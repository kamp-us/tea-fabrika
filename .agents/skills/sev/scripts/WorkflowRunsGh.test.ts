// Today's lead tooling. How WorkflowRunsGh reads what `gh api -i` prints, on answers GitHub gave this
// repo on 2026-11-18 through gh 2.104.0, cut to the parts the layer reads; nothing here starts gh.
import { describe, expect, it } from "@effect/vitest";
import { Recorder } from "@kampus/vitest";
import {
  Array as Arr,
  String as Str,
  DateTime,
  Effect,
  Layer,
  Option,
  Record as Rec,
  Schema,
  Sink,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { TestClock } from "effect/testing";
import { lastLine } from "../../lead/scripts/pr/command.ts";
import { WorkflowRuns } from "./WorkflowRuns.ts";
import * as WorkflowRunsGh from "./WorkflowRunsGh.ts";

/** When tonight's rate limit was seen, and when GitHub said it would reset (`x-ratelimit-reset: 1794996535`). */
const SEEN = DateTime.makeUnsafe("2026-11-18T10:01:42Z");

const RESET = DateTime.makeUnsafe("2026-11-18T10:08:55Z");

/** An answer as `gh api -i` prints it: the status line, headers ending in CRLF, a blank line, the body. */
const printed = (status: number, headers: ReadonlyArray<readonly [string, string]>, body: string) =>
  [`HTTP/2.0 ${status} Answer`, ...Arr.map(headers, ([name, value]) => `${name}: ${value}\r`), "\r", body].join("\n");

/** Tonight's 409 for a cancel of a run stuck in `queued`, with its headers cut to these. */
const STUCK = {
  out: [
    "HTTP/2.0 409 Conflict",
    "Content-Length: 182\r",
    "Content-Type: application/json; charset=utf-8\r",
    "Date: Wed, 18 Nov 2026 10:46:01 GMT\r",
    "X-Ratelimit-Limit: 5000\r",
    "X-Ratelimit-Remaining: 3195\r",
    "X-Ratelimit-Reset: 1795000142\r",
    "X-Ratelimit-Resource: core\r",
    "\r",
    '{"message":"Cannot cancel a workflow run that has not been queued yet.","documentation_url":"https://docs.github.com/rest/actions/workflow-runs#cancel-a-workflow-run","status":"409"}',
  ].join("\n"),
  err: "gh: Cannot cancel a workflow run that has not been queued yet. (HTTP 409)\n",
};

/** Tonight's rate limit: GitHub's 403 with none left, and its reset. */
const SPENT = {
  out: printed(
    403,
    [
      ["X-Ratelimit-Limit", "5000"],
      ["X-Ratelimit-Remaining", "0"],
      ["X-Ratelimit-Reset", "1794996535"],
    ],
    '{"message":"API rate limit exceeded."}',
  ),
  err: "gh: API rate limit exceeded. (HTTP 403)\n",
};

/** GitHub's message for a secondary rate limit (REST docs, "Rate limits for the REST API"). */
const SECONDARY =
  '{"message":"You have exceeded a secondary rate limit. Please wait a few minutes before you try again."}';

/** Tonight's 502 for one cancel, line 351 of that sev0's log. */
const BAD_GATEWAY = { out: printed(502, [["Content-Type", "text/html"]], ""), err: "gh: Server Error (HTTP 502)\n" };

/** gh when no answer came back: nothing on stdout. */
const OFFLINE = {
  out: "",
  err: "error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n",
};

type Printed = { readonly out: string; readonly err: string };

const handle = (code: number, given: Printed) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.die("fixture never signals a process"),
    stdin: Sink.drain,
    stdout: Stream.make(new TextEncoder().encode(given.out)),
    stderr: Stream.make(new TextEncoder().encode(given.err)),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });

/** gh, answering every call with exit 1 and `given`. */
const refusing = (given: Printed) => {
  const spawner = Recorder.layer(ChildProcessSpawner.ChildProcessSpawner, {
    spawn: () => Effect.succeed(handle(1, given)),
  });

  return Layer.merge(spawner, WorkflowRunsGh.layer("kamp-us/tea-fabrika", ".").pipe(Layer.provide(spawner)));
};

/** The args of each gh call made, in order. */
const asked = Effect.map(Recorder.calls(ChildProcessSpawner.ChildProcessSpawner, "spawn"), (calls) =>
  Arr.map(calls, ([command]) => (ChildProcess.isStandardCommand(command) ? command.args : [])),
);

const CANCEL = ["api", "-i", "repos/kamp-us/tea-fabrika/actions/runs/43096104693/cancel", "--method", "POST"];

/** What one cancel fails with when gh prints `given`, and the gh calls it made. */
const cancelled = (given: Printed) =>
  Effect.gen(function* () {
    const failed = yield* Effect.flip((yield* WorkflowRuns).cancel(43096104693));

    return { failed, calls: yield* asked };
  }).pipe(Effect.provide(refusing(given)));

