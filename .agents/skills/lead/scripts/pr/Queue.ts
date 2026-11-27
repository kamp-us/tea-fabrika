// Queue: how a finished pull request lands, and what follows its merge (a pull request whose steps passed lands on green CI and a clean leak check alone). Main takes changes
// only through GitHub's merge queue: GitHub tests each pull request on newest main and merges it,
// so nothing here merges main in, waits on a check or runs one again. Today's lead tooling, run on
// our own laptop; it is not product.
//
//   add      the pull request is open, into main and not in conflict with main -> leak grep on its net change and on each
//            of its commits, each failing closed -> the body checks (`body`, which `land.ts check` runs alone): the leak grep on its
//            title and description, that the description is the pr skill's template (its `## Summary`, `## Evidence` and `## Merge Danger`) and not the draft placeholder (Sections.ts), and each new exported name named under `## New names` (Names.ts, a new helper names the tools it searched, and a new name cites the industry's word), and each `fabrika close ticket <N>` line naming an open tracker ticket (an open GitHub issue is closed by `Closes #<N>`) -> a draft whose head has a CI run
//            (never in the seconds after a push; with a wait, one is given time to appear, and a wait ends at once with a refusal
//            when the pull request turns to conflict with main, since GitHub starts no check on one) is marked ready
//            (as `land.ts admin` does), which starts its real `ci-required` -> `ci-required`
//            is green on its head (read once; a quest may wait for it to end, within a limit) -> one
//            squash pinned to that head, which adds it to the queue
//   settle   later, one read of the pull request and no wait: merged -> close each ticket its
//            description names (a merge closes only the tickets its pull request names with our own phrase) and start one box cleanup sweep (box cleanup runs on a timer and after a merge, never on a step's start path); else say how it stands
//   reconcile the timer's pass (gcloop.ts, after each sweep): the newest merged pull requests by merge time, out of the most
//            recently updated ones, and the open tickets they name that the record (Closes.ts) does not hold yet, closed once
//            each, so a missed `settle` is caught within one tick
//
// `add` answers "queued", never "merged": the merge is GitHub's, later. `settle` is how code learns
// it happened. Read through its module: `Queue.add(...)`. Every close, by `settle`, `closeOnly` or
// `reconcile`, is written to the record, so a ticket that a person reopens later is never closed again
// by the timer. Each close reads the tracker again just before it, so a close another path made after
// the first read is not repeated. Those reads and the close are not one atomic step: a race inside that
// gap is still possible, and a lock around each close would close it.

import {
  String as Str,
  pipe,
  Option,
  Array as Arr,
  DateTime,
  Duration,
  Effect,
  Match,
  Result,
  Schedule,
  Schema,
} from "effect";

import { Checks, type ChecksError, type Job } from "../ci/Checks.ts";
import { Closes } from "./Closes.ts";
import * as Leaks from "./Leaks.ts";
import * as Names from "./Names.ts";
import { Detail, PullRequests, PullRequestsError } from "./PullRequests.ts";
import type { LeakGrepRefused, Pushes } from "./Pushes.ts";
import * as Sections from "./Sections.ts";
import { Sweeps } from "./Sweeps.ts";
import { Tickets } from "./Tickets.ts";

/** The one check main's ruleset requires. A draft's run names its own `ci-required (draft)`. */
export const REQUIRED = "ci-required";

/** The pull request was not added to the queue, and nothing was asked of GitHub's merge. */
export class NotQueued extends Schema.TaggedError<NotQueued, { readonly brand: unique symbol }>()("NotQueued", {
  reason: Schema.String,
}) {}

/**
 * How long a caller lets the required check take to end, and the seconds between two reads. A read
 * that finds nothing new is a 304, which GitHub does not count (../ci/ChecksGh.ts).
 */
export type Wait = { readonly minutes: number; readonly every: number };

/** The wait a quest gives the required check: the hour catchup.sh gave every check, read once a minute. */
export const QUEST_WAIT: Wait = { minutes: 60, every: 60 };

export type Ask = {
  /** A checkout of the repo, to fetch the head into and read its change from. */
  readonly dir: string;
  readonly pr: number;
  /** Left out, the required check is read once and must have ended green already. */
  readonly wait?: Wait;
};

