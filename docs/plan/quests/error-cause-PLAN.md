
Plancheck-Version: 3

# Plan: every error's cause is `Schema.Defect()` or `Schema.optional(Schema.Defect())`, never `optionalKey`

`next/` and our tooling (the lead and step scripts under `.agents/`, `oxlint-plugins/`,
`.github/ci/`). Today's app is not touched. It builds
[0568](../../../.decisions/0568-error-cause-follows-effect.md) (owner, 2026-11-15, merged as
https://github.com/kamp-us/tea-fabrika/pull/1376 while this plan was written): a cause every caller always has is
`cause: Schema.Defect()`; a cause that may be missing is `cause: Schema.optional(Schema.Defect())`;
never `Schema.optionalKey` on a cause; ordinary optional fields keep `optionalKey`. It is one of the
fixes of the sev0 called the same day, so it ends with every cause in the scope in one of the two
forms, held by a lint rule at zero.

```ts
// before: next/packages/libfabrika/src/settings/Files.ts:29, and 11 more like it
cause: Schema.optionalKey(Schema.Defect()),
// after: some caller has no cause (Files.ts:98 makes an `invalid` error from a rule, not a failure)
cause: Schema.optional(Schema.Defect()),

// before: next/packages/libfabrika/src/gateway/GatewayNonce.ts:52. A required cause, filled with
// nothing because "a key of the wrong length decoded fine: no failure to keep".
return yield* new GatewayError({ reason: new Storage({ cause: undefined }) });
// after: Storage's cause is optional, and the site says what it means
return yield* new GatewayError({ reason: new Storage({}) });

// before: next/packages/libfabrika/src/permissions/Relations.ts:27. All three callers pass one.
cause: Schema.optionalKey(Schema.Defect()),
// after: the compiler now refuses a fourth caller that forgets it
cause: Schema.Defect(),
```

## Doubts, at the top (owner away)

Each is a call taken, with its lean. None contradicts a decision, so none is an open question.

- **The product's call sites decide, and a test fake follows them** (75%). Two errors are made
  with a cause at every product site, and only a test fake leaves it out: `JournalError`
  (`next/packages/libfabrika/src/client/Commands.test-support.ts:134`, `:146`) and
  `MailDeliveryError` (`next/packages/libfabrika/src/runtime/ReloadTest.ts:545`). They become
  required, and the fakes pass a generated cause. The doubt: the ruling says "every caller", and a
  fake is a caller. The lean holds because a fake that makes an error the product never makes shows
  an agent a shape that cannot happen ([0562](../../../.decisions/0562-nothing-teaches-the-wrong-shape.md)).
  What would settle it: the owner reading this line. If he says no, those two stay optional, and
  slices 2 and 3 each lose one row; nothing else moves.
- **The five audit errors take `Schema.Defect()` and lose `disallowJsonEncode`** (75%).
  `next/packages/libfabrika/src/runtime/Audit.ts:12` writes their cause as
  `Schema.optionalKey(Schema.Redacted(Schema.Unknown, { disallowJsonEncode: true }))`. The ruling's
  principle covers every error's cause, so these take `Schema.optional(Schema.Defect())`, and every
  caller keeps passing `Redacted.make(cause)`, as 23 other product sites already do into a
  `Defect()` field (for example `next/packages/libfabrika/src/node/launchd/BrainControlLaunchd.ts:45`).
  What then keeps the secret out is Redacted's own JSON form: Effect 4.1.2's `Defect` encodes a
  non-Error value through `formatJson` (`effect/src/SchemaTransformation.ts:1364`), and
  `Redacted.toJSON` prints `<redacted>` (`effect/src/Redacted.ts:209-213`). Law L6 plants a secret
  and checks every output. The doubt: the old schema refused to encode at all, which is stronger
  than "encodes as `<redacted>`". `Answer` carries no cause across the audit RPC either way
  (`Audit.ts:67-69`).
- **`ProgramDown`'s cause takes `Schema.optional(Schema.Defect())` in place of
  `Schema.optionalKey(Schema.Unknown)`** (80%). It crosses the Worker RPC only as
  `ExecutionFailure`, built by hand without the cause (`next/packages/libfabrika/src/runtime/Execution.ts:42-66`),
  and a search found no encode of `ProgramDown` itself. Its `errorClass` getter and `shown` read
  `Object.hasOwn(this, "cause")`, which the change leaves as it is; L7 pins both.
- **A placeholder means "may be missing"** (85%). A `cause: undefined` or `cause: null` passed to a
  required cause carries nothing, and two of the six product sites say so in a comment. Those
  errors become optional and the sites drop the key. A made-up text cause (`cause: "Conflicting
  instance start"`) does carry a fact, so it stays, and is a finding row below, not part of this
  sweep.
- **CodeHost's `Refused` stays required with no product caller yet** (75%). A code host's refusal
  always comes with the host's answer, and the only callers today are the fakes in
  `next/packages/libfabrika/src/codehost/CodeHostTest.ts:120`, `:169`, which pass `undefined` and
  get a generated value. The first real caller would show it wrong if it ever has none.

## The count, error by error

Counted on `origin/main` at `a16c31d54` and checked again at `24f39b2cc`, where no counted file had
changed, over every `.ts` and `.tsx` file in the scope, tests
included (0562 makes a shape rule cover tests too). Every line that gives a schema field named
`cause` was found by `rg -n 'cause\s*:\s*(Schema|S)\.'`, and each was then read: 116 lines. Six are
not an error's cause and are left alone:

- `.github/ci/field-schema.ts:41` and `.github/ci/field-check.test.ts:38`: a finding row's text
  field named `cause`, an ordinary optional field, so it keeps `optionalKey`.
- `next/packages/libfabrika/src/gateway/RateLimit.ts:35`: the `invalid` case of a result union,
  already `Schema.Defect()`.
- `next/packages/libfabrika/src/access/SessionManagerTest.ts:220`,
  `next/packages/libfabrika/src/runtime/NemesisTest.ts:334`: decoders a test uses to read an encoded
  error.
- `next/packages/libfabrika/src/tasks/TasksTest.ts:1132`: a property's generator record.

That leaves **110 lines on 114 error classes** (the audit line serves five). For each one the
construction sites were found with a script that walks every `new Name(` and reads its whole
argument, with the class's own file and its importers kept apart when two classes share a name
(`Failed`, `BrainError`, `InstanceError`, `BadAssertion`); a site that spreads another object counts
as passing a cause. A required cause needs no site list: the compiler already makes every site pass
one. So for those the read was the other way round: a search for a cause filled with `undefined`
or `null`. It found 20 lines: 16 are placeholders on 7 classes, and 4 are not (a test's expected
frame, a test's `JSON.stringify`, a model field that is no error, and a `ProgramDown` made with
`null` on purpose).

| Today | Product lines | Test lines | After |
|---|---|---|---|
| `Schema.Defect()` | 58 | 19 | 73 stay, 4 become `optional` (their placeholders go) |
| `Schema.optional(Schema.Defect())` | 17 | 0 | 14 stay, 3 become required |
| `Schema.optionalKey(Schema.Defect())` | 12 | 1 | 10 become `optional`, 3 become required |
| `optionalKey` on another schema | 2 | 0 | both become `optional(Defect())` (audit, `ProgramDown`) |
| `Schema.Unknown` | 0 | 1 | becomes `Defect()` (a test's `CallError`) |

**Totals: 110 lines. 23 change their form: 12 from `optionalKey` to `optional`, 3 from
`optionalKey` to required, 3 from `optional` to required, 4 from required to `optional`, and 1 from
`Schema.Unknown` to required. 87 keep the form they have.** The brief's figures (about 58, 13 and
12) match the product lines in `next/`: 58 required; 17 `optional` less the 3 under `.agents/` and
the one in `Id.ts`, which writes `S.optional` and which a `Schema.`-only search misses, gives 13;
and 12 `optionalKey(Schema.Defect())`.

The whole table, one row per line, is in the last section, [Every cause line](#every-cause-line).

### The 23 that change, and the sites that change with them

| Error | Line | Form it gets | Call site that decides | Other lines that change |
|---|---|---|---|---|
| `RelationsError` | `permissions/Relations.ts:27` | required | all three pass one (`RelationsLedger.ts:46`, `:64`, `RelationsMemory.ts:39`) | none |
| `SendersError` | `permissions/Senders.ts:43` | optional | `access/SessionSenders.ts:22` passes none | none |
| `SettingsError` | `settings/Files.ts:29` | optional | `settings/Files.ts:98` passes none | none |
| `SnapshotError` | `settings/Snapshot.ts:47` | optional | `settings/Snapshot.ts:157` passes none | none |
| `WebCryptoError` | `transport/internal/binary.ts:68` | required | its one site passes one (`:85`) | none |
| `ChildrenError` | `processes/Children.ts:135` | optional | `processes/ChildrenLedger.ts:36` passes none | none |
| `ProgramMailError` | `processes/ProgramMail.ts:74` | optional | `processes/ProgramMail.ts:78` passes none | none |
| audit `Input`, `Selection`, `Output`, `Transport`, `Reply` | `runtime/Audit.ts:12` | optional | `restore` (`Audit.ts:90`) makes each with none | none: callers keep `Redacted.make(cause)` |
| `RpcError` | `runtime/Execution.ts:292` | optional | `runtime/Execution.ts:299` passes none | none |
| `HandsTasksError` | `runtime/HandsTasks.ts:58` | optional | `runtime/HandsTasksLive.ts:71` passes none | none |
| `MailDeliveryError` | `runtime/MailDelivery.ts:29` | required | its one product site passes one (`MailDeliveryLive.ts:44`) | the fake at `runtime/ReloadTest.ts:545` gains one |
| `MailWakeupsError` | `runtime/MailWakeups.ts:19` | optional | `cloudflare/mail.ts:73` passes none | none |
| `ProgramDown` | `runtime/Program.ts:553` | optional | `runtime/State.ts:23` passes none | none |
| `RecoveryStore`'s `Storage` | `runtime/RecoveryStore.ts:18` | optional | `:241` passes `undefined` | `:241` drops it |
| `RecoveryStore`'s `BadRow` | `runtime/RecoveryStore.ts:27` | optional | `:40` passes `undefined` | `:40` drops it |
| Nemesis `Off` | `runtime/Nemesis.ts:16` | optional | `runtime/NemesisNone.ts:17`, `:20` pass `null` | those two, and `next/programs/chaos/src/RunnerTest.ts:391`, `:544`, `:743`, drop it |
| `GatewayError`'s `Storage` | `gateway/GatewayError.ts:17` | optional | `gateway/GatewayNonce.ts:52`, `:112` pass `undefined` | those two drop it; `next/apps/fabrika/src/door.integration.test.ts:1994` asks for no `cause` key |
| `JournalError` | `client/Journal.ts:58` | required | its one product site passes one (`JournalStore.ts:13`) | the fakes at `client/Commands.test-support.ts:134`, `:146` gain one |
| `SignalError` | `node/dev/local-dev.ts:125` | required | its one site passes one (`:148`) | none |
| `CallError` (test) | `node/dev/dev-secrets.laws.integration.test.ts:35` | required | both sites pass one (`:377`, `:381`) | none |
| `InstanceError` | `next/apps/fabrika/dev.ts:22` | optional | `next/apps/fabrika/dev.ts:82` passes none | none |
| `HostError` (test support) | `next/apps/fabrika/e2e/node/P19Launchd.test-support.ts:46` | optional | `:515` passes none | none |
| `BrainError` | `next/apps/fabrika/src/local-instance.ts:8` | required | both sites pass one (`:42`, `:48`) | none |

Paths without a leading folder are under `next/packages/libfabrika/src/`. Three classes keep a
required cause and only their fakes change: WatcherManager's `Gone` and `Unreachable` (the fakes in
`next/packages/libfabrika/src/runtime/WatchersTest.ts:85`, `:184`, `:247` and
`next/packages/libfabrika/src/runtime/RunnerWatchersTest.ts:114`, `:118` pass `null`), and
CodeHost's `Refused` (above). Their fakes get a generated value.

## What each change does to a caller, a stored value and the wire

- **Becoming required** (7 classes: `RelationsError`, `WebCryptoError`, `MailDeliveryError`,
  `JournalError`, `SignalError`, `BrainError` in `local-instance.ts`, the test's `CallError`).
  No product call site leaves the cause out today; the table names each. The fakes that do are named
  above and change in the same slice. A decode of an encoded value with no `cause` now fails. A
  search for each class in a schema, a union, an RPC error list or a decode found none: they live in
  memory and in Effect's error channel. `JournalError` crosses tea's `Cmd` only by its tag
  (`err: ["JournalError"]` in `next/packages/libfabrika/src/client/HandsMachine.ts:117`; tea 0.25.0
  keeps only `errTags`, `dist/core-CDR1i78K.d.ts:179`), so its fields are never decoded there. No
  stored value is read by these schemas.
- **From `optionalKey` to `optional`** (12 lines). In Effect 4.1.2 `optional(S)` is
  `optionalKey(UndefinedOr(S))` (`effect/src/Schema.ts:2434`, `:2471`). So the new decoder accepts
  every value the old one did, to the same result, plus a key written as `undefined`. JSON cannot
  carry `undefined`, so a JSON frame or a stored JSON row reads the same. A structured clone (the
  Worker and object RPCs) can carry it: such a value was refused before and is read now. Encoding
  changes in one corner only: a value made with `cause: undefined` used to go through `Defect`'s
  encoder, which prints `undefined` as text; now the union's `Undefined` arm keeps it as
  `undefined`. No stored value becomes unreadable.
- **From required to `optional`** (4 lines). Same as above: the decoder accepts more. The sites
  that passed `undefined` or `null` stop writing a `cause` key, so a span's failure or a frame no
  longer shows a made-up `cause` for them.
- **The audit and `ProgramDown` lines** change what the field holds (`unknown` either way) and how
  it encodes (above). Neither is encoded whole across a boundary today.

No fact is lost by this change: a placeholder never held one. Nothing new needs recording.

## How others do it

- **Effect itself,** read in the installed `effect` 4.1.2 (`node_modules/effect/src`): 12 lines
  write `cause: Schema.Defect()` (`sql/SqlError.ts:21`, `socket/Socket.ts:383`,
  `socket/DatagramSocket.ts:336`) and 16 write `cause: Schema.optional(Schema.Defect())`
  (`workers/WorkerError.ts:46`, `socket/Socket.ts:451`), as 0568 counts them; a looser search here
  found 17. None writes `optionalKey` on a cause. Its
  `ai-docs/` examples write `cause: Schema.Defect()` every time
  (`ai-docs/src/01_effect/03_services/20_layer-unwrap.ts:9`). That is the ruling, as built.
- **A trusted repo:** clanka writes `cause: Schema.optional(Schema.Defect())` on its boundary errors
  (`src/CodexAuth.ts:50-59`, cited in `.patterns/effect-errors-keep-their-cause.md`; not fetched
  again for this plan).
- **Decision 0566 N8** sets `optionalKey` for a key that may be absent and left the cause out of it
  on purpose ("not decided here"). 0568 is that missing piece, so N8 and 0568 agree: a cause is the
  one field where `optional` is right, the way Effect writes it. 0568 also amends
  [0119](../../../.decisions/0119-an-errors-reason-is-a-tagged-error.md): a reason's cause is
  required only when every caller has one, which is what lets the four placeholder reasons below
  become optional.
- **Elm and OTP** have no answer here: this is how a schema field is written.

## Which check holds it: lint, type or test

- **The form is lint.** A shape of code, so a lint rule (AGENTS.md "Checks"). Looked for an existing
  one first, as 0040 and 0563 ask:
  - The Effect team's checker in `@effect/tsgo` 0.63.0: its 135 checks (`schema.json`) hold none
    about an optional key or a cause. The nearest are `catchToIgnore` and `failCauseToConstructor`.
  - The same package's shipped oxlint presets (`oxlint-presets/*.json`): none.
  - oxlint 1.90.0's own rules: there is no `no-restricted-syntax`; the only restricted rules are
    imports, exports, globals and properties (`configuration_schema.json`). `no-restricted-properties`
    could ban `Schema.optionalKey` everywhere, but not on one key, and every ordinary optional field
    uses it.
  - The anti-slop plugin (0563) at `5360c12`: 27 rules, listed through the GitHub API; none is about
    schemas, optional keys or causes.
  So the rule is ours: `fabrika/error-cause` in `oxlint-plugins/error-cause.ts`.
- **Required or optional is type, and judgment.** No rule can tell whether every caller has a cause.
  A required field makes the compiler refuse a site that leaves it out, which holds the required
  side. A placeholder that defeats it (`cause: undefined`) is the case only reading finds; a
  pattern doc line added in slice 4 says so. A lint rule against a literal `undefined` or `null` cause
  inside a `new` was measured and is not built: on today's tree it would fire 17 times with 1 false
  alarm (`next/apps/fabrika/src/exam/runner-contract.test.ts:342` makes `ProgramDown` with
  `cause: null` on purpose, to test a program that threw `null`), about 6%, too high to block
  (AGENTS.md "Checks").
- **Decode behavior is test.** A property per changed error (L4, L5).

## The shape

```ts
// oxlint-plugins/error-cause.ts, a sketch.
// An error's cause is `Schema.Defect()` when every caller has one, and
// `Schema.optional(Schema.Defect())` when one may be missing. Never `Schema.optionalKey`, and never
// another schema (0568).
//
// What counts as an error's fields: the second argument of `<S>.TaggedError<T>()(tag, fields)` or
// `<S>.TaggedErrorClass<T>()(tag, fields, ...)`, where <S> is `Schema` imported from `effect`, or
// `effect/Schema` as a namespace, under any local name, resolved through the file's scope the way
// `no-cause-squash.ts` resolves `Cause`. The fields are an object literal, or an identifier bound
// to a `const` object literal in the same file (Audit.ts's `Cause`).
// What passes: `cause: S.Defect(...)`, `cause: S.optional(S.Defect(...))`, a `cause` key in any
// other object (a Struct, a TaggedUnion case, a generator record), and a `Schema` that is not
// Effect's.
// Misses: fields built by a call or a spread from another file.
import type { CreateRule } from "@oxlint/plugins";

const MESSAGE =
  "An error's cause is `Schema.Defect()` when every caller has one, or `Schema.optional(Schema.Defect())` when one may be missing; never `Schema.optionalKey`, which refuses a cause written as undefined. Read the call sites to pick (oxlint-plugins/error-cause.ts).";

type Form = "required" | "optional" | "other";

/** Which of the two allowed forms a `cause` value is, read from its syntax. */
declare const formOf: (value: Node, schema: ReadonlySet<string>) => Form;

export const errorCause: CreateRule = {
  meta: { type: "problem" },
  create: (context) => ({
    CallExpression: (node) => {
      /* outer call of an inner `<S>.TaggedError<T>()` call: take the fields argument, follow a
         same-file const one step, find the `cause` property, report when formOf is "other" */
    },
  }),
};
```

`Defect` called with options (`Schema.Defect({ includeStack: true })`) counts as `Defect`: the ruling
is about the optional wrapper, and Effect documents those options (`effect/src/Schema.ts:9390`).
Nothing in the scope passes options today. A call, 85%.

The rule is set to `error` for `next/**`, `.agents/**`, `oxlint-plugins/**` and `.github/ci/**`, tests
included, in the same override blocks that set `fabrika/no-hand-tag` for 0562's scope, and on only
in slice 4, when the tree is at zero. It is not a setting: nobody turns a code shape on per install
([0069](../../../.decisions/0069-choices-are-settings.md)).

**Its false alarms, counted on the real tree** by reading each of the 116 `cause` lines above
against the rule's logic: it fires on 16 lines (12 `optionalKey(Defect())`, the audit line through
its `const`, `ProgramDown`'s `optionalKey(Unknown)`, and the test's `Schema.Unknown`), every one a
real fault, and on none of the six non-error lines. 0 false alarms in 16. The tests step runs the
rule once on main before slice 1's edits and records the real count in its run row; if it differs,
the rule or this count is wrong, and the step says which before slice 4 turns it on.

## One value traced

`SettingsError`, `next/packages/libfabrika/src/settings/Files.ts:29`, through slice 1:

1. Today: `cause: Schema.optionalKey(Schema.Defect())`. Seven sites make it; two pass a cause
   (a decode failure, a read failure) and five do not: `Files.ts:98`, `:166`, `:177`, `:187`, `:239`
   each build an `invalid`, `scope`, `unknown` or `version` error from a rule with a `message`, not
   from a failure below. So a cause may be missing.
2. The build writes `cause: Schema.optional(Schema.Defect())`. No call site changes. The type of
   `.cause` stays `unknown`.
3. Decode, before: `{ _tag: "SettingsError", reason: "invalid", message: "...", cause: undefined }`
   fails, because `Defect`'s encoded side is `Json` and `undefined` is not JSON. After: it decodes,
   with `cause: undefined`. A value with no `cause` key, or with a JSON cause, decodes the same
   before and after.
4. `fabrika/error-cause` reads `Files.ts`: `Schema` is imported from `effect`; the class's fields
   hold `cause: Schema.optional(Schema.Defect())`; `formOf` answers `optional`; nothing is reported.
   On today's line it answers `other` and reports `MESSAGE`.
5. L4's plant puts `optionalKey` back: the generated value with a written `undefined` cause fails to
   decode, and L4 is red.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1, `fabrika/error-cause` fires on exactly the error causes that are neither `Defect()` nor `optional(Defect())`, under any import name, through a same-file `const` fields object, and on `TaggedError` and `TaggedErrorClass` alike; it passes a `cause` key in a Struct, a TaggedUnion case or a generator record, and an error built on a `Schema` that is not Effect's; 4 runs | test, of a lint rule | fc.record: local name of Schema, class maker, the cause's wrapper from seven forms, fields inline or through a const, and the order of the case lines by fc.shuffledSubarray | (a) accept `optionalKey(Defect())`, (b) skip the const lookup, (c) check every object's `cause`, (d) match `Schema` by its name only: each turns L1 red | oxlint-plugins/error-cause.test.ts |
| L2, the real tree has no fire of `fabrika/error-cause` in the scope, tests included | lint | lint | put `optionalKey` back on `permissions/Senders.ts:43`: `pnpm lint` fails | oxlint-plugins/error-cause.ts, set in .oxlintrc.json |
| L3, an exported error whose every caller has a cause cannot be made without one: `RelationsError`, `WebCryptoError`, `MailDeliveryError`, `JournalError`, each a `@ts-expect-error` on a maker call with no cause | type | type | make `Relations.ts:27` optional again: its `@ts-expect-error` goes unused and the typecheck fails | the three types test files below |
| L4, each error moved to `optional` decodes an encoded value whose cause is written as `undefined`, and decodes every value the old `optionalKey` schema decoded to the same value; 50 runs | test | fc.record: the class's own reason drawn from its literals, any other fields from their schemas, and the cause drawn from absent, written undefined, or fc.jsonValue | put `optionalKey` back on that error's line: the written-undefined case fails | the four ErrorCause test files below |
| L5, each placeholder site now makes its error with no `cause` key, and its encoded form has none: GatewayNonce's short key and full store, RecoveryStore's full store and misplaced row, NemesisNone's fire and check; 20 runs | test | fc.record: key length other than 32, spent count at or above the cap, store capacity, saved row name | put `cause: undefined` back on one site: `Object.hasOwn(error, "cause")` is true and the law is red | next/packages/libfabrika/src/runtime/ErrorCause.test.ts, next/packages/libfabrika/src/gateway/ErrorCause.test.ts |
| L6 [secrets], an audit error made with `Redacted.make(secret)` shows the secret in no output: its Schema encode, `Cause.pretty`, its span's failure, and `Audit.failure`; 50 runs | test | fc.string: a secret of 8 to 40 characters, with fc.constantFrom picking which of the five reasons | pass the cause without `Redacted.make` at one site: the secret appears in the encoded form and L6 is red | next/packages/libfabrika/src/runtime/ErrorCause.test.ts |
| L7, `ProgramDown` reads the same after the change: `errorClass` and `executionFailure` answer as before for a cause absent, present, or a kept secret, and a kept cause never reaches `ExecutionFailure`'s content; 50 runs | test | fc.record: reason from `ProgramDown`'s literals, `error` absent or a class name, and the cause absent, a generated Error, or a secret string | make `shown` keep the cause when `error` is `ProgramDown`: the secret reaches `content` and L7 is red | next/packages/libfabrika/src/runtime/ErrorCause.test.ts |

Notes on the laws:

- L4 is one generated law per slice, over that slice's errors, not one per error: its generator
  draws the error too. Slice 1 covers `SendersError`, `SettingsError`, `SnapshotError`; slice 2 the
  seven runtime and processes errors and the four placeholder classes; slice 3 `InstanceError`,
  `HostError` and `GatewayError`'s `Storage`. `InstanceError` and `HostError` are not exported: their
  L4 case lives beside them, or the step exports nothing new and covers them by L2 only, and says
  which.
- L3 covers only exported classes. `SignalError` and `BrainError` in `local-instance.ts` are private,
  and each has every site in its own file, so the compiler already refuses a site without a cause.
- L6 and L7 may already exist in part: `next/packages/libfabrika/src/runtime/ErrorCause.test.ts`
  holds cause laws today. The tests step reads it first and extends a law rather than writing a
  second one for the same thing.
- Every plant is run once by the tests step and recorded in its run row, never committed (0093).
- **No host-only law.** Nothing needs launchd, the real app, a real process or a signal.
- **No `.integration.` or `.visual.` file runs on the laptop.** Three such files change:
  `next/apps/fabrika/src/door.integration.test.ts` (one expectation),
  `next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts` (one schema line) and
  `next/apps/fabrika/e2e/node/P19Launchd.test-support.ts` (one schema line, read by integration
  tests). They are edited by reading, checked by `pnpm lint` and the lead's typecheck, and run on
  the schedule ([0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md)).

## How this meets decision 0566 N7

N7 rewrites 113 inline wrappers, `mapError((cause) => new X({ ..., cause }))`, into one named helper
per error. This sweep edits other lines:

- the 23 schema field lines;
- 6 product placeholder lines and 3 in the chaos test, none of which is a wrapper: each makes an
  error with no failure to wrap (`return yield* new ...`, `throw new ...`, `Result.fail(new ...)`);
- 10 test fake lines (`Effect.fail(new ...)` and the like), and one test expectation.

So no line is edited by both. Files are shared: N7's biggest file,
`next/packages/libfabrika/src/cloudflare/runtime.ts`, is not touched here, but
`next/packages/libfabrika/src/runtime/RecoveryStore.ts`, `next/packages/libfabrika/src/gateway/GatewayNonce.ts`
and others may be. Land this first in each folder. Then a helper N7 writes for an error whose cause
is now required is a type error if it forgets the cause, which helps N7 instead of fighting it.
Whichever lands second rebases; no hand merge of a shared line is expected.

## The open pull requests and the busy folders

The lead's brief holds `next/packages/libfabrika/src/runtime`, `processes`, `cloudflare`, `gateway`,
`node`, `client` and `next/apps/fabrika` until
https://github.com/kamp-us/tea-fabrika/pull/1341, https://github.com/kamp-us/tea-fabrika/pull/1331
and https://github.com/kamp-us/tea-fabrika/pull/1366 land (all three open drafts on 2026-11-15).
Read in their diffs on that day, they add causes of their own:

- 1341 adds two `cause: Schema.optionalKey(Schema.Defect())` lines (a new monitors error among
  them).
- 1366 adds required causes and passes `cause: null` to them (`new BadRow({ cause: null })`, and a
  `RecoveryReserveExhausted` with `cause: null`), and one more `new Storage({ cause: undefined })`
  in `runtime/RecoveryStore.ts`.
- 1331 adds none.

So slices 2 and 3 do not trust this table for those folders. Each starts by running the same count
at its base, after the three have merged, and adds every new cause line to its rows by the same
reading. The lead's brief for those slices names the new head. Slice 1's folders (`permissions`,
`settings`, `transport/internal`, `codehost`) are in none of the three diffs.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| `next/packages/libfabrika/src/permissions/Relations.ts` | build | 1 | slice 1: required |
| `next/packages/libfabrika/src/permissions/Senders.ts` | build | 1 | slice 1: optional |
| `next/packages/libfabrika/src/settings/Files.ts` | build | 1 | slice 1: optional |
| `next/packages/libfabrika/src/settings/Snapshot.ts` | build | 1 | slice 1: optional |
| `next/packages/libfabrika/src/transport/internal/binary.ts` | build | 1 | slice 1: required |
| `next/packages/libfabrika/src/codehost/CodeHostTest.ts` | tests | tests | slice 1: two fakes pass a generated cause |
| `next/packages/libfabrika/src/permissions/ErrorCause.test.ts` | tests | tests | slice 1: L4 for `SendersError` |
| `next/packages/libfabrika/src/settings/ErrorCause.test.ts` | tests | tests | slice 1: L4 for `SettingsError` and `SnapshotError` |
| `next/packages/libfabrika/src/permissions/Rebac.types.test.ts` | tests | tests | slice 1: L3 for `RelationsError` |
| `next/packages/libfabrika/src/transport/ErrorCause.types.test.ts` | tests | tests | slice 1: L3 for `WebCryptoError` |
| `next/packages/libfabrika/src/processes/Children.ts` | build | 1 | slice 2: optional |
| `next/packages/libfabrika/src/processes/ProgramMail.ts` | build | 1 | slice 2: optional |
| `next/packages/libfabrika/src/runtime/Audit.ts` | build | 2 | slice 2: the shared `Cause` fields take `optional(Defect())`; the head comment says how the secret stays out |
| `next/packages/libfabrika/src/runtime/Execution.ts` | build | 1 | slice 2: `RpcError` optional |
| `next/packages/libfabrika/src/runtime/HandsTasks.ts` | build | 1 | slice 2: optional |
| `next/packages/libfabrika/src/runtime/MailDelivery.ts` | build | 1 | slice 2: required |
| `next/packages/libfabrika/src/runtime/MailWakeups.ts` | build | 1 | slice 2: optional |
| `next/packages/libfabrika/src/runtime/Program.ts` | build | 1 | slice 2: `ProgramDown` optional `Defect` |
| `next/packages/libfabrika/src/runtime/RecoveryStore.ts` | build | 4 | slice 2: `Storage` and `BadRow` optional, two placeholders dropped (three once 1366 lands) |
| `next/packages/libfabrika/src/runtime/Nemesis.ts` | build | 1 | slice 2: `Off` optional |
| `next/packages/libfabrika/src/runtime/NemesisNone.ts` | build | 2 | slice 2: two placeholders dropped |
| `next/packages/libfabrika/src/runtime/ReloadTest.ts` | tests | tests | slice 2: the `MailDeliveryError` fake passes a generated cause |
| `next/packages/libfabrika/src/runtime/WatchersTest.ts` | tests | tests | slice 2: three `Gone` fakes pass a generated value |
| `next/packages/libfabrika/src/runtime/RunnerWatchersTest.ts` | tests | tests | slice 2: two fakes pass a generated value |
| `next/programs/chaos/src/RunnerTest.ts` | tests | tests | slice 2: three `Off` fakes drop `cause: null` |
| `next/packages/libfabrika/src/runtime/ErrorCause.test.ts` | tests | tests | slice 2: L4, L5, L6, L7 |
| `next/packages/libfabrika/src/processes/ErrorCause.test.ts` | tests | tests | slice 2: L4 for `ChildrenError` and `ProgramMailError` |
| `next/packages/libfabrika/src/runtime/Runtime.types.test.ts` | tests | tests | slice 2: L3 for `MailDeliveryError` |
| `next/packages/libfabrika/src/gateway/GatewayError.ts` | build | 1 | slice 3: `Storage` optional |
| `next/packages/libfabrika/src/gateway/GatewayNonce.ts` | build | 2 | slice 3: two placeholders dropped |
| `next/packages/libfabrika/src/client/Journal.ts` | build | 1 | slice 3: required |
| `next/packages/libfabrika/src/node/dev/local-dev.ts` | build | 1 | slice 3: `SignalError` required |
| `next/apps/fabrika/dev.ts` | build | 1 | slice 3: `InstanceError` optional |
| `next/apps/fabrika/src/local-instance.ts` | build | 1 | slice 3: `BrainError` required |
| `next/apps/fabrika/e2e/node/P19Launchd.test-support.ts` | tests | tests | slice 3: `HostError` optional |
| `next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts` | tests | tests | slice 3: `CallError` takes `Defect()` |
| `next/packages/libfabrika/src/client/Commands.test-support.ts` | tests | tests | slice 3: two `JournalError` fakes pass a generated cause |
| `next/apps/fabrika/src/door.integration.test.ts` | tests | tests | slice 3: line 1994 asks for no `cause` key on the full-store `Storage` |
| `next/packages/libfabrika/src/gateway/ErrorCause.test.ts` | tests | tests | slice 3: L4 and L5 for `GatewayError`'s `Storage` |
| `next/packages/libfabrika/src/client/Hands.types.test.ts` | tests | tests | slice 3: L3 for `JournalError` |
| `oxlint-plugins/error-cause.ts` | tests | 90 | slice 4: the rule, as a lint rule is the tests step's, like `law-shape.ts` in plan t971 |
| `oxlint-plugins/error-cause.test.ts` | tests | tests | slice 4: L1 |
| `oxlint-plugins/index.ts` | tests | 2 | slice 4: register the rule |
| `.oxlintrc.json` | tests | 4 | slice 4: `error` in the scope's override blocks (L2) |
| `oxlint-plugins/README.md` | tests | docs | slice 4: one row for the rule |
| `.patterns/effect-errors-keep-their-cause.md` | build | docs | slice 4, with the write-pattern skill: 0568 already wrote the two forms and how to pick. Left: "Today's code breaks this" drops the 12 `optionalKey` lines, now zero; "Holds it" names `fabrika/error-cause`; one rule line says a required cause is never filled with `undefined` or `null`, since that error's cause may be missing |
| `.glossary/TERMS.md` | build | none | not changed: no new word |
| `next/apps/fabrika/e2e/chaos-revoke.integration.test.ts`, `next/apps/fabrika/e2e/page-runtime.laws.visual.test.ts`, `next/apps/fabrika/e2e/reload.visual.test.ts`, `next/apps/fabrika/src/exam/runner-contract.test.ts`, `next/apps/fabrika/src/exam/tsconfig-scope.integration.test.ts`, `next/apps/fabrika/src/hands-client.test.ts`, `next/apps/fabrika/src/port-home.laws.integration.test.ts`, `next/apps/fabrika/src/port-home.test-support.ts`, `next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts`, `next/packages/libfabrika/src/Testing.test-support.ts`, `next/packages/libfabrika/src/access/SessionManagerTest.ts`, `next/packages/libfabrika/src/cloudflare/entry-flows.laws.test.ts`, `next/packages/libfabrika/src/cloudflare/leave.laws.test.ts`, `next/packages/libfabrika/src/cloudflare/reload.laws.test.ts`, `next/packages/libfabrika/src/cloudflare/tail.test.ts`, `next/packages/libfabrika/src/gateway/TasksTest.ts`, `next/packages/libfabrika/src/packs/RepositoryTrustTest.ts`, `next/packages/libfabrika/src/runtime/NemesisTest.ts`, `next/packages/libfabrika/src/tasks/TasksTest.ts`, `next/packages/libfabrika/src/transport/Sshsig.test-support.ts`, `.github/ci/field-check.test.ts`, `.github/ci/field-schema.ts`, `.github/ci/time-table.ts` | tests | none | not changed: each is named in the count as a cause that keeps its form or is not an error's cause |
| `.github/ci/`, `.github/ci`, `.github/ci/**`, `oxlint-plugins/`, `oxlint-plugins/**` | tests | none | named as the scope and as the rule's globs; any file there this plan changes has its own row |

## Validation

- Each slice's tests step: `pnpm format`, then `nice -n 15 pnpm exec vitest run --maxWorkers=3` on
  that slice's test files above that are not `.integration.` or `.visual.`, then `pnpm lint`. Each
  plant run once and recorded. Slice 4 also runs the new rule over main once before it is set to
  `error`, and records the fire count beside this plan's 16.
- The lead: one `pnpm typecheck` per slice (the required causes are held by the compiler), the leak
  grep, and CI.
- Not run on this laptop by anyone: the three `.integration.` files and every `.visual.` file.

## Size

Four pull requests, each landing whole, cold folders first as the brief asks. None changes what a
person sees.

1. Slice 1, cold folders (`permissions`, `settings`, `transport/internal`, `codehost`): 5 product lines, about 120 test lines. 5 lines.
2. Slice 2, `runtime`, `processes` and the chaos program, after 1341 and 1366 land: about 18 product lines today, more once those two add theirs, and about 250 test lines. 18 lines.
3. Slice 3, `gateway`, `node`, `client` and `next/apps/fabrika`, after all three land: about 8 product lines and about 120 test lines. 8 lines.
4. Slice 4, the lint rule `fabrika/error-cause` at `error`, once slices 1 to 3 have merged, with the pattern doc's last lines: about 90 rule lines, 6 config lines, about 150 test lines and about 10 doc lines. 96 lines.

Priced from the t971 plan's lane, a lint rule with its laws (tests $8.41, build $0.87, review $2.70,
list dollars from PR 1199's body), and from the size of these slices: slices 1 to 3 about $4 tests,
$2 build and $3 review each; slice 4 about $8, $2 and $3; and two fix rounds at about $3. Confidence 70%: the doubt is slice 2, whose count grows by however many causes
1341 and 1366 add, and whose L6 and L7 may need more reading of `runtime/ErrorCause.test.ts` than
priced.

Estimate: 14 steps, $46

## Records

- What is lost if not written now: this count at `a16c31d54`, which main will move past. It is in
  this plan; each slice's run row records its own recount.
- `field/runs/` rows for each step, written by the lead.
- `.patterns/effect-errors-keep-their-cause.md` and `oxlint-plugins/README.md`, both in slice 4.
- The decision is [0568](../../../.decisions/0568-error-cause-follows-effect.md). This plan makes no
  new decision; each call above builds it, and 0568's "whether a check holds it is for the
  cleanup's plan" is answered under "Which check holds it".

## What this cannot tell us

- Whether a required cause ever forces a placeholder in new code. The type pushes a writer to fill
  it; only reading catches `cause: undefined`, and the measured lint rule for it is too noisy to
  block.
- The counts in the busy folders after 1341, 1331 and 1366: slices 2 and 3 recount.
- The site counts come from a script that reads `new Name(`. A class made another way (a factory
  that returns `new`, a `Schema.decode` into the class) is not a site it sees; for the six classes
  that become required, a search for each name in a schema, union or decode found none, but a site
  built by a helper in another module would show only at the typecheck.
- That `Redacted` encodes as `<redacted>` through `Defect` is read from `effect` 4.1.2, not run. L6
  runs it.
- 0568's context says that under `exactOptionalPropertyTypes` a call passing a cause that may be
  `undefined` compiles with `optional` and fails with `optionalKey`. For a `Defect()` field the type
  is `unknown`, which already holds `undefined`, so the two may type the same; this was not
  compiled here. It changes no row: the forms are picked by the call sites either way.
- How `toMatchObject` in vitest treats `cause: undefined` against a missing key was not checked;
  the door test line is rewritten to say "no `cause` key" plainly, so it does not matter.

## Open questions

None.

## Findings

```json
{"_tag":"finding","id":"2026-11-15-made-up-text-causes","date":"2026-11-15","by":"plan","model":"claude-opus-5-5","rule":"rule_break","location":{"path":"next/packages/libfabrika/src/cloudflare/SettingsStartsLedger.ts","line":112},"says":"In next/, eight product sites fill an error's cause with text our own code made up, not a failure from below: `cause: \"Conflicting instance start\"` here, `cause: \"Invalid instance receipt\"` at cloudflare/SettingsInput.ts:87, `cause: \"Start acknowledgement mismatch\"` at cloudflare/SettingsStartsRemote.ts:81, a template string at permissions/RelationsMemory.ts:39, `Redacted.make(\"deadline\")` at desktop/BrainServiceManaged.ts:108 and :173, and `Redacted.make` of a fixed sentence at node/repositories/RepositoriesGit.ts:285 and :294.","proof":"`rg -n -e 'cause:\\s*([\"`]|Redacted\\.make\\([\"`])' next/packages/libfabrika/src -g '!*test*' -g '!*Test.ts'` at a16c31d54 prints those eight lines; .patterns/effect-errors-keep-their-cause.md:52 says an error has a cause field when it wraps a failure from below, and its 'Where it applies' says a cause is the untyped value a platform hands us.","cost":"A span's failure shows our own sentence as if a lower layer had failed, and the fact it carries has no field of its own, so a reader cannot tell a real cause from a note.","head":"a16c31d54585dab25cf609d734fe4ebe97ed5a59","ticket":null,"pr":null}
```

## Every cause line

One row per line, `origin/main` at `a16c31d54`. "Slice" is the pull request that changes the line or
its sites, or `none`.

| Error | Where | Line | Today | After | Slice | Call site that decides |
|---|---|---|---|---|---|---|
| BoxGitError | `.agents/skills/lead/scripts/box/BoxGit.ts` | 11 | `Schema.optional(Schema.Defect())` | `Schema.optional(Schema.Defect())` | none | `.agents/skills/lead/scripts/box/BoxGitProcess.ts:75` passes none |
| Unreadable | `.agents/skills/lead/scripts/box/Remove.ts` | 44 | `Schema.optional(Schema.Defect())` | `Schema.optional(Schema.Defect())` | none | `.agents/skills/lead/scripts/box/Remove.ts:275` passes none |
| Failed | `.agents/skills/lead/scripts/movecheck.ts` | 496 | `Schema.optional(Schema.Defect())` | `Schema.optional(Schema.Defect())` | none | `.agents/skills/lead/scripts/movecheck.ts:637` passes none (`usage`) |
| Unread | `.github/ci/time-table.ts` | 204 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| InstanceError | `next/apps/fabrika/dev.ts` | 22 | `Schema.optionalKey(Schema.Defect())` | `Schema.optional(Schema.Defect())` | 3 | `next/apps/fabrika/dev.ts:82` passes none (`parent_gone`) |
| WireFailure | `next/apps/fabrika/e2e/chaos-revoke.integration.test.ts` | 32 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| HostError | `next/apps/fabrika/e2e/node/P19Launchd.test-support.ts` | 46 | `Schema.optionalKey(Schema.Defect())` | `Schema.optional(Schema.Defect())` | 3 | `next/apps/fabrika/e2e/node/P19Launchd.test-support.ts:515` passes none |
| PlaywrightError | `next/apps/fabrika/e2e/page-runtime.laws.visual.test.ts` | 45 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| PropertyFailed | `next/apps/fabrika/e2e/page-runtime.laws.visual.test.ts` | 51 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| BrowserFailure | `next/apps/fabrika/e2e/reload.visual.test.ts` | 47 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Falsified | `next/apps/fabrika/src/exam/tsconfig-scope.integration.test.ts` | 33 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| CryptoFailed | `next/apps/fabrika/src/hands-client.test.ts` | 101 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| PropertyFailed | `next/apps/fabrika/src/hands-client.test.ts` | 104 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| BrainError | `next/apps/fabrika/src/local-instance.ts` | 8 | `Schema.optional(Schema.Defect())` | `Schema.Defect()` | 3 | both sites pass one: `next/apps/fabrika/src/local-instance.ts:42`, `:48` |
| InstanceError | `next/apps/fabrika/src/port-home.laws.integration.test.ts` | 238 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| GuardError | `next/apps/fabrika/src/port-home.test-support.ts` | 25 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| StubFailure | `next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts` | 139 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| PropertyFailed | `next/packages/libfabrika/src/Testing.test-support.ts` | 11 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Storage | `next/packages/libfabrika/src/access/SessionManager.ts` | 116 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| BadRow | `next/packages/libfabrika/src/access/SessionManager.ts` | 125 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Membership | `next/packages/libfabrika/src/access/SessionManager.ts` | 134 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Unavailable | `next/packages/libfabrika/src/ci/Ci.ts` | 85 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| RateLimited | `next/packages/libfabrika/src/ci/Ci.ts` | 95 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| JournalError | `next/packages/libfabrika/src/client/Journal.ts` | 58 | `Schema.optionalKey(Schema.Defect())` | `Schema.Defect()` | 3 | the one product site passes one: `next/packages/libfabrika/src/client/JournalStore.ts:13`; the two fakes at `next/packages/libfabrika/src/client/Commands.test-support.ts:134`, `:146` gain one |
| EntryFailure | `next/packages/libfabrika/src/cloudflare/entry-flows.laws.test.ts` | 31 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Rejected | `next/packages/libfabrika/src/cloudflare/leave.laws.test.ts` | 34 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Rejected | `next/packages/libfabrika/src/cloudflare/reload.laws.test.ts` | 60 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| TailImportError | `next/packages/libfabrika/src/cloudflare/tail.test.ts` | 24 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Unavailable | `next/packages/libfabrika/src/codehost/CodeHost.ts` | 101 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| RateLimited | `next/packages/libfabrika/src/codehost/CodeHost.ts` | 111 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Refused | `next/packages/libfabrika/src/codehost/CodeHost.ts` | 121 | `Schema.Defect()` | `Schema.Defect()` | 1 | no product site yet; a host's refusal always carries the host's answer. The fakes at `next/packages/libfabrika/src/codehost/CodeHostTest.ts:120`, `:169` pass `undefined` and gain a real value |
| Conflict | `next/packages/libfabrika/src/desktop/BrainControl.ts` | 101 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| ? | `next/packages/libfabrika/src/desktop/BrainControl.ts` | 78 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Storage | `next/packages/libfabrika/src/desktop/BrainControl.ts` | 87 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Unsupported | `next/packages/libfabrika/src/desktop/BrainControl.ts` | 94 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Unreachable | `next/packages/libfabrika/src/desktop/BrainProbe.ts` | 30 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Foreign | `next/packages/libfabrika/src/desktop/BrainProbe.ts` | 37 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Cleanup | `next/packages/libfabrika/src/desktop/BrainProbe.ts` | 44 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Operation | `next/packages/libfabrika/src/desktop/BrainService.ts` | 18 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Timeout | `next/packages/libfabrika/src/desktop/BrainService.ts` | 29 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Conflict | `next/packages/libfabrika/src/desktop/BrainService.ts` | 38 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Unavailable | `next/packages/libfabrika/src/desktop/PersonCheck.ts` | 28 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Storage | `next/packages/libfabrika/src/gateway/GatewayError.ts` | 17 | `Schema.Defect()` | `Schema.optional(Schema.Defect())` | 3 | `next/packages/libfabrika/src/gateway/GatewayNonce.ts:52` and `:112` pass `cause: undefined`, "no failure to keep" |
| BadRow | `next/packages/libfabrika/src/gateway/GatewayError.ts` | 26 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Crypto | `next/packages/libfabrika/src/gateway/GatewayError.ts` | 35 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| CryptoFailed | `next/packages/libfabrika/src/gateway/TasksTest.ts` | 98 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| LedgerError | `next/packages/libfabrika/src/ledger/Ledger.ts` | 36 | `Schema.optional(Schema.Defect())` | `Schema.optional(Schema.Defect())` | none | `next/packages/libfabrika/src/gateway/Gateway.ts:648` passes none (`refused`); 35 product sites in all |
| Storage | `next/packages/libfabrika/src/ledger/LedgerStreams.ts` | 16 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| BadRow | `next/packages/libfabrika/src/ledger/LedgerStreams.ts` | 26 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| CallError | `next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts` | 35 | `Schema.Unknown` | `Schema.Defect()` | 3 | both sites pass one: `:377`, `:381` |
| ControlError | `next/packages/libfabrika/src/node/dev/dev.ts` | 48 | `Schema.optional(Schema.Defect())` | `Schema.optional(Schema.Defect())` | none | `next/packages/libfabrika/src/node/dev/dev.ts:85` passes none |
| SignalError | `next/packages/libfabrika/src/node/dev/local-dev.ts` | 125 | `Schema.optional(Schema.Defect())` | `Schema.Defect()` | 3 | the one site passes one: `next/packages/libfabrika/src/node/dev/local-dev.ts:148` |
| BrainError | `next/packages/libfabrika/src/node/dev/local-dev.ts` | 85 | `Schema.optional(Schema.Defect())` | `Schema.optional(Schema.Defect())` | none | `next/packages/libfabrika/src/node/dev/local-dev.ts:329` passes none (`id_reused`) |
| Storage | `next/packages/libfabrika/src/node/repositories/OpenRepository.ts` | 17 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| InvalidDocument | `next/packages/libfabrika/src/node/repositories/OpenRepository.ts` | 18 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| ReadFailed | `next/packages/libfabrika/src/node/repositories/OpenRepository.ts` | 19 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Storage | `next/packages/libfabrika/src/packs/RepositoryTrust.ts` | 118 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| InvalidHistory | `next/packages/libfabrika/src/packs/RepositoryTrust.ts` | 129 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| TrustLawFailed | `next/packages/libfabrika/src/packs/RepositoryTrustTest.ts` | 23 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| RelationsError | `next/packages/libfabrika/src/permissions/Relations.ts` | 27 | `Schema.optionalKey(Schema.Defect())` | `Schema.Defect()` | 1 | all three pass one: `next/packages/libfabrika/src/permissions/RelationsLedger.ts:46`, `:64`, `next/packages/libfabrika/src/permissions/RelationsMemory.ts:39` |
| SendersError | `next/packages/libfabrika/src/permissions/Senders.ts` | 43 | `Schema.optionalKey(Schema.Defect())` | `Schema.optional(Schema.Defect())` | 1 | `next/packages/libfabrika/src/access/SessionSenders.ts:22` passes none (`removed`) |
| ChildrenError | `next/packages/libfabrika/src/processes/Children.ts` | 135 | `Schema.optionalKey(Schema.Defect())` | `Schema.optional(Schema.Defect())` | 2 | `next/packages/libfabrika/src/processes/ChildrenLedger.ts:36` passes none |
| ProcessError | `next/packages/libfabrika/src/processes/Process.ts` | 340 | `Schema.optional(Schema.Defect())` | `Schema.optional(Schema.Defect())` | none | `next/packages/libfabrika/src/processes/ProcessManager.ts:266` passes none (`forbidden`) |
| Unreachable | `next/packages/libfabrika/src/processes/ProcessHistory.ts` | 17 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| BadRow | `next/packages/libfabrika/src/processes/ProcessHistory.ts` | 26 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Storage | `next/packages/libfabrika/src/processes/ProcessHistory.ts` | 34 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| ProgramMailError | `next/packages/libfabrika/src/processes/ProgramMail.ts` | 74 | `Schema.optionalKey(Schema.Defect())` | `Schema.optional(Schema.Defect())` | 2 | `next/packages/libfabrika/src/processes/ProgramMail.ts:78` passes none |
| DefaultUnknown | `next/packages/libfabrika/src/repositories/Repositories.ts` | 82 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| ReadFailed | `next/packages/libfabrika/src/repositories/Repositories.ts` | 92 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| MissingPath | `next/packages/libfabrika/src/repositories/Repositories.ts` | 99 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Input, Selection, Output, Transport, Reply | `next/packages/libfabrika/src/runtime/Audit.ts` | 12 | `Schema.optionalKey(Schema.Redacted(Schema.Unknown, ...))` | `Schema.optional(Schema.Defect())` | 2 | `restore` at `next/packages/libfabrika/src/runtime/Audit.ts:90` makes each of the five with none; every other site passes `Redacted.make(cause)` |
| BuildError | `next/packages/libfabrika/src/runtime/Built.ts` | 24 | `Schema.optional(Schema.Defect())` | `Schema.optional(Schema.Defect())` | none | `next/packages/libfabrika/src/node/build/build.ts:512` passes none (`table`) |
| Storage | `next/packages/libfabrika/src/runtime/CodeStore.ts` | 17 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| BadRow | `next/packages/libfabrika/src/runtime/CodeStore.ts` | 25 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| RpcError | `next/packages/libfabrika/src/runtime/Execution.ts` | 292 | `Schema.optionalKey(Schema.Defect())` | `Schema.optional(Schema.Defect())` | 2 | `next/packages/libfabrika/src/runtime/Execution.ts:299` passes none |
| HandsTasksError | `next/packages/libfabrika/src/runtime/HandsTasks.ts` | 58 | `Schema.optionalKey(Schema.Defect())` | `Schema.optional(Schema.Defect())` | 2 | `next/packages/libfabrika/src/runtime/HandsTasksLive.ts:71` passes none |
| MailDeliveryError | `next/packages/libfabrika/src/runtime/MailDelivery.ts` | 29 | `Schema.optionalKey(Schema.Defect())` | `Schema.Defect()` | 2 | the one product site passes one: `next/packages/libfabrika/src/runtime/MailDeliveryLive.ts:44`; the fake at `next/packages/libfabrika/src/runtime/ReloadTest.ts:545` gains one |
| MailWakeupsError | `next/packages/libfabrika/src/runtime/MailWakeups.ts` | 19 | `Schema.optionalKey(Schema.Defect())` | `Schema.optional(Schema.Defect())` | 2 | `next/packages/libfabrika/src/cloudflare/mail.ts:73` passes none |
| Off | `next/packages/libfabrika/src/runtime/Nemesis.ts` | 16 | `Schema.Defect()` | `Schema.optional(Schema.Defect())` | 2 | `next/packages/libfabrika/src/runtime/NemesisNone.ts:17` and `:20` pass `cause: null` |
| BadTarget | `next/packages/libfabrika/src/runtime/Nemesis.ts` | 24 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| NotGranted | `next/packages/libfabrika/src/runtime/Nemesis.ts` | 32 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Unreachable | `next/packages/libfabrika/src/runtime/Nemesis.ts` | 40 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| BadRow | `next/packages/libfabrika/src/runtime/Nemesis.ts` | 48 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Storage | `next/packages/libfabrika/src/runtime/Nemesis.ts` | 56 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| ProgramDown | `next/packages/libfabrika/src/runtime/Program.ts` | 553 | `Schema.optionalKey(Schema.Unknown)` | `Schema.optional(Schema.Defect())` | 2 | `next/packages/libfabrika/src/runtime/State.ts:23` passes none (`saved_state`) |
| Storage | `next/packages/libfabrika/src/runtime/RecoveryStore.ts` | 18 | `Schema.Defect()` | `Schema.optional(Schema.Defect())` | 2 | `next/packages/libfabrika/src/runtime/RecoveryStore.ts:241` passes `cause: undefined` |
| BadRow | `next/packages/libfabrika/src/runtime/RecoveryStore.ts` | 27 | `Schema.Defect()` | `Schema.optional(Schema.Defect())` | 2 | `next/packages/libfabrika/src/runtime/RecoveryStore.ts:40` passes `cause: undefined`, "no lower fault to keep" |
| PropertyFailure | `next/packages/libfabrika/src/runtime/ReloadTest.ts` | 64 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| RepliesError | `next/packages/libfabrika/src/runtime/Replies.ts` | 32 | `Schema.optional(Schema.Defect())` | `Schema.optional(Schema.Defect())` | none | `next/packages/libfabrika/src/runtime/RepliesSql.ts:55` passes none |
| RunnerError | `next/packages/libfabrika/src/runtime/Runner.ts` | 2747 | `Schema.optional(Schema.Defect())` | `Schema.optional(Schema.Defect())` | none | `next/packages/libfabrika/src/runtime/Runner.ts:2358` passes none (`bad_client`) |
| Gone | `next/packages/libfabrika/src/runtime/WatcherManager.ts` | 25 | `Schema.Defect()` | `Schema.Defect()` | 2 | the product site passes one: `next/packages/libfabrika/src/cloudflare/WatcherManagerRemote.ts:17`; fakes passing `null` in `WatchersTest.ts` and `RunnerWatchersTest.ts` gain a real value |
| Unreachable | `next/packages/libfabrika/src/runtime/WatcherManager.ts` | 34 | `Schema.Defect()` | `Schema.Defect()` | 2 | the product site passes one: `next/packages/libfabrika/src/cloudflare/WatcherManagerRemote.ts:13`; the fake at `RunnerWatchersTest.ts:118` gains a real value |
| Storage | `next/packages/libfabrika/src/runtime/Watchers.ts` | 16 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| BadRow | `next/packages/libfabrika/src/runtime/Watchers.ts` | 24 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| SettingsError | `next/packages/libfabrika/src/settings/Files.ts` | 29 | `Schema.optionalKey(Schema.Defect())` | `Schema.optional(Schema.Defect())` | 1 | `next/packages/libfabrika/src/settings/Files.ts:98` passes none (`invalid`) |
| SnapshotError | `next/packages/libfabrika/src/settings/Snapshot.ts` | 47 | `Schema.optionalKey(Schema.Defect())` | `Schema.optional(Schema.Defect())` | 1 | `next/packages/libfabrika/src/settings/Snapshot.ts:157` passes none |
| Decode | `next/packages/libfabrika/src/settings/Starts.ts` | 25 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Refused | `next/packages/libfabrika/src/settings/Starts.ts` | 41 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Storage | `next/packages/libfabrika/src/settings/Starts.ts` | 49 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Unreachable | `next/packages/libfabrika/src/settings/Starts.ts` | 57 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Syntax | `next/packages/libfabrika/src/settings/Toml.ts` | 32 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Value | `next/packages/libfabrika/src/settings/Toml.ts` | 42 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| Conflict | `next/packages/libfabrika/src/settings/Toml.ts` | 53 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| TomlError | `next/packages/libfabrika/src/settings/Toml.ts` | 70 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| TasksError | `next/packages/libfabrika/src/tasks/Tasks.ts` | 37 | `Schema.optional(Schema.Defect())` | `Schema.optional(Schema.Defect())` | none | `next/packages/libfabrika/src/tasks/TasksLedger.ts:128` passes none (`not_found`) |
| SinkError | `next/packages/libfabrika/src/telemetry/Trace.ts` | 309 | `Schema.optional(Schema.Defect())` | `Schema.optional(Schema.Defect())` | none | `next/packages/libfabrika/src/telemetry/Sink.ts:561` passes none |
| CryptoFailed | `next/packages/libfabrika/src/transport/Sshsig.test-support.ts` | 123 | `Schema.Defect()` | `Schema.Defect()` | none | required today: the compiler makes every site pass one, and the search for `cause: undefined` or `null` found none |
| BadAssertion | `next/packages/libfabrika/src/transport/Webauthn.ts` | 206 | `Schema.optional(Schema.Defect())` | `Schema.optional(Schema.Defect())` | none | `next/packages/libfabrika/src/transport/Webauthn.ts:259` passes none |
| WebCryptoError | `next/packages/libfabrika/src/transport/internal/binary.ts` | 68 | `Schema.optional(Schema.Defect())` | `Schema.Defect()` | 1 | the one site passes one: `next/packages/libfabrika/src/transport/internal/binary.ts:85` |
| IdError | `next/packages/libfabrika/src/Id.ts` | 15 | `Schema.optional(Schema.Defect())` | `Schema.optional(Schema.Defect())` | none | `next/packages/libfabrika/src/Id.ts:70` passes none (`prefix`) |
