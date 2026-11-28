// B1 to B3 of .kalfa/quests/kalfa-records-bin-flush-PLAN.md (ticket 2302): the bin's teardown, run on a stand-in pair of standard streams.
// Effect's `runMain` calls `process.exit` at once for an exit code that is not 0, so a long output that Node has not written to a
// pipe yet is lost. The teardown holds `onExit` back until both streams have written everything, and keeps a closed reader
// (`EPIPE`) from changing the run's code. The real bin on a real pipe is bin.integration.test.ts (B4 to B6); these three run on
// every pull request.
//
// Assumed exports of `Teardown.ts` (the build writes them):
// - `Streams`: `{ stdout, stderr }`, each with `write(chunk, done)` and `on("error", listener)`: what `process.stdout` and
//   `process.stderr` have, as much as the teardown uses.
// - `teardown(streams)`: `Runtime.Teardown`. Listeners are added when it is called, before the run starts.
//
// The stand-in keeps each write in a queue until the test lets it go, and lets go in the order a real stream does: the oldest
// first, so a write ends only when everything written before it has. Emitting an `error` with no listener throws, as Node's
// emitter does.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Exit, Schema } from "effect";
import { type Streams, teardown } from "./Teardown.ts";

const SEED = 119120;

const RUNS = runsFor({ fast: 50, full: 100 });

/** The cases a property drew: the mutation box caps a property's count to `MUTATE_RUNS`, so a tally is read only after all of them. */
const capped = () => Math.min(RUNS, Number(process.env.MUTATE_RUNS) || RUNS);

type Done = (error?: Error | null) => void;

/** What a stream's `error` listener takes, and so what its `error` event carries: whatever the stream's own type says. */
type Listener = Parameters<Streams["stdout"]["on"]>[1];

type Raised = Parameters<Listener>[0];

/** One write of a stand-in stream, waiting to be let go. `ours` is a write the teardown started. */
interface Write {
  readonly done: Done;
  readonly ours: boolean;
}

/** A stand-in standard stream. */
class Held {
  readonly waiting: Array<Write> = [];
  readonly listeners: Array<Listener> = [];
  /** True from the moment the teardown is called: a write made then is the teardown's. */
  running = false;
  started = 0;
  finished = 0;
  failed = 0;

  write(_chunk: string, done: Done): boolean {
    this.waiting.push({ done, ours: this.running });

    if (this.running) {
      this.started++;
    }

    return true;
  }

  on(_event: "error", listener: Listener): this {
    this.listeners.push(listener);

    return this;
  }

  /** What the stream does when it fails: an `error` event, which throws when nothing listens. */
  emit(error: Raised): void {
    if (this.listeners.length === 0) {
      throw new Error("Unhandled error event: no listener on this stream");
    }

    for (const listener of this.listeners) {
      listener(error);
    }
  }

  /** Lets the oldest write go, with the stream's error for it when it has one. */
  release(error: Error | undefined): void {
    const write = this.waiting.shift();

    if (write === undefined) {
      return;
    }

    if (write.ours) {
      this.finished++;
      this.failed += error === undefined ? 0 : 1;
    }

    write.done(error);
  }
}

const Name = Schema.Literals(["stdout", "stderr"]);

type Name = typeof Name.Type;

/** An `error` a stream emits: a closed reader (Node's `EPIPE`), (f) any other code, or (g) an error with no `code` of its own. */
const Epipe = Schema.Struct({ kind: Schema.Literal("epipe") });

const Issue = Schema.Union([
  Epipe,
  Schema.Struct({ kind: Schema.Literal("other"), code: Schema.Literals(["EIO", "EBADF", "ECONNRESET"]) }),
  Schema.Struct({
    kind: Schema.Literal("codeless"),
    // A plain `Error` is made from the message; the rest are thrown as they are.
    error: Schema.Union([Schema.String, Schema.Null, Schema.Undefined]),
    wrapped: Schema.Boolean,
  }),
]);

type Issue = typeof Issue.Type;

/** What the stream's `error` event carries. */
const raised = (issue: Issue): Raised => {
  switch (issue.kind) {
    case "epipe":
      return Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    case "other":
      return Object.assign(new Error(`write ${issue.code}`), { code: issue.code });
    case "codeless":
      return issue.wrapped ? new Error(String(issue.error)) : issue.error;
  }
};

