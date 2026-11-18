Approved by the lead agent, builds 0014, 0093, 0036, 0052, 0590, 0161, 0164; body 29e728777ba8
Plancheck-Version: 3

```ts
// next/, sketch. Restore the original generated inputs. Keep a fresh Project for every cut.
const perWalk = Math.max(4, Math.ceil(inventory.length / 100));
const tape = fc.commands(commands, { maxCommands: perWalk + 8, size: "max" })
  .filter((commands) => [...commands].length >= perWalk);
// Inside the existing law, once per generated secret:
const secretForms = forms(secret);
// The input marker and every output scan read this same immutable array.
// seed: 119120, numRuns: runsFor({ fast: 100, full: 100 }), endOnFailure: true
```

# T1129: restore L11's input coverage and prove the speed repair

Version `next/` only. Unsigned plan for https://github.com/kamp-us/tea-fabrika/pull/1379.
Tracker ticket 1129 was filed and verified through today's tracker CLI. It follows ticket 1063,
whose title describes cutting each storage operation once. Ticket 1113 stays separate. Its title
reports an L11 cloud-box timeout, but the exact failed law and matching cause have not been proved.

Read PR head `e2273e1343880a4b39e6f7488f795f0ced93ca6d`, its complete three-file diff and both
committed step rows. Read main at `88edfe12cfc71fe50c95b3e3cc77a3c7f27b3ea1` without changing
its checkout, index or refs. The stale speed worktree was not used. This plan step runs no tests,
benchmark, install, typecheck or CI dispatch and waits on no CI.

The empirical unknown is the costly phase of the original, coverage-preserving law on the current
integrated code. No profiling result proves that Project setup, SQL, identity creation, span
collection or string scanning is the timeout's cause. This plan approves restoring coverage and
retaining one source-proved cache. It does not claim that cache fixes the timeout. Further speed
changes need the bounded measurement below and a plan update before implementation.

## Settled contract and evidence

The recovered original plan is `../boxes/p42-plan.md`, approval body `89c734b19cda`, 598 lines.
Its heading says T717; the test's own header and Tier 1 P42 row identify slice 1 as ticket 770.
L11 at original line 218 requires 100 generated flow runs and raw, JSON-escaped and percent-encoded
inspection. A8 adds the generated storage error's `name`, `code` and `errcode`. The changed-exam
section at line 249 requires no narrowing. The original plan is read as evidence, not copied into
the public repository.

PR1379 preserves unique operation coverage but removes repeated input reach. Its old tape length
was `perWalk..perWalk+8`, with `perWalk=max(4,ceil(inventory/100))`. Its current tape is exactly
`ceil(inventory/100)`. A second cut may use a different generated secret and input encoding.
Scanning all output encodings cannot test an input encoding that was never injected. Restore the
old generator exactly, including the minimum four and repeat selection after `remaining` empties.

The prior build row has ticket null, one green after-run and one storage-text plant. The prior
review covers `def5872bd`, says the T770 plan was unavailable, and reports second-form operation
counts of 254 before and 30 after. Those counts are prior-review evidence, not a replay performed
by this worker. There is no dedicated tests-step row in this PR. Preserve these historical rows;
new rows must correct the coverage claim and identify the head actually tested.

The prior audit read these remote results:

- https://github.com/kamp-us/tea-fabrika/actions/runs/43779861624 at `4248a5aacfa022a170e5d8e3bc15994157d017cd`: the storage law passed in 29584 ms and the file passed 23 tests. This proves older integrated code, with narrowed inputs.
- https://github.com/kamp-us/tea-fabrika/actions/runs/43782621366 at `43d0a275aedf24d57a41880752dce9e5b24c55a8`: the plant law failed in 36906 ms, reporting 849 operations and 59 leaks. The run later ended canceled. This is evidence for one plant, not every named output.
- https://github.com/kamp-us/tea-fabrika/actions/runs/43791247569 at the current PR head: lint and typecheck passed, but `next` skipped. The current API read confirms this. It supplies no current-head integration proof.

No result above proves the repaired generator or the final merge with main.

Settled searches used the read-only records tool for "L11 storage secrets timeout", "flaky tests
repeated speed coverage" and "generated input narrowing", then searched the plan, decisions,
glossary, direction notes and experiments for L11, P42, T770, storage and coverage. The applicable
rules are 0014 and 0093 on no narrowing, 0036 and 0052 on fixing the cause and repeated proof,
0536 and 0581 on real-resource laws, and 0590 on exact-head branch proof. No settled record found
allows this reduction or identifies the costly phase. Tier 1 records P42 slice 1 as merged and
still needed for the four-primitives work. No Tier 1 completion claim changes here.

