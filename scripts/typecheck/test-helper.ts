// Test helpers for two typecheck laws that live in Promise-based files (caps.test.ts and
// typecheck.integration.test.ts), so those files need not import Effect. The file name is the one
// code-graph reads as test support (`test-helper.ts`). Ticket 766, today's tooling (0113), following
// next/'s rules (0033).
import { NodeServices } from "@effect/platform-node";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { type Command, Commands, type Ended } from "./Commands.ts";
import * as CommandsProcess from "./CommandsProcess.ts";
import * as CommandsTest from "./CommandsTest.ts";
import * as LocksTest from "./LocksTest.ts";
import * as NodeModulesTest from "./NodeModulesTest.ts";
import { Listing } from "./Processes.ts";
import * as ProcessesTest from "./ProcessesTest.ts";
import * as Typecheck from "./Typecheck.ts";

/**
 * Runs the program in this process on the test layers, with `env` as the config's environment: a
 * `node_modules` folder, every command exiting 0, and no compiler running. Hands back its exit code
 * and each path the lock was handed. Nothing takes a real lock or starts a process.
 */
export const programOnTestLayers = (env: Record<string, string>) => {
  const log: Array<string> = [];
  const folder = NodeModulesTest.folder("folder", log);
  const taken = LocksTest.taken(log);
  const layer = Layer.mergeAll(
    LocksTest.layer(taken),
    CommandsTest.layer(CommandsTest.script({}, log, folder)),
    ProcessesTest.layer(ProcessesTest.table([Listing.cases.listed.make({ pids: [] })]), process.pid),
    NodeModulesTest.layer(folder),
    ConfigProvider.layer(ConfigProvider.fromEnvRecord(env)),
  );
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: a Promise-based test awaits it
  return Effect.runPromise(
    Effect.map(Effect.provide(Typecheck.program, layer), (code) => ({ code, paths: [...taken.paths] })),
  );
};

/**
 * Runs `commands` one after another on CommandsProcess.layer over Node's own spawner, real processes.
 * Hands back how each ended, and for each call of `started`, whether it was handed a pid.
 */
export const commandsOnNode = (commands: ReadonlyArray<Command>) => {
  const heard: Array<boolean> = [];
  const started = (pid: Option.Option<number>) =>
    Effect.sync(() => {
      heard.push(Option.isSome(pid));
    });
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: a Promise-based test awaits it
  return Effect.runPromise(
    Effect.gen(function* () {
      const run = (yield* Commands).run;
      const ended: Array<Ended> = [];

      for (const command of commands) {
        ended.push(yield* run(command, started));
      }

      return { ended, heard };
    }).pipe(Effect.provide(Layer.provide(CommandsProcess.layer, NodeServices.layer))),
  );
};
