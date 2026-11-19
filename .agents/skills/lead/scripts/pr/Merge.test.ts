// Today's lead tooling. The laws of `land.ts merge` and of the leak gate every merge path runs
// (field/notes/2026-11-15-admin-merge-ran-past-a-leak-grep-hit.json). Merge's laws run on the test
// layers and ask GitHub nothing. The gate's process laws run the real leakgrep.sh, on a word list in
// a temp folder, and a scripts folder with no leakgrep.sh in it.
//
// R6 of docs/plan/quests/sev-runbooks-PLAN.md (0611): a sev fix is admin-merged in both levels. Assumed
// exports of Merge.ts, which the build writes:
// - `Route.cases.admin.make({ sev0, sev0Fixes, sev1 })`: `sev0` every branch an open sev0 allows (as land.ts
//   passes it today), `sev0Fixes` the ones of those that `open --allow` and `next` named, and `sev1` the one branch
//   the sev log names as the fix of a sev1, or `null`. The log can tell them apart: `open --allow` and `next`
//   write an `opened` or a `next` line, `allow` an `allowed` line. Level.ts's folded `allow` list cannot yet, which
//   is the build's to add. The plan's AdminFor reads `next` and `open --allow` as a fix, `allow` as a ready pull
//   request (0603), and this file pins that reading.
// - A fix is admitted only when its head holds origin/main's head, which Merge reads through the `Branches`
//   service (`behind(oid)` is 0 when the head holds main), beside `ci-required` and the leak gate. A ready pull
//   request in a sev0 lands with no catch-up (0603), and still needs `ci-required` green, as a sev0 branch does today.
// - `Done`'s admin case says why: `for` is `docs`, `fix` or `ready`, and `level` is `sev0` or `sev1` for a fix or a
//   ready one (the plan's "One value traced through", step 6).
// The `sev` label is no input of Merge in B1: PullRequests reads none, and the route alone grants, so a label
// alone grants nothing by construction and no law here can vary it.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { Recorder, runsFor } from "@kampus/vitest";
import { Effect, Layer, Option, Schema, Match } from "effect";
import * as ChecksTest from "../ci/ChecksTest.ts";
import * as BranchesTest from "./BranchesTest.ts";
import * as Merge from "./Merge.ts";
import * as PullRequestsGh from "./PullRequestsGh.ts";
import * as PullRequestsTest from "./PullRequestsTest.ts";
import { LeakGrepRefused, Pushes } from "./Pushes.ts";
import * as PushesProcess from "./PushesProcess.ts";
import * as PushesTest from "./PushesTest.ts";

const oid = "0123456789abcdef0123456789abcdef01234567";

const branch = "fabrikalfa/decision-1415";

const title = "Decision 0583: a room is one process";

const body = "What it decides.";

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

const Files = Schema.Literals(["docs", "code", "none"]);

const FILES = {
  docs: [".decisions/0583-a-room.md", "field/notes/2026-11-15-x.json", "docs/plan/README.md"],
  // One file that is not docs is enough, even in a docs folder.
  code: [".decisions/0583-a-room.md", "docs/tutorials/one/package.json"],
  none: [],
} as const;

type World = {
  readonly leak?: typeof Leak.Type;
  readonly files?: typeof Files.Type;
  readonly required?: "success" | "failure" | "pending";
  readonly title?: string;
  readonly head?: string;
  /** How many commits origin/main holds that the head does not; 0, the default, is a head that holds main. */
  readonly behind?: number;
};

