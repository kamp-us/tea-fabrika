// Merge: the one way the lead merges a pull request by hand (`land.ts merge`). Every path runs the
// leak gate (./Leaks.ts) first and asks nothing of GitHub's merge when it refuses, or when the grep
// could not run. Today's lead tooling, run on our own laptop; it is not product.
//
//   queue   as Queue.add: open, ready, into main -> the leak gate -> ci-required green -> one
//           pinned squash, which adds it to the merge queue
//   admin   open, ready, into main, no `Plan:` title -> every file docs (0183), or the branch is one
//           an open sev0 allows (0532) -> the leak gate -> for a sev0 fix, ci-required green -> one
//           pinned squash with --admin, past the queue
//
// A bare `gh pr merge` skips the gate: on 2026-11-15 a shell line ran the grep, never read its exit
// code, and merged past a hit (field/notes/2026-11-15-admin-merge-ran-past-a-leak-grep-hit.json).
// Read through its module: `Merge.merge(...)`.
import * as DocsOnly from "@kalfa/ci/DocsOnly";
import { Effect, Schema } from "effect";
import { Checks } from "../ci/Checks.ts";
import * as Arm from "./Arm.ts";
import * as Leaks from "./Leaks.ts";
import { PullRequests } from "./PullRequests.ts";
import * as Queue from "./Queue.ts";

/** The pull request was not merged, and nothing was asked of GitHub's merge. */
export class NotMerged extends Schema.TaggedError<NotMerged>()("NotMerged", { reason: Schema.String }) {}

/**
 * Whether a changed file keeps a pull request docs only for the admin merge, as 0183 has it: a docs file
 * in one of the admin merge's folders, by the shared classifier's `isAdminDocs` (@kalfa/ci/DocsOnly).
 * Instruction text is not docs (0183, 0180): skill prose, AGENTS.md, CLAUDE.md and an agent's definition.
 * A README and `.patterns/` Markdown are not docs for it either, so a pull request that changes one is
 * armed, not admin-merged.
 */
export const isDocsFile = (path: string): boolean => DocsOnly.isAdminDocs(path);

/** How the lead merges: through the queue, or past it with an admin merge. */
export const Route = Schema.TaggedUnion({
  queue: {},
  /** `sev0` holds the branches an open sev0 allows, and none when no sev0 is open. */
  admin: { sev0: Schema.Array(Schema.String) },
});

export type Route = typeof Route.Type;

export type Ask = {
  /** A checkout of the repo, to fetch the head into for the leak gate. */
  readonly dir: string;
  readonly pr: number;
  readonly route: Route;
};

/** What `merge` did: queued, admin-merged, or found it merged already. */
export const Done = Schema.TaggedUnion({
  queued: { pr: Schema.Number, oid: Schema.String },
  admin: { pr: Schema.Number, oid: Schema.String, for: Schema.Literals(["docs", "sev0"]) },
  merged: { pr: Schema.Number, commit: Schema.String },
});

export type Done = typeof Done.Type;

/** Why the admin merge is allowed for this pull request, or why not. */
const adminFor = (head: string, files: ReadonlyArray<string>, sev0: ReadonlyArray<string>) => {
  const code = files.filter((path) => !isDocsFile(path));

  if (files.length > 0 && code.length === 0) {
    return { for: "docs" as const };
  }

  if (sev0.includes(head)) {
    return { for: "sev0" as const };
  }

  const shown = code.length > 5 ? [...code.slice(0, 5), `and ${code.length - 5} more`] : code;

  return {
    refused:
      files.length === 0
        ? "it changes no files, so it is not docs only; refused"
        : `not docs only (0183), and no open sev0 allows ${head} (0532); --admin refused: ${shown.join(", ")}`,
  };
};

const admin = Effect.fn("Merge.admin")(function* (dir: string, pr: number, sev0: ReadonlyArray<string>) {
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

  const allowed = adminFor(found.head, yield* prs.files(found.number), sev0);

  if ("refused" in allowed) {
    return yield* refuse(allowed.refused);
  }

  yield* Leaks.gate(dir, found);

  // A sev0 fix lands once its required checks are green (the sev skill); a docs change starts no CI.
  if (allowed.for === "sev0") {
    const required = yield* (yield* Checks).job(found.oid, Queue.REQUIRED);

    if (required._tag === "None" || required.value.conclusion !== "success") {
      const stands = required._tag === "None" ? "missing" : (required.value.conclusion ?? required.value.status);

      return yield* refuse(`${Queue.REQUIRED} is ${stands} at ${found.oid}, not a success; not merged`);
    }
  }

  yield* prs.admin(found.number, found.oid);

  return Done.cases.admin.make({ pr: found.number, oid: found.oid, for: allowed.for });
});

export const merge = Effect.fn("Merge.merge")(function* (a: Ask) {
  if (a.route._tag === "admin") {
    return yield* admin(a.dir, a.pr, a.route.sev0);
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
      `pr ${d.pr}: admin-merged at ${d.oid}, ${d.for === "docs" ? "docs only (0183)" : "a sev0 fix (0532)"}; read the push run on main next`,
    merged: (d) => `pr ${d.pr}: already merged at ${d.commit}`,
  });
