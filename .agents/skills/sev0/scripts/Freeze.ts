// Freeze: what a sev0 does to CI, as code (decision 0532). Today's lead tooling, run on our own
// laptop; it is not product. sev0.ts is its command line.
//
//   freeze     every beat, cancel each unfinished run that is not the merge queue's and not on a
//              branch the allow list names; until the state says stop. In a sev0 the owner has
//              emptied the queue, so its runs are none, and keeping them is harmless
//   next       make one branch the whole allow list: the next fix, landed one at a time
//   allow      add one branch to the list of a freeze that is on
//   stop       ask the freeze loop to end, and wait until it has
//   unfreeze   stop the freeze if it is on, then rerun the newest canceled pull request run of
//              each workflow at each open pull request's head, so its required check comes back
//
// The state and the log live in one folder, `runs/sev0/` in the checkout (git ignores `runs/`):
//
//   state.json   the freeze as it stands, rewritten whole each change; every command reads it
//   log.jsonl    one line per thing done, never rewritten: each cancel, next, allow, stop and rerun
//
// The loop reads the state again before each cancel, so a stop or an allow counts at once, never a
// beat late.
import { Console, DateTime, Duration, Effect, FileSystem, Option, Path, Schema } from "effect";
import { PullRequests, type PullRequest } from "../../lead/scripts/pr/PullRequests.ts";
import { Run, WorkflowRuns } from "./WorkflowRuns.ts";

/** A command was refused: the freeze does not stand the way it needs. The reason says how it does. */
export class Refused extends Schema.TaggedError<Refused>()("Refused", { reason: Schema.String }) {}

// ---------------------------------------------------------------- the deciding part

/** Why a run is kept: it is the merge queue's, or its branch fixes the emergency. */
export const Verdict = Schema.TaggedUnion({
  keep: { reason: Schema.Literals(["queue", "allowed"]) },
  cancel: {},
});
export type Verdict = typeof Verdict.Type;

/**
 * What the freeze does with one unfinished run. A merge queue run is kept: in a sev0 the owner has
 * emptied the queue first, so there is none, and canceling one would take its pull request out of
 * the queue behind the owner's back. A push run on main is canceled too.
 */
export const verdict = (run: Run, allow: ReadonlyArray<string>): Verdict =>
  run.event === "merge_group"
    ? Verdict.cases.keep.make({ reason: "queue" })
    : allow.includes(run.branch)
      ? Verdict.cases.keep.make({ reason: "allowed" })
      : Verdict.cases.cancel.make({});

/**
 * The runs `unfreeze` reruns at one pull request's head: per workflow, the newest pull request run,
 * when it ended canceled. An older canceled run that a newer one replaced is left alone.
 */
export const canceled = (runs: ReadonlyArray<Run>): ReadonlyArray<Run> => {
  const newest = new Map<string, Run>();

  for (const run of runs) {
    const held = newest.get(run.workflow);

    if (run.event === "pull_request" && (held === undefined || run.id > held.id)) {
      newest.set(run.workflow, run);
    }
  }

  return [...newest.values()].filter((run) => run.status === "completed" && run.conclusion === "cancelled");
};

// ---------------------------------------------------------------- the state and the log

const Allow = Schema.Array(Schema.String);

/** The freeze as `state.json` holds it. `stopping` is a stop asked for that the loop has not seen. */
export const State = Schema.TaggedUnion({
  frozen: { allow: Allow, at: Schema.String },
  stopping: { at: Schema.String },
  stopped: { at: Schema.String },
  unfrozen: { at: Schema.String },
});
export type State = typeof State.Type;

