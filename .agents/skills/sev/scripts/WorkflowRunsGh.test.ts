// Today's lead tooling. How WorkflowRunsGh reads `gh run list --json`, on an answer gh 2.104.0 gave
// for this repo on 2026-11-14; nothing here starts gh.
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as WorkflowRunsGh from "./WorkflowRunsGh.ts";

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
