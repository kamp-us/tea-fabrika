// Today's lead tooling. The laws of the land record (.kalfa/quests/land-record-PLAN.md, L1 to L6, L8 to L12 and L14): what a
// `land.ts` command leaves in its record around the handler it runs, and how a later reader tells one that died. All on the
// in-memory LandLogTest layer and the test clock, except the ones that need a folder that can refuse a file (L4 j, L10) or that
// check a read leaves a folder alone (L14), which run on a real temp folder. The real-signal law (L16) is in
// Recorded.integration.test.ts.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import {
  Array as Arr,
  Cause,
  ConfigProvider,
  Console,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import { type Key, LandLog, Line } from "./LandLog.ts";
import * as LandLogFs from "./LandLogFs.ts";
import * as LandLogTest from "./LandLogTest.ts";
import * as Recorded from "./Recorded.ts";

// ---------------------------------------------------------------- the world a law runs in

/** The check names `land.ts` refuses at (its `Check` literals). */
const CHECKS = [
  "env",
  "ready",
  "check",
  "leak",
  "fetch",
  "merge",
  "sign",
  "push",
  "pr",
  "queue",
  "wait",
  "arm",
  "body",
] as const;

/** A check saying no, as land.ts's `Refused` carries it: with the last lines a child printed, which the record must never hold. */
type Failure =
  | { readonly _tag: "Refused"; readonly check: string; readonly reason: string; readonly output: string }
  | { readonly _tag: "Broke"; readonly broke: string };

const PR = 2351;

const forPr = (pr: number): Key => ({ _tag: "pr", pr });

const spec = (over: Partial<Recorded.Spec<number, Failure>> = {}): Recorded.Spec<number, Failure> => ({
  command: "queue",
  keys: (pr) => [forPr(pr)],
  argv: ["queue", String(PR), "--wait-ci"],
  pid: 4021,
  every: Duration.minutes(5),
  // The caller says which failure is a refusal, and gives the words the record may hold.
  refusal: (e) => (e._tag === "Refused" ? Option.some({ check: e.check, reason: e.reason }) : Option.none()),
  ...over,
});

/** The terminal a law gives the command: what it printed to stdout and to stderr. */
const terminal = () => {
  const said: Array<string> = [];
  const errors: Array<string> = [];

  const console = Object.assign(Object.create(globalThis.console), {
    log: (...args: ReadonlyArray<unknown>) => {
      said.push(args.join(" "));
    },
    error: (...args: ReadonlyArray<unknown>) => {
      errors.push(args.join(" "));
    },
  });

  return { console, said, errors };
};

/** What an exit says, without its stack: its value, its typed failure, or its defect (the error a handler threw). */
const outcome = <A>(exit: Exit.Exit<A, Failure>) =>
  Exit.isSuccess(exit)
    ? ({ _tag: "success", value: exit.value } as const)
    : Cause.hasInterruptsOnly(exit.cause)
      ? ({ _tag: "interrupt" } as const)
      : ({
          _tag: "failure",
          failure: Cause.findError(exit.cause),
          defect: Cause.findDefect(exit.cause),
          interrupts: Cause.hasInterrupts(exit.cause),
        } as const);

/** The handler on its own, with no record around it: what a caller got before the record existed. */
const bare = <A>(handler: (pr: number) => Effect.Effect<A, Failure>) =>
  Effect.gen(function* () {
    const shown = terminal();
    const exit = yield* Effect.exit(handler(PR)).pipe(Effect.provideService(Console.Console, shown.console));

    return { outcome: outcome(exit), said: shown.said };
  });

/** `handler` around its record on `layer`: how it ended and what the terminal showed. */
const runOn = <A, R>(
  layer: Layer.Layer<LandLog, never, R>,
  handler: (pr: number) => Effect.Effect<A, Failure>,
  over: Partial<Recorded.Spec<number, Failure>> = {},
) =>
  Effect.gen(function* () {
    const shown = terminal();

    const exit = yield* Effect.exit(Recorded.around(spec(over), handler)(PR)).pipe(
      Effect.provide(layer),
      Effect.provideService(Console.Console, shown.console),
    );

    return { outcome: outcome(exit), shown };
  });

/** `runOn` the in-memory record: the lines it left for the pull request come back with it. */
const run = <A>(
  handler: (pr: number) => Effect.Effect<A, Failure>,
  over: Partial<Recorded.Spec<number, Failure>> = {},
  failing?: (key: Key, line: Line) => boolean,
) => {
  const world = LandLogTest.world();

  return runOn(LandLogTest.layer(world, failing), handler, over).pipe(
    Effect.map((got) => ({ ...got, world, lines: LandLogTest.lines(world, forPr(PR)) })),
  );
};

