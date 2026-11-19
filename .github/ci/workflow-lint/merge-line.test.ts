import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { isIntegration } from "../../../oxlint-plugins/test-names.ts";
import { projects } from "../../../vitest.config.ts";
import { lintWorkflow as lint } from "../workflow-lint.ts";
import { lintNoTooling } from "./merge-line.ts";
import {
  build,
  checkFlag,
  guard,
  type Parsed,
  place,
  type Plant,
  rejects,
  step,
  stepsOf,
  stop,
  testEnv,
  type Workflow,
} from "./wiring.test-support.ts";

// Today's CI, serving both versions. Covers merge-line.ts: no tooling test (T1), nothing of today's
// app (T2) and no promise check of today's version (T6) on the merge line. Each plant is given to
// every generated valid workflow alone (wiring.test-support.ts), so an unrelated error cannot mask
// it.

// The test job's one test step before 0539, the tooling tests on two machines: the `tooling`
// project, since next/ and today's trees are projects of their own and a project ignores `--exclude`.
const tooling = [
  'if [ -n "$BASE" ]; then',
  '  pnpm exec vitest run --project tooling --changed "$BASE" --shard "$SHARD" --passWithNoTests --reporter=default --reporter=json --outputFile.json="$RUNNER_TEMP/tooling.json"',
  "else",
  '  pnpm exec vitest run --project tooling --shard "$SHARD" --passWithNoTests --reporter=default --reporter=json --outputFile.json="$RUNNER_TEMP/tooling.json"',
  "fi",
  "",
].join("\n");

// What changes exposed before 0533 and 0539: the flags that started today's tests, its app end to
// end, and the tooling tests.
const goneFlags = ["today", "e2e", "test"] as const;

// The e2e job as it was before 0533, with its own place in ci-required's needs and its stop step
// last (F1), so T2 alone names it.
const todaysE2e = (run: Record<string, string>) => (w: Workflow) => {
  Object.assign(w.jobs, {
    e2e: { needs: "changes", if: guard("e2e"), "timeout-minutes": 25, steps: [run, stop] },
  });
  w.jobs["ci-required"].needs.push("e2e");
};

