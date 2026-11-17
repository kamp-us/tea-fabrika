// PullRequestsGh.layer: the PullRequests service on `gh`, the one way the lead tooling reaches
// GitHub. `gh pr edit` fails here with a classic Projects error (AGENTS.md), so an edit goes
// through `gh api -X PATCH`. Every call names the repo, so the checkout it runs in does not pick it.
import { Effect, Layer, Option, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { type Given, lastLine, run } from "./command.ts";
import {
  type Detail,
  MergeQueue,
  Patch,
  type Pin,
  type PullRequest,
  PullRequests,
  PullRequestsError,
  type Stack,
  type Text,
} from "./PullRequests.ts";

/** The most pull requests one `all` read takes; a repo with this many fails it, never cuts it. */
export const LIMIT = 5000;

const Listed = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      number: Schema.Finite,
      headRefName: Schema.String,
      headRefOid: Schema.String,
      state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
      isDraft: Schema.Boolean,
    }),
  ),
);

const FIELDS = "number,headRefName,headRefOid,state,isDraft";

const Viewed = Schema.fromJsonString(
  Schema.Struct({
    number: Schema.Finite,
    headRefName: Schema.String,
    headRefOid: Schema.String,
    baseRefName: Schema.String,
    state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
    isDraft: Schema.Boolean,
    title: Schema.String,
    body: Schema.String,
    mergeCommit: Schema.NullOr(Schema.Struct({ oid: Schema.String })),
  }),
);

const VIEW_FIELDS = `${FIELDS},baseRefName,title,body,mergeCommit`;

/** One line of the files list as `patches` asks jq to print it. */
const PatchRow = Schema.fromJsonString(Patch);

/** One open stack as `stackRows` asks jq to print it: its layers bottom first, each with its head. */
const StackRow = Schema.fromJsonString(
  Schema.Struct({
    number: Schema.Finite,
    base: Schema.String,
    prs: Schema.Array(Schema.Struct({ number: Schema.Finite, oid: Schema.String })),
  }),
);

/** The jq that prints each open stack of `GET repos/{repo}/stacks` on a line of its own. */
const STACKS_JQ = ".[] | select(.open) | {number, base: .base.ref, prs: [.pull_requests[] | {number, oid: .head.sha}]}";

/** The merge queue rule's two sizes, read by `mergeQueue` from the rules on a branch. */
const QueueRow = Schema.fromJsonString(MergeQueue);

/** The jq that prints the `merge_queue` rule on a branch, if any, as a `MergeQueue`. */
const QUEUE_JQ =
  '.[] | select(.type == "merge_queue") | .parameters | {build: .max_entries_to_build, merge: .max_entries_to_merge}';

/**
 * The stack merge (gh-stack's `gh stack merge`): everything from the stack's bottom up to `top`, as
 * squashes, with no prompt. A stack number shares the pull requests' number sequence, so `top` is
 * never read as a stack number.
 */
const stackMergeArgs = (top: number): ReadonlyArray<string> => ["stack", "merge", String(top), "--squash", "--yes"];

/** Why a stack's layers are not at the heads that were checked, or `null` when every one is. */
export const moved = (layers: ReadonlyArray<Pin>, pinned: ReadonlyArray<Pin>): string | null => {
  const off = pinned.filter((pin) => layers.find((layer) => layer.number === pin.number)?.oid !== pin.oid);

  return off.length === 0
    ? null
    : `layers not at the head their gates read, so nothing was merged: ${off.map((pin) => `pr ${pin.number}`).join(", ")}`;
};

/**
 * The merge call that adds a pull request to the queue: a squash, pinned to the head that was
 * checked. It carries no `--admin`, no `--auto` and no other merge method (0162).
 */
export const mergeArgs = (repo: string, number: number, oid: string): ReadonlyArray<string> => [
  "pr",
  "merge",
  String(number),
  "-R",
  repo,
  "--squash",
  "--match-head-commit",
  oid,
];

/** The admin merge, pr/Merge.ts's alone (0183, 0532): the same pinned squash, past the queue. */
export const adminArgs = (repo: string, number: number, oid: string): ReadonlyArray<string> => [
  ...mergeArgs(repo, number, oid),
  "--admin",
];

