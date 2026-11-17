import { NodeServices } from "@effect/platform-node";
// Today's lead tooling. Arm's laws on the test layers: nothing here asks GitHub. The red run is
// run 43776563690 on fabrikalfa/p34c-s4 as GitHub served it on 2026-11-15, its jobs and steps
// trimmed to the fields read (../ci/fixtures/run-43776563690-jobs.json), and lines of its red leg's
// log (../ci/fixtures/run-43776563690-next-2.log): one leg's vitest step failed, and that leg's stop
// step canceled the other nine, so the run's own conclusion reads `cancelled`.
import { describe, expect, it } from "@effect/vitest";
import { Recorder } from "@kampus/vitest";
import { Effect, Layer, Schema } from "effect";
import { FileSystem } from "effect";
import * as ChecksTest from "../ci/ChecksTest.ts";
import { type Job, type Run, Runs } from "../ci/Runs.ts";
import * as RunsGh from "../ci/RunsGh.ts";
import * as RunsTest from "../ci/RunsTest.ts";
import * as Arm from "./Arm.ts";
import * as PullRequestsTest from "./PullRequestsTest.ts";
import { LeakGrepRefused, Pushes } from "./Pushes.ts";
import * as PushesTest from "./PushesTest.ts";

const oid = "e42d1dce6a74f4ccb246ed19b4db04ad72c0d899";

const older = "0123456789abcdef0123456789abcdef01234567";

const branch = "fabrikalfa/p34c-s4";

const repo = "fixture/repo";

const RED = 43776563690;

const fixtures = `${import.meta.dirname}/../ci/fixtures`;

/** The fixture files, read once per law through the platform's file system. */
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const jobs = yield* RunsGh.jobsIn(yield* fs.readFileString(`${fixtures}/run-${RED}-jobs.json`));
  const log = yield* fs.readFileString(`${fixtures}/run-${RED}-next-2.log`);

  return { jobs, log };
}).pipe(Effect.provide(NodeServices.layer));

/** The same jobs as a branch run that went green: every job a success, the report too. */
const allGreen = (jobs: ReadonlyArray<Job>): ReadonlyArray<Job> =>
  jobs.map((job) => ({ ...job, conclusion: "success" }));

/** A job of a run in today's shape (0590), with no step: only its name and how it ended are read. */
const job = (id: number, name: string, conclusion: string): Job => ({
  id,
  name,
  status: "completed",
  conclusion,
  steps: [],
});

/**
 * A green proof run's jobs, by what `select` chose: the full set on `tests`, a changed set on
 * `changed`, or a changed set of zero files, with no leg. The matrix it did not start is one skipped
 * job with no leg in its name, as GitHub lists it.
 */
const shaped = (kind: "full" | "changed" | "zero", report = "success"): ReadonlyArray<Job> => [
  job(1, "gate", "success"),
  job(2, "select", "success"),
  ...(kind === "full"
    ? [job(3, "tests (1)", "success"), job(4, "tests (tooling-1)", "success")]
    : [job(3, "tests", "skipped")]),
  ...(kind === "changed"
    ? [job(5, "changed (1)", "success"), job(6, "changed (2)", "success")]
    : [job(5, "changed", "skipped")]),
  job(7, "report", report),
];

/** How the branch's full runs stand, as a law sets them: at the head, or only at an older head. */
const Stands = Schema.Literals([
  "green",
  "red",
  "in_progress",
  "queued",
  "none",
  "older",
  "older_red",
  "older_running",
]);

type Stands = typeof Stands.Type;

type World = {
  readonly branch?: string;
  readonly head?: string;
  readonly stands?: Stands;
  readonly state?: "OPEN" | "CLOSED" | "MERGED";
  readonly draft?: boolean;
  readonly base?: string;
  readonly title?: string;
  readonly files?: ReadonlyArray<string>;
  /** The jobs of the run that is read, for a law that builds its own. */
  readonly jobs?: ReadonlyArray<Job>;
  readonly automatic?: ReadonlyArray<Run>;
  readonly automaticJobs?: ReadonlyArray<Job>;
  /** Which leak check refuses, as PushesTest.layer takes it; none when absent. */
  readonly leak?: PushesTest.Failing;
};

