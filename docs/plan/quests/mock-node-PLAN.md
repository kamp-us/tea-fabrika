Approved by the lead agent, builds 0555, 0557, 0579, 0554, 0573; body c84cb74f9d8a
Plancheck-Version: 3

# Plan: the mock sweep in `libfabrika/src/node`, the `RunnerAdmission` law, in next/ (ticket 1067)

This is `next/` and our lint tooling. Today's app is not touched. It is one later slice of the
recorder plan ([`recorder-PLAN.md`](./recorder-PLAN.md), "Size", the row for
`libfabrika/src/node`): 4 `vi.fn` calls, 0 `toHaveBeenCalled*`, 0 `vi.spyOn`, all platform
namespace doubles, so platform fakes and not the Recorder. It builds
[0555](../../../.decisions/0555-no-vi-mock-or-domock.md),
[0557](../../../.decisions/0557-kalfa-vitest-is-the-test-toolbox.md),
[0579](../../../.decisions/0579-property-laws-use-it-prop.md) and
[0554](../../../.decisions/0554-no-reflect-get-set-has.md), which puts the fakes of Cloudflare
objects in the test package. Not in this slice: `node/dev`, `node/client` and `node/repositories`,
which have their own plans.

```ts
// The whole idea, on next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts.
// A sketch, not compiled.
// before: vi.fn answers `any`, so none of these doubles is checked against Cloudflare's types
RECORD: namespace(vi.fn().mockReturnValue({ write: async () => Written.cases.written.make({}) })),
// after: the shared platform stub, typed by the binding it stands in for
RECORD: Stub.make<Env["RECORD"]>(unexpected, {
  getByName: () => Stub.make<ReturnType<Env["RECORD"]["getByName"]>>(unexpected, {
    write: async () => Written.cases.written.make({}),
  }),
}),
```

## Doubts, read these first

