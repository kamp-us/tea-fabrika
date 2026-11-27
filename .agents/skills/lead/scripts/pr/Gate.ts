// Gate: the one check every way of merging a pull request runs first (`land.ts check`, `queue`, `run`, `merge`, `merge
// --admin`, `admin` and `arm`, and the landing flow's `queue` step), so the paths cannot drift: a refusal that one path holds is
// held by all of them. A path adds only its own part after the gate (a wait, a proof run, admin's conditions) and never skips
// a refusal. Today's lead tooling, run on our own laptop; it is not product.
//
// Why a pull request may not merge, in the order they are asked, the first one that applies answering:
//
//   branch        not a `can/` branch: a person's own pull request, which no agent merges
//   state         open, into main, not in conflict with main, and not a draft unless the path marks it ready itself
//   plan          no `Plan:` title: a plan's pull request is read, never merged
//   change        the leak grep on its net change and on each of its commits (./Leaks.ts)
//   words         the leak grep on its title and description, then that the description is the pr skill's template and not the
//                 draft placeholder (Sections.ts), each new exported name is named under `## New names` (Names.ts), and each
//                 `fabrika close ticket <N>` line names an open tracker ticket
//   signatures    every commit since main is signed or made by `stepcommit.sh` (./Signatures.ts)
//   review        a path the head changes that needs a review (./Review.ts `REVIEWED`) has an approval recorded on that head, except that an
//                 admin merge may go past a missing one with a written reason, and `arm` never goes past it (see `Way`)
//
// A merged pull request is no refusal here: each path answers one as "already merged" before it asks the gate, and `land.ts
// check` reads merged ones too (replay.ts runs it on them).
//
// The review check (ticket 2338, decision 0093: .kalfa/decisions/0093-a-review-verdict-is-a-record-on-the-reviewed-head-and-ci-required-reads-it-on-the-queue.md)
// is the last entry of `CHECKS`. It asks git for the paths the head changes (./Changes.ts) and, only when one needs a review, GitHub for
// the statuses on that head (./Reviews.ts). The question carries the way the path merges (queue, arm or admin, with the reason an admin
// merge gives), since the three go past a missing record differently. Read through its module: `Gate.before(...)`.
import { String as Str, pipe, Array as Arr, Effect, Schema } from "effect";

import { Changes, type ChangesError } from "./Changes.ts";
import * as Leaks from "./Leaks.ts";
import * as Names from "./Names.ts";
import { type Detail, PullRequests, type PullRequestsError } from "./PullRequests.ts";
import type { LeakGrepRefused, Pushes } from "./Pushes.ts";
import * as Review from "./Review.ts";
import { Reviews, type ReviewsError } from "./Reviews.ts";
import * as Sections from "./Sections.ts";
import { Signatures, type SignaturesError } from "./Signatures.ts";
import { Tickets } from "./Tickets.ts";

/** What a check cannot read, so it cannot tell: a leak grep that refused or could not run, GitHub, git. The next check adds its own here. */
export type Unread = LeakGrepRefused | PullRequestsError | SignaturesError | ChangesError | ReviewsError;

/** What the checks read from. The next check adds its own service here. */
export type Needs = PullRequests | Pushes | Tickets | Signatures | Changes | Reviews;

/**
 * How a path merges, which decides what it may do about a missing review: the merge queue (`queue`, `merge`, `run`, `check`, the landing
 * flow) needs a record; `arm` turns on merge when ready, which merges whatever the head is later, so it is refused for a pull request that
 * needs a review, record or not; an admin merge (`merge --admin`, `admin`) goes past a missing record only with a written reason.
 */
export const Way = Schema.TaggedUnion({
  queue: {},
  arm: {},
  admin: { override: Schema.NullOr(Review.Reason) },
});

/** The pull request, and where the checks read its change from. */
export type Ask = {
  /** A checkout of the repo, to fetch the head into and read its change from. */
  readonly dir: string;
  readonly found: Detail;
  /** Whether the path marks a draft ready itself, as `queue`, `arm` and `check` do and `admin` does with a wait; a draft then passes. */
  readonly marksReady: boolean;
  readonly way: typeof Way.Type;
};

/** One refusal: what it says of this pull request when it passes, and how it asks. It gives why the pull request may not merge, or `null`. */
type Check = {
  readonly passes: (found: Pick<Detail, "state">, overridden: boolean) => string;
  readonly ask: (ask: Ask) => Effect.Effect<string | null, Unread, Needs>;
};

