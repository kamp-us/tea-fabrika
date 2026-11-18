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
  type PullRequest,
  PullRequests,
  PullRequestsError,
  StackMerge,
  type Stack,
  Stack as StackSchema,
  type StackSelection,
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
const StackRow = Schema.fromJsonString(StackSchema);

/** The jq that prints each open stack of `GET repos/{repo}/stacks` on a line of its own. */
const STACKS_JQ = ".[] | select(.open) | {number, base: .base.ref, prs: [.pull_requests[] | {number, oid: .head.sha}]}";

/** The merge queue rule, read by `mergeQueue` from the rules on a branch. */
const QueueRow = Schema.fromJsonString(MergeQueue);

/** The jq that prints the merge queue rule, including its configured merge method. */
const QUEUE_JQ =
  '.[] | select(.type == "merge_queue") | .parameters | {build: .max_entries_to_build, merge: .max_entries_to_merge, method: .merge_method}';

/**
 * The result of GitHub's async merge request. Details are optional because queued and failed replies
 * have different fields; each status checks the fields it needs before it is trusted.
 */
const MergeReply = Schema.fromJsonString(
  Schema.Struct({
    status: Schema.Literals(["merged", "enqueued", "pending", "failed"]),
    details: Schema.optional(
      Schema.Struct({
        message: Schema.optional(Schema.String),
        sha: Schema.optional(Schema.String),
        uuid: Schema.optional(Schema.String),
        merge_action: Schema.optional(Schema.Literals(["default", "direct_merge", "merge_queue"])),
        merge_method: Schema.optional(Schema.Literals(["merge", "squash", "rebase"])),
        expected_head_sha: Schema.optional(Schema.String),
        bypass_rules: Schema.optional(Schema.Boolean),
      }),
    ),
  }),
);

const Compared = Schema.fromJsonString(Schema.Struct({ mergeBase: Schema.NullOr(Schema.String) }));

/** The selected open prefix must still hold the same ordered heads, stack identity and base. */
const prefixMoved = (
  held: Stack,
  selection: StackSelection,
  prefix: ReadonlyArray<Stack["prs"][number]>,
  current: ReadonlyArray<Detail>,
): string | null => {
  if (held.number !== selection.number || held.base !== selection.base) {
    return "the stack identity or base changed after its gates; nothing was merged";
  }

  const top = selection.layers.at(-1);
  const pinsMatchViews =
    prefix.length > 0 &&
    prefix.length === current.length &&
    prefix.every((pin, index) => pin.number === current[index]?.number && pin.oid === current[index]?.oid);
  const expected = selection.layers
    .filter((layer) => layer.state === "OPEN")
    .map(({ number, oid }) => ({ number, oid }));
  const actual = current.filter((layer) => layer.state === "OPEN").map(({ number, oid }) => ({ number, oid }));
  const sameOpenPrefix =
    expected.length > 0 &&
    actual.length === expected.length &&
    expected.every((pin, index) => pin.number === actual[index]?.number && pin.oid === actual[index]?.oid);
  const endsAtSelectedTop = top !== undefined && prefix.at(-1)?.number === top.number;

  return pinsMatchViews && sameOpenPrefix && endsAtSelectedTop
    ? null
    : "the selected stack prefix changed after its gates; nothing was merged";
};

/** Every field the stack gates read must still describe the same selected layer. */
const layerMoved = (held: Detail, expected: Detail): boolean =>
  held.number !== expected.number ||
  held.head !== expected.head ||
  held.oid !== expected.oid ||
  held.base !== expected.base ||
  held.state !== expected.state ||
  held.draft !== expected.draft ||
  held.title !== expected.title ||
  held.body !== expected.body ||
  held.mergeCommit !== expected.mergeCommit;

/** Open children target their parent branch; a merged parent may already be retargeted to the stack base. */
const linkRefusal = (selection: StackSelection): string | null => {
  const broken = selection.layers.find((layer, index) => {
    const parent = selection.layers[index - 1];

    return parent === undefined
      ? layer.base !== selection.base
      : layer.base !== parent.head && !(parent.state === "MERGED" && layer.base === selection.base);
  });

  return broken === undefined
    ? null
    : `pr ${broken.number} targets ${broken.base}, not its stack base or parent branch; nothing was merged`;
};

