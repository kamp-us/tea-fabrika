Approved by the lead agent, builds ticket 2344; body 27e2d16eee59
Plancheck-Version: 3

# Plan: every `land.ts` command leaves a start and an end line, so a dead one is visible (ticket 2344)

This is lead tooling in today's version (`.agents/skills/lead/scripts/land.ts` and `pr/`), not `next/` and not product. The
ticket is https://github.com/kamp-us/tea-fabrika/issues/2344, on the wayfinder map
https://github.com/kamp-us/tea-fabrika/issues/2336. Lead tooling is fast-tracked, so this plan is the whole design and the
builder may write the tests in the same step.

The answer in one paragraph. Each `land.ts` command appends one JSON line when it starts, one every few minutes while it
lives, and one when it ends, to `runs/land/<pr>.jsonl` (a command about a quest, not a pull request, writes
`runs/land/quest-<name>.jsonl`). The end line says how it ended: done, refused, failed or interrupted. A command that dies
with no chance to write (a killed shell, a sleeping laptop, a power cut) leaves a start line and no end line, and a new
command, `land.ts last <pr>`, says so in plain words by asking whether that process still exists. The record covers the
whole `--wait-ci` wait. It does not cover GitHub's merge after `queued`, because that wait is held on GitHub's servers and
not by a laptop process; `land.ts merged <pr>` is recorded too, so the polls after `queued` show up in the same file.

```ts
// A sketch of the whole idea. One line per event; a start line first, because the lines a dying process cannot write
// are the ones that matter. `attempt` ties a start to its end: `${pid}.${startedAtMs}`.
const Line = Schema.TaggedUnion({
  started:     { at, attempt, pid: Schema.Finite, command: Schema.String, argv: Schema.Array(Schema.String) },
  heartbeat:   { at, attempt },                                // every LAND_LOG_MINUTES, while the command lives
  done:        { at, attempt, said: Schema.Array(Schema.String) },   // what it printed: "queued ..." is the fact a poller needs
  refused:     { at, attempt, check: Schema.String, reason: Schema.String },
  failed:      { at, attempt, reason: Schema.String },
  interrupted: { at, attempt },
});

// Around each subcommand's handler (a sketch). Errors and output pass through unchanged.
const queueCommand = Command.make("queue", { /* flags as today */ },
  recorded("queue", ({ pr }) => [Key.pr(pr)], Effect.fn("land.queueCommand")(function* (input) { /* as today */ })));
```

## Doubts, read first

Three calls are under 80%. Each lean is taken and stays here so a reader sees the doubt.

- **Handle a closed terminal (`SIGHUP`) too, 70%.** Effect's `runMain` interrupts on `SIGINT` and `SIGTERM` only, so a
  command whose terminal closes dies at once with no end line. The fix is about 10 lines (an `Effect.callback` that turns the
  signal into an interrupt). I do not know which signal the harness sends when a background shell ends; the real-process
  law below settles that the handler works, not that the harness uses it. If the harness sends only `SIGKILL`, the handler
  is dead weight but harmless.
- **Default heartbeat of 5 minutes, 70%.** A wait reads every 60 seconds for up to an hour (`Queue.QUEST_WAIT`), so 5
  minutes gives at most 12 extra lines for a full wait and a reader sees a dead one within one period. A shorter period
  costs lines, a longer one hides a death for longer. It is a setting, so the number is cheap to change.
- **A new `land.ts last` command is in scope, 80%.** The ticket asks only for the file and a skill rule. The rule "an open
  start with no live process means it died" is a fact code can check (the research below says to let a reader judge it), so
  it becomes a command and leaves the prose. Cost: about 35 lines more than the ticket's estimate.

## What changes, in one paragraph

A new service, `LandLog`, keeps the lines (`pr/LandLog.ts` is its contract, `pr/LandLogFs.ts` the file layer, shaped as
`Closes` and `ClosesFs` are). A new combinator, `Recorded.around`, wraps one command's handler: it writes `started`,
starts a heartbeat, copies what the command prints, and writes the ending from the handler's exit with `Effect.onExit`. It
changes no result and no exit code. `land.ts` wraps its ten commands with it and gains `last`. The lead skill's "read this
first" rule points at `last`.