/** The required check has not ended, or GitHub did not answer: a wait reads again. */
class Pending extends Schema.TaggedError<Pending, { readonly brand: unique symbol }>()("Pending", {}) {}

/** The pull request now conflicts with main, so GitHub starts no check on it and a wait for one would run its whole hour. */
export class Conflicting extends Schema.TaggedError<Conflicting, { readonly brand: unique symbol }>()("Conflicting", {
  pr: Schema.Finite,
}) {}

/** What a refusal for a conflict says, and the commands that put main in. */
export const conflictLine = (pr: number): string =>
  `it conflicts with main, so no check runs on it; merge main in with \`gh pr update-branch ${pr}\` (a quest: \`land.ts run <quest> <ticket>\`), push, and queue it again`;

/**
 * Fails with `Conflicting` when GitHub now says pull request `pr` conflicts with main. A read that
 * fails or has no answer yet counts as no conflict: it must never end a wait.
 */
const unlessConflicting = Effect.fn("Queue.unlessConflicting")(function* (pr: number) {
  const prs = yield* PullRequests;
  const found = yield* Effect.option(prs.view(pr));

  if (Option.isSome(found) && found.value.mergeable === "CONFLICTING") {
    return yield* Conflicting.make({ pr });
  }
});

/** The pull request left open while a wait ran: merged or closed, so no check will be waited for. */
export class Gone extends Schema.TaggedError<Gone, { readonly brand: unique symbol }>()("Gone", {
  pr: Schema.Finite,
  state: Schema.String,
}) {}

/** The required check as one read found it: the head it was read at, and the check run there (none before GitHub has made it). */
export type Awaited = { readonly oid: string; readonly job: Option.Option<Job> };

const ended = (job: Option.Option<Job>): boolean => Option.isSome(job) && job.value.status === "completed";

/** What a caller says when the head it read first is not the head the check ended at. */
export const moved = (from: string, to: string): string => `its head moved from ${from} to ${to} while waiting`;

/**
 * The required check of pull request `pr` as it stands, read at the head the pull request holds on
 * each read. Without a wait, one read at `oid`. With one, again each `every` seconds until the check
 * at the current head has ended or the wait is over: a push or an update-branch moves the head and
 * the next read follows it, and a check read at a head the pull request has left is read again at
 * once. Each read that finds it not ended also asks whether the pull request has come to conflict
 * with main (a check GitHub will never start ends the wait with `Conflicting`) or has left open
 * (`Gone`). A wait over with nothing read fails with the last error.
 */
export const required = Effect.fn("Queue.required")(function* (oid: string, wait: Wait | undefined, pr: number) {
  const checks = yield* Checks;

  if (wait === undefined) {
    return { oid, job: yield* checks.job(oid, REQUIRED) } satisfies Awaited;
  }

  const prs = yield* PullRequests;
  let last: Awaited | undefined;
  let failed: PullRequestsError | ChecksError | undefined;

  const read = Effect.gen(function* () {
    // A head read again after the check ended is the head the check belongs to; a moved one is read again at once.
    for (;;) {
      const now = yield* prs.view(pr);
      const job = yield* checks.job(now.oid, REQUIRED);
      last = { oid: now.oid, job };

      if (ended(job)) {
        if ((yield* prs.view(pr)).oid === now.oid) {
          return last;
        }

        continue;
      }

      if (now.state !== "OPEN") {
        return yield* Gone.make({ pr, state: now.state });
      }

      if (now.mergeable === "CONFLICTING") {
        return yield* Conflicting.make({ pr });
      }

      return yield* Pending.make();
    }
  });

  const done = read.pipe(
    Effect.tapError((e) =>
      Effect.sync(() => {
        if (e._tag === "PullRequestsError" || e._tag === "ChecksError") {
          failed = e;
        }
      }),
    ),
    Effect.retry({
      schedule: Schedule.spaced(Duration.seconds(wait.every)),
      while: (e) => e._tag !== "Conflicting" && e._tag !== "Gone",
    }),
    Effect.catchTag("Pending", () => Effect.sync(() => last)),
    Effect.timeoutOption(Duration.minutes(wait.minutes)),
  );

  const result = Option.getOrElse(yield* done, () => last);

  return result ?? (yield* failed ?? PullRequestsError.make({ reason: "the required check was not read" }));
});