const mergeRequest = (repo: string, top: Detail, action: "direct_merge" | "merge_queue") => ({
  args: ["api", "-X", "PUT", `repos/${repo}/pulls/${top.number}/merge-async`, "--input", "-"],
  body:
    action === "merge_queue"
      ? { sha: top.oid, merge_action: action }
      : { sha: top.oid, merge_action: action, merge_method: "squash" },
});

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

      const draft = Effect.fn("PullRequestsGh.draft")(
        function* (branch: string, text: Text, head: string) {
          let out;

          if (branch.startsWith("fabrikalfa/")) {
            const ran = yield* run(
              "node",
              [`${import.meta.dirname}/../botpush.mjs`, "--draft", repo, branch, head],
              cwd,
              {
                stdin: JSON.stringify(text),
              },
            );

            if (ran.code !== 0) {
              return yield* PullRequestsError.make({ reason: `bot draft exited ${ran.code}: ${lastLine(ran)}` });
            }

            out = ran.out;
          } else {
            out = yield* gh([
              "pr",
              "create",
              "-R",
              repo,
              "--draft",
              "--base",
              "main",
              "--head",
              branch,
              "--title",
              text.title,
              "--body",
              text.body,
            ]);
          }

          const number = Number(/\/pull\/(\d+)/.exec(out)?.[1]);

          if (!Number.isInteger(number)) {
            return yield* PullRequestsError.make({ reason: "draft publication named no pull request" });
          }

          return number;
        },
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", () =>
          Effect.fail(PullRequestsError.make({ reason: "bot draft could not start" })),
        ),
      );

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
          Option.map((stack): Stack => stack),
        );

      const mergeQueue = Effect.fn("PullRequestsGh.mergeQueue")(function* (branch: string) {
        const out = yield* gh(["api", "--paginate", `repos/${repo}/rules/branches/${branch}`, "--jq", QUEUE_JQ]);
        const rows = out.split("\n").filter((line) => line !== "");

        if (rows.length > 1) {
          return yield* PullRequestsError.make({
            reason: `the merge_queue rules on ${branch} are ambiguous; nothing was merged`,
          });
        }

        const row = rows[0];

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

      const compare = Effect.fn("PullRequestsGh.compare")(function* (parent: Detail, parentOid: string, child: Detail) {
        const out = yield* gh([
          "api",
          `repos/${repo}/compare/${parentOid}...${child.oid}`,
          "--jq",
          "{mergeBase: .merge_base_commit.sha}",
        ]);

        return yield* Schema.decodeEffect(Compared)(out).pipe(
          Effect.mapError(() =>
            PullRequestsError.make({
              reason: `GitHub could not confirm pr ${parent.number} is an ancestor of pr ${child.number}`,
            }),
          ),
        );
      });

      const mergeStack = Effect.fn("PullRequestsGh.mergeStack")(function* (selection: StackSelection) {
        const top = selection.layers.at(-1);

        if (top === undefined || top.state !== "OPEN" || top.draft) {
          return yield* PullRequestsError.make({
            reason: "the selected stack top is not open and ready; nothing was merged",
          });
        }

        const linkProblem = linkRefusal(selection);

        if (linkProblem !== null) {
          return yield* PullRequestsError.make({ reason: linkProblem });
        }

        const held = yield* holding(top.number);

        if (Option.isNone(held)) {
          return yield* PullRequestsError.make({
            reason: `pr ${top.number} is in no open stack now; nothing was merged`,
          });
        }

        const topAt = held.value.prs.findIndex((layer) => layer.number === top.number);

        if (topAt === -1) {
          return yield* PullRequestsError.make({ reason: `pr ${top.number} left its stack; nothing was merged` });
        }

        const prefix = held.value.prs.slice(0, topAt + 1);
        const heldLayers = yield* Effect.forEach(prefix, (layer) => view(layer.number), {
          concurrency: "unbounded",
        });
        const offPin = prefix.filter((pin, index) => heldLayers[index]?.oid !== pin.oid);

        if (offPin.length > 0) {
          return yield* PullRequestsError.make({
            reason: "a selected stack head changed while GitHub's stack list was reread; nothing was merged",
          });
        }

        const off = prefixMoved(held.value, selection, prefix, heldLayers);

        if (off !== null) {
          return yield* PullRequestsError.make({ reason: off });
        }

        const current = yield* Effect.forEach(selection.layers, (layer) => view(layer.number), {
          concurrency: "unbounded",
        });
        const changed = selection.layers.filter((layer, index) => {
          const actual = current[index];

          return actual === undefined || layerMoved(actual, layer);
        });

        if (changed.length > 0) {
          return yield* PullRequestsError.make({
            reason: `selected pull requests changed after their gates (${changed.map((layer) => layer.number).join(", ")}); nothing was merged`,
          });
        }

        for (const [index, child] of selection.layers.slice(1).entries()) {
          const parent = selection.layers[index];

          if (parent === undefined) {
            return yield* PullRequestsError.make({
              reason: "the selected stack parent is missing; nothing was merged",
            });
          }

          const retargeted = parent.state === "MERGED" && child.base === selection.base;
          const parentOid = retargeted ? parent.mergeCommit : parent.oid;

          if ((child.base !== parent.head && !retargeted) || parentOid === null) {
            return yield* PullRequestsError.make({
              reason: `pr ${child.number} no longer targets a current parent or stack base; nothing was merged`,
            });
          }

          const ancestry = yield* compare(parent, parentOid, child);

          if (ancestry.mergeBase !== parentOid) {
            return yield* PullRequestsError.make({
              reason: `pr ${parent.number} is not the pinned ancestor of pr ${child.number}; nothing was merged`,
            });
          }
        }

        const queue = yield* mergeQueue(selection.base);
        let action: "direct_merge" | "merge_queue";

        if (Option.isSome(queue)) {
          if (queue.value.method !== "SQUASH") {
            return yield* PullRequestsError.make({
              reason: `the ${selection.base} merge queue is configured for ${queue.value.method}, not SQUASH; nothing was merged`,
            });
          }

          action = "merge_queue";
        } else {
          action = "direct_merge";
        }

        const request = mergeRequest(repo, top, action);
        const raw = yield* gh(request.args, { stdin: JSON.stringify(request.body) });
        const reply = yield* Schema.decodeEffect(MergeReply)(raw).pipe(
          Effect.mapError(() =>
            PullRequestsError.make({ reason: "GitHub answered the stack merge request in a shape we do not read" }),
          ),
        );

        if (reply.status === "failed") {
          return yield* PullRequestsError.make({
            reason: `GitHub's stack merge request failed: ${reply.details?.message ?? "no reason returned"}`,
          });
        }

        if (reply.status === "enqueued") {
          if (action !== "merge_queue") {
            return yield* PullRequestsError.make({
              reason: "GitHub reported a queued stack merge for a direct request; nothing was reported as merged",
            });
          }

          return StackMerge.cases.enqueued.make({});
        }

        if (reply.status === "pending") {
          const details = reply.details;

          if (
            details?.uuid === undefined ||
            details.uuid === "" ||
            details.expected_head_sha !== top.oid ||
            details.merge_action !== action ||
            details.merge_method !== "squash" ||
            details.bypass_rules !== false
          ) {
            return yield* PullRequestsError.make({
              reason:
                "GitHub's pending stack merge did not match the pinned squash request; nothing was reported as merged",
            });
          }

          return StackMerge.cases.pending.make({ uuid: details.uuid });
        }

        const commit = reply.details?.sha;

        if (commit === undefined || commit === "") {
          return yield* PullRequestsError.make({
            reason: "GitHub reported a merged stack without its merge commit; nothing was reported as merged",
          });
        }

        const after = yield* Effect.forEach(selection.layers, (layer) => view(layer.number), {
          concurrency: "unbounded",
        });
        const notMerged = selection.layers.filter((layer, index) => {
          const actual = after[index];

          return (
            actual === undefined ||
            actual.number !== layer.number ||
            actual.oid !== layer.oid ||
            actual.state !== "MERGED"
          );
        });

        if (notMerged.length > 0 || after.at(-1)?.mergeCommit !== commit) {
          return yield* PullRequestsError.make({
            reason: "GitHub reported a merged stack but the selected layers did not all report merged at that commit",
          });
        }

        return StackMerge.cases.merged.make({ commit });
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
