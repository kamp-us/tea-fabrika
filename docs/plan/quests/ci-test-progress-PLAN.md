Approved by the lead agent, builds 0250 and 0594; body f82fa119ab9b
Plancheck-Version: 3
# Keep CI progress when a test run is cut short

Today's CI tooling, serving both versions. Tracker ticket 1144, filed and read back through the app CLI.
Read at main `f06b11d5b9b97275a121e3f5876abb292cfe84fe`.

```text
Vitest callback -> awaited safe event append -> existing timing artifact
missing run end -> partial progress, never an invented test verdict
```

## Problem and scope

The full main run [44059387685](https://github.com/kamp-us/tea-fabrika/actions/runs/44059387685/job/133960614165) reached its existing 17-minute test-step limit. Its final Vitest JSON report did not exist. The saved timing artifact therefore could not say which tests had started but not ended. A bounded reconstruction found 63 selected files, 62 completed files and only `node/QuotaRunner.test.ts` without a completion. That is a lead, not proof of a failing law or a cleanup fault.

Add a small progress journal to the existing scheduled full and changed test commands. The changed test step also passes its existing matrix shard as the internal LEG environment value so its header can match the timing reader. Full steps retain their existing SHARD identity. This adds no user input or setting. Include its safe records and unmatched starts in the existing timing artifact and job summary. Keep the final JSON report, current failure verdicts, main cadence, test selection, all case counts, all deadlines, shared job groups and artifact upload unchanged. This patch diagnoses interrupted runs. It does not fix or attribute the old timeout.

No product file in `next/` changes. No reporter or runner change belongs in ticket 1126's eight owned files. In particular, leave the existing plant reporter and its fixture alone.

## Ground and known way

Vitest's [custom reporter interface](https://vitest.dev/guide/advanced/reporters.html) supplies lifecycle callbacks. The installed 5.0.5 declaration in `node_modules/vitest/dist/chunks/plugin.d.C8mmycim.d.ts`, lines 2139 through 2187, says module-queued precedes import, test-ready precedes beforeEach and test-result follows the test and its hooks. Its task implementation supplies a deterministic ID based on project, module and declaration order. Its JSON reporter writes only at run end. These installed sources, not a guessed API from an older release, govern construction.

Use those callbacks beside the ordinary reporters, as `.github/ci/plant-reporter.ts` already does for a different purpose. Elm's data-first answer is to save the events and derive the view. No second worker, polling loop or queue is needed. OTP's monitoring is not substituted for the test framework's own observations. An unmatched start means last observed activity, never a claim that the worker was still executing that operation at death.

Use Effect 4.1.3 `FileSystem.writeFileString` with append mode, `Path`, `Clock` and `ManagedRuntime` for the callback boundary. The installed Effect guide and FileSystem source were read. Await each write before the reporter callback returns. No in-memory batch is flushed only at run end. This survives termination of the Vitest process after a completed append; it does not promise survival of runner loss or power failure.

Applicable records: [0250](../../../.decisions/0250-effect-modules-first-node-at-an-edge.md) uses Effect's platform modules; [0579](../../../.decisions/0579-property-laws-use-it-prop.md) uses Schema inputs and it.prop; [0584](../../../.decisions/0584-a-tests-kind-follows-what-it-uses.md) classifies tests by reached resources; [0594](../../../.decisions/0594-safe-checks-direct-mac-ci.md) routes real signal proof off the laptop; [0590](../../../.decisions/0590-a-branch-proof-run-runs-only-what-its-change-reaches.md) preserves exact-head branch proof; [0595](../../../.decisions/0595-scheduled-runs-share-slots.md) preserves the existing shared job groups. [0065](../../../.decisions/0065-speed-laws-count-work.md) keeps elapsed measurements advisory and uses work counts for a blocking law. [0037](../../../.decisions/0037-implicit-state-machines-made-explicit.md)'s control-state test is answered below.

## Shape

This is a sketch. Construction uses Effect Schemas for the exact closed union and strict decoding.

```ts
type Progress = {
  readonly version: 1;
  readonly leg: Leg;
  readonly events: readonly Event[];
  readonly complete: boolean;
  readonly active: readonly Event[];
  readonly gaps: readonly number[];
};

type Event = {
  readonly seq: number;
  readonly at: number;
  readonly project: "next" | "next-integration" | "next-visual" | "tooling";
  readonly file: string;
  readonly id: string;
  readonly line?: number;
  readonly column?: number;
} & (
  | { readonly _tag: "module"; readonly phase: "queued" | "collected" | "started" | "ended" }
  | { readonly _tag: "test"; readonly phase: "started" | "ended" }
  | { readonly _tag: "hook"; readonly phase: "started" | "ended";
      readonly hook: "beforeAll" | "afterAll" | "beforeEach" | "afterEach" }
);
```

The first NDJSON line is a versioned run header with the existing Leg facts. The last line, when observed, is a closed run-end event with only Vitest's passed, failed or interrupted reason. Event lines carry only the projected shape above. Derive `file` from a module inside the actual repository root. Refuse paths outside that root, virtual IDs and traversal. Never serialize the source absolute path. Validate ID against installed Vitest's hash and declaration-index grammar. Copy no title, fullName, custom metadata, annotation, stdout, error, parameter, arbitrary environment value or raw failure object. Missing source locations remain absent.

Record at the fixed `RUNNER_TEMP/vitest-progress.ndjson` location. This is an internal filename, not a new user setting. Run identity already exists in GitHub's environment. The reporter uses only its named identity fields; no environment dump. Truncate the journal at the start of this one Vitest run, then append one complete line per observed event. All journal I/O failures remain diagnostic and cannot change the test verdict. Increment the sequence before an append so a later successful record exposes a missed write. A missing run-end record, gap, malformed complete line or incomplete last line makes progress partial. Preserve every valid earlier record; report the fault with a fixed reason, without echoing its input or filesystem error.

The timing reader retains `files: unavailable` when final results are missing. Add an independent progress section with read, partial or unavailable cases. A partial journal still supplies its valid earlier observations. Validate the header against the current run, attempt, head, job and leg, so a stale file never describes another attempt. Include all safe events in the existing JSON artifact. The Markdown lists every unmatched module, test and hook by project, repository path, ID and source position when available. It says last observed, not hung, failing or current. It never manufactures elapsed file timings from a partial journal.

Match test and module ends by project, file and ID. Hook grouping also includes its closed hook name. Vitest gives no separate hook-function ID here, so retain a multiset when the same entity/name has more than one overlapping start. A matching end decrements that group; it cannot identify which of two identical hooks ended. Report that limit rather than invent a hook identity. Keep unmatched starts for different concurrent workers independently. Normal module completion removes its module activity. A run-end event does not invent missing test or hook ends. Derived active sets are replay results, not control state: they admit or refuse no later callback. The append sequence is a count, not a hidden lifecycle switch. No new state machine is introduced.

## One value through

1. Vitest queues `next/packages/libfabrika/src/node/QuotaRunner.test.ts`. The reporter appends its module ID, relative path, sequence and time before returning.
2. A test becomes ready, then beforeEach starts and ends. Those three safe records are appended separately. Other workers can have their own unmatched tests at the same time.
3. The action stops Vitest before a test-result and before final JSON is written. There is no new special timer in this patch.
4. The existing always-running time-table step reads the journal, keeps final files unavailable and shows the three workers' last unmatched observations. The existing timings upload saves this same JSON.

The per-event time, exact run identity and unfinished-operation ID are facts lost forever if not saved before termination. Counts and active lists can be rebuilt later from the saved events.

## Files

| File | Owner | Product lines expected | Change |
| --- | --- | ---: | --- |
| `.github/ci/progress.ts` | tests | 150 | Schemas, strict safe projection, journal reader and derived unmatched observations |
| `.github/ci/progress-reporter.ts` | tests | 110 | Installed Vitest callbacks and awaited Effect append adapter |
| `.github/ci/progress.test.ts` | tests | tests | Generated interleaving, damaged-input and privacy laws |
| `.github/ci/progress-reporter.integration.test.ts` | tests | tests | Actual installed child reporter and interruption proof, independent of plant fixture |
| `.github/ci/time-table.ts` | tests | 45 | Add progress collection and summary beside unchanged steps and final files |
| `.github/ci/time-table.test.ts` | tests | tests | Preserve existing laws and add incomplete-run progress behavior |
| `.github/workflows/scheduled.yaml` | tests | 5 | Add the custom reporter argument to the four existing Vitest commands and expose the existing changed matrix leg |
| `.github/ci/workflow-lint/scheduled.ts` | tests | 2 | Require that exact reporter argument while preserving all prior command constraints |
| `.github/ci/workflow-lint/scheduled.test.ts` | tests | tests | Missing or substituted progress reporter is rejected without weakening other rules |
| `docs/plan/README.md` | lead | docs | Record actual diagnostic capability after its protected proof exists |
| `.github/ci/plant-reporter.ts` | tests | 0 | Read-only pattern; no edit, belongs to the existing fault-runner owner |
| `next/packages/libfabrika/src/node/QuotaRunner.test.ts` | tests | 0 | Read-only diagnostic lead; no product, test or classification edit in this patch |

## Existing tools

- `.github/ci/progress.ts`: searched the existing time-table reader, plant reporter, Vitest JSON/blob reporters and installed Effect NDJSON and Schema tools. Reuse Effect decoding and the existing Leg identity. No installed reporter saves this restricted metadata before run end and supplies it to our existing timings artifact. New projection and replay helpers stay here, rather than copying the final JSON reader.
- `.github/ci/progress-reporter.ts`: searched installed Vitest Reporter callbacks and the existing plant reporter. Reuse Reporter and ManagedRuntime plus Effect FileSystem, Path and Clock. Do not extend PlantReporter, which owns causal fault witnesses and has another active owner. No native filesystem helper or service is needed.
- Progress projection: searched Vitest task ID, relative module ID and source location. Use its deterministic ID and validated repository-relative path. Do not invent a second test naming scheme.
- Progress decoding and active summary: searched time-table readFiles, Section, collect and markdown. Reuse their advice-only independent-section behavior. NDJSON decoding needs to retain a valid prefix and mark a partial final line, which the final JSON reader cannot do.
- Reporter callback append: searched Effect FileSystem append flags and ManagedRuntime's external-callback pattern. Reuse them, one awaited write per callback. Do not build a background writer, retry loop, native append wrapper or new log rotation.
- Existing timing upload and always-running table steps already handle failed and canceled legs. No upload step, artifact name, retention value, token permission or time-table environment changes.

## Laws

New generated laws use the existing installed @effect/vitest it.prop runner with Effect Schema inputs and shared package seed, 100 runs per generated law. CallbackEvents is a Schema.Array of closed safe events. Interleavings draws bounded matching start/end keys. InterruptedReports adds missing/broken final reports. DamagedJournals draws valid prefixes plus arbitrary corruption and closed identity mutations. PrivateCallbacks draws Schema.String canaries into excluded fields. WriteAnswers draws append success/failure sequences. Do not migrate unrelated existing time-table properties as part of this patch. Run counts below remain explicit. Each planned temporary fault is run once, followed by exact restoration and a green law.

| Law | Kind | Generator or reason | Check | Plant |
| --- | --- | --- | --- | --- |
| P1 every observed callback appends before returning, without relying on run end | test | Effect Arbitrary: CallbackEvents | Append-call sequence equals input order and count even when no run-end callback is supplied | Buffer all records until run end |
| P2 independent starts survive every legal concurrent interleaving | test | Effect Arbitrary: Interleavings | An independent test oracle retains exactly unmatched project/file/ID/hook keys after every prefix | Keep only the last started test, or clear another worker on any end |
| P3 missing final results never erase recorded progress or invent final file results | test | Effect Arbitrary: InterruptedReports | collect keeps steps and progress independent, files unavailable and safe Markdown honest | Require valid final JSON before reading progress |
| P4 stale identity, malformed lines, write gaps and truncated tails remain explicitly partial or unavailable | test | Effect Arbitrary: DamagedJournals | Earlier valid records survive damage, no later corrupt record is trusted, stale headers supply no current events | Accept the stale header or silently call a truncated file complete |
| P5 [secrets] recorded output contains no titles, generated values or machine paths | test | Effect Arbitrary: PrivateCallbacks | Inspect raw journal, timing JSON and Markdown, including JSON and percent encodings, while retaining safe path/ID/positions | Copy title, fullName, metadata or raw module path into each named output, one temporary fault per output |
| P6 reporter failure cannot replace Vitest's actual verdict | test | Effect Arbitrary: WriteAnswers | Failed append records no fabricated event, later success exposes sequence gap, fixed diagnostics contain no thrown input | Let a write error escape its callback or serialize raw filesystem error |
| P7 scheduled commands keep the progress reporter beside every existing reporter and exact selection/depth | lint | lint | Existing scheduled rule rejects removed/substituted reporter while preserving prior source/queue/verdict constraints | Drop custom argument from one of the four commands |
| P8 installed callback ordering survives a real child cutoff before final JSON | test | scenario: a real Vitest child and process termination are needed to prove kernel-visible records survive without the final callback | See remote proof below | Write only in onTestRunEnd, then terminate after ready |
| P9 metadata writes cost one append per accepted callback, with no replay per callback | test | Effect Arbitrary: CallbackEvents | Recorder observes one append each and no extra read, scan or growing serialization of old records | Serialize the whole accumulated journal after every event |

## Validation and proof

Run format first. Ordinary pure laws use nice 19 and one worker. The lead reserves the one compiler and one full lint slot for final resulting-head checks. Use narrow progress, time-table and workflow-lint paths. The lead obtains the resulting-head full or selected scheduled proof through the normal path. Preserve every existing test count, assertion, generator and deadline.

P8 is a new integration file because a stand-in cannot prove that the installed Vitest callback writes reach a file before that process dies. It runs before the first review on eligible disposable CI under 0594. Use the existing scheduled tooling project, not a new workflow. A scope owns one temporary folder, child and output drains. The fixture has a test that sends a fixed ready marker from inside its body, then awaits an intentionally unresolved fixture promise. The parent receives that marker, reads the actual journal and requires the matching test-ready record while the child is still blocked. It uses SIGKILL through that exact acquired ChildProcessSpawner handle, awaits exit and records that final JSON is absent while progress remains. The handle owns its child process group; cleanup cannot signal another group. Cleanup belongs to the scope. Never identify a child by pgrep, a shared name or process ancestry. This signal proof does not run on the owner's laptop.

A separate normal fixture returns immediately after the same fixed marker and requires the existing final JSON result plus complete progress. The two fixture bodies differ only in that explicit final return versus unresolved await; no extra runner input is added. A separate bounded fixture lets Vitest's own per-test timeout fail a gated test and requires the real failed verdict and saved progress. These fixture bounds are test inputs, not changes to repository or workflow deadlines. A generic child crash or a timeout before the fixed ready observation is not proof. The timing reader is called on these real files; do not substitute synthetic JSON for the final interruption observation.

No clock threshold gates speed. P9 gates exact work counts. Separately measure elapsed time and journal bytes with and without the reporter over the same finite safe fixture input, serially, on the pinned runtime. Record all samples and the observed difference as advisory. If overhead is material in the actual measured run, revise before rollout; do not invent an unmeasured percentage threshold or hide events with a count limit.

## Calls and settings

- Use Vitest lifecycle callbacks rather than parse its console output. They provide the installed framework's event identity. Confidence 99%.
- Keep the journal beside the existing report and include it in the existing timing JSON. This closes the demonstrated gap without new infrastructure or permissions. Confidence 98%.
- Scope reporter wiring to scheduled full and changed runs, the demonstrated failure path. check.yaml keeps its current commands; its time-table progress section may be unavailable. Confidence 97%.
- No new setting is needed. The file is internal, event vocabulary follows the installed framework, the record schema is versioned and the existing artifact retains its current retention setting. Do not add configurable filtering or arbitrary output paths.
- Unknowns are explicit. Last observed activity is not a diagnosis. Missing or partial diagnostics cannot pass or fail tests. This does not answer whether QuotaRunner caused the old timeout.

## Size

1. One complete CI diagnostic patch, about 315 product lines in five source/workflow files, plus tests and the plan status note. Roughly 1 to 2 agent hours, including protected proof. No numeric size cap drives the scope. Size confidence 85%.

Budget basis: comparable ticket 1050 saved list-price rows record tests $9.5471, build $2.6691 and review $4.2807, total $16.4969. Round to $20 for this bounded patch. These are historical list-price measurements, not a new model price claim or a subscription charge. Actual model use and cost remain recorded by each step.

Estimate: 3 steps, $20

## Records

Save one new immutable field run row for each actual step, naming the exact source and proof limits. Save the real-child receipts and measured overhead in the private archive, with a short field note about the observed interruption gap. No new owner decision is made here. Record no raw test content or absolute paths in public records. The lead updates the plan status only after actual proof.

## What this cannot tell us

A last observed callback cannot identify a killed worker's exact final instruction, explain the historical timeout or prove that the unaccounted QuotaRunner file hung. Runner loss can prevent the existing upload. Missing diagnostics stay unknown. The overhead has not yet been measured. No test or compiler was run during this planning step.

## Tracker ticket

Title: Keep last observed CI test activity when final Vitest JSON is missing

Body: Today's scheduled full run 44059387685 tests3 reached its existing step deadline and produced no final results.json. The timing artifact consequently lost unfinished-test identity. Implement the bounded metadata-only lifecycle reporter and timing-reader extension in this plan. Preserve verdicts, all tests/counts/deadlines, selection and shared CI slots. Prove real installed-child interruption and normal completion on disposable CI. Do not attribute the old timeout or change QuotaRunner behavior from this evidence.

## Open questions

None.

Tracker ticket 1144 is filed. The lead reads and approves this public copy before it is committed or published.
