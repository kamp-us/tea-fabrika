// The anti-slop lint plugin, taken as it ships (decision 0563): the fork's `src/` sits unchanged in
// vendor/anti-slop/ (vendored.ts holds that), and `.oxlintrc.json` loads its two plugins. The owner
// took ten of its rules. Each is on as an error in the folders its own block at the end of the
// config lists, and nowhere else: a folder goes on a rule's list in the pull request that brings it
// to zero hits of that rule.
//
// A whole `pnpm lint` run calls `audit` here, which holds three things. The config loads each of the
// fork's two plugins from vendor/anti-slop/ and from nowhere else (`strays`), so an edited copy in
// another folder cannot stand in for it. The folder is the pinned commit's code (vendored.ts). And
// the zero lock: one more oxlint run, with the taken rules over the whole scope, fails on a folder
// with no hit of a rule that the rule's list does not name, and on a listed glob that is not a folder
// of the scope. It keeps no list of its own: the folders still waiting are the scope's folders minus
// the rule's list.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob, relative, resolve } from "node:path";
import { Exit, Predicate, Schema } from "effect";
import { verify } from "./vendored.ts";

/**
 * The ten rules the owner took, as the config names them: eight by 0558, 0561, 0562 and 0563, and the
 * two Match rules by 0567.
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

/** The four globs of the whole scope. A rule's list becomes these once every folder is on it. */
export const WHOLE: ReadonlyArray<string> = ["next/**", ".agents/**", "oxlint-plugins/**", ".github/ci/**"];

/** The folders the zero lock's run reads: the scope, as the four globs name it. */
const ROOTS = ["next", ".agents", "oxlint-plugins", ".github/ci"];

const LIBFABRIKA = "next/packages/libfabrika/src";

/** Each folder right under `path`, as the glob a rule's list names it by. */
const subfolders = (root: string, path: string): ReadonlyArray<string> =>
  readdirSync(join(root, path), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => `${path}/${entry.name}/**`);

/**
 * The folders of the scope, read from the disk, each as the glob a rule's list names it by: each
 * tooling folder, the files of libfabrika outside a module, each module of libfabrika, each other
 * package, each program and the app. A new folder is one of them from its first file.
 */
export const folders = (root: string): ReadonlyArray<string> => [
  ".agents/**",
  ".github/ci/**",
  "oxlint-plugins/**",
  `${LIBFABRIKA}/*`,
  ...subfolders(root, LIBFABRIKA),
  ...subfolders(root, "next/packages").filter((glob) => glob !== "next/packages/libfabrika/**"),
  ...subfolders(root, "next/programs"),
  ...subfolders(root, "next/apps"),
];

/** What the zero lock asks of one rule's list. */
interface Lock {
  /** The folders of the scope with no hit of the rule that its list does not name yet. */
  readonly add: ReadonlyArray<string>;
  /** The globs on its list that are neither a folder of the scope nor one of the four whole-scope globs. */
  readonly refused: ReadonlyArray<string>;
}

/** A listed glob covers a folder when it names that folder, or is a whole-scope glob above it. */
const covers = (glob: string, folder: string): boolean =>
  glob === folder || (WHOLE.includes(glob) && folder.startsWith(glob.slice(0, -"**".length)));

/** The zero lock for one rule: its list, and the rule's hits in each folder of the scope. */
export const lock = (
  scope: ReadonlyArray<string>,
  listed: ReadonlyArray<string>,
  hits: ReadonlyMap<string, number>,
): Lock => ({
  add: scope.filter((folder) => (hits.get(folder) ?? 0) === 0 && !listed.some((glob) => covers(glob, folder))),
  refused: listed.filter((glob) => !scope.includes(glob) && !WHOLE.includes(glob)),
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
      Schema.Struct({ files: Schema.Array(Schema.String), rules: Schema.Record(Schema.String, Setting) }),
    ),
  }),
);

/** What the lock's oxlint run reports, as `--format=json` prints it. */
const Report = Schema.fromJsonString(
  Schema.Struct({
    number_of_files: Schema.Number,
    diagnostics: Schema.Array(
      Schema.Struct({ code: Schema.optionalKey(Schema.String), filename: Schema.optionalKey(Schema.String) }),
    ),
  }),
);

