// box.ts: the TypeScript half of box.sh, a Codex agent's own copy of tea-fabrika. Today's lead
// tooling, run on our own laptop; it is not product. box.sh hands it these subcommands:
//
//   box.ts rm <name>   remove a clean pair whose commits MAIN retains (box/Remove.ts says how)
//
// `new`, `run` and `fetch` still run in box.sh, and `gc` in gc.ts. Paths come from env.sh, which
// box.sh sources first: MAIN, BOXES. One result line on stdout; exit 0, 1 (kept) or 2 (bad name or
// usage), as box.sh's Python gave.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, ConfigProvider, Console, Effect, Layer, Option } from "effect";
import * as BoxGitProcess from "./box/BoxGitProcess.ts";
import * as Remove from "./box/Remove.ts";
import * as RunsProcess from "./box/RunsProcess.ts";

/** One variable of this process's environment, read through Config; unset is `undefined`. */
const text = (name: string) => Config.String(name).pipe(Config.option, Config.map(Option.getOrUndefined));

const setExit = (code: number) =>
  Effect.sync(() => {
    process.exitCode = code;
  });

const rm = Effect.fn("box.rm")(function* (name: string, places: { readonly boxes: string; readonly main: string }) {
  const removal = yield* Remove.remove(name, places);

  if (removal.runs !== "") {
    yield* Console.log(removal.runs);
  }

  yield* Console.log(Remove.line(removal));
  yield* setExit(Remove.exitCode(removal.verdict));
});

/** What `rm` calls: git from MAIN and the script that keeps a box's runs, on Node. */
const services = (main: string) =>
  Layer.mergeAll(
    BoxGitProcess.layer(main, process.env),
    RunsProcess.layer(`${import.meta.dirname}/keepruns.sh`, process.env),
  ).pipe(Layer.provideMerge(NodeServices.layer));

// A box name is read as the exact argument, never through a flag parser: a name such as "", "-h"
// or "--x" must reach the name check, which answers it with exit 2.
const [command, ...rest] = process.argv.slice(2);

const name = rest[0] ?? "";

const program = Effect.gen(function* () {
  if (command !== "rm" || rest.length !== 1) {
    yield* Console.error("usage: box.sh rm <name>");
    return yield* setExit(2);
  }
  const { main, boxes } = yield* Config.all({ main: text("MAIN"), boxes: text("BOXES") }).parse(
    ConfigProvider.fromEnv({ preserveEmptyStrings: true }),
  );
  if (main === undefined || boxes === undefined) {
    yield* Console.log(`kept box ${name}: inspection or removal failed`);
    return yield* setExit(1);
  }
  yield* rm(name, { boxes, main }).pipe(Effect.provide(services(main)));
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program, { disableErrorReporting: true });
