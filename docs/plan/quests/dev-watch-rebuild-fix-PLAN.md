Approved by the lead agent, builds 0036, 0045, 0178, 0291, 0292, 0536, 0581, 0590; body adbb966cf5cc
Plancheck-Version: 3

# Save-driven dev rebuilds receive the current reply

This plan covers `next/` only. Tracker ticket 1122.

```ts
// Sketch. Check every reply. Finish a save only on its changed result.
same(previousHash); // Record and check this duplicate.
loaded(currentHash); // This completes the good save.
failed("bundle"); // This completes a distinct broken save.

// One deadline covers the whole wait. Duplicate replies never reset it.
```

## What the source shows

Base read: `e6d8f36d4702825c1ffe152141a616e4e90cec3c`. Local `main` and `origin/main` name that commit.

The reported failure is [PR 1525](https://github.com/kamp-us/tea-fabrika/pull/1525), [proof run 43847603869](https://github.com/kamp-us/tea-fabrika/actions/runs/43847603869), tests shard 2/5. The brief reports L17/L18 at line 479, seed `119120`, path `17`, expected `loaded`, received `same`.

The lead verified that proof run 43847603869 failed at commit `e7129ea7be703db4288129641adcb49314a3eed3`.

The local worktree named for PR 1525 points to `fabrikalfa/antislop-mechanical-1366`, commit `e7129ea7be703db4288129641adcb49314a3eed3`. Reading its Git tree and main's tree gives identical blobs:

- `watch.ts`: `ac194a337ffac4f9591f3a188675b02839f5a402`.
- `watch.laws.integration.test.ts`: `930dc93ea6c139c300dc46981dc78f3b5096e911`.

This verifies source equality with that local branch. It does not establish the failing run's exact head.

In `next/packages/libfabrika/src/node/dev/watch.ts`:

1. Rolldown events enter a queue.
2. Each group ending at `END` runs `buildPrograms` against the current inputs.
3. Repeated failed inputs produce a completed `same` span and no reply.
4. A successful build calls `install`. The watcher forwards its `loaded`, `same` or `failed` answer, adding the program and hash.
5. Each acquired Rolldown result and watcher has scoped cleanup.

The law's brain double answers `same` when it already holds the requested hash. That matches the product contract in `runtime/Code.ts`.

The save-driven law takes the next queued answer after writing a file. It then drains replies until 300 ms passes without one. That quiet period cannot prove that another duplicate will never arrive. The first save also follows the initial answer without such a drain.

The law also assigns spans to saves using the array length before each write. A rebuild that starts before that point and ends afterward can cross that boundary.

**Call, 95% confidence:** repair the law's reply and span accounting. The source proves that its positional assumption is invalid. The exact schedule behind the reported CI failure still needs a controlled reproduction. No product defect is proven.

The cost is more explicit test bookkeeping. Product behavior stays governed by the existing contract. If the controlled test exposes a product fault, return to this plan with the failing trace before changing product code.

## Settled rules and existing evidence

Read for this plan:

- Decisions `0036`, `0052`, `0045`, `0178`, `0536`, `0581` and `0590`.
- Hot reload decisions `0291` and `0292`, and `docs/direction/hot-reload.md`.
- `docs/plan/README.md`, Tier 1's P15 row and its detail.
- The existing approved P15 slice 1 plan saved as `p15b-plan.md` beside the checkout. Its contents are evidence, not text to copy into this repository.
- `.patterns/effect-tests-run-in-it-effect.md`, `.patterns/effect-state-and-time.md`, `.patterns/effect-platform-wrapped-once.md` and `.patterns/a-law-watches-calls-with-a-recorder.md`.
- `field/README.md` and the existing findings about repeated watcher notifications.

The P15 plan explicitly permits repeated rebuilds and same-hash answers. It requires no fact, swap or view notice for unchanged code. It also requires rebuild spans and cleanup of every watcher and result.

The existing finding `field/findings/2026-11-13-watch-law-saw-two-rebuilds-for-one-save.json` records a prior failure caused by assuming one rebuild per save. That supports testing duplicate delivery. It does not prove this failure's cause.

The record-search CLI failed because it first fetches into the checkout. Its exported `readEntries`, `find` and `foundLines` functions were then used without fetching, over tracked records from the local `origin/main` file list. Searches covered save/rebuild replies, duplicate notifications and event waits. Local text searches covered the plan, direction notes, glossary, patterns and experiments.

## How others do it

**Elm first.** Commands produce messages, and `update` handles those messages explicitly. The test should examine every answer it receives. It should not infer which request an answer belongs to from elapsed quiet time. The message-handling model is documented in the [Elm guide](https://guide.elm-lang.org/effects/http.html).

**Erlang/OTP.** `receive` selects messages by matching their contents. Request/reply protocols use identity to distinguish replies. Here, successful watcher replies already carry the program and content hash. No new product request identifier is needed. See [Erlang expressions, receive](https://www.erlang.org/doc/system/expressions.html#receive) and the repository's `docs/direction/follows/otp.md`.

**Rolldown.** The installed 1.2.13 declarations describe rebuild cycles and require closing `BUNDLE_END` and `ERROR` results. They offer no guarantee of exactly one cycle per save. Their `buildDelay` documentation also describes file-event coalescing. Keep the real watcher and result objects.

**Effect.** The installed source provides `Queue`, `Deferred`, scoped fibers and explicit span completion through `Tracer.Span.end`. These cover reply delivery, controlled delay and completion waits. Use them instead of a new polling or retry tool.

The lockfile pins Effect and `@effect/vitest` 4.1.3, tea 0.27.0, Rolldown 1.2.13, fast-check 4.10.2 and Vitest 5.0.5. Effect's existing patch changes arbitrary shrinking. This plan adds no dependency or package patch. The installed Effect `AGENTS.md` was read.

## The change

The tests step owns the law repair.

1. Type the save-driven answer queue from `watchPrograms`, replacing `unknown`.
2. Receive every answer in order. Match its tagged case explicitly.
3. Check every `same` reply against the program and a hash already established by a successful load. Retain it for span and privacy checks.
4. Complete a save only on its required changed answer. A good edit requires `loaded` with changed bytes. A syntax edit requires `failed` with reason `bundle`.
5. Keep one three-second deadline around the whole receive operation. A duplicate never restarts that deadline.
6. Record completed rebuild spans by identity and completion, rather than assigning them through array positions captured before a save.
7. Keep one complete history for the case. Its changed replies, changed spans, failure facts and generated edits must agree exactly.

Do not turn this into a loop that discards replies until an assertion passes. An unexpected changed reply, wrong program, wrong hash or extra failure fails immediately.

For successful edits, check the corresponding install's source against the generated module value and its hash. The fixture already keeps that value in observable bundle code. A stale successful build must fail even if its answer says `loaded`.

For syntax edits, retain the ordered failure facts, their reason and relative location. Distinct broken inputs must each produce their required failure. Unchanged failed inputs remain suppressed.

Use completion notifications from the test tracer to await the relevant ended spans. Keep the existing checks on program, bytes, duration and outcome. At the end of the scoped case, account for every normally completed rebuild. The existing interruption law continues to cover interrupted cleanup.

Sketch of the types, not a new public API:

```ts
type Reply = Stream.Success<ReturnType<typeof watchPrograms>>;
type Install = Parameters<Parameters<typeof watchPrograms>[0]["install"]>[0];

const Edit = Schema.TaggedUnion({
  edit: { value: Schema.Int },
  syntax: { value: Schema.Int, secret: Schema.String },
  fix: { value: Schema.Int },
});

// The existing state-dependent generator chooses moves from the reached state.
// All replies and completed spans remain available to the final assertions.
```

The real-resource law keeps its existing state-dependent generation, edit range, seed and `runsFor({ fast: 3, full: 20 })`. This quest does not migrate the folder's property runner or seed setup.

No product state, schema, protocol, setting or record changes. The watcher belongs in libfabrika because any client needs it. This fix stays beside that watcher's law.

## Controlled reproduction

Extend the existing real-Rolldown wrapper and stream consumer. Do not replace Rolldown or fabricate an install answer.

1. Finish the initial good build or a good generated save.
2. Use the existing repeat mechanism to trigger an unchanged rebuild.
3. When the real stream produces its `same` answer, hold its delivery to the law's answer queue with a `Deferred`.
4. Write the next distinct edit.
5. Release the held answer before the current save's answer.
6. Show that the old next-answer assertion fails on that ordering.
7. Show that the repaired law checks the duplicate and then receives the current changed result.

The gate determines the ordering. No sleep chooses it.

Exercise a duplicate from the initial build and one from a preceding save. Include delivery before both a good edit and a syntax edit. Release all gates through scoped cleanup, including when an assertion fails.

**Call, 90% confidence:** this controlled ordering is the right regression. It uses an answer the real product produced and isolates the law's assumption. It proves the handling of that ordering, not that CI used exactly that ordering.

## One value traced through

1. The fixture loads value `4`, giving hash `A`.
2. A repeated notification rebuilds unchanged bytes and produces `same` for `A`.
3. The test holds that reply before queue delivery.
4. The law writes value `9`.
5. The held `same(A)` reaches the queue first. The law checks and records it.
6. The real watcher builds value `9`, installs hash `B` and returns `loaded(B)`.
7. The law checks `B != A`, the installed source's value, and the matching ended rebuild span.
8. The complete history contains one changed result for the edit. Every additional result and span is checked as a duplicate.

If step 6 never happens, the original three-second bound fails the law.

## Laws

All rows are runtime tests. They concern asynchronous behavior, output or resource lifetime, so lint and types cannot establish them.

| Law | Kind | Generator or reason label | Plant that must turn it red |
|---|---|---|---|
| R1. A late duplicate cannot complete the next save; every received reply is checked | test | scenario: hold a real `same` reply with a gate, write the next edit, then release it first | Restore the original next-answer assertion |
| R2. Every distinct generated edit has exactly one required changed reply and changed span; successful source and hash match the edit | test | fc.gen: existing state-dependent walk, 3 runs at fast depth and 20 runs at full depth, preserving the edit bounds | Drop a saved rebuild; return stale successful source; report a changed load as `same` |
| R3. Every normally completed rebuild records its program, bytes, nonnegative duration and correct outcome; duplicates remain visible in the accounting | test | fc.gen: the same walk, 3 runs at fast depth and 20 runs at full depth | Omit a span, duplicate a changed outcome or associate a previous span with the current save |
| R4. Distinct broken saves each write one failure fact; repeated unchanged failures write none; a later fix loads | test | fc.gen: the existing syntax and fix moves, 3 runs at fast depth and 20 runs at full depth | Remove failed-input suppression or suppress a distinct broken input |
| R5. `[secrets]` Replies, failure facts and span attributes contain neither the generated private marker nor the temporary root, including JSON-escaped and URI-encoded forms | test | fc.gen: existing generated marker and edit walk, 3 runs at fast depth and 20 runs at full depth | Copy the source marker or absolute root into each checked output in turn |
| R6. Every acquired watcher and `BUNDLE_END` or `ERROR` result closes on success, failure and interruption | test | fc.gen: retain the existing interruption walk and its depth counts unchanged | Omit result cleanup or watcher cleanup |

Keep the first L17/L18 law's initial bundle failure, Compiler failure, warning and privacy checks. Keep L10's reached-module coverage and the separate interruption law.

These laws remain integration tests. A stand-in cannot establish real file notification delivery, Rolldown rebuild behavior or cleanup of its actual results.

## Existing tools

- `receiveChange`, a test-local helper in `next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts`: searched the dev tests and installed Effect APIs. The existing `drain` waits for quiet; it cannot identify the current save's reply. Reuse `Queue.take`, tagged matching and one outer timeout.
- The completion recorder in that same file: searched the existing tracer and `Tracer.NativeSpan`. Reuse the tracer's actual `end` method and span identity, with a queue notification after completion.
- The controlled delay in that same file: searched the existing `repeat` wrapper and neighboring `Deferred` use. Reuse both. No timer helper or new mock API is needed.
- `Recorder` records service calls. It does not replace the watcher stream or tracer completion callback, so no service or shared test-package helper is added.

No new exported name or code file is planned.

## Settings

This adds no setting.

Reply identity and complete accounting are correctness requirements. A person cannot choose to accept a stale reply. The existing test deadlines and depth setting remain unchanged. Rolldown's delay remains unchanged.

## Files

Read-only rows make ownership explicit. They authorize no edits.

| File | Owner | Product lines expected | Work |
|---|---|---:|---|
| `next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts` | tests | tests | Reproduction, reply accounting, span completion and preserved assertions |
| `next/packages/libfabrika/src/node/dev/watch.ts` | build | 0 | Read-only product contract |
| `next/packages/libfabrika/src/node/dev/internal/watcher.ts` | build | 0 | Read-only phase and failed-input behavior |
| `next/packages/libfabrika/src/node/dev/internal/watcher.test.ts` | tests | 0 | Read-only adjacent machine law |
| `next/packages/libfabrika/src/node/build/build.ts` | build | 0 | Read-only current-input build path |
| `next/packages/libfabrika/src/runtime/Code.ts` | build | 0 | Read-only install contract |
| `vitest.config.ts` | tests | 0 | Read-only runner restrictions |
| `vitest.hostrun.ts` | tests | 0 | Read-only real-resource guard |
| `.github/workflows/scheduled.yaml` | tests | 0 | Read-only branch proof routing |
| `package.json` | tests | 0 | Read-only pinned Node and scripts |
| `pnpm-workspace.yaml` | tests | 0 | Read-only dependency catalog |
| `pnpm-lock.yaml` | tests | 0 | Read-only installed versions |
| `.agents/skills/lead/scripts/loosening.sh` | tests | 0 | Read-only law comparison |
| `docs/plan/quests/dev-watch-rebuild-fix-PLAN.md` | lead | docs | Save, check and sign this plan |
| `docs/plan/README.md` | lead | docs | Record the quest's result |
| `field/runs/` | lead | records | Step results and plant evidence |
| `field/findings/2026-11-16-record-search-needs-write-in-read-only-plan.json` | lead | records | Save the finding below unchanged |

If a product change is needed, amend the plan and file ownership before build starts that change.

## Validation

No validation command runs during this read-only plan step.

The tests and build steps use a permitted Linux container with its own network and temporary files. Run no integration test on the laptop. Do not set `CI` or owner-approval variables to bypass the local guard. The current guard also refuses an ordinary laptop Docker box without an approved execution context; use the permitted cloud container or branch proof workflow.

Use pinned Node `26.13.0`, one worker and one test file at a time, with `TYPESAFE_API_KEY` unset.

1. Before repair, prove the controlled ordering turns the original assertion red. Save the command, ordering and failure.
2. After repair, run the targeted save-driven law five consecutive times at full depth. This is proof work, not an added test retry.
3. Run the entire watcher integration file once at full depth. Verify the other L17/L18, L10 and interruption laws.
4. Run each listed plant once, record the red result and remove it.
5. Run format first, then lint. The lead handles one final changed-test selection and typecheck without starting real-resource tests on the laptop.
6. Before review, obtain a green branch proof run at the final head. Confirm its selected test set includes the watcher integration file.
7. The lead reads the whole diff, every law-comparison hit, the proof result and the leak check.

No Mac-only law is added. If later work requires a real Mac run, decision `0178` requires the lead's read of reachable signal and launchd code and the owner's explicit yes before that run.

No skip, weaker assertion, raised timeout, new allow-list entry, reduced input range or lowered rule is allowed.

## Records

No new product fact is needed.

The evidence that cannot be recovered later is the actual ordering seen in a failing or controlled execution. Record:

- The tested head, seed, path, depth and command.
- The ordered reply tags and hashes.
- Which reply the gate held and when it released it relative to the write.
- Changed-span identities and outcomes, failure counts and cleanup results.
- Every plant and its observed failure.

Keep raw source, private markers and temporary absolute paths out of committed reports. Use per-case edit numbers and hashes for public evidence. Raw output belongs in the private archive.

## Size

One pull request. About 150 to 250 changed test lines, zero product lines, plus the plan and run records. About 1 to 2 agent hours. Confidence: 75%. Span accounting and the controlled delay are the main uncertainty.

1. Repair and prove the watcher law: **0 product lines**, about 200 test lines, landing as one complete change.

Budget basis: `field/runs/2026-11-13-t936-fix1.json` records a related test-runner fix at $4.1829 list price; its recheck row records $1.846. Allow about $4 for tests, $2 for build verification, $2 for review and $4 for one possible fix round. These are historical list-price estimates, not a paid-run authorization.

Estimate: 4 steps, $12

## What this cannot tell us

- The complete counterexample behind the CI failure.
- Whether its `same` came from the initial build or a preceding save.
- Whether the controlled ordering explains every possible watcher failure.
- Whether a separate product fault exists. A failing controlled trace must settle that before expanding scope.

## Open questions

None.

## Findings

```json
{"_tag":"finding","id":"2026-11-16-record-search-needs-write-in-read-only-plan","date":"2026-11-16","by":"plan","model":null,"rule":"bug","location":{"path":".agents/skills/lead/scripts/records.ts","line":697},"says":"The required record-search CLI cannot run in a read-only plan checkout because it unconditionally fetches before searching.","proof":"The plan skill requires record searches during its read-only step. records.ts:697 calls git fetch -q origin main before listing records. Running records.ts find for dev watch save rebuild reply failed because Git could not open .git/FETCH_HEAD: Operation not permitted. Calling the exported ranking functions over locally tracked records completed without fetching.","cost":"A read-only planner loses the required settled-record search unless it assembles a separate read-only call.","head":"e6d8f36d4702825c1ffe152141a616e4e90cec3c","ticket":null,"pr":null}
```