const plants: Plant[] = [
  // 0533: the promises gate tests today's pipeline code, so no step runs it, under any spelling or
  // flag. Source plant, run once on workflow-lint.ts and restored: drop T6's check (red: the five
  // check plants with no `if`, and the real-file scenario below). The one on the build flag and the
  // next job's are also held by the build-flag law and next's own command law.
  ...[
    { name: "promises", if: build, run: "pnpm promises gate" },
    { name: "promises", run: 'pnpm promises gate --base "$BASE"' },
    { name: "promises", run: "pnpm -s promises gate" },
    { name: "promises", run: "pnpm run promises confirm ship" },
    { name: "promises", run: "node packages/promises/src/main.ts gate" },
    { name: "promises", run: 'if [ -n "$BASE" ]; then\n  pnpm promises gate --base "$BASE"\nfi\n' },
  ].map((planted): [string, (w: Workflow) => void] => [
    `T6: check runs today's promise checks again: ${planted.run.split("\n")[0]}`,
    (w) => {
      // Before the stop step, which stays last (F1).
      w.jobs.check.steps.splice(-1, 0, planted);
    },
  ]),
  [
    "T6: the next job runs today's promise checks",
    (w) => {
      w.jobs.next.steps.splice(place(w, "next", "shard times"), 0, { name: "promises", run: "pnpm promises" });
    },
  ],
  // 0533: no event runs the tests of today's version or its app end to end, and 0539: none runs a
  // tooling test. T1: no output of changes can start them, and every vitest call names only next/'s
  // projects. T2: no job runs today's app. Each plant puts back one way those tests ran before, or a
  // new spelling of one. Source plants, each run once on workflow-lint.ts and restored: drop T1's
  // outputs check (red: the today, e2e and test flags back), drop T2's loop (red: every e2e plant),
  // drop T1's vitest loop (red: the old test job and each typecheck plant below; next's step plants
  // stay held by next's own command law).
  ...goneFlags.map((flag): [string, (w: Workflow) => void] => [
    `T1: changes exposes the ${flag} flag again`,
    (w) => {
      w.jobs.changes.outputs[flag] = `\${{ steps.diff.outputs.${flag} }}`;
    },
  ]),
  [
    "T1: the test job is back as it was before 0539, the tooling tests on two machines",
    (w) => {
      Object.assign(w.jobs, {
        test: {
          needs: "changes",
          if: guard("next"),
          "timeout-minutes": 30,
          strategy: { "fail-fast": false, matrix: { shard: [1, 2] } },
          steps: [
            { name: "install", run: "pnpm install --frozen-lockfile" },
            { name: "tooling tests", env: { ...testEnv, SHARD: `\${{ matrix.shard }}/2` }, run: tooling },
            stop,
          ],
        },
      });
      w.jobs["ci-required"].needs.push("test");
    },
  ],
  // In the typecheck job, before its stop step (F1): no other law lists its steps whole, so T1 alone
  // rejects these. In check, its own command law would hold them too.
  ...(
    [
      ["today's tests are back, on the today flag", "pnpm exec vitest run --shard \"$SHARD\" --exclude 'next/**'"],
      [
        "the lane tests are back, one file at a time",
        "pnpm exec vitest run packages/pipeline/src/stages/pipeline/lane. --maxWorkers=1 --exclude 'next/**'",
      ],
      ["the tooling project runs in typecheck", 'pnpm exec vitest run --project tooling --shard "$SHARD"'],
      ["the tooling project runs in typecheck, spelled with =", "pnpm exec vitest run --project=tooling"],
      ["the tooling project beside next's", "pnpm exec vitest run --project next --project tooling"],
      ["CI's own tests run by path, every project", "pnpm exec vitest run .github/ci/"],
      ["the root test script, every project", "pnpm test .github/ci/"],
      ["the root test script, run", "pnpm run test"],
      ["vitest through npx", "npx vitest run oxlint-plugins/"],
      ["the today project", "pnpm exec vitest run --project today"],
      // Fix round 1. The first T1 read one line at a time and knew only `vitest` and `pnpm … test`.
      // Run on it, 16 of the plants from here on were not rejected, the job-env one below included;
      // it already rejected the rest, kept as spellings.
      ["a line continuation adds the tooling project", "pnpm exec vitest run --project next \\\n  --project tooling\n"],
      ["pnpm's alias t", "pnpm t"],
      ["pnpm's alias tst", "pnpm tst"],
      ["pnpm test after a flag with a value", "pnpm --dir . test"],
      ["pnpm test after a short flag with a value", "pnpm -C . test"],
      ["npm test", "npm test"],
      ["npm's alias t", "npm t"],
      ["npm run test", "npm run test"],
      ["yarn test", "yarn test"],
      ["a test script of its own name", "pnpm test:tooling"],
      ["vitest through npx alone", "npx vitest"],
      ["vitest from a path into node_modules", "node node_modules/vitest/vitest.mjs run --project tooling"],
      [
        "a command substitution adds the tooling project",
        "pnpm exec vitest run --project next $(echo --project tooling)",
      ],
      [
        "a backquoted substitution adds the tooling project",
        "pnpm exec vitest run --project next `echo --project tooling`",
      ],
      ["an expression adds the tooling project", `pnpm exec vitest run --project next \${{ '--project tooling' }}`],
      ["a script's arguments add the tooling project", 'pnpm exec vitest run --project next "$@"'],
      [
        "another config, whose projects could hold anything",
        "pnpm exec vitest run --project next --config tooling.config.ts",
      ],
      ["another root", "pnpm exec vitest run --project next --root .github/ci"],
      ["a second command on the same line", "pnpm exec vitest run --project next; pnpm exec vitest run .github/ci/"],
      [
        "a variable the step sets to the tooling project",
        "pnpm exec vitest run --project next $EXTRA",
        { EXTRA: "--project tooling" },
      ],
      [
        "next's shard variable set to the tooling project",
        'pnpm exec vitest run --project next --shard "$SHARD"',
        { SHARD: "--project tooling" },
      ],
      ["next's filter variable read where no step sets it", "pnpm exec vitest run --project next $FILTER"],
    ] as const
  ).map((planted): [string, (w: Workflow) => void] => [
    `T1: ${planted[0]}`,
    (w) => {
      const env = planted.length === 3 ? { env: planted[2] } : {};
      stepsOf(w, "typecheck").splice(-1, 0, { name: "planted", run: planted[1], ...env });
    },
  ]),
  [
    "T1: the job's env sets the runner's temp folder that a vitest call reads",
    (w) => {
      Object.assign(w.jobs.next, { env: { RUNNER_TEMP: "--project tooling" } });
    },
  ],
  // 0536: today's tests and the tooling tests are projects of their own, so a second `--project`, or
  // none at all, runs them in next's vitest step. next's own command law holds these too.
  ...["today", "tooling"].map((project): [string, (w: Workflow) => void] => [
    `T1: next's vitest step runs the ${project} project's tests too`,
    (w) => {
      const found = step(w, "next", "vitest");
      found.run = found.run.replace("--project next ", `--project next --project ${project} `);
    },
  ]),
  [
    "T1: next's vitest step runs every project",
    (w) => {
      const found = step(w, "next", "vitest");
      found.run = found.run.replace("--project next ", "");
    },
  ],
  ["T2: the e2e job is back", todaysE2e({ name: "e2e", run: "pnpm --filter @kampus/fabrika-app-old e2e" })],
  ["T2: the e2e job is back, from the app's folder", todaysE2e({ name: "e2e", run: "cd apps/fabrika && node e2e.ts" })],
  [
    "T2: the ruler's end to end is back, with the folder as its working directory",
    todaysE2e({ name: "ruler", run: "node ruler-e2e.ts", "working-directory": "apps/fabrika" }),
  ],
  [
    "T2: check runs today's app end to end",
    (w) => {
      // Before the stop step, which stays last (F1).
      w.jobs.check.steps.splice(-1, 0, { run: "pnpm --filter @kampus/fabrika-app-old e2e -- --aria" });
    },
  ],
];

