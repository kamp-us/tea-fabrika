// Queue: how a finished pull request lands, and what follows its merge (a pull request whose steps passed lands on green CI and a clean leak check alone). Main takes changes
// only through GitHub's merge queue: GitHub tests each pull request on newest main and merges it,
// so nothing here merges main in, waits on a check or runs one again. Today's lead tooling, run on
// our own laptop; it is not product.
//
//   add      the pull request is open, into main and not in conflict with main -> leak grep on its net change and on each
//            of its commits, each failing closed -> the body checks (`body`, which `land.ts check` runs alone): the leak grep on its
//            title and description, and each new exported name named under `## New names` (Names.ts, a new helper names the tools it searched, and a new name cites the industry's word), and each `fabrika close ticket <N>` line naming an open tracker ticket (an open GitHub issue is closed by `Closes #<N>`) -> a draft whose head has a CI run
//            (never in the seconds after a push; with a wait, one is given time to appear, and a wait ends at once with a refusal
//            when the pull request turns to conflict with main, since GitHub starts no check on one) is marked ready
//            (as `land.ts admin` does), which starts its real `ci-required` -> `ci-required`
//            is green on its head (read once; a quest may wait for it to end, within a limit) -> one
//            squash pinned to that head, which adds it to the queue
//   settle   later, one read of the pull request and no wait: merged -> close each ticket its
//            description names (a merge closes only the tickets its pull request names with our own phrase) and start one box cleanup sweep (box cleanup runs on a timer and after a merge, never on a step's start path); else say how it stands
//
// `add` answers "queued", never "merged": the merge is GitHub's, later. `settle` is how code learns
// it happened. Read through its module: `Queue.add(...)`.

import { String as Str, pipe, Option, Array as Arr, Duration, Effect, Match, Schedule, Schema } from "effect";

import { Checks, type Job } from "../ci/Checks.ts";
import * as Leaks from "./Leaks.ts";
import * as Names from "./Names.ts";
import { Detail, PullRequests, type PullRequestsError } from "./PullRequests.ts";
import type { LeakGrepRefused, Pushes } from "./Pushes.ts";
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

/**
 * The required check at `oid` as it stands: read once, or again until it ends or the wait is over.
 * Each read that finds it not ended also asks whether pull request `pr` has come to conflict with
 * main (a wait for a check GitHub will never start ends there, with `Conflicting`).
 */
export const requiredAt = Effect.fn("Queue.requiredAt")(function* (oid: string, wait: Wait | undefined, pr: number) {
  const checks = yield* Checks;
  const read = checks.job(oid, REQUIRED);

  if (wait === undefined) {
    return yield* read;
  }

  let last: Option.Option<Job> = Option.none();

  const ended = read.pipe(
    Effect.tap((found) =>
      Effect.sync(() => {
        last = found;
      }),
    ),
    Effect.filterOrFail(
      (found) => Option.isSome(found) && found.value.status === "completed",
      () => Pending.make(),
    ),
    Effect.tapError(() => unlessConflicting(pr)),
    Effect.retry({ schedule: Schedule.spaced(Duration.seconds(wait.every)), while: (e) => e._tag !== "Conflicting" }),
    Effect.catchTag("Pending", () => Effect.sync(() => last)),
    Effect.timeoutOption(Duration.minutes(wait.minutes)),
  );

  return Option.getOrElse(yield* ended, () => last);
});

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
 * The checks on a pull request's own words, which `add` runs and `land.ts check` runs alone, so a
 * body is known good before the queue is asked: the leak grep on its title and description, then
 * each new exported name named under `## New names`, then each `fabrika close ticket <N>` line naming an open tracker ticket. Gives why it may not enter the queue, or
 * `null`; a leak grep that refuses or cannot run fails it. Reads the pull request's patches and
 * changes nothing.
 */
export const body = Effect.fn("Queue.body")(function* (
  dir: string,
  found: Pick<Detail, "number" | "title" | "body">,
): Effect.fn.Return<string | null, LeakGrepRefused | PullRequestsError, PullRequests | Pushes | Tickets> {
  yield* Leaks.text(dir, found);

  const names = Names.refusal(found.body, yield* (yield* PullRequests).patches(found.number));

  return names ?? (yield* unopenTickets(found.body));
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
  // required check is read first, and anything but a finished success asks nothing.
  const required = yield* requiredAt(found.oid, a.wait, found.number).pipe(
    Effect.catchTag("Conflicting", () => conflicted(found.number)),
  );

  const stands = required._tag === "None" ? "missing" : (required.value.conclusion ?? required.value.status);

  if (required._tag === "None" || required.value.status !== "completed" || required.value.conclusion !== "success") {
    return yield* NotQueued.make({
      reason: `pr ${found.number}: ${REQUIRED} is ${stands} at ${found.oid}, not a success; not added to the queue`,
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

    lines.push(
      yield* tickets.comment(n, closeNote(repo, found.number, commit)).pipe(
        Effect.matchEffect({
          onFailure: (e) => Effect.succeed(said(`ticket ${n} not closed, the comment failed: ${e.reason}`)),
          onSuccess: () =>
            Effect.match(tickets.close(n), {
              onFailure: (e) => said(`ticket ${n} not closed: ${e.reason}`),
              onSuccess: () => said(`closed ticket ${n}`),
            }),
        }),
      ),
    );
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
