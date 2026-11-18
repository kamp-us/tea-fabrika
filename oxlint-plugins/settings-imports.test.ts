// T730, P38 slice 2, L9 of its approved plan: in next/apps only `dev.ts`, `cli.ts` and
// `src/settings-start.integration.test.ts` import the TOML adapter; in libfabrika only the settings
// module and `node/settings/`; and only `settings/TomlParser.ts` imports the parser. oxlint's own
// `no-restricted-imports` says so, in `.oxlintrc.json`, so this law is that rule's plant test, through
// the real config at generated next/ paths. It was in next/apps/fabrika/src/settings-generated.test.ts
// until 0591 moved it here, beside the other lint rules' tests. Plant: drop
// `src/settings-start.integration.test.ts` from the adapter's allowed files in `.oxlintrc.json`, and a
// drawn start file is refused.
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { plant } from "./plant.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

// L9's callers: where an import sits, and whether it may take the TOML adapter or the parser.
const ADAPTER = "next/packages/libfabrika/src/settings/TomlParser.ts";

const RULE = "eslint(no-restricted-imports)";

/** The exact start files: they choose the adapter. */
const START = [
  "next/apps/fabrika/dev.ts",
  "next/apps/fabrika/cli.ts",
  "next/apps/fabrika/src/settings-start.integration.test.ts",
];

const word = fc.stringMatching(/^[a-z][a-z0-9]{2,7}$/);

const caller = fc.oneof(
  // The exact start files: they choose the adapter.
  fc.constantFrom(...START).map((file) => ({ file, adapter: true, parser: false })),
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

describe("L9, only the start files take the TOML adapter in next/apps, and only the adapter takes the parser", () => {
  it("oxlint refuses each import a caller may not make, in every spelling, and passes the rest", async () => {
    // Each run plants a batch of generated imports and lints them in one oxlint process.
    // Coverage: each start file must be drawn taking the adapter, or a lost allowance would pass.
    const started = new Set<string>();
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

          for (const p of planted) {
            if (START.includes(p.file) && p.allowed) {
              started.add(p.file);
            }
          }

          const result = await plant(
            Object.fromEntries(
              planted.map((p) => [p.file, `import * as T from "${p.spec}";\n\nexport const t = T;\n`]),
            ),
          );

          for (const p of planted) {
            expect(result(RULE, p.file), `${p.file} imports ${p.spec}`).toEqual(p.allowed ? [] : [1]);
          }
        },
      ),
      // A lint property: each run starts one oxlint process over up to 12 planted files, so a red
      // ends at its first counterexample rather than shrinking through more processes.
      // 0591's M8 count: at the old 10 runs this seed never drew a start file taking the adapter.
      { seed: SEED, numRuns: 100, endOnFailure: true },
    );
    expect([...started].sort()).toEqual([...START].sort());
  }, 120_000);
});