// T1076 O4. Each new fault goes through the existing whole-workflow acceptance path alone, on the
// generated valid workflow, whose fallback is the two roots of the `next` project.
plants.push(
  [
    "O4 legacy next-only fallback",
    (w) => {
      Object.assign(step(w, "next", "vitest").env!, {
        FILTER: `\${{ needs.changes.outputs.files || needs.changes.outputs.filter || 'next/' }}`,
      });
    },
  ],
  [
    "O4 fallback without the literal separator",
    (w) => {
      Object.assign(step(w, "next", "vitest").env!, {
        FILTER: `\${{ needs.changes.outputs.files || needs.changes.outputs.filter || 'next/kalfa/' }}`,
      });
    },
  ],
  [
    "O4 Kalfa-only fallback",
    (w) => {
      Object.assign(step(w, "next", "vitest").env!, {
        FILTER: `\${{ needs.changes.outputs.files || needs.changes.outputs.filter || 'kalfa/' }}`,
      });
    },
  ],
  [
    "O4 quoted two-root fallback",
    (w) => {
      Object.assign(step(w, "next", "vitest").env!, {
        FILTER: `\${{ needs.changes.outputs.files || needs.changes.outputs.filter || '"next/ kalfa/"' }}`,
      });
    },
  ],
  [
    "O4 reversed two-root fallback",
    (w) => {
      Object.assign(step(w, "next", "vitest").env!, {
        FILTER: `\${{ needs.changes.outputs.files || needs.changes.outputs.filter || 'kalfa/ next/' }}`,
      });
    },
  ],
  [
    "O4 extra project in the fallback",
    (w) => {
      Object.assign(step(w, "next", "vitest").env!, {
        FILTER: `\${{ needs.changes.outputs.files || needs.changes.outputs.filter || 'next/ kalfa/ --project tooling' }}`,
      });
    },
  ],
  [
    "O4 wrong precedence, the classifier first",
    (w) => {
      Object.assign(step(w, "next", "vitest").env!, {
        FILTER: `\${{ needs.changes.outputs.filter || needs.changes.outputs.files || 'next/ kalfa/' }}`,
      });
    },
  ],
  [
    "O4 ordinary command receives another changed restriction",
    (w) => {
      step(w, "next", "vitest").run += " --changed=HEAD";
    },
  ],
  [
    "O4 ordinary command adds a project",
    (w) => {
      step(w, "next", "vitest").run += " --project tooling";
    },
  ],
  [
    "O4 ordinary step receives an extra env input",
    (w) => {
      Object.assign(step(w, "next", "vitest").env!, { CHANGED: "--changed=HEAD" });
    },
  ],
);

rejects(plants);

