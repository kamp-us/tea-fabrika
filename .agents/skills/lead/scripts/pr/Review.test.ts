// Today's lead tooling. The review record's laws (./Review.ts; the plan is .kalfa/quests/review-record-PLAN.md, slice 1): which paths need a
// review and when a head is approved (R1), the record on the wire (R2), the carry rule and the write (R3), the leak gate on the record's
// words (R4) and the record's types (T1). All on the test layers and `@kalfa/git/memory`: nothing here asks GitHub, git or the leak grep.
import { createHash } from "node:crypto";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import * as Commit from "@kalfa/git/Commit";
import { CommitId } from "@kalfa/git/CommitId";
import * as MemoryRepository from "@kalfa/git/memory";
import * as Ref from "@kalfa/git/Ref";
import * as Settings from "@kalfa/git/Settings";
import * as Tree from "@kalfa/git/Tree";
import { Recorder, runsFor } from "@kampus/vitest";
import { Arbitrary, Effect, Layer, Result, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as BranchesTest from "./BranchesTest.ts";
import * as PullRequestsTest from "./PullRequestsTest.ts";
import { LeakGrepRefused, Pushes } from "./Pushes.ts";
import * as Review from "./Review.ts";
import type { Seen } from "./Reviews.ts";
import * as ReviewsTest from "./ReviewsTest.ts";

/** A 40-character lowercase hex id made from a number, so two numbers make two ids. */
const hex = (n: number): string => createHash("sha1").update(`h${n}`).digest("hex");

const seenStatus = (id: number, state: string, description: string, creator = "lead"): Seen => ({
  id,
  creator,
  state,
  core: Review.core(state, description),
  url: null,
});

// ---------------------------------------------------------------------------------------------------------
// R1: which paths need a review, and when a head is approved
// ---------------------------------------------------------------------------------------------------------

const TREES = ["next/", "kalfa/", "apps/web/", "oxlint-plugins/"] as const;

const FILES = [
  "package.json",
  "pnpm-lock.yaml",
  ".github/workflows/check.yaml",
  "layer-rules.json",
  "docs/guide.md",
] as const;

const NAMES = ["tsconfig*", "vitest*.ts", "*.lock", "exact.name", "Makefile"] as const;

const REST = ["x", "a/b.ts", "deep/er/file.md"] as const;

const OTHER = [
  ".kalfa/x",
  "packages/x/package.json",
  "kalfa-x/y",
  "kalfa.md",
  "README.md",
  "docs/tsconfig.json",
] as const;

/** Each way a drawn path stands to the drawn value, and whether the rule says it needs a review: the near misses are the point. */
const PATH_KINDS = {
  inTree: true,
  treeDepth: false,
  treeLookalike: false,
  treeBare: false,
  file: true,
  fileDepth: false,
  fileLookalike: false,
  nameRoot: true,
  nameFill: true,
  nameDepth: false,
  nameLookalike: false,
  other: false,
} as const;

type PathKind = keyof typeof PATH_KINDS;

const PathSpec = Schema.Struct({
  // SAFETY: the keys of the table are its own `PathKind`s.
  kind: Schema.Literals(Object.keys(PATH_KINDS) as ReadonlyArray<PathKind>),
  t: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9 })),
  rest: Schema.Literals(REST),
});

const KINDS = [
  "pass",
  "passFailure",
  "passError",
  "passPending",
  "override",
  "overrideSuccess",
  "v2",
  "shortSha",
  "upperSha",
  "missingField",
  "extraWords",
  "trailingBreak",
  "emptyReason",
  "longReason",
  "lineBreak",
] as const;

type Kind = (typeof KINDS)[number];

/** What each kind of status says, and why a head it is newest on is not approved (`null`: either reading is fair, so none is asserted). */
const KIND_WHY: Record<Kind, "approved" | "override_only" | "not_success" | "unreadable" | null> = {
  pass: "approved",
  passFailure: "not_success",
  passError: "not_success",
  passPending: "not_success",
  override: "override_only",
  overrideSuccess: "unreadable",
  v2: "unreadable",
  shortSha: "unreadable",
  upperSha: "unreadable",
  missingField: "unreadable",
  extraWords: "unreadable",
  trailingBreak: "unreadable",
  emptyReason: null,
  longReason: null,
  lineBreak: null,
};

const said = (kind: Kind, n: number): { readonly state: string; readonly description: string } => {
  const [rev, patch] = [hex(n), hex(n + 1)];
  const good = `pass v1 reviewed=${rev} patch=${patch}`;

  switch (kind) {
    case "pass":
      return { state: "success", description: good };
    case "passFailure":
      return { state: "failure", description: good };
    case "passError":
      return { state: "error", description: good };
    case "passPending":
      return { state: "pending", description: good };
    case "override":
      return { state: "failure", description: "override v1 sev1 fix for the red main" };
    case "overrideSuccess":
      return { state: "success", description: "override v1 sev1 fix for the red main" };
    case "v2":
      return { state: "success", description: `pass v2 reviewed=${rev} patch=${patch}` };
    case "shortSha":
      return { state: "success", description: `pass v1 reviewed=${rev.slice(1)} patch=${patch}` };
    case "upperSha":
      return { state: "success", description: `pass v1 reviewed=${rev.toUpperCase()} patch=${patch}` };
    case "missingField":
      return { state: "success", description: `pass v1 reviewed=${rev}` };
    case "extraWords":
      return { state: "success", description: `${good} and more words` };
    case "trailingBreak":
      return { state: "success", description: `${good}\n` };
    case "emptyReason":
      return { state: "failure", description: "override v1 " };
    case "longReason":
      return { state: "failure", description: `override v1 ${"a".repeat(129)}` };
    default:
      return { state: "failure", description: "override v1 a\nb" };
  }
};

