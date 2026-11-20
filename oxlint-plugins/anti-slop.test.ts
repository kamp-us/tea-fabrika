// The anti-slop rules the owner took (we use the anti-slop plugin as it ships, never our own copy of its rules) are the exam, so each is seen to fire through the
// repository's own .oxlintrc.json, everywhere in the scope but the folders its block excludes (L2,
// L3). The config names no other rule of the two plugins, and never turns a taken one down (L3, L5).
// The zero lock in anti-slop.ts is a property of its own (L4), and no block may set a taken rule
// below error (L9). The config loads the two plugins from vendor/anti-slop/ and from nowhere else (L7).
//
// Plants, each run once and undone:
// - L2: drop the `anti-slop-effect` entry from `jsPlugins`. The two tag rules load no rule, and their
//   plants get no diagnostic.
// - L3: name a taken rule in the root `rules`. It fires in a folder its block excludes.
// - L4: `lock` answers "nothing to remove" for every input.
// - L4: `added` answers [] whatever the base branch's list holds; `remove` reads a folder's own
//   hits in place of `loose`.
// - L9: `lowered` reads only the blocks that set a taken rule at error.
// - L5: add `{ "files": ["next/**"], "rules": { "anti-slop/no-runtime-typeof": "off" } }` at the end.
// - L7: load `anti-slop` from `./oxlint-plugins/fixtures/edited-copy/index.ts` in `.oxlintrc.json`.
//   The scenario then reads a line naming that path.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { it as effectIt } from "@effect/vitest";
import { Array as Arr, Effect, pipe, Option, Order, Predicate, Record as Rec, Schema } from "effect";
import fc from "fast-check";
import { parseSync } from "oxc-parser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baseLists, countFile, folders, lock, lowered, SCOPE, strays, TAKEN, WHOLE } from "./anti-slop.ts";

const ROOT = join(import.meta.dirname, "..");

const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");

/** A rule's setting as `oxlint --print-config` prints it: a level, or a level and the list of its options. */
const Setting = Schema.Union([Schema.String, Schema.Tuple([Schema.String, Schema.Array(Schema.Unknown)])]);

const Rules = Schema.Record(Schema.String, Setting);

/** The part of oxlint's own reading of the config these laws read: its blocks. */
const Printed = Schema.fromJsonString(
  Schema.Struct({
    overrides: Schema.Array(
      Schema.Struct({
        files: Schema.Array(Schema.String),
        excludeFiles: Schema.optionalKey(Schema.Array(Schema.String)),
        rules: Rules,
      }),
    ),
  }),
);

/**
 * The rules the config's root `rules` names, read from its own text with oxc-parser, as
 * no-static-layer.test.ts reads it: `--print-config` leaves every JS plugin's rule out of the root.
 */
const rootRules = (): ReadonlyArray<string> => {
  const text = readFileSync(join(ROOT, ".oxlintrc.json"), "utf8");
  const [statement] = parseSync("oxlintrc.ts", `(${text})`).program.body;
  const top = statement?.type === "ExpressionStatement" ? statement.expression : undefined;
  const config = top?.type === "ParenthesizedExpression" ? top.expression : top;
  const properties = config?.type === "ObjectExpression" ? config.properties : [];

  const rules = Arr.findFirst(
    properties,
    (property) => property.type === "Property" && property.key.type === "Literal" && property.key.value === "rules",
  );

  const value = Option.isSome(rules) && rules.value.type === "Property" ? rules.value.value : undefined;
  const named = value?.type === "ObjectExpression" ? value.properties : [];

  return Arr.flatMap(named, (property) =>
    property.type === "Property" && property.key.type === "Literal" ? [String(property.key.value)] : [],
  );
};

/** What one oxlint run reports, as `--format=json` prints it. */
const Report = Schema.fromJsonString(
  Schema.Struct({
    diagnostics: Schema.Array(
      Schema.Struct({
        code: Schema.String,
        filename: Schema.String,
        labels: Schema.Array(Schema.Struct({ span: Schema.Struct({ line: Schema.Finite }) })),
      }),
    ),
  }),
);

