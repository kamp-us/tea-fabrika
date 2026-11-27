// Today's lead tooling. The merge gate's laws (./Gate.ts): every way of merging a pull request asks the gate first, so every path
// refuses every pull request the gate refuses, with the gate's own words, and asks GitHub for nothing then. The paths are `check`
// (the gate alone), `queue`, `run` (the queue with the quest's wait), `merge`, `merge --admin`, `admin` (with its wait) and `arm`;
// the flow's landing step is `queue` (flow/landing.ts calls `Queue.add`), and land.test.ts runs each command of the CLI on a
// pull request that holds two of these refusals. All on the test layers: nothing here asks GitHub, git, the tracker or the leak grep.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Layer, Option, Result, Schema } from "effect";
import * as ChecksTest from "../ci/ChecksTest.ts";
import * as RunsTest from "../ci/RunsTest.ts";
import * as Arm from "./Arm.ts";
import * as BranchesTest from "./BranchesTest.ts";
import * as Gate from "./Gate.ts";
import * as Merge from "./Merge.ts";
import { PullRequests } from "./PullRequests.ts";
import * as PullRequestsTest from "./PullRequestsTest.ts";
import { LeakGrepRefused } from "./Pushes.ts";
import * as PushesTest from "./PushesTest.ts";
import * as Queue from "./Queue.ts";
import * as Sections from "./Sections.ts";
import * as SignaturesTest from "./SignaturesTest.ts";
import * as TicketsTest from "./TicketsTest.ts";

const oid = "0123456789abcdef0123456789abcdef01234567";

const hit = LeakGrepRefused.make({ reason: "leakgrep.sh exited 1" });

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
]);

type Defect = typeof Defect.Type;

/** The defects in the order the gate asks them, each with a line its refusal holds: the first one a pull request has is the one it says. */
const ORDER: ReadonlyArray<{ readonly defect: Defect; readonly says: string }> = [
  { defect: "can", says: "can/ branch, never merged here" },
  { defect: "closed", says: "closed, not merged" },
  { defect: "otherBase", says: "merges into fabrikalfa/parent, not main" },
  { defect: "conflicting", says: "it conflicts with main" },
  { defect: "plan", says: "its title starts `Plan:`" },
  { defect: "leakChange", says: "leakgrep.sh exited 1" },
  { defect: "leakGrep", says: "leakgrep.sh exited 1" },
  { defect: "leakText", says: "leakgrep.sh exited 1" },
  { defect: "placeholder", says: ".agents/skills/pr/SKILL.md" },
  { defect: "noEvidence", says: ".agents/skills/pr/SKILL.md" },
  { defect: "unnamed", says: "its ## New names section does not name: newThing" },
  { defect: "ticket", says: "fabrika close ticket 9: 9 is not an open tracker ticket" },
  { defect: "unreadable", says: "git cannot be read" },
  {
    defect: "unsigned",
    says: "1 commit(s) since main are not signed or made by stepcommit.sh: abc12345 a plain commit",
  },
];

const Path = Schema.Literals(["check", "queue", "run", "merge", "mergeAdmin", "admin", "arm"]);

type Path = typeof Path.Type;

/** What the pull request is: a full body, a branch of the bot's, open, into main, and every commit vouched for, unless a defect says otherwise. */
const memory = (defects: ReadonlyArray<Defect>) => {
  const has = (defect: Defect) => defects.includes(defect);

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
    ...(has("leakChange") ? { leakChange: hit } : {}),
    ...(has("leakGrep") ? { leakGrep: hit } : {}),
    ...(has("leakText") ? { leakText: hit } : {}),
  };

  const layer = Layer.mergeAll(
    PullRequestsTest.layer(github),
    PushesTest.layer(PushesTest.remote(), failing),
    ChecksTest.layer([Option.some({ id: 1, status: "completed", conclusion: "success" })], ""),
    BranchesTest.layer({ branches: [], ahead: {}, empty: [], behind: { [oid]: 0 } }),
    RunsTest.layer(RunsTest.world()),
    TicketsTest.layer(TicketsTest.world()),
    SignaturesTest.layer({
      ...(has("unsigned") ? { unvouched: ["abc12345 a plain commit"] } : {}),
      ...(has("unreadable") ? { broken: "git cannot be read" } : {}),
    }),
  );

  return { github, layer };
};

const admin = Merge.Route.cases.admin.make({ sev0: [], sev0Fixes: [], sev1: null });

/** How one path ended on the pull request: what refused it, or `null` when nothing did, and every write it asked of GitHub. */
const walk = (path: Path, defects: ReadonlyArray<Defect>) => {
  const m = memory(defects);

  const ended = Effect.gen(function* () {
    switch (path) {
      case "check": {
        const refusal = yield* Gate.before({ dir: ".", found: yield* (yield* PullRequests).view(1415), readies: true });

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
  // refusal out of the order above; let `check` skip a check the others run.
  it.effect.prop(
    "property: whatever refusals a pull request holds, every path refuses it with the gate's own words for the first of them and asks GitHub for nothing; a pull request with none is not refused by any path, which each asks its own one write",
    { defects: Schema.Array(Defect) },
    ({ defects }) =>
      Effect.gen(function* () {
        const first = ORDER.find(({ defect }) => defects.includes(defect));
        const gate = yield* walk("check", defects);

        if (first === undefined) {
          expect(gate.refused).toBeNull();
        } else {
          expect(gate.refused?.reason).toContain(first.says);
        }

        for (const path of PATHS) {
          const got = yield* walk(path, defects);

          expect(got.refused, path).toEqual(gate.refused);
          expect(got.calls, path).toEqual(first === undefined ? WRITES[path] : []);
        }
      }),
    { arbitrary: { seed: 2337, runs: runsFor({ fast: 120, full: 400 }) } },
  );

  // Plants: refuse a draft the path marks ready itself, or let `admin` without a wait mark one.
  it.effect(
    "scenario: a draft passes the gate for a path that marks it ready, and is refused for one that does not",
    () =>
      Effect.gen(function* () {
        const m = memory([]);
        const found = yield* (yield* PullRequests).view(1415);
        const draft = { ...found, draft: true };
        expect(yield* Gate.before({ dir: ".", found: draft, readies: true })).toBeNull();
        expect(yield* Gate.before({ dir: ".", found: draft, readies: false })).toBe(
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
        expect(yield* Gate.before({ dir: ".", found: { ...found, state: "MERGED" }, readies: false })).toBeNull();
      }).pipe(Effect.provide(memory([]).layer)),
  );

  it("vector: what a passing gate says it checked, in the order it asked, for `land.ts check` to print", () => {
    expect(Gate.passed).toBe(
      "not a can/ branch; open, into main, no conflict; no Plan: title; leak grep on the change and each commit; leak grep on the title and description, the pr skill's sections, ## New names, fabrika close ticket lines; every commit since main signed",
    );
  });
});
