import { join } from "node:path";
import { it } from "@effect/vitest";
// Each generated case runs in process through oxlint's RuleTester, at its next/ path; one oxlint run
// over every case's files then proves the repo's own .oxlintrc.json wires the rule at those paths.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { noNodeImports } from "./no-node-imports.ts";

/** A promise the test waits on rejected: the test's own failure, with the rejection as its cause. */
class TestFailure extends Schema.TaggedError<TestFailure>()("TestFailure", { cause: Schema.Unknown }) {}

/** Waits on a promise inside the test's Effect, as `Effect.tryPromise` in its object form. */
const promised = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new TestFailure({ cause }) });

const CODE = "fabrika(no-node-imports)";

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();

RuleTester.it = (_name, fn) => fn();

// From the top of the repo, so the rule reads each path as oxlint gives it there.
const tester = new RuleTester({ cwd: join(import.meta.dirname, "..") });

/** One case: a file at a path from the top of the repo, and the lines the rule fires on. */
type Case = { readonly text: string; readonly lines: readonly number[] };

/** In process, RuleTester: the file fires on exactly these lines, or on none. */
const check = (filename: string, { text: code, lines }: Case) => {
  tester.run("no-node-imports", noNodeImports, {
    valid: lines.length === 0 ? [{ code, filename }] : [],
    invalid:
      lines.length === 0
        ? []
        : [{ code, filename, errors: Arr.map(lines, (line) => ({ line, message: /Native imports in next\/ need/ })) }],
  });
};

/** One oxlint run over every case's files, through the repo's own config. */
const cli = Effect.fnUntraced(function* (cases: ReadonlyMap<string, Case>) {
  const result = yield* promised(() => plant(Rec.fromEntries(Arr.map([...cases], ([path, { text }]) => [path, text]))));
  expect(Rec.fromEntries(Arr.map([...cases.keys()], (path) => [path, result(CODE, path)]))).toEqual(
    Rec.fromEntries(Arr.map([...cases], ([path, { lines }]) => [path, lines])),
  );

  return result;
});

/** The path the one oxlint run reads run `n`'s file at: its name gets the number, its folder stays. */
const numbered = (path: string, n: number) => path.replace(/native/, `native${n}`);

it.live("every native import form needs a nonempty reason on its own line, in product and exam code", () =>
  Effect.gen(function* () {
    let n = 0;
    const cases = new Map<string, Case>();
    fc.assert(
      fc.property(
        fc.constantFrom(
          "fs",
          "fs/promises",
          "path",
          "child_process",
          "util",
          "os",
          "crypto",
          "sqlite",
          "url",
          "stream/web",
          "test",
          "module",
        ),
        fc.boolean(),
        fc.uuid(),
        (name, prefix, reason) => {
          const module = `${prefix ? "node:" : ""}${name}`;
          // Node's prefix-only modules are not bare builtins.
          const native = prefix || !["test", "sqlite"].includes(name);
          const from = JSON.stringify(module);

          const forms = [
            `import * as a from ${from};`,
            `import a from ${from};`,
            `import {x as a} from ${from};`,
            `import ${from};`,
            `import type {X} from ${from};`,
            `import {type X} from ${from};`,
            `export * from ${from};`,
            `export {x} from ${from};`,
            `export type {X} from ${from};`,
            `const a = import(${from});`,
            `const a = import(\`${module}\`);`,
            `const a = require(${from});`,
            `const a = require(\`${module}\`);`,
            `const a = module.require(${from});`,
            `import a = require(${from});`,
            `type A = import(${from}).X;`,
          ];

          const paths = [
            "next/packages/libfabrika/src/native.ts",
            "next/apps/fabrika/src/exam/native.ts",
            "next/native.d.ts",
            "next/native.test.ts",
            "next/native.test-support.ts",
            "next/e2e/native.ts",
            "packages/fabrika/src/native.ts",
          ];

          const lines = Arr.flatMap(forms, (form, i) =>
            Arr.map(
              [
                "",
                ` // edge: ${reason}`,
                " // edge:   ",
                "before",
                ` /* edge: ${reason} */`,
                ` // not edge: ${reason}`,
              ],
              (mark, j) => {
                const unique = form.replace(/\b(a|A|X|x)\b/g, (name) => `${name}${i}_${j}`);

                return mark === "before" ? `// edge: ${reason}\n${unique}` : unique + mark;
              },
            ),
          );

          const body = Arr.join(lines, "\n");
          const expected: number[] = [];
          let line = 1;

          for (const _ of forms) {
            expected.push(line, line + 2, line + 4, line + 5, line + 6);
            line += 7;
          }

          for (const [i, path] of paths.entries()) {
            const one = { text: body, lines: native && i < 3 ? expected : [] };
            check(path, one);
            cases.set(numbered(path, n), one);
          }

          n++;
        },
      ),
      { seed: 119120, numRuns: 12 },
    );
    yield* cli(cases);
  }),
);