const memory = (w: World, red: { readonly jobs: ReadonlyArray<Job>; readonly log: string }) => {
  const name = w.branch ?? branch;
  const head = w.head ?? oid;

  const github = PullRequestsTest.world([
    { number: 1092, head: name, oid: head, state: w.state ?? "OPEN", draft: w.draft ?? false },
  ]);

  github.more.set(1092, {
    base: w.base ?? "main",
    title: w.title ?? "Per-program quotas, in next/ (P34c slice 4)",
    mergeCommit: w.state === "MERGED" ? older : null,
  });
  github.files.set(1092, w.files ?? ["next/apps/fabrika/src/worker-quotas.ts"]);
  const actions = RunsTest.world();
  const stands = w.stands ?? "green";
  const run = (head: string, status: string, conclusion: string | null): Run => ({ id: RED, head, status, conclusion });

  const runs: Record<Stands, ReadonlyArray<Run>> = {
    green: [run(head, "completed", "success")],
    red: [run(head, "completed", "cancelled")],
    in_progress: [run(head, "in_progress", null)],
    queued: [run(head, "queued", null)],
    none: [],
    older: [run(older, "completed", "success")],
    older_red: [run(older, "completed", "cancelled")],
    older_running: [run(older, "in_progress", null)],
  };

  actions.runs.set(name, runs[stands]);
  const isRed = stands === "red" || stands === "older_red";
  actions.jobs.set(RED, w.jobs ?? (isRed ? red.jobs : allGreen(red.jobs)));
  const remote = PushesTest.remote();

  const layer = Layer.mergeAll(
    PullRequestsTest.layer(github),
    PushesTest.layer(remote, w.leak),
    Layer.effect(
      Runs,
      Effect.map(Runs, (scheduled) =>
        Runs.of({
          ...scheduled,
          on: (workflow, branch) => {
            if (workflow === Arm.WORKFLOW) {
              return scheduled.on(workflow, branch);
            }

            actions.asked.push(`runs ${workflow} ${branch}`);

            return Effect.succeed(w.automatic ?? []);
          },
        }),
      ),
    ).pipe(Layer.provide(RunsTest.layer(actions))),
    ChecksTest.layer([], red.log),
  );

  for (const run of w.automatic ?? []) {
    actions.jobs.set(run.id, w.automaticJobs ?? []);
  }

  return { github, actions, layer };
};

const arm = (m: ReturnType<typeof memory>) => Arm.arm({ repo, dir: ".", pr: 1092 }).pipe(Effect.provide(m.layer));

/** One arm, and the leak checks it asked for, read inside the layer that recorded them. */
const armed = (m: ReturnType<typeof memory>) =>
  Effect.gen(function* () {
    const answer = yield* Effect.result(Arm.arm({ repo, dir: ".", pr: 1092 }));

    return { answer, leaks: yield* Recorder.calls(Pushes) };
  }).pipe(Effect.provide(m.layer));

/** Which leak check refuses, by its method's name, or none. */
const Leak = Schema.Literals(["clean", "leakChange", "leakGrep", "leakText"]);

const hit = LeakGrepRefused.make({ reason: "leakgrep.sh exited 1" });

/** The one leak check that refuses, with the error it refuses with. */
const leaking = (leak: typeof Leak.Type): PushesTest.Failing =>
  leak === "clean"
    ? {}
    : leak === "leakChange"
      ? { leakChange: hit }
      : leak === "leakGrep"
        ? { leakGrep: hit }
        : { leakText: hit };

const armedAt = [{ _tag: "arm", number: 1092, oid }];