## Searched first

- The ticket and the map it sits on.
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` and `.kalfa/research` for
  "runs/land", "land record", "background command", "dies without", "jsonl", "heartbeat", "event log". Only one file
  bears on this: `.kalfa/research/pipeline-liveness-and-after-merge.md` (merged in
  https://github.com/kamp-us/tea-fabrika/pull/2349). No decision rules on it, so there is no ADR to write: the choice is
  easy to reverse (one folder under a git-ignored `runs/`, no other tool reads it yet).
- The code as built on main: `land.ts` (`note` at line 249 writes only through `say`, `run`'s `say` at about line 736, the
  main at the end prints a `Refused` to stderr only; line numbers in the ticket hold), `pr/Queue.ts` (`required`, the
  wait), `pr/Closes.ts` and `pr/ClosesFs.ts` and `pr/ClosesTest.ts` and `pr/ClosesFs.test.ts` (the shape to follow),
  `gcloop.ts` (`Sweep`, `late`, one line per sweep in `gc.jsonl`), `sev/scripts/Level.ts` (a pid in `runs/sev/log.jsonl`).
- Installed versions from the lockfile: `effect` 4.1.3 and `@effect/platform-node` 4.1.3. I read the installed source:
  `NodeRuntime.runMain` (in `@effect/platform-node-shared`) listens to `SIGINT` and `SIGTERM` only, and interrupts the
  main fiber; `Cause.hasInterruptsOnly` and `Effect.onExit` exist; `Console.Console` is a `Context.Reference`, so a command's
  output can be copied by providing a wrapped console; `cli/Command.ts` has `withHandler` and `provide*` but no hook that
  runs around a handler with its parsed input. The repo's local patch of `effect` touches the arbitrary model and
  `TestConsole` only, and its patch of `@effect/platform-node` touches `NodeHttpServer` only: neither bears on this.

## How others do it

The prior-art research is already in the repo: `.kalfa/research/pipeline-liveness-and-after-merge.md`, sections 2.1, 4.1 to
4.3 and 5 (read 2026-11-26, primary sources pinned there). I did not fetch its sources again; I read its claims against the
installed code above. What it says, and what I take:

- **Healthchecks.io** lets a job send a `/start` ping first. If a start comes and no success follows within the grace time,
  it marks the job down. "Begun but not finished" is the alarm. Take: the start line comes first.
- **Google's cron service** records the start and end of each launch with its replicas and keeps "all open launches
  (launches that have begun but not completed)", so recovery can finish them. Take: an open start is the signal.
- **Temporal** keeps an append-only event history per workflow and treats an activity that "fails to report at all" as
  timed out; **AWS Step Functions** have `HeartbeatSeconds`. Take: a heartbeat line, written on a period, and not one line
  per poll (Temporal records timers started and fired, not each tick).
- **Prometheus** says to alarm when a batch job "has not succeeded recently enough", at least two periods. Take: the reader
  says a run is late by comparing, not by waiting for a signal. This plan's reader reports the last line's age and lets a
  person judge; `gcloop.ts` already does the `LATE` comparison for sweeps.
- **Erlang/OTP** (from memory, not fetched): a process that watches another with `monitor` gets a `DOWN` message with the
  exit reason, `killed` for a hard kill. Our watcher does not exist while the command runs; the file is the monitor, and
  the later reader is the one that gets the news. `proc_lib` also writes a crash report for a process that dies abnormally.
  Elm has nothing to say: it has no process that dies between messages.
- **What can end a command** (research section 4.3, checked against `runMain`): `SIGINT`/`SIGTERM` run cleanup (so
  `Effect.onExit` writes the end line); `SIGHUP`, `SIGKILL`, power loss and a crash do not. So the end line is a
  best effort, and the start line plus a liveness probe (`process.kill(pid, 0)`, which Node documents as a test for a
  process) is what carries the proof.
- **The existing shape in this repo.** `ClosesFs` writes one JSON line per record with `{ flag: "a" }`, never rewrites, and
  starts the next record on a line of its own after a cut-short line. `gcloop.ts` writes one line per sweep, at the end
  only (so "a kill during it leaves no record for that sweep", in its own header: the very gap this ticket closes). I
  follow `ClosesFs` in four ways: a contract file, a file layer and a memory layer; `Schema.fromJsonString` per line;
  append with a fresh-line check; reads that name a torn line. I differ in one: `ClosesFs.all` fails every read when a
  line does not read, because a lost close could mean a ticket a person reopened. A lost line here costs one fact about
  one attempt, so the read skips an unreadable line and counts it, and never fails.

## The shape

### The record

```ts
// pr/LandLog.ts, a sketch. The contract only; each layer is its own file.
export class LandLogError extends Schema.TaggedError<LandLogError, { readonly brand: unique symbol }>()("LandLogError", {
  reason: Schema.String,                     // never holds a local path
}) {}

