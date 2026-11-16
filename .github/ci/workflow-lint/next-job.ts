// Today's CI, serving both versions. check.yaml's next job: its legs (E1, E10), each leg's
// `--shard` (E2), the vitest and end-to-end steps (E3, E11), and its pinned commands.
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import {
  CHANGED_FROM_BASE,
  chromium,
  compact,
  denominator,
  E2E_PREFIX,
  ends,
  fallbacks,
  legs,
  map,
  ON_E2E,
  type Rule,
  SHARD_OF,
  steps,
  VISUAL_FILES,
  VISUAL_LABEL,
} from "./shared.ts";
import { TIME_TABLE } from "./time-tables.ts";

// The vitest legs of next's matrix, "1" to "5", each a string.
const VITEST_LEGS = ["1", "2", "3", "4", "5"];

export const nextLaws: Rule = ({ jobs }, require) => {
  const nextJob = map(jobs["next"]),
    strategy = map(nextJob["strategy"]),
    matrix = map(strategy["matrix"]),
    nextSteps = steps(nextJob);
  require(!("name" in nextJob), "next keeps the default matrix check names");
  // E1. The matrix is `fromJSON(needs.changes.outputs.shards || (<when> && '<full>' || '<vitest>'))`:
  // on a run that tests all of next/ from a base, changes' sized legs, else a fallback (E10). The
  // full one is the end-to-end legs
  // `e2e-1` to `e2e-N`, in order, then the vitest legs "1" to "5", all strings. The count N is E4's,
  // in vitest.shards.test.ts; here only its shape and its `/N`. The sized legs are legs.ts's
  // `shards`, the same shape cut shorter (legs.test.ts).
  // Plants (T967), each run once on check.yaml and restored, each exit 1: drop e2e-2 and keep `/2`
  // (E2's count error); `e2e-2, e2e-1` (E1); a leg named plain `e2e` (E1 and E2); `/3` with two legs
  // (E2); the end-to-end step's guard dropped (E2); `--shard` dropped (E2's command); shard times back
  // before the end-to-end step (E3); chromium on every leg (E3); the vitest step on the old
  // `matrix.shard != 'e2e'` (E3).
  const allLegs = legs(nextJob),
    e2eCount = ends(allLegs).length;
  const expectedLegs = [...Array.from({ length: e2eCount }, (_, i) => `${E2E_PREFIX}${i + 1}`), ...VITEST_LEGS];
  require(e2eCount >= 1 &&
    JSON.stringify(allLegs) === JSON.stringify(expectedLegs) &&
    Object.keys(matrix).length ===
      1, "next's legs are e2e-1 to e2e-N in order, then 1 to 5, all strings, with no other matrix entries");
  // E10 (0536). The visual tests never start unasked: the full fallback runs only on a pull request
  // with the `visual` label, and every other unsized run, the merge queue and main among them, gets
  // the vitest legs alone; the schedule runs the visual tests. Plants, each run once on check.yaml
  // and restored: the full fallback alone, as before (red); `github.event_name == 'push' ||` beside
  // the label (red); the vitest fallback with e2e-1 (red).
  const { when, plain } = fallbacks(nextJob);
  require(compact(when) === compact(VISUAL_LABEL) &&
    JSON.stringify(plain) ===
      JSON.stringify(
        VITEST_LEGS,
      ), "E10: next's full fallback runs only with the visual label, else the vitest legs 1 to 5 alone");
  require(strategy["fail-fast"] === false, "next lets every shard finish");
  // The vitest step's paths, unquoted so each path is its own argument. On a sized run (a pull
  // request, a merge queue group or a push to main, 0534) changes' `files`: what `--changed` picked
  // and every reader test, each once (legs.ts), so the step takes no `--changed` of its own, which
  // would drop the readers again. Else the plan for CI paths, slice 2: `filter` from changes, the
  // reader tests or `next/`, and a missing filter runs all of next/.
  const nextCommand =
    'pnpm exec vitest run --project next $FILTER --shard "$SHARD" --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/next.json"';
  // E11 (0536). The vitest step tests the `next` project alone, on every event: the merge line runs
  // the in-memory layer, and the schedule runs the real-resource one. A path filter alone finds a
  // file in any project, so the flag is what keeps `next-integration` out. Plants, each run once on
  // check.yaml and restored: `--project next` dropped (red); `--project next-integration` beside it
  // (red).
  // The leg `e2e-k` with SHARD `e2e-k/N` asks Vitest for shard `k/N` of the visual files, the
  // `next-visual` project. It takes no filter, so under the reader filter the e2e legs still run every
  // visual file the change reaches.
  const e2eCommand = `pnpm exec vitest run --project next-visual $CHANGED --shard "\${SHARD#e2e-}" --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/next.json"`;
  const adviceCommand = 'node .github/ci/shard-times.ts "$RUNNER_TEMP/next.json"';
  // Only these whole scripts are allowed; shell aliases and alternate paths cannot add work.
  const allowed = [
    "pnpm install --frozen-lockfile",
    nextCommand,
    adviceCommand,
    chromium,
    e2eCommand,
    'node next/apps/fabrika/src/exam/edges.ts --base "$BASE"',
    TIME_TABLE,
  ];
  const nextRuns = pipe(
    nextSteps,
    Arr.filter((s) => "run" in s),
    Arr.map((s) => s["run"]),
  );
  require(nextRuns.length === allowed.length &&
    Arr.every(
      allowed,
      (command) => Arr.filter(nextRuns, (run) => run === command).length === 1,
    ), "next runs exactly its install and six approved commands once each");
  const testStep = Option.getOrUndefined(Arr.findFirst(nextSteps, (s) => s["run"] === nextCommand));
  require(testStep !==
    undefined, "E11: next's vitest step runs the next project alone, with --shard and no exclusions");
  const shard = map(testStep?.["env"])["SHARD"];
  // E3. The one `if` the vitest step may carry. Without it an e2e leg asks vitest for `e2e-1/5`.
  require(compact(testStep?.["if"]) ===
    compact(`!${ON_E2E}`), "next's vitest step runs only on the numbered legs, and has no other guard");
  // A larger denominator leaves a share of the files on no machine; a smaller one fails a leg.
  require(typeof shard === "string" &&
    new RegExp(`^${SHARD_OF}/${denominator("vitest", VITEST_LEGS.length)}$`).test(
      shard,
    ), "next's vitest step passes --shard <leg>/<the count of numbered legs>");
  // The size step's list first, so a sized run runs the files it was sized with; changes' filter
  // after, so every other run keeps it. SHARD and FILTER are its whole env: a CHANGED here would
  // narrow the list again, past the readers.
  require(compact(map(testStep?.["env"])["FILTER"]) ===
    "needs.changes.outputs.files||needs.changes.outputs.filter||'next/'", "next's vitest step takes changes' files, else filter, with the fallback next/");
  require(JSON.stringify(Arr.sort(Object.keys(map(testStep?.["env"])), Order.String)) ===
    JSON.stringify(["FILTER", "SHARD"]), "next's vitest step's env is SHARD and FILTER alone");
  // E2. The same for the end-to-end step, over the count of e2e legs.
  const e2eStep = Option.getOrUndefined(Arr.findFirst(nextSteps, (s) => s["run"] === e2eCommand));
  const e2eShard = map(e2eStep?.["env"])["SHARD"];
  require(typeof e2eShard === "string" &&
    new RegExp(`^${SHARD_OF}/${denominator("e2e", e2eCount)}$`).test(
      e2eShard,
    ), "next's end-to-end step passes --shard <leg>/<the count of e2e legs>");

  // The end-to-end step narrows to the changed files from changes' `base`, the commit the size step
  // sized these legs from, and from nothing else: a run the size step did not size has no `base` and
  // runs every end-to-end file, so a failed sizing never narrows. The schedule runs them all.
  require(map(e2eStep?.["env"])["CHANGED"] ===
    CHANGED_FROM_BASE, "next's end-to-end step narrows with --changed from changes' base alone");

  // E3. Both kinds of leg write next.json, so the advice comes after both test steps.
  const advice = Option.getOrUndefined(Arr.findFirst(nextSteps, (s) => s["run"] === adviceCommand));
  require(testStep !== undefined &&
    e2eStep !== undefined &&
    advice !== undefined &&
    nextSteps.indexOf(testStep) < nextSteps.indexOf(advice) &&
    nextSteps.indexOf(e2eStep) < nextSteps.indexOf(advice) &&
    compact(advice["if"]) ===
      "!cancelled()", "next timing advice follows both test steps even after failure, unless cancelled");

  // E2 and E3. Chromium and the end-to-end runner only on the e2e legs, edges only on leg 1.
  for (const [command, leg, condition] of [
    [chromium, "the e2e legs", `${ON_E2E} && ${VISUAL_FILES}`],
    [e2eCommand, "the e2e legs", ON_E2E],
    [
      'node next/apps/fabrika/src/exam/edges.ts --base "$BASE"',
      "leg 1",
      "matrix.shard == '1' && github.event_name == 'pull_request'",
    ],
  ] as const) {
    const matches = Arr.filter(nextSteps, (s) => s["run"] === command);
    require(matches.length === 1 &&
      compact(matches[0]?.["if"]) ===
        compact(condition), `next runs ${command} once, only on ${leg}, with its pinned condition`);
  }
};