const subset = <A extends string>(values: ReadonlyArray<A>) =>
  Schema.Array(Schema.Literals(values)).check(Schema.isMaxLength(3));

const Approvable = Schema.Struct({
  trees: subset(TREES),
  files: subset(FILES),
  names: subset(NAMES),
  paths: Schema.Array(PathSpec).check(Schema.isMaxLength(4)),
  statuses: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(KINDS),
      id: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9 })),
      creator: Schema.Literals(["lead", "a-bot", "someone-else"]),
    }),
  ).check(Schema.isMaxLength(5)),
});

const escaped = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The rule written another way, as regular expressions: a tree is a prefix, a file is the whole path, a name is a root-level name with `*` as any run of non-slash characters. */
const needsReview = (r: Review.Reviewed, path: string): boolean =>
  r.trees.some((t) => new RegExp(`^${escaped(t)}`).test(path)) ||
  r.files.some((f) => new RegExp(`^${escaped(f)}$`).test(path)) ||
  r.names.some((n) => new RegExp(`^${n.split("*").map(escaped).join("[^/]*")}$`).test(path));

const resolve = (c: typeof Approvable.Type) => {
  const reviewed: Review.Reviewed = { trees: c.trees, files: c.files, names: c.names };

  const [trees, files, names] = [
    c.trees.length > 0 ? c.trees : TREES,
    c.files.length > 0 ? c.files : FILES,
    c.names.length > 0 ? c.names : NAMES,
  ];

  // SAFETY: every list passed is non-empty and the index is taken modulo its length.
  const at = <A>(xs: ReadonlyArray<A>, t: number): A => xs[t % xs.length] as A;
  const fill = (name: string, by: string) => name.replace("*", by);

  const paths = c.paths.map((p) => {
    const [tree, file, name] = [at(trees, p.t), at(files, p.t), at(names, p.t)];

    const path: Record<PathKind, string> = {
      inTree: `${tree}${p.rest}`,
      treeDepth: `docs/${tree}${p.rest}`,
      treeLookalike: `${tree.slice(0, -1)}ra/${p.rest}`,
      treeBare: tree.slice(0, -1),
      file,
      fileDepth: `sub/${file}`,
      fileLookalike: `${file}.bak`,
      nameRoot: fill(name, ""),
      nameFill: fill(name, "x.y"),
      nameDepth: `docs/${fill(name, "x.y")}`,
      nameLookalike: `x${fill(name, "q")}x`,
      other: at(OTHER, p.t),
    };

    // A near miss of a tree means something only when the value lists a tree; the same for a file and a name.
    const listed =
      p.kind.startsWith("tree") || p.kind === "inTree"
        ? c.trees.length > 0
        : p.kind.startsWith("file")
          ? c.files.length > 0
          : p.kind.startsWith("name")
            ? c.names.length > 0
            : true;

    return { kind: p.kind, path: path[p.kind], listed };
  });

  const seen = c.statuses.map((s, i) => {
    const n = s.id * 100 + i;
    const { state, description } = said(s.kind, n);

    return { kind: s.kind, id: n, seen: seenStatus(n, state, description, s.creator) };
  });

  return { reviewed, paths, seen };
};

const R1_LAW = { arbitrary: { seed: 1001, runs: runsFor({ fast: 600, full: 1200 }) } };

/** What a drawn case reaches: each path kind with whether the rule needs it, and each kind of status that decides a head. */
const reaches = (c: typeof Approvable.Type): ReadonlyArray<string> => {
  const { reviewed, paths, seen } = resolve(c);

  const newest = seen.reduce<(typeof seen)[number] | undefined>(
    (a, s) => (a === undefined || s.id > a.id ? s : a),
    undefined,
  );

  const hit = paths.some((p) => needsReview(reviewed, p.path));

  return [
    ...paths.map((p) => (p.listed ? `${p.kind}:${needsReview(reviewed, p.path)}` : `${p.kind} unlisted`)),
    hit ? (newest === undefined ? "needs, no status" : `newest ${newest.kind}`) : "needs nothing",
    ...(seen.length > 1 ? ["several statuses"] : []),
  ];
};

