Approved by the lead agent, builds current typed checklist proof and 0093/0594; body eb7d2a7f7b5d
Plancheck-Version: 3
# Checklist1126 remaining fault groups

~~~text
source27039 -> fixed neutral probe bytes -> baseline PASS
            -> one fixed fault -> intended causal assertion RED
            -> restored neutral bytes -> PASS
            -> original bytes, mode, head, index and inventory restored
~~~

## Result and approval boundary

This maps six remaining checklist fault groups to nine closed cases. Two are direct notification edits. Three check completion. The sixth group has four cases for replacement, deletion, an in-flight failure and a failure completed before waiting. The PID triplet in run44051257300 is accepted separately.

Source is exactly27039e9455026f37327259a5411260cb4d441ba8, version next/. Original test Git blob is9807a7d0861768fe1a5e868e837a975b0076d74a. Its full-file SHA256 is87cf843c2c5544d89551ff99a8259b8aec681973c36314a8c6f0fb18f8509904. Parent approved plan body4f0d3db59859 remains unchanged.

The lead approved this bounded amendment and its fixed vectors before construction. The exact literal edits and hashes are recorded in `.github/ci/plant-cases.ts`. Source acceptance and ordinary checks do not prove the actual runtime fault exercises.

## Known way and settled rules

Elm waits for the actual command answer; Erlang receives a matching message. Effect4.1.3 supplies the existing Deferred result and scoped child execution. Sources: https://guide.elm-lang.org/effects/ and https://www.erlang.org/doc/system/expressions.html#receive and https://github.com/Effect-TS/effect/blob/effect%404.1.3/packages/effect/src/Deferred.ts and https://github.com/Effect-TS/effect/blob/effect%404.1.3/packages/effect/src/Effect.ts .

Read0093 and0061 again: faults run once and are removed, and held resources are released by scope. Read-only settled search was checked. The parent rules0036,0052,0061,0093,0069 still apply. No new setting or owner policy. A closed execution case is not a product setting.

Installed forkChild has startImmediately. Its implementation evaluates that child before returning the handle. The probes use actual callback entry, a Deferred release and one pending-child snapshot. No sleep, repeated yield count or stability polling. These source facts do not replace actual scheduling proof.

## Existing tools

- .github/ci/plant-cases.ts: searched fixed mappings and unique-span derive. Reuse its literal edits and add only enumerated names.
- .github/ci/plant.ts: searched exercise, unchanged and restore. Its three-phase machine stays. Two direct cases fit the current contract. Seven probe cases need fixed neutral preparation before baseline, while final cleanup still restores original source.
- .github/ci/plant-errors.ts: searched the current causal classifier. Add fixed diagnostics and exact case-specific frames, never generic fast-check wording.
- .github/ci/plant.test.ts: searched existing phase, snapshot and rejected-evidence laws. Extend them using existing runners and Schemas.
- .github/ci/plant-reporter.integration.test.ts: searched actual fast-check/Vitest compatibility. It crosses a real child edge and stays on eligible disposable CI.
- The world in next/apps/fabrika/src/checklist-instance.laws.integration.test.ts already owns its alarm timer and real Process call. Temporary AlarmProbe/pause support remains there only in the disposable source copy.
- Deferred cells and scoped child handles are the existing tools. No new helper file, executable, general executor, public API or interpreter.

## Fixed vectors and bytes

The fixed case catalog in .github/ci/plant-cases.ts is part of this amendment. Every before/after string, ordered preparation edit, one broken-phase edit, full-file hash and predicted assertion frame is there. Each anchor matched exactly once in source27039. Eighteen prepared/broken images parsed as TypeScript text without syntax errors. No module was evaluated; no law, compiler or fault ran.

These are fixed catalog literals, not a new workflow input language. Requests remain enumerated case plus source SHA only. A caller supplies no code, path, selector, regex, timeout, environment override or command. Reuse the existing unique-text guard for the fixed spans. No eval, VM or arbitrary patch program.

The vectors preserve literal unformatted bytes. Formatting them changes hashes and frames. Return an updated unsigned amendment for whole lead review if any literal must change. Never broaden an anchor or silently accept another source hash.

## Phase and cleanup contract