const refused = (check: string, reason: string, output: string): Failure => ({
  _tag: "Refused",
  check,
  reason,
  output,
});

const speak = (lines: ReadonlyArray<string>) =>
  Effect.forEach(lines, (line) => Console.log(line), { concurrency: 1, discard: true });

/** Lines a command prints: any text, and the ones a terminal shows with quotes, a newline inside and text that is no ASCII. */
const SAID = Schema.Array(
  Schema.Union([Schema.String, Schema.Literals(['say "hi"', "two\nlines", "héllo ✓ 日本", "", "tab\there", "\\n"])]),
);

/** A command that waits for ever, interrupted after `beats` heartbeats: its lines, and the exit it ended with. */
const interruptedAfter = (beats: number) =>
  Effect.gen(function* () {
    const world = LandLogTest.world();
    const ready = yield* Deferred.make<void>();
    const shown = terminal();

    const fiber = yield* Effect.forkChild(
      Effect.exit(
        Recorded.around(spec(), () => Deferred.succeed(ready, undefined).pipe(Effect.andThen(Effect.never)))(PR),
      ).pipe(Effect.provide(LandLogTest.layer(world)), Effect.provideService(Console.Console, shown.console)),
    );

    yield* Deferred.await(ready);
    yield* TestClock.adjust(Duration.minutes(5 * beats));
    yield* Fiber.interrupt(fiber);

    return { lines: LandLogTest.lines(world, forPr(PR)), exit: yield* Fiber.await(fiber) };
  });

/** A temp folder, given back when the law ends. */
const temp = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.makeTempDirectoryScoped({ prefix: "recorded-" });
});

// ---------------------------------------------------------------- L1, L2, L3: what a command's end says