describe("R1: which paths need a review, and when a head is approved (slice 1, pure)", () => {
  // Plants, each run once and restored: match a tree by `includes`, so `docs/next/x` needs a review; let a root name match at depth, so
  // `docs/tsconfig.json` needs one; ignore the value's `files` or `names`; accept a pass description on a `failure` or `error` status;
  // accept an override description on `success`; accept a text that fails to decode; count an `override`; let the oldest status decide,
  // or the first listed; ask for two good statuses before approving.
  it.prop(
    "R1 property: for any value of what needs a review, a head is exempt exactly when no path matches it; else approved exactly when its newest status by id is a success that reads as a pass; the creator and the order listed never change the answer",
    Approvable.fields,
    (c) => {
      const { reviewed, paths, seen } = resolve(c);
      const got = Review.approval({ reviewed, paths: paths.map((p) => p.path), seen: seen.map((s) => s.seen) });

      if (!paths.some((p) => needsReview(reviewed, p.path))) {
        expect(got).toEqual({ _tag: "exempt" });
      } else {
        const newest = seen.reduce<(typeof seen)[number] | undefined>(
          (a, s) => (a === undefined || s.id > a.id ? s : a),
          undefined,
        );

        if (newest === undefined) {
          expect(got).toEqual({ _tag: "missing", reason: "none" });
        } else if (KIND_WHY[newest.kind] === "approved") {
          expect(got).toEqual({ _tag: "approved", seen: newest.seen });
        } else if (KIND_WHY[newest.kind] === null) {
          expect(got._tag).toBe("missing");
        } else {
          expect(got).toEqual({ _tag: "missing", reason: KIND_WHY[newest.kind] });
        }
      }

      const reversed = Review.approval({
        reviewed,
        paths: paths.map((p) => p.path).toReversed(),
        seen: seen.map((s) => s.seen).toReversed(),
      });

      const renamed = Review.approval({
        reviewed,
        paths: paths.map((p) => p.path),
        seen: seen.map((s) => ({ ...s.seen, creator: "someone-who-never-mattered" })),
      });

      expect(reversed).toEqual(got);
      expect(renamed._tag).toBe(got._tag);
    },
    R1_LAW,
  );

  it.effect("scenario: the R1 generator reaches every class it must hold on, with the law's seed and count", () =>
    Effect.gen(function* () {
      const sample = yield* Arbitrary.sampleEffect(Arbitrary.schema(Approvable), {
        count: R1_LAW.arbitrary.runs,
        seed: R1_LAW.arbitrary.seed,
      });

      const reached = new Set(sample.flatMap(reaches));

      const required = [
        ...Object.entries(PATH_KINDS).map(([kind, needs]) => `${kind}:${needs}`),
        "needs nothing",
        "needs, no status",
        "several statuses",
        ...KINDS.map((k) => `newest ${k}`),
      ];

      expect(required.filter((c) => !reached.has(c))).toEqual([]);
    }).pipe(Effect.orDie),
  );

  // Plant: drop the shape checks of `Reviewed` (a tree with no trailing slash, a name with two stars, a file with a trailing slash).
  it("scenario: a value of what needs a review that cannot mean a path is refused: a tree with no closing slash, a name with two stars or a slash, a file ending in a slash", () => {
    const ok = { trees: ["next/"], files: ["package.json"], names: ["tsconfig*"] };
    expect(Schema.is(Review.Reviewed)(ok)).toBe(true);

    for (const bad of [
      { ...ok, trees: ["next"] },
      { ...ok, trees: ["/next/"] },
      { ...ok, names: ["a*b*c"] },
      { ...ok, names: ["docs/tsconfig*"] },
      { ...ok, names: [""] },
      { ...ok, files: ["docs/"] },
    ]) {
      expect(Schema.is(Review.Reviewed)(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  // Plant: drop a path from ROOT_CONFIG or from REVIEWED, or read `.kalfa/` as `kalfa/`.
  it("vector: the value 0093 settles and the owner's ruling adds: the two trees, and the root config files, with `.kalfa/` outside", () => {
    expect(Review.REVIEWED).toEqual({
      trees: ["next/", "kalfa/", "oxlint-plugins/"],
      files: ["package.json", "pnpm-lock.yaml", ".github/workflows/check.yaml", "layer-rules.json"],
      names: ["tsconfig*", "vitest*.ts"],
    });

    const all = (path: string) =>
      Review.approval({ reviewed: Review.REVIEWED, paths: [path], seen: [] })._tag !== "exempt";

    for (const path of [
      "next/a.ts",
      "kalfa/git/src/x.ts",
      "package.json",
      "tsconfig.base.json",
      "vitest.config.ts",
      "oxlint-plugins/a.ts",
    ]) {
      expect(all(path), path).toBe(true);
    }

    for (const path of [
      ".kalfa/decisions/0093.md",
      "docs/next/x",
      "packages/x/package.json",
      "apps/x/tsconfig.json",
      "README.md",
    ]) {
      expect(all(path), path).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// R2: the record on the wire
// ---------------------------------------------------------------------------------------------------------

const WORDS = ["a", "b7", "`", "```", '"', "\\", "{", "}", "é", "日本", "x y", "'", "$", "%", "{{x}}", "</b>"] as const;

const Words = (max: number) =>
  Schema.Array(Schema.Literals(WORDS)).check(Schema.isMinLength(1), Schema.isMaxLength(max));

const RecordCase = Schema.Struct({
  tag: Schema.Literals(["pass", "carry", "override"]),
  n: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 200 })),
  reviewerWords: Words(40),
  reason: Words(60),
  ticket: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 99999 }))),
});

const drawnRecord = (c: typeof RecordCase.Type): Review.Record => {
  const [head, reviewed, base, patchId] = [hex(c.n), hex(c.n + 300), hex(c.n + 600), hex(c.n + 900)];
  const reviewer = c.reviewerWords.join(" ").slice(0, 300).trimEnd() || "a";
  const reason = c.reason.join(" ").slice(0, 128).trimEnd() || "a";

  switch (c.tag) {
    case "pass":
      return Review.Record.cases.pass.make({ v: 1, head, reviewed, base, patchId, reviewer, ticket: c.ticket });
    case "carry":
      return Review.Record.cases.carry.make({ v: 1, head, from: base, reviewed, patchId });
    default:
      return Review.Record.cases.override.make({ v: 1, head, reason });
  }
};

const BAD_WORDS = ["", "  ", "\t", "\n", "a\nb", "a\r", " lead", "trail ", "a".repeat(129)] as const;

describe("R2: the record on the wire (slice 1)", () => {
  // Plants, each run once and restored: give an override `success`; give an override `error`; let a reason of 129 characters through; write
  // the reason with its line break; drop `patchId` from the description.
  it.prop(
    "R2 property: for any record, the status is `success` for a pass and a carry and `failure` for an override and never another state, its description is at most 140 characters and reads back as the same reviewed head and patch id (or the same reason), and a comment holds the whole record as JSON and the head's first seven characters",
    RecordCase.fields,
    (c) => {
      const r = drawnRecord(c);
      const { state, description } = Review.status(r);
      expect(state).toBe(c.tag === "override" ? "failure" : "success");
      expect(description.length).toBeLessThanOrEqual(140);
      const read = Review.core(state, description);

      if (r._tag === "override") {
        expect(read).toEqual(Result.succeed({ _tag: "override", reason: r.reason }));
      } else {
        expect(read).toEqual(Result.succeed({ _tag: "pass", reviewed: r.reviewed, patchId: r.patchId }));
      }

      const text = Review.comment(r);
      // In the lines for a person, not only in the JSON, whose full sha holds them too.
      expect(text.split("```json")[0]).toContain(r.head.slice(0, 7));
      const json = /```json\n(.*)\n```/.exec(text)?.[1] ?? "";
      expect(Schema.decodeSync(Schema.fromJsonString(Review.Record))(json)).toEqual(r);
    },
    { arbitrary: { seed: 1002, runs: runsFor({ fast: 200, full: 400 }) } },
  );

  it.prop(
    "R2 property: a blank reason, a reason with a line break or space at either end, a reason over 128 characters, and a blank or over-long reviewer are no record, and read back from a status as nothing",
    { n: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 })), bad: Schema.Literals(BAD_WORDS) },
    ({ n, bad }) => {
      const head = hex(n);
      expect(Schema.is(Review.Record)({ _tag: "override", v: 1, head, reason: bad })).toBe(false);
      expect(Result.isFailure(Review.core("failure", `override v1 ${bad}`))).toBe(true);

      const pass = { _tag: "pass", v: 1, head, reviewed: head, base: head, patchId: head, ticket: null };
      // 129 characters is a fair reviewer (the cap is 300) and not a fair reason.
      expect(Schema.is(Review.Record)({ ...pass, reviewer: bad })).toBe(bad.length === 129);
      expect(Schema.is(Review.Record)({ ...pass, reviewer: "a".repeat(301) })).toBe(false);
      expect(Schema.is(Review.Record)({ ...pass, reviewer: "a".repeat(300) })).toBe(true);
      expect(Schema.is(Review.Record)({ _tag: "override", v: 1, head, reason: "a".repeat(128) })).toBe(true);
    },
    { arbitrary: { seed: 1003, runs: runsFor({ fast: 30, full: 100 }) } },
  );

  // Plant: read a `v2` record as a pass.
  it("format: a status reads as a pass only in the one shape this tool writes, with the version and 40-character lowercase ids", () => {
    const [rev, patch] = [hex(1), hex(2)];
    expect(Review.core("success", `pass v1 reviewed=${rev} patch=${patch}`)).toEqual(
      Result.succeed({ _tag: "pass", reviewed: rev, patchId: patch }),
    );

    expect(Result.isFailure(Review.core("success", `pass v2 reviewed=${rev} patch=${patch}`))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
// T1: the types
// ---------------------------------------------------------------------------------------------------------

describe("T1: the record's types (slice 1; the compiler checks these, `pnpm typecheck` where it reaches this file)", () => {
  // Plants: give the carry a `reviewer`; add a tag to the record, or to what a status reads as, and leave a match without it.
  it("type: a carry holds no reviewer, and the record and what a status reads as hold exactly the cases the code matches", () => {
    expectTypeOf<Extract<Review.Record, { _tag: "carry" }>>().not.toHaveProperty("reviewer");
    expectTypeOf<Extract<Review.Record, { _tag: "carry" }>>().toHaveProperty("from");
    expectTypeOf<Extract<Review.Record, { _tag: "override" }>>().toHaveProperty("reason");
    expectTypeOf<Review.Record["_tag"]>().toEqualTypeOf<"pass" | "carry" | "override">();
    expectTypeOf<Review.Core["_tag"]>().toEqualTypeOf<"pass" | "override">();
    expectTypeOf<Review.Approval["_tag"]>().toEqualTypeOf<"exempt" | "approved" | "missing">();
    expectTypeOf<Review.Recorded["_tag"]>().toEqualTypeOf<"fresh" | "kept" | "already">();
  });
});

// ---------------------------------------------------------------------------------------------------------
// R3 and R4: the write, over a generated history
// ---------------------------------------------------------------------------------------------------------

// A pull request is a branch off main with `ops` made on it: an `edit` changes the one feature file, an `empty` commit changes nothing, a
// `merge` brings a new main commit into the branch (the branch is the merge's first parent, as GitHub's update-branch makes it).
// Main may move on after the last merge. A reviewed head is named by a `pick`, and heads may already hold statuses. All of it is plain
// data, so `plan` says what must happen (with no commit ids) and `build` makes the store the code runs on.

// Each list below repeats a value to make it likelier: a drawn case should mostly be one the code can write for, and rarely a refusal that
// an earlier check makes anyway.
const PICKS = ["head", "head", "same", "same", "same", "same", "fewer", "main", "side", "unknown"] as const;

const Pick = Schema.Literals(PICKS);

const Index = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9 }));

const HistoryCase = Schema.Struct({
  ops: Schema.Array(Schema.Literals(["edit", "edit", "merge", "merge", "empty"])).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(6),
  ),
  shape: Schema.Literals([
    "plain",
    "plain",
    "plain",
    "plain",
    "plain",
    "plain",
    "plain",
    "unrelated",
    "crisscross",
    "shallow",
  ]),
  mainAfter: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
  pr: Schema.Literals(["open", "open", "open", "open", "open", "open", "open", "closed", "merged", "other"]),
  ask: Schema.Literals(["fresh", "carry"]),
  pick: Pick,
  at: Index,
  seeds: Schema.Array(
    Schema.Struct({
      place: Schema.Literals(["head", "own", "own", "own", "own", "own", "own", "fork", "mainSide"]),
      at: Index,
      kind: Schema.Literals(["pass", "pass", "pass", "pass", "pass", "override", "garbage", "passFailure"]),
      pick: Pick,
      pickAt: Index,
      url: Schema.Literals([true, true, true, true, false]),
    }),
  ).check(Schema.isMaxLength(5)),
  fault: Schema.Literals([
    "none",
    "none",
    "none",
    "none",
    "none",
    "none",
    "none",
    "none",
    "writeFails",
    "commentFails",
    "lossy",
    "readFails",
  ]),
  reviewerWords: Words(6),
  ticket: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9999 }))),
});

