Approved by the lead agent, builds issues 1934, 2011; body f46005651ed2
Plancheck-Version: 3

# Git: the wait before a git process is killed is a setting (ticket 2011)

Ticket: https://github.com/kamp-us/tea-fabrika/issues/2011. Version: kalfa, the `@kalfa/git` package
(`kalfa/git/`), not `next/` and not today's frozen code.

Today `kalfa/git/src/ProcessRepository.ts:52` holds `const KILL_AFTER = Duration.seconds(5)`: when a call runs out of
time, git is asked to stop, and a git that ignores that is killed five seconds later. This pull request moves that wait
into `Settings`, as `limits.kill`, duration text, required with no default like the package's other limits. The app's own
layer passes `"5 seconds"`. The spawn reads the setting. A law on the stand-in shows the kill comes after the set wait
and not after five seconds, and a package law keeps every other fixed time or count limit out of the package's code.

```text
before   forceKillAfter: KILL_AFTER              const KILL_AFTER = Duration.seconds(5)
after    forceKillAfter: Settings.killWait(...)  [limits] kill = "5 seconds"   (required; the app passes any duration text)
```

## How sure, and the doubt at the top

- **`kill` is required, with no default, like the other seven limits: 90%.** The package's rule is "every value is
  required, with no default" (`kalfa/git/src/Settings.ts`, its header, `kalfa/git/README.md` Settings, and the read,
  diff, merge and edit plans in `.kalfa/quests/`). One limit with a default would make the package inconsistent. The
  ticket's "default 5 seconds" becomes: the app's own layer passes 5 seconds. The lead made this call at signing. What
  would change it: an app that builds git's settings by hand and wants one less line. Then a default can be added later
  for every limit at once, in one pull request.

## Records read

- `AGENTS.md`, `kalfa/AGENTS.md` (Source control imports no kalfa package and ranks lowest), and in `kalfa/git/`:
  `GLOSSARY.md`, `README.md`, the package manifest, `src/Settings.ts`, `src/ProcessRepository.ts`,
  the stand-in spawner's test support, `src/ProcessRepository.test.ts` (the two P3 laws), `src/Values.test.ts` (G5),
  `src/Values.types.test.ts`, `src/Package.test.ts` (K1 to K4), `src/History.test-support.ts` (`limitsArb`),
  `src/RepositoryTest.ts` (`settings`).
- Decisions: 0047 (each kalfa package usable alone, so `@kalfa/git` keeps no dependency, which K1 checks) and 0089 (a
  setting's value is plain data: a duration is text, checked with `Schema.DurationFromString` and decoded where it is
  read).
- `@kalfa/config`: `kalfa/config/README.md` ("A setting's value is plain data") and how `@kalfa/github` declares its
  settings (`kalfa/github/src/Settings.ts`: `Setting.make(...).pipe(Setting.withDefault(...))`). `@kalfa/git` cannot use
  `Setting.make`, since K1 (`kalfa/git/src/Package.test.ts`) holds it to no workspace dependency, so `kill` is declared
  in its own Effect Schema, with no default as the other limits have none. An app that joins git's settings into a
  `@kalfa/config` group later gives `"5 seconds"` there.
