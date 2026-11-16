import { readFileSync } from "node:fs";
import { pipe } from "effect/Function";
import * as Str from "effect/String";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintWorkflow as lint } from "../workflow-lint.ts";
import {
  changedOnPullRequests,
  e2eCommand,
  e2eShard,
  legsOf,
  nextLegs,
  onE2e,
  options,
  place,
  type Plant,
  rejects,
  setLegs,
  sizedLegs,
  step,
  visualLabel,
  vitestShard,
  wiring,
  type Workflow,
} from "./wiring.test-support.ts";

// Today's CI, serving both versions. Covers next-job.ts: next's legs, shards, steps and pinned
// commands (E1 to E11). Each plant is given to every generated valid workflow alone
// (wiring.test-support.ts), so an unrelated error cannot mask it.

// What 1230 gave the vitest step: `--changed` on a pull request whose filter is all of next/.
const changedUnlessReaders = `\${{ github.event_name == 'pull_request' && (needs.changes.outputs.filter || 'next/') == 'next/' && format('--changed={0} --passWithNoTests', github.event.pull_request.base.sha) || '' }}`;

// Pinned T376 second-review bypasses, also applied to every generated valid workflow.
const extraCommands = [
  { run: "pnpm test next/" },
  { run: "pnpm run test" },
  { run: 'pnpm exec vi""test run next/' },
  { run: "cd next/apps/fabrika && node e2e.ts" },
  { run: "node e2e.ts", "working-directory": "next/apps/fabrika" },
  { run: "pnpm --filter @kampus/fabrika exec node e2e.ts" },
  { run: 'node next/apps/fabrika/src/exam/../exam/edges.ts --base "$BASE"' },
  { run: 'cd next/apps/fabrika/src/exam && node edges.ts --base "$BASE"' },
  { run: "npx playwright@latest install chromium" },
  { run: "pnpm --filter @kampus/fabrika exec playwright -- install chromium" },
];

it.each(extraCommands)("pinned: T376 review extra command in real workflow: $run", (added) => {
  const workflow = parse(readFileSync(new URL("../../workflows/check.yaml", import.meta.url), "utf8"));
  expect(lint(JSON.stringify(workflow))).toEqual([]);
  workflow.jobs.next.steps.push(added);
  expect(lint(JSON.stringify(workflow))).not.toEqual([]);
});

