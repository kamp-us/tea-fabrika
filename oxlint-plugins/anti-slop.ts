// The anti-slop lint plugin, taken as it ships (we use the anti-slop plugin as it ships, never our own copy of its rules): the fork's `src/` sits unchanged in
// vendor/anti-slop/ (vendored.ts holds that), and `.oxlintrc.json` loads its two plugins. The owner
// took ten of its rules. Each is on as an error across the whole scope, from its own block at the
// end of the config, and that block's `excludeFiles` names the folders that still have hits. A new
// folder is on from its first file, and a pull request that brings a folder to zero takes it off
// the exclude list: the list only shrinks, as advice.ts's warn lines do. No other block may set a
// taken rule to warn or off.
//
// A whole `pnpm lint` run calls `audit` here, which holds three things. The config loads each of the
// fork's two plugins from vendor/anti-slop/ and from nowhere else (`strays`), so an edited copy in
// another folder cannot stand in for it. The folder is the pinned commit's code (vendored.ts). And
// the zero lock: one more oxlint run, with the taken rules over the whole scope, fails on an
// excluded folder with no hit of its rule left outside the excluded folders inside it, on a folder
// with hits that no excluded folder covers, on an excluded glob that is not a folder of the scope,
// on an excluded glob that the list at the merge base with origin/main does not name, on a block
// whose `files` leave out part of the scope, and on a block that sets a taken rule below error.
// The typecheck port is today's lead tooling and joins as four exact globs.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob, relative, resolve } from "node:path";
import { Array as Arr, Exit, pipe, Option, Predicate, Record as Rec, Schema } from "effect";
import { parseSync } from "oxc-parser";
import { verify } from "./vendored.ts";

/**
 * The ten rules the owner took, as the config names them: eight by the ternary-depth rule, the cast-comment rule, the no-wrong-shape rule and the anti-slop rule, and the
 * two Match rules by the match rule.
 */
export const TAKEN: ReadonlyArray<string> = [
  "anti-slop/max-ternary-depth",
  "anti-slop/require-safety-comment-for-type-assertion",
  "anti-slop/require-readable-spacing",
  "anti-slop/no-unknown-parameters",
  "anti-slop/no-unknown-returns",
  "anti-slop/no-runtime-typeof",
  "anti-slop-effect/no-manual-tagged-construction",
  "anti-slop-effect/no-manual-tagged-type",
  "anti-slop-effect/no-manual-tag-comparison",
  "anti-slop-effect/prefer-effect-match",
];

/** The fork's two plugins, as `.oxlintrc.json`'s `jsPlugins` names them, from the top of the repo. */
const PLUGINS = [
  { name: "anti-slop", specifier: "vendor/anti-slop/src/index.ts" },
  { name: "anti-slop-effect", specifier: "vendor/anti-slop/src/effect/index.ts" },
];

/** The globs of the whole scope but the typecheck port, each a tree every taken rule is on in. */
export const WHOLE: ReadonlyArray<string> = ["next/**", "kalfa/**", ".agents/**", "oxlint-plugins/**", ".github/ci/**"];

/** The typecheck port's four globs, as its lint blocks name them. */
const TYPECHECK = [
  "scripts/typecheck.ts",
  "scripts/typecheck/**",
  "scripts/typecheck.test.ts",
  "scripts/typecheck-lock.test.ts",
];

/** The folders and files the zero lock's run reads. */
const ROOTS = [
  "next",
  "kalfa",
  ".agents",
  "oxlint-plugins",
  ".github/ci",
  ...Arr.map(TYPECHECK, (glob) => glob.replace(/\/\*\*$/, "")),
];

const LIBFABRIKA = "next/packages/libfabrika/src";

/** Each folder right under `path`, as the glob a rule's list names it by. */
const subfolders = (root: string, path: string): ReadonlyArray<string> =>
  pipe(
    readdirSync(join(root, path), { withFileTypes: true }),
    Arr.filter((entry) => entry.isDirectory() && entry.name !== "node_modules"),
    Arr.map((entry) => `${path}/${entry.name}/**`),
  );

