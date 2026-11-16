// Today's lead tooling. The sev0 cancel loop's laws (decision 0532) on the test layers: nothing here
// asks GitHub. The log goes to a temporary folder, and the test clock drives the beats.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, FileSystem, Fiber, Schema, type Scope } from "effect";
import { TestClock } from "effect/testing";
import * as Freeze from "./Freeze.ts";
import * as Level from "./Level.ts";
import { Run } from "./WorkflowRuns.ts";
import * as WorkflowRunsTest from "./WorkflowRunsTest.ts";

const FIX = "fabrikalfa/ci-cache";

const AT = "2026-11-14T19:00:00.000Z";

const made = (id: number, over: Partial<Run>): Run => ({
  id,
  workflow: "check",
  event: "pull_request",
  branch: "fabrikalfa/some-feature",
  sha: "a".repeat(40),
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

/** Moves the test clock until `fiber` has ended, then answers what it ended with. */
const finished = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.andThen(until(Effect.sync(() => fiber.pollUnsafe() !== undefined)), Fiber.join(fiber));

const tags = (dir: string) => Effect.map(Level.log(dir), (entries) => entries.map((e) => e._tag));

const law = <A, E>(body: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>) =>
  body.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const opened = (dir: string, allow: ReadonlyArray<string>) =>
  Level.write(dir, Level.Entry.cases.opened.make({ at: AT, by: "owner", reason: "CI is too slow", allow, issues: [] }));

const closed = (dir: string) => Level.write(dir, Level.Entry.cases.closed.make({ at: AT, by: "lead" }));

/** A sev0 opened in `dir` with its loop forked over `github`, once the loop has said it started. */
const started = Effect.fnUntraced(function* (
  dir: string,
  github: WorkflowRunsTest.World,
  given: { readonly allow?: ReadonlyArray<string>; readonly failing?: WorkflowRunsTest.Failing } = {},
) {
  yield* opened(dir, given.allow ?? []);

  const loop = yield* Freeze.loop(dir, Duration.seconds(20), 7).pipe(
    Effect.provide(WorkflowRunsTest.layer(github, given.failing)),
    Effect.forkChild,
  );

  yield* until(Effect.map(tags(dir), (t) => t.includes("looping")));

  return loop;
});

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
    expect(Freeze.Verdict.isAnyOf(["keep"])(v) ? `keep ${v.reason}` : v._tag).toBe(is);
  });

  it.prop(
    "property: a merge queue run is kept whatever its branch and the allow list, so the script never takes an entry out of the queue",
    { run: Run, allow: Schema.Array(Schema.String) },
    ({ run, allow }) => Freeze.Verdict.isAnyOf(["keep"])(Freeze.verdict({ ...run, event: "merge_group" }, allow)),
  );

  it.prop(
    "property: any other run is kept exactly when its branch is on the allow list",
    { run: Run, allow: Schema.Array(Schema.String), listed: Schema.Boolean },
    ({ run, allow, listed }) => {
      const other = { ...run, event: run.event === "merge_group" ? "push" : run.event };
      const list = listed ? [...allow, other.branch] : allow.filter((b) => b !== other.branch);

      return Freeze.Verdict.isAnyOf(["keep"])(Freeze.verdict(other, list)) === listed;
    },
  );
});

describe("the cancel loop", () => {
  it.effect("scenario: each beat cancels every run but the queue's and the fix branch's, and a close ends it", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        const github = WorkflowRunsTest.world([queue, fixPr, mainPush, otherPr, done, dispatched]);
        const loop = yield* started(dir, github, { allow: [FIX] });
        yield* until(Effect.sync(() => github.calls.length === 3));
        expect(github.calls.map((c) => c.id)).toEqual([3, 4, 6]);

        // A run that starts later is canceled on the next beat.
        github.runs.push(made(20, {}));
        yield* until(Effect.sync(() => github.calls.length === 4));
        expect(github.calls.at(-1)?.id).toBe(20);

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
        expect(github.calls).toHaveLength(4);
      }),
    ),
  );

  it.effect("scenario: a branch allowed while the loop runs is kept from then on", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        const github = WorkflowRunsTest.world([queue]);
        const loop = yield* started(dir, github);
        yield* Level.write(dir, Level.Entry.cases.allowed.make({ at: AT, branch: FIX }));
        github.runs.push(fixPr, otherPr);
        yield* until(Effect.sync(() => github.calls.length === 1));
        yield* TestClock.adjust(Duration.seconds(40));
        yield* settle;
        expect(github.calls.map((c) => c.id)).toEqual([4]);

        yield* ending(dir);
        yield* finished(loop);
      }),
    ),
  );

  it.effect("scenario: next makes one fix the whole allow list, so the fix before it is canceled from then on", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        const LEGS = "fabrikalfa/ci-legs";
        const github = WorkflowRunsTest.world([fixPr]);
        const loop = yield* started(dir, github, { allow: [FIX, "fabrikalfa/ci-flake"] });
        yield* TestClock.adjust(Duration.seconds(40));
        yield* settle;
        expect(github.calls).toEqual([]);

        yield* Level.write(dir, Level.Entry.cases.next.make({ at: AT, branch: LEGS, before: [FIX] }));
        github.runs.push(made(21, { branch: LEGS }));
        yield* until(Effect.sync(() => github.calls.length === 1));
        yield* TestClock.adjust(Duration.seconds(40));
        yield* settle;
        expect(github.calls.map((c) => c.id)).toEqual([2]);

        yield* ending(dir);
        yield* finished(loop);
      }),
    ),
  );

  it.effect("scenario: the loop is refused with no sev0 open", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;

        const refused = yield* Effect.flip(
          Freeze.loop(dir, Duration.seconds(20), 7).pipe(
            Effect.provide(WorkflowRunsTest.layer(WorkflowRunsTest.world())),
          ),
        );

        expect(refused).toMatchObject({ _tag: "Refused", reason: "no sev0 is open" });
      }),
    ),
  );

  it.effect("scenario: a close no loop answers writes the end itself once its wait is over", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        // A loop that died: it said it started, and nothing reads the log any more.
        yield* Fiber.interrupt(yield* started(dir, WorkflowRunsTest.world([])));

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
        const github = WorkflowRunsTest.world([otherPr, mainPush]);
        const loop = yield* started(dir, github, { failing: { cancel: "gh run cancel exited 1: completed" } });
        yield* until(Effect.map(tags(dir), (t) => t.filter((tag) => tag === "failed").length === 2));
        yield* ending(dir);
        yield* finished(loop);
        const failed = (yield* Level.log(dir)).filter(Level.Entry.isAnyOf(["failed"]));
        expect(failed.map((e) => [e.call, e.id, e.reason])).toEqual([
          ["cancel", 4, "gh run cancel exited 1: completed"],
          ["cancel", 3, "gh run cancel exited 1: completed"],
        ]);
      }),
    ),
  );
});
