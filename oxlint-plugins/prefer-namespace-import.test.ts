// `fabrika/prefer-namespace-import`, E2 of the Effect-check sweep (0577). Laws 1 to 4 run in process
// through oxlint's RuleTester on generated import lines and read the exact text the fix writes.
// Law 5 lints planted files at their real paths with the repo's own `.oxlintrc.json`, so the scope is
// the config's: the 13 libfabrika folders and tuval fire, the folders still to come and every other
// path do not.
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { preferNamespaceImport } from "./prefer-namespace-import.ts";

const RUNS = { seed: 119120, numRuns: 100 };

const CODE = "fabrika(prefer-namespace-import)";

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();

RuleTester.it = (_name, fn) => fn();

const tester = new RuleTester({ cwd: import.meta.dirname });

/** Modules of the installed package: the barrel they are named from, and the module name. */
const MODULES = [
  { source: "effect", name: "Effect" },
  { source: "effect", name: "Duration" },
  { source: "effect", name: "Schema" },
  { source: "effect", name: "Option" },
  { source: "effect", name: "Array" },
  { source: "effect", name: "Layer" },
  { source: "effect", name: "Scope" },
  { source: "effect/process", name: "ChildProcess" },
  { source: "effect/process", name: "ChildProcessSpawner" },
  { source: "effect/testing", name: "TestClock" },
  { source: "effect/testing", name: "TestConsole" },
] as const;

/** Names Effect's root exports that are functions, not modules: no file stands behind them. */
const FUNCTIONS = ["pipe", "identity", "flow", "dual"] as const;

interface Wanted {
  readonly name: string;
  readonly local: string;
  readonly type: boolean;
}

/** Distinct names of one barrel, each with its own local name. */
const wanteds = (options: { readonly alias: boolean; readonly typed: "none" | "some" | "all" }) =>
  fc
    .record({
      source: fc.constantFrom("effect", "effect/process", "effect/testing"),
      picks: fc.array(fc.tuple(fc.nat(), fc.boolean(), fc.boolean()), { minLength: 1, maxLength: 6 }),
    })
    .map(({ source, picks }) => {
      const pool = MODULES.filter((m) => m.source === source);
      const seen = new Set<string>();
      const wanted: Wanted[] = [];

      for (const [at, aliased, typed] of picks) {
        const name = pool[at % pool.length]?.name ?? "Effect";

        if (!seen.has(name)) {
          seen.add(name);
          wanted.push({
            name,
            local: options.alias && aliased ? `${name}Alias` : name,
            type: options.typed === "all" || (options.typed === "some" && typed),
          });
        }
      }

      return { source, wanted };
    });

const specifierText = (w: Wanted, whole: boolean): string =>
  `${w.type && !whole ? "type " : ""}${w.name === w.local ? w.name : `${w.name} as ${w.local}`}`;

/** The source the person wrote, and what the fix must leave. */
const render = (
  { source, wanted }: { readonly source: string; readonly wanted: ReadonlyArray<Wanted> },
  whole: boolean,
) => {
  const code = `import ${whole ? "type " : ""}{ ${wanted.map((w) => specifierText(w, whole)).join(", ")} } from "${source}";\nexport const a = 1;\n`;

  const expected = `${wanted
    .map((w) => `import ${w.type || whole ? "type " : ""}* as ${w.local} from "${source}/${w.name}";`)
    .join("\n")}\nexport const a = 1;\n`;

  return { code, expected };
};

const fixes = (code: string, expected: string): void => {
  tester.run("prefer-namespace-import", preferNamespaceImport, {
    valid: [{ code: expected, filename: "case.ts" }],
    invalid: [
      { code, filename: "case.ts", errors: [{ message: /Import each Effect module by its path/ }], output: expected },
    ],
  });
};