// Where a command's lines go: a pull request, or a quest (ready and run know no pull request yet).
export const Key = Schema.TaggedUnion({
  pr:    { pr: Schema.Int },                                                   // runs/land/2351.jsonl
  quest: { name: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)) },   // runs/land/quest-<name>.jsonl
});

export class LandLog extends Context.Service<LandLog, {
  /** Appends one line, on a line of its own. */
  readonly append: (key: Key, line: Line) => Effect.Effect<void, LandLogError>;
  /** Every line that reads, oldest first, and how many lines did not (a torn last line, or noise). No file is no lines. */
  readonly read: (key: Key) => Effect.Effect<{ readonly lines: ReadonlyArray<Line>; readonly torn: number }, LandLogError>;
}>()("lead/pr/LandLog") {}
```

```ts
// pr/Recorded.ts, a sketch. Needs LandLog; adds nothing to the handler's success or error type.
export const around = <In, A, E, R>(spec: {
  readonly command: string;
  readonly keys: (input: In) => ReadonlyArray<Key>;
  readonly argv: ReadonlyArray<string>;
  readonly pid: number;
  readonly every: Duration.Duration;                                   // LAND_LOG_MINUTES
  readonly refusal: (e: E) => Option.Option<{ check: string; reason: string }>;   // land.ts says what a Refused is
}, handler: (input: In) => Effect.Effect<A, E, R>) =>
  (input: In): Effect.Effect<A, E, R | LandLog> => /* started; heartbeat fiber in a scope; tee Console.log into `said`;
     handler(input) with Effect.onExit: success -> done; failure with only interrupts -> interrupted;
     a Refused -> refused; any other failure or defect -> failed. A failed append is swallowed with one stderr line. */;

// The reader. Pure over lines, with the liveness probe given as a function so a test needs no process.
export const attempts = (lines: ReadonlyArray<Line>, alive: (pid: number) => boolean): ReadonlyArray<Attempt>;  // newest first
type Attempt = { attempt: string; command: string; argv: ReadonlyArray<string>; startedAt: string; last: Line;
                 standing: "ended" | "alive" | "gone" };   // sketch: a TaggedUnion in the build
```

### `land.ts last`

```text
land.ts last <pr | quest> [--attempts <n>]       default 3, newest first. Reads one file; asks GitHub nothing; changes nothing.

