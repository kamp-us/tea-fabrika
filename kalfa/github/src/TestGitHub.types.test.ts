// T9, T11, T12 and T13: what `GitHubTest.answer`, `GitHubTest.refuse` and `GitHubTest.layer` accept and refuse. Like the other type laws, each
// `@ts-expect-error` below must stay a compile error: `tsc` and the root `typecheck` check them, not a test run. Each helper
// holds one law's lines, and its `it` only names the helper.
import { expectTypeOf, it } from "@effect/vitest";
import type { Layer } from "effect";
import { CancelRun, Dispatch, ListCheckRuns } from "./GitHub.test-support.ts";
import type * as GitHub from "./GitHub.ts";
import { CreatedIssue, EchoIssue, RunLogs } from "./TestGitHub.test-support.ts";
import * as GitHubTest from "./TestGitHub.ts";

// T9, the answer. Plant: type `Answered<Op>` as `unknown`, and every `@ts-expect-error` of a key the description lacks is
// unused.
const answers = () => {
  const ok = [
    // Part of the description's answer: every key is optional, at every depth.
    GitHubTest.answer(ListCheckRuns, () => ({})),
    GitHubTest.answer(ListCheckRuns, () => ({ total_count: 1 })),
    GitHubTest.answer(ListCheckRuns, () => ({ check_runs: [{ id: 7 }, { name: "lint", conclusion: null }] })),
    // A field the caller's Schema does not read, and the description has.
    GitHubTest.answer(ListCheckRuns, () => ({ check_runs: [{ id: 7, head_sha: "abc", app: { id: 1, slug: "x" } }] })),
    // `f` is handed the asked parts, and the payload is the one the Request carried: the encoded text of a number.
    GitHubTest.answer(EchoIssue, (asked) => ({ title: asked.payload.title }), { status: 201 }),
    GitHubTest.answer(ListCheckRuns, (asked) => ({ check_runs: [{ name: asked.params["ref"] ?? "" }] })),
  ];

  // @ts-expect-error a key the description's answer lacks, at the top
  const top = GitHubTest.answer(ListCheckRuns, () => ({ check_rnus: [] }));
  // @ts-expect-error a key the description's answer lacks, inside an array item
  const deep = GitHubTest.answer(ListCheckRuns, () => ({ check_runs: [{ idd: 1 }] }));
  // @ts-expect-error a key the description's answer lacks, two objects down
  const deeper = GitHubTest.answer(ListCheckRuns, () => ({ check_runs: [{ app: { slugg: "x" } }] }));
  // @ts-expect-error a value of the wrong type
  const wrong = GitHubTest.answer(ListCheckRuns, () => ({ total_count: "one" }));
  // @ts-expect-error a key the description's answer lacks, beside one it has, at the top
  const beside = GitHubTest.answer(ListCheckRuns, () => ({ total_count: 1, check_rnus: [] }));
  // @ts-expect-error a key the description's answer lacks, beside one it has, inside an array item
  const besideDeep = GitHubTest.answer(ListCheckRuns, () => ({ check_runs: [{ id: 1, idd: 2 }] }));
  // @ts-expect-error a key the description's answer lacks, beside one it has, two objects down
  const besideDeeper = GitHubTest.answer(ListCheckRuns, () => ({ check_runs: [{ app: { slug: "x", slugg: "x" } }] }));
  // @ts-expect-error `undefined` is an answer only beside a status with no body, and the check runs route has none
  const nothing = GitHubTest.answer(ListCheckRuns, () => undefined);
  // @ts-expect-error the payload is the encoded text, not the decoded number
  const decoded = GitHubTest.answer(EchoIssue, (asked) => ({ title: asked.payload.title.toFixed(0) }), { status: 201 });

  expectTypeOf([ok, top, deep, deeper, beside, besideDeep, besideDeeper, wrong, nothing, decoded]).toBeArray();
};