1. Inspect original source. Require source SHA, full-file hash, regular mode, clean full inventory, head and index.
2. Compute prepared and broken bytes from the fixed catalog. Check their expected hashes before writing. Only the one selected test file may differ; never stage it.
3. Baseline uses prepared bytes and the existing selected generated property. Require PASS. A preparation error or timeout is incomplete evidence.
4. Broken changes one fixed behavior over those same prepared bytes. Require the selected property's intended terminal causal AssertionError at the planned frame.
5. Restored uses prepared bytes again and must PASS.
6. Final scoped cleanup restores original source bytes and mode, then verifies head, index, complete inventory, summary and original hash.

No new phase machine. Existing unchanged can compare each expected byte image with the original head/index/mode and sole allowed dirty path. Keep originalHash distinct from preparedHash and editedHash. Restored-phase bytes may still contain temporary probes; final cleanup must not.

Temporary probes add checks inside the existing generated property. They remove or rewrite no existing assertion, generator, seed, count, limit, pinned example, runner or coverage check. Each held call has an independent returned cell. The probe finalizer releases its gate, then awaits every started callback's returned cell before the world's existing cleanup. It does not trust the work.done record that the fault corrupts.

## Six obligation groups

The following case entries are generated below from the fixed vectors. Expected frames are static predictions at matcher positions in the exact proposed broken bytes. The accepted PID artifact's838:73 position calibrates that calculation. Actual remote causal stacks must confirm them. A different failure is not silently accepted.



### checklist-body

Alter only delivered rev to -1 after published recorded the original Process update. Keep pid. The existing unchanged-body assertion must catch this, so neither side of the oracle is changed together.

Selected law: L13: notices name their process each view.whole and view.patch for checklist:1 carries its pid and the update its Process published.

Expected closed diagnostic: AssertionError: the update reached the client unchanged. Predicted matcher frame 840:91. This is not an observed failure.

Prepared SHA256: 87cf843c2c5544d89551ff99a8259b8aec681973c36314a8c6f0fb18f8509904.

Broken SHA256: dfc6983e043ab66b3790f3e88e1f2efd017110b59a93bbac7a825bee7de3d20b.

Restored phase equals prepared bytes; final cleanup equals the original source hash. The fixed case catalog supplies every exact before/after anchor.

### checklist-drop-notify

Drop exactly the first view notification, identified by the independently recorded first whole/patch publication. Later notifications append normally. Existing nonempty-view or count comparison must catch it. Shrinking can leave no other view, so two exact existing frames are allowed.

Selected law: L13: notices name their process each view.whole and view.patch for checklist:1 carries its pid and the update its Process published.

Expected closed diagnostic: AssertionError: the client heard the checklist's views. Predicted matcher frame 837:80. This is not an observed failure.

Expected closed diagnostic: AssertionError: checklist notice count differs. Predicted matcher frame 838:38. This is not an observed failure.

Prepared SHA256: 87cf843c2c5544d89551ff99a8259b8aec681973c36314a8c6f0fb18f8509904.

Broken SHA256: 3144b346f9ac98548a756c2a309ef83599e0252fece52f977ecb80d470fa1f30.

Restored phase equals prepared bytes; final cleanup equals the original source hash. The fixed case catalog supplies every exact before/after anchor.

### checklist-early-complete

Pause the actual callback before its real Process call. The fault completes work.done before signaling callback entry. The neutral probe checks that completion is still unresolved. It then releases the call and keeps all original fresh-state assertions.

Selected law: L13: notices name their process successive sends land and a client joining after the first send opens the current checklist.

Expected closed diagnostic: AssertionError: alarm completion waits for the real callback. Predicted matcher frame 779:107. This is not an observed failure.

Prepared SHA256: da5ed53689af965741a4684f4c53285f4c013d65bfb8bef7c308102a3b4161b9.

Broken SHA256: 1fbd13adcee585a4fa8d6635f8e16b675b123ea9b098d2181d1d39fbd40e64c8.

Restored phase equals prepared bytes; final cleanup equals the original source hash. The fixed case catalog supplies every exact before/after anchor.

### checklist-held-call

Hold a real callback and start the actual settled operation. After callback entry the child must still be pending, then release/join must finish it. The fault omits the actual batch await. No timer or repeated polling decides readiness.

Selected law: L13: notices name their process successive sends land and a client joining after the first send opens the current checklist.

Expected closed diagnostic: AssertionError: settled stays pending while the callback is held. Predicted matcher frame 780:98. This is not an observed failure.

