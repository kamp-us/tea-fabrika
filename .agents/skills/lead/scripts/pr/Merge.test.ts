// Today's lead tooling. The laws of `land.ts merge` and of the leak gate every merge path runs
// (field/notes/2026-11-15-admin-merge-ran-past-a-leak-grep-hit.json). Merge's laws run on the test
// layers and ask GitHub nothing. The gate's process laws run the real leakgrep.sh, on a word list in
// a temp folder, and a scripts folder with no leakgrep.sh in it.
//
// R6 of .kalfa/quests/sev-runbooks-PLAN.md (a sev fix is admin-merged one at a time on current main): a sev fix is admin-merged in both levels. Assumed
// exports of Merge.ts, which the build writes:
// - `Route.cases.admin.make({ sev0, sev0Fixes, sev1 })`: `sev0` every branch an open sev0 allows (as land.ts
//   passes it today), `sev0Fixes` the ones of those that `open --allow` and `next` named, and `sev1` the one branch
//   the sev log names as the fix of a sev1, or `null`. The log can tell them apart: `open --allow` and `next`
//   write an `opened` or a `next` line, `allow` an `allowed` line. Level.ts's folded `allow` list cannot yet, which
//   is the build's to add. The plan's AdminFor reads `next` and `open --allow` as a fix, `allow` as a ready pull
//   request (no pull request is in a stack, and in a sev0 the lead admin-merges ready ones in order), and this file pins that reading.
// - A fix is admitted only when its head holds origin/main's head, which Merge reads through the `Branches`
//   service (`behind(oid)` is 0 when the head holds main), beside `ci-required` and the leak gate. A ready pull
//   request in a sev0 lands with no catch-up (no pull request is in a stack, and in a sev0 the lead admin-merges ready ones in order), and still needs `ci-required` green, as a sev0 branch does today.
// - `Done`'s admin case says why: `for` is `fix`, `ready` or `other`, and `level` is `sev0` or `sev1` for a fix or a
//   ready one, and `null` for any other pull request, whose line gives no reason. Every admin merge needs `ci-required` green
//   at the head, docs included.
// The `sev` label is no input of Merge in B1: PullRequests reads none, and the route alone grants, so a label
// alone grants nothing by construction and no law here can vary it.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { Recorder, runsFor } from "@kampus/vitest";
import { Effect, Fiber, Layer, Match, Option, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import { Checks } from "../ci/Checks.ts";
import * as ChecksTest from "../ci/ChecksTest.ts";
import * as BranchesTest from "./BranchesTest.ts";
import * as ChangesTest from "./ChangesTest.ts";
import * as Merge from "./Merge.ts";
import { PullRequests } from "./PullRequests.ts";
import * as PullRequestsGh from "./PullRequestsGh.ts";
import * as PullRequestsTest from "./PullRequestsTest.ts";
import { LeakGrepRefused, Pushes } from "./Pushes.ts";
import * as PushesProcess from "./PushesProcess.ts";
import * as PushesTest from "./PushesTest.ts";
import type * as Queue from "./Queue.ts";
import { Reviews } from "./Reviews.ts";
import * as ReviewsTest from "./ReviewsTest.ts";
import * as Sections from "./Sections.ts";
import * as SignaturesTest from "./SignaturesTest.ts";
import * as TicketsTest from "./TicketsTest.ts";

const oid = "0123456789abcdef0123456789abcdef01234567";

const branch = "fabrikalfa/decision-1415";

const title = "Decision 0583: a room is one process";

/** A description as the pr skill's template writes it. */
const body = "## Summary\n\nWhat it decides.\n\n## Evidence\n\nA test.\n\n## Merge Danger\n\n**Door:** two-way\n";

/** Which leak check refuses, by its method's name, or none. */
const Leak = Schema.Literals(["clean", "leakChange", "leakGrep", "leakText"]);

const hit = new LeakGrepRefused({ reason: "leakgrep.sh exited 1" });

/** The one leak check that refuses, with the error it refuses with. */
const leaking = (leak: typeof Leak.Type): PushesTest.Failing =>
  Match.value(leak).pipe(
    Match.when("clean", () => ({})),
    Match.when("leakChange", () => ({ leakChange: hit })),
    Match.when("leakGrep", () => ({ leakGrep: hit })),
    Match.orElse(() => ({ leakText: hit })),
  );

/** What the pull request changes: docs only, or code. Admin merge treats both alike. */
const Files = Schema.Literals(["docs", "code"]);

const FILES = {
  docs: [".kalfa/decisions/0583-a-room.md", "docs/plan/README.md"],
  code: [".kalfa/decisions/0583-a-room.md", "docs/tutorials/one/package.json"],
} as const;

type World = {
  readonly leak?: typeof Leak.Type;
  readonly files?: typeof Files.Type;
  readonly required?: "success" | "failure" | "pending";
  readonly title?: string;
  readonly body?: string;
  /** The one new export the diff adds, in `src/thing.ts`. */
  readonly patch?: string;
  readonly head?: string;
  /** The pull request is a draft, as one is just before the lead marks it ready. */
  readonly draft?: boolean;
  /** How many commits origin/main holds that the head does not; 0, the default, is a head that holds main. */
  readonly behind?: number;
};

const memory = (w: World = {}) => {
  const github = PullRequestsTest.world([
    { number: 1415, head: w.head ?? branch, oid, state: "OPEN", draft: w.draft ?? false },
  ]);

  github.more.set(1415, { title: w.title ?? title, body: w.body ?? body });

  if (w.patch !== undefined) {
    github.patches.set(1415, [{ path: "src/thing.ts", patch: `@@ -0,0 +1 @@\n+export const ${w.patch} = 1;` }]);
  }

  github.files.set(1415, FILES[w.files ?? "docs"]);
  const remote = PushesTest.remote();

  const job =
    w.required === "pending"
      ? { id: 1, status: "in_progress", conclusion: null }
      : { id: 1, status: "completed", conclusion: w.required ?? "success" };

  const layer = Layer.mergeAll(
    PullRequestsTest.layer(github),
    PushesTest.layer(remote, leaking(w.leak ?? "clean")),
    ChecksTest.layer([Option.some(job)], ""),
    BranchesTest.layer({ branches: [], ahead: {}, empty: [], behind: { [oid]: w.behind ?? 0 } }),
    SignaturesTest.layer(),
    ChangesTest.layer(ChangesTest.world()),
    ReviewsTest.layer(ReviewsTest.world()),
    TicketsTest.layer(TicketsTest.world()),
  );

  return { github, layer };
};

const merge = (m: ReturnType<typeof memory>, route: Merge.Route) =>
  Merge.merge({ dir: ".", pr: 1415, route }).pipe(Effect.provide(m.layer));

/** One merge, and the leak checks it asked for, read inside the layer that recorded them. */
const merged = (m: ReturnType<typeof memory>, route: Merge.Route) =>
  Effect.gen(function* () {
    const answer = yield* Effect.result(Merge.merge({ dir: ".", pr: 1415, route }));

    return { answer, leaks: yield* Recorder.calls(Pushes) };
  }).pipe(Effect.provide(m.layer));

const queue = Merge.Route.cases.queue.make({});

const admin = (sev0: ReadonlyArray<string> = [], sev1: string | null = null, sev0Fixes: ReadonlyArray<string> = []) =>
  Merge.Route.cases.admin.make({ sev0, sev0Fixes, sev1 });

/** The three leak checks, in order, as the gate runs them on pull request 1415. */
const gate = [
  { method: "leakChange", args: [".", oid] },
  { method: "leakGrep", args: [".", oid] },
  { method: "leakText", args: [".", `${title}\n\n${body}\n`] },
];

describe("merge: the lead's one way to merge by hand runs the leak gate first", () => {
  // Plants: merge before the gate, or past a refusal from it; skip the commit or the word grep;
  // admin-merge on a red or missing ci-required, docs only or not.
  it.effect.prop(
    "property: GitHub's merge is asked once, pinned to the head, only when all three leak checks passed and ci-required is green, by the queue or by --admin, whatever the files are",
    {
      route: Schema.Literals(["queue", "admin"]),
      leak: Leak,
      files: Files,
      required: Schema.Literals(["success", "failure", "pending"]),
    },
    ({ route, leak, files, required }) =>
      Effect.gen(function* () {
        const m = memory({ leak, files, required });
        const { answer, leaks } = yield* merged(m, route === "queue" ? queue : admin());
        const merges = leak === "clean" && required === "success";

        const asked = route === "queue" ? "enqueue" : "admin";
        expect(m.github.calls).toEqual(merges ? [{ _tag: asked, number: 1415, oid }] : []);
        expect(answer._tag).toBe(merges ? "Success" : "Failure");

        if (merges) {
          expect(leaks).toEqual(gate);
        }
      }),
  );

  // Plants: leave the description check out of `Merge.admin`, so `--admin` merges a placeholder body, a body missing a section, or a diff whose new name the body does not name.
  it.effect.prop(
    "property: the admin route refuses a description with the draft placeholder, a missing required section or an unnamed new export, with the same words as the queue, and asks no merge",
    {
      placeholder: Schema.Boolean,
      left: Schema.Literals(["none", "Summary", "Evidence", "Merge Danger"]),
      unnamed: Schema.Boolean,
    },
    ({ placeholder, left, unnamed }) =>
      Effect.gen(function* () {
        const kept = ["Summary", "Evidence", "Merge Danger"].filter((name) => name !== left);
        const text = `${placeholder ? `${Sections.DRAFT_BODY}\n\n` : ""}${kept.map((name) => `## ${name}\n\nWords.\n`).join("\n")}`;
        const world = { body: text, ...(unnamed ? { patch: "newThing" } : {}) };
        const bad = placeholder || left !== "none" || unnamed;

        for (const route of [queue, admin()]) {
          const m = memory(world);
          const { answer } = yield* merged(m, route);

          expect(answer._tag).toBe(bad ? "Failure" : "Success");

          if (bad) {
            const reason = answer._tag === "Failure" ? String(answer.failure.reason) : "";

            expect(reason).toContain(placeholder || left !== "none" ? ".agents/skills/pr/SKILL.md" : "new names");
            expect(m.github.calls).toEqual([]);
          }
        }
      }),
  );

  // Plant: read only the change, as the 2026-11-15 shell line read only the description, or the reverse.
  it.effect(
    "scenario: a leak word in the description refuses --admin on a docs-only pull request, and nothing merges",
    () =>
      Effect.gen(function* () {
        const m = memory({ leak: "leakText" });
        const { answer, leaks } = yield* merged(m, admin());
        expect(answer._tag === "Failure" && answer.failure).toMatchObject({ _tag: "LeakGrepRefused" });
        expect(leaks).toEqual(gate);
        expect(m.github.calls).toEqual([]);
      }),
  );

  it.effect("scenario: a leak word in a commit refuses, with or without --admin, and nothing merges", () =>
    Effect.gen(function* () {
      for (const route of [queue, admin()]) {
        const m = memory({ leak: "leakGrep" });
        const { answer, leaks } = yield* merged(m, route);
        expect(answer._tag === "Failure" && answer.failure).toMatchObject({ _tag: "LeakGrepRefused" });
        expect(leaks).toEqual(gate.slice(0, 2));
        expect(m.github.calls).toEqual([]);
      }
    }),
  );

  it.effect(
    "scenario: a clean pull request with ci-required green is admin-merged at its head, code or docs, and the line says only what happened",
    () =>
      Effect.gen(function* () {
        for (const files of ["code", "docs"] as const) {
          const m = memory({ files });
          const done = yield* merge(m, admin());
          expect(done).toMatchObject({ _tag: "admin", for: "other", level: null });
          expect(m.github.calls).toEqual([{ _tag: "admin", number: 1415, oid }]);
          expect(Merge.line(done)).toBe(`pr 1415: admin-merged at ${oid}; read the push run on main next`);
        }
      }),
  );

  it.effect(
    "scenario: --admin on a red or missing ci-required refuses with the check's name, for code and for docs, and nothing merges",
    () =>
      Effect.gen(function* () {
        for (const files of ["code", "docs"] as const) {
          for (const required of ["failure", "pending"] as const) {
            const m = memory({ files, required });
            const refused = yield* Effect.flip(merge(m, admin()));
            expect(refused).toMatchObject({ _tag: "NotMerged" });
            expect(refused.reason).toContain("pr 1415");
            expect(refused.reason).toContain("not a success; not merged");
            expect(m.github.calls).toEqual([]);
          }
        }
      }),
  );

  it.effect("scenario: --admin on a pull request with no ci-required job at its head refuses as missing", () =>
    Effect.gen(function* () {
      const m = memory();
      const none = Layer.mergeAll(m.layer, ChecksTest.layer([Option.none()], ""));

      const refused = yield* Effect.flip(
        Merge.merge({ dir: ".", pr: 1415, route: admin() }).pipe(Effect.provide(none)),
      );

      expect(refused.reason).toContain("is missing at");
      expect(m.github.calls).toEqual([]);
    }),
  );

  it.effect("scenario: a `Plan:` title refuses --admin", () =>
    Effect.gen(function* () {
      const plan = yield* Effect.flip(merge(memory({ title: "Plan: a room" }), admin()));
      expect(plan.reason).toContain("its title starts `Plan:`");
    }),
  );

  it("vector: the admin merge call is the queue's pinned squash with --admin and nothing else", () => {
    expect(PullRequestsGh.adminArgs("o/r", 1415, oid)).toEqual([
      "pr",
      "merge",
      "1415",
      "-R",
      "o/r",
      "--squash",
      "--match-head-commit",
      oid,
      "--admin",
    ]);
  });
});

const X = "fabrikalfa/sev-fix-x";

const Y = "fabrikalfa/sev-fix-y";

/** How the route names pull request 1415's branch (X): as the fix, as a ready pull request, or not at all. */
const Listing = Schema.Literals(["fix", "ready", "other", "none"]);

type Listing = typeof Listing.Type;

/**
 * The route a level gives, as land.ts reads it from the sev log. In a sev1 the log names one fix. In a sev0 the
 * allow list holds every branch `open --allow`, `next` and `allow` named, and `fixes` are those `open --allow` and
 * `next` named: `allow` adds a ready pull request. A sev0 outranks a sev1, so an open sev0 leaves `sev1` null.
 */
const routeFor = (level: "sev1" | "sev0", listing: Listing, alsoY: boolean) => {
  if (level === "sev1") {
    return admin([], listing === "fix" ? X : listing === "other" ? Y : null);
  }

  const others = alsoY ? [Y] : [];

  return listing === "fix"
    ? admin([X, ...others], null, [X])
    : listing === "ready"
      ? admin([X, ...others], null, others)
      : listing === "other"
        ? admin([Y], null, alsoY ? [Y] : [])
        : admin([], null, []);
};

/** What the branch is to the route: `fix` or `ready`, and any other branch is `other`. */
const roleFor = (level: "sev1" | "sev0", listing: Listing) =>
  listing === "fix" ? "fix" : level === "sev0" && listing === "ready" ? "ready" : "other";

describe("merge: a sev fix is admin-merged in both levels, on current main", () => {
  // R6 of .kalfa/quests/sev-runbooks-PLAN.md. In a sev0 `sev.ts allow` lets in fixes and other ready pull
  // requests alike (no pull request is in a stack, and in a sev0 the lead admin-merges ready ones in order), and the ancestor check holds for a fix only (a sev fix is admin-merged one at a time on current main): a ready pull request there lands
  // with no catch-up. Plants: drop the ancestor check (a fix whose head lacks main is admitted: red); ask the
  // ancestor check of a ready pull request too (a sev0 ready one behind main is refused: red); read the sev1 fix
  // as any branch (a sev1 that names fix y admits x); skip ci-required; ask the catch-up of a branch the level does not name as a fix.
  it.effect.prop(
    "property: --admin lands a pull request as a fix (the sev1 log's fix, or a sev0's `open --allow` or `next` branch), a ready one (a sev0's `allow` branch) or any other pull request; each needs ci-required green at its head and a clean leak gate, and a fix also a head that holds origin/main, the others no catch-up",
    {
      level: Schema.Literals(["sev1", "sev0"]),
      listing: Listing,
      // A second branch listed beside this one in a sev0, which must not change what happens to this one.
      alsoY: Schema.Boolean,
      // The parts that are wrong in this run, none to two of them, so a single missing part is reached often.
      faults: Schema.Array(Schema.Literals(["ci", "leak", "behind"])).check(Schema.isMaxLength(2)),
      behind: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9 })),
      ci: Schema.Literals(["failure", "pending"]),
      leak: Schema.Literals(["leakChange", "leakGrep", "leakText"]),
    },
    ({ level, listing, alsoY, faults, behind, ci, leak }) =>
      Effect.gen(function* () {
        const role = roleFor(level, listing);
        const holds = !faults.includes("behind");
        const ciOk = !faults.includes("ci");
        const leakOk = !faults.includes("leak");

        const m = memory({
          head: X,
          required: ciOk ? "success" : ci,
          leak: leakOk ? "clean" : leak,
          behind: holds ? 0 : behind,
        });

        const { answer } = yield* merged(m, routeFor(level, listing, alsoY));

        const merges = ciOk && leakOk && (role !== "fix" || holds);

        expect(m.github.calls).toEqual(merges ? [{ _tag: "admin", number: 1415, oid }] : []);
        expect(answer._tag).toBe(merges ? "Success" : "Failure");

        if (merges && answer._tag === "Success") {
          // Why it was allowed: a fix at its level, a ready one in a sev0, or neither, with no level.
          expect(answer.success).toMatchObject({
            _tag: "admin",
            pr: 1415,
            oid,
            for: role,
            level: role === "other" ? null : level,
          });
        }
      }),
    { arbitrary: { seed: 119120, runs: runsFor({ fast: 200, full: 600 }) } },
  );

  // Plants: give two missing parts one reason (the ancestor refusal says "not the fix"); let a failed leak
  // check refuse as NotMerged.
  it.effect.prop(
    "property: each part a fix lacks refuses on its own, at either level: ci-required not a success and a head behind main give different reasons, and a leak hit is the gate's refusal",
    {
      level: Schema.Literals(["sev1", "sev0"]),
      ci: Schema.Literals(["failure", "pending"]),
      behind: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9 })),
      leak: Schema.Literals(["leakChange", "leakGrep", "leakText"]),
    },
    ({ level, ci, behind, leak }) =>
      Effect.gen(function* () {
        // The one thing that is wrong in each world; every other part is right for the fix.
        const worlds = {
          ciNotSuccess: { route: routeFor(level, "fix", false), world: { required: ci } },
          behindMain: { route: routeFor(level, "fix", false), world: { behind } },
        } as const;

        const reasons: Array<string> = [];

        for (const { route, world } of Object.values(worlds)) {
          const m = memory({ head: X, ...world });
          const { answer } = yield* merged(m, route);
          const refused = answer._tag === "Failure" ? answer.failure : null;
          expect(refused).toMatchObject({ _tag: "NotMerged" });
          expect(m.github.calls).toEqual([]);
          reasons.push(refused !== null && "reason" in refused ? String(refused.reason) : "");
        }

        expect(new Set(reasons).size, reasons.join(" | ")).toBe(Object.keys(worlds).length);

        const hit = memory({ head: X, leak });
        const { answer } = yield* merged(hit, routeFor(level, "fix", false));
        expect(answer._tag === "Failure" && answer.failure).toMatchObject({ _tag: "LeakGrepRefused" });
        expect(hit.github.calls).toEqual([]);
      }),
    { arbitrary: { seed: 119120, runs: runsFor({ fast: 25, full: 100 }) } },
  );

  // scenario: the cases the plan and the sev-fix rule name, so the property's chance draw is never the only proof of them.
  // Plants: refuse a sev1 fix whose head holds main (red); ask a sev0 ready pull request for the catch-up (red);
  // skip the catch-up of a sev0 fix (red).
  it.effect(
    "scenario: a sev1 fix whose head holds main, with ci-required green and a clean gate, is admin-merged at its head as a fix",
    () =>
      Effect.gen(function* () {
        const m = memory({ head: X });
        const done = yield* merge(m, admin([], X));
        expect(done).toMatchObject({ _tag: "admin", for: "fix", level: "sev1" });
        expect(m.github.calls).toEqual([{ _tag: "admin", number: 1415, oid }]);
      }),
  );

  it.effect(
    "scenario: in a sev0, a ready pull request that `allow` added lands with no catch-up, and a fix of `open --allow` or `next` behind main does not (no pull request is in a stack, and in a sev0 the lead admin-merges ready ones in order; a sev fix is admin-merged one at a time on current main)",
    () =>
      Effect.gen(function* () {
        const ready = memory({ head: X, behind: 4 });
        const done = yield* merge(ready, routeFor("sev0", "ready", false));
        expect(done).toMatchObject({ _tag: "admin", for: "ready", level: "sev0" });
        expect(ready.github.calls).toEqual([{ _tag: "admin", number: 1415, oid }]);

        const fix = memory({ head: X, behind: 4 });
        expect(yield* Effect.flip(merge(fix, routeFor("sev0", "fix", false)))).toMatchObject({ _tag: "NotMerged" });
        expect(fix.github.calls).toEqual([]);
      }),
  );
});