type HistoryCase = typeof HistoryCase.Type;

/** Everything about a drawn case that needs no commit id: the branch, what each commit's change is, which head is reviewed, what must happen. */
const plan = (c: HistoryCase) => {
  const ops: ReadonlyArray<"edit" | "merge" | "empty"> =
    c.shape === "crisscross"
      ? ["edit", "merge", ...c.ops]
      : c.shape === "unrelated"
        ? c.ops.map((op) => (op === "merge" ? "edit" : op))
        : c.ops;

  let edits = 0;
  let merges = 0;

  const chain = ops.map((op) => {
    edits += op === "edit" ? 1 : 0;
    merges += op === "merge" ? 1 : 0;

    return { op, e: edits, merged: merges };
  });

  const last = chain.length - 1;
  const eHead = chain[last]?.e ?? 0;
  const tip = merges + c.mainAfter;
  const mains = tip + 1;
  const headKey = `chain:${last}`;
  const editsAt = (key: string) => (key.startsWith("chain:") ? (chain[Number(key.slice(6))]?.e ?? -1) : -1);

  const commitKey = (pick: HistoryCase["pick"], at: number): string => {
    const same = chain.flatMap((x, i) => (x.e === eHead ? [i] : []));
    const fewer = chain.flatMap((x, i) => (x.e < eHead ? [i] : []));

    switch (pick) {
      case "head":
        return headKey;
      case "same":
        return `chain:${same[at % same.length]}`;
      case "fewer":
        return fewer.length === 0 ? headKey : `chain:${fewer[at % fewer.length]}`;
      case "main":
        return `main:${at % mains}`;
      case "side":
        return "side";
      default:
        return "unknown";
    }
  };

  /** A reviewed head names the same change as the head: one of the branch's own commits, holding the head's change, which is some change. */
  const sameChange = (key: string) => editsAt(key) === eHead && eHead >= 1;

  const seeds = c.seeds.map((s, i) => ({
    id: i + 1,
    key:
      s.place === "head"
        ? headKey
        : s.place === "own"
          ? `chain:${s.at % chain.length}`
          : s.place === "fork"
            ? "main:0"
            : `main:${s.at % mains}`,
    kind: s.kind,
    reviewedKey: commitKey(s.pick, s.pickAt),
    url: s.url,
  }));

  /** The status that decides a commit, when it is a pass. */
  const approving = (key: string) => {
    const there = seeds.filter((s) => s.key === key);
    const newest = there[there.length - 1];

    return newest?.kind === "pass" ? newest : undefined;
  };

  const reviewedKey = commitKey(c.pick, c.at);

  const carried =
    c.ask === "carry"
      ? chain
          .slice(0, last)
          .map((_, i) => `chain:${last - 1 - i}`)
          .map(approving)
          .find((a) => a !== undefined)
      : undefined;

  /** What must happen: the outcome, and whether the write was reached (a refusal after it, such as a read back that disagrees, has written). */
  const [outcome, reached] = ((): readonly [
    "RecordRefused" | "ReviewsError" | "already" | "fresh" | "kept",
    boolean,
  ] => {
    if (c.pr !== "open") {
      return ["RecordRefused", false];
    }

    if (c.fault === "readFails") {
      return ["ReviewsError", false];
    }

    if (approving(headKey) !== undefined) {
      return ["already", false];
    }

    if (c.shape !== "plain") {
      return ["RecordRefused", false];
    }

    if (c.ask === "fresh") {
      if (!sameChange(reviewedKey)) {
        return ["RecordRefused", false];
      }

      return c.fault === "writeFails" || c.fault === "commentFails"
        ? ["ReviewsError", true]
        : c.fault === "lossy"
          ? ["RecordRefused", true]
          : ["fresh", true];
    }

    if (carried === undefined || !carried.url || !sameChange(carried.reviewedKey)) {
      return ["RecordRefused", false];
    }

    return c.fault === "writeFails"
      ? ["ReviewsError", true]
      : c.fault === "lossy"
        ? ["RecordRefused", true]
        : ["kept", true];
  })();

  /** Which kind of case this is, for the generator's reach: what the head holds, how the carry found its approval, which head was named. */
  const classes = [
    `outcome ${outcome}${reached ? " (write reached)" : ""}`,
    ...(c.pr !== "open" ? [`pull request ${c.pr}`] : []),
    ...(c.pr === "open" && c.shape !== "plain" ? [`shape ${c.shape}`] : []),
    ...(c.pr === "open" && c.shape === "plain" && approving(headKey) === undefined && c.fault === "none"
      ? c.ask === "fresh"
        ? [
            `fresh names ${c.pick === "same" && reviewedKey === headKey ? "head" : c.pick}${c.pick === "head" && eHead === 0 ? " with no change" : ""}`,
          ]
        : [
            carried === undefined
              ? `carry finds none${seeds.some((s) => s.kind === "override") ? " beside an override" : ""}${seeds.some((s) => s.kind === "pass" && !s.key.startsWith("chain:")) ? " beside a pass off the branch" : ""}`
              : `carry finds a pass naming ${carried.reviewedKey.startsWith("chain:") ? (sameChange(carried.reviewedKey) ? "the same change" : "another change") : carried.reviewedKey.split(":")[0]}${carried.url ? "" : ", no url"}`,
            ...(outcome === "kept" &&
            seeds.some(
              (x) =>
                x.key.startsWith("chain:") &&
                Number(x.key.slice(6)) > Number(carried?.key.slice(6)) &&
                Number(x.key.slice(6)) < last,
            )
              ? ["carry walks past a status that does not approve"]
              : []),
            ...(outcome === "kept"
              ? [
                  `carry kept over ${Math.min(2, (chain[last]?.merged ?? 0) - (chain[Number(carried?.key.slice(6))]?.merged ?? 0))} merges`,
                ]
              : []),
          ]
      : []),
    ...(approving(headKey) !== undefined ? ["head already approved"] : []),
    ...(c.fault !== "none" ? [`fault ${c.fault}`] : []),
  ];

  return { ops, chain, merges, tip, mains, headKey, seeds, reviewedKey, carried, outcome, reached, classes };
};

