// sev.ts: the command line of a sev, the level CI is in (decision 0532 for sev0, 0542 for the two
// levels and sev1). Today's lead tooling, run on our own laptop; it is not product. Incident.ts
// says what each command does, Freeze.ts what the loop does, Level.ts what the levels are.
//
//   node sev.ts open 0 --reason <why> --allow <branch>...   a sev0, on the owner's call; runs the
//                                                         cancel loop until a close, so start it
//                                                         in the background
//   node sev.ts next <branch>                             that branch alone is allowed: the next fix
//   node sev.ts allow <branch>                            one more fix branch, while it runs
//   node sev.ts close --by owner|lead                     ends the sev0: stops the loop, prints the
//                                                         walk, the full run to start and the level
//   node sev.ts status                                    the level now, since when and why
//   node sev.ts loop                                      the cancel loop again, when the first died
//
// A sev1 is never opened here: it is on while a `ci-scheduled` issue is open, and the script only
// reads those. The log lives in `runs/sev/` of the checkout this script sits in, so run every
// command from the same checkout. GH_REPO (owner/name) names the repo, else the checkout's origin.
// SEV_SECONDS sets the beat (0069: a choice is a setting), default 20; a close waits three beats.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Console, Duration, Effect, Layer, Option, Path, Predicate, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as BranchesGit from "../../lead/scripts/pr/BranchesGit.ts";
import { run } from "../../lead/scripts/pr/command.ts";
import * as PullRequestsGh from "../../lead/scripts/pr/PullRequestsGh.ts";
import * as AlertsGh from "./AlertsGh.ts";
import * as Freeze from "./Freeze.ts";
import * as Incident from "./Incident.ts";
import { Refused } from "./Level.ts";
import * as WorkflowRunsGh from "./WorkflowRunsGh.ts";

/** Seconds between two beats of the cancel loop. */
const SECONDS = Config.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), "SEV_SECONDS").pipe(
  Config.withDefault(20),
);

/** The repo to ask, when it is not the checkout's origin. */
const REPO = Config.option(Config.NonEmptyString("GH_REPO"));

/** The checkout this script sits in: `.agents/skills/sev/scripts/` is four folders down. */
const checkout = Effect.map(Path.Path, (path) => path.resolve(import.meta.dirname, "..", "..", "..", ".."));

/** Where everything the commands share is: the folder, the beat, how long a close waits, the services. */
const setup = Effect.gen(function* () {
  const path = yield* Path.Path;
  const dir = yield* checkout;
  const named = yield* REPO;

  const repo = Option.isSome(named)
    ? named.value
    : PullRequestsGh.repoFromUrl((yield* run("git", ["-C", dir, "remote", "get-url", "origin"], dir)).out);

  if (repo === null) {
    return yield* Refused.make({ reason: "no GH_REPO, and an origin that is not a GitHub repo" });
  }

  const every = Duration.seconds(yield* SECONDS);

  const services = Layer.mergeAll(
    WorkflowRunsGh.layer(repo, dir),
    PullRequestsGh.layer(repo, dir),
    BranchesGit.layer(dir),
    AlertsGh.layer(repo, dir),
  );

  return { home: path.join(dir, "runs", "sev"), every, wait: Duration.times(every, 3), services };
});

/** The services of the commands that call GitHub, given to each with `Command.provide`. */
const services = Layer.unwrap(Effect.map(setup, (s) => s.services));

const openCommand = Command.make(
  "open",
  {
    level: Argument.Literals("level", ["0"]).pipe(
      Argument.withDescription("0, the one level opened here: a sev1 is an open ci-scheduled issue"),
    ),
    reason: Flag.String("reason").pipe(Flag.withDescription("Why the owner called it")),
    allow: Flag.String("allow").pipe(
      Flag.atLeast(0),
      Flag.withDescription("A branch that fixes the emergency, whose runs are kept; give it once per branch"),
    ),
  },
  Effect.fn(function* ({ reason, allow }) {
    const { home, every } = yield* setup;
    yield* Effect.andThen(Incident.open({ home, reason, allow }), Freeze.loop(home, every, process.pid));
  }),
).pipe(
  Command.provide(services),
  Command.withDescription("Open a sev0 on the owner's call, and cancel every other run until a close"),
);

const branchArgument = Argument.String("branch").pipe(Argument.withSchema(Schema.NonEmptyString));

const nextCommand = Command.make(
  "next",
  { branch: branchArgument },
  Effect.fn(function* ({ branch }) {
    yield* Incident.next((yield* setup).home, branch);
  }),
).pipe(Command.withDescription("Make one fix branch the whole allow list: the next fix to land"));

const allowCommand = Command.make(
  "allow",
  { branch: branchArgument },
  Effect.fn(function* ({ branch }) {
    yield* Incident.allow((yield* setup).home, branch);
  }),
).pipe(Command.withDescription("Keep one more fix branch's runs, while the sev0 is open"));

const closeCommand = Command.make(
  "close",
  {
    by: Flag.Literals("by", ["owner", "lead"]).pipe(
      Flag.withDescription("Who ended it: the lead once every fix merged, or the owner who called it off"),
    ),
  },
  Effect.fn(function* ({ by }) {
    const { home, wait } = yield* setup;
    yield* Incident.close(home, by, wait);
  }),
).pipe(
  Command.provide(services),
  Command.withDescription("End the sev0: stop the loop, print what the lead does next and the level now"),
);

const statusCommand = Command.make(
  "status",
  {},
  Effect.fn(function* () {
    const { home } = yield* setup;
    yield* Incident.status(home);
  }),
).pipe(
  Command.provide(services),
  Command.withDescription("Print the level now: sev0, sev1 or none, since when and why"),
);

const loopCommand = Command.make(
  "loop",
  {},
  Effect.fn(function* () {
    const { home, every } = yield* setup;
    yield* Freeze.loop(home, every, process.pid);
  }),
).pipe(
  Command.provide(services),
  Command.withDescription("Run the cancel loop of the open sev0 again, when the one before died"),
);

const sev = Command.make("sev").pipe(
  Command.withSubcommands([openCommand, nextCommand, allowCommand, closeCommand, statusCommand, loopCommand]),
);

/** A refusal or a failed GitHub call ends the command with its reason and exit 1. */
const told = (e: unknown) =>
  Predicate.hasProperty(e, "reason") && Predicate.isString(e.reason)
    ? Effect.andThen(
        Console.error(`sev: ${e.reason}`),
        Effect.sync(() => {
          process.exitCode = 1;
        }),
      )
    : Effect.void;

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(sev, { version: "0.0.0" })(process.argv.slice(2)).pipe(
      Effect.tapError(told),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
