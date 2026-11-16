// T730's L9, moved from next/apps/fabrika/src/settings-generated.test.ts (0591): the law is the plant
// test of oxlint's own `no-restricted-imports` as `.oxlintrc.json` sets it. In next/apps only the start
// files (`dev.ts`, `cli.ts` and `src/settings-start.integration.test.ts`) import the TOML adapter; in
// libfabrika only the settings module and `node/settings/`; and only `settings/TomlParser.ts` imports
// the parser. Each generated caller and spelling is planted at its path and linted with the real config.
//
// Plant, run once when the law moved: drop `src/settings-start.integration.test.ts` from the adapter's
// allowed files in `.oxlintrc.json`, and the start test's import of the adapter fires: red.
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

// L9's callers: where an import sits, and whether it may take the TOML adapter or the parser.
const ADAPTER = "next/packages/libfabrika/src/settings/TomlParser.ts";
const RULE = "eslint(no-restricted-imports)";

const word = fc.stringMatching(/^[a-z][a-z0-9]{2,7}$/);

const caller = fc.oneof(
  // The exact start files: they choose the adapter.
  fc
    .constantFrom(
      "next/apps/fabrika/dev.ts",
      "next/apps/fabrika/cli.ts",
      "next/apps/fabrika/src/settings-start.integration.test.ts",
    )
    .map((file) => ({ file, adapter: true, parser: false })),
  // Every other app file, the generation entry and sibling tests included.
  fc
    .constantFrom(
      "next/apps/fabrika/settings-generate.ts",
      "next/apps/fabrika/build.ts",
      "next/apps/fabrika/src/settings-generated.test.ts",
    )
    .map((file) => ({ file, adapter: false, parser: false })),
  fc
    .tuple(
      word,
      fc.constantFrom(
        "next/apps/fabrika/src/",
        "next/apps/fabrika/src/exam/",
        "next/apps/fabrika/",
        "next/apps/other/src/",
      ),
      fc.constantFrom(".ts", ".test.ts", ".tsx"),
    )
    .map(([w, folder, ext]) => ({ file: `${folder}${w}${ext}`, adapter: false, parser: false })),
  // The settings module and its Node loader take the adapter; other modules and packages do not.
  fc
    .tuple(
      word,
      fc.constantFrom("next/packages/libfabrika/src/settings/", "next/packages/libfabrika/src/node/settings/"),
    )
    .map(([w, folder]) => ({ file: `${folder}X${w}.ts`, adapter: true, parser: false })),
  fc
    .tuple(
      word,
      fc.constantFrom(
        "next/packages/libfabrika/src/runtime/",
        "next/packages/libfabrika/src/node/",
        "next/packages/tuval/src/",
      ),
    )
    .map(([w, folder]) => ({ file: `${folder}X${w}.ts`, adapter: false, parser: false })),
  // The adapter itself is the one file that imports the parser.
  fc.constant({ file: ADAPTER, adapter: true, parser: true }),
);

const target = fc.constantFrom("package", "relative", "relative-bare", "parser", "parser-subpath");

/** The relative import spelling from one repo file to another, as `../../packages/x.ts`. */
const relative = (from: string, to: string) => {
  const [a, b] = [from.split("/").slice(0, -1), to.split("/")];
  const shared = a.findIndex((s, n) => s !== b[n]);
  const n = shared === -1 ? a.length : shared;
  const rest = b.slice(n).join("/");
  return a.length === n ? `./${rest}` : `${"../".repeat(a.length - n)}${rest}`;
};

it("L9: oxlint refuses each import of the TOML adapter or its parser a caller may not make, in every spelling, and passes the rest", async () => {
  // Each run plants a batch of generated imports and lints them in one oxlint process.
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(fc.tuple(caller, target), { minLength: 1, maxLength: 12, selector: ([c]) => c.file }),
      async (cases) => {
        const planted = cases
          .filter(([c, t]) => !(c.file === ADAPTER && t !== "parser" && t !== "parser-subpath"))
          .map(([c, t]) => {
            const spec =
              t === "package"
                ? "@kampus/libfabrika/settings/TomlParser"
                : t === "relative"
                  ? relative(c.file, ADAPTER)
                  : t === "relative-bare"
                    ? relative(c.file, ADAPTER).replace(/\.ts$/, "")
                    : t === "parser"
                      ? "toml-eslint-parser"
                      : "toml-eslint-parser/lib/ast";
            const allowed = t === "parser" || t === "parser-subpath" ? c.parser : c.adapter;
            return { file: c.file, spec, allowed };
          });
        fc.pre(planted.length > 0);
        const result = await plant(
          Object.fromEntries(planted.map((p) => [p.file, `import * as T from "${p.spec}";\n\nexport const t = T;\n`])),
        );

        for (const p of planted) {
          expect(result(RULE, p.file), `${p.file} imports ${p.spec}`).toEqual(p.allowed ? [] : [1]);
        }
      },
    ),
    // A lint property: each run starts one oxlint process over up to 12 planted files, so a red
    // ends at its first counterexample rather than shrinking through more processes. 100 runs, the
    // plan's count (0591, M8): at the old 10, seed 119120 draws the start test file only once, with a
    // parser import, so the plant above stayed green; at 100 it first fails at run 17.
    { seed: SEED, numRuns: 100, endOnFailure: true },
  );
}, 120_000);