/** The text of `oxlint --print-config` for the repository's own config. */
const printout = spawnSync(OXLINT, [`--config=${join(ROOT, ".oxlintrc.json")}`, "--print-config"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 2 ** 28,
}).stdout;

const printed = Schema.decodeUnknownSync(Printed)(printout);

const levelOf = (setting: typeof Setting.Type): string => (Predicate.isString(setting) ? setting : setting[0]);

const ofThePlugins = (rule: string): boolean => rule.startsWith("anti-slop/") || rule.startsWith("anti-slop-effect/");

/** The blocks that turn a rule on, as the config holds them: each override that names it at error. */
const blocksOf = (rule: string) =>
  Arr.filter(printed.overrides, (block) => {
    const setting = block.rules[rule];

    return setting !== undefined && levelOf(setting) === "deny";
  });

/** The folders a rule's blocks exclude. */
const excluded = (rule: string): ReadonlyArray<string> =>
  Arr.flatMap(blocksOf(rule), (block) => block.excludeFiles ?? []);

/** `anti-slop/max-ternary-depth` as oxlint prints its code: `anti-slop(max-ternary-depth)`. */
const codeOf = (rule: string): string => `${rule.replace("/", "(")})`;

/**
 * One refused and one taken case per rule, after the plugin's own README and tests. The line that
 * must fire ends in `// refused`, and the one that must not in `// taken`.
 */
const PLANTS: Readonly<Record<string, ReadonlyArray<string>>> = {
  "anti-slop/max-ternary-depth": [
    "export const deep = (a: boolean, b: boolean, c: boolean) => (a ? 1 : b ? 2 : c ? 3 : 4); // refused",
    "",
    "export const two = (a: boolean, b: boolean) => (a ? 1 : b ? 2 : 3); // taken",
  ],
  "anti-slop/require-safety-comment-for-type-assertion": [
    "declare const value: string | number;",
    "",
    "export const bare = value as string; // refused",
    "",
    "// SAFETY: the plant declares value, and no test reads it.",
    "export const said = value as string; // taken",
  ],
  "anti-slop/require-readable-spacing": [
    "export function crowded(): number {",
    "  const a = 1;",
    "  return a; // refused",
    "}",
    "",
    "export function spaced(): number {",
    "  const b = 1;",
    "",
    "  return b; // taken",
    "}",
  ],
  "anti-slop/no-unknown-parameters": [
    "export const parse = (value: unknown): void => {}; // refused",
    "",
    "export const enrich = (cause: unknown): void => {}; // taken",
  ],
  "anti-slop/no-unknown-returns": [
    "export declare function load(): unknown; // refused",
    "",
    "export declare function name(): string; // taken",
  ],
  "anti-slop/no-runtime-typeof": [
    "declare const value: string | number;",
    "",
    'export const isText = typeof value === "string"; // refused',
    "",
    'export const hasWindow = typeof globalThis.window === "undefined"; // taken',
  ],
  "anti-slop-effect/no-manual-tagged-construction": [
    'export const ready = { _tag: "Ready" }; // refused',
    "",
    'export const plain = { tag: "Ready" }; // taken',
  ],
  "anti-slop-effect/no-manual-tagged-type": [
    'export type Ready = { readonly _tag: "Ready" }; // refused',
    "",
    'export type Plain = { readonly tag: "Ready" }; // taken',
  ],
  // The match rule's two Match rules.
  "anti-slop-effect/no-manual-tag-comparison": [
    "declare const value: { readonly _tag: string; readonly status: string };",
    "",
    'export const isReady = value._tag === "Ready"; // refused',
    "",
    'export const isUp = value.status === "Ready"; // taken',
  ],
  "anti-slop-effect/prefer-effect-match": [
    "declare const kind: string;",
    "",
    'export const chained = kind === "a" ? 1 : kind === "b" ? 2 : 3; // refused',
    "",
    'export const single = kind === "a" ? 1 : 2; // taken',
  ],
};