Prepared SHA256: ac72eaebcf7807fbc420a1d50d48db7c49aa0eac02f9353aa2faec49298649a2.

Broken SHA256: 30f002b04b283c0795ac241b046c8cee7c436c38b44e5d83d600f088c110946f.

Restored phase equals prepared bytes; final cleanup equals the original source hash. The fixed case catalog supplies every exact before/after anchor.

### checklist-due-reschedule

After the first real Process call returns, rearm the existing alarm adapter at0. Hold the second callback. The fault returns after the first consumed batch. At second entry, the settled child must still be pending. Release/join must finish without awaiting a future wake.

Selected law: L13: notices name their process successive sends land and a client joining after the first send opens the current checklist.

Expected closed diagnostic: AssertionError: settled includes the rescheduled due callback. Predicted matcher frame 786:95. This is not an observed failure.

Prepared SHA256: e06e8591c63a7478875fe7d981aebddc944ace52618c4fc94b8d3b53ef4ddea5.

Broken SHA256: 2eba932c86e465964cd3d55608300c64c1a491cd28226514874b2f9b6348f613.

Restored phase equals prepared bytes; final cleanup equals the original source hash. The fixed case catalog supplies every exact before/after anchor.

### checklist-running-replace

Hold an actual running call. Arm a future schedule, then replace it. The fault completes every running record when canceling the pending record. The running call must stay unresolved until its actual release. This also checks that future schedules do not hold the eventual join.

Selected law: L13: notices name their process successive sends land and a client joining after the first send opens the current checklist.

Expected closed diagnostic: AssertionError: canceling a schedule keeps the running call pending. Predicted matcher frame 786:114. This is not an observed failure.

Prepared SHA256: 951b21bb82caf768b7009313a17fece337e5c767440421681970c3ce779de759.

Broken SHA256: ef764cdd9d6b087251195f2c97d2352be0f4cd0b39f3d5d6ef42450fa9b940f1.

Restored phase equals prepared bytes; final cleanup equals the original source hash. The fixed case catalog supplies every exact before/after anchor.

### checklist-running-delete

Hold an actual running call, arm a future schedule, then delete that schedule. Apply the same wrong-running-completion fault. Deletion needs its own triplet; a successful replacement case does not prove it.

Selected law: L13: notices name their process successive sends land and a client joining after the first send opens the current checklist.

Expected closed diagnostic: AssertionError: canceling a schedule keeps the running call pending. Predicted matcher frame 786:114. This is not an observed failure.

Prepared SHA256: 1c7eda62183a128ff73c16b082fc05889454bef0c0872988a809873fe214e3f4.

Broken SHA256: ad935ce016118a7e697e804b8c0d8c52473f8e91f218645182271c6d389a3291.

Restored phase equals prepared bytes; final cleanup equals the original source hash. The fixed case catalog supplies every exact before/after anchor.

### checklist-alarm-failure

After the unchanged generated walk, hold one alarm and start settled. Release it; the boundary runs the real Process call and then rejects with a fixed Error. The fault swallows AlarmFailure. The added assertion requires failure propagation; positive phases also require the typed wrapper and original cause identity.

Selected law: L13: notices name their process successive sends land and a client joining after the first send opens the current checklist.

Expected closed diagnostic: AssertionError: alarm failure reaches the completion waiter. Predicted matcher frame 810:91. This is not an observed failure.

Prepared SHA256: e5eb025fb38d1abe0fb6b2a855eeb4dc25d7c0eb6567433790c8a378db4c01a7.

Broken SHA256: 4e2e5782d6f6e53ec9423974cab221c015d360ebc6bed3b1aa0c38aa48ef4511.

Restored phase equals prepared bytes; final cleanup equals the original source hash. The fixed case catalog supplies every exact before/after anchor.

### checklist-late-failure

After the unchanged generated walk, complete that controlled rejection before starting settled. The fault deletes the completed record when the call finishes. The failure must still reach the later waiter. This is separate from an in-flight failure.

Selected law: L13: notices name their process successive sends land and a client joining after the first send opens the current checklist.

Expected closed diagnostic: AssertionError: alarm failure reaches the completion waiter. Predicted matcher frame 810:91. This is not an observed failure.

Prepared SHA256: 2fd6f3e43846951664bdd7ef40842ac2674f1cfce42b5e865183c06f7e11eaa3.

