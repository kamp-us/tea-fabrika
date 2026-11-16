// Today's lead tooling. The laws of the sev commands but the loop, on the test layers: nothing here
// asks GitHub or git. The log goes to a temporary folder.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, FileSystem, Layer, Schema, type Scope, Array as Arr, Order } from "effect";
import * as BranchesTest from "../../lead/scripts/pr/BranchesTest.ts";
import type { PullRequest } from "../../lead/scripts/pr/PullRequests.ts";
import * as PullRequestsTest from "../../lead/scripts/pr/PullRequestsTest.ts";
import * as AlertsTest from "./AlertsTest.ts";
import * as Incident from "./Incident.ts";
import * as Level from "./Level.ts";
import { Run } from "./WorkflowRuns.ts";
import * as WorkflowRunsTest from "./WorkflowRunsTest.ts";

const AT = "2026-11-14T19:00:00.000Z";
const red = { number: 1300, title: "Scheduled CI is red on main", since: AT } satisfies Level.Alert;
const slow = { number: 1301, title: "CI speed: a stage is over its goal", since: AT } satisfies Level.Alert;

const home = Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeTempDirectoryScoped({ prefix: "sev-" }));

const law = <A, E>(body: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>) =>
  body.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const pr = (number: number, head: string, state: PullRequest["state"] = "OPEN"): PullRequest => ({
  number,
  head,
  oid: `${number}`.padStart(40, "0"),
  state,
  draft: false,
});

const canceled = (run: Run) => Level.Entry.cases.canceled.make({ at: AT, run });

/** The services `close` and `status` read, each in memory. */
const services = (given: {
  readonly github?: WorkflowRunsTest.World;
  readonly prs?: PullRequestsTest.World;
  readonly behind?: Readonly<Record<string, number>>;
  readonly issues?: ReadonlyArray<Level.Alert> | { readonly failing: string };
}) =>
  Layer.mergeAll(
    WorkflowRunsTest.layer(given.github ?? WorkflowRunsTest.world()),
    PullRequestsTest.layer(given.prs ?? PullRequestsTest.world()),
    BranchesTest.layer({ branches: [], ahead: {}, empty: [], behind: given.behind ?? {} }),
    AlertsTest.layer(given.issues ?? []),
  );

const run = (id: number, branch: string): Run => ({
  id,
  workflow: "check",
  event: "pull_request",
  branch,
  sha: "a".repeat(40),
  status: "completed",
  conclusion: "cancelled",
  created: AT,
});

