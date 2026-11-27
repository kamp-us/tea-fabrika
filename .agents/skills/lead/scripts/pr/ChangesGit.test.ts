// Today's lead tooling. The Changes service on real git (./ChangesGit.ts), asked of a stand-in `git` that answers as told and keeps every call:
// the one question it asks, `git diff --name-only -z --no-renames origin/main...<head>`, in the checkout it was given, and how it reads the
// NUL-separated answer (CG1 of .kalfa/quests/review-record-PLAN.md). Nothing here runs git; ChangesGit.integration.test.ts runs the real one.
import { describe, expect, it } from "@effect/vitest";
import { Recorder, runsFor } from "@kampus/vitest";
import { Effect, Layer, Result, Schema, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Changes } from "./Changes.ts";
import * as ChangesGit from "./ChangesGit.ts";

type Said = { readonly code: number; readonly out: string };

const handle = ({ code, out }: Said) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.die("fixture never signals a process"),
    stdin: Sink.drain,
    stdout: Stream.make(new TextEncoder().encode(out)),
    stderr: Stream.make(new TextEncoder().encode(code === 0 ? "" : "fatal: bad revision\n")),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });

/** `git`, as a stand-in: every call is answered the same way, and kept in order. */
const layers = (said: Said) => {
  const spawner = Recorder.layer(ChildProcessSpawner.ChildProcessSpawner, {
    spawn: () => Effect.succeed(handle(said)),
  });

  return Layer.merge(spawner, ChangesGit.layer.pipe(Layer.provide(spawner)));
};

/** Every call `git` was asked: the command, its arguments and the folder it ran in. */
const asked = Effect.map(Recorder.calls(ChildProcessSpawner.ChildProcessSpawner, "spawn"), (calls) =>
  calls.map(([command]) =>
    ChildProcess.isStandardCommand(command)
      ? { command: command.command, args: command.args.map(String), cwd: command.options.cwd }
      : { command: "not a command", args: [], cwd: undefined },
  ),
);

const head = "0123456789abcdef0123456789abcdef01234567";

/** Names git can print: plain ones, and the ones a line-based reader or a quoting one gets wrong. */
const Name = Schema.Union([
  Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/^[^\0]+$/)),
  Schema.Literals([
    "a b/c d.ts",
    "line\nbreak.ts",
    "é/ü ö.ts",
    "trailing space ",
    " leading",
    "tab\there",
    '"quoted".md',
    "-dash",
  ]),
]);

const Answer = Schema.Struct({
  names: Schema.Array(Name).check(Schema.isMaxLength(8)),
  dir: Schema.Literals([".", "/checkout", "/a b/c"]),
});

describe("CG1: the changed paths (slice 2)", () => {
  // Plants, each run once and restored: drop `--no-renames`, so a move names only its new path; split on newlines, so a name with one splits in
  // two; diff two dots in place of three; run it in another folder; ask for a fetch first.
  it.effect.prop(
    "property: the paths are one git diff of `origin/main...<head>` with no rename detection, NUL-separated, run in the given checkout, and every name comes back whole and in git's order",
    Answer.fields,
    ({ names, dir }) =>
      Effect.gen(function* () {
        const paths = yield* (yield* Changes).paths(dir, head);

        expect(paths).toEqual(names);

        expect(yield* asked).toEqual([
          { command: "git", args: ["diff", "--name-only", "-z", "--no-renames", `origin/main...${head}`], cwd: dir },
        ]);
      }).pipe(Effect.provide(layers({ code: 0, out: names.map((name) => `${name}\0`).join("") }))),
    { arbitrary: { seed: 2344, runs: runsFor({ fast: 200, full: 400 }) } },
  );

  // Plants: treat a failed git as no paths, a name with no ending NUL as a whole name, or a cut name as the paths so far.
  it.effect.prop(
    "property: a git that exits non-zero, or whose last name has no NUL after it (the answer was cut), is a `ChangesError` and never a list of paths",
    {
      names: Schema.Array(Name).check(Schema.isMinLength(1), Schema.isMaxLength(5)),
      fault: Schema.Literals(["exit1", "exit128", "cut"]),
    },
    ({ names, fault }) =>
      Effect.gen(function* () {
        const result = yield* Effect.result((yield* Changes).paths(".", head));

        expect(Result.isFailure(result) && result.failure._tag).toBe("ChangesError");
      }).pipe(
        Effect.provide(
          layers(
            fault === "cut"
              ? {
                  code: 0,
                  out: names
                    .map((name) => `${name}\0`)
                    .join("")
                    .slice(0, -1),
                }
              : { code: fault === "exit1" ? 1 : 128, out: names.map((name) => `${name}\0`).join("") },
          ),
        ),
      ),
    { arbitrary: { seed: 2345, runs: runsFor({ fast: 60, full: 200 }) } },
  );
});