describe("the leak gate's process: the real leakgrep.sh, whose exit code decides", () => {
  const scripts = import.meta.dirname.replace(/\/pr$/, "");
  const planted = "plantedleakgate1415";
  let dir = "";

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const words = () => {
    dir = mkdtempSync(join(tmpdir(), "leakgate-"));
    writeFileSync(join(dir, "words"), `${planted}\n`);
    vi.stubEnv("FABRIKA_LEAK_WORDS", join(dir, "words"));
  };

  const withPushes = <A, E>(use: (p: Pushes["Service"]) => Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      return yield* use(yield* Pushes);
    });

  const pushes = (at: string) => Effect.provide(Layer.provide(PushesProcess.layer(at), NodeServices.layer));

  // Plant: read leakgrep.sh's output or ignore its exit code, as the 2026-11-15 shell line did.
  it.effect(
    "scenario: a description with a leak word makes leakgrep.sh exit non-zero, and the words check refuses",
    () =>
      Effect.gen(function* () {
        words();
        const grep = (text: string) => Effect.result(withPushes((p) => p.leakText(import.meta.dirname, text)));
        const hit = yield* grep(`${title}\n\nIt names ${planted} once.\n`).pipe(pushes(scripts));
        expect(hit._tag === "Failure" && hit.failure.reason).toMatch(/^leakgrep\.sh --text exited [1-9]/);
        // The reason names only the kind, never the word.
        expect(hit._tag === "Failure" && hit.failure.reason.includes(planted)).toBe(false);
        const clean = yield* grep(`${title}\n\n${body}\n`).pipe(pushes(scripts));
        expect(clean._tag).toBe("Success");
      }),
  );

  // Plant: count a grep that could not start, or exited 127, as a pass.
  it.effect("scenario: a leak grep that cannot run refuses the words and the commits, never passes them", () =>
    Effect.gen(function* () {
      words();
      const missing = join(dir, "no-scripts-here");

      const text = yield* Effect.result(withPushes((p) => p.leakText(import.meta.dirname, `${title}\n`))).pipe(
        pushes(missing),
      );

      const commits = yield* Effect.result(withPushes((p) => p.leakGrep(import.meta.dirname, "HEAD"))).pipe(
        pushes(missing),
      );

      for (const ran of [text, commits]) {
        expect(ran._tag === "Failure" && ran.failure._tag).toBe("LeakGrepRefused");
      }
    }),
  );
});

