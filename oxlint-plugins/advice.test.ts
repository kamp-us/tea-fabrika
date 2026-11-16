// Ticket 930 (0523): the five old advice rules block wherever their folder is at zero, and advise
// only where a warn override at the end of the config names their folder. Ticket 948 adds the docs
// rule, `fabrika/jsdocs`, the same way: six in all. These laws read
// `advice.ts` in process, and run the real `lint.ts` and oxlint in a small temp repo of their own.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, matchesGlob } from "node:path";
import { Array as Arr, pipe } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { advises, type Fire, stale, type WarnLine, warnLines } from "./advice.ts";

const ROOT = join(import.meta.dirname, "..");
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");
const runs = { seed: 119120, numRuns: 200 };

/** The five, as oxlint prints them: the oracle, written out apart from `advice.ts`. */
const FIVE = [
  "eslint(no-restricted-properties)",
  "fabrika(law-shape)",
  "fabrika(no-effect-promise)",
  "fabrika(no-raw-try-catch)",
  "fabrika(prefer-schema-arbitrary)",
] as const;

/** The six: the five and the docs rule (ticket 948). */
const SIX = [...FIVE, "fabrika(jsdocs)"] as const;

const OTHERS = [
  "fabrika(service-id)",
  "eslint(no-debugger)",
  "fabrika(no-type-assertions)",
  "eslint(no-restricted-imports)",
];

/**
 * What oxlint's `no-restricted-properties` names in a fire's message, written as oxlint 1.90.0 prints
 * it: `'JSON.parse' is restricted from being used.` The entry's own text is kept apart, as `help`.
 */
const restricted = (name: string) => `'${name}' is restricted from being used.`;

/** Members the config restricts, and near misses of `JSON.parse`. */
const MEMBERS = [
  "JSON.parse",
  "Reflect.get",
  "Reflect.set",
  "Reflect.has",
  "globalThis.Reflect",
  "Effect.retry",
  "Stream.retry",
  "setBounds",
  "JSON.parsed",
  "JSON",
];

describe("T930 L1 a fire advises only when it is one of the six and graded a warning", () => {
  // Reflect ban L2 (0554), in process: of oxlint's own rule, only the JSON.parse fire advises.
  // Plant: make `advises` read the code alone again, and a Reflect fire at warning advises.
  it("is true exactly for the six at severity warning, of no-restricted-properties only the JSON.parse fire, and false for an error or any other rule", () => {
    const seen = { parse: false, reflect: false };
    fc.assert(
      fc.property(
        fc.record(
          {
            // A missing key is drawn through `requiredKeys: []`: oxlint's JSON never holds an explicit undefined.
            // Weighted toward oxlint's own rule and its JSON.parse fire, the cases this law is about.
            code: fc.oneof(
              { arbitrary: fc.constant("eslint(no-restricted-properties)"), weight: 5 },
              { arbitrary: fc.constantFrom<string>(...SIX, ...OTHERS), weight: 5 },
            ),
            severity: fc.constantFrom("warning", "error"),
            message: fc.oneof(
              { arbitrary: fc.constant(restricted("JSON.parse")), weight: 5 },
              fc.constantFrom(...MEMBERS).map(restricted),
              fc.stringMatching(/^[A-Za-z.]{1,12}$/).map(restricted),
              fc.string(),
            ),
          },
          { requiredKeys: [] },
        ),
        (fire) => {
          const six = Arr.some(SIX, (code) => code === fire.code);
          const member = /^'([^']*)' is restricted from being used\.$/.exec(fire.message ?? "")?.[1];
          const guard = fire.code !== "eslint(no-restricted-properties)" || member === "JSON.parse";
          const want = six && guard && fire.severity === "warning";

          if (fire.code === "eslint(no-restricted-properties)" && fire.severity === "warning") {
            seen.parse ||= member === "JSON.parse";
            seen.reflect ||= member?.startsWith("Reflect.") === true;
          }

          expect(advises(fire)).toBe(want);
        },
      ),
      runs,
    );
    // Coverage: a warning-level JSON.parse fire and a warning-level Reflect fire were both drawn.
    expect(seen).toEqual({ parse: true, reflect: true });
  });
});