/** How the required check stands in words, as a refusal says it: its conclusion, else its status, else missing. */
export const stands = (job: Option.Option<Job>): string =>
  Option.isNone(job) ? "missing" : (job.value.conclusion ?? job.value.status);

/**
 * What `land.ts wait` says of a read check, and whether it is a success. A cancelled check names its
 * run (the check run's page: a second run at one head cancels the first, and the first's check is
 * the one that reads cancelled).
 */
export const verdict = (repo: string, pr: number, at: Awaited): { readonly ok: boolean; readonly text: string } => {
  const head = `pr ${pr}: ${REQUIRED}`;

  if (Option.isNone(at.job) || at.job.value.status !== "completed") {
    return { ok: false, text: `${head} is ${stands(at.job)} at ${at.oid}, not ended` };
  }

  const { id, conclusion } = at.job.value;

  if (conclusion === "success") {
    return { ok: true, text: `${head} succeeded at ${at.oid}` };
  }

  return {
    ok: false,
    text:
      conclusion === "cancelled"
        ? `${head} was cancelled at ${at.oid}: its run was cancelled, https://github.com/${repo}/runs/${id}`
        : `${head} is ${conclusion ?? "ended with no conclusion"} at ${at.oid}, not a success: https://github.com/${repo}/runs/${id}`,
  };
};

/**
 * Whether a CI run has started at `oid`: any check run GitHub Actions made there, which a push's own
 * run makes within seconds. Marking a draft ready in the seconds after a push starts a second run on
 * the same commit, and GitHub then reports the required check as "expected" and will not queue the
 * pull request (2026-11-22). Read once, or with a wait again until one appears or the wait is over;
 * a read that fails counts as not started. As `requiredAt`, a wait ends with `Conflicting` when
 * pull request `pr` comes to conflict with main.
 */
export const startedAt = Effect.fn("Queue.startedAt")(function* (oid: string, wait: Wait | undefined, pr: number) {
  const checks = yield* Checks;

  if (wait === undefined) {
    return yield* checks.started(oid);
  }

  const began = checks.started(oid).pipe(
    Effect.filterOrFail(
      (started) => started,
      () => Pending.make(),
    ),
    Effect.tapError(() => unlessConflicting(pr)),
    Effect.retry({ schedule: Schedule.spaced(Duration.seconds(wait.every)), while: (e) => e._tag !== "Conflicting" }),
    Effect.catchTag("Pending", () => Effect.succeed(false)),
    Effect.timeoutOption(Duration.minutes(wait.minutes)),
  );

  return Option.getOrElse(yield* began, () => false);
});

/** The refusal for a draft whose head has no CI run yet: it is not marked ready, and nothing else is asked. */
export const notStarted = (oid: string): string =>
  `no CI run has started at ${oid} yet, so it is not marked ready (a ready event seconds after a push starts a second run on one commit, and the required check stays expected); give it a wait, or try again`;

/** What `add` did: added it to the queue at this head, or found it merged already. */
export const Added = Schema.TaggedUnion({
  queued: { pr: Schema.Finite, oid: Schema.String },
  merged: { pr: Schema.Finite, commit: Schema.String },
});

export type Added = typeof Added.Type;

/**
 * Why a pull request may not enter the queue as it stands, or `null` when it may. A draft is
 * refused here for callers that do not mark it ready (an admin merge with no wait); `add` marks
 * one ready itself and asks about it as ready.
 */
export const refusal = (found: Detail): string | null =>
  found.state === "CLOSED"
    ? "closed, not merged"
    : found.state !== "OPEN"
      ? `in state ${found.state}, not merged; refused`
      : found.draft
        ? "draft, not merged; refused until it is ready for review"
        : found.base !== "main"
          ? `merges into ${found.base}, not main; refused`
          : found.mergeable === "CONFLICTING"
            ? conflictLine(found.number)
            : null;

/**
 * Why a pull request's description may not merge, or `null`: it is the pr skill's template and not the draft placeholder
 * (Sections.ts), and each new exported name is named under `## New names` (Names.ts). The one place `add`, `land.ts check`,
 * the arm and the admin merge read it from, so the four cannot drift.
 */
export const description = Effect.fn("Queue.description")(function* (
  found: Pick<Detail, "number" | "body">,
): Effect.fn.Return<string | null, PullRequestsError, PullRequests> {
  return Sections.refusal(found.body) ?? Names.refusal(found.body, yield* (yield* PullRequests).patches(found.number));
});