## How others do it

Elm's answer is still a parent stepping its children, and OTP's answer is still a supervisor's
`start_child`. This repair changes neither. It changes the test's work only.

[fast-check's model-based guide](https://fast-check.dev/docs/advanced/model-based-testing/) keeps
commands inside the property and uses `asyncModelRun` for asynchronous commands. Its model stays
simpler than the implementation. Keep the existing commands, sequential execution and shrink
behavior. The installed fast-check 4.10.2 implementation constructs command lengths from
`maxCommands` and `size`; changing that bound changes generated inputs.

[Vitest's profiling guide](https://vitest.dev/guide/profiling-test-performance) separates test time
from transform/setup time and uses Node CPU profiles in the test worker through `execArgv`.
The installed Vitest 5.0.5 types expose `execArgv?: string[]`. A main-process profile alone would
not identify time inside this law. Use worker profiling only on an eligible remote runner, with
the existing test deadline. A profile's overhead is not an after-run timing result.

Installed on this main checkout: Effect 4.1.3, fast-check 4.10.2, Vitest 5.0.5 and root tea 0.27.0.
The lock also retains patched tea 0.25.0 for today's code. The relevant app uses the current catalog.
Effect's installed AGENTS was read in full. Existing Effect scopes and `fnUntraced` remain as they
are. No package API, dependency, upstream patch or module boundary is added.

## The shape

Keep the existing test-only types. No new schema or stored state is needed.

```ts
// Existing types, sketch. No domain/API change.
type StorageCut = { path: StoragePath; operation: number; statement: string };
type SecretPick = { point: number; encoding: number };
type ChildOutput = "reply" | "span" | "row" | "log";
```

`remaining` records uncut operations; `inventory` remains the fallback after all are cut. Keep the
same mutation order, modulo selection, SQL-occurrence identity and sequential public call/recovery
call. No shared database, shared Project, snapshot, pooled runtime or parallel cut is authorized.
A SQL snapshot alone would omit Project memory, descriptors, pending delivery, failure targets,
recorded spans and remote-object state. Equivalence has not been proved.

`forms(secret)` is a pure calculation over one immutable string. Its three strings are only read,
never modified. Computing them once in the existing law and reusing the array for marker selection
and every output scan preserves values, order, generator consumption and assertions. Confidence
99%. It saves repeated escaping work, at the cost of holding three strings for one walk. Its
measured speed benefit remains unknown. Keep the original denominator 100 and direct `runsFor`
call so the generator can be compared to main without an unrelated rewrite.

All 16 flows stay: fresh, saved, already, ended, recovery, migration, configuration, exit, status,
isLive, info, resolve, receive, object, read and append. All 16 sibling L11 laws and every other law
in the file stay intact. The secret generator keeps its escaping suffixes. `SecretPick` keeps all
three input encodings. The error keeps marker-bearing message, name, code and errcode.

This is not a setting. Generated input reach and the existing 60000 ms test deadline are the
approved check's contract. The cache introduces no choice for a person. No facts are added to
product records. For the repair record, save SHA, base SHA, seed/replay path, inventory and cut
counts, encoding reach, duration, failed law and run/job URL when observed. Those facts cannot be
recovered from an unrecorded run. Keep generated markers and raw profiles in private storage.

## One value traced through

1. A generated secret with an escaping suffix produces raw, JSON-escaped and percent-encoded forms once.
2. A command chooses an unvisited storage occurrence, or a repeated one after the inventory is exhausted, and selects its input encoding.
3. A new scoped Project and database prepare that flow. The selected operation throws the marked error, including its metadata fields.
4. The public call's reply or rejection, database rows, stored spans and formatted logs are captured. Recovery runs and its outputs are captured too.
5. Every captured string is searched for all three forms. The same hit, nonempty-walk, remaining-empty, reached-size and no-leaks assertions run. No command disappears to save time.

## Conflict ownership and resolution

A read-only three-way merge against the stated main confirms three conflicts in the integration
law at old PR lines 650, 669 and 680. The first combines main's original `perWalk` and spacing with
the PR's exact-length explanation and new `walks` variable. The second conflicts at the cache
insertion. The third conflicts at marker selection. Main also has formatting changes and its
current `Schema.decodeOption` use near the end of this file.

Tests owns every edit of the integration-law file, including these conflicts. The lead owns the
normal merge of main and its plain bot commit with the required co-author trailer. Resolve the first conflict to main's original
`perWalk` and remove the exact-once explanation and unused `walks`. Restore `maxCommands: perWalk
+ 8` and the original run-count call even though those edits may merge without conflict. Resolve
the next two conflicts by retaining the once-per-law cache and using it for marker selection.
Keep the cache in the output scan, main's formatting and current decoding API. Never take the
whole file from one side. No rebase, reset, force push or history rewrite.

The builder changes no test file. For this test-only repair its step reads the finished tests
diff, checks the cache's equivalence and collects the bounded performance evidence. Any new
product-file fix goes back to the plan before it starts. Ticket 1122 and the watcher work are
outside this file's repair and remain untouched.

## Laws

These are the existing L11 obligations, not new tests that read the test's source text. Shape
checks remain lint/type checks. The tests step uses the current law-declaration rules without
broadly converting unrelated laws.

| Law | Lint, type or test? | Generator | Plant that must fail |
|---|---|---|---|
| L11 [secrets]: every storage occurrence in all 16 flows keeps marked error text and metadata out of reply, row, span and log, before and after recovery | test | fc.commands: original perWalk..perWalk+8 range, original Secret and SecretPick, seed 119120, 100 runs at both fast and full depth; fresh Project for every cut | Leak the selected marker through each named output separately. Run each plant once on the restored range and record an assertion failure naming the output, then remove it |
| L11 sibling laws [secrets]: descriptor, recovery, configuration and exit failures preserve all four output checks and A8's metadata fields | test | fc.commands: unchanged ProjectTape and Secret, 100 runs at full depth, unchanged fast counts | Reuse the original named-output plant sites, one output at a time. Include an encoded metadata-only leak, so raw-only injection cannot count as proof |
| Existing resource and module rules still hold | lint | lint | A resource/file classification or module violation is caught by the existing lint checks; no new lint rule or allow-list entry |

Temporary plants belong to tests and are never shipped. Their exact sites must be read on the
integrated head. The original plan names Runner answer/log paths and ChildrenLedger span paths;
today's shared worker storage sanitizer is an additional known storage-text plant site. A leak
plant that times out before its output assertion proves nothing. Restore clean code after each.

## Existing tools

- `storageSecrets`, `forms`, `outputText`, `storageCall` and `childProject` already exist. Searched their definitions and fixture acquisition/observation/row reads. Reuse them; add no helper or function.
- Searched the installed fast-check exports, bundled command generator and Vitest profiling types. Existing commands and worker CPU profiling fit; no npm dependency is needed.
- Existing `scheduled.yaml` branch proof runs the changed-and-related set at full depth and retains its proof-set and JSON results. Read its selection, jobs and deadline rules. Reuse it for baseline and after proof, without editing workflow/config files.
- If the available remote execution route cannot collect a worker CPU profile, report that capability gap to the lead. Do not invent a profile, set protected host/cloud flags locally or add a workflow to this repair.

## Files

Only the integration law changes executable text. It stays in the app because it exercises the
app's boot/Project wiring and real-instance fixtures. A from-scratch libfabrika client does not
need this app's test wiring. Product contracts and layers do not move.

| File | Change | Product lines expected | Owner |
|---|---|---:|---|
| `next/apps/fabrika/src/start-child.laws.integration.test.ts` | Restore original tape/input reach, retain pure forms cache, resolve main conflict | tests | tests |
| `field/runs/` | New tests, build and review rows with ticket 1129 and exact proof, preserving old historical rows | records | lead |
| `field/notes/` | Record the coverage correction and actual speed result or unresolved cause | records | lead |
| `docs/plan/README.md` | Short repair status if needed; no P42 completion change | docs | lead |

### Bounded tests amendment: measure one equivalent output walker

The tests step may also use the already-reviewed single-buffer walk in `outputText` in
`start-child.laws.integration.test.ts`. It visits the same keys and leaves in the same order,
emits the same raw and JSON-encoded strings, and still excludes the error causes. Only the
tests owner changes this function. Product code and all coverage stay as above.

The cache-only candidate timed out at 60,036 ms. The unchanged main law has timed out at
60,019 ms and passed at 45,312 ms and 35,548 ms. These runs show variation. They do not identify
the cause, show a speedup, or test this buffer candidate. Keep the cache-only comparison
separate. Collect the next candidate's evidence through automatic full-depth PR and protected
queue CI. Preserve input-sequence comparison, all seventeen L11 laws, the sixteen storage
flows, the seed and run counts, fresh cuts, each named-output failure and restoration,
consecutive full-depth passes, and the 60,000 ms deadline. If the cost remains unproven, keep
the remote worker profile requirement. No further optimization is approved here.

## Validation

1. The lead approves this unsigned plan. A fresh tests agent restores the generator and resolves the owned conflict during a normal merge of current main. Record the new exact SHA. Read every automatic merge too.
2. Establish a remote baseline with the original reach and no cache on that integrated product code, then an after head with only the equivalent cache. Use eligible existing branch proof or eligible remote execution. Record both exact SHAs and test-file contents. A narrowed-generator green is not a baseline. Neither result is assumed in this plan.
3. Confirm equal generated command/input sequences for the same actual inventory and seed, including repeats, encoding selection and count. This is a temporary comparison, not a committed source-shape test. Inventory size may change with main; do not require the historical 849 or 1318 counts when it does.
4. Run the named-output plants with the old reach remotely and remove each. Read the assertion failures. Run the full start-child file and its unchanged siblings at the after head.
5. Decision 0036 requires many consecutive after-passes and the count in the PR. Before dispatch, the lead records a bounded consecutive-run count and its reason from the baseline failure history. Complete that batch on the same after SHA and record every run, including failures. One after-pass is insufficient. Any recurrence means cause still open; do not restart the count and report only greens. This plan invents no numeric reliability threshold.
6. If restoration plus caching still fails or lacks a measured benefit, perform one bounded worker CPU profile of this same restored law remotely, with the original seed, 100 runs and unchanged deadline. Keep the full profile privately and record where samples land among fixture acquisition/preparation, public call/recovery, row/span capture, scanning and disposal. Compare ordinary baseline/after results separately. No timer, hook, retry or instrumentation lands. Choose no further optimization until evidence identifies the cost and its behavior-preserving change is planned. If the deadline cuts profiling off, preserve that failure and profile; do not raise it.
7. Required normal checks run after formatting: lint, the narrow affected ordinary tests and the changed ordinary set under nice 19/maxWorkers 1, and one globally coordinated typecheck. The plan worker runs none. Real-instance/resource laws stay on eligible remote proof; signal, launchd and Electron laws, if reached, run only on disposable macOS 15 through the existing host workflow. Never spoof flags, rename files or reduce counts to move a law locally.
8. Before review, read the proof-set and actual JSON report to verify this exact integration file ran at the final SHA at full depth. A skipped next check or an empty changed set does not qualify. Hand the recovered original plan and new evidence to the original reviewer for the repair recheck. The reviewer is separate from tests/build and binds its verdict to the integrated head. A changed final head requires fresh proof and the relevant recheck.
9. The lead reads loosening output against the original approved reach, leak-checks all added text/commits and lands only after all steps and exact-head checks pass. The current plan step dispatches nothing and waits on no run.

## Records

New step rows name ticket 1129, exact tested head, workflow/job URLs, each actual plant result,
consecutive pass count and unresolved evidence. Keep the two old PR rows as history. Record the
coverage correction in a note and link it from the tracker and PR. No private plan or profile
gets copied into the public tree.

## Calls

- Restore the exact old generator and retain only the pure forms cache now. Confidence 99% for behavior preservation by source. The cost is the original number of fresh Project preparations; speed is still an empirical question.
- Keep ticket 1113 separate. Confidence 95%. Matching a short L11 label is weaker evidence than matching the failed full law and cause. Separate records may cost an extra tracker link but avoid claiming an unrelated timeout fixed.
- Do not reuse Project/database snapshots or parallelize cuts. Confidence 95%. Existing fixture memory and recovery state make equivalence unproved. Measurement comes first.

## Size

1. Restore coverage, retain the equivalent cache and resolve the law conflict: about 25 changed test lines, 0 product lines. One whole repair, followed by evidence and review. Further optimization has no honest line estimate until the profile is read and its plan is amended.

Tests, build/evidence and review, plus one likely fix round. Budget uses the recovered T770 plan's
$5-per-step estimate as a conservative allowance, not measured token billing. The public original
PR https://github.com/kamp-us/tea-fabrika/pull/1011 records later small tests steps at $0.36 to
$0.79, builds at $0.61 to $0.88 and reviews near $1; the larger allowance covers remote proof
and a likely fix round. Confidence 50%; remote failures may add work.
No paid model or provider run was requested by this plan worker.

Estimate: 4 steps, $20

## Open questions

None.

Restoring decided coverage needs the lead's plan approval, not a new owner
design choice. The costly phase, actual benefit of caching and ticket 1113's matching cause are
empirical unknowns for the assigned workers.

## Findings

None outside this repair.

## What this cannot tell us

No repro, profile, plant, benchmark or after-run was performed in this plan step. Source proves the
cache's value equivalence and the generator reduction. It does not prove that restoring coverage
and caching removes the timeout. The final integrated SHA, repeated remote passes, named-output
plants and review verdict remain required evidence before landing.