/** The 1-based line of the plant that ends in `mark`. */
const lineOf = (lines: ReadonlyArray<string>, mark: string): number =>
  Option.match(
    Arr.findFirstIndex(lines, (line) => line.endsWith(mark)),
    { onNone: () => 0, onSome: (index) => index + 1 },
  );

/** A folder's glob of the whole tree under it, as plants are written into, never a whole-scope glob. */
const tree = (glob: string): boolean => glob.endsWith("/**");

/** Whether a rule's blocks exclude a folder: the folder itself, or one it sits in. */
const isExcluded = (rule: string, folder: string): boolean =>
  Arr.some(
    excluded(rule),
    (glob) => glob === folder || (glob.endsWith("/**") && folder.startsWith(glob.slice(0, -"**".length))),
  );

/**
 * A folder of the scope that a rule's block does not exclude, where its plant must fire: this test's
 * own folder while it is not excluded, as plants.test.ts plants beside itself, else the first.
 */
const included = (rule: string): Option.Option<string> =>
  Arr.findFirst(["oxlint-plugins/**", ...folders(ROOT)], (folder) => tree(folder) && !isExcluded(rule, folder));

/** Where a rule's plant goes: a folder of the scope, as its glob. */
interface Site {
  readonly rule: string;
  readonly glob: string;
}

/** Each taken rule in the first folder its block does not exclude. */
const ON: ReadonlyArray<Site> = Arr.flatMap(TAKEN, (rule) =>
  Option.match(included(rule), { onNone: () => [], onSome: (glob) => [{ rule, glob }] }),
);

/** Each taken rule in the first folder its block excludes. A rule whose list is empty has none left. */
const OFF: ReadonlyArray<Site> = Arr.flatMap(TAKEN, (rule) =>
  Arr.map(Arr.filter(excluded(rule), tree).slice(0, 1), (glob) => ({ rule, glob })),
);

const made: Array<string> = [];

afterAll(() => {
  for (const folder of made) {
    rmSync(folder, { recursive: true, force: true });
  }
});

/** Writes a rule's plant into a new folder inside its site's folder, and gives its path from the top of the repo. */
const plant = ({ rule, glob }: Site): string => {
  const folder = mkdtempSync(join(ROOT, glob.slice(0, -"/**".length), "anti-slop-plant-"));
  made.push(folder);
  const file = join(folder, `${rule.replace("/", "-")}.ts`);
  writeFileSync(file, `${Arr.join(PLANTS[rule] ?? [], "\n")}\n`);

  return relative(ROOT, file);
};

let fires: ReadonlyMap<Site, ReadonlyArray<number>> = new Map();

beforeAll(() => {
  const sites = [...ON, ...OFF];
  const files = Arr.map(sites, plant);

  // One oxlint run for every plant, through the repository's own config.
  const ran = spawnSync(OXLINT, ["--disable-nested-config", "--format=json", ...files], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 2 ** 28,
  });

  const { diagnostics } = Schema.decodeUnknownSync(Report)(ran.stdout);
  fires = new Map(
    Arr.map(sites, (site, i) => [
      site,
      pipe(
        diagnostics,
        Arr.filter(({ code, filename }) => filename === files[i] && code === codeOf(site.rule)),
        Arr.flatMap(({ labels }) => Arr.map(labels.slice(0, 1), ({ span }) => span.line)),
      ),
    ]),
  );
});

describe("L2 each taken rule fires through the repository's own config, in a folder its block does not exclude", () => {
  it("scenario: every taken rule has its plant, refused and taken", () => {
    expect(Arr.sort(Rec.keys(PLANTS), Order.String)).toEqual(Arr.sort(TAKEN, Order.String));
    expect(ON.length).toBeGreaterThan(0);
  });

  it.each(ON)("scenario: $rule fires on its refused line and not on its taken line, in $glob", (site) => {
    const lines = PLANTS[site.rule] ?? [];
    expect(fires.get(site)).toEqual([lineOf(lines, "// refused")]);
    expect(fires.get(site)).not.toContain(lineOf(lines, "// taken"));
  });
});

