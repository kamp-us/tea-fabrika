import { describe, expect, it } from "@effect/vitest";
import { Recorder } from "@kampus/vitest";
import { Effect, Layer, Schema, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { PullRequests } from "./PullRequests.ts";
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

const commandArgs = (command: ChildProcess.StandardCommand) => command.args.map(String);

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
          expect(commandArgs(command)).toEqual([
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
          expect(commandArgs(command)).toEqual([
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
