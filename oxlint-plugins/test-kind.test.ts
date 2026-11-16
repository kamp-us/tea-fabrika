// 0584, next/. `test-kind.ts` fails an `.integration.` file that reaches no real thing, and only
// advises on a plain file that reaches one through helpers. K3 runs twice: on `judge` in memory,
// over chains of every edge kind code-graph answers, and through the real command on planted trees,
// so code-graph's own resolution (a relative path, a workspace package's exact export, a `*`
// pattern) is in the law. K4 rides on the planted trees: advice never changes the exit, a failure
// exits 1. Plants, each run once on test-kind.ts and restored: stop the walk after the first hop
// (red: a two-hop integration chain failed); exit 1 on an advice line (red: a tree of only advice
// exited 1).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import type { Tag } from "./starters.ts";
import { judge, type Module } from "./test-kind.ts";

/** What the last module of a chain holds: a starter of a tag, one that is real only on Node's layer, or nothing. */
type End =
  | { readonly _tag: "opens"; readonly tag: Tag }
  | { readonly _tag: "needs_layer" }
  | { readonly _tag: "type_only" }
  | { readonly _tag: "nothing" };

/** A module's text for each end, in the starters' own spellings. */
const SOURCE: Readonly<Record<Tag, string>> = {
  process: 'import { spawnSync } from "node:child_process";\nexport const go = () => spawnSync("git");\n',
  port: 'import { createServer } from "node:net";\nexport const go = () => createServer();\n',
  browser: 'import { chromium } from "playwright";\nexport const go = () => chromium.launch();\n',
  instance:
    'import { localInstance } from "./local-instance.ts";\nexport const go = (home: string) => localInstance(home);\n',
  signal: "export const go = (pid: number) => process.kill(pid);\n",
  network: 'export const go = () => fetch("https://example.com/");\n',
  disk: 'import { mkdtempSync } from "node:fs";\nexport const go = () => mkdtempSync("t1073-");\n',
};

const sourceOf = (end: End): string => {
  switch (end._tag) {
    case "opens":
      return SOURCE[end.tag];
    case "needs_layer":
      // A FileSystem service's temp folder, real only on Node's layer, which the module that runs it provides.
      return 'import { Effect, FileSystem } from "effect";\nexport const go = Effect.gen(function* () {\n  const fs = yield* FileSystem.FileSystem;\n  return yield* fs.makeTempDirectory();\n});\n';
    case "type_only":
      return 'import type { spawnSync } from "node:child_process";\nexport type Go = typeof spawnSync;\n';
    case "nothing":
      return "export const go = () => 1;\n";
  }
};

const end: fc.Arbitrary<End> = fc.oneof(
  fc
    .constantFrom<Tag>("process", "port", "browser", "instance", "signal", "network", "disk")
    .map((tag): End => ({ _tag: "opens", tag })),
  fc.constantFrom<End>({ _tag: "needs_layer" }, { _tag: "type_only" }, { _tag: "nothing" }),
);

/** Whether a chain's end is a starter: for the integration walk, and alone, for the advice. */
const reaches = (e: End) => e._tag === "opens" || e._tag === "needs_layer";

const alone = (e: End) => e._tag === "opens";

/** An edge kind as code-graph answers it; only a type-only edge reaches nothing. */
const edge = fc.constantFrom("static", "dynamic", "export-from", "type-only");

it("K3: in memory, an .integration. file fails exactly when no chain of value imports reaches a starter, and a plain file gets advice only through a helper", () => {
  const seen = new Set<string>();

  fc.assert(
    fc.property(
      fc.record({
        integration: fc.boolean(),
        hops: fc.array(edge, { maxLength: 3 }),
        end,
        // A side import that opens nothing, and one outside the tree (a package), on every module.
        side: fc.boolean(),
      }),
      ({ integration, hops, end: last, side }) => {
        const test = `next/apps/x/src/t.${integration ? "integration." : ""}test.ts`;
        const chain = [test, ...Arr.map(hops, (_, k) => `next/apps/x/src/m${k + 1}.ts`)];

        const modules = new Map<string, Module>(
          Arr.map(chain, (file, k) => {
            const hop = hops[k];

            const imports = [
              ...(hop === undefined ? [] : [{ target: chain[k + 1] ?? null, typeOnly: hop === "type-only" }]),
              ...(side
                ? [
                    { target: "next/apps/x/src/side.ts", typeOnly: false },
                    { target: null, typeOnly: false },
                  ]
                : []),
            ];

            return [file, { source: k === chain.length - 1 ? sourceOf(last) : "export {};\n", imports }];
          }),
        );

        modules.set("next/apps/x/src/side.ts", { source: "export const side = 1;\n", imports: [] });

        const open = Arr.every(hops, (hop) => hop !== "type-only");
        const fails = integration && !(open && reaches(last));
        const advised = !integration && hops.length > 0 && open && alone(last);
        const findings = judge(modules);

        seen.add(`${hops.length}:${last._tag}:${fails}:${advised}`);
        expect(
          pipe(
            findings,
            Arr.filter((f) => f._tag === "integration_opens_nothing"),
            Arr.map((f) => f.file),
          ),
        ).toEqual(fails ? [test] : []);
        expect(
          pipe(
            findings,
            Arr.filter((f) => f._tag === "plain_opens"),
            Arr.map((f) => [f.file, f.via]),
          ),
        ).toEqual(advised ? [[test, chain]] : []);
      },
    ),
    { seed: 119120, numRuns: 100 },
  );
  // Coverage: a chain of three hops that passes, one that fails, and advice two hops down were all generated.
  expect(Arr.some([...seen], (key) => key.startsWith("3:") && key.endsWith(":false:false"))).toBe(true);
  expect(Arr.some([...seen], (key) => key.endsWith(":true:false"))).toBe(true);
  expect(Arr.some([...seen], (key) => /^[23]:opens:false:true$/.test(key))).toBe(true);
});