Broken SHA256: e6c92f5b5b8c9e73ff84755939aa80a22fee87f95b1569994820b2925b43ccc9.

Restored phase equals prepared bytes; final cleanup equals the original source hash. The fixed case catalog supplies every exact before/after anchor.

## One due callback through the check

A generated add still calls process.send with the original input and expects acceptance. Its first real alarm stamps the item and publishes. The fixed probe rearms the same storage adapter at0 after that real call returns. Its second callback signals entry and waits on release. The concurrent settled operation must not have completed. The deliberate fault returns after batch1, so second entry exposes the early exit without a guessed delay. Scope releases and awaits the actual call through independent return records before runtime/database disposal.

## Laws and reach

| Law | Kind | Generator | Plant |
|---|---|---|---|
| Existing forwarding property with independent oracle,100 runs | test | fc.array: existing move/pick/name records,seed119120,1..12moves | body and dropped-notify edits |
| Existing successive-sends property with temporary boundary probes,100 runs | test | fc.uniqueArray: existing name generator,2..5names,seed119120,pinned milk/bread | early-complete,held-call,due-reschedule,replacement/failure cases |
| Closed runner rejects missing/changed snapshots and invalid phase evidence | test | Effect Arbitrary: Request | Extend existing runner laws with finite prepared-image and cleanup failures |

These are behavioral tests. No new property runner or source test module. Broken generation can fail/shrink before100evaluations; do not invent a completed-case count. Existing fast10/full100, all inputs, coverage checks and60000ms limit remain.

## Allowed metadata

Keep existing request/source/runner/run/attempt, selected title/file, phase exit/status, framework counts/suite counts, law duration and process elapsed time, closed diagnostic and positive line/column, original mode/head/index, originalHash/editedHash/diffHash and cleanup fields. Add preparedHash and actual observed baseline/broken/restored byte hashes. Final cleanup must report the original hash. Compute these during the attempt; a planned hash is not an observed hash.

New diagnostics are only the finite list in the vectors. For drop-notify, allow the existing custom nonempty-view message, or a terminal numeric toBe/Object.is count mismatch at the exact count-comparison frame. Normalize the latter to the fixed count diagnostic. Reject equal counts, generic AssertionError elsewhere, title text inside another error, missing frames, and generic fast-check wrapper messages.

No raw messages/stacks, generated inputs, item names, runner-machine paths, environment/configuration/keys or arbitrary probe objects in public results. Omit existing caller account data from public receipts. Raw child content follows the current private lifecycle. If generator/callback counters are not exposed, record null rather than infer them. Full-depth mode is not a measured completed-case count for a failing/shrinking phase.

## Files and owner

All named paths are exam paths; step ownership is tests. The existing host builder executes that authorized tests/tooling repair after whole lead review. This writer edits none of them. Temporary source probes are confined to the disposable checkout and are never committed as product or checklist-test changes.

| File | Change | Owner | Product lines expected |
|---|---|---|---|
| .github/ci/plant-cases.ts | Closed cases,selectors,literal preparation/fault spans and hashes | tests |0 |
| .github/ci/plant.ts | Prepared phase bytes with original snapshot/final cleanup and observed hashes | tests |0 |
| .github/ci/plant-errors.ts | Finite diagnostics and exact causal frame rules | tests |0 |
| .github/ci/plant.test.ts | Existing runner laws for prepared phases and rejected evidence | tests | tests |
| .github/ci/plant-reporter.integration.test.ts | Real reporter compatibility on disposable CI | tests | tests |
| .github/workflows/plant.yaml | Closed case choices only; unchanged limits/trust split | tests |0 |
| .github/ci/workflow-lint/plant.ts | Same finite seven-to-sixteen case choices only | tests |0 |
| .github/ci/workflow-lint/plant.test.ts | Preserve the same choices and all rejected-policy checks | tests | tests |
| next/apps/fabrika/src/checklist-instance.laws.integration.test.ts | Fixed probes/faults in disposable source copy only | tests |0committed |

## Three-phase commands and limits

The existing adapter runs the same child command in each phase, with the phase's fixed byte image and a separate scoped report:

~~~text
baseline: original -> prepared; selected existing property must PASS
broken: prepared -> fixed fault; same property must give intended causal assertion RED
restored: broken -> prepared; same property must PASS
final cleanup: prepared -> original; original full snapshot must match
~~~