/** What a refusal for a conflict says, and the commands that put main in. */
export const conflictLine = (pr: number): string =>
  `it conflicts with main, so no check runs on it; merge main in with \`gh pr update-branch ${pr}\` (a quest: \`land.ts run <quest> <ticket>\`), push, and queue it again`;

/** A `can/` branch is a person's own work and never merged by the lead. */
const CAN = "can/";

const canBranch = (found: Detail): string | null =>
  found.head.startsWith(CAN) ? `${found.head} is a ${CAN} branch, never merged here; not merged` : null;

/**
 * Why a pull request is in no state to merge, or `null`. A draft is refused for a path that does not mark it ready; one that
 * does asks about it as ready. A merged pull request is not refused.
 */
const unfit = ({ found, marksReady }: Ask): string | null => {
  const at = marksReady && found.state === "OPEN" && found.draft ? { ...found, draft: false } : found;

  return at.state === "MERGED"
    ? null
    : at.state === "CLOSED"
      ? "closed, not merged"
      : at.state !== "OPEN"
        ? `in state ${at.state}, not merged; refused`
        : at.draft
          ? "draft, not merged; refused until it is ready for review"
          : at.base !== "main"
            ? `merges into ${at.base}, not main; refused`
            : at.mergeable === "CONFLICTING"
              ? conflictLine(at.number)
              : null;
};

// An open pull request for a plan to be read is titled `Plan: ...` (1279, 1344, 1365, 1373). A lowercase `plan:` title is how a
// change to the plan files merges (485, 1158), so it may merge.
const plan = (found: Detail): string | null =>
  found.title.startsWith("Plan:")
    ? "its title starts `Plan:`, a plan's pull request, which is never merged; give it the title it lands with first (the pr skill)"
    : null;

/**
 * Why a pull request's description may not merge, or `null`: it is the pr skill's template and not the draft placeholder
 * (Sections.ts), and each new exported name is named under `## New names` (Names.ts).
 */
export const description = Effect.fn("Gate.description")(function* (
  found: Pick<Detail, "number" | "body">,
): Effect.fn.Return<string | null, PullRequestsError, PullRequests> {
  return Sections.refusal(found.body) ?? Names.refusal(found.body, yield* (yield* PullRequests).patches(found.number));
});

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

/**
 * Why a `fabrika close ticket <N>` line cannot close anything, or `null` when each N is an open tracker ticket. A GitHub issue
 * is closed by `Closes #<N>`, never by that line, so a number that is an open issue says so. A tracker that cannot be read
 * refuses too: a line that closes nothing is found after the merge, when it is too late.
 */
