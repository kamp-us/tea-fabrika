// The child process Recorded.integration.test.ts starts (L16 of .kalfa/quests/land-record-PLAN.md): `Recorded.around` under
// `NodeRuntime.runMain`, as `land.ts` runs it, with a command that prints `ready` and then waits for ever. The law sends it real
// signals and reads the record it leaves in the folder this script is given. Today's lead tooling, run on our own laptop.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Duration, Effect, Option } from "effect";
import { Key } from "./LandLog.ts";
import * as LandLogFs from "./LandLogFs.ts";
import * as Recorded from "./Recorded.ts";

const [dir = ""] = process.argv.slice(2);

const waiting = Recorded.around(
  {
    command: "queue",
    keys: () => [Key.cases.pr.make({ pr: 2351 })],
    argv: ["queue", "2351", "--wait-ci"],
    pid: process.pid,
    every: Duration.hours(1),
    refusal: () => Option.none<{ readonly check: string; readonly reason: string }>(),
  },
  () => Console.log("ready").pipe(Effect.andThen(Effect.never)),
);

NodeRuntime.runMain(waiting(undefined).pipe(Effect.provide(LandLogFs.layer(dir)), Effect.provide(NodeServices.layer)), {
  disableErrorReporting: true,
});
