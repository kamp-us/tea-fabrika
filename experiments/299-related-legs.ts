// Experiment 299: queue wait and run time of today's CI `related` legs, per run.
// Reads TSV rows of related jobs (one per leg, as GitHub's list_workflow_jobs gives them)
// and prints per-run lines, the split rule and medians. Run: node related-legs.ts runs.tsv legs*.tsv
import { readFileSync } from "node:fs";

type Leg = {
  run: string;
  name: string;
  conclusion: string;
  project: string;
  created: number;
  started: number;
  completed: number;
  stepStarted: number | null;
  stepCompleted: number | null;
};

const at = (s: string | undefined): number | null => (s ? Date.parse(s) / 1000 : null);

const [runsPath, ...legPaths] = process.argv.slice(2);
const runs = new Map(
  readFileSync(runsPath!, "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split("\t"))
    .map(([id, event, conclusion, created, sha]) => [id!, { event: event!, conclusion: conclusion!, created: created!, sha: sha! }]),
);
const legs: Leg[] = legPaths.flatMap((path) =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t"))
    .map(([run, name, conclusion, project, created, started, completed, stepStarted, stepCompleted]) => ({
      run: run!,
      name: name!,
      conclusion: conclusion!,
      project: project!,
      created: at(created)!,
      started: at(started)!,
      completed: at(completed)!,
      stepStarted: at(stepStarted),
      stepCompleted: at(stepCompleted),
    })),
);

// Nearest-rank percentile.
const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!;
};
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

// f1540a3 landed on main at 02:38:47Z. A pull request run tests the merge with main at its
// creation, so a run created after that holds the new rows; a queue run holds them when its
// head is f1540a3 or a later main commit.
const ROWS_AT = Date.parse("2026-11-18T02:38:47Z") / 1000;

// A rerun (attempt 2) keeps the legs that passed in attempt 1 with their old start and end but the
// new attempt's created_at, so they show a start before their creation. Those legs did not run in
// this attempt: drop them and count them.
const stale = legs.filter((l) => l.started < l.created);
console.log(`legs from an earlier attempt, dropped: ${stale.map((l) => `${l.run} ${l.name}`).join(", ") || "none"}`);
const byRun = Map.groupBy(
  legs.filter((l) => l.started >= l.created),
  (l) => l.run,
);
const done = [...byRun].filter(([, ls]) => ls.every((l) => l.conclusion === "success"));
const waits = { tooling: [] as number[], integration: [] as number[] };
const times = { tooling: [] as number[], integration: [] as number[] };
const walls: number[] = [];
const lastWaits: number[] = [];
let fires = 0;
let withBoth = 0;

for (const [run, ls] of done.sort(([a], [b]) => a.localeCompare(b))) {
  const info = runs.get(run);
  const rows = info && Date.parse(info.created) / 1000 > ROWS_AT ? "new" : "old";
  for (const l of ls) {
    const project = l.project === "tooling" ? "tooling" : "integration";
    waits[project].push(l.started - l.created);
    times[project].push(l.completed - l.started);
  }
  const last = ls.reduce((a, b) => (b.completed > a.completed ? b : a));
  const wall = Math.max(...ls.map((l) => l.completed)) - Math.min(...ls.map((l) => l.created));
  walls.push(wall);
  lastWaits.push(last.started - last.created);
  const integration = ls.filter((l) => l.project === "integration");
  const longestIntegration = integration.length > 0 ? Math.max(...integration.map((l) => l.completed - l.started)) : null;
  if (longestIntegration !== null && ls.some((l) => l.project === "tooling")) withBoth++;
  const gap = longestIntegration === null ? null : last.completed - last.started - longestIntegration;
  const rule = last.project === "tooling" && last.started - last.created <= 60 && gap !== null && gap >= 120;
  if (rule) fires++;
  const cells = ls
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
    .map((l) => `${l.name.replace("related ", "")}${l.project[0]} ${l.started - l.created}/${l.completed - l.started}`)
    .join(", ");
  console.log(
    [run, info?.event ?? "?", rows, `last ${last.name.replace("related ", "")} ${last.project}`, `wall ${wall}`, `wait on path ${wall - Math.max(...ls.map((l) => l.completed - l.started))}`, `gap ${gap ?? "-"}`, rule ? "FIRES" : "no", cells].join("\t"),
  );
}

console.log(`\nruns with all legs green: ${done.length}; with both kinds: ${withBoth}; rule fires in ${fires}`);
for (const k of ["tooling", "integration"] as const) {
  console.log(
    `${k}: n=${waits[k].length} wait median ${median(waits[k])} p90 ${pct(waits[k], 90)} max ${Math.max(...waits[k])}; run median ${median(times[k])} p90 ${pct(times[k], 90)} max ${Math.max(...times[k])}`,
  );
}
console.log(`group wall median ${median(walls)} p90 ${pct(walls, 90)}; last leg's wait median ${median(lastWaits)} p90 ${pct(lastWaits, 90)}`);

// Wait of legs in runs that did not finish their related group (canceled by a newer push):
// a leg that started is still a sample of runner wait. Rows with an empty start are left out.
const partial = [...Map.groupBy(legs, (l) => l.run)].filter(([run]) => !done.some(([r]) => r === run));
const partialWaits = partial.flatMap(([, ls]) => ls.filter((l) => l.started >= l.created).map((l) => l.started - l.created));
const pathCosts = done.map(([, ls]) => Math.max(...ls.map((l) => l.completed)) - Math.min(...ls.map((l) => l.created)) - Math.max(...ls.map((l) => l.completed - l.started)));
console.log(`wait on the critical path: median ${median(pathCosts)} p90 ${pct(pathCosts, 90)} max ${Math.max(...pathCosts)}`);
console.log(`unfinished groups: ${partial.length} runs, ${partialWaits.length} started legs; wait median ${median(partialWaits)} p90 ${pct(partialWaits, 90)} max ${Math.max(...partialWaits)}`);
