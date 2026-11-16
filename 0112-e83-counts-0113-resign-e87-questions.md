# 0112: E83's box is all green; the 0113 amendment is ready to sign; E87 brings three calls, and E43 is wrong in your layer 5

## E83: every file passes, at both heads

Nothing failed, the 0178 guard refused nothing, no override was set, and nothing was changed.
Counts are passed/failed/skipped, then vitest's Duration.

**Run 1, the tests step, at `dfd033025`: 25 files, each run alone.**

| File | Result | Time |
|---|---|---|
| build.integration | 11/0/0 | 87.46 s |
| door.integration | 153/0/0 | 27.17 s |
| file-services.laws.integration | 13/0/0 | 4.05 s |
| hands-launcher.integration | 2/0/0 | 43.98 s |
| instance-one-file.integration | 7/0/0 | 37.39 s |
| port-home-guard.integration | 1/0/0 | 0.89 s |
| port-home.laws.integration | 3/0/1 | 13.96 s (the 1 skip is the test's own) |
| record.laws.integration | 7/0/0 | 6.76 s |
| repository-open.integration | 1/0/0 | 29.75 s |
| runtime-recovery.laws.integration | 14/0/0 | 72.46 s |
| runtime.laws.integration | 29/0/0 | 19.41 s |
| settings-generated.integration | 5/0/0 | 5.43 s |
| start-child.laws.integration | 23/0/0 | 82.69 s |
| worker-monitor.integration | 3/0/0 | 18.20 s |
| cloudflare/supervision.laws.integration | 6/0/0 | 3.27 s |
| ProcessLifecycle | 31/0/0 | 4.96 s |
| ProcessManagerMemo | 2/0/0 | 4.22 s |
| ProcessMonitors | 29/0/0 | 10.49 s |
| ProcessSpans | 4/0/0 | 2.12 s |
| ProcessStreams | 13/0/0 | 3.61 s |
| RecoveryStore | 8/0/0 | 1.02 s |
| Runner | 117/0/0 | 41.29 s |
| telemetry/Records | 22/0/0 | 1.26 s |
| telemetry/Sink | 41/0/0 | 2.11 s |
| telemetry/internal/measurements | 17/0/0 | 3.72 s |

**Run 2, the build, at `7665fd512`, with the lockfile unchanged.**

| File | Result | Time |
|---|---|---|
| `next/apps/fabrika/src/build.integration.test.ts` | 11/0/0 | 91.24 s |
| `next/packages/libfabrika/src/runtime/Runner.integration.test.ts` | 117/0/0 | 39.09 s |
| `next/packages/libfabrika/src/telemetry/Sink.integration.test.ts` | 41/0/0 | 2.07 s |

No Runner test timed out at vitest's 5 s default in this box.

## The 0113 sweep: its plan amendment, for re-sign

- **Branch and head:** `fabrikalfa/port-scripts-0113` is at `5472e0bae`.
- **Body digest:** plan-sha256 `3783b353e1312cd417527e01acdb00dfce0cc5c003b7202bd561cd90ceda687c`.
  The approval line still names `81af55606021`.
- **Plan check:** `--approved` fails only on the body hash. `--draft` passes on a copy with line 1
  blanked.

Each change is dated 2026-11-16:

- **S5:**
  - Files rows for `redact/RedactFs.ts`, with its Existing tools and New names lines (0587), and
    for the `--` in `box.sh` and `runplan.sh`.
  - A Laws row: the redacted count is a number. Its plant is NaN.
  - The LockFs finding, both in Findings and as `field/findings/2026-11-16-lockfs-has-no-law.json`.
- **S12:**
  - `--publisher <name>` replaces `STEPCOMMIT_PUBLISHER`. With no flag, `publish.ts` runs. `bot`
    runs `node botpush.mjs <worktree> <branch>`. botpush's own usage wants the worktree first,
    which is a second reason today's call fails.
  - A Laws row: the named publisher runs, and an unknown name is refused with a typed error.
  - `field/findings/2026-11-16-stepcommit-publisher-runs-its-value.json`.
- **S9:** a Files row for `exam.integration.test.ts`, and a note that `exam.py` is deleted at
  integrator 2's switch.

**Commits, as made:**

- The amendment is a plain git commit, because stepcommit refuses the step name `plan`. S12 fixes
  that.
- S5's clean commit is `c2b35b5de`, and leakgrep over `f074a55..HEAD` exits 0. The leaky local
  branch and its worktree are deleted, locally only.
- One slip, left as written because commits are not rewritten: the S2 glob-workaround note on
  integrator 1, at `b647c766d`, carries a Claude-Session trailer naming my session, not the
  coordinator's.

S5's build starts now.

## E87 (`missingPipeableSignature`): sent back once; three calls for you

The branch is `fabrikalfa/effect-e87`, head `76b9d2c47`, with the review row pushed.

- **98 of 101 hits are right:** `Function.dual`, with checked predicates. Data-first callers are
  unchanged, the suite counts 5 and 29 hold, and typecheck is green.
- **A fix round has started,** with one build agent.

**(1) Narrowing two decoders to one argument.** `decodeExitReason` (`ExitReason.ts:55`) and
`letterBody` (`Mailbox.ts:122`) are Schema decoders whose first argument is `unknown`, so no safe
dual exists. The fix round narrows each to a one-argument function. Every caller passes one
argument, so behavior does not change. Is that an acceptable reading of "every hit gets
Function.dual"? The reviewer leans yes, 85%, and so do I. If not, that commit is reverted.

**(2) `nodeExecution`** (`runtime/Execution.ts:252`, `(declared: unknown, build = "node")`). No
predicate can tell a piped build string from a direct string declaration.

| Option | What it costs |
|---|---|
| (a) Make `build` required and use `Function.dual(2)` | About 40 one-argument callers, mostly exam-path tests, pass `"node"`. A tests round, then a build. |
| (b) Keep it listed, with a reasoned ignore line, in the final lock PR | Nothing now. |

The reviewer leans (a), 70%. I lean (a) too: it removes an ambiguity rather than documenting it.
It stays as it is until you answer.

**(3) E43 overlaps E87, and E43 has a real fault. This matters for your layer 5 fold.**

- **The overlap:** `origin/fabrikalfa/effect-e43` at `8acb42f` shares cloudflare, runtime, ledger
  and settings product files with E87. Merge-tree shows 31 files in conflict, mostly comments and
  import order.
- **The fault:** E43's `nodeExecution` predicate, `!Predicate.isString(args[0])`, is wrong. A
  direct call with a string declaration is read as piped, so `cloudflare/box.ts:26` gets a function
  back instead of a failing Execution.
- **The reviewer's lean:** the fold takes E87's side in those five folders, and takes neither
  branch's `nodeExecution` until (2) is ruled.
- **Against main:** E87 also conflicts with current main in `cloudflare/connection.ts`,
  `cloudflare/index.ts` and `runtime/QuotaRunner.ts`, so the fold should recount.
- **Two finding rows,** to be committed on E87's branch after the fix round:
  `e43-node-execution-reads-string-as-piped` and `dual-suite-helpers-registered-count-unchecked`.

If E43 is already in your fold agent's list, that agent needs this before it merges E43.

E82's build is running.