describe("arm: merge when ready goes on over a green full run, or none at the head as 0544 allows", () => {
  // scenario: the run that was read as "the queue canceled it" twice on 2026-11-15.
  it.effect(
    "scenario: run 43776563690, one leg's vitest step failed and the other nine canceled, refuses; it names the red leg's failed step and failing tests, and arms nothing",
    () =>
      Effect.gen(function* () {
        const red = yield* fixture;
        const m = memory({ stands: "red" }, red);
        const refused = yield* Effect.flip(arm(m));
        expect(refused._tag).toBe("NotArmed");
        expect(m.github.calls).toEqual([]);
        expect(refused.reason.split("\n")[0]).toBe(
          `pr 1092: at this head: the full run https://github.com/${repo}/actions/runs/${RED} is not green on every job:`,
        );
        // The red leg comes first, right under the run's line.
        expect(refused.reason.split("\n")[1]).toBe("  next (2): cancelled, failed step: vitest");
        expect(refused.reason).toContain(
          "  tooling (1): cancelled, no step failed (stopped by a red leg's stop step, or at its time limit)",
        );
        expect(refused.reason).toContain("    Test Files  2 failed | 58 passed (60)");
        expect(refused.reason).toContain(
          "    FAIL   next-integration  next/apps/fabrika/src/worker-quotas.integration.test.ts > scenario: Q13 writes, one program refuses or faults while another remains writable",
        );
        // Every one of the ten jobs is named: none of them is green.
        expect(red.jobs.filter((job) => refused.reason.includes(`  ${job.name}: `))).toHaveLength(10);
      }),
  );

  // scenario: each run that is there and not green, at the head or at an older head.
  it.effect(
    "scenario: a run at the head that is queued or in progress, and with none at the head an older head's run that is red or in progress, each refuse with a line saying which, and arm nothing",
    () =>
      Effect.gen(function* () {
        const red = yield* fixture;
        const url = `https://github.com/${repo}/actions/runs/${RED}`;

        const said = {
          in_progress: `pr 1092: at this head: the full run ${url} is in_progress, not ended; arm it once it is green`,
          queued: `pr 1092: at this head: the full run ${url} is queued, not ended; arm it once it is green`,
          older_red: `pr 1092: no full run at this head, and at the older head ${older.slice(0, 12)}: the full run ${url} is not green on every job:`,
          older_running: `pr 1092: no full run at this head, and at the older head ${older.slice(0, 12)}: the full run ${url} is in_progress, not ended; arm it once it is green`,
        } as const;

        for (const [stands, line] of Object.entries(said)) {
          const m = memory({ stands: stands as keyof typeof said }, red);
          const refused = yield* Effect.flip(arm(m));
          expect(refused.reason.split("\n")[0]).toBe(line);
          expect(m.github.calls).toEqual([]);
        }
      }),
  );

  // vector: 0544's path, word for word: no run at the head arms, with one line and the way to start one.
  it.effect(
    "vector: no full run arms with the 0544 line and the preflight command; a green run at an older head arms with the same line; a docs pull request's line says it starts no full run",
    () =>
      Effect.gen(function* () {
        const red = yield* fixture;
        const head = oid.slice(0, 12);
        const tail = `merge when ready on at ${oid}, a squash: GitHub queues it once ci-required is green there`;
        const none = memory({ stands: "none" }, red);
        expect(Arm.line(yield* arm(none))).toBe(
          `pr 1092: no full run at ${head}; arming as 0544 allows (before starting one: node .agents/skills/lead/scripts/ci/preflight.ts --repo ${repo} --branch ${branch} --head ${oid}); ${tail}`,
        );
        const stale = memory({ stands: "older" }, red);
        expect(Arm.line(yield* arm(stale))).toBe(
          `pr 1092: no full run at ${head}, and the newest one, ${RED} at the older head ${older.slice(0, 12)}, was green; arming as 0544 allows (before starting one: node .agents/skills/lead/scripts/ci/preflight.ts --repo ${repo} --branch ${branch} --head ${oid}); ${tail}`,
        );
        const docs = memory({ stands: "none", files: ["docs/plan/README.md", ".glossary/TERMS.md"] }, red);
        expect(Arm.line(yield* arm(docs))).toBe(
          `pr 1092: no full run at ${head}; arming as 0544 allows (a docs pull request, only .decisions/, docs/, field/, .glossary/, .runbooks/ files, starts no full run); ${tail}`,
        );
        expect([...none.github.calls, ...stale.github.calls, ...docs.github.calls]).toEqual([
          ...armedAt,
          ...armedAt,
          ...armedAt,
        ]);
      }),
  );

  // Plant: preflight the old fixed branch instead of the PR branch; generated requests must expose it.
  it.effect.prop(
    "property: new-proof guidance refuses an old workflow while existing head evidence keeps its meaning",
    {
      branch: Schema.String.check(Schema.isPattern(/^fabrikalfa\/[a-z][a-z0-9_-]{0,24}$/)),
      head: Schema.String.check(
        Schema.isPattern(/^[0-9a-f]{40}$/),
        Schema.makeFilter((head) => head !== older),
      ),
      reason: Schema.NonEmptyString,
    },
    ({ branch, head, reason }) =>
      Effect.gen(function* () {
        const red = yield* fixture;
        const missing = memory({ stands: "none", branch, head }, red);
        missing.actions.preflight = reason;
        const line = Arm.line(yield* arm(missing));
        expect(line).toContain(`new proof unavailable: ${reason}`);
        expect(line.replace(`new proof unavailable: ${reason}`, "")).not.toContain("workflow run");
        expect(missing.actions.asked).toEqual([
          `runs scheduled.yaml ${branch}`,
          `runs check.yaml ${branch}`,
          `preflight ${branch} ${head}`,
        ]);
        expect(missing.github.calls).toEqual([{ _tag: "arm", number: 1092, oid: head }]);

        const existing = memory({ stands: "green", jobs: shaped("changed"), branch, head }, red);
        existing.actions.preflight = reason;
        expect(Arm.line(yield* arm(existing))).toContain(
          `changed-set run ${RED} green on every job at ${head.slice(0, 12)}`,
        );
        expect(existing.actions.asked).toEqual([`runs scheduled.yaml ${branch}`, `jobs ${RED}`]);
        expect(existing.github.calls).toEqual([{ _tag: "arm", number: 1092, oid: head }]);

        const stale = memory({ stands: "older", jobs: shaped("changed"), branch, head }, red);
        stale.actions.preflight = reason;
        expect((yield* Effect.flip(arm(stale))).reason).toContain(`new proof unavailable: ${reason}`);
        expect(stale.github.calls).toEqual([]);
      }),
  );

  // scenario: the green path, as the lead runs it on a reviewed draft.
  it.effect(
    "scenario: a draft whose full run is green on every job is marked ready, then armed pinned to its head",
    () =>
      Effect.gen(function* () {
        const red = yield* fixture;
        const m = memory({ stands: "green", draft: true }, red);
        const armed = yield* arm(m);
        expect(m.github.calls).toEqual([{ _tag: "ready", number: 1092 }, ...armedAt]);
        expect(Arm.line(armed)).toBe(
          `pr 1092: full run ${RED} green on every job at ${oid.slice(0, 12)}; marked ready; merge when ready on at ${oid}, a squash: GitHub queues it once ci-required is green there`,
        );
        expect(m.actions.asked).toEqual([`runs scheduled.yaml ${branch}`, `jobs ${RED}`]);
      }),
  );

  // Plants: arm on the run's top line; let a skip pass on any job; refuse a head with no run (0544);
  // arm over a red or unfinished run at the head, or over an older head's run that is not green; arm
  // a plan or a closed one.
  it.effect.prop(
    "property: it arms exactly when the pull request is open, into main and no `Plan:`, and the run it is judged by is green on every job, or there is no full run on the branch at all; it then arms once, at the head",
    {
      stands: Stands,
      state: Schema.Literals(["OPEN", "CLOSED"]),
      base: Schema.Literals(["main", "fabrikalfa/parent"]),
      plan: Schema.Boolean,
      docsOnly: Schema.Boolean,
      skipped: Schema.Literals(["none", "report", "tooling (1)"]),
    },
    ({ stands, state, base, plan, docsOnly, skipped }) =>
      Effect.gen(function* () {
        const red = yield* fixture;
        // Every job a success, or one skipped that no run skips by design: the report, which runs on
        // every branch run since pull request 1404, or a leg.
        const withSkip = red.jobs.map((job) => ({ ...job, conclusion: job.name === skipped ? "skipped" : "success" }));
        const isRed = stands === "red" || stands === "older_red";

        const m = memory(
          {
            stands,
            state,
            base,
            title: plan ? "Plan: per-program quotas" : "Per-program quotas",
            files: docsOnly ? [".decisions/0573-x.md", "field/notes/x.json"] : ["docs/x.md", "next/x.ts"],
            jobs: isRed ? red.jobs : withSkip,
          },
          red,
        );

        const answer = yield* Effect.result(arm(m));
        const open = state === "OPEN" && base === "main" && !plan;
        const green = (stands === "green" || stands === "older") && skipped === "none";
        const arms = open && (green || stands === "none");
        expect(m.github.calls).toEqual(arms ? armedAt : []);
        expect(answer._tag).toBe(arms ? "Success" : "Failure");
      }),
  );

  // 0590: a branch's proof run tests the full set or the changed set. Plants, each run once on
  // Arm.ts and restored: `kind` reads every run as full (red: the changed-set run at the older head
  // arms); a changed-set run at an older head arms with the note as a full one does (red: the same);
  // the report skips by design, as before pull request 1404 (red: the runs with a skipped report arm).
  it.effect(
    "scenario: a changed-set run green at the head arms, and one at an older head refuses, a zero-file set included; a full run of today's shape at an older head still arms with 0544's note",
    () =>
      Effect.gen(function* () {
        const red = yield* fixture;
        const head = oid.slice(0, 12);
        const url = `https://github.com/${repo}/actions/runs/${RED}`;

        for (const kind of ["changed", "zero"] as const) {
          const at = memory({ stands: "green", jobs: shaped(kind) }, red);
          expect(Arm.line(yield* arm(at)), kind).toBe(
            `pr 1092: changed-set run ${RED} green on every job at ${head}, the tests this change reaches (0590); merge when ready on at ${oid}, a squash: GitHub queues it once ci-required is green there`,
          );
          expect(at.github.calls, kind).toEqual(armedAt);

          const stale = memory({ stands: "older", jobs: shaped(kind) }, red);
          const refused = yield* Effect.flip(arm(stale));
          expect(refused.reason, kind).toBe(
            `pr 1092: no full run at this head, and at the older head ${older.slice(0, 12)}: the changed-set run ${url} tested that head's change, not this one (0590); before starting one: node .agents/skills/lead/scripts/ci/preflight.ts --repo ${repo} --branch ${branch} --head ${oid}`,
          );
          expect(stale.github.calls, kind).toEqual([]);
        }

        const full = memory({ stands: "older", jobs: shaped("full") }, red);
        expect(Arm.line(yield* arm(full))).toBe(
          `pr 1092: no full run at ${head}, and the newest one, ${RED} at the older head ${older.slice(0, 12)}, was green; arming as 0544 allows (before starting one: node .agents/skills/lead/scripts/ci/preflight.ts --repo ${repo} --branch ${branch} --head ${oid}); merge when ready on at ${oid}, a squash: GitHub queues it once ci-required is green there`,
        );
        const fullAt = memory({ stands: "green", jobs: shaped("full") }, red);
        expect(Arm.line(yield* arm(fullAt))).toContain(`full run ${RED} green on every job at ${head}`);
      }),
  );

  it.effect(
    "scenario: a run whose report failed, was canceled or never ran refuses at the head, whatever its matrices did",
    () =>
      Effect.gen(function* () {
        const red = yield* fixture;

        for (const report of ["failure", "skipped", "cancelled"]) {
          for (const kind of ["full", "changed", "zero"] as const) {
            const m = memory({ stands: "green", jobs: shaped(kind, report) }, red);
            const refused = yield* Effect.flip(arm(m));
            expect(refused.reason, `${kind} ${report}`).toContain("is not green on every job:");
            expect(refused.reason, `${kind} ${report}`).toContain(`  report: ${report}`);
            expect(m.github.calls).toEqual([]);
          }
        }
      }),
  );

  it("vector: a run's kind is full when a leg of the full set ran, of today's shape or the older two-job one, and changed otherwise", () => {
    expect(Arm.kind(shaped("full"))).toBe("full");
    expect(Arm.kind(shaped("changed"))).toBe("changed");
    expect(Arm.kind(shaped("zero"))).toBe("changed");
    expect(Arm.kind([job(1, "next (2)", "success"), job(2, "tooling (1)", "success")])).toBe("full");
    expect(Arm.kind([job(1, "tests", "skipped"), job(2, "changed (1)", "success")])).toBe("changed");
  });

  // vector: a plan's pull request, and a merged one.
  it.effect(
    "vector: a `Plan:` title refuses over a green run; a merged one says where it merged and arms nothing",
    () =>
      Effect.gen(function* () {
        const red = yield* fixture;
        const plan = memory({ title: "Plan: per-program quotas" }, red);
        const refused = yield* Effect.flip(arm(plan));
        expect(refused.reason).toContain("pr 1092: its title starts `Plan:`");
        const done = memory({ state: "MERGED" }, red);
        expect(Arm.line(yield* arm(done))).toBe(`pr 1092: already merged at ${older}`);
        expect([...plan.github.calls, ...done.github.calls]).toEqual([]);
      }),
  );
  // Plants: skip the names check, or run it after the arm.
  it.effect(
    "scenario: a green pull request whose diff exports a name its description does not name is refused with that name and arms nothing; with the line it arms (0587)",
    () =>
      Effect.gen(function* () {
        const red = yield* fixture;

        const patch = {
          path: "next/apps/fabrika/src/worker-quotas.ts",
          patch: "@@ -0,0 +1 @@\n+export const Quota = 1;",
        };

        const bare = memory({}, red);
        bare.github.patches.set(1092, [patch]);
        const refused = yield* Effect.flip(arm(bare));
        expect(refused.reason).toContain(
          "pr 1092: its diff exports new names its ## New names section does not name: Quota",
        );
        expect(bare.github.calls).toEqual([]);
        const named = memory({}, red);
        named.github.more.set(1092, {
          ...named.github.more.get(1092),
          body: "## New names\n\n- `Quota`: a quota (source).",
        });
        named.github.patches.set(1092, [patch]);
        yield* arm(named);
        expect(named.github.calls).toEqual(armedAt);
      }),
  );

  // Plants: turn merge when ready on before the leak gate, or past a refusal from it; skip the
  // grep of the commits or of the words. The hit on 2026-11-15 was in a description.
  it.effect.prop(
    "property: over a green full run it arms only when the leak grep passed on the change, each commit and the title and description; a refusal from any of them, or a grep that could not run, arms nothing",
    { leak: Leak },
    ({ leak }) =>
      Effect.gen(function* () {
        const red = yield* fixture;
        const m = memory({ stands: "green", draft: true, leak: leaking(leak) }, red);
        const { answer, leaks } = yield* armed(m);
        expect(m.github.calls).toEqual(leak === "clean" ? [{ _tag: "ready", number: 1092 }, ...armedAt] : []);
        expect(answer._tag === "Failure" && answer.failure._tag).toBe(leak === "clean" ? false : "LeakGrepRefused");

        const ran = [
          { method: "leakChange", args: [".", oid] },
          { method: "leakGrep", args: [".", oid] },
          { method: "leakText", args: [".", "Per-program quotas, in next/ (P34c slice 4)\n\n\n"] },
        ];

        expect(leaks).toEqual(ran.slice(0, { clean: 3, leakChange: 1, leakGrep: 2, leakText: 3 }[leak]));
      }),
  );
});