describe("around: a started line first, then how the command ended, and nothing the command does is changed", () => {
  // Plants, each run once and restored: write a refusal as `failed` (red: the refused case); a typed failure that is no refusal as
  // `refused` (red); a defect as `done` (red); an interrupt that writes nothing (red: no ending line); a cause that holds an
  // interrupt and a failure as `interrupted` (red); `said` left off a line when it is empty, so the line fails its own schema (red:
  // the silent success is no `Line`).
  // Coverage: every case runs every shape of an exit, so none is left to the draw; the data around each is what varies.
  it.effect.prop(
    "L1 property: a started line comes first and the last line says how the command ended (done, refused, failed or interrupted), by the exit's shape; a cause with an interrupt and a failure is failed; the result is the handler's own",
    {
      said: SAID,
      check: Schema.Literals(CHECKS),
      reason: Schema.String,
      output: Schema.String,
      broke: Schema.String,
      beats: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
    },
    ({ said, check, reason, output, broke, beats }) =>
      Effect.gen(function* () {
        const refusal = refused(check, reason, output);

        const shapes: ReadonlyArray<{
          readonly name: string;
          readonly handler: (pr: number) => Effect.Effect<number, Failure>;
          readonly ends: Line["_tag"];
        }> = [
          // (a) a success that printed no line, and (b) one that printed several.
          { name: "silent", handler: () => Effect.succeed(7), ends: "done" },
          { name: "printed", handler: () => speak(said).pipe(Effect.as(8)), ends: "done" },
          // (c) a Refused, and (d) a typed failure that is none.
          { name: "refused", handler: () => Effect.fail(refusal), ends: "refused" },
          { name: "typed", handler: () => Effect.fail({ _tag: "Broke", broke }), ends: "failed" },
          // (e) a defect: an error thrown inside the handler.
          { name: "defect", handler: () => Effect.die(new Error(broke)), ends: "failed" },
          // (g) a cause that holds an interrupt and a failure together.
          {
            name: "mixed",
            handler: () => Effect.failCause(Cause.combine(Cause.interrupt(), Cause.fail(refusal))),
            ends: "failed",
          },
          // A refusal beside a defect (a finalizer that threw) is no clean refusal either.
          {
            name: "mixed with a defect",
            handler: () => Effect.failCause(Cause.combine(Cause.die(new Error(broke)), Cause.fail(refusal))),
            ends: "failed",
          },
        ];

        for (const shape of shapes) {
          const got = yield* run(shape.handler);

          expect(got.lines[0], shape.name).toMatchObject({
            _tag: "started",
            pid: 4021,
            command: "queue",
            argv: ["queue", String(PR), "--wait-ci"],
          });
          expect(got.lines.every(Schema.is(Line)), `${shape.name}: every line is a Line`).toBe(true);

          // One ending, the last line; every line of the attempt carries the same `attempt`.
          const endings = got.lines.filter((line) => line._tag !== "started" && line._tag !== "heartbeat");
          expect(
            endings.map((line) => line._tag),
            shape.name,
          ).toEqual([shape.ends]);
          expect(got.lines.at(-1)?._tag, shape.name).toBe(shape.ends);
          expect(new Set(got.lines.map((line) => line.attempt)).size, shape.name).toBe(1);

          const end = got.lines.at(-1);

          if (shape.name === "refused") {
            expect(end).toMatchObject({ check, reason });
          }

          if (shape.name === "printed") {
            expect(end).toMatchObject({ said });
          }

          if (shape.name === "silent") {
            expect(end).toMatchObject({ said: [] });
          }

          // The result and the printed lines are the handler's own, as with no record.
          const alone = yield* bare(shape.handler);
          expect(got.outcome, shape.name).toEqual(alone.outcome);
          expect(got.shown.said, shape.name).toEqual(alone.said);
        }

        // (f) An interrupt while the command waits: once before its first heartbeat (beats 0), and once after some.
        const cut = yield* interruptedAfter(beats);
        expect(cut.lines[0]?._tag).toBe("started");
        expect(cut.lines.at(-1)?._tag).toBe("interrupted");
        expect(cut.lines.filter((line) => line._tag === "heartbeat")).toHaveLength(beats);
        expect(cut.lines.every(Schema.is(Line))).toBe(true);
      }),
    { arbitrary: { seed: 2344, runs: runsFor({ fast: 30, full: 100 }) } },
  );

  // Plants: swallow a printed line in the copy (red); join the lines and cut at the first newline (red: a line with a newline
  // inside); stop passing the print to the terminal when the record cannot be written (red: the `recorded: false` case).
  it.effect.prop(
    "L2 property: what the command prints reaches the terminal unchanged and in order, with the record or without it, and done.said holds the same lines",
    { said: SAID, recorded: Schema.Boolean },
    ({ said, recorded }) =>
      Effect.gen(function* () {
        // With the record down, every append fails.
        const got = yield* run(() => speak(said), {}, recorded ? undefined : () => true);

        expect(got.shown.said).toEqual(said);

        if (recorded) {
          expect(got.lines.at(-1)).toMatchObject({ _tag: "done", said });
        }
      }),
    { arbitrary: { seed: 2345, runs: runsFor({ fast: 60, full: 200 }) } },
  );

  // Plant: write the refusal's `output` into `reason`, or into a new field of the line (red: the marker is in the record).
  it.effect.prop(
    "L3 property [secrets]: the output a refusal carries never reaches the record; the line holds only its check and its reason",
    {
      check: Schema.Literals(CHECKS),
      reason: Schema.String,
      before: Schema.String,
      after: Schema.String,
    },
    ({ check, reason, before, after }) =>
      Effect.gen(function* () {
        const marker = "tok-9f3a1c27d5e84b60";
        const output = `${before}${marker}${after}`;

        // The caller hands `around` the whole failure, which holds more than the two fields the record may keep.
        const got = yield* run(() => Effect.fail(refused(check, reason, output)), {
          refusal: (e) => (e._tag === "Refused" ? Option.some(e) : Option.none()),
        });

        const end = got.lines.at(-1);
        expect(end?._tag).toBe("refused");
        expect(Object.keys(end ?? {}).toSorted()).toEqual(["_tag", "at", "attempt", "check", "reason"]);
        expect(JSON.stringify(got.lines)).not.toContain(marker);
        // Every named output: the record, and what the terminal showed.
        expect([...got.shown.said, ...got.shown.errors].join("\n")).not.toContain(marker);
      }),
    { arbitrary: { seed: 2346, runs: runsFor({ fast: 60, full: 200 }) } },
  );
});

// ---------------------------------------------------------------- L4: a record that cannot be written changes nothing