const memory = (w: World = {}) => {
  const github = PullRequestsTest.world([{ number: 1415, head: w.head ?? branch, oid, state: "OPEN", draft: false }]);
  github.more.set(1415, { title: w.title ?? title, body });
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
  // admin-merge a pull request with one file that is not docs; admin-merge a sev0 fix on a red head.
  it.effect.prop(
    "property: GitHub's merge is asked once, pinned to the head, only when all three leak checks passed, and --admin only for a docs-only pull request or a branch an open sev0 allows whose ci-required is green",
    {
      route: Schema.Literals(["queue", "admin"]),
      leak: Leak,
      files: Files,
      sev0: Schema.Boolean,
      required: Schema.Literals(["success", "failure"]),
    },
    ({ route, leak, files, sev0, required }) =>
      Effect.gen(function* () {
        const m = memory({ leak, files, required });
        const { answer, leaks } = yield* merged(m, route === "queue" ? queue : admin(sev0 ? [branch] : []));
        const clean = leak === "clean";
        const docs = files === "docs";

        const merges =
          route === "queue" ? clean && required === "success" : clean && (docs || (sev0 && required === "success"));

        const asked = route === "queue" ? "enqueue" : "admin";
        expect(m.github.calls).toEqual(merges ? [{ _tag: asked, number: 1415, oid }] : []);
        expect(answer._tag).toBe(merges ? "Success" : "Failure");

        if (merges) {
          expect(leaks).toEqual(gate);
        }

        // An admin merge GitHub's rules would not allow refuses before any grep runs.
        if (route === "admin" && !docs && !sev0) {
          expect(leaks).toEqual([]);
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

  it.effect("scenario: a clean docs-only pull request is admin-merged at its head, and the line says why", () =>
    Effect.gen(function* () {
      const m = memory();
      const done = yield* merge(m, admin());
      expect(m.github.calls).toEqual([{ _tag: "admin", number: 1415, oid }]);
      expect(Merge.line(done)).toBe(
        `pr 1415: admin-merged at ${oid}, docs only (0183); read the push run on main next`,
      );
    }),
  );

  it.effect(
    "vector: --admin on a pull request with a file that is not docs names it and refuses; one that changes no files refuses; a `Plan:` title refuses",
    () =>
      Effect.gen(function* () {
        // The reason names the file that is not docs; which levels it says do not hold the branch is the
        // build's wording (0611 adds the sev1 fix to what 0532 said), so only the file and the pull request are read.
        const code = yield* Effect.flip(merge(memory({ files: "code" }), admin()));
        expect(code).toMatchObject({ _tag: "NotMerged" });
        expect(code.reason).toContain("pr 1415");
        expect(code.reason).toContain("docs/tutorials/one/package.json");
        const none = yield* Effect.flip(merge(memory({ files: "none" }), admin()));
        expect(none).toMatchObject({ reason: "pr 1415: it changes no files, so it is not docs only; refused" });
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

/** What the branch is to the route: the plan's AdminFor, `fix` or `ready` (0603), or nothing. */
const roleFor = (level: "sev1" | "sev0", listing: Listing) =>
  listing === "fix" ? "fix" : level === "sev0" && listing === "ready" ? "ready" : "none";

describe("merge: a sev fix is admin-merged in both levels, on current main (0611)", () => {
  // R6 of docs/plan/quests/sev-runbooks-PLAN.md. In a sev0 `sev.ts allow` lets in fixes and other ready pull
  // requests alike (0603), and the ancestor check holds for a fix only (0611): a ready pull request there lands
  // with no catch-up. Plants: drop the ancestor check (a fix whose head lacks main is admitted: red); ask the
  // ancestor check of a ready pull request too (a sev0 ready one behind main is refused: red); read the sev1 fix
  // as any branch (a sev1 that names fix y admits x); skip ci-required; admit a branch the level does not name.
  it.effect.prop(
    "property: --admin lands a code pull request only as a fix (the sev1 log's fix, or a sev0's `open --allow` or `next` branch) or a ready one (a sev0's `allow` branch); each needs ci-required green at its head and a clean leak gate, and a fix also a head that holds origin/main, a ready one no catch-up",
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
          files: "code",
          head: X,
          required: ciOk ? "success" : ci,
          leak: leakOk ? "clean" : leak,
          behind: holds ? 0 : behind,
        });

        const { answer } = yield* merged(m, routeFor(level, listing, alsoY));

        const merges = role !== "none" && ciOk && leakOk && (role === "ready" || holds);

        expect(m.github.calls).toEqual(merges ? [{ _tag: "admin", number: 1415, oid }] : []);
        expect(answer._tag).toBe(merges ? "Success" : "Failure");

        if (merges && answer._tag === "Success") {
          // Why it was allowed is the plan's AdminFor: a fix at its level, or a ready one in a sev0.
          expect(answer.success).toMatchObject({ _tag: "admin", pr: 1415, oid, for: role, level });
        }
      }),
    { arbitrary: { seed: 119120, runs: runsFor({ fast: 200, full: 600 }) } },
  );

  // Plants: give two missing parts one reason (the ancestor refusal says "not the fix"); let a failed leak
  // check refuse as NotMerged.
  it.effect.prop(
    "property: each part a fix lacks refuses on its own, at either level: not the fix, ci-required not a success, and a head behind main each give a different reason, and a leak hit is the gate's refusal",
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
          notTheFix: { route: routeFor(level, "other", false), world: {} },
          ciNotSuccess: { route: routeFor(level, "fix", false), world: { required: ci } },
          behindMain: { route: routeFor(level, "fix", false), world: { behind } },
        } as const;

        const reasons: Array<string> = [];

        for (const { route, world } of Object.values(worlds)) {
          const m = memory({ files: "code", head: X, ...world });
          const { answer } = yield* merged(m, route);
          const refused = answer._tag === "Failure" ? answer.failure : null;
          expect(refused).toMatchObject({ _tag: "NotMerged" });
          expect(m.github.calls).toEqual([]);
          reasons.push(refused !== null && "reason" in refused ? String(refused.reason) : "");
        }

        expect(new Set(reasons).size, reasons.join(" | ")).toBe(Object.keys(worlds).length);

        const hit = memory({ files: "code", head: X, leak });
        const { answer } = yield* merged(hit, routeFor(level, "fix", false));
        expect(answer._tag === "Failure" && answer.failure).toMatchObject({ _tag: "LeakGrepRefused" });
        expect(hit.github.calls).toEqual([]);
      }),
    { arbitrary: { seed: 119120, runs: runsFor({ fast: 25, full: 100 }) } },
  );

  // scenario: the cases the plan and 0611 name, so the property's chance draw is never the only proof of them.
  // Plants: refuse a sev1 fix whose head holds main (red); ask a sev0 ready pull request for the catch-up (red);
  // skip the catch-up of a sev0 fix (red).
  it.effect(
    "scenario: a sev1 fix whose head holds main, with ci-required green and a clean gate, is admin-merged at its head as a fix",
    () =>
      Effect.gen(function* () {
        const m = memory({ files: "code", head: X });
        const done = yield* merge(m, admin([], X));
        expect(done).toMatchObject({ _tag: "admin", for: "fix", level: "sev1" });
        expect(m.github.calls).toEqual([{ _tag: "admin", number: 1415, oid }]);
      }),
  );

  it.effect(
    "scenario: in a sev0, a ready pull request that `allow` added lands with no catch-up, and a fix of `open --allow` or `next` behind main does not (0603, 0611)",
    () =>
      Effect.gen(function* () {
        const ready = memory({ files: "code", head: X, behind: 4 });
        const done = yield* merge(ready, routeFor("sev0", "ready", false));
        expect(done).toMatchObject({ _tag: "admin", for: "ready", level: "sev0" });
        expect(ready.github.calls).toEqual([{ _tag: "admin", number: 1415, oid }]);

        const fix = memory({ files: "code", head: X, behind: 4 });
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