/** Tonight's answer for the runs `in_progress`, cut to one run and the fields the layer reads. */
const listed = JSON.stringify({
  total_count: 1,
  workflow_runs: [
    {
      id: 44288548971,
      name: "check",
      head_branch: "fabrikalfa/l11-template-copy",
      head_sha: "c1b4ac212db364797b623779788269007d4d9a4f",
      event: "pull_request",
      status: "in_progress",
      conclusion: null,
      created_at: "2026-11-18T10:46:29Z",
    },
  ],
});

describe("runsIn", () => {
  it.effect("format: it reads GitHub's page of runs, a null conclusion as none yet, and the total", () =>
    Effect.gen(function* () {
      expect(yield* WorkflowRunsGh.runsIn(listed)).toEqual({
        total: 1,
        runs: [
          {
            id: 44288548971,
            workflow: "check",
            event: "pull_request",
            branch: "fabrikalfa/l11-template-copy",
            sha: "c1b4ac212db364797b623779788269007d4d9a4f",
            status: "in_progress",
            conclusion: null,
            created: "2026-11-18T10:46:29Z",
          },
        ],
      });
    }),
  );

  it.effect("format: it reads an empty page as no runs, as GitHub listed the runs `waiting` that night", () =>
    Effect.gen(function* () {
      expect(yield* WorkflowRunsGh.runsIn('{"total_count":0,"workflow_runs":[]}')).toEqual({ total: 0, runs: [] });
    }),
  );

  it.effect("format: it fails on a shape it does not read", () =>
    Effect.gen(function* () {
      const failed = yield* Effect.flip(WorkflowRunsGh.runsIn('{"total_count":1,"workflow_runs":[{"id":"one"}]}'));
      expect(failed._tag).toBe("SchemaError");
    }),
  );
});

describe("answerIn", () => {
  it("format: it reads tonight's 409 as gh api -i printed it: the status, the headers by lowercase name, and the body", () => {
    const answer = Option.getOrThrow(WorkflowRunsGh.answerIn(STUCK.out));
    expect(answer.status).toBe(409);
    expect(answer.headers).toMatchObject({ "x-ratelimit-remaining": "3195", "x-ratelimit-reset": "1795000142" });
    expect(answer.body).toContain('"status":"409"');
  });

  it.prop(
    "property: it reads back any status and headers as printed, and finds no answer where gh printed no status line",
    {
      status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
      headers: Schema.Array(
        Schema.Tuple([
          Schema.Literals(["Retry-After", "X-Ratelimit-Remaining", "X-Ratelimit-Reset", "Content-Type"]),
          Schema.Literals(["0", "60", "1794996535", "text/html; charset=utf-8"]),
        ]),
      ),
      body: Schema.String,
      noise: Schema.String,
    },
    ({ status, headers, body, noise }) => {
      const answer = Option.getOrThrow(WorkflowRunsGh.answerIn(printed(status, headers, body)));
      expect(answer.status).toBe(status);
      expect(answer.body).toBe(body);

      // A header named twice keeps its last value.
      expect(answer.headers).toEqual(
        Rec.fromEntries(Arr.map(headers, ([name, value]) => [Str.toLowerCase(name), value])),
      );

      // gh printed no answer: stdout is empty, or holds no status line.
      expect(WorkflowRunsGh.answerIn(OFFLINE.out)).toEqual(Option.none());
      expect(Option.isNone(WorkflowRunsGh.answerIn(`x${noise}`))).toBe(true);
    },
  );
});

describe("retryAt", () => {
  const Limit = Schema.Literals([403, 429]);
  const Seconds = Schema.Int.check(Schema.isBetween({ minimum: -7200, maximum: 7200 }));

  /** The wait, in ms from `now`, as `limitWait` gives it: never below zero, at most an hour. */
  const clamped = (ms: number) => Math.min(Math.max(ms, 0), 60 * 60_000);

  const waited = (status: number, headers: Record<string, string>, body = "{}") => {
    const at = WorkflowRunsGh.retryAt({ status, headers, body }, SEEN);

    return at === null ? null : DateTime.toEpochMillis(at) - DateTime.toEpochMillis(SEEN);
  };

  it.prop(
    "property: only a 403 or a 429 names a wait, whatever its headers and message say",
    {
      status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
      after: Schema.String,
      left: Schema.String,
      reset: Schema.String,
    },
    ({ status, after, left, reset }) =>
      status === 403 ||
      status === 429 ||
      waited(status, { "retry-after": after, "x-ratelimit-remaining": left, "x-ratelimit-reset": reset }, SECONDARY) ===
        null,
  );

  it.prop(
    "property: retry-after comes first, in seconds or as an HTTP date, and never past an hour",
    {
      status: Limit,
      seconds: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 7200 })),
      offset: Seconds,
      left: Schema.Literals(["0", "12"]),
    },
    ({ status, seconds, offset, left }) => {
      const rest = { "x-ratelimit-remaining": left, "x-ratelimit-reset": "1794996535" };
      expect(waited(status, { ...rest, "retry-after": String(seconds) })).toBe(clamped(seconds * 1000));

      // An HTTP date, which names a second, so a date in the past is no wait at all.
      const date = DateTime.toDateUtc(DateTime.add(SEEN, { seconds: offset })).toUTCString();
      expect(waited(status, { ...rest, "retry-after": date })).toBe(clamped(offset * 1000));
    },
  );

  it.prop(
    "property: with no retry-after it reads, a spent limit waits for x-ratelimit-reset; with calls left, a 429 or a 403 that names a rate limit waits a minute, and any other 403 names no wait",
    {
      status: Limit,
      after: Schema.Literals(["", "soon", "later", "60s", "never"]),
      left: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 })),
      offset: Seconds,
      named: Schema.Boolean,
    },
    ({ status, after, left, offset, named }) => {
      const reset = String(Math.floor(DateTime.toEpochMillis(SEEN) / 1000) + offset);
      const headers = { "retry-after": after, "x-ratelimit-remaining": String(left), "x-ratelimit-reset": reset };
      const body = named ? SECONDARY : '{"message":"Resource not accessible by integration"}';
      expect(waited(status, headers, body)).toBe(
        left === 0 ? clamped(offset * 1000) : status === 429 || named ? 60_000 : null,
      );

      // Tonight's 403: none left, and the reset at 10:08:55.
      const tonight = { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1794996535" };
      expect(WorkflowRunsGh.retryAt({ status: 403, headers: tonight, body: "{}" }, SEEN)).toEqual(RESET);
    },
  );
});

