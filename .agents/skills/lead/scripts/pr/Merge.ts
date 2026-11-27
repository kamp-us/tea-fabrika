// Merge: the one way the lead merges a pull request by hand (`land.ts merge`). Every path runs the
// leak gate (./Leaks.ts) first and asks nothing of GitHub's merge when it refuses, or when the grep
// could not run. Today's lead tooling, run on our own laptop; it is not product.
//
//   queue   as Queue.add: open, ready, into main -> the leak gate -> ci-required green -> one
//           pinned squash, which adds it to the merge queue
//   admin   the merge gate passes (./Gate.ts, which every merge path asks first: open, ready, into main, no `Plan:` title, not a `can/` branch, the leak
//           gate, the description, each close-ticket line, every commit signed) -> ci-required
//           completed and green at the head, for every admin merge; a draft is marked ready first, and
//           with `wait` the check is given that long to appear and end (`land.ts admin`) -> the head has
//           not moved since it was read -> for a sev fix, also origin/main's head in its history -> one
//           pinned squash with --admin, past the queue. "Admin" skips the queue, never a green
//           ci-required. A pull request that is no sev fix and no sev0 ready one also waits for the merge queue to
//           empty (`queueWait`; refused, naming the entry, without one): an admin merge moves main, which restarts the
//           build of every entry in the queue (2026-11-22, three restarts in six minutes). A draft is marked ready only once a CI run
//           has started at its head, never in the seconds after a push. It says why it was allowed: a sev fix at either level (the sev1's named fix,
//           or a sev0's `open --allow` or `next` branch, as a sev fix is admin-merged one at a time on
//           current main), a ready pull request an open sev0 allows (no pull request is in a stack,
//           and in a sev0 the lead admin-merges ready ones in order), or, for any other, no reason is given.
//
// A bare `gh pr merge` skips the gate: on 2026-11-15 a shell line ran the grep, never read its exit
// code, and merged past a hit (field/notes/2026-11-15-admin-merge-ran-past-a-leak-grep-hit.json).
// Read through its module: `Merge.merge(...)`.
import { Array as Arr, Duration, Effect, Option, Schedule, Schema } from "effect";
import { Branches } from "./Branches.ts";
import * as Gate from "./Gate.ts";
import { PullRequests, PullRequestsError, type QueueEntry } from "./PullRequests.ts";
import * as Queue from "./Queue.ts";

/** The pull request was not merged, and nothing was asked of GitHub's merge. */
export class NotMerged extends Schema.TaggedError<NotMerged>()("NotMerged", { reason: Schema.String }) {}

/** How the lead merges: through the queue, or past it with an admin merge. */
export const Route = Schema.TaggedUnion({
  queue: {},
  admin: {
    /** Every branch an open sev0 allows (a fix or a ready pull request), and none when no sev0 is open. */
    sev0: Schema.Array(Schema.String),
    /** The ones of `sev0` that `open --allow` and `next` named, the fixes; `allow` added the rest (no pull request is in a stack, and in a sev0 the lead admin-merges ready ones in order). */
    sev0Fixes: Schema.Array(Schema.String),
    /** The one branch the sev log names as a sev1's fix now landing, or `null`. */
    sev1: Schema.NullOr(Schema.String),
  },
});

export type Route = typeof Route.Type;

type AdminRoute = typeof Route.cases.admin.Type;

export type Ask = {
  /** A checkout of the repo, to fetch the head into for the leak gate. */
  readonly dir: string;
  readonly pr: number;
  readonly route: Route;
  /** For an admin merge: mark a draft ready, and give `ci-required` this long to appear and end. Left out, a draft is refused and the check is read once. */
  readonly wait?: Queue.Wait;
  /**
   * For an admin merge of a pull request that is no sev fix and no ready pull request of a sev0: how long to
   * wait for the merge queue to empty, and the seconds between two reads. Left out, a queue with an entry refuses it.
   */
  readonly queueWait?: Queue.Wait;
};

/** What `merge` did: queued, admin-merged, or found it merged already. */
export const Done = Schema.TaggedUnion({
  queued: { pr: Schema.Number, oid: Schema.String },
  admin: {
    pr: Schema.Number,
    oid: Schema.String,
    /** Why it was allowed: a sev fix, a ready pull request in a sev0, or `other` for any other pull request (docs and tooling under the standing rule, or one the owner asked for). */
    for: Schema.Literals(["fix", "ready", "other"]),
    /** The level a fix or a ready pull request landed in; `null` for any other. */
    level: Schema.NullOr(Schema.Literals(["sev0", "sev1"])),
  },
  merged: { pr: Schema.Number, commit: Schema.String },
});

