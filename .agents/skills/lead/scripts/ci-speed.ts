// ci-speed.ts: the daily measure of CI against the owner's speed goal (experiment 293). Today's
// lead tooling. It prints, as Markdown, the three goal stages over the last 24 hours (median and
// worst 10%), the runners' machine-minutes per hour and their share of capacity, and flags each
// stage over its goal. The numbers come from ci/Speed.ts; GitHub's facts from ci/History.ts.
//
//   node .agents/skills/lead/scripts/ci-speed.ts                 print the measure
//   node .agents/skills/lead/scripts/ci-speed.ts --hours 48      over a longer window
//   node .agents/skills/lead/scripts/ci-speed.ts --issue         also open, add to or close the issue
//
// With --issue, a stage over its goal opens one `ci-scheduled` issue titled "CI speed", or adds the
// day's numbers to the open one, and a day with every stage within its goal closes it (0541 allows
// this measure that one label). ci-speed.yaml runs it once a day with --issue. It exits 0 either way:
// the issue is the alarm, not a red job.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, DateTime, Effect, Layer } from "effect";
import { Command, Flag } from "effect/cli";
import { History, Issues } from "./ci/History.ts";
import * as HistoryGh from "./ci/HistoryGh.ts";
import { LABEL_NAME, Move, TITLE, markdown, moveFor, readyRuns, report, type Report } from "./ci/Speed.ts";

/** Hours of runs read before the window, so a PR merged in it finds the push its head came from. */
export const LOOKBACK = 48;

/** Hours before the window whose runs' jobs still count, cut at the window's start, for jobs that ran into it. */
export const SPILL = 1;

/** Run ids asked for jobs at once: each is one call to GitHub. */
const CONCURRENCY = 6;

const HOUR = 3_600_000;

const iso = (ms: number) => new Date(ms).toISOString();

/** The measure over the `hours` before `now` (epoch ms), from GitHub's runs, jobs and merged PRs. */
export const measure = Effect.fn("ciSpeed.measure")(function* (now: number, hours: number) {
  const history = yield* History;
  const from = now - hours * HOUR;

  const [pulls, runs] = yield* Effect.all(
    [history.merged(iso(from)), history.runs(iso(from - LOOKBACK * HOUR), iso(now))],
    {
      concurrency: 2,
    },
  );

  const check = runs.filter((run) => run.workflow === "check");
  const busy = runs.filter((run) => run.created >= iso(from - SPILL * HOUR)).map((run) => run.id);
  const ids = [...new Set([...busy, ...readyRuns(pulls, check)])];
  const jobs = yield* Effect.forEach(ids, (id) => history.jobs(id), { concurrency: CONCURRENCY });

  return report({ now, hours, pulls, runs: check, jobs: jobs.flat() });
});

/** Brings the issue in line with the report: the move `Move` decides, made on GitHub. */
export const sync = Effect.fn("ciSpeed.sync")(function* (r: Report) {
  const issues = yield* Issues;
  const move = moveFor(r, yield* issues.open(LABEL_NAME));
  const body = markdown(r);

  yield* Move.match(move, {
    open: () => issues.create(TITLE, body, LABEL_NAME),
    comment: ({ number }) => issues.comment(number, body),
    close: ({ number }) =>
      Effect.andThen(issues.comment(number, `Every stage is back within its goal.\n\n${body}`), issues.close(number)),
    none: () => Effect.void,
  });

  return move;
});

const cli = Command.make(
  "ci-speed",
  {
    hours: Flag.Int("hours").pipe(Flag.withDefault(24)),
    issue: Flag.Boolean("issue").pipe(Flag.withDefault(false)),
    repo: Flag.String("repo").pipe(Flag.withDefault("kamp-us/tea-fabrika")),
  },
  Effect.fn("ciSpeed.cli")(function* ({ hours, issue, repo }) {
    const now = DateTime.toEpochMillis(yield* DateTime.now);

    const run = Effect.gen(function* () {
      const r = yield* measure(now, hours);
      yield* Console.log(markdown(r));

      if (issue) {
        const move = yield* sync(r);
        yield* Console.log(`\nIssue: ${move._tag}`);
      }
    });

    yield* run.pipe(Effect.provide(Layer.provide(HistoryGh.layer(repo), NodeServices.layer)));
  }),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(cli, { version: "0.0.0" })(process.argv.slice(2)).pipe(Effect.provide(NodeServices.layer)),
  );
}