/** One line of `log.jsonl`. `at` is when it was written. */
export const Entry = Schema.TaggedUnion({
  frozen: { at: Schema.String, allow: Allow, repo: Schema.String, pid: Schema.Number },
  allowed: { at: Schema.String, branch: Schema.String },
  /** The allow list became `branch` alone; `before` is the list it replaced. */
  next: { at: Schema.String, branch: Schema.String, before: Allow },
  canceled: { at: Schema.String, run: Run },
  /** A call to GitHub that failed; `id` is the run it was for, `null` for a list. */
  failed: {
    at: Schema.String,
    call: Schema.Literals(["unfinished", "at", "cancel", "rerun"]),
    id: Schema.NullOr(Schema.Number),
    reason: Schema.String,
  },
  /** The loop ended on a stop (`loop`), or a stop no loop answered wrote it (`stop`). */
  stopped: { at: Schema.String, by: Schema.Literals(["loop", "stop"]) },
  reran: { at: Schema.String, pr: Schema.Number, run: Run },
  unfrozen: { at: Schema.String, reran: Schema.Number },
});
export type Entry = typeof Entry.Type;

const StateJson = Schema.fromJsonString(State);
const EntryJson = Schema.fromJsonString(Entry);

const now = Effect.map(DateTime.now, DateTime.formatIso);

/** The state in folder `home`; none before the first freeze there. */
export const state = Effect.fn("Freeze.state")(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(home, "state.json");

  if (!(yield* fs.exists(file))) {
    return Option.none<State>();
  }

  const text = yield* fs.readFileString(file);
  const read = yield* Schema.decodeUnknownEffect(StateJson)(text).pipe(
    Effect.mapError(() => new Refused({ reason: `${file} is not a state this script wrote` })),
  );
  return Option.some(read);
});

/** Writes the whole state through a file beside it, so a reader never sees half of one. */
const save = Effect.fn("Freeze.save")(function* (home: string, next: State) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(home, "state.json");
  yield* fs.makeDirectory(home, { recursive: true });
  yield* fs.writeFileString(`${file}.new`, `${Schema.encodeSync(StateJson)(next)}\n`);
  yield* fs.rename(`${file}.new`, file);
});

/** Adds one line to the log. */
const note = Effect.fn("Freeze.note")(function* (home: string, entry: Entry) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(home, { recursive: true });
  yield* fs.writeFileString(path.join(home, "log.jsonl"), `${Schema.encodeSync(EntryJson)(entry)}\n`, { flag: "a" });
});

/** Every line of the log in folder `home`, oldest first. */
export const log = Effect.fn("Freeze.log")(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(home, "log.jsonl");

  if (!(yield* fs.exists(file))) {
    return [];
  }

  const lines = (yield* fs.readFileString(file)).split("\n").filter((line) => line !== "");
  return yield* Effect.forEach(lines, (line) => Schema.decodeUnknownEffect(EntryJson)(line), {
    concurrency: "unbounded",
  });
});

/** The allow list while the freeze is on; none once a stop was asked for. */
const on = (s: Option.Option<State>): Option.Option<ReadonlyArray<string>> =>
  Option.isSome(s) && s.value._tag === "frozen" ? Option.some(s.value.allow) : Option.none();

const runLine = (run: Run) => `${run.id} ${run.workflow} ${run.event} ${run.branch}`;

// ---------------------------------------------------------------- the commands

/** One beat: list what has not finished, then cancel each run the verdict cancels. */
const beat = Effect.fn("Freeze.beat")(function* (home: string) {
  const github = yield* WorkflowRuns;
  const listed = yield* Effect.result(github.unfinished);

  if (listed._tag === "Failure") {
    const reason = listed.failure.reason;
    yield* note(home, Entry.cases.failed.make({ at: yield* now, call: "unfinished", id: null, reason }));
    return yield* Console.log(`sev0: could not list the runs: ${reason}`);
  }

  for (const run of listed.success) {
    const allow = on(yield* state(home));

    if (Option.isNone(allow)) {
      return;
    }

    if (verdict(run, allow.value)._tag === "keep") {
      continue;
    }

    const done = yield* Effect.result(github.cancel(run.id));

    if (done._tag === "Failure") {
      const reason = done.failure.reason;
      yield* note(home, Entry.cases.failed.make({ at: yield* now, call: "cancel", id: run.id, reason }));
      yield* Console.log(`sev0: could not cancel ${runLine(run)}: ${reason}`);
    } else {
      yield* note(home, Entry.cases.canceled.make({ at: yield* now, run }));
      yield* Console.log(`sev0: canceled ${runLine(run)}`);
    }
  }
});