- Earlier plans: `.kalfa/quests/kalfa-git-read-PLAN.md`, Amendment 2 (it chose a named constant "unless a law needs it
  to change") and `.kalfa/quests/kalfa-git-trees-PLAN.md`, Findings 1 (this ticket's source). This plan supersedes the
  read plan's choice: every limit is a setting.
- Installed versions from the lockfile: `effect` 4.1.3 (patched), `@effect/vitest` 4.1.3, `vitest` 5.0.5.
  Checked in the installed source: `ChildProcess`'s `forceKillAfter?: Duration.Input`. `@effect/platform-node-shared`'s `NodeChildProcessSpawner` sends the first signal
  when the scope ends, waits `forceKillAfter`, sends `SIGKILL`, then waits one more fixed second of its own.
- PR https://github.com/kamp-us/tea-fabrika/pull/2052 (ticket 1935, the Git edit), its whole diff. See "Who lands
  first".

## How others do it

- **Erlang/OTP:** a supervisor's child spec has `shutdown`: a number of milliseconds the child gets after the
  `shutdown` exit signal before it is killed with `kill`, or `brutal_kill`, or `infinity`. Its default is 5000 for a
  worker. It is a per-child setting, which is this plan's shape; this package gives no limit a default, so the app passes the value. (From memory, not fetched.)
- **Kubernetes:** `terminationGracePeriodSeconds`, default 30: SIGTERM, then SIGKILL after the period. **systemd:**
  `TimeoutStopSec`, default 90 s, then SIGKILL. **Docker:** `docker stop -t`, default 10 s. Each is a setting with a
  default; here the app's layer passes 5 seconds. (From memory, not fetched.)
- **Effect:** `forceKillAfter` on the command, read by the platform's spawner. That is the knob this setting feeds.
- **Elm:** no processes, so no answer to borrow.

## The shape

```ts
// kalfa/git/src/Settings.ts, a sketch.
import { Duration, Option, Schema } from "effect";

export const Limits = Schema.Struct({
  commits: Count,
  refs: Count,
  bytes: Count,
  files: Count,
  diff: Count,
  blob: Count,
  time: TimeText,
  // How long git has to stop, once a call has run out of time, before it is killed. Required, as the others are.
  kill: TimeText,
});

/**
 * The kill wait as a length of time, decoded from its text, as `timeLimit` decodes `time`. It decodes inside a
 * `{ limits: { kill } }` shape, so a missing or bad value fails with an error that names `limits.kill`.
 */
export const killWait = (settings: Settings): Duration.Duration =>
  Schema.decodeUnknownSync(Schema.Struct({ limits: Schema.Struct({ kill: Schema.DurationFromString }) }))(settings).limits
    .kill;
```

```ts
// kalfa/git/src/ProcessRepository.ts, a sketch. KILL_AFTER and its comment go.
const child = (spawner, path, env, kill: Duration.Duration, args, input) =>
  spawner.spawn(ChildProcess.make("git", [...start(path), ...args], { extendEnv: false, env, forceKillAfter: kill, stdin }))
// runner(spawner, path, env, settings, kill) and lister(spawner, path, env, settings, kill) pass it to child.
// In layer, beside `after`:
const kill = Settings.killWait(options.settings);
```

The types this gives (exactOptionalPropertyTypes is on in the repo's base tsconfig):

| Way the value is typed | `limits.kill` is |
|---|---|
| `Settings.Settings`, the decoded `Type` | `string`, required |
| `typeof Settings.Settings.Encoded`, what an app gives | `string`, required; a missing key or `undefined` does not fit |
| `Settings.killWait`'s answer | `Duration.Duration` |

`Settings.Settings` is a plain `string` field, so a value an app builds by hand and never decodes can hold
`kill: "ten"`, or, cast, no `kill` at all. The type cannot stop that, so the run-time guard is the decode in `layer`:
`killWait` throws an error that names `limits.kill`, and building the layer dies before any command runs. Law P3g holds
both.

The doc comment on `Limits` gains `kill`. The header of `Settings.ts` stays as it is: every value is required, with no default.
`kalfa/git/README.md`'s Settings section shows `kill = "5 seconds"` in the example, as one more required value, and its
last sentence says git is killed `limits.kill` later, no longer "a fixed five seconds".

## One value traced through

1. An app gives `{ limits: { commits: 1000, ..., time: "10 seconds", kill: "5 seconds" }, committer }`.
2. `Schema.decodeUnknownSync(Settings.Settings)` keeps `kill: "5 seconds"` as given.
3. `ProcessRepository.layer` decodes it once: `killWait` gives `Duration.seconds(5)`.
4. Every `git` it spawns, `version` first, carries `forceKillAfter: 5 seconds`.
5. A `rev-list` runs past 10 seconds. `Repository.make`'s time limit interrupts the call, and the call's scope ends.
6. The Node spawner sends the first signal. The git ignores it. 5 seconds later it sends `SIGKILL`, and then waits up
   to its own fixed second.
7. The call ends with `TimedOut { after: 10 seconds }`, about 15 to 16 seconds after it started.

With `kill = "1500 millis"`, step 4 carries 1.5 seconds and step 6 kills 1.5 seconds after the signal.

## Generators

For P3k, each run draws one of each:

- (a) a kill wait under the old five seconds, in milliseconds: `"<n> millis"`, n from 2 to 4999.
- (b) a kill wait over five seconds, in seconds: `"<n> seconds"`, n from 6 to 3600.
- (c) a kill wait in minutes: `"<n> minutes"`, n from 1 to 60.
- (g) a call that hangs in `lister` (the `diff-tree -r -z` of `diff`), beside the five calls that hang in `runner`.

For P3g:

- (d) a `Settings.Settings` value with no `kill` key, built by hand and cast, beside one with `kill: "ten"`.

For G5:

- (e) a `kill` that passes `Schema.String` and fails the duration check: every entry of `NOT_A_TIME`, and the negative of
  a drawn good time.

For K5:

- (f) a file below `src/internal/`, which the scan must read too.

## Laws

| Law | Kind | Generator | Plant | Test file |
|---|---|---|---|---|
| P3k, the kill wait (replaces the second P3 law, "killed a short, fixed time later"): the stand-in replies `"hang, ignores the first signal"` to every command once the layer is open, except `cat-file --batch-check`, which `script` answers. For each run, a time limit of 1 to 3600 seconds, and for each of the three kill cases (a) to (c) a new layer, then each of `readCommit`, `readRefs`, `walk`, `mergeBases`, `isAncestor` and `diff` forked detached. Asserts: every command the stand-in recorded, the layer's own included, has `forceKillAfter` equal to the set wait; after `TestClock.adjust(1 ms)`, `adjust(limit)` and `adjust(wait - 2 ms)` the fiber has not ended and `stand.ended` has not grown; after `adjust(2 ms)` more it has ended with `TimedOut` naming the limit, and `stand.ended` grew. 50 runs, seed 119120 | test (`it.effect.prop`, `TestClock`), one Arbitrary.all of the limit's seconds and n for (a), (b) and (c) | Effect Arbitrary: Arbitrary.all | (a) put `Duration.seconds(5)` back in the spawn: the 1 ms-before check holds but the kill comes late, red; (a) `Duration.max(wait, 5 s)`: red; (b) `Duration.min(wait, 5 s)`: killed early, red; (c) read the number as seconds (`Duration.seconds(parseFloat(text))`): "3 minutes" waits 3 s, red; (g) give `lister`'s child no wait (`forceKillAfter` left out): `diff` never ends, the law's own guard reds it and it never hangs | kalfa/git/src/ProcessRepository.test.ts |
| P3g, the guard: a `Settings.Settings` value built by hand, never decoded, with `kill: "ten"` and one with no `kill` (cast): building `ProcessRepository.layer` dies for each, the error names `limits.kill`, and the stand-in recorded no command | test (`it.effect`) | scenario: `settings()` spread by hand, `kill` set to `"ten"` or removed | (d) catch the decode and fall back to 5 seconds: the layer builds for the missing `kill` and for `"ten"`, red; decode the bare text, so the error does not name `limits.kill`: red | kalfa/git/src/ProcessRepository.test.ts |
| G5, the settings, now with `kill`: every drawn limit set decodes with a drawn `kill` and keeps it as given; with `kill` left out it is refused; each bad `kill` is refused; the seven other keys are each still refused when missing; `{ limits: {} }` and no `limits` are still refused. 100 runs, seed 119120 | test (`it.prop`), `limitsArb` gains `kill: durationTextArb` | Effect Arbitrary: limitsArb | give `kill` a default (`Schema.withDecodingDefaultKey`): `kill` missing decodes, red; (e) declare `kill` as plain `Schema.String`: `"ten"` decodes, red; give `commits` a default: red (unchanged) | kalfa/git/src/Values.test.ts |
| T5, the types of `kill`: `Settings.Settings["limits"]["kill"]` is exactly `string` and required (a decoded value without it does not compile); `typeof Settings.Settings.Encoded` requires `kill` too (limits without it do not compile), and `kill: undefined` in the encoded form does not compile; `Settings.killWait` answers `Duration.Duration` | type (`expectTypeOf` and `@ts-expect-error`) | type | declare it `Schema.optionalKey(TimeText)`: the decoded type loses the required key, the `@ts-expect-error` goes unused, red; give it `withDecodingDefaultKey`: the encoded form takes limits without it, the `@ts-expect-error` goes unused, red; declare it `Schema.DurationFromString`: the decoded type is not `string`, red | kalfa/git/src/Values.types.test.ts |
| K5, no fixed limit in the package's code: every `.ts` file under `kalfa/git/src/`, folders below included, except `*.test.ts`, `*.test-support.ts`, `RepositoryTest.ts`, `HistoryTest.ts` and `Settings.ts`, holds no match of `/Duration\.(nanos\|micros\|millis\|seconds\|minutes\|hours\|days\|weeks)\(/`, no quoted duration text (`/["'`]\s*\d[\d_.]*\s*(nanos?\|micros?\|millis?\|seconds?\|minutes?\|hours?\|days?\|weeks?)\s*["'`]/`), and no top-level decimal constant (`/^(export )?const ([A-Z][A-Z0-9_]*) = (\d[\d_]*)\s*;/m`) except the three named below, each found exactly once. The scanned list holds `ProcessRepository.ts`, `MemoryRepository.ts` and `internal/parse.ts` | test (`it`) | scenario: the package's own files | put back `const KILL_AFTER = Duration.seconds(5)`: red; `forceKillAfter: "5 seconds"`: red; (f) add `const MOST_PATHS = 1000;` to `internal/lookup.ts` and scan only the top folder: the scanned-list check reds it; remove `BINARY_WINDOW` from `internal/lines.ts` but keep it allowed: "found exactly once" reds | kalfa/git/src/Package.test.ts |

Lint, type or test? P3k, P3g and G5 are behavior, so tests. T5 is a shape the compiler checks, so type. K5 is a
shape rule over source text; an oxlint rule would cover the whole repo and need its own plugin and test, for one
package's rule, so a package law in the style of K2 and K3 is the smaller tool, 80%.

The three allowed constants, and why none is a setting: `BINARY_WINDOW = 8000` (`internal/lines.ts`) is git's own rule
for a binary file, and the memory adapter must keep it to agree with git; `HEADER_BYTES = 80` and `HEAD_BYTES = 60`
(`internal/parse.ts`) are how much of a printed row a parser reads, sized to git's fixed format. The byte codes
(`NEWLINE = 0x0a` and the like) are hex and do not match. The version floors `OPEN_NEEDS = "2.38"` and
`MERGE_NEEDS = "2.40"` are text and are what the commands need, not limits.

No law here is host-only. No law needs a real git, a real signal or launchd: the stand-in's finalizer sleeps the
command's `forceKillAfter`, as the Node spawner does. No `.integration.` law changes.

## Files

| File | Change | Owner | Product lines expected |
|---|---|---|---|
| kalfa/git/src/Settings.ts | `Limits` gains `kill`, required; `killWait`; doc comment | build | 12 |
| kalfa/git/src/ProcessRepository.ts | `KILL_AFTER` and its comment go; `child`, `runner` and `lister` take `kill`; `layer` decodes it beside `after` | build | 8 |
| kalfa/git/README.md | Settings section: `kill` in the example, the kill sentence | build | docs |
| kalfa/git/src/ProcessRepository.test.ts | the second P3 law becomes P3k; P3g | tests | tests |
| kalfa/git/src/Values.test.ts | G5 gains `kill` | tests | tests |
| kalfa/git/src/History.test-support.ts | `limitsArb` gains `kill` | tests | tests |
| kalfa/git/src/Values.types.test.ts | T5 | tests | tests |
| kalfa/git/src/Package.test.ts | K5 | tests | tests |
| .kalfa/quests/kalfa-git-kill-wait-PLAN.md | this plan | lead | docs |

No glossary change: `kalfa/git/GLOSSARY.md` holds git's own words, and `kill` is a setting key named for POSIX's
`SIGKILL` and Effect's `forceKillAfter`, not a domain word. No new package, so no lockfile change and no new
layer rule.

## New names

- `limits.kill`: the setting. Named for what happens after it, as `SIGKILL` and Effect's `forceKillAfter` say. The
  industry word for the wait is "grace period" (Kubernetes); `grace` was the other choice, and `kill` reads plainer in
  `[limits]` beside `time`.
- `Settings.killWait`: decodes it, named as `timeLimit` is.

## Existing tools

- `Settings.killWait` in `kalfa/git/src/Settings.ts`: searched `kalfa/git/src` for a decode of duration text and found
  `Settings.timeLimit`, which reads `time` only. `killWait` is its twin for `kill`, with the path in its error. A shared `durationOf(text)` was
  weighed: it saves one line and makes callers name the field, so no.
- The duration check: the existing `TimeText` in `Settings.ts`, reused as it is.
- K5's file walk: the existing `filesUnder` in `kalfa/git/src/Package.test.ts`; searched the package's test files for a
  source scan and found only K2 and K3's, which use it.
- P3k's kill: the existing stand-in spawner (`standIn`, in the package's test support), which already records `forceKillAfter`
  and sleeps it in the finalizer of a child that ignores the first signal. No change to it.

## Is this a setting?

- The kill wait: yes, this pull request.
- `BINARY_WINDOW`, `HEADER_BYTES`, `HEAD_BYTES`: no. Each is git's format or rule; a different value makes the
  adapters disagree with git or read a row wrong, with nothing an app could gain.
- The one more second Effect's Node spawner waits after `SIGKILL`: not ours. It sits in `@effect/platform-node-shared`,
  so this package cannot set it.

## Who lands first

PR https://github.com/kamp-us/tea-fabrika/pull/2052 (ticket 1935) is open as a draft and touches four files this plan
touches too:

| Shared file | 2052's hunks | This plan's |
|---|---|---|
| kalfa/git/src/ProcessRepository.ts | the import line, `NUL` after `encoder`, `kindIn`, `printedId`, `descend`, `editTree` | lines 49 to 52 (`KILL_AFTER`), `child`, `runner`, `lister`, `layer` |
| kalfa/git/README.md | the intro, a new edit section, the `files` sentence of Settings | the first and last sentences of Settings and its example |
| kalfa/git/src/ProcessRepository.test.ts | imports, and new laws after line 2326 | the second P3 law, lines 238 to 323 |
| kalfa/git/src/Package.test.ts | `EXPORTS` and K1's comment | K5, added at the end |

No hunk overlaps. The nearest are `KILL_AFTER`'s deletion and 2052's `NUL` two lines below it, and the Settings
paragraph of the README. The import line of `ProcessRepository.ts` stays as it is, since `Duration` is still used as
`child`'s parameter type. The tests step starts from main after 2052 lands, if it has; if it has not, whichever lands
second takes main in and resolves these by hand, a few lines. Settings.ts, Values.test.ts, Values.types.test.ts and
`limitsArb` in History.test-support.ts (2052 only adds at line 1432) are this plan's alone.

## Validation

- tests step: each law file alone, `nice -n 15 pnpm exec vitest run kalfa/git/src/ProcessRepository.test.ts`, then
  `Values.test.ts`, `Values.types.test.ts` and `Package.test.ts` the same way, each red for the reason its row says
  before the build. Each plant by hand, undone.
- build step: the same four files green, then `pnpm format` and `pnpm lint`.
- The lead runs `--changed origin/main` and `pnpm typecheck` once, outside the box.

## Size

1. Slice 1, the kill wait is a setting: 20 lines of product code (Settings.ts 12, ProcessRepository.ts 8), the README's
   Settings section, and about 160 lines of laws (P3k and P3g 90, G5 15, T5 20, K5 35). 85% sure of the size.

Steps: tests (Sonnet), build (Sonnet), one review (Opus), and one likely send-back, priced at about $7 a step on list
prices for a change this small.

Estimate: 4 steps, $28

## What this cannot tell us

- That a real git that ignores SIGTERM is killed after the set wait. P3k proves the adapter hands the wait to the
  spawner; the spawner's own kill is Effect's, and no real-binary law here sends a real signal.
- That K5 finds every fixed limit. It finds three shapes of one by text. A limit written inline (`Stream.take(100)`)
  passes it; the review reads for those.

## Calls taken

- `kill` is required with no default, like the other limits, and the app's layer passes 5 seconds: 90%, the lead's call
  at signing (the doubt at the top).
- The key is `limits.kill`, not `grace`: 75%. It is a name in code, and the lead may rename it at review.
- Decode once in `layer` beside `after`, not inside each spawn: 90%. One decode, and a bad or missing value dies at build,
  naming `limits.kill`.
- K5 is a package test, not an oxlint rule: 80%.
- P3k replaces the second P3 law instead of sitting beside it: 90%. The old law's "at most a minute" bound is a fixed
  limit of its own, and P3k's exact equality says more.

## Open questions

None.

## Findings

1. `kalfa/git/src/ProcessRepository.ts:49-51` says of the kill wait "It is short and fixed, and no caller has a reason
   to change it." That line goes with this pull request; it is in scope, listed so the review checks it is gone.
2. A search of every kalfa package's code for `Duration.millis(`, `Duration.seconds(`, `Duration.minutes(` and
   `Duration.hours(` outside tests finds only this one (`rg` over `kalfa/`, on main at b70a5e77d). No other ticket is
   needed.

## Lead's calls at signing (2026-11-23)

- `limits.kill` is required, with no default, like every other Git limit. Why: `kalfa/git/README.md:257` says "The limits
  are required and have no default. The app gives each one where it builds the layer." One limit with a default would
  make the package inconsistent. The ticket's "default 5 seconds" becomes: the app's own layer passes 5 seconds. The
  plan above is edited to match: no default, P3g also covers a missing value (the layer fails at build and names
  `limits.kill`), and the size is updated.