const automaticRun = (head: string, id = RED + 1): Run => ({
  id,
  head,
  status: "completed",
  conclusion: "success",
  source: { event: "pull_request", path: ".github/workflows/check.yaml", repository: 7, headRepository: 7 },
});

const automaticJobs = (count: number): ReadonlyArray<Job> => [
  job(101, "changes", "success"),
  job(102, "select", "success"),
  ...(count === 0
    ? [job(103, "related", "skipped")]
    : Array.from({ length: count }, (_, i) => job(103 + i, `related (${i + 1})`, "success"))),
  job(120, "ci-required", "success"),
];

const Head = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));

const automaticFixture = { jobs: shaped("changed"), log: "" };

describe("automatic ready CI as the current-head resource proof", () => {
  // Plant owed on CI: omit the automatic lookup; older changed/red history would refuse again.
  it.effect.prop(
    "property: complete ready CI, including an explicitly empty related set, supersedes older scheduled history and arms the exact head",
    {
      head: Head,
      count: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9 })),
      stands: Schema.Literals(["older", "older_red", "older_running", "none"]),
    },
    ({ head, count, stands }) =>
      Effect.gen(function* () {
        const run = automaticRun(head);
        const m = memory(
          {
            head,
            stands,
            jobs: stands === "older_red" ? [job(1, "tests (1)", "failure")] : shaped("changed"),
            automatic: [automaticRun(`other-${head}`, run.id + 1), run],
            automaticJobs: automaticJobs(count),
          },
          automaticFixture,
        );
        const answer = yield* arm(m);
        expect(answer._tag).toBe("armed");
        expect(m.github.calls).toEqual([{ _tag: "arm", number: 1092, oid: head }]);
        expect(m.actions.asked).toEqual([
          `runs scheduled.yaml ${branch}`,
          `runs check.yaml ${branch}`,
          `jobs ${run.id}`,
        ]);
      }),
  );

  // Plant owed on CI: trust ci-required alone, omit source checks, or accept one passing matrix leg.
  it.effect.prop(
    "property: legacy, draft, foreign, incomplete and malformed automatic evidence cannot replace the older changed-set refusal",
    { head: Head, repository: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000000 })) },
    ({ head, repository }) =>
      Effect.gen(function* () {
        const run = automaticRun(head);
        const source = {
          event: "pull_request",
          path: ".github/workflows/check.yaml",
          repository,
          headRepository: repository,
        };
        const good = automaticJobs(2);
        const replace = (name: string, conclusion: string) =>
          good.map((j) => (j.name === name ? { ...j, conclusion } : j));
        const candidates: ReadonlyArray<{ readonly run: Run; readonly jobs: ReadonlyArray<Job> }> = [
          { run: { id: run.id, head, status: "completed", conclusion: "success" }, jobs: good },
          ...[
            { ...source, event: "push" },
            { ...source, path: ".github/workflows/legacy.yaml" },
            { ...source, headRepository: repository + 1 },
            { ...source, repository: 0, headRepository: 0 },
            { ...source, repository: -1, headRepository: -1 },
            { ...source, repository: Number.MAX_SAFE_INTEGER + 1, headRepository: Number.MAX_SAFE_INTEGER + 1 },
          ].map((source) => ({ run: { ...run, source }, jobs: good })),
          { run: { ...run, head: `other-${head}` }, jobs: good },
          { run, jobs: [job(1, "ci-required", "success")] },
          { run, jobs: [...good.filter((j) => j.name !== "ci-required"), job(1, "ci-required (draft)", "success")] },
          { run, jobs: good.filter((j) => j.name !== "ci-required") },
          { run, jobs: replace("ci-required", "skipped") },
          { run, jobs: replace("ci-required", "failure") },
          { run, jobs: good.map((j) => (j.name === "ci-required" ? { ...j, status: "in_progress" } : j)) },
          { run, jobs: replace("select", "skipped") },
          { run, jobs: good.filter((j) => j.name !== "select") },
          { run, jobs: automaticJobs(0).filter((j) => j.name !== "related") },
          { run, jobs: replace("related (2)", "failure") },
          { run, jobs: replace("related (2)", "skipped") },
          { run, jobs: good.map((j) => (j.name === "related (2)" ? { ...j, name: "related (3)" } : j)) },
          { run, jobs: [...good, job(200, "related (10)", "success")] },
          { run, jobs: [...good, job(200, "related (2)", "success")] },
          { run, jobs: [...good, job(200, "related", "skipped")] },
          { run, jobs: good.map((j) => (j.name === "related (2)" ? { ...j, status: "queued" } : j)) },
          { run: { ...run, conclusion: "failure" }, jobs: good },
        ];

        for (const candidate of candidates) {
          const m = memory(
            { head, stands: "older", automatic: [candidate.run], automaticJobs: candidate.jobs },
            automaticFixture,
          );
          expect((yield* Effect.result(arm(m)))._tag).toBe("Failure");
          expect(m.github.calls).toEqual([]);
        }
      }),
  );

  // Plant owed on CI: treat a missing required job as absent proof and arm through the no-run fallback.
  it.effect.prop(
    "property: incomplete new-route coverage explicitly refuses even with no scheduled history",
    { head: Head, missing: Schema.Literals(["select", "ci-required", "related (1)"]) },
    ({ head, missing }) =>
      Effect.gen(function* () {
        const run = automaticRun(head);
        const m = memory(
          { head, stands: "none", automatic: [run], automaticJobs: automaticJobs(1).filter((j) => j.name !== missing) },
          automaticFixture,
        );
        const refused = yield* Effect.flip(arm(m));
        expect(refused.reason).toContain(`/actions/runs/${run.id}`);
        expect(m.github.calls).toEqual([]);
      }),
  );

  // Plant owed on CI: let a failed completed run reach the markerless legacy fallback.
  it.effect.prop(
    "property: a completed failed automatic run refuses with empty or markerless jobs despite absent or green older scheduled history",
    { head: Head, conclusion: Schema.NullOr(Schema.Literals(["failure", "cancelled", "timed_out"])) },
    ({ head, conclusion }) =>
      Effect.gen(function* () {
        const run = { ...automaticRun(head), conclusion };

        for (const stands of ["none", "older"] as const) {
          for (const automaticJobs of [[], [job(1, "ci-required", "success")]]) {
            const m = memory({ head, stands, jobs: shaped("full"), automatic: [run], automaticJobs }, automaticFixture);
            const refused = yield* Effect.flip(arm(m));
            expect(refused.reason).toContain(`/actions/runs/${run.id}`);
            expect(m.github.calls).toEqual([]);
            expect(m.actions.asked).not.toContain(`jobs ${RED}`);
          }
        }
      }),
  );

  // Plant owed on CI: choose the newest successful run instead of the newest exact-head run.
  it.effect.prop(
    "property: a newer red or unfinished ready run refuses explicitly instead of falling back to an older green run",
    { head: Head, status: Schema.Literals(["completed", "queued", "in_progress"]), visible: Schema.Boolean },
    ({ head, status, visible }) =>
      Effect.gen(function* () {
        const newest = {
          ...automaticRun(head, RED + 2),
          status,
          conclusion: status === "completed" ? "failure" : null,
        };
        const m = memory(
          {
            head,
            stands: "none",
            automatic: [automaticRun(head), newest],
            automaticJobs: status === "completed" || visible ? automaticJobs(1) : [],
          },
          automaticFixture,
        );
        const refused = yield* Effect.flip(arm(m));
        expect(refused.reason).toContain(`/actions/runs/${newest.id}`);
        expect(m.github.calls).toEqual([]);
        expect(m.actions.asked).not.toContain(`jobs ${RED + 1}`);
      }),
  );

  // Plant owed on CI: read automatic CI before the scheduled run at the current head.
  it.effect.prop(
    "property: a current-head scheduled red or unfinished run still refuses despite green automatic CI",
    { head: Head, stands: Schema.Literals(["red", "queued", "in_progress"]) },
    ({ head, stands }) =>
      Effect.gen(function* () {
        const m = memory(
          {
            head,
            stands,
            jobs: [job(1, "tests (1)", "failure")],
            automatic: [automaticRun(head)],
            automaticJobs: automaticJobs(1),
          },
          automaticFixture,
        );
        yield* Effect.flip(arm(m));
        expect(m.github.calls).toEqual([]);
        expect(m.actions.asked).not.toContain(`runs check.yaml ${branch}`);
      }),
  );
});

