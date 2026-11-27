// Recorded: what a `land.ts` command leaves in its record (pr/LandLog.ts), and how a later reader tells a command that died.
//
//   around    wraps one command's handler: a `started` line first (a death leaves nothing else), a `heartbeat` line each period
//             while it lives, copies what it prints, and one ending line from the handler's exit. It changes no result and no exit
//             code; a record that cannot be written costs one line on stderr and the command goes on.
//   attempts  reads a record's lines into one attempt each, newest first: ended, alive (its process exists) or gone (an open start
//             whose process does not exist, so it died with no end line).
//   last      says that in plain words, one line for each attempt, for `land.ts last`.
//
// What can end a command: SIGINT and SIGTERM interrupt it (Effect's `runMain` does that), and a closed terminal (SIGHUP) is turned
// into the same interrupt here, so the cleanup writes the ending line. SIGKILL, a sleeping laptop and a power cut run no code: the
// start line and the liveness probe are the proof then. Today's lead tooling, run on our own laptop; it is not product.
import {
  Cause,
  Clock,
  Config,
  Console,
  DateTime,
  Duration,
  Effect,
  Exit,
  Fiber,
  Inspectable,
  Option,
  Predicate,
  Ref,
  Result,
  Schema,
} from "effect";
import { type Key, LandLog, type LandLogError, Line } from "./LandLog.ts";

/**
 * How often a running command writes a `heartbeat` line: whole minutes, at least 1 (a setting, `LAND_LOG_MINUTES`, from the
 * environment as `GC_MINUTES` is, so env.sh's way of setting a value from outside works). A wait reads every 60 seconds for up
 * to an hour, so 5 minutes gives at most 12 extra lines for a whole wait.
 */
export const every = Config.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), "LAND_LOG_MINUTES").pipe(
  Config.withDefault(5),
  Config.map(Duration.minutes),
);

/** What `around` is told about one command. */
export type Spec<In, E> = {
  readonly command: string;
  /** The records the command's lines go to: a pull request's, a quest's, or several. */
  readonly keys: (input: In) => ReadonlyArray<Key>;
  readonly argv: ReadonlyArray<string>;
  readonly pid: number;
  /** The period of the heartbeat. */
  readonly every: Duration.Duration;
  /** Which failures are a check saying no: what the caller says a refusal is, with only the words the record may hold. */
  readonly refusal: (e: E) => Option.Option<{ readonly check: string; readonly reason: string }>;
};

/** A closed terminal ends the process with no cleanup unless something turns it into an interrupt. */
const hangup: Effect.Effect<never> = Effect.callback<never>((resume) => {
  const stop = () => resume(Effect.interrupt);
  process.once("SIGHUP", stop);

  return Effect.sync(() => {
    process.off("SIGHUP", stop);
  });
});

/** One line of what a command printed: its arguments the way a terminal shows them. */
const printed = (args: ReadonlyArray<unknown>): string => args.map((arg) => Inspectable.toStringUnknown(arg)).join(" ");

/** The first line of what a cause says: enough to know what broke, and no stack of paths. */
const firstLine = (cause: Cause.Cause<unknown>): string =>
  Cause.pretty(cause)
    .split("\n")
    .find((line) => line.trim() !== "") ?? "failed";

/** How an exit became one ending line. A cause with an interrupt and a failure is a failure, not an interrupt. */
const ending = <A, E>(
  exit: Exit.Exit<A, E>,
  said: ReadonlyArray<string>,
  refusal: Spec<unknown, E>["refusal"],
): ((at: string, attempt: string) => Line) => {
  if (Exit.isSuccess(exit)) {
    return (at, attempt) => Line.cases.done.make({ at, attempt, said });
  }

  const cause = exit.cause;

  if (Cause.hasInterruptsOnly(cause)) {
    return (at, attempt) => Line.cases.interrupted.make({ at, attempt });
  }

  const typed = Cause.findError(cause);

  const refused =
    Result.isSuccess(typed) && !Cause.hasInterrupts(cause) && !Cause.hasDies(cause)
      ? refusal(typed.success)
      : Option.none();

  return Option.match(refused, {
    onNone: () => (at, attempt) => Line.cases.failed.make({ at, attempt, reason: firstLine(cause) }),
    onSome:
      ({ check, reason }) =>
      (at, attempt) =>
        Line.cases.refused.make({ at, attempt, check, reason }),
  });
};

