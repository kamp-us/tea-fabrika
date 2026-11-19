import { Array as Arr, String as Str, DateTime, Effect, FileSystem, Option, Path, Result, Schema } from "effect";
// Level: the level CI is in, as data (decision 0532 for sev0, 0542 for the two levels and sev1).
// Today's lead tooling, run on our own laptop; it is not product.
//
//   sev0   the owner called it; the log below holds it, from `opened` to `closed`
//   sev1   no sev0 is open, and at least one `ci-scheduled` issue is open: the full run is red,
//          or a CI speed number is over its goal. Nobody calls it. The issues are its record, and
//          the log holds only the one fact land.ts needs: which branch is the fix now landing (0611)
//   none   neither
//
// The log is `runs/sev/log.jsonl` in the checkout (git ignores `runs/`): one line per fact, never
// rewritten. The sev0 is folded from it, so two sev0s open at once cannot be written: `open` is
// refused while one is open, and a log that holds two fails to fold.
import { Run } from "./WorkflowRuns.ts";

/** A command was refused: the level does not stand the way it needs. The reason says how it does. */
export class Refused extends Schema.TaggedError<Refused, { readonly brand: unique symbol }>()("Refused", {
  reason: Schema.String,
}) {}

// ---------------------------------------------------------------- the log

const Branches = Schema.Array(Schema.String);

/** One line of the log. `at` is when it was written, `by` who made the call. */
export const Entry = Schema.TaggedUnion({
  /**
   * A sev0 began. Only the owner calls one, so `by` has one value. `issues` are the open
   * `ci-scheduled` issues it began over (a sev1 before it); `null` when they could not be read.
   */
  opened: {
    at: Schema.String,
    by: Schema.Literal("owner"),
    reason: Schema.String,
    allow: Branches,
    issues: Schema.NullOr(Schema.Array(Schema.Finite)),
  },
  allowed: { at: Schema.String, branch: Schema.String },
  /** The allow list became `branch` alone; `before` is the list it replaced. */
  next: { at: Schema.String, branch: Schema.String, before: Branches },
  /**
   * The lead named `branch` as the one fix of a sev1 now landing, or dropped it (`branch` is `null`).
   * `issues` are the open `ci-scheduled` issues it answers.
   */
  fix: { at: Schema.String, branch: Schema.NullOr(Schema.String), issues: Schema.Array(Schema.Finite) },
  /** A cancel loop started, in process `pid`. */
  looping: { at: Schema.String, pid: Schema.Finite },
  canceled: { at: Schema.String, run: Run },
  /**
   * A call to GitHub that failed, and is asked again next beat: no answer came, GitHub answered a
   * 5xx, or its answer was not one we read. `id` is the run it was for, `null` for a list. Lines
   * written before `refused` and `limited` existed read the same way, whatever their reason says.
   */
  failed: {
    at: Schema.String,
    call: Schema.Literals(["unfinished", "cancel"]),
    id: Schema.NullOr(Schema.Finite),
    reason: Schema.String,
  },
  /** GitHub answered the cancel of run `id` with `status`, a 4xx that is not its rate limit: not asked again in this sev0. */
  refused: { at: Schema.String, id: Schema.Finite, status: Schema.Int, reason: Schema.String },
  /** GitHub refused a call for its rate limit, so the loop asks it nothing until `until`. */
  limited: {
    at: Schema.String,
    call: Schema.Literals(["unfinished", "cancel"]),
    id: Schema.NullOr(Schema.Finite),
    until: Schema.DateTimeUtcFromString,
    reason: Schema.String,
  },
  /** The loop ended: it saw the close (`loop`), or no loop answered the close in time (`close`). */
  ended: { at: Schema.String, by: Schema.Literals(["loop", "close"]) },
  /** The sev0 ended: every fix merged (the lead says so), or the owner called it off. */
  closed: { at: Schema.String, by: Schema.Literals(["owner", "lead"]) },
});

export type Entry = typeof Entry.Type;

// ---------------------------------------------------------------- the level

/** The sev0, as the log folds to it. */
export const Sev0 = Schema.TaggedUnion({
  closed: {},
  /** `index` is the line of the log its `opened` is on, so a summary reads only this sev0. */
  open: { since: Schema.String, reason: Schema.String, allow: Branches, index: Schema.Finite },
});

export type Sev0 = typeof Sev0.Type;

/** One open `ci-scheduled` issue: what keeps a sev1 on. `since` is when it was opened. */
export const Alert = Schema.Struct({ number: Schema.Finite, title: Schema.String, since: Schema.String });

export type Alert = typeof Alert.Type;

/** The level CI is in now. A sev1's `fix` is the branch named as its fix now landing, or `null`. */
export const Level = Schema.TaggedUnion({
  none: {},
  sev1: { issues: Schema.Array(Alert), fix: Schema.NullOr(Schema.String) },
  sev0: { since: Schema.String, reason: Schema.String, allow: Branches },
});

export type Level = typeof Level.Type;

/** The level from the sev0 and the open issues: an open sev0 wins, then any open issue. */
export const level = (sev0: Sev0, issues: ReadonlyArray<Alert>, fix: string | null = null): Level =>
  sev0._tag === "open"
    ? Level.cases.sev0.make({ since: sev0.since, reason: sev0.reason, allow: sev0.allow })
    : issues.length > 0
      ? Level.cases.sev1.make({ issues, fix })
      : Level.cases.none.make({});