it.live("multiline imports use the module string's line; strings and neighboring marks grant nothing", () =>
  Effect.gen(function* () {
    let n = 0;
    const cases = new Map<string, Case>();
    fc.assert(
      fc.property(fc.uuid(), (reason) => {
        const path = "next/apps/fabrika/src/exam/native.ts";
        const product = "next/packages/libfabrika/src/native.ts";

        const exam = {
          text: Arr.join(
            [
              `import {\n readFile\n} from "node:fs"; // edge: ${reason}`,
              `import { // edge: ${reason}\n writeFile\n} from "node:fs";`,
              `const fake = "// edge: ${reason}"; const a = require("node:fs");`,
              'import {Effect} from "effect";',
              'import a from "some-package";',
              'import b from "./fs.ts";',
            ],
            "\n",
          ),
          lines: [6, 7],
        };

        const blessed = { text: `import {readFile} from "node:fs"; // edge: ${reason}`, lines: [] };
        check(path, exam);
        check(product, blessed);
        cases.set(numbered(path, n), exam);
        cases.set(numbered(product, n), blessed);
        n++;
      }),
      { seed: 119120, numRuns: 5 },
    );
    yield* cli(cases);
  }),
);

// L4 of the trusted-rules swap (0573): `fabrika/no-node-filesystem` is gone, so this rule holds every
// form it held. Its 8 module names and 10 import forms, at its paths: fired in product code, and now
// at an `exam/` path and a `.d.ts` too, which the old rule skipped; never in a test, a test-support
// file or `e2e/`; and a line with `// edge: <why>` on it passes. Every run checks all 8 names: a draw
// of one name per run left `fs` and `node:path/posix` out at this seed (fast-check counts examples
// inside numRuns).
// Plant: skip only the bare `fs` specifier in no-node-imports.ts, and the fs lines are not refused.
const FILESYSTEM = [
  "node:fs",
  "node:fs/promises",
  "fs",
  "fs/promises",
  "node:path",
  "path",
  "node:path/posix",
  "node:path/win32",
] as const;

it.live("holds every filesystem import form the retired no-node-filesystem held, at its paths", () =>
  Effect.gen(function* () {
    let n = 0;
    const cases = new Map<string, Case>();
    const reached = new Set<string>();
    fc.assert(
      fc.property(fc.uuid(), (reason) => {
        for (const module of FILESYSTEM) {
          const from = JSON.stringify(module);

          const forms = [
            `import * as native0 from ${from};`,
            `import native1 from ${from};`,
            `import {readFile as read} from ${from};`,
            `import ${from};`,
            `export * from ${from};`,
            `export {readFile as read2} from ${from};`,
            `const native6 = await import(${from});`,
            `const native7 = require(${from});`,
            `import native8 = require(${from});`,
            `const native9 = import(\`${module}\`);`,
          ];

          const all = forms.map((_, i) => i + 1);

          const paths = [
            ["next/packages/libfabrika/src/native.ts", all],
            ["next/apps/fabrika/src/exam/native.ts", all],
            ["next/packages/libfabrika/src/native.d.ts", all],
            ["next/packages/libfabrika/src/native.test.ts", []],
            ["next/packages/libfabrika/src/native.test-support.ts", []],
            ["next/apps/fabrika/e2e/native.ts", []],
          ] as const;

          const edged = { text: forms.map((form) => `${form} // edge: ${reason}`).join("\n"), lines: [] };

          for (const [path, lines] of paths) {
            const one = { text: forms.join("\n"), lines };
            check(path, one);
            cases.set(numbered(path, n), one);
          }

          check("next/packages/libfabrika/src/native.ts", edged);
          cases.set(numbered("next/packages/libfabrika/src/native-edged.ts", n), edged);
          reached.add(module);
          n++;
        }
      }),
      { seed: 119120, numRuns: 8 },
    );
    // Coverage: every name the old rule held was checked.
    expect([...reached].sort()).toEqual([...FILESYSTEM].sort());
    yield* cli(cases);
  }),
);