// T1, T2 and T6 on the checked-in check.yaml: each plant puts back one piece of how today's tests
// ran before 0533, or the tooling tests before 0539, and gives its one error.
for (const [name, plant, error] of [
  [
    "T1: the today flag back on changes",
    (w: Parsed) => {
      w.jobs["changes"]!.outputs = { ...w.jobs["changes"]!.outputs, today: `\${{ steps.diff.outputs.today }}` };
    },
    "check.yaml: S1: changes exposes its flags, filter and the size step's outputs, and nothing else",
  ],
  [
    "T1: the test flag back on changes",
    (w: Parsed) => {
      w.jobs["changes"]!.outputs = { ...w.jobs["changes"]!.outputs, test: `\${{ steps.diff.outputs.test }}` };
    },
    "check.yaml: S1: changes exposes its flags, filter and the size step's outputs, and nothing else",
  ],
  [
    "T1: the tooling tests back in the typecheck job, before its stop step",
    (w: Parsed) => {
      w.jobs["typecheck"]!.steps.splice(-1, 0, {
        name: "tooling tests",
        env: { SHARD: "1/1" },
        run: 'pnpm exec vitest run --project tooling --shard "$SHARD" --passWithNoTests',
      });
    },
    "check.yaml: T1: typecheck runs no tooling test (0539)",
  ],
  [
    "T2: the e2e job back, with its place in ci-required's needs",
    (w: Parsed) => {
      // With the stop step last, as every job but ci-required ends (F1).
      const run = { run: "pnpm --filter @kampus/fabrika-app-old e2e" };
      Object.assign(w.jobs, {
        e2e: { needs: "changes", "timeout-minutes": 25, steps: [run, w.jobs["check"]!.steps.at(-1)] },
      });
      w.jobs["ci-required"]!.needs = [...[w.jobs["ci-required"]!.needs ?? []].flat(), "e2e"];
    },
    "check.yaml: T2: e2e runs nothing of today's app",
  ],
  [
    "T6: the promises gate back in check, on the check flag, before the field rows",
    (w: Parsed) => {
      // On the check flag like every lint step, and before the rows, so check's own step law (F1)
      // has nothing to say.
      w.jobs["check"]!.steps.splice(place(w, "check", "field rows"), 0, {
        name: "promises",
        if: checkFlag,
        env: { BASE: `\${{ github.event.pull_request.base.sha }}` },
        run: 'if [ -n "$BASE" ]; then\n  pnpm promises gate --base "$BASE"\nelse\n  pnpm promises gate\nfi\n',
      });
    },
    "check.yaml: T6: check runs no promise check of today's version",
  ],
] as const) {
  it(`scenario: ${name} is named by its one error`, () => {
    // scenario: the real workflow with one of the old pieces planted back, so the lint's own words
    // for each are read here.
    const workflow: Parsed = parse(readFileSync(new URL("../../workflows/check.yaml", import.meta.url), "utf8"));
    plant(workflow);
    expect(lint(JSON.stringify(workflow))).toEqual([error]);
  });
}

/** A project's test settings by its name, as vitest.config.ts gives them. */
const projectNamed = (name: string) => projects.find((project) => project.test.name === name)?.test;