~~~sh
nice -n 19 pnpm exec vitest run --project next-integration --maxWorkers=1 --fileParallelism=false --reporter=TRUSTED_PLANT_REPORTER --outputFile.json=SCOPED_PHASE_REPORT next/apps/fabrika/src/checklist-instance.laws.integration.test.ts -t FIXED_ESCAPED_SELECTOR
~~~

The uppercase words denote values already chosen by trusted argv code, not new workflow inputs. Exact file/title/selector are in each vector. Body/drop use the forwarding property; the other seven cases use successive sends. Each phase retains full depth,seed119120,100runs/fast10,original name/move limits,mandatory example and60000ms test timeout. Keep the existing17minute exercise-step and20minute job bounds. No new timer,hook,process kind,laptop approval marker or raised timeout.

After whole amendment approval and reviewed runner changes land on trusted main, the lead can use the following exact dispatches, one at a time under existing shared slots. Do not run them as a batch or create a dispatcher loop. This writer executed none.


    gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-body -f sha=27039e9455026f37327259a5411260cb4d441ba8

    gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-drop-notify -f sha=27039e9455026f37327259a5411260cb4d441ba8

    gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-early-complete -f sha=27039e9455026f37327259a5411260cb4d441ba8

    gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-held-call -f sha=27039e9455026f37327259a5411260cb4d441ba8

    gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-due-reschedule -f sha=27039e9455026f37327259a5411260cb4d441ba8

    gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-running-replace -f sha=27039e9455026f37327259a5411260cb4d441ba8

    gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-running-delete -f sha=27039e9455026f37327259a5411260cb4d441ba8

    gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-alarm-failure -f sha=27039e9455026f37327259a5411260cb4d441ba8

    gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-late-failure -f sha=27039e9455026f37327259a5411260cb4d441ba8


At planning time the merged9a748e3c runner did not advertise these case names or neutral preparation. That older runner refuses these requests. The host builder owns the extension; no duplicate runner work or new infrastructure.

## Validation

This read-only writer ran no law, plant, compiler, install, full lint, API call, CI dispatch or waiting job. It rendered fixed strings, checked each unique span, calculated hashes, preserved generation controls and parsed18images as text. Only plan draft/owner/leak checks remain permitted.

The host builder must verify the proposed fixed preparation/phase/final-cleanup behavior with existing narrow runner laws, preserve rejected-evidence coverage, and verify real reporter compatibility on eligible CI. A type/API/format change to a vector returns for whole lead read. The predicted red is unproved until the actual causal assertion appears. A baseline failure, a different assertion, timeout, broken pass or incomplete restoration is not accepted.

No broadening of the unknown exit: absent source versions, hashes, anchors, selected test or causal witness means incomplete and a concrete reason. A passing normal branch run or PID triplet does not waive another group. Separate fresh whole-diff product review follows required fault evidence. Root/merger own readiness and landing.

## What this cannot tell us

Prepared probes themselves have not run or typechecked. Their frames are predictions from exact unformatted bytes. Syntax checks cannot establish runtime scheduling, error wrapping, resource release or the actual stack frame. A phase might expose a probe setup error or exceed the unchanged60s limit; stop that case and report it without raising bounds or counting it as red proof.

The independent returned cells protect cleanup even when work.done is deliberately completed early. No claim is made that every possible resource fault is covered by these finite cases. Actual prices/models/tokens/case counts/callback counts remain null unless emitted by real proof.

## Records

Record the actual trusted runner/source SHA, case, exact prepared/broken/restored/final-cleanup hashes, selected law outcome, intended diagnostic/frame, phase durations and complete cleanup witness during execution. These facts cannot be recovered from a later green normal run. Missing runtime counters stay null. Planned hashes are separate from observed hashes. Raw generated content remains private and is never a public receipt. This amendment and vectors are planning records only; no execution outcome is recorded as actual.

Calls: fixed neutral preparation 90%, because four groups cannot be proved by the old direct-edit contract; the cost is one explicit prepared byte image per case and stricter cleanup. Independent returned-cell cleanup 90%, because a deliberately premature work.done cannot safely decide resource release; it adds fixed temporary bookkeeping only. Immediate-start child snapshot 85%, grounded in installed Effect4.1.3 implementation; actual dynamic proof remains required, and a timing/setup failure must be incomplete rather than accepted red.

