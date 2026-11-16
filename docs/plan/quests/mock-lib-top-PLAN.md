
Plancheck-Version: 3

# Plan: the mock sweep in libfabrika's top `src/` files (`Id`, `Id.cause`, `check`), in next/

This is `next/` only: `next/packages/libfabrika/src/Id.ts`, the tests beside it, and the lint
config that locks the folder. Today's app is not touched. It builds
[0555](../../../.decisions/0555-no-vi-mock-or-domock.md) (no `vi.spyOn` in `next/`: a call goes
through a service) and [0579](../../../.decisions/0579-property-laws-use-it-prop.md) (the
Recorder is the one way to watch calls), on the shape of
[`.patterns/effect-crypto-through-services.md`](../../../.patterns/effect-crypto-through-services.md)
(random bytes come from Effect's `SecureRandom`). It is one row of the sweep list in
[`recorder-PLAN.md`, "Size"](./recorder-PLAN.md#size): "`libfabrika/src` (top: `Id`, `Id.cause`,
`check`) | 0 | 0 | 10 | `crypto.getRandomValues` 9, `check.run` 1".

```ts
// The whole idea. A sketch, not compiled.
// Before: Id.ts:131 reads the global, and nine laws swap it behind the code's back.
const entropy = (): bigint => crypto.getRandomValues(new Uint8Array(10)).reduce(/* ... */) & maxRandom;
vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => array.fill(0));

// After: the generator asks for SecureRandom, the edge layer gives WebCrypto, a law gives bytes.
export const makeGenerator: Effect.Effect<Generator["Service"], never, SecureRandom.SecureRandom>;
// Id.test-support.ts
export const generatorWith = (fill: (size: number) => Uint8Array): Layer.Layer<Id.Generator> =>
  Layer.effect(Id.Generator, Id.makeGenerator).pipe(
    Layer.provide(Layer.succeed(SecureRandom.SecureRandom, SecureRandom.make(fill))),
  );
it.effect.prop("...", { at: Time }, ({ at }) => law.pipe(Effect.provide(generatorWith((size) => new Uint8Array(size)))));
```

## Doubts, read these first

- **The `check.run` law (Id.test.ts:975) loses its window into allocation order** (80% sure the
  rewrite below is at least as strong). The spy records each id at the moment the generator's
  synchronous step decodes it, which is the only point that sees allocation order. No service
  sits there, and adding a hook to product code only for a law is worse. The rewrite checks the
  exact ids a reference model of the generator predicts for the schedule, so a lost update or a
  second reseed in one millisecond, which with fixed entropy always makes a duplicate, turns it
  red. The plant below (the T518 review 5 P1 shape) is what settles it: if the rewritten law stays
  green under that plant, the tests step sends it back here and it becomes an open question.
- **`Generator.layer` keeps providing WebCrypto inside itself** (open question 1). The pattern doc
  says the edge provides the crypto layer. About 50 files provide `Id.Generator.layer` today, and 3
  of them are in pull request 1366's diff (the two cloudflare files `connection.ts` and `runtime.ts`, and the app's
  `local-instance` integration test), which this slice may not touch.
- **Nothing here was compiled or run.** The installed versions were read: `effect` 4.1.3
  (`next/packages/libfabrika/node_modules/effect/package.json`).

## What changes, in one paragraph

`Id.ts` stops reading `globalThis.crypto`. A new `makeGenerator` builds the generator's service
from `SecureRandom.SecureRandom`, and `Generator.layer` becomes `makeGenerator` with
`SecureRandom.layerWebCrypto` provided, so no caller changes. `next` draws the 10 random bytes as an
Effect before its synchronous step, only when the millisecond is fresh, and keeps allocation
synchronous. A throw from the random source is a defect of `SecureRandom`, and the generator
translates it into `IdError({ reason: "entropy", cause })` as it does today. The ten spies go:
nine laws get their bytes from a `SecureRandom` made by `SecureRandom.make(fill)`, and the
`check.run` law checks the exact ids a model predicts. The top files then hold zero `vi` mocks,
and `vitest/no-restricted-vi-methods` goes on for them.

## How others do it

