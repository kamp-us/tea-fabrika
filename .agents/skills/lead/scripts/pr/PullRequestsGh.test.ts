import { describe, expect, it } from "@effect/vitest";
import { Recorder } from "@kampus/vitest";
import { Effect, Layer, Schema, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { PullRequests, type StackSelection } from "./PullRequests.ts";
import * as PullRequestsGh from "./PullRequestsGh.ts";

const text = { title: 'T1131: exact "title"', body: "First line.\n\nSecond line." };

const handle = (code: number, out = "https://github.com/owner/repo/pull/71\n") =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.die("fixture never signals a process"),
    stdin: Sink.drain,
    stdout: Stream.make(new TextEncoder().encode(out)),
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });

const layers = (code: number) => {
  const spawner = Recorder.layer(ChildProcessSpawner.ChildProcessSpawner, {
    spawn: () => Effect.succeed(handle(code)),
  });

  return Layer.merge(spawner, PullRequestsGh.layer("owner/repo", ".").pipe(Layer.provide(spawner)));
};

const oid = (number: number) => String(number % 10).repeat(40);

const detail = (number: number, state: "OPEN" | "MERGED" = "OPEN", mergeCommit: string | null = null) => ({
  number,
  head: `fabrikalfa/layer-${number}`,
  oid: oid(number),
  base: number === 11 ? "main" : `fabrikalfa/layer-${number - 1}`,
  state,
  draft: false,
  title: `Layer ${number}`,
  body: "## New names\n\n- None.\n",
  mergeCommit,
});

const selection = (numbers: ReadonlyArray<number> = [11, 12, 13]): StackSelection => ({
  number: 1522,
  base: "main",
  layers: numbers.map((number) => detail(number)),
});

type StackFixture = {
  readonly selected?: StackSelection;
  readonly held?: ReadonlyArray<{ readonly number: number; readonly oid: string }>;
  readonly queue?: {
    readonly build: number;
    readonly merge: number;
    readonly method: "MERGE" | "SQUASH" | "REBASE";
  } | null;
  readonly reply: string;
  readonly after?: ReadonlyMap<number, { readonly state: "OPEN" | "MERGED"; readonly mergeCommit: string | null }>;
};

const stackLayer = (fixture: StackFixture) => {
  const selected = fixture.selected ?? selection();
  const held = fixture.held ?? selected.layers.map(({ number, oid: head }) => ({ number, oid: head }));
  const queue = fixture.queue === undefined ? { build: 2, merge: 3, method: "SQUASH" as const } : fixture.queue;
  const views = new Map<number, number>();
  let mergeAsked = false;
  const spawner = Recorder.layer(ChildProcessSpawner.ChildProcessSpawner, {
    spawn: (command) => {
      if (!ChildProcess.isStandardCommand(command)) {
        return Effect.die("expected a standard command");
      }

      const args = command.args;

      if (args.some((part) => part.includes("/stacks"))) {
        return Effect.succeed(handle(0, JSON.stringify({ number: selected.number, base: selected.base, prs: held })));
      }

      if (args[0] === "pr" && args[1] === "view") {
        const number = Number(args[2]);
        const count = views.get(number) ?? 0;
        views.set(number, count + 1);
        const after = mergeAsked && count > 0 ? fixture.after?.get(number) : undefined;
        const found = selected.layers.find((layer) => layer.number === number) ?? detail(number);
        const mergeCommit = after === undefined ? found.mergeCommit : after.mergeCommit;
        const body = {
          number,
          headRefName: found.head,
          headRefOid: found.oid,
          baseRefName: found.base,
          state: after?.state ?? found.state,
          isDraft: found.draft,
          title: found.title,
          body: found.body,
          mergeCommit: mergeCommit === null ? null : { oid: mergeCommit },
        };

        return Effect.succeed(handle(0, JSON.stringify(body)));
      }

      const compare = args.find((part) => part.includes("/compare/"));

      if (compare !== undefined) {
        const parent = compare.split("/compare/")[1]?.split("...")[0] ?? null;

        return Effect.succeed(handle(0, JSON.stringify({ mergeBase: parent })));
      }

      if (args.some((part) => part.includes("/rules/branches/"))) {
        return Effect.succeed(
          handle(
            0,
            queue === null ? "" : JSON.stringify({ build: queue.build, merge: queue.merge, method: queue.method }),
          ),
        );
      }

      if (args.some((part) => part.endsWith("/merge-async"))) {
        mergeAsked = true;

        return Effect.succeed(handle(0, fixture.reply));
      }

      return Effect.die(`unexpected command: ${args.slice(0, 3).join(" ")}`);
    },
  });

  return Layer.merge(spawner, PullRequestsGh.layer("owner/repo", ".").pipe(Layer.provide(spawner)));
};