/**
 * The checks on a pull request's own words, which `add` runs and `land.ts check` runs alone, so a
 * body is known good before the queue is asked: the leak grep on its title and description, then
 * that it is the pr skill's template and not the draft placeholder (Sections.ts), then
 * each new exported name named under `## New names`, then each `fabrika close ticket <N>` line naming an open tracker ticket. Gives why it may not enter the queue, or
 * `null`; a leak grep that refuses or cannot run fails it. Reads the pull request's patches and
 * changes nothing.
 */
export const body = Effect.fn("Queue.body")(function* (
  dir: string,
  found: Pick<Detail, "number" | "title" | "body">,
): Effect.fn.Return<string | null, LeakGrepRefused | PullRequestsError, PullRequests | Pushes | Tickets> {
  yield* Leaks.text(dir, found);

  return (yield* description(found)) ?? (yield* unopenTickets(found.body));
});

/**
 * Why a `fabrika close ticket <N>` line cannot close anything, or `null` when each N is an open tracker ticket. A GitHub issue
 * is closed by `Closes #<N>`, never by that line, so a number that is an open issue says so. A tracker that cannot be read
 * refuses too: a line that closes nothing is found after the merge, when it is too late.
 */
const unopenTickets = Effect.fn("Queue.unopenTickets")(function* (
  text: string,
): Effect.fn.Return<string | null, PullRequestsError, PullRequests | Tickets> {
  const named = namedTickets(text);

  if (named.length === 0) {
    return null;
  }

  const open = yield* (yield* Tickets).open.pipe(Effect.option);

  if (open._tag === "None") {
    return `cannot read the tracker, so cannot tell if its fabrika close ticket line names an open ticket: ${Arr.join(Arr.map(named, String), " ")}`;
  }

  const unopen = Arr.filter(named, (n) => !open.value.includes(n));

  if (unopen.length === 0) {
    return null;
  }

  const issues = yield* (yield* PullRequests).openIssues;

  return Arr.join(
    Arr.map(unopen, (n) =>
      issues.includes(n)
        ? `fabrika close ticket ${n}: ${n} is an open GitHub issue, not a tracker ticket; close it with a line \`Closes #${n}\` instead`
        : `fabrika close ticket ${n}: ${n} is not an open tracker ticket (closed, or no such ticket), and not an open GitHub issue; fix the number or take the line out`,
    ),
    "; ",
  );
});

const conflicted = (pr: number) => NotQueued.make({ reason: `pr ${pr}: ${conflictLine(pr)}` });

export const add = Effect.fn("Queue.add")(function* (a: Ask) {
  const prs = yield* PullRequests;
  const found = yield* prs.view(a.pr);

  if (found.state === "MERGED") {
    return Added.cases.merged.make({ pr: found.number, commit: found.mergeCommit ?? found.oid });
  }

  // A draft is not refused for being a draft: it is marked ready below, once every refusal that needs no ready pull request has passed.
  const marking = found.state === "OPEN" && found.draft;
  const refused = refusal(marking ? { ...found, draft: false } : found);

  if (refused !== null) {
    return yield* NotQueued.make({ reason: `pr ${found.number}: ${refused}` });
  }

  yield* Leaks.diff(a.dir, found);
  const unnamed = yield* body(a.dir, found);

  if (unnamed !== null) {
    return yield* NotQueued.make({ reason: `pr ${found.number}: ${unnamed}` });
  }

  // Marking a draft ready starts its real `ci-required`, which has not registered yet: a read with no wait finds it missing and
  // refuses, and a read with a wait gives it time to appear and end. It waits first for the push's own run to start, so a ready
  // event never lands in the seconds after a push.
  if (marking) {
    if (
      !(yield* startedAt(found.oid, a.wait, found.number).pipe(
        Effect.catchTag("Conflicting", () => conflicted(found.number)),
      ))
    ) {
      return yield* NotQueued.make({ reason: `pr ${found.number}: ${notStarted(found.oid)}` });
    }

    yield* prs.ready(found.number);
  }

  // With a queue on, a merge call on a head that is not green yet arms auto-merge (a pull request whose steps passed lands on green CI and a clean leak check alone). So the
  // required check is read first, and anything but a finished success asks nothing. It is read at the head the leak checks ran on.
  const at = yield* required(found.oid, a.wait, found.number).pipe(
    Effect.catchTags({
      Conflicting: () => conflicted(found.number),
      Gone: (e) =>
        NotQueued.make({ reason: `pr ${found.number}: it is ${e.state}, not merged; not added to the queue` }),
    }),
  );

  if (at.oid !== found.oid) {
    return yield* NotQueued.make({ reason: `pr ${found.number}: ${moved(found.oid, at.oid)}; not added to the queue` });
  }

  const read = at.job;

  if (read._tag === "None" || read.value.status !== "completed" || read.value.conclusion !== "success") {
    return yield* NotQueued.make({
      reason: `pr ${found.number}: ${REQUIRED} is ${stands(read)} at ${found.oid}, not a success; not added to the queue`,
    });
  }

  yield* prs.enqueue(found.number, found.oid);

  return Added.cases.queued.make({ pr: found.number, oid: found.oid });
});