- **Effect:** randomness is a service. `SecureRandom.make(randomBytes)` builds the whole service
  from one synchronous byte function, and `SecureRandom.layerWebCrypto` is that function over the
  `WebCrypto` reference (`effect/src/crypto/SecureRandom.ts:83`, `:143`, read in 4.1.3). A test
  provides its own `make(fill)`; Effect ships no test layer for it. Every operation has a `never`
  error channel, and "a bad size or an empty range is a defect" (the module doc), so a throw from
  `fill` dies.
- **Effect on translating a defect:** `Effect.catchDefect` is "for when you need to report or
  translate defects at integration boundaries" (`effect/src/Effect.ts:5871`, `@stability stable`).
  The generator is that boundary: it turns the platform's failure into its own typed error, as
  decision 0043 rule 12 asks of a module.
- **The industry:** a random source passed in, not read from a global, is the plain dependency
  injection that lets a UUIDv7 maker be tested with fixed bits; RFC 9562 section 6.2 (the monotonic
  counter methods the generator follows) assumes the random bits come from a CSPRNG the
  implementation is handed. Cited from memory, not fetched.
- **Why not `SecureRandom.uuidV7`:** its layout is a 42-bit counter plus 32 fresh random bits per
  id (`SecureRandom.ts`, the `uuidV7` doc), not the generator's 74-bit random field that counts up.
  Switching would change every id's bits and the `exhausted` edge, which the laws hold. The
  pattern doc's open line "whether `SecureRandom.uuidV7` can replace it is not checked" is now
  checked: not without a format change, which is not this slice.

## The shape

```ts
// next/packages/libfabrika/src/Id.ts. A sketch, not compiled.
import { SecureRandom } from "effect/crypto";

const toRandom = (bytes: Uint8Array): bigint => bytes.reduce((n, byte) => (n << 8n) | BigInt(byte), 0n) & maxRandom;

const validClock = (now: number): boolean => Number.isSafeInteger(now) && now >= 0 && now <= maxTime;

/** The generator's service, drawing its random bits from SecureRandom. */
export const makeGenerator: Effect.Effect<Generator["Service"], never, SecureRandom.SecureRandom> = Effect.gen(
  function* () {
    const secure = yield* SecureRandom.SecureRandom;
    let at = -1,
      random = 0n;
    // The draw is an Effect, so it runs before the synchronous step. `at` only grows, so a
    // millisecond that is fresh at the step was fresh at the draw, and `fresh` is there when needed.
    const draw = secure.randomBytes(10).pipe(
      Effect.map(toRandom),
      Effect.catchDefect((cause) => Effect.fail(new IdError({ reason: "entropy", cause }))),
    );
    // Keep allocation and validation synchronous so fibers observe IDs in allocation order.
    const allocate = <P extends string>(schema: IdSchema<P>, prefix: string, now: number, fresh: bigint | undefined) => {
      let nextAt = at,
        nextRandom = random;

      if (now > at && fresh !== undefined) {
        nextAt = now;
        nextRandom = fresh;
      } else if (random === maxRandom) {
        if (at === maxTime) {
          throw new IdError({ reason: "exhausted" });
        }

        nextAt++;
        nextRandom = 0n;
      } else {
        nextRandom++;
      }

      at = nextAt;
      random = nextRandom;
      return Result.getOrThrowWith(
        S.decodeUnknownResult(schema)(`${prefix}_${encode(at, random)}`),
        (cause) => new IdError({ reason: "prefix", cause }),
      );
    };
    return {
      next: Effect.fn("id.next")(function* <P extends string>(schema: IdSchema<P>) {
        const prefix = prefixes.get(schema);

        if (prefix === undefined) {
          return yield* new IdError({ reason: "prefix" });
        }

        yield* Effect.annotateCurrentSpan({ type: prefix });
        const now = yield* Clock.currentTimeMillis;

        // The clock is checked before any draw, so a bad clock is `clock` even when entropy fails.
        if (!validClock(now)) {
          return yield* new IdError({ reason: "clock" });
        }

        const fresh = now > at ? yield* draw : undefined;
        return yield* Effect.try({
          try: () => allocate(schema, prefix, now, fresh),
          catch: (error) => (error instanceof IdError ? error : new IdError({ reason: "entropy", cause: error })),
        });
      }),
    };
  },
);

export class Generator extends Context.Service<Generator, { /* unchanged */ }>()("@kampus/libfabrika/Id.Generator") {
  // Callers keep one layer that needs nothing (open question 1).
  static readonly layer: Layer.Layer<Generator> = Layer.effect(Generator, makeGenerator).pipe(
    Layer.provide(SecureRandom.layerWebCrypto),
  );
}
```

