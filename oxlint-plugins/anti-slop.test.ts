// The anti-slop rules the owner took (0563) are the exam, so each is seen to fire through the
// repository's own .oxlintrc.json, and only where its block lists the folder (L2, L3). The config
// names no other rule of the two plugins, and never turns a taken one down (L3, L5). The zero lock in
// anti-slop.ts is a property of its own (L4). The config loads the two plugins from vendor/anti-slop/
// and from nowhere else (L7).
//
// Plants, each run once and undone:
// - L2: drop the `anti-slop-effect` entry from `jsPlugins`. The two tag rules load no rule, and their
//   plants get no diagnostic.
// - L3: name a taken rule in the root `rules`. It fires in a folder its block does not list.
// - L4: `lock` answers "nothing to add" for every input.
// - L5: add `{ "files": ["next/**"], "rules": { "anti-slop/no-runtime-typeof": "off" } }` at the end.
// - L7: load `anti-slop` from `./oxlint-plugins/fixtures/edited-copy/index.ts` in `.oxlintrc.json`.
//   The scenario then reads a line naming that path.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Predicate, Schema } from "effect";
import fc from "fast-check";
import { parseSync } from "oxc-parser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { folders, lock, strays, TAKEN, WHOLE } from "./anti-slop.ts";

const ROOT = join(import.meta.dirname, "..");

const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");

/** A rule's setting as `oxlint --print-config` prints it: a level, or a level and the list of its options. */
const Setting = Schema.Union([Schema.String, Schema.Tuple([Schema.String, Schema.Array(Schema.Unknown)])]);

const Rules = Schema.Record(Schema.String, Setting);

/** The part of oxlint's own reading of the config these laws read: its blocks. */
const Printed = Schema.fromJsonString(
  Schema.Struct({ overrides: Schema.Array(Schema.Struct({ files: Schema.Array(Schema.String), rules: Rules })) }),
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

  const rules = properties.find(
    (property) => property.type === "Property" && property.key.type === "Literal" && property.key.value === "rules",
  );

  const value = rules?.type === "Property" ? rules.value : undefined;
  const named = value?.type === "ObjectExpression" ? value.properties : [];

  return named.flatMap((property) =>
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
        labels: Schema.Array(Schema.Struct({ span: Schema.Struct({ line: Schema.Number }) })),
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

/** The folders a rule's blocks list, as the config holds them: each override that names it at error. */
const listed = (rule: string): ReadonlyArray<string> =>
  printed.overrides.flatMap((block) => {
    const setting = block.rules[rule];

    return setting !== undefined && levelOf(setting) === "deny" ? block.files : [];
  });

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
  // 0567's two Match rules.
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
  lines.findIndex((line) => line.endsWith(mark)) + 1;

/** A folder's glob of the whole tree under it, as plants are written into, never a whole-scope glob. */
const tree = (glob: string): boolean => glob.endsWith("/**");

/**
 * A folder of the scope that a rule's list does not cover, where its plant must stay silent: this
 * test's own folder while it is not listed, as plants.test.ts plants beside itself, else the first.
 */
const unlisted = (rule: string): string | undefined => {
  const on = listed(rule);

  const covered = (folder: string) =>
    on.includes(folder) || on.some((glob) => WHOLE.includes(glob) && folder.startsWith(glob.slice(0, -"**".length)));

  return ["oxlint-plugins/**", ...folders(ROOT)].find((folder) => tree(folder) && !covered(folder));
};

/** Where a rule's plant goes: a folder of the scope, as its glob. */
interface Site {
  readonly rule: string;
  readonly glob: string;
}

/** Each taken rule in the first folder its block lists. A rule whose list is still empty gets one with its first sweep. */
const ON: ReadonlyArray<Site> = TAKEN.flatMap((rule) =>
  listed(rule)
    .filter(tree)
    .slice(0, 1)
    .map((glob) => ({ rule, glob })),
);

/** Each taken rule in the first folder its block does not list. A rule on in the whole scope has none left. */
const OFF: ReadonlyArray<Site> = TAKEN.flatMap((rule) => {
  const glob = unlisted(rule);

  return glob === undefined ? [] : [{ rule, glob }];
});

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
  writeFileSync(file, `${(PLANTS[rule] ?? []).join("\n")}\n`);

  return relative(ROOT, file);
};

let fires: ReadonlyMap<Site, ReadonlyArray<number>> = new Map();

beforeAll(() => {
  const sites = [...ON, ...OFF];
  const files = sites.map(plant);

  // One oxlint run for every plant, through the repository's own config.
  const ran = spawnSync(OXLINT, ["--disable-nested-config", "--format=json", ...files], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 2 ** 28,
  });

  const { diagnostics } = Schema.decodeUnknownSync(Report)(ran.stdout);
  fires = new Map(
    sites.map((site, i) => [
      site,
      diagnostics
        .filter(({ code, filename }) => filename === files[i] && code === codeOf(site.rule))
        .flatMap(({ labels }) => labels.slice(0, 1).map(({ span }) => span.line)),
    ]),
  );
});