describe("L3 a taken rule holds everywhere but the folders its block excludes", () => {
  it("scenario: every taken rule's block names the whole scope in its files", () => {
    for (const rule of TAKEN) {
      expect(
        Arr.filter(SCOPE, (glob) => !Arr.some(blocksOf(rule), (block) => block.files.includes(glob))),
        rule,
      ).toEqual([]);
    }
  });

  it.each(OFF)(
    "scenario: $rule's refused line gets none of its diagnostics in $glob, which its block excludes",
    (site) => {
      expect(fires.get(site)).toEqual([]);
    },
  );

  it("scenario: the root rules name no rule of the two plugins, and no block names one the owner did not take", () => {
    const root = rootRules();
    // The root holds many rules: none read means the text was not read, never that it is clean.
    expect(root.length).toBeGreaterThan(0);
    expect(Arr.filter(root, ofThePlugins)).toEqual([]);

    const named = pipe(
      printed.overrides,
      Arr.flatMap((block) => Rec.keys(block.rules)),
      Arr.filter(ofThePlugins),
    );

    expect(Arr.filter(named, (rule) => !TAKEN.includes(rule))).toEqual([]);
  });
});

describe("L4 the zero lock names the excluded folders with no hit and the folders with hits that are not excluded", () => {
  it("scenario: a new folder with no hit trips nothing", () => {
    const scope = ["next/programs/old/**", "next/programs/new/**"];
    const hits = new Map([["next/programs/old/**", 2]]);

    expect(lock(scope, ["next/programs/old/**"], hits, null)).toEqual({
      remove: [],
      missing: [],
      refused: [],
      added: [],
    });
  });

  it("property: and refuses an excluded glob that is not a folder of the scope", () => {
    const glob = (name: string) => `next/programs/${name}/**`;
    const reached = { remove: false, missing: false, none: false, refused: false };

    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 1, maxLength: 8 }).chain((names) =>
          fc.record({
            names: fc.constant(names),
            onList: fc.subarray(names),
            hits: fc.array(fc.nat({ max: 3 }), { minLength: names.length, maxLength: names.length }),
            strays: fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { maxLength: 3 }),
          }),
        ),
        ({ names, onList, hits, strays }) => {
          const scope = Arr.map(names, glob);
          const counted = Arr.map(names, (name, i) => ({ folder: glob(name), name, hits: hits[i] ?? 0 }));

          // A folder with no hit is often left out of the map, as a real run leaves it.
          const map = new Map(
            Arr.flatMap(counted, ({ folder, hits }) => (hits === 0 ? [] : [[folder, hits] as const])),
          );

          const gone = Arr.map(strays, (name) => `next/gone/${name}/**`);
          const result = lock(scope, [...Arr.map(onList, glob), ...gone], map, null);

          const folderOf = (keep: (entry: (typeof counted)[number]) => boolean) =>
            pipe(
              counted,
              Arr.filter(keep),
              Arr.map(({ folder }) => folder),
            );

          const remove = Arr.map(
            Arr.filter(onList, (name) => (hits[names.indexOf(name)] ?? 0) === 0),
            glob,
          );

          expect(result.remove).toEqual(remove);
          expect(result.missing).toEqual(folderOf(({ name, hits }) => hits > 0 && !onList.includes(name)));
          expect(result.refused).toEqual(gone);
          expect(result.added).toEqual([]);
          reached.remove ||= result.remove.length > 0;
          reached.missing ||= result.missing.length > 0;
          reached.none ||= result.remove.length === 0 && result.missing.length === 0;
          reached.refused ||= gone.length > 0;
        },
      ),
      { seed: 119120, numRuns: 100 },
    );

    expect(reached).toEqual({ remove: true, missing: true, none: true, refused: true });
  });

  // Plant: `added` answers [] whatever the base branch's list holds, so a dirty folder put on the list passes.
  it("property: an excluded glob the base branch's list does not name is refused, whatever its hits", () => {
    const glob = (name: string) => `next/programs/${name}/**`;
    const reached = { added: false, none: false, dirty: false, noBase: false };

    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 1, maxLength: 8 }).chain((names) =>
          fc.record({
            names: fc.constant(names),
            onList: fc.subarray(names),
            base: fc.option(fc.subarray(names), { nil: null }),
            hits: fc.array(fc.nat({ max: 3 }), { minLength: names.length, maxLength: names.length }),
          }),
        ),
        ({ names, onList, base, hits }) => {
          const scope = Arr.map(names, glob);
          const map = new Map(Arr.map(names, (name, i) => [glob(name), hits[i] ?? 0] as const));
          const result = lock(scope, Arr.map(onList, glob), map, base === null ? null : Arr.map(base, glob));

          const added =
            base === null
              ? []
              : Arr.map(
                  Arr.filter(onList, (name) => !base.includes(name)),
                  glob,
                );

          expect(result.added).toEqual(added);
          reached.added ||= added.length > 0;
          reached.none ||= base !== null && added.length === 0;
          reached.dirty ||= Arr.some(result.added, (folder) => (map.get(folder) ?? 0) > 0);
          reached.noBase ||= base === null && onList.length > 0;
        },
      ),
      { seed: 119120, numRuns: 100 },
    );

    expect(reached).toEqual({ added: true, none: true, dirty: true, noBase: true });

    // The repository's own lists, read as the base branch's text is read, grow past nothing.
    const base = Option.getOrThrow(baseLists(readFileSync(join(ROOT, ".oxlintrc.json"), "utf8")));

    for (const rule of TAKEN) {
      const list = base.get(rule);
      expect(list, rule).toEqual(excluded(rule));
      expect(lock(folders(ROOT), excluded(rule), new Map(), list ?? null).added, rule).toEqual([]);
    }
  });

  // Plant: `remove` reads a folder's own hits in place of `loose`, so the outer glob stays on the list.
  it("property: an excluded folder comes off the list exactly when no hit is left outside the excluded folders inside it", () => {
    const reached = { outer: false, kept: false, inner: false };

    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            name: fc.stringMatching(/^[a-z]{1,6}$/),
            own: fc.nat({ max: 3 }),
            source: fc.nat({ max: 3 }),
            pkgOn: fc.boolean(),
            srcOn: fc.boolean(),
          }),
          { minLength: 1, maxLength: 6, selector: ({ name }) => name },
        ),
        (packages) => {
          const pkg = (name: string) => `kalfa/${name}/**`;
          const src = (name: string) => `kalfa/${name}/src/**`;
          const scope = Arr.flatMap(packages, ({ name }) => [pkg(name), src(name)]);

          const map = new Map(
            Arr.flatMap(packages, ({ name, own, source }) => [
              [pkg(name), own + source] as const,
              [src(name), source] as const,
            ]),
          );

          const onList = Arr.flatMap(packages, ({ name, pkgOn, srcOn }) => [
            ...(pkgOn ? [pkg(name)] : []),
            ...(srcOn ? [src(name)] : []),
          ]);

          const remove = Arr.flatMap(packages, ({ name, own, source, pkgOn, srcOn }) => [
            ...(pkgOn && own + (srcOn ? 0 : source) === 0 ? [pkg(name)] : []),
            ...(srcOn && source === 0 ? [src(name)] : []),
          ]);

          expect(lock(scope, onList, map, onList).remove).toEqual(remove);

          for (const { own, source, pkgOn, srcOn } of packages) {
            reached.outer ||= pkgOn && srcOn && own === 0 && source > 0;
            reached.kept ||= pkgOn && srcOn && own > 0 && source > 0;
            reached.inner ||= srcOn && source === 0;
          }
        },
      ),
      { seed: 119120, numRuns: 100 },
    );

    expect(reached).toEqual({ outer: true, kept: true, inner: true });
  });
});