describe("close", () => {
  /** Pull requests made from the generated runs: each pick names a run by index, and how it stands. */
  const Pick = Schema.Struct({
    at: Schema.Int,
    state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
    behind: Schema.Literals([0, 1, 7]),
  });

  it.effect.prop(
    "property: whatever runs the freeze canceled, close asks GitHub for no rerun and no write at all, and walks each open pull request of a canceled branch exactly once",
    { runs: Schema.Array(Run), picks: Schema.Array(Pick), stray: Schema.String },
    ({ runs, picks, stray }) =>
      law(
        Effect.gen(function* () {
          const dir = yield* home;
          const github = WorkflowRunsTest.world(runs);
          const prs = Arr.map(picks, (p, i) =>
            pr(i + 1, runs.length === 0 ? stray : (runs[Math.abs(p.at) % runs.length]?.branch ?? stray), p.state),
          );
          const behind = Object.fromEntries(Arr.map(prs, (p, i) => [p.oid, picks[i]?.behind ?? 0]));
          const prWorld = PullRequestsTest.world([...prs, pr(9999, stray)]);

          yield* Incident.open({ home: dir, reason: "slow", allow: [] }).pipe(Effect.provide(services({})));

          for (const r of runs) {
            yield* Level.write(dir, canceled(r));
          }

          const closed = yield* Incident.close(dir, "lead", Duration.zero).pipe(
            Effect.provide(services({ github, prs: prWorld, behind })),
          );

          expect(github.calls).toEqual([]);
          expect(github.runs).toEqual(runs);
          expect(prWorld.calls).toEqual([]);

          const hit = new Set(Arr.map(runs, (r) => r.branch));
          const due = Arr.filter([...prs, pr(9999, stray)], (p) => p.state === "OPEN" && hit.has(p.head));
          expect(
            Arr.sort(
              Arr.map(closed.walk, (w) => w.pr),
              Order.Number,
            ),
          ).toEqual(
            Arr.sort(
              Arr.map(due, (p) => p.number),
              Order.Number,
            ),
          );
          expect((yield* Level.read(dir)).sev0._tag).toBe("closed");
        }),
      ),
    { arbitrary: { runs: 40, seed: 119120 } },
  );

  it.effect(
    "scenario: close walks the branches behind main first, says which hold main, and ends at a sev1 while an issue is open",
    () =>
      law(
        Effect.gen(function* () {
          const dir = yield* home;
          yield* Incident.open({ home: dir, reason: "slow", allow: ["fabrikalfa/ci-cache"] }).pipe(
            Effect.provide(services({ issues: [red] })),
          );
          yield* Level.write(dir, canceled(run(1, "fabrikalfa/a")));
          yield* Level.write(dir, canceled(run(2, "fabrikalfa/b")));
          yield* Level.write(dir, canceled(run(3, "fabrikalfa/b")));
          yield* Level.write(dir, canceled(run(4, "main")));
          yield* Level.write(dir, canceled(run(5, "fabrikalfa/gone")));
          const prs = PullRequestsTest.world([
            pr(10, "fabrikalfa/a"),
            pr(11, "fabrikalfa/b"),
            pr(12, "fabrikalfa/gone", "MERGED"),
            pr(13, "fabrikalfa/quiet"),
          ]);

          const closed = yield* Incident.close(dir, "owner", Duration.zero).pipe(
            Effect.provide(services({ prs, behind: { [pr(11, "").oid]: 3, [pr(10, "").oid]: 0 }, issues: [red] })),
          );

          expect(Arr.map(closed.walk, (w) => w._tag)).toEqual(["holds", "behind"]);
          expect(Incident.nextLines(closed.walk)).toEqual([
            "sev: 2 open pull requests had runs canceled; walk them in this order, on the merge line:",
            "  11 fabrikalfa/b: 3 commits behind main; merge main in and push",
            "  10 fabrikalfa/a: holds main's head; a fresh run needs its next push",
            `sev: start the 3-hour full run by hand, since the freeze canceled it: ${Incident.FULL_RUN}`,
          ]);
          expect(closed.level).toEqual(Level.Level.cases.sev1.make({ issues: [red] }));
          expect((yield* Level.log(dir)).at(-1)).toMatchObject({ _tag: "closed", by: "owner" });
        }),
      ),
  );

  it.effect(
    "scenario: a branch git cannot read is walked first, with the reason, and close ends at none with no issue open",
    () =>
      law(
        Effect.gen(function* () {
          const dir = yield* home;
          yield* Incident.open({ home: dir, reason: "slow", allow: [] }).pipe(Effect.provide(services({})));
          yield* Level.write(dir, canceled(run(1, "fabrikalfa/a")));
          const closed = yield* Incident.close(dir, "lead", Duration.zero).pipe(
            Effect.provide(services({ prs: PullRequestsTest.world([pr(10, "fabrikalfa/a")]) })),
          );
          expect(closed.walk).toEqual([
            Incident.Walk.cases.unknown.make({ pr: 10, branch: "fabrikalfa/a", reason: `unknown ${pr(10, "").oid}` }),
          ]);
          expect(closed.level._tag).toBe("none");
        }),
      ),
  );

  it("vector: with nothing to walk, close still says to start the full run by hand", () => {
    expect(Incident.nextLines([])).toEqual([
      "sev: the freeze canceled no run of an open pull request",
      "sev: start the 3-hour full run by hand, since the freeze canceled it: gh workflow run scheduled.yaml --ref main",
    ]);
  });
});