- `makeGenerator` is used by `Generator.layer` and by the test support, so `pnpm lint:dead` keeps it.
- The `catch` in `Effect.try` stays: it still maps a throw inside the synchronous step that is not
  an `IdError`. The builder may narrow its reason if no such throw can happen now; that is a
  build call, since no law reads it.
- One behavior moves, on purpose: today the draw happens inside the synchronous step only when the
  millisecond is fresh there. Now two fibers that both see a fresh millisecond both draw, and the
  second one's bytes are not used. If the second draw fails, that fiber fails with `entropy` where
  today it would have counted up. A random source that fails once fails for both, so no law or
  caller sees the difference; it is written here so the review does not have to find it.
- The header comment of `Id.ts` ("No platform or other libfabrika layer is needed") becomes "It
  draws random bits from Effect's SecureRandom; `Generator.layer` provides the WebCrypto one."

```ts
// next/packages/libfabrika/src/Id.test-support.ts, added. A sketch.
import { SecureRandom } from "effect/crypto";

/** Id.Generator over random bytes the law writes. A throw in `fill` is a defect, as WebCrypto's is. */
export const generatorWith = (fill: (size: number) => Uint8Array): Layer.Layer<Id.Generator> =>
  Layer.effect(Id.Generator, Id.makeGenerator).pipe(
    Layer.provide(Layer.succeed(SecureRandom.SecureRandom, SecureRandom.make(fill))),
  );

/** Every byte is `byte`. */
export const bytes = (byte: number) => (size: number) => new Uint8Array(size).fill(byte);

/** The random source throws `failure`, as a platform with no entropy left does. */
export const throws = (failure: unknown) => (): never => {
  throw failure;
};
```