/**
 * Merge when ready, as the lead turns it on (0530): a squash, and `expectedHeadOid` pins it to the
 * head that was checked, so a push after the check leaves it off.
 */
export const ARM = `mutation($id: ID!, $oid: GitObjectID!) {
  enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: SQUASH, expectedHeadOid: $oid}) {
    clientMutationId
  }
}`;

/** `owner/name` from an origin URL GitHub serves, https or ssh; `null` for any other. */
export const repoFromUrl = (url: string): string | null =>
  /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(
    url.trim(),
  )?.[1] ?? null;

/** `repo` is `owner/name`; `cwd` is any folder gh may start in. */
export const layer = (
  repo: string,
  cwd: string,
): Layer.Layer<PullRequests, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    PullRequests,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      /** One gh call; any exit but 0 fails it with gh's own last line. */
      const gh = Effect.fn("PullRequestsGh.gh")(
        function* (args: ReadonlyArray<string>, given?: Given) {
          const ran = yield* run("gh", args, cwd, given);

          if (ran.code !== 0) {
            return yield* PullRequestsError.make({
              reason: `gh ${args.slice(0, 2).join(" ")} exited ${ran.code}: ${lastLine(ran)}`,
            });
          }

          return ran.out;
        },
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(PullRequestsError.make({ reason: `gh could not start: ${e.message}` })),
        ),
      );

      const list = Effect.fn("PullRequestsGh.list")(function* (args: ReadonlyArray<string>) {
        const out = yield* gh(["pr", "list", "-R", repo, "--json", FIELDS, ...args]);

        const rows = yield* Schema.decodeEffect(Listed)(out.trim() || "[]").pipe(
          Effect.mapError(() => PullRequestsError.make({ reason: "gh pr list answered a shape we do not read" })),
        );

        return rows.map((r): PullRequest => ({
          number: r.number,
          head: r.headRefName,
          oid: r.headRefOid,
          state: r.state,
          draft: r.isDraft,
        }));
      });

      const openOn = (branch: string) =>
        Effect.map(list(["--head", branch, "--state", "open"]), (prs) =>
          Option.fromNullishOr(prs.find((pr) => pr.head === branch)),
        );

      const all = Effect.flatMap(list(["--state", "all", "--limit", String(LIMIT)]), (prs) =>
        prs.length >= LIMIT
          ? Effect.fail(PullRequestsError.make({ reason: `${LIMIT} or more pull requests: one read cannot hold all` }))
          : Effect.succeed(prs),
      );

      const draft = Effect.fn("PullRequestsGh.draft")(function* (branch: string, text: Text) {
        const args = ["--draft", "--base", "main", "--head", branch, "--title", text.title, "--body", text.body];
        const out = yield* gh(["pr", "create", "-R", repo, ...args]);
        const number = Number(/\/pull\/(\d+)/.exec(out)?.[1]);

        if (!Number.isInteger(number)) {
          return yield* PullRequestsError.make({ reason: `gh pr create named no pull request: ${out.trim()}` });
        }

        return number;
      });

      const edit = (number: number, text: Text) =>
        Effect.asVoid(
          gh([
            "api",
            "-X",
            "PATCH",
            `repos/${repo}/pulls/${number}`,
            "-f",
            `title=${text.title}`,
            "-f",
            `body=${text.body}`,
          ]),
        );

      const ready = (number: number) => Effect.asVoid(gh(["pr", "ready", String(number), "-R", repo]));

      const view = Effect.fn("PullRequestsGh.view")(function* (number: number) {
        const out = yield* gh(["pr", "view", String(number), "-R", repo, "--json", VIEW_FIELDS]);

        const v = yield* Schema.decodeEffect(Viewed)(out).pipe(
          Effect.mapError(() => PullRequestsError.make({ reason: "gh pr view answered a shape we do not read" })),
        );

        return {
          number: v.number,
          head: v.headRefName,
          oid: v.headRefOid,
          base: v.baseRefName,
          state: v.state,
          draft: v.isDraft,
          title: v.title,
          body: v.body,
          mergeCommit: v.mergeCommit?.oid ?? null,
        } satisfies Detail;
      });

      const enqueue = (number: number, oid: string) => Effect.asVoid(gh(mergeArgs(repo, number, oid)));

      // REST, paged: `gh pr view --json files` stops at 100 files.
      const files = Effect.fn("PullRequestsGh.files")(function* (number: number) {
        const out = yield* gh(["api", "--paginate", `repos/${repo}/pulls/${number}/files`, "--jq", ".[].filename"]);

        return out.split("\n").filter((path) => path !== "");
      });

      // The same paged list, one JSON line per file. GitHub leaves `patch` out for a file it will not show.
      const patches = Effect.fn("PullRequestsGh.patches")(function* (number: number) {
        const out = yield* gh([
          "api",
          "--paginate",
          `repos/${repo}/pulls/${number}/files`,
          "--jq",
          ".[] | {path: .filename, patch: (.patch // null)}",
        ]);

        return yield* Effect.forEach(
          out.split("\n").filter((row) => row !== ""),
          (row) =>
            Schema.decodeEffect(PatchRow)(row).pipe(
              Effect.mapError(() =>
                PullRequestsError.make({ reason: "gh api pulls/files answered a shape we do not read" }),
              ),
            ),
          { concurrency: "unbounded" },
        );
      });

      const arm = Effect.fn("PullRequestsGh.arm")(function* (number: number, oid: string) {
        const id = (yield* gh(["pr", "view", String(number), "-R", repo, "--json", "id", "--jq", ".id"])).trim();

        if (id === "") {
          return yield* PullRequestsError.make({ reason: `gh pr view named no node id for pull request ${number}` });
        }

        yield* gh(["api", "graphql", "-f", `query=${ARM}`, "-f", `id=${id}`, "-f", `oid=${oid}`]);
      });

      const admin = (number: number, oid: string) => Effect.asVoid(gh(adminArgs(repo, number, oid)));

      /** Each open stack of the repo, its layers bottom first, each with the head GitHub holds. */
      const stacks = Effect.fn("PullRequestsGh.stacks")(function* () {
        const out = yield* gh(["api", "--paginate", `repos/${repo}/stacks`, "--jq", STACKS_JQ]);

        return yield* Effect.forEach(
          out.split("\n").filter((row) => row !== ""),
          (row) =>
            Schema.decodeEffect(StackRow)(row).pipe(
              Effect.mapError(() =>
                PullRequestsError.make({ reason: "gh api stacks answered a shape we do not read" }),
              ),
            ),
          { concurrency: "unbounded" },
        );
      });

      const holding = (number: number) =>
        Effect.map(stacks(), (all) =>
          Option.fromUndefinedOr(all.find((stack) => stack.prs.some((pr) => pr.number === number))),
        );

      const stack = (number: number) =>
        Effect.map(
          holding(number),
          Option.map((stack): Stack => ({ ...stack, prs: stack.prs.map((pr) => pr.number) })),
        );

      const mergeQueue = Effect.fn("PullRequestsGh.mergeQueue")(function* (branch: string) {
        const out = yield* gh(["api", "--paginate", `repos/${repo}/rules/branches/${branch}`, "--jq", QUEUE_JQ]);
        const row = out.split("\n").find((line) => line !== "");

        return row === undefined
          ? Option.none()
          : Option.some(
              yield* Schema.decodeEffect(QueueRow)(row).pipe(
                Effect.mapError(() =>
                  PullRequestsError.make({ reason: `the merge_queue rule on ${branch} has a shape we do not read` }),
                ),
              ),
            );
      });

      // gh stack merge pins no head, so the layers' heads are read again right before it runs.
      const mergeStack = Effect.fn("PullRequestsGh.mergeStack")(function* (top: number, heads: ReadonlyArray<Pin>) {
        const held = yield* holding(top);

        if (Option.isNone(held)) {
          return yield* PullRequestsError.make({ reason: `pr ${top} is in no open stack now; nothing was merged` });
        }

        const off = moved(held.value.prs, heads);

        if (off !== null) {
          return yield* PullRequestsError.make({ reason: off });
        }

        yield* gh(stackMergeArgs(top), { env: { GH_REPO: repo } });
      });

      return PullRequests.of({
        openOn,
        all,
        draft,
        edit,
        ready,
        view,
        enqueue,
        files,
        patches,
        arm,
        admin,
        stack,
        mergeQueue,
        mergeStack,
      });
    }),
  );