export type Done = typeof Done.Type;

/** Why the admin merge is allowed for this branch: a sev fix, a ready pull request in a sev0, or none of those. */
const adminFor = (head: string, route: AdminRoute) => {
  if (route.sev1 === head) {
    return { for: "fix" as const, level: "sev1" as const };
  }

  if (route.sev0Fixes.includes(head)) {
    return { for: "fix" as const, level: "sev0" as const };
  }

  if (route.sev0.includes(head)) {
    return { for: "ready" as const, level: "sev0" as const };
  }

  return { for: "other" as const, level: null };
};

/** How long `land.ts admin` gives `ci-required` to appear and end, and the seconds between two reads; its flags change both. */
export const ADMIN_WAIT: Queue.Wait = { minutes: 30, every: 30 };

/** The merge queue still holds an entry: a wait reads again. */
class Occupied extends Schema.TaggedError<Occupied, { readonly brand: unique symbol }>()("Occupied", {}) {}

/**
 * The entries of main's merge queue other than pull request `pr`, as the last read left them: none when
 * the queue is empty. With a wait, reads again each `every` seconds until it is empty or the wait is over, and a
 * read that failed counts as not read; a queue never read fails with the last error, never reads as empty.
 */
const queued = Effect.fn("Merge.queued")(function* (pr: number, wait: Queue.Wait | undefined) {
  const prs = yield* PullRequests;

  const others = Effect.map(
    prs.queue,
    Arr.filter((entry: QueueEntry) => entry.number !== pr),
  );

  if (wait === undefined) {
    return yield* others;
  }

  let last: ReadonlyArray<QueueEntry> | undefined;
  let failed: PullRequestsError | undefined;

  const emptied = others.pipe(
    Effect.tapError((e) =>
      Effect.sync(() => {
        failed = e;
      }),
    ),
    Effect.tap((entries) =>
      Effect.sync(() => {
        last = entries;
      }),
    ),
    Effect.filterOrFail(
      (entries) => entries.length === 0,
      () => Occupied.make(),
    ),
    Effect.retry({ schedule: Schedule.spaced(Duration.seconds(wait.every)) }),
    Effect.catchTag("Occupied", () => Effect.succeed(last ?? [])),
    Effect.timeoutOption(Duration.minutes(wait.minutes)),
  );

  const done = yield* emptied;

  if (Option.isSome(done)) {
    return done.value;
  }

  return last ?? (yield* Effect.fail(failed ?? PullRequestsError.make({ reason: "the merge queue was not read" })));
});