/** One line for a log: what `add` did. */
export const line = (added: Added): string =>
  added._tag === "queued"
    ? `pr ${added.pr}: queued at ${added.oid}; GitHub tests it on newest main and merges it`
    : `pr ${added.pr}: already merged at ${added.commit}`;

// ---------------------------------------------------------------- after the merge

const PHRASE = /^[ \t]*fabrika close ticket ([0-9]+)[ \t]*$/;

/**
 * The tickets a description names, each once, in order: only a line of its own that reads
 * `fabrika close ticket <N>` (a merge closes only the tickets its pull request names with our own phrase). No GitHub keyword, trailer or commit subject names one.
 */
export const namedTickets = (body: string): ReadonlyArray<number> => [
  ...new Set(
    pipe(
      body,
      Str.replaceAll("\r", ""),
      Str.split("\n"),
      Arr.map((row) => PHRASE.exec(row)?.[1]),
      Arr.filter((n) => n !== undefined),
      Arr.map(Number),
    ),
  ),
];

/** The comment a closed ticket gets: the pull request and its merge commit. */
export const closeNote = (repo: string, pr: number, commit: string): string =>
  `Closed by the merge of https://github.com/${repo}/pull/${pr}, merge commit ${commit}.\n`;

/** How a pull request stands when `settle` reads it, and one line for each thing it did or left. */
export const Settled = Schema.TaggedUnion({
  merged: { pr: Schema.Finite, commit: Schema.String, lines: Schema.Array(Schema.String) },
  unmerged: { pr: Schema.Finite, lines: Schema.Array(Schema.String) },
});

export type Settled = typeof Settled.Type;

/**
 * Comments on ticket `n` and closes it, then records the close: the one close every path makes, so the
 * record holds each ticket this tooling closed. Says how it went: `closed` is whether the ticket is closed
 * now (a record that was not written still closed it), and `line` says so for a log. A failed comment or
 * close is a line, never a failure, and it is not recorded, so a later pass tries that ticket again.
 */
const closeOne = Effect.fn("Queue.closeOne")(function* (repo: string, pr: number, commit: string, n: number) {
  const tickets = yield* Tickets;
  const closes = yield* Closes;
  const said = (text: string) => `pr ${pr}: ${text}`;

  const commented = yield* Effect.result(tickets.comment(n, closeNote(repo, pr, commit)));

  if (Result.isFailure(commented)) {
    return { closed: false, line: said(`ticket ${n} not closed, the comment failed: ${commented.failure.reason}`) };
  }

  const closed = yield* Effect.result(tickets.close(n));

  if (Result.isFailure(closed)) {
    return { closed: false, line: said(`ticket ${n} not closed: ${closed.failure.reason}`) };
  }

  const at = DateTime.formatIso(yield* DateTime.now);
  const recorded = yield* Effect.result(closes.record({ at, pr, ticket: n, commit }));

  return {
    closed: true,
    line: Result.isFailure(recorded)
      ? said(`closed ticket ${n}, but the record was not written: ${recorded.failure.reason}`)
      : said(`closed ticket ${n}`),
  };
});

