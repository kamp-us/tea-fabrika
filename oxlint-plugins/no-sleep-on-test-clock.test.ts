import { join } from "node:path";
import { it } from "@effect/vitest";
// Ticket 1311. `fabrika/no-sleep-on-test-clock` refuses a clock-driven wait inside a body that runs
// on Effect's `TestClock` (`it.effect` and the `.effect` of a `layer(...)` block) when the same body
// never moves that clock. Law 1 runs generated files in process through oxlint's RuleTester: each
// way a test is registered, on the test clock or off it, each way a wait is spelled, with and
// without a move of the clock or a `TestClock.withLive`, and look-alikes that must pass. Law 2
// writes out the bodies by hand, the pipe forms among them. The scenario is one real oxlint run
// with the repo's config, since only the config says which paths are tests.
//
// Plants, each run once on no-sleep-on-test-clock.ts and restored, each red as named:
// - read `it.effect` only, not a `layer` block's parameter (law 1: the block forms stop firing);
// - drop the `excludeTestServices` check (law 1: a block with the test services off fires);
// - drop the move check (laws 1 and 2: a body with `adjust` or `setTime` fires);
// - drop the `withLive` exemption (laws 1 and 2: a wait inside `TestClock.withLive` fires);
// - hold `it.live` to the rule too (law 1 and the scenario: an `it.live` wait fires);
// - drop one wait from the list, `timeoutOrElse` (law 1: its fire is gone);
// - resolve no name through its import (all three: no wait is seen).
import { Array as Arr, Effect, Record as Rec, Schema } from "effect";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect } from "vitest";
import { noSleepOnTestClock } from "./no-sleep-on-test-clock.ts";
import { plant } from "./plant.ts";

/** A promise the test waits on rejected: the test's own failure, with the rejection as its cause. */
class TestFailure extends Schema.TaggedError<TestFailure, { readonly brand: unique symbol }>()("TestFailure", {
  cause: Schema.Unknown,
}) {}

/** Waits on a promise inside the test's Effect, as `Effect.tryPromise` in its object form. */
const promised = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => TestFailure.make({ cause }) });

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();

RuleTester.it = (_name, fn) => fn();

// From the top of the repo, so the rule reads each path as oxlint gives it there.
const tester = new RuleTester({ cwd: join(import.meta.dirname, "..") });

const CODE = "fabrika(no-sleep-on-test-clock)";

const REFUSED = /runs on the test clock/;

type Part = "Effect" | "Schedule" | "Stream" | "TestClock";

/** The module a part lives in when it is imported as a whole: `effect/Effect`, `effect/testing/TestClock`. */
const MODULE: Readonly<Record<Part, string>> = {
  Effect: "effect/Effect",
  Schedule: "effect/Schedule",
  Stream: "effect/Stream",
  TestClock: "effect/testing/TestClock",
};

/** The barrel a part is named in: `effect`, and `effect/testing` for the clock. */
const BARREL: Readonly<Record<Part, string>> = {
  Effect: "effect",
  Schedule: "effect",
  Stream: "effect",
  TestClock: "effect/testing",
};

/** How a file reaches one member of one part: the import line, and what a use of the member is written as. */
type Reach = { readonly header: string; readonly ref: string };

/** Each spelling of the import that reaches `part.member`, `alias` being the name a renamed one takes. */
const reaches = (part: Part, member: string, alias: string): ReadonlyArray<Reach> => [
  { header: `import { ${part} } from "${BARREL[part]}";`, ref: `${part}.${member}` },
  { header: `import { ${part} as ${alias} } from "${BARREL[part]}";`, ref: `${alias}.${member}` },
  { header: `import * as ${alias} from "${MODULE[part]}";`, ref: `${alias}.${member}` },
  { header: `import { ${member} as ${alias} } from "${MODULE[part]}";`, ref: alias },
  ...(BARREL[part] === "effect"
    ? [{ header: `import * as ${alias} from "effect";`, ref: `${alias}.${part}.${member}` }]
    : [{ header: `import * as ${alias} from "effect/testing";`, ref: `${alias}.${part}.${member}` }]),
];

