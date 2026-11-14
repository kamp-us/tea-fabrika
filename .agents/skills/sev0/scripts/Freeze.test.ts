// Today's lead tooling. The sev0 freeze's laws (decision 0532) on the test layers: nothing here asks
// GitHub. The state and the log go to a temporary folder, and the test clock drives the beats.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, FileSystem, Fiber, Layer, Option, Schema, type Scope } from "effect";
import { TestClock } from "effect/testing";
import type { PullRequest } from "../../lead/scripts/pr/PullRequests.ts";
import * as PullRequestsTest from "../../lead/scripts/pr/PullRequestsTest.ts";
import * as Freeze from "./Freeze.ts";
import { Run } from "./WorkflowRuns.ts";
import * as WorkflowRunsTest from "./WorkflowRunsTest.ts";

const FIX = "fabrikalfa/ci-cache";

const made = (id: number, over: Partial<Run>): Run => ({
  id,
  workflow: "check",
  event: "pull_request",
  branch: "fabrikalfa/some-feature",
  sha: "a".repeat(40),
  status: "in_progress",
  conclusion: null,
  created: "2026-11-14T19:00:00Z",
  ...over,
});

const queue = made(1, { event: "merge_group", branch: "gh-readonly-queue/main/pr-1240-6fe17ff" });
const fixPr = made(2, { branch: FIX });
const mainPush = made(3, { event: "push", branch: "main" });
const otherPr = made(4, {});
const done = made(5, { status: "completed", conclusion: "success" });
const dispatched = made(6, { event: "workflow_dispatch", workflow: "mutation", branch: "main" });

/** A fresh folder for the state and the log, removed when the law ends. */
const home = Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeTempDirectoryScoped({ prefix: "sev0-" }));

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

const tags = (home: string) => Effect.map(Freeze.log(home), (entries) => entries.map((e) => e._tag));

const stateTag = (home: string) =>
  Effect.map(
    Freeze.state(home),
    Option.map((s) => s._tag),
  );

const law = <A, E>(body: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>) =>
  body.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

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
    "property: a merge queue run is kept whatever its branch and the allow list, so nothing leaves the queue",
    { run: Run, allow: Schema.Array(Schema.String) },
    ({ run, allow }) => Freeze.verdict({ ...run, event: "merge_group" }, allow)._tag === "keep",
  );

  it.prop(
    "property: any other run is kept exactly when its branch is on the allow list",
    { run: Run, allow: Schema.Array(Schema.String), listed: Schema.Boolean },
    ({ run, allow, listed }) => {
      const other = { ...run, event: run.event === "merge_group" ? "push" : run.event };
      const list = listed ? [...allow, other.branch] : allow.filter((b) => b !== other.branch);
      return (Freeze.verdict(other, list)._tag === "keep") === listed;
    },
  );
});

describe("canceled", () => {
  const cancelled = { status: "completed", conclusion: "cancelled" } as const;

  it("vector: it takes the newest pull request run of each workflow when it ended canceled", () => {
    const runs = [made(10, cancelled), made(11, { ...cancelled, workflow: "host" })];
    expect(Freeze.canceled(runs).map((r) => r.id)).toEqual([10, 11]);
  });

  it("vector: it leaves a canceled run that a newer one replaced", () => {
    expect(Freeze.canceled([made(10, cancelled), made(12, { status: "completed", conclusion: "success" })])).toEqual(
      [],
    );
    expect(Freeze.canceled([made(12, cancelled), made(10, { status: "queued" })]).map((r) => r.id)).toEqual([12]);
  });

  it("vector: it leaves runs that are not pull request runs, and runs that did not end canceled", () => {
    const runs = [
      made(10, { ...cancelled, event: "push" }),
      made(11, { ...cancelled, event: "merge_group", workflow: "queue" }),
      made(12, { workflow: "host", status: "completed", conclusion: "failure" }),
      made(13, { workflow: "mutation", status: "in_progress" }),
    ];
    expect(Freeze.canceled(runs)).toEqual([]);
  });
});

const REPO = "fixture/repo";