/** Closes each open ticket the merged description names; trouble is a line, never a failure. */
const closeNamed = Effect.fn("Queue.closeNamed")(function* (repo: string, found: Detail, commit: string) {
  const tickets = yield* Tickets;
  const named = namedTickets(found.body);
  const said = (text: string) => `pr ${found.number}: ${text}`;

  if (named.length === 0) {
    return [said("no fabrika close ticket line; closed no tickets")];
  }

  const open = yield* tickets.open.pipe(Effect.option);

  if (open._tag === "None") {
    return [said(`cannot read the tracker; closed no tickets: ${Arr.join(Arr.map(named, String), " ")}`)];
  }

  const lines: Array<string> = [];

  for (const n of named) {
    if (!open.value.includes(n)) {
      lines.push(said(`ticket ${n} is not open (already closed, or no such ticket); left as it is`));
      continue;
    }

    // The last look before the close: another path may have shut the ticket since the first read.
    const again = yield* tickets.open.pipe(Effect.option);

    if (Option.isNone(again)) {
      lines.push(said(`cannot read the tracker again before closing ticket ${n}; left as it is`));
      continue;
    }

    if (!again.value.includes(n)) {
      lines.push(said(`ticket ${n} is not open (already closed, or no such ticket); left as it is`));
      continue;
    }

    lines.push((yield* closeOne(repo, found.number, commit, n)).line);
  }

  return lines;
});

/** A pull request read once: merged into main at a commit, or why it is not. */
const Standing = Schema.TaggedUnion({
  unmerged: { found: Detail, lines: Schema.Array(Schema.String) },
  merged: { found: Detail, commit: Schema.String },
});

type Standing = typeof Standing.Type;

const standing = Effect.fn("Queue.standing")(function* (
  pr: number,
): Effect.fn.Return<Standing, PullRequestsError, PullRequests> {
  const prs = yield* PullRequests;
  const found = yield* prs.view(pr);
  const said = (text: string) => `pr ${found.number}: ${text}`;

  if (found.state !== "MERGED" || found.mergeCommit === null) {
    const stands = Match.value(found.state).pipe(
      Match.when("OPEN", () =>
        found.draft ? "a draft, not in the queue" : "open, not merged yet: in the queue, or put back out of it",
      ),
      Match.when("CLOSED", () => "closed, not merged"),
      Match.orElse(() => "not confirmed merged"),
    );

    return Standing.cases.unmerged.make({ found, lines: [said(`${stands}; closed no tickets`)] });
  }

  if (found.base !== "main") {
    return Standing.cases.unmerged.make({
      found,
      lines: [said(`merged into ${found.base}, not main; closed no tickets`)],
    });
  }

  return Standing.cases.merged.make({ found, commit: found.mergeCommit });
});

/**
 * Reads pull request `pr` once. Merged into main: closes the tickets it names and nothing else, no
 * sweep. For a pull request that merged long ago, which `settle` would sweep for no reason.
 */
export const closeOnly = Effect.fn("Queue.closeOnly")(function* (a: { readonly repo: string; readonly pr: number }) {
  const at = yield* standing(a.pr);

  if (at._tag === "unmerged") {
    return Settled.cases.unmerged.make({ pr: at.found.number, lines: at.lines });
  }

  const closed = yield* closeNamed(a.repo, at.found, at.commit);

  return Settled.cases.merged.make({
    pr: at.found.number,
    commit: at.commit,
    lines: [`pr ${at.found.number}: merged at ${at.commit}`, ...closed],
  });
});

/**
 * Reads pull request `pr` once. Merged into main: closes the tickets it names and starts one box
 * cleanup sweep. Anything else: says how it stands and does nothing. It never waits and never
 * fails on a ticket or a sweep; only a pull request that cannot be read fails it. Running it again
 * closes nothing twice: a closed ticket is no longer open.
 */
export const settle = Effect.fn("Queue.settle")(function* (a: { readonly repo: string; readonly pr: number }) {
  const sweeps = yield* Sweeps;
  const at = yield* standing(a.pr);

  if (at._tag === "unmerged") {
    return Settled.cases.unmerged.make({ pr: at.found.number, lines: at.lines });
  }

  const closed = yield* closeNamed(a.repo, at.found, at.commit);

  const swept = yield* Effect.match(sweeps.kick, {
    onFailure: (e) => [`pr ${at.found.number}: box cleanup not started: ${e.reason}`],
    onSuccess: () => [],
  });

  return Settled.cases.merged.make({
    pr: at.found.number,
    commit: at.commit,
    lines: [`pr ${at.found.number}: merged at ${at.commit}`, ...closed, ...swept],
  });
});

