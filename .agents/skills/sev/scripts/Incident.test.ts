// Today's lead tooling. The laws of the sev commands but the loop, on the test layers: nothing here
// asks GitHub or git. The log goes to a temporary folder.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Recorder, runsFor } from "@kampus/vitest";
import {
  Array as Arr,
  String as Str,
  pipe,
  DateTime,
  Duration,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Order,
  Record as Rec,
  Schema,
} from "effect";
import type { Scope } from "effect";
import { TestClock } from "effect/testing";
import * as BranchesTest from "../../lead/scripts/pr/BranchesTest.ts";
import type { PullRequest } from "../../lead/scripts/pr/PullRequests.ts";
import * as PullRequestsTest from "../../lead/scripts/pr/PullRequestsTest.ts";
import * as AlertsTest from "./AlertsTest.ts";
import * as Freeze from "./Freeze.ts";
import * as Incident from "./Incident.ts";
import * as Level from "./Level.ts";
import { Run, WorkflowRuns } from "./WorkflowRuns.ts";
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
  oid: pipe(`${number}`, Str.padStart(40, "0")),
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
  sha: pipe("a", Str.repeat(40)),
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
    "property: whatever runs the freeze canceled, close asks GitHub for no rerun and no cancel, starts main's full run exactly once, and walks each open pull request of a canceled branch exactly once",
    { runs: Schema.Array(Run), picks: Schema.Array(Pick), stray: Schema.String },
    ({ runs, picks, stray }) =>
      law(
        Effect.gen(function* () {
          const dir = yield* home;
          const github = WorkflowRunsTest.world(runs);

          const prs = Arr.map(picks, (p, i) =>
            pr(i + 1, runs.length === 0 ? stray : (runs[Math.abs(p.at) % runs.length]?.branch ?? stray), p.state),
          );

          const behind = Rec.fromEntries(Arr.map(prs, (p, i) => [p.oid, picks[i]?.behind ?? 0]));
          const prWorld = PullRequestsTest.world([...prs, pr(9999, stray)]);

          yield* Incident.open({ home: dir, reason: "slow", allow: [] }).pipe(Effect.provide(services({})));

          for (const r of runs) {
            yield* Level.write(dir, canceled(r));
          }

          const { closed, cancels, dispatches } = yield* Effect.gen(function* () {
            return {
              closed: yield* Incident.close(dir, "lead", Duration.zero),
              cancels: yield* Recorder.calls(WorkflowRuns, "cancel"),
              dispatches: yield* Recorder.calls(WorkflowRuns, "dispatch"),
            };
          }).pipe(Effect.provide(services({ github, prs: prWorld, behind })));

          expect(cancels).toEqual([]);
          // The one write close makes is the full run's start: the runs GitHub held are as they were.
          expect(dispatches).toHaveLength(1);
          expect(github.runs.slice(0, runs.length)).toEqual(runs);
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
          // Close starts the full run itself (0611), so the walk no longer tells the lead to.
          expect(Incident.nextLines(closed.walk)).toEqual([
            "sev: 2 open pull requests had runs canceled; walk them in this order, on the merge line:",
            "  11 fabrikalfa/b: 3 commits behind main; merge main in and push",
            "  10 fabrikalfa/a: holds main's head; a fresh run needs its next push",
          ]);
          expect(closed.level).toEqual(Level.Level.cases.sev1.make({ issues: [red], fix: null }));
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

  it("vector: with nothing to walk, close says so, and no line tells the lead to start the full run by hand", () => {
    // format: the first line is read as written. The full run is not the lead's to start: `close`
    // dispatches it (0611), so no line carries the command. Plant: today's Incident.ts, which still
    // prints "start the full run by hand" (red).
    expect(Incident.nextLines([])).toEqual(["sev: the freeze canceled no run of an open pull request"]);
    expect(
      Incident.nextLines([Incident.Walk.cases.holds.make({ pr: 1, branch: "fabrikalfa/a" })]).join("\n"),
    ).not.toContain("gh workflow run");
  });
});

/** Lets the real file reads and writes of forked fibers finish, outside the test clock. */
const settle = TestClock.withLive(Effect.sleep(Duration.millis(20)));

/** Moves the test clock a second at a time until `holds` is true, at most two minutes. */
const until = Effect.fnUntraced(function* <E, R>(holds: Effect.Effect<boolean, E, R>) {
  for (let left = 120; left > 0; left -= 1) {
    yield* settle;

    if (yield* holds) {
      return;
    }

    yield* TestClock.adjust(Duration.seconds(1));
  }

  return yield* Effect.die("the condition never held");
});

/** Moves the test clock until `fiber` has ended, then answers what it ended with. */
const finished = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.andThen(until(Effect.sync(() => fiber.pollUnsafe() !== undefined)), Fiber.join(fiber));

/** A run the freeze cancels: a pull request's, still going, on a branch the allow list does not name. */
const going = (id: number): Run => ({ ...run(id, `fabrikalfa/going-${id}`), status: "in_progress", conclusion: null });

/**
 * GitHub's runs as `close` sees them, with each start of a workflow run reading the log first: `held`
 * keeps the lines the log held at that moment, so a law sees whether the cancel loop had ended.
 */
const watching = (dir: string, held: Array<ReadonlyArray<Level.Entry>>) =>
  Layer.effect(
    WorkflowRuns,
    Effect.gen(function* () {
      const inner = yield* WorkflowRuns;

      return WorkflowRuns.of({
        ...inner,
        dispatch: (...given) =>
          Effect.andThen(
            Level.log(dir).pipe(
              Effect.tap((entries) => Effect.sync(() => void held.push(entries))),
              Effect.provide(NodeServices.layer),
              Effect.orDie,
            ),
            inner.dispatch(...given),
          ),
      });
    }),
  );

/** The workflow and the ref a start of a workflow run was asked for, as the call carries them. */
const asked = (args: ReadonlyArray<unknown>) => JSON.stringify(args);

describe("close starts main's full run", () => {
  // R9 of docs/plan/quests/sev-runbooks-PLAN.md (0611). Needs `WorkflowRuns.dispatch(workflow, ref)`, in the
  // contract and in WorkflowRunsTest, which the build writes; a call is read as the Recorder keeps it, so
  // the law reads the workflow and the ref from the arguments wherever they stand.
  // Plant: close dispatches before the loop's end line is written, or before the last cancel was asked:
  // the run `held` shows no `ended` line, or a cancel comes after the dispatch.
  it.effect(
    "scenario: with the cancel loop running, close dispatches scheduled.yaml on main once, after the loop ended and no cancel is asked after it, and never reruns a run",
    () =>
      law(
        Effect.gen(function* () {
          const dir = yield* home;
          const github = WorkflowRunsTest.world([going(1), going(2)]);
          const held: Array<ReadonlyArray<Level.Entry>> = [];

          const others = Layer.mergeAll(
            PullRequestsTest.layer(PullRequestsTest.world()),
            BranchesTest.layer({ branches: [], ahead: {}, empty: [] }),
            AlertsTest.layer([]),
          );

          const github$ = Layer.provideMerge(watching(dir, held), WorkflowRunsTest.layer(github));

          yield* Effect.gen(function* () {
            yield* Incident.open({ home: dir, reason: "slow", allow: [] });
            const loop = yield* Effect.forkChild(Freeze.loop(dir, Duration.seconds(20), 7));
            yield* until(Effect.map(Recorder.calls(WorkflowRuns, "cancel"), (all) => all.length === 2));

            yield* finished(yield* Effect.forkChild(Incident.close(dir, "lead", Duration.seconds(60))));
            yield* finished(loop);

            // However long the clock runs on, nothing more is asked of GitHub.
            const all = yield* Recorder.calls(WorkflowRuns);
            yield* TestClock.adjust(Duration.seconds(120));
            yield* settle;
            expect(yield* Recorder.calls(WorkflowRuns)).toEqual(all);

            const at = Arr.findFirstIndex(all, (c) => c.method === "dispatch");
            expect(Arr.filter(all, (c) => c.method === "dispatch")).toHaveLength(1);
            expect(at._tag).toBe("Some");
            expect(at._tag === "Some" ? all.slice(at.value + 1) : all).toEqual([]);
            expect(new Set(Arr.map(all, (c) => c.method))).toEqual(new Set(["unfinished", "cancel", "dispatch"]));

            const call = Arr.findFirst(all, (c) => c.method === "dispatch");
            expect(call._tag === "Some" && asked(call.value.args)).toContain('"scheduled.yaml"');
            expect(call._tag === "Some" && asked(call.value.args)).toContain('"main"');

            // At that moment the log held the close and the loop's own end, so no cancel could follow.
            expect(held).toHaveLength(1);
            expect(held[0]?.some((e) => e._tag === "closed")).toBe(true);
            expect(held[0]?.some((e) => e._tag === "ended" && e.by === "loop")).toBe(true);
          }).pipe(Effect.provide(Layer.mergeAll(github$, others)));
        }),
      ),
  );

  it.effect(
    "scenario: a close no loop answers still dispatches the full run once, and a close that is refused dispatches nothing",
    () =>
      law(
        Effect.gen(function* () {
          const dir = yield* home;
          const github = WorkflowRunsTest.world();

          const refused = yield* Effect.flip(
            Effect.andThen(Incident.close(dir, "lead", Duration.zero), Recorder.calls(WorkflowRuns, "dispatch")).pipe(
              Effect.provide(services({ github })),
            ),
          );

          expect(refused).toMatchObject({ _tag: "Refused", reason: "no sev0 is open" });

          yield* Incident.open({ home: dir, reason: "slow", allow: [] }).pipe(Effect.provide(services({})));

          // A loop that died: it said it started, and nothing reads the log any more.
          yield* Level.write(dir, Level.Entry.cases.looping.make({ at: AT, pid: 7 }));

          const dispatches = yield* Effect.andThen(
            Incident.close(dir, "lead", Duration.zero),
            Recorder.calls(WorkflowRuns, "dispatch"),
          ).pipe(Effect.provide(services({ github })));

          expect(dispatches).toHaveLength(1);
          expect(asked(dispatches[0] ?? [])).toContain('"scheduled.yaml"');
          expect(asked(dispatches[0] ?? [])).toContain('"main"');
        }),
      ),
  );
});

describe("fix", () => {
  // Enough branches that a walk of ten steps, merging after every second one, never runs out of one that
  // is not merged yet: a merged branch is never named again.
  const FIXES = Arr.makeBy(12, (i) => `fabrikalfa/fix-${i}`);

  /** One step of a walk: a pick among the moves the model allows now, and a branch to name. */
  const Step = Schema.Struct({ pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 99 })), at: Schema.Int });

  // R7 of docs/plan/quests/sev-runbooks-PLAN.md (0611). Needs `Incident.fix(home, branch)` and `Incident.drop(home)`
  // (`sev.ts fix --drop`), and a sev1 level that reads the named fix as `fix: string | null`; the build writes them.
  // A named fix is merged when its pull request is, which `fix` reads through the `PullRequests` service: the merge
  // writes nothing to the sev log, so the log alone cannot say.
  // The walk takes each step from what the model allows in its state: naming a fix when none is named or the
  // named one merged, and a second fix, a drop or a merge when one is named. A last stretch always reaches each case.
  // Plant: let `fix` overwrite the named fix, so a second fix is named silently; or refuse after the
  // named fix merged or after `fix --drop`.
  it.effect.prop(
    "property: while a sev1 fix is named and not merged, a second `fix` is refused and changes nothing; once the first is dropped or its pull request merged, the next `fix` names the new one",
    { steps: Schema.Array(Step).check(Schema.isMaxLength(10)), viaMerge: Schema.Boolean, last: Schema.Int },
    ({ steps, viaMerge, last }) =>
      law(
        Effect.gen(function* () {
          const dir = yield* home;
          const prs = PullRequestsTest.world(Arr.map(FIXES, (b, i) => pr(i + 1, b)));
          const layer = services({ issues: [red], prs });

          const state: { named: string | null; merged: boolean; readonly done: Set<string> } = {
            named: null,
            merged: false,
            done: new Set(),
          };

          /** The branches a step may name: not the one named now, and none that already merged. */
          const open = () => Arr.filter(FIXES, (b) => b !== state.named && !state.done.has(b));

          /** What the level says is the named fix: the model's, in a sev1 with the one issue open. */
          const settled = (expectNamed: string | null) =>
            Effect.gen(function* () {
              const level = yield* Incident.status(dir);
              expect(level._tag === "sev1" && level.fix).toBe(expectNamed);
            });

          const merge = Effect.sync(() => {
            const at = prs.prs.findIndex((p) => p.head === state.named);
            const found = prs.prs[at];

            if (found !== undefined) {
              prs.prs[at] = { ...found, state: "MERGED" };
            }

            state.merged = true;

            if (state.named !== null) {
              state.done.add(state.named);
            }
          });

          /** `fix branch`, which the model says is refused or named. */
          const names = (branch: string) =>
            Effect.gen(function* () {
              const free = state.named === null || state.merged;
              const before = (yield* Level.log(dir)).length;
              const result = yield* Effect.result(Incident.fix(dir, branch));
              const after = (yield* Level.log(dir)).length;

              expect(result._tag, `${branch} after ${state.named}`).toBe(free ? "Success" : "Failure");
              expect(result._tag === "Failure" && result.failure._tag, "the refusal").toBe(free ? false : "Refused");
              expect(after > before, "a fix is written, and a refused one writes nothing").toBe(free);

              const named = free ? branch : state.named;
              state.named = named;
              state.merged = free ? false : state.merged;
              yield* settled(named);
            });

          yield* Effect.gen(function* () {
            // A walk: each step takes a move from what the model allows in the state it is in.
            for (const step of steps) {
              const others = open();
              const other = others[Math.abs(step.at) % others.length] ?? "";

              if (state.named === null || state.merged) {
                yield* names(other);
                continue;
              }

              const move = step.pick % 3;

              if (move === 0) {
                yield* names(other);
              } else if (move === 1) {
                yield* Incident.drop(dir);
                state.named = null;
                yield* settled(null);
              } else {
                yield* merge;
              }
            }

            // However the walk went, every case is reached once: name a fix, see a second refused, then
            // free the first by a drop or a merge, and name the second.
            if (state.named === null || state.merged) {
              yield* names(open()[0] ?? "");
            }

            const first = state.named ?? "";
            const second = open()[Math.abs(last) % 2] ?? "";
            yield* names(second);

            if (viaMerge) {
              yield* merge;
            } else {
              yield* Incident.drop(dir);
              state.named = null;
            }

            // The first is named again only if it did not merge: a dropped fix is a branch still open.
            yield* names(viaMerge ? (open()[0] ?? "") : first);
          }).pipe(Effect.provide(layer));
        }),
      ),
    { arbitrary: { seed: 119120, runs: runsFor({ fast: 20, full: 60 }) } },
  );

  // 0611, fail closed (the 2026-11-19 review): whether the named fix still stands depends on the open issues, so an
  // unreadable list refuses `drop` and writes nothing. It is never read as no open issues, which names nothing.
  it.effect.prop(
    "property: with the open issues unreadable, drop refuses and says they could not be read, and the log is unchanged; once they read again the fix is still named",
    { branch: Schema.Literals(["fabrikalfa/x", "fabrikalfa/y"]), reason: Schema.NonEmptyString },
    ({ branch, reason }) =>
      law(
        Effect.gen(function* () {
          const dir = yield* home;
          yield* Incident.fix(dir, branch).pipe(Effect.provide(services({ issues: [red] })));
          const before = yield* Level.log(dir);

          const dropped = yield* Effect.result(
            Incident.drop(dir).pipe(Effect.provide(services({ issues: { failing: reason } }))),
          );

          expect(dropped._tag).toBe("Failure");
          expect(dropped._tag === "Failure" ? dropped.failure : null).toMatchObject({
            _tag: "Refused",
            reason: expect.stringContaining("could not be read"),
          });
          expect(yield* Level.log(dir)).toEqual(before);

          expect(yield* Incident.status(dir).pipe(Effect.provide(services({ issues: [red] })))).toEqual(
            Level.Level.cases.sev1.make({ issues: [red], fix: branch }),
          );
        }),
      ),
    { arbitrary: { seed: 119120, runs: runsFor({ fast: 20, full: 60 }) } },
  );
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
            Level.Level.cases.sev1.make({ issues: [slow], fix: null }),
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

  /** Tonight's three kinds of failed call: the 403 rate limit, the 409 of a stuck run, and a 502 (runs/sev/log.jsonl, 2026-11-18). */
  const tonight: ReadonlyArray<Level.Entry> = [
    Level.Entry.cases.limited.make({
      at: "2026-11-18T10:01:42.000Z",
      call: "cancel",
      id: 43096104693,
      until: DateTime.makeUnsafe("2026-11-18T10:08:55Z"),
      reason: "gh run cancel exited 1: HTTP 403: API rate limit exceeded.",
    }),
    Level.Entry.cases.refused.make({
      at: "2026-11-18T10:46:01.000Z",
      id: 43096104693,
      status: 409,
      reason: "gh api exited 1: gh: Cannot cancel a workflow run that has not been queued yet. (HTTP 409)",
    }),
    Level.Entry.cases.failed.make({
      at: "2026-11-18T09:39:46.045Z",
      call: "cancel",
      id: 43096102409,
      reason: "gh run cancel exited 1: HTTP 502: Server Error",
    }),
  ];

  it.prop(
    "property: the summary counts each failed, refused and rate-limited call as one failed GitHub call",
    {
      lines: Schema.Array(
        Schema.Union([Level.Entry.cases.failed, Level.Entry.cases.refused, Level.Entry.cases.limited]),
      ),
    },
    ({ lines }) => {
      const entries = [
        Level.Entry.cases.opened.make({ at: AT, by: "owner", reason: "slow", allow: [], issues: [] }),
        ...tonight,
        ...lines,
      ];

      expect(Incident.summary(entries).at(-1)).toBe(
        `0 runs canceled on 0 branches; ${tonight.length + lines.length} GitHub calls failed`,
      );
    },
  );
});
