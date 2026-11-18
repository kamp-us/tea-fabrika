// Today's lead tooling. The sev0 cancel loop's laws (decision 0532) on the test layers: nothing here
// asks GitHub. The log goes to a temporary folder, and the test clock drives the beats.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Recorder } from "@kampus/vitest";
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

/** What GitHub answered each cancel of a run stuck in `queued`, on 2026-11-18. */
const STUCK = "gh api exited 1: gh: Cannot cancel a workflow run that has not been queued yet. (HTTP 409)";

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
const forked = Effect.fnUntraced(function* (dir: string) {
  const loops = Effect.map(tags(dir), (t) => Arr.filter(t, (tag) => tag === "looping").length);
  const before = yield* loops;
  const loop = yield* Effect.forkChild(Freeze.loop(dir, Duration.seconds(20), 7));
  yield* until(Effect.map(loops, (n) => n > before));

  return loop;
});

/** A sev0 opened in `dir` with its loop forked, once the loop has said it started. */
const started = (dir: string, allow: ReadonlyArray<string> = []) => Effect.andThen(opened(dir, allow), forked(dir));

/** Closes the sev0 in `dir`, then waits for its loop as `close` does, moving the clock for it. */
const ending = (dir: string) =>
  Effect.andThen(closed(dir), Effect.flatMap(Effect.forkChild(Freeze.ended(dir, Duration.seconds(60))), finished));

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
      { failing: { cancel: WorkflowRunsError.make({ reason: "gh run cancel exited 1: completed" }) } },
    ),
  );

  it.effect(
    "scenario: a run GitHub refuses to cancel is asked once in a sev0, however many beats pass and however often the loop starts again",
    () =>
      law(
        Effect.gen(function* () {
          const dir = yield* home;
          const first = yield* started(dir);
          yield* until(Effect.map(cancels, (ids) => ids.length === 2));

          // GitHub still lists both, beat after beat, and the loop asks again about neither.
          yield* pass(100);
          expect(yield* cancels).toEqual([4, 3]);
          expect(Arr.filter(yield* calls, (c) => c.method === "unfinished").length).toBeGreaterThanOrEqual(5);

          // A loop started again reads the refusals from the log.
          yield* Fiber.interrupt(first);
          const again = yield* forked(dir);
          yield* pass(60);
          expect(yield* cancels).toEqual([4, 3]);
          expect(Arr.filter(yield* tags(dir), (tag) => tag === "failed")).toHaveLength(2);

          yield* ending(dir);
          yield* finished(again);
        }),
        WorkflowRunsTest.world([otherPr, mainPush]),
        { failing: { cancel: WorkflowRunsError.make({ reason: STUCK }) } },
      ),
  );

  it.effect(
    "scenario: a rate limit ends the beat at once, and no loop asks GitHub anything more until the limit resets",
    () => {
      const reset = DateTime.makeUnsafe(70_000);

      return law(
        Effect.gen(function* () {
          const dir = yield* home;
          const first = yield* started(dir);
          yield* until(Effect.map(tags(dir), (t) => t.includes("limited")));

          // The list was answered and the first cancel refused; the second cancel was never asked.
          const spent = [
            { method: "unfinished", args: [] },
            { method: "cancel", args: [4] },
          ];

          expect(yield* calls).toEqual(spent);
          expect((yield* Level.log(dir)).at(-1)).toMatchObject({
            _tag: "limited",
            call: "cancel",
            id: 4,
            until: reset,
          });

          // A loop started again inside the limit waits it out too.
          yield* Fiber.interrupt(first);
          const again = yield* forked(dir);
          yield* pass(65);
          expect(yield* calls).toEqual(spent);

          // From the reset on, the loop lists and cancels again: a rate limit refuses no run for good.
          yield* until(Effect.map(cancels, (ids) => ids.length === 3));
          expect(yield* cancels).toEqual([4, 4, 3]);
          expect(DateTime.isGreaterThanOrEqualTo(yield* DateTime.now, reset)).toBe(true);
          expect(Arr.filter(yield* tags(dir), (tag) => tag === "failed")).toEqual([]);

          yield* ending(dir);
          yield* finished(again);
        }),
        WorkflowRunsTest.world([otherPr, mainPush]),
        { limit: { left: 1, reset } },
      );
    },
  );
});

describe("delay", () => {
  const now = DateTime.makeUnsafe("2026-11-18T10:01:42Z");

  it.each([
    { until: null, is: 20 },
    { until: "2026-11-18T10:08:55Z", is: 433 },
    { until: "2026-11-18T10:01:50Z", is: 20 },
    { until: "2026-11-18T10:00:00Z", is: 20 },
  ])("vector: a beat of 20 seconds, with GitHub taking calls again at $until, rests $is seconds", ({ until, is }) => {
    const wait = Freeze.delay(Duration.seconds(20), until === null ? null : DateTime.makeUnsafe(until), now);
    expect(Duration.toSeconds(wait)).toBe(is);
  });
});
