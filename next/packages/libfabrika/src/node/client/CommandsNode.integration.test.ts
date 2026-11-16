// P39 slice 4b, next/: the real command layer on a real process, C4 and C5 (0536: the schedule).
//
// C4 runs the runner's own `git --version` through the real spawner: no signal, no instance. Its
// line is the shape of `fixtures/next/hands/git-version.json`, the vectors C1 replays.
//
// C5 is host-only: closing the child's scope sends a real child a real signal, so it runs only in
// CI's full run, in its container (0045), never on a laptop.
//
// Plants, each run once and undone (recorded in the tests step's field row): C4, keep the trailing
// newline in `version`. C5, answer `output_limit` without closing the child's scope.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schedule from "effect/Schedule";
import { Commands } from "../../client/Commands.ts";
import { Command, Result } from "../../tasks/Task.ts";
import * as CommandsNode from "./CommandsNode.ts";
import { capped } from "./internal/capped.ts";

const CAP = 4096;

describe("P39 slice 4b: the real command on a real host", () => {
  it.live(
    "C4 scenario: the real git --version on the runner, through the real spawner, answers exited with code 0 and a version that starts with git version",
    () =>
      Effect.gen(function* () {
        const commands = yield* Commands;
        expect(commands.has, "C4: the runner has git on its PATH").toEqual(["git"]);
        const answer = yield* commands.execute(Command.cases.git_version.make({}));
        expect(answer._tag, `C4: real git exits: ${JSON.stringify(answer)}`).toBe("exited");

        if (answer._tag !== "exited") {
          return;
        }

        expect(answer.code).toBe(0);
        expect(answer.version.startsWith("git version "), `C4: ${JSON.stringify(answer.version)}`).toBe(true);
        expect(answer.version.endsWith("\n"), "C4: the trailing newline is dropped").toBe(false);
        // The line C1's vectors replay: one line, far under the cap.
        expect(answer.version.includes("\n")).toBe(false);
        expect(new TextEncoder().encode(answer.version).length).toBeLessThan(CAP);
      }).pipe(Effect.provide(CommandsNode.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
    30_000,
  );

  it.live(
    "C5 scenario: a real child that prints past the cap is stopped: after execute answers failed output_limit, its pid is gone",
    () =>
      Effect.gen(function* () {
        const real = yield* ChildProcessSpawner.ChildProcessSpawner;
        const pids: Array<number> = [];
        // The real spawner, with each child's pid kept so the law can look for it afterward.
        const watched = ChildProcessSpawner.make((command) =>
          real.spawn(command).pipe(Effect.tap((handle) => Effect.sync(() => pids.push(handle.pid)))),
        );
        const PATH = yield* Config.String("PATH");
        // A Node child that prints without end: it never exits by itself.
        const forever = "const b = Buffer.alloc(1024, 120); for (;;) process.stdout.write(b);";
        const answer = yield* capped(watched, [process.execPath, ["-e", forever]], { PATH }, CAP).pipe(
          Effect.timeout("20 seconds"),
        );
        expect(answer, "C5: the child past its cap answers output_limit").toEqual(
          Result.cases.failed.make({ reason: "output_limit" }),
        );
        expect(pids.length, "C5: one child was spawned").toBe(1);
        const pid = pids[0] ?? 0;
        // Gone means no process holds the pid: signal 0 checks and sends nothing. The kill is
        // asynchronous, so the check waits up to five seconds.
        const alive = Effect.try({ try: () => process.kill(pid, 0), catch: () => "gone" }).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        const gone = yield* alive.pipe(
          Effect.repeat({ while: (running) => running, schedule: Schedule.spaced("100 millis"), times: 50 }),
        );
        expect(gone, `C5: pid ${pid} is gone once execute answered`).toBe(false);
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000,
  );
});
