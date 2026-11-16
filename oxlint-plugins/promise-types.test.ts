import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NodePath, NodeServices } from "@effect/platform-node";
import { Effect, Path } from "effect";
import * as fc from "fast-check";
import { API, type Snapshot } from "typescript/unstable/sync";
// `pnpm lint:promise-types` (`promise-types.ts`), the typed half of `no-promises` (exam item 1): a call,
// return or parameter that carries a Promise outside one marked edge line is refused, through Effect's
// bridges, aliases and inferred types. An edge comment covers only the next physical line. These laws
// were the exam's (next/apps/fabrika/src/exam/no-promises.integration.test.ts) until 0591 moved them here
// with the command; the oxlint half's plants are in no-promises.test.ts. Each law keeps its generator,
// seed 119120, at the count the full run gave it: this folder's tests run only in the full run (0590).
// Plant: let a marker cover the whole statement under it, not only the next line, and the wrapped-edge
// laws fail.
import { describe, expect, it } from "vitest";
import { checkPromiseTypes, checkSecretTypes, nextPackages, scopeGaps, typedProjects } from "./promise-types.ts";

const paths = Effect.runSync(Path.Path.pipe(Effect.provide(NodePath.layer)));

const typed = (files: Readonly<Record<string, string>>, workers = false) => {
  const root = mkdtempSync(join(tmpdir(), "p12-types-"));
  const api = new API({ cwd: root });

  try {
    for (const [file, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), body);
    }

    const config = join(root, "tsconfig.json");
    writeFileSync(
      config,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2023",
          ...(workers
            ? {
                module: "preserve",
                moduleResolution: "bundler",
                // Effect's DOM declarations are not Workers globals; check our source here.
                skipLibCheck: true,
                paths: {
                  effect: [paths.resolve(import.meta.dirname, "node_modules/effect/dist/index.d.ts")],
                  "effect/*": [paths.resolve(import.meta.dirname, "node_modules/effect/dist/*.d.ts")],
                },
                lib: ["ES2023"],
                types: [
                  paths.resolve(import.meta.dirname, "../next/apps/fabrika/node_modules/@cloudflare/workers-types"),
                ],
              }
            : {}),
        },
        include: ["**/*.ts"],
      }),
    );
    const snapshot = api.updateSnapshot({ openProjects: [config] });

    try {
      const project = snapshot.getProject(config)!;
      expect(project.program.getSemanticDiagnostics()).toEqual([]);
      return checkPromiseTypes(project, root, paths);
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
    rmSync(root, { recursive: true, force: true });
  }
};

const wrappedEdge = (method: string, rule: string, indent: string, gap = 0) =>
  [
    "declare const platform: {read(): Promise<number>};",
    "declare const Effect: {",
    "  tryPromise(options: {try: () => Promise<number>; catch: () => Error}): number;",
    "  runPromise(value: number): Promise<number>;",
    "};",
    `// oxlint-disable-next-line ${rule} -- edge: the platform call enters or leaves Effect`,
    `export const edge = Effect.${method}(`,
    ...(method === "runPromise" ? [`${indent}Effect.tryPromise(`] : []),
    `${indent}{`,
    `${indent}  try: () =>`,
    ...Array.from({ length: gap }, () => ""),
    `${indent}    platform.read(),`,
    `${indent}  catch: () => new Error("platform"),`,
    `${indent}}`,
    ...(method === "runPromise" ? [`${indent})`] : []),
    ");",
  ].join("\n");

const markedEdge = fc.tuple(
  fc.constantFrom("tryPromise", "runPromise"),
  fc.constantFrom("fabrika/no-promises", "fabrika/no-effect-run-outside-edge"),
  fc.constantFrom(" ", "  ", "\t"),
);

const bridgeSpellings = [
  "module",
  "renamedModule",
  "namespace",
  "function",
  "renamedFunction",
  "computed",
  "parenthesized",
  "nonNull",
  "satisfies",
  "sameTypeAs",
  "localAlias",
  "destructured",
  "computedKey",
  "aliasChain",
  "renamedDestructured",
  "moduleAlias",
  "computedBridgeKeys",
] as const;