describe("around: a record that cannot be written changes neither the result, nor what is printed, nor the exit", () => {
  const Handler = Schema.Literals(["ok", "refused", "typed", "defect"]);

  const handlerFor = (kind: typeof Handler.Type, said: ReadonlyArray<string>) =>
    kind === "ok"
      ? speak(said).pipe(Effect.as(1))
      : kind === "refused"
        ? Effect.fail(refused("queue", "the pull request is closed", "output"))
        : kind === "typed"
          ? Effect.fail<Failure>({ _tag: "Broke", broke: "gh failed" })
          : Effect.die(new Error("a thrown error"));

  // Plants, each run once and restored: let the append of the start line fail the command (h, red: the result is a failure); the
  // same for the ending line (i, red); the same for a folder that cannot be made (j, red); print one stderr line for each failed
  // line (red: more than one).
  it.effect.prop(
    "L4 property: a failed start line, a failed ending line, or a folder that cannot be made, leaves the command's result and printed lines as they were and costs one stderr line",
    {
      kind: Handler,
      said: SAID,
      failing: Schema.Literals(["start", "end", "both"]),
    },
    ({ kind, said, failing }) =>
      Effect.gen(function* () {
        const alone = yield* bare(() => handlerFor(kind, said));

        // (h) the start line, (i) the ending line, and both: the in-memory record refuses them.
        const ending = (line: Line) => line._tag !== "started" && line._tag !== "heartbeat";

        const got = yield* run(
          () => handlerFor(kind, said),
          {},
          (_key, line) => (failing === "start" ? line._tag === "started" : failing === "end" ? ending(line) : true),
        );

        expect(got.outcome).toEqual(alone.outcome);
        expect(got.shown.said).toEqual(alone.said);
        expect(got.shown.errors).toHaveLength(1);

        // (j) a folder that cannot be made: its parent is a file.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* temp;
        yield* fs.writeFileString(`${root}/blocker`, "a file, not a folder");

        const blocked = yield* runOn(LandLogFs.layer(`${root}/blocker/land`), () => handlerFor(kind, said));
        expect(blocked.outcome).toEqual(alone.outcome);
        expect(blocked.shown.said).toEqual(alone.said);
        expect(blocked.shown.errors).toHaveLength(1);
      }).pipe(Effect.provide(NodeServices.layer)),
    { arbitrary: { seed: 2347, runs: runsFor({ fast: 30, full: 100 }) } },
  );
});

// ---------------------------------------------------------------- L5: the heartbeat

describe("around: a heartbeat line each period while the command lives, and none after it ends", () => {
  // Plants: leave the heartbeat running after the end, so a line follows it (red); read the period as seconds (red: more lines).
  it.effect.prop(
    "L5 property: while the command lives it writes one heartbeat line each period; none follows its end, and an interrupt stops them too",
    {
      minutes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60 })),
      periods: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
      // A length of the run that is a whole number of periods and a part of one: never on a heartbeat's own second.
      part: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 59 })),
      interruptAt: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
    },
    ({ minutes, periods, part, interruptAt }) =>
      Effect.gen(function* () {
        const period = Duration.minutes(minutes);
        const length = Duration.sum(Duration.times(period, periods), Duration.seconds(part));
        const world = LandLogTest.world();
        const shown = terminal();

        const fiber = yield* Effect.forkChild(
          Effect.exit(Recorded.around(spec({ every: period }), () => Effect.sleep(length).pipe(Effect.as(1)))(PR)).pipe(
            Effect.provide(LandLogTest.layer(world)),
            Effect.provideService(Console.Console, shown.console),
          ),
        );

        yield* TestClock.adjust(length);
        yield* Fiber.join(fiber);

        const lines = LandLogTest.lines(world, forPr(PR));
        expect(lines.map((line) => line._tag)).toEqual([
          "started",
          ...Array.from({ length: periods }, () => "heartbeat"),
          "done",
        ]);

        // No line follows the end, however long the clock runs on.
        yield* TestClock.adjust(Duration.times(period, 10));
        expect(LandLogTest.lines(world, forPr(PR))).toEqual(lines);

        // A heartbeat write that began just before the end is finished first, so the ending is the last line.
        expect((yield* endingDuringHeartbeat(period)).map((line) => line._tag)).toEqual([
          "started",
          "heartbeat",
          "done",
        ]);

        // An interrupt after `interruptAt` periods: its heartbeats stop with it.
        const cut = yield* interruptedEvery(period, interruptAt);
        expect(cut.map((line) => line._tag)).toEqual([
          "started",
          ...Array.from({ length: interruptAt }, () => "heartbeat"),
          "interrupted",
        ]);
      }),
    { arbitrary: { seed: 2348, runs: runsFor({ fast: 40, full: 100 }) } },
  );
});

/**
 * A command that ends half a second after its first heartbeat began to be written, and whose heartbeat write cannot be stopped once
 * begun and takes a second, as a write already handed to the disk does: the lines the record holds when the clock has run on.
 */
const endingDuringHeartbeat = (period: Duration.Duration) =>
  Effect.gen(function* () {
    const world = LandLogTest.world();

    // The in-memory record, with a slow heartbeat write that an interrupt cannot cut.
    const slow = Layer.effect(
      LandLog,
      Effect.gen(function* () {
        const base = yield* LandLog;

        return LandLog.of({
          ...base,
          append: (key, line) =>
            line._tag === "heartbeat"
              ? Effect.uninterruptible(Effect.sleep(Duration.seconds(1)).pipe(Effect.andThen(base.append(key, line))))
              : base.append(key, line),
        });
      }),
    ).pipe(Layer.provide(LandLogTest.layer(world)));

    const length = Duration.sum(period, Duration.millis(500));

    const fiber = yield* Effect.forkChild(
      Effect.exit(Recorded.around(spec({ every: period }), () => Effect.sleep(length).pipe(Effect.as(1)))(PR)).pipe(
        Effect.provide(slow),
        Effect.provideService(Console.Console, terminal().console),
      ),
    );

    yield* TestClock.adjust(length);
    yield* TestClock.adjust(Duration.seconds(5));
    yield* Fiber.join(fiber);

    return LandLogTest.lines(world, forPr(PR));
  });

