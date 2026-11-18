// Law Q12 of docs/plan/quests/kalfa-quality-stryker-PLAN.md: the repo's plant catalog (plants.ts) holds at
// head. Each plant's file holds its target exactly once, found by Stryker's own instrumenter on the
// file's text (the same call the plant run makes, with no Stryker run after it), and its law file holds
// a test whose suite chain and title are the plant's `law.name`. A rename of a variable or a law breaks
// the catalog here, loudly, on every pull request that reaches it, instead of on the first plant run.
//
// scenario: the repo's own catalog at head. It is data about the repo, so no generated input stands in
// for it; the five plants are the five cases, one test each.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Catalog } from "@kalfa/quality/stryker";
import { Mutants } from "@kalfa/quality/stryker/Mutants";
import { layer } from "@kalfa/quality/stryker/node/MutantsStryker";
import * as Target from "@kalfa/quality/stryker/Target";
import { Effect, Schema } from "effect";
import { type CallExpression, type Expression, parseSync, Visitor } from "oxc-parser";
import { describe, expect, it } from "vitest";
import catalog from "./plants.ts";

const ROOT = join(import.meta.dirname, "../..");

/** The identifier at the root of `it.effect.prop`, `describe.skipIf(x)`, or plain `it`. */
const rootOf = (node: Expression): string | undefined => {
  switch (node.type) {
    case "Identifier":
      return node.name;
    case "MemberExpression":
      return rootOf(node.object);
    case "CallExpression":
      return rootOf(node.callee);
    default:
      return undefined;
  }
};

/** The title of a call whose first argument is a plain string, or `undefined`. */
const titleOf = (call: CallExpression): string | undefined => {
  const first = call.arguments[0];

  if (first?.type === "Literal" && typeof first.value === "string") {
    return first.value;
  }

  return first?.type === "TemplateLiteral" && first.quasis.length === 1
    ? (first.quasis[0]?.value.cooked ?? undefined)
    : undefined;
};

/** Every test of a file, named as Stryker 10.1.1 names a vitest test: the suite chain and the title joined by " > ". */
const testNames = (path: string): ReadonlyArray<string> => {
  const found: Array<string> = [];
  const chain: Array<string> = [];
  const suite = (call: CallExpression) => rootOf(call.callee) === "describe" && titleOf(call) !== undefined;

  new Visitor({
    CallExpression(call) {
      const title = titleOf(call);
      const root = rootOf(call.callee);

      if (title === undefined) {
        return;
      }

      if (root === "describe") {
        chain.push(title);
      } else if (root === "it" || root === "test") {
        found.push([...chain, title].join(" > "));
      }
    },
    "CallExpression:exit"(call) {
      if (suite(call)) {
        chain.pop();
      }
    },
  }).visit(parseSync(path, readFileSync(join(ROOT, path), "utf8")).program);

  return found;
};

/** Every mutant Stryker's instrumenter makes on the file's text. */
const mutantsOf = (file: string, text: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Mutants).make(file, text);
    }).pipe(Effect.provide(layer({ root: ROOT, nice: 0 })), Effect.provide(NodeServices.layer)),
  );

describe("the plant catalog at head (decision 0600)", () => {
  it("scenario: the catalog decodes, and its names are unique", () => {
    expect(Schema.decodeUnknownSync(Catalog)(catalog)).toHaveLength(catalog.length);
    expect(new Set(catalog.map(({ name }) => name)).size).toBe(catalog.length);
    expect(catalog.map(({ name }) => name)).toEqual([
      "checklist-pid",
      "host-pin",
      "host-requested-pin",
      "host-pnpm-path",
      "host-env-order",
    ]);
  });

  // Plant: change host-pnpm-path's `original` to `pnpm !== null`.
  for (const plant of catalog) {
    it(`scenario: ${plant.name} has its target exactly once, and its law exists by that name`, async () => {
      const text = readFileSync(join(ROOT, plant.file), "utf8");
      const found = Target.find(text, await mutantsOf(plant.file, text), plant);

      expect(found._tag === "Success" ? "found" : found.failure.reason).toBe("found");
      expect(testNames(plant.law.file)).toContain(plant.law.name);
    });
  }
});