const SETTINGS = Schema.decodeSync(Settings.Settings)({
  limits: {
    commits: 1000,
    refs: 1000,
    bytes: 1_000_000,
    files: 1000,
    diff: 10_000_000,
    blob: 10_000_000,
    time: "10 seconds",
    kill: "5 seconds",
  },
  committer: { name: "Fixture", email: "fixture@example.test" },
});

const SIGNED = Commit.Signature.make({
  name: "Fixture",
  email: "fixture@example.test",
  at: { seconds: 1_700_000_000, offset: "+0000" },
});

const filesMap = (entries: Readonly<Record<string, string>>) =>
  new Map(
    Object.entries(entries).map(([path, content]) => [
      Schema.decodeSync(Tree.Path)(path),
      { mode: Schema.decodeSync(Tree.Mode)("100644"), content: new TextEncoder().encode(content) },
    ]),
  );

const toId = (sha: string) => Schema.decodeSync(CommitId)(sha);

/** The store a drawn case makes, with the id of each commit by its key (`chain:2`, `main:1`, `side`, ...), and who the pull request is. */
const build = (c: HistoryCase) =>
  Effect.gen(function* () {
    const p = plan(c);
    let store = MemoryRepository.empty;
    const ids = new Map<string, CommitId>();

    const put = Effect.fnUntraced(function* (
      key: string,
      parents: ReadonlyArray<CommitId>,
      files: Readonly<Record<string, string>>,
      shallow = false,
    ) {
      const made = yield* Effect.orDie(MemoryRepository.tree(store, filesMap(files)));

      const commit = yield* MemoryRepository.commit({
        tree: made.id,
        parents,
        author: SIGNED,
        committer: SIGNED,
        message: `${key}\n`,
      });

      store = yield* Effect.orDie(
        Effect.fromResult(
          MemoryRepository.add({ ...made.store, shallow: shallow ? new Set([commit.id]) : made.store.shallow }, commit),
        ),
      );

      ids.set(key, commit.id);

      return commit.id;
    });

    const mainFiles = (j: number): Record<string, string> => ({
      "base.txt": "base",
      ...Object.fromEntries(Array.from({ length: j }, (_, i) => [`main-${i + 1}.txt`, "main"])),
    });

    const feature = (e: number): Record<string, string> =>
      e === 0 ? {} : { "feature.txt": Array.from({ length: e }, (_, i) => `edit ${i + 1}`).join("\n") };

    yield* put("main:0", c.shape === "shallow" ? [toId(hex(888))] : [], mainFiles(0), c.shape === "shallow");

    let tipOfBranch: CommitId | undefined =
      c.shape === "unrelated" ? yield* put("orphan", [], { "orphan.txt": "orphan" }) : ids.get("main:0");

    let merged = 0;

    for (const [i, step] of p.chain.entries()) {
      const parents = tipOfBranch === undefined ? [] : [tipOfBranch];

      if (step.op === "merge") {
        merged += 1;
        const main = yield* put(`main:${merged}`, [ids.get(`main:${merged - 1}`) ?? toId(hex(0))], mainFiles(merged));
        tipOfBranch = yield* put(`chain:${i}`, [...parents, main], { ...mainFiles(merged), ...feature(step.e) });
      } else {
        tipOfBranch = yield* put(`chain:${i}`, parents, {
          ...(c.shape === "unrelated" ? { "orphan.txt": "orphan" } : mainFiles(merged)),
          ...feature(step.e),
        });
      }
    }

    for (let j = p.merges + 1; j <= p.tip; j++) {
      yield* put(`main:${j}`, [ids.get(`main:${j - 1}`) ?? toId(hex(0))], mainFiles(j));
    }

    // A commit off the branch that holds the head's own change: the branch as it was before a rebase, which is no ancestor of the head.
    yield* put("side", [ids.get("main:0") ?? toId(hex(0))], {
      ...mainFiles(0),
      ...feature(p.chain[p.chain.length - 1]?.e ?? 0),
    });

    let tipOfMain = ids.get(`main:${p.tip}`) ?? toId(hex(0));

    if (c.shape === "crisscross") {
      tipOfMain = yield* put(`main:${p.tip + 1}`, [tipOfMain, ids.get("chain:0") ?? toId(hex(0))], {
        ...mainFiles(p.tip),
        ...feature(1),
      });
    }

    store = yield* Effect.orDie(
      Effect.fromResult(
        MemoryRepository.point(store, Schema.decodeSync(Ref.RefName)("refs/remotes/origin/main"), tipOfMain),
      ),
    );

    return { store, ids, plan: p };
  }).pipe(Effect.provide(Digest.layerWebCrypto));