/**
 * The folders of the scope, read from the disk, each as the glob a rule's list names it by: each
 * tooling folder, the typecheck port, the files of libfabrika outside a module, each module of
 * libfabrika, each other package, each program and the app. A new folder is one of them from its first file.
 */
export const folders = (root: string): ReadonlyArray<string> => [
  ".agents/**",
  ".github/ci/**",
  "oxlint-plugins/**",
  ...TYPECHECK,
  `${LIBFABRIKA}/*`,
  ...subfolders(root, LIBFABRIKA),
  ...Arr.filter(subfolders(root, "next/packages"), (glob) => glob !== "next/packages/libfabrika/**"),
  ...subfolders(root, "next/programs"),
  ...subfolders(root, "next/apps"),
  ...subfolders(root, "kalfa").flatMap((glob) => [
    ...subfolders(root, glob.slice(0, -"/**".length)).filter((folder) => folder.endsWith("/src/**")),
    glob,
  ]),
];

/** Every glob a taken rule's block names in `files`: the whole scope, so a new folder is on from its first file. */
export const SCOPE: ReadonlyArray<string> = [...WHOLE, ...TYPECHECK];

/** What the zero lock asks of one rule's exclude list. */
interface Lock {
  /** The excluded folders with no hit of the rule left: each comes off the list. */
  readonly remove: ReadonlyArray<string>;
  /** The folders with a hit that no excluded folder covers. */
  readonly missing: ReadonlyArray<string>;
  /** The excluded globs that are not a folder of the scope. */
  readonly refused: ReadonlyArray<string>;
  /** The excluded globs the base branch's list does not name: a list only shrinks. */
  readonly added: ReadonlyArray<string>;
}

/** A glob covers its own folder and every folder below it. */
const covers = (glob: string, folder: string): boolean =>
  glob === folder || (glob.endsWith("/**") && folder.startsWith(glob.slice(0, -"**".length)));

/**
 * The hits of `folder` that no excluded folder covers: its own count, less the counts of the
 * outermost excluded folders inside it, which never overlap.
 */
const loose = (folder: string, excluded: ReadonlyArray<string>, hits: ReadonlyMap<string, number>): number => {
  const inside = Arr.filter(excluded, (glob) => glob !== folder && covers(folder, glob));
  const outermost = Arr.filter(inside, (glob) => !Arr.some(inside, (other) => other !== glob && covers(other, glob)));

  return (hits.get(folder) ?? 0) - Arr.reduce(outermost, 0, (sum, glob) => sum + (hits.get(glob) ?? 0));
};

/**
 * The zero lock for one rule: its exclude list, the rule's hits in each folder of the scope, and the
 * rule's list at the merge base with origin/main. That list is `null` when the base branch has no
 * whole-scope block for the rule, the config's shape before this lock, so there is no list to grow past.
 */
export const lock = (
  scope: ReadonlyArray<string>,
  excluded: ReadonlyArray<string>,
  hits: ReadonlyMap<string, number>,
  base: ReadonlyArray<string> | null,
): Lock => ({
  remove: Arr.filter(excluded, (glob) => scope.includes(glob) && loose(glob, excluded, hits) === 0),
  missing: Arr.filter(
    scope,
    (folder) => !Arr.some(excluded, (glob) => covers(glob, folder)) && loose(folder, excluded, hits) > 0,
  ),
  refused: Arr.filter(excluded, (glob) => !scope.includes(glob)),
  added: base === null ? [] : Arr.filter(excluded, (glob) => !base.includes(glob)),
});

/** A rule's setting as `oxlint --print-config` prints it: a level, or a level and the list of its options. */
const Setting = Schema.Union([Schema.String, Schema.Tuple([Schema.String, Schema.Array(Schema.Unknown)])]);

type Setting = typeof Setting.Type;

