import { NodeServices } from "@effect/platform-node";
// Today's lead tooling. Arm's laws on the test layers: nothing here asks GitHub. The red run is
// run 43776563690 on fabrikalfa/p34c-s4 as GitHub served it on 2026-11-15, its jobs and steps
// trimmed to the fields read (../ci/fixtures/run-43776563690-jobs.json), and lines of its red leg's
// log (../ci/fixtures/run-43776563690-next-2.log): one leg's vitest step failed, and that leg's stop
// step canceled the other nine, so the run's own conclusion reads `cancelled`.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { FileSystem } from "effect";
import * as ChecksTest from "../ci/ChecksTest.ts";
import type { Job, Run } from "../ci/Runs.ts";
import * as RunsGh from "../ci/RunsGh.ts";
import * as RunsTest from "../ci/RunsTest.ts";
import * as Arm from "./Arm.ts";
import * as PullRequestsTest from "./PullRequestsTest.ts";

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

/** The same jobs as a branch run that went green: every job a success, and the report skipped. */
const allGreen = (jobs: ReadonlyArray<Job>): ReadonlyArray<Job> =>
  jobs.map((job) => ({ ...job, conclusion: job.name === "report" ? "skipped" : "success" }));

/** How the branch's full runs stand, as a law sets them. */
const Stands = Schema.Literals(["green", "red", "none", "older", "in_progress", "queued"]);
type Stands = typeof Stands.Type;

type World = {
  readonly stands?: Stands;
  readonly state?: "OPEN" | "CLOSED" | "MERGED";
  readonly draft?: boolean;
  readonly base?: string;
  readonly title?: string;
  readonly files?: ReadonlyArray<string>;
  /** The jobs of the run at the head, for a law that builds its own. */
  readonly jobs?: ReadonlyArray<Job>;
};