describe("cancel", () => {
  it.effect.prop(
    "property: a cancel GitHub refuses with a status but no wait fails with that status and gh's own words, in one call",
    {
      // Any error status but a 429, which is always a rate limit.
      status: Schema.Union([
        Schema.Int.check(Schema.isBetween({ minimum: 400, maximum: 428 })),
        Schema.Int.check(Schema.isBetween({ minimum: 430, maximum: 599 })),
      ]),
      words: Schema.String,
    },
    ({ status, words }) =>
      Effect.gen(function* () {
        const generated = {
          out: printed(status, [["X-Ratelimit-Remaining", "4000"]], "{}"),
          err: `gh: ${words} (HTTP ${status})\n`,
        };

        // Tonight's 409 and 502 are in every case.
        for (const [given, is] of [
          [generated, status],
          [STUCK, 409],
          [BAD_GATEWAY, 502],
        ] as const) {
          const { failed, calls } = yield* cancelled(given);
          expect(failed).toMatchObject({ _tag: "WorkflowRunsError", status: is });
          // gh's words as they come through a pipe, which writes a lone surrogate as U+FFFD.
          const err = new TextDecoder().decode(new TextEncoder().encode(given.err));
          expect(failed.reason).toBe(
            `gh api repos/kamp-us/tea-fabrika/actions/runs/43096104693/cancel exited 1: ${lastLine({ out: given.out, err, code: 1 })}`,
          );
          expect(calls).toEqual([CANCEL]);
        }
      }),
  );

  it.effect.prop(
    "property: a cancel over the rate limit fails as RateLimited, at the time GitHub's own headers give, in one call",
    {
      status: Schema.Literals([403, 429]),
      after: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 7200 })),
    },
    ({ status, after }) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(DateTime.toEpochMillis(SEEN));

        const generated = {
          out: printed(status, [["Retry-After", String(after)]], "{}"),
          err: `gh: limited (HTTP ${status})\n`,
        };

        // Tonight's 403 is in every case.
        for (const [given, until] of [
          [generated, DateTime.add(SEEN, { seconds: Math.min(after, 3600) })],
          [SPENT, RESET],
        ] as const) {
          const { failed, calls } = yield* cancelled(given);
          expect(failed).toMatchObject({ _tag: "RateLimited", until });
          expect(calls).toEqual([CANCEL]);
        }
      }),
  );

  it.effect.prop(
    "property: a 429, or a 403 whose message names a rate limit, with calls left and no header naming a wait, fails as RateLimited for one minute",
    { status: Schema.Literals([403, 429]), left: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5000 })) },
    ({ status, left }) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(DateTime.toEpochMillis(SEEN));

        const given = {
          out: printed(status, [["X-Ratelimit-Remaining", String(left)]], SECONDARY),
          err: `gh: You have exceeded a secondary rate limit. (HTTP ${status})\n`,
        };

        const { failed, calls } = yield* cancelled(given);
        expect(failed).toMatchObject({ _tag: "RateLimited", until: DateTime.add(SEEN, { minutes: 1 }) });
        expect(calls).toEqual([CANCEL]);
      }),
  );

  it.effect.prop(
    "property: a cancel no answer came back for fails with no status",
    { words: Schema.String },
    ({ words }) =>
      Effect.gen(function* () {
        for (const given of [{ out: "", err: `${words}\n` }, OFFLINE]) {
          const { failed } = yield* cancelled(given);
          expect(failed).toMatchObject({ _tag: "WorkflowRunsError", status: null });
        }
      }),
  );
});