**Why not the Recorder.** None of the ten spies watches a call: each one only stands in the bytes.
So the replacement is an in-memory `SecureRandom` (Effect's own `make`), and no law reads a call
list. The Recorder could not wrap `SecureRandom` anyway: its `uuidV4` and `uuidV7` are overloaded
(`UuidGenerator` has two call signatures), and the Recorder refuses a service with an overloaded
method (law R16 of the Recorder's type laws, as the Recorder pattern doc
says).

## The ten sites, before and after

Counted again on main at `f7169af` with `rg -n 'vi\.|toHaveBeenCalled' *.test.ts` in
`next/packages/libfabrika/src/`: 0 `vi.fn`, 0 `toHaveBeenCalled*`, 10 `vi.spyOn`, all in two files.
`Id.types.test.ts`, `Testing.test.ts` and the other top files have none.

| Site | Law | What the spy does | After |
|---|---|---|---|
| `Id.cause.test.ts:22` | C1, a thrown value is `entropy` with it as `cause` | throws a generated failure | `generatorWith(throws(failure))` for the failing call, built after the good ids. The good ids share one millisecond, so they draw once: the fill answers its first call and throws `failure` from the second, the draw for the millisecond `TestClock.adjust` opens |
| `Id.test.ts:599` | built-in prefixes generate UUIDv7 bursts | all bytes 0 | `generatorWith(bytes(0))` |
| `Id.test.ts:669` | `next(schema)` encodes the clock at both edges | all bytes 0 | `generatorWith(bytes(0))` |
| `Id.test.ts:736` | exhausted random bits advance the logical clock | all bytes 255 | `generatorWith(bytes(255))` |
| `Id.test.ts:773` | bad clocks fail `clock`, even when entropy fails | throws, in the `failing` pass | the `failing` pass provides `generatorWith(refuses(marker))` (the file's own helper, `Id.test.ts:166`), the `working` pass `Id.Generator.layer` |
| `Id.test.ts:808` | random-bit overflow at the last millisecond fails typed | all bytes 255 | `generatorWith(bytes(255))` |
| `Id.test.ts:880` | an entropy failure is a typed IdError, never a defect | throws | `generatorWith(refuses(marker))` |
| `Id.test.ts:906` | a fresh millisecond takes its bits from entropy | bytes from generated `raw` | `generatorWith((size) => Uint8Array.from({ length: size }, (_, i) => raw[i % raw.length]!))` |
| `Id.test.ts:982` | shared fibers allocate unique, increasing ids | all bytes `schedule.entropy` | `generatorWith(bytes(schedule.entropy))` |
| `Id.test.ts:975` | the same law: allocation order | spies on the id format check's `run` to log ids as they are decoded | goes; the law checks the exact ids a model predicts (below) |

Every `try`/`finally` with `mockRestore` goes with its spy: the layer is scoped to the law's own
provide, so nothing is left to restore (0061). `vi` leaves both files' imports.

The C1 law keeps its own shape (`fc.assert` over `Effect.runPromise`). Moving it to
`it.effect.prop` is 0579's sweep, not this one; the tests step may do it in the same edit only if
the first failing case stays the same, as 0579 asks.

### The allocation-order law, rewritten

```ts
// Id.test.ts, inside checkSchedule. A sketch.
// The generator's rule, written again from RFC 9562's counter method: a fresh millisecond takes the
// 74 bits of `entropy`, a repeated one counts up, and the all-ones field moves the clock by one.
const predicted = (schedule: Schedule): ReadonlyArray<string> => {
  const seed = BigInt.asUintN(74, BigInt(`0x${schedule.entropy.toString(16).padStart(2, "0").repeat(10)}`));
  let at = -1, random = 0n;
  const ids: Array<string> = [];
  const one = (now: number) => {
    if (now > at) { at = now; random = seed; }
    else if (random === (1n << 74n) - 1n) { at++; random = 0n; }
    else { random++; }
    ids.push(wire(schedule.type, layout(at, random)));
  };
  for (const batch of schedule.batches) {
    for (const _ of batch.work) one(batch.at);
    one(batch.at); // the later call after each burst
  }
  return ids;
};

expect([...returned].sort(compare)).toEqual(predicted(schedule));
```

`wire` is the test file's own encoder; `layout(at, random)` packs the bits with its own code, not
`Id.ts`'s `encode`, so an encoder mistake is not copied into the model. The tests step picks the
names. Every batch is a fresh millisecond or a rollback, and the model follows both, as the
generator does: with `at` rolled back, the counter keeps counting.

## One value traced: a fresh millisecond with zero bytes

1. A law provides `generatorWith(bytes(0))` and sets the test clock to `1000`.
2. `next(Id.Process)` finds the prefix `process`, reads `now = 1000`, and `validClock(1000)` holds.
3. `at` is `-1`, so `now > at`: `draw` runs `secure.randomBytes(10)`, which is `fill(10)`, ten zero
   bytes, so `fresh = 0n`.
4. The synchronous step sees `now > at` and `fresh` given: `at = 1000`, `random = 0n`, and the id is
   `process_` plus the suffix of `encode(1000, 0n)`, decoded by `Id.Process`.
5. The next call in the same millisecond reads `now = 1000`, `now > at` is false, so it does not
   draw, and the step counts up to `random = 1n`.
6. If `fill` had thrown `marker`, step 3's `randomBytes` dies with `marker`, `catchDefect` turns it
   into `IdError({ reason: "entropy", cause: marker })`, and `next` fails with it, never a defect.

## Laws

Property laws stay as they are written (`it.effect.prop` with Schemas, or `fc.assert` where the
file already has it), with the shared seed 119120. No law is deleted or loosened: each keeps its
assertions, and only where its bytes come from changes.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| T1. The nine entropy laws above hold with their bytes from `SecureRandom` | test | Effect Arbitrary: Time | make `draw` read `crypto.getRandomValues` again in place of `secure.randomBytes`: the zero, 255 and `raw` laws go red | next/packages/libfabrika/src/Id.test.ts, next/packages/libfabrika/src/Id.cause.test.ts |
| T2. A throw from the random source is `IdError` `entropy` with the thrown value as `cause`, never a defect (C1 and `Id.test.ts:880`) | test | fc.record: failures of three kinds, prefixes, `before` 0 to 3 | drop the `catchDefect`: the generator dies, C1 red. 100 runs, as today | next/packages/libfabrika/src/Id.cause.test.ts |
| T3. A bad clock is `clock` even when the random source throws (`Id.test.ts:773`) | test | Effect Arbitrary: Count | move the clock check after the draw: the `failing` pass answers `entropy`, red | next/packages/libfabrika/src/Id.test.ts |
| T4. Shared fibers give exactly the ids the model predicts, over generated schedules and the pinned four-fiber case | test | fc.record: prefix, entropy byte, 2 to 6 batches of 2 to 8 fibers with 2000 to 2070 yields, and pinned: the four-fiber case | the T518 review 5 P1 shape: in `allocate`, take `fresh` whenever it is given, without `now > at`, so four fibers that drew for one millisecond each reseed it: duplicates, red. A second plant: an `Effect.yieldNow()` between reading and writing `at`, red. 40 runs, as today | next/packages/libfabrika/src/Id.test.ts |
| T5. `Generator.layer` needs nothing, and `makeGenerator` needs `SecureRandom` | type | type | drop the `Layer.provide(SecureRandom.layerWebCrypto)` from `Generator.layer`: red | next/packages/libfabrika/src/Id.types.test.ts |
| L1. The top files of libfabrika's `src/` refuse `vi.mock`, `vi.doMock`, `vi.spyOn` and `vi.stubEnv` | lint | lint | delete the `spyOn` entry from the block in `.oxlintrc.json`: the `vi.spyOn` plant line is not refused | oxlint-plugins/builtin-plants.ts, oxlint-plugins/plants.test.ts |

- **T4's plant must turn it red,** or the doubt at the top holds and the law comes back here.
- **L1's plant set** is written as `REFLECT` is in `oxlint-plugins/builtin-plants.ts`: a `VI_METHODS`
  plant with one refused line per method, one line that passes (`vi.fn()`, which 0555 does not
  ban), and a renamed import (`import { vi as v } ...; v.spyOn(...)`), whose answer the tests step
  records, since 0555 says the lint pull request plants it to find out. `plants.test.ts` runs the
  lines in every folder the block lists, as its `REFLECT` scenario does, so each later slice's glob
  is checked by the same test.

## The lock

`vitest/no-restricted-vi-methods` is not set on main (`rg no-restricted-vi-methods .oxlintrc.json`
finds nothing). The first slice of the sweep to land adds it; if this one is first, it adds the
block, and a later slice adds its glob to the block's `files`:

```jsonc
// .oxlintrc.json, a new overrides block. A sketch; the option shape is 0555's, checked by L1.
{
  // 0555: no test framework mock in next/. Each folder joins when its sweep slice reaches zero.
  "files": ["next/packages/libfabrika/src/*.ts", "next/packages/libfabrika/src/*.tsx"],
  "rules": {
    "vitest/no-restricted-vi-methods": [
      "error",
      {
        "mock": "Give the code a service and provide a test layer (0555).",
        "doMock": "Give the code a service and provide a test layer (0555).",
        "spyOn": "Put the call behind a service and record it in the law's layer (0555).",
        "stubEnv": "Read through Config and provide a ConfigProvider layer (0555)."
      }
    ]
  }
}
```

The glob's `*` does not cross a `/`, so the subfolders, which still hold spies, stay out until
their slices; `pnpm lint` on main with this block is the proof (it fails if the glob reaches a
folder with a spy). If another slice lands first, this slice adds its two globs to that block, and
L1's plants run in this folder through the same scenario. No `LOCKED` row in the
Effect checks' lock test (that waits for pull request 1417).

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/Id.test.ts | tests | tests | nine spies go (`:599`, `:669`, `:736`, `:773`, `:808`, `:880`, `:906`, `:975`, `:982`), each law takes `generatorWith`; `checkSchedule` checks the model's ids; `vi` leaves the import |
| next/packages/libfabrika/src/Id.cause.test.ts | tests | tests | C1's spy goes; its fill throws on the named call; `vi` leaves the import |
| next/packages/libfabrika/src/Id.types.test.ts | tests | tests | T5 |
| next/packages/libfabrika/src/Id.test-support.ts | tests | tests | `generatorWith`, `bytes`, `throws` |
| oxlint-plugins/builtin-plants.ts | tests | tests | the `VI_METHODS` plant set |
| oxlint-plugins/plants.test.ts | tests | tests | the scenario runs `VI_METHODS` in every folder of the block |
| next/packages/libfabrika/src/Id.ts | build | 25 | `makeGenerator`, the draw before the synchronous step, `catchDefect`, `Generator.layer` over `layerWebCrypto`, the header comment |
| .oxlintrc.json | tests | 18 | the block above, or two globs added to it |
| .patterns/effect-crypto-through-services.md | build | docs | "Where it applies" no longer stops at `Id.ts`; the `uuidV7` line says what was checked; `Id.ts` joins the examples of a service asked for, with its bundled layer named |

No file of pull request 1366's diff is in this table (its 57 files were read with `get_files`).

## Calls taken

- **An in-memory `SecureRandom` from `SecureRandom.make`, not the Recorder and not a fake
  `WebCrypto`** (95%): the laws watch no call, the Recorder refuses `SecureRandom`'s overloads, and
  a fake `WebCrypto` must type a whole `Crypto` object, which needs a cast.
- **The draw runs before the synchronous step, and the step re-checks `now > at`** (90%): this keeps
  "allocation is synchronous" (the comment at `Id.ts:163` and law T4) with an Effect draw. Settled
  by the generator's own comment; the builder may shape it differently if T4 holds.
- **`catchDefect` translates the platform's failure** (85%): the laws say an entropy failure is a
  typed `IdError` with its cause, and Effect's doc names translating a defect at a boundary as
  `catchDefect`'s use. Deleting the `entropy` reason would delete laws, which this sweep may not do.
- **The test helpers sit in `Id.test-support.ts`** (90%), beside the service, as 0538 says.
- **Is this a setting?** No. The random source is a layer an edge picks, not a value a person sets.
- **What fact is lost if it is not recorded now?** None: this changes where bytes come from, not what
  is written.
- **The libfabrika test** in `next/AGENTS.md`: `Id.ts` is in libfabrika already, and any client
  would need it.

## Validation

- The tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3
  next/packages/libfabrika/src/Id.test.ts next/packages/libfabrika/src/Id.cause.test.ts
  next/packages/libfabrika/src/Id.types.test.ts oxlint-plugins/plants.test.ts`, red where the build
  is owed (T5, and every law that imports `generatorWith` before `makeGenerator` exists), then each
  plant above once, recorded in the step's report.
- The build: the same narrow paths, and `pnpm lint` with `NODE_OPTIONS=--max-old-space-size=6144`.
  The lead runs the changed-files test run, which reaches the ~50 files that provide
  `Id.Generator.layer` only through its unchanged type, and the one type check, which reads T5.
- No `.integration.` law and no host-only law: every law here runs on an in-memory layer.

## Size

Confidence in the line counts: 80%; the doubt is the model law, which may need more lines.

1. This slice, one pull request: about 25 product lines in `Id.ts`, 18 lines of lint config, about
   120 test lines changed in the two test files (the spies and their `try`/`finally` go, the model
   comes in), about 60 lines of plants and scenario, and about 10 lines of the pattern doc. 43 lines.

Priced as the recorder plan priced its steps from the rows in `field/runs/` for 2026-11-10 to
2026-11-15 at list price: a tests step about $6, a build about $5, a review about $3, a fix round
about $4. The tests step here carries the model law and the lint plants, so $6; the build is small,
so $4; one likely send-back, on T4, $4.

Estimate: 4 steps, $17

## Records

- `.patterns/effect-crypto-through-services.md`: edited in this pull request.
- No glossary row: this coins no word (`makeGenerator` and `generatorWith` are code names).
- No decision file: this plan builds 0555 and 0579, and its one open question waits for the owner.
- `field/`: one run row per step, the same day.
- The tracker ticket is 1067, the Recorder's, whose "Size" section lists this slice.

## What this cannot tell us

- **Whether any block here compiles.** None was compiled or run.
- **Whether T4's rewrite is as strong as the spy it replaces.** The argument is that every lost
  update makes a duplicate when entropy is fixed; the plant is the test of that argument, not a
  proof.
- **Whether `vitest/no-restricted-vi-methods` in the installed oxlint takes 0555's option shape**
  and catches a renamed `vi`. L1 runs it.
- **Whether the ~50 callers of `Id.Generator.layer` see any change.** By type they cannot; the
  changed-files run is what shows it.

## Open questions

1. **`Id.Generator.layer` keeps providing `SecureRandom.layerWebCrypto` inside itself, or every
   edge provides it.** The crypto pattern doc says the edge provides; its "Not yet" list names
   `Built.ts` for providing inside. Moving now touches about 50 files, 3 of them in pull request
   1366's diff, so it cannot be done in this slice whole. Lean: keep the bundled layer now, with
   `makeGenerator` for anyone who picks their own source, and no later slice unless the owner wants
   one. The
   other way: this slice moves the ~47 free edges, and a slice after 1366 moves the last 3 and drops
   the bundled layer. 75% sure of the lean; the doubt is whether the pattern rule is meant to bind
   a layer every caller uses.