const Events = Schema.Array(Schema.Struct({ on: Name, issue: Issue })).check(Schema.isBetweenLength(0, 4));

const EpipeEvents = Schema.Array(Schema.Struct({ on: Name, issue: Epipe })).check(Schema.isBetweenLength(1, 4));

/** (a) A success whose value is an integer: the three codes the bin uses, and any other. */
const Answered = Schema.Struct({
  kind: Schema.Literal("number"),
  value: Schema.Union([Schema.Literals([0, 1, 2]), Schema.Int.check(Schema.isBetween({ minimum: -5, maximum: 300 }))]),
});

/** What a run ended with: (a) a number the command answered, (b) a success with something else, or (c) a failure or an interruption. */
const Ended = Schema.Union([
  Answered,
  Schema.Struct({
    kind: Schema.Literal("other"),
    value: Schema.Union([
      Schema.String,
      Schema.Literals(["0", "1", "2"]),
      Schema.Boolean,
      Schema.Undefined,
      Schema.Null,
      Schema.BigInt,
      Schema.Array(Schema.Int),
    ]),
  }),
  Schema.Struct({
    kind: Schema.Literal("failed"),
    form: Schema.Literals(["fail", "die", "interrupt"]),
    value: Schema.Int,
  }),
]);

type Ended = typeof Ended.Type;

const FAILURES = {
  fail: (value: number) => Exit.fail(value),
  die: (value: number) => Exit.die(value),
  interrupt: () => Exit.interrupt(),
} as const;

const toExit = (ended: Ended): Exit.Exit<unknown, unknown> =>
  ended.kind === "failed" ? FAILURES[ended.form](ended.value) : Exit.succeed(ended.value);

/** The order streams are let go in, and which writes end with an error (j). */
const Release = Schema.Struct({
  pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 99 })),
  fail: Schema.Boolean,
});

const Count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }));

/** Writes each stream already holds when the run ends: the output Node has not written yet. */
const Earlier = Schema.Struct({ stdout: Count, stderr: Count });

const Releases = Schema.Array(Release).check(Schema.isBetweenLength(0, 12));

const Scene = Schema.Struct({ earlier: Earlier, events: Events, ended: Ended, releases: Releases });

type Scene = typeof Scene.Type;

/** What `onExit` saw when it was called. */
interface Call {
  readonly code: number;
  readonly waiting: Readonly<Record<Name, number>>;
  readonly finished: Readonly<Record<Name, number>>;
}

/** One run of the teardown: the streams hold their earlier writes, the events happen, the run ends, then the writes are let go. */
const play = (scene: Pick<Scene, "earlier" | "events" | "ended" | "releases">) => {
  const stdout = new Held();
  const stderr = new Held();
  const streams = { stdout, stderr } satisfies Streams;
  const calls: Array<Call> = [];

  for (const name of ["stdout", "stderr"] as const) {
    for (let index = 0; index < scene.earlier[name]; index++) {
      streams[name].write("earlier output", () => undefined);
    }
  }

  const end = teardown(streams);

  for (const { on, issue } of scene.events) {
    streams[on].emit(raised(issue));
  }

  stdout.running = true;
  stderr.running = true;

  end(toExit(scene.ended), (code) => {
    calls.push({
      code,
      waiting: { stdout: stdout.waiting.length, stderr: stderr.waiting.length },
      finished: { stdout: stdout.finished, stderr: stderr.finished },
    });
  });

  for (let step = 0; stdout.waiting.length + stderr.waiting.length > 0 && step < 100; step++) {
    const open = [stdout, stderr].filter((stream) => stream.waiting.length > 0);
    const draw = scene.releases[step] ?? { pick: 0, fail: false };

    open[draw.pick % open.length]?.release(draw.fail ? new Error("write after the stream closed") : undefined);
  }

  return { calls, stdout, stderr };
};

const tally = {
  B1: new Map<string, number>(),
  B2: new Map<string, number>(),
  B3: new Map<string, number>(),
};

const counted = (law: keyof typeof tally, kind: string): void => {
  tally[law].set(kind, (tally[law].get(kind) ?? 0) + 1);
};

