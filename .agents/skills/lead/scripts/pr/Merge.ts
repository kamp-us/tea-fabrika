// Merge: the one way the lead merges a pull request by hand (`land.ts merge`). Every path runs the
// leak gate (./Leaks.ts) first and asks nothing of GitHub's merge when it refuses, or when the grep
// could not run. Today's lead tooling, run on our own laptop; it is not product.
//
//   queue   as Queue.add: open, ready, into main -> the leak gate -> ci-required green -> one
//           pinned squash, which adds it to the merge queue
//   admin   the lead's route for every ready pull request (0603): open, ready, into main, no
//           `Plan:` title -> the leak gate -> each new exported name under `## New names` (0587)
//           -> every file docs (0183), or ci-required green at the head -> one pinned squash with
//           --admin, past the queue
//
// A bare `gh pr merge` skips the gate: on 2026-11-15 a shell line ran the grep, never read its exit
// code, and merged past a hit (field/notes/2026-11-15-admin-merge-ran-past-a-leak-grep-hit.json).
// Read through its module: `Merge.merge(...)`.
import { Effect, Schema } from "effect";
import { Checks } from "../ci/Checks.ts";
import * as Arm from "./Arm.ts";
import * as Leaks from "./Leaks.ts";
import * as Names from "./Names.ts";
import { PullRequests } from "./PullRequests.ts";
import * as Queue from "./Queue.ts";

/** The pull request was not merged, and nothing was asked of GitHub's merge. */
export class NotMerged extends Schema.TaggedError<NotMerged>()("NotMerged", { reason: Schema.String }) {}

/**
 * Whether a changed file keeps a pull request docs only, as 0183 has it: Markdown in a docs folder,
 * or a field row. A script, a config or a `package.json` under `docs/` is not.
 */
export const isDocsFile = (path: string): boolean =>
  Arm.isDocs(path) && (path.endsWith(".md") || path.startsWith("field/"));

/** How the lead merges: past the queue with an admin merge (0603), or through the queue. */
export const Route = Schema.TaggedUnion({
  queue: {},
  admin: {},
});

export type Route = typeof Route.Type;

export type Ask = {
  /** A checkout of the repo, to fetch the head into for the leak gate. */
  readonly dir: string;
  readonly pr: number;
  readonly route: Route;
};

/**
 * What `merge` did: queued, admin-merged, or found it merged already. An admin merge says what let
 * it land: `docs`, a change of only words, which starts no CI (0183); `green`, `ci-required` a
 * success at the head that was merged.
 */
export const Done = Schema.TaggedUnion({
  queued: { pr: Schema.Number, oid: Schema.String },
  admin: { pr: Schema.Number, oid: Schema.String, for: Schema.Literals(["docs", "green"]) },
  merged: { pr: Schema.Number, commit: Schema.String },
});

export type Done = typeof Done.Type;

/** Whether every file is docs (0183): such a change starts no CI, so it lands on the lead's read. */
const docsOnly = (files: ReadonlyArray<string>): boolean => files.length > 0 && files.every(isDocsFile);

const admin = Effect.fn("Merge.admin")(function* (dir: string, pr: number) {
  const prs = yield* PullRequests;
  const found = yield* prs.view(pr);
  const refuse = (reason: string) => new NotMerged({ reason: `pr ${found.number}: ${reason}` });

  if (found.state === "MERGED") {
    return Done.cases.merged.make({ pr: found.number, commit: found.mergeCommit ?? found.oid });
  }

  const refused = Queue.refusal(found) ?? Arm.refusal(found);

  if (refused !== null) {
    return yield* refuse(refused);
  }

  const files = yield* prs.files(found.number);

  if (files.length === 0) {
    return yield* refuse("it changes no files; refused");
  }

  yield* Leaks.gate(dir, found);

  const unnamed = Names.refusal(found.body, yield* prs.patches(found.number));

  if (unnamed !== null) {
    return yield* refuse(unnamed);
  }

  const docs = docsOnly(files);

  if (!docs) {
    const required = yield* (yield* Checks).job(found.oid, Queue.REQUIRED);

    if (required._tag === "None" || required.value.conclusion !== "success") {
      const stands = required._tag === "None" ? "missing" : (required.value.conclusion ?? required.value.status);

      return yield* refuse(`${Queue.REQUIRED} is ${stands} at ${found.oid}, not a success; not merged`);
    }
  }

  yield* prs.admin(found.number, found.oid);

  return Done.cases.admin.make({ pr: found.number, oid: found.oid, for: docs ? "docs" : "green" });
});

export const merge = Effect.fn("Merge.merge")(function* (a: Ask) {
  if (a.route._tag === "admin") {
    return yield* admin(a.dir, a.pr);
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
      `pr ${d.pr}: admin-merged at ${d.oid}, ${d.for === "docs" ? "docs only (0183)" : `${Queue.REQUIRED} green (0603)`}; read the push run on main next`,
    merged: (d) => `pr ${d.pr}: already merged at ${d.commit}`,
  });
