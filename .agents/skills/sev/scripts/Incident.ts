// Incident: the commands of the sev script but the loop, as code. Today's lead tooling, run on our
// own laptop; it is not product. sev.ts is its command line, Freeze.ts the cancel loop.
//
//   open     a sev0 begins, on the owner's call (from none or from a sev1); sev.ts then runs the loop
//   next     one branch becomes the whole allow list: the next fix, landed one at a time
//   allow    one more branch on the list
//   fix      a sev1's one fix now landing is named (0611); a second is refused until the first merged
//   drop     the named fix is let go, so another can be named
//   close    the sev0 ends: the loop stops, main's full run starts, then it prints what the lead does
//            next and the level now
//   status   the level now, since when and why
//
// Leaving a sev0 reruns nothing. A run the freeze canceled and a red run that stopped itself both
// end `cancelled`, and a rerun tests the old merge of main. So `close` starts a fresh full run on
// main itself, and lists each open pull request the freeze canceled a run of, with whether its
// branch holds main's head: the lead merges main into each and pushes, which starts a fresh run on
// today's main.
import type { Duration } from "effect";
import { Console, Effect, Schema, Array as Arr, pipe, Option, Order } from "effect";
import { Branches } from "../../lead/scripts/pr/Branches.ts";
import { type PullRequest, PullRequests } from "../../lead/scripts/pr/PullRequests.ts";
import { Alerts } from "./Alerts.ts";
import * as Freeze from "./Freeze.ts";
import * as Level from "./Level.ts";
import { WorkflowRuns } from "./WorkflowRuns.ts";

/** Main's full run: the freeze canceled it, and nothing starts it again but `close` (0611). */
const FULL_RUN = { workflow: "scheduled.yaml", ref: "main" } as const;

// ---------------------------------------------------------------- the deciding part

/** The lines of the latest sev0, from its `opened` on; all of them before any sev0. */
export const latest = (entries: ReadonlyArray<Level.Entry>): ReadonlyArray<Level.Entry> =>
  entries.slice(
    Option.getOrElse(
      Arr.findLastIndex(entries, (e) => e._tag === "opened"),
      () => 0,
    ),
  );

/** The open pull requests the latest sev0 canceled a run of, each once, by number. */
export const owed = (entries: ReadonlyArray<Level.Entry>, prs: ReadonlyArray<PullRequest>) => {
  const hit = new Set(Arr.flatMap(latest(entries), (e) => (e._tag === "canceled" ? [e.run.branch] : [])));

  return Arr.sort(
    Arr.filter(prs, (pr) => pr.state === "OPEN" && hit.has(pr.head)),
    Order.mapInput(Order.Number, (pr: PullRequest) => pr.number),
  );
};

/** One pull request the lead walks after a sev0, and how its branch stands to main. */
export const Walk = Schema.TaggedUnion({
  behind: { pr: Schema.Finite, branch: Schema.String, commits: Schema.Finite },
  holds: { pr: Schema.Finite, branch: Schema.String },
  unknown: { pr: Schema.Finite, branch: Schema.String, reason: Schema.String },
});

export type Walk = typeof Walk.Type;

/** The walk in the order the lead takes it: the ones a merge of main helps first, then the rest. */
export const ordered = (walk: ReadonlyArray<Walk>): ReadonlyArray<Walk> =>
  Arr.sort(
    walk,
    Order.combine(
      Order.mapInput(Order.Boolean, (w: Walk) => w._tag === "holds"),
      Order.mapInput(Order.Number, (w: Walk) => w.pr),
    ),
  );

const walkLine = (w: Walk): string => {
  switch (w._tag) {
    case "behind":
      return `${w.pr} ${w.branch}: ${w.commits} commits behind main; merge main in and push`;
    case "unknown":
      return `${w.pr} ${w.branch}: could not tell if it holds main (${w.reason}); merge main in and push`;
    case "holds":
      return `${w.pr} ${w.branch}: holds main's head; a fresh run needs its next push`;
  }
};

/** What `close` prints after the loop stopped and the full run started: the walk. */
export const nextLines = (walk: ReadonlyArray<Walk>): ReadonlyArray<string> => [
  walk.length === 0
    ? "sev: the freeze canceled no run of an open pull request"
    : `sev: ${walk.length} open pull requests had runs canceled; walk them in this order, on the merge line:`,
  ...Arr.map(ordered(walk), (w) => `  ${walkLine(w)}`),
];