describe("open, next, allow and status", () => {
  it.effect(
    "scenario: open keeps the issues it began over, a second open is refused, and status reads the sev0 from the log",
    () =>
      law(
        Effect.gen(function* () {
          const dir = yield* home;
          const layer = services({ issues: [red, slow] });
          yield* Incident.open({ home: dir, reason: "nothing lands", allow: ["fabrikalfa/x", "fabrikalfa/x"] }).pipe(
            Effect.provide(layer),
          );
          expect((yield* Level.log(dir))[0]).toMatchObject({
            by: "owner",
            issues: [1300, 1301],
            allow: ["fabrikalfa/x"],
          });

          const again = yield* Effect.flip(
            Incident.open({ home: dir, reason: "again", allow: [] }).pipe(Effect.provide(layer)),
          );
          expect(again).toMatchObject({ _tag: "Refused" });

          yield* Incident.next(dir, "fabrikalfa/y");
          yield* Incident.allow(dir, "fabrikalfa/z");
          expect((yield* Level.log(dir))[1]).toMatchObject({
            _tag: "next",
            branch: "fabrikalfa/y",
            before: ["fabrikalfa/x"],
          });
          expect(yield* Incident.status(dir).pipe(Effect.provide(layer))).toEqual(
            Level.Level.cases.sev0.make({
              since: (yield* Level.log(dir))[0]?.at ?? "",
              reason: "nothing lands",
              allow: ["fabrikalfa/y", "fabrikalfa/z"],
            }),
          );
        }),
      ),
  );

  it.effect("scenario: open records null issues when they cannot be read, and still opens", () =>
    law(
      Effect.gen(function* () {
        const dir = yield* home;
        yield* Incident.open({ home: dir, reason: "slow", allow: [] }).pipe(
          Effect.provide(services({ issues: { failing: "gh issue list exited 1" } })),
        );
        expect((yield* Level.log(dir))[0]).toMatchObject({ issues: null });
      }),
    ),
  );

  it.effect(
    "scenario: next, allow and close are refused with no sev0 open, and status is a sev1 or none from the issues",
    () =>
      law(
        Effect.gen(function* () {
          const dir = yield* home;
          const none = { _tag: "Refused", reason: "no sev0 is open" };
          expect(yield* Effect.flip(Incident.next(dir, "fabrikalfa/y"))).toMatchObject(none);
          expect(yield* Effect.flip(Incident.allow(dir, "fabrikalfa/y"))).toMatchObject(none);
          expect(
            yield* Effect.flip(Incident.close(dir, "lead", Duration.zero).pipe(Effect.provide(services({})))),
          ).toMatchObject(none);
          expect(yield* Level.log(dir)).toEqual([]);

          expect(yield* Incident.status(dir).pipe(Effect.provide(services({ issues: [slow] })))).toEqual(
            Level.Level.cases.sev1.make({ issues: [slow] }),
          );
          expect((yield* Incident.status(dir).pipe(Effect.provide(services({}))))._tag).toBe("none");
          expect(
            yield* Effect.flip(Incident.status(dir).pipe(Effect.provide(services({ issues: { failing: "offline" } })))),
          ).toMatchObject({ _tag: "AlertsError", reason: "offline" });
        }),
      ),
  );
});

describe("summary", () => {
  it("vector: it reads only the latest sev0, and counts its cancels by branch", () => {
    const entries: ReadonlyArray<Level.Entry> = [
      Level.Entry.cases.opened.make({ at: "old", by: "owner", reason: "before", allow: [], issues: [] }),
      Level.Entry.cases.closed.make({ at: "old", by: "lead" }),
      Level.Entry.cases.opened.make({ at: AT, by: "owner", reason: "slow", allow: ["fabrikalfa/a"], issues: [1300] }),
      Level.Entry.cases.next.make({ at: AT, branch: "fabrikalfa/b", before: ["fabrikalfa/a"] }),
      canceled(run(1, "x")),
      canceled(run(2, "x")),
      canceled(run(3, "y")),
      Level.Entry.cases.failed.make({ at: AT, call: "cancel", id: 3, reason: "gone" }),
      Level.Entry.cases.closed.make({ at: AT, by: "owner" }),
    ];
    expect(Incident.summary(entries)).toEqual([
      `${AT} opened by the owner: slow; allowed: fabrikalfa/a`,
      "  over ci-scheduled issues: 1300",
      `${AT} next fix fabrikalfa/b`,
      `${AT} closed by the owner`,
      "3 runs canceled on 2 branches; 1 GitHub calls failed",
    ]);
  });
});