const poll = (status: "in_progress" | "success" | "failure") =>
  Option.some(
    status === "in_progress" ? { id: 1, status, conclusion: null } : { id: 1, status: "completed", conclusion: status },
  );

/** One admin merge with a wait, on checks that answer these polls, and the time it was given to finish. */
const waited = (m: ReturnType<typeof memory>, polls: ReadonlyArray<ChecksTest.Poll>, every = 10) =>
  Effect.gen(function* () {
    const fiber = yield* Merge.merge({ dir: ".", pr: 1415, route: admin(), wait: { minutes: 5, every } }).pipe(
      Effect.provide(Layer.merge(m.layer, ChecksTest.layer(polls, ""))),
      Effect.result,
      Effect.forkChild,
    );

    yield* TestClock.adjust("6 minutes");

    return yield* Fiber.join(fiber);
  });

describe("merge: land.ts admin never merges ahead of ci-required, a can/ branch or a leak hit", () => {
  // Plants: ask GitHub's merge while the check is missing or running (the 2026-11-22 shell chain);
  // mark a draft ready before the leak gate or a can/ refusal; merge a can/ branch; read the check once
  // after marking ready, so a check that has not registered yet is a refusal; drop the wait's limit.
  it.effect.prop(
    "property: a draft is marked ready, then GitHub's merge is asked once, pinned to the head, only once ci-required has appeared, ended and succeeded, and never for a can/ branch or a leak hit",
    {
      draft: Schema.Boolean,
      can: Schema.Boolean,
      leak: Leak,
      before: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
      running: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
      end: Schema.Literals(["success", "failure", "never"]),
    },
    ({ draft, can, leak, before, running, end }) =>
      Effect.gen(function* () {
        const m = memory({ draft, leak, head: can ? "can/theirs" : branch });

        const polls = [
          ...Array.from({ length: before }, () => Option.none()),
          ...Array.from({ length: running }, () => poll("in_progress")),
          poll(end === "never" ? "in_progress" : end),
        ];

        const answer = yield* waited(m, polls);
        const refusedEarly = can || leak !== "clean";
        const merges = !refusedEarly && end === "success";

        expect(answer._tag).toBe(merges ? "Success" : "Failure");

        expect(m.github.calls).toEqual([
          ...(draft && !refusedEarly ? [{ _tag: "ready", number: 1415 }] : []),
          ...(merges ? [{ _tag: "admin", number: 1415, oid }] : []),
        ]);
      }),
    { arbitrary: { seed: 1249, runs: runsFor({ fast: 60, full: 200 }) } },
  );

  // Plant: let a draft through without a wait, which the check of a ready pull request cannot have registered for.
  it.effect("scenario: without a wait a draft is refused and not marked ready, as before", () =>
    Effect.gen(function* () {
      const m = memory({ draft: true });
      const refused = yield* Effect.flip(merge(m, admin()));
      expect(refused.reason).toContain("draft, not merged");
      expect(m.github.calls).toEqual([]);
    }),
  );

  // Plant: pin the merge to the head read before the wait.
  it.effect("scenario: a push during the wait moves the head, and nothing is merged", () =>
    Effect.gen(function* () {
      const m = memory();
      const moved = "f".repeat(40);

      const checks = Layer.succeed(
        Checks,
        Checks.of({
          job: () =>
            Effect.sync(() => {
              m.github.prs[0] = { ...m.github.prs[0]!, oid: moved };

              return poll("success");
            }),
          log: () => Effect.succeed(""),
        }),
      );

      const fiber = yield* Merge.merge({ dir: ".", pr: 1415, route: admin(), wait: { minutes: 5, every: 60 } }).pipe(
        Effect.provide(Layer.merge(m.layer, checks)),
        Effect.flip,
      );

      expect(fiber.reason).toContain(`its head moved from ${oid} to ${moved}`);
      expect(m.github.calls).toEqual([]);
    }),
  );
});