describe("L5 no block for a taken rule says off or warn", () => {
  it("scenario: every setting of a rule of the two plugins, in every block, is error", () => {
    const settings = Arr.flatMap(printed.overrides, (block) =>
      Arr.filter(Rec.toEntries(block.rules), ([rule]) => ofThePlugins(rule)),
    );

    expect(settings.length).toBeGreaterThan(0);
    expect(Arr.filter(settings, ([, setting]) => levelOf(setting) !== "deny")).toEqual([]);
  });
});

// Plant: `lowered` reads only the blocks that set a taken rule at error, so a later "off" block passes.
describe("L9 no block sets a taken rule below error", () => {
  it("property: each block that sets a taken rule to off or warn gets one line, and no other block does", () => {
    const level = fc.constantFrom("deny", "warn", "allow");
    const reached = { allow: false, warn: false, options: false, clean: false };

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            files: fc.uniqueArray(fc.constantFrom(...SCOPE), { minLength: 1, maxLength: 3 }),
            taken: fc.dictionary(fc.constantFrom(...TAKEN), fc.tuple(level, fc.boolean()), { maxKeys: 4 }),
            other: fc.dictionary(fc.constantFrom("eslint/no-console", "fabrika/no-promises"), level, { maxKeys: 2 }),
          }),
          { maxLength: 5 },
        ),
        (drawn) => {
          const blocks = Arr.map(drawn, ({ files, taken, other }) => ({
            files,
            rules: {
              ...other,
              ...Rec.map(taken, ([at, options]): typeof Setting.Type => (options ? [at, [{ max: 2 }]] : at)),
            },
          }));

          const lines = Arr.flatMap(drawn, ({ files, taken }) =>
            pipe(
              TAKEN,
              Arr.flatMap((rule) => {
                const at = taken[rule]?.[0];

                return at === undefined || at === "deny" ? [] : [`${rule} to ${at} in ${files.join(", ")};`];
              }),
            ),
          );

          const said = lowered(blocks);
          expect(said.length).toBe(lines.length);

          for (const [i, line] of lines.entries()) {
            expect(said[i]).toContain(line);
          }

          reached.allow ||= Arr.some(lines, (line) => line.includes(" to allow in "));
          reached.warn ||= Arr.some(lines, (line) => line.includes(" to warn in "));
          reached.options ||= Arr.some(drawn, ({ taken }) =>
            Arr.some(Rec.values(taken), ([at, o]) => o && at !== "deny"),
          );
          reached.clean ||= drawn.length > 0 && lines.length === 0;
        },
      ),
      { seed: 119120, numRuns: 100 },
    );

    expect(reached).toEqual({ allow: true, warn: true, options: true, clean: true });
    expect(lowered(printed.overrides)).toEqual([]);
  });
});