const rpcSource = (
  suffix: string,
  method: "tryPromise" | "promise",
  gap: number,
  marked: boolean,
  spelling: (typeof bridgeSpellings)[number] | "bare" | "unresolvedKey",
) => {
  const [setup, callee] = (
    {
      module: ['import {Effect} from "effect";', `Effect.${method}`],
      renamedModule: ['import {Effect as E} from "effect";', `E.${method}`],
      namespace: ['import * as Fx from "effect";', `Fx.Effect.${method}`],
      function: [`import {${method}} from "effect/Effect";`, method],
      renamedFunction: [`import {${method} as tp} from "effect/Effect";`, "tp"],
      computed: ['import {Effect} from "effect";', `Effect["${method}"]`],
      parenthesized: ['import {Effect} from "effect";', `(Effect.${method})`],
      nonNull: ['import {Effect} from "effect";', `Effect.${method}!`],
      satisfies: ['import {Effect} from "effect";', `(Effect.${method} satisfies typeof Effect.${method})`],
      sameTypeAs: ['import {Effect} from "effect";', `(Effect.${method} as typeof Effect.${method})`],
      localAlias: [`import {Effect} from "effect";\nconst tp = Effect.${method};`, "tp"],
      destructured: [`import {Effect} from "effect";\nconst {${method}} = Effect;`, method],
      computedKey: [`import {Effect} from "effect";\nconst k = "${method}";`, "Effect[k]"],
      aliasChain: [
        `import {Effect} from "effect";\nconst first = (Effect.${method})!;\nconst tp = first satisfies typeof first;`,
        "(tp)",
      ],
      renamedDestructured: [`import {Effect} from "effect";\nconst {${method}: tp} = Effect;`, "tp"],
      moduleAlias: [`import {Effect} from "effect";\nconst E = Effect;`, `E.${method}`],
      computedBridgeKeys: [
        'import {Effect} from "effect";\ndeclare const k: "tryPromise" | "promise";',
        `(Effect[k] as typeof Effect.${method})`,
      ],
      unresolvedKey: [
        `import {Effect} from "effect";\ndeclare const k: "${method}" | "sync";`,
        `(Effect[k] as typeof Effect.${method})`,
      ],
      bare: ["", ""],
    } as const
  )[spelling];
  const inBridge = spelling !== "bare";
  // Installed workers-types: WorkerStub -> Fetcher<T> -> Rpc.Provider<T> ->
  // MethodOrProperty<V> -> Result<Awaited<R>> turns Promise<unknown> into never.
  const before = [
    ...setup.split("\n"),
    `type Calls = Rpc.WorkerEntrypointBranded & {describe${suffix}(): Promise<unknown>};`,
    "declare const worker: WorkerStub;",
    "const rpc = worker.getEntrypoint<Calls>();",
    ...(inBridge
      ? [
          "// oxlint-disable-next-line fabrika/no-promises -- edge: the RPC call enters Effect",
          `export const edge = ${callee}(${method === "tryPromise" ? "{" : ""}`,
          ...(method === "tryPromise" ? ["  try: () =>"] : ["  () =>"]),
        ]
      : []),
    ...Array.from({ length: gap }, () => ""),
    ...(marked ? ["// oxlint-disable-next-line fabrika/no-promises -- edge: Worker RPC returns a Promise"] : []),
  ];
  return {
    file: "next/rpc.ts",
    line: before.length + 1,
    source: [
      ...before,
      `    rpc.describe${suffix}()${inBridge ? (method === "tryPromise" ? "," : "") : ";"}`,
      ...(inBridge ? (method === "tryPromise" ? ['  catch: () => new Error("rpc"),', "});"] : [");"]) : []),
    ].join("\n"),
  };
};