/**
 * Runs `handler` as before and leaves its start, a heartbeat each period and its end in the record. The handler's success, its
 * failures and its output pass through unchanged; only `LandLog` is added to what it needs.
 */
export const around =
  <In, A, E, R>(spec: Spec<In, E>, handler: (input: In) => Effect.Effect<A, E, R>) =>
  (input: In): Effect.Effect<A, E, R | LandLog> =>
    Effect.gen(function* () {
      const log = yield* LandLog;
      const keys = spec.keys(input);
      const attempt = `${spec.pid}.${yield* Clock.currentTimeMillis}`;
      const said: Array<string> = [];
      const warned = yield* Ref.make(false);

      // One line on stderr for a command whose record cannot be written, however many lines that costs.
      const warn = (e: LandLogError) =>
        Ref.getAndSet(warned, true).pipe(
          Effect.flatMap((already) =>
            already ? Effect.void : Console.error(`land: the record could not be written (${e.reason}); going on`),
          ),
        );

      // Each key gets the line on its own: one that cannot be written does not stop the others.
      const write = (make: (at: string, attempt: string) => Line) =>
        Effect.gen(function* () {
          const line = make(DateTime.formatIso(yield* DateTime.now), attempt);
          yield* Effect.forEach(keys, (key) => log.append(key, line).pipe(Effect.catch(warn)), {
            concurrency: 1,
            discard: true,
          });
        });

      yield* write((at, id) =>
        Line.cases.started.make({
          at,
          attempt: id,
          pid: spec.pid,
          command: spec.command,
          argv: spec.argv,
        }),
      );

      const beat = yield* Effect.forkChild(
        write((at, id) => Line.cases.heartbeat.make({ at, attempt: id })).pipe(
          Effect.delay(spec.every),
          Effect.forever,
        ),
      );

      // The copy of what the command prints goes between it and the terminal; `error` and the rest pass through.
      const copying = (run: Effect.Effect<A, E, R>) =>
        Console.consoleWith((terminal) =>
          Effect.provideService(
            run,
            Console.Console,
            Object.assign(Object.create(terminal), {
              log: (...args: ReadonlyArray<unknown>) => {
                said.push(printed(args));
                terminal.log(...args);
              },
            }),
          ),
        );

      // The hangup goes first: its listener stands before the handler's first step runs, so no signal slips between.
      return yield* Effect.raceFirst(hangup, copying(handler(input))).pipe(
        Effect.onExit((exit) =>
          // The heartbeat stops first, so no line follows the ending.
          Fiber.interrupt(beat).pipe(Effect.andThen(write(ending(exit, said, spec.refusal)))),
        ),
      );
    });

// ---------------------------------------------------------------- the reader

/** One run of a command, from its start line to its end, or to the last line it wrote. */
export type Attempt = {
  readonly attempt: string;
  readonly command: string;
  readonly argv: ReadonlyArray<string>;
  readonly pid: number;
  readonly startedAt: string;
  /** The ending line when it ended; else the newest line it wrote. */
  readonly last: Line;
  /** `ended`: an ending line exists. `alive`: none, and its process exists. `gone`: none, and its process does not: it died. */
  readonly standing: "ended" | "alive" | "gone";
};

const isEnding = (line: Line): boolean =>
  Line.guards.done(line) || Line.guards.refused(line) || Line.guards.failed(line) || Line.guards.interrupted(line);

/**
 * The attempts a record's lines hold, newest first. An ending belongs to the start with the same `attempt`, wherever it stands in
 * the lines. `alive` asks whether a process exists, and is asked only for an attempt with no ending.
 */