describe("merge: admin merges only the head the gate read", () => {
  /** Whatever a push does to the pull request, from the point the layer names: its head is `moved` from then on. */
  const pushed = (m: ReturnType<typeof memory>, at: "queue" | "ready") =>
    Layer.effect(
      PullRequests,
      Effect.map(PullRequests, (prs) => {
        const move = Effect.sync(() => {
          m.github.prs[0] = { ...m.github.prs[0]!, oid: "f".repeat(40) };
        });

        return PullRequests.of({
          ...prs,
          ...(at === "queue" ? { queue: Effect.tap(prs.queue, () => move) } : {}),
          ...(at === "ready" ? { ready: (n: number) => Effect.tap(prs.ready(n), () => move) } : {}),
        });
      }),
    ).pipe(Layer.provide(m.layer));

  // Plant: re-read the pull request after the queue read or after marking it ready and pin the merge to the new head, as `Merge.admin` did, so a push after the gate is merged unread.
  it.effect.prop(
    "property: a push after the gate read the head, during the queue read or when the draft is marked ready, makes an admin merge refuse with the moved head and ask for no merge",
    { at: Schema.Literals(["queue", "ready"]) },
    ({ at }) =>
      Effect.gen(function* () {
        const m = memory({ draft: at === "ready" });

        const refused = yield* Merge.merge({
          dir: ".",
          pr: 1415,
          route: admin(),
          wait: { minutes: 5, every: 60 },
        }).pipe(Effect.provide(Layer.merge(m.layer, pushed(m, at))), Effect.flip);

        expect(refused.reason).toContain(`its head moved from ${oid} to ${"f".repeat(40)} after the gate read it`);
        expect(m.github.calls.filter((call) => call._tag === "admin")).toEqual([]);
      }),
  );
});

