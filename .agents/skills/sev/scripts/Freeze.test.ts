// Today's lead tooling. The sev0 cancel loop's laws (decision 0532) on the test layers: nothing here
// asks GitHub. The log goes to a temporary folder, and the test clock drives the beats.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Recorder, runsFor } from "@kampus/vitest";
import { Array as Arr, String as Str, pipe, DateTime, Duration, Effect, Fiber, FileSystem, Schema } from "effect";
import type { Scope } from "effect";
import { TestClock } from "effect/testing";
import * as Freeze from "./Freeze.ts";
import * as Level from "./Level.ts";
import { Run, WorkflowRuns, WorkflowRunsError } from "./WorkflowRuns.ts";
import * as WorkflowRunsTest from "./WorkflowRunsTest.ts";

const FIX = "fabrikalfa/ci-cache";

const AT = "2026-11-14T19:00:00.000Z";

const made = (id: number, over: Partial<Run>): Run => ({
  id,
  workflow: "check",
  event: "pull_request",
  branch: "fabrikalfa/some-feature",
  sha: pipe("a", Str.repeat(40)),
  status: "in_progress",
  conclusion: null,
  created: AT,
  ...over,
});

const queue = made(1, { event: "merge_group", branch: "gh-readonly-queue/main/pr-1240-6fe17ff" });

const fixPr = made(2, { branch: FIX });

const mainPush = made(3, { event: "push", branch: "main" });

const otherPr = made(4, {});

const done = made(5, { status: "completed", conclusion: "success" });

const dispatched = made(6, { event: "workflow_dispatch", workflow: "scheduled", branch: "main" });

/** What GitHub answered each cancel of a run stuck in `queued` on 2026-11-18, read through `gh api -i`. */
const STUCK = WorkflowRunsError.make({
  reason:
    "gh api repos/kamp-us/tea-fabrika/actions/runs/43096104693/cancel exited 1: gh: Cannot cancel a workflow run that has not been queued yet. (HTTP 409)",
  status: 409,
});

/** The 502 GitHub gave one cancel that night: line 351 of that sev0's log. */
const BAD_GATEWAY = WorkflowRunsError.make({
  reason:
    "gh run cancel exited 1: HTTP 502: Server Error (https://api.github.com/repos/kamp-us/tea-fabrika/actions/runs/43096102409/cancel)",
  status: 502,
});

/** A cancel with no answer at all: gh's words when it cannot reach GitHub. */
const OFFLINE = WorkflowRunsError.make({
  reason: "gh api repos/kamp-us/tea-fabrika/actions/runs/1/cancel exited 1: error connecting to api.github.com",
  status: null,
});

/** A refusal of `status`, as the gh layer makes one. */
const answered = (status: number | null) =>
  WorkflowRunsError.make({ reason: `gh api exited 1: (HTTP ${status ?? "none"})`, status });

/** A beat short enough that a property runs many cases quickly. */
const BEAT = Duration.seconds(2);

/**
 * A 4xx that is not a rate limit: the gh layer makes every 429, and every 403 that names a rate
 * limit, a `RateLimited`, so a refusal never carries 429.
 */
const Status4xx = Schema.Union([
  Schema.Int.check(Schema.isBetween({ minimum: 400, maximum: 428 })),
  Schema.Int.check(Schema.isBetween({ minimum: 430, maximum: 499 })),
]);

const Status5xx = Schema.Int.check(Schema.isBetween({ minimum: 500, maximum: 599 }));

/** How many cases a loop property runs: each one runs a real loop on the test clock. */
const LOOP_RUNS = { arbitrary: { runs: runsFor({ fast: 6, full: 40 }) } };

/** A fresh folder for the log, removed when the law ends. */
const home = Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeTempDirectoryScoped({ prefix: "sev-" }));

/** Lets the real file reads and writes of forked fibers finish, outside the test clock. */
const settle = TestClock.withLive(Effect.sleep(Duration.millis(20)));

/** Moves the test clock a second at a time until `holds` is true, at most two minutes. */
const until = Effect.fnUntraced(function* <E, R>(holds: Effect.Effect<boolean, E, R>) {
  for (let left = 120; left > 0; left -= 1) {
    yield* settle;

    if (yield* holds) {
      return;
    }

    yield* TestClock.adjust(Duration.seconds(1));
  }

  return yield* Effect.die("the condition never held");
});

