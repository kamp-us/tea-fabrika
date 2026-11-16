import { readFileSync } from "node:fs";
import { Array as Arr, Option } from "effect";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintCiSpeed } from "./ci-speed.ts";

// Today's CI, serving both versions. Covers ci-speed.ts.
// ci-speed.yaml, the daily measure (experiment 293): the checked-in file passes, and each plant on
// it gives its one error, so no rule hides behind another.
type SpeedFile = {
  on: Record<string, unknown>;
  permissions: unknown;
  jobs: Record<string, Record<string, unknown> & { steps: Record<string, unknown>[] }>;
};

const speedFile = (): SpeedFile =>
  parse(readFileSync(new URL("../../workflows/ci-speed.yaml", import.meta.url), "utf8"));

const speedJob = (w: SpeedFile) => Object.values(w.jobs)[0]!;

const speedStep = (w: SpeedFile, name: string) =>
  Option.getOrThrow(Arr.findFirst(speedJob(w).steps, (s) => s["name"] === name));

it("ci-speed.yaml as checked in passes", () => {
  expect(lintCiSpeed(readFileSync(new URL("../../workflows/ci-speed.yaml", import.meta.url), "utf8"))).toEqual([]);
});

for (const [name, plant, error] of [
  [
    "K1: a pull request starts it",
    (w: SpeedFile) => void (w.on["pull_request"] = null),
    "K1: it runs on one daily schedule and by hand, nothing else",
  ],
  [
    "K1: every five minutes",
    (w: SpeedFile) => void ((w.on["schedule"] as Record<string, string>[])[0]!["cron"] = "*/5 * * * *"),
    "K1: it runs on one daily schedule and by hand, nothing else",
  ],
  ["K2: a second job", (w: SpeedFile) => void (w.jobs["again"] = { ...speedJob(w) }), "K2: it has one job"],
  ["K2: a branch's copy", (w: SpeedFile) => void delete speedJob(w)["if"], "K2: the job runs main's copy only"],
  [
    "K2: no time limit",
    (w: SpeedFile) => void delete speedJob(w)["timeout-minutes"],
    "K2: the job sets timeout-minutes, at most 30",
  ],
  [
    "K3: the issue write on the workflow",
    (w: SpeedFile) => void (w.permissions = { issues: "write" }),
    "K3: the workflow's token grants nothing",
  ],
  [
    "K3: the job may write contents",
    (w: SpeedFile) => void ((speedJob(w)["permissions"] as Record<string, string>)["contents"] = "write"),
    "K3: the job's token reads actions, contents and pull requests and writes issues, nothing more",
  ],
  [
    "K4: the checkout keeps its token",
    (w: SpeedFile) => void delete (speedJob(w).steps[0]!["with"] as Record<string, unknown>)["persist-credentials"],
    "K4: its checkout sets persist-credentials: false",
  ],
  [
    "K5: no issue",
    (w: SpeedFile) =>
      void (speedStep(w, "measure")["run"] = String(speedStep(w, "measure")["run"]).replace(" --issue", "")),
    "K5: the measure step runs ci-speed.ts --issue into the job summary, with the job's token, under bash",
  ],
  [
    "K5: no pipefail",
    (w: SpeedFile) => void delete speedStep(w, "measure")["shell"],
    "K5: the measure step runs ci-speed.ts --issue into the job summary, with the job's token, under bash",
  ],
  [
    "K6: check.yaml's stop step added",
    (w: SpeedFile) =>
      void speedJob(w).steps.push({
        name: "stop the run",
        if: "failure() && github.event_name != 'push'",
        env: { GH_TOKEN: `\${{ github.token }}` },
        run: 'gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY"',
      }),
    "K6: no step cancels the run: one job has nothing to cancel",
  ],
  [
    "K7: a test step added",
    (w: SpeedFile) => void speedJob(w).steps.splice(-1, 0, { run: "pnpm exec vitest run --project tooling" }),
    "K7: its steps are the checkout, the pnpm setup, its install and the measure, nothing else",
  ],
  [
    "K7: another action added",
    (w: SpeedFile) => void speedJob(w).steps.splice(1, 0, { uses: "actions/setup-python@v6" }),
    "K7: its steps are the checkout, the pnpm setup, its install and the measure, nothing else",
  ],
  [
    "K7: the install runs its scripts",
    (w: SpeedFile) => void (speedJob(w).steps[2]!["run"] = "pnpm install --frozen-lockfile"),
    "K7: its steps are the checkout, the pnpm setup, its install and the measure, nothing else",
  ],
] as const) {
  it(`ci-speed.yaml ${name} is named by its one error`, () => {
    const workflow = speedFile();
    plant(workflow);
    expect(lintCiSpeed(JSON.stringify(workflow))).toEqual([`ci-speed.yaml: ${error}`]);
  });
}
