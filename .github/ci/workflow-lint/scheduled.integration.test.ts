import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";

// Today's CI, serving both versions. These children only read YAML on stdin. No signals, network,
// application processes or files are changed. Plant: remove the CLI, as in the old version;
// success status alone then passes, but the required sentinel is absent and the positive law fails.
const script = fileURLToPath(new URL("./scheduled.ts", import.meta.url));

const source = readFileSync(new URL("../../workflows/scheduled.yaml", import.meta.url), "utf8");

const sentinel = "scheduled job slots conform\n";

const run = (input: string, args = ["--job-slots"]) =>
  spawnSync(process.execPath, [script, ...args], { input, encoding: "utf8" });

const workflow = fc
  .tuple(
    fc.integer({ min: 1, max: 9 }),
    fc.boolean(),
    fc.constantFrom("scheduled", `scheduled-\${{ github.ref }}`),
    fc.shuffledSubarray(["1", "2", "3", "4", "5", "6", "7", "8", "9"], { minLength: 9, maxLength: 9 }),
  )
  .map(([most, upper, group, slots]) => {
    const w = parse(source);
    w.concurrency.group = group;
    w.jobs.select.steps.find((step: { id?: string }) => step.id === "set").env.MOST = most;
    w.jobs.changed.strategy["max-parallel"] = most;
    const shards: string[] = w.jobs.tests.strategy.matrix.shard;
    const lookup = Object.fromEntries(shards.map((shard, index) => [shard, slots[index]]));
    w.jobs.tests.concurrency.group = `scheduled-test-\${{ fromJSON('${JSON.stringify(lookup)}')[matrix.shard] }}`;

    for (const job of Object.values<{ concurrency: { group: string } }>(w.jobs)) {
      if (upper) {
        job.concurrency.group = job.concurrency.group.replace(/^scheduled-/, "SCHEDULED-");
      }
    }

    // The boundary checks only shared slots. Full-workflow rules would reject these omissions.
    Reflect.deleteProperty(w, "on");
    Reflect.deleteProperty(w, "permissions");

    return w;
  });

it("property: the stdin CLI confirms shared job slots without requiring full-workflow conformance", () => {
  const reached = new Set<string>();

  fc.assert(
    fc.property(workflow, (w) => {
      reached.add(w.concurrency.group === "scheduled" ? "global" : "ref");
      reached.add(w.jobs.gate.concurrency.group.startsWith("SCHEDULED-") ? "upper" : "lower");
      const child = run(JSON.stringify(w));
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(child.stdout).toBe(sentinel);
      expect(child.stderr).toBe("");
    }),
    { seed: 119120, numRuns: 5 },
  );
  expect(
    ["global", "ref", "upper", "lower"].every((kind) => reached.has(kind)),
    [...reached].join(", "),
  ).toBe(true);
});

it("property: the stdin CLI refuses a private group on every shared job", () => {
  fc.assert(
    fc.property(workflow, fc.stringMatching(/^[a-z]{1,8}$/), (w, suffix) => {
      for (const name of ["gate", "select", "report", "tests", "changed"]) {
        const broken = structuredClone(w);
        broken.jobs[name].concurrency.group += `-${suffix}`;
        const child = run(JSON.stringify(broken));
        expect(child.error).toBeUndefined();
        expect(child.status).not.toBe(0);
        expect(child.stdout).not.toContain(sentinel.trim());
        expect(child.stderr).toContain("SC19:");
      }
    }),
    { seed: 119120, numRuns: 3 },
  );
});

it("property: the stdin CLI refuses extra jobs and changed matrices that leave the shared budget", () => {
  fc.assert(
    fc.property(workflow, fc.stringMatching(/^[a-z]{1,8}$/), (w, suffix) => {
      const extra = structuredClone(w);
      extra.jobs[`extra-${suffix}`] = { "runs-on": "ubuntu-latest", steps: [] };
      const axis = structuredClone(w);
      axis.jobs.changed.strategy.matrix.extra = [suffix];
      const fixed = structuredClone(w);
      fixed.jobs.changed.strategy.matrix.shard = ["10"];
      const expression = structuredClone(w);
      expression.jobs.changed.strategy.matrix.shard = `\${{ fromJSON(vars.shards) }}`;
      const parallel = structuredClone(w);
      parallel.jobs.changed.strategy["max-parallel"] = 10;

      for (const broken of [extra, axis, fixed, expression, parallel]) {
        const child = run(JSON.stringify(broken));
        expect(child.error).toBeUndefined();
        expect(child.status).not.toBe(0);
        expect(child.stdout).not.toContain(sentinel.trim());
        expect(child.stderr).toContain("SC19:");
      }
    }),
    { seed: 119120, numRuns: 3 },
  );
});

it("property: malformed stdin YAML never prints the success sentinel", () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[a-z]{1,8}$/), (key) => {
      const child = run(`${key}: [`);
      expect(child.error).toBeUndefined();
      expect(child.status).not.toBe(0);
      expect(child.stdout).not.toContain(sentinel.trim());
      expect(child.stderr).toContain("invalid YAML");
    }),
    { seed: 119120, numRuns: 3 },
  );
});

it("property: unsupported CLI arguments never print the success sentinel", () => {
  fc.assert(
    fc.property(fc.stringMatching(/^--[a-z]{1,8}$/), (arg) => {
      const child = run(source, [arg]);
      expect(child.error).toBeUndefined();
      expect(child.status).not.toBe(0);
      expect(child.stdout).not.toContain(sentinel.trim());
    }),
    { seed: 119120, numRuns: 3 },
  );
});