export const attempts = Effect.fn("Recorded.attempts")(function* (
  lines: ReadonlyArray<Line>,
  alive: (pid: number) => Effect.Effect<boolean>,
) {
  const starts = lines.filter(Line.guards.started).toReversed();

  return yield* Effect.forEach(
    starts,
    (start) =>
      Effect.gen(function* () {
        const mine = lines.filter((line) => !Line.guards.started(line) && line.attempt === start.attempt);
        const end = mine.find(isEnding);

        return {
          attempt: start.attempt,
          command: start.command,
          argv: start.argv,
          pid: start.pid,
          startedAt: start.at,
          last: end ?? mine.at(-1) ?? start,
          standing: end !== undefined ? "ended" : (yield* alive(start.pid)) ? "alive" : "gone",
        } satisfies Attempt;
      }),
    { concurrency: 1 },
  );
});

/** Whether a process with this pid exists. Signal 0 sends nothing: it only asks. */
export const pidExists = (pid: number): Effect.Effect<boolean> =>
  Effect.try({
    try: () => process.kill(pid, 0),
    // EPERM: the process exists and is someone else's.
    catch: (e) => Predicate.hasProperty(e, "code") && e.code === "EPERM",
  }).pipe(
    Effect.as(true),
    Effect.catch((owned) => Effect.succeed(owned)),
  );

const stamp = (at: string): string => at.replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, "Z");

/** How long ago, in the unit a person reads: minutes, then hours, then days. */
const ago = (since: string, now: DateTime.Utc): string => {
  const minutes = Math.max(0, Math.round((DateTime.toEpochMillis(now) - Date.parse(since)) / 60_000));

  return minutes < 90
    ? `${minutes} min ago`
    : minutes < 2880
      ? `${Math.round(minutes / 60)} h ago`
      : `${Math.round(minutes / 1440)} days ago`;
};

const kind = (line: Line): string => (Line.guards.started(line) ? "the start" : "a heartbeat");

/** One attempt in plain words, in one line. */
const sentence = (a: Attempt, now: DateTime.Utc): string => {
  const head = `${(a.argv.length > 0 ? a.argv : [a.command]).join(" ")}   started ${stamp(a.startedAt)}`;
  const end = a.last;

  if (Line.guards.done(end)) {
    const said = end.said.at(-1)?.replaceAll("\n", " ");

    return `${head}, ended ${stamp(end.at)}: done${said === undefined ? "" : `, ${said}`}`;
  }

  if (Line.guards.refused(end)) {
    return `${head}, ended ${stamp(end.at)}: refused at the ${end.check} check: ${end.reason.replaceAll("\n", " ")}`;
  }

  if (Line.guards.failed(end)) {
    return `${head}, ended ${stamp(end.at)}: failed: ${end.reason}`;
  }

  if (Line.guards.interrupted(end)) {
    return `${head}, ended ${stamp(end.at)}: it was interrupted (a signal stopped it)`;
  }

  const seen = `${head}, last line ${stamp(end.at)} (${kind(end)}, ${ago(end.at, now)})`;

  return a.standing === "alive"
    ? `${seen}; pid ${a.pid} is running, so it is still running: do not start another`
    : `${seen}; pid ${a.pid} is not running: it died with no end line. Run it again.`;
};

/**
 * What `land.ts last` prints for one record: one line for each of the newest `count` attempts, or one line saying there is no
 * record. It reads one record and changes nothing.
 */
export const last = Effect.fn("Recorded.last")(function* (spec: {
  readonly key: Key;
  readonly count: number;
  readonly alive: (pid: number) => Effect.Effect<boolean>;
}) {
  const record = yield* (yield* LandLog).read(spec.key);
  const found = (yield* attempts(record.lines, spec.alive)).slice(0, spec.count);
  const now = yield* DateTime.now;
  const unread = record.torn === 0 ? [] : [`${record.torn} lines of the record did not read`];

  return found.length === 0
    ? [`no record of a command for this`, ...unread]
    : [...found.map((a) => sentence(a, now)), ...unread];
});