describe("T930 L3 a warn line is stale when no advice fire of its rule is in its folder", () => {
  /** One folder's warn line: a whole tree, its own files only, or one file, which is never a folder. */
  type Kind = "tree" | "files" | "file";
  const globOf = (folder: string, kind: Kind) =>
    kind === "tree" ? `next/${folder}/**` : kind === "files" ? `next/${folder}/*` : `next/${folder}/a.ts`;

  it("names exactly the lines with no fire of their rule, and each line that names a file", () => {
    const folders = fc.uniqueArray(fc.stringMatching(/^[a-z]{2,5}$/), { minLength: 1, maxLength: 4 });
    fc.assert(
      fc.property(
        folders.chain((names) =>
          fc.record({
            lines: fc.tuple(
              ...Arr.map(names, (folder) =>
                fc.record({
                  folder: fc.constant(folder),
                  kind: fc.constantFrom<Kind>("tree", "files", "file"),
                  rule: fc.constantFrom(...SIX),
                }),
              ),
            ),
            fires: fc.array(
              fc.record({
                folder: fc.constantFrom(...names),
                // `sibling` is a folder whose name starts with this one's: a glob is not a prefix.
                place: fc.constantFrom("direct", "deep", "sibling"),
                rule: fc.constantFrom(...SIX),
              }),
              { maxLength: 8 },
            ),
          }),
        ),
        ({ lines, fires }) => {
          const warn: WarnLine[] = Arr.map(lines, ({ folder, kind, rule }) => ({ rule, glob: globOf(folder, kind) }));
          const advice: Fire[] = Arr.map(fires, ({ folder, place, rule }) => ({
            code: rule,
            severity: "warning",
            filename:
              place === "direct"
                ? `next/${folder}/b.ts`
                : place === "deep"
                  ? `next/${folder}/sub/b.ts`
                  : `next/${folder}x/b.ts`,
          }));
          const want = Arr.flatMap(lines, ({ folder, kind, rule }, i) => {
            const line = warn[i]!;

            if (kind === "file") {
              return [{ _tag: "file", line }];
            }

            const held = Arr.some(
              fires,
              (f) =>
                f.rule === rule &&
                f.folder === folder &&
                (f.place === "direct" || (f.place === "deep" && kind === "tree")),
            );
            return held ? [] : [{ _tag: "zero", line }];
          });
          expect(stale(warn, advice)).toEqual(want);
        },
      ),
      runs,
    );
  });
});

