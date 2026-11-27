import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintMutation } from "./mutation.ts";
import { allSteps, map } from "./shared.ts";

// Today's CI, serving both versions. Covers mutation.ts: the hourly mutation run starts itself, and
// its heartbeat starts on every push to main as well as on its schedule.
const read = (name: string) => readFileSync(new URL(`../../workflows/${name}`, import.meta.url), "utf8");

const files = () => ({ run: map(parse(read("mutation.yaml"))), beat: map(parse(read("mutation-heartbeat.yaml"))) });

const lint = ({ run, beat }: { run: Record<string, unknown>; beat: Record<string, unknown> }) =>
  lintMutation(JSON.stringify(run), JSON.stringify(beat));

const job = (workflow: Record<string, unknown>, name: string) => map(map(workflow["jobs"])[name]);

it("pinned: the real mutation and heartbeat workflows pass", () => {
  expect(lint(files())).toEqual([]);
});

it("MU1: the run starts on a push to main, on a schedule and by hand, and on nothing else", () => {
  const dropped = ["push", "schedule", "workflow_dispatch"];

  for (const event of dropped) {
    const f = files();
    delete map(f.run["on"])[event];
    expect(lint(f), event).toEqual([expect.stringContaining("mutation.yaml: MU1")]);
  }

  for (const event of ["pull_request", "merge_group"]) {
    const f = files();
    map(f.run["on"])[event] = {};
    expect(lint(f), event).toEqual([expect.stringContaining("mutation.yaml: MU1")]);
  }

  const f = files();
  map(f.run["on"])["push"] = { branches: ["main", "next"] };
  expect(lint(f)).toEqual([expect.stringContaining("mutation.yaml: MU1")]);
});

it("MU2: one run at a time, and a running one is never cut short", () => {
  const f = files();
  map(f.run["concurrency"])["cancel-in-progress"] = true;
  expect(lint(f)).toEqual([expect.stringContaining("mutation.yaml: MU2")]);

  const g = files();
  delete g.run["concurrency"];
  expect(lint(g)).toEqual([expect.stringContaining("mutation.yaml: MU2")]);
});

it("MU3: a start by push or cron has no base, so the dispatch's base is optional", () => {
  const f = files();
  map(map(map(map(f.run["on"])["workflow_dispatch"])["inputs"])["base"])["required"] = true;
  expect(lint(f)).toEqual([expect.stringContaining("mutation.yaml: MU3")]);
});

it("MU4: the heartbeat starts on a push to main, on a schedule and by hand, and on nothing else", () => {
  for (const event of ["push", "schedule", "workflow_dispatch"]) {
    const f = files();
    delete map(f.beat["on"])[event];
    expect(lint(f), event).toEqual([expect.stringContaining("mutation-heartbeat.yaml: MU4")]);
  }

  const f = files();
  map(f.beat["on"])["pull_request"] = {};
  expect(lint(f)).toEqual([expect.stringContaining("mutation-heartbeat.yaml: MU4")]);
});

it("MU5: the heartbeat alone may write issues, in its one job, and runs heartbeat.ts with --issue", () => {
  const f = files();
  f.beat["permissions"] = { contents: "read", issues: "write" };
  expect(lint(f)).toEqual([expect.stringContaining("mutation-heartbeat.yaml: MU5")]);

  const g = files();
  map(job(g.beat, "heartbeat")["permissions"])["issues"] = "read";
  expect(lint(g)).toEqual([expect.stringContaining("mutation-heartbeat.yaml: MU5")]);

  const h = files();
  const step = allSteps(job(h.beat, "heartbeat")).find((s) => String(s["run"] ?? "").includes("heartbeat.ts"))!;
  step["run"] = "node .agents/skills/mutation/scripts/heartbeat.ts";
  expect(lint(h)).toEqual([expect.stringContaining("mutation-heartbeat.yaml: MU5")]);
});

it("MU6: one heartbeat at a time, so two runs never open two issues", () => {
  const f = files();
  map(f.beat["concurrency"])["cancel-in-progress"] = true;
  expect(lint(f)).toEqual([expect.stringContaining("mutation-heartbeat.yaml: MU6")]);

  const g = files();
  delete g.beat["concurrency"];
  expect(lint(g)).toEqual([expect.stringContaining("mutation-heartbeat.yaml: MU6")]);
});

it("MU7: the heartbeat's issue never takes the ci-scheduled label, which switches on a sev1", () => {
  const f = files();
  job(f.beat, "heartbeat")["name"] = "label ci-scheduled";
  expect(lint(f)).toEqual([expect.stringContaining("mutation-heartbeat.yaml: MU7")]);
});

