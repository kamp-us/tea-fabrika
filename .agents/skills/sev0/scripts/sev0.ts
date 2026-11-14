// sev0.ts: the command line of a sev0 freeze (decision 0532). Today's lead tooling, run on our own
// laptop; it is not product. Freeze.ts says what each command does.
//
//   node sev0.ts freeze --allow <branch> [--allow <branch>]...   runs until a stop; start it in the background
//   node sev0.ts allow <branch>                                  one more fix branch, while it runs
//   node sev0.ts stop                                            ends the loop, and waits until it has
//   node sev0.ts unfreeze                                        stops it if on, then reruns the canceled checks
//
// The state and the log live in `runs/sev0/` of the checkout this script sits in, so run every
// command from the same checkout. GH_REPO (owner/name) names the repo, else the checkout's origin.
// SEV0_SECONDS sets the beat (0069: a choice is a setting), default 20; a stop waits three beats.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Console, Duration, Effect, Layer, Path, Predicate, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { run } from "../../lead/scripts/pr/command.ts";
import * as PullRequestsGh from "../../lead/scripts/pr/PullRequestsGh.ts";
import * as Freeze from "./Freeze.ts";
import * as WorkflowRunsGh from "./WorkflowRunsGh.ts";

/** Seconds between two beats of the freeze loop. */
const SECONDS = Config.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), "SEV0_SECONDS").pipe(
  Config.withDefault(20),
);

/** The checkout this script sits in: `.agents/skills/sev0/scripts/` is four folders down. */
const checkout = Effect.map(Path.Path, (path) => path.resolve(import.meta.dirname, "..", "..", "..", ".."));

/** Where everything the commands share is: the folder, the repo, the beat and how long a stop waits. */
const setup = Effect.gen(function* () {
  const path = yield* Path.Path;
  const dir = yield* checkout;
  const origin = yield* run("git", ["-C", dir, "remote", "get-url", "origin"], dir);
  const repo = process.env.GH_REPO ?? PullRequestsGh.repoFromUrl(origin.out);

  if (repo === null) {
    return yield* new Freeze.Refused({ reason: "no GH_REPO, and an origin that is not a GitHub repo" });
  }

  const every = Duration.seconds(yield* SECONDS);
  const services = Layer.mergeAll(WorkflowRunsGh.layer(repo, dir), PullRequestsGh.layer(repo, dir));
  return { dir, home: path.join(dir, "runs", "sev0"), repo, every, wait: Duration.times(every, 3), services };
});

const freezeCommand = Command.make(
  "freeze",
  {
    allow: Flag.String("allow").pipe(
      Flag.atLeast(0),
      Flag.withDescription("A branch that fixes the emergency, whose runs are kept; give it once per branch"),
    ),
  },
  Effect.fn(function* ({ allow }) {
    const { home, repo, every, services } = yield* setup;
    yield* Freeze.freeze({ home, allow, every, repo, pid: process.pid }).pipe(Effect.provide(services));
  }),
).pipe(Command.withDescription("Cancel every run but the merge queue's and the allowed branches', until a stop"));

const allowCommand = Command.make(
  "allow",
  { branch: Argument.String("branch").pipe(Argument.withSchema(Schema.NonEmptyString)) },
  Effect.fn(function* ({ branch }) {
    yield* Freeze.allow((yield* setup).home, branch);
  }),
).pipe(Command.withDescription("Keep one more fix branch's runs, while the freeze runs"));

const stopCommand = Command.make(
  "stop",
  {},
  Effect.fn(function* () {
    const { home, wait } = yield* setup;
    yield* Freeze.stop(home, wait);
  }),
).pipe(Command.withDescription("End the freeze loop, and wait until it has"));

const unfreezeCommand = Command.make(
  "unfreeze",
  {},
  Effect.fn(function* () {
    const { home, wait, services } = yield* setup;
    yield* Freeze.unfreeze(home, wait).pipe(Effect.provide(services));
  }),
).pipe(Command.withDescription("Stop the freeze if it is on, then rerun the checks it canceled on open pull requests"));

const sev0 = Command.make("sev0").pipe(
  Command.withSubcommands([freezeCommand, allowCommand, stopCommand, unfreezeCommand]),
);

/** A refusal or a failed GitHub call ends the command with its reason and exit 1. */
const told = (e: unknown) =>
  Predicate.hasProperty(e, "reason") && Predicate.isString(e.reason)
    ? Effect.andThen(
        Console.error(`sev0: ${e.reason}`),
        Effect.sync(() => {
          process.exitCode = 1;
        }),
      )
    : Effect.void;

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(sev0, { version: "0.0.0" })(process.argv.slice(2)).pipe(
      Effect.tapError(told),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