describe("law 1: a named import of Effect modules is reported once, and the fix writes one namespace line per name", () => {
  // plant: the fix writes the barrel path (`effect`) in place of `effect/<Name>`, or drops a name.
  it("for any names of any barrel, in any order", () => {
    fc.assert(
      fc.property(wanteds({ alias: false, typed: "none" }), (model) => {
        const { code, expected } = render(model, false);

        fixes(code, expected);
      }),
      RUNS,
    );
  });
});

describe("law 2: a type-only import stays type-only, whole or by name", () => {
  // plant: the fix writes `import * as` for a type name.
  it("`import type { ... }` and `{ type X, Y }` give `import type * as` for the type names alone", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          wanteds({ alias: false, typed: "all" }).map((m) => render(m, true)),
          wanteds({ alias: false, typed: "some" }).map((m) => render(m, false)),
        ),
        ({ code, expected }) => {
          fixes(code, expected);
        },
      ),
      RUNS,
    );
  });
});

describe("law 3: an alias keeps its local name and takes the module of the imported name", () => {
  // plant: the fix names the module after the local alias.
  it('`{ A as B }` gives `import * as B from "effect/A"`', () => {
    fc.assert(
      fc.property(wanteds({ alias: true, typed: "some" }), (model) => {
        const { code, expected } = render(model, false);

        fixes(code, expected);
      }),
      RUNS,
    );
  });
});

describe("law 4: a name that is no module of Effect is reported and given no fix", () => {
  // plant: the module check always answers yes, so `pipe` becomes `effect/pipe`.
  it("alone or among modules, the whole declaration is left as written", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FUNCTIONS),
        fc.array(fc.constantFrom(...MODULES.filter((m) => m.source === "effect").map((m) => m.name)), { maxLength: 3 }),
        fc.nat(),
        (fn, modules, at) => {
          const names: string[] = [...new Set(modules)];

          names.splice(at % (names.length + 1), 0, fn);

          const code = `import { ${names.join(", ")} } from "effect";\nexport const a = 1;\n`;

          tester.run("prefer-namespace-import", preferNamespaceImport, {
            valid: [],
            invalid: [
              {
                code,
                filename: "case.ts",
                errors: [{ message: new RegExp(`${fn} from "effect" is no module`) }],
                output: null,
              },
            ],
          });
        },
      ),
      RUNS,
    );
  });
});

const IN_SCOPE = [
  "next/packages/libfabrika/src/planted.ts",
  "next/packages/libfabrika/src/access/Planted.ts",
  "next/packages/libfabrika/src/node/internal/planted.ts",
  "next/packages/libfabrika/src/transport/Planted.test.ts",
  "next/packages/libfabrika/src/tezgah/Planted.ts",
  "next/packages/tuval/src/planted.ts",
] as const;

const OUTSIDE = [
  "next/packages/libfabrika/src/runtime/Planted.ts",
  "next/packages/libfabrika/src/ci/Planted.ts",
  "next/apps/fabrika/src/planted.ts",
  "next/programs/counter/src/planted.ts",
  ".agents/skills/lead/scripts/planted.ts",
] as const;

describe("law 5: with the real config the rule fires in the folders the tsconfig locks, and nowhere else", async () => {
  const body = `import { Effect } from "effect";\n\nexport const planted = Effect.succeed(1);\n`;
  const linted = await plant(Object.fromEntries([...IN_SCOPE, ...OUTSIDE].map((path) => [path, body])));

  // plant: a folder dropped from the `.oxlintrc.json` block, so its planted file stays silent. Each
  // run takes every path, in a generated order, so no folder can be missed by the draw.
  it("fires on the import line in each locked folder, tests and internal/ included", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([...IN_SCOPE], { minLength: IN_SCOPE.length }), (paths) => {
        for (const path of paths) {
          expect(linted(CODE, path), path).toEqual([1]);
        }
      }),
      RUNS,
    );
  });

  it("stays silent in the folders still to come and outside the libraries", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([...OUTSIDE], { minLength: OUTSIDE.length }), (paths) => {
        for (const path of paths) {
          expect(linted(CODE, path), path).toEqual([]);
        }
      }),
      RUNS,
    );
  });
});