/** Moves the test clock a second at a time for `seconds`, letting the loop's file work finish each time. */
const pass = Effect.fnUntraced(function* (seconds: number) {
  for (let left = seconds; left > 0; left -= 1) {
    yield* settle;
    yield* TestClock.adjust(Duration.seconds(1));
  }

  yield* settle;
});

/** Moves the test clock until `fiber` has ended, then answers what it ended with. */
const finished = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.andThen(until(Effect.sync(() => fiber.pollUnsafe() !== undefined)), Fiber.join(fiber));

const tags = (dir: string) => Effect.map(Level.log(dir), (entries) => Arr.map(entries, (e) => e._tag));

/** Every call the loops made to GitHub, in order. */
const calls = Recorder.calls(WorkflowRuns);

/** How many times the loops listed the runs. */
const lists = Effect.map(Recorder.calls(WorkflowRuns, "unfinished"), (all) => all.length);

/** How many times the loops asked GitHub to cancel run `id`. */
const asked = (id: number) =>
  Effect.map(Recorder.calls(WorkflowRuns, "cancel"), (all) => Arr.filter(all, ([c]) => c === id).length);

/** The runs the loops asked GitHub to cancel, in order, answered or refused. */
const cancels = Effect.map(
  Recorder.calls(WorkflowRuns, "cancel"),
  Arr.map(([id]) => id),
);

/**
 * A law on the files, in a scope, with GitHub in memory over `github` for the whole law: every loop
 * it starts asks the same GitHub, and the Recorder keeps each call.
 */
const law = <A, E>(
  body: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope | WorkflowRuns | Recorder.Recorded<WorkflowRuns>>,
  github: WorkflowRunsTest.World = WorkflowRunsTest.world(),
  given: Parameters<typeof WorkflowRunsTest.layer>[1] = {},
) =>
  body.pipe(Effect.provide(WorkflowRunsTest.layer(github, given)), Effect.scoped, Effect.provide(NodeServices.layer));

const opened = (dir: string, allow: ReadonlyArray<string>) =>
  Level.write(dir, Level.Entry.cases.opened.make({ at: AT, by: "owner", reason: "CI is too slow", allow, issues: [] }));

const closed = (dir: string) => Level.write(dir, Level.Entry.cases.closed.make({ at: AT, by: "lead" }));

/** A cancel loop forked over the sev0 open in `dir`, once it has said it started. */
const forked = Effect.fnUntraced(function* (dir: string, every: Duration.Duration = Duration.seconds(20)) {
  const loops = Effect.map(tags(dir), (t) => Arr.filter(t, (tag) => tag === "looping").length);
  const before = yield* loops;
  const loop = yield* Effect.forkChild(Freeze.loop(dir, every, 7));
  yield* until(Effect.map(loops, (n) => n > before));

  return loop;
});

/** A sev0 opened in `dir` with its loop forked, once the loop has said it started. */
const started = (dir: string, allow: ReadonlyArray<string> = [], every?: Duration.Duration) =>
  Effect.andThen(opened(dir, allow), forked(dir, every));

/** Closes the sev0 in `dir`, then waits for its loop as `close` does, moving the clock for it. */
const ending = (dir: string, wait: Duration.Duration = Duration.seconds(60)) =>
  Effect.andThen(closed(dir), Effect.flatMap(Effect.forkChild(Freeze.ended(dir, wait)), finished));

/** Runs counting from `from`, each one a pull request run the verdict cancels. */
const runsFrom = (from: number, count: number) => Arr.makeBy(count, (i) => made(from + i, {}));

describe("verdict", () => {
  it.each([
    { run: queue, allow: [], is: "keep queue" },
    { run: { ...queue, branch: FIX }, allow: [], is: "keep queue" },
    { run: fixPr, allow: [FIX], is: "keep allowed" },
    { run: made(7, { event: "push", branch: FIX }), allow: [FIX], is: "keep allowed" },
    { run: mainPush, allow: [FIX], is: "cancel" },
    { run: otherPr, allow: [FIX], is: "cancel" },
    { run: dispatched, allow: [FIX], is: "cancel" },
    { run: made(8, { branch: `${FIX}-2` }), allow: [FIX], is: "cancel" },
    { run: made(9, { branch: "fabrikalfa/ci" }), allow: [FIX], is: "cancel" },
    { run: fixPr, allow: [], is: "cancel" },
  ])("vector: $run.event on $run.branch with $allow.length allowed is $is", ({ run, allow, is }) => {
    const v = Freeze.verdict(run, allow);
    expect(v._tag === "keep" ? `keep ${v.reason}` : v._tag).toBe(is);
  });

  it.prop(
    "property: a merge queue run is kept whatever its branch and the allow list, so the script never takes an entry out of the queue",
    { run: Run, allow: Schema.Array(Schema.String) },
    ({ run, allow }) => Freeze.verdict({ ...run, event: "merge_group" }, allow)._tag === "keep",
  );

  it.prop(
    "property: any other run is kept exactly when its branch is on the allow list",
    { run: Run, allow: Schema.Array(Schema.String), listed: Schema.Boolean },
    ({ run, allow, listed }) => {
      const other = { ...run, event: run.event === "merge_group" ? "push" : run.event };
      const list = listed ? [...allow, other.branch] : Arr.filter(allow, (b) => b !== other.branch);

      return (Freeze.verdict(other, list)._tag === "keep") === listed;
    },
  );
});

