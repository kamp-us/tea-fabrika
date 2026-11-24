/**
 * The edge: runs `kalfa` in the folder it is called from, on Node's platform.
 *
 * **Details**
 *
 * The folder it is called from is the repo's root: `kalfa` reads the `package.json` there and nowhere else. The exit code is `main`'s, and an exit that is not a success ends 2. Both standard streams are written out before the process exits: Effect's `runMain` calls `process.exit` at once for a code that is not 0, and a pipe may still hold output that has not been read.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Exit, Layer, Predicate } from "effect";
import { layerNode } from "./internal/packages.ts";
import { main } from "./internal/run.ts";

if (import.meta.main) {
  const platform = Layer.provideMerge(layerNode(process.cwd()), NodeServices.layer);

  NodeRuntime.runMain(Effect.provide(main(process.argv.slice(2)), platform), {
    disableErrorReporting: true,
    teardown: (exit, onExit) => {
      const code = Exit.isSuccess(exit) && Predicate.isNumber(exit.value) ? exit.value : 2;

      // An empty write ends when everything before it is written, so each callback runs after that stream is whole.
      process.stdout.write("", () => process.stderr.write("", () => onExit(code)));
    },
  });
}