queue --wait-ci 2351   started 14:02, ended 14:41: done, queued at its head
queue --wait-ci 2351   started 13:30, last line 13:45 (a heartbeat), pid 4021 is not running: it died with no end line. Run it again.
```

A target of digits is a pull request; anything else is a quest name. It exits 0 when it can read the file (a file with a dead
attempt is not an error: that is the answer) and 1 only when it cannot read it.

## Does the record cover the `queue --wait-ci` wait, and the merge after it?

The wait: yes, all of it. `queue --wait-ci`, `wait`, `admin --wait` and `run` hold a process for up to an hour or more, and
that is the very case that dies. The heartbeat lines show it alive; a dead one leaves its last heartbeat and no end.

The merge after `queued`: no, and on purpose. `queue --wait-ci` returns at `queued` ("`queued`, never `merged`"), and from
there GitHub's merge queue holds the wait on its own servers, which a sleeping laptop cannot break. Holding a command open
until the merge would put a second long wait in a laptop process, the thing that fails. What the record does give:
`done.said` for the queue command says `queued` at a head, and `land.ts merged <pr>` (the poll the lead skill already
names) is recorded into the same file, so "queued at 14:41, merged check at 15:10 said not yet" reads in order. A poll
written by hand with `gh pr view` is not recorded; the lead skill's rule tells a session to use `merged`.
The merge fact itself comes from GitHub (the pull request's state), as the research's level-over-edge rule says; the
timer's ticket pass (`gcloop.ts`) already acts on that state.

## One value traced through

A lead session starts `land.ts queue 2351 --wait-ci` in the background (pid 4021) on a draft pull request.

1. `Recorded.around` runs first. The key is `pr 2351`; the file is `runs/land/2351.jsonl` in the main checkout. It appends
   `{"_tag":"started","at":"…14:02Z","attempt":"4021.1790…","pid":4021,"command":"queue","argv":["queue","2351","--wait-ci"]}`.
2. The handler waits for `ci-required`. At 14:07 and 14:12 the heartbeat appends `{"_tag":"heartbeat",…}`.
3. The laptop sleeps at 14:13 and the harness kills the shell with `SIGKILL`. No code runs. The file ends at the 14:12 line.
4. A new session, hours later, is told by the lead skill to run `land.ts last 2351` before it runs the command again. It reads
   the file, finds attempt `4021.1790…` with last line `heartbeat`, asks `process.kill(4021, 0)`, gets "no such process",
   and prints "pid 4021 is not running: it died with no end line. Run it again." It runs `queue 2351 --wait-ci` again.
5. The second attempt (pid 4310) appends `started`, heartbeats, and at 15:01 `{"_tag":"done",…,"said":["…","queued 2351 at <head>"]}`.
   `last 2351` now prints the newest attempt as ended and the older one as died.
6. Had step 3 been a plain `kill` (`SIGTERM`), `runMain` would have interrupted the fiber, `onExit` would have appended
   `{"_tag":"interrupted",…}`, and `last` would say "interrupted at 14:12", with no probe needed. Had the gate refused at
   step 1, the file would end `{"_tag":"refused","check":"queue","reason":"pr 2351: …"}`.

## Laws

Plain laws run on the in-memory `LandLogTest` layer or a real temp folder (as `ClosesFs.test.ts` does), narrowly, on every
pull request. A law is `lint`, `type` or `test`: shape of code is lint, an erased type is `type`, behavior is `test`. No law
here is a lint rule: no rule that "every subcommand is wrapped" exists, and `L13` holds it as a test over `land.ts --help`.

| Law | Kind (lint, type or test) | Generator | Plant |
|---|---|---|---|
| L1 A started line comes first, and the last line says how the command ended: done, refused, failed or interrupted, by the exit's shape. A cause with an interrupt and a failure is failed, not interrupted. (100 runs) | test | fc.constantFrom: the exit shapes (a) to (g) | A refusal written as failed, (c) red. A typed failure written as refused, (d) red. A defect written as done, (e) red. An interrupt that writes nothing, (f) red. A mixed cause written as interrupted, (g) red. `said` left off when empty so the line fails its own schema, (a) red. |
| L2 What the command prints reaches the terminal unchanged and in order, with or without the record, and `done.said` holds the same lines. (100 runs) | test | fc.array: printed lines, with quotes, a newline inside one and non-ASCII (b) | The copy swallows the line, (b) red. Lines joined and cut at the first newline, (b) red. |
| L3 [secrets] The child output a `Refused` carries never reaches the file; only `check` and `reason` do. (100 runs) | test | fc.string: arbitrary text with a marker, as `output` (p) | Write `output` into `reason` or a new field, (p) red. |
| L4 A record that cannot be written changes neither the command's result nor what it prints nor its exit; one line goes to stderr. (100 runs) | test | fc.constantFrom: a failing step (h) (i) (j) | Let the append error out, so a failing start line (h) red. The same for the ending line, (i) red. The same for a folder that cannot be made, (j) red. |
| L5 While the command lives, one heartbeat line per period; none after its end; an interrupt stops the heartbeat too. (100 runs, TestClock) | test | fc.integer: the period in minutes, 1 to 60, and the run's length (s) | Leave the heartbeat running after the end, so a line follows it, (f) red. Read the period as seconds, (s) red. |
| L6 A `LAND_LOG_MINUTES` that is not a whole number of at least 1 refuses the command at start, naming the variable. (100 runs) | test | fc.constantFrom: invalid values such as 0, -3, 2.5, "abc", "" (s) | Accept 0, so the heartbeat spins, (s) red. |
| L7 The file layer: one line per event, each ending in a newline; a record whose last line is torn takes the next line on a line of its own; a read skips a torn or blank line and counts it, and never fails. (100 runs) | test | fc.string: an encoded line cut at a random point, and blank lines between others (k) (l) | Append onto the torn line, (k) red. Fail the read on a bad line, as `ClosesFs.all` does, (l) red. Count a blank line as torn, (l) red. |
| L8 The reader pairs an ending with its start by `attempt`, not by position: two attempts interleaved in one file give each its own standing. (100 runs) | test | fc.shuffledSubarray: the lines of two attempts, each kept in its own order (m) | Take the file's last line as every attempt's last, (m) red. |
| L9 An open attempt is `alive` when its pid exists and `gone` when it does not; an ended attempt is `ended` and its pid is never probed. (100 runs) | test | fc.boolean: whether the probe finds the pid (n) | Call every open attempt gone, (n) red. Probe the pid of an ended attempt, (n) red. |
| L10 A pull request writes `<pr>.jsonl`, a quest writes `quest-<name>.jsonl`, and a quest name with a slash, a leading dot or no characters writes nothing outside `runs/land`: one stderr line, the command goes on. (100 runs) | test | fc.constantFrom: names with `/`, `..`, a leading `.`, empty, whose `.land.json` exists (o) | Delete the name check, so a file lands outside the folder, (o) red. |
| L11 `merged` and `close-named` write to every pull request's file; one file that cannot be written does not stop the others. (100 runs) | test | fc.uniqueArray: three to six pull requests, one unwritable (q) | Stop at the first failed key, (q) red. |
| L12 `around` keeps the handler's success and error types and adds only `LandLog` to its needs. | type | type | Widen the error to `unknown`, an `expectTypeOf` line goes red. Add a service the handler did not need, an `expectTypeOf` on the needs goes red. |
| L13 Every subcommand `land.ts --help` lists leaves a started line and one ending line, in the file its key names. Run each once with arguments that end it fast (a missing ready file, a closed stub pull request). | test | scenario: each of the ten subcommands once, the list read from `--help` and compared to the table | Leave one subcommand unwrapped. Add an eleventh with no row in the table. |
| L14 `land.ts last` says, in plain words and one line each, ended (and how), alive, gone (with the last line's age), or no record; it changes nothing. | test | scenario: one file per standing, from the shapes in L8 and L9 | Say "ended" for an open attempt. Create the file when none exists. |
| L15 A refused, a successful and a failed command, each run through the real `land.ts` with the existing stubs (`gh`, node, git), leave a last line that says how they ended and the same exit code and output as before. | test | scenario: `check` on a closed pull request, `wait` on a green stub, `run` on a missing ready file | Wrap only the success path. Change the exit code when the record fails. |
| L16 Real signals: `SIGTERM`, `SIGINT` and `SIGHUP` each leave `interrupted` as the last line; `SIGKILL` leaves no ending, and `last` says gone. Host-only. | test | scenario: one real child process per signal (r) | Remove the `SIGHUP` handler, (r) red. Write the ending before the work, so a `SIGKILL` looks ended, (r) red. |

L16 is the one host-only law. It starts a real child node process and sends it real signals, so it is a
`*.integration.test.ts` file, which the laptop refuses by name (`vitest.hostrun.ts`). It runs in CI on main's full run, and the
lead can start a proof run that names it before the first review. On the owner's Mac it would wait for the lead's read of its
signal lines and the owner's yes; it never needs to run there, since CI runs it. It kills only the child it spawned, by that
child's pid. No stand-in will do for L16: the claim is about what Node and `runMain` do when a real signal arrives. Every
behavior L16 touches is also proved on the stand-in (L1 f for an interrupt, L9 for a gone pid), so the real file is the thin
check that the real thing matches.

## Generators

Classes the generated inputs must reach. Each has a plant in a row above.

- (a) A success that printed no line.
- (b) A success that printed several lines, one with quotes, a newline or non-ASCII text.
- (c) A `Refused`, for each check name `land.ts` has.
- (d) A typed failure that is not a `Refused`.
- (e) A defect (a thrown error inside the handler).
- (f) An interrupt while waiting, once before the first heartbeat and once after it.
- (g) A cause that holds an interrupt and a failure together.
- (h) The append of the start line fails.
- (i) The append of the ending line fails.
- (j) The folder cannot be made.
- (k) A record whose last line is cut short.
- (l) A record with a bad line in the middle, and blank lines.
- (m) Two attempts interleaved in one file, one ended and one open.
- (n) An open attempt whose pid exists, and one whose pid does not.
- (o) A quest name with a slash, `..`, a leading dot or no characters, whose ready file exists, so it passes the checks before.
- (p) Child output on a `Refused` that holds a marker string and arbitrary text.
- (q) A command over several pull requests where one file cannot be written.
- (r) Each of the four signals.
- (s) A heartbeat period inside the range, and values outside it.

## Existing tools

Each new file and new function, with what was searched.

- `.agents/skills/lead/scripts/pr/LandLog.ts`: searched `pr/Closes.ts`, `gcloop.ts` (`Sweep`), `sev/scripts/Level.ts`
  (`Entry`, a log with a pid), Effect's `Logger.toFile`, and npm (`pino`, `winston`, an ndjson writer; none is installed).
  `Logger.toFile` is batched, so a process killed with `SIGKILL` loses its buffer, and the start line must be on disk
  before the work begins. Used `Closes.ts`'s contract shape.
- `.agents/skills/lead/scripts/pr/LandLogFs.ts`: searched the same, plus `ClosesFs.ts`. Used its append and torn-line rule,
  with the read that skips a bad line (the reason is above).
- `.agents/skills/lead/scripts/pr/Recorded.ts`: searched `Command` in `cli/Command.ts` (no around hook), `Effect.onExit`,
  `Effect.ensuring`, `Cause.hasInterruptsOnly`, `Console.Console` and `Effect.cached`, and `NodeRuntime.runMain`. Used
  `onExit`, `hasInterruptsOnly` and a provided `Console`. A `Command`-level wrapper does not exist, so one function wraps
  each handler.
- A new `recorded` function and a new `last` command in `land.ts`, a file that exists: searched `land.ts`, `gcloop.ts status`
  (a similar reader of a jsonl file, for sweeps, which does not read this file's shape) and `sev/scripts/Level.ts` `read`.
  None reads a per-pull-request file. `last` follows `gcloop.ts status`: one plain line per fact.
- The three hand-written jsonl appenders that already exist (`gcloop.ts`, `Level.ts`, `ClosesFs.ts`) are not merged into one
  here: that is a refactor of three files this ticket does not need. See Findings.

## Is this a setting?

- **Heartbeat period: yes.** `LAND_LOG_MINUTES`, whole minutes, at least 1, default 5, read from the environment as `gcloop.ts`
  reads `GC_MINUTES` (Config, so `env.sh`'s way of setting a value from outside works). A wrong value refuses at start.
- **How many attempts `last` prints: yes.** `--attempts <n>`, default 3.
- **The folder: no.** `runs/land` in the main checkout, because `runs/` is where a live run's local state goes by rule
  (`AGENTS.md`). It is found the way every `land.ts` command finds its paths: `env.sh`'s `MAIN`.
- **The line kinds and the file names: no.** They are the contract the reader and the skill share.
- **A cap on how much a command's `said` holds: no.** `said` is what the command already printed to its terminal, a few
  lines. A cap would be a limit with no problem behind it.
- **Pruning old files: no.** Each attempt writes about 3 lines plus a heartbeat every 5 minutes; a year of landings is a few
  hundred small files in a git-ignored folder.

## Records

What fact is lost if it is not recorded now, and what is left for later.

- **Now, never recoverable later:** the start line (without it a killed command leaves nothing), its `argv` (which flags it
  ran with, such as `--wait-ci` and the wait limits), its pid and start time, and the heartbeat's timestamps (how long it was
  alive). Each exists only while the process runs.
- **The printed lines** (`said`) and the refusal's `check` and `reason` are in the file because stderr and a harness's task
  file are the only other copies, and a later session does not have them.
- **Left out on purpose:** a refusal's `output` (the last 30 lines of a child's output). It goes to stderr as today. It may
  hold anything a child printed, and a record read by later agents is no place for it (L3).
- **Derived, so not stored:** how long an attempt took, whether one died, and the standing of a pull request. They rebuild from
  the lines.
- **Each wait read** (the head seen and the check's status at each poll) is not recorded. It lives on GitHub (the check run and
  the pull request's timeline), and a line per minute for an hour is the noise Temporal's history avoids.
- **Where the pull request number is not known:** `run <quest> <ticket>` opens the pull request partway, so its attempt lives
  in the quest's file, and its `done.said` names the pull request. The pull request's own file starts at its first `queue`,
  `wait` or `merged`. I did not link the two files (80%): a reader who knows the quest finds the number in one line.

## Files

| Path | Owner | Product lines expected | What |
|---|---|---|---|
| `.agents/skills/lead/scripts/pr/LandLog.ts` | build | 45 | The `LandLog` contract, `Line`, `Key`, `LandLogError` |
| `.agents/skills/lead/scripts/pr/LandLogFs.ts` | build | 45 | The file layer, shaped as `ClosesFs.ts` |
| `.agents/skills/lead/scripts/pr/Recorded.ts` | build | 95 | `around`, the heartbeat, the console copy, `attempts` |
| `.agents/skills/lead/scripts/land.ts` | build | 55 | `recorded` over ten handlers, `LAND_LOG_MINUTES`, SIGHUP, `last`, the header's text |
| `.agents/skills/lead/SKILL.md` | build | 14 | The commands table row for `last`, and the rule to read it before a command runs again |
| `.agents/skills/lead/scripts/pr/LandLogTest.ts` | tests | tests | The service in memory, as `ClosesTest.ts` is |
| `.agents/skills/lead/scripts/pr/LandLogFs.test.ts` | tests | tests | L7 on a real temp folder |
| `.agents/skills/lead/scripts/pr/Recorded.test.ts` | tests | tests | L1 to L6, L8 to L12, L14 |
| `.agents/skills/lead/scripts/pr/Recorded.integration.test.ts` | tests | tests | L16, one real child per signal |
| `.agents/skills/lead/scripts/pr/Recorded.fixture.ts` | tests | tests | The child L16 starts: `around` under `NodeRuntime.runMain`, waiting forever |
| `.agents/skills/lead/scripts/land.test.ts` | tests | tests | L13 and L15, beside the existing scenarios |

No new domain word: `attempt` and `heartbeat` are Temporal's and Step Functions' words, which this plan cites under "How others
do it", and the glossary is for words the project is about. So no `GLOSSARY.md` changes, and no `_Avoid_` list is owed.

## New names

For the pull request body's `## New names`: `LandLog`, `LandLogError`, `Key`, `Line`, `around`, `attempts`, and the command
`last`. Each is from industry or plain English: `heartbeat` (Step Functions, Healthchecks), `attempt` (Temporal), `around`
(an aspect-oriented word for "wraps a call"; Hono and Express call it middleware, which would clash with this repo's use).
No name ends in `Of`, and no key is a bare `by`.

## The lead skill's rule

Two lines, and what leaves the prose. The rule: before you run a `land.ts` command again, run `land.ts last <pr>` (or the
quest's name). It names a start with no end and a dead pid as "died", an alive one as "still running, do not start another",
and a `done` from `queue` as "queued, not merged: run `land.ts merged`". The skill's old line "Read a backgrounded land
command's exit code and its log" stays (the harness's own task file is still the first place), and gains "and `land.ts last`
for a later session". The judgment that a session looks is prose; the judgment of "did it die" is the command's.

## Size

1. The record, the reader, the skill rule and the tests, one pull request: about 250 lines of product code and about 450 of
   tests. 250 lines. It lands whole: the record without the reader would still be a file nobody can read cheaply, and the
   reader without the record has nothing to read. Cut by what lands whole, not by a count.

How sure of the size: 70%. The doubt is the console copy and the `SIGHUP` handler, which the tests step may find harder than
planned; the ticket's own estimate was 30 lines for one file.

Estimate: 4 steps, $16

## What this plan cannot tell us

- **Which signal the harness sends when a background shell ends.** The `SIGHUP` handler and L16 prove the handler works, not
  that the harness uses it. A `SIGKILL`, a sleep or a power cut still leaves only a start line, and `last` can only call
  that "died with no end line" when the pid is gone.
- **Pid reuse.** A pid that a new, unrelated process now holds reads as `alive`. After a reboot this is likely for a day-old
  attempt. The text prints the last line's age so a person can tell, and I did not add a start-time probe: it is
  macOS-specific (`ps`) and one more process to run.
- **Whether a laptop's sleep breaks an in-flight `gh` call.** No source found (the research says the same). It affects how often
  commands die, not the design.
- **How many commands die today.** There is no record, which is the finding, so I cannot count. After this lands, the files
  answer it.
- **That a session reads `last`.** The skill rule is prose; nothing forces it. The check on the hard part (the death itself)
  is the reader. If sessions do not look, the next step is a refusal: `land.ts` run commands that refuse to start while an
  alive attempt for the same pull request exists. I left that out: it would stop a person from running two waits on purpose,
  and no record yet says that happens.
- **Concurrency on one file beyond two writers.** Appends use `O_APPEND` in one write each (POSIX says the offset is set to the
  end before each write); the fresh-line check reads first, so two writers racing on a torn line could both prepend a
  newline. That leaves a blank line, which the reader skips. I did not test three writers.
- **Whether the quest file and the pull request file should be one.** Mentioned in Records; 80% sure they need not be.

## Validation

Narrow tests while the work goes: the files in the table by path. The lead runs `--changed` and the typecheck. L16 runs in
CI on main's full run, or in a proof run the lead starts that names it.

## Open questions

None.

## Findings

Outside this ticket, proved by reading, not fixed here.

1. Four hand-written jsonl appenders will exist: `gcloop.ts` (`gc.jsonl`, line 511), `sev/scripts/Level.ts` (`log.jsonl`, line
   268), `pr/ClosesFs.ts`, and now `LandLogFs.ts`. Each writes with `{ flag: "a" }`; only `ClosesFs` handles a torn last line.
   A `gc.jsonl` or sev log with a cut-short line is read by `gcloop.ts` with `Schema.decodeOption` per line (it skips it) and by
   `Level.read` as its own rule says. A shared "append a line, start on a fresh one" helper would serve all four. The research
   puts the value of sharing at 60%, so I did not extract it; a fifth appender is the time.
2. `gcloop.ts`'s header says "a kill during [the ticket pass] leaves no record for that sweep". That is the same gap as this
   ticket on another command (start line first, as here, would fix it). The map's "not yet specified" list names the other
   background commands (`box.sh`, `gcloop.ts`, `sev.ts`, CI scripts) as unaudited.