it("MU8: the pause is a setting in the heartbeat's job, empty by default", () => {
  const f = files();
  delete map(job(f.beat, "heartbeat")["env"])["MUTATION_PAUSE"];
  expect(lint(f)).toEqual([expect.stringContaining("mutation-heartbeat.yaml: MU8")]);
});

const only = (law: string, file: string) => [expect.stringContaining(`${file}: ${law}`)];

it("MU1 and MU4: a push with tags or paths-ignore, or a cron more often than hourly, is refused in both workflows", () => {
  for (const [file, law, pick] of [
    ["mutation.yaml", "MU1", (f: ReturnType<typeof files>) => f.run],
    ["mutation-heartbeat.yaml", "MU4", (f: ReturnType<typeof files>) => f.beat],
  ] as const) {
    for (const extra of [{ tags: ["v*"] }, { "paths-ignore": ["docs/**"] }, { paths: ["next/**"] }]) {
      const f = files();
      Object.assign(map(map(pick(f)["on"])["push"]), extra);
      expect(lint(f), JSON.stringify(extra)).toEqual(only(law, file));
    }

    for (const cron of ["*/5 * * * *", "* * * * *", "0,30 * * * *", "31 */2 * * *", "31 * * * 1"]) {
      const f = files();
      map(pick(f)["on"])["schedule"] = [{ cron }];
      expect(lint(f), cron).toEqual(only(law, file));
    }
  }
});

it("MU3: no base fallback from the gate, or a gate that gives none, is refused", () => {
  const f = files();
  const range = allSteps(job(f.run, "mutation")).find((s) => s["id"] === "range")!;
  map(range["env"])["BASE"] = "the dispatch alone";
  expect(lint(f)).toEqual(only("MU3", "mutation.yaml"));

  const g = files();
  delete map(job(g.run, "gate")["outputs"])["base"];
  expect(lint(g)).toEqual(only("MU3", "mutation.yaml"));
});

it("MU9: each workflow keeps its run-list read, its main-only guard and its gate", () => {
  const plants: [string, (f: ReturnType<typeof files>) => void][] = [
    ["the workflow's actions read", (f) => delete map(f.run["permissions"])["actions"]],
    ["the gate's actions read", (f) => delete map(job(f.run, "gate")["permissions"])["actions"]],
    ["the gate's main guard", (f) => delete job(f.run, "gate")["if"]],
    ["the work job's main guard", (f) => (job(f.run, "mutation")["if"] = "needs.gate.outputs.start == 'true'")],
    ["the work job's gate", (f) => delete job(f.run, "mutation")["needs"]],
  ];

  for (const [label, plant] of plants) {
    const f = files();
    plant(f);
    expect(lint(f), label).toEqual(only("MU9", "mutation.yaml"));
  }

  const beats: [string, (f: ReturnType<typeof files>) => void][] = [
    ["the gate's actions read", (f) => delete map(job(f.beat, "gate")["permissions"])["actions"]],
    ["the check's actions read", (f) => delete map(job(f.beat, "heartbeat")["permissions"])["actions"]],
    ["the gate's main guard", (f) => delete job(f.beat, "gate")["if"]],
    ["the check's main guard", (f) => (job(f.beat, "heartbeat")["if"] = "needs.gate.outputs.start == 'true'")],
    ["the check's gate", (f) => delete job(f.beat, "heartbeat")["needs"]],
  ];

  for (const [label, plant] of beats) {
    const f = files();
    plant(f);
    expect(lint(f), label).toEqual(only("MU9", "mutation-heartbeat.yaml"));
  }
});

it("MU10: a job's timeout raised past its cap is refused", () => {
  const f = files();
  job(f.run, "mutation")["timeout-minutes"] = 46;
  expect(lint(f)).toEqual(only("MU10", "mutation.yaml"));

  const g = files();
  job(g.run, "gate")["timeout-minutes"] = 6;
  expect(lint(g)).toEqual(only("MU10", "mutation.yaml"));

  const h = files();
  job(h.beat, "heartbeat")["timeout-minutes"] = 11;
  expect(lint(h)).toEqual(only("MU10", "mutation-heartbeat.yaml"));
});