describe("failingLines: what a red leg's log says failed, cut to a readable size", () => {
  // vector: the red leg of run 43776563690, colors and times taken off, counts first.
  it.effect(
    "vector: run 43776563690's red leg gives its counts, its two FAIL lines, its two × lines and its marked error",
    () =>
      Effect.gen(function* () {
        const { log } = yield* fixture;
        expect(Arm.failingLines(log)).toEqual([
          " Test Files  2 failed | 58 passed (60)",
          "      Tests  2 failed | 530 passed | 1 skipped (533)",
          " FAIL   next-integration  next/apps/fabrika/src/worker-quotas.integration.test.ts > scenario: Q13 writes, one program refuses or faults while another remains writable",
          " FAIL   next-integration  next/apps/fabrika/src/worker-supervision.integration.test.ts > ticket 402: P34 supervision on the real Worker path > scenario: ticket 646 plant (ignore the marker, refuse ...",
          "     × scenario: ticket 646 plant (ignore the marker, refuse a live name, count one attempt twice): workerd killed inside a step refuses one letter, restarts once and accepts its one resend 8670ms",
          "   × scenario: Q13 writes, one program refuses or faults while another remains writable 12909ms",
          "AssertionError: expected { _tag: 'between' } to deeply equal { _tag: 'inside', letter: 'k-10' }",
        ]);
      }),
  );

  // property: the size limit holds on any log.
  it.prop(
    "property: it gives at most 16 lines of at most 200 characters each, for any number of FAIL lines",
    { count: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 60 })) },
    ({ count }) => {
      const log = Array.from({ length: count }, (_, i) => ` FAIL  file-${i}.test.ts > ${"law ".repeat(80)}`).join("\n");
      const lines = Arm.failingLines(log);
      expect(lines.length).toBeLessThanOrEqual(16);
      expect(lines.every((line) => line.length <= 200)).toBe(true);
    },
  );

  // scenario: a leg that broke before any test ran still says something.
  it("scenario: a log with no test lines gives its last lines that are not empty", () => {
    const log = ["2026-11-15T00:00:00.0000000Z one", "2026-11-15T00:00:01.0000000Z ERR_PNPM_LOCKFILE", ""].join("\n");
    expect(Arm.failingLines(log)).toEqual(["one", "ERR_PNPM_LOCKFILE"]);
  });
});

