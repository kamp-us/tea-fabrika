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