const runStack = (fixture: StackFixture) =>
  Effect.gen(function* () {
    const prs = yield* PullRequests;

    return yield* prs.mergeStack(fixture.selected ?? selection());
  }).pipe(Effect.provide(stackLayer(fixture)));

const asyncRequest = (calls: ReadonlyArray<readonly [unknown, unknown]>) => {
  for (const [command] of calls) {
    if (ChildProcess.isStandardCommand(command) && command.args.some((part) => part.endsWith("/merge-async"))) {
      return command;
    }
  }

  return undefined;
};

const asyncBody = (command: unknown) => {
  if (!ChildProcess.isStandardCommand(command)) {
    return Effect.die("merge request must be a standard command");
  }

  const input = command.options.stdin;

  if (!Stream.isStream(input)) {
    return Effect.die("merge request body must travel on stdin");
  }

  return Stream.mkString(Stream.decodeText(input));
};

describe("PullRequestsGh draft actor selection", () => {
  it.effect.prop(
    "property: agent branches use the bot route; other branches keep the CLI actor and exact text",
    { branch: Schema.Literals(["fabrikalfa/task", "person/task", "fabrikalfa-wrong/task"]) },
    ({ branch }) =>
      Effect.gen(function* () {
        const prs = yield* PullRequests;
        expect(yield* prs.draft(branch, text, "a".repeat(40))).toBe(71);
        const calls = yield* Recorder.calls(ChildProcessSpawner.ChildProcessSpawner, "spawn");
        expect(calls).toHaveLength(1);
        const command = calls[0]?.[0];

        if (command === undefined || !ChildProcess.isStandardCommand(command)) {
          return yield* Effect.die("expected one command");
        }

        if (branch.startsWith("fabrikalfa/")) {
          expect(command.command).toBe("node");
          expect(command.args).toEqual([
            expect.stringMatching(/\/botpush\.mjs$/),
            "--draft",
            "owner/repo",
            branch,
            "a".repeat(40),
          ]);
          const input = command.options.stdin;

          if (!Stream.isStream(input)) {
            return yield* Effect.die("bot text must travel on stdin");
          }

          expect(yield* Stream.mkString(Stream.decodeText(input))).toBe(JSON.stringify(text));
        } else {
          expect(command.command).toBe("gh");
          expect(command.args).toEqual([
            "pr",
            "create",
            "-R",
            "owner/repo",
            "--draft",
            "--base",
            "main",
            "--head",
            branch,
            "--title",
            text.title,
            "--body",
            text.body,
          ]);
        }
      }).pipe(Effect.provide(layers(0))),
  );

  // scenario: auth/HTTP refusal stays one failed bot call; no personal-actor recovery follows.
  it.effect("scenario: a refused bot draft fails without a CLI fallback", () =>
    Effect.gen(function* () {
      const prs = yield* PullRequests;
      const error = yield* Effect.flip(prs.draft("fabrikalfa/task", text, "a".repeat(40)));
      expect(error.reason).toContain("bot draft exited 1");
      const calls = yield* Recorder.calls(ChildProcessSpawner.ChildProcessSpawner, "spawn");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0]).toMatchObject({ command: "node" });
    }).pipe(Effect.provide(layers(1))),
  );
});