/** Every wait the rule knows, as the part and member. */
const WAITS: ReadonlyArray<readonly [Part, string]> = [
  ["Effect", "sleep"],
  ["Effect", "delay"],
  ["Effect", "timeout"],
  ["Effect", "timeoutOption"],
  ["Effect", "timeoutOrElse"],
  ["Schedule", "spaced"],
  ["Schedule", "fixed"],
  ["Schedule", "windowed"],
  ["Schedule", "exponential"],
  ["Schedule", "fibonacci"],
  ["Schedule", "duration"],
  ["Schedule", "cron"],
  ["Stream", "tick"],
  ["Stream", "debounce"],
  ["Stream", "throttle"],
  ["Stream", "throttleEffect"],
  ["Stream", "timeout"],
  ["Stream", "timeoutOrElse"],
  ["Stream", "groupedWithin"],
  ["Stream", "aggregateWithin"],
];

/** Members of the same parts that wait on nothing. */
const QUIET: ReadonlyArray<readonly [Part, string]> = [
  ["Effect", "succeed"],
  ["Effect", "gen"],
  ["Effect", "timed"],
  ["Schedule", "recurs"],
  ["Schedule", "forever"],
  ["Stream", "make"],
  ["Stream", "runCollect"],
];

/**
 * A way to register a test, as lines around the steps. `clock` says what it runs on: `test` for
 * the test clock, `live` for the real one, `unknown` for what the rule cannot tell.
 */
type Form = {
  readonly clock: "test" | "live" | "unknown";
  readonly header: ReadonlyArray<string>;
  readonly wrap: (steps: ReadonlyArray<string>) => ReadonlyArray<string>;
};

/** One test call whose body runs each step on a line of its own, opened and closed as the form says. */
const around =
  (open: string, close: string) =>
  (steps: ReadonlyArray<string>): ReadonlyArray<string> => [open, ...Arr.map(steps, (step) => `    ${step},`), close];