describe("promise-types", () => {
  it("refuses an unmarked mapped Workers RPC call in every resolved Effect bridge spelling", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,8}$/),
        fc.constantFrom("tryPromise", "promise"),
        fc.nat({ max: 8 }),
        fc.boolean(),
        fc.constantFrom(...bridgeSpellings),
        (suffix, method, gap, marked, spelling) => {
          const { file, source, line } = rpcSource(suffix, method, gap, marked, spelling);
          expect(typed({ [file]: source }, true).map((f) => ({ file: f.file, line: f.line }))).toEqual(
            marked ? [] : [{ file, line }],
          );
        },
      ),
      {
        seed: 119120,
        // Its examples are all twelve runs, so a pull request runs them all too.
        numRuns: 12,
        // P12 review 7: the marker covered Effect.tryPromise, but not rpc.describe below it.
        // P12 review 8: renamed imports and computed access hid the same RPC call.
        // P12 review 9: wrappers and local aliases bypassed bridge recognition.
        examples: (["tryPromise", "promise"] as const).flatMap((method) =>
          bridgeSpellings.map((spelling): [string, typeof method, number, boolean, typeof spelling] => [
            "",
            method,
            0,
            false,
            spelling,
          ]),
        ),
      },
    );
  });
  it.each(["tryPromise", "promise"] as const)(
    "pinned: P12 cannot identify Effect.%s through a key that may select sync",
    (method) => {
      // A cast does not prove which declaration a runtime key selects. Guessing would
      // flag synchronous calls too, so the unresolved RPC return is missed here.
      const { file, source } = rpcSource("", method, 0, false, "unresolvedKey");
      expect(typed({ [file]: source }, true)).toEqual([]);
    },
  );
  it("pinned: P12 cannot distinguish a bare never-returning RPC from a synchronous throw", () => {
    // The installed Workers mapping erases Promise<unknown> to never. Without an
    // Effect bridge, catching it also flags the real synchronous throw helpers.
    const { file, source } = rpcSource("", "promise", 0, false, "bare");
    expect(typed({ [file]: source }, true)).toEqual([]);
  });
  it("leaves declared never throw helpers outside a Promise bridge alone", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,8}$/), (suffix) => {
        const file = "next/throw.ts";
        const source = [`declare function fail${suffix}(): never;`, `fail${suffix}();`].join("\n");
        expect(typed({ [file]: source })).toEqual([]);
      }),
      { seed: 119120, numRuns: 12 },
    );
  });
  it("leaves any, unknown, generic and unresolved calls outside Promise bridges alone", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,8}$/), (suffix) => {
        const file = "next/sync.ts";
        expect(
          typed({
            [file]: [
              `declare function any${suffix}(): any;`,
              `declare function unknown${suffix}(): unknown;`,
              `declare function identity${suffix}<A>(value: A): A;`,
              `any${suffix}(); unknown${suffix}();`,
              `export function generic${suffix}<A>(value: A) { return identity${suffix}(value); }`,
              "// @ts-ignore -- plant: an unresolved name gives the checker an error type",
              `missing${suffix}();`,
            ].join("\n"),
          }),
        ).toEqual([]);
      }),
      { seed: 119120, numRuns: 12 },
    );
  });
  it("recognizes Effect's bridge declarations rather than another module with the same names", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,8}$/),
        fc.constantFrom("tryPromise", "promise"),
        fc.constantFrom(...bridgeSpellings),
        (suffix, method, spelling) => {
          const { file, source } = rpcSource(suffix, method, 0, false, spelling);
          expect(
            typed(
              {
                [file]: source
                  .replaceAll('"effect/Effect"', '"./lookalike-functions"')
                  .replaceAll('"effect"', '"./lookalike"'),
                "next/lookalike.ts": 'export * as Effect from "./lookalike-functions";',
                "next/lookalike-functions.ts": [
                  "export declare const tryPromise: <A>(options: {try: () => PromiseLike<A>; catch: () => Error}) => number;",
                  "export declare const promise: <A>(fn: () => PromiseLike<A>) => number;",
                ].join("\n"),
              },
              true,
            ),
          ).toEqual([]);
        },
      ),
      { seed: 119120, numRuns: 12 },
    );
  });
  it("The edge comment covers the next line and only that line", () => {
    fc.assert(
      fc.property(markedEdge, fc.nat({ max: 8 }), ([method, rule, indent], gap) => {
        const file = "next/wrapped.ts";
        expect(
          typed({ [file]: wrappedEdge(method, rule, indent, gap) }).map((f) => ({
            file: f.file,
            line: f.line,
          })),
        ).toEqual([{ file, line: (method === "runPromise" ? 11 : 10) + gap }]);
      }),
      {
        seed: 119120,
        numRuns: 12,
        // P12 wrapped-edge bug: a statement-wide marker hid later Promise calls.
        examples: [[["tryPromise", "fabrika/no-promises", "\t"], 0]],
      },
    );
  });
  it("refuses the unmarked statement immediately after a wrapped marked statement", () => {
    fc.assert(
      fc.property(markedEdge, fc.boolean(), ([method, rule, indent], sameLine) => {
        const file = "next/wrapped.ts";
        const before = wrappedEdge(method, rule, indent);
        const line = before.split("\n").length + (sameLine ? 0 : 1);
        const source = `${before}${sameLine ? " " : "\n"}platform.read();`;
        expect(typed({ [file]: source }).map((f) => ({ file: f.file, line: f.line }))).toEqual([
          { file, line: method === "runPromise" ? 11 : 10 },
          { file, line },
        ]);
      }),
      { seed: 119120, numRuns: 12 },
    );
  });
  it("pinned: the P12 storage-method gap refuses unmarked returned Promises", () => {
    const file = "next/apps/fabrika/src/storage-method.ts";
    const findings = typed({
      [file]: [
        "declare const storage: {put(key: string, value: unknown): Promise<void>};",
        "export class Process {",
        '  configure(value: unknown) { return storage.put("descriptor", value); }',
        "}",
      ].join("\n"),
    });
    expect(findings.filter((f) => f.file === file).map((f) => f.line)).toContain(3);
  });
  it("refuses Promise values, inferred returns, imported aliases and thunks outside one marked line", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,8}$/), (suffix) => {
        const file = `next/case-${suffix}.ts`;
        const findings = typed({
          "next/binding.ts":
            "export type Later<T> = Promise<T>; export declare const platform: {read(): Later<number>};",
          [file]: [
            'import {platform, type Later} from "./binding";',
            "declare const p: Later<number>;",
            "const identity = (value: Later<number>) => value;",
            "const thunk = (send: () => Later<number>) => send;",
            "const inferred = () => platform.read();",
            "const take = <A>(send: () => Promise<A>) => send;",
            "identity(p);",
            "take(() => platform.read());",
            "thunk(platform.read);",
            "// oxlint-disable-next-line fabrika/no-promises -- edge: platform read enters Effect",
            "const edge = () => platform.read();",
            "const afterEdge = () => platform.read();",
            "// oxlint-disable-next-line fabrika/no-promises -- edge: covers only the next line",
            "const twoLines = () => {",
            "  return platform.read();",
            "};",
            "void [inferred, edge, afterEdge, twoLines];",
          ].join("\n"),
          "next/allowed.ts":
            "export const read = (n: number) => n; export const f = () => read(1); export const domain = () => ({then: 1});",
          "next/runner.ts": [
            "declare const runner: {runPromise(n: number): Promise<number>};",
            "// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: platform method returns a Promise",
            "export const run = () => runner.runPromise(1);",
          ].join("\n"),
          "next/allowed.test.ts": "declare const p: Promise<number>; export const f = () => p;",
          "next/helper.test-support.ts": "declare const p: Promise<number>; export const f = () => p;",
          "packages/today.ts": "declare const p: Promise<number>; export const f = () => p;",
        });
        expect(findings.filter((f) => f.file === file).map((f) => f.line)).toEqual([3, 4, 5, 6, 7, 8, 9, 12, 15]);
        expect(findings.filter((f) => f.file !== file)).toEqual([]);
      }),
      { seed: 119120, numRuns: 20 },
    );
  });
});