/** Waits one beat, a second at a time, and ends early once the freeze is off. */
const rest = Effect.fn("Freeze.rest")(function* (home: string, every: Duration.Duration) {
  for (let left = Duration.toSeconds(every); left > 0; left -= 1) {
    yield* Effect.sleep(Duration.seconds(1));

    if (Option.isNone(on(yield* state(home)))) {
      return;
    }
  }
});

/** What a freeze starts with. */
export type Start = {
  readonly home: string;
  readonly allow: ReadonlyArray<string>;
  readonly every: Duration.Duration;
  readonly repo: string;
  readonly pid: number;
};

/** Freezes CI until a stop: refused while another freeze is on in the same folder. */
export const freeze = Effect.fn("Freeze.freeze")(function* (start: Start) {
  const { home, every } = start;
  const before = yield* state(home);

  if (Option.isSome(before) && (before.value._tag === "frozen" || before.value._tag === "stopping")) {
    return yield* new Refused({ reason: `a freeze is on already (${before.value._tag}): run stop first` });
  }

  const at = yield* now;
  const allow = [...new Set(start.allow)];
  yield* save(home, State.cases.frozen.make({ allow, at }));
  yield* note(home, Entry.cases.frozen.make({ at, allow, repo: start.repo, pid: start.pid }));
  yield* Console.log(`sev0: frozen; kept: the merge queue${allow.map((b) => `, ${b}`).join("")}`);

  while (Option.isSome(on(yield* state(home)))) {
    yield* beat(home);
    yield* rest(home, every);
  }

  const after = yield* state(home);

  if (Option.isSome(after) && after.value._tag === "stopping") {
    yield* save(home, State.cases.stopped.make({ at: yield* now }));
    yield* note(home, Entry.cases.stopped.make({ at: yield* now, by: "loop" }));
  }

  yield* Console.log("sev0: the freeze loop ended");
});

/** Adds `branch` to the allow list of the freeze that is on. */
export const allow = Effect.fn("Freeze.allow")(function* (home: string, branch: string) {
  const s = yield* state(home);

  if (Option.isNone(s) || s.value._tag !== "frozen") {
    return yield* new Refused({ reason: "no freeze is on" });
  }

  if (s.value.allow.includes(branch)) {
    return yield* Console.log(`sev0: ${branch} was already allowed`);
  }

  yield* save(home, State.cases.frozen.make({ allow: [...s.value.allow, branch], at: s.value.at }));
  yield* note(home, Entry.cases.allowed.make({ at: yield* now, branch }));
  yield* Console.log(`sev0: allowed ${branch}`);
});

/**
 * Makes `branch` the only allowed branch of the freeze that is on: the next fix in line. From the
 * next cancel on, the fix before it is canceled like any other branch.
 */
export const next = Effect.fn("Freeze.next")(function* (home: string, branch: string) {
  const s = yield* state(home);

  if (Option.isNone(s) || s.value._tag !== "frozen") {
    return yield* new Refused({ reason: "no freeze is on" });
  }

  yield* save(home, State.cases.frozen.make({ allow: [branch], at: s.value.at }));
  yield* note(home, Entry.cases.next.make({ at: yield* now, branch, before: s.value.allow }));
  yield* Console.log(`sev0: next is ${branch}; nothing else is allowed`);
});

/** How a stop ended: the loop saw it, no loop answered in time, or no freeze was on. */
export const Stop = Schema.Literals(["answered", "unanswered", "idle"]);
export type Stop = typeof Stop.Type;