// T11, the status. Plant: type the status as any 2xx, and the cancel `200` line compiles.
const statuses = () => {
  const ok = [
    // Cancel answers 202 only: the option is required, and is exactly that status.
    GitHubTest.answer(CancelRun, () => ({}), { status: 202 }),
    GitHubTest.answer(CreatedIssue, () => ({ number: 1 }), { status: 201 }),
    // The check runs route answers 200: the option may be left out.
    GitHubTest.answer(ListCheckRuns, () => ({})),
    GitHubTest.answer(ListCheckRuns, () => ({}), { status: 200 }),
  ];

  // @ts-expect-error cancel's only 2xx is 202, so the status is required
  const missing = GitHubTest.answer(CancelRun, () => ({}));
  // @ts-expect-error 200 is not one of cancel's statuses
  const other = GitHubTest.answer(CancelRun, () => ({}), { status: 200 });
  // @ts-expect-error 200 is not one of create an issue's statuses
  const created = GitHubTest.answer(CreatedIssue, () => ({ number: 1 }), { status: 200 });
  // @ts-expect-error 202 is not one of the check runs route's statuses
  const listed = GitHubTest.answer(ListCheckRuns, () => ({}), { status: 202 });

  // The dispatch route answers 200 with a body, or 204 with none: `undefined` goes with the status that has no body, and only with it.
  const dispatched = [
    GitHubTest.answer(Dispatch, () => undefined, { status: 204 }),
    GitHubTest.answer(Dispatch, () => ({ workflow_run_id: 1, run_url: "u" })),
    GitHubTest.answer(Dispatch, () => ({ workflow_run_id: 1 }), { status: 200 }),
  ];

  // @ts-expect-error `undefined` with no status would send a 200 with an empty body, which GitHub never does
  const emptyOk = GitHubTest.answer(Dispatch, () => undefined);
  // @ts-expect-error `undefined` with the status that has a body
  const emptyOkGiven = GitHubTest.answer(Dispatch, () => undefined, { status: 200 });
  // @ts-expect-error a value with the status that has no body
  const bodyOnEmpty = GitHubTest.answer(Dispatch, () => ({ workflow_run_id: 1 }), { status: 204 });
  // A route with no 2xx status at all answers only through `refuse`: GitHub redirects, and `call` reads that as unreadable.
  // @ts-expect-error the logs route has no 2xx, so it has no answer
  const logs = GitHubTest.answer(RunLogs, () => "the log");
  // @ts-expect-error nor an empty one
  const logsEmpty = GitHubTest.answer(RunLogs, () => undefined);
  // @ts-expect-error nor with a status given
  const logsOk = GitHubTest.answer(RunLogs, () => "the log", { status: 200 });
  // @ts-expect-error nor with a redirect status
  const logsMoved = GitHubTest.answer(RunLogs, () => undefined, { status: 302 });

  expectTypeOf([dispatched, emptyOk, emptyOkGiven, bodyOnEmpty, logs, logsEmpty, logsOk, logsMoved]).toBeArray();
  expectTypeOf([ok, missing, other, created, listed]).toBeArray();
};

// T12, the refusal. Plant: type the status as any number, and the 500 line compiles.
const refusals = () => {
  const ok = [
    GitHubTest.refuse(ListCheckRuns, { status: 404 }),
    GitHubTest.refuse(ListCheckRuns, { status: 400, message: "m", documentation_url: "https://docs.github.com/x" }),
    GitHubTest.refuse(CreatedIssue, { status: 422, errors: [{ resource: "Issue", field: "title", code: "missing" }] }),
    GitHubTest.refuse(ListCheckRuns, { status: 499 }),
    // A route with no 2xx is refused, since that is all a fake can say for it.
    GitHubTest.refuse(RunLogs, { status: 404 }),
  ];

  // @ts-expect-error a 5xx is not a refusal GitHub's 4xx body describes
  const server = GitHubTest.refuse(ListCheckRuns, { status: 500 });
  // @ts-expect-error a 3xx is not a refusal either
  const moved = GitHubTest.refuse(ListCheckRuns, { status: 399 });
  // @ts-expect-error the status is required
  const bare = GitHubTest.refuse(ListCheckRuns, { message: "m" });

  expectTypeOf([ok, server, moved, bare]).toBeArray();
};

// T13, the layer. Plant: type it as `Layer<GitHub.GitHub, Error>`, and the line that pins it fails.
const layers = () => {
  expectTypeOf(GitHubTest.layer([])).toEqualTypeOf<Layer.Layer<GitHub.GitHub>>();
  expectTypeOf(
    GitHubTest.layer([GitHubTest.refuse(ListCheckRuns, { status: 404 })], { poll: "5 seconds" }),
  ).toEqualTypeOf<Layer.Layer<GitHub.GitHub>>();
};

it("T9 type: answer takes part of the description's answer and refuses a key it lacks at any depth, with the encoded payload", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(answers).toBeFunction();
});

it("T11 type: the status option is required when 200 is not one of the route's statuses, and is exactly those", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(statuses).toBeFunction();
});

it("T12 type: refuse takes a 4xx status only", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(refusals).toBeFunction();
});

it("T13 type: layer is a Layer of the GitHub service and nothing else", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(layers).toBeFunction();
});
