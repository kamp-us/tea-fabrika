Approved by the lead agent, builds 0555, 0579; body 1eb901f14e92
Plancheck-Version: 3

# Plan: the mock sweep in `next/packages/libfabrika/src/node/repositories`, in next/

This is `next/` only. Today's app is not touched. It builds
[0555](../../../.decisions/0555-no-vi-mock-or-domock.md) (no `vi.mock`, `vi.doMock`, `vi.spyOn`
or `vi.stubEnv`) and [0579](../../../.decisions/0579-property-laws-use-it-prop.md) (calls are
watched with a `Recorder`, property laws are `it.effect.prop`), for one folder of the sweep the
[recorder plan](./recorder-PLAN.md#size) lists. Ticket 1067.

```ts
// The whole idea. Before: the test framework swaps a function of our own settings module.
const spy = vi.spyOn(SettingsSnapshot, "make");
spy.mockImplementation((group, resolved) =>
  original(group, resolved).pipe(Effect.map((saved) => ({ ...saved, hash: "wrong" }))),
);

// After (a sketch, not compiled): no swap. Make and read both hash through Effect's own `Digest`
// service. A Recorder over it records both hashes, and a fault in the second answer makes a
// bypassed `Snapshot.read` visible as a prepare that succeeds.
const layer = Recorder.layer(Digest.Digest, {
  digestHex: (algorithm, data) => answer(algorithm, data),
});
```

## Doubts, read these first

- **Is dropping the `values: {}` arm a loosening?** The old law had two faults: a wrong hash, and
  a snapshot with no values. The new law has only the wrong hash, since `Digest` is the one seam.
  My reading: no. What this law holds is that `prepare` does not bypass `Snapshot.read`, and the
  planted bypass still turns it red. That `read` refuses a snapshot with missing values is `read`'s
  own laws, `next/packages/libfabrika/src/settings/Snapshot.test.ts:187` (L5, "every declared
  value and origin is required") and `:234` (L6, "corrupt values or hashes fail"), which stay. 85% sure. The lead's read settles it; if the lead calls it a
  loosening, it goes to the owner (0014).
- **The `vi as v` alias.** 0555 says the lint rule may miss a renamed import. The tests step plants
  it and records what oxlint does. See the laws.

## What changes, in one paragraph

On `origin/main` at `f7169af`, the folder has one mock call: `vi.spyOn(SettingsSnapshot, "make")`
in `OpenRepository.test.ts:199`, inside law L3 "a malformed snapshot made upstream is refused". No
`vi.fn`, no `toHaveBeenCalled*`, no `vi.mock`, `vi.doMock` or `vi.stubEnv`. That law is rewritten to
watch Effect's `Digest` service with the Recorder, as `it.effect.prop` with Schema inputs, and the
`vi` import goes. Then oxlint's `vitest/no-restricted-vi-methods` turns on for the folder, which
is at zero. No product file changes, so there is no build step.

## The count

Counted on `origin/main` at `f7169af` with
`rg -n 'vi\.fn\(|toHaveBeenCalled|vi\.spyOn\(|vi\.mock\(|vi\.doMock\(|vi\.stubEnv\(' next/packages/libfabrika/src/node/repositories`,
one match per call:

| Call | Hits | Where | What it watches | What replaces it |
|---|---|---|---|---|
| `vi.spyOn` | 1 | `OpenRepository.test.ts:199` | `Snapshot.make` from `settings/Snapshot.ts`, made to answer a snapshot with a wrong hash or no values | a `Recorder.layer` over Effect's `Digest` service, with a fault in its second answer |
| `vi.fn`, `toHaveBeenCalled*`, `vi.mock`, `vi.doMock`, `vi.stubEnv` | 0 | | | |

This matches the recorder plan's row (0, 0, 1). The folder's hand-written call logs (`touches`
and `parsed` in the same file, the `Toml` wrapper at `OpenRepository.test.ts:106`) are not mocks
and are not counted. They could build on the Recorder later; this slice leaves them, since 0555
and the lint rule are about `vi` methods.

## How others do it

- **Effect's own way to watch a call is a service with a test layer.** `node_modules/effect/AGENTS.md`
  points tests at services with shared test layers; Effect 4.1.3's `Layer.mock`
  (`node_modules/effect/src/Layer.ts`) is what our Recorder wraps (0555's context).
- **Fault injection through a dependency, not a patch of the code under test.** This is
  Meszaros's "Test Stub" used for indirect input, the term the Recorder's own doc uses
  (`next/packages/vitest/src/Recorder.ts:1`). The stub here is the `Digest` the code already asks
  for; nothing in the code changes.
- **The service is Effect's.** `Digest` is `effect/crypto`'s `Context.Service` with two members,
  `digest` and `digestHex`, neither overloaded and neither able to fail
  (`node_modules/effect/src/crypto/Digest.ts:135-143`, effect 4.1.3). So the Recorder takes it
  (an overloaded method would not compile, Recorder law R16), and its `fails` option is not used,
  since a method that cannot fail cannot be named there (R3).

## The shape

`Snapshot.make` and `Snapshot.read` both hash the values with the same private helper, and that
helper asks for `Digest`:

```ts
// next/packages/libfabrika/src/settings/Snapshot.ts:50-57, on main
const hashValues = Effect.fnUntraced(function* (values: Snapshot["values"]) {
  // ...sorted JSON of the values
  const digest = yield* Digest.Digest;
  return yield* digest.digestHex(Digest.sha256, new TextEncoder().encode(text));
});
```

`Load.load` calls `make`, then `read` on what `make` gave (`node/settings/Load.ts:108-118`). So one
`prepare` runs `digestHex` twice over the same bytes: once to make the hash, once to check it. In
this law nothing else asks for `Digest`: `Repositories` is the law's own `reader` stub, and
`RepositoriesGit` is not in the layer.

The law's layer, a sketch:

```ts
// next/packages/libfabrika/src/node/repositories/OpenRepository.test.ts, a sketch, not compiled.
import { Recorder } from "@kampus/vitest";
import { Digest } from "effect/crypto";

/** Answers the true hash, except that the run numbered `wrong` gets a hash with one digit changed. */
const digests = (wrong: Option.Option<number>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const real = yield* Effect.provide(Digest.Digest, Digest.layerWebCrypto);
      const runs = yield* Ref.make(0);
      return Recorder.layer(Digest.Digest, {
        digestHex: (algorithm, data) =>
          Effect.zipWith(real.digestHex(algorithm, data), Ref.getAndUpdate(runs, (n) => n + 1), (hex, n) =>
            Option.contains(wrong, n) ? flip(hex) : hex,
          ),
      });
    }),
  );

// flip: the first hex digit changed ("0" to "1", else "0"), as Snapshot.test.ts:278 does.
```

`digest` is left out of `impl`, so a call of it dies with `UnimplementedError` (Recorder law R10):
the law then also tells us if the code starts hashing another way. The layer is provided after
`services`, so its `Digest` is the one the code sees.

The law, a sketch:

```ts
// a sketch, not compiled
it.effect.prop(
  "L3: a snapshot whose saved hash does not check is refused, never returned unchecked",
  { wrong: Schema.Boolean },
  ({ wrong }) =>
    Effect.gen(function* () {
      const result = yield* OpenRepository.prepare("selected-repo", options).pipe(Effect.exit);
      const runs = yield* Recorder.calls(Digest.Digest, "digestHex");
      // make hashed, then read hashed the same bytes again
      expect(runs).toHaveLength(2);
      expect(runs[1]).toEqual(runs[0]);
      expect(Exit.isFailure(result)).toBe(wrong);
    }).pipe(
      Effect.provide([reader("", []), FileSystem.layerNoop({ readFileString: () => Effect.succeed("") })]),
      Effect.provide(digests(wrong ? Option.some(1) : Option.none())),
      Effect.provide(services),
    ),
);
```

- **Inputs are Schemas** (0579): `wrong` is `Schema.Boolean`, and the seed is the package's. The
  old law's `fc.array(fc.nat())` only picked which of two faults to plant, so it has no input of
  its own to keep. The tests step may add the repo document text as a second input, drawn from the
  `docs` list the first L3 law uses (`OpenRepository.test.ts:120`), so the fault is tried on more
  than one settings shape.
- **Its title stays "L3"**, the label the file already uses, so the field rows and the T878 plan
  still find it.
- **A failure is checked as this failure,** not only as a failure of `prepare`, as the old law
  did. `Load.ts:110-117` turns `read`'s `SnapshotError` into a `SettingsError` with reason
  `invalid`, and `documentFailed` (`OpenRepository.ts:39`) turns that into an
  `OpenRepositoryError` whose reason is `InvalidDocument`, with the `SettingsError` redacted in its
  `cause`. So the law checks the reason's `_tag` is `InvalidDocument`, and that the redacted
  cause's own `cause` is a `SnapshotError`, so a failure from somewhere else does not pass for
  this one.
- **After `@kalfa/config` ([pull request 1427](https://github.com/kamp-us/tea-fabrika/pull/1427)).**
  Its slice 2 moves `Snapshot.ts` and `Load.ts` to `kalfa/config/src/` with `git mv`, and its
  slice 1 makes `Load` generic. That changes this plan in one way, and for the better: the law no
  longer names `SettingsSnapshot.make` at all, so the move cannot break it. A `vi.spyOn` on a
  namespace that then lives in another package would also stop reaching the call `Load` makes
  inside that package. `Digest` is Effect's and stays where it is. Neither slice waits on the
  other. If 1427's slice 2 lands first, this law's other imports from `settings/` (the first L3
  law's `SettingsSnapshot.read` and `Declarations`) take the new specifiers, which 1427's own
  table does for every file it lists; `OpenRepository.test.ts` is not in its table today, so the
  tests step here checks the imports against main when it starts.

## The lock

oxlint's own `vitest/no-restricted-vi-methods` holds 0555, as 0555 names it. It is not set
anywhere in `.oxlintrc.json` on main (`rg -n no-restricted-vi-methods .oxlintrc.json` finds
nothing), so this slice adds it, on for this folder, which reaches zero in this slice:

```jsonc
// .oxlintrc.json, a new override block, a sketch. No other block sets this rule, so where it
// sits does not change which options win. The entries follow 0555's sketch, plus `fn` (0579).
{
  // 0555, 0579: no vi mock in next/; each folder joins this list the day it reaches zero.
  "files": ["next/packages/libfabrika/src/node/repositories/**"],
  "rules": {
    "vitest/no-restricted-vi-methods": [
      "error",
      {
        "mock": "Give the code a service and provide a test layer (0555).",
        "doMock": "Give the code a service and provide a test layer (0555).",
        "spyOn": "Put the call behind a service and record it with a Recorder (0555, 0579).",
        "stubEnv": "Read through Config and provide a ConfigProvider layer (0555).",
        "fn": "Watch the call with a Recorder over its service (0579)."
      }
    ]
  }
}
```

- **This is 0168's form:** a rule turns on for each folder when it reaches zero. It is not a list
  of leftovers (0524). No block turns it off for a dirty folder.
- **`fn` is in the list** because 0579 says the Recorder replaces the `vi.fn` uses too, and this
  folder has none. 85% sure; the doubt is only whether later slices want one shared message.
- **If another mock slice lands its block first,** this slice adds its folder to that block's
  `files` and does not add a second one. Which slice turns the rule on for the folders already at
  zero is the sweep's order, not this plan's.
- **The plants** (amendment 2026-11-15, ruling 2: one lock shape, so these are node's shared
  `VI_METHODS` set, with this plan's lines added to it, and node's M1 is the law) go in
  `oxlint-plugins/builtin-plants.ts` as one `Plant` beside `REFLECT`, run by
  `oxlint-plugins/plants.test.ts` under a `*.test.ts` name inside this folder, the way the REFLECT
  plant runs in every folder a block lists.

## One value traced: a bypassed `read`

1. A builder changes `Load.ts:109` to return `{ values: resolved.values, snapshot: saved }`,
   skipping `Snapshot.read`.
2. The law runs with `wrong: true`. `prepare` runs `make`, which calls `digestHex` once (run 0),
   and gets the true hash.
3. Nothing calls `digestHex` again, so run 1 never happens and the fault is never served.
4. `prepare` succeeds. The law reads `Recorder.calls(Digest.Digest, "digestHex")`: one run, not
   two. Red on the length, and red on `Exit.isFailure(result)` being `false`.
5. With `wrong: false` the length check is red too, so the bypass is caught even on the plain case.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L3 (rewritten). For a generated `wrong: Schema.Boolean`, `prepare` hashes the values twice over the same bytes, and it fails with `InvalidDocument` over a `SnapshotError` exactly when the second hash answers wrong | test, `it.effect.prop`, default runs, the package seed | Effect Arbitrary: Schema.Boolean | (a) `Load.ts` skips `Snapshot.read` and returns `make`'s snapshot: red on both cases; (b) `Load.ts` catches `read`'s failure and returns `make`'s snapshot: red when `wrong`; (c) `Snapshot.read` drops its hash compare (`Snapshot.ts:156`): red when `wrong` | next/packages/libfabrika/src/node/repositories/OpenRepository.test.ts |
| V1. In this folder, `vi.mock`, `vi.doMock`, `vi.spyOn`, `vi.stubEnv` and `vi.fn` are refused, with 0555's messages; `vi.hoisted` passes, since 0555 does not decide it. Amendment 2026-11-15 (merge session ruling 2): this is node's M1 run in this folder, its lines node's shared `VI_METHODS` set, to which `vi.hoisted` is added as a line that passes | lint | lint | delete one entry from the block: that line is not refused, red | oxlint-plugins/builtin-plants.ts, oxlint-plugins/plants.test.ts |
| V2. The alias `import { vi as v } from "vitest"; v.spyOn(o, "m")` in this folder: the tests step plants it and records what oxlint does. If it is refused, it is a planted line of V1. If it is not, it goes in the plant as a line that passes, with a comment naming the gap, and a finding row says so; no hand-written rule is added (0573: a trusted rule first) | lint | lint | as V1 | oxlint-plugins/builtin-plants.ts |

No law here needs a real resource: `Digest.layerWebCrypto` is in-process, and the `reader` stub and
`FileSystem.layerNoop` stand in for git and the disk. So L3 runs on every pull request and is not
an `.integration.` file (0536, 0581). No host-only law.

The other laws in `OpenRepository.test.ts` keep their bodies. The first L3 law and L9 still use
`fc.assert` with a hand seed; moving them to `it.effect.prop` is 0579's own sweep, not this one.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/node/repositories/OpenRepository.test.ts | tests | tests | L3 "malformed snapshot" rewritten as above; the `vi` import goes; `Recorder`, `Option` and `Ref` imports come in |
| .oxlintrc.json | tests | configuration | the block above, or this folder added to an existing block for the rule |
| oxlint-plugins/builtin-plants.ts | tests | tests | V1's and V2's planted lines |
| oxlint-plugins/plants.test.ts | tests | tests | run the plant under a test file name in this folder |
| next/packages/libfabrika/src/settings/Snapshot.test.ts | tests | tests | unchanged: L5 and L6 hold the `values: {}` fault; named so the review reads them |
| oxlint-plugins/README.md | tests | docs | one row for `vitest/no-restricted-vi-methods`, naming 0555 and the folders it is on for |
| field/runs/2026-11-16-mock-node-repositories-tests1.json | tests | docs | the tests step's run row, with each plant's result |
| field/runs/2026-11-16-mock-node-repositories-review1.json | review | docs | the review's run row |

No product file changes. So there is no build step: the rewritten law is green on main's product
code, and its plants show it is live. (Amendment 2026-11-15, merge session ruling 5: the build
step still runs, changes nothing, says so, and runs the checks green; see "Steps".)

## Steps

**Amendment (2026-11-15, merge session rulings 1 and 5).** The slice opens no pull request of its
own. It lands on the mock sweep's one fold branch, `fabrikalfa/mock-fold`, in its one pull request
(0589, amended 2026-11-15), after these steps, one fresh agent each, in its own box. Step 2 was
"none"; it now runs.

1. **Tests:** writes L3, V1 and V2, runs each plant once and puts it back, and records the results
   in its run row. Runs `nice -n 15 pnpm exec vitest run --maxWorkers=3` on
   `next/packages/libfabrika/src/node/repositories/OpenRepository.test.ts` and
   `oxlint-plugins/plants.test.ts`, then `pnpm lint`.
2. **Build:** no product file changes, so the build changes nothing, says so in its run row, and
   runs the tests step's paths and `pnpm lint` green at the tests step's head, or sends back
   (amended 2026-11-15; first "none").
3. **Review:** the one review of the whole diff against this plan, 0555 and 0579, and the lead's
   read of the doubt above.

## Calls taken

- **The seam is Effect's `Digest`, not a new service around `Snapshot`.** 0555 says a stand-in
  comes from the code's own design, and the code already asks for `Digest` at both ends of the
  boundary. A `Snapshots` service made only so a law can swap `make` would be a product change
  for a test's sake. 90%.
- **The `values: {}` fault leaves this law** and stays held by `Snapshot.test.ts` L5 and L6. See the
  doubts. 85%.
- **The lock covers this folder only,** plus `fn`. 85%.
- **Is anything here a setting?** No: a law's fault and a lint block are not choices a person
  makes (0069).
- **What fact is lost if not recorded now?** None: this changes tests and lint only. The run rows
  record each plant's result the day it runs.

## Validation

- `plancheck.sh --draft` on this file.
- The tests step's narrow vitest runs and `pnpm lint`, as in Steps, at its pushed head.

## Size

One slice, landing whole on the sweep's one fold branch, `fabrikalfa/mock-fold` (amended
2026-11-15; first "one pull request"). 0 product lines. Confidence 80%: the doubt is whether
`Layer.unwrap` and the Recorder type `digestHex` as sketched, which the first run tells.

1. The law and the lock: about 50 test lines changed in `OpenRepository.test.ts`, about 20 lines
   of configuration, about 30 lines of plants, about 5 lines of prose. 0 lines.

Priced from the rows in `field/runs/` for 2026-11-10 to 2026-11-15 at list price, as the recorder
plan priced them: a tests step about $6 and a review about $3. This tests step is small, so $5;
one likely send-back on the `values: {}` doubt, $4. (Amendment 2026-11-15, ruling 5: a build that
only runs checks, about $2, as the oxlint-plugins plan prices one.)

Estimate: 4 steps, $14

## Records

- No decision file: this builds 0555 and 0579 and takes no new ruling.
- No glossary row: no new word.
- `field/`: one run row per step, the same day.

## What this cannot tell us

- **Whether any block here compiles.** None was compiled or run. The first run tells, starting
  with `Layer.unwrap` around `Recorder.layer` and `Effect.provide(Digest.Digest, ...)`.
- **What oxlint does with `vi as v`.** V2 finds out.
- **Whether `toHaveBeenCalled*` needs a rule of its own.** This folder has none. A matcher with no
  `vi.fn` to call it on has nothing to watch, so `fn` in the list may be enough; not checked.
- **Whether a later change makes `prepare` hash a third time** (a repository key, say). The length
  check would then go red for a good reason, and the law's count changes with it.

## Open questions

None.