// The approved typecheck-port amendment adds these four globs, rather than all of scripts/.
// Plant: drop the port from folders(); its excluded globs are then refused.
describe("L8 the zero lock covers the typecheck port, today's tooling", () => {
  it("scenario: the port's four globs are in scope and no taken rule excludes a refused glob", () => {
    const scope = folders(ROOT);

    expect(scope).toEqual(
      expect.arrayContaining([
        "scripts/typecheck.ts",
        "scripts/typecheck/**",
        "scripts/typecheck.test.ts",
        "scripts/typecheck-lock.test.ts",
      ]),
    );

    for (const rule of TAKEN) {
      expect(lock(scope, excluded(rule), new Map(), null).refused, rule).toEqual([]);
    }
  });
});

describe("L7 the config loads the fork's two plugins only from vendor/anti-slop/", () => {
  const VENDORED = {
    "anti-slop": "vendor/anti-slop/src/index.ts",
    "anti-slop-effect": "vendor/anti-slop/src/effect/index.ts",
  };

  /** One `jsPlugins` entry, and whether `strays` must name it. */
  const entry = fc.oneof(
    fc.constantFrom("./oxlint-plugins/index.ts", "./other/plugin.ts").map((plugin) => ({ plugin, stray: false })),
    fc
      .record({
        name: fc.constantFrom("anti-slop", "anti-slop-effect"),
        dot: fc.boolean(),
        elsewhere: fc.constantFrom("", "oxlint-plugins/fixtures/edited-copy/", "node_modules/anti-slop/"),
      })
      .map(({ name, dot, elsewhere }) => {
        const path = elsewhere === "" ? VENDORED[name] : `${elsewhere}${VENDORED[name].split("/").pop()}`;

        return { plugin: { name, specifier: `${dot ? "./" : ""}${path}` }, stray: elsewhere !== "" };
      }),
    fc
      .constantFrom("fabrika", "anti-slop-other")
      .map((name) => ({ plugin: { name, specifier: "./oxlint-plugins/fixtures/edited-copy/index.ts" }, stray: false })),
  );

  it("property: an entry named for one of the two plugins is refused exactly when its path is not the vendored one", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 6 }), (entries) => {
        for (const { stray } of entries) {
          seen.add(String(stray));
        }

        const config = JSON.stringify({
          jsPlugins: Arr.map(entries, ({ plugin }) => plugin),
          ignorePatterns: [],
          overrides: [],
        });

        expect(strays(ROOT, config).length).toBe(Arr.filter(entries, ({ stray }) => stray).length);
      }),
      { seed: 119120, numRuns: 100 },
    );
    // Coverage: both a stray entry and an entry that holds were drawn.
    expect(Arr.sort(seen, Order.String)).toEqual(["false", "true"]);
  });

  it("scenario: the repository's own config loads both plugins from their vendored path", () => {
    expect(strays(ROOT, printout)).toEqual([]);
    expect(printout).toContain("anti-slop-effect");
  });
});

