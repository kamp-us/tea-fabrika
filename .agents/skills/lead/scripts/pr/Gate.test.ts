// Today's lead tooling. The merge gate's laws (./Gate.ts): every way of merging a pull request asks the gate first, so every path
// refuses every pull request the gate refuses, with the gate's own words, and asks GitHub for nothing then. The paths are `check`
// (the gate alone), `queue`, `run` (the queue with the quest's wait), `merge`, `merge --admin`, `admin` (with its wait) and `arm`;
// the flow's landing step is `queue` (flow/landing.ts calls `Queue.add`), and land.test.ts runs each command of the CLI on a
// pull request that holds two of these refusals. All on the test layers: nothing here asks GitHub, git, the tracker or the leak grep.
//
// Slice 2 of .kalfa/quests/review-record-PLAN.md adds the review check, last (R8, R9): the gate asks `Changes` for the paths the head changes
// and, when one needs a review, `Reviews` for the statuses on that head, and each path says its `way` (queue, arm, admin).
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Layer, Option, Predicate, Result, Schema } from "effect";
import * as ChecksTest from "../ci/ChecksTest.ts";
import * as RunsTest from "../ci/RunsTest.ts";
import * as Arm from "./Arm.ts";
import * as BranchesTest from "./BranchesTest.ts";
import * as ChangesTest from "./ChangesTest.ts";
import * as Gate from "./Gate.ts";
import * as Merge from "./Merge.ts";
import { PullRequests } from "./PullRequests.ts";
import * as PullRequestsTest from "./PullRequestsTest.ts";
import { LeakGrepRefused } from "./Pushes.ts";
import * as PushesTest from "./PushesTest.ts";
import * as Queue from "./Queue.ts";
import * as ReviewsTest from "./ReviewsTest.ts";
import * as Sections from "./Sections.ts";
import * as SignaturesTest from "./SignaturesTest.ts";
import * as TicketsTest from "./TicketsTest.ts";

const oid = "0123456789abcdef0123456789abcdef01234567";

/** Each leak check says which one refused, so a check asked in the wrong order is told apart. */
const hit = (method: string) => LeakGrepRefused.make({ reason: `leakgrep.sh exited 1 on ${method}` });

/** Each way a pull request is wrong that the gate refuses. A merged one is no refusal: every path answers it as done. */
const Defect = Schema.Literals([
  "can",
  "closed",
  "otherBase",
  "conflicting",
  "plan",
  "leakChange",
  "leakGrep",
  "leakText",
  "placeholder",
  "noEvidence",
  "unnamed",
  "ticket",
  "unreadable",
  "unsigned",
  "unreviewed",
]);

type Defect = typeof Defect.Type;

/** The three ways a path merges, as the gate asks them. */
type Way = "queue" | "arm" | "admin";

/** What the gate's review refusal names to do, by way: carry the record, queue instead of arming, or write an override reason. */
const NAMES: Record<Way, string> = {
  queue: "land.ts review 1415",
  arm: "land.ts queue 1415",
  admin: "--override-review",
};

/** The defects in the order the gate asks them, each with a line its refusal holds: the first one a pull request has is the one it says. */
const ORDER: ReadonlyArray<{ readonly defect: Defect; readonly says: string | ((way: Way) => string) }> = [
  { defect: "can", says: "can/ branch, never merged here" },
  { defect: "closed", says: "closed, not merged" },
  { defect: "otherBase", says: "merges into fabrikalfa/parent, not main" },
  { defect: "conflicting", says: "it conflicts with main" },
  { defect: "plan", says: "its title starts `Plan:`" },
  { defect: "leakChange", says: "leakgrep.sh exited 1 on leakChange" },
  { defect: "leakGrep", says: "leakgrep.sh exited 1 on leakGrep" },
  { defect: "leakText", says: "leakgrep.sh exited 1 on leakText" },
  { defect: "placeholder", says: ".agents/skills/pr/SKILL.md" },
  { defect: "noEvidence", says: ".agents/skills/pr/SKILL.md" },
  { defect: "unnamed", says: "its ## New names section does not name: newThing" },
  { defect: "ticket", says: "fabrika close ticket 9: 9 is not an open tracker ticket" },
  { defect: "unreadable", says: "git cannot be read" },
  {
    defect: "unsigned",
    says: "1 commit(s) since main are not signed or made by stepcommit.sh: abc12345 a plain commit",
  },
  { defect: "unreviewed", says: (way) => NAMES[way] },
];

