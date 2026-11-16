// Queue: how a finished pull request lands, and what follows its merge (0162). Main takes changes
// only through GitHub's merge queue: GitHub tests each pull request on newest main and merges it,
// so nothing here merges main in, waits on a check or runs one again. Today's lead tooling, run on
// our own laptop; it is not product.
//
//   add      the pull request is open, ready and into main -> leak grep on its net change, on each
//            of its commits and on its title and description, each failing closed -> each new
//            exported name is named under `## New names` (Names.ts, 0587) -> `ci-required`
//            is green on its head (read once; a quest may wait for it to end, within a limit) -> one
//            squash pinned to that head, which adds it to the queue
//   settle   later, one read of the pull request and no wait: merged -> close each ticket its
//            description names (0015) and start one box cleanup sweep (0101); else say how it stands
//
// `add` answers "queued", never "merged": the merge is GitHub's, later. `settle` is how code learns
// it happened. Read through its module: `Queue.add(...)`.
import { Array as Arr, Duration, Effect, Option, Schedule, Schema, pipe } from "effect";
import { Checks, type Job } from "../ci/Checks.ts";
import * as Leaks from "./Leaks.ts";
import * as Names from "./Names.ts";
import { Detail, PullRequests, type PullRequestsError } from "./PullRequests.ts";
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

/** The required check at `oid` as it stands: read once, or again until it ends or the wait is over. */
const requiredAt = Effect.fn("Queue.requiredAt")(function* (oid: string, wait: Wait | undefined) {
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
    Effect.retry({ schedule: Schedule.spaced(Duration.seconds(wait.every)) }),
    Effect.catchTag("Pending", () => Effect.sync(() => last)),
    Effect.timeoutOption(Duration.minutes(wait.minutes)),
  );

  return Option.getOrElse(yield* ended, () => last);
});

/** What `add` did: added it to the queue at this head, or found it merged already. */
export const Added = Schema.TaggedUnion({
  queued: { pr: Schema.Finite, oid: Schema.String },
  merged: { pr: Schema.Finite, commit: Schema.String },
});

export type Added = typeof Added.Type;

/** Why a pull request may not enter the queue as it stands, or `null` when it may. */
export const refusal = (found: Detail): string | null =>
  found.state === "CLOSED"
    ? "closed, not merged"
    : found.state !== "OPEN"
      ? `in state ${found.state}, not merged; refused`
      : found.draft
        ? "draft, not merged; refused until it is ready for review"
        : found.base !== "main"
          ? `merges into ${found.base}, not main; refused`
          : null;

export const add = Effect.fn("Queue.add")(function* (a: Ask) {
  const prs = yield* PullRequests;
  const found = yield* prs.view(a.pr);

  if (found.state === "MERGED") {
    return Added.cases.merged.make({ pr: found.number, commit: found.mergeCommit ?? found.oid });
  }

  const refused = refusal(found);

  if (refused !== null) {
    return yield* NotQueued.make({ reason: `pr ${found.number}: ${refused}` });
  }

  yield* Leaks.gate(a.dir, found);
  const unnamed = Names.refusal(found.body, yield* prs.patches(found.number));

  if (unnamed !== null) {
    return yield* NotQueued.make({ reason: `pr ${found.number}: ${unnamed}` });
  }

  // With a queue on, a merge call on a head that is not green yet arms auto-merge (0162). So the
  // required check is read first, and anything but a finished success asks nothing.
  const required = yield* requiredAt(found.oid, a.wait);
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
 * `fabrika close ticket <N>` (0015). No GitHub keyword, trailer or commit subject names one.
 */
export const namedTickets = (body: string): ReadonlyArray<number> => [
  ...new Set(
    pipe(
      body.replaceAll("\r", "").split("\n"),
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
    const stands =
      found.state === "OPEN"
        ? found.draft
          ? "a draft, not in the queue"
          : "open, not merged yet: in the queue, or put back out of it"
        : found.state === "CLOSED"
          ? "closed, not merged"
          : "not confirmed merged";

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