const plants: Plant[] = [
  ...extraCommands.map((added): [string, (w: Workflow) => void] => [
    `review2 extra command: ${added.run}`,
    (w) => {
      w.jobs.next.steps.push(added);
    },
  ]),
  ...["missing", "duplicate"].map((fault): [string, (w: Workflow) => void] => [
    `next ${fault} install`,
    (w) => {
      if (fault === "missing") {
        w.jobs.next.steps.splice(place(w, "next", "install"), 1);
      } else {
        w.jobs.next.steps.push({ ...step(w, "next", "install") });
      }
    },
  ]),
  [
    "review: extra exec Vitest invocation",
    (w) => {
      const vitest = step(w, "next", "vitest");
      w.jobs.next.steps.push({ ...vitest, run: `exec ${vitest.run}` });
    },
  ],
  ...[
    "vitest run next/",
    "pnpm vitest run next/",
    "npx vitest run next/",
    "./node_modules/.bin/vitest run next/",
    'pnpm exec "vitest" run next/',
    'env CI=true pnpm exec vitest run next/ --shard "$SHARD"',
    'echo before; pnpm exec vitest run next/ --shard "$SHARD"; echo after',
    'echo before\npnpm exec vitest run next/ --shard "$SHARD"\necho after',
    "pnpm exec vitest run next/; pnpm exec vitest run next/",
  ].map((run): [string, (w: Workflow) => void] => [
    `extra Vitest spelling: ${run}`,
    (w) => {
      w.jobs.next.steps.push({ ...step(w, "next", "vitest"), run });
    },
  ]),
  ...(
    [
      ["chromium", "Chromium"],
      ["end to end", "e2e"],
      ["edges", "edges"],
    ] as const
  ).map(([named, label]): [string, (w: Workflow) => void] => [
    `review: extra multiline ${label} invocation`,
    (w) => {
      const found = step(w, "next", named);
      w.jobs.next.steps.push({ ...found, run: `echo before\n${found.run}\necho after` });
    },
  ]),
  [
    "review: SHARD matrix.sha rd",
    (w) => {
      step(w, "next", "vitest").env!.SHARD = pipe(vitestShard(), Str.replace("matrix.shard", "matrix.sha rd"));
    },
  ],
  ...(
    [
      ["chromium", "Chromium"],
      ["end to end", "e2e"],
      ["edges", "edges"],
    ] as const
  ).map(([named, label]): [string, (w: Workflow) => void] => [
    `review: ${label} guard matrix.sha rd`,
    (w) => {
      const found = step(w, "next", named);
      found.if = pipe(found.if!, Str.replace("matrix.shard", "matrix.sha rd"));
    },
  ]),
  [
    "review: Chromium path next/ **",
    (w) => {
      const chromium = step(w, "next", "chromium");
      chromium.if = pipe(chromium.if!, Str.replace("next/**", "next/ **"));
    },
  ],
  // 0536, E10 and E11. Each plant was run once on the real check.yaml too, and restored.
  [
    "E10: the full fallback alone, as before 0536, so the merge queue starts the visual legs",
    (w) => {
      w.jobs.next.strategy.matrix.shard = `\${{ fromJSON(needs.changes.outputs.shards || '${JSON.stringify(nextLegs(2))}') }}`;
    },
  ],
  [
    "E10: the full fallback runs on main too, as before the schedule",
    (w) => {
      w.jobs.next.strategy.matrix.shard = pipe(
        w.jobs.next.strategy.matrix.shard,
        Str.replace(visualLabel, `(github.event_name == 'push' || ${visualLabel})`),
      );
    },
  ],
  [
    "E10: the full fallback runs in the merge queue",
    (w) => {
      w.jobs.next.strategy.matrix.shard = pipe(
        w.jobs.next.strategy.matrix.shard,
        Str.replace(visualLabel, `(github.event_name == 'merge_group' || ${visualLabel})`),
      );
    },
  ],
  [
    "E10: the full fallback runs on any pull request",
    (w) => {
      w.jobs.next.strategy.matrix.shard = pipe(
        w.jobs.next.strategy.matrix.shard,
        Str.replace(visualLabel, "github.event_name == 'pull_request'"),
      );
    },
  ],
  [
    "E10: the plain fallback holds a visual leg",
    (w) => {
      w.jobs.next.strategy.matrix.shard = sizedLegs(nextLegs(2), ["e2e-1", "1", "2", "3", "4", "5"]);
    },
  ],
  [
    "E11: the vitest step runs next-integration too",
    (w) => {
      const found = step(w, "next", "vitest");
      found.run = pipe(String(found.run), Str.replace("--project next ", "--project next --project next-integration "));
    },
  ],
  [
    "E11: the vitest step loses its project, so it runs every one",
    (w) => {
      const found = step(w, "next", "vitest");
      found.run = pipe(String(found.run), Str.replace("--project next ", ""));
    },
  ],
  [
    "E11: main runs next-integration through an env, as the bridge before the schedule did",
    (w) => {
      const found = step(w, "next", "vitest");
      found.run = pipe(String(found.run), Str.replace("--project next ", "$PROJECTS "));
      (found["env"] as Record<string, string>)["PROJECTS"] =
        `\${{ github.event_name == 'push' && '--project next --project next-integration' || '--project next' }}`;
    },
  ],
  [
    "review: edges event pull_ request",
    (w) => {
      const edges = step(w, "next", "edges");
      edges.if = pipe(edges.if!, Str.replace("pull_request", "pull_ request"));
    },
  ],
  // E1's legs (T967, after LE1). Each list is one fault, and the end-to-end step's `/N` is set to the
  // list's count of `e2e-k` legs, so only the legs' shape is wrong: a vitest leg gone or added, no
  // e2e leg, e2e legs out of order, after the numbered ones, from 0, or a plain `e2e`, and numbers
  // for strings. Source plants, each run once on workflow-lint.ts and restored: accept any end-to-end
  // `/N` (red: the e2e leg added or dropped, the denominators 1, -1 and 0, and LE2's one-more case);
  // drop the advice-after-the-end-to-end-step check (red: both advice-before cases).
  ...(
    [
      ["drops leg 5", ["e2e-1", "e2e-2", "1", "2", "3", "4"]],
      ["drops every e2e leg", ["1", "2", "3", "4", "5"]],
      ["adds leg 6", ["e2e-1", "e2e-2", "1", "2", "3", "4", "5", "6"]],
      ["numbers six legs with no e2e", ["1", "2", "3", "4", "5", "6"]],
      ["writes its numbered legs as numbers", ["e2e-1", "e2e-2", 1, 2, 3, 4, 5]],
      ["keeps the old six numbers", [1, 2, 3, 4, 5, 6]],
      ["puts its e2e legs last", ["1", "2", "3", "4", "5", "e2e-1", "e2e-2"]],
      ["writes e2e-2 before e2e-1", ["e2e-2", "e2e-1", "1", "2", "3", "4", "5"]],
      ["names a leg plain e2e", ["e2e", "e2e-1", "1", "2", "3", "4", "5"]],
      ["keeps the old plain e2e leg alone", ["e2e", "1", "2", "3", "4", "5"]],
      ["numbers its e2e legs from 0", ["e2e-0", "e2e-1", "1", "2", "3", "4", "5"]],
      ["skips e2e-2", ["e2e-1", "e2e-3", "1", "2", "3", "4", "5"]],
      ["repeats e2e-1", ["e2e-1", "e2e-1", "1", "2", "3", "4", "5"]],
      ["puts a vitest leg between its e2e legs", ["e2e-1", "1", "e2e-2", "2", "3", "4", "5"]],
    ] as const
  ).map(([fault, legs]): [string, (w: Workflow) => void] => [
    `next ${fault}`,
    (w) => {
      setLegs(w, legs);
      const count = legs.filter((leg) => typeof leg === "string" && /^e2e-[1-9]\d*$/.test(leg)).length;
      step(w, "next", "end to end").env!.SHARD = e2eShard(count);
    },
  ]),
  // E1 and E2: one e2e leg fewer or more than the end-to-end step's `/N`.
  [
    "next drops its last e2e leg and keeps its /N",
    (w) => {
      setLegs(
        w,
        legsOf(w).filter(
          (leg, _, all) => leg !== all.filter((l) => typeof l === "string" && pipe(l, Str.startsWith("e2e-"))).at(-1),
        ),
      );
    },
  ],
  [
    "next adds an e2e leg and keeps its /N",
    (w) => {
      const legs = legsOf(w);
      const count = legs.filter((leg) => typeof leg === "string" && pipe(leg, Str.startsWith("e2e-"))).length;
      legs.splice(count, 0, `e2e-${count + 1}`);
      setLegs(w, legs);
    },
  ],
  // E2's denominator, the end-to-end step's own: its full count one more or one fewer than its legs,
  // or not a count; no denominator. S1: the plain full count, which ignores a sized run's own count;
  // the sized count with no full count for a run that is not sized; the vitest legs' count.
  ...([1, -1, "", "x", "0", "plain", "sized only", "vitest's"] as const).map(
    (fault): [string, (w: Workflow) => void] => [
      `next end-to-end denominator ${fault === "" ? "absent" : fault}`,
      (w) => {
        const env = step(w, "next", "end to end").env!;
        const count = Number(/\|\| (\d+)\s*\}\}$/.exec(env.SHARD ?? "")?.[1]);
        const wrong: Record<string, string> = {
          "": `\${{ matrix.shard }}`,
          x: e2eShard("x"),
          "0": e2eShard(`0${count}`),
          plain: `\${{ matrix.shard }}/${count}`,
          "sized only": `\${{ matrix.shard }}/\${{ needs.legs.outputs.e2e }}`,
          "vitest's": `\${{ matrix.shard }}/\${{ needs.legs.outputs.vitest || ${count} }}`,
        };
        env.SHARD = typeof fault === "number" ? e2eShard(count + fault) : wrong[fault]!;
      },
    ],
  ),
  [
    "next end-to-end step loses its SHARD",
    (w) => {
      Reflect.deleteProperty(step(w, "next", "end to end"), "env");
    },
  ],
  // E2's command: each part the leg needs, dropped alone, so the run is no longer the pinned one.
  ...[
    ` --shard "\${SHARD#e2e-}"`,
    " --reporter=verbose",
    " --reporter=json",
    " --reporter=github-actions",
    ' --outputFile.json="$RUNNER_TEMP/next.json"',
  ].map((flag): [string, (w: Workflow) => void] => [
    `next end-to-end step loses ${flag}`,
    (w) => {
      const e2e = step(w, "next", "end to end");
      e2e.run = pipe(e2e.run, Str.replace(flag, ""));
    },
  ]),
  [
    "next end-to-end step passes the whole leg name",
    (w) => {
      const e2e = step(w, "next", "end to end");
      e2e.run = pipe(e2e.run, Str.replace(`"\${SHARD#e2e-}"`, '"$SHARD"'));
    },
  ],
  // E2's guard: exactly `startsWith(matrix.shard, 'e2e-')`.
  [
    "next end-to-end step loses its guard",
    (w) => {
      Reflect.deleteProperty(step(w, "next", "end to end"), "if");
    },
  ],
  ...["matrix.shard == 'e2e-1'", "matrix.shard == 'e2e'", `${onE2e} && false`, `${onE2e} || true`].map(
    (condition): [string, (w: Workflow) => void] => [
      `next end-to-end guard ${condition}`,
      (w) => {
        step(w, "next", "end to end").if = condition;
      },
    ],
  ),
  // E3: shard times after both test steps, so an e2e leg's next.json is read too.
  [
    "next timing advice before the end-to-end step",
    (w) => {
      const [advice] = w.jobs.next.steps.splice(place(w, "next", "shard times"), 1);
      w.jobs.next.steps.splice(place(w, "next", "end to end"), 0, advice!);
    },
  ],
  [
    "next chromium on every leg",
    (w) => {
      step(w, "next", "chromium").if = "hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''";
    },
  ],
  // LE1's denominator: `/6` leaves a sixth of the files on no machine, and a smaller one fails a leg.
  // S1: the plain `/5`, which ignores a sized run's own count; the sized count alone; the e2e count.
  ...[
    `/\${{ needs.legs.outputs.vitest || 6 }}`,
    `/\${{ needs.legs.outputs.vitest || 3 }}`,
    `/\${{ needs.legs.outputs.vitest || 4 }}`,
    "",
    `/\${{ needs.legs.outputs.vitest || 05 }}`,
    `/\${{ needs.legs.outputs.vitest || 5 }} `,
    "/5",
    `/\${{ needs.legs.outputs.vitest }}`,
    `/\${{ needs.legs.outputs.e2e || 5 }}`,
  ].map((denominator): [string, (w: Workflow) => void] => [
    `next wrong denominator ${denominator || "absent"}`,
    (w) => {
      step(w, "next", "vitest").env!.SHARD = `\${{ matrix.shard }}${denominator}`;
    },
  ]),
  // E3's vitest guard (after LE1): exactly one `if`, and it is `!startsWith(matrix.shard, 'e2e-')`.
  [
    "next vitest step loses its guard",
    (w) => {
      Reflect.deleteProperty(step(w, "next", "vitest"), "if");
    },
  ],
  ...[
    `!${onE2e} && false`,
    onE2e,
    `!${onE2e} || true`,
    "matrix.shard != 'e2e'",
    "matrix.shard != 'e2e-1'",
    "matrix.shard != 1",
  ].map((condition): [string, (w: Workflow) => void] => [
    `next vitest guard ${condition}`,
    (w) => {
      step(w, "next", "vitest").if = condition;
    },
  ]),
  // E2 and E3's leg steps: chromium and the end-to-end runner only on the e2e legs, edges only on 1.
  ...(
    [
      [
        "Chromium back on leg 1",
        "chromium",
        "matrix.shard == '1' && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''",
      ],
      [
        "Chromium on the old e2e leg",
        "chromium",
        "matrix.shard == 'e2e' && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''",
      ],
      ["e2e back on leg 1", "end to end", "matrix.shard == '1'"],
      ["e2e back on the number 1", "end to end", "matrix.shard == 1"],
      ["e2e on every numbered leg", "end to end", `!${onE2e}`],
      ["edges on the e2e legs", "edges", `${onE2e} && github.event_name == 'pull_request'`],
      ["edges on the number 1", "edges", "matrix.shard == 1 && github.event_name == 'pull_request'"],
    ] as const
  ).map(([fault, named, condition]): [string, (w: Workflow) => void] => [
    `next ${fault}`,
    (w) => {
      step(w, "next", named).if = condition;
    },
  ]),
  [
    "next fail fast",
    (w) => {
      w.jobs.next.strategy["fail-fast"] = true;
    },
  ],
  [
    "next extra axis",
    (w) => {
      Object.assign(w.jobs.next.strategy.matrix, { os: ["ubuntu"] });
    },
  ],
  [
    "next include",
    (w) => {
      Object.assign(w.jobs.next.strategy.matrix, { include: [{ shard: 7 }] });
    },
  ],
  [
    "next exclude",
    (w) => {
      Object.assign(w.jobs.next.strategy.matrix, { exclude: [{ shard: 6 }] });
    },
  ],
  [
    "next custom name",
    (w) => {
      Object.assign(w.jobs.next, { name: "next" });
    },
  ],
  [
    "next duplicate command",
    (w) => {
      w.jobs.next.steps.push({ ...step(w, "next", "vitest") });
    },
  ],
  ...[
    " --reporter=verbose",
    " --reporter=json",
    " --reporter=github-actions",
    ' --outputFile.json="$RUNNER_TEMP/next.json"',
  ].map((flag): [string, (w: Workflow) => void] => [
    `next loses ${flag}`,
    (w) => {
      const vitest = step(w, "next", "vitest");
      vitest.run = pipe(vitest.run, Str.replace(flag, ""));
    },
  ]),
  ...["missing", "duplicate", "before tests", "wrong report"].map((fault): [string, (w: Workflow) => void] => [
    `next timing advice ${fault}`,
    (w) => {
      const advice = step(w, "next", "shard times");

      if (fault === "missing") {
        w.jobs.next.steps.splice(place(w, "next", "shard times"), 1);
      } else if (fault === "duplicate") {
        w.jobs.next.steps.push({ ...advice });
      } else if (fault === "before tests") {
        w.jobs.next.steps.splice(place(w, "next", "shard times"), 1);
        w.jobs.next.steps.unshift(advice);
      } else {
        advice.run = 'node .github/ci/shard-times.ts "$RUNNER_TEMP/other.json"';
      }
    },
  ]),
  ...[
    "",
    "success()",
    "always()",
    "false",
    "matrix.shard == '1' && !cancelled()",
    "matrix.shard != 'e2e'",
    `!${onE2e}`,
  ].map((condition): [string, (w: Workflow) => void] => [
    `next timing advice condition ${condition || "absent"}`,
    (w) => {
      step(w, "next", "shard times").if = condition;
    },
  ]),
  ...[" --changed main", " --passWithNoTests", " file.test.ts"].map((suffix): [string, (w: Workflow) => void] => [
    suffix,
    (w) => {
      step(w, "next", "vitest").run += suffix;
    },
  ]),
  [
    "next test command inside a longer step",
    (w) => {
      step(w, "next", "vitest").run = `echo before\n${step(w, "next", "vitest").run}`;
    },
  ],
  [
    "next no shard flag",
    (w) => {
      step(w, "next", "vitest").run = "pnpm exec vitest run next/";
    },
  ],
  [
    "next guarded test",
    (w) => {
      Object.assign(step(w, "next", "vitest"), { if: "false" });
    },
  ],
  ...["chromium", "end to end", "edges"].flatMap((named, at): [string, (w: Workflow) => void][] => [
    [
      `next missing step ${at + 1}`,
      (w) => {
        w.jobs.next.steps.splice(place(w, "next", named), 1);
      },
    ],
    [
      `next duplicate step ${at + 1}`,
      (w) => {
        w.jobs.next.steps.push({ ...step(w, "next", named) });
      },
    ],
    [
      `next false step ${at + 1}`,
      (w) => {
        step(w, "next", named).if = "false";
      },
    ],
  ]),
  [
    "next e2e everywhere",
    (w) => {
      step(w, "next", "end to end").if = "true";
    },
  ],
  [
    "next chromium without file guard",
    (w) => {
      step(w, "next", "chromium").if = onE2e;
    },
  ],
  [
    "next edges without event guard",
    (w) => {
      step(w, "next", "edges").if = "matrix.shard == '1'";
    },
  ],
  // The plan for CI paths, slice 2, law 21: the next job's path comes from filter with the fallback
  // next/, and the changes job's parser steps carry continue-on-error.
  [
    "next loses its path fallback",
    (w) => {
      step(w, "next", "vitest").env!.FILTER = `\${{ needs.changes.outputs.filter }}`;
    },
  ],
  [
    "next runs all of next/ whatever filter says",
    (w) => {
      step(w, "next", "vitest").run = pipe(step(w, "next", "vitest").run, Str.replace("$FILTER", "next/"));
    },
  ],
  [
    "next quotes its path, so the reader paths are one argument",
    (w) => {
      step(w, "next", "vitest").run = pipe(step(w, "next", "vitest").run, Str.replace("$FILTER", '"$FILTER"'));
    },
  ],
  [
    "next has no filter",
    (w) => {
      delete (step(w, "next", "vitest").env as Record<string, string>)["FILTER"];
    },
  ],
  // After PR 1230: under the reader filter, `--changed` would drop the reader tests, which reach a
  // changed file by reading it, not by importing it. So the vitest step's CHANGED is empty there.
  [
    "next narrows the reader tests with --changed",
    (w) => {
      (step(w, "next", "vitest").env as Record<string, string>)["CHANGED"] = changedOnPullRequests;
    },
  ],
  // PR 1235: a sized run's vitest legs run the legs job's `files`, which hold every reader test, and
  // nothing narrows that list again. 1230's own `--changed` back on the step drops the readers; the
  // legs list ignored or read after filter runs the import graph's files alone or the whole suite;
  // 1235's first shape, a readers step on leg 1, runs a reader twice and loads leg 1 alone.
  [
    "next's vitest step ignores legs's files",
    (w) => {
      w.jobs.next.steps[0]!.env!.FILTER = `\${{ needs.changes.outputs.filter || 'next/' }}`;
    },
  ],
  [
    "next's vitest step reads legs's files after filter",
    (w) => {
      w.jobs.next.steps[0]!.env!.FILTER = `\${{ needs.changes.outputs.filter || needs.legs.outputs.files || 'next/' }}`;
    },
  ],
  [
    "next's vitest step narrows legs's files with 1230's --changed",
    (w) => {
      const step = w.jobs.next.steps[0]!;
      step.run = pipe(step.run, Str.replace("$FILTER ", "$FILTER $CHANGED "));
      (step.env as Record<string, string>)["CHANGED"] = changedUnlessReaders;
    },
  ],
  [
    "next's vitest step takes another env key",
    (w) => {
      (w.jobs.next.steps[0]!.env as Record<string, string>)["READERS"] = `\${{ needs.changes.outputs.readers }}`;
    },
  ],
  [
    "next runs the reader tests again in a step of their own on leg 1",
    (w) => {
      w.jobs.next.steps.splice(1, 0, {
        name: "readers",
        if: "!cancelled() && matrix.shard == '1'",
        run: 'pnpm exec vitest run $READERS --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/readers.json"',
      });
    },
  ],
  [
    "next job excludes next",
    (w) => {
      step(w, "next", "vitest").run += " --exclude 'next/**'";
    },
  ],
];