/** A freeze started in `dir` over `github`, forked, and the moment its state says frozen. */
const started = Effect.fnUntraced(function* (
  dir: string,
  github: WorkflowRunsTest.World,
  given: { readonly allow?: ReadonlyArray<string>; readonly failing?: WorkflowRunsTest.Failing } = {},
) {
  const start = { home: dir, allow: given.allow ?? [], every: Duration.seconds(20), repo: REPO, pid: 7 };
  const loop = yield* Freeze.freeze(start).pipe(
    Effect.provide(WorkflowRunsTest.layer(github, given.failing)),
    Effect.forkChild,
  );
  yield* until(Effect.map(stateTag(dir), (s) => Option.getOrNull(s) === "frozen"));
  return loop;
});

/** Runs a stop in `dir` to its end, moving the clock for it. */
const stopped = (dir: string) => Effect.flatMap(Effect.forkChild(Freeze.stop(dir, Duration.seconds(60))), finished);

describe("freeze, allow and stop", () => {
  it.effect("scenario: each beat cancels every run but the queue's and the fix branch's, and stop ends the loop", () =>
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

        expect(yield* stopped(dir)).toBe("answered");
        yield* finished(loop);
        expect(yield* tags(dir)).toEqual(["frozen", "canceled", "canceled", "canceled", "canceled", "stopped"]);
        const log = yield* Freeze.log(dir);
        expect(log[0]).toMatchObject({ allow: [FIX], repo: REPO, pid: 7 });
        expect(log.at(-1)).toMatchObject({ by: "loop" });
      }),
    ),
  );

  it.effect("scenario: a branch allowed while the loop runs is kept from then on", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        const github = WorkflowRunsTest.world([queue]);
        const loop = yield* started(dir, github);
        yield* Freeze.allow(dir, FIX);
        yield* Freeze.allow(dir, FIX);
        github.runs.push(fixPr, otherPr);
        yield* until(Effect.sync(() => github.calls.length === 1));
        yield* TestClock.adjust(Duration.seconds(40));
        yield* settle;
        expect(github.calls.map((c) => c.id)).toEqual([4]);
        expect(Option.map(yield* Freeze.state(dir), (s) => (s._tag === "frozen" ? s.allow : []))).toEqual(
          Option.some([FIX]),
        );

        yield* stopped(dir);
        yield* finished(loop);
        expect(yield* tags(dir)).toEqual(["frozen", "allowed", "canceled", "stopped"]);
      }),
    ),
  );

  it.effect("scenario: next makes one fix the whole allow list, so the fix before it is canceled from then on", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        const LEGS = "fabrikalfa/ci-legs";
        expect(yield* Effect.flip(Freeze.next(dir, LEGS))).toMatchObject({ reason: "no freeze is on" });

        const github = WorkflowRunsTest.world([fixPr]);
        const loop = yield* started(dir, github, { allow: [FIX, "fabrikalfa/ci-flake"] });
        yield* TestClock.adjust(Duration.seconds(40));
        yield* settle;
        expect(github.calls).toEqual([]);

        yield* Freeze.next(dir, LEGS);
        const legsPr = made(21, { branch: LEGS });
        github.runs.push(legsPr);
        yield* until(Effect.sync(() => github.calls.length === 1));
        yield* TestClock.adjust(Duration.seconds(40));
        yield* settle;
        expect(github.calls.map((c) => c.id)).toEqual([2]);
        expect(Option.map(yield* Freeze.state(dir), (s) => (s._tag === "frozen" ? s.allow : []))).toEqual(
          Option.some([LEGS]),
        );

        yield* stopped(dir);
        yield* finished(loop);
        expect(yield* tags(dir)).toEqual(["frozen", "next", "canceled", "stopped"]);
        expect((yield* Freeze.log(dir))[1]).toMatchObject({ branch: LEGS, before: [FIX, "fabrikalfa/ci-flake"] });
      }),
    ),
  );

  it.effect("scenario: a second freeze is refused while one is on, and allow is refused while none is", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        expect(yield* Effect.flip(Freeze.allow(dir, FIX))).toMatchObject({ reason: "no freeze is on" });

        const github = WorkflowRunsTest.world([]);
        const loop = yield* started(dir, github);
        const again = { home: dir, allow: [], every: Duration.seconds(20), repo: REPO, pid: 8 };
        const refused = yield* Effect.flip(Freeze.freeze(again).pipe(Effect.provide(WorkflowRunsTest.layer(github))));
        expect(refused).toMatchObject({ _tag: "Refused", reason: "a freeze is on already (frozen): run stop first" });

        yield* stopped(dir);
        yield* finished(loop);
        expect(yield* Effect.flip(Freeze.allow(dir, FIX))).toMatchObject({ reason: "no freeze is on" });
      }),
    ),
  );

  it.effect("scenario: a stop no loop answers writes the stop itself once its wait is over", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        // A loop that died: the state says frozen, and nothing reads it.
        yield* Fiber.interrupt(yield* started(dir, WorkflowRunsTest.world([])));

        expect(yield* stopped(dir)).toBe("unanswered");
        expect((yield* Freeze.log(dir)).at(-1)).toMatchObject({ _tag: "stopped", by: "stop" });
        expect(yield* stateTag(dir)).toEqual(Option.some("stopped"));
        expect(yield* Freeze.stop(dir, Duration.seconds(60))).toBe("idle");
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
        yield* stopped(dir);
        yield* finished(loop);
        const failed = (yield* Freeze.log(dir)).filter((e) => e._tag === "failed");
        expect(failed.map((e) => [e.call, e.id, e.reason])).toEqual([
          ["cancel", 4, "gh run cancel exited 1: completed"],
          ["cancel", 3, "gh run cancel exited 1: completed"],
        ]);
      }),
    ),
  );
});

