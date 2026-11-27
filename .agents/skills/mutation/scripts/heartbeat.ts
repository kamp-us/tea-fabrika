import { execFileSync } from "node:child_process"; // edge: the one `gh` call every read and write goes through
/**
 * The hourly mutation run's heartbeat: is a merge on main waiting longer than the limit for a
 * passing run? Today's lead tooling. The run starts itself (a push to main, an hourly catch-up, or
 * a hand dispatch: `.github/workflows/mutation.yaml`), so this watches the outcome and not the
 * starter: whichever way the run stops starting, the alarm is the same. On 2026-11-13 the run
 * stopped, its dispatcher being a session that ended, and for 13 days about 630 merges went by
 * with no run and no word. `.github/workflows/mutation-heartbeat.yaml` runs this on a push to
 * main (its gate lets one through an hour), each hour and by hand, and goes red when late:
 *
 *   node .agents/skills/mutation/scripts/heartbeat.ts [--issue]
 *   mutation heartbeat: late: 21 merges since the last passing run (2026-11-11T05:40:24Z), the oldest 3.6 h ago, past the 3.5 h limit
 *
 * It starts no run and reads no artifact. It reads (through `gh`, in the repo `GH_REPO` names, which
 * `runs.ts` wraps) the newest passing run of the `mutation` job on main, and counts the merges since the
 * commit that run ended at with GitHub's compare API: its `ahead_by` is the whole count however many
 * there are, and its first commit, oldest first, is the merge that has waited longest. A run counts as
 * passing when its `mutation` job passed, so a run the gate skipped (`mutation-gate.mjs`) never hides a dead one.
 * With `--issue` it also
 * keeps one GitHub issue, titled `TITLE` and labeled `LABEL`: late opens it (or comments on the open
 * one), a green check closes it, a pause leaves it as it was. The label is not `ci-scheduled`:
 * that one switches on a sev1 (sev skill), and whether a dead mutation run is one is the owner's call.
 *
 * Settings, each an environment variable the workflow sets (limits are settings):
 *
 *   MUTATION_LATE_MINUTES  how long a merge may wait for a passing run; default 210, which is 3.5 h; 105 to 1440
 *   MUTATION_PAUSE         empty, or `{"until":"<ISO time>","reason":"<why>"}`
 *
 * 210 minutes is two full runs, as Prometheus's alerting practices ask of a batch job (an alert
 * waits "at least enough time for 2 full runs"): a merge waits up to one hour for the next run,
 * which takes up to the workflow's 45-minute limit, so one failed run is no alarm and two are. A
 * pause is an Alertmanager silence's shape: it has an end and a reason (the commit that sets it
 * says who), and when the end passes the alarm turns on by itself. A pause with a bad end, no end
 * or no reason fails the check, so a typo never reads as "no pause". A skipped run (no test beside a
 * changed file) passes, so a quiet range never reads as late.
 *
 * Hand-written, since no tool here does it: GitHub's own mail for a failed scheduled run needs a
 * scheduled run, and GitHub's cron fires only about 3 times a day on this repo (measured on
 * scheduled.yaml), so the check also runs on every push. An outside dead-man switch (Healthchecks.io
 * and the like) would also watch this check itself. No rule here forbids one, but it is an outside
 * account with a key and nobody has set one up, so this first version has none: if the heartbeat
 * workflow itself stops, nothing says so. Its edge cases, each in the test:
 *
 * - No merge since the last passing run: ok, however old that run is (no merge, no run).
 * - Merges all younger than the limit: ok.
 * - A merge exactly at the limit is not yet late; one millisecond more is.
 * - No passing run ever: late once any listed merge is past the limit.
 * - A merge stamped in the future (a skewed clock): never late on its own.
 * - A pause with an end in the future turns "late" into "paused"; at its end, and after, it is late
 *   again and the line says the pause ended. A pause never changes "ok".
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Array as Arr,
  Clock,
  Config,
  ConfigProvider,
  Console,
  DateTime,
  Effect,
  Schema,
  String as Str,
  pipe,
} from "effect";

const MINUTE = 60_000;

/** The default for `MUTATION_LATE_MINUTES`: two runs of an hour's wait and the workflow's 45 minutes. */
export const DEFAULT_LATE_MINUTES = 2 * (60 + 45);

/** The title of the one open issue. */
export const TITLE = "The hourly mutation run is late";

