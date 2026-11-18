import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { parse } from "yaml";

// Today's CI, serving both versions. These children only read YAML on stdin. No signals, network,
// application processes or files are changed. Plant (S7, run once and restored): put the 0595
// version of scheduled.ts back, so its `jobSlots` takes the nine `scheduled-test-` slots; then the
// old shape prints the sentinel and the pinned case fails, and every generated split is refused, so
// the positive law fails too.
const script = fileURLToPath(new URL("./scheduled.ts", import.meta.url));

const source = readFileSync(new URL("../../workflows/scheduled.yaml", import.meta.url), "utf8");

const sentinel = "scheduled job slots conform\n";

const run = (input: string, args = ["--job-slots"]) =>
  spawnSync(process.execPath, [script, ...args], { input, encoding: "utf8" });

// 0598's split of the nine test groups: MAIN_SLOTS for main's full run (1 to 8), PROOF_SLOTS for a
// branch's proof, the rest; each `tests` leg's pin is its group's number, the first legs of each map
// taking groups 1 to N in order, as SC20 asks.
const Workflow = Schema.Struct({
  main: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
  upper: Schema.Boolean,
  group: Schema.Literals(["scheduled", `scheduled-\${{ github.ref }}`]),
  mainTail: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))).check(
    Schema.isMinLength(9),
    Schema.isMaxLength(9),
  ),
  proofTail: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))).check(
    Schema.isMinLength(9),
    Schema.isMaxLength(9),
  ),
});

const Word = Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/));

const Argument = Schema.String.check(Schema.isPattern(/^--[a-z]{1,8}$/));

const REF = "github.ref == 'refs/heads/main'";

/** The numbers 1 to `count`, as text. */
const upTo = (count: number) => Array.from({ length: count }, (_, index) => String(index + 1));

/** Each leg's pin: the first `count` legs take groups 1 to `count` in order, the others `tail`'s group. */
const pinned = (shards: readonly string[], count: number, tail: readonly number[]) =>
  Object.fromEntries(shards.map((shard, i) => [shard, i < count ? String(i + 1) : String((tail[i]! % count) + 1)]));

/** The `tests` group as the real file writes it: the prefix and the map, each chosen by the ref. */
const testsGroup = (main: unknown, proof: unknown, upper: boolean) =>
  `\${{ ${REF} && '${upper ? "SCHEDULED-MAIN-" : "scheduled-main-"}' || '${upper ? "SCHEDULED-PROOF-" : "scheduled-proof-"}' }}\${{ fromJSON(${REF} && '${JSON.stringify(main)}' || '${JSON.stringify(proof)}')[matrix.shard] }}`;

/** The `changed` group: the proof prefix and the closed identity lookup over the proof groups. */
const changedGroup = (proof: number, upper: boolean) =>
  `${upper ? "SCHEDULED-PROOF-" : "scheduled-proof-"}\${{ fromJSON('${JSON.stringify(Object.fromEntries(upTo(proof).map((slot) => [slot, slot])))}')[fromJSON(needs.select.outputs.slots)[matrix.shard]] || '1' }}`;

const workflow = ({ main, upper, group, mainTail, proofTail }: typeof Workflow.Type) => {
  const proof = 9 - main;
  const w = parse(source);
  w.concurrency.group = group;
  w.env = { GAP_MINUTES: 60, MAIN_SLOTS: main, PROOF_SLOTS: proof };
  w.jobs.select.steps.find((step: { id?: string }) => step.id === "set").env.MOST = proof;
  w.jobs.changed.strategy["max-parallel"] = proof;
  w.jobs.tests.strategy["max-parallel"] = `\${{ ${REF} && ${main} || ${proof} }}`;
  const shards: string[] = w.jobs.tests.strategy.matrix.shard;
  w.jobs.tests.concurrency.group = testsGroup(pinned(shards, main, mainTail), pinned(shards, proof, proofTail), upper);
  w.jobs.changed.concurrency.group = changedGroup(proof, upper);

  for (const [name, job] of Object.entries<{ concurrency: { group: string } }>(w.jobs)) {
    if (upper && name !== "tests" && name !== "changed") {
      job.concurrency.group = job.concurrency.group.replace(/^scheduled-/, "SCHEDULED-");
    }
  }

  // The boundary checks only shared slots. Full-workflow rules would reject these omissions.
  Reflect.deleteProperty(w, "on");
  Reflect.deleteProperty(w, "permissions");

  return w;
};

const refuses = (w: unknown) => {
  const child = run(JSON.stringify(w));
  expect(child.error).toBeUndefined();
  expect(child.status).not.toBe(0);
  expect(child.stdout).not.toContain(sentinel.trim());
  expect(child.stderr).toContain("SC19:");
};