describe("PullRequestsGh native stack merge", () => {
  it.effect("scenario: queue mode sends the pinned top SHA and leaves SQUASH to the queue", () =>
    Effect.gen(function* () {
      const answer = yield* runStack({
        reply: JSON.stringify({ status: "enqueued" }),
        queue: { build: 2, merge: 3, method: "SQUASH" },
      });
      const calls = yield* Recorder.calls(ChildProcessSpawner.ChildProcessSpawner, "spawn");
      const request = asyncRequest(calls);

      expect(answer._tag).toBe("enqueued");
      expect(request?.args).toEqual(["api", "-X", "PUT", "repos/owner/repo/pulls/13/merge-async", "--input", "-"]);
      expect(request === undefined ? "" : JSON.parse(yield* asyncBody(request))).toEqual({
        sha: oid(13),
        merge_action: "merge_queue",
      });
    }),
  );

  it.effect("scenario: an open child retargeted after its parent squash is checked from the squash commit", () =>
    Effect.gen(function* () {
      const parentCommit = "a".repeat(40);
      const selected: StackSelection = {
        ...selection(),
        layers: [detail(11, "MERGED", parentCommit), { ...detail(12), base: "main" }, detail(13)],
      };
      const answer = yield* runStack({
        selected,
        reply: JSON.stringify({ status: "enqueued" }),
      });

      expect(answer._tag).toBe("enqueued");
    }),
  );

  it.effect("scenario: a direct request names the exact SHA and explicit squash action", () =>
    Effect.gen(function* () {
      const answer = yield* runStack({
        reply: JSON.stringify({
          status: "pending",
          details: {
            uuid: "9fb26355-cb81-4596-bce0-4097e262e8e4",
            expected_head_sha: oid(13),
            merge_action: "direct_merge",
            merge_method: "squash",
            bypass_rules: false,
          },
        }),
        queue: null,
      });
      const calls = yield* Recorder.calls(ChildProcessSpawner.ChildProcessSpawner, "spawn");
      const request = asyncRequest(calls);

      expect(answer).toEqual({ _tag: "pending", uuid: "9fb26355-cb81-4596-bce0-4097e262e8e4" });
      expect(request === undefined ? "" : JSON.parse(yield* asyncBody(request))).toEqual({
        sha: oid(13),
        merge_action: "direct_merge",
        merge_method: "squash",
      });
    }),
  );

  it.effect("scenario: an unexpected queue method fails without a direct merge fallback", () =>
    Effect.gen(function* () {
      const answer = yield* Effect.flip(
        runStack({
          reply: JSON.stringify({ status: "enqueued" }),
          queue: { build: 2, merge: 3, method: "MERGE" },
        }),
      );
      const calls = yield* Recorder.calls(ChildProcessSpawner.ChildProcessSpawner, "spawn");

      expect(answer.reason).toContain("configured for MERGE, not SQUASH");
      expect(asyncRequest(calls)).toBeUndefined();
    }),
  );

  it.effect("scenario: a moved lower head refuses before the async request", () =>
    Effect.gen(function* () {
      const held = selection().layers.map(({ number, oid: head }) => ({
        number,
        oid: number === 11 ? oid(9) : head,
      }));
      const answer = yield* Effect.flip(runStack({ held, reply: JSON.stringify({ status: "enqueued" }) }));
      const calls = yield* Recorder.calls(ChildProcessSpawner.ChildProcessSpawner, "spawn");

      expect(answer.reason).toContain("selected stack head changed");
      expect(asyncRequest(calls)).toBeUndefined();
    }),
  );

  it.effect("scenario: an inserted lower layer refuses before the async request", () =>
    Effect.gen(function* () {
      const held = [
        { number: 10, oid: oid(0) },
        ...selection().layers.map(({ number, oid: head }) => ({ number, oid: head })),
      ];
      const answer = yield* Effect.flip(runStack({ held, reply: JSON.stringify({ status: "enqueued" }) }));
      const calls = yield* Recorder.calls(ChildProcessSpawner.ChildProcessSpawner, "spawn");

      expect(answer.reason).toContain("selected stack prefix changed");
      expect(asyncRequest(calls)).toBeUndefined();
    }),
  );

  it.effect("scenario: a failed async result stays a failure", () =>
    Effect.gen(function* () {
      const answer = yield* Effect.flip(
        runStack({
          reply: JSON.stringify({ status: "failed", details: { message: "merge group failed checks" } }),
        }),
      );

      expect(answer.reason).toContain("merge group failed checks");
    }),
  );

  it.effect("scenario: a merged reply with only the bottom landed is not reported as merged", () =>
    Effect.gen(function* () {
      const commit = "f".repeat(40);
      const answer = yield* Effect.flip(
        runStack({
          reply: JSON.stringify({ status: "merged", details: { sha: commit } }),
          after: new Map<number, { readonly state: "OPEN" | "MERGED"; readonly mergeCommit: string | null }>([
            [11, { state: "MERGED", mergeCommit: "a".repeat(40) }],
            [12, { state: "OPEN", mergeCommit: null }],
            [13, { state: "OPEN", mergeCommit: null }],
          ]),
        }),
      );

      expect(answer.reason).toContain("selected layers did not all report merged");
    }),
  );

  it.effect("scenario: a merged reply is reported only after every selected layer reports merged", () =>
    Effect.gen(function* () {
      const commit = "f".repeat(40);
      const answer = yield* runStack({
        reply: JSON.stringify({ status: "merged", details: { sha: commit } }),
        after: new Map<number, { readonly state: "OPEN" | "MERGED"; readonly mergeCommit: string | null }>([
          [11, { state: "MERGED", mergeCommit: "a".repeat(40) }],
          [12, { state: "MERGED", mergeCommit: "b".repeat(40) }],
          [13, { state: "MERGED", mergeCommit: commit }],
        ]),
      });

      expect(answer).toEqual({ _tag: "merged", commit });
    }),
  );
});