/** The issue's label. Never `ci-scheduled`: that one switches on a sev1. */
export const LABEL = "mutation-heartbeat";

/** A pause on purpose: it ends at `until` (ms since the epoch) and says why. */
export const Pause = Schema.Struct({ until: Schema.Finite, reason: Schema.String });

export type Pause = typeof Pause.Type;

const Counts = { lastPass: Schema.NullOr(Schema.Finite), merges: Schema.Finite };

const Late = { oldest: Schema.Finite, limit: Schema.Finite };

export const Beat = Schema.TaggedUnion({
  ok: { ...Counts },
  late: { ...Counts, ...Late, lapsed: Schema.NullOr(Pause) },
  paused: { ...Counts, ...Late, until: Schema.Finite, reason: Schema.String },
});

export type Beat = typeof Beat.Type;

/** The merges on main since the last passing run: how many, and when the oldest landed (ms; null when none). */
export interface Waiting {
  readonly count: number;
  readonly oldest: number | null;
}

/**
 * The heartbeat at `now`, from the last passing run's start, the merges on main since, the limit (ms)
 * and the pause, if one is set. Pure.
 */
export const beat = (
  now: number,
  lastPass: number | null,
  { count, oldest }: Waiting,
  limit: number,
  pause: Pause | null,
): Beat => {
  if (count === 0 || oldest === null || now - oldest <= limit) {
    return Beat.cases.ok.make({ lastPass, merges: count });
  }

  const held = pause !== null && now < pause.until;

  return held
    ? Beat.cases.paused.make({
        lastPass,
        merges: count,
        oldest,
        limit,
        until: pause.until,
        reason: pause.reason,
      })
    : Beat.cases.late.make({ lastPass, merges: count, oldest, limit, lapsed: pause });
};

const iso = (ms: number | null) =>
  ms === null ? "none" : pipe(DateTime.formatIso(DateTime.makeUnsafe(ms)), Str.replace(/\.\d{3}Z$/, "Z"));

const hours = (ms: number) => `${(ms / 3_600_000).toFixed(1)} h`;

/** The one line it prints. Pure. */
export const line = (now: number, b: Beat): string => {
  const since = (merges: number, lastPass: number | null) =>
    `${merges} merges since the last passing run (${iso(lastPass)})`;

  switch (b._tag) {
    case "ok":
      return `mutation heartbeat: ok: ${since(b.merges, b.lastPass)}`;
    case "paused":
      return `mutation heartbeat: paused until ${iso(b.until)} (${b.reason}): ${since(b.merges, b.lastPass)}, the oldest ${hours(now - b.oldest)} ago, past the ${hours(b.limit)} limit`;
    case "late":
      return `mutation heartbeat: late: ${since(b.merges, b.lastPass)}, the oldest ${hours(now - b.oldest)} ago, past the ${hours(b.limit)} limit${
        b.lapsed === null ? "" : `; the pause ended ${iso(b.lapsed.until)} (${b.lapsed.reason})`
      }`;
  }
};

/** What to do about the issue, given the open one's number (or null). */
export const Alarm = Schema.TaggedUnion({
  open: {},
  comment: { number: Schema.Int },
  close: { number: Schema.Int },
  none: {},
});

export type Alarm = typeof Alarm.Type;

/**
 * Late opens the issue or comments on the open one; ok closes the open one; a pause leaves it as it
 * was, so a pause neither opens nor closes. Pure.
 */
export const alarm = (b: Beat, open: number | null): Alarm => {
  switch (b._tag) {
    case "late":
      return open === null ? Alarm.cases.open.make({}) : Alarm.cases.comment.make({ number: open });
    case "ok":
      return open === null ? Alarm.cases.none.make({}) : Alarm.cases.close.make({ number: open });
    case "paused":
      return Alarm.cases.none.make({});
  }
};

/** The text of the issue, or of a comment on it. Pure. */
export const issueText = (now: number, b: Beat): string =>
  [
    line(now, b),
    "",
    "A merge on main has waited longer than the limit for a passing run of the hourly mutation run (`.github/workflows/mutation.yaml`). The run starts on a push to main and each hour, so either it did not start or its runs fail.",
    "",
    "Look: `gh run list --workflow mutation.yaml --branch main --limit 10`",
    "",
    "A passing run of mutation.yaml on main closes this issue. The heartbeat checks on every push to main and each hour.",
    "",
    'To pause on purpose, set `MUTATION_PAUSE` in `.github/workflows/mutation-heartbeat.yaml` to `{"until":"<ISO time>","reason":"<why>"}`. The alarm turns back on by itself when the end passes.',
  ].join("\n");