const memory = (w: World, red: { readonly jobs: ReadonlyArray<Job>; readonly log: string }) => {
  const github = PullRequestsTest.world([
    { number: 1092, head: branch, oid, state: w.state ?? "OPEN", draft: w.draft ?? false },
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
    green: [run(oid, "completed", "success")],
    red: [run(oid, "completed", "cancelled")],
    none: [],
    older: [run(older, "completed", "success")],
    in_progress: [run(oid, "in_progress", null)],
    queued: [run(oid, "queued", null)],
  };
  actions.runs.set(branch, runs[stands]);
  actions.jobs.set(RED, w.jobs ?? (stands === "red" ? red.jobs : allGreen(red.jobs)));
  const layer = Layer.mergeAll(PullRequestsTest.layer(github), RunsTest.layer(actions), ChecksTest.layer([], red.log));
  return { github, actions, layer };
};

const arm = (m: ReturnType<typeof memory>, noRun: Arm.NoRun = "refuse") =>
  Arm.arm({ repo, pr: 1092, noRun }).pipe(Effect.provide(m.layer));

describe("arm: merge when ready goes on only over a full run green on every job at the head", () => {
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
        expect(refused.reason).toContain(`https://github.com/${repo}/actions/runs/${RED} is not green on every job`);
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

  // scenario: each way a head can lack a finished run of its own.
  it.effect(
    "scenario: no run on the branch, a run only at an older head, and a run at the head that is in progress or queued each refuse with a line saying which, and arm nothing",
    () =>
      Effect.gen(function* () {
        const red = yield* fixture;
        const said = {
          none: `no scheduled.yaml run on ${branch}`,
          older: `the newest scheduled.yaml run on ${branch} is at ${older.slice(0, 12)}, not the head ${oid.slice(0, 12)}`,
          in_progress: `at this head is in_progress, not ended`,
          queued: `at this head is queued, not ended`,
        } as const;

        for (const [stands, line] of Object.entries(said)) {
          const m = memory({ stands: stands as keyof typeof said }, red);
          const refused = yield* Effect.flip(arm(m));
          expect(refused.reason).toContain(line);
          expect(m.github.calls).toEqual([]);
        }
      }),
  );

  // scenario: the green path, as the lead runs it on a reviewed draft.
  it.effect(
    "scenario: a draft whose full run is green on every job, the report skipped as on every branch, is marked ready, then armed pinned to its head",
    () =>
      Effect.gen(function* () {
        const red = yield* fixture;
        const m = memory({ stands: "green", draft: true }, red);
        const armed = yield* arm(m);
        expect(m.github.calls).toEqual([
          { _tag: "ready", number: 1092 },
          { _tag: "arm", number: 1092, oid },
        ]);
        expect(Arm.line(armed)).toBe(
          `pr 1092: full run ${RED} green on every job at ${oid.slice(0, 12)}; marked ready; merge when ready on at ${oid}, a squash: GitHub queues it once ci-required is green there`,
        );
        expect(m.actions.asked).toEqual([`runs scheduled.yaml ${branch}`, `jobs ${RED}`]);
      }),
  );

  // Plants: arm on the run's top line; let a skip pass on any job; arm with no run, or on an older
  // head, without being told; let a flag arm a red or unfinished run; arm a plan or a closed one.
  it.effect.prop(
    "property: it arms exactly when the pull request is open, into main and no `Plan:`, and the run at its head is green on every job, or there is none at the head and the caller said to arm anyway (--docs only for docs paths); it then arms once, at the head",
    {
      stands: Stands,
      state: Schema.Literals(["OPEN", "CLOSED"]),
      base: Schema.Literals(["main", "fabrikalfa/parent"]),
      plan: Schema.Boolean,
      docsOnly: Schema.Boolean,
      noRun: Arm.NoRun,
      skipped: Schema.Literals(["none", "report", "tooling (1)"]),
    },
    ({ stands, state, base, plan, docsOnly, noRun, skipped }) =>
      Effect.gen(function* () {
        const red = yield* fixture;
        // The report skipped as on every branch, or a success, or another job skipped in its place.
        const skips = (job: Job) => job.name === skipped || (job.name === "report" && skipped === "report");
        const withSkip = red.jobs.map((job) => ({ ...job, conclusion: skips(job) ? "skipped" : "success" }));
        const m = memory(
          {
            stands,
            state,
            base,
            title: plan ? "Plan: per-program quotas" : "Per-program quotas",
            files: docsOnly ? [".decisions/0573-x.md", "field/notes/x.json"] : ["docs/x.md", "next/x.ts"],
            jobs: stands === "red" ? red.jobs : withSkip,
          },
          red,
        );
        const answer = yield* Effect.result(arm(m, noRun));
        const open = state === "OPEN" && base === "main" && !plan;
        const flagFits = noRun === "any" || (noRun === "docs" && docsOnly);
        const green = stands === "green" && skipped !== "tooling (1)";
        const unrun = stands === "none" || stands === "older";
        const arms = open && (noRun !== "docs" || docsOnly) && (green || (unrun && flagFits));
        expect(m.github.calls).toEqual(arms ? [{ _tag: "arm", number: 1092, oid }] : []);
        expect(answer._tag).toBe(arms ? "Success" : "Failure");
      }),
  );

  // vector: the hint a docs pull request with no run gets, and the refusal of --docs on code.
  it.effect(
    "vector: a docs pull request with no full run is told to pass --docs; --docs on one with code refuses",
    () =>
      Effect.gen(function* () {
        const red = yield* fixture;
        const docs = memory({ stands: "none", files: ["docs/plan/README.md", ".glossary/TERMS.md"] }, red);
        const hint = yield* Effect.flip(arm(docs));
        expect(hint.reason).toBe(
          `pr 1092: no scheduled.yaml run on ${branch}. A docs pull request (only .decisions/, docs/, field/, .glossary/, .runbooks/ files) starts no full run: pass --docs to arm it`,
        );
        const armed = yield* arm(docs, "docs");
        expect(Arm.line(armed)).toContain(`no scheduled.yaml run on ${branch}; armed with --docs`);
        const code = memory({ stands: "none", files: ["docs/x.md", "next/a.ts"] }, red);
        const refused = yield* Effect.flip(arm(code, "docs"));
        expect(refused.reason).toBe(
          "pr 1092: --docs is for a pull request of only .decisions/, docs/, field/, .glossary/, .runbooks/ files; it also changes next/a.ts",
        );
        expect(code.github.calls).toEqual([]);
      }),
  );

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
