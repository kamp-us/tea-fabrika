// Law Q12 of docs/plan/quests/kalfa-quality-stryker-PLAN.md: the repo's plant catalog (plants.ts) holds at
// head. Each plant's file holds its target exactly once, found by Stryker's own instrumenter on the
// file's text (the same call the plant run makes, with no Stryker run after it), and its law file holds
// a test whose suite chain and title are the plant's `law.name`. A rename of a variable or a law breaks
// the catalog here, loudly, on every pull request that reaches it, instead of on the first plant run.
//
// scenario: the repo's own catalog at head. It is data about the repo, so no generated input stands in
// for it; the five plants are the five cases, one test each.
//
// The last law is the edge's host guard (decision 0594), which nothing else runs under Stryker: a
// property over command lines, in every order and spelling effect/cli accepts, that no run starts a
// law the host may not start.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Catalog } from "@kalfa/quality/stryker";
import { Mutants } from "@kalfa/quality/stryker/Mutants";
import { layer } from "@kalfa/quality/stryker/node/MutantsStryker";
import * as Target from "@kalfa/quality/stryker/Target";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, Result, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { type CallExpression, type Expression, parseSync, Visitor } from "oxc-parser";
import { hostFiles } from "../../vitest.hostrun.ts";
import catalog, { run } from "./plants.ts";

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

      expect(Result.isSuccess(found) ? "found" : found.failure.reason).toBe("found");
      expect(testNames(plant.law.file)).toContain(plant.law.name);
    });
  }
});

// The guard law's world. Nothing here starts a real process: the spawner is a stand-in that counts.
// The first two are laws the guard refuses off a CI or a box: one by its `.integration.` name, one because its
// own code signals a process (0594). The third is a plain law: the guard lets it run anywhere, and no plant names it.
const LAWS: ReadonlyArray<{ readonly plant: string | undefined; readonly law: string }> = [
  { plant: "checklist-pid", law: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts" },
  { plant: "host-pin", law: ".agents/skills/lead/scripts/flow/host.test.ts" },
  { plant: undefined, law: "kalfa/quality/src/stryker/Target.test.ts" },
];

const PRODUCT = ".agents/skills/lead/scripts/flow/host.ts";

/** The settings every run here shares: in place, so no refusal for two packages comes before the guard. */
const SETTINGS = { KALFA_QUALITY_STRYKER_IN_PLACE: "true" };

/** A machine that may start a host-only law, and two that may not: a laptop, and a Mac with a box's marker. */
const ALLOWED = [
  { env: { ...SETTINGS, CI: "true" }, platform: "linux" },
  { env: { ...SETTINGS, CLAUDE_CODE_REMOTE: "true" }, platform: "linux" },
] as const;

const AWAY = [
  { env: SETTINGS, platform: "linux" },
  { env: { ...SETTINGS, CLAUDE_CODE_REMOTE: "true" }, platform: "darwin" },
] as const;

const Place = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9 }));

/** A command line's shape: which command, how a flag is spelled, which flags it has, and where each part sits. */
const Shape = Schema.Struct({
  verb: Schema.Literals(["plant", "survey"]),
  equals: Schema.Boolean,
  out: Schema.Boolean,
  range: Schema.Boolean,
  away: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: AWAY.length - 1 })),
  allowed: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: ALLOWED.length - 1 })),
  at: Schema.Struct({ subject: Place, law: Place, out: Place, from: Place, to: Place }),
});

/** The words of one command, its parts in the order `shape.at` gives (ties keep the order below). */
const argv = (shape: typeof Shape.Type, law: { readonly plant: string; readonly law: string }) => {
  const flag = (name: string, value: string) => (shape.equals ? [`--${name}=${value}`] : [`--${name}`, value]);

  const parts: Array<readonly [number, ReadonlyArray<string>]> = [
    [shape.at.subject, [shape.verb === "plant" ? law.plant : PRODUCT]],
  ];

  if (shape.verb === "survey") {
    parts.push([shape.at.law, flag("law", law.law)]);

    if (shape.range) {
      parts.push([shape.at.from, flag("from", "1")], [shape.at.to, flag("to", "9")]);
    }
  }

  if (shape.out) {
    parts.push([shape.at.out, flag("out", "runs/plants/out.json")]);
  }

  return ["stryker", shape.verb, ...parts.toSorted(([a], [b]) => a - b).flatMap(([, words]) => words)];
};

/** The repo's own guard on one law file: whether it refuses it on this machine. */
const hostOnly = (law: string, where: (typeof ALLOWED)[number] | (typeof AWAY)[number]) =>
  hostFiles([law], where.env, where.platform, (path) => readFileSync(join(ROOT, path), "utf8")).length > 0;

/** How many times the command started a process, and how it ended: a refusal starts none. */
const starts = (words: ReadonlyArray<string>, where: (typeof ALLOWED)[number] | (typeof AWAY)[number]) => {
  const count = { started: 0 };

  const spawner = ChildProcessSpawner.make(() =>
    Effect.sync(() => {
      count.started += 1;
    }).pipe(Effect.andThen(Effect.die("a law starts no real process"))),
  );

  return run(words, where.env, where.platform).pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provide(NodeServices.layer),
    Effect.exit,
    Effect.map((exit) => ({ ...count, exit })),
  );
};

// Plant: read the law file from fixed argument spots again (`args[2]` for `plant`, the word after `--law`
// for `survey`), which a flag before the name, `--law=` or `--out=` all miss.
it.effect.prop(
  "property: no command line, in any order or spelling, starts a host-only law where the host may not, and every one still runs where it may",
  { shape: Shape },
  ({ shape }) =>
    Effect.gen(function* () {
      for (const { plant, law } of LAWS) {
        if (plant === undefined && shape.verb === "plant") {
          continue;
        }

        const words = argv(shape, { plant: plant ?? "", law });
        const here = yield* starts(words, ALLOWED[shape.allowed] ?? ALLOWED[0]);
        const away = yield* starts(words, AWAY[shape.away] ?? AWAY[0]);

        // The word list parsed and reached the run: without this, a refusal below could be a typo.
        expect(here.started, words.join(" ")).toBe(1);
        expect(away.started, words.join(" ")).toBe(hostOnly(law, AWAY[shape.away] ?? AWAY[0]) ? 0 : 1);
        expect(Exit.isFailure(away.exit), words.join(" ")).toBe(true);
      }
    }),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 12, full: 60 }) } },
);