// ---------------------------------------------------------------- the settings

/**
 * The least `MUTATION_LATE_MINUTES` allows: a merge waits up to the gap for the next run and the run takes up to
 * its limit (60 and 45 minutes), so a lower limit alarms on a healthy run. The most is a day, past which
 * the alarm is no alarm.
 */
export const LATE_RANGE = { least: 105, most: 24 * 60 } as const;

const LATE_MINUTES = Config.schema(
  Schema.Int.check(Schema.isBetween({ minimum: LATE_RANGE.least, maximum: LATE_RANGE.most })),
  "MUTATION_LATE_MINUTES",
).pipe(Config.withDefault(DEFAULT_LATE_MINUTES));

const PAUSE_TEXT = Config.schema(Schema.String, "MUTATION_PAUSE").pipe(Config.withDefault(""));

/** The pause setting is set, and does not parse as an end and a reason. */
class BadPause extends Schema.TaggedError<BadPause, { readonly brand: unique symbol }>()("BadPause", {
  reason: Schema.String,
}) {}

const PauseSetting = Schema.fromJsonString(
  Schema.Struct({ until: Schema.DateTimeUtcFromString, reason: Schema.String.check(Schema.isNonEmpty()) }),
);

/** A pause setting's text: no pause when blank, a pause with an end and a reason, or a failure. */
export const readPause = (text: string): Effect.Effect<Pause | null, BadPause> =>
  Str.isEmpty(Str.trim(text))
    ? Effect.succeed(null)
    : Schema.decodeEffect(PauseSetting)(text).pipe(
        Effect.map(({ until, reason }) => ({ until: DateTime.toEpochMillis(until), reason })),
        Effect.mapError((error) => BadPause.make({ reason: `MUTATION_PAUSE needs an end and a reason: ${error}` })),
      );

/** The limit in ms and the pause, read from `provider` (the environment, in a run). */
export const settings = (provider: ConfigProvider.ConfigProvider) =>
  Effect.gen(function* () {
    const minutes = yield* LATE_MINUTES.parse(provider);
    const pause = yield* readPause(yield* PAUSE_TEXT.parse(provider));

    return { limit: minutes * MINUTE, pause };
  });

// ---------------------------------------------------------------- the reads and writes

const Compare = Schema.fromJsonString(
  Schema.Struct({
    ahead_by: Schema.Int,
    commits: Schema.Array(
      Schema.Struct({ commit: Schema.Struct({ committer: Schema.Struct({ date: Schema.String }) }) }),
    ),
  }),
);

const Commits = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ commit: Schema.Struct({ committer: Schema.Struct({ date: Schema.String }) }) })),
);

const Issues = Schema.fromJsonString(Schema.Array(Schema.Struct({ number: Schema.Int, title: Schema.String })));

/** A read or a write failed; `reason` is what threw. */
class ReadFailed extends Schema.TaggedError<ReadFailed, { readonly brand: unique symbol }>()("ReadFailed", {
  reason: Schema.String,
}) {}

/** The heartbeat is late; its line is already printed. */
class IsLate extends Schema.TaggedError<IsLate, { readonly brand: unique symbol }>()("IsLate", {}) {}

const REPO = "repos/{owner}/{repo}";

/** One `gh` call: its stdout, or a throw with its stderr. */
export type Gh = (args: ReadonlyArray<string>) => string;

const realGh: Gh = (args) =>
  execFileSync("gh", [...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });

/** The most runs one read looks at, newest first: past that, a pass is as good as none. */
export const SCAN = 30;

const Runs = Schema.fromJsonString(
  Schema.Struct({
    workflow_runs: Schema.Array(Schema.Struct({ id: Schema.Int, created_at: Schema.String, head_sha: Schema.String })),
  }),
);

const Jobs = Schema.fromJsonString(
  Schema.Struct({
    jobs: Schema.Array(Schema.Struct({ name: Schema.String, conclusion: Schema.NullOr(Schema.String) })),
  }),
);

/**
 * The newest run on main of the `mutation` workflow whose job `mutation` concluded `success`: when it was
 * created and the commit it ran on. A run the gate skipped ends `success` with its job `skipped`, and is no
 * pass. `.github/ci/mutation-runs.mjs` reads the same thing for the gate, and a law holds the two to one answer.
 */