it("MU11: a setting outside its range, or no number, is refused wherever it is set", () => {
  for (const [name, bad] of [
    ["MUTATION_LATE_MINUTES", "30"],
    ["MUTATION_LATE_MINUTES", "99999"],
    ["MUTATION_LATE_MINUTES", "soon"],
    ["MUTATION_GAP_MINUTES", "1"],
    ["MUTATION_GAP_MINUTES", "1000"],
  ] as const) {
    const f = files();
    map(job(f.beat, "heartbeat")["env"])[name] = bad;
    expect(lint(f), `${name}=${bad}`).toEqual(only("MU11", "mutation-heartbeat.yaml"));
  }

  const g = files();
  map(g.run["env"])["MUTATION_MAX_RELATED"] = "500";
  expect(lint(g)).toEqual(only("MU11", "mutation.yaml"));

  for (const [name, bad] of [
    ["MUTATION_FAIL_STREAK", "0"],
    ["MUTATION_FAIL_STREAK", "11"],
    ["MUTATION_FAIL_GAP_MINUTES", "1"],
    ["MUTATION_FAIL_GAP_MINUTES", "1000"],
  ] as const) {
    const h = files();
    map(h.run["env"])[name] = bad;
    expect(lint(h), `${name}=${bad}`).toEqual(only("MU11", "mutation.yaml"));
  }
});

// pinned: heartbeat.test.ts holds the same two numbers for the range heartbeat.ts enforces. A test here may not
// import a script from .agents/skills, or a change to that script would select this file too (related.test.ts).
it("pinned: the lint's range for the limit is 105 to 1440 minutes, the one heartbeat.ts enforces", () => {
  const f = files();
  const LATE_RANGE = { least: 105, most: 1440 };

  for (const edge of [LATE_RANGE.least, LATE_RANGE.most]) {
    map(job(f.beat, "heartbeat")["env"])["MUTATION_LATE_MINUTES"] = String(edge);
    expect(lint(f), String(edge)).toEqual([]);
  }

  for (const edge of [LATE_RANGE.least - 1, LATE_RANGE.most + 1]) {
    map(job(f.beat, "heartbeat")["env"])["MUTATION_LATE_MINUTES"] = String(edge);
    expect(lint(f), String(edge)).toEqual(only("MU11", "mutation-heartbeat.yaml"));
  }
});

it("MU9 and MU12: the work jobs start only on their gate, and each gate and step names the right workflow, job and script", () => {
  const f = files();
  job(f.run, "mutation")["if"] = "github.ref == 'refs/heads/main'";
  expect(lint(f)).toEqual(only("MU9", "mutation.yaml"));

  const g = files();
  job(g.beat, "heartbeat")["if"] = "github.ref == 'refs/heads/main'";
  expect(lint(g)).toEqual(only("MU9", "mutation-heartbeat.yaml"));

  const gateStep = (workflow: Record<string, unknown>, name: string) =>
    allSteps(job(workflow, name)).find((s) => s["id"] === (name === "mutation" ? "range" : "gate"))!;

  const plants: [string, (f: ReturnType<typeof files>) => void][] = [
    [
      "the mutation gate reads the wrong job",
      (x) =>
        (gateStep(x.run, "gate")["run"] = String(gateStep(x.run, "gate")["run"]).replace(
          "--job mutation",
          "--job gate",
        )),
    ],
    [
      "the mutation gate reads the wrong workflow",
      (x) =>
        (gateStep(x.run, "gate")["run"] = String(gateStep(x.run, "gate")["run"]).replace(
          "--workflow mutation.yaml",
          "--workflow mutation-heartbeat.yaml",
        )),
    ],
    [
      "the mutation gate is paced by a gap",
      (x) => (gateStep(x.run, "gate")["run"] = `${String(gateStep(x.run, "gate")["run"])} --paced`),
    ],
    ["the range step does not call range.ts", (x) => (gateStep(x.run, "mutation")["run"] = "echo base=$BASE")],
  ];

  for (const [label, plant] of plants) {
    const x = files();
    plant(x);
    expect(lint(x), label).toEqual(only("MU12", "mutation.yaml"));
  }

  const beats: [string, (f: ReturnType<typeof files>) => void][] = [
    [
      "the heartbeat gate reads another workflow",
      (x) =>
        (gateStep(x.beat, "gate")["run"] = String(gateStep(x.beat, "gate")["run"]).replace(
          "--workflow mutation-heartbeat.yaml",
          "--workflow mutation.yaml",
        )),
    ],
    [
      "the heartbeat gate reads another job",
      (x) =>
        (gateStep(x.beat, "gate")["run"] = String(gateStep(x.beat, "gate")["run"]).replace(
          "--job heartbeat",
          "--job gate",
        )),
    ],
    [
      "the heartbeat gate has no gap",
      (x) => (gateStep(x.beat, "gate")["run"] = String(gateStep(x.beat, "gate")["run"]).replace(" --paced", "")),
    ],
  ];

  for (const [label, plant] of beats) {
    const x = files();
    plant(x);
    expect(lint(x), label).toEqual(only("MU12", "mutation-heartbeat.yaml"));
  }
});