it("T1 (0536): the tooling projects, the schedule's tooling legs' projects, hold no glob of today's trees or of next/", () => {
  // A project ignores `--exclude`, so the projects' own globs are what keeps today's tests and next/'s
  // out of scheduled.yaml's tooling legs (SC8). Plant, run once on vitest.config.ts and restored: add
  // "apps/*/src/**/*.test.ts" to TOOLING, which both projects are made from (red, on each).
  for (const name of ["tooling", "tooling-integration"]) {
    const tooling = projectNamed(name);
    expect(tooling, name).toBeDefined();
    expect(tooling!.include.length, name).toBeGreaterThan(0);
    expect(
      tooling!.include.filter((glob) => /^(?:apps|packages|programs|next)\//.test(glob)),
      name,
    ).toEqual([]);
  }
});

it("0602: tooling-integration holds the tooling laws that start a process, and tooling none of them", () => {
  // A tooling law that starts a process is an `.integration.` law (0584), and only main's full run
  // runs it, on the `tooling-integration` project (SC8). Plants, each run once on vitest.config.ts and
  // restored: drop TOOLING_INTEGRATION from tooling's `exclude` (red: tooling holds them); map
  // TOOLING_INTEGRATION's globs to plain names (red: tooling-integration holds plain laws).
  const tooling = projectNamed("tooling");
  const real = projectNamed("tooling-integration");
  expect(real?.include.length).toBeGreaterThan(0);
  expect(real?.include.every((glob) => isIntegration(glob))).toBe(true);
  expect(real?.include.every((glob) => tooling?.exclude.includes(glob) === true)).toBe(true);
});

// T1 (0539) holds every PR-reachable job, including L13 in host.yaml. The fixed box job is
// dispatch-only; its tooling laws run on no pull request or merge group.
const hostPath = ".github/workflows/host.yaml";

const hostYaml = () => parse(readFileSync(new URL("../../workflows/host.yaml", import.meta.url), "utf8"));

const l13 = (w: Parsed) => step(w, "launchd", "L13");

const hostError = `${hostPath}: T1: launchd runs no tooling test (0539)`;

it("scenario: the checked-in host.yaml runs no tooling test", () => {
  expect(lintNoTooling(hostPath, JSON.stringify(hostYaml()))).toEqual([]);
});

for (const [condition, dispatch] of [
  ["github.event_name == 'workflow_dispatch'", true],
  ["github.event_name == 'workflow_dispatch' && inputs.suite == 'box'", true],
  [`\${{ github.event_name == 'workflow_dispatch' }}`, true],
  [`\${{ github.event_name == 'workflow_dispatch' && inputs.suite == 'box' }}`, true],
  ["github.event_name == 'pull_request'", false],
  ["github.event_name == 'merge_group'", false],
  ["github.event_name == 'workflow_dispatch' || github.event_name == 'pull_request'", false],
  ["github.event_name == 'workflow_dispatch' && inputs.suite == 'box' || github.event_name == 'merge_group'", false],
  [`\${{ github.event_name == 'workflow_dispatch' || github.event_name == 'pull_request' }}`, false],
  ['contains(fromJSON(\'["workflow_dispatch","pull_request"]\'), github.event_name)', false],
  ["inputs.suite == 'box'", false],
  ["github.event_name != 'pull_request'", false],
  ["github.event_name == 'workflow_dispatch' && inputs.suite == github.event.inputs.suite", false],
  [undefined, false],
] as const) {
  it(`scenario: host tooling condition ${condition ?? "missing"} is ${dispatch ? "proved dispatch-only" : "rejected"}`, () => {
    const workflow: Parsed = hostYaml();
    Object.assign(workflow.jobs["box"]!, { if: condition });
    expect(lintNoTooling(hostPath, JSON.stringify(workflow))).toEqual(
      dispatch ? [] : [`${hostPath}: T1: box runs no tooling test (0539)`],
    );
  });
}

for (const [name, plant] of [
  [
    "its vitest call runs from the repository's root",
    (w: Parsed) => void Reflect.deleteProperty(l13(w), "working-directory"),
  ],
  ["its folder climbs out of next/", (w: Parsed) => void (l13(w)["working-directory"] = "next/../.github/ci")],
  ["its script changes folder first", (w: Parsed) => void (l13(w)["run"] = `cd ../..\n${String(l13(w)["run"])}`)],
  [
    "its root climbs out of next/",
    (w: Parsed) => void (l13(w)["run"] = String(l13(w)["run"]).replace("--root e2e", "--root ../../.github/ci")),
  ],
  [
    "a second step runs the tooling project from the root",
    (w: Parsed) =>
      void w.jobs["launchd"]!.steps.push({ name: "tooling", run: "pnpm exec vitest run --project tooling" }),
  ],
] as const) {
  it(`scenario: host.yaml where ${name} is named by its one error`, () => {
    const workflow: Parsed = hostYaml();
    plant(workflow);
    expect(lintNoTooling(hostPath, JSON.stringify(workflow))).toEqual([hostError]);
  });
}

it("scenario: a workflow that no pull request or merge queue starts is no merge line, so T1 leaves it", () => {
  const workflow: Parsed = hostYaml();
  workflow["on"] = { workflow_dispatch: {} };
  workflow.jobs["launchd"]!.steps.push({ name: "tooling", run: "pnpm exec vitest run --project tooling" });
  expect(lintNoTooling(hostPath, JSON.stringify(workflow))).toEqual([]);
  workflow["on"] = ["merge_group"];
  expect(lintNoTooling(hostPath, JSON.stringify(workflow))).toEqual([hostError]);
});

it("scenario: O4 the legacy filter is rejected by the merge-line guard itself, whatever another guard says", () => {
  // scenario: the real checked-in workflow with only the next job's fallback put back to next/. The
  // merge-line guard (T1) must name it, so another rule's error cannot stand in for it.
  const workflow: Parsed = parse(readFileSync(new URL("../../workflows/check.yaml", import.meta.url), "utf8"));
  expect(lint(JSON.stringify(workflow))).toEqual([]);

  const found = workflow.jobs["next"]!.steps.find(
    (candidate) =>
      typeof candidate["run"] === "string" &&
      candidate["run"].startsWith("pnpm exec vitest run --project next $FILTER "),
  );

  expect(found).toBeDefined();

  Object.assign(found!["env"]!, {
    FILTER: `\${{ needs.changes.outputs.files || needs.changes.outputs.filter || 'next/' }}`,
  });
  expect(lint(JSON.stringify(workflow)).some((error) => error.includes("T1:"))).toBe(true);
});