/** A command that waits for ever on a heartbeat of `period`, interrupted after `beats` of them, and the clock run on far past it: its lines. */
const interruptedEvery = (period: Duration.Duration, beats: number) =>
  Effect.gen(function* () {
    const world = LandLogTest.world();
    const ready = yield* Deferred.make<void>();

    const fiber = yield* Effect.forkChild(
      Effect.exit(
        Recorded.around(spec({ every: period }), () =>
          Deferred.succeed(ready, undefined).pipe(Effect.andThen(Effect.never)),
        )(PR),
      ).pipe(Effect.provide(LandLogTest.layer(world)), Effect.provideService(Console.Console, terminal().console)),
    );

    yield* Deferred.await(ready);
    yield* TestClock.adjust(Duration.times(period, beats));
    yield* Fiber.interrupt(fiber);
    yield* TestClock.adjust(Duration.times(period, 10));

    return LandLogTest.lines(world, forPr(PR));
  });

// ---------------------------------------------------------------- L6: the heartbeat's setting

describe("every: the heartbeat period is a setting, and a wrong value refuses", () => {
  const read = (value: string) =>
    Recorded.every.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: { LAND_LOG_MINUTES: value } }),
      ),
    );

  // Plant: accept 0 (red: a 0 reads as a period, and the heartbeat spins).
  it.effect.prop(
    "L6 property: LAND_LOG_MINUTES that is not a whole number of at least 1 is refused, naming the variable; a whole number is that many minutes",
    {
      // Not a whole number of at least 1: zero and below, a fraction, or no number at all. (An empty value is no value: the
      // environment provider reads it as unset, as it does for GC_MINUTES, so it takes the default.)
      below: Schema.Int.check(Schema.isLessThanOrEqualTo(0)),
      fraction: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
      word: Schema.Literals(["abc", "five", "NaN", "Infinity", "1 2", " 7", "7 ", "1,5", "0x", "-"]),
      good: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
    },
    ({ below, fraction, word, good }) =>
      Effect.gen(function* () {
        for (const bad of [String(below), `${fraction}.5`, word]) {
          const refused = yield* Effect.flip(read(bad));
          expect(refused.message, bad).toContain("LAND_LOG_MINUTES");
        }

        expect(yield* read(String(good))).toEqual(Duration.minutes(good));
      }),
    { arbitrary: { seed: 2349, runs: runsFor({ fast: 60, full: 200 }) } },
  );
});

// ---------------------------------------------------------------- L8, L9: the reader

/** One attempt's lines as a command leaves them: its start, `beats` heartbeats, and the ending it reached, if any. */
const attemptLines = (pid: number, beats: number, ends: Option.Option<Line["_tag"]>): ReadonlyArray<Line> => {
  const attempt = `${pid}.${pid * 1000}`;
  const at = (n: number) => `2026-11-26T14:0${n}:00.000Z`;

  const ending = Option.map(ends, (tag): Line => {
    const when = at(beats + 1);

    return tag === "done"
      ? Line.cases.done.make({ at: when, attempt, said: ["queued 2351 at 0123abc"] })
      : tag === "refused"
        ? Line.cases.refused.make({ at: when, attempt, check: "queue", reason: "the pull request is closed" })
        : tag === "failed"
          ? Line.cases.failed.make({ at: when, attempt, reason: "gh failed" })
          : Line.cases.interrupted.make({ at: when, attempt });
  });

  return [
    Line.cases.started.make({ at: at(0), attempt, pid, command: "queue", argv: ["queue", "2351"] }),
    ...Array.from({ length: beats }, (_, i) => Line.cases.heartbeat.make({ at: at(i + 1), attempt })),
    ...Option.toArray(ending),
  ];
};

const Ending = Schema.Literals(["done", "refused", "failed", "interrupted"]);

/** Two lists merged in the order the picks say, each kept in its own order: how two commands' lines interleave in one file. */
const interleave = <A>(a: ReadonlyArray<A>, b: ReadonlyArray<A>, picks: ReadonlyArray<boolean>): ReadonlyArray<A> => {
  const [x, y] = [[...a], [...b]];
  const out: Array<A> = [];

  for (const pick of picks) {
    const next = (pick ? x : y).shift() ?? (pick ? y : x).shift();

    if (next !== undefined) {
      out.push(next);
    }
  }

  return [...out, ...x, ...y];
};

