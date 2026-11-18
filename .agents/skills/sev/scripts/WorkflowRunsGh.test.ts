// Today's lead tooling. How WorkflowRunsGh reads gh's answers, on ones gh 2.104.0 gave for this repo
// on 2026-11-14 and 2026-11-18; nothing here starts gh.
import { describe, expect, it } from "@effect/vitest";
import { Recorder } from "@kampus/vitest";
import { Array as Arr, DateTime, Effect, Layer, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { WorkflowRuns } from "./WorkflowRuns.ts";
import * as WorkflowRunsGh from "./WorkflowRunsGh.ts";

/** What `gh api rate_limit --jq .resources.core` answered at 10:07 UTC on 2026-11-18, with none left. */
const SPENT = '{"limit":5000,"remaining":0,"reset":1794996535,"used":5000}\n';

/** What gh wrote for a call over the limit, that morning. */
const LIMITED = "gh: API rate limit exceeded for user ID 1783869. (HTTP 403)\n";

/** What gh wrote for the cancel of a run stuck in `queued`, that morning. */
const STUCK = "gh: Cannot cancel a workflow run that has not been queued yet. (HTTP 409)\n";

const handle = (code: number, out: string, err: string) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.die("fixture never signals a process"),
    stdin: Sink.drain,
    stdout: Stream.make(new TextEncoder().encode(out)),
    stderr: Stream.make(new TextEncoder().encode(err)),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });

/** gh, answering `rate_limit` with SPENT and every other call with exit 1 and `refusal`. */
const layers = (refusal: string) => {
  const spawner = Recorder.layer(ChildProcessSpawner.ChildProcessSpawner, {
    spawn: (command) =>
      Effect.succeed(
        ChildProcess.isStandardCommand(command) && command.args[1] === "rate_limit"
          ? handle(0, SPENT, "")
          : handle(1, "", refusal),
      ),
  });

  return Layer.merge(spawner, WorkflowRunsGh.layer("kamp-us/tea-fabrika", ".").pipe(Layer.provide(spawner)));
};

/** The args of each gh call made, in order. */
const asked = Effect.map(Recorder.calls(ChildProcessSpawner.ChildProcessSpawner, "spawn"), (calls) =>
  Arr.map(calls, ([command]) => (ChildProcess.isStandardCommand(command) ? command.args : [])),
);

const CANCEL = ["api", "repos/kamp-us/tea-fabrika/actions/runs/43096104693/cancel", "--method", "POST"];

const listed = JSON.stringify([
  {
    conclusion: "",
    createdAt: "2026-11-14T19:37:43Z",
    databaseId: 43633122861,
    event: "merge_group",
    headBranch: "gh-readonly-queue/main/pr-1240-6fe17ffab0142684fe05bbbd540187bdb27eac20",
    headSha: "c94c9cec520db5e5f363fe7cf5e0e80cfb431c62",
    status: "in_progress",
    workflowName: "check",
  },
  {
    conclusion: "cancelled",
    createdAt: "2026-11-14T19:30:02Z",
    databaseId: 43633000001,
    event: "pull_request",
    headBranch: "fabrikalfa/sev0-skill",
    headSha: "700af11471655a892923fba5b72d891061bd790d",
    status: "completed",
    workflowName: "check",
  },
]);

describe("runsIn", () => {
  it.effect("format: it reads gh's rows, and an empty conclusion as none yet", () =>
    Effect.gen(function* () {
      const runs = yield* WorkflowRunsGh.runsIn(listed);
      expect(runs).toEqual([
        {
          id: 43633122861,
          workflow: "check",
          event: "merge_group",
          branch: "gh-readonly-queue/main/pr-1240-6fe17ffab0142684fe05bbbd540187bdb27eac20",
          sha: "c94c9cec520db5e5f363fe7cf5e0e80cfb431c62",
          status: "in_progress",
          conclusion: null,
          created: "2026-11-14T19:37:43Z",
        },
        expect.objectContaining({ id: 43633000001, conclusion: "cancelled", status: "completed" }),
      ]);
    }),
  );

  it.effect("format: it reads an empty answer as no runs", () =>
    Effect.gen(function* () {
      expect(yield* WorkflowRunsGh.runsIn("\n")).toEqual([]);
    }),
  );

  it.effect("format: it fails on a shape it does not read", () =>
    Effect.gen(function* () {
      const failed = yield* Effect.flip(WorkflowRunsGh.runsIn('[{"databaseId":"one"}]'));
      expect(failed._tag).toBe("SchemaError");
    }),
  );
});

describe("retryAt", () => {
  const now = DateTime.makeUnsafe("2026-11-18T10:01:42Z");

  it.effect("format: with no call left, GitHub takes calls again at its reset", () =>
    Effect.gen(function* () {
      expect(DateTime.formatIso(yield* WorkflowRunsGh.retryAt(SPENT, now))).toBe("2026-11-18T10:08:55.000Z");
    }),
  );

  it.effect("format: with calls left, which is a secondary limit, it is a minute from now", () =>
    Effect.gen(function* () {
      const left = '{"limit":5000,"remaining":4271,"reset":1794997213,"used":729}';
      expect(DateTime.formatIso(yield* WorkflowRunsGh.retryAt(left, now))).toBe("2026-11-18T10:02:42.000Z");
    }),
  );
});

describe("cancel", () => {
  it.effect("scenario: a cancel over the rate limit fails as RateLimited until the reset gh api rate_limit gives", () =>
    Effect.gen(function* () {
      const failed = yield* Effect.flip((yield* WorkflowRuns).cancel(43096104693));

      if (failed._tag !== "RateLimited") {
        return yield* Effect.die(`expected a rate limit, got ${failed.reason}`);
      }

      expect(DateTime.formatIso(failed.until)).toBe("2026-11-18T10:08:55.000Z");
      expect(yield* asked).toEqual([CANCEL, ["api", "rate_limit", "--jq", ".resources.core"]]);
    }).pipe(Effect.provide(layers(LIMITED))),
  );

  it.effect("scenario: a cancel GitHub refuses is one call, and fails with GitHub's own words", () =>
    Effect.gen(function* () {
      const failed = yield* Effect.flip((yield* WorkflowRuns).cancel(43096104693));
      expect(failed).toMatchObject({
        _tag: "WorkflowRunsError",
        reason: `gh api repos/kamp-us/tea-fabrika/actions/runs/43096104693/cancel exited 1: ${STUCK.trim()}`,
      });
      expect(yield* asked).toEqual([CANCEL]);
    }).pipe(Effect.provide(layers(STUCK))),
  );
});
