// Publish: a commit leaves the laptop the moment it is made, and its branch has a pull request from
// its first commit (every commit is pushed when it is made, with a draft pull request from the first commit). Today's lead tooling, run on our own laptop; it is not product.
//
//   publish   leak grep on origin/main..head, fail closed -> push, never forced -> the branch's open
//             pull request, or a new draft when it has none; a title or body given on the command line
//             is leak-grepped too, and sets the title and body of an open pull request (its draft state stays)
//   ready     publish, then the pull request's title and description from the quest brief, then
//             marked ready: a quest's steps have passed
//
// The commit step runs `publish` after each signed commit; a quest's host part runs it after each
// step's commit comes out of the box, and `ready` where the quest used to open its pull request.
// Read through its module: `Publish.publish(...)`.
import { Effect, Schema } from "effect";
import { words as squashWords } from "./Leaks.ts";
import { PullRequests, type Text } from "./PullRequests.ts";
import { Pushes } from "./Pushes.ts";

/** What a draft says when a commit opens it; the quest's ready step gives it the brief's words. */
export const DRAFT_BODY =
  "Opened as a draft at this branch's first commit, so no code stays only on a branch (every commit " +
  "is pushed when it is made). It is marked ready when its steps have passed.";

/** What `publish.ts` was asked: the branch, and the words a new draft takes instead of the placeholder. */
export type Words = {
  readonly branch: string;
  readonly title: string | null;
  readonly bodyFile: string | null;
};

/**
 * Read `<branch> [--title <title>] [--body-file <path>]`, the flags in any order and each at most once, or
 * `null` for anything else: no branch, two, an unknown flag, a flag with no value.
 */
export const words = (args: ReadonlyArray<string>): Words | null => {
  const take = (
    rest: ReadonlyArray<string>,
    got: { branch: string | null; title: string | null; bodyFile: string | null },
  ): Words | null => {
    const [head, value, ...more] = rest;

    if (head === undefined) {
      return got.branch === null ? null : { ...got, branch: got.branch };
    }

    if (head === "--title" || head === "--body-file") {
      const field = head === "--title" ? "title" : "bodyFile";

      return value === undefined || value === "" || value.startsWith("--") || got[field] !== null
        ? null
        : take(more, { ...got, [field]: value });
    }

    return head.startsWith("--") || got.branch !== null ? null : take(rest.slice(1), { ...got, branch: head });
  };

  return take(args, { branch: null, title: null, bodyFile: null });
};

/** What a new draft says: the title and body it was given, else the commit's subject and the placeholder. */
export const draftText = (subject: string, asked: Words, body: string | null): Text => ({
  title: asked.title ?? subject,
  body: body ?? DRAFT_BODY,
});

/** A branch no commit step pushes to: main, or none (a detached head). */
export class NoBranch extends Schema.TaggedError<NoBranch, { readonly brand: unique symbol }>()("NoBranch", {
  reason: Schema.String,
}) {}

/** What one publish did: the branch's pull request, whether this publish opened it, and if a draft. `edited` is there only when it rewrote an open pull request's title or body. */
export type Published = {
  readonly pr: number;
  readonly opened: boolean;
  readonly draft: boolean;
  readonly edited?: true;
};

export type Ask = {
  /** The checkout the commit is in. */
  readonly dir: string;
  readonly branch: string;
  /** The exact commit SHA to push and use when opening a draft. */
  readonly head: string;
  /** What a new draft says. A pull request already open keeps its own words, except for those in `given`. */
  readonly text: Text;
  /** The title and the body that were asked for by name. A part left out stays as the open pull request has it. */
  readonly given?: Partial<Text>;
  /**
   * The branch the checkout in `dir` is on, when HEAD is what gets pushed (`publish.ts`). When it is not `branch`, the
   * publish is refused before any push. A caller that pushes an exact SHA from elsewhere (drive's box) leaves it out.
   */
  readonly checkedOut?: string;
};

const checked = (branch: string) =>
  branch === "" || branch === "HEAD"
    ? Effect.fail(NoBranch.make({ reason: "HEAD is detached, so there is no branch to push" }))
    : branch === "main" || branch === "refs/heads/main"
      ? Effect.fail(NoBranch.make({ reason: "a commit step never pushes to main" }))
      : Effect.succeed(branch);

export const publish = Effect.fn("Publish.publish")(function* (a: Ask) {
  const branch = yield* checked(a.branch);

  if (a.checkedOut !== undefined && a.checkedOut !== branch) {
    return yield* NoBranch.make({
      reason:
        `this checkout is on ${a.checkedOut === "" ? "no branch (detached HEAD)" : a.checkedOut}, not ${branch}, ` +
        `so its HEAD does not belong on ${branch}; run publish.ts from ${branch}'s worktree (\`git worktree list\` shows it)`,
    });
  }

  const pushes = yield* Pushes;
  const prs = yield* PullRequests;
  yield* pushes.leakGrep(a.dir, a.head);

  const given = a.given !== undefined && (a.given.title !== undefined || a.given.body !== undefined) ? a.given : null;

  if (given !== null) {
    yield* pushes.leakText(a.dir, squashWords({ title: given.title ?? "", body: given.body ?? "" }));
  }

  yield* pushes.push(a.dir, branch, a.head);
  const open = yield* prs.openOn(branch);

  if (open._tag === "Some") {
    const number = open.value.number;

    if (given === null) {
      return { pr: number, opened: false, draft: open.value.draft } satisfies Published;
    }

    // `edit` sets both fields, so a part that was not given is read back from the pull request.
    const now = yield* prs.view(number);
    yield* prs.edit(number, { title: given.title ?? now.title, body: given.body ?? now.body });

    return { pr: number, opened: false, draft: open.value.draft, edited: true } satisfies Published;
  }

  const pr = yield* prs.draft(branch, a.text, a.head);

  return { pr, opened: true, draft: true } satisfies Published;
});

/** The quest's steps passed: push its head, give its pull request the brief's words, mark it ready. */
export const ready = Effect.fn("Publish.ready")(function* (a: Ask) {
  const published = yield* publish(a);
  const prs = yield* PullRequests;
  yield* prs.edit(published.pr, a.text);

  if (published.draft) {
    yield* prs.ready(published.pr);
  }

  return { ...published, draft: false } satisfies Published;
});

/** One line for a log: what the publish did, with the pull request's number. */
export const line = (branch: string, p: Published): string =>
  p.opened
    ? `pushed ${branch} and opened draft PR ${p.pr}`
    : p.edited === true
      ? `pushed ${branch}; PR ${p.pr} was already open, and its title and body are updated`
      : `pushed ${branch}; PR ${p.pr} was already open`;