it.prop(
  "property: the stdin CLI confirms shared job slots without requiring full-workflow conformance",
  { value: Workflow },
  ({ value }) => {
    const reached = new Set<string>();

    // Each generated case walks every split from 1 to 8 and covers both queue forms and both prefix
    // cases, independent of RNG order. A child costs a process, so a case is 16 of them and the run
    // count stays small.
    const inputs: ReadonlyArray<typeof Workflow.Type> = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((main) => [
      { ...value, main },
      {
        ...value,
        main,
        upper: !value.upper,
        group: value.group === "scheduled" ? `scheduled-\${{ github.ref }}` : "scheduled",
      },
    ]);

    for (const input of inputs) {
      const w = workflow(input);
      reached.add(w.concurrency.group === "scheduled" ? "global" : "ref");
      reached.add(w.jobs.gate.concurrency.group.startsWith("SCHEDULED-") ? "upper" : "lower");
      reached.add(`split ${input.main}`);
      const child = run(JSON.stringify(w));
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(child.stdout).toBe(sentinel);
      expect(child.stderr).toBe("");
    }

    expect(
      ["global", "ref", "upper", "lower", ...inputs.map(({ main }) => `split ${main}`)].every((kind) =>
        reached.has(kind),
      ),
      [...reached].join(", "),
    ).toBe(true);
  },
  { arbitrary: { runs: 3 } },
);

it.prop(
  "property: the stdin CLI refuses a private group on every shared job",
  { value: Workflow, suffix: Word },
  ({ value, suffix }) => {
    const w = workflow(value);

    for (const name of ["gate", "select", "report", "tests", "changed"]) {
      const broken = structuredClone(w);
      broken.jobs[name].concurrency.group += `-${suffix}`;
      refuses(broken);
    }
  },
  { arbitrary: { runs: 3 } },
);

it.prop(
  "property: the stdin CLI refuses extra jobs and changed matrices that leave the shared budget",
  { value: Workflow, suffix: Word },
  ({ value, suffix }) => {
    const w = workflow(value);
    const proof = 9 - value.main;
    const extra = structuredClone(w);
    extra.jobs[`extra-${suffix}`] = { "runs-on": "ubuntu-latest", steps: [] };
    const axis = structuredClone(w);
    axis.jobs.changed.strategy.matrix.extra = [suffix];
    const fixed = structuredClone(w);
    fixed.jobs.changed.strategy.matrix.shard = [String(proof + 1)];
    const expression = structuredClone(w);
    expression.jobs.changed.strategy.matrix.shard = `\${{ fromJSON(vars.shards) }}`;
    const parallel = structuredClone(w);
    parallel.jobs.changed.strategy["max-parallel"] = proof + 1;
    const budget = structuredClone(w);
    budget.env.MAIN_SLOTS = value.main + 1;
    const private_ = structuredClone(w);
    private_.jobs.tests.concurrency.group = private_.jobs.tests.concurrency.group.replace(
      /scheduled-main-/i,
      "scheduled-test-",
    );

    for (const broken of [extra, axis, fixed, expression, parallel, budget, private_]) {
      refuses(broken);
    }
  },
  { arbitrary: { runs: 3 } },
);

// S7's pinned case: main's scheduled.yaml before 0598 (the 0595 shape at 955a82d), built here from
// today's file with the pieces 0595 had put back: `GAP_MINUTES` alone in `env`, nine `scheduled-test-`
// slots for the tests and changed jobs, `MOST` and `max-parallel` of nine. A branch cut before 0598
// carries this file; its proof run is refused at preflight until it merges main.
it("pinned: the stdin CLI refuses the 0595 shape, so a branch not yet on main's refuses preflight", () => {
  const w = parse(source);
  w.env = { GAP_MINUTES: 60 };
  w.jobs.select.steps.find((step: { id?: string }) => step.id === "set").env.MOST = 9;
  w.jobs.changed.strategy["max-parallel"] = 9;
  w.jobs.tests.strategy["max-parallel"] = 9;
  w.jobs.tests.strategy.matrix.shard = ["e2e-1", "e2e-2", "1", "2", "3", "4", "5", "tooling-1", "tooling-2"];
  w.jobs.tests.concurrency.group = `scheduled-test-\${{ fromJSON('{"e2e-1":"1","e2e-2":"6","1":"3","2":"4","3":"5","4":"2","5":"7","tooling-1":"8","tooling-2":"9"}')[matrix.shard] }}`;
  w.jobs.changed.concurrency.group = `scheduled-test-\${{ fromJSON('{"1":"1","2":"2","3":"3","4":"4","5":"5","6":"6","7":"7","8":"8","9":"9"}')[fromJSON(needs.select.outputs.slots)[matrix.shard]] || '1' }}`;
  Reflect.deleteProperty(w, "on");
  Reflect.deleteProperty(w, "permissions");
  refuses(w);
});

it.prop(
  "property: malformed stdin YAML never prints the success sentinel",
  { key: Word },
  ({ key }) => {
    const child = run(`${key}: [`);
    expect(child.error).toBeUndefined();
    expect(child.status).not.toBe(0);
    expect(child.stdout).not.toContain(sentinel.trim());
    expect(child.stderr).toContain("invalid YAML");
  },
  { arbitrary: { runs: 3 } },
);

it.prop(
  "property: unsupported CLI arguments never print the success sentinel",
  { arg: Argument },
  ({ arg }) => {
    const child = run(source, [arg]);
    expect(child.error).toBeUndefined();
    expect(child.status).not.toBe(0);
    expect(child.stdout).not.toContain(sentinel.trim());
  },
  { arbitrary: { runs: 3 } },
);
