// The typecheck's program: `pnpm typecheck` under the one machine-wide lock (0410, 0012). It checks
// `./node_modules` before the lock, holds the lock, waits on the laptop for any compiler the lock
// does not cover, replaces a linked `node_modules` with this worktree's own offline install, then
// runs the patch and the check in turn; the first command that fails ends the run with its status.
// Every line goes to stderr. `main` runs it as the process. Today's tooling (0113), following
// next/'s rules (0033).
import { constants } from "node:os"; // edge: Effect has no table of signal numbers, for 128 plus a signal
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Console, Effect, Exit, Layer, Predicate } from "effect";
import { CHECK, INSTALL, PATCH } from "../typecheck.ts";
import { type Command, Commands, Ended } from "./Commands.ts";
import * as CommandsProcess from "./CommandsProcess.ts";
import { Locks } from "./Locks.ts";
import * as LocksFile from "./LocksFile.ts";
import { NodeModules } from "./NodeModules.ts";
import * as NodeModulesFs from "./NodeModulesFs.ts";
import { Processes } from "./Processes.ts";
import * as ProcessesPs from "./ProcessesPs.ts";

/** A variable from the environment, or `fallback` where it is unset or empty, as the shell's `${name:-fallback}`. */
const setting = (name: string, fallback: string) =>
  Config.String(name).pipe(
    Config.withDefault(""),
    Config.map((value) => (value === "" ? fallback : value)),
  );

// One fixed system file, never under TMPDIR: agents' TMPDIR differs, and the lock must be shared.
// Only a test points FABRIKA_TYPECHECK_LOCK at a file of its own, so a real typecheck on the same
// machine never holds up its fake compilers, and they never hold up a real typecheck.
const LOCK = setting("FABRIKA_TYPECHECK_LOCK", "/tmp/fabrika-typecheck.lock");
// The compiler's process name, which the laptop wait looks for. Only a test names another, for the
// same reason as the lock: a real tsgo on the machine never holds up a law's stand-ins.
const COMPILER = setting("FABRIKA_TYPECHECK_COMPILER", "tsgo");
// CI runs one job to a machine and skips the compiler wait, as the test config's guard reads CI (0410).
const CI = setting("CI", "");

const NO_FOLDER = "typecheck: node_modules is no folder; remove it and run pnpm install --offline --frozen-lockfile";

const INSTALL_FAILED =
  "typecheck: node_modules was a link and is removed, but the offline install failed; run pnpm install --frozen-lockfile";

/** Prints `line` and ends the run with 1. */
const failed = (line: string) => Console.error(line).pipe(Effect.as(1));

/** The exit status a command's end gives the run: its code, or 128 plus its signal's number. */
const exitStatus = (ended: Ended) =>
  Ended.match(ended, {
    exited: ({ code }) => code,
    signaled: ({ signal }) => {
      const number = Object.entries(constants.signals).find(([name]) => name === signal)?.[1];
      return number === undefined ? 1 : 128 + number;
    },
  });

/**
 * On the laptop, a compiler this lock does not cover (a package's own tsc, a tool's tsgo) still takes
 * about 8 cores, and two at once froze it (AGENTS.md, 0012). So the holder waits until none runs, the
 * same wait drive.ts makes before a step. An editor's language server is `tsgo --lsp --stdio`, which
 * runs as long as the editor is open, so it is left out. Where pgrep cannot list processes (a
 * sandbox), the wait is skipped with one line, never read as "none running".
 */
const waitForCompiler = Effect.fnUntraced(function* (compiler: string) {
  const processes = yield* Processes;
  let said = false;

  for (;;) {
    const listing = yield* processes.named(compiler);

    if (listing._tag === "refused") {
      return yield* Console.error(
        `typecheck: pgrep cannot list processes here, so the wait for a running ${compiler} is skipped`,
      );
    }

    const running: Array<{ readonly pid: number; readonly args: string }> = [];

    for (const pid of listing.pids) {
      const args = yield* processes.args(pid);

      if (!args.split(/\s+/).includes("--lsp")) {
        running.push({ pid, args });
      }
    }

    const [first] = running;

    if (first === undefined) {
      return;
    }

    if (!said) {
      said = true;
      const holder = first.args === "" ? `pid ${first.pid}` : `pid ${first.pid} (${first.args})`;
      yield* Console.error(`typecheck: waiting for ${holder}, a ${compiler} already running`);
    }

    yield* Effect.sleep("1 second");
  }
});