const id = (ids: ReadonlyMap<string, CommitId>, key: string): string =>
  key === "unknown" ? hex(777) : (ids.get(key) ?? hex(0));

const reviewerText = (c: HistoryCase): string => c.reviewerWords.join(" ").slice(0, 300).trimEnd() || "a";

/** Runs `record` once on a drawn case, on the test layers, and keeps what it did. `leaks` says which words the leak grep refuses. */
const run = Effect.fnUntraced(function* (c: HistoryCase, reviewer: string, leaks: string | undefined = undefined) {
  const built = yield* build(c);
  const p = built.plan;
  const head = id(built.ids, p.headKey);

  const github = PullRequestsTest.world([
    {
      number: 7,
      head: "fabrikalfa/t2338",
      oid: head,
      state: c.pr === "closed" ? "CLOSED" : c.pr === "merged" ? "MERGED" : "OPEN",
      draft: false,
    },
  ]);

  github.more.set(7, { base: c.pr === "other" ? "fabrikalfa/parent" : "main" });
  const world = ReviewsTest.world();
  world.lossy = c.fault === "lossy";

  for (const s of p.seeds) {
    const reviewed = id(built.ids, s.reviewedKey);
    const good = `pass v1 reviewed=${reviewed} patch=${hex(s.id)}`;

    const said =
      s.kind === "pass"
        ? { state: "success", description: good }
        : s.kind === "passFailure"
          ? { state: "failure", description: good }
          : s.kind === "override"
            ? { state: "failure", description: "override v1 sev1 fix" }
            : { state: "success", description: good.replace("v1", "v2") };

    ReviewsTest.seed(world, id(built.ids, s.key), {
      id: s.id,
      creator: "lead",
      ...said,
      url: s.url ? `https://github.test/c/${s.id}` : null,
    });
  }

  const failing: ReviewsTest.Failing =
    c.fault === "readFails"
      ? { read: "gh is down" }
      : c.fault === "writeFails"
        ? { status: "no right" }
        : c.fault === "commentFails"
          ? { comment: "gh is down" }
          : {};

  const ask =
    c.ask === "fresh"
      ? Review.Ask.cases.fresh.make({ reviewed: id(built.ids, p.reviewedKey), reviewer, ticket: c.ticket })
      : Review.Ask.cases.carry.make({});

  const pushes = Recorder.layer(Pushes, {
    leakGrep: () => Effect.void,
    leakChange: () => Effect.void,
    leakText: (_dir, text) =>
      leaks !== undefined && text.includes(leaks)
        ? Effect.fail(LeakGrepRefused.make({ reason: "leakgrep.sh exited 1" }))
        : Effect.void,
    push: () => Effect.void,
  });

  const layers = Layer.mergeAll(
    PullRequestsTest.layer(github),
    BranchesTest.layer({ branches: [], ahead: {}, empty: [] }),
    pushes,
    ReviewsTest.layer(world, failing),
    MemoryRepository.layer(built.store, SETTINGS).pipe(Layer.provide(Digest.layerWebCrypto)),
  );

  const { result, greps } = yield* Effect.gen(function* () {
    const done = yield* Review.record({ dir: ".", pr: 7, ask }).pipe(Effect.result);

    return { result: done, greps: yield* Recorder.calls(Pushes, "leakText") };
  }).pipe(Effect.provide(layers));

  return { built, head, world, result, greps };
});

