// CommandsTest.layer: the Commands service in memory. Each command ends as the law told it to, by its
// first word after `pnpm` (`install`, `exec` for the patch, `-r` for the check), and starts nothing.
// Like the real layer, it hands `started` a pid first and `none` once the command has ended, and it
// writes `run <command>` and `ended <command>` to the shared log. An install that the law says leaves
// a folder turns NodeModulesTest's shape to `folder`. Today's tooling (0113), following next/'s rules
// (0033).
import { Effect, Layer, Option } from "effect";
import { Commands, Ended } from "./Commands.ts";
import type { Folder } from "./NodeModulesTest.ts";

/** How one command ends, and for the install whether it leaves a `node_modules` folder. */
export type Answer = { readonly ended: Ended; readonly leavesFolder?: boolean };

export type Script = {
  /** How each command ends, by its key: `install`, `patch` or `check`; a command with none exits 0. */
  readonly answers: Partial<Record<"install" | "patch" | "check", Answer>>;
  /** The shared log. */
  readonly log: Array<string>;
  /** The folder the install fills. */
  readonly folder: Folder;
  /** The next pid a command gets. */
  pid: number;
};

export const script = (answers: Script["answers"], log: Array<string>, folder: Folder): Script => ({
  answers,
  log,
  folder,
  pid: 7000,
});

const keyFor = (args: ReadonlyArray<string>) =>
  args[0] === "install" ? "install" : args[0] === "exec" ? "patch" : args[0] === "-r" ? "check" : undefined;

export const layer = (s: Script): Layer.Layer<Commands> =>
  Layer.succeed(
    Commands,
    Commands.of({
      run: (command, started) =>
        Effect.gen(function* () {
          const line = [command.cmd, ...command.args].join(" ");
          const key = keyFor(command.args);

          if (key === undefined) {
            return yield* Effect.die(new Error(`CommandsTest: no answer for ${line}`));
          }

          s.pid += 1;
          s.log.push(`run ${line}`);
          yield* started(Option.some(s.pid));
          const answer = s.answers[key] ?? { ended: Ended.cases.exited.make({ code: 0 }) };

          const passed = Ended.match(answer.ended, { exited: ({ code }) => code === 0, signaled: () => false });

          if (key === "install" && passed && answer.leavesFolder !== false) {
            s.folder.shape = "folder";
          }

          s.log.push(`ended ${line}`);
          yield* started(Option.none());
          return answer.ended;
        }),
    }),
  );
