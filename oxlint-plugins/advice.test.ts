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
import { dirname, join } from "node:path";
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
          const six = SIX.some((code) => code === fire.code);
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
              ...names.map((folder) =>
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
          const warn: WarnLine[] = lines.map(({ folder, kind, rule }) => ({ rule, glob: globOf(folder, kind) }));

          const advice: Fire[] = fires.map(({ folder, place, rule }) => ({
            code: rule,
            severity: "warning",
            filename:
              place === "direct"
                ? `next/${folder}/b.ts`
                : place === "deep"
                  ? `next/${folder}/sub/b.ts`
                  : `next/${folder}x/b.ts`,
          }));

          const want = lines.flatMap(({ folder, kind, rule }, i) => {
            const line = warn[i]!;

            if (kind === "file") {
              return [{ _tag: "file", line }];
            }

            const held = fires.some(
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
  // The real config loads the vendored anti-slop plugins from here (0563).
  symlinkSync(join(ROOT, "vendor"), join(at, "vendor"));
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
    ...dirty.flatMap((folder) => [
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
  Object.fromEntries(Object.values(PLANTS).map(({ file, text }) => [`${folder}/${file}`, text]));

describe("T1087 fixes and ledger matching read the same source", () => {
  const config = {
    categories: { correctness: "off" },
    jsPlugins: ["./oxlint-plugins/index.ts"],
    ignorePatterns: ["oxlint-plugins/**", "node_modules/**"],
    rules: { "fabrika/no-promises": "error", "fabrika/padding-line-between-statements": "error" },
    overrides: [{ files: ["next/**", ".agents/**"], rules: { "fabrika/no-promises": "error" } }],
  };

  const known = "export const known = async () => 2;";
  const fresh = "export const fresh = async () => 3;";
  const before = `export function first() {\n  return 1;\n}\n${known}\n\n${fresh}\n`;
  const after = before.replace(`}\n${known}`, `}\n\n${known}`);

  const folders = [
    { folder: ".agents", ledger: "agents-ledger.json" },
    { folder: "next", ledger: "next-ledger.json" },
  ];

  const entries = (file: string) => [
    { file, rule: "fabrika(no-promises)", code: known },
    { file, rule: "fabrika(padding-line-between-statements)", code: known },
    { file, rule: "fabrika(no-promises)", code: "export const fresh = async () => 1;" },
    { file, rule: "fabrika(no-promises)", code: "export const deleted = async () => 0;" },
  ];

  const files = () =>
    Object.fromEntries(
      folders.flatMap(({ folder, ledger }) => [
        [`${folder}/unit.ts`, before],
        [ledger, `${JSON.stringify({ entries: entries(`${folder}/unit.ts`) })}\n`],
      ]),
    );

  it.each(["--fix", "--fix-suggestions", "--fix-dangerously"])(
    "scenario: %s keeps a moved unchanged finding, prunes fixed, changed and deleted entries, and blocks new code",
    (flag) => {
      const fixture = repo(config, files());
      rmSync(join(fixture.at, "vendor"));

      try {
        const fixed = fixture.lint("--threads=1", flag);
        expect(fixed.status, fixed.out).toBe(1);
        expect(fixed.out).toContain("oxlint: 2 blocking, 0 advice");

        for (const { folder, ledger } of folders) {
          expect(readFileSync(join(fixture.at, folder, "unit.ts"), "utf8")).toBe(after);
          expect(fixed.out).toContain(`${folder}/unit.ts:7:22 fabrika(no-promises)`);
          expect(fixed.out).toContain(`${ledger}: pruned 3 fixed entries`);
          expect(JSON.parse(readFileSync(join(fixture.at, ledger), "utf8"))).toEqual({
            entries: [entries(`${folder}/unit.ts`)[0]],
          });
        }

        const checked = fixture.lint("--threads=1");
        expect(checked.status, checked.out).toBe(1);
        expect(checked.out).toContain("oxlint: 2 blocking, 0 advice");
        expect(checked.out).not.toContain("pruned");

        for (const { folder } of folders) {
          writeFileSync(join(fixture.at, folder, "unit.ts"), after.replace(`\n${fresh}\n`, "\n"));
        }

        const clean = fixture.lint("--threads=1");
        expect(clean.status, clean.out).toBe(0);
        expect(clean.out).toContain("oxlint: 0 blocking, 0 advice, 1 in agents-ledger.json, 1 in next-ledger.json");
        expect(clean.out).not.toContain("pruned");
      } finally {
        fixture.done();
      }
    },
  );

  it("scenario: a scoped fix matches moved findings and leaves both ledgers byte-identical", () => {
    const original = files();
    const fixture = repo(config, original);
    rmSync(join(fixture.at, "vendor"));

    try {
      const fixed = fixture.lint("--threads=1", "--fix", ".agents/unit.ts");
      expect(fixed.status, fixed.out).toBe(1);
      expect(fixed.out).toContain("oxlint: 1 blocking, 0 advice");
      expect(fixed.out).toContain(".agents/unit.ts:7:22 fabrika(no-promises)");
      expect(readFileSync(join(fixture.at, ".agents/unit.ts"), "utf8")).toBe(after);
      expect(readFileSync(join(fixture.at, "next/unit.ts"), "utf8")).toBe(before);

      for (const { ledger } of folders) {
        expect(readFileSync(join(fixture.at, ledger), "utf8")).toBe(original[ledger]);
      }
    } finally {
      fixture.done();
    }
  });
});

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
      const clean = lint(...Object.values(PLANTS).map(({ file }) => `next/clean/${file}`));
      expect(clean.out).toContain(`oxlint: ${FIVE.length} blocking, 0 advice`);
      expect(clean.status, clean.out).toBe(1);
      const dirty = lint(...Object.values(PLANTS).map(({ file }) => `next/dirty/${file}`));
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
        [clean, ...folders].flatMap((folder) => [
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
        const warn = lint(...folders.map((folder) => `${folder}/Planted.ts`));
        const lines = warn.out.split("\n").filter((line) => line.includes(" fabrika(jsdocs) "));
        expect(lines, warn.out).toHaveLength(2 * folders.length);

        for (const line of lines) {
          expect(line).toContain("fabrika(jsdocs) advice, this folder is not at zero yet:");
        }

        for (const folder of folders) {
          expect(
            lines.filter((line) => line.startsWith(`${folder}/Planted.ts:`)),
            folder,
          ).toHaveLength(2);
        }
      }

      const tests = lint(...[clean, ...folders].map((folder) => `${folder}/Planted.test.ts`));
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

    return overrides
      .filter(({ rules }) => {
        const setting = rules["fabrika/jsdocs"];

        return (Array.isArray(setting) ? setting[0] : setting) === "warn";
      })
      .flatMap(({ files }) => files)
      .map((glob) => {
        expect(glob, "a jsdocs warn line names one folder").toMatch(/^next\/packages\/[^/*]+\/src(\/[^/*]+)?\/\*\*?$/);

        return glob.replace(/\/\*\*?$/, "");
      });
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
      symlinkSync(join(ROOT, "vendor"), join(at, "vendor"));
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

      const fires = report.diagnostics.filter((d) => FIVE.some((code) => code === d.code));
      expect([...new Set(fires.map((d) => d.code))].sort()).toEqual([...FIVE].sort());

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
      { files: dirty.map((folder) => `${folder}/**`), rules: { "eslint/no-restricted-properties": ban("warn") } },
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
      Object.entries(planted("next/dirty")).filter(([path]) => !path.endsWith("/parse.ts")),
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

/** One sample file per folder: a fire of each member the rule restricts, so its severity says what the folder ends with. */
const SAMPLE = [
  "declare const Effect: any;",
  "declare const Stream: any;",
  'export const parse: unknown = JSON.parse("1");',
  'export const get: unknown = Reflect.get({}, "a");',
  'export const set = Reflect.set({}, "a", 1);',
  'export const has = Reflect.has({}, "a");',
  "export const hidden = globalThis.Reflect;",
  "export const retries = [Effect.retry, Stream.retry];",
  "",
].join("\n");

/** What the rule ends with in a folder, by member: oxlint's own severity of that member's fire there. */
type Ending = Readonly<Record<string, "error" | "warning">>;

/** The members a fire names, from oxlint's `'JSON.parse' is restricted from being used.` */
const memberOf = (message: string): string => /^'([^']*)'/.exec(message)?.[1] ?? "";

interface Report {
  readonly diagnostics: ReadonlyArray<{ code?: string; message: string; severity: string; filename: string }>;
}

/** What oxlint reports for no-restricted-properties, by member, in each folder of the files it read. */
const endings = ({ diagnostics }: Report) => {
  const found = new Map<string, Record<string, "error" | "warning">>();

  for (const { code, message, severity, filename } of diagnostics) {
    if (code === "eslint(no-restricted-properties)" && (severity === "error" || severity === "warning")) {
      found.set(dirname(filename), { ...found.get(dirname(filename)), [memberOf(message)]: severity });
    }
  }

  return found;
};

/**
 * The level a folder's JSON.parse fires are held at where it started: a glob of the warn block is
 * written for a folder one level under a package's `src` (or for `src` itself, or an app's `e2e`), so
 * that folder is the one that has to hold a fire. A clean folder below it advises with it.
 */
const topOf = (dir: string): string =>
  /^next\/(?:apps|packages|programs)\/[^/]+\/(?:src\/)?[^/]+/.exec(dir)?.[0] ?? dir;

describe("Reflect ban L4 each file of next/ ends with the setting the rule held there before", () => {
  // pinned: the real config and the real tree, since the law is about this one file. oxlint 1.90.0's
  // --print-config lists blocks and not what a file ends with, and the last matching block wins, so
  // the law plants one file of fires in each folder (every folder of next/ that holds code, the stem
  // of every block's glob, and a new folder) and reads the severity oxlint gives each fire there.
  // Then the folders that advise are held to the tree: a JSON.parse fire has to be in the folder a
  // warn glob is written for (topOf), so a glob cannot reach a folder that blocks today and keep the
  // stale warn-line law (T930 L3, per glob) quiet. No list of folders is pinned (0524).
  // Plants: add "next/packages/libfabrika/**" to the JSON.parse warn block's files; or drop a retry
  // entry from client/'s block; or set client/'s block to "warn"; or drop JSON.parse from the block
  // for next/ whole.
  it("pinned: every folder of next/ ends with JSON.parse and the ban at one level, new folders and client/ at error with both retry entries, and a folder that advises has JSON.parse fires in its tree", () => {
    const git = spawnSync("git", ["ls-files", "next"], { cwd: ROOT, encoding: "utf8", maxBuffer: 2 ** 28 });
    expect(git.status, git.stderr).toBe(0);
    const tracked = git.stdout.split("\n").filter((file) => /\.(?:ts|tsx|js|mjs)$/.test(file));

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

      const named = overrides
        .filter(({ rules }) => Array.isArray(rules["no-restricted-properties"]))
        .flatMap(({ files }) => files)
        .filter((glob) => glob.startsWith("next/"))
        .map((glob) => glob.replace(/(?:\/\*\*?)+$/, ""));

      const folders = [...new Set([...tracked.map((file) => dirname(file)), ...named, "next/zz-new-folder"])].sort();
      const samples = folders.map((folder) => join(folder, "zz-sample.ts"));

      for (const sample of samples) {
        mkdirSync(dirname(join(at, sample)), { recursive: true });
        writeFileSync(join(at, sample), SAMPLE);
      }

      const planted = spawnSync(
        OXLINT,
        [
          `--config=${join(at, ".oxlintrc.json")}`,
          "--disable-nested-config",
          "--no-ignore",
          "--format=json",
          ...samples,
        ],
        { cwd: at, encoding: "utf8", maxBuffer: 2 ** 28, timeout: 90_000 },
      );

      const report: Report = JSON.parse(planted.stdout);
      const ended = endings(report);
      const advising = folders.filter((folder) => ended.get(folder)?.["JSON.parse"] === "warning");

      // Coverage: folders that block, folders that advise, the new folder, and client/ with a subfolder.
      expect(advising.length).toBeGreaterThan(0);
      expect(folders.length - advising.length).toBeGreaterThan(0);
      expect(folders).toEqual(
        expect.arrayContaining([
          "next",
          "next/zz-new-folder",
          "next/packages/libfabrika/src/client",
          "next/packages/libfabrika/src/client/internal",
        ]),
      );

      for (const folder of folders) {
        const ending: Ending = ended.get(folder) ?? {};
        const level = ending["JSON.parse"];

        expect(level, `${folder} ends with JSON.parse restricted`).toBeDefined();

        for (const name of ["Reflect.get", "Reflect.set", "Reflect.has", "globalThis.Reflect"]) {
          expect(ending[name], `${folder} ends with ${name} restricted at JSON.parse's level`).toBe(level);
        }

        if (
          folder === "next" ||
          folder === "next/zz-new-folder" ||
          folder.startsWith("next/packages/libfabrika/src/client")
        ) {
          expect(level, `${folder} starts at zero and blocks`).toBe("error");
        }

        if (folder.startsWith("next/packages/libfabrika/src/client")) {
          expect(ending["Effect.retry"], `${folder} keeps Effect.retry`).toBe("error");
          expect(ending["Stream.retry"], `${folder} keeps Stream.retry`).toBe("error");
        }
      }

      // The tree's own fires: the files a warn folder's top holds, linted with the real config.
      const tops = [...new Set(advising.map(topOf))];
      const inside = (dir: string, top: string) => dir === top || (!top.endsWith("/src") && dir.startsWith(`${top}/`));
      const files = tracked.filter((file) => tops.some((top) => inside(dirname(file), top)));

      const real = spawnSync(
        OXLINT,
        [`--config=${join(ROOT, ".oxlintrc.json")}`, "--disable-nested-config", "--format=json", ...files],
        { cwd: ROOT, encoding: "utf8", maxBuffer: 2 ** 28, timeout: 100_000 },
      );

      const tree: Report = JSON.parse(real.stdout);

      const fires = [...endings(tree)]
        .filter(([, ending]) => ending["JSON.parse"] === "warning")
        .map(([folder]) => folder);

      for (const top of tops) {
        expect(
          fires.some((fire) => inside(fire, top)),
          `${top} advises for JSON.parse and has no JSON.parse fire left, so it blocks at zero`,
        ).toBe(true);
      }
    } finally {
      done();
    }
  }, 180_000);
});
