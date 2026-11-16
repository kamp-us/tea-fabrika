// L12, next/. The lint rule owns contract shape; behavior lives in the desktop laws.
import { join } from "node:path";
import { it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { serviceContract } from "./service-contract.ts";

/** A promise the test waits on rejected: the test's own failure, with the rejection as its cause. */
class TestFailure extends Schema.TaggedError<TestFailure, { readonly brand: unique symbol }>()("TestFailure", {
  cause: Schema.Unknown,
}) {}

/** Waits on a promise inside the test's Effect, as `Effect.tryPromise` in its object form. */
const promised = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => TestFailure.make({ cause }) });

RuleTester.describe = (_name, fn) => fn();

RuleTester.it = (_name, fn) => fn();

const tester = new RuleTester({ cwd: join(import.meta.dirname, "..") });

const top = "next/packages/libfabrika/src/desktop/";

const headers = 'import { Context as C, Schema as S, Effect, Layer } from "effect";\n';

const shape =
  'export class BrainService extends C.Service<BrainService, { readonly stop: Effect.Effect<void> }>()("@kampus/libfabrika/desktop/BrainService")';

it("L12 contract bodies refuse running code under renamed imports and computed members", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("BrainService", "BrainControl", "BrainProbe"),
      fc.constantFrom(
        "static layer = Layer.succeed(this, {});",
        'static ["layer"] = Layer.effect(this, Effect.succeed({}));',
        "static layer() { return Layer.succeed(this, {}); }",
        "stop() { return Effect.void; }",
      ),
      (name, member) =>
        tester.run("service-contract", serviceContract, {
          valid: [{ filename: `${top}${name}.ts`, code: `${headers}${shape} {}\nexport const Status = S.String;` }],
          invalid: [
            {
              filename: `${top}${name}.ts`,
              code: `${headers}${shape} { ${member} }`,
              errors: [{ message: /only its written contract/ }],
            },
          ],
        }),
    ),
    { seed: 119120, numRuns: 100 },
  );
});

it("vector: schemas and errors pass; platform imports and running code fail", () => {
  // Fixed syntax forms are the parser's protocol, including constructs absent from generated members.
  const good = `${headers}export interface Shape { readonly stop: Effect.Effect<void> }\nexport class Failure extends S.TaggedError<Failure>()("Failure", { cause: S.Defect() }) {}\n${shape} {}`;
  tester.run("service-contract", serviceContract, {
    valid: [
      { filename: `${top}BrainService.ts`, code: good },
      { filename: `${top}BrainServiceManaged.ts`, code: `${headers}export const layer = Layer.empty;` },
    ],
    invalid: Arr.map(
      [
        'import { app } from "electron";',
        'import type { BrowserWindow } from "electron";',
        'import { DatabaseSync } from "node:sqlite";',
        'export { layer } from "./BrainServiceManaged.ts";',
        "export const layer = Layer.empty;",
        "export const stop = () => Effect.void;",
        "Effect.runSync(Effect.void);",
      ],
      (code) => ({
        filename: `${top}BrainService.ts`,
        code: `${headers}${code}`,
        errors: [{ message: /only its written contract/ }],
      }),
    ),
  });
});

it.live("scenario: L12 the repo config rejects a static Layer at every new contract path", () =>
  Effect.gen(function* () {
    // The config, not RuleTester, must activate this rule at each approved contract.
    const paths = Arr.map(["BrainService", "BrainControl", "BrainProbe"], (name) => `${top}${name}.ts`);

    const result = yield* promised(() =>
      plant(Rec.fromEntries(Arr.map(paths, (file) => [file, `${headers}${shape} { static layer = Layer.empty; }\n`]))),
    );

    for (const file of paths) {
      expect(result("fabrika(service-contract)", file)).toEqual([2]);
    }
  }),
);

it("L12 every desktop file, including test support, refuses platform imports and types", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("BrainServiceManaged.ts", "BrainLife.laws.test.ts", "BrainControl.test-support.ts"),
      fc.constantFrom(
        'import { readFile } from "node:fs";',
        'import type { BrowserWindow } from "electron";',
        'import { Root } from "@kampus/tuval";',
        "export type Timer = NodeJS.Timeout;",
      ),
      (name, code) => {
        tester.run("service-contract", serviceContract, {
          valid: [],
          invalid: [{ filename: `${top}${name}`, code, errors: [{ message: /only its written contract/ }] }],
        });
      },
    ),
    { seed: 119120, numRuns: 100 },
  );
});