/** The ways a test is registered. `run` stands for whatever Effect the body builds from its steps. */
const FORMS = (alias: string): ReadonlyArray<Form> => {
  const vitest = (names: string) => `import { ${names} } from "@effect/vitest";`;

  /** The test inside a `layer` block: the block's parameter is `alias`, whatever its use is. */
  const inBlock = (start: string, options: string, clock: "test" | "live" | "unknown", names = "layer"): Form => ({
    clock,
    header: [vitest(names)],
    wrap: (steps) => [
      `${start}${options})("block", (${alias}) => {`,
      `  ${alias}.effect("inside", () => run(`,
      ...Arr.map(steps, (step) => `    ${step},`),
      "  ));",
      "});",
    ],
  });

  return [
    { clock: "test", header: [vitest("it")], wrap: around('it.effect("a", () => run(', "));") },
    { clock: "test", header: [vitest("it")], wrap: around('it.effect.skip("a", () => run(', "));") },
    { clock: "test", header: [vitest("it")], wrap: around('it.effect.only("a", () => run(', "));") },
    { clock: "test", header: [vitest("it")], wrap: around('it.effect.fails("a", () => run(', "));") },
    {
      clock: "test",
      header: [vitest("it")],
      wrap: around('it.effect.prop("a", { n: Schema.Int }, ({ n }) => run(', "));"),
    },
    { clock: "test", header: [vitest("it")], wrap: around('it.effect.each([1, 2])("a", (n) => run(', "));") },
    {
      clock: "test",
      header: [vitest("it")],
      wrap: around('it.effect.skipIf(process.env.X === "1")("a", () => run(', "));"),
    },
    { clock: "test", header: [vitest("it")], wrap: around('it.effect("a", function () { return run(', "); });") },
    { clock: "test", header: [vitest(`it as ${alias}`)], wrap: around(`${alias}.effect("a", () => run(`, "));") },
    { clock: "test", header: [vitest(`effect as ${alias}`)], wrap: around(`${alias}("a", () => run(`, "));") },
    {
      clock: "test",
      header: [`import * as ${alias} from "@effect/vitest";`],
      wrap: around(`${alias}.it.effect("a", () => run(`, "));"),
    },
    {
      clock: "test",
      header: [`import * as ${alias} from "@effect/vitest";`],
      wrap: around(`${alias}.effect("a", () => run(`, "));"),
    },
    inBlock("layer(L", "", "test"),
    inBlock("layer(L, { timeout: 5 }", "", "test"),
    inBlock("layer(L, { excludeTestServices: false }", "", "test"),
    inBlock("it.layer(L", "", "test", "it"),
    // A block inside a block takes the clock of the one it sits in.
    {
      clock: "test",
      header: [vitest("layer")],
      wrap: (steps) => [
        'layer(L)("outer", (it) => {',
        '  it.layer(M)("inner", (it) => {',
        '    it.effect("a", () => run(',
        ...Arr.map(steps, (step) => `      ${step},`),
        "    ));",
        "  });",
        "});",
      ],
    },
    // The real clock: `it.live`, and a block with the test services left out, or nested in one.
    { clock: "live", header: [vitest("it")], wrap: around('it.live("a", () => run(', "));") },
    { clock: "live", header: [vitest("it")], wrap: around('it.live.prop("a", { n: Schema.Int }, () => run(', "));") },
    inBlock("layer(L", ", { excludeTestServices: true }", "live"),
    inBlock("it.layer(L", ", { excludeTestServices: true, timeout: 5 }", "live", "it"),
    {
      clock: "live",
      header: [vitest("layer")],
      wrap: (steps) => [
        'layer(L, { excludeTestServices: true })("outer", (it) => {',
        '  it.layer(M)("inner", (it) => {',
        '    it.effect("a", () => run(',
        ...Arr.map(steps, (step) => `      ${step},`),
        "    ));",
        "  });",
        "});",
      ],
    },
    // A block the rule cannot read: options built elsewhere.
    inBlock("layer(L", ", options", "unknown"),
    inBlock("layer(L", ", { excludeTestServices: flag }", "unknown"),
    // Not `@effect/vitest`'s `it`: another module's, and a local object.
    {
      clock: "unknown",
      header: ['import { it } from "vitest";'],
      wrap: around('it.effect("a", () => run(', "));"),
    },
    {
      clock: "unknown",
      header: ['import { it } from "./mine.ts";'],
      wrap: around('it.effect("a", () => run(', "));"),
    },
    {
      clock: "unknown",
      header: ["const it = { effect: (_name: string, _fn: () => void) => {} };"],
      wrap: around('it.effect("a", () => run(', "));"),
    },
  ];
};

/** What the clock does in a body: nothing, or one of the two calls that move it. */
type Move = "none" | "adjust" | "setTime" | "referred";

const MOVE_MEMBER: Readonly<Record<Exclude<Move, "none">, string>> = {
  adjust: "adjust",
  setTime: "setTime",
  referred: "adjust",
};

/** What one generated case is built from: indexes into the lists above, so a failure shrinks to a small file. */
type Case = {
  readonly form: number;
  readonly alias: string;
  readonly waits: ReadonlyArray<{ readonly at: number; readonly how: number }>;
  readonly quiet: ReadonlyArray<{ readonly at: number; readonly how: number }>;
  readonly move: Move;
  readonly moveHow: number;
  readonly live: boolean;
};

const spelling = fc.nat({ max: 5 });

const generated: fc.Arbitrary<Case> = fc.record({
  form: fc.nat({ max: FORMS("x").length - 1 }),
  alias: fc.stringMatching(/^[a-z]{2,6}$/).map((word) => `K${word}`),
  waits: fc.array(fc.record({ at: fc.nat({ max: WAITS.length - 1 }), how: spelling }), { minLength: 1, maxLength: 3 }),
  quiet: fc.array(fc.record({ at: fc.nat({ max: QUIET.length - 1 }), how: spelling }), { maxLength: 2 }),
  move: fc.constantFrom<Move>("none", "adjust", "setTime", "referred"),
  moveHow: spelling,
  live: fc.boolean(),
});

/** Lines that name a wait and wait on nothing, whichever test they sit in. None fires. */
const NEIGHBORS: ReadonlyArray<(i: number) => string> = [
  (i) => `git.sleep(${i})`,
  (i) => `Mine.sleep(${i})`,
  (i) => `Mine.Effect.sleep(${i})`,
  (i) => `((Effect: { sleep: (n: number) => void }) => Effect.sleep(${i}))`,
  (i) => `"Effect.sleep(${i})"`,
  (i) => `sleep(${i})`,
  (i) => `Effect["succeed"](${i})`,
];

