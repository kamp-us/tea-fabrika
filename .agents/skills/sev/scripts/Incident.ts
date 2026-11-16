// Incident: the commands of the sev script but the loop, as code. Today's lead tooling, run on our
// own laptop; it is not product. sev.ts is its command line, Freeze.ts the cancel loop.
//
//   open     a sev0 begins, on the owner's call (from none or from a sev1); sev.ts then runs the loop
//   next     one branch becomes the whole allow list: the next fix, landed one at a time
//   allow    one more branch on the list
//   close    the sev0 ends: the loop stops, then it prints what the lead does next and the level now
//   status   the level now, since when and why
//
// Leaving a sev0 reruns nothing. A run the freeze canceled and a red run that stopped itself both
// end `cancelled`, and a rerun tests the old merge of main. So `close` lists each open pull request
// the freeze canceled a run of, with whether its branch holds main's head, and the lead merges main
// into each and pushes, which starts a fresh run on today's main.
import type { Duration } from "effect";
import { Console, Effect, Schema, Array as Arr, pipe, Option, Order } from "effect";
import { Branches } from "../../lead/scripts/pr/Branches.ts";
import { type PullRequest, PullRequests } from "../../lead/scripts/pr/PullRequests.ts";
import { Alerts } from "./Alerts.ts";
import * as Freeze from "./Freeze.ts";
import * as Level from "./Level.ts";

/** What the lead starts by hand once a sev0 ends: the freeze canceled it, and nothing starts it again. */
export const FULL_RUN = "gh workflow run scheduled.yaml --ref main";

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

/** What `close` prints after the loop stopped: the walk, then the full run to start. */
export const nextLines = (walk: ReadonlyArray<Walk>): ReadonlyArray<string> => [
  walk.length === 0
    ? "sev: the freeze canceled no run of an open pull request"
    : `sev: ${walk.length} open pull requests had runs canceled; walk them in this order, on the merge line:`,
  ...Arr.map(ordered(walk), (w) => `  ${walkLine(w)}`),
  `sev: start the full run by hand, since the freeze canceled it: ${FULL_RUN}`,
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
      case "canceled":
        cancels += 1;
        canceled.add(e.run.branch);
        break;
      case "failed":
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
 * Ends the sev0: writes the close, waits for the loop to stop, then prints the walk, the full run
 * to start, the summary and the level now. It asks GitHub for no rerun and writes nothing there.
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

  const entries = yield* Level.log(home);
  const branches = yield* Branches;
  yield* Effect.result(branches.refresh);
  const prs = yield* (yield* PullRequests).all;
  const walk = yield* Effect.forEach(owed(entries, prs), stand, { concurrency: 4 });

  const issues = yield* Effect.result((yield* Alerts).open);
  const level = Level.level(Level.Sev0.cases.closed.make({}), issues._tag === "Success" ? issues.success : []);

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
  const { sev0 } = yield* Level.read(home);
  const level = Level.level(sev0, sev0._tag === "open" ? [] : yield* (yield* Alerts).open);

  for (const line of levelLines(level)) {
    yield* Console.log(line);
  }

  return level;
});