describe("attempts: a record's lines are read into one attempt each, paired by `attempt` and not by position", () => {
  // Plant: take the file's last line as every attempt's last (red: two attempts interleaved), or the first ending in the file as
  // each one's.
  it.effect.prop(
    "L8 property: two attempts interleaved in one file each get their own last line and standing, and come newest start first",
    {
      beatsA: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
      beatsB: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
      endsA: Schema.Option(Ending),
      endsB: Schema.Option(Ending),
      aliveA: Schema.Boolean,
      aliveB: Schema.Boolean,
      picks: Schema.Array(Schema.Boolean),
    },
    ({ beatsA, beatsB, endsA, endsB, aliveA, aliveB, picks }) =>
      Effect.gen(function* () {
        const a = attemptLines(4021, beatsA, endsA);
        const b = attemptLines(4310, beatsB, endsB);
        const file = interleave(a, b, picks);

        const found = yield* Recorded.attempts(file, (pid) => Effect.succeed(pid === 4021 ? aliveA : aliveB));

        // Newest first is by where the start line stands in the file.
        const startIndex = (own: ReadonlyArray<Line>) => file.indexOf(own[0] ?? file[0]!);
        expect(found.map((attempt) => attempt.pid)).toEqual(
          startIndex(a) > startIndex(b) ? [4021, 4310] : [4310, 4021],
        );

        for (const [own, ends, alive] of [
          [a, endsA, aliveA],
          [b, endsB, aliveB],
        ] as const) {
          const got = found.find((attempt) => attempt.pid === own[0]?.attempt.split(".").map(Number)[0]);
          expect(got?.last).toEqual(own.at(-1));
          expect(got?.standing).toBe(Option.isSome(ends) ? "ended" : alive ? "alive" : "gone");
          expect(got?.startedAt).toBe(own[0]?.at);
        }
      }),
    { arbitrary: { seed: 2350, runs: runsFor({ fast: 60, full: 200 }) } },
  );

  // Plants: call every open attempt gone (red: an alive probe); probe the pid of an ended attempt too (red: the probe log).
  it.effect.prop(
    "L9 property: an open attempt is alive when its pid exists and gone when it does not; an ended attempt is ended and its pid is never asked about",
    {
      beats: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
      ends: Schema.Option(Ending),
      exists: Schema.Boolean,
    },
    ({ beats, ends, exists }) =>
      Effect.gen(function* () {
        const asked: Array<number> = [];

        const found = yield* Recorded.attempts(attemptLines(4021, beats, ends), (pid) =>
          Effect.sync(() => {
            asked.push(pid);

            return exists;
          }),
        );

        expect(found).toHaveLength(1);

        if (Option.isSome(ends)) {
          expect(found[0]?.standing).toBe("ended");
          expect(asked).toEqual([]);
        } else {
          expect(found[0]?.standing).toBe(exists ? "alive" : "gone");
          expect(asked).toEqual([4021]);
        }
      }),
    { arbitrary: { seed: 2351, runs: runsFor({ fast: 60, full: 200 }) } },
  );
});

// ---------------------------------------------------------------- L10, L11: where the lines go