export const passedRun = (gh: Gh): { readonly createdAt: number; readonly headSha: string } | null => {
  const runs = Schema.decodeSync(Runs)(
    gh(["api", `${REPO}/actions/workflows/mutation.yaml/runs?status=success&branch=main&per_page=${SCAN}`]),
  );

  const passed = Arr.findFirst(runs.workflow_runs, (run) =>
    Arr.some(
      Schema.decodeSync(Jobs)(gh(["api", `${REPO}/actions/runs/${run.id}/jobs?per_page=100`])).jobs,
      (job) => job.name === "mutation" && job.conclusion === "success",
    ),
  );

  return passed._tag === "Some"
    ? { createdAt: Date.parse(passed.value.created_at), headSha: passed.value.head_sha }
    : null;
};

/**
 * The merges on main since the last passing run, counted by GitHub's compare API: its `ahead_by` is the
 * whole count, however many there are, and its first commit (oldest first, `per_page=1`) is the one
 * that has waited longest. With no passing run ever, the newest 100 commits stand in, and the count
 * stops at 100.
 */
export const waiting = (gh: Gh, passed: { readonly headSha: string } | null): Waiting => {
  if (passed === null) {
    const dates = Arr.map(Schema.decodeSync(Commits)(gh(["api", `${REPO}/commits?sha=main&per_page=100`])), (c) =>
      Date.parse(c.commit.committer.date),
    );

    return { count: dates.length, oldest: dates.length === 0 ? null : Math.min(...dates) };
  }

  const answer = Schema.decodeSync(Compare)(gh(["api", `${REPO}/compare/${passed.headSha}...main?per_page=1`]));
  const first = answer.commits[0];

  return { count: answer.ahead_by, oldest: first === undefined ? null : Date.parse(first.commit.committer.date) };
};

/** The heartbeat, read from GitHub through `gh`: the last passing run of the `mutation` job, and the merges since. */
export const check = (now: number, limit: number, pause: Pause | null, gh: Gh): Beat => {
  const passed = passedRun(gh);

  return beat(now, passed === null ? null : passed.createdAt, waiting(gh, passed), limit, pause);
};

/** The number of the open issue with `TITLE` and `LABEL`, or null. */
export const openIssue = (gh: Gh): number | null =>
  Arr.findFirst(
    Schema.decodeSync(Issues)(
      gh(["issue", "list", "--label", LABEL, "--state", "open", "--json", "number,title", "--limit", "20"]),
    ),
    (i) => i.title === TITLE,
  ).pipe((found) => (found._tag === "Some" ? found.value.number : null));

/** Does what `alarm` says. */
export const sync = (now: number, b: Beat, gh: Gh): void => {
  const a = alarm(b, openIssue(gh));

  switch (a._tag) {
    case "open":
      // The label is there already after the first time, which `--force` allows.
      gh([
        "label",
        "create",
        LABEL,
        "--color",
        "d93f0b",
        "--description",
        "The hourly mutation run is late",
        "--force",
      ]);
      gh(["issue", "create", "--title", TITLE, "--label", LABEL, "--body", issueText(now, b)]);
      break;
    case "comment":
      gh(["issue", "comment", String(a.number), "--body", issueText(now, b)]);
      break;
    case "close":
      gh(["issue", "close", String(a.number), "--reason", "completed", "--comment", line(now, b)]);
      break;
    case "none":
      break;
  }
};

const main = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const { limit, pause } = yield* settings(ConfigProvider.fromEnv());

  const run = <A>(work: () => A) =>
    Effect.try({ try: work, catch: (cause) => ReadFailed.make({ reason: String(cause) }) });

  const b = yield* run(() => check(now, limit, pause, realGh));

  yield* Console.log(line(now, b));

  if (process.argv.includes("--issue")) {
    yield* run(() => sync(now, b, realGh));
  }

  if (b._tag === "late") {
    return yield* IsLate.make();
  }
});

// Exit 0 when ok or paused, 1 when late or when a read or a write failed; the line, or the failure, says which.
if (import.meta.main) {
  NodeRuntime.runMain(
    main.pipe(
      Effect.tapError((error) =>
        error._tag === "IsLate"
          ? Effect.void
          : Console.error(`mutation heartbeat: ${"reason" in error ? error.reason : String(error)}`),
      ),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