/** The part of `oxlint --print-config`, oxlint's own reading of the config, that the lock reads. */
const Printed = Schema.fromJsonString(
  Schema.Struct({
    jsPlugins: Schema.Array(
      Schema.Union([Schema.String, Schema.Struct({ name: Schema.String, specifier: Schema.String })]),
    ),
    ignorePatterns: Schema.Array(Schema.String),
    overrides: Schema.Array(
      Schema.Struct({
        files: Schema.Array(Schema.String),
        excludeFiles: Schema.optionalKey(Schema.Array(Schema.String)),
        rules: Schema.Record(Schema.String, Setting),
      }),
    ),
  }),
);

// `Predicate.isString` is the guard: `Array.isArray` does not narrow a readonly tuple out of the union.
const levelOf = (setting: Setting): string => (Predicate.isString(setting) ? setting : setting[0]);

/** The part of the config's own text the base branch's lists are read from: its blocks. */
const Written = Schema.fromJsonString(
  Schema.Struct({
    overrides: Schema.Array(
      Schema.Struct({
        files: Schema.Array(Schema.String),
        excludeFiles: Schema.optionalKey(Schema.Array(Schema.String)),
        rules: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
      }),
    ),
  }),
);

/** The config's text with its comments cut out, as oxc-parser finds them, so it is JSON. */
const uncommented = (text: string): string => {
  const prefix = "export default ";
  const { comments } = parseSync("oxlintrc.ts", `${prefix}${text}`);

  const kept = Arr.reduce(comments, { text: "", at: 0 }, (cut, comment) => ({
    text: cut.text + text.slice(cut.at, comment.start - prefix.length),
    at: comment.end - prefix.length,
  }));

  return kept.text + text.slice(kept.at);
};

/**
 * Each taken rule's exclude list in a config's text, as the base branch holds it. A rule whose
 * blocks there leave part of the scope out of `files` has no entry: that is the shape before this
 * lock. None when the text is no config.
 */
export const baseLists = (text: string): Option.Option<ReadonlyMap<string, ReadonlyArray<string>>> => {
  const config = Schema.decodeUnknownExit(Written)(uncommented(text));

  if (Exit.isFailure(config)) {
    return Option.none();
  }

  const lists = Arr.flatMap(TAKEN, (rule) => {
    const named = Arr.filter(config.value.overrides, (block) => block.rules?.[rule] !== undefined);
    const whole = Arr.every(SCOPE, (glob) => Arr.some(named, (block) => block.files.includes(glob)));

    return whole ? [[rule, Arr.flatMap(named, (block) => block.excludeFiles ?? [])] as const] : [];
  });

  return Option.some(new Map(lists));
};

/** The config's text at the merge base with origin/main; `null` when git could not give it. */
export const baseConfig = (root: string): string | null => {
  const base = spawnSync("git", ["merge-base", "origin/main", "HEAD"], { cwd: root, encoding: "utf8" });
  const sha = base.stdout.trim();

  if (base.status !== 0 || !/^[0-9a-f]{40}$/.test(sha)) {
    return null;
  }

  const shown = spawnSync("git", ["show", `${sha}:.oxlintrc.json`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 ** 28,
  });

  return shown.status === 0 ? shown.stdout : null;
};

/**
 * One line for each block that sets a taken rule to anything but error, as `--print-config` prints
 * the blocks: a later block set to warn or off would turn the rule down in its folders.
 */
export const lowered = (
  overrides: ReadonlyArray<{
    readonly files: ReadonlyArray<string>;
    readonly rules: Readonly<Record<string, Setting>>;
  }>,
): ReadonlyArray<string> =>
  Arr.flatMap(overrides, (block) =>
    Arr.flatMap(TAKEN, (rule) => {
      const setting = block.rules[rule];

      return setting === undefined || levelOf(setting) === "deny"
        ? []
        : [
            `.oxlintrc.json: a block sets ${rule} to ${levelOf(setting)} in ${block.files.join(", ")}; a taken rule is an error everywhere, and a folder with hits goes in its block's excludeFiles`,
          ];
    }),
  );