/**
 * The branch named as the sev1's fix: the newest `fix` line, unless it is a drop, or none of the
 * issues it answered is open any more, or an open issue opened after it was named. Issue numbers
 * only grow, so an issue opened after the fix is one above every number the fix answered: the clock
 * plays no part (0611).
 */
export const sev1Fix = (entries: ReadonlyArray<Entry>, issues: ReadonlyArray<Alert>): string | null => {
  const named = Arr.findLast(entries, Entry.guards.fix);

  if (Option.isNone(named) || named.value.branch === null) {
    return null;
  }

  const answered = named.value.issues;
  const answersOpen = Arr.some(issues, (i) => answered.includes(i.number));
  const newest = Math.max(...answered);
  const newer = Arr.some(issues, (i) => i.number > newest);

  return answersOpen && !newer ? named.value.branch : null;
};

/**
 * The branches an open sev0 holds as fixes: those `open --allow` and `next` named, which `allow`
 * (a ready pull request, 0603) did not. `lines` are the log from the sev0's `opened` on.
 */
export const sev0Fixes = (lines: ReadonlyArray<Entry>): ReadonlyArray<string> => {
  let named: ReadonlyArray<string> = [];

  for (const e of lines) {
    named = e._tag === "opened" ? e.allow : e._tag === "next" ? [e.branch] : named;
  }

  return named;
};

/** The sev0 after one more line at `index`; a line that does not follow is refused with why. */
export const step = (sev0: Sev0, entry: Entry, index: number): Result.Result<Sev0, string> => {
  switch (entry._tag) {
    case "opened":
      return sev0._tag === "open"
        ? Result.fail(`a sev0 is open already, since ${sev0.since}`)
        : Result.succeed(Sev0.cases.open.make({ since: entry.at, reason: entry.reason, allow: entry.allow, index }));
    case "allowed":
      return sev0._tag === "closed"
        ? Result.fail("no sev0 is open")
        : Result.succeed(
            sev0.allow.includes(entry.branch)
              ? sev0
              : Sev0.cases.open.make({ ...sev0, allow: [...sev0.allow, entry.branch] }),
          );
    case "next":
      return sev0._tag === "closed"
        ? Result.fail("no sev0 is open")
        : Result.succeed(Sev0.cases.open.make({ ...sev0, allow: [entry.branch] }));
    case "closed":
      return sev0._tag === "closed" ? Result.fail("no sev0 is open") : Result.succeed(Sev0.cases.closed.make({}));
    // What the loop writes and the sev1's fix change no sev0; a late cancel may follow a close.
    case "fix":
    case "looping":
    case "canceled":
    case "failed":
    case "refused":
    case "limited":
    case "ended":
      return Result.succeed(sev0);
  }
};

/** The sev0 the whole log folds to; the first line that does not follow fails it. */
export const fold = (entries: ReadonlyArray<Entry>): Result.Result<Sev0, string> => {
  let sev0: Sev0 = Sev0.cases.closed.make({});

  for (const [index, entry] of entries.entries()) {
    const next = step(sev0, entry, index);

    if (Result.isFailure(next)) {
      return Result.fail(`line ${index + 1} of the log (${entry._tag}): ${next.failure}`);
    }

    sev0 = next.success;
  }

  return Result.succeed(sev0);
};

// ---------------------------------------------------------------- the log file

const EntryJson = Schema.fromJsonString(Entry);

/** Now, as the log writes it. */
export const now = Effect.map(DateTime.now, DateTime.formatIso);

const file = (home: string) => Effect.map(Path.Path, (path) => path.join(home, "log.jsonl"));

/** Every line of the log in folder `home`, oldest first; none before the first sev0 there. */
export const log = Effect.fn("Level.log")(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const at = yield* file(home);

  if (!(yield* fs.exists(at))) {
    return [];
  }

  const lines = Arr.filter(Str.split(yield* fs.readFileString(at), "\n"), (line) => line !== "");

  return yield* Effect.forEach(
    lines,
    (line, index) =>
      Schema.decodeEffect(EntryJson)(line).pipe(
        Effect.mapError(() => Refused.make({ reason: `line ${index + 1} of ${at} is not one this script wrote` })),
      ),
    { concurrency: "unbounded" },
  );
});

/** The log and the sev0 it folds to; a log that does not fold is refused. */
export const read = Effect.fn("Level.read")(function* (home: string) {
  const entries = yield* log(home);
  const sev0 = fold(entries);

  if (Result.isFailure(sev0)) {
    return yield* Refused.make({ reason: sev0.failure });
  }

  return { entries, sev0: sev0.success };
});

/**
 * Adds one line to the log once it follows the log as it stands, so no command writes a second
 * sev0 or a close with none open. One small append is one write: a reader never sees half a line.
 */
export const write = Effect.fn("Level.write")(function* (home: string, entry: Entry) {
  const fs = yield* FileSystem.FileSystem;
  const { entries, sev0 } = yield* read(home);
  const next = step(sev0, entry, entries.length);

  if (Result.isFailure(next)) {
    return yield* Refused.make({ reason: next.failure });
  }

  yield* fs.makeDirectory(home, { recursive: true });
  yield* fs.writeFileString(yield* file(home), `${Schema.encodeSync(EntryJson)(entry)}\n`, { flag: "a" });

  return next.success;
});
