// Review: a review verdict is a record on the reviewed head (decision 0093; the plan is .kalfa/quests/review-record-PLAN.md). The record is
// a commit status with the context `review`, one per head, written by the lead and read by the merge gate. This file holds the record, its
// encodings, the rule for which paths need a review, the pure answer "is this head approved", and `record`, the write. It asks GitHub
// only through `Reviews`, and git only through `@kalfa/git`. Today's lead tooling, run on our own laptop; it is not product.
//
// The gate stops a forgotten review, not a lying lead and not a forged status: `--reviewed` is the lead's own word, and anyone with
// write access can post a status named `review`. The status keeps its `creator`; judging it is the next ticket's job.
import { CommitId } from "@kalfa/git/CommitId";
import { RefName } from "@kalfa/git/Ref";
import { NoSuchCommit, Repository } from "@kalfa/git/Repository";
import { Array as Arr, Effect, Option, Order, Predicate, Result, Schema } from "effect";
import { Branches } from "./Branches.ts";
import { PullRequests } from "./PullRequests.ts";
import { Pushes } from "./Pushes.ts";
import { Reviews, type Seen } from "./Reviews.ts";

/** The context of the status: the name 0093 gives the record. */
export const CONTEXT = "review";

/**
 * Which paths need a review: a named value, so a law draws any of it and the queue's check reads the same one.
 * `trees` are path prefixes ending "/"; `files` are exact repo paths; `names` are root-level file names with one `*`.
 */