// P12, the command's `fabrika(secret-types)` check. This was the exam's
// next/apps/fabrika/src/exam/secret-types.integration.test.ts until 0591 made it part of this command;
// its real-tree law is the command's run in `pnpm lint`. Generated plants prove the checker sees the
// secret read through a renamed import and a renamed wrapper. Plant: drop the `~effect/Redacted` test,
// and the three wrapped reads fire too.
describe("secret reads enter Redacted at their source", () => {
  it("[secrets] source type plants catch plain entropy, Authorization and binding reads, including renamed wrappers", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/), (suffix) => {
        const folder = realpathSync(mkdtempSync(join(tmpdir(), "p12-sec-types-")));
        const api = new API({ cwd: folder });

        try {
          const file = "next/source.ts",
            path = join(folder, file),
            config = join(folder, "tsconfig.json");
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(
            join(folder, "crypto.d.ts"),
            'declare module "node:crypto" {export function randomBytes(n: number): {toString(encoding: string): string};}',
          );
          const prelude = `import {randomBytes as bytes${suffix}} from "node:crypto";\ninterface Redacted {readonly "~effect/Redacted": never}\ndeclare function wrap${suffix}(value: unknown): Redacted;\ndeclare const request: {headers: {get(name: string): string | null}};\ndeclare const ctx: {props: {token: string}};\n`;
          const lines = [
            `export const entropy = bytes${suffix}(32).toString("base64url");`,
            'export const header = request.headers.get("authorization");',
            "export const binding = ctx.props.token;",
            `export const safeEntropy = wrap${suffix}(bytes${suffix}(32).toString("base64url"));`,
            `export const safeHeader = wrap${suffix}(request.headers.get("authorization"));`,
            `export const safeBinding = wrap${suffix}(ctx.props.token);`,
          ];
          writeFileSync(path, prelude + lines.join("\n"));
          writeFileSync(
            config,
            JSON.stringify({ compilerOptions: { strict: true, target: "ES2023", types: [] }, include: ["**/*.ts"] }),
          );
          const snapshot = api.updateSnapshot({ openProjects: [config] });

          try {
            const project = snapshot.getProject(config)!;
            expect(project.program.getSemanticDiagnostics()).toEqual([]);
            expect(checkSecretTypes(project, folder, paths).map((f) => f.line)).toEqual([6, 7, 8]);
          } finally {
            snapshot.dispose();
          }
        } finally {
          api.close();
          rmSync(folder, { recursive: true, force: true });
        }
      }),
      // The exam's full-run count: this folder's tests run only in the full run (0590).
      { seed: 119120, numRuns: 5 },
    );
  });
});