/** How one hop names the next module: a relative path, the package's exact export, or a `*` pattern. */
type Hop = "relative" | "exact" | "pattern";

type Chain = { readonly integration: boolean; readonly hops: ReadonlyArray<Hop>; readonly end: End };

const chain: fc.Arbitrary<Chain> = fc.record({
  integration: fc.boolean(),
  hops: fc.array(fc.constantFrom<Hop>("relative", "exact", "pattern"), { maxLength: 3 }),
  end,
});

const APP = "next/apps/app";

const LIB = "next/packages/lib";

/** A planted repo: the chains in an app and a library package, linked as pnpm links them. */
const plant = (chains: ReadonlyArray<Chain>) => {
  const root = mkdtempSync(join(tmpdir(), "t1073-kind-"));

  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };

  const exports: Record<string, string> = { "./p/*": "./src/*.ts" };
  const tests: Array<{ readonly file: string; readonly chain: Chain }> = [];

  Arr.forEach(chains, (c, i) => {
    const test = `${APP}/src/c${i}.${c.integration ? "integration." : ""}test.ts`;
    let at = test;
    let text = "";

    Arr.forEach(c.hops, (hop, k) => {
      const name = `c${i}m${k + 1}`;
      // A relative hop stays in the importer's package; a workspace hop goes into the library.
      const next = hop === "relative" ? `${dirname(at)}/${name}.ts` : `${LIB}/src/${name}.ts`;
      const specifier = hop === "relative" ? `./${name}.ts` : hop === "exact" ? `@t/lib/${name}` : `@t/lib/p/${name}`;

      if (hop === "exact") {
        exports[`./${name}`] = `./src/${name}.ts`;
      }

      write(at, `${text}import { go } from "${specifier}";\nexport const run = () => go();\n`);
      at = next;
      text = "";
    });

    write(at, sourceOf(c.end));
    tests.push({ file: test, chain: c });
  });

  write("package.json", '{ "name": "t1073", "private": true }\n');
  write(
    "tsconfig.json",
    '{ "compilerOptions": { "module": "nodenext", "allowImportingTsExtensions": true, "noEmit": true } }\n',
  );
  write(`${APP}/package.json`, '{ "name": "@t/app", "type": "module", "dependencies": { "@t/lib": "workspace:*" } }\n');
  write(`${LIB}/package.json`, `${JSON.stringify({ name: "@t/lib", type: "module", exports })}\n`);

  // pnpm's links: the app sees the library, and the library sees itself by its own name.
  for (const folder of [APP, LIB]) {
    mkdirSync(join(root, folder, "node_modules/@t"), { recursive: true });
    symlinkSync(
      relative(join(root, folder, "node_modules/@t"), join(root, LIB)),
      join(root, folder, "node_modules/@t/lib"),
    );
  }

  return { root, tests };
};

const COMMAND = join(import.meta.dirname, "test-kind.ts");

it("K3 and K4: through the real command and code-graph, every hop kind is followed, a failure exits 1, and advice never changes the exit", () => {
  const seen = new Set<string>();

  fc.assert(
    fc.property(fc.array(chain, { minLength: 1, maxLength: 6 }), (chains) => {
      const { root, tests } = plant(chains);

      try {
        const run = spawnSync(process.execPath, [COMMAND, root], { encoding: "utf8" });

        const fails = pipe(
          tests,
          Arr.filter(({ chain: c }) => c.integration && !reaches(c.end)),
          Arr.map(({ file }) => file),
        );

        const advised = pipe(
          tests,
          Arr.filter(({ chain: c }) => !c.integration && c.hops.length > 0 && alone(c.end)),
          Arr.map(({ file }) => file),
        );

        const named = (out: string, prefix: string) =>
          pipe(
            tests,
            Arr.map(({ file }) => file),
            Arr.filter((file) => Arr.some(out.split("\n"), (l) => l.startsWith(`${prefix}${file}`))),
          );

        for (const { chain: c } of tests) {
          for (const hop of c.hops) {
            seen.add(hop);
          }
        }

        seen.add(`exit ${fails.length > 0 ? 1 : 0}${advised.length > 0 ? " with advice" : ""}`);
        expect({ exit: run.status, fails: named(run.stderr, ""), advised: named(run.stdout, "advice: ") }).toEqual({
          exit: fails.length > 0 ? 1 : 0,
          fails,
          advised,
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
    { seed: 119120, numRuns: 20 },
  );
  // Coverage: every hop kind, a failing tree, and a passing tree that still printed advice.
  expect(Arr.filter([...seen], (k) => !k.startsWith("exit")).sort()).toEqual(["exact", "pattern", "relative"]);
  expect(seen.has("exit 0 with advice")).toBe(true);
  expect(Arr.some([...seen], (k) => k.startsWith("exit 1"))).toBe(true);
});