/** What the lock's oxlint run reports, as `--format=json` prints it. */
const Report = Schema.fromJsonString(
  Schema.Struct({
    number_of_files: Schema.Finite,
    diagnostics: Schema.Array(
      Schema.Struct({ code: Schema.optionalKey(Schema.String), filename: Schema.optionalKey(Schema.String) }),
    ),
  }),
);

/** A printed setting as a config writes it: `["deny", [options]]` becomes `["deny", options]`. */
const written = (setting: Setting): string | ReadonlyArray<unknown> =>
  Predicate.isString(setting) ? setting : [setting[0], ...setting[1]];

/** Count a file's hit in every containing folder, including a package and its source folder. */
export const countFile = (scope: ReadonlyArray<string>, hits: Map<string, number>, file: string): void => {
  for (const folder of scope) {
    if (matchesGlob(file, folder)) {
      hits.set(folder, (hits.get(folder) ?? 0) + 1);
    }
  }
};

/** `anti-slop/no-runtime-typeof` as oxlint prints its code: `anti-slop(no-runtime-typeof)`. */
const codeOf = (rule: string): string => `${rule.replace("/", "(")})`;

/** Each taken rule's hits in each folder, from one oxlint run over the scope; `null` when it did not finish. */
const count = (
  root: string,
  settings: Readonly<Record<string, string | ReadonlyArray<unknown>>>,
  ignored: ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlyMap<string, number>> | null => {
  const home = mkdtempSync(join(tmpdir(), "anti-slop-lock-"));
  const config = join(home, "oxlintrc.json");
  const plugins = Arr.map(PLUGINS, ({ name, specifier }) => ({ name, specifier: join(root, specifier) }));
  writeFileSync(
    config,
    JSON.stringify({ categories: { correctness: "off" }, plugins: [], jsPlugins: plugins, rules: settings }),
  );

  const ran = spawnSync(
    join(root, "node_modules", ".bin", "oxlint"),
    [`--config=${config}`, "--disable-nested-config", "--no-ignore", "--format=json", ...ROOTS],
    { cwd: root, encoding: "utf8", maxBuffer: 2 ** 30 },
  );

  rmSync(home, { recursive: true, force: true });
  const report = Schema.decodeUnknownExit(Report)(ran.stdout);

  if (Exit.isFailure(report) || report.value.number_of_files === 0) {
    return null;
  }

  const scope = folders(root);
  const codes = new Map(Arr.map(TAKEN, (rule) => [codeOf(rule), rule]));
  const hits = new Map(Arr.map(TAKEN, (rule) => [rule, new Map<string, number>()]));

  // The config's ignore list is matched here, from the top of the repo, as lint.ts's run reads it.
  for (const { code, filename } of report.value.diagnostics) {
    const file = relative(root, resolve(root, filename ?? ""));
    const rule = codes.get(code ?? "");
    const counted = rule === undefined ? undefined : hits.get(rule);

    if (counted !== undefined && !Arr.some(ignored, (glob) => matchesGlob(file, glob))) {
      countFile(scope, counted, file);
    }
  }

  return hits;
};

const UNREAD = "anti-slop.ts: could not read oxlint --print-config, so nothing says the anti-slop plugin holds";

/**
 * One line for each `jsPlugins` entry named for one of the fork's two plugins that loads it from
 * anywhere but its vendored path, so an edited copy in another folder cannot stand in for the pinned
 * one. `printed` is the text of `oxlint --print-config` for the config at the top of `root`.
 */
export const strays = (root: string, printed: string): ReadonlyArray<string> => {
  const config = Schema.decodeUnknownExit(Printed)(printed);

  if (Exit.isFailure(config)) {
    return [UNREAD];
  }

  return Arr.flatMap(config.value.jsPlugins, (plugin) => {
    const pinned = Predicate.isString(plugin)
      ? Option.none()
      : Arr.findFirst(PLUGINS, ({ name }) => name === plugin.name);

    const from = Predicate.isString(plugin) ? "" : relative(root, resolve(root, plugin.specifier));

    return Option.isNone(pinned) || from === pinned.value.specifier
      ? []
      : [
          `.oxlintrc.json: ${pinned.value.name} is loaded from ${from}, and only ${pinned.value.specifier} is the pinned copy (we use the anti-slop plugin as it ships, never our own copy of its rules)`,
        ];
  });
};

/**
 * Every line a whole run prints for the anti-slop plugin, none when all holds: the config loads its
 * two plugins from vendor/anti-slop/ (`strays`), that folder is the pinned commit's code
 * (vendored.ts), and each taken rule's list is as the zero lock asks. `printed` is the text of
 * `oxlint --print-config` for the config the run lints with, and `base` the config's own text at the
 * merge base with origin/main (`baseConfig`). A config that loads neither of the
 * fork's plugins, as a test's small repo has, runs none of their code, so there is nothing to hold.
 */
export const audit = (root: string, printed: string, base: string | null): ReadonlyArray<string> => {
  const config = Schema.decodeUnknownExit(Printed)(printed);

  if (Exit.isFailure(config)) {
    return [UNREAD];
  }

  const { jsPlugins, overrides, ignorePatterns } = config.value;
  const names = new Set(Arr.map(PLUGINS, ({ name }) => name));

  if (!Arr.some(jsPlugins, (plugin) => !Predicate.isString(plugin) && names.has(plugin.name))) {
    return [];
  }

  const pinned = [...strays(root, printed), ...verify(root)];

  /** The blocks that turn a rule on: each override that names it at error. */
  const blocks = (rule: string) =>
    Arr.flatMap(overrides, (block) => {
      const setting = block.rules[rule];

      return setting !== undefined && levelOf(setting) === "deny"
        ? [{ files: block.files, excluded: block.excludeFiles ?? [], setting }]
        : [];
    });

  // The lock's run uses each rule's options from its own block, so it counts what the config holds.
  const settings = Rec.fromEntries(Arr.map(TAKEN, (rule) => [rule, written(blocks(rule)[0]?.setting ?? "deny")]));
  const hits = count(root, settings, ignorePatterns);

  if (hits === null) {
    return [...pinned, "anti-slop.ts: the zero lock's oxlint run did not finish, so it read nothing"];
  }

  const lists = base === null ? Option.none() : baseLists(base);

  if (Option.isNone(lists)) {
    return [
      ...pinned,
      "anti-slop.ts: could not read .oxlintrc.json at the merge base with origin/main, so nothing says an exclude list only shrinks",
    ];
  }

  const scope = folders(root);

  const unlocked = Arr.flatMap(TAKEN, (rule) => {
    const on = blocks(rule);

    const { remove, missing, refused, added } = lock(
      scope,
      Arr.flatMap(on, (block) => block.excluded),
      hits.get(rule) ?? new Map(),
      lists.value.get(rule) ?? null,
    );

    const narrow = Arr.filter(SCOPE, (glob) => !Arr.some(on, (block) => block.files.includes(glob)));

    return [
      ...Arr.map(
        remove,
        (folder) =>
          `.oxlintrc.json: ${rule} has no hit left in ${folder}: remove the folder from its block's excludeFiles (a taken rule goes on in each folder the moment the folder reaches zero)`,
      ),
      ...Arr.map(
        missing,
        (folder) =>
          `.oxlintrc.json: ${rule} has hits in ${folder}, which its block's excludeFiles does not name: fix them, since the list only shrinks`,
      ),
      ...Arr.map(
        refused,
        (glob) => `.oxlintrc.json: ${rule}'s excludeFiles names ${glob}, which is not a folder of its scope`,
      ),
      ...Arr.map(
        added,
        (glob) =>
          `.oxlintrc.json: ${rule}'s excludeFiles names ${glob}, which its list at the merge base with origin/main does not: fix its hits, since the list only shrinks`,
      ),
      ...Arr.map(
        narrow,
        (glob) => `.oxlintrc.json: ${rule}'s block leaves ${glob} out of its files, which name the whole scope`,
      ),
    ];
  });

  return [...pinned, ...unlocked, ...lowered(overrides)];
};