/** The run, once `./node_modules` is a folder, a link or missing: under the lock, to the first failure. */
const underLock = Effect.fnUntraced(function* (lock: string, compiler: string, ci: boolean) {
  const modules = yield* NodeModules;
  const commands = yield* Commands;
  const held = yield* (yield* Locks).hold(lock);

  if (!ci) {
    yield* waitForCompiler(compiler);
  }

  // A linked node_modules (a worktree pointed at another checkout's) is never written through: the
  // patch would change the other checkout's compiler, and an install through the link rewrites its
  // install state. Only the link goes, never what it points at, and this worktree gets its own
  // install from the warm store, with no network. Under the lock, since the install's `prepare` runs
  // the same patch and a second typecheck here must find the folder, not the link.
  const linked = (yield* modules.shape) === "link";

  if (linked) {
    yield* modules.unlink;
  }

  const env = { FABRIKA_TYPECHECK_LOCK: lock, FABRIKA_TYPECHECK_COMPILER: compiler };
  const steps: ReadonlyArray<Command> = linked ? [INSTALL, PATCH, CHECK] : [PATCH, CHECK];

  for (const step of steps) {
    let status = exitStatus(yield* commands.run({ ...step, env }, held.running));

    // An install that says it passed but leaves no folder has not passed.
    if (status === 0 && step === INSTALL && (yield* modules.shape) !== "folder") {
      status = 1;
    }

    if (status !== 0) {
      if (step === INSTALL) {
        yield* Console.error(INSTALL_FAILED);
      }

      return status;
    }
  }

  return 0;
});

/** The whole typecheck: its exit code, every line on stderr. A failure the run cannot read is exit 1. */
export const program: Effect.Effect<number, never, Locks | Commands | Processes | NodeModules> = Effect.gen(
  function* () {
    const lock = yield* LOCK;
    const compiler = yield* COMPILER;
    const ci = (yield* CI) !== "";

    // pnpm -r refuses a node_modules that is no folder (ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH). A link
    // is replaced under the lock. Anything else that is no folder is not ours to remove, so say so
    // before pnpm or the lock starts.
    if ((yield* (yield* NodeModules).shape) === "other") {
      yield* Console.error(NO_FOLDER);
      return 1;
    }

    return yield* Effect.scoped(underLock(lock, compiler, ci));
  },
).pipe(
  Effect.catchTags({
    LockError: (e) => failed(`typecheck: the lock ${e.path}: ${e.reason}`),
    CommandError: (e) => failed(`typecheck: ${e.command}: ${e.reason}`),
    NodeModulesError: (e) => failed(`typecheck: ${e.reason}`),
    ConfigError: (e) => failed(`typecheck: a setting does not read: ${e.message}`),
  }),
);

const live = Layer.mergeAll(LocksFile.layer, CommandsProcess.layer, NodeModulesFs.layer).pipe(
  Layer.provideMerge(ProcessesPs.layer),
  Layer.provide(NodeServices.layer),
);

/**
 * Runs the program as this process. A Ctrl-C or SIGTERM interrupts it, so the running command is
 * stopped and waited for and the lock let go; then the same signal is raised again, so the process
 * ends by it, as the shell that started it expects.
 */
export const main = (): void => {
  const heard: Array<NodeJS.Signals> = [];
  const hear = (signal: NodeJS.Signals) => {
    heard.push(signal);
  };
  process.once("SIGINT", hear);
  process.once("SIGTERM", hear);
  NodeRuntime.runMain(program.pipe(Effect.provide(live)), {
    disableErrorReporting: true,
    teardown: (exit, onExit) => {
      const [signal] = heard;
      process.removeListener("SIGINT", hear);
      process.removeListener("SIGTERM", hear);

      if (signal !== undefined) {
        // Effect has no form of a signal to this process (0250); its default action ends it.
        process.kill(process.pid, signal);
        return;
      }

      onExit(Exit.isSuccess(exit) && Predicate.isNumber(exit.value) ? exit.value : 1);
    },
  });
};
