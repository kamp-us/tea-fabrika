/**
 * The hourly mutation run's heartbeat: is a merge on main waiting longer than the limit for a
 * passing run? Today's lead tooling. The run starts itself (a push to main, an hourly catch-up, or
 * a hand dispatch: `.github/workflows/mutation.yaml`), so this watches the outcome and not the
 * starter: whichever way the run stops starting, the alarm is the same. On 2026-11-13 the run
 * stopped, its dispatcher being a session that ended, and for 13 days about 630 merges went by
 * with no run and no word. `.github/workflows/mutation-heartbeat.yaml` runs this on every push to
 * main, each hour and by hand, and goes red when late:
 *
 *   node .agents/skills/mutation/scripts/heartbeat.ts [--issue]
 *   mutation heartbeat: late: 21 merges since the last passing run (2026-11-11T05:40:24Z), the oldest 3.6 h ago, past the 3.5 h limit
 *
 * It starts no run and reads no artifact; it reads the list of passing runs on main and main's
 * commits with `gh api`, in the repo `GH_REPO` names (gh's own setting). With `--issue` it also
 * keeps one GitHub issue, titled `TITLE` and labeled `LABEL`: late opens it (or comments on the open
 * one), a green check closes it, a pause leaves it as it was. The label is not `ci-scheduled`:
 * that one switches on a sev1 (sev skill), and whether a dead mutation run is one is the owner's call.
 *
 * Settings, each an environment variable the workflow sets (limits are settings):
 *
 *   MUTATION_LATE_MINUTES  how long a merge may wait for a passing run; default 210, which is 3.5 h
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
  Stream,
  pipe,
} from "effect";
import { ChildProcess } from "effect/process";

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

const Waiting = { lastPass: Schema.NullOr(Schema.Finite), merges: Schema.Finite };

const Late = { oldest: Schema.Finite, limit: Schema.Finite };

export const Beat = Schema.TaggedUnion({
  ok: { ...Waiting },
  late: { ...Waiting, ...Late, lapsed: Schema.NullOr(Pause) },
  paused: { ...Waiting, ...Late, until: Schema.Finite, reason: Schema.String },
});

export type Beat = typeof Beat.Type;

/**
 * The heartbeat at `now`, from the last passing run's start, the merges on main since, the limit (ms)
 * and the pause, if one is set. Pure.
 */
export const beat = (
  now: number,
  lastPass: number | null,
  merges: ReadonlyArray<number>,
  limit: number,
  pause: Pause | null,
): Beat => {
  const oldest = Math.min(...merges);

  if (merges.length === 0 || now - oldest <= limit) {
    return Beat.cases.ok.make({ lastPass, merges: merges.length });
  }

  const held = pause !== null && now < pause.until;

  return held
    ? Beat.cases.paused.make({
        lastPass,
        merges: merges.length,
        oldest,
        limit,
        until: pause.until,
        reason: pause.reason,
      })
    : Beat.cases.late.make({ lastPass, merges: merges.length, oldest, limit, lapsed: pause });
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

const LATE_MINUTES = Config.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), "MUTATION_LATE_MINUTES").pipe(
  Config.withDefault(DEFAULT_LATE_MINUTES),
);

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

const Runs = Schema.fromJsonString(
  Schema.Struct({ workflow_runs: Schema.Array(Schema.Struct({ created_at: Schema.String })) }),
);

const Commits = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ commit: Schema.Struct({ committer: Schema.Struct({ date: Schema.String }) }) })),
);

const Issues = Schema.fromJsonString(Schema.Array(Schema.Struct({ number: Schema.Int, title: Schema.String })));

/** A `gh` call that failed, with its stderr. */
class ReadFailed extends Schema.TaggedError<ReadFailed, { readonly brand: unique symbol }>()("ReadFailed", {
  path: Schema.String,
  reason: Schema.String,
}) {}

/** The heartbeat is late; its line is already printed. */
class IsLate extends Schema.TaggedError<IsLate, { readonly brand: unique symbol }>()("IsLate", {}) {}

/** One `gh` call: its stdout, or a failure with its stderr. */
const gh = Effect.fn("heartbeat.gh")(function* (args: ReadonlyArray<string>) {
  const handle = yield* ChildProcess.make("gh", args);

  const [out, err, code] = yield* Effect.all(
    [
      Stream.mkString(Stream.decodeText(handle.stdout)),
      Stream.mkString(Stream.decodeText(handle.stderr)),
      handle.exitCode,
    ],
    { concurrency: 3 },
  );

  return Number(code) === 0 ? out : yield* ReadFailed.make({ path: args.join(" "), reason: Str.trim(err) });
}, Effect.scoped);

/** The number of the open issue with `TITLE` and `LABEL`, or null. */
const openIssue = Effect.gen(function* () {
  const issues = yield* Schema.decodeEffect(Issues)(
    yield* gh(["issue", "list", "--label", LABEL, "--state", "open", "--json", "number,title", "--limit", "20"]),
  );

  return Arr.findFirst(issues, (i) => i.title === TITLE).pipe((found) =>
    found._tag === "Some" ? found.value.number : null,
  );
});

/** Does what `alarm` says. */
const sync = Effect.fn("heartbeat.sync")(function* (now: number, b: Beat) {
  const a = alarm(b, yield* openIssue);

  switch (a._tag) {
    case "open":
      // The label is there already after the first time, which `--force` allows.
      yield* gh([
        "label",
        "create",
        LABEL,
        "--color",
        "d93f0b",
        "--description",
        "The hourly mutation run is late",
        "--force",
      ]);
      yield* gh(["issue", "create", "--title", TITLE, "--label", LABEL, "--body", issueText(now, b)]);
      break;
    case "comment":
      yield* gh(["issue", "comment", String(a.number), "--body", issueText(now, b)]);
      break;
    case "close":
      yield* gh(["issue", "close", String(a.number), "--reason", "completed", "--comment", line(now, b)]);
      break;
    case "none":
      break;
  }
});

const main = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const { limit, pause } = yield* settings(ConfigProvider.fromEnv());

  // Passing runs on main only: a run a branch started never covers a merge on main.
  const runs = yield* Schema.decodeEffect(Runs)(
    yield* gh([
      "api",
      "repos/{owner}/{repo}/actions/workflows/mutation.yaml/runs?status=success&branch=main&per_page=1",
    ]),
  );

  const passed = runs.workflow_runs[0];
  const lastPass = passed === undefined ? null : Date.parse(passed.created_at);
  const since = lastPass === null ? "" : `&since=${iso(lastPass)}`;

  const commits = yield* Schema.decodeEffect(Commits)(
    yield* gh(["api", `repos/{owner}/{repo}/commits?sha=main&per_page=100${since}`]),
  );

  const b = beat(
    now,
    lastPass,
    Arr.map(commits, (c) => Date.parse(c.commit.committer.date)),
    limit,
    pause,
  );

  yield* Console.log(line(now, b));

  if (process.argv.includes("--issue")) {
    yield* sync(now, b);
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