const KalfaScope = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z]{1,6}$/)),
  hits: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 })),
});

effectIt.effect.prop(
  "T1076 Kalfa package and source folders keep the same zero lock as next folders",
  { input: KalfaScope },
  ({ input }) =>
    Effect.sync(() => {
      // Plants unrun locally: omit Kalfa from WHOLE/folders, or ignore its folders' hits.
      expect(WHOLE).toContain("kalfa/**");
      const actual = folders(ROOT);
      expect(actual).toContain("kalfa/config/**");
      expect(actual).toContain("kalfa/config/src/**");

      const [pkg, src, program] = [
        `kalfa/${input.name}/**`,
        `kalfa/${input.name}/src/**`,
        `next/programs/${input.name}/**`,
      ];

      const scope = [pkg, src, program];
      expect(lock(scope, [], new Map(), null)).toEqual({ remove: [], missing: [], refused: [], added: [] });
      expect(lock(scope, [pkg, src], new Map(), null).remove).toEqual([pkg, src]);
      const gone = `kalfa/${input.name}/absent/**`;
      expect(lock(scope, [gone], new Map(), null).refused).toEqual([gone]);

      // The actual fold used by count must account for every overlapping scope.
      for (const mode of ["source", "package", "mixed"]) {
        const hits = new Map<string, number>();
        const source = mode !== "package" ? input.hits : 0;
        const other = mode !== "source" ? input.hits : 0;
        const containing = [src, pkg, program];

        for (let hit = 0; hit < source; hit++) {
          countFile(containing, hits, `kalfa/${input.name}/src/value.ts`);
        }

        for (let hit = 0; hit < other; hit++) {
          countFile(containing, hits, `kalfa/${input.name}/Pnpm.ts`);
        }

        expect(hits.get(pkg)).toBe(source + other);
        expect(hits.get(src) ?? 0).toBe(source);
        expect(hits.has(program)).toBe(false);
        expect(lock(scope, [], hits, null).missing).toEqual(source === 0 ? [pkg] : [pkg, src]);
        expect(lock(scope, [pkg], hits, null)).toEqual({ remove: [], missing: [], refused: [], added: [] });
        // Excluding the source folder alone leaves the package's own hits, outside it, on.
        expect(lock(scope, [src], hits, null).missing).toEqual(other === 0 ? [] : [pkg]);
        expect(lock(scope, [src], hits, null).remove).toEqual(source === 0 ? [src] : []);
      }
    }),
  { arbitrary: { seed: 119120, runs: 100, size: 100 } },
);