export const Reviewed = Schema.Struct({
  trees: Schema.Array(Schema.String.check(Schema.isPattern(/^[^/].*\/$/))),
  files: Schema.Array(Schema.String.check(Schema.isPattern(/^[^/](?:.*[^/])?$/))),
  names: Schema.Array(Schema.String.check(Schema.isPattern(/^[^/*]*\*?[^/*]*$/), Schema.isNonEmpty())),
});

export type Reviewed = typeof Reviewed.Type;

/**
 * The root config files, which need a review too (the owner's ruling of 2026-11-27): a lockfile or manifest change moves what every
 * reviewed file runs on, and the lint rules, layer rules, vitest files and the check workflow are what keep the gate honest.
 */
export const ROOT_CONFIG: Reviewed = {
  trees: ["oxlint-plugins/"],
  files: ["package.json", "pnpm-lock.yaml", ".github/workflows/check.yaml", "layer-rules.json"],
  names: ["tsconfig*", "vitest*.ts"],
};

/** The two trees 0093 settles, `kalfa/` the folder and not `.kalfa/`, and the root config files. */
export const REVIEWED: Reviewed = {
  trees: ["next/", "kalfa/", ...ROOT_CONFIG.trees],
  files: [...ROOT_CONFIG.files],
  names: [...ROOT_CONFIG.names],
};

const Sha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));

/** One line, never blank, with no space at either end. U+2028 and U+2029 break a line too, and the pattern that reads a description back stops at them. */
const Line = Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isPattern(/^[^\r\n\u2028\u2029]+$/));

/** Who judged: tool, model and session, as the lead gives it. */
const Who = Line.check(Schema.isMaxLength(300));

/** 140 characters of a status description, less the 12 of `override v1 `: a reason always fits. */
export const Reason = Line.check(Schema.isMaxLength(128));

/** The record, three cases. `v` is the version. */
export const Record = Schema.TaggedUnion({
  /** Someone read the change and said yes: the first record of a review, with the wide facts. `head` is the commit the status sits on. */
  pass: {
    v: Schema.Literal(1),
    head: Sha,
    /** The head the reviewer read: `head` itself, or an ancestor of it with the same change. */
    reviewed: Sha,
    /** The merge base of `head` and main when it was recorded. */
    base: Sha,
    /** The patch id of base..head, equal to the reviewed head's. */
    patchId: Sha,
    reviewer: Who,
    ticket: Schema.NullOr(Schema.Int),
  },
  /** The same approval on a later head (a merge of main). It holds no wide facts: its status points at the first record's comment. */
  carry: {
    v: Schema.Literal(1),
    head: Sha,
    /** The head whose approval it carries. */
    from: Sha,
    reviewed: Sha,
    patchId: Sha,
  },
  /** An admin merge went past a missing verdict. It never approves anything. */
  override: { v: Schema.Literal(1), head: Sha, reason: Reason },
});

export type Record = typeof Record.Type;

/** What a status says on its own, with its state: a pass (a pass or a carry) or an override. */
export const Core = Schema.TaggedUnion({
  pass: { reviewed: Schema.String, patchId: Schema.String },
  override: { reason: Schema.String },
});

export type Core = typeof Core.Type;

/** The state and the description a record is posted as. A pass and a carry are the same bytes; an override is a `failure`. */
export const status = (r: Record): { readonly state: "success" | "failure"; readonly description: string } =>
  Record.match(r, {
    pass: (p) => ({ state: "success" as const, description: `pass v1 reviewed=${p.reviewed} patch=${p.patchId}` }),
    carry: (c) => ({ state: "success" as const, description: `pass v1 reviewed=${c.reviewed} patch=${c.patchId}` }),
    override: (o) => ({ state: "failure" as const, description: `override v1 ${o.reason}` }),
  });

const asJson = Schema.encodeSync(Schema.fromJsonString(Record));

/** The pull request comment that holds the wide facts: plain lines for a person, then the JSON of the whole record in a fenced block. */
export const comment = (r: Record): string => {
  const lines = Record.match(r, {
    pass: (p) => [
      `Review recorded on ${p.head.slice(0, 7)}: pass.`,
      `reviewed: ${p.reviewed}`,
      `reviewer: ${p.reviewer}`,
      `ticket: ${p.ticket === null ? "none" : `#${p.ticket}`}`,
      `base: ${p.base}`,
    ],
    carry: (c) => [
      `Review carried to ${c.head.slice(0, 7)} from ${c.from.slice(0, 7)}: pass.`,
      `reviewed: ${c.reviewed}`,
    ],
    override: (o) => [`Review overridden on ${o.head.slice(0, 7)}: ${o.reason}`],
  });

  return [...lines, "", "```json", asJson(r), "```", ""].join("\n");
};

const PASS = /^pass v1 reviewed=([0-9a-f]{40}) patch=([0-9a-f]{40})$/;

const OVERRIDE = /^override v1 (.+)$/;

/** What a status says, read back from its state and description; the failure says why it reads as nothing. Only a `success` reads as a pass. */
export const core = (state: string, description: string): Result.Result<Core, string> => {
  const pass = PASS.exec(description);

  if (pass !== null) {
    const [, reviewed = "", patchId = ""] = pass;

    return state === "success"
      ? Result.succeed(Core.cases.pass.make({ reviewed, patchId }))
      : Result.fail(`a pass description on a ${state} status`);
  }

  const reason = OVERRIDE.exec(description)?.[1];

  if (reason !== undefined && Schema.is(Reason)(reason)) {
    return state === "failure"
      ? Result.succeed(Core.cases.override.make({ reason }))
      : Result.fail(`an override description on a ${state} status`);
  }

  return Result.fail("the description is not one this tool wrote");
};

const named = (pattern: string, name: string): boolean => {
  const star = pattern.indexOf("*");

  if (star < 0) {
    return name === pattern;
  }

  const [front, back] = [pattern.slice(0, star), pattern.slice(star + 1)];

  return name.length >= front.length + back.length && name.startsWith(front) && name.endsWith(back);
};

/** Whether a repo path needs a review: under a tree, a file named, or a root-level file whose name fits a name. */
const needs = (reviewed: Reviewed, path: string): boolean =>
  reviewed.trees.some((tree) => path.startsWith(tree)) ||
  reviewed.files.includes(path) ||
  (!path.includes("/") && reviewed.names.some((name) => named(name, path)));

const byId = Order.mapInput(Order.Number, (s: Seen) => s.id);

/** The status that decides a head: the newest by id, whatever order GitHub listed them in. */
const newest = (seen: ReadonlyArray<Seen>): Option.Option<Seen> => Arr.last(Arr.sort(seen, byId));

/** The pass a status reads as, when it reads as one. */
const readPass = (s: Seen) => Option.filter(Result.getSuccess(s.core), Core.guards.pass);

/** The status that approves a head: the newest one, when it reads as a pass. Nothing else approves. */
const approving = (seen: ReadonlyArray<Seen>): Option.Option<Seen> =>
  Option.filter(newest(seen), (s) => Option.isSome(readPass(s)));

const Status = Schema.declare((input: unknown): input is Seen => Predicate.hasProperty(input, "core"));

/** Is this head approved? `seen` is the head's statuses with context `review`; `paths` is every path git says the pull request changes. */
export const Approval = Schema.TaggedUnion({
  exempt: {},
  approved: { seen: Status },
  missing: { reason: Schema.Literals(["none", "unreadable", "not_success", "override_only"]) },
});

export type Approval = typeof Approval.Type;

export const approval = (a: {
  readonly reviewed: Reviewed;
  readonly paths: ReadonlyArray<string>;
  readonly seen: ReadonlyArray<Seen>;
}): Approval => {
  if (!a.paths.some((path) => needs(a.reviewed, path))) {
    return Approval.cases.exempt.make({});
  }

  const decided = newest(a.seen);

  if (Option.isNone(decided)) {
    return Approval.cases.missing.make({ reason: "none" });
  }

  const read = decided.value.core;

  if (Result.isSuccess(read)) {
    return Core.guards.pass(read.success)
      ? Approval.cases.approved.make({ seen: decided.value })
      : Approval.cases.missing.make({ reason: "override_only" });
  }

  return Approval.cases.missing.make({ reason: decided.value.state === "success" ? "unreadable" : "not_success" });
};

/** What the caller asks `record` to write. A carry names no sha: the nearest approval on the head's first parents gives it. */
export const Ask = Schema.TaggedUnion({
  fresh: { reviewed: Sha, reviewer: Who, ticket: Schema.NullOr(Schema.Int) },
  carry: {},
});

export type Ask = typeof Ask.Type;

/** What `record` did: a first record, an approval carried over a merge of main, or nothing, since the head holds an approval already. */
export const Recorded = Schema.TaggedUnion({
  fresh: { head: Sha, reviewed: Sha },
  kept: { head: Sha, from: Sha, reviewed: Sha },
  already: { head: Sha },
});

export type Recorded = typeof Recorded.Type;

/** `record` wrote nothing: the reason says why, in one plain line. */
export class RecordRefused extends Schema.TaggedError<RecordRefused, { readonly brand: unique symbol }>()(
  "RecordRefused",
  { reason: Schema.String },
) {}

const refused = (reason: string) => RecordRefused.make({ reason });

const isMissing = Schema.is(NoSuchCommit);

/** A failed git call, said in one plain line. */
const gitSaid = (e: unknown): RecordRefused =>
  isMissing(e)
    ? refused(`the commit ${e.id} is not in this checkout, after fetching origin`)
    : refused(`git could not answer (${Predicate.hasProperty(e, "_tag") ? String(e._tag) : "an error"})`);

const MAIN = Schema.decodeSync(RefName)("refs/remotes/origin/main");

const commitId = (sha: string) =>
  Schema.decodeEffect(CommitId)(sha).pipe(Effect.mapError(() => refused(`${sha} is not a full commit id`)));

/** Origin's main, as the last fetch left it. */
const mainTip = Effect.fnUntraced(function* (repo: Repository["Service"]) {
  const [tip] = yield* repo.readRefs(MAIN).pipe(Effect.mapError(gitSaid));

  return tip === undefined ? yield* refused("origin/main is not in this checkout") : tip.commit;
});

/**
 * The proof that `reviewed` read the same change as `head`: it is in the head's history, and both hold some change against main and the
 * same one (one patch id of main..commit). `rangePatchId` fails when a commit has no merge base with main, or two, so an unclear base is
 * never read as one.
 */
const same = Effect.fnUntraced(function* (
  repo: Repository["Service"],
  main: CommitId,
  head: CommitId,
  reviewed: CommitId,
) {
  if (!(yield* repo.isAncestor(reviewed, head).pipe(Effect.mapError(gitSaid)))) {
    return yield* refused(`the reviewed head ${reviewed} is not in the pull request's history (was it rewritten?)`);
  }

  const read = yield* repo.rangePatchId({ upstream: main, commit: reviewed }).pipe(Effect.mapError(gitSaid));
  const now = yield* repo.rangePatchId({ upstream: main, commit: head }).pipe(Effect.mapError(gitSaid));

  if (Option.isNone(read) || Option.isNone(now)) {
    return yield* refused("the reviewed head or the head holds no change against main");
  }

  if (read.value !== now.value) {
    return yield* refused("the reviewed head and the head hold different changes");
  }

  const [base] = yield* repo.mergeBases(head, main).pipe(Effect.mapError(gitSaid));

  return base === undefined ? yield* refused("the head and main share no history") : { base, patchId: now.value };
});

/** The write is done only when the head reads as approved: a status that did not land is a refusal, never a silent pass. */
const readBack = Effect.fnUntraced(function* (reviews: Reviews["Service"], head: string) {
  if (Option.isNone(approving(yield* reviews.read(head)))) {
    return yield* refused(`the status was posted and ${head.slice(0, 12)} still reads as unapproved`);
  }
});

/**
 * Records the review of pull request `pr`, or carries it over a merge of main. A fresh record needs the head the review read; a carry
 * walks the head's first parents, only through the commits the pull request adds to main, to the nearest approval and reuses its
 * `reviewed`. Either one writes only when the two heads hold one change (the same patch id of main..head), and reads the head
 * back. A head that holds an approval already gets nothing written.
 */
export const record = Effect.fn("Review.record")(function* (a: {
  readonly dir: string;
  readonly pr: number;
  readonly ask: Ask;
}) {
  const [prs, branches, pushes, reviews, repo] = [
    yield* PullRequests,
    yield* Branches,
    yield* Pushes,
    yield* Reviews,
    yield* Repository,
  ];

  const found = yield* prs.view(a.pr);

  if (found.state !== "OPEN") {
    return yield* refused(`it is ${found.state}, not open`);
  }

  if (found.base !== "main") {
    return yield* refused(`it merges into ${found.base}, not into main`);
  }

  yield* branches.refresh;
  const head = yield* commitId(found.oid);

  if (Option.isSome(approving(yield* reviews.read(head)))) {
    return Recorded.cases.already.make({ head });
  }

  const main = yield* mainTip(repo);

  return yield* Ask.match(a.ask, {
    fresh: Effect.fnUntraced(function* (f) {
      const reviewed = yield* commitId(f.reviewed);
      const proof = yield* same(repo, main, head, reviewed);

      const pass = Record.cases.pass.make({
        v: 1,
        head,
        reviewed,
        base: proof.base,
        patchId: proof.patchId,
        reviewer: f.reviewer,
        ticket: f.ticket,
      });

      // The comment holds the reviewer's words and the whole record: one grep on all of it, before anything is posted.
      yield* pushes.leakText(a.dir, comment(pass));
      yield* reviews.write(a.pr, pass, Option.none());
      yield* readBack(reviews, head);

      return Recorded.cases.fresh.make({ head, reviewed });
    }),
    carry: Effect.fnUntraced(function* () {
      const own = yield* repo.walk({ include: [head], exclude: [main] }).pipe(Effect.mapError(gitSaid));
      const ofPr = new Map(own.map((c) => [c.id, c]));
      let at = ofPr.get(head)?.parents[0];

      // The nearest approval on the first parents, never past the commits the pull request adds to main.
      while (at !== undefined && ofPr.has(at)) {
        const found = approving(yield* reviews.read(at));
        const pass = Option.flatMap(found, readPass);

        if (Option.isSome(found) && Option.isSome(pass)) {
          const sha = pass.value.reviewed;
          const url = found.value.url;

          if (url === null) {
            return yield* refused(`the approval on ${at.slice(0, 12)} points at no comment, so it cannot be carried`);
          }

          const reviewed = yield* commitId(sha);
          const proof = yield* same(repo, main, head, reviewed);

          const carried = Record.cases.carry.make({ v: 1, head, from: at, reviewed, patchId: proof.patchId });
          yield* reviews.write(a.pr, carried, Option.some(url));
          yield* readBack(reviews, head);

          return Recorded.cases.kept.make({ head, from: at, reviewed });
        }

        at = ofPr.get(at)?.parents[0];
      }

      return yield* refused(
        "no earlier head on this branch holds an approval to carry; record a new review with --reviewed <sha> --reviewer <who>",
      );
    }),
  });
});