## Size

1. One closed-case extension across six existing tooling/workflow files, about 250 lines plus fixed literal probe text. Temporary images add about90..140lines to one existing test copy and never become product commits. No new source file,interpreter,setting,agent or process kind. Sizing confidence 70%; reuse details belong to the existing host builder after approval.

The final budget line retains the parent's planning allowance, not a new rate or measured spend. Actual incremental models,tokens,dollars and agent time remain unknown/null. This reader authorizes no paid work.

Estimate: 3 steps, $30

## Open questions

None.

The approved scope retains the existing limits. Actual runtime proof, cleanup and the final checklist review remain required.


## Current source amendment, 2026-11-17

### Scope and precedence

The earlier sections remain the historical planning record for source
`27039e9455026f37327259a5411260cb4d441ba8`. This section replaces that source,
its law blob and full-file hashes, all nine prepared/broken image hashes,
all nine expected assertion locations, the two notification fault strings,
the body diagnostic and all nine dispatch source values. The replacements
below govern these nine cases. All other requirements in the earlier plan remain.

This is today's CI tooling for next/ checklist laws. It adds no case, public
request field, matcher rule, runner phase, setting or product change. The nine
catalog records and the exact body Failure literal are the bounded change.
The other seven catalog cases and their behavior remain unchanged.

### Exact current source and complete dependency lock

- Source commit: `a062f7a2515aa1917dfae05d3af95e3705b88812`.
- Actual main used for integration: `bc358e659e0499a4d50d2cc6d2483c36c24ad216`.
- Source parents, in order: `27039e9455026f37327259a5411260cb4d441ba8`,
  `bc358e659e0499a4d50d2cc6d2483c36c24ad216`.
- Source tree: `0f173e9cd69bee2678896aebf3d1150ebd410a02`.
- Law Git blob: `10082e6777e1e5c080d326c930d8d5cbee134b6c`.
- Law full-file SHA256: `08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f`.
- Complete `pnpm-lock.yaml` SHA256 on both source and the integrated main:
  `1800791fae8716cfb063adc7bd50822a0bfe07d7980eb599543e07c948032c95`.

The trusted runner must use the same complete dependency lock as this source.
The earlier complete lock SHA256
`02d1d1c629105e240ea3b473df3dbb0f89874cfaf5f57352c6d8492da133da4c`
differs and cannot establish current dependency equality. Existing complete-lock
checks remain. No source-lock overlay or guard override is added.

The source is the repaired historical completion code plus main's typed News
migration. It keeps `w.settled` and main's typed reader and assertions.
All 29 expect assertions remain. The pid/body checks now use `update.pid`
and `update`; the other 27 assertions are byte-identical to the repaired
historical source. The full six-test file, generators, depth and seed fields,
mandatory milk/bread example and input bounds remain.

| File | Change | Owner | Product lines expected |
|---|---|---|---|
| pnpm-lock.yaml | Read-only complete-file equality check; no dependency edit | tests | 0 |

This read-only row records the lock used by the existing checks. It authorizes
no lock change. The earlier files table still owns the catalog, causal reader,
existing tests and disposable source copies.

### Exact 27 image hashes

These are the full SHA256 values of the nine ORIGINAL, PREPARED and BROKEN images.
PREPARED is the baseline image. BROKEN applies the one existing fault to it.
For every row, the restored phase equals PREPARED and final cleanup equals ORIGINAL.
These planned values must still be checked against bytes actually observed in each run.

