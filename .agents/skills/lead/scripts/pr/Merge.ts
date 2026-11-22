// Merge: the one way the lead merges a pull request by hand (`land.ts merge`). Every path runs the
// leak gate (./Leaks.ts) first and asks nothing of GitHub's merge when it refuses, or when the grep
// could not run. Today's lead tooling, run on our own laptop; it is not product.
//
//   queue   as Queue.add: open, ready, into main -> the leak gate -> ci-required green -> one
//           pinned squash, which adds it to the merge queue
//   admin   open, ready, into main, no `Plan:` title, not a `can/` branch -> the leak gate -> ci-required
//           completed and green at the head, for every admin merge; a draft is marked ready first, and
//           with `wait` the check is given that long to appear and end (`land.ts admin`) -> the head has
//           not moved since it was read -> for a sev fix, also origin/main's head in its history -> one
//           pinned squash with --admin, past the queue. "Admin" skips the queue, never a green
//           ci-required. It says why it was allowed: a sev fix at either level (the sev1's named fix,
//           or a sev0's `open --allow` or `next` branch, as a sev fix is admin-merged one at a time on
//           current main), a ready pull request an open sev0 allows (no pull request is in a stack,
//           and in a sev0 the lead admin-merges ready ones in order), or, for any other, that the owner asked.
//
// A bare `gh pr merge` skips the gate: on 2026-11-15 a shell line ran the grep, never read its exit
// code, and merged past a hit (field/notes/2026-11-15-admin-merge-ran-past-a-leak-grep-hit.json).
// Read through its module: `Merge.merge(...)`.
import { Effect, Schema } from "effect";
import * as Arm from "./Arm.ts";
import { Branches } from "./Branches.ts";
import * as Leaks from "./Leaks.ts";
import { PullRequests } from "./PullRequests.ts";
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
};

/** What `merge` did: queued, admin-merged, or found it merged already. */
export const Done = Schema.TaggedUnion({
  queued: { pr: Schema.Number, oid: Schema.String },
  admin: {
    pr: Schema.Number,
    oid: Schema.String,
    /** Why it was allowed: a sev fix, a ready pull request in a sev0, or the owner asked. */
    for: Schema.Literals(["fix", "ready", "asked"]),
    /** The level a fix or a ready pull request landed in; `null` when the owner asked. */
    level: Schema.NullOr(Schema.Literals(["sev0", "sev1"])),
  },
  merged: { pr: Schema.Number, commit: Schema.String },
});

export type Done = typeof Done.Type;

/** Why the admin merge is allowed for this branch: a sev fix, a ready pull request in a sev0, or the owner asked. */
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

  return { for: "asked" as const, level: null };
};

/** How long `land.ts admin` gives `ci-required` to appear and end, and the seconds between two reads; its flags change both. */
export const ADMIN_WAIT: Queue.Wait = { minutes: 30, every: 30 };

/** A `can/` branch is a person's own work and never merged by the lead. */
const CAN = "can/";

const admin = Effect.fn("Merge.admin")(function* (dir: string, pr: number, route: AdminRoute, wait?: Queue.Wait) {
  const prs = yield* PullRequests;
  let found = yield* prs.view(pr);
  const refuse = (reason: string) => new NotMerged({ reason: `pr ${found.number}: ${reason}` });

  if (found.state === "MERGED") {
    return Done.cases.merged.make({ pr: found.number, commit: found.mergeCommit ?? found.oid });
  }

  if (found.head.startsWith(CAN)) {
    return yield* refuse(`${found.head} is a ${CAN} branch, never merged here; not merged`);
  }

  // With a wait, a draft is not refused for being a draft: it is marked ready below, after the leak gate.
  const marking = wait !== undefined && found.state === "OPEN" && found.draft;
  const refused = Queue.refusal(marking ? { ...found, draft: false } : found) ?? Arm.refusal(found);

  if (refused !== null) {
    return yield* refuse(refused);
  }

  const allowed = adminFor(found.head, route);

  yield* Leaks.gate(dir, found);

  // Marking a draft ready starts its real `ci-required`, which has not registered yet: the wait below
  // is what keeps the merge from running ahead of it.
  if (marking) {
    yield* prs.ready(found.number);
    found = yield* prs.view(pr);
  }

  // Every admin merge, docs included, lands once ci-required is green at the head: it skips the queue,
  // never the check.
  const required = yield* Queue.requiredAt(found.oid, wait);

  if (required._tag === "None" || required.value.status !== "completed" || required.value.conclusion !== "success") {
    const stands = required._tag === "None" ? "missing" : (required.value.conclusion ?? required.value.status);

    return yield* refuse(`${Queue.REQUIRED} is ${stands} at ${found.oid}, not a success; not merged`);
  }

  // The check was read for the head that was read first. A push during the wait moves it, and the
  // pinned squash would refuse anyway; say so here, before asking.
  const now = yield* prs.view(pr);

  if (now.oid !== found.oid) {
    return yield* refuse(`its head moved from ${found.oid} to ${now.oid} while waiting; not merged`);
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
    return yield* admin(a.dir, a.pr, a.route, a.wait);
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
      `pr ${d.pr}: admin-merged at ${d.oid}, ${
        d.for === "asked"
          ? "the owner asked"
          : d.for === "fix"
            ? `a ${d.level} fix (a sev fix is admin-merged one at a time on current main)`
            : "a ready pull request in a sev0 (no pull request is in a stack, and in a sev0 the lead admin-merges ready ones in order)"
      }; read the push run on main next`,
    merged: (d) => `pr ${d.pr}: already merged at ${d.commit}`,
  });