const admin = Effect.fn("Merge.admin")(function* (
  dir: string,
  pr: number,
  route: AdminRoute,
  wait?: Queue.Wait,
  queueWait?: Queue.Wait,
) {
  const prs = yield* PullRequests;
  let found = yield* prs.view(pr);
  const refuse = (reason: string) => new NotMerged({ reason: `pr ${found.number}: ${reason}` });

  if (found.state === "MERGED") {
    return Done.cases.merged.make({ pr: found.number, commit: found.mergeCommit ?? found.oid });
  }

  // With a wait, a draft is not refused for being a draft: it is marked ready below, after the gate.
  const marking = wait !== undefined && found.state === "OPEN" && found.draft;
  const refused = yield* Gate.before({ dir, found, marksReady: wait !== undefined });

  if (refused !== null) {
    return yield* refuse(refused);
  }

  const allowed = adminFor(found.head, route);
  // The head the gate read. Every later read of the pull request must hold the same head, or what is merged is not what was gated.
  const gated = found.oid;

  const reread = Effect.fn("Merge.reread")(function* () {
    found = yield* prs.view(pr);

    if (found.oid !== gated) {
      return yield* refuse(`its head moved from ${gated} to ${found.oid} after the gate read it; not merged`);
    }
  });

  // A merge to main moves main under the queue and restarts the build of every entry in it: any other
  // pull request waits for the queue to empty. A sev fix and a sev0's ready pull request keep the sev
  // skill's one-at-a-time rule alone, so this never slows a fix.
  if (allowed.for === "other") {
    const waiting = yield* queued(found.number, queueWait);

    if (waiting.length > 0) {
      const first = waiting[0];

      return yield* refuse(
        `pr ${first?.number} is in the merge queue (${first?.state}); an admin merge moves main and restarts its build; not merged${
          queueWait === undefined ? " (give `land.ts admin` --wait to wait for the queue to empty)" : ""
        }`,
      );
    }

    yield* reread();
  }

  // Marking a draft ready starts its real `ci-required`, which has not registered yet: the wait below
  // is what keeps the merge from running ahead of it. It starts only after the push's own CI run has,
  // so no ready event lands in the seconds after a push.
  if (marking) {
    const began = yield* Queue.startedAt(found.oid, wait, found.number).pipe(
      Effect.catchTag("Conflicting", () => refuse(Gate.conflictLine(found.number))),
    );

    if (!began) {
      return yield* refuse(Queue.notStarted(found.oid));
    }

    yield* prs.ready(found.number);
    yield* reread();
  }

  // Every admin merge, docs included, lands once ci-required is green at the head: it skips the queue,
  // never the check.
  const at = yield* Queue.required(found.oid, wait, found.number).pipe(
    Effect.catchTags({
      Conflicting: () => refuse(Gate.conflictLine(found.number)),
      Gone: (e) => refuse(`it is ${e.state}, not merged`),
    }),
  );

  // The check was read at the head the pull request held when it ended. A push during the wait moves
  // it, and the pinned squash would refuse anyway; say so here, before asking.
  if (at.oid !== found.oid) {
    return yield* refuse(`${Queue.moved(found.oid, at.oid)}; not merged`);
  }

  const read = at.job;

  if (read._tag === "None" || read.value.status !== "completed" || read.value.conclusion !== "success") {
    return yield* refuse(`${Queue.REQUIRED} is ${Queue.stands(read)} at ${found.oid}, not a success; not merged`);
  }

  // Read once more, with no wait too: a push after the check was read moves it as well.
  const now = yield* prs.view(pr);

  if (now.oid !== found.oid) {
    return yield* refuse(`${Queue.moved(found.oid, now.oid)}; not merged`);
  }

  // A fix holds main's head (a sev fix is admin-merged one at a time on current main): the next fix is tested on top of it. A ready pull request in a sev0
  // lands with no catch-up first (no pull request is in a stack, and in a sev0 the lead admin-merges ready ones in order).
  if (allowed.for === "fix") {
    const branches = yield* Branches;

    const behind = yield* branches.refresh.pipe(
      Effect.andThen(branches.behind(found.oid)),
      Effect.mapError((e) =>
        refuse(`could not tell whether ${found.oid} holds origin/main's head (${e.reason}); not merged`),
      ),
    );

    if (behind > 0) {
      return yield* refuse(
        `${found.head} is ${behind} commits behind origin/main: merge main in, push, and wait for ${Queue.REQUIRED} at the new head; not merged`,
      );
    }
  }

  yield* prs.admin(found.number, found.oid);

  return Done.cases.admin.make({ pr: found.number, oid: found.oid, for: allowed.for, level: allowed.level });
});

export const merge = Effect.fn("Merge.merge")(function* (a: Ask) {
  if (a.route._tag === "admin") {
    return yield* admin(a.dir, a.pr, a.route, a.wait, a.queueWait);
  }

  const added = yield* Queue.add({ dir: a.dir, pr: a.pr });

  return added._tag === "queued"
    ? Done.cases.queued.make({ pr: added.pr, oid: added.oid })
    : Done.cases.merged.make({ pr: added.pr, commit: added.commit });
});

/** One line for a log: what `merge` did. */
export const line = (done: Done): string =>
  Done.match(done, {
    queued: (d) => Queue.line(Queue.Added.cases.queued.make({ pr: d.pr, oid: d.oid })),
    admin: (d) =>
      `pr ${d.pr}: admin-merged at ${d.oid}${
        d.for === "other"
          ? ""
          : d.for === "fix"
            ? `, a ${d.level} fix (a sev fix is admin-merged one at a time on current main)`
            : ", a ready pull request in a sev0 (no pull request is in a stack, and in a sev0 the lead admin-merges ready ones in order)"
      }; read the push run on main next`,
    merged: (d) => `pr ${d.pr}: already merged at ${d.commit}`,
  });