- **This slice waits for pull request [1433](https://github.com/kamp-us/tea-fabrika/pull/1433)
  (certain).** `Stub.make` is slice 8 of the Reflect ban
  ([`reflect-ban-PLAN.md`](./reflect-ban-PLAN.md), "The shared stub, in the test package"). On
  main it does not exist yet: pull request 1433 has its laws (L6, `next/packages/vitest/src/Stub.test.ts`)
  and waits for its build. The tests step here starts only once 1433 has merged. It builds no stub
  of its own, since 0554 says a law calls the shared helper and does not write the fake by hand.
- **Whether every member types through `own` (70%).** `Stub.make<A>(rest, own?: Partial<A>)` types
  `own` against `A`. Cloudflare's RPC types wrap a binding's methods (`Rpc.Provider` in
  `@cloudflare/workers-types` 5.20261027.1), and `WorkerStub.getEntrypoint` is generic in its
  binding (`index.d.ts:4159`), so a plain `() => box` cannot be every `Fetcher<T>`. The lean: a
  member goes in `own` where it types. A member Cloudflare's types refuse in `own` is answered by
  name in `rest`, which `Stub.make` types as `(...args: ReadonlyArray<unknown>) => unknown`, and
  the law's comment says why. That is no looser than today: `vi.fn()` answers `any` for every one of
  these members. What settles it: the tests step's typecheck of the file (one `effect-tsgo
  diagnostics` on `next/packages/libfabrika/tsconfig.json`). No cast is written in the law, and
  `Stub.make` holds its one cast inside (1433).
- **The law is an `.integration.` law (certain).** It runs on the schedule (0536), not on every pull
  request. The tests step may run it in its box, since the step rules allow an `.integration.` law
  its files reach; it takes up to 10 minutes.

## What changes, in one paragraph

In `RunnerAdmission.integration.test.ts`, the `environment` the project audit suite asks for
(`ProjectAuditTest.Harness["environment"]`, `next/packages/libfabrika/src/cloudflare/ProjectAuditTest.ts:48`)
is built from `Stub.make` in place of four `vi.fn` calls, and the file stops importing `vi`. No law
of the file changes: the same suites, seeds, run counts and coverage lists. Then oxlint's own rule
`vitest/no-restricted-vi-methods` goes on at error for the top folder's files,
`next/packages/libfabrika/src/node/*.ts`, refusing `vi.fn` and 0555's four methods, with a plant
law beside the Reflect ban's in `oxlint-plugins/builtin-plants.ts`. This is the first slice that
turns that rule on, so it adds the rule and its plant law; each later folder slice adds its own
block.

## How others do it

- **Cloudflare's own way** is `@cloudflare/vitest-pool-workers`, which runs a law inside workerd
  with real bindings from Miniflare (developers.cloudflare.com, "Write your first test"; from
  memory, not fetched). This law does not fit it: it drives the Project's composition in Node, on
  real SQLite files, with a scripted `msg` per process (`box.admit` decides). 0042 says Miniflare is
  reached through Alchemy, and the Node run is what the law is for. So the law keeps stand-ins.
- **A stub, in the industry's words.** Fowler's "Mocks Aren't Stubs" (read for the recorder plan,
  2026-11-15): a stub gives canned answers, a spy also records how it was called. None of the four
  `vi.fn` here is read for its calls: no `toHaveBeenCalled*`, no `.mock.calls` in the file or in
  `ProjectAuditTest.ts`. Each is a stub, so the replacement is a stub, not the Recorder.
- **Effect's way for a part of a service** is `Layer.mock`: members left out die with
  `UnimplementedError` when used. A Cloudflare binding is no Effect service, so the shared helper
  takes the same idea: `rest` answers every member not given, and here it throws, naming the member.
- **The lint rule.** oxlint 1.90.0, the installed version, ships `vitest/no-restricted-vi-methods`
  (`node_modules/oxlint/configuration_schema.json`, its options a map from method name to message).
  0555's sketch names it. 0573 says a trusted rule replaces ours where it catches the same, so no
  rule of our own is written.

## The shape

A sketch, not compiled. `Env` is `next/packages/libfabrika/src/cloudflare/runtime.ts:169`.

```ts
// next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts
import * as Stub from "@kampus/vitest/Stub"; // or `import { Stub } from "@kampus/vitest"`, as 1433 exports it
import type { Env } from "../cloudflare/runtime.ts";

/** Any member this law does not use throws, naming it, as a member left out of Layer.mock dies. */
const unexpected =
  (member: string) =>
  (): never => {
    throw new Error(`unused platform call: ${member}`);
  };

const environment: ProjectAuditTest.Harness["environment"] = (box, accept, usage, loaded) => ({
  PROJECT: Stub.make<Env["PROJECT"]>(unexpected),
  CONNECTION: Stub.make<Env["CONNECTION"]>(unexpected),
  LOADER: Stub.make<Env["LOADER"]>(unexpected, {
    get: (key, code) => {
      loaded(key, code());
      // getEntrypoint is generic in its binding, so it is answered by name (see the doubts).
      return Stub.make<ReturnType<Env["LOADER"]["get"]>>((member) =>
        member === "getEntrypoint" ? () => box : unexpected(member),
      );
    },
  }),
  PROCESS: Stub.make<Env["PROCESS"]>(unexpected, {
    getByName: (object) =>
      Stub.make<ReturnType<Env["PROCESS"]["getByName"]>>(unexpected, {
        configure: async () => undefined,
        usage: async (rows) => usage(object, rows),
        msg: async (input) => {
          const message = input.envelope.input;
          const stamped = Predicate.isObject(message) ? { ...message, parent: input.envelope.id } : message;
          if (!(await box.admit(stamped))) return Sent.cases.refused.make({ reason: "bad_msg" });
          const rev = accept();
          return Sent.cases.accepted.make({ rev, pos: rev });
        },
      }),
  }),
  RECORD: Stub.make<Env["RECORD"]>(unexpected, {
    getByName: () =>
      Stub.make<ReturnType<Env["RECORD"]["getByName"]>>(unexpected, {
        write: async () => Written.cases.written.make({}),
      }),
  }),
  MEASUREMENTS: Stub.make<Env["MEASUREMENTS"]>(unexpected),
});
```

```jsonc
// .oxlintrc.json, one new block in "overrides" (a sketch; the messages say what to do instead)
{
  "files": ["next/packages/libfabrika/src/node/*.ts"],
  "rules": {
    "vitest/no-restricted-vi-methods": [
      "error",
      {
        "fn": "A stand-in for a platform object is Stub.make; a watched call is a Recorder (0557, 0579).",
        "mock": "Give the code a service and provide a test layer (0555).",
        "doMock": "Give the code a service and provide a test layer (0555).",
        "spyOn": "Put the call behind a service and record it with a Recorder (0555, 0579).",
        "stubEnv": "Read through Config and provide a ConfigProvider layer (0555)."
      }
    ]
  }
}
```

Each choice, decided in one line:

- **`Stub.make`, not the Recorder,** since nothing here reads a call (the recorder plan's row says
  so too). 90%.
- **`rest` throws, naming the member.** Today's `unused` throws `"unused platform call"`; the name is
  added so a failing run says which member. A law that leans on a member it did not give fails
  loudly, as `Layer.mock` does. 90%.
- **The stub types come from `Env`,** the product's own binding interface, so a renamed binding
  member fails the law's typecheck, which `vi.fn`'s `any` hid. 85%.
- **The lock's folder is `node/*.ts`, the top files only.** `node/**` cannot block yet: `node/build`
  has 7 `vi.doMock` and 4 `vi.stubEnv` (counted below), `node/dev` has 2 `vi.mock`, 15 `vi.spyOn`
  and 6 `vi.stubEnv`. A glob `*` does not cross a `/`, so the subfolders stay out until their
  slices. 85%.
- **All five methods in one block, `fn` included.** 0555 bans four. `vi.fn` is a `vi` mechanism
  `@kalfa/vitest` does not export (0557), and 0579 names the Recorder as what replaces it. The top
  folder is at zero for all five after this slice, so the block blocks at zero (0523's bar). 85%.
- **One block per folder, each with the same five messages.** oxlint takes the last matching
  override's options for a rule, so a later block for a subfolder must list all five again, not add
  one. The plant law below reads every block that sets the rule, so a block that drops a method is
  red. 80%.

**Amendment (2026-11-16, lead ruling): the lock is a pair.** oxlint's
`vitest/no-restricted-vi-methods` does not refuse a call chained onto the `vi` call, in oxlint
1.90.0 (the lockfile's) and 1.93.0 alike: `vi.spyOn(console, "warn").mockImplementation(() => {})`
and `vi.fn().mockReturnValue(1)` pass, while the same call in parentheses is refused. The proof is
the last `false` lines of `VI_METHODS` in `oxlint-plugins/builtin-plants.ts` on
`fabrikalfa/mock-app-e2e-s1` at `f02b31948`, and the row
`field/runs/2026-11-15-mock-app-e2e-tests1.json`. So every block of the lock sets two of oxlint's
own rules over the same files: `vitest/no-restricted-vi-methods`, kept on as it is, and the
built-in `eslint/no-restricted-properties` with one `object: "vi"` entry for each member the
block bans, each with the same message as that member's entry in the vitest rule.
`no-restricted-properties` matches the member access `vi.spyOn` itself, so it refuses the call
with another call chained on; the vitest rule keeps what only it sees, such as `v.spyOn` after
`import { vi as v }`. Both are trusted rules, as
[0573](../../../.decisions/0573-trusted-lint-rule-replaces-ours.md) asks, and no rule of ours is
written. The upstream issue is [oxc#29656](https://github.com/oxc-project/oxc/issues/29656),
filed by the lead: `vitest/no-restricted-vi-methods` misses chained calls. The
`no-restricted-properties` half stays until oxc fixes it.

```jsonc
// .oxlintrc.json, the lock as a pair (amendment 2026-11-16, lead ruling). A sketch; one block.
{
  "files": ["next/packages/libfabrika/src/node/*.ts"],
  "rules": {
    // Kept on as it is: the same members, with the same messages as below.
    "vitest/no-restricted-vi-methods": ["error", { /* fn, mock, doMock, spyOn, stubEnv */ }],
    "eslint/no-restricted-properties": [
      "warn",
      // Written out again, since an override replaces options: the `JSON.parse` entry, of the warn block that writes it out again.
      { "object": "vi", "property": "fn", "message": "A stand-in for a platform object is Stub.make; a watched call is a Recorder (0557, 0579)." },
      { "object": "vi", "property": "mock", "message": "Give the code a service and provide a test layer (0555)." },
      { "object": "vi", "property": "doMock", "message": "Give the code a service and provide a test layer (0555)." },
      { "object": "vi", "property": "spyOn", "message": "Put the call behind a service and record it with a Recorder (0555, 0579)." },
      { "object": "vi", "property": "stubEnv", "message": "Read through Config and provide a ConfigProvider layer (0555)." }
    ]
  }
}
```

- **The `vi` entries join the list these files already take.** A block's options for a rule
  replace an earlier block's, they do not merge, and oxlint takes the last matching block's. So the
  lock's `no-restricted-properties` list writes out again every entry its files take today, at that
  block's level, and the lock's block sits after that block, the way the Reflect ban's blocks write
  out the `JSON.parse` entry (`.oxlintrc.json` on main at `b490a3203`). On main `node/*.ts` takes the `warn` block that writes out `JSON.parse` alone, so the lock is one block, as the sketch shows. At `warn`, a `vi`
  fire still blocks: `pnpm lint` lets only a `JSON.parse` fire of this rule advise
  (0523, the advice map `pnpm lint` reads). No file loses an entry, and no file gains one but the
  `vi` entries. Whichever slice lands later carries the entries the others landed first: another folder's `vi` entries, the `process.stdout` and `process.stderr` entries of the cloudflare plan's M13 (on these files but `*.test.ts`, the way M13 leaves test files out), or any new set.
- **The plant, red first.** The lock's law runs a second plant beside node's `VI_METHODS`:
  `VI_PROPERTIES`, under the code `eslint(no-restricted-properties)` as `REFLECT` is, in every
  path of every block that sets the vitest rule, through the same scenario. Refused:
  `vi.spyOn(console, "warn").mockImplementation(() => undefined)`, `vi.fn().mockReturnValue(1)`,
  and one plain call of each banned member. Taken: `vi.hoisted(() => 1)`, `vi.waitFor(() => 1)`,
  a comment, a string and `other.fn()`. A line is held by the lock when either plant refuses it.
  Red first: drop the block's `vi` entries from `no-restricted-properties`, and the two chained
  lines are not refused, so the law is red; with them back, it is green. The plants of the entries
  written out again, such as `REFLECT`, still pass in each locked path, which shows no entry was
  lost.
- **`VI_METHODS`' chained lines.** `VI_METHODS` keeps recording what the vitest rule does alone,
  so its chained lines stay `false` under its own code. They are no longer a miss of the lock: the
  pair refuses them, through `VI_PROPERTIES`.
- **M1 is still the sweep's one lock law:** it runs both plants, `VI_METHODS` and `VI_PROPERTIES`, in every path of every block, and every other mock plan's lock runs both. M2's plant, `getEntrypoint: vi.fn().mockReturnValue(box)`, is a chained call: the vitest rule alone takes it, and it is red through `eslint(no-restricted-properties)`.

## One value traced: a refused message

1. The project audit suite builds the environment with `harness.environment(box, accept, usage, loaded)`
   (`ProjectAuditTest.ts:172`) and hands it to `projectLayer`.
2. The Project asks `env.PROCESS.getByName("counter:1")`. `Stub.make`'s trap finds `getByName` in
   `own` and answers the process stub.
3. The Project calls `msg(input)` on it. The stub stamps the message's parent and asks
   `box.admit(stamped)`. The box says no.
4. `msg` answers `Sent.cases.refused.make({ reason: "bad_msg" })`, and the suite's admission walk
   records the refusal as it does today.
5. Had the Project asked `env.PROCESS.idFromName(...)`, a member this law never gave, `rest` would
   throw `unused platform call: idFromName`, and the walk fails.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| M1. In every folder a `vitest/no-restricted-vi-methods` block lists, `vi.fn`, `vi.mock`, `vi.doMock`, `vi.spyOn` and `vi.stubEnv` are refused, and `vi.waitFor`, a comment, a string and another object's `fn` pass | lint | scenario: the plant lines of `VI_METHODS`, run in a file of each listed folder, as `REFLECT` is | delete `fn` from the new block of `.oxlintrc.json`: M1 red for `node/*.ts`. Amendment 2026-11-16 (lead ruling): the lock is the pair, and this law also runs `VI_PROPERTIES` (see the lock's amendment): drop the block's `vi` entries from `eslint/no-restricted-properties`, and its chained lines are not refused, red | oxlint-plugins/builtin-plants.ts, oxlint-plugins/plants.test.ts |
| M2. `RunnerAdmission.integration.test.ts` has no `vi` call and no import of `vi` | lint | lint | put back `getEntrypoint: vi.fn().mockReturnValue(box)`: `vitest(no-restricted-vi-methods)` red. Amendment 2026-11-16 (lead ruling): that line is a chained call, which the vitest rule alone takes; it is red through `eslint(no-restricted-properties)`, the pair's other half | next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts |
| M3. Both suites in the file keep every law they had: the runner admission suite and the project audit suite, with the same seeds, run counts and `required` coverage, and the audit walks still reach every case | test | scenario: the suites' own tapes, unchanged | make the process stub's `msg` answer `accepted` without asking `box.admit`: the audit suite's admission walk is red | next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts |
| M4. Each stub is typed by its `Env` binding: a member name `Env` lacks in `own` does not compile | type | type | rename `write` to `writ` in the record stub's `own`: red in the typecheck | next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts |

- M3 is the loosening check: every value the old law compared is still compared, and the reviewer
  runs the loosening grep on the diff.
- M4 is red only in a typecheck; the tests step runs one `effect-tsgo diagnostics` on libfabrika's
  tsconfig and says so.
- No law needs the real machine, so none is host-only (0178). M3 is an `.integration.` law already;
  no new one is added. No law reads a secret.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts | tests | tests | the four `vi.fn` become `Stub.make` over `Env`'s bindings; `unexpected` names the member; the `vi` import goes |
| .oxlintrc.json | tests | 0 | one override block for `next/packages/libfabrika/src/node/*.ts`, `vitest/no-restricted-vi-methods` at error with five messages |
| oxlint-plugins/builtin-plants.ts | tests | tests | `VI_METHODS`, the plant lines for M1, beside `REFLECT`; and (amendment 2026-11-16, lead ruling) the `VI_PROPERTIES` plant, the lock's other half |
| oxlint-plugins/plants.test.ts | tests | tests | M1: `VI_METHODS`' lines refused exactly in every folder of every block that sets the rule, as the `REFLECT` scenario does |
| field/runs/2026-11-15-mock-node-tests1.json | tests | docs | the tests step's run row, with its plants |
| next/packages/libfabrika/src/cloudflare/ProjectAuditTest.ts | tests | 0 | read only, not changed: its `Harness["environment"]` type is what the stubs fill |
| next/packages/vitest/src/Stub.test.ts | tests | 0 | read only, not changed: pull request 1433's L6, the helper's own laws |
| next/packages/libfabrika/tsconfig.json | tests | 0 | read only, not changed: the project M4's typecheck reads |
| next/packages/libfabrika/src/node/build/build-assets.integration.test.ts | tests | 0 | read only, not changed: named by the finding below, outside this slice |

- No product file changes, so no build step is expected. If the typecheck shows `Stub.make` itself
  must change, that change belongs to pull request 1433's slice, not here, and this slice waits.
- Every path above is an exam path, so all are the tests step's. No path is in pull request 1366's
  diff (read with `get_files`, 57 files, 2026-11-15).

## Calls taken

- **Wait for 1433's `Stub.make` and use it,** 95%. 0554 rules a law calls the shared helper.
- **Members Cloudflare's types refuse in `own` go by name in `rest`,** 70%. See the doubts.
- **The lock is `node/*.ts` with all five methods,** 85%. See "The shape".
- **No `Recorder`,** 90%. Nothing reads a call.
- **Is this a setting?** No. Which `vi` methods are refused, and where, is a rule on our own source,
  held by lint, and nothing a person running fabrika picks (0069).
- **What fact is lost if not recorded now?** None. The doubles live only inside one test run.

## Validation

- The tests step: `pnpm format`, then `pnpm lint` (with `NODE_OPTIONS=--max-old-space-size=6144` in
  a cloud box), then `nice -n 15 pnpm exec vitest run --maxWorkers=3 oxlint-plugins/plants.test.ts`
  and the same on `next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts`. One
  `pnpm exec effect-tsgo diagnostics --format json --project next/packages/libfabrika/tsconfig.json`
  for M4. Each plant is run once and recorded in the run row.
- The review reads the whole diff against this plan and runs the loosening check on M3.

## Steps

**Amendment (2026-11-15, merge session rulings 1 and 5).** The slice opens no pull request of its
own. It lands on the mock sweep's one fold branch, `fabrikalfa/mock-fold`, in its one pull request
(0589, amended 2026-11-15), after its own steps, one fresh agent each, in its own box:

1. **Tests:** M1 to M4, `VI_METHODS` and the lock block; each plant run once and recorded in the
   run row.
2. **Build:** no product file changes, so the build changes nothing, says so in its run row, and
   runs the checks under "Validation" green at the tests step's head, or sends back.
3. **Review:** the one review of the slice's diff, with the loosening check on M3.

M1 here is the sweep's one lock law: every other mock plan's lock runs this plan's `VI_METHODS` set
in its own paths (ruling 2).

## Size

One slice, on the fold branch named under "Steps". Confidence in the counts: 85%; the doubt is how
many members must go by name in `rest`. Counted on main at `f7169af` with `rg -c` in
`next/packages/libfabrika/src/node`:

| Where | `vi.fn` | `toHaveBeenCalled*` | `vi.spyOn` | `vi.mock` | `vi.doMock` | `vi.stubEnv` |
|---|---|---|---|---|---|---|
| top files (`node/*.ts`), this slice | 4 | 0 | 0 | 0 | 0 | 0 |
| `node/build` | 0 | 0 | 0 | 0 | 7 | 4 |
| `node/dev` | 0 | 2 | 15 | 2 | 0 | 6 |
| `node/client` | 0 | 0 | 3 | 0 | 0 | 0 |
| `node/repositories` | 0 | 0 | 1 | 0 | 0 | 0 |

1. The `RunnerAdmission` law on `Stub.make` and the lock for `node/*.ts`: 0 product lines, about 60
   test lines changed, about 25 lines of configuration, about 60 lint test lines. 25 lines.

Priced from the rows in `field/runs/` for 2026-11-10 to 2026-11-15 at list price, as the recorder
plan priced them: a tests step about $6, a review about $3, a fix round about $4. No build step was
expected; (amendment 2026-11-15, ruling 5) the build that only runs checks is about $2, as the
oxlint-plugins plan prices one. One likely fix round, for the `own` typing doubt.

Estimate: 4 steps, $15

## Records

- No decision file: this builds 0554, 0555, 0557 and 0579, and takes no new ruling.
- No glossary row: "stub" is already the industry's word, and 1433 coins nothing new.
- `field/`: one run row per step, the same day.
- The tracker ticket is 1067.

## What this cannot tell us

- **Whether the sketch compiles.** Nothing was compiled. The first typecheck tells, starting with
  the RPC-wrapped members of `own`.
- **Whether `Stub.make` lands as 1433's plan sketches it.** Its build has not run. If its
  signature changes, the sketch above follows it.
- **Whether `vitest/no-restricted-vi-methods` matches `vi.fn` through an import alias** (`import
  { vi as v }`). M1's plant lines try it and record what oxlint does; a miss is listed, not hidden,
  as `REFLECT` lists its alias miss.
- **The rest of the file's test style.** `register` runs a raw `fc.assert`, which 0579 retires; that
  is the property-law sweep's work, not this slice's.

## Open questions

None.

## Findings

```json
{"_tag": "finding", "id": "2026-11-15-node-build-mocks-have-no-slice", "date": "2026-11-15", "by": "plan", "model": "claude-opus-5-5", "rule": "rule_break", "location": {"path": "next/packages/libfabrika/src/node/build/build-assets.integration.test.ts", "line": 275}, "says": "In next/, node/build's laws call vi.doMock 7 times and vi.stubEnv 4 times (build-assets.integration.test.ts and build-one-file.integration.test.ts), which 0555 bans, and the recorder plan's slice table counts only vi.fn, toHaveBeenCalled and vi.spyOn, so no mock-sweep slice owns them.", "proof": "rg -c 'vi\\.doMock\\(|vi\\.stubEnv\\(' next/packages/libfabrika/src/node/build on main at f7169af: build-assets 5 and 1, build-one-file 2 and 3. docs/plan/quests/recorder-PLAN.md, Size, the folder table, has no row for node/build.", "cost": "The vi ban cannot reach node/** while these stay, and no plan is set to remove them.", "head": "f7169af", "ticket": null, "pr": null}
```