rejects(plants);

it("names the next command whose step or condition is wrong", () => {
  fc.assert(
    fc.property(
      wiring,
      fc.constantFrom("chromium", "end to end", "edges"),
      fc.boolean(),
      (broken, named, missingGuard) => {
        const found = step(broken, "next", named);
        found.if = missingGuard
          ? named === "end to end"
            ? "true"
            : named === "chromium"
              ? onE2e
              : "matrix.shard == '1'"
          : "false";
        expect(lint(JSON.stringify(broken))).toEqual([
          `check.yaml: next runs ${found.run} once, only on ${named === "edges" ? "leg 1" : "the e2e legs"}, with its pinned condition`,
        ]);
      },
    ),
    options,
  );
});

// LE2, today's CI. LE1's four faults, each planted alone in every generated valid workflow, and the
// one error the lint must give for it. An error list of exactly one line shows that the fault is
// named and that nothing else hides behind it.
// Plants, each run once on workflow-lint.ts and restored: accept any `if` on the vitest step (red:
// the `if` taken off went unnamed); accept any denominator (red: `/6` went unnamed).
const faults: [string, (workflow: Workflow) => void, string][] = [
  [
    "a /6 denominator",
    (w) => {
      // Keeps the generated spacing; LE2's one-error check fails if there is no SHARD to change.
      const env = step(w, "next", "vitest").env!;

      if (env.SHARD !== undefined) {
        env.SHARD = pipe(env.SHARD, Str.replace(/\|\| 5(\s*\}\})$/, "|| 6$1"));
      }
    },
    "next's vitest step passes --shard <leg>/<the count of numbered legs>",
  ],
  [
    "leg 5 dropped",
    (w) => {
      setLegs(w, legsOf(w).slice(0, -1));
    },
    "next's legs are e2e-1 to e2e-N in order, then 1 to 5, all strings, with no other matrix entries",
  ],
  [
    "the end-to-end step back on leg 1",
    (w) => {
      step(w, "next", "end to end").if = pipe(
        step(w, "next", "end to end").if!,
        Str.replace(onE2e, "matrix.shard == '1'"),
      );
    },
    `next runs ${e2eCommand} once, only on the e2e legs, with its pinned condition`,
  ],
  [
    "the `if` taken off the vitest step",
    (w) => {
      Reflect.deleteProperty(step(w, "next", "vitest"), "if");
    },
    "next's vitest step runs only on the numbered legs, and has no other guard",
  ],
  // T967. E1's `e2e-2, e2e-1` order, E2's `/N` one more than the e2e legs, and E3's advice before
  // the end-to-end step, each planted alone; each names itself and nothing else.
  [
    "the e2e legs written out of order",
    (w) => {
      const legs = legsOf(w);
      const count = legs.filter((leg) => typeof leg === "string" && pipe(leg, Str.startsWith("e2e-"))).length;
      legs.splice(0, count, ...legs.slice(0, count).toReversed());

      // One e2e leg cannot be out of order, so a second one comes first.
      if (count === 1) {
        legs.unshift("e2e-2");
        step(w, "next", "end to end").env!.SHARD = e2eShard(2);
      }

      setLegs(w, legs);
    },
    "next's legs are e2e-1 to e2e-N in order, then 1 to 5, all strings, with no other matrix entries",
  ],
  [
    "an end-to-end /N one more than the e2e legs",
    (w) => {
      const env = step(w, "next", "end to end").env!;
      env.SHARD = (env.SHARD ?? "").replace(
        /\|\| (\d+)(\s*\}\})$/,
        (_, count: string, end: string) => `|| ${Number(count) + 1}${end}`,
      );
    },
    "next's end-to-end step passes --shard <leg>/<the count of e2e legs>",
  ],
  [
    "the timing advice before the end-to-end step",
    (w) => {
      const [advice] = w.jobs.next.steps.splice(place(w, "next", "shard times"), 1);
      w.jobs.next.steps.splice(place(w, "next", "end to end"), 0, advice!);
    },
    "next timing advice follows both test steps even after failure, unless cancelled",
  ],
];

it.each(faults)("LE2: names %s when it alone is planted", (_fault, mutate, error) => {
  fc.assert(
    fc.property(wiring, (clean) => {
      expect(lint(JSON.stringify(clean))).toEqual([]);
      const broken = structuredClone(clean);
      mutate(broken);
      expect(lint(JSON.stringify(broken))).toEqual([`check.yaml: ${error}`]);
    }),
    options,
  );
});