/** One import spelling of `part.member` for a case, by its `how`, under a name the case's alias makes unique. */
const reach = (part: Part, member: string, how: number, alias: string): Reach => {
  const all = reaches(part, member, alias);

  return all[how % all.length]!;
};

/**
 * The file one generated case makes, and for each wait the mark that finds its line and whether it
 * fires. A wait fires when its test runs on the test clock, its body moves that clock nowhere, and
 * no `TestClock.withLive` holds the wait.
 */
const fileOf = (value: Case) => {
  const form = FORMS(value.alias)[value.form]!;
  const headers = new Set<string>(form.header);
  const steps: Array<string> = [];
  const marks: Array<{ readonly mark: string; readonly fires: boolean }> = [];
  const quiet = form.clock !== "test" || value.move !== "none";

  Arr.forEach(value.waits, ({ at, how }, i) => {
    const [part, member] = WAITS[at]!;
    const found = reach(part, member, how, `W${value.alias}${i}`);
    const mark = `${100 + i}`;
    const call = `${found.ref}(${mark})`;
    headers.add(found.header);

    if (value.live) {
      const held = reach("TestClock", "withLive", how, `L${value.alias}${i}`);
      headers.add(held.header);
      steps.push(`${held.ref}(${call})`);
    } else {
      steps.push(call);
    }

    marks.push({ mark, fires: !quiet && !value.live });
  });

  Arr.forEach(value.quiet, ({ at, how }, i) => {
    const [part, member] = QUIET[at]!;
    const found = reach(part, member, how, `Q${value.alias}${i}`);
    headers.add(found.header);
    steps.push(`${found.ref}(${i})`);
  });

  if (value.move !== "none") {
    const found = reach("TestClock", MOVE_MEMBER[value.move], value.moveHow, `M${value.alias}`);
    headers.add(found.header);
    steps.push(value.move === "referred" ? `run(${found.ref})` : `${found.ref}(1000)`);
  }

  Arr.forEach(NEIGHBORS, (neighbor, i) => steps.push(neighbor(i)));

  const lines = [
    ...headers,
    'import { Mine, git } from "./mine.ts";',
    "declare const L: unknown, M: unknown, run: (...steps: unknown[]) => unknown, options: object, flag: boolean;",
    ...form.wrap(steps),
    "",
  ];

  return { lines, marks };
};

it("law 1: refuses each wait on the test clock that its body never moves, and nothing else, through every way a test and a wait are spelled", () => {
  fc.assert(
    fc.property(generated, (value) => {
      const { lines, marks } = fileOf(value);
      const filename = "next/packages/libfabrika/src/runtime/Case.test.ts";
      const code = Arr.join(lines, "\n");

      const errors = Arr.flatMap(marks, ({ mark, fires }) =>
        fires ? [{ line: lines.findIndex((line) => line.includes(`(${mark})`)) + 1, message: REFUSED }] : [],
      );

      tester.run("no-sleep-on-test-clock", noSleepOnTestClock, {
        valid: errors.length === 0 ? [{ code, filename }] : [],
        invalid: errors.length === 0 ? [] : [{ code, filename, errors }],
      });
    }),
    { seed: 119120, numRuns: 200 },
  );
});

/** Bodies that run on the test clock and hold a wait, one hand-written spelling each, and whether the wait fires. */
const WRITTEN: ReadonlyArray<readonly [string, string, boolean]> = [
  ["the bare sleep", "Effect.sleep(1)", true],
  ["a sleep in a pipe", "run(Effect.succeed(1).pipe(Effect.delay(1)))", true],
  ["a retry on a spaced schedule", "run(Effect.retry(x, { schedule: Schedule.spaced(1) }))", true],
  ["a sleep after an adjust", "run(TestClock.adjust(1), Effect.sleep(1))", false],
  ["a sleep before a set", "run(Effect.sleep(1), TestClock.setTime(1))", false],
  ["a sleep forked beside an adjust", "run(Effect.forkChild(Effect.sleep(1)), TestClock.adjust(1))", false],
  ["a sleep in withLive", "TestClock.withLive(Effect.sleep(1))", false],
  ["a sleep piped to withLive", "Effect.sleep(1).pipe(TestClock.withLive)", false],
  [
    "a sleep in a pipe function that ends in withLive",
    "pipe(Effect.sleep(1), Effect.asVoid, TestClock.withLive)",
    false,
  ],
  ["a sleep beside another in withLive", "run(Effect.sleep(1), TestClock.withLive(Effect.sleep(2)))", true],
];