describe("around: each key's lines go to its own file, and a key that cannot be written to never stops the others", () => {
  const Names = Schema.Literals(["t2344", "land-record", "a.b-c_d", "7", "A"]);

  // Names that are no plain name: a slash, `..`, a leading dot, nothing at all, a space. `a/../../escape` walks out of
  // `runs/land` through a folder that exists (made below), which the others cannot.
  const Bad = Schema.Literals(["a/../../escape", "../x", ".hidden", "", "a/b", "/abs", "-x", "x y", "..", "."]);

  // Plant: delete the name check (red: a file lands outside the folder).
  it.effect.prop(
    "L10 property: a pull request writes <pr>.jsonl and a quest writes quest-<name>.jsonl; a quest name that is no plain name writes nothing, outside runs/land or in it, costs one stderr line, and the command goes on",
    { name: Names, bad: Bad, pr: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 99_999 })) },
    ({ name, bad, pr }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* temp;
        const dir = `${root}/land`;
        // A folder an escaping name can walk through.
        yield* fs.makeDirectory(`${dir}/quest-a`, { recursive: true });

        const listing = fs.readDirectory(root, { recursive: true }).pipe(Effect.map((names) => names.toSorted()));

        const good = yield* runOn(LandLogFs.layer(dir), () => Effect.succeed(1), {
          keys: () => [forPr(pr), { _tag: "quest", name }],
        });

        expect(good.outcome).toEqual({ _tag: "success", value: 1 });
        expect(good.shown.errors).toEqual([]);

        for (const file of [`${pr}.jsonl`, `quest-${name}.jsonl`]) {
          const lines = (yield* fs.readFileString(`${dir}/${file}`)).split("\n").filter((line) => line !== "");
          expect(
            lines.map((line) => JSON.parse(line)._tag),
            file,
          ).toEqual(["started", "done"]);
        }

        const before = yield* listing;

        const refused = yield* runOn(LandLogFs.layer(dir), () => Effect.succeed(2), {
          keys: () => [{ _tag: "quest", name: bad }],
        });

        expect(refused.outcome).toEqual({ _tag: "success", value: 2 });
        expect(refused.shown.errors).toHaveLength(1);
        expect(yield* listing).toEqual(before);
      }).pipe(Effect.provide(NodeServices.layer)),
    { arbitrary: { seed: 2352, runs: runsFor({ fast: 40, full: 100 }) } },
  );

  // Plant: stop at the first failed key (red: the keys after it get no line).
  it.effect.prop(
    "L11 property: a command over several pull requests writes every one's file, and one that cannot be written does not stop the others",
    {
      more: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9999 }))).check(
        Schema.isMaxLength(5),
      ),
      pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
    },
    ({ more, pick }) =>
      Effect.gen(function* () {
        // Three to six pull requests, none twice; the one at `pick` cannot be written.
        const prs = Arr.dedupe([10_001, 10_002, 10_003, ...more.map((n) => n + 20_000)]);
        const bad = prs[pick % prs.length] ?? 0;

        const world = LandLogTest.world();
        const shown = terminal();

        const exit = yield* Effect.exit(
          Recorded.around(spec({ keys: () => prs.map(forPr) }), () => Effect.succeed(3))(PR),
        ).pipe(
          Effect.provide(LandLogTest.layer(world, (key) => key._tag === "pr" && key.pr === bad)),
          Effect.provideService(Console.Console, shown.console),
        );

        expect(Exit.isSuccess(exit)).toBe(true);
        expect(shown.errors).toHaveLength(1);

        for (const pr of prs) {
          expect(
            LandLogTest.lines(world, forPr(pr)).map((line) => line._tag),
            `pr ${pr}`,
          ).toEqual(pr === bad ? [] : ["started", "done"]);
        }
      }),
    { arbitrary: { seed: 2353, runs: runsFor({ fast: 40, full: 100 }) } },
  );
});

// ---------------------------------------------------------------- L12: the types

describe("around: it adds nothing to what a handler gives and asks, but the record", () => {
  // Plants: widen the error to `unknown`, or add a service the handler did not need (red: the `toEqualTypeOf` lines). A type law:
  // vitest does not run the compiler, so only the typecheck can fail it.
  it("L12 type: around keeps the handler's success and error types and adds only LandLog to its needs", () => {
    interface Dep {
      readonly dep: true;
    }

    type Handler = (pr: number) => Effect.Effect<string, Failure, Dep>;

    type Wrapped = ReturnType<typeof Recorded.around<number, string, Failure, Dep>>;

    expectTypeOf<Parameters<typeof Recorded.around<number, string, Failure, Dep>>[1]>().toEqualTypeOf<Handler>();
    expectTypeOf<Wrapped>().toEqualTypeOf<(input: number) => Effect.Effect<string, Failure, Dep | LandLog>>();
    expectTypeOf<Effect.Success<ReturnType<Wrapped>>>().toEqualTypeOf<string>();
    expectTypeOf<Effect.Error<ReturnType<Wrapped>>>().toEqualTypeOf<Failure>();
    expectTypeOf<Effect.Services<ReturnType<Wrapped>>>().toEqualTypeOf<Dep | LandLog>();
  });
});

// ---------------------------------------------------------------- L14: last