// B1. Plants: (h) call `onExit(code)` straight away and skip the writes: it is called while standard output is held; (i) wait for
// standard output only, and start standard error's write with no wait: it is called while standard error is held; (j) call
// `onExit` only when the callback has no error: it is never called; call it in both callbacks: it is called twice.
it.prop(
  "B1 property: onExit runs exactly once, and only after both streams have written everything they held and everything the teardown wrote",
  { scene: Scene },
  ({ scene }) => {
    const { calls, stdout, stderr } = play(scene);

    counted("B1", "case");

    if (scene.earlier.stdout > 0) {
      counted("B1", "output held on standard output");
    }

    if (scene.earlier.stderr > 0) {
      counted("B1", "output held on standard error");
    }

    if (stdout.failed + stderr.failed > 0) {
      counted("B1", "a write of the teardown ended with an error");
    }

    if (scene.events.length > 0) {
      counted("B1", "an error event before the run ended");
    }

    expect(calls, "onExit runs exactly once").toHaveLength(1);

    const [call] = calls;

    expect(call?.waiting.stdout, "standard output holds no write when onExit runs").toBe(0);
    expect(call?.waiting.stderr, "standard error holds no write when onExit runs").toBe(0);
    expect(call?.finished.stdout, "the teardown waited on standard output").toBeGreaterThan(0);
    expect(call?.finished.stderr, "the teardown waited on standard error").toBeGreaterThan(0);
  },
  { arbitrary: { seed: SEED, runs: RUNS } },
);

// B2. Plants: (a) answer 1 for every success; (b) delete the `isNumber` check, so a string becomes the code; (c) answer 0 for a
// failure or an interruption, or 1; (f) ignore every `error`, so an `EIO` keeps the run's code; (g) read `error.code` with no
// `hasProperty`, so `null` throws. Deleting the `isSuccess` check cannot be planted red: a failure has no `value`, so `isNumber`
// refuses it too (see the commit's note).
it.prop(
  "B2 property: the code is the run's number for a success that had no broken stream, and 2 for anything else",
  { scene: Scene },
  ({ scene }) => {
    const { calls } = play(scene);
    const broken = scene.events.some(({ issue }) => issue.kind !== "epipe");

    counted("B2", "case");
    counted("B2", `exit: ${scene.ended.kind}`);

    for (const { issue } of scene.events) {
      counted("B2", `error: ${issue.kind}`);
    }

    if (scene.ended.kind === "number") {
      counted("B2", broken ? "a number with a broken stream" : "a number with no broken stream");
    }

    expect(calls.map(({ code }) => code)).toEqual([scene.ended.kind === "number" && !broken ? scene.ended.value : 2]);
  },
  { arbitrary: { seed: SEED, runs: RUNS } },
);

// B3. Plants: (d) count `EPIPE` as a broken stream: the code is 2; (e) add the listener to standard output only: the event on
// standard error throws.
it.prop(
  "B3 property: an EPIPE on either stream leaves the run's code and throws nothing",
  { scene: Schema.Struct({ earlier: Earlier, events: EpipeEvents, ended: Answered, releases: Releases }) },
  ({ scene }) => {
    const { calls } = play(scene);

    counted("B3", "case");

    for (const { on } of scene.events) {
      counted("B3", `EPIPE on ${on}`);
    }

    expect(calls.map(({ code }) => code)).toEqual([scene.ended.value]);
  },
  { arbitrary: { seed: SEED, runs: RUNS } },
);

// The three laws above draw exactly the cases they are given: their own count, or the box's cap when that is smaller. Each class
// they list was drawn, but only a full run can say so: a capped run draws too few cases to reach every class, so it skips the
// classes. The count is asserted too, so a lost counter or a changed count fails here and never skips quietly.
it("B3 scenario: B1 to B3 drew their cases and reached every class they list", () => {
  const required = {
    B1: [
      "output held on standard output",
      "output held on standard error",
      "a write of the teardown ended with an error",
      "an error event before the run ended",
    ],
    B2: [
      "exit: number",
      "exit: other",
      "exit: failed",
      "error: epipe",
      "error: other",
      "error: codeless",
      "a number with a broken stream",
      "a number with no broken stream",
    ],
    B3: ["EPIPE on stdout", "EPIPE on stderr"],
  } as const;

  for (const law of ["B1", "B2", "B3"] as const) {
    const drawn = tally[law].get("case") ?? 0;

    expect(drawn, `${law} drew its cases`).toBe(capped());

    if (drawn >= RUNS) {
      for (const kind of required[law]) {
        expect(tally[law].get(kind) ?? 0, `${law}, ${kind}: drawn`).toBeGreaterThan(0);
      }
    }
  }
});