// `Predicate.isString` is the guard: `Array.isArray` does not narrow a readonly tuple out of the union.
const levelOf = (setting: Setting): string => (Predicate.isString(setting) ? setting : setting[0]);

/** A printed setting as a config writes it: `["deny", [options]]` becomes `["deny", options]`. */
const written = (setting: Setting): string | ReadonlyArray<unknown> =>
  Predicate.isString(setting) ? setting : [setting[0], ...setting[1]];

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
  const plugins = PLUGINS.map(({ name, specifier }) => ({ name, specifier: join(root, specifier) }));
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
  const codes = new Map(TAKEN.map((rule) => [codeOf(rule), rule]));
  const hits = new Map(TAKEN.map((rule) => [rule, new Map<string, number>()]));

  // The config's ignore list is matched here, from the top of the repo, as lint.ts's run reads it.
  for (const { code, filename } of report.value.diagnostics) {
    const file = relative(root, resolve(root, filename ?? ""));
    const rule = codes.get(code ?? "");
    const folder = scope.find((glob) => matchesGlob(file, glob));
    const counted = rule === undefined ? undefined : hits.get(rule);

    if (counted !== undefined && folder !== undefined && !ignored.some((glob) => matchesGlob(file, glob))) {
      counted.set(folder, (counted.get(folder) ?? 0) + 1);
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

  return config.value.jsPlugins.flatMap((plugin) => {
    const pinned = Predicate.isString(plugin) ? undefined : PLUGINS.find(({ name }) => name === plugin.name);
    const from = Predicate.isString(plugin) ? "" : relative(root, resolve(root, plugin.specifier));
    return pinned === undefined || from === pinned.specifier
      ? []
      : [
          `.oxlintrc.json: ${pinned.name} is loaded from ${from}, and only ${pinned.specifier} is the pinned copy (0563)`,
        ];
  });
};

/**
 * Every line a whole run prints for the anti-slop plugin, none when all holds: the config loads its
 * two plugins from vendor/anti-slop/ (`strays`), that folder is the pinned commit's code
 * (vendored.ts), and each taken rule's list is as the zero lock asks. `printed` is the text of
 * `oxlint --print-config` for the config the run lints with. A config that loads neither of the
 * fork's plugins, as a test's small repo has, runs none of their code, so there is nothing to hold.
 */
export const audit = (root: string, printed: string): ReadonlyArray<string> => {
  const config = Schema.decodeUnknownExit(Printed)(printed);

  if (Exit.isFailure(config)) {
    return [UNREAD];
  }

  const { jsPlugins, overrides, ignorePatterns } = config.value;
  const names = new Set(PLUGINS.map(({ name }) => name));

  if (!jsPlugins.some((plugin) => !Predicate.isString(plugin) && names.has(plugin.name))) {
    return [];
  }

  const pinned = [...strays(root, printed), ...verify(root)];
  /** The blocks that turn a rule on: each override that names it at error. */
  const blocks = (rule: string) =>
    overrides.flatMap((block) => {
      const setting = block.rules[rule];
      return setting !== undefined && levelOf(setting) === "deny" ? [{ files: block.files, setting }] : [];
    });
  // The lock's run uses each rule's options from its own block, so it counts what the config holds.
  const settings = Object.fromEntries(TAKEN.map((rule) => [rule, written(blocks(rule)[0]?.setting ?? "deny")]));
  const hits = count(root, settings, ignorePatterns);

  if (hits === null) {
    return [...pinned, "anti-slop.ts: the zero lock's oxlint run did not finish, so it read nothing"];
  }

  const scope = folders(root);
  const unlocked = TAKEN.flatMap((rule) => {
    const { add, refused } = lock(
      scope,
      blocks(rule).flatMap((block) => block.files),
      hits.get(rule) ?? new Map(),
    );
    return [
      ...add.map(
        (folder) => `.oxlintrc.json: ${rule} has no hit left in ${folder}: add the folder to its block (0563)`,
      ),
      ...refused.map((glob) => `.oxlintrc.json: ${rule}'s block names ${glob}, which is not a folder of its scope`),
    ];
  });
  return [...pinned, ...unlocked];
};
