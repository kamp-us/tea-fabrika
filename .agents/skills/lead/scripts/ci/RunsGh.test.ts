// Today's tooling. Recorded child-process answers, with no GitHub access or process signals.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, PlatformError, Schema, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Runs } from "./Runs.ts";
import * as RunsGh from "./RunsGh.ts";

const head = "a".repeat(40);

const branch = "fabrikalfa/repair";

const ref = (sha = head) => JSON.stringify({ object: { type: "commit", sha } });

type Answer = { readonly out: string; readonly code?: number; readonly missing?: boolean };

const memory = (answers: ReadonlyArray<Answer>) => {
  const calls: Array<{ readonly cmd: string; readonly args: ReadonlyArray<string>; readonly stdin: string }> = [];

  const spawner = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        if (!ChildProcess.isStandardCommand(command)) {
          return yield* Effect.die("expected a standard command");
        }

        const answer: Answer = answers[calls.length] ?? { out: "unexpected child process", code: 1 };
        const input = command.options.stdin;
        const stdin = Stream.isStream(input) ? yield* Stream.mkString(Stream.decodeText(input)) : "";
        calls.push({ cmd: command.command, args: command.args.map(String), stdin });

        if (answer.missing === true) {
          return yield* PlatformError.systemError({ _tag: "NotFound", module: "ChildProcessSpawner", method: "spawn" });
        }

        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(answer.code ?? 0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.die("fixture never signals a process"),
          stdin: Sink.drain,
          stdout: Stream.make(new TextEncoder().encode(answer.out)),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        });
      }),
    ),
  );

  return { calls, layer: RunsGh.layer("fixture/repo", ".").pipe(Layer.provide(spawner)) };
};

describe("new branch-proof preflight", () => {
  // Plant: replace the requested workflow ref with the old fixed head; generated requests must expose it.
  it.effect.prop(
    "property: only the exact branch head's YAML reaches the trusted local job-slot check",
    {
      head: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
      branch: Schema.String.check(Schema.isPattern(/^fabrikalfa\/[a-z][a-z0-9_-]{0,24}$/)),
      // GitHub source arrives as UTF-8 bytes, which cannot contain an unpaired UTF-16 surrogate.
      yaml: Schema.String.check(
        Schema.makeFilter((text) => new TextDecoder().decode(new TextEncoder().encode(text)) === text),
      ),
    },
    ({ head, branch, yaml }) => {
      const m = memory([{ out: ref(head) }, { out: yaml }, { out: "scheduled job slots conform\n" }]);

      return Effect.gen(function* () {
        yield* (yield* Runs).preflight(branch, head);
        expect(m.calls).toEqual([
          {
            cmd: "gh",
            args: ["api", "-X", "GET", `repos/fixture/repo/git/ref/heads/${encodeURIComponent(branch)}`],
            stdin: "",
          },
          {
            cmd: "gh",
            args: [
              "api",
              "-X",
              "GET",
              "repos/fixture/repo/contents/.github/workflows/scheduled.yaml",
              "-f",
              `ref=${head}`,
              "-H",
              "Accept: application/vnd.github.raw+json",
            ],
            stdin: "",
          },
          { cmd: "node", args: [".github/ci/workflow-lint/scheduled.ts", "--job-slots"], stdin: yaml },
        ]);
      }).pipe(Effect.provide(m.layer));
    },
  );

  it.effect.prop(
    "property: missing, moved or malformed branch heads stop before reading workflow text",
    {
      body: Schema.Literals([ref("b".repeat(40)), "{}", "not JSON", ref("short")]),
    },
    ({ body }) => {
      const m = memory([{ out: body }]);

      return Effect.gen(function* () {
        yield* Effect.flip((yield* Runs).preflight(branch, head));
        expect(m.calls).toHaveLength(1);
      }).pipe(Effect.provide(m.layer));
    },
  );

  it.effect.prop(
    "property: a refused checker, malformed YAML or an older checker without the command contract cannot pass",
    {
      answer: Schema.Literals(["malformed", "unsafe", "unsupported", "nonzero"]),
    },
    ({ answer }) => {
      const replies = {
        malformed: { out: "scheduled.yaml: invalid YAML", code: 1 },
        unsafe: { out: "scheduled.yaml: SC19: tests shares its fixed job slots", code: 1 },
        unsupported: { out: "", code: 0 },
        nonzero: { out: "scheduled job slots conform", code: 1 },
      };

      const m = memory([{ out: ref() }, { out: "untrusted YAML" }, replies[answer]]);

      return Effect.gen(function* () {
        const refused = yield* Effect.flip((yield* Runs).preflight(branch, head));
        expect(refused.reason).toContain("new proof on fabrikalfa/repair");
        expect(m.calls).toHaveLength(3);
      }).pipe(Effect.provide(m.layer));
    },
  );

  // Plant: accept hexadecimal heads of any length; every case must still refuse its short and long requests.
  it.effect.prop(
    "property: inexact requested heads are refused without asking GitHub",
    {
      short: Schema.String.check(Schema.isPattern(/^[0-9a-f]{0,39}$/)),
      long: Schema.String.check(Schema.isPattern(/^[0-9a-f]{41,80}$/)),
      malformed: Schema.String.check(Schema.isPattern(/^[g-z][0-9a-f]{39}$/)),
    },
    ({ short, long, malformed }) =>
      Effect.gen(function* () {
        // Every generated case reaches a short, a long and an exact-length non-hex request.
        for (const requested of [short, long, malformed]) {
          const m = memory([]);

          const error = yield* Effect.flatMap(Runs, (runs) => Effect.flip(runs.preflight(branch, requested))).pipe(
            Effect.provide(m.layer),
          );

          expect(error._tag).toBe("RunsError");
          expect(error.reason).toContain("exact forty-character");
          expect(m.calls).toEqual([]);
        }
      }),
  );

  it.effect.prop(
    "property: a refused branch or workflow read stays a typed error and never runs the checker",
    {
      at: Schema.Literals(["ref", "workflow"]),
    },
    ({ at }) => {
      const refused = { out: "Not Found", code: 1 };
      const m = memory(at === "ref" ? [refused] : [{ out: ref() }, refused]);

      return Effect.gen(function* () {
        const error = yield* Effect.flip((yield* Runs).preflight(branch, head));
        expect(error._tag).toBe("RunsError");
        expect(error.reason).toContain("exited 1: Not Found");
        expect(m.calls.map((call) => call.cmd)).toEqual(at === "ref" ? ["gh"] : ["gh", "gh"]);
      }).pipe(Effect.provide(m.layer));
    },
  );

  it.effect.prop(
    "property: missing gh or a missing local checker stays a typed error",
    {
      at: Schema.Literals(["gh", "checker"]),
    },
    ({ at }) => {
      const missing = { out: "", missing: true };
      const m = memory(at === "gh" ? [missing] : [{ out: ref() }, { out: "the YAML" }, missing]);

      return Effect.gen(function* () {
        const error = yield* Effect.flip((yield* Runs).preflight(branch, head));
        expect(error._tag).toBe("RunsError");
        expect(error.reason).toContain(at === "gh" ? "gh could not start" : "proof preflight could not start");
        expect(m.calls).toHaveLength(at === "gh" ? 1 : 3);
      }).pipe(Effect.provide(m.layer));
    },
  );
});