/** An entry of the merge queue, as GitHub lists it. */
const entry = (number: number, state = "AWAITING_CHECKS") => ({ number, state });

describe("merge: an admin merge waits for the merge queue to empty (2026-11-22: three restarts of one entry's build in six minutes)", () => {
  const Role = Schema.Literals(["other", "fix", "ready"]);

  const routeAs = (role: typeof Role.Type) =>
    role === "fix" ? admin([], branch) : role === "ready" ? admin([branch]) : admin();

  /** One admin merge on a queue that answers these reads, with or without a queue wait, and 61 minutes for it to finish. */
  const queued = (
    m: ReturnType<typeof memory>,
    reads: ReadonlyArray<ReadonlyArray<ReturnType<typeof entry>>>,
    role: typeof Role.Type,
    queueWait: Queue.Wait | undefined,
    extra: Layer.Layer<never> = Layer.empty,
  ) =>
    Effect.gen(function* () {
      m.github.queue.push(...reads);

      const fiber = yield* Merge.merge({
        dir: ".",
        pr: 1415,
        route: routeAs(role),
        wait: { minutes: 5, every: 10 },
        ...(queueWait ? { queueWait } : {}),
      }).pipe(Effect.provide(Layer.merge(m.layer, extra)), Effect.result, Effect.forkChild);

      yield* TestClock.adjust("61 minutes");

      return yield* Fiber.join(fiber);
    });

  const everyMinute: Queue.Wait = { minutes: 60, every: 60 };

  // Plants: admin-merge with an entry in the queue; give a sev fix or a sev0's ready pull request the wait (it is never
  // slowed); read the queue once with a wait; count the pull request's own entry; read a queue that failed to read as empty;
  // drop the wait's limit.
  it.effect.prop(
    "property: an admin merge of a pull request that is no fix and no sev0 ready one is asked only once the queue holds no other entry (read again with a wait, once without one); a fix or a sev0's ready one never waits on it",
    {
      role: Role,
      busy: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
      end: Schema.Literals(["empty", "never"]),
      waits: Schema.Boolean,
      own: Schema.Boolean,
    },
    ({ role, busy, end, waits, own }) =>
      Effect.gen(function* () {
        const m = memory({ head: branch });
        const mine = own ? [entry(1415, "QUEUED")] : [];

        const reads = [
          ...Array.from({ length: busy }, () => [entry(1922), ...mine]),
          end === "empty" ? mine : [entry(1922), ...mine],
        ];

        const answer = yield* queued(m, reads, role, waits ? everyMinute : undefined);

        const clear = role !== "other" || (waits ? end === "empty" : busy === 0 && end === "empty");

        expect(answer._tag).toBe(clear ? "Success" : "Failure");
        expect(m.github.calls).toEqual(clear ? [{ _tag: "admin", number: 1415, oid }] : []);

        if (!clear && answer._tag === "Failure") {
          expect(String(answer.failure.reason)).toContain("pr 1922 is in the merge queue (AWAITING_CHECKS)");
          expect(String(answer.failure.reason)).toContain("restarts its build");
        }
      }),
    { arbitrary: { seed: 1122, runs: runsFor({ fast: 60, full: 200 }) } },
  );

  // Plants: mark the draft ready before the queue is empty (the ready run is thrown away when the entry restarts it); mark it
  // ready while no run has started at its head (a ready event seconds after a push starts a second run on one commit, and the
  // required check stays expected); read the head's run once.
  it.effect(
    "scenario: a draft is marked ready neither while the queue holds an entry nor before a run has started at its head",
    () =>
      Effect.gen(function* () {
        const crowded = memory({ draft: true });
        const held = yield* queued(crowded, [[entry(1922)]], "other", everyMinute);
        expect(held._tag).toBe("Failure");
        expect(crowded.github.calls).toEqual([]);

        const later = memory({ draft: true });

        const eventually = yield* queued(
          later,
          [[entry(1922)], []],
          "other",
          everyMinute,
          ChecksTest.layer([Option.some({ id: 1, status: "completed", conclusion: "success" })], "", [
            false,
            false,
            true,
          ]),
        );

        expect(eventually._tag).toBe("Success");

        expect(later.github.calls).toEqual([
          { _tag: "ready", number: 1415 },
          { _tag: "admin", number: 1415, oid },
        ]);

        const unstarted = memory({ draft: true });

        const stuck = yield* queued(
          unstarted,
          [],
          "other",
          undefined,
          ChecksTest.layer([Option.some({ id: 1, status: "completed", conclusion: "success" })], "", [false]),
        );

        expect(stuck._tag === "Failure" ? String(stuck.failure.reason) : "").toContain(
          `no CI run has started at ${oid}`,
        );
        expect(unstarted.github.calls).toEqual([]);
      }),
  );

  // Plant: a queue that cannot be read reads as an empty one.
  it.effect("scenario: a queue that cannot be read refuses, with or without a wait, and nothing is merged", () =>
    Effect.gen(function* () {
      for (const queueWait of [undefined, everyMinute]) {
        const m = memory();

        const answer = yield* queued(
          m,
          [],
          "other",
          queueWait,
          PullRequestsTest.layer(m.github, { queue: "gh: offline" }),
        );

        expect(answer._tag === "Failure" ? String(answer.failure.reason) : "").toContain("gh: offline");
        expect(m.github.calls).toEqual([]);
      }
    }),
  );

  it.effect("scenario: without a wait the refusal says how to wait", () =>
    Effect.gen(function* () {
      const m = memory();
      const answer = yield* queued(m, [[entry(1922, "LOCKED")]], "other", undefined);
      expect(answer._tag === "Failure" ? String(answer.failure.reason) : "").toContain("--wait");
    }),
  );
});