/** The latest sev0's log, as lines for the write-up. */
export const summary = (entries: ReadonlyArray<Level.Entry>): ReadonlyArray<string> => {
  const lines: Array<string> = [];
  const canceled = new Set<string>();
  let cancels = 0;
  let failed = 0;

  for (const e of latest(entries)) {
    switch (e._tag) {
      case "opened":
        lines.push(`${e.at} opened by the owner: ${e.reason}; allowed: ${Arr.join(e.allow, ", ") || "none"}`);
        lines.push(
          e.issues === null
            ? "  the open ci-scheduled issues could not be read"
            : `  over ci-scheduled issues: ${Arr.join(Arr.map(e.issues, String), ", ") || "none"}`,
        );
        break;
      case "allowed":
        lines.push(`${e.at} allowed ${e.branch}`);
        break;
      case "next":
        lines.push(`${e.at} next fix ${e.branch}`);
        break;
      case "fix":
        lines.push(e.branch === null ? `${e.at} dropped the fix` : `${e.at} fix ${e.branch}`);
        break;
      case "canceled":
        cancels += 1;
        canceled.add(e.run.branch);
        break;
      case "failed":
      case "refused":
      case "limited":
        failed += 1;
        break;
      case "closed":
        lines.push(`${e.at} closed by the ${e.by}`);
        break;
      case "looping":
      case "ended":
        break;
    }
  }

  return [...lines, `${cancels} runs canceled on ${canceled.size} branches; ${failed} GitHub calls failed`];
};

/** The level, as `status` and `close` print it. */
export const levelLines = (level: Level.Level): ReadonlyArray<string> => {
  switch (level._tag) {
    case "sev0":
      return [`sev0 since ${level.since}: ${level.reason}`, `  allowed: ${Arr.join(level.allow, ", ") || "none"}`];
    case "sev1":
      return [
        `sev1 since ${level.issues[0]?.since ?? "now"}: ${level.issues.length} ci-scheduled issues open`,
        ...Arr.map(level.issues, (i) => `  issue ${i.number} since ${i.since}: ${i.title}`),
        `  fix: ${level.fix ?? "none"}`,
      ];
    case "none":
      return ["none: no sev0 is open, and no ci-scheduled issue is open"];
  }
};

// ---------------------------------------------------------------- the commands

/** What a sev0 opens with. */
export type Open = { readonly home: string; readonly reason: string; readonly allow: ReadonlyArray<string> };

/** A sev0 begins, on the owner's call; refused while one is open. The issues it began over are kept. */
export const open = Effect.fn("Incident.open")(function* (given: Open) {
  const issues = yield* Effect.result((yield* Alerts).open);
  const allow = [...new Set(given.allow)];
  yield* Level.write(
    given.home,
    Level.Entry.cases.opened.make({
      at: yield* Level.now,
      by: "owner",
      reason: given.reason,
      allow,
      issues: issues._tag === "Success" ? Arr.map(issues.success, (i) => i.number) : null,
    }),
  );
  yield* Console.log(
    `sev: sev0 open; kept: the merge queue${pipe(
      allow,
      Arr.map((b) => `, ${b}`),
      Arr.join(""),
    )}`,
  );
});

/** Makes `branch` the only allowed branch: the next fix in line. The one before is canceled from now. */
export const next = Effect.fn("Incident.next")(function* (home: string, branch: string) {
  const { sev0 } = yield* Level.read(home);
  const before = sev0._tag === "open" ? sev0.allow : [];
  yield* Level.write(home, Level.Entry.cases.next.make({ at: yield* Level.now, branch, before }));
  yield* Console.log(`sev: next is ${branch}; nothing else is allowed`);
});

/** Adds `branch` to the allow list of the open sev0. */
export const allow = Effect.fn("Incident.allow")(function* (home: string, branch: string) {
  yield* Level.write(home, Level.Entry.cases.allowed.make({ at: yield* Level.now, branch }));
  yield* Console.log(`sev: allowed ${branch}`);
});

/** Names `branch` as the sev1's one fix now landing; refused in a sev0, with no issue open, or while another fix is not merged. */
export const fix = Effect.fn("Incident.fix")(function* (home: string, branch: string) {
  const { entries, sev0 } = yield* Level.read(home);

  if (sev0._tag === "open") {
    return yield* Level.Refused.make({
      reason: `a sev0 is open since ${sev0.since}: name the next fix with next, not fix`,
    });
  }

  const issues = yield* (yield* Alerts).open;

  if (issues.length === 0) {
    return yield* Level.Refused.make({ reason: "no ci-scheduled issue is open, so there is no sev1 fix to name" });
  }

  const named = Level.sev1Fix(entries, issues);

  if (named === branch) {
    return yield* Console.log(`sev: ${branch} is the fix already`);
  }

  if (named !== null) {
    const prs = yield* (yield* PullRequests).all;

    if (!Arr.some(prs, (pr) => pr.head === named && pr.state === "MERGED")) {
      return yield* Level.Refused.make({
        reason: `${named} is the fix now landing and has not merged: one fix at a time; wait for it, or run fix --drop`,
      });
    }
  }

  yield* Level.write(
    home,
    Level.Entry.cases.fix.make({ at: yield* Level.now, branch, issues: Arr.map(issues, (i) => i.number) }),
  );
  yield* Console.log(`sev: the fix now landing is ${branch}`);
});