const R3_LAW = { arbitrary: { seed: 1004, runs: runsFor({ fast: 1500, full: 3000 }) } };

describe("R3: the carry rule and the write (slice 1)", () => {
  // Plants, each run once and restored: skip the ancestor check; compare commit ids and not patch ids; let a one-sided none pass; treat two
  // merge bases as one; skip the read back; require a strict ancestor; walk both parents; walk past main into old history; carry from an
  // override; write again on an approved head; post a second comment on a carry; mint a record for a closed pull request.
  it.effect.prop(
    "R3 property: over a generated branch with merges of main, a fresh record writes one comment and one status on the head only when the reviewed head is the head or its ancestor with the same change; a carry writes one status and no comment, from the nearest approval on the head's first parents; a head that holds an approval gets nothing; and every write is read back",
    HistoryCase.fields,
    (c) =>
      Effect.gen(function* () {
        const { built, head, world, result } = yield* run(c, reviewerText(c));
        const p = built.plan;
        const got = Result.isSuccess(result) ? result.success._tag : result.failure._tag;
        expect(got, JSON.stringify(p.classes)).toBe(p.outcome);

        const comments = world.calls.filter(ReviewsTest.Call.guards.comment);
        const statuses = world.calls.filter(ReviewsTest.Call.guards.status);

        if (!p.reached) {
          expect(world.calls).toEqual([]);
        } else if (c.ask === "fresh") {
          const failedBefore = c.fault === "commentFails";
          expect(comments).toHaveLength(failedBefore ? 0 : 1);
          expect(statuses).toHaveLength(failedBefore || c.fault === "writeFails" ? 0 : 1);
        } else {
          expect(comments).toHaveLength(0);
          expect(statuses).toHaveLength(c.fault === "writeFails" ? 0 : 1);
        }

        if (p.outcome === "fresh") {
          const reviewed = id(built.ids, p.reviewedKey);
          const [first, status] = [comments[0], statuses[0]];
          expect(status?.head).toBe(head);
          expect(status?.state).toBe("success");
          expect(status?.description).toMatch(new RegExp(`^pass v1 reviewed=${reviewed} patch=[0-9a-f]{40}$`));
          expect(status?.url).toBe(`https://github.test/pull/7#issuecomment-1`);

          const json = /```json\n(.*)\n```/.exec(first?.body ?? "")?.[1] ?? "";
          const written = Schema.decodeSync(Schema.fromJsonString(Review.Record))(json);

          expect(written).toMatchObject({
            _tag: "pass",
            head,
            reviewed,
            base: id(built.ids, `main:${p.merges}`),
            reviewer: reviewerText(c),
            ticket: c.ticket,
          });

          expect(result).toEqual(Result.succeed({ _tag: "fresh", head, reviewed }));
        }

        if (p.outcome === "kept") {
          const [from, reviewed] = [id(built.ids, p.carried?.key ?? ""), id(built.ids, p.carried?.reviewedKey ?? "")];
          expect(statuses[0]).toMatchObject({ head, state: "success", url: `https://github.test/c/${p.carried?.id}` });
          expect(statuses[0]?.description).toMatch(new RegExp(`^pass v1 reviewed=${reviewed} patch=[0-9a-f]{40}$`));
          expect(result).toEqual(Result.succeed({ _tag: "kept", head, from, reviewed }));
        }

        if (p.outcome === "already") {
          expect(result).toEqual(Result.succeed({ _tag: "already", head }));
        }
      }).pipe(Effect.provide(Digest.layerWebCrypto)),
    R3_LAW,
  );

  it.effect("scenario: the R3 generator reaches every class it must hold on, with the law's seed and count", () =>
    Effect.gen(function* () {
      const sample = yield* Arbitrary.sampleEffect(Arbitrary.schema(HistoryCase), {
        count: R3_LAW.arbitrary.runs,
        seed: R3_LAW.arbitrary.seed,
      });

      const reached = new Set(sample.flatMap((c) => plan(c).classes));

      const required = [
        "outcome fresh (write reached)",
        "outcome kept (write reached)",
        "outcome already",
        "outcome RecordRefused",
        "outcome ReviewsError (write reached)",
        "outcome ReviewsError",
        "outcome RecordRefused (write reached)",
        "pull request closed",
        "pull request merged",
        "pull request other",
        "shape unrelated",
        "shape crisscross",
        "shape shallow",
        "fresh names head",
        "fresh names same",
        "fresh names fewer",
        "fresh names main",
        "fresh names side",
        "fresh names unknown",
        "carry finds none",
        "carry finds none beside an override",
        "carry finds none beside a pass off the branch",
        "carry finds a pass naming the same change",
        "carry finds a pass naming the same change, no url",
        "carry finds a pass naming another change",
        "carry walks past a status that does not approve",
        "carry kept over 1 merges",
        "carry kept over 2 merges",
        "head already approved",
        "fault readFails",
        "fault lossy",
        "fault writeFails",
        "fault commentFails",
      ];

      expect(required.filter((k) => !reached.has(k))).toEqual([]);
    }).pipe(Effect.orDie),
  );
});