describe("RunsGh: the shapes GitHub answers", () => {
  // format: GitHub's jobs body for run 43776563690, read whole.
  it.effect(
    "format: run 43776563690's jobs read as ten jobs, each `cancelled`, and only next (2) with a failed step",
    () =>
      Effect.gen(function* () {
        const { jobs } = yield* fixture;
        expect(jobs).toHaveLength(10);
        expect(jobs.every((job) => job.conclusion === "cancelled")).toBe(true);
        expect(jobs.filter((job) => Arm.failedSteps(job).length > 0).map((job) => job.name)).toEqual(["next (2)"]);
      }),
  );

  // Plant owed on CI: discard source identity while decoding GitHub's run body.
  it.effect.prop(
    "property: GitHub source identity is retained as one complete object and incomplete source data never gains identity",
    { head: Head, repository: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000000 })) },
    ({ head, repository }) =>
      Effect.gen(function* () {
        const base = { id: 1, head_sha: head, status: "completed", conclusion: "success" };
        const metadata = {
          event: "pull_request",
          path: ".github/workflows/check.yaml",
          repository: { id: repository },
          head_repository: { id: repository },
        };
        const bodies = [
          { ...base, ...metadata },
          { ...base, event: metadata.event, path: metadata.path, repository: metadata.repository },
          { ...base, ...metadata, head_repository: null },
          base,
        ];
        const decoded = yield* RunsGh.runsIn(JSON.stringify({ workflow_runs: bodies }));
        expect(decoded[0]?.source).toEqual({
          event: metadata.event,
          path: metadata.path,
          repository,
          headRepository: repository,
        });
        expect(decoded.slice(1).every((run) => run.source === undefined)).toBe(true);
      }),
  );

  // format: a runs body, newest first, with a run not ended yet.
  it.effect("format: a workflow's runs body reads each run's id, head, status and conclusion", () =>
    Effect.gen(function* () {
      const body = JSON.stringify({
        total_count: 2,
        workflow_runs: [
          { id: 2, head_sha: oid, status: "in_progress", conclusion: null, name: "scheduled" },
          { id: 1, head_sha: older, status: "completed", conclusion: "success", name: "scheduled" },
        ],
      });

      expect(yield* RunsGh.runsIn(body)).toEqual([
        { id: 2, head: oid, status: "in_progress", conclusion: null },
        { id: 1, head: older, status: "completed", conclusion: "success" },
      ]);
    }),
  );
});
