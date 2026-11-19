Approved by the lead agent, builds 0137, 0210, 0233, 0564, 0594, 0023; body 33e2940ab86a
Plancheck-Version: 3

```ts
// next/, P25 slice 1: the library code half.
const tools = Tools.list([program]);
const call = Tools.read([program], "checklist_check", { value: { name: "item" } });
// Call.write.m and Call.query.query hold JSON.
// Execution.admit, step and fold decode the same JSON codec.
// A server and real agent access still need later work.
```

# P25 slice 1 recovery amendment

This amendment describes the recovered `next/` tree integrated at `4af9d5b0760bc4b64e5b0ba8c196a44ace5a97b5`.
It builds tracker ticket 888 and [PR 1099](https://github.com/kamp-us/tea-fabrika/pull/1099).
The original approval covers slice 1's code half only. The approved recovery body is
`c35ee72259c3`. This amendment records that scope on the combined tree and corrects its status.
It adds no owner ruling. Today's version is unchanged by P25.

The ordinary merge took in main at `dac18a5ad407e26509acd4bd8d3ebe178aab8954`.
Against that main parent, the P25 diff has 16 files, 2,503 added lines and 72 removed lines.
The lead still owes publication of this plan, current plan status, supported run records and the
PR description. Final type proof, remote proof and a fresh whole-diff review remain required.

## Approved scope

Keep Tools, Program.port, T1 through T5, the tools exam binding and amendments A-Module, A-Port,
A-Wire and A-Closed. These implement the checklist direction in
[0137](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0137-tier-1s-program-is-the-checklist.md),
the schema contract in
[0210](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0210-agents-get-a-closed-schema.md),
and [P25](https://github.com/kamp-us/tea-fabrika/blob/main/docs/plan/tier-1.md#the-pull-requests-one-at-a-time).
The scope remains the library code half. It completes neither slice 1's real harness experiment
nor the P25 row. Tracker 888 and umbrella ticket 328 stay open.

The policy exam belongs to slice 2. Its prerequisite is the presence of
`next/packages/libfabrika/src/gateway/Methods.ts`, not any file in the MCP folder.
The file is absent at the read head. Presence must attempt the binding even when loading fails
or an operation is missing. The ten existing policy test declarations and their assertion
bodies remain equivalent to main. This corrects when the law applies; it adds no policy behavior.

`layer-rules.json` is byte-exact main, blob `0ede1ae2252dcf371388abd19b8102ee06cd6cf2`.
The old numeric MCP layer entry is gone. Main already declares `next-mcp` with imports from
runtime, transport and shared types. Keep its inferred layer and explicit import limits.
The layer exam follows main's rename to `layers.integration.test.ts`. Do not recreate its old
plain test path. Keep all 18 main declarations and add the T5 scenario beside them.

Keep main's 29 Program test declarations, both A-Wire declarations and the monitor/DOWN suite.
Program.ts retains main's loader checks, fresh/update split and audit contracts beside the port
helper and JSON message decoder. Execution.ts retains the same surrounding runner behavior.
Remove only obsolete stability tags where current lint requires it.

## Known way and sources

Elm keeps state changes in update. This recovery adds pure schema helpers and changes the runner's
decoder; it adds no coordinator or new control state. See the
[Elm guide](https://guide.elm-lang.org/architecture/) and
[Elm first](https://github.com/kamp-us/tea-fabrika/blob/main/docs/direction/elm-first.md).

MCP defines named tools and their input schemas. This code supplies descriptions and decodes
arguments; it is not an MCP server. See the
[MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
Keep JSON Schema's distinct combination rules for allOf, anyOf and oneOf, as documented in
[JSON Schema combination](https://json-schema.org/understanding-json-schema/reference/combining).

The combined tree pins Effect 4.1.3, tea 0.27.0, Vitest 5.0.5, fast-check 4.10.2 and Ajv 8.20.0.
The builder read the installed Effect sources. Schema.toJsonSchemaDocument describes the JSON
codec's encoded side. Toolkit uses that codec for tool arguments, and McpServer attaches reached
definitions under $defs. Keep those APIs. No new runtime dependency or upstream patch is needed.

## Shape and one value traced

```ts
// The existing exported result schema, shortened only by omitting module qualifications.
const Call = Schema.TaggedUnion({
  ps: {},
  write: { program: ProgramName, m: Schema.Json },
  query: { program: ProgramName, name: Schema.String, query: Schema.Json },
  refused: { reason: Schema.Literals(["unknown_tool", "bad_input"]) },
});
```

1. A write port declares a Date field and its literal message type.
2. Tools lists the Date's JSON string inside value. The tool arguments omit the message type.
3. Program.port checks the arguments through the Msg's JSON codec. Tools.read encodes the checked
   Msg back to JSON, with its type restored.
4. Execution.admit and Program step/fold decode that JSON codec. Update receives a Date.
5. W3 checks that old letters whose schema sides already matched still step and fold.

There is no new setting, store, service layer, command or state machine. Which codec reads a
letter is a data contract. A test's source prerequisite is not a user preference.

## Laws

Keep the original laws and regression cases. The rows below describe the recovery, not a replacement
for the original plan. Existing seeds, run counts, policy assertions and refusal behavior stay.

| Law | Kind | Plant | Generator |
|---|---|---|---|
| T1/T2, P1-P5: ordering, hidden ports, exact port schemas, strict calls, alternatives, codecs and reached definitions; 300 runs | test | Expose a hidden port, drop a member or attach an unrelated definition | Effect Arbitrary: Forms.Declaration |
| T3: names fit and whole-list failures name the tool; 200 runs | test | Truncate a name or keep the first clash | Effect Arbitrary: Name |
| A-Wire W1/W2/W3: JSON letters reach update unchanged in meaning and old letters still fold; 300 runs | test | Restore raw decoding in admits or stepper, or raw encoding in Tools | Effect Arbitrary: Wire.Sent |
| A-Closed W4: open nested values fail, closed nested values list and reject wrong values; 200 runs | test | Skip an allOf or array child, or refuse every port | Effect Arbitrary: Forms.Odd |
| T4: typed port fields, checked Program arguments and the tagged Call union | type | Widen the port value to unknown and require the compile-time assertion to fail | type |
| T5: MCP accepts its contracts and refuses gateway and platform imports under main's rules | lint | Import gateway/Gateway or node:fs from Tools; prove red and restore | lint |
| Policy presence controls: only Methods.ts activates policy; failed and partial bindings throw; existing options and default runs | test | Restore the MCP directory trigger, swallow a failed load, omit install from required operations | Effect Arbitrary: Schema.Record |

The final presence generator is Schema.Record of the listed slice paths to Boolean, plus bounded
error text. It covers empty, complete unrelated and drawn path sets, failed imports, each missing
operation and the missing parked-wait Effect. It uses the existing seed and options.

## Files

Ownership below carries forward the approved recovery. It grants no new product work.

| File | Owner | Product lines expected | Work |
|---|---|---|---|
| `next/packages/libfabrika/src/mcp/Tools.ts` | build | 429 | Retain listing, decoding and JSON encoding. |
| `next/packages/libfabrika/src/runtime/Program.ts` | build | 83 | Keep typed port helper and JSON decoder with main behavior. |
| `next/packages/libfabrika/src/runtime/Execution.ts` | build | 8 | Keep admission through the JSON codec. |
| `next/packages/libfabrika/src/runtime/WireTest.ts` | tests | tests | Shared JSON round-trip fixtures and generators. |
| `next/packages/libfabrika/src/mcp/Tools.test.ts` | tests | tests | Preserve all 47 current tests. |
| `next/packages/libfabrika/src/mcp/Tools.types.test.ts` | tests | tests | Retain assertions and obtain actual compiler/type-plant proof. |
| `next/packages/libfabrika/src/runtime/Program.test.ts` | tests | tests | Preserve A-Wire and main's laws together. |
| `next/apps/fabrika/src/exam/agents.test.ts` | tests | tests | Per-law bindings, real Tools and checklist assertion. |
| `next/apps/fabrika/src/exam/agent-may.test.ts` | tests | tests | Methods.ts applicability and generated binding controls. |
| `next/apps/fabrika/src/exam/layers.integration.test.ts` | tests | tests | Preserve main's laws and add T5. |
| `layer-rules.json` | tests | tests | Exact-main resolution, no net change. |
| `.oxlintrc.json` | tests | tests | Four added registration/enforcement lines, no severity change. |
| `next/packages/libfabrika/package.json` | lead | 0 | MCP export group and approved test-only Ajv dependency. |
| `pnpm-workspace.yaml` | tests | tests | Approved Ajv catalog entry. |
| `pnpm-lock.yaml` | tests | tests | Matching catalog/importer entries, no new package version. |
| `docs/plan/quests/p25-recovery-PLAN.md` | lead | docs | Publish the reviewed amendment. |
| `docs/plan/README.md` | lead | docs | Current P25 code-half status and next move. |
| `docs/plan/tier-1.md` | lead | docs | Keep P25 open. |
| `docs/plan/tier-1-detail.md` | lead | docs | Separate the library code from the experiment and later slices. |
| `.glossary/TERMS.md` | lead | docs | Only terms introduced by the shipped code half. |
| `field/runs/*p25*.json` | lead | docs | Supported historical rows and actual new work. |
| `field/notes/*p25*.json` | lead | docs | A new recovery and missing-proof note. |

## Existing tools

- `next/packages/libfabrika/src/mcp/Tools.ts`: searched the existing Tools helpers and installed
  Effect Schema, Toolkit and McpServer. Retain the approved helpers and JSON Schema walk.
- `next/packages/libfabrika/src/runtime/Program.ts`: searched port, writePortCodec, PortFields,
  PortSchema, Payload, Fields and isJsonObject in the existing diff and Effect's JSON codec.
  Keep the approved codec; no second runner or new helper is proposed.
- `next/packages/libfabrika/src/runtime/WireTest.ts`: searched both existing consumers and its
  recorder/generators. It remains shared test support owned by tests.
- The existing presence helpers, plancheck, fieldfile, field-check, leakgrep, loosening and landing
  tools already cover this work. No new script or replacement tool is proposed.

## Validation and current evidence

The tests worker reports the following checks for the combined tree at the read head:

| Check | Reported result |
|---|---|
| Tools.test.ts | 47 passed |
| Tools.types.test.ts | 1 runtime check passed; compiler assertions unproved |
| Program.test.ts | 46 passed, including W1/W3 and main's monitor/DOWN laws |
| agents.test.ts | 7 passed, 4 later-slice laws pending |
| agent-may.test.ts | 10 passed, 1 slice-2 policy law pending because Methods.ts is absent |
| Total for those five safe files | 111 passed, 5 pending |
| Final Schema presence plants | 3 red, each restored byte-exact; restored suite passed |
| Post-merge format and lint | Passed; lint 18 of 18 parts |
| Post-merge advice-list check against the main parent | All three lists passed |

The three actual final plants restored the directory trigger, swallowed a failed binding load,
and omitted install from required operation checks. Each made the final Schema presence law fail.
Early collection failures are not product-law proof. The earlier check against the old committed
head is superseded by the post-merge result. This documentation worker ran no product check.

Two later compiler checks exposed style faults and were kept as failures. At the integrated
head, Tools.ts used a return-only arrow block. Commit ff0c3ac060f6a10e162a3873d86987c44d951d74
made that callback concise; all 47 Tools tests passed afterward. That head's next check found
the typed Program declaration passed to decodeUnknownResult in agents.test.ts. Commit
0e499051c5f3ebe05536c287620af0da610b0a0f uses the same runtime decoder through its typed
alias, decodeResult; the seven active agent tests passed and four later-slice cases remained
pending. These are behavior-preserving corrections under the installed Effect checks. Neither
failed whole check is a passing compiler or type-plant result. The next baseline is waiting for
the lead's shared compiler resource, rather than running alongside another check.

T4 still needs the single coordinated compiler run and a real type plant. Runtime execution of
Tools.types.test.ts does not check its uncalled assertions. T5's real-rule integration scenario
and its plants need eligible remote proof. A lint pass alone does not prove those deliberate faults.

The lead must obtain the required final-head CI and full branch proof. The manifest, lockfile
and lint configuration trigger the full proof set under
[0590](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0590-a-branch-proof-run-runs-only-what-its-change-reaches.md).
Keep guarded laws on their eligible remote runners. Launchd, real Electron and real process-signal
laws stay off the owner's laptop under
[0594](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0594-safe-checks-direct-mac-ci.md).
Obtain required real-resource proof before fresh whole-diff review. Match proof and review to
the final head. A later push needs the corresponding updated read and proof.

The lead must also run the loosening check and inspect every hit by hand. This worker has no
result to report for that check. No passing final review or merge eligibility is claimed.

## Records

Sixteen historical run rows and 32 recorded plants were recovered from reports. Keep their original
dates, outcomes and measured costs. There are seven pass, seven fail and two parked rows. All five
recovered reviews failed. Build 3's recorded pass made no code change. A tests-step pass can still
describe expected red product laws. None of those rows proves the current head passed review.

The older note says seven reviews sent work back. Reports for reviews 6 and 7 were not recovered.
Do not invent their rows, checks, dates, usage or plants. Later A-Wire and A-Closed commit subjects
also do not supply missing run records. The skipped historical host rounds prove no host check.

Publish supported historical rows through the existing per-file record tool. Preserve their old
metadata warnings rather than inventing fields. Record current plan, tests, build and review work
separately, with unknown usage and cost left null. Do not change old field rows. Record the exact
head, actual commands, outcomes and plants now, because those facts cannot be rebuilt later.

## Known limits

Tracker ticket 905 remains open. Its full filed body covers the shared type with a key description
that Tools.named rejects as unsupported_schema. The same class includes annotated shared literals,
recursive trees and shared tuple elements, on read and write ports.

It also records two missing regression cases: an allOf member need not name its own type, and
patternProperties must be checked. The third smaller finding is a false claim in named's comment,
not a third missing test. The ticket leaves open whether free JSON inside a JSON string should be
rejected by inspecting contentSchema. This recovery neither fixes that ticket nor decides it.

The recursive JSON union remains separately undecided in
`field/findings/2026-11-13-recursive-json-union-lists-as-a-tool.json`. Keep that finding and the
historical scope-cut note unchanged. Do not describe all schema forms as supported or fully closed.

The real two-harness experiment, slice 2's gateway policy and queries, slice 3's MCP server/client
bridge and slice 4's writes and visible checklist demo remain outside this recovery.

## Size

This amendment adds no product code. It records the existing 16-file diff and the remaining proof.
The lead's approved recovery allowance stays about 60 changed product lines plus test and record
work. Confidence: 65%, carried from the recovery plan. Readiness depends on proof still missing.

1. Preserve and prove the approved code half on current main: 60 product lines of recovery allowance.
2. Publish plan status and supported records in this PR: about 500 lines of documentation.

The existing four-step budget covers tests, build, review and one likely repair. Its dollar basis
is the 16 historical rows, whose measured list-price total is $11.678. This is a budget carried
forward, not a claim about this documentation worker's usage or money spent today.

Estimate: 4 steps, $4

## What it cannot tell us

- Whether T4's compiler assertions and type plant pass on the final head.
- Whether T5's integration scenario, plants and the full remote proof pass there.
- Whether a fresh whole-diff reviewer accepts the final implementation and records.
- Whether real agent harnesses accept the schemas. The separate experiment still has to run.
- What missing reviews 6 and 7 checked or cost.

## Open questions

None.

This amendment adds no new design choice. Missing proof is work for the lead, not owner approval.