// e2e typecheck, the command's `fabrika(tsconfig-scope)` check: every TypeScript file of a next/
// package is in the program its `typecheck` script checks. The app's tsconfig once named its files
// by hand, and `e2e/` and `e2e.ts` were never on the list, so 19 type errors stood there unseen from
// 2026-11-06 (0524: no list lets broken code pass). This was the exam's
// next/apps/fabrika/src/exam/tsconfig-scope.integration.test.ts until 0591 made it part of this
// command; its real-tree law is the command's run in `pnpm lint`. Each law plants a tree in a temp
// folder and opens the projects the command opens there. Plant: open one package fewer, and every
// planted file is reported.
describe("every TypeScript file of a next/ package is in its program", () => {
  const TYPECHECK = "tsc --noEmit -p .";
  const APP = "next/apps/fabrika";
  const ROOT = realpathSync(join(import.meta.dirname, ".."));
  const word = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/);

  /** Plants `files` in a temp folder, opens the command's projects there, and answers `use`'s value. */
  const scoped = <A>(
    files: Readonly<Record<string, string>>,
    links: Readonly<Record<string, string>>,
    use: (at: string, snapshot: Snapshot, gaps: (tracked: ReadonlyArray<string>) => ReadonlyArray<string>) => A,
  ): Promise<A> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const at = realpathSync(mkdtempSync(join(tmpdir(), "tsconfig-scope-")));

        try {
          for (const [file, text] of Object.entries(files)) {
            mkdirSync(dirname(join(at, file)), { recursive: true });
            writeFileSync(join(at, file), text);
          }

          for (const [file, target] of Object.entries(links)) {
            mkdirSync(dirname(join(at, file)), { recursive: true });
            symlinkSync(target, join(at, file));
          }

          const configs = yield* typedProjects(at);
          const packages = yield* nextPackages(at);
          const api = new API({ cwd: at });

          try {
            const snapshot = api.updateSnapshot({ openProjects: [...configs] });

            try {
              return use(at, snapshot, (tracked) =>
                scopeGaps(snapshot, at, packages, tracked, paths).map((g) => `${g.file} ${g.reason}`),
              );
            } finally {
              snapshot.dispose();
            }
          } finally {
            api.close();
          }
        } finally {
          rmSync(at, { recursive: true, force: true });
        }
      }).pipe(Effect.provide(NodeServices.layer)),
    );

  const Planted = fc.record({
    folder: fc.oneof(
      fc.constantFrom("e2e", "e2e/node", ""),
      word.map((w) => `e2e/${w}`),
    ),
    name: word,
    // 0536's names too: the e2e files are `*.integration.test.ts` and `*.visual.test.ts` now.
    suffix: fc.constantFrom(
      ".test.ts",
      ".test-support.ts",
      ".laws.test.ts",
      ".integration.test.ts",
      ".visual.test.ts",
      ".laws.visual.test.ts",
      ".ts",
    ),
    word,
  });

  it("pinned: e2e typecheck gap, a planted type error in any new TypeScript file of next/apps/fabrika is in the program the command checks", async () => {
    // The app's real tsconfig, base config and manifest, at their repo paths, with the root's and the
    // app's node_modules linked, so types and Effect's plugin resolve as on the tree.
    await fc.assert(
      fc.asyncProperty(Planted, async (planted) => {
        const file = `${APP}/${planted.folder === "" ? "" : `${planted.folder}/`}${planted.name}${planted.suffix}`;
        const text = `export const planted: number = "${planted.word}";\n`;
        const { gaps, diagnostics } = await scoped(
          {
            "tsconfig.base.json": readFileSync(join(ROOT, "tsconfig.base.json"), "utf8"),
            [`${APP}/tsconfig.json`]: readFileSync(join(ROOT, APP, "tsconfig.json"), "utf8"),
            [`${APP}/package.json`]: readFileSync(join(ROOT, APP, "package.json"), "utf8"),
            [file]: text,
          },
          { node_modules: join(ROOT, "node_modules"), [`${APP}/node_modules`]: join(ROOT, APP, "node_modules") },
          (at, snapshot, gapsOf) => {
            const program = snapshot.getProject(join(at, APP, "tsconfig.json"))?.program;
            const full = join(at, file);
            return {
              gaps: gapsOf([file]),
              diagnostics: [...(program?.getSyntacticDiagnostics() ?? []), ...(program?.getSemanticDiagnostics() ?? [])]
                .filter((d) => d.fileName === full)
                .map((d) => ({ code: d.code, line: text.slice(0, d.pos).split("\n").length })),
            };
          },
        );
        expect(gaps).toEqual([]);
        expect(diagnostics).toEqual([{ code: 2322, line: 1 }]);
      }),
      {
        seed: 119120,
        numRuns: 5,
        // The bug's file: e2e/node/P19Launchd.test-support.ts sent SIGTERM unseen until this law.
        examples: [[{ folder: "e2e/node", name: "P19Launchd", suffix: ".test-support.ts", word: "milk" }]],
      },
    );
  });

  const segment = /^[a-z][a-z0-9]{0,6}$/;

  const Scoped = fc.record({
    name: fc.stringMatching(segment),
    files: fc.uniqueArray(
      fc
        .record({
          under: fc.boolean(),
          dirs: fc.array(fc.stringMatching(segment), { maxLength: 2 }),
          name: fc.stringMatching(segment),
          ext: fc.constantFrom(".ts", ".tsx"),
        })
        .map(({ under, dirs, name, ext }) => [...(under ? ["src"] : []), ...dirs, `${name}${ext}`].join("/")),
      { minLength: 1, maxLength: 12 },
    ),
  });

  it("names each generated file left out of a package's include, and none it holds", async () => {
    await fc.assert(
      fc.asyncProperty(Scoped, async ({ name, files }) => {
        const pkg = `next/programs/${name}`;
        const tracked = files.map((f) => `${pkg}/${f}`);
        const gaps = await scoped(
          {
            [`${pkg}/package.json`]: JSON.stringify({ scripts: { typecheck: TYPECHECK } }),
            [`${pkg}/tsconfig.json`]: JSON.stringify({
              compilerOptions: { strict: true, types: [] },
              include: ["src"],
            }),
            ...Object.fromEntries(tracked.map((f) => [f, "export {};\n"])),
          },
          {},
          (_at, _snapshot, gapsOf) => gapsOf(tracked),
        );
        expect([...gaps].sort()).toEqual(
          tracked
            .filter((f) => !f.startsWith(`${pkg}/src/`))
            .map((f) => `${f} outside`)
            .sort(),
        );
      }),
      { seed: 119120, numRuns: 10 },
    );
  });

  it("refuses a package whose typecheck is not the one script, and a file in no package", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(TYPECHECK, "tsc --noEmit", "tsgo --noEmit -p .", undefined),
        word,
        async (script, stray) => {
          const pkg = "next/packages/held";
          const tracked = [`${pkg}/src/index.ts`, `next/${stray}.ts`];
          const gaps = await scoped(
            {
              [`${pkg}/package.json`]: JSON.stringify(script === undefined ? {} : { scripts: { typecheck: script } }),
              [`${pkg}/tsconfig.json`]: JSON.stringify({
                compilerOptions: { strict: true, types: [] },
                include: ["src"],
              }),
              [`${pkg}/src/index.ts`]: "export {};\n",
              [`next/${stray}.ts`]: "export {};\n",
            },
            {},
            (_at, _snapshot, gapsOf) => gapsOf(tracked),
          );
          expect([...gaps].sort()).toEqual(
            [...(script === TYPECHECK ? [] : [`${pkg}/package.json script`]), `next/${stray}.ts stray`].sort(),
          );
        },
      ),
      { seed: 119120, numRuns: 8 },
    );
  });
});