// ---------------------------------------------------------------------------------------------------------
// R10: the admin override (slice 2 of .kalfa/quests/review-record-PLAN.md)
// ---------------------------------------------------------------------------------------------------------

/** A word the leak grep refuses in these laws, so a reason holding it is refused by the grep on the override's words and by nothing else. */
const PLANTED_WORD = "plantedleakword2338";

const ReasonKey = Schema.Literals([
  "none",
  "good",
  "short",
  "edge",
  "leaky",
  "blank",
  "spaces",
  "tab",
  "lineBreak",
  "twoLines",
  "lineSeparator",
  "paragraphSeparator",
  "padded",
  "long",
]);

type ReasonKey = typeof ReasonKey.Type;

/** The reasons an admin merge is given: none, and each shape of a good or a bad one. */
const REASONS: Record<ReasonKey, string | null> = {
  none: null,
  good: "sev1 fix for the red main",
  short: "x",
  edge: "z".repeat(128),
  leaky: `words ${PLANTED_WORD} here`,
  blank: "",
  spaces: "   ",
  tab: "\t",
  lineBreak: "\n",
  twoLines: "a\nb",
  lineSeparator: "a\u2028b",
  paragraphSeparator: "a\u2029b",
  padded: " padded ",
  long: "y".repeat(129),
};