describe("L2 each taken rule fires through the repository's own config, in a folder on its list", () => {
  it("scenario: every taken rule has its plant, refused and taken", () => {
    expect(Object.keys(PLANTS).toSorted()).toEqual([...TAKEN].toSorted());
    expect(ON.length).toBeGreaterThan(0);
  });

  it.each(ON)("scenario: $rule fires on its refused line and not on its taken line, in $glob", (site) => {
    const lines = PLANTS[site.rule] ?? [];
    expect(fires.get(site)).toEqual([lineOf(lines, "// refused")]);
    expect(fires.get(site)).not.toContain(lineOf(lines, "// taken"));
  });
});

describe("L3 a taken rule holds only where its block lists the folder", () => {
  it.each(OFF)(
    "scenario: $rule's refused line gets none of its diagnostics in $glob, which its block does not list",
    (site) => {
      expect(fires.get(site)).toEqual([]);
    },
  );

  it("scenario: the root rules name no rule of the two plugins, and no block names one the owner did not take", () => {
    const root = rootRules();
    // The root holds many rules: none read means the text was not read, never that it is clean.
    expect(root.length).toBeGreaterThan(0);
    expect(root.filter(ofThePlugins)).toEqual([]);
    const named = printed.overrides.flatMap((block) => Object.keys(block.rules)).filter(ofThePlugins);
    expect(named.filter((rule) => !TAKEN.includes(rule))).toEqual([]);
  });
});

describe("L4 the zero lock names exactly the folders with no hit that are not listed", () => {
  it("and refuses a listed glob that is neither a folder of the scope nor a whole-scope glob", () => {
    const glob = (name: string) => `next/programs/${name}/**`;
    const reached = { add: false, none: false, refused: false, whole: false };

    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 1, maxLength: 8 }).chain((names) =>
          fc.record({
            names: fc.constant(names),
            onList: fc.subarray(names),
            hits: fc.array(fc.nat({ max: 3 }), { minLength: names.length, maxLength: names.length }),
            strays: fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { maxLength: 3 }),
            whole: fc.subarray([...WHOLE]),
          }),
        ),
        ({ names, onList, hits, strays, whole }) => {
          const scope = names.map(glob);
          const counted = names.map((name, i) => ({ folder: glob(name), name, hits: hits[i] ?? 0 }));
          // A folder with no hit is often left out of the map, as a real run leaves it.
          const map = new Map(counted.flatMap(({ folder, hits }) => (hits === 0 ? [] : [[folder, hits] as const])));
          const gone = strays.map((name) => `next/gone/${name}/**`);
          const result = lock(scope, [...onList.map(glob), ...gone, ...whole], map);
          const everything = whole.includes("next/**");

          const expected = everything
            ? []
            : counted.filter(({ name, hits }) => hits === 0 && !onList.includes(name)).map(({ folder }) => folder);

          expect(result.add).toEqual(expected);
          expect(result.refused).toEqual(gone);
          reached.add ||= expected.length > 0;
          reached.none ||= expected.length === 0;
          reached.refused ||= gone.length > 0;
          reached.whole ||= everything;
        },
      ),
      { seed: 119120, numRuns: 100 },
    );

    expect(reached).toEqual({ add: true, none: true, refused: true, whole: true });
  });
});

describe("L5 no block for a taken rule says off or warn", () => {
  it("scenario: every setting of a rule of the two plugins, in every block, is error", () => {
    const settings = printed.overrides.flatMap((block) =>
      Object.entries(block.rules).filter(([rule]) => ofThePlugins(rule)),
    );

    expect(settings.length).toBeGreaterThan(0);
    expect(settings.filter(([, setting]) => levelOf(setting) !== "deny")).toEqual([]);
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
          jsPlugins: entries.map(({ plugin }) => plugin),
          ignorePatterns: [],
          overrides: [],
        });

        expect(strays(ROOT, config).length).toBe(entries.filter(({ stray }) => stray).length);
      }),
      { seed: 119120, numRuns: 100 },
    );
    // Coverage: both a stray entry and an entry that holds were drawn.
    expect([...seen].toSorted()).toEqual(["false", "true"]);
  });

  it("scenario: the repository's own config loads both plugins from their vendored path", () => {
    expect(strays(ROOT, printout)).toEqual([]);
    expect(printout).toContain("anti-slop-effect");
  });
});