/** Lets go of the named sev1 fix, so another can be named; says so when none is named. */
export const drop = Effect.fn("Incident.drop")(function* (home: string) {
  const { entries } = yield* Level.read(home);
  const issues = yield* Effect.result((yield* Alerts).open);
  const open = issues._tag === "Success" ? issues.success : [];
  const named = Level.sev1Fix(entries, open);

  if (named === null) {
    return yield* Console.log("sev: no fix is named");
  }

  yield* Level.write(
    home,
    Level.Entry.cases.fix.make({ at: yield* Level.now, branch: null, issues: Arr.map(open, (i) => i.number) }),
  );
  yield* Console.log(`sev: ${named} is not the fix now landing any more`);
});

/** How a pull request's branch stands to main, read from the checkout after a fetch. */
const stand = Effect.fn("Incident.stand")(function* (pr: PullRequest) {
  const behind = yield* Effect.result((yield* Branches).behind(pr.oid));

  if (behind._tag === "Failure") {
    return Walk.cases.unknown.make({ pr: pr.number, branch: pr.head, reason: behind.failure.reason });
  }

  return behind.success === 0
    ? Walk.cases.holds.make({ pr: pr.number, branch: pr.head })
    : Walk.cases.behind.make({ pr: pr.number, branch: pr.head, commits: behind.success });
});

/** What `close` found: how the loop ended, the walk, and the level after it. */
export type Closed = { readonly loop: Freeze.Ended; readonly walk: ReadonlyArray<Walk>; readonly level: Level.Level };

/**
 * Ends the sev0: writes the close, waits for the loop to stop, starts main's full run once (the
 * freeze canceled it), then prints the walk, the summary and the level now. It asks GitHub for no
 * rerun and no cancel.
 */
export const close = Effect.fn("Incident.close")(function* (
  home: string,
  by: "owner" | "lead",
  wait: Duration.Duration,
) {
  yield* Level.write(home, Level.Entry.cases.closed.make({ at: yield* Level.now, by }));
  const loop = yield* Freeze.ended(home, wait);
  yield* Console.log(
    loop === "answered" ? "sev: sev0 closed; the cancel loop ended" : "sev: sev0 closed; no cancel loop answered",
  );

  // The loop has ended, so no cancel can follow: the one run `close` starts is main's full run.
  const started = yield* Effect.result((yield* WorkflowRuns).dispatch(FULL_RUN.workflow, FULL_RUN.ref));
  yield* Console.log(
    started._tag === "Success"
      ? `sev: started the full run: ${FULL_RUN.workflow} on ${FULL_RUN.ref}`
      : `sev: could not start the full run (${started.failure.reason}): gh workflow run ${FULL_RUN.workflow} --ref ${FULL_RUN.ref}`,
  );

  const entries = yield* Level.log(home);
  const branches = yield* Branches;
  yield* Effect.result(branches.refresh);
  const prs = yield* (yield* PullRequests).all;
  const walk = yield* Effect.forEach(owed(entries, prs), stand, { concurrency: 4 });

  const issues = yield* Effect.result((yield* Alerts).open);
  const open = issues._tag === "Success" ? issues.success : [];
  const level = Level.level(Level.Sev0.cases.closed.make({}), open, Level.sev1Fix(entries, open));

  for (const line of [
    ...nextLines(walk),
    "sev: for the write-up:",
    ...Arr.map(summary(entries), (l) => `  ${l}`),
    issues._tag === "Success"
      ? `sev: now ${Arr.join(levelLines(level), "\n  ")}`
      : `sev: could not read the ci-scheduled issues (${issues.failure.reason}); run status`,
  ]) {
    yield* Console.log(line);
  }

  return { loop, walk, level } satisfies Closed;
});

/** The level now: the sev0 from the log when one is open, else the open ci-scheduled issues. */
export const status = Effect.fn("Incident.status")(function* (home: string) {
  const { entries, sev0 } = yield* Level.read(home);
  const issues = sev0._tag === "open" ? [] : yield* (yield* Alerts).open;
  const level = Level.level(sev0, issues, Level.sev1Fix(entries, issues));

  for (const line of levelLines(level)) {
    yield* Console.log(line);
  }

  return level;
});