// R4: the words in a record go public, so they pass the leak grep before anything is posted.
const MARKER = "plantedleakwordr4";

/** A pull request that the code can write a fresh record for, and the one thing that goes wrong beside a leaking reviewer. */
const GOOD: HistoryCase = {
  ops: ["edit"],
  shape: "plain",
  mainAfter: 0,
  pr: "open",
  ask: "fresh",
  pick: "head",
  at: 0,
  seeds: [],
  fault: "none",
  reviewerWords: ["a"],
  ticket: null,
};

const LeakFlow = Schema.Struct({
  leaks: Schema.Boolean,
  at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  words: Words(4),
  other: Schema.Literals(["nothing", "closed", "side", "approved", "readFails", "writeFails", "lossy"]),
});

describe("R4: the leak gate on the record's words [secrets] (slice 1)", () => {
  // Plants, each run once and restored: run the grep on the status description and not the comment; post the comment before the grep; skip the
  // grep; print the reviewer in a refusal.
  it.effect.prop(
    "R4 property: a reviewer holding a refused word posts no comment and no status, whatever else is wrong with the record, and no output holds the word; a clean reviewer is grepped, in the comment that is posted, before anything is written",
    LeakFlow.fields,
    ({ leaks, at, words, other }) =>
      Effect.gen(function* () {
        const tokens: Array<string> = [...words];
        tokens.splice(at % (tokens.length + 1), 0, leaks ? `x${MARKER}y` : "clean");
        const reviewer = tokens.join(" ");

        const c: HistoryCase = {
          ...GOOD,
          pr: other === "closed" ? "closed" : "open",
          pick: other === "side" ? "side" : "head",
          fault: other === "readFails" || other === "writeFails" || other === "lossy" ? other : "none",
          seeds:
            other === "approved" ? [{ place: "head", at: 0, kind: "pass", pick: "head", pickAt: 0, url: true }] : [],
        };

        const { world, result, greps } = yield* run(c, reviewer, MARKER);
        const first = Result.isSuccess(result) ? result.success._tag : result.failure._tag;

        const early: Record<typeof other, string> = {
          nothing: "fresh",
          closed: "RecordRefused",
          side: "RecordRefused",
          approved: "already",
          readFails: "ReviewsError",
          writeFails: "fresh",
          lossy: "fresh",
        };

        // Only a write that was reached is held back by the grep.
        const reachesWrite = other === "nothing" || other === "writeFails" || other === "lossy";
        expect(first).toBe(
          leaks && reachesWrite
            ? "LeakGrepRefused"
            : other === "writeFails"
              ? "ReviewsError"
              : other === "lossy"
                ? "RecordRefused"
                : early[other],
        );

        if (leaks) {
          expect(world.calls).toEqual([]);
        }

        if (!leaks && reachesWrite) {
          expect(greps.some(([, text]) => text.includes(reviewer))).toBe(true);
        }

        // Every output the code gives: what it returned, and what it wrote.
        const outputs = JSON.stringify([result, world.calls, [...world.statuses]]);
        expect(outputs.includes(MARKER)).toBe(false);
      }),
    { arbitrary: { seed: 1005, runs: runsFor({ fast: 300, full: 600 }) } },
  );
});