/** A reason is one trimmed line of 1 to 128 characters. */
const goodReason = (text: string | null): text is string =>
  text !== null && text.length > 0 && text.length <= 128 && text === text.trim() && !/[\r\n\u2028\u2029]/.test(text);

const CHANGED = {
  docs: ["docs/plan/README.md"],
  code: ["kalfa/git/a.ts", "docs/b.md"],
  // The move: the old path is inside a reviewed folder and the new one is outside it, so only the old half names the tree.
  move: ["next/old.ts", "docs/new.md"],
} as const;

const OverrideCase = Schema.Struct({
  paths: Schema.Literals(["docs", "code", "move"]),
  approved: Schema.Boolean,
  reason: ReasonKey,
  /** What refuses the merge after the gate passed, if anything: a red check, a busy queue, a fix behind main. */
  after: Schema.Literals(["none", "none", "none", "red", "queueBusy", "behindFix"]),
  /** Whether the head moves, and from which read of the pull request on. */
  moves: Schema.Boolean,
  moveAt: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 8 })),
  failing: Schema.Literals(["none", "none", "none", "comment", "status", "squash"]),
});

type OverrideCase = typeof OverrideCase.Type;

const OTHER_HEAD = "f".repeat(40);

/**
 * One admin merge on pull request 1415 with a reason (or none), over a head that changes these paths and may hold an approval. An order log
 * keeps every read of the pull request, the override's write and the pinned squash, in the order they happened across the two services.
 */
const overriding = (c: OverrideCase) => {
  const github = PullRequestsTest.world([{ number: 1415, head: branch, oid, state: "OPEN", draft: false }]);
  github.more.set(1415, { title, body });

  if (c.after === "queueBusy") {
    github.queue.push([{ number: 99, state: "QUEUED" }]);
  }

  const changes = ChangesTest.world({ [oid]: CHANGED[c.paths] });
  const reviews = ReviewsTest.world();

  if (c.approved) {
    ReviewsTest.seed(reviews, oid, {
      id: 1,
      creator: "lead",
      state: "success",
      description: `pass v1 reviewed=${oid} patch=${oid}`,
      url: null,
    });
  }

  const order: Array<string> = [];

  const pulls = Layer.effect(
    PullRequests,
    Effect.gen(function* () {
      const inner = yield* PullRequests;
      let views = 0;

      return PullRequests.of({
        ...inner,
        view: (n) =>
          Effect.map(inner.view(n), (found) => {
            views += 1;
            const seen = c.moves && views >= c.moveAt ? OTHER_HEAD : found.oid;
            order.push(`view:${seen}`);

            return { ...found, oid: seen };
          }),
        admin: (n, at) => Effect.tap(inner.admin(n, at), () => Effect.sync(() => order.push(`admin:${at}`))),
      });
    }),
  ).pipe(
    Layer.provide(PullRequestsTest.layer(github, c.failing === "squash" ? { admin: "the squash was refused" } : {})),
  );

  const overrides = Layer.effect(
    Reviews,
    Effect.gen(function* () {
      const inner = yield* Reviews;

      return Reviews.of({
        ...inner,
        write: (pr, record, url) =>
          Effect.andThen(
            Effect.sync(() => order.push("override")),
            inner.write(pr, record, url),
          ),
      });
    }),
  ).pipe(
    Layer.provide(
      ReviewsTest.layer(
        reviews,
        c.failing === "comment" ? { comment: "gh is down" } : c.failing === "status" ? { status: "no right" } : {},
      ),
    ),
  );

  const pushes = Recorder.layer(Pushes, {
    leakGrep: () => Effect.void,
    leakChange: () => Effect.void,
    leakText: (_dir, text) => (text.includes(PLANTED_WORD) ? Effect.fail(hit) : Effect.void),
    push: () => Effect.void,
  });

  const layer = Layer.mergeAll(
    pulls,
    overrides,
    ChangesTest.layer(changes),
    pushes,
    ChecksTest.layer(
      [Option.some({ id: 1, status: "completed", conclusion: c.after === "red" ? "failure" : "success" })],
      "",
    ),
    BranchesTest.layer({ branches: [], ahead: {}, empty: [], behind: { [oid]: c.after === "behindFix" ? 3 : 0 } }),
    SignaturesTest.layer(),
    TicketsTest.layer(TicketsTest.world()),
  );

  return { github, reviews, order, layer };
};