const unopenTickets = Effect.fn("Gate.unopenTickets")(function* (
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

/**
 * The checks on a pull request's own words, one part of the gate that the laws also read alone: the leak grep on
 * its title and description, then that it is the pr skill's template and not the draft placeholder (Sections.ts), then each new
 * exported name named under `## New names`, then each `fabrika close ticket <N>` line naming an open tracker ticket. Gives why
 * it may not merge, or `null`; a leak grep that refuses or cannot run fails it. Reads the pull request's patches and changes
 * nothing.
 */
export const body = Effect.fn("Gate.body")(function* (
  dir: string,
  found: Pick<Detail, "number" | "title" | "body">,
): Effect.fn.Return<string | null, LeakGrepRefused | PullRequestsError, PullRequests | Pushes | Tickets> {
  yield* Leaks.text(dir, found);

  return (yield* description(found)) ?? (yield* unopenTickets(found.body));
});

/** The approval a pull request's head holds for the paths it changes: `exempt` when none needs a review, else what its statuses say. */
const decided = Effect.fn("Gate.decided")(function* (
  found: Pick<Detail, "oid">,
  paths: ReadonlyArray<string>,
): Effect.fn.Return<Review.Approval, ReviewsError, Reviews> {
  const exempt = Review.approval({ reviewed: Review.REVIEWED, paths, seen: [] });

  return exempt._tag === "exempt"
    ? exempt
    : Review.approval({ reviewed: Review.REVIEWED, paths, seen: yield* (yield* Reviews).read(found.oid) });
});

/**
 * What the head's review stands at, for a path that acts on it (the admin merge writes its override only when this says `missing`). Reads the
 * paths git says the head changes and, when one needs a review, the statuses on the head.
 */
export const approval = Effect.fn("Gate.approval")(function* (
  dir: string,
  found: Pick<Detail, "oid">,
): Effect.fn.Return<Review.Approval, ChangesError | ReviewsError, Changes | Reviews> {
  return yield* decided(found, yield* (yield* Changes).paths(dir, found.oid));
});

const carryLine = (found: Detail): string =>
  `it changes a path that needs a review (next/, kalfa/ or a root config file) and no approval is recorded on its head ${found.oid}; if an earlier head was approved, carry it with \`land.ts review ${found.number}\`, else record the review with \`land.ts review ${found.number} --reviewed <sha> --reviewer <who>\``;

const adminLine = (found: Detail): string =>
  `it changes a path that needs a review and no approval is recorded on its head ${found.oid}; record one (\`land.ts review ${found.number}\`), or go past it on purpose with \`--override-review <reason>\``;

const armLine = (found: Detail): string =>
  `it changes a path that needs a review, so merge when ready is not turned on for it (a later push would merge with no review); queue it with \`land.ts queue ${found.number} --wait-ci\``;

/**
 * Why a pull request that changes a path needing a review may not merge by this way, or `null`. A merged pull request is not refused. Reads
 * the head's changed paths once, and its statuses only when a path needs a review and the way would take a record.
 */
const review = Effect.fn("Gate.review")(function* ({
  dir,
  found,
  way,
}: Ask): Effect.fn.Return<string | null, ChangesError | ReviewsError, Changes | Reviews> {
  if (found.state === "MERGED") {
    return null;
  }

  const paths = yield* (yield* Changes).paths(dir, found.oid);

  if (Review.approval({ reviewed: Review.REVIEWED, paths, seen: [] })._tag === "exempt") {
    return null;
  }

  const unapproved = (line: string) =>
    Effect.map(decided(found, paths), (read) => (read._tag === "approved" ? null : line));

  return yield* Way.match(way, {
    queue: () => unapproved(carryLine(found)),
    arm: () => Effect.succeed(armLine(found)),
    admin: ({ override }) => (override === null ? unapproved(adminLine(found)) : Effect.succeed(null)),
  });
});

/** The refusals, in the order they are asked. */
const CHECKS: ReadonlyArray<Check> = [
  { passes: () => "not a can/ branch", ask: ({ found }) => Effect.succeed(canBranch(found)) },
  {
    passes: ({ state }) => (state === "MERGED" ? "state: already merged" : "open, into main, no conflict"),
    ask: (ask) => Effect.succeed(unfit(ask)),
  },
  { passes: () => "no Plan: title", ask: ({ found }) => Effect.succeed(plan(found)) },
  {
    passes: () => "leak grep on the change and each commit",
    ask: ({ dir, found }) => Effect.as(Leaks.diff(dir, found), null),
  },
  {
    passes: () =>
      "leak grep on the title and description, the pr skill's sections, ## New names, fabrika close ticket lines",
    ask: ({ dir, found }) => body(dir, found),
  },
  {
    passes: () => "every commit since main signed",
    ask: Effect.fn("Gate.signatures")(function* ({ dir, found }) {
      const unsigned = yield* (yield* Signatures).unsigned(dir, found.oid);

      return unsigned.length === 0
        ? null
        : `${unsigned.length} commit(s) since main are not signed or made by stepcommit.sh: ${Arr.join(unsigned, "; ")}. Make it with \`stepcommit.sh --commit-only lead <ticket> "<subject>" <files>\` (\`--empty\` for no files), not a plain git commit.`;
    }),
  },
  {
    passes: (_, overridden) =>
      overridden
        ? "no review is recorded on the head: gone past on a written reason (--override-review)"
        : "a review on the head, or no path that needs one",
    ask: review,
  },
];

/**
 * What a passing gate says it checked, one line: the same words from `land.ts check` and from each path that merges, so the
 * lead reads one list. `found` is the pull request as it stood when the gate read it, so a merged one says so.
 */
export const line = (found: Pick<Detail, "number" | "state">, overridden = false): string =>
  `pr ${found.number}: the merge gate passes (${Arr.join(
    Arr.map(CHECKS, (check) => check.passes(found, overridden)),
    "; ",
  )})`;

/**
 * Why the pull request may not merge by any path, or `null` when it may: the first refusal of `CHECKS`. A refusal that cannot be
 * read (a leak grep that could not run, GitHub or git that did not answer) fails, and is never a pass. Changes nothing but the
 * refs a fetch writes.
 */
export const before = Effect.fn("Gate.before")(function* (ask: Ask): Effect.fn.Return<string | null, Unread, Needs> {
  for (const check of CHECKS) {
    const refused = yield* check.ask(ask);

    if (refused !== null) {
      return refused;
    }
  }

  return null;
});
