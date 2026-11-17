// Today's lead tooling. A read-only preflight for a new branch proof. It does not dispatch a run.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { Command, Flag } from "effect/cli";
import { Runs } from "./Runs.ts";
import * as RunsGh from "./RunsGh.ts";

const cli = Command.make(
  "proof-preflight",
  {
    repo: Flag.String("repo"),
    branch: Flag.String("branch"),
    head: Flag.String("head"),
  },
  Effect.fn("proofPreflight.cli")(function* ({ repo, branch, head }) {
    yield* Effect.gen(function* () {
      yield* (yield* Runs).preflight(branch, head);
    }).pipe(Effect.provide(RunsGh.layer(repo, process.cwd())));
    yield* Console.log(
      `Shared job groups confirmed at ${head}. To start the branch proof: gh workflow run scheduled.yaml -R ${repo} --ref ${branch}`,
    );
  }),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(cli, { version: "0.0.0" })(process.argv.slice(2)).pipe(
      Effect.tapErrorTag("RunsError", (error) => Console.error(`proof-preflight: ${error.reason}`)),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