// ---------------------------------------------------------------- the timer's pass

/**
 * What one pass did: the tickets it closed, the tickets whose comment or close failed (the next pass tries
 * them again), why it stopped early when it did (a read that failed, or its time ran out), and one line for
 * each thing it said. gcloop.ts keeps it in the sweep's record, so `status` can say it.
 */
export const Pass = Schema.Struct({
  closed: Schema.Array(Schema.Finite),
  failed: Schema.Array(Schema.Finite),
  stopped: Schema.NullOr(Schema.String),
  lines: Schema.Array(Schema.String),
});

export type Pass = typeof Pass.Type;

/**
 * The timer's pass (gcloop.ts runs it after each sweep, under the sweep's lock). Reads the newest `limit`
 * pull requests merged into main, by merge time, out of the `scan` most recently updated merged ones, and
 * closes each open ticket one of them names, once: a ticket the record already holds is left as it is, so a
 * ticket a person reopened after this tooling closed it stays open. One read each of GitHub, the tracker and
 * the record, however many pull requests there are, and no tracker read when no merge names a ticket. The
 * newest merge that names a ticket is the one credited. Each close reads the tracker and the record again
 * first. A read that fails closes no more tickets and says why; a close that fails is one line, and the next
 * pass tries it again.
 */
export const reconcile = Effect.fn("Queue.reconcile")(function* (a: {
  readonly repo: string;
  readonly limit: number;
  readonly scan: number;
}) {
  const prs = yield* PullRequests;
  const tickets = yield* Tickets;
  const closes = yield* Closes;
  const stop = (reason: string) => Pass.make({ closed: [], failed: [], stopped: reason, lines: [reason] });

  const listed = yield* Effect.result(prs.merged(a.scan));

  if (Result.isFailure(listed)) {
    return stop(`cannot read the merged pull requests: ${listed.failure.reason}; no tickets closed`);
  }

  // The scan is in update order, which a late comment can change, so the credited merges are the newest by merge time.
  const newest = listed.success.toSorted((x, y) => Date.parse(y.mergedAt) - Date.parse(x.mergedAt)).slice(0, a.limit);
  const named = newest.flatMap((pr) => namedTickets(pr.body).map((ticket) => ({ pr, ticket })));

  if (named.length === 0) {
    return Pass.make({ closed: [], failed: [], stopped: null, lines: [] });
  }

  const open = yield* Effect.result(tickets.open);

  if (Result.isFailure(open)) {
    return stop(`cannot read the tracker: ${open.failure.reason}; no tickets closed`);
  }

  const recorded = yield* Effect.result(closes.all);

  if (Result.isFailure(recorded)) {
    return stop(`cannot read the closes record: ${recorded.failure.reason}; no tickets closed`);
  }

  // A ticket joins `done` once this pass has tried it, so an older merge that names it does not try again.
  const done = new Set(recorded.success.map((close) => close.ticket));
  const stillOpen = new Set(open.success);
  const closed: Array<number> = [];
  const failed: Array<number> = [];
  const lines: Array<string> = [];

  for (const { pr, ticket } of named) {
    if (done.has(ticket) || !stillOpen.has(ticket)) {
      continue;
    }

    done.add(ticket);

    // The last look before the close: another path may have shut the ticket, or recorded it, since the first reads.
    const again = yield* Effect.result(
      Effect.all({ open: tickets.open, recorded: closes.all }, { concurrency: "unbounded" }),
    );

    if (Result.isFailure(again)) {
      const reason = `cannot read the tracker or the record before a close: ${again.failure.reason}; no more tickets closed`;

      return Pass.make({ closed, failed, stopped: reason, lines: [...lines, reason] });
    }

    if (!again.success.open.includes(ticket) || again.success.recorded.some((close) => close.ticket === ticket)) {
      lines.push(`pr ${pr.number}: ticket ${ticket} was shut or recorded since the first read; left as it is`);
      continue;
    }

    const shut = yield* closeOne(a.repo, pr.number, pr.mergeCommit, ticket);

    lines.push(shut.line);

    if (shut.closed) {
      closed.push(ticket);
    } else {
      failed.push(ticket);
    }
  }

  return Pass.make({ closed, failed, stopped: null, lines });
});