describe("the cancel loop", () => {
  it.effect("scenario: each beat cancels every run but the queue's and the fix branch's, and a close ends it", () => {
    const github = WorkflowRunsTest.world([queue, fixPr, mainPush, otherPr, done, dispatched]);

    return law(
      Effect.gen(function* () {
        const dir = yield* home;
        const loop = yield* started(dir, [FIX]);
        yield* until(Effect.map(cancels, (ids) => ids.length === 3));
        expect(yield* cancels).toEqual([3, 4, 6]);

        // A run that starts later is canceled on the next beat.
        github.runs.push(made(20, {}));
        yield* until(Effect.map(cancels, (ids) => ids.length === 4));
        expect((yield* cancels).at(-1)).toBe(20);

        expect(yield* ending(dir)).toBe("answered");
        yield* finished(loop);
        expect(yield* tags(dir)).toEqual([
          "opened",
          "looping",
          "canceled",
          "canceled",
          "canceled",
          "canceled",
          "closed",
          "ended",
        ]);
        expect((yield* Level.log(dir)).at(-1)).toMatchObject({ by: "loop" });

        // Nothing is canceled once it closed, however many beats pass.
        github.runs.push(made(21, {}));
        yield* TestClock.adjust(Duration.seconds(60));
        yield* settle;
        expect(yield* cancels).toHaveLength(4);
      }),
      github,
    );
  });

  it.effect("scenario: a branch allowed while the loop runs is kept from then on", () => {
    const github = WorkflowRunsTest.world([queue]);

    return law(
      Effect.gen(function* () {
        const dir = yield* home;
        const loop = yield* started(dir);
        yield* Level.write(dir, Level.Entry.cases.allowed.make({ at: AT, branch: FIX }));
        github.runs.push(fixPr, otherPr);
        yield* until(Effect.map(cancels, (ids) => ids.length === 1));
        yield* TestClock.adjust(Duration.seconds(40));
        yield* settle;
        expect(yield* cancels).toEqual([4]);

        yield* ending(dir);
        yield* finished(loop);
      }),
      github,
    );
  });

  it.effect("scenario: next makes one fix the whole allow list, so the fix before it is canceled from then on", () => {
    const github = WorkflowRunsTest.world([fixPr]);

    return law(
      Effect.gen(function* () {
        const dir = yield* home;
        const LEGS = "fabrikalfa/ci-legs";
        const loop = yield* started(dir, [FIX, "fabrikalfa/ci-flake"]);
        yield* TestClock.adjust(Duration.seconds(40));
        yield* settle;
        expect(yield* cancels).toEqual([]);

        yield* Level.write(dir, Level.Entry.cases.next.make({ at: AT, branch: LEGS, before: [FIX] }));
        github.runs.push(made(21, { branch: LEGS }));
        yield* until(Effect.map(cancels, (ids) => ids.length === 1));
        yield* TestClock.adjust(Duration.seconds(40));
        yield* settle;
        expect(yield* cancels).toEqual([2]);

        yield* ending(dir);
        yield* finished(loop);
      }),
      github,
    );
  });

  it.effect("scenario: the loop is refused with no sev0 open", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        const refused = yield* Effect.flip(Freeze.loop(dir, Duration.seconds(20), 7));
        expect(refused).toMatchObject({ _tag: "Refused", reason: "no sev0 is open" });
        expect(yield* calls).toEqual([]);
      }),
    ),
  );

  it.effect("scenario: a close no loop answers writes the end itself once its wait is over", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        // A loop that died: it said it started, and nothing reads the log any more.
        yield* Fiber.interrupt(yield* started(dir));

        expect(yield* ending(dir)).toBe("unanswered");
        expect((yield* Level.log(dir)).at(-1)).toMatchObject({ _tag: "ended", by: "close" });
        expect(Freeze.running(yield* Level.log(dir))).toBe(0);
      }),
    ),
  );

  it.effect("scenario: a failed cancel is logged and the beat goes on", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        const loop = yield* started(dir);
        yield* until(Effect.map(tags(dir), (t) => Arr.filter(t, (tag) => tag === "failed").length === 2));
        yield* ending(dir);
        yield* finished(loop);
        const failed = Arr.filter(yield* Level.log(dir), (e) => e._tag === "failed");
        expect(Arr.map(failed, (e) => [e.call, e.id, e.reason])).toEqual([
          ["cancel", 4, "gh run cancel exited 1: completed"],
          ["cancel", 3, "gh run cancel exited 1: completed"],
        ]);
      }),
      WorkflowRunsTest.world([otherPr, mainPush]),
      { failing: { cancel: WorkflowRunsError.make({ reason: "gh run cancel exited 1: completed", status: null }) } },
    ),
  );

  it.effect.prop(
    "property: a cancel GitHub answers with a 4xx is asked once in a sev0, however many beats pass and however often the loop starts again",
    {
      statuses: Schema.Array(Status4xx).check(Schema.isMaxLength(3)),
      beats: Schema.Literals([1, 2, 4]),
      restart: Schema.Boolean,
    },
    ({ statuses, beats, restart }) => {
      // Tonight's 409 is in every case: the twelve stuck runs that spent the limit.
      const refusals = [STUCK, ...Arr.map(statuses, answered)];
      const runs = runsFrom(100, refusals.length);

      const github = WorkflowRunsTest.world(
        runs,
        Arr.map(refusals, (e, i) => [100 + i, e] as const),
      );

      return law(
        Effect.gen(function* () {
          const dir = yield* home;
          const first = yield* started(dir, [], BEAT);
          yield* pass(beats * 2);

          const loop = restart ? yield* Effect.andThen(Fiber.interrupt(first), forked(dir, BEAT)) : first;
          yield* pass(beats * 2);

          // GitHub still lists every one, beat after beat.
          expect(yield* lists).toBeGreaterThan(beats);

          for (const run of runs) {
            expect(yield* asked(run.id)).toBe(1);
          }

          expect(Arr.filter(yield* tags(dir), (tag) => tag === "refused")).toHaveLength(runs.length);

          yield* ending(dir, Duration.seconds(6));
          yield* finished(loop);
        }),
        github,
      );
    },
    LOOP_RUNS,
  );

  it.effect.prop(
    "property: a cancel GitHub answers with a 5xx or not at all is asked again each beat, and canceled once GitHub takes it",
    {
      statuses: Schema.Array(Schema.NullOr(Status5xx)).check(Schema.isMaxLength(3)),
      beats: Schema.Literals([1, 2, 4]),
    },
    ({ statuses, beats }) => {
      // Tonight's 502, and a cancel no answer came back for, are in every case.
      const refusals = [BAD_GATEWAY, OFFLINE, ...Arr.map(statuses, answered)];
      const runs = runsFrom(200, refusals.length);

      const github = WorkflowRunsTest.world(
        runs,
        Arr.map(refusals, (e, i) => [200 + i, e] as const),
      );

      return law(
        Effect.gen(function* () {
          const dir = yield* home;
          const loop = yield* started(dir, [], BEAT);
          yield* pass(beats * 2);

          // Each beat lists the runs once and asks again about every one.
          const even = Effect.gen(function* () {
            const listed = yield* lists;
            const counts = yield* Effect.forEach(runs, (run) => asked(run.id), { concurrency: 1 });

            return listed > beats && Arr.every(counts, (n) => n === listed);
          });

          yield* until(even);
          expect(Arr.filter(yield* tags(dir), (tag) => tag === "refused")).toEqual([]);

          // GitHub answers again, and the next beat cancels them all.
          github.refusing.clear();
          yield* until(Effect.map(tags(dir), (t) => Arr.filter(t, (tag) => tag === "canceled").length === runs.length));

          yield* ending(dir, Duration.seconds(6));
          yield* finished(loop);
        }),
        github,
      );
    },
    LOOP_RUNS,
  );

  it.effect.prop(
    "property: a run GitHub refused in one sev0 is asked once more in the next",
    { statuses: Schema.Array(Status4xx).check(Schema.isMaxLength(3)) },
    ({ statuses }) => {
      const refusals = [STUCK, ...Arr.map(statuses, answered)];
      const runs = runsFrom(300, refusals.length);

      const github = WorkflowRunsTest.world(
        runs,
        Arr.map(refusals, (e, i) => [300 + i, e] as const),
      );

      return law(
        Effect.gen(function* () {
          const dir = yield* home;
          const first = yield* started(dir, [], BEAT);
          yield* until(Effect.map(cancels, (ids) => ids.length === runs.length));
          yield* ending(dir, Duration.seconds(6));
          yield* finished(first);

          const second = yield* started(dir, [], BEAT);
          yield* until(Effect.map(cancels, (ids) => ids.length === 2 * runs.length));
          yield* pass(4);

          for (const run of runs) {
            expect(yield* asked(run.id)).toBe(2);
          }

          yield* ending(dir, Duration.seconds(6));
          yield* finished(second);
        }),
        github,
      );
    },
    LOOP_RUNS,
  );

  it.effect.prop(
    "property: a rate limit ends the beat at once, and no loop asks GitHub anything more until the limit resets",
    {
      count: Schema.Literals([1, 2, 3]),
      left: Schema.Literals([0, 1, 2, 3]),
      wait: Schema.Int.check(Schema.isBetween({ minimum: 3, maximum: 12 })),
      restart: Schema.Boolean,
    },
    ({ count, left, wait, restart }) =>
      Effect.gen(function* () {
        const runs = runsFrom(400, count);
        // The limit is spent within the first beat: after the list and `answered - 1` cancels.
        const answers = Math.min(left, count);
        const reset = DateTime.add(yield* DateTime.now, { seconds: wait });

        return yield* law(
          Effect.gen(function* () {
            const dir = yield* home;
            const first = yield* started(dir, [], BEAT);
            yield* until(Effect.map(tags(dir), (t) => t.includes("limited")));

            // The calls GitHub answered, then the one it refused; nothing after it in that beat.
            const spent = yield* calls;
            expect(spent).toHaveLength(answers + 1);
            expect(spent.at(-1)).toEqual(
              answers === 0 ? { method: "unfinished", args: [] } : { method: "cancel", args: [400 + answers - 1] },
            );
            expect((yield* Level.log(dir)).at(-1)).toMatchObject({ _tag: "limited", until: reset });

            // A loop started again inside the limit waits it out too.
            const loop = restart ? yield* Effect.andThen(Fiber.interrupt(first), forked(dir, BEAT)) : first;
            yield* pass(wait - 1);
            expect(yield* calls).toEqual(spent);

            // From the reset on, the loop lists and cancels again: a rate limit refuses no run for good.
            yield* until(Effect.map(tags(dir), (t) => Arr.filter(t, (tag) => tag === "canceled").length === count));
            expect(DateTime.isGreaterThanOrEqualTo(yield* DateTime.now, reset)).toBe(true);
            expect(Arr.filter(yield* tags(dir), (tag) => tag === "limited")).toHaveLength(1);
            expect(Arr.filter(yield* tags(dir), (tag) => tag === "failed" || tag === "refused")).toEqual([]);

            yield* ending(dir, Duration.seconds(6));
            yield* finished(loop);
          }),
          WorkflowRunsTest.world(runs),
          { limit: { left: answers, reset } },
        );
      }),
    LOOP_RUNS,
  );
});

describe("delay", () => {
  it.prop(
    "property: the loop rests one beat, or until GitHub takes calls again when that is later",
    {
      every: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 120 })),
      offset: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: -7200, maximum: 7200 }))),
    },
    ({ every, offset }) => {
      const now = DateTime.makeUnsafe("2026-11-18T10:01:42Z");
      const until = offset === null ? null : DateTime.add(now, { seconds: offset });
      expect(Duration.toSeconds(Freeze.delay(Duration.seconds(every), until, now))).toBe(
        offset === null ? every : Math.max(every, offset),
      );

      // Tonight's reset, 10:08:55, seen at 10:01:42 with a beat of 20 seconds.
      expect(
        Duration.toSeconds(Freeze.delay(Duration.seconds(20), DateTime.makeUnsafe("2026-11-18T10:08:55Z"), now)),
      ).toBe(433);
    },
  );
});