describe("last: what `land.ts last` says, in plain words, one line for each attempt", () => {
  const Said = Schema.Literals([
    "queued 2351 at 0123abc",
    "pr 2351: MERGED, merge commit feedface",
    "ci-required: success",
  ]);

  const Reason = Schema.Literals(["the pull request is closed", "it conflicts with main", "ci-required is red"]);

  /** The record holding these attempts' lines, put there through the service as a command would. */
  const holding = (lines: ReadonlyArray<Line>) => {
    const world = LandLogTest.world();

    return {
      world,
      layer: LandLogTest.layer(world),
      fill: Effect.gen(function* () {
        const log = yield* LandLog;
        yield* Effect.forEach(lines, (line) => log.append(forPr(PR), line), { concurrency: 1, discard: true });
      }).pipe(Effect.provide(LandLogTest.layer(world))),
    };
  };

  // Plants: say "ended" for an open attempt (red: the died and still-running cases); leave the age off a dead one's line
  // (red: the age); create a record when none exists (red: the real-folder check); print every attempt of a record whatever
  // `count` is (red: the count).
  it.effect.prop(
    "L14 scenario: each attempt is one line that says how it ended (done with what it printed, refused with its check and reason, failed, interrupted), that it is still running (alive), or that it died with no end line (gone, with the age of its last line); a record with no attempt says so; and it changes nothing",
    {
      ends: Schema.Literals(["done", "refused", "failed", "interrupted", "open"]),
      alive: Schema.Boolean,
      said: Schema.Array(Said),
      reason: Reason,
      old: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 80 })),
      older: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
      count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 })),
    },
    ({ ends, alive, said, reason, old, older, count }) =>
      Effect.gen(function* () {
        // The newest attempt's last line is `old` minutes old; `older` attempts that ended well stand before it.
        const lastAt = 1_000_000_000_000;
        yield* TestClock.setTime(lastAt + old * 60_000);
        const at = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
        const attempt = "4021.4021000";

        const earlier = Array.from({ length: older }, (_, i): ReadonlyArray<Line> => [
          Line.cases.started.make({
            at: at(lastAt - (i + 2) * 3_600_000),
            attempt: `1.${i}`,
            pid: 1,
            command: "wait",
            argv: ["wait", "2351"],
          }),
          Line.cases.done.make({
            at: at(lastAt - (i + 2) * 3_600_000 + 1000),
            attempt: `1.${i}`,
            said: ["ci-required: success"],
          }),
        ]).toReversed();

        const newest: ReadonlyArray<Line> = [
          Line.cases.started.make({
            at: at(lastAt - 60_000),
            attempt,
            pid: 4021,
            command: "queue",
            argv: ["queue", "2351", "--wait-ci"],
          }),
          ...(ends === "open"
            ? [Line.cases.heartbeat.make({ at: at(lastAt), attempt })]
            : ends === "done"
              ? [Line.cases.done.make({ at: at(lastAt), attempt, said })]
              : ends === "refused"
                ? [Line.cases.refused.make({ at: at(lastAt), attempt, check: "queue", reason })]
                : ends === "failed"
                  ? [Line.cases.failed.make({ at: at(lastAt), attempt, reason })]
                  : [Line.cases.interrupted.make({ at: at(lastAt), attempt })]),
        ];

        const held = holding([...earlier.flat(), ...newest]);
        yield* held.fill;
        const before = structuredClone([...held.world.records]);

        const said_ = yield* Recorded.last({ key: forPr(PR), count, alive: () => Effect.succeed(alive) }).pipe(
          Effect.provide(held.layer),
        );

        // One line each, the newest first, and no more than `count`.
        expect(said_).toHaveLength(Math.min(count, older + 1));
        const first = said_[0] ?? "";
        expect(first).toContain("queue");

        if (ends === "done" && said.length > 0) {
          expect(first).toContain(said.at(-1));
        }

        if (ends === "refused") {
          expect(first).toContain("queue");
          expect(first).toContain(reason);
        }

        if (ends === "failed") {
          expect(first).toContain(reason);
        }

        if (ends === "open") {
          expect(first).toContain("4021");

          if (alive) {
            expect(first).toContain("still running");
            expect(first).not.toContain("died");
          } else {
            expect(first).toContain("died");
            expect(first).toContain(`${old} min`);
            expect(first).not.toContain("still running");
          }
        } else {
          expect(first).not.toContain("died");
          expect(first).not.toContain("still running");
        }

        // A read changes nothing.
        expect([...held.world.records]).toEqual(before);

        // No record: one line that says so, and the record is still none.
        const none = LandLogTest.world();

        const nothing = yield* Recorded.last({ key: forPr(7), count, alive: () => Effect.succeed(alive) }).pipe(
          Effect.provide(LandLogTest.layer(none)),
        );

        expect(nothing).toHaveLength(1);
        expect(nothing[0]).toContain("no record");
        expect(none.records.size).toBe(0);

        // On a real folder, a read makes no folder and no file.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* temp;
        yield* Recorded.last({ key: forPr(7), count, alive: () => Effect.succeed(alive) }).pipe(
          Effect.provide(LandLogFs.layer(`${root}/land`)),
        );
        expect(yield* fs.readDirectory(root)).toEqual([]);
      }).pipe(Effect.provide(NodeServices.layer)),
    { arbitrary: { seed: 2354, runs: runsFor({ fast: 40, full: 100 }) } },
  );
});
