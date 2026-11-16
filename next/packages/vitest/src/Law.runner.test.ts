// Decision 0579 and 0580: the package's `it.effect.prop` runs fast-check inputs as our old `property`
// runner did, from the shared seed (119120), and stops on the law's abort. These laws must see a law
// fail, time out or run twice, which no law can see of itself, so each runs fixtures/Law.fixture.ts in a vitest
// of its own, through vitest's Node API, and reads its tasks. That vitest runs in this process on a
// worker thread and starts no process, port or temp folder, so the file is plain (0584) and runs on
// every pull request, as .github/ci/shard-rows.test.ts and related.test.ts do.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import type { RunnerTask, RunnerTestFile, TaskMeta } from "vitest";
import { createVitest } from "vitest/node";
import { runsFor } from "./Depth.ts";
import { LawCase } from "./fixtures/LawCase.ts";
import { Label } from "./Law.ts";

/** One law's verdict in a nested run: its state and its first error's message. */
interface Verdict {
  readonly state: string | undefined;
  readonly message: string;
}

const tests = (task: RunnerTask): ReadonlyArray<RunnerTask> =>
  task.type === "test" ? [task] : "tasks" in task ? task.tasks.flatMap(tests) : [];

const verdicts = (files: ReadonlyArray<RunnerTestFile>): ReadonlyMap<string, Verdict> =>
  new Map(
    files
      .flatMap(tests)
      .map((t) => [t.name, { state: t.result?.state, message: t.result?.errors?.[0]?.message ?? "" }] as const),
  );

/** Runs the fixture's laws for one case in a vitest of its own, and answers each law's verdict by title. */
/** A nested run that could not start or finish: the run itself broke, not a law in it. */
class NestedRun extends Schema.TaggedError<NestedRun>()("NestedRun", { cause: Schema.Defect() }) {}

/** One law a nested run registered: its title, verdict and meta. */
interface Registered extends Verdict {
  readonly name: string;
  readonly meta: TaskMeta;
}

/** What a nested run registered, by suite title, in order; and the errors of files that failed to load. */
const registered = (files: ReadonlyArray<RunnerTestFile>) => ({
  errors: files.flatMap((file) => file.result?.errors ?? []).map((error) => error.message),
  suites: new Map(
    files
      .flatMap((file) => file.tasks)
      .map(
        (suite) =>
          [
            suite.name,
            tests(suite).map((t): Registered => ({
              name: t.name,
              state: t.result?.state,
              message: t.result?.errors?.[0]?.message ?? "",
              meta: t.meta,
            })),
          ] as const,
      ),
  ),
});

/** Runs the fixture for one case in a vitest of its own, and reads its files with `read`. */
const run = <A>(lawCase: LawCase, read: (files: ReadonlyArray<RunnerTestFile>) => A) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () =>
        createVitest("test", {
          root: `${import.meta.dirname}/fixtures`,
          config: false,
          watch: false,
          include: ["Law.fixture.ts"],
          pool: "threads",
          maxWorkers: 1,
          reporters: [],
          provide: { lawCase },
        }),
      catch: (cause) => new NestedRun({ cause }),
    }),
    (vitest) =>
      Effect.tryPromise({ try: () => vitest.start(), catch: (cause) => new NestedRun({ cause }) }).pipe(
        Effect.map(() => read(vitest.state.getFiles())),
      ),
    (vitest) =>
      Effect.tryPromise({ try: () => vitest.close(), catch: (cause) => new NestedRun({ cause }) }).pipe(Effect.orDie),
  );

const nested = (lawCase: LawCase) => run(lawCase, verdicts);

const Small = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 }));
const runs = runsFor({ fast: 3, full: 10 });