const saysFor = (says: string | ((way: Way) => string), way: Way): string =>
  Predicate.isString(says) ? says : says(way);

const Path = Schema.Literals(["check", "queue", "run", "merge", "mergeAdmin", "admin", "arm"]);

type Path = typeof Path.Type;

/** How each path asks the gate. `check` says what the queue will say. */
const WAY: Record<Path, Way> = {
  check: "queue",
  queue: "queue",
  run: "queue",
  merge: "queue",
  mergeAdmin: "admin",
  admin: "admin",
  arm: "arm",
};

// Paths a pull request changes. `NEEDS` each match what needs a review (a tree, a file, a root name); `NEAR` are near misses that match none.
// A moved file lists both halves, so a path in `NEEDS` beside one in `NEAR` is a move out of a reviewed folder.
const NEEDS = [
  "next/a.ts",
  "kalfa/git/b.ts",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.base.json",
  "oxlint-plugins/c.ts",
  "layer-rules.json",
  "vitest.config.ts",
  ".github/workflows/check.yaml",
] as const;

const NEAR = [
  ".kalfa/x",
  "docs/next/x",
  "nextra/x",
  "kalfa-x/y",
  "next",
  "kalfa.md",
  "a/next/b",
  "packages/x/package.json",
  "docs/tsconfig.json",
  "docs/vitest.config.ts",
  "oxlint-plugins-x/y.ts",
  "README.md",
  ".github/workflows/ci-speed.yaml",
] as const;

/** What a pull request changes, and what is on its head: near misses, one path that needs a review at some place among them, and what the head holds. */
const Changed = Schema.Struct({
  near: Schema.Array(Schema.Literals(NEAR)).check(Schema.isMaxLength(4)),
  hit: Schema.Literals(NEEDS),
  at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  /** With no `unreviewed` defect: the pull request changes no reviewed path, or one with an approval on its head. */
  clean: Schema.Literals(["exempt", "approved"]),
  /** With the `unreviewed` defect: the statuses on the head that are no approval, and an approval on another head. */
  seeded: Schema.Literals(["nothing", "override", "elsewhere"]),
});

type Changed = typeof Changed.Type;

const PLAIN: Changed = { near: [], hit: "next/a.ts", at: 0, clean: "exempt", seeded: "nothing" };

/** A pass as the record writes it, on any head. */
const pass = {
  id: 1,
  creator: "lead",
  state: "success",
  description: `pass v1 reviewed=${oid} patch=${oid}`,
  url: null,
};