| Case | ORIGINAL SHA256 | PREPARED SHA256 | BROKEN SHA256 |
|---|---|---|---|
| checklist-body | `08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f` | `08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f` | `061a14624cb441a033477a741668f2e46d8d87ab64ff670b3bfa486f9564c8ee` |
| checklist-drop-notify | `08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f` | `08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f` | `d95cdb439345596c7f54d64d469e71f95c51761fd832685da47f74496e18421d` |
| checklist-early-complete | `08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f` | `d097eed69883a94ee40d8824e84844567672012f97a6e3e71001167c3ed45336` | `5a166e8c8fc6b26afa845cc793052ac228037237c557a1c01a662bbfb116db15` |
| checklist-held-call | `08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f` | `5ab79a9bd1333b20874fcfd26659f7fbb4c1d799fac4a441b78b2b2a9cf79087` | `ea0866f9735cb11103994209e889f2a5e23cb57ecb7d6ff28711d589f4aa24ef` |
| checklist-due-reschedule | `08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f` | `15a20a30009ce885e2fce5b77164a70dde147c44286ecefb7bf7a13abda32852` | `4ce6941d2ad4b4780a411b994b63f4a078052b9bca5ac9e0a225b2f521a1eeda` |
| checklist-running-replace | `08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f` | `a7a798a65be92dabc32d25540c0b9fd6ef4b328a4bb0c7af5d53669e47fde6a5` | `84c27c3333f5eeb55c26c33219671a09008dc0abee7d7797245997872305facf` |
| checklist-running-delete | `08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f` | `e82cf996bf5a94d236f5c3022e0e3ee02748a427946fd6ea3817455ddbf9c678` | `13c9dae45705b697abede18a004fc6656235918bd9198b6c665b4b5da016c09b` |
| checklist-alarm-failure | `08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f` | `ea8d42e1ae68ac5f544227f17c5c29ea7a4e009e29936308d6963e61ff3ed073` | `c976a384dc41751fc74e96f21b588314333033e1cb03618d23de85405378ef9a` |
| checklist-late-failure | `08a5cfd7af599b98e3a68c887328f5d2462f455c9e19aefe2258e5766a03f50f` | `a0a10cef5b8e134ea8a2b87f89930e2f58b715fdac29bdc1b25e30574d77bf3c` | `5b43a4afb1e77c9f783623dbe1ca34526f419a477da4cf15e17255d035d0ed27` |

### Exact predicted causal assertions

These locations replace every old frame for these nine cases. All are predictions
from the exact new broken bytes. An actual eligible run must confirm the matching
causal AssertionError, with the existing whole strict schema and frame checks.

| Case | Closed diagnostic | Predicted line:column |
|---|---|---|
| checklist-body | `AssertionError: the update its Process published reached the client unchanged` | `830:99` |
| checklist-drop-notify | `AssertionError: the client heard the checklist's views` | `828:80` |
| checklist-drop-notify | `AssertionError: checklist notice count differs` | `829:38` |
| checklist-early-complete | `AssertionError: alarm completion waits for the real callback` | `769:107` |
| checklist-held-call | `AssertionError: settled stays pending while the callback is held` | `770:98` |
| checklist-due-reschedule | `AssertionError: settled includes the rescheduled due callback` | `776:95` |
| checklist-running-replace | `AssertionError: canceling a schedule keeps the running call pending` | `776:114` |
| checklist-running-delete | `AssertionError: canceling a schedule keeps the running call pending` | `776:114` |
| checklist-alarm-failure | `AssertionError: alarm failure reaches the completion waiter` | `800:91` |
| checklist-late-failure | `AssertionError: alarm failure reaches the completion waiter` | `800:91` |

The drop-notify count route still requires the existing terminal numeric
strictEqual/Object.is mismatch with unequal finite nonnegative counts at its
exact frame. Equal counts, unrelated assertions, generic property wrappers,
missing frames and changed locations remain refused.

### Exact typed News fault replacements

Both notification cases keep this unique anchor:

~~~ts
              heard.push({ client, news: structuredClone(news) });
~~~

For checklist-body, replace that anchor with these exact bytes:

~~~ts
              const delivered = News.guards.view(news) ? { ...news, update: { ...news.update, rev: -1 } } : news;
              heard.push({ client, news: structuredClone(delivered) });
~~~

Only the delivered revision is corrupted. The independently recorded Process
publication remains unchanged. This replaces the old Notice/params fault with
the current typed News/update fault.

For checklist-drop-notify, replace the same anchor with these exact bytes:

~~~ts
              if (News.guards.view(news) && published.filter((h) => Schema.is(Published)(h.news)).length === 1) {
                return;
              }

              heard.push({ client, news: structuredClone(news) });
~~~

This still omits only the first matching view delivery. Later deliveries append
normally. `News.guards.view` and `Schema.is(Published)` follow the typed reader
already on main. The source law itself is unchanged by either catalog fault.

In `.github/ci/plant-errors.ts`, the Failure diagnostic literal is exactly:

~~~text
AssertionError: the update its Process published reached the client unchanged
~~~