describe("the fast-check path of it.effect.prop (0579)", () => {
  // Plant: catch the failure and pass.
  it.live.prop(
    "a fast-check case that fails fails the law with fast-check's counterexample, and a passing run passes",
    { above: Schema.Array(Small).check(Schema.isMinLength(1), Schema.isMaxLength(17)) },
    ({ above }) =>
      Effect.gen(function* () {
        const seen = yield* nested(LawCase.cases.threshold.make({ above }));
        above.forEach((threshold, at) => {
          const verdict = seen.get(`threshold ${at}`);
          expect(verdict?.state, `threshold ${threshold}`).toBe("fail");
          // fast-check shrinks to the least failing value, one above the threshold.
          expect(verdict?.message).toMatch(new RegExp(`\\b${threshold + 1}\\b`));
        });
        expect(seen.get(`threshold ${above.length}`)?.state, seen.get(`threshold ${above.length}`)?.message).toBe(
          "pass",
        );
      }),
    { arbitrary: { runs }, timeout: 60_000 },
  );

  // Plant: remove the `Arbitrary.configureGlobal` call.
  it.live.prop(
    "two runs of the same failing law, on either engine, report the same counterexample: the seed comes from the package",
    { lowest: Schema.Array(Small).check(Schema.isMinLength(1), Schema.isMaxLength(20)) },
    ({ lowest }) =>
      Effect.gen(function* () {
        const first = yield* nested(LawCase.cases.seed.make({ lowest }));
        const second = yield* nested(LawCase.cases.seed.make({ lowest }));

        for (const engine of ["fast-check", "effect"]) {
          lowest.forEach((_, at) => {
            const title = `${engine} ${at}`;
            expect(first.get(title)?.state, title).toBe("fail");
            expect(second.get(title)?.message, title).toBe(first.get(title)?.message);
          });
        }
      }),
    { arbitrary: { runs }, timeout: 120_000 },
  );

  // scenario: one timed-out law, since the timing is the case. The law waits 40 ms a case for 1000
  // cases with a 300 ms timeout, and the law after it waits, then fails if any case or shrink
  // started once the first law's signal had aborted. Plant: delete the `stopOnAbort` step.
  it.live(
    "scenario: after the law's timeout, no case or shrink opens another scope",
    () =>
      Effect.gen(function* () {
        const seen = yield* nested(LawCase.cases.timeout.make({ timeout: 300 }));
        expect(seen.get("times out")?.state).toBe("fail");
        expect(seen.get("then nothing more opens"), JSON.stringify([...seen])).toEqual({ state: "pass", message: "" });
      }),
    60_000,
  );
});

/** Every placeholder vitest's `formatTitle` reads that R7 draws: printf's, the index two ways, and an object case's keys. */
const PIECES = ["%s", "%d", "%j", "%#", "%$", "%%", "$word", "$n"] as const;
const Word = Schema.String.check(Schema.isMaxLength(8));
const Cases = { minimum: 1, maximum: 4 };

/** A law's label as its options give it; a pinned ticket is a whole number. */
const Labels = Schema.Union([
  Label.cases.vector,
  Label.cases.format,
  Label.cases.scenario,
  Label.cases.type,
  Schema.TaggedStruct("pinned", { reason: Schema.Int }),
]);

describe("it.each (0591)", () => {
  // R7. Every run reaches both case kinds (tuples, spread into the body, and records, handed whole),
  // every placeholder of PIECES (each template ends with all of them, after the drawn pieces), a law
  // with a plant, a label and reads (the tuples) and one with none (the records), by construction.
  // Plants: format the title in the package (a loop of plain `it` calls on the raw name), red; drop
  // `toTestOptions` from `each`, red.
  it.live.prop(
    "R7 the package's it.each registers one law per case, titled as vitest's own it.each titles them, hands each body its case, and puts the law's plant, label and reads in meta as the plain it does",
    {
      tuples: Schema.Array(Schema.Tuple([Word, Schema.Int])).check(
        Schema.isMinLength(Cases.minimum),
        Schema.isMaxLength(Cases.maximum),
      ),
      records: Schema.Array(Schema.Struct({ word: Word, n: Schema.Int })).check(
        Schema.isMinLength(Cases.minimum),
        Schema.isMaxLength(Cases.maximum),
      ),
      pieces: Schema.Array(Schema.Union([Schema.Literals(PIECES), Word])).check(Schema.isMaxLength(6)),
      plant: Word,
      label: Labels,
      reads: Schema.Array(Schema.String.check(Schema.isMaxLength(16))).check(Schema.isMaxLength(3)),
    },
    ({ tuples, records, pieces, plant, label, reads }) =>
      Effect.gen(function* () {
        const template = [...pieces, ...PIECES].join(" ");
        const seen = yield* run(
          LawCase.cases.each.make({ tuples, records, template, plant, label, reads }),
          registered,
        );
        expect(seen.errors).toEqual([]);

        for (const [kind, cases, meta] of [
          ["tuples", tuples, { plant, label, reads }],
          ["records", records, {}],
        ] as const) {
          const law = seen.suites.get(`law ${kind}`) ?? [];
          const own = seen.suites.get(`vitest ${kind}`) ?? [];
          expect(own, kind).toHaveLength(cases.length);
          expect(
            law.map((one) => one.name),
            kind,
          ).toEqual(own.map((one) => one.name));
          law.forEach((one, at) => {
            const { received, ...rest } = one.meta;
            const value = cases[at];
            expect(one.state, one.message).toBe("pass");
            expect(received, `${kind} ${at}`).toEqual(Array.isArray(value) ? value : [value]);
            expect(received, `${kind} ${at}`).toEqual(own[at]?.meta.received);
            expect(rest, `${kind} ${at}`).toEqual(meta);
          });
        }
      }),
    { arbitrary: { runs }, timeout: 120_000 },
  );
});