it("law 2: reads the whole body, so a wait beside a move of the clock passes, and a wait beside a live one does not", () => {
  const head = [
    'import { it } from "@effect/vitest";',
    'import { Effect, Schedule, pipe } from "effect";',
    'import { TestClock } from "effect/testing";',
    "declare const x: unknown, run: (...steps: unknown[]) => unknown;",
  ];

  tester.run("no-sleep-on-test-clock", noSleepOnTestClock, {
    valid: Arr.flatMap(WRITTEN, ([, body, fires]) =>
      fires
        ? []
        : [
            {
              code: Arr.join([...head, `it.effect("a", () => ${body});`, ""], "\n"),
              filename: "next/packages/libfabrika/src/runtime/Case.test.ts",
            },
          ],
    ),
    invalid: Arr.flatMap(WRITTEN, ([, body, fires]) =>
      fires
        ? [
            {
              code: Arr.join([...head, `it.effect("a", () => ${body});`, ""], "\n"),
              filename: "next/packages/libfabrika/src/runtime/Case.test.ts",
              errors: [{ line: head.length + 1, message: REFUSED }],
            },
          ]
        : [],
    ),
  });
});

const BODY = Arr.join(
  [
    'import { it } from "@effect/vitest";',
    'import { Effect } from "effect";',
    'it.effect("a", () => Effect.sleep(1));',
    "// oxlint-disable-next-line fabrika/no-sleep-on-test-clock -- the clock is moved by a helper above",
    'it.effect("b", () => Effect.sleep(1));',
    'it.live("c", () => Effect.sleep(1));',
    "// oxlint-disable-next-line fabrika/no-sleep-on-test-clock -- nothing waits here",
    "export const d = 1;",
  ],
  "\n",
);

const HELD = [
  "next/packages/libfabrika/src/runtime/Plant.test.ts",
  "next/apps/fabrika/src/window/Plant.test.tsx",
  "next/packages/libfabrika/src/processes/PlantTest.ts",
  "next/packages/libfabrika/src/processes/plant.test-support.ts",
  "kalfa/config/src/plant.test.ts",
  ".agents/skills/x/scripts/plant.test.ts",
  "packages/fabrika/src/plant.test.ts",
  "apps/fabrika/src/plant.test.ts",
];

const LEFT_OUT = [
  "next/packages/libfabrika/src/runtime/Plant.ts",
  "next/apps/fabrika/src/window/Plant.tsx",
  "kalfa/config/src/plant.ts",
  ".agents/skills/x/scripts/plant.ts",
  "packages/fabrika/src/plant.ts",
];

it.live("scenario: one real lint run per path kind, since only the real config holds which paths are tests", () =>
  Effect.gen(function* () {
    const linted = yield* promised(() =>
      plant(Rec.fromEntries(Arr.map([...HELD, ...LEFT_OUT], (path) => [path, BODY]))),
    );

    // A test, a shared suite and a test kit: the bare wait on the test clock fires, the one under its
    // disable comment and the one in `it.live` pass.
    for (const path of HELD) {
      expect([path, linted(CODE, path)]).toEqual([path, [3]]);
    }

    // The disable comment over a line with no wait is an unused directive, which oxlint reports with
    // no rule code (`reportUnusedDisableDirectives`).
    for (const path of HELD) {
      expect([path, linted("", path)]).toEqual([path, [7]]);
    }

    // A file that is no test holds no test body for the rule to read.
    for (const path of LEFT_OUT) {
      expect([path, linted(CODE, path)]).toEqual([path, []]);
    }
  }),
);
