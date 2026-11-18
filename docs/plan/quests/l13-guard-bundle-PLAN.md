
Plancheck-Version: 3

# Slice B of the two-flakes plan: the L13 guard gets a bundle of its own with no compiler in it, and records `guardMs`, in next/ (ticket 1167, decision 0036)

This is slice B of the two-flakes plan (`0001-two-flakes-plan.md` on branch
`fabrikalfa/mail-session_01WuXcauHMQJS7qtW6UxMkzV`, commit 7937a668), copied here for this pull
request only. Slice A (tezgah) landed as PR 1612; slice C (L15, the gateway) is another pull
request, and nothing here touches its files. It is about `next/`, and only test helpers, one law
and the host workflow's trigger change: no product file.

```text
flake                          what the wait waits for                    why it comes late, or never
L13 (host)                     the guard process to write guard.ready     the guard's bundle loads rolldown, lightningcss
  P19Launchd.test-support.ts     within desktop.brain-stop-timeout (5 s)    and two oxc native addons it never uses
```

The fix removes the cause. No timeout grows, nothing is retried, nothing is skipped.

## How sure, and the doubt at the top

| Flake | Cause | How sure | What would settle the doubt |
|---|---|---|---|
| L13 (ticket 1167) | heavy guard bundle against a 5 s bound | 75% for the bundle; 95% that the wait is guard.ready | `guardMs` recorded in `runs/p19/host.json` on 20 host runs after the split |

## Records

What was read, so a reader can check each claim.

- Decisions: [0036](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0036-a-flaky-test-is-fixed.md),
  [0052](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0052-tests-never-depend-on-the-machine.md),
  [0178](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0178-host-only-laws-run-first.md)
  and [0594](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0594-safe-checks-direct-mac-ci.md).
- Finding rows on main: `field/findings/2026-11-18-l13-launchd-brain-stop-flakes-on-host.json` and
  `field/findings/2026-11-18-p19-l13-times-out-once-after-the-settings-merge.json`.
- Code on main at 1775071ca (after PRs 1562 and 1612): in the app's e2e folder,
  `electron-launchd.visual.test.ts` and `node/P19Launchd.test-support.ts`; in libfabrika,
  `node/launchd/LaunchdStatus.ts`, `node/launchd/ProcessGroups.test-support.ts`,
  `desktop/BrainControl.ts` and `settings/Declarations.ts`; and `.github/workflows/host.yaml`.
- CI logs (from the parent plan): failing, run 44243735833 job 134597528763 (PR 1562 at
  e85cee196) and run 44243040878 job 134595233763 (PR 1494). Passing: run 44267539920 job
  134677786250 (PR 1562 at ab29f23f), whose `runs/p19/host.json` the log prints. The coordinator
  reports a third failure on PR 1583's host run; this plan has not read that job's log.

## How others do it

- **A guard process** in OTP is a small `heart`-like process with nothing but its job: it starts
  fast because it loads nothing else. Here the guard is bundled from the whole host check.

## The cause