describe("R10: an admin merge past a missing review is written down first, and only as the last step before the squash", () => {
  // Plants, each run once and restored: write the override right after the gate (before the reads that follow it); write it after the merge;
  // trim nothing, so spaces pass; drop the 128 cap; write an override for a pull request that holds an approval; swallow a failed write;
  // skip the leak grep on the reason; write one for a pull request that needs no review; let a bad reason through the gate.
  it.effect.prop(
    "property: an admin merge of a pull request that needs a review and holds none needs a good reason, writes exactly one override (the comment, then a `failure` status holding the reason) as the step just before the pinned squash, and writes nothing when anything refuses before that; one with an approval or no reviewed path writes none",
    OverrideCase.fields,
    (c) =>
      Effect.gen(function* () {
        const reason = REASONS[c.reason];
        const needs = c.paths !== "docs";
        const writes = needs && !c.approved;

        // Only a pull request that writes one has any use for a reason; a bad or a leaky one beside an approval is no case of this law.
        if (!writes && reason !== null && (!goodReason(reason) || c.reason === "leaky")) {
          return;
        }

        const m = overriding(c);

        const answer = yield* Effect.result(
          Merge.merge({
            dir: ".",
            pr: 1415,
            route:
              c.after === "behindFix"
                ? Merge.Route.cases.admin.make({ sev0: [], sev0Fixes: [], sev1: branch })
                : Merge.Route.cases.admin.make({ sev0: [], sev0Fixes: [], sev1: null }),
            ...(reason === null ? {} : { override: reason }),
          }).pipe(Effect.provide(m.layer)),
        );

        const wrote = m.reviews.calls.map((call) => call._tag);
        const merged = m.github.calls.length > 0;
        const at = m.order.indexOf("override");

        // Whatever happened: an override is the step before the squash, so no read of the pull request follows it, and every read before it saw the head the gate read.
        if (at >= 0) {
          expect(
            m.order.slice(at + 1).every((entry) => entry.startsWith("admin:")),
            m.order.join(" "),
          ).toBe(true);
          expect(
            m.order.slice(0, at).every((entry) => entry === `view:${oid}`),
            m.order.join(" "),
          ).toBe(true);
        }

        // A merge at a head that is not the one the gate read, or with no override where one was due, never happens.
        expect(m.github.calls.every((call) => call.oid === oid)).toBe(true);
        expect(m.order.filter((entry) => entry === "override").length).toBeLessThanOrEqual(1);

        if (writes && !goodReason(reason)) {
          expect(Result.isFailure(answer) && answer.failure._tag).toBe("NotMerged");
          expect(wrote).toEqual([]);
          expect(merged).toBe(false);

          return;
        }

        if (merged) {
          expect(wrote).toEqual(writes ? ["comment", "status"] : []);
        }

        if (writes && merged) {
          const [commented, statused] = m.reviews.calls;
          expect(commented).toMatchObject({ _tag: "comment", pr: 1415 });
          expect(commented?._tag === "comment" && commented.body).toContain(reason);
          expect(statused).toMatchObject({
            _tag: "status",
            head: oid,
            state: "failure",
            description: `override v1 ${reason}`,
          });
          expect(m.order.slice(-2)).toEqual(["override", `admin:${oid}`]);
        }

        // With nothing broken, the merge happens: the path, the reason and the approval alone decide. A head that moves may stop it at a read
        // this law cannot count, so then only a merge is checked: it came with nothing broken.
        const leaks = writes && c.reason === "leaky";
        const brokenWrite = writes && (c.failing === "comment" || c.failing === "status");
        const squashFails = c.failing === "squash";
        // Nothing before the squash refuses: it is asked, and so the override, if one is due, is written first.
        const reachesSquash = c.after === "none" && !leaks && !brokenWrite;
        const fine = reachesSquash && !squashFails;

        if (c.moves) {
          expect(!Result.isSuccess(answer) || fine).toBe(true);
        } else {
          expect(
            Result.isSuccess(answer),
            `${JSON.stringify(c)}: ${Result.isFailure(answer) ? JSON.stringify(answer.failure) : ""}`,
          ).toBe(fine);
        }

        if (Result.isSuccess(answer) && answer.success._tag === "admin") {
          expect(answer.success.override).toBe(writes ? reason : null);

          if (writes) {
            expect(Merge.line(answer.success)).toContain(reason ?? "");
          }
        }

        // A squash that fails after the override was written: the override stays (written once, as the step before it), nothing merged, and
        // the refusal names the override, so no one reads the red status on the head as a merge that happened.
        if (!c.moves && reachesSquash && squashFails) {
          expect(merged).toBe(false);
          expect(wrote).toEqual(writes ? ["comment", "status"] : []);

          if (writes) {
            expect(Result.isFailure(answer) && answer.failure._tag).toBe("NotMerged");
            expect(Result.isFailure(answer) ? String(answer.failure.reason) : "").toContain(reason ?? "");
          }
        }

        // A refusal before the squash leaves nothing written and nothing merged; a leak in the reason is the grep's own refusal.
        if (!reachesSquash && !brokenWrite) {
          expect(merged).toBe(false);
          expect(wrote).toEqual([]);
        }

        if (leaks && c.after === "none" && !c.moves) {
          expect(Result.isFailure(answer) && answer.failure._tag).toBe("LeakGrepRefused");
        }

        if (brokenWrite && !leaks && c.after === "none" && !c.moves) {
          expect(merged).toBe(false);
          expect(wrote).toEqual(c.failing === "status" ? ["comment"] : []);
        }
      }),
    { arbitrary: { seed: 2338, runs: runsFor({ fast: 200, full: 400 }) } },
  );

  // Plant: always send the override, so an admin merge of a docs-only pull request is given a `failure` status it never needed.
  it.effect(
    "scenario: an admin merge of a docs-only pull request needs no reason and writes no override, with or without one",
    () =>
      Effect.gen(function* () {
        for (const reason of [undefined, "sev1 fix for the red main"]) {
          const m = overriding({
            paths: "docs",
            approved: false,
            reason: "none",
            after: "none",
            moves: false,
            moveAt: 2,
            failing: "none",
          });

          const done = yield* Merge.merge({
            dir: ".",
            pr: 1415,
            route: admin(),
            ...(reason === undefined ? {} : { override: reason }),
          }).pipe(Effect.provide(m.layer));

          expect(done).toMatchObject({ _tag: "admin", override: null });
          expect(m.reviews.calls).toEqual([]);
          expect(m.github.calls).toEqual([{ _tag: "admin", number: 1415, oid }]);
        }
      }),
  );
});