/** A small repo of its own: lint.ts and the rules copied, node_modules linked, and this config. */
const repo = (config: object | string, files: Readonly<Record<string, string>>) => {
  const at = realpathSync(mkdtempSync(join(tmpdir(), "advice-")));
  spawnSync("git", ["init", "-q", at]);
  mkdirSync(join(at, "oxlint-plugins"));

  for (const entry of readdirSync(join(ROOT, "oxlint-plugins"), { withFileTypes: true })) {
    if (entry.isFile()) {
      copyFileSync(join(ROOT, "oxlint-plugins", entry.name), join(at, "oxlint-plugins", entry.name));
    }
  }

  symlinkSync(join(ROOT, "oxlint-plugins", "node_modules"), join(at, "oxlint-plugins", "node_modules"));
  symlinkSync(join(ROOT, "node_modules"), join(at, "node_modules"));
  mkdirSync(join(at, ".agents/skills"), { recursive: true });
  writeFileSync(join(at, ".oxlintrc.json"), typeof config === "string" ? config : JSON.stringify(config));

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), text);
  }

  return {
    at,
    lint: (...args: readonly string[]) => {
      const ran = spawnSync(process.execPath, [join(at, "oxlint-plugins/lint.ts"), ...args], {
        cwd: at,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(ran.error).toBeUndefined();
      return { status: ran.status, out: ran.stdout + ran.stderr };
    },
    done: () => rmSync(at, { recursive: true, force: true }),
  };
};

const HINT = "decode with Effect Schema, not a bare JSON.parse";
const parse = (level: string) => [level, { object: "JSON", property: "parse", message: HINT }];

/**
 * The frozen version's override, as the real config writes it (0525): both top-level rules "warn"
 * there, and fabrika-design carved back to "error". It is not a dirty-folder line, so no fire under
 * these paths is ever needed to keep a whole run passing.
 */
const FROZEN = [
  {
    files: ["apps/**", "programs/**", "packages/**", "bin/**"],
    rules: { "fabrika/no-effect-promise": "warn", "fabrika/no-raw-try-catch": "warn" },
  },
  {
    files: ["packages/fabrika-design/**"],
    rules: { "fabrika/no-effect-promise": "error", "fabrika/no-raw-try-catch": "error" },
  },
];

/** The five at "error" in their base scope, the frozen override, and "warn" for each dirty folder, placed last. */
const small = (dirty: readonly string[] = ["next/dirty"]) => ({
  jsPlugins: ["./oxlint-plugins/index.ts"],
  categories: { correctness: "off" },
  ignorePatterns: ["oxlint-plugins/**", "node_modules/**"],
  rules: { "fabrika/no-effect-promise": "error", "fabrika/no-raw-try-catch": "error" },
  overrides: [
    {
      files: ["next/**/*.test.ts"],
      rules: { "fabrika/law-shape": "error", "fabrika/prefer-schema-arbitrary": "error" },
    },
    { files: ["next/**/*"], rules: { "eslint/no-restricted-properties": parse("error") } },
    ...FROZEN,
    ...Arr.flatMap(dirty, (folder) => [
      {
        files: [`${folder}/**`],
        rules: {
          "fabrika/no-effect-promise": "warn",
          "fabrika/no-raw-try-catch": "warn",
          "eslint/no-restricted-properties": parse("warn"),
        },
      },
      {
        files: [`${folder}/**/*.test.ts`],
        rules: { "fabrika/law-shape": "warn", "fabrika/prefer-schema-arbitrary": "warn" },
      },
    ]),
  ],
});

/** One planted fire per rule: the file it sits in, inside a folder, and its text. */
const PLANTS: Readonly<Record<(typeof FIVE)[number], { readonly file: string; readonly text: string }>> = {
  "eslint(no-restricted-properties)": { file: "parse.ts", text: 'export const a: unknown = JSON.parse("1");\n' },
  "fabrika(law-shape)": { file: "law.test.ts", text: 'import { it } from "vitest";\n\nit("adds one", () => {});\n' },
  "fabrika(no-effect-promise)": {
    file: "promise.ts",
    text: 'import { Effect } from "effect";\n\nexport const a = Effect.promise(() => Promise.resolve(1));\n',
  },
  "fabrika(no-raw-try-catch)": {
    file: "try.ts",
    text: 'import { Effect } from "effect";\n\ndeclare const f: () => void;\nexport const e = Effect.void;\n\ntry {\n  f();\n} catch {\n  f();\n}\n',
  },
  "fabrika(prefer-schema-arbitrary)": {
    file: "data.test.ts",
    text: "import fc from 'fast-check';\nimport {Schema} from 'effect';\nconst S = Schema.Struct({x: Schema.String});\nexport const data: fc.Arbitrary<typeof S.Type> = fc.record({x: fc.string()});\n",
  },
};

const planted = (folder: string) =>
  Object.fromEntries(Arr.map(Object.values(PLANTS), ({ file, text }) => [`${folder}/${file}`, text]));

describe("T930 L2 through lint.ts and oxlint, one of the five blocks in a clean folder and advises in a dirty one", () => {
  it.each(FIVE)(
    "scenario: %s blocks in next/clean, advises in next/dirty, and a warning of another rule still fails",
    (code) => {
      const { file } = PLANTS[code];
      const { lint, done } = repo(small(), {
        ...planted("next/clean"),
        ...planted("next/dirty"),
        "next/dirty/debug.ts": "debugger;\n",
      });

      try {
        const clean = lint(`next/clean/${file}`);
        expect(clean.out).toContain(`next/clean/${file}`);
        expect(clean.out).toContain(code);
        expect(clean.out).toContain("oxlint: 1 blocking, 0 advice");
        expect(clean.status, clean.out).toBe(1);

        const dirty = lint(`next/dirty/${file}`);
        expect(dirty.out).toContain(`${code} advice, this folder is not at zero yet:`);
        expect(dirty.out).toContain("oxlint: 0 blocking, 1 advice");
        expect(dirty.status, dirty.out).toBe(0);

        const warned = lint("--warn=no-debugger", `next/dirty/${file}`, "next/dirty/debug.ts");
        expect(warned.out).toContain("eslint(no-debugger)");
        expect(warned.out).toContain("oxlint: 1 blocking, 1 advice");
        expect(warned.status, warned.out).toBe(1);

        if (code === "eslint(no-restricted-properties)") {
          expect(clean.out).toContain(HINT);
          expect(dirty.out).toContain(HINT);
        }
      } finally {
        done();
      }
    },
    120_000,
  );

  it("scenario: all five together block in next/clean and advise in next/dirty", () => {
    const { lint, done } = repo(small(), { ...planted("next/clean"), ...planted("next/dirty") });

    try {
      const clean = lint(...Arr.map(Object.values(PLANTS), ({ file }) => `next/clean/${file}`));
      expect(clean.out).toContain(`oxlint: ${FIVE.length} blocking, 0 advice`);
      expect(clean.status, clean.out).toBe(1);
      const dirty = lint(...Arr.map(Object.values(PLANTS), ({ file }) => `next/dirty/${file}`));
      expect(dirty.out).toContain(`oxlint: 0 blocking, ${FIVE.length} advice`);
      expect(dirty.status, dirty.out).toBe(0);
    } finally {
      done();
    }
  }, 120_000);

  // scenario: the repo's own config fails closed. A folder nobody listed blocks, the frozen version
  // still advises until the freeze quest takes it out of lint, and fabrika-design stays live (0456).
  it("scenario: under the real config an Effect.promise blocks in a new folder and in fabrika-design, and advises under apps/", () => {
    const { text } = PLANTS["fabrika(no-effect-promise)"];
    const config = readFileSync(join(ROOT, ".oxlintrc.json"), "utf8");
    const { lint, done } = repo(config, {
      "newfolder/unit.ts": text,
      "packages/fabrika-design/unit.ts": text,
      "apps/unit.ts": text,
    });

    try {
      for (const file of ["newfolder/unit.ts", "packages/fabrika-design/unit.ts"]) {
        const blocked = lint(file);
        expect(blocked.out).toContain(`${file}:3:33 fabrika(no-effect-promise) `);
        expect(blocked.status, blocked.out).toBe(1);
      }

      const frozen = lint("apps/unit.ts");
      expect(frozen.out).toContain("fabrika(no-effect-promise) advice, this folder is not at zero yet:");
      expect(frozen.out).toContain("oxlint: 0 blocking, 1 advice");
      expect(frozen.status, frozen.out).toBe(0);
    } finally {
      done();
    }
  }, 120_000);

  // scenario (ticket 948): the docs rule under the repo's own config, in its own order: the error
  // block, the warn block, then the off block. A folder no config line names is at zero, so a
  // missing doc block there blocks. Each folder the config's jsdocs warn lines name today makes the
  // same export advice, and no warn line turns the rule on for a test file. The warn folders are read
  // from the config, apart from `advice.ts`, so a fill that deletes its line changes nothing here.
  it("scenario: under the real config a missing doc block blocks in a new folder, advises in each warn folder, and is off for a test file in any of them", () => {
    // No block at all: the rule fires twice, once for the export and once for the module block.
    const text = "export const planted = 1;\n";
    const config = readFileSync(join(ROOT, ".oxlintrc.json"), "utf8");
    const folders = jsdocsWarnFolders(repo(config, {}));
    // A new package: no config line names it, and libfabrika's module rule does not reach it.
    const clean = "next/packages/planted/src";
    const { lint, done } = repo(
      config,
      Object.fromEntries(
        Arr.flatMap([clean, ...folders], (folder) => [
          [`${folder}/Planted.ts`, text],
          [`${folder}/Planted.test.ts`, text],
        ]),
      ),
    );

    try {
      const blocked = lint(`${clean}/Planted.ts`);
      expect(blocked.out).toContain(`${clean}/Planted.ts:1:1 fabrika(jsdocs) `);
      expect(blocked.out).toContain("oxlint: 2 blocking, 0 advice");
      expect(blocked.status, blocked.out).toBe(1);

      // Judged by its own lines: libfabrika's module rule also refuses a planted top file in `src/`,
      // and lint.ts fails on a fire only when it blocks, so a jsdocs line that advises cannot fail it.
      if (folders.length > 0) {
        const warn = lint(...Arr.map(folders, (folder) => `${folder}/Planted.ts`));
        const lines = Arr.filter(warn.out.split("\n"), (line) => line.includes(" fabrika(jsdocs) "));
        expect(lines, warn.out).toHaveLength(2 * folders.length);

        for (const line of lines) {
          expect(line).toContain("fabrika(jsdocs) advice, this folder is not at zero yet:");
        }

        for (const folder of folders) {
          expect(
            Arr.filter(lines, (line) => line.startsWith(`${folder}/Planted.ts:`)),
            folder,
          ).toHaveLength(2);
        }
      }

      const tests = lint(...Arr.map([clean, ...folders], (folder) => `${folder}/Planted.test.ts`));
      expect(tests.out).not.toContain("fabrika(jsdocs)");
    } finally {
      done();
    }
  }, 120_000);
});

/**
 * The folders the config's `fabrika/jsdocs` warn lines name, read from oxlint's own `--print-config`
 * and written out apart from `advice.ts`: `<pkg>/src/<name>/**` gives `<pkg>/src/<name>`, and
 * `<pkg>/src/*` gives `<pkg>/src`. It removes the repo it is given.
 */
const jsdocsWarnFolders = ({ at, done }: { readonly at: string; readonly done: () => void }): string[] => {
  try {
    const printed = spawnSync(OXLINT, [`--config=${join(at, ".oxlintrc.json")}`, "--print-config"], {
      cwd: at,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(printed.status, printed.stderr).toBe(0);
    const { overrides }: { readonly overrides: ReadonlyArray<{ files: string[]; rules: Record<string, unknown> }> } =
      JSON.parse(printed.stdout);
    return pipe(
      overrides,
      Arr.filter(({ rules }) => {
        const setting = rules["fabrika/jsdocs"];
        return (Arr.isArray(setting) ? setting[0] : setting) === "warn";
      }),
      Arr.flatMap(({ files }) => files),
      Arr.map((glob) => {
        expect(glob, "a jsdocs warn line names one folder").toMatch(/^next\/packages\/[^/*]+\/src(\/[^/*]+)?\/\*\*?$/);
        return glob.replace(/\/\*\*?$/, "");
      }),
    );
  } finally {
    done();
  }
};

describe("T930 L4 the warn lines are read from oxlint's own --print-config", () => {
  // pinned: oxlint 1.90.0's --print-config shape (pnpm-lock.yaml): a builtin's key loses its plugin,
  // a level prints as "deny" or "warn", and an override keeps its `files` list. The config holds the
  // frozen version's warn override too (FROZEN above): it is not a dirty-folder line, so it is not read.
  it("pinned: reads a law-shape warn override, a no-restricted-properties one and a jsdocs one with options, and no error or frozen line", () => {
    const config = {
      ...small([]),
      overrides: [
        ...small([]).overrides,
        {
          files: ["next/dirty/**/*{.test.ts,Test.ts}", "next/other/*{.test.ts,Test.ts}"],
          rules: { "fabrika/law-shape": "warn" },
        },
        { files: ["next/dirty/**"], rules: { "eslint/no-restricted-properties": parse("warn") } },
        // Ticket 948: the docs rule's warn line, with its option, as the real config writes it.
        { files: ["next/docs/src/*"], rules: { "fabrika/jsdocs": ["warn", { since: "absent" }] } },
      ],
    };
    const { at, done } = repo(config, {});

    try {
      const printed = spawnSync(OXLINT, [`--config=${join(at, ".oxlintrc.json")}`, "--print-config"], {
        cwd: at,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(printed.status, printed.stderr).toBe(0);
      expect(warnLines(JSON.parse(printed.stdout))).toEqual([
        { rule: "fabrika(law-shape)", glob: "next/dirty/**/*{.test.ts,Test.ts}" },
        { rule: "fabrika(law-shape)", glob: "next/other/*{.test.ts,Test.ts}" },
        { rule: "eslint(no-restricted-properties)", glob: "next/dirty/**" },
        { rule: "fabrika(jsdocs)", glob: "next/docs/src/*" },
      ]);
    } finally {
      done();
    }
  }, 120_000);
});

describe("T930 L5 a whole run fails on a warn line whose folder has no fire left", () => {
  it("scenario: names the empty folder's line, passes once it goes, and a run given a path skips the check", () => {
    const files = planted("next/dirty");
    const stuck = repo(small(["next/dirty", "next/empty"]), files);
    const pruned = repo(small(["next/dirty"]), files);

    try {
      const whole = stuck.lint();
      expect(whole.out).toMatch(/fabrika\(no-effect-promise\)[^\n]*next\/empty\/\*\*/);
      expect(whole.out).not.toMatch(/has no fire left in next\/dirty/);
      expect(whole.status, whole.out).toBe(1);

      const path = stuck.lint("next/dirty/promise.ts");
      expect(path.out).not.toContain("next/empty");
      expect(path.status, path.out).toBe(0);

      // Both repos hold the frozen override with no fire under it, and that never fails a run.
      const clean = pruned.lint();
      expect(clean.out).not.toContain("has no fire left");
      expect(clean.out).not.toContain("warn line");
      expect(clean.out).toContain(`oxlint: 0 blocking, ${FIVE.length} advice`);
      expect(clean.status, clean.out).toBe(0);
    } finally {
      stuck.done();
      pruned.done();
    }
  }, 120_000);
});

describe("T930 L10 the five stop saying they only advise", () => {
  // format: the rules' own words, as the repo's real config prints them for a fire in a clean folder.
  it("format: no message or hint of the five holds Advice or does not block, and each blocks", () => {
    const at = realpathSync(mkdtempSync(join(tmpdir(), "advice-words-")));

    try {
      copyFileSync(join(ROOT, ".oxlintrc.json"), join(at, ".oxlintrc.json"));
      symlinkSync(join(ROOT, "oxlint-plugins"), join(at, "oxlint-plugins"));
      const files = planted("next/packages/zero/src/clean");

      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(at, path)), { recursive: true });
        writeFileSync(join(at, path), text);
      }

      const ran = spawnSync(
        OXLINT,
        [
          `--config=${join(at, ".oxlintrc.json")}`,
          "--disable-nested-config",
          "--no-ignore",
          "--format=json",
          ...Object.keys(files),
        ],
        { cwd: at, encoding: "utf8", timeout: 60_000, maxBuffer: 2 ** 28 },
      );
      const report: {
        readonly diagnostics: ReadonlyArray<{
          readonly code?: string;
          readonly message: string;
          readonly help?: string;
          readonly severity: string;
        }>;
      } = JSON.parse(ran.stdout);
      const fires = Arr.filter(report.diagnostics, (d) => Arr.some(FIVE, (code) => code === d.code));
      expect([...new Set(Arr.map(fires, (d) => d.code))].sort()).toEqual([...FIVE].sort());

      for (const d of fires) {
        expect(`${d.message} ${d.help ?? ""}`, d.code).not.toMatch(/advice|does not block/i);
        expect(d.severity, d.code).toBe("error");
      }
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  }, 120_000);
});

/** The Reflect ban's four entries (0554), each with its own hint, as the config writes them. */
const BAN = [
  { object: "Reflect", property: "get", message: "Decode with Schema, or narrow first (0554)." },
  { object: "Reflect", property: "set", message: "Assign through the type (0554)." },
  { object: "Reflect", property: "has", message: "Narrow with Predicate.hasProperty (0554)." },
  { object: "globalThis", property: "Reflect", message: "Name Reflect directly, so lint can read the call (0554)." },
];

/**
 * The small config with the ban on, the way the real config turns it on: blocks after the dirty
 * folders' lines that repeat the JSON.parse entry, at "warn" where JSON.parse still advises.
 */
const banned = (dirty: readonly string[] = ["next/dirty"]) => {
  const base = small(dirty);
  const ban = (level: string) => [...parse(level), ...BAN];
  return {
    ...base,
    overrides: [
      ...base.overrides,
      { files: ["next/clean/**"], rules: { "eslint/no-restricted-properties": ban("error") } },
      { files: Arr.map(dirty, (folder) => `${folder}/**`), rules: { "eslint/no-restricted-properties": ban("warn") } },
    ],
  };
};

/** One planted line per entry of the ban, in a file of its own. */
const REFLECTS =
  'declare const x: object;\nexport const a: unknown = Reflect.get(x, "a");\nexport const b = Reflect.set(x, "a", 1);\nexport const c = Reflect.has(x, "a");\nexport const d = globalThis.Reflect;\n';

describe("Reflect ban L2 through lint.ts and oxlint, a Reflect fire blocks where the rule is at warn", () => {
  // scenario: a small config with one dirty folder, one planted JSON.parse line and one planted file
  // of Reflect lines, run through the real runner.
  // Plant: make `advises` read the code alone again, and the dirty folder's Reflect lines advise.
  it("scenario: in next/dirty the JSON.parse fire advises and each Reflect fire blocks, and in next/clean all block", () => {
    const { lint, done } = repo(banned(), {
      "next/dirty/parse.ts": PLANTS["eslint(no-restricted-properties)"].text,
      "next/dirty/reflect.ts": REFLECTS,
      "next/clean/reflect.ts": REFLECTS,
    });

    try {
      const parsed = lint("next/dirty/parse.ts");
      expect(parsed.out).toContain("eslint(no-restricted-properties) advice, this folder is not at zero yet:");
      expect(parsed.out).toContain("oxlint: 0 blocking, 1 advice");
      expect(parsed.status, parsed.out).toBe(0);

      const dirty = lint("next/dirty/reflect.ts");
      expect(dirty.out).not.toContain("advice, this folder is not at zero yet");
      expect(dirty.out).toContain("oxlint: 4 blocking, 0 advice");
      expect(dirty.status, dirty.out).toBe(1);

      for (const { message } of BAN) {
        expect(dirty.out).toContain(message);
      }

      const both = lint("next/dirty/parse.ts", "next/dirty/reflect.ts");
      expect(both.out).toContain("oxlint: 4 blocking, 1 advice");
      expect(both.status, both.out).toBe(1);

      const clean = lint("next/clean/reflect.ts");
      expect(clean.out).toContain("oxlint: 4 blocking, 0 advice");
      expect(clean.status, clean.out).toBe(1);
    } finally {
      done();
    }
  }, 120_000);
});

describe("Reflect ban L3 a Reflect fire does not keep a JSON.parse warn line alive", () => {
  // scenario: the same small config, with the dirty folder's JSON.parse line removed and its other
  // five plants kept, so only the JSON.parse warn line can go stale.
  // Plant: count every warning of the rule as holding the line, and the stale line is not named.
  it("scenario: a whole run names the rule's warn line stale once only Reflect fires are left, and not while JSON.parse is", () => {
    const others = Object.fromEntries(
      Arr.filter(Object.entries(planted("next/dirty")), ([path]) => !path.endsWith("/parse.ts")),
    );
    const stuck = repo(banned(), { ...others, "next/dirty/reflect.ts": REFLECTS });
    const held = repo(banned(), { ...planted("next/dirty"), "next/dirty/reflect.ts": REFLECTS });
    const line = "eslint(no-restricted-properties) has no fire left in next/dirty/**";

    try {
      const whole = stuck.lint();
      expect(whole.out).toContain(line);
      expect(whole.out).not.toMatch(/fabrika\([a-z-]+\) has no fire left/);
      expect(whole.status, whole.out).toBe(1);

      const kept = held.lint();
      expect(kept.out).not.toContain("has no fire left");
      expect(kept.out).toContain("oxlint: 4 blocking, 5 advice");
    } finally {
      stuck.done();
      held.done();
    }
  }, 120_000);
});

/** A file inside one folder glob of the config: `next/a/**` and `next/a/*` give `next/a/planted.ts`. */
const inside = (glob: string): string => `${glob.replace(/(\/\*\*)?\/\*\*?$/, "")}/planted.ts`;

/** One option of the rule, named as oxlint names its fire: `JSON.parse`, or `setBounds` alone. */
const nameOf = (entry: unknown): string => {
  if (typeof entry !== "object" || entry === null) {
    return "";
  }

  const object = "object" in entry && typeof entry.object === "string" ? `${entry.object}.` : "";
  const property = "property" in entry && typeof entry.property === "string" ? entry.property : "";
  return `${object}${property}`;
};

describe("Reflect ban L4 each ban block under next/ keeps what the rule held there before", () => {
  // pinned: the real config, read from oxlint 1.90.0's own --print-config, since the law is about
  // this one file. A level prints as "deny" or "warn", and a setting as [level, [options]].
  // Plant: drop JSON.parse from the second ban block, and that block no longer keeps it.
  it("pinned: every ban block under next/ keeps the JSON.parse entry at its folder's old level, and client/ keeps both retry entries", () => {
    const { at, done } = repo(readFileSync(join(ROOT, ".oxlintrc.json"), "utf8"), {});

    try {
      const printed = spawnSync(OXLINT, [`--config=${join(at, ".oxlintrc.json")}`, "--print-config"], {
        cwd: at,
        encoding: "utf8",
        maxBuffer: 2 ** 28,
        timeout: 60_000,
      });
      expect(printed.status, printed.stderr).toBe(0);
      const { overrides }: { readonly overrides: ReadonlyArray<{ files: string[]; rules: Record<string, unknown> }> } =
        JSON.parse(printed.stdout);
      const settings = Arr.flatMap(overrides, ({ files, rules }) => {
        const setting = rules["no-restricted-properties"];
        return Arr.isArray(setting) && Arr.isArray(setting[1])
          ? [{ files, level: setting[0], names: Arr.map(setting[1], nameOf) }]
          : [];
      });
      // The folders where JSON.parse advised before the ban: the warn override with no Reflect entry.
      const advised = pipe(
        settings,
        Arr.filter(({ level, names }) => level === "warn" && !names.includes("Reflect.get")),
        Arr.flatMap(({ files }) => files),
      );
      const blocks = Arr.filter(
        settings,
        ({ files, names }) => names.includes("Reflect.get") && Arr.some(files, (glob) => glob.startsWith("next/")),
      );
      // Coverage: a block where JSON.parse blocks and one where it still advises.
      expect(new Set(Arr.map(blocks, ({ level }) => level))).toEqual(new Set(["deny", "warn"]));

      for (const { files, level, names } of blocks) {
        expect(names, Arr.join(files, " ")).toContain("JSON.parse");

        for (const glob of files) {
          expect(glob, "a ban block under next/ names next/ folders only").toMatch(/^next\//);
          const was = Arr.some(advised, (warn) => matchesGlob(inside(glob), warn)) ? "warn" : "deny";
          expect(level, glob).toBe(was);

          if (glob.startsWith("next/packages/libfabrika/src/client/")) {
            expect(names, glob).toEqual(expect.arrayContaining(["Effect.retry", "Stream.retry"]));
          }
        }
      }
    } finally {
      done();
    }
  }, 120_000);
});