On PR 1562's head the 5 s `TimeoutError` comes from `P19Host.wait`, called from `P19Host.check`.
That line is `wait(fs.exists(guard.ready), config.stopTimeout)` (`P19Launchd.test-support.ts:526`
on main), and `config.stopTimeout` is `desktop.brain-stop-timeout`, 5000 ms by default
(libfabrika's `settings/Declarations.ts`). How sure that this is the wait: 95%. The stack names
the line, and both failing jobs' launchd samplers saw no line for a `fabrika.brain.*` job: no
brain was ever loaded, and the first load comes after this wait.

Why the guard can be late (75%): the guard runs `node guard.mjs p19:guard`, and `guard.mjs` is
bundled from the whole `P19Launchd.test-support.ts`. That module imports `rolldown` and
`../../src/build.ts`, and through `@kampus/libfabrika/build` it reaches `rolldown`,
`lightningcss`, `oxc-parser` and `oxc-transform-react`. `bundle` keeps all four external. So the
guard's first act is to load four native addons and the whole build and settings graph, from a
fresh `/tmp` folder, on a macOS runner. It uses none of them. The passing run's `host.json` shows
the same runner taking 5.7 s for the first brain start and about 4 s for each later one, so cold
first loads of several seconds are normal there. The doubt: nobody has measured the guard's
start. A slow `ChildProcess.make` on a loaded runner would give the same signature.

The guard's own imports are light: `LaunchdStatus.ts`, `ProcessGroups.test-support.ts` and
`desktop/BrainControl.ts` import only `effect` modules.

## Fix at the cause

The guard gets its own small entry, and the 5 s bound stays as it is:

```ts
// Sketch, e2e/node/P19Guard.test-support.ts: the guard and the few helpers both sides share
// (command, wait, alive, processes, signal, status, listening, Config, HostError). It imports
// effect, @effect/platform-node, LaunchdStatus and ProcessGroups, and nothing that builds.
export const guard = Effect.fn("P19Host.guard")(function* (file: string) { /* moved unchanged */ });
if (process.argv[2] === "p19:guard") NodeRuntime.runMain(/* as today */);

// P19Launchd.test-support.ts imports those helpers from P19Guard.test-support.ts, the heavy module
// depending on the light one, and bundles guard.mjs from P19Guard.test-support.ts.
yield* bundle(`import ${Formatter.formatJson(guardEntry)};`, guardFile, root);
const started = yield* Clock.currentTimeMillis;
// The ready file or the guard's exit, whichever comes first: a guard that crashes fails at once
// with its exit code, never as a 5 s timeout.
yield* Effect.raceFirst(
  wait(fs.exists(`${home}/guard.ready`), config.stopTimeout),
  watcher.exitCode.pipe(Effect.flatMap((code) => HostError.make({ reason: `guard-exited-${code}` }))),
);
const guardMs = (yield* Clock.currentTimeMillis) - started; // written to runs/p19/host.json
```

`bundle`'s `treeshake.moduleSideEffects` test (today `/P19(?:Launchd|Brain)\.test-support\.ts$/`)
must also match `P19Guard.test-support.ts`, or the app's `"sideEffects": false` drops the guard's
`p19:guard` main from its bundle. The pinned law's dispatch check below catches that.

`guardMs` goes into `runs/p19/host.json` beside `starts` and `stops`, so every host run records
the guard's start. Today that fact is lost, and it is the one this plan's doubt turns on.

One value traced through: the check bundles `guard.mjs` from the light entry, starts it detached,
and reads the clock. The guard writes `guard.ready` after 600 ms; the race's first side wins,
`guardMs` is about 600, and the check goes on as today. If the guard instead throws on start and
exits 1 after 300 ms, the race's second side wins and the law fails at once with
`guard-exited-1`. If it hangs, the first side times out at 5 s with today's `TimeoutError`.

## Laws

| Law | Kind | Generator | Plant |
|---|---|---|---|
| G1: the guard's bundle links no compiler: no `rolldown`, `lightningcss` or `oxc-` path among its linked files, and it still dispatches `p19:guard`; the controller's bundle still dispatches `p19:controller` | test (the pinned L13 bundle law) | pinned: the guard entry as check bundles it | import `bundle` (rolldown) into the guard entry: the linked list holds rolldown |
| G2: L13 records `guardMs`, and a guard that exits before ready fails at once with `guard-exited-<code>` | test, host-only (launchd, real Electron, signals) | scenario: L13 on eligible disposable macOS CI | make the guard exit 3 before ready: the law fails with `guard-exited-3` in well under 5 s |
| G3: L13 passes 20 host runs in a row, each recording `guardMs`, with the count and the largest `guardMs` in the PR | test, host-only | scenario: L13, unchanged | none: a count |

Lint, type or test? Each of these is a behavior, so a test. "The guard's entry imports nothing
that builds" could be a lint rule, but it holds for one file, and G1 checks the bundle it makes,
which is what the runner loads.

Host-only laws: G2 and G3 need launchd, real Electron and real signals. They run first, before the
review, on eligible disposable macOS CI (`host.yaml`, started by hand on this branch), never on
the owner's Mac and never locally (0178, 0594). The lead reads their signal and launchd lines
before the review. G2's plant is one hand-started run on a scratch commit that is not kept, or it
is read from the code, and the PR says which. G1 runs in the pinned law, which compiles the
bundles and starts no launchd, Electron or signal.

`host.yaml`'s `concurrency` group for a hand-started run is `host-<sha>-l13` with
`cancel-in-progress: true`, so G3's 20 runs are started one after another, each when the one
before has ended, never all at once.

## Files

| File | Change | Owner | Product lines expected |
|---|---|---|---|
| next/apps/fabrika/e2e/node/P19Guard.test-support.ts | new: the guard and its shared helpers, moved from P19Launchd | tests | tests |
| next/apps/fabrika/e2e/node/P19Launchd.test-support.ts | imports the helpers from P19Guard, bundles guard.mjs from it, races ready with exit, records `guardMs` | tests | tests |
| next/apps/fabrika/e2e/electron-launchd.visual.test.ts | pinned law: guard entry and G1 | tests | tests |
| .github/workflows/host.yaml | the new guard file joins the `pull_request` paths | tests | none |
| field/findings/2026-11-18-l13-launchd-brain-stop-flakes-on-host.json | the ticket and this pull request | lead | none |

## Existing tools

- `next/apps/fabrika/e2e/node/P19Guard.test-support.ts`: searched the app's e2e `node` folder,
  libfabrika's `node/launchd/` and `rg "p19:guard"` for a guard entry of its own. Found none. The
  guard lives inside `P19Launchd.test-support.ts`. The new file holds that code, moved and not
  rewritten, so no new helper is written.

## Who lands first

PR 1562 has landed, and so has slice A (PR 1612), so this branches from main after both. Open PR
1583, and PR 1589 stacked on it, change one import line at the top of
`P19Launchd.test-support.ts` (Snapshot moves to `@kalfa/config`). This slice moves the guard and
its helpers out of the same file but does not touch that line, which stays with the controller
and the check. Whichever lands second merges main.

## Size

Slice B (tests only): about 170 lines moved into `P19Guard.test-support.ts`, about 40 changed in
`P19Launchd.test-support.ts`, about 15 in the pinned law, one in `host.yaml`. 225 lines. 75% sure.

Steps: tests, the host runs, build (no product file, so it confirms the laws are green and commits
nothing) and one review, plus one likely send-back: 4 agent steps, priced at about $4 a step from
recorded steps on 2026-11-15 to 2026-11-18 in `field/runs/`.

Estimate: 4 steps, $16

## What this cannot tell us

- How long the guard's cold start took before the split. Nothing recorded it. G2 adds the record,
  and G3's 20 runs give the margin under 5 s. If `guardMs` stays near 5 s after the split, the
  cause is the runner's process spawn or a stall, not the bundle. The next step then is a guard
  that is not a bundle at all, and that would be a new call.
- The controller bundle is the same heavy module. Its waits use `desktop.brain-start-timeout`
  (60 s), so it has not flaked, but it pays the same load each start.
- No run here proves the cause. Every claim comes from code and CI logs; G1's plant and G3's 20
  runs are the proof.

## Calls taken

Each builds a decided behavior or is an implementation choice, taken with its percentage:

- The guard's 5 s bound stays: 90%. A bigger bound would be the widening 0036 forbids, and the
  split should leave seconds of room.
- Proof count: 20 host runs for L13: 80%. At a 10% failure rate, 20 greens in a row happen by
  chance about 12% of the time. Host minutes cost more, so L13 takes fewer than slice A's 30.
- Added when this slice was copied, for the lead's read: `host.yaml`'s `pull_request` paths gain
  `P19Guard.test-support.ts`. Without it, a later change to the guard alone would never start
  L13. 90%.
- Added when this slice was copied, for the lead's read: `guardMs` is written to
  `runs/p19/host.json` as soon as the race ends, ready or not, and the full record at the end
  rewrites the same file with it. A run that fails at the guard is the one whose `guardMs` matters
  most, and today's `host.json` is written only at the end of a passing run, so that run would
  lose it. 85%.

## Open questions

None.
