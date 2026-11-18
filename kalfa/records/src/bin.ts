/**
 * The edge: runs `records` in the folder it is called from, with Node's file system, `git` for the
 * tracked files and the TOML parser the settings need. `pnpm lint` runs
 * `node kalfa/records/src/bin.ts check`.
 *
 * The exit code is 0 for a clean repo, 1 when `check` found something (its lines are already printed),
 * and 2 for any other failure, which is printed.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as TomlParser from "@kalfa/config/TomlParser";
import { Cause, Console, Effect, Exit, Layer, Predicate } from "effect";
import { Command } from "effect/cli";
import { Digest } from "effect/crypto";
import { records } from "./cli.ts";
import { Tracked } from "./Tracked.ts";

const services = Layer.mergeAll(Tracked.layer, TomlParser.layer, Digest.layerWebCrypto).pipe(
  Layer.provideMerge(NodeServices.layer),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(records, { version: "0.0.0" })(process.argv.slice(2)).pipe(
      Effect.as(0),
      Effect.catchTag("Failed", () => Effect.succeed(1)),
      Effect.catchCause((cause) => Console.error(Cause.pretty(cause)).pipe(Effect.as(2))),
      Effect.provide(services),
    ),
    {
      disableErrorReporting: true,
      teardown: (exit, onExit) => onExit(Exit.isSuccess(exit) && Predicate.isNumber(exit.value) ? exit.value : 2),
    },
  );
}