/**
 * Asks the loop to end and waits up to `wait` for it to say it has. When no loop answers (it died, or
 * none runs), this writes the stop itself: the loop reads the state before each cancel, so a late
 * one cancels nothing more.
 */
export const stop = Effect.fn("Freeze.stop")(function* (home: string, wait: Duration.Duration) {
  const s = yield* state(home);

  if (Option.isNone(s) || s.value._tag === "stopped" || s.value._tag === "unfrozen") {
    yield* Console.log("sev0: no freeze is on");
    return "idle" satisfies Stop;
  }

  if (s.value._tag === "frozen") {
    yield* save(home, State.cases.stopping.make({ at: yield* now }));
  }

  for (let left = Duration.toSeconds(wait); left > 0; left -= 1) {
    yield* Effect.sleep(Duration.seconds(1));
    const seen = yield* state(home);

    if (Option.isSome(seen) && seen.value._tag !== "stopping") {
      yield* Console.log("sev0: stopped; the freeze loop ended");
      return "answered" satisfies Stop;
    }
  }

  yield* save(home, State.cases.stopped.make({ at: yield* now }));
  yield* note(home, Entry.cases.stopped.make({ at: yield* now, by: "stop" }));
  yield* Console.log("sev0: stopped; no freeze loop answered, so none is running");
  return "unanswered" satisfies Stop;
});

/** One rerun `unfreeze` asked for. */
export type Rerun = { readonly pr: number; readonly run: Run };

/** Reruns the canceled runs at one open pull request's head; a failed call is logged and skipped. */
const rerunAt = Effect.fn("Freeze.rerunAt")(function* (home: string, pr: PullRequest) {
  const github = yield* WorkflowRuns;
  const runs = yield* Effect.result(github.at(pr.oid));

  if (runs._tag === "Failure") {
    const reason = runs.failure.reason;
    yield* note(home, Entry.cases.failed.make({ at: yield* now, call: "at", id: null, reason }));
    yield* Console.log(`sev0: could not list the runs of pull request ${pr.number}: ${reason}`);
    return [];
  }

  const reran: Array<Rerun> = [];

  for (const run of canceled(runs.success)) {
    const done = yield* Effect.result(github.rerun(run.id));

    if (done._tag === "Failure") {
      const reason = done.failure.reason;
      yield* note(home, Entry.cases.failed.make({ at: yield* now, call: "rerun", id: run.id, reason }));
      yield* Console.log(`sev0: could not rerun ${runLine(run)} of pull request ${pr.number}: ${reason}`);
    } else {
      yield* note(home, Entry.cases.reran.make({ at: yield* now, pr: pr.number, run }));
      yield* Console.log(`sev0: reran pull request ${pr.number}: ${runLine(run)}`);
      reran.push({ pr: pr.number, run });
    }
  }

  return reran;
});

/**
 * Ends the freeze: stops it if it is on, then reruns the canceled checks of every open pull request,
 * so one armed to merge gets its required check back. Refused where no freeze was ever recorded.
 */
export const unfreeze = Effect.fn("Freeze.unfreeze")(function* (home: string, wait: Duration.Duration) {
  if (Option.isNone(yield* state(home))) {
    return yield* new Refused({ reason: "no freeze is recorded here" });
  }

  yield* stop(home, wait);
  const prs = (yield* (yield* PullRequests).all).filter((pr) => pr.state === "OPEN");
  const reran = (yield* Effect.forEach(prs, (pr) => rerunAt(home, pr), { concurrency: 4 })).flat();
  yield* save(home, State.cases.unfrozen.make({ at: yield* now }));
  yield* note(home, Entry.cases.unfrozen.make({ at: yield* now, reran: reran.length }));
  yield* Console.log(
    `sev0: unfrozen; reran ${reran.length} runs on ${new Set(reran.map((r) => r.pr)).size} pull requests`,
  );
  return reran;
});
