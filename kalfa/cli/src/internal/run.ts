/**
 * The whole run of `kalfa`: find the subcommands, load them, run the one asked for, print, and pick the exit code.
 *
 * **Details**
 *
 * `main` never fails: a run that could not finish is an outcome, and the exit code comes from the outcome in one place. The repo's root is decided by whoever provides `Packages`, and every subcommand is handed it as its `Path`.
 */
import { Cause, Console, Effect, Exit, Order, Path, Predicate, Ref, Schema } from "effect";
import { CliError, Command } from "effect/cli";
import type { Platform, Subcommand } from "../Subcommand.ts";
import { find } from "./find.ts";
import { load } from "./load.ts";
import { Packages } from "./packages.ts";
import * as Print from "./print.ts";

/** `kalfa`'s own version, shown by `--version` and kept on `cli.run`. */
const VERSION = "0.0.0";

/** How a run ended: with no error reported, with errors reported, or without finishing. */
const Outcome = Schema.Union([
  Schema.TaggedStruct("clean", { warnings: Schema.Int }),
  Schema.TaggedStruct("reported", { errors: Schema.Int, warnings: Schema.Int }),
  Schema.TaggedStruct("failed", { message: Schema.String }),
]).pipe(Schema.toTaggedUnion("_tag"));

type Outcome = typeof Outcome.Type;

/** 0 when the handler finished and no error was reported, 1 when it finished and errors were, 2 when it did not finish. */
const exitCode = (outcome: Outcome): 0 | 1 | 2 =>
  Outcome.match(outcome, { clean: (): 0 => 0, reported: (): 1 => 1, failed: (): 2 => 2 });

const NO_MESSAGE = "the subcommand stopped with a value that has no message.";

const STOPPED = "kalfa was stopped.";

// What a person is told when a run could not finish: effect/cli's own words for a bad invocation, else the message the failure carries.
const failedWith = (cause: Cause.Cause<unknown>): string => {
  const [first] = cause.reasons;

  if (first === undefined || Cause.isInterruptReason(first)) {
    return STOPPED;
  }

  const stop = Cause.isFailReason(first) ? first.error : first.defect;

  if (Schema.is(CliError.ShowHelp)(stop)) {
    return stop.errors.length === 0
      ? `\`${stop.commandPath.join(" ")}\` needs a subcommand.`
      : stop.errors.map((error) => error.message).join(" ");
  }

  return Predicate.hasProperty(stop, "message") && Predicate.isString(stop.message) ? stop.message : NO_MESSAGE;
};

/** `kalfa`'s command with every subcommand under it, sorted by root name. */
const tree = (subcommands: ReadonlyArray<Subcommand>) =>
  Command.make("kalfa").pipe(
    Command.withSubcommands(
      subcommands.toSorted(Order.mapInput(Order.String, (each) => each.name)).map((each) => each.command),
    ),
  );

/** The Path a subcommand gets: what Node's gives, except that a relative path starts at the repo's root. */
const rooted = (path: Path.Path, folder: string): Path.Path =>
  Path.make({ ...path, resolve: (...segments) => path.resolve(folder, ...segments) });

const command = Effect.fn("cli.command")(function* (
  subcommands: ReadonlyArray<Subcommand>,
  args: ReadonlyArray<string>,
  counts: Ref.Ref<Print.Counts>,
) {
  const packages = yield* Packages;
  const path = yield* Path.Path;
  const [first = ""] = args;

  // The first argument is a root name only when a subcommand has it: otherwise it is what a person typed.
  if (subcommands.some((each) => each.name === first)) {
    yield* Effect.annotateCurrentSpan("kalfa.cli.root", first);
  }

  yield* Command.runWith(tree(subcommands), { version: VERSION, renderErrors: false })(args).pipe(
    Effect.provide([Print.diagnostics(counts), Print.presenter]),
    Effect.provideService(Path.Path, rooted(path, packages.folder)),
  );
});

const exit = Effect.fn("cli.exit")(function* (outcome: Outcome, counts: Print.Counts) {
  const code = exitCode(outcome);

  yield* Effect.annotateCurrentSpan({
    "process.exit.code": code,
    "kalfa.cli.reported.errors": counts.errors,
    "kalfa.cli.reported.warnings": counts.warnings,
  });

  return code;
});

/**
 * The whole run: find, load, run, print, pick the exit code. A run that could not finish prints one line `kalfa: <message>` to standard error and answers 2.
 *
 * @category running
 */
export const main: (args: ReadonlyArray<string>) => Effect.Effect<0 | 1 | 2, never, Packages | Platform> = Effect.fn(
  "cli.run",
)(function* (args: ReadonlyArray<string>) {
  yield* Effect.annotateCurrentSpan("kalfa.cli.version", VERSION);

  const counts = yield* Ref.make<Print.Counts>({ errors: 0, warnings: 0 });

  // A handler that interrupts itself is a failure of the run, caught by `exit`. Ctrl-C interrupts the whole run, which says so before it ends.
  const finished = yield* Effect.exit(
    Effect.gen(function* () {
      const subcommands = yield* Effect.forEach(yield* find(), load, { concurrency: "unbounded" });

      yield* command(subcommands, args, counts);
    }),
  ).pipe(Effect.onInterrupt(() => Console.error(Print.failure(STOPPED))));

  const seen = yield* Ref.get(counts);

  const outcome: Outcome = Exit.isSuccess(finished)
    ? seen.errors > 0
      ? Outcome.cases.reported.make(seen)
      : Outcome.cases.clean.make({ warnings: seen.warnings })
    : Outcome.cases.failed.make({ message: failedWith(finished.cause) });

  yield* Outcome.match(outcome, {
    clean: () => Effect.void,
    reported: () => Effect.void,
    failed: ({ message }) => Console.error(Print.failure(message)),
  });

  return yield* exit(outcome, seen);
});