describe("unfreeze", () => {
  const head = "b".repeat(40);
  const open: PullRequest = { number: 900, head: "fabrikalfa/armed", oid: head, state: "OPEN", draft: false };
  const closed: PullRequest = {
    number: 901,
    head: "fabrikalfa/gone",
    oid: "c".repeat(40),
    state: "CLOSED",
    draft: false,
  };
  const cancelled = { status: "completed", conclusion: "cancelled", sha: head } as const;

  it.effect("scenario: unfreeze stops the freeze, then reruns the canceled checks of each open pull request", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        const github = WorkflowRunsTest.world([]);
        const loop = yield* started(dir, github);
        github.runs.push(
          made(30, cancelled),
          made(31, { ...cancelled, workflow: "host" }),
          made(32, { ...cancelled, sha: "c".repeat(40) }),
          made(33, { ...cancelled, event: "push", workflow: "check" }),
        );
        const prs = PullRequestsTest.layer(PullRequestsTest.world([open, closed]));
        const layer = Layer.mergeAll(WorkflowRunsTest.layer(github), prs);
        const reran = yield* finished(
          yield* Effect.forkChild(Freeze.unfreeze(dir, Duration.seconds(60)).pipe(Effect.provide(layer))),
        );
        yield* finished(loop);

        expect(reran.map((r) => [r.pr, r.run.id])).toEqual([
          [900, 30],
          [900, 31],
        ]);
        expect(github.calls).toEqual([
          WorkflowRunsTest.Call.cases.rerun.make({ id: 30 }),
          WorkflowRunsTest.Call.cases.rerun.make({ id: 31 }),
        ]);
        expect(yield* tags(dir)).toEqual(["frozen", "stopped", "reran", "reran", "unfrozen"]);
        expect((yield* Freeze.log(dir)).at(-1)).toMatchObject({ reran: 2 });
        expect(yield* stateTag(dir)).toEqual(Option.some("unfrozen"));
      }),
    ),
  );

  it.effect("scenario: a failed rerun is logged, and unfreeze still ends", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        const github = WorkflowRunsTest.world([]);
        const loop = yield* started(dir, github);
        yield* stopped(dir);
        yield* finished(loop);
        github.runs.push(made(30, cancelled));
        const layer = Layer.mergeAll(
          WorkflowRunsTest.layer(github, { rerun: "gh run rerun exited 1: too old" }),
          PullRequestsTest.layer(PullRequestsTest.world([open])),
        );
        expect(yield* Freeze.unfreeze(dir, Duration.seconds(60)).pipe(Effect.provide(layer))).toEqual([]);
        expect((yield* Freeze.log(dir)).find((e) => e._tag === "failed")).toMatchObject({ call: "rerun", id: 30 });
        expect(yield* stateTag(dir)).toEqual(Option.some("unfrozen"));
      }),
    ),
  );

  it.effect("scenario: unfreeze is refused where no freeze was ever recorded", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        const layer = Layer.mergeAll(
          WorkflowRunsTest.layer(WorkflowRunsTest.world([])),
          PullRequestsTest.layer(PullRequestsTest.world([open])),
        );
        const refused = yield* Effect.flip(Freeze.unfreeze(dir, Duration.seconds(60)).pipe(Effect.provide(layer)));
        expect(refused).toMatchObject({ _tag: "Refused", reason: "no freeze is recorded here" });
      }),
    ),
  );
});