/** What the pull request is: a full body, a branch of the bot's, open, into main, and every commit signed, unless a defect says otherwise. */
const memory = (
  defects: ReadonlyArray<Defect>,
  changed: Changed = PLAIN,
  broken: ChangesTest.Failing & ReviewsTest.Failing = {},
) => {
  const has = (defect: Defect) => defects.includes(defect);
  const needs = has("unreviewed") || changed.clean === "approved";

  const github = PullRequestsTest.world([
    {
      number: 1415,
      head: has("can") ? "can/theirs" : "fabrikalfa/decision-1415",
      oid,
      state: has("closed") ? "CLOSED" : "OPEN",
      draft: false,
    },
  ]);

  const sections = ["Summary", "Evidence", "Merge Danger"].filter(
    (name) => !(has("noEvidence") && name === "Evidence"),
  );

  const body = `${has("placeholder") ? `${Sections.DRAFT_BODY}\n\n` : ""}${sections.map((name) => `## ${name}\n\nWords.\n`).join("\n")}${
    has("ticket") ? "\nfabrika close ticket 9\n" : ""
  }`;

  github.more.set(1415, {
    title: has("plan") ? "Plan: a room" : "Decision 0583: a room is one process",
    body,
    base: has("otherBase") ? "fabrikalfa/parent" : "main",
    mergeable: has("conflicting") ? "CONFLICTING" : "MERGEABLE",
  });

  if (has("unnamed")) {
    github.patches.set(1415, [{ path: "src/thing.ts", patch: "@@ -0,0 +1 @@\n+export const newThing = 1;" }]);
  }

  const failing: PushesTest.Failing = {
    ...(has("leakChange") ? { leakChange: hit("leakChange") } : {}),
    ...(has("leakGrep") ? { leakGrep: hit("leakGrep") } : {}),
    ...(has("leakText") ? { leakText: hit("leakText") } : {}),
  };

  // The paths git says the head changes, and the statuses GitHub holds on it.
  const changes = ChangesTest.world({
    [oid]: needs
      ? [...changed.near.slice(0, changed.at), changed.hit, ...changed.near.slice(changed.at)]
      : changed.near,
  });

  const reviews = ReviewsTest.world();

  if (has("unreviewed")) {
    if (changed.seeded === "override") {
      ReviewsTest.seed(reviews, oid, { ...pass, state: "failure", description: "override v1 a reason" });
    }

    if (changed.seeded === "elsewhere") {
      ReviewsTest.seed(reviews, "b".repeat(40), pass);
    }
  } else if (changed.clean === "approved") {
    ReviewsTest.seed(reviews, oid, pass);
  }

  const layer = Layer.mergeAll(
    ChangesTest.layer(changes, broken.paths === undefined ? {} : { paths: broken.paths }),
    ReviewsTest.layer(reviews, broken.read === undefined ? {} : { read: broken.read }),
    PullRequestsTest.layer(github),
    PushesTest.layer(PushesTest.remote(), failing),
    ChecksTest.layer([Option.some({ id: 1, status: "completed", conclusion: "success" })], ""),
    BranchesTest.layer({ branches: [], ahead: {}, empty: [], behind: { [oid]: 0 } }),
    RunsTest.layer(RunsTest.world()),
    TicketsTest.layer(TicketsTest.world()),
    SignaturesTest.layer({
      ...(has("unsigned") ? { unsigned: ["abc12345 a plain commit"] } : {}),
      ...(has("unreadable") ? { broken: "git cannot be read" } : {}),
    }),
  );

  return { github, layer, changes, reviews };
};

/** The way a path asks, as the gate takes it: the admin way with no reason given. */
const wayFor = (way: Way): typeof Gate.Way.Type =>
  way === "admin"
    ? Gate.Way.cases.admin.make({ override: null })
    : way === "arm"
      ? Gate.Way.cases.arm.make({})
      : Gate.Way.cases.queue.make({});

const admin = Merge.Route.cases.admin.make({ sev0: [], sev0Fixes: [], sev1: null });

/** How one path ended on the pull request: what refused it, or `null` when nothing did, and every write it asked of GitHub. */
const walk = (path: Path, defects: ReadonlyArray<Defect>, changed: Changed = PLAIN) => {
  const m = memory(defects, changed);

  const ended = Effect.gen(function* () {
    switch (path) {
      case "check": {
        const refusal = yield* Gate.before({
          dir: ".",
          found: yield* (yield* PullRequests).view(1415),
          marksReady: true,
          way: Gate.Way.cases.queue.make({}),
        });

        // The gate alone answers with its words, as each path's own error carries them after `pr 1415: `.
        return refusal === null ? null : yield* Effect.fail({ _tag: "Refusal", reason: `pr 1415: ${refusal}` });
      }

      case "queue":
        return yield* Queue.add({ dir: ".", pr: 1415 });
      case "run":
        return yield* Queue.add({ dir: ".", pr: 1415, wait: Queue.QUEST_WAIT });
      case "merge":
        return yield* Merge.merge({ dir: ".", pr: 1415, route: Merge.Route.cases.queue.make({}) });
      case "mergeAdmin":
        return yield* Merge.merge({ dir: ".", pr: 1415, route: admin });
      case "admin":
        return yield* Merge.merge({ dir: ".", pr: 1415, route: admin, wait: Merge.ADMIN_WAIT });
      default:
        return yield* Arm.arm({ repo: "fixture/repo", dir: ".", pr: 1415 });
    }
  }).pipe(Effect.result, Effect.provide(m.layer));

  return Effect.map(ended, (result) => ({
    // A leak grep or git that cannot say passes its own error through; any other refusal is the path's own error carrying the gate's words.
    refused: Result.isFailure(result)
      ? {
          tag:
            result.failure._tag === "LeakGrepRefused" || result.failure._tag === "SignaturesError"
              ? result.failure._tag
              : "refused",
          reason: String(result.failure.reason),
        }
      : null,
    calls: m.github.calls,
  }));
};

/** The one write each path asks of GitHub when nothing refuses it: the gate alone asks none. */
const WRITES: Record<Path, ReadonlyArray<PullRequestsTest.Call>> = {
  check: [],
  queue: [{ _tag: "enqueue", number: 1415, oid }],
  run: [{ _tag: "enqueue", number: 1415, oid }],
  merge: [{ _tag: "enqueue", number: 1415, oid }],
  mergeAdmin: [{ _tag: "admin", number: 1415, oid }],
  admin: [{ _tag: "admin", number: 1415, oid }],
  arm: [{ _tag: "arm", number: 1415, oid }],
};

const PATHS = Path.literals;

describe("the merge gate: every way of merging a pull request asks it first, so none can drift", () => {
  // Plants, each run once and restored: take `Gate.before` out of one path (`Queue.add`, `Arm.arm` or `Merge.admin`), so it
  // merges a pull request another path refuses (red: that path's defects); ask it after the path's own first write; read one
  // refusal out of the order above; let `check` skip a check the others run. The review check (slice 2): leave it out of `Arm.arm`;
  // let `arm` pass a pull request with an approval; look at one path of the list only (the first or the last); read the statuses of
  // another head; let an override status approve. Plants for the one gate (red: every defect but the review's): make `Arm.arm` or `Merge.admin` add
  // words of its own to the gate's refusal, as `refuse(`${refused}; and arm says something else`)`.
  it.effect.prop(
    "property: whatever refusals a pull request holds, every path refuses it with the gate's own words for the first of them and asks GitHub for nothing; a pull request with none is not refused by any path, which each asks its own one write, except `arm`, which refuses one that needs a review even with an approval",
    { defects: Schema.Array(Defect), changed: Changed },
    ({ defects, changed }) =>
      Effect.gen(function* () {
        const first = ORDER.find(({ defect }) => defects.includes(defect));
        const byWay = new Map<Way, { readonly tag: string; readonly reason: string } | null>();
        // The one gate: for every refusal but the review's, each path answers with exactly what `check` answers, word for word. The review's refusal
        // names a different command for each way, so there a path is compared only with the others of its own way.
        const gate = (yield* walk("check", defects, changed)).refused;
        const wordForWord = first !== undefined && first.defect !== "unreviewed";

        for (const path of PATHS) {
          const way = WAY[path];
          const got = yield* walk(path, defects, changed);
          // `arm` also turns away a pull request that needs a review and holds an approval.
          const arming = first === undefined && way === "arm" && changed.clean === "approved";
          const says = first === undefined ? (arming ? NAMES.arm : undefined) : saysFor(first.says, way);

          if (says === undefined) {
            expect(got.refused, path).toBeNull();
          } else {
            expect(got.refused?.reason, path).toContain(says);
          }

          if (wordForWord) {
            expect(got.refused, path).toEqual(gate);
          }

          // Every path of one way answers with the same words as the others of its way.
          const mate = byWay.get(way);

          if (mate === undefined) {
            byWay.set(way, got.refused);
          } else {
            expect(got.refused, path).toEqual(mate);
          }

          expect(got.calls, path).toEqual(says === undefined ? WRITES[path] : []);
        }
      }),
    { arbitrary: { seed: 2337, runs: runsFor({ fast: 120, full: 400 }) } },
  );

  // A random set of 15 refusals rarely holds the two that sit next to each other in the order, so a pair of checks asked the wrong way round slips by. This one always holds one adjacent pair, given
  // in the wrong order, so each of the 14 pairs is walked at fast depth. Plants, each run once and restored: swap each pair of neighbouring entries of `CHECKS`, and the two checks inside `body`; ask the review check before the signatures check (red: that pair).
  it.effect.prop(
    "property: a pull request with two neighbouring refusals, given the later first, is refused by every path with the earlier one's words",
    { at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: ORDER.length - 2 })) },
    ({ at }) =>
      Effect.gen(function* () {
        const [earlier, later] = [ORDER[at], ORDER[at + 1]];
        expect(earlier !== undefined && later !== undefined).toBe(true);

        for (const path of ["check", ...PATHS] as const) {
          const got = yield* walk(path, [later?.defect ?? "can", earlier?.defect ?? "can"]);

          expect(got.refused?.reason, `${path}: ${earlier?.defect} before ${later?.defect}`).toContain(
            saysFor(earlier?.says ?? "", WAY[path]),
          );
          expect(got.calls, path).toEqual([]);
        }
      }),
    { arbitrary: { seed: 2338, runs: runsFor({ fast: 60, full: 200 }) } },
  );

  // Plants: refuse a draft the path marks ready itself, or let `admin` without a wait mark one.
  it.effect(
    "scenario: a draft passes the gate for a path that marks it ready, and is refused for one that does not",
    () =>
      Effect.gen(function* () {
        const m = memory([]);
        const found = yield* (yield* PullRequests).view(1415);
        const draft = { ...found, draft: true };
        const way = Gate.Way.cases.queue.make({});
        expect(yield* Gate.before({ dir: ".", found: draft, marksReady: true, way })).toBeNull();
        expect(yield* Gate.before({ dir: ".", found: draft, marksReady: false, way })).toBe(
          "draft, not merged; refused until it is ready for review",
        );
        expect(m.github.calls).toEqual([]);
      }).pipe(Effect.provide(memory([]).layer)),
  );

  // Plant: refuse a merged pull request, so `land.ts check` fails on one and replay.ts reads every merged pull request as refused.
  it.effect(
    "scenario: a merged pull request is no refusal of the gate, which land.ts check reads and replay.ts runs it on",
    () =>
      Effect.gen(function* () {
        const found = yield* (yield* PullRequests).view(1415);
        const merged = { ...found, state: "MERGED" } as const;
        const way = Gate.Way.cases.queue.make({});
        expect(yield* Gate.before({ dir: ".", found: merged, marksReady: false, way })).toBeNull();
      }).pipe(Effect.provide(memory([]).layer)),
  );

  // Plants: ask the review check for a merged pull request first, so one that needs a review and holds none is refused; the same, for
  // each way (queue, arm, admin).
  it.effect.prop(
    "property: a merged pull request that needs a review and holds none is no refusal of the gate, whatever way it is asked",
    { way: Schema.Literals(["queue", "arm", "admin"]), changed: Changed },
    ({ way, changed }) =>
      Effect.gen(function* () {
        const found = yield* (yield* PullRequests).view(1415);

        const merged = { ...found, state: "MERGED" } as const;
        expect(yield* Gate.before({ dir: ".", found: merged, marksReady: false, way: wayFor(way) })).toBeNull();
      }).pipe(Effect.provide(memory(["unreviewed"], changed).layer)),
    { arbitrary: { seed: 2339, runs: runsFor({ fast: 40, full: 120 }) } },
  );

  // Plants, each run once and restored: read the statuses of a pull request that changes no reviewed path; read the paths twice; read the statuses
  // of another head (the base's); read no paths and treat a pull request as outside.
  it.effect.prop(
    "property: the gate reads the changed paths once, for the pull request's own head; the statuses of that head only when a path needs a review, and none for a pull request outside the reviewed paths",
    { way: Schema.Literals(["queue", "arm", "admin"]), changed: Changed, missing: Schema.Boolean },
    ({ way, changed, missing }) =>
      Effect.gen(function* () {
        const m = memory(missing ? ["unreviewed"] : [], changed);
        const needs = missing || changed.clean === "approved";

        const refusal = yield* Effect.gen(function* () {
          const found = yield* (yield* PullRequests).view(1415);

          return yield* Gate.before({
            dir: "/checkout",
            found,
            marksReady: true,
            way: wayFor(way),
          });
        }).pipe(Effect.provide(m.layer));

        expect(m.changes.calls).toEqual([{ dir: "/checkout", head: oid }]);

        // Statuses are read for a pull request that needs a review (the arm way may refuse it without reading any), never for one that does not.
        expect(needs || m.reviews.reads.length === 0, "no status is read for a pull request outside").toBe(true);
        expect(!needs || way === "arm" || m.reviews.reads.length > 0, "the statuses are read").toBe(true);
        expect(needs || refusal === null).toBe(true);
        expect(m.reviews.reads.every((head) => head === oid)).toBe(true);
      }),
    { arbitrary: { seed: 2340, runs: runsFor({ fast: 120, full: 400 }) } },
  );

  // Plants, each run once and restored: turn a failed read of the paths into no paths (a pass); turn a failed read of the statuses into
  // no approval, silently (a refusal with words and no error).
  it.effect.prop(
    "property: a read of the paths or of the statuses that fails is the gate's own error, never a pass and never a quiet refusal",
    {
      way: Schema.Literals(["queue", "arm", "admin"]),
      broken: Schema.Literals(["paths", "statuses"]),
      changed: Changed,
      needs: Schema.Boolean,
    },
    ({ way, broken, changed, needs }) =>
      Effect.gen(function* () {
        const m = memory(
          needs ? ["unreviewed"] : [],
          { ...changed, clean: "exempt" },
          broken === "paths" ? { paths: "git cannot be read" } : { read: "GitHub cannot be read" },
        );

        const result = yield* Effect.gen(function* () {
          const found = yield* (yield* PullRequests).view(1415);

          return yield* Gate.before({
            dir: ".",
            found,
            marksReady: true,
            way: wayFor(way),
          });
        }).pipe(Effect.result, Effect.provide(m.layer));

        // What the gate says: its own error for a read that failed, or, for a pull request that needs no review (so no status is read), a pass.
        // The arm way may refuse a pull request that needs one before it reads any status, so no answer is demanded of it.
        const said = Result.isFailure(result) ? result.failure._tag : result.success;
        const wanted = broken === "paths" ? "ChangesError" : !needs ? null : way === "arm" ? said : "ReviewsError";

        expect(said).toBe(wanted);
      }),
    { arbitrary: { seed: 2341, runs: runsFor({ fast: 60, full: 200 }) } },
  );

  // Plants: let the admin way pass with no reason; refuse a reason; let the queue way or `arm` take a reason; let an override status approve for
  // the queue.
  it.effect.prop(
    "property: on a pull request that needs a review and holds none, the admin way is refused with no reason and passes with one, and the queue and arm ways are refused whatever else; an override on the head approves none of them",
    {
      changed: Changed,
      reason: Schema.Literals(["sev1 fix for the red main", "a fix", "one more reason, spaced out"]),
    },
    ({ changed, reason }) =>
      Effect.gen(function* () {
        const m = memory(["unreviewed"], { ...changed, seeded: "override" });

        const asked = (way: typeof Gate.Way.Type) =>
          Effect.gen(function* () {
            const found = yield* (yield* PullRequests).view(1415);

            return yield* Gate.before({ dir: ".", found, marksReady: true, way });
          }).pipe(Effect.provide(m.layer));

        expect(yield* asked(Gate.Way.cases.admin.make({ override: null }))).toContain(NAMES.admin);
        expect(yield* asked(Gate.Way.cases.admin.make({ override: reason }))).toBeNull();
        expect(yield* asked(Gate.Way.cases.queue.make({}))).toContain(NAMES.queue);
        expect(yield* asked(Gate.Way.cases.arm.make({}))).toContain(NAMES.arm);
      }),
    { arbitrary: { seed: 2342, runs: runsFor({ fast: 30, full: 90 }) } },
  );

  // Plants: let a blank, a spaced, a broken-line or a 129-character reason through; cap it at 127 or 130.
  it.effect.prop(
    "property: a reason for an override is one trimmed line of 1 to 128 characters, and the admin way takes no other",
    {
      lead: Schema.Literals(["", "", "", " ", "\t"]),
      // Lengths at the edge of the cap are drawn as often as any other, since a cap off by one is what this law is for.
      length: Schema.Union([
        Schema.Literals([0, 1, 127, 128, 129, 130]),
        Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 140 })),
      ]),
      inner: Schema.Literals(["", "", "", " ", "\n", "\r", "\u2028", "\u2029", "é"]),
      trail: Schema.Literals(["", "", "", " ", "\n"]),
    },
    ({ lead, length, inner, trail }) =>
      Effect.sync(() => {
        const half = Math.floor(length / 2);
        const text = `${lead}${"x".repeat(half)}${inner}${"x".repeat(length - half)}${trail}`;
        const fine = text.length > 0 && text.length <= 128 && text === text.trim() && !/[\r\n\u2028\u2029]/.test(text);

        expect(Schema.is(Gate.Way.cases.admin)({ _tag: "admin", override: text })).toBe(fine);
      }),
    { arbitrary: { seed: 2343, runs: runsFor({ fast: 200, full: 400 }) } },
  );

  // Plant: say "open, into main" of a merged pull request, as the line did.
  it("vector: what a passing gate says it checked, in the order it asked, for `land.ts check` and every path to print; a merged one says so", () => {
    const checks =
      "no Plan: title; leak grep on the change and each commit; leak grep on the title and description, the pr skill's sections, ## New names, fabrika close ticket lines; every commit since main signed; a review on the head, or no path that needs one)";

    expect(Gate.line({ number: 7, state: "OPEN" })).toBe(
      `pr 7: the merge gate passes (not a can/ branch; open, into main, no conflict; ${checks}`,
    );

    expect(Gate.line({ number: 7, state: "MERGED" })).toBe(
      `pr 7: the merge gate passes (not a can/ branch; state: already merged; ${checks}`,
    );
  });

  // Plant: print the review words for an admin merge that went past a missing record on a reason.
  it("vector: the line an admin merge on a written reason prints, which names the override and does not say a review is on the head", () => {
    const line = Gate.line({ number: 7, state: "OPEN" }, true);

    expect(line).not.toContain("a review on the head");
    expect(line).toContain("no review is recorded");
    expect(line).toContain("--override-review");
    // The other checks are the same words as ever.
    expect(
      line.startsWith("pr 7: the merge gate passes (not a can/ branch; open, into main, no conflict; no Plan: title;"),
    ).toBe(true);
  });
});
