Approved by the lead agent, builds 0036, 0052, 0061, 0093, 0069; body 4f0d3db59859
Plancheck-Version: 3
# Checklist L13 waits for completion, next/

```text
process.send answer
  -> existing due alarm callback finishes its real Process call
  -> awaited Project.publish and Connection.notify finish
  -> compare the Process updates with the client's notices
```

## Result and evidence

Repair next/'s checklist L13 timeout by replacing the fixed waits with completion of the work the fixture already starts. Product code stays as built.

Verified main `55ae19989916bacf063c1e418f72869fe1891957` and [tests 1, job 133777095156](https://github.com/kamp-us/tea-fabrika/actions/runs/44004679465/job/133777095156). The law at line 671, `each view.whole and view.patch for checklist:1 carries its pid and the update its Process published`, ended after 60004 ms with `Test timed out in 60000ms`. Its sibling late-subscriber law passed in 50369 ms. This plan ran neither law.

The fixture's `settle` waits 50 ms after each move and once after each case. At 100 full-depth cases and a maximum of 12 moves, the permitted waits alone total 65 seconds. A coordinator's separate generator sample counted 596 moves, or 34.8 seconds of waits. That sample is a lead, not a replay of the failed property or proof that product behavior is correct. Boot, signatures, routing and cleanup also cost time.

## How others do it

Elm keeps effects in the runtime and delivers their answers to the program. Its [commands and subscriptions guide](https://guide.elm-lang.org/effects/) is the first answer here: keep the checklist reducer pure and observe the runtime work finishing. No tea or program change is needed.

Erlang's [receive expression](https://www.erlang.org/doc/system/expressions.html#receive) waits for a matching message. The relevant property is causal completion, rather than a guessed elapsed delay. We need no mailbox implementation for this fixture.

Effect 4.1.3 already provides `Deferred.make`, `Deferred.await` and `Deferred.complete` for one result awaited by another task. Their installed source is `node_modules/effect/src/Deferred.ts`, read alongside the installed Effect instructions. Use those operations to observe the existing alarm callback. Keep its Promise boundary at the existing platform adapter.

Vitest's [waitFor reference](https://vitest.dev/api/vi.html#vi-waitfor), checked against the installed 5.0.5 declarations, provides assertion polling. It defaults to a 50 ms interval. Merely replacing every sleep with that default can preserve much of the same cost, and equal notice counts can pass before a queued alarm starts. Await the real work instead.

Installed versions read: Effect 4.1.3, tea 0.27.0, Vitest 5.0.5 and fast-check 4.10.2. The workspace catalog and installed package metadata agree. The root lock currently holds the pnpm 12.16.1 launcher rather than the workspace dependency resolutions. Existing Effect and tea patches remain untouched.

## Settled rules and calls

Decisions 0036 and 0052 require removing the source of a flaky wait. Decisions 0061 and 0093 require scoped resources and a recorded red plant. Decision 0069 adds no setting here: completion is a correctness condition, and no person would configure it. Keep the current test-depth settings and the 60000 ms test limit.

The searches were `records.ts find` with `checklist view pid update timeout`, `checklist completion sleep`, and `property integration readiness`, followed by local searches of decisions, glossary, direction notes, experiments, plan rows and test helpers. Read the P14/P44 rows, the property-test rules, the Elm-first note and decisions 0584, 0590 and 0177.

- Await due and running alarms, including immediate alarms they schedule before finishing. Exclude a future alarm, such as tomorrow's late-item wake. Confidence 90%. This directly removes fixed waiting, but cancellation and rescheduling must be checked carefully.
- Keep both L13 laws on one fixture and replace all three uses of `settle`. Confidence 95%. The first law checks that the immediate wake stamps an item before the next send; changing only the timed-out law would leave the same guessed wait next door.
- Keep the present filename in this bounded repair. Confidence 90%. The code it actually runs is an in-memory fixture, not a real-instance or host-only law under 0584. The separate test-classification plan already owns its naming sweep. This repair must not race that work or change routing rules. Its existing integration filename still requires remote proof under the current guard.

No owner decision is needed. No law is weakened.

## Existing tools

For the new private completion helper inside `next/apps/fabrika/src/checklist-instance.laws.integration.test.ts`, searched the app's test support, checklist tests, `@kampus/vitest` Recorder and the installed Effect Deferred source. Recorder records calls at their start, not completion, so it cannot by itself prove that an alarm or delivery finished. Deferred is the existing waiting tool. No package or new helper file is needed.

The fixture already owns its alarm timers through `world` and its release. Extend those existing callbacks with completion records. Add no timer, interval, hook, schedule or timeout. Do not replace a real Process call with a canned result.

## Shape

Sketch only, private test support rather than a product API:

```ts
type AlarmWork = {
  readonly at: number;
  readonly done: Deferred.Deferred<void, unknown>;
};

// A scoped world's operation. It awaits due callbacks and calls already in flight.
// It rechecks after completion because that call may have scheduled another due wake.
declare const settled: Effect.Effect<void, unknown>;
```

Each scheduled alarm has its own completion record. Retain the scheduled record until its existing timer starts, then retain the running record until `entry.object.call("alarm", [])` finishes. A timer being replaced or deleted completes only the canceled scheduled record. It must never complete an already running call's record. A completion wait must re-read due scheduled and running records after each awaited batch.

Propagate the alarm call's failure to its completion record. The current empty catch cannot count as successful completion. On scope release, clear pending timers through the existing cleanup and await started calls before disposing their runtimes and databases. A waiter interrupted by the test ending releases through that same scope. An unresolved callback remains a test failure under the existing test limit.

Do not use a repeated yield count, stable-for-N-polls rule, fake time, a smaller sleep, or a larger timeout. Do not use notice equality as the completion condition. Both arrays can still be empty, and a dropped notice must remain detectable.

The real runner already awaits watcher publishing during a turn. The Project's publication adapter awaits `notify`, whose fixture implementation appends to `heard`. Therefore the completion record covers the whole alarm call, not only the moment a Process announces a publication. Keep the final independent notice-count, pid, update-body and coverage assertions.

The test support stays beside the app wiring it checks. A from-scratch libfabrika client does not need this fixture, so no file moves into the library.

## One value through the code

1. A generated move adds `milk` to the checklist through `process.send`. Keep the existing accepted/refused answer handling and independent item map.
2. The real runner publishes the changed view and asks the fixture for an immediate alarm. The existing timer owns a completion record before it can fire.
3. `settled` waits for that timer's real `alarm` call. The runner folds its timer letter, stamps `milk` open and awaits its publications through Project and Connection.
4. The alarm records completion. If it scheduled another due alarm, await that one too. Tomorrow's scheduled wake does not keep this case alive.
5. The next generated move runs. At the end, compare every heard notice with every recorded Process publication in order. A missing pid, changed body or dropped notice still fails.

## Laws

| Law | Kind | Generator | Plant |
|---|---|---|---|
| Existing L13 forwarding property keeps every update, pid and order. Keep full 100 runs, fast 10 runs, seed 119120 and move lengths 1 through 12. Keep patch, array-operation and refusal coverage. | test | fc.array: the existing move/pick/name records, unchanged | Remove pid at the real watcher-to-Project adapter, then separately alter an update body or drop one notify. Each break must make L13 red. Restore every plant. |
| Existing L13 successive sends and late open see the current list and a fresh item in open state. Keep full 100 runs, fast 10 runs, unique-name limits and the pinned milk/bread example. | test | fc.uniqueArray: the existing name generator, unchanged | Complete the fixture's alarm record before its Process call runs while a Deferred holds that call. The immediate-state assertion must fail or the test must remain blocked until release. Restore the plant. |
| Completion follows the callback's actual finish, includes a due reschedule and leaves a future alarm pending without waiting a day. Exercise via both existing generated walks; add assertions at their existing boundaries rather than a shape test. | test | fc.array: existing walks, full 100 runs and fast 10 runs | Hold an alarm with Deferred and prove settled cannot finish; release it and prove it can. Separately complete only the first record when a due wake is rescheduled. Record the wrong early return as red. |

These are behavioral checks, so they are tests rather than lint or type checks. The test writer owns the file and the precise generated probes. Run each plant once and record what failed. A timing-only red caused by a held plant is recorded as such, never called proof of the original CI failure.

## Files

| File | Change | Owner | Product lines expected |
|---|---|---|---|
| `next/apps/fabrika/src/checklist-instance.laws.integration.test.ts` | Observe completion in the existing scoped alarm fixture; replace fixed waits in both L13 laws; preserve every existing assertion and generator | tests | tests |

No product change is planned. The build step reads the test writer's result and checks that the fixture still calls the existing real Project/Process/runner path. Any demonstrated product bug returns to the lead for a plan amendment, rather than widening this repair silently.

## Validation

This plan step ran no test, plant, install, lint, format or typecheck. Only read-only evidence checks and draft format/leak checks are allowed here.

After approval, the test writer runs formatting first, lint, then this file at full depth and each listed plant. Because the current filename is guarded, use an eligible existing remote branch-proof run, `scheduled.yaml`, and keep the proof-set artifact and exact tested SHA. Do not set CI, cloud or owner-approval markers on the laptop. The underlying fixture needs no launchd, Electron, signal or real-instance proof, so host.yaml is unnecessary for these laws. If the independent classification work renames this file first, adapt its path and run ordinary safe checks directly at nice 19 and one worker.

The lead runs the changed set once and one global typecheck after coordinating with other lanes. No full local suite. Review requires the real L13 result at full 100 cases, the sibling L13 result, L21 results because the shared fixture changed, exact durations, plant outcomes and the removed/replacement mapping. Keep timeout 60000 ms, seed, generator limits and coverage assertions byte-for-byte where possible. The reviewer must reject an early-completion shortcut even if the run is green.

## Records

Record baseline and repaired durations, actual cases/moves, callback completions, plants and exact heads in the step report. These timings and completion order are lost unless recorded during proof; they cannot be recovered from a later green check. Keep raw proof logs private and put only non-sensitive results in field rows. No input content, key material, account names or local machine paths belong in public text.

The observed timeout already has a field record, so this lane must not duplicate that row.

## What this cannot tell us

No local reproduction was run. The fixed sleeps are proven source cost, while their part in the failed CI run is still an inference. Full-depth proof must show the repaired law completes within its unchanged limit. A green run cannot by itself prove correct causal waiting; the held-alarm and dropped-notice plants are required.

The older classification plan labels this file as network-backed based on imported helper modules. Here only `settingsFixture` and `fcExitReason` are used. `settingsFixture` hashes an in-memory settings envelope; the Process test helper creates its temp folder only when `storage()` is called, and this fixture never calls it. No port helper or recordWire instance is invoked. This distinction is evidence for the naming sweep, not permission to bypass the current test guard.

## Size

1. One test-only repair, about 90 lines changed in one file, zero product lines and about half to one agent hour. Confidence 75%. Most uncertainty is callback cancellation and rescheduling.

Expect three subsequent steps: tests, build read with no product edit, and fresh review. Comparable test runs in field/runs on 2026-11-16 took 30 to 50 minutes but recorded no token or dollar data. The $30 below is a budget estimate, not measured spend or a provider-price claim. The lead must price the chosen models when assigning the steps; this brief names no model or rate.

Estimate: 3 steps, $30

## Ready tracker ticket

Filed as tracker ticket 1126, separate from ticket 1080. The ready title and body follow.

Title: next/: checklist L13 times out while waiting a fixed 50 ms after every move

Body:

The full run at main 55ae19989916bacf063c1e418f72869fe1891957 failed checklist L13 at its 60000 ms limit. Proof: https://github.com/kamp-us/tea-fabrika/actions/runs/44004679465/job/133777095156 . The failing law is at line 671 of next/apps/fabrika/src/checklist-instance.laws.integration.test.ts.

The fixture waits 50 ms after each generated move and once after each case. With 100 cases and up to 12 moves, allowed waits alone can exceed the test limit. This is a timing lead, not a reproduced product cause.

Replace those fixed waits with actual completion of the fixture's existing due alarms and their deliveries. Keep both L13 laws, full 100 cases, seed 119120, maxLength 12, every assertion and coverage check, and the existing timeout. Propagate completion failures and keep cleanup scoped. Do not change product behavior or weaken gates. The test writer owns the repair; fresh build and review steps follow. Use the eligible remote proof workflow while the filename remains guarded.

## Open questions

None.