That one literal replaces the historical
`AssertionError: the update reached the client unchanged`.
The whole strict Failure validation remains. No generalized message match,
additional accepted diagnostic or fallback is introduced.

### Preserved probes, cases and execution contract

All ordered neutral preparation strings and all seven alarm fault mappings remain
byte-identical to their existing records. The seven alarm cases are early-complete,
held-call, due-reschedule, running-replace, running-delete, alarm-failure and
late-failure, each with its existing checklist- prefix.

The other seven catalog records remain byte-identical: checklist-pid, watcher-r1,
host-pin, host-discovery-timeout, host-requested-pin, host-pnpm-path and host-env-order.
The catalog remains 16 cases in the same order. No L3 construction is included.

The same phases and safeguards remain: exact source/head/index/mode/inventory,
unique anchors, checked image hashes, prepared baseline PASS, one intended causal
broken RED, prepared restored PASS and ORIGINAL final cleanup. An unrelated
failure, timeout, setup error, broken PASS, skipped selected law, incomplete cleanup
or absent result remains incomplete evidence. Temporary probe scope still releases
its gate and awaits independent callback-return records before disposal.

Retain full 100 and fast 10 runs for the selected source laws, seed 119120,
all generated walks and siblings, every original assertion and input bound,
the mandatory example, fixed selectors, one worker, no file parallelism,
the shared 60000 ms test limit, 17-minute exercise step and 20-minute job limit.
There is no new timer, wait, polling loop, retry rule or relaxed count.
The existing pure tests and real reporter fixture read their matching diagnostic
and position expectations from the catalog. Their source needs no edit for these
fixed values. Real reporter compatibility still requires eligible disposable CI.

### Historical receipts and current proof

The historical body run
https://github.com/kamp-us/tea-fabrika/actions/runs/44085847607
used the historical source and recorded baseline PASS, intended body RED at840:91 and restored PASS.
The historical drop-notify run
https://github.com/kamp-us/tea-fabrika/actions/runs/44088724095
used the historical source and recorded baseline PASS, intended count RED at838:38 and restored PASS.
Both receipts remain unchanged and earn no current-source credit. The historical
PID receipt remains separate and is not one of this nine-case repin.

The old full-file proof
https://github.com/kamp-us/tea-fabrika/actions/runs/44021915255
passed six laws at the historical source. Its product tree and complete dependency lock differ
from this integrated source. It does not prove the current six-test file or graph.
Fresh product review, applicable branch proof and actual main-full results remain required.

Syntax parsing of 27 images and the passing pure checks do not prove typed fault
compilation, actual causal frames, runtime scheduling or resource release. They do
not replace the current-source full-file proof, real reporter fixture or nine actual
fault triplets. No new current-source runtime outcome is claimed in this amendment.

### Current dispatch values

These commands replace the nine historical source commands above. They describe
separate serial runs, not a batch or loop. Publication of the exact source and reviewed
catalog on trusted main must complete before dispatch. The lead owns dispatch under the
existing shared slots and records actual per-phase hashes, outcomes and cleanup.
This draft executes none of these commands.

~~~sh
gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-body -f sha=a062f7a2515aa1917dfae05d3af95e3705b88812

gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-drop-notify -f sha=a062f7a2515aa1917dfae05d3af95e3705b88812

gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-early-complete -f sha=a062f7a2515aa1917dfae05d3af95e3705b88812

gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-held-call -f sha=a062f7a2515aa1917dfae05d3af95e3705b88812

gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-due-reschedule -f sha=a062f7a2515aa1917dfae05d3af95e3705b88812

gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-running-replace -f sha=a062f7a2515aa1917dfae05d3af95e3705b88812

gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-running-delete -f sha=a062f7a2515aa1917dfae05d3af95e3705b88812

gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-alarm-failure -f sha=a062f7a2515aa1917dfae05d3af95e3705b88812

gh workflow run plant.yaml --repo kamp-us/tea-fabrika --ref main -f case=checklist-late-failure -f sha=a062f7a2515aa1917dfae05d3af95e3705b88812
~~~

No historical runner or previous source receipt can stand in for those runs.
Keep planned hashes separate from observed hashes, raw generated content private,
and missing counters null. No new policy, permission, budget or infrastructure
is introduced. The earlier estimate stays a historical planning allowance.

### Current amendment open questions

None.
