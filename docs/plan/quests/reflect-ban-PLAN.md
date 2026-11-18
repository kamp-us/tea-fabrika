Approved by the lead agent, builds 0554, 0562, 0524, 0523, 0168; body ff7b3eb93cc0
Plancheck-Version: 3

# Plan: no `Reflect.get`, `Reflect.set` or `Reflect.has` is left in `next/` and our tooling, and a lint rule holds it

This is `next/` and our tooling (`.agents/`, the `oxlint-plugins` folder, the CI scripts). Today's app is not
touched. It builds [0554](../../../.decisions/0554-no-reflect-get-set-has.md) (the ban), under
[0562](../../../.decisions/0562-nothing-teaches-the-wrong-shape.md) (tests and tooling are covered
too), [0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md) (no list of leftovers) and
0560, the order for Effect code (accepted, in
https://github.com/kamp-us/tea-fabrika/pull/1359, not on main yet). It is one of the fixes of the
sev0 the owner called on 2026-11-15: nothing more is built on wrong code foundations.

```ts
// The whole idea. Before: each call answers `any`, so the type checker sees nothing.
const signed = String(Reflect.get(Object(hello?.params), "signed") ?? "");

// After (a sketch, not compiled): decode the loose value once, then read plain fields.
const Hello = Schema.Struct({ signed: Schema.String, tab: Schema.String });
const params = Schema.decodeUnknownOption(Hello)(hello?.params);

// And the hold, in .oxlintrc.json, on for each folder the day it reaches zero:
// { "object": "Reflect", "property": "get", "message": "Decode with Schema, or narrow first (0554)." }
```

## Doubts, read these first

The owner is away, so each lean below is taken. Two are at or under 80%.

- **The built-in rule only advises in 14 folders today, so the lint runner must change first
  (80%).** `pnpm lint` treats every warn-level fire of `eslint/no-restricted-properties` as advice,
  because that rule was first used for `JSON.parse`. In the 14 folders where `JSON.parse` still
  advises, a `Reflect` entry in the same rule would only advise too. Slice 1 narrows the runner so
  only the `JSON.parse` fire can advise. The doubt: those folders' config block still says `warn`
  above the `Reflect` entries, and a plain `oxlint` run in an editor shows yellow, though
  `pnpm lint` and CI fail on it. What would settle it: the `JSON.parse` cleanup of
  [0523](../../../.decisions/0523-advice-rules-block-where-clean.md) reaching zero, which deletes
  that block. See "The hold".
- **Where the dev client's method types come from: settled for the process half, a lean for the
  project half (75%).** The merge session ruled choice (A): the method types move type-only to a
  layer both `node/` and `cloudflare/` already import, with no `layer-rules.json` edit. Read
  against `layer-rules.json` on main at `9ca24b1`, that holds for the Process object's calls: they
  move to `next/packages/libfabrika/src/runtime/ObjectCalls.ts`. It cannot hold for the Project
  object's calls: they name `transport/` and seven reply schemas that are values in
  `cloudflare/bindings.ts`, and no layer both may import is allowed to import `transport/` and
  `runtime/` together. The lean for that half is the tests step's choice (C): `dev.ts` names its
  Project calls from modules `node/` may import, and L7 holds them equal to the binding's. The
  merge session's signature is the yes; a send-back picks (B) instead. See the amendment of
  2026-11-15.

## What changes, in one paragraph

165 calls in 39 files go. Each is replaced by the Effect-native way first: a schema decoded once, a
`Predicate` check, a narrow, or a plain typed read. One built-in lint rule holds the ban at `error`.
It turns on in slice 1 for every folder already at zero (the three tooling folders and most of
`next/`), and each later slice ends with its own folder at zero and added to the rule. Cold folders
go first. The busy ones wait for the three open branches and are named as waiting.

## The count

Counted on `origin/main` at `ca4444777` by running the rule itself: oxlint 1.90.0, a throwaway
config with only the three entries, over `next/`, `.agents/`, the `oxlint-plugins` folder and the CI scripts.
Nothing in the repo changed. It fires 165 times in 39 files: 155 `get`, 6 `set`, 4 `has`.

| Folder | Fires | In how many | Slice | State |
|---|---|---|---|---|
| `.agents/`, the `oxlint-plugins` folder, the CI scripts | 0 | 0 | 1 | cold |
| `next/packages/tuval/src/browser` | 4 | 1 | 2 | cold |
| `next/packages/libfabrika/src/codehost` | 1 | 1 | 3 | cold |
| `next/packages/libfabrika/src/transport` | 3 | 2 | 4 | cold |
| `next/packages/libfabrika/src/settings` | 2 | 2 | 5 | cold |
| `next/programs/pipeline` | 3 | 2 | 6 | cold |
| `next/programs/counter` | 2 | 1 | 7 | cold, one shared file |
| `next/packages/libfabrika/src/node` | 6 | 4 | 9 | waiting |
| `next/packages/libfabrika/src/cloudflare` | 28 | 5 | 10 | waiting |
| `next/packages/libfabrika/src/runtime` | 18 | 3 | 11 | waiting |
| `next/packages/libfabrika/src/client` | 50 | 3 | 12 | waiting |
| `next/apps/fabrika/e2e` | 15 | 5 | 13 | waiting |
| `next/apps/fabrika/src` | 33 | 10 | 14 | waiting |

- Every other folder of `next/` has 0 fires, `processes` and `gateway` included.
- A text search finds 5 more matches the rule cannot see: 3 inside strings that write code, 1 in a
  comment and 1 in a README table. Each is in a slice below.
- The brief expected about 140 in about 30 files. The real number is 165 in 39.
- No file aliases `Reflect` or reaches it through `globalThis` today.

## How others do it

- **The Effect team.** The installed Effect is 4.1.2 (the lockfile). Its own guide, shipped in the
  package as `AGENTS.md`, says at line 114 to use `Schema` to parse untrusted data and not manual
  parsing, and from line 319 to use the `Predicate` module for small checks. Read in the installed
  source: `Predicate.hasProperty` (`Predicate.ts:1352`), `Predicate.isTagged` (`:1452`),
  `Predicate.isObjectOrArray` (`:1218`), `Schema.is` (`Schema.ts:1461`) and the five
  `Schema.decodeUnknown*` functions (`:1535` on).
- **Their tests hand a typed function a wrong value with `@ts-expect-error`.** GitHub's code search
  finds it across `Effect-TS/effect`'s `packages/effect/typetest/`. `next/` already does the same
  151 times in 30 files, and our lint allows it by name.
- **Where we are stricter than them.** 0554 records that the Effect team keeps `Reflect.get` in 18
  files, mostly as the pass-through in a `Proxy` trap. We keep it in 3 hostile-input proxies and
  one shared helper only. That is the owner's choice, written in 0554.
- **The lint rule.** ESLint's `no-restricted-properties` is the industry's rule for banning one
  member of one object, and oxlint ships it. 0554 names it as the hold.
- **The trusted repos.** The anti-slop plugin has `no-reflect-get`. Decision 0563 (accepted, in
  https://github.com/kamp-us/tea-fabrika/pull/1363, not on main) takes it, and says its rule reads
  only `get`, so `set` and `has` need the built-in rule either way. The plugin is not installed
  yet. Not fetched for this plan: the plugin's source.

## What replaces each kind of call

Every hit was read. Each block is real code from `origin/main`, then its replacement. Each "after"
is a sketch and was not compiled: this step runs no typecheck.

**1. Fields of a loose value: one schema, decoded once.** The largest kind, about half of all
fires. Most are in the window laws, where a ledger entry or a frame's `params` is read field by field.

```ts
// next/packages/libfabrika/src/client/WindowMachine.laws.test.ts:2527, before
const entry = Object(raw);
const rev: unknown = Reflect.get(entry, "rev");
const body = Object(Reflect.get(entry, "body"));
const process: unknown = Reflect.get(body, "process");

// after: one schema for what this loop reads, decoded once per entry
const Read = Schema.Struct({
  rev: Schema.optionalKey(Schema.Number),
  by: Schema.optionalKey(Schema.Unknown),
  _tag: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(Schema.Struct({ process: Schema.optionalKey(Schema.String) })),
});
const entry = Schema.decodeUnknownOption(Read)(raw);
```

A schema that refuses a whole entry drops fields the old loop still read (0554). So each loop's
schema makes every field optional and as loose as the old read, and the law keeps its own checks.
The reviewer compares each loop by hand.

**2. One field in a check: `Predicate.hasProperty`, or `Predicate.isTagged` for a tag.**

```ts
// next/programs/pipeline/src/QueueRunnerTest.ts:305, before
typeof l.m === "object" && l.m !== null && Reflect.get(l.m, "type") === "land"
// after
Predicate.hasProperty(l.m, "type") && l.m.type === "land"

// next/packages/libfabrika/src/transport/Handshake.laws.test.ts:232, before
m.type === "hello_err" && Reflect.get(Object(m["error"]), "_tag") === "key"
// after
m.type === "hello_err" && Predicate.isTagged(m["error"], "key")
```

Product code already reads this way: `next/apps/fabrika/src/runtime.ts:77`.

**3. A field of one of our errors: check the class, then read the typed field.**

```ts
// next/packages/libfabrika/src/cloudflare/platform.test.ts:117, before
const cause = Reflect.get(Object(error), "cause");
expect(cause).toBeInstanceOf(RpcCallError);
expect(Reflect.get(Object(cause), "cause")).toBe(fault);
// after
expect(Schema.is(LedgerError)(error) && error.cause instanceof RpcCallError && error.cause.cause).toBe(fault);
```

**4. A field the type has, or will have: read it plainly.** A law for a field the build has not
added yet writes the field. Its type error is the law's red (0554).

```ts
// next/packages/libfabrika/src/client/WindowMachine.laws.test.ts:1338, before
Reflect.get(s, "handshake") ?? { _tag: "none" };
// after: the model has the field today
s.handshake;
```

A field on one case of a union is read after the narrow. At `Tezgah.laws.test.ts:1073` the key of
a key press is read as `m.type === "key" && m.key` (a sketch).

**5. A method picked by a name in a variable: a typed table.** This is the one product call with no
line-for-line fix.

```ts
// next/packages/libfabrika/src/cloudflare/control.ts:124, before
const answer: Effect.Effect<unknown, unknown> = Reflect.apply(Reflect.get(client, method), client, args);

// after: each target's table maps a method name to a call that decodes its own arguments,
// the way the "bucket" branch of the same function already does at control.ts:84
const project = {
  read: (c: ProjectClient["Service"], args: ReadonlyArray<unknown>) =>
    Effect.flatMap(decode(ReadArgs)(args), (a) => c.read(...a)),
  // one line per method of today's `methods.project` set, which this table replaces
};
```

The `methods` sets go: the table's keys are the allowed names, so the two cannot drift. In tests,
the same kind (`Reflect.get(service, method)` over every method of a client) becomes a loop over
`Object.entries(service)`, which hands back each function with its name.

**6. A call the dev client's type does not name: give the client real types.**

```ts
// next/apps/fabrika/src/worker-mail.integration.test.ts:355, before
const started = await Reflect.get(instance.project(PROJECT), "start")(request, from);
// after, once slice 9 types the client in next/packages/libfabrika/src/node/dev/dev.ts
const started = await instance.project(PROJECT).start(request, from);
```

17 fires in 8 files are this kind on main at `9ca24b1` (amendment of 2026-11-15). All wait for slice 9.

**7. A value on `globalThis`: declare it once with its type.**

```ts
// next/packages/tuval/src/browser/key.laws.visual.test.ts:121, before
page.evaluate(() => Reflect.get(globalThis, "__key").claim())
// after
declare global {
  // What the page's entry puts on the tab for this law.
  var __key: { current(rejected: string | null): Promise<Answer<Key>>; claim(): Promise<Answer<boolean>> };
  var __realOpen: IDBFactory["open"] | undefined;
}
page.evaluate(() => globalThis.__key.claim())
```

`next/apps/fabrika/e2e/one-file.visual.test.ts:223` already does this. 11 fires are this kind.

**8. A walk down a path of keys: narrow at each step.**

```ts
// next/packages/libfabrika/src/settings/internal/edit.ts:63, before
Predicate.isObjectOrArray(parent) && Object.hasOwn(parent, key) ? Reflect.get(parent, key) : undefined
// after: hasProperty narrows, hasOwn keeps the own-key rule the comment above `put` asks for
Predicate.hasProperty(parent, key) && Object.hasOwn(parent, key) ? parent[key] : undefined
```

`TomlParser.ts:35` gets the same narrow. Today a scalar in the middle of a path makes the next
`Object.defineProperty` throw. The tests step pins that case first if no law holds it, and the
build keeps the answer. The two test-side patch appliers (`Patch.test.ts:27`, the counter's
`runner.laws.integration.test.ts:66`) type their document as JSON and narrow with
`Predicate.isObjectOrArray` before each index and each assignment.

**9. The pass-through in a `Proxy` trap.** Three sub-kinds, as 0554 sorts them:

```ts
// a wrapper that changes one member: a plain object, as Launchd.test-support.ts:294 does one line up
const disk = Layer.succeed(FileSystem.FileSystem, { ...fs, open: (file, options) => /* ... */ });

// a stub that answers any method name: the shared helper of slice 8
const stub = Stub.make<ProjectBinding>(() => async () => { throw fault; });

// a hostile input, where the Proxy is the value under test: the line stays, with its reason
// oxlint-disable-next-line eslint/no-restricted-properties -- the Proxy is the hostile value this law feeds in; the trap forwards every other key
return Reflect.get(t, key, receiver);
```

Only the 3 hostile-input proxies (`Connection.test.ts:743`, `runtime.decode.test.ts:160`,
`Program.test.ts:1264`) keep a `Reflect` line: a `has` and a `get` each, so 6 disable lines in
all. The helper needs none. A wrapper whose object keeps its members on a prototype cannot be
spread; it lists each member it forwards.

**10. A typed function handed a value its type refuses: a plain call under `@ts-expect-error`.**
0554 left this open. The lean, at 85%, is the Effect team's own way:

```ts
// next/packages/libfabrika/src/runtime/Program.test.ts:927, before
const make = Reflect.get(Program, "make");
expect(() => Reflect.apply(make, Program, [raw])).toThrow();
// after
// @ts-expect-error raw is untrusted JavaScript, which the type refuses and this law feeds in on purpose
expect(() => Program.make(raw)).toThrow();
```

If the type ever takes the value, the comment itself becomes an error, so the law cannot go stale.

**11. Text that is not a call.** Read by hand, since lint cannot see into a string.

- `next/apps/fabrika/src/exam/twin.integration.test.ts:93-95` stays as it is. It lists the ways
  outside code can call a function, and `Reflect.get` is one of the inputs the law tries. It is the
  value under test (85%).
- `next/apps/fabrika/src/instance-records.integration.test.ts:288` is generated JavaScript for a
  Worker. `Reflect.get(base, name)` becomes `base[name]`, which is plain there: the text has no
  types.
- `Program.test.ts:1006`, a comment, is reworded. `oxlint-plugins/README.md:541` names a
  `Reflect.get` in `dev.ts` that is gone, so the row is corrected.

**12. A probe for a polluted prototype.** `Patch.test.ts:244` reads `Reflect.get({}, "polluted")`.
It becomes `Object.hasOwn(Object.prototype, "polluted")`, which says what the law means.

No fix swaps one way past the types for another: no `Object(x)[key]`, no `as` to a loose record, no
`Object.getOwnPropertyDescriptor(x, k)?.value` (0554's binding constraint).

## The shape

### The hold

One built-in rule, `eslint/no-restricted-properties`, with four entries.

```jsonc
// The entries, a sketch. The first three are 0554's. The fourth closes a gap the probe found.
{ "object": "Reflect", "property": "get", "message": "Decode with Schema, or narrow first (0554)." },
{ "object": "Reflect", "property": "set", "message": "Assign through the type (0554)." },
{ "object": "Reflect", "property": "has", "message": "Narrow with Predicate.hasProperty (0554)." },
{ "object": "globalThis", "property": "Reflect", "message": "Name Reflect directly, so lint can read the call (0554)." }
```

The rule was probed on a scratch file with oxlint 1.90.0, outside the repo:

- It fires on `Reflect.get(x)`, `Reflect["get"](x)`, `Reflect?.get(x)`, `(Reflect).get` and a
  destructure, `const { get } = Reflect`, renamed or not.
- It misses `globalThis.Reflect.get(x)`. The fourth entry refuses `globalThis.Reflect`, which
  nothing uses today.
- It misses an alias, `const R = Reflect; R.get(x)`. No built-in rule sees that. Nothing does it
  today, and the review reads for it.
- `Reflect.apply`, `Reflect.construct` and `Reflect.deleteProperty` pass. 0554 does not decide them.

**An override replaces a rule's options,** so a folder gets the `Reflect` entries only from a block
that also repeats what the folder had. Three kinds of folder exist in `next/` today:

```jsonc
// 1. Most of next/: the block at .oxlintrc.json:1729 sets JSON.parse at "error".
// 2. client/: the block at :1746 sets JSON.parse and two retry entries at "error".
// 3. 14 folders: the block at :2296 sets JSON.parse at "warn", which pnpm lint prints as advice.
```

So slice 1 adds four blocks after `:2296`, each a list of folders where the ban is on:

```jsonc
// a sketch, not run
{ "files": [/* the three tooling folders */],
  "rules": { "eslint/no-restricted-properties": ["error", /* the four Reflect entries */] } },
{ "files": [/* each next/ folder of kind 1 that is at zero */],
  "rules": { "eslint/no-restricted-properties": ["error", /* JSON.parse, then the four */] } },
{ "files": [/* client/**, once slice 12 lands */],
  "rules": { "eslint/no-restricted-properties": ["error", /* JSON.parse, two retries, the four */] } },
{ "files": [/* each folder of kind 3 that is at zero */],
  "rules": { "eslint/no-restricted-properties": ["warn", /* JSON.parse, then the four */] } }
```

- Slice 1 lists every folder that is at zero today. Each later slice adds its own folder.
- A folder is listed whole. No file is named, and no folder is ever taken off.
- **This is the form 0168 and 0562 name:** the rule turns on for each folder when it reaches zero.
  It is not a list of leftovers. No block turns the rule off or down for a dirty folder.
- Slice 15, the last, folds the four blocks into the three base blocks, so `next/**/*` holds the
  ban for every folder, a new one included, and the lists are deleted.
- Until the fold, a brand-new folder in `next/` is not covered. That is the cost of turning on
  folder by folder.

**The fourth block says `warn`, and still blocks.** `pnpm lint` fails on every diagnostic but
advice. Today `oxlint-plugins/advice.ts` calls a fire advice when its rule code is one of six and
oxlint graded it a warning. For the built-in rule that is too wide: 0523 names it only as the
`JSON.parse` guard. Slice 1 narrows it:

```ts
// oxlint-plugins/advice.ts, a sketch. Today ADVICE is a set of codes; it becomes a map.
/** One fire as oxlint reports it. */
export interface Fire {
  readonly code?: string;
  readonly severity?: string;
  readonly filename?: string;
  readonly message?: string;
}

const always = () => true;

/** Each advice rule's code, and which of its fires may advise. */
const ADVICE: ReadonlyMap<string, (fire: Fire) => boolean> = new Map([
  // Only the JSON.parse guard advises (0523). Any other entry of this rule blocks at every level.
  ["eslint(no-restricted-properties)", (fire) => (fire.message ?? "").startsWith("'JSON.parse' ")],
  ["fabrika(jsdocs)", always],
  // the other four, unchanged
]);

export const advises = (fire: Fire): boolean =>
  fire.severity === "warning" && (ADVICE.get(fire.code ?? "")?.(fire) ?? false);
```

Oxlint prints the fire's message as `'JSON.parse' is restricted from being used.` and the entry's
own text as a separate hint, so the check does not depend on our wording. This also closes a trap
that bit before: `oxlint-plugins/README.md:879` records that `no-cause-squash` became a rule of our
own because this rule's code "only advises".

**Why not the other holds.** Judged by what each loses:

- A rule of our own would block at `error` everywhere with no runner change. 0554 names the
  built-in rule, and 0563 says we never write our own version of a rule the plugin's authors wrote.
- The plugin's `no-reflect-get` is not installed, and reads only `get`.
- Finishing the `JSON.parse` cleanup first would delete the `warn` block, but it is about 110
  unrelated lines in the busiest folders.

**When the plugin lands,** the plan that turns on `anti-slop/no-reflect-get` says whether it stands
beside these entries or takes over the `get` one (0563). `set`, `has` and `globalThis.Reflect` stay
here either way.

### The shared stub, in the test package

0554 puts the fakes of Cloudflare objects in `next/`'s test package, `@kampus/vitest` in
`next/packages/vitest`, and leaves the shape to this plan. All 18 hand-written stubs and guards
have one shape: some members answer by name, and every other method name gets one answer.

```ts
// next/packages/vitest/src/Stub.ts, a sketch, read through its module as `Stub.make` (0029)

/**
 * A stand-in for a platform object, such as a Durable Object stub, its storage or a bucket.
 * `own` answers by name. Any other method name answers `rest(name)`.
 * `then` and symbol keys answer undefined, so awaiting the stub never hangs.
 */
export const make: <A extends object>(
  rest: (method: string) => (...args: ReadonlyArray<unknown>) => unknown,
  own?: Partial<A>,
) => A;
```

```ts
// One call and its answers, from next/packages/libfabrika/src/cloudflare/platform.test.ts:27
const stub = Stub.make<ProjectBinding>(() => async () => { throw fault; });
stub.read("beats", 0); // a Promise that rejects with `fault`
stub.then;             // undefined

// a guard: fails the law on any use it did not expect, with one member that answers
const project = Stub.make<ProjectBinding>(unexpected, { settingsStart: async () => StartsTest.reply(good) });
```

- The helper holds the one cast from the `Proxy` to `A`, on one line with its reason. That is the
  point of one place. Its trap reads `own` with `Predicate.hasProperty`, so it has no `Reflect`
  line.
- It imports no service of ours, so 0538's rule for the package holds.
- One function, not three (80%). `rejecting` and `answering` in the tests today are one line each
  over `make`, and a name per use would hide that they are the same thing.
- The package is to be renamed `@kalfa/vitest` (0557). This plan builds under today's name. The
  rename moves the file with the rest.

### The dev client

`next/packages/libfabrika/src/node/dev/dev.ts:52` types the client as a bare record of functions.
Slice 9 types `project(p)` and `process(pid)` by the methods their objects have, each answering a
Promise. The 17 calls made through `Reflect.get` then become plain calls. Where the method types
come from is the amendment of 2026-11-15, with its code.

## One value traced: a new `Reflect.get` in a folder that only advises for `JSON.parse`

1. After slice 4, someone adds `Reflect.get(m, "error")` to a law in
   `next/packages/libfabrika/src/transport/`.
2. Oxlint matches the file to the fourth block. The rule is at `warn` there, with five entries.
3. Oxlint reports code `eslint(no-restricted-properties)`, severity `warning`, message
   `'Reflect.get' is restricted from being used.`
4. `oxlint-plugins/lint.ts` asks `advises(fire)`. The code is in the map and the severity is a
   warning, but the message does not start with `'JSON.parse' `. The answer is no.
5. The fire is printed as blocking, and `pnpm lint` exits 1.
6. Before slice 1 the answer at step 4 was yes, and the line would have merged as advice.

## One value traced: one hit, from red to gone

1. `next/programs/pipeline/src/QueueRunnerTest.ts:308` holds
   `Reflect.get(l.m, "type") === "land"`.
2. Slice 6's tests step adds `next/programs/pipeline/**` to the second block. `pnpm lint` on that
   folder now fails with 3 fires. That is the slice's red.
3. The same step rewrites the line as `Predicate.hasProperty(l.m, "type") && l.m.type === "land"`.
4. `pnpm lint` on the folder passes, and the suite that runs `QueueRunnerTest` still passes.
5. The plant: put the old line back. Lint fails on it.

## Laws

A check on the shape of code is a lint rule, so most laws here are lint. Each lint law is seen to
fail through a planted line, run with the repo's own config, as `oxlint-plugins/plants.test.ts`
does for the other built-in rules.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1. In every folder a block lists, `Reflect.get`, `Reflect.set`, `Reflect.has` and `globalThis.Reflect` are refused, and `Reflect.apply` passes | lint | lint | delete one entry from one block: L1 red for that folder | oxlint-plugins/builtin-plants.ts, oxlint-plugins/plants.test.ts |
| L2. A warn-level fire of the built-in rule is advice only when it is the `JSON.parse` fire. A `Reflect` fire in a folder of the fourth block makes `pnpm lint` exit 1 | test | scenario: a small config with one dirty folder, one planted `JSON.parse` line and one planted `Reflect.get` line, run through the real runner | make `advises` read the code alone again: L2 red | oxlint-plugins/advice.test.ts |
| L3. A `Reflect` fire does not keep a `JSON.parse` warn line alive: with no `JSON.parse` fire left in the folder, a whole run still names the warn line stale | test | scenario: the same small config with the `JSON.parse` line removed | count every warning of the rule as holding the line: L3 red | oxlint-plugins/advice.test.ts |
| L4. Every block that sets the rule for a `next/` path keeps the `JSON.parse` entry at the level the folder had, and `client/` keeps its two retry entries | test | pinned: the real config, read from oxlint's own `--print-config`, since the law is about this one file | drop `JSON.parse` from the second block: L4 red | oxlint-plugins/advice.test.ts |
| L5. Each slice's folder has no fire and no disable line for the rule outside the 6 lines this plan names | lint | lint | put one old line back in the folder: `pnpm lint` red | .oxlintrc.json |
| L6. `Stub.make`: any method name not in `own` answers `rest(name)` with that name, `own` members answer as given, `then` and symbol keys are undefined. 200 runs | test | fc.record: a method name from fc.string, own keys from fc.uniqueArray of fc.string | answer `then` with a function: L6 red | next/packages/vitest/src/Stub.test.ts |
| L7. The dev client names its methods: `instance.project(p).start` is a function type, and a name the object lacks is a type error | type | type | type the client as a bare record again: L7 red in a typecheck | next/packages/libfabrika/src/node/dev/dev.types.test.ts |
| L8. The control door calls exactly the method its request names with the decoded arguments, and any other name fails `unknown_method`. 200 runs | test | fc.record: a method from fc.constantFrom over the table's keys or fc.string, arguments from fc.array of fc.jsonValue | drop one key from the table: L8 red for that method | next/packages/libfabrika/src/cloudflare/control.laws.test.ts |
| L9. A settings path with hostile keys (`__proto__`, `constructor`, `toString`) is put and read back, a scalar in the middle of a path answers as it does today, and `Object.prototype` is unchanged. 200 runs | test | fc.record: a path from fc.array of fc.constantFrom over hostile and plain keys, a value from fc.jsonValue | read with `in` and no own-key check: L9 red | next/packages/libfabrika/src/settings/TomlEdit.test.ts |
| L10. After the fold, a planted `Reflect.get` is refused in a folder of `next/` that no block names, and no list block is left | lint | lint | leave `next/**/*` without the entries: L10 red | oxlint-plugins/builtin-plants.ts |

- No law needs the real machine, so none is host-only. No law reads a secret.
- Every existing law in a file this plan edits stays as strict as it is. A rewritten read must
  refuse what the old read refused. The reviewer runs the loosening check on each slice.
- L7 is red only in a typecheck. The tests step says so in its report, and the build runs it.

## Files

Almost every file is an exam path (a test file, the lint config, the lint tooling), so the tests
step owns most of this quest. A slice with no build row has two steps: tests, then review.

### Slice 1, the rule and the tooling

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| .oxlintrc.json | tests | configuration | the four blocks, with every folder at zero today; each later slice adds its folder here, and slice 15 folds them |
| oxlint-plugins/advice.ts | tests | 0 | `ADVICE` becomes a map; `Fire` gets `message`; only the `JSON.parse` fire advises |
| oxlint-plugins/advice.test.ts | tests | tests | L2, L3, L4 |
| oxlint-plugins/lint.ts | tests | 0 | pass the fire's message through, if it does not already |
| oxlint-plugins/builtin-plants.ts | tests | tests | L1's planted lines, and L10's in slice 15 |
| oxlint-plugins/plants.test.ts | tests | tests | run L1's plants under a tooling path and a `next/` path |
| oxlint-plugins/README.md | tests | docs | correct the stale row at line 541; a short section for the ban, with the probe's results; the line at 879 no longer says the rule only advises |
| next/AGENTS.md | build | docs | one row in "What lint holds" |

### Slices 2 to 7, the cold folders of `next/`

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/tuval/src/browser/key.laws.visual.test.ts | tests | tests | slice 2: kind 7, 4 fires |
| next/packages/libfabrika/src/codehost/CodeHostTest.ts | tests | tests | slice 3: kind 2, 1 fire |
| next/packages/libfabrika/src/transport/Connection.test.ts | tests | tests | slice 4: kind 9, the hostile input; 2 lines stay, each with its reason |
| next/packages/libfabrika/src/transport/Handshake.laws.test.ts | tests | tests | slice 4: kind 2, 1 fire |
| next/packages/libfabrika/src/settings/TomlParser.ts | build | 6 | slice 5: kind 8 |
| next/packages/libfabrika/src/settings/internal/edit.ts | build | 2 | slice 5: kind 8 |
| next/packages/libfabrika/src/settings/TomlEdit.test.ts | tests | tests | slice 5: L9, and the scalar-in-a-path case pinned before the build |
| next/programs/pipeline/src/QueueRunnerTest.ts | tests | tests | slice 6: kind 2, 1 fire |
| next/programs/pipeline/src/Settings.test.ts | tests | tests | slice 6: kind 8, 2 fires |
| next/programs/counter/src/runner.laws.integration.test.ts | tests | tests | slice 7: kind 8, 2 fires |

### Slice 8, the shared stub

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/vitest/src/Stub.ts | build | 30 | the helper |
| next/packages/vitest/src/Stub.test.ts | tests | tests | L6 |
| next/packages/vitest/src/index.ts | build | 1 | `export * as Stub from "./Stub.ts"` |

### Slices 9 to 12, the waiting folders of the library

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/runtime/ObjectCalls.ts | build | 30 | slice 9: new; `RemoteCall`, `Remote` and `ProcessObjectCalls`, moved type-only from `cloudflare/bindings.ts` (amendment of 2026-11-15) |
| next/packages/libfabrika/src/cloudflare/bindings.ts | build | 15 | slice 9: imports the three types back; `ProcessBinding` becomes `Rpc.DurableObjectBranded & ProcessObjectCalls`; 0 fires |
| next/packages/libfabrika/src/node/dev/dev.ts | build | 70 | slice 9: the typed client, `DevProject` and `DevProcess`; 0 fires |
| next/packages/libfabrika/src/node/dev/dev.types.test.ts | tests | tests | slice 9: L7, new; it imports `cloudflare/bindings.ts` types, as `node/IsolateUsage.integration.test.ts:12` does today |
| layer-rules.json | tests | 0 | slice 9: no change, by the merge session's ruling; read to place the moved types |
| next/apps/fabrika/src/exam/layers.integration.test.ts | tests | tests | slice 9: no change; its plant at :289 shows the layer check reads `import type` |
| next/packages/libfabrika/src/node/IsolateUsage.integration.test.ts | tests | tests | slice 9: no change; the model for a `node/` test that imports `cloudflare/bindings.ts` |
| next/packages/libfabrika/src/node/dev/dev-control.laws.integration.test.ts | tests | tests | slice 9: 3 fires; kind 9 at :241 and :279, two wrappers become plain objects; :470, the `ping` call, is the fake member of the amendment of 2026-11-15 |
| next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts | tests | tests | slice 9: kind 6, 1 fire, at :380 |
| next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts | tests | tests | slice 9: kind 9, 1 fire, at :69; a wrapper becomes a plain object |
| next/packages/libfabrika/src/node/launchd/Launchd.test-support.ts | tests | tests | slice 9: kind 9, 1 fire, at :319; the handle wrapper becomes a plain object |
| next/packages/libfabrika/src/cloudflare/control.ts | build | 60 | slice 10: kind 5, the typed table, 1 fire, at :124 (point 7) |
| next/packages/libfabrika/src/cloudflare/control.laws.test.ts | tests | tests | slice 10: L8 |
| next/packages/libfabrika/src/cloudflare/platform.test.ts | tests | tests | slice 10: kinds 3, 5 and 9, 19 fires; `rejecting` (:27), `answeringProcess` (:82) and `answering` (:138) become `Stub.make`, in point 7's shape |
| next/packages/libfabrika/src/cloudflare/readers.laws.test.ts | tests | tests | slice 10: kind 9, 5 fires, at :147, :151, :169, :171, :705; wrappers over real objects, not stubs |
| next/packages/libfabrika/src/cloudflare/ObjectService.test.ts | tests | tests | slice 10: kind 3, 2 fires, at :208 and :370; its two guards (:323, :347) become `Stub.make`; edited by pull request 1366, now merged (point 7) |
| next/packages/libfabrika/src/cloudflare/error-cause.test.ts | tests | tests | slice 10: kind 9, 1 fire, at :209; its stubs (`rejecting` at :47, the wrapper at :205) become `Stub.make` |
| next/packages/libfabrika/src/cloudflare/alarm.laws.test.ts | tests | tests | slice 10: no fire; its 4 hand-written guards (:168, :169, :378, :379) become `Stub.make`; edited by pull request 1366, now merged |
| next/packages/libfabrika/src/cloudflare/index.test.ts | tests | tests | slice 10: no fire; its guard (:102) becomes `Stub.make` |
| next/packages/libfabrika/src/cloudflare/p14.test.ts | tests | tests | slice 10: no fire; its stub (:45) becomes `Stub.make` |
| next/packages/libfabrika/src/telemetry/Records.integration.test.ts | tests | tests | slice 10: no fire; its stub (:499) becomes `Stub.make` |
| next/packages/libfabrika/src/runtime/Program.test.ts | tests | tests | slice 11: kinds 9, 10 and 11, 10 fires; 2 lines stay in the hostile input |
| next/packages/libfabrika/src/runtime/Patch.test.ts | tests | tests | slice 11: kinds 8 and 12, 5 fires |
| next/packages/libfabrika/src/runtime/Client.laws.test.ts | tests | tests | slice 11: kinds 1 and 2, 3 fires |
| next/packages/libfabrika/src/client/WindowMachine.laws.test.ts | tests | tests | slice 12: kinds 1, 2 and 4, 33 fires |
| next/packages/libfabrika/src/client/WindowStart.laws.test.ts | tests | tests | slice 12: kinds 1 and 3, 9 fires |
| next/packages/libfabrika/src/client/Tezgah.laws.test.ts | tests | tests | slice 12: kinds 1, 2 and 4, 8 fires |

### Slices 13 and 14, the app

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/apps/fabrika/e2e/client-protocol.test-support.ts | tests | tests | slice 13: kind 1, 5 fires |
| next/apps/fabrika/e2e/first-window.visual.test.ts | tests | tests | slice 13: kinds 2 and 7, 3 fires |
| next/apps/fabrika/e2e/p14.test-support.ts | tests | tests | slice 13: kind 1, 2 fires |
| next/apps/fabrika/e2e/page-runtime.laws.visual.test.ts | tests | tests | slice 13: kind 7, 3 fires |
| next/apps/fabrika/e2e/tezgah-focus.visual.test.ts | tests | tests | slice 13: kind 7, 2 fires |
| next/apps/fabrika/e2e/one-file.visual.test.ts | tests | tests | no change: the model for kind 7 |
| next/apps/fabrika/src/checklist-instance.laws.integration.test.ts | tests | tests | slice 14: kinds 2 and 5, 3 fires, at :186, :247, :687; its 2 stubs (:269, :315) become `Stub.make` |
| next/apps/fabrika/src/door.integration.test.ts | tests | tests | slice 14: kind 1, 2 fires, at :5812 and :5835 |
| next/apps/fabrika/src/hands-launcher.integration.test.ts | tests | tests | slice 14: kind 6, 2 fires (:114, a method picked by a name the type names, becomes `project[name]`; :233, a `start`) |
| next/apps/fabrika/src/worker-monitor.integration.test.ts | tests | tests | slice 14: kind 6 at :335 and kind 2 at :362, 2 fires |
| next/apps/fabrika/src/input-recording.integration.test.ts | tests | tests | slice 14: kind 5, 1 fire, at :40 |
| next/apps/fabrika/src/instance-records.integration.test.ts | tests | tests | slice 14: kind 6, 1 fire, at :232; kind 11, the generated text at :288 |
| next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts | tests | tests | slice 14: kinds 1 and 5, 9 fires, at :565, :730, :866, :1502, :1521, :1647, :1648, :1826, :1828; its 2 stubs (:613, :689) become `Stub.make` |
| next/apps/fabrika/src/runtime-quotas.laws.test.ts | tests | tests | slice 14: new with pull request 1366 (point 7); 5 fires: kind 5 at :320 and :371, kind 1 at :488 and :491, a `Reflect.set` at :660; its 2 stubs (:305, :353) become `Stub.make` |
| next/apps/fabrika/src/runtime.decode.test.ts | tests | tests | slice 14: 5 fires, at :72, :83, :84, :165, :176; kind 2, 3 fires; kind 9, 2 lines stay in the hostile input |
| next/apps/fabrika/src/scheduled-job-alarm.integration.test.ts | tests | tests | slice 14: kind 6, 6 fires, at :135, :143, :159, :182, :184, :186 |
| next/apps/fabrika/src/tasks-wire.integration.test.ts | tests | tests | slice 14: kind 6, 1 fire, at :228 |
| next/apps/fabrika/src/worker-mail.integration.test.ts | tests | tests | slice 14: kind 6, 3 fires, at :356, :749, :952 |
| next/apps/fabrika/src/worker-quotas.integration.test.ts | tests | tests | slice 14: new with pull request 1366 (point 7); kind 6, 1 fire, at :189; its `rpc` helper takes a thunk, as point 6's `invoke` does |
| next/apps/fabrika/src/worker-supervision.integration.test.ts | tests | tests | slice 14: kind 6, 2 fires, at :141 and :359 |
| next/apps/fabrika/src/exam/twin.integration.test.ts | tests | tests | no change: kind 11, read by hand, the text stays |

Slice 15 changes only `.oxlintrc.json`, `oxlint-plugins/builtin-plants.ts` and
`oxlint-plugins/README.md`, which slice 1's table already gives to the tests step.

## The order, and what waits

**Cold, start now, in this order:** slice 1, then 2 to 8 in any order. Slice 1 is first because it
makes the hold real.

- Cold means no open branch edits a file the slice edits, the lint config aside. Three slices share
  one file with https://github.com/kamp-us/tea-fabrika/pull/1301: slice 7's one test file, slice
  1's `oxlint-plugins/README.md` and `oxlint-plugins/plants.test.ts`, and slice 8's
  `next/packages/vitest/src/index.ts`. Each is a few lines. Whichever lands second rebases.
- `.oxlintrc.json` is edited by every slice and by four open pull requests. Each slice adds one
  line to one list, so a clash is one line.

**Waiting, each named with what it waits on.** The list below is the order as signed on
2026-11-15. The amendment of 2026-11-15 replaces it for slices 9 to 15; see "Amendments".

- Slice 9, `node`: https://github.com/kamp-us/tea-fabrika/pull/1331,
  https://github.com/kamp-us/tea-fabrika/pull/1341 and the quotas slice (branch
  `fabrikalfa/p34c-s4`).
- Slice 10, `cloudflare`: pull request 1341, the quotas slice, and slice 8.
- Slice 11, `runtime`: pull request 1341, the quotas slice, and
  https://github.com/kamp-us/tea-fabrika/pull/1099, which edits `Program.test.ts`.
- Slice 12, `client`: pull request 1331, and https://github.com/kamp-us/tea-fabrika/pull/1312 and
  https://github.com/kamp-us/tea-fabrika/pull/1232, which both edit `WindowMachine.laws.test.ts`.
- Slices 13 and 14, the app: all of the above, and slice 9 for the typed dev client.
- Slice 15, the fold: every other slice.

`processes` and `gateway` are busy too, but have no fire, so slice 1 turns the ban on there at once.
A branch that adds a call there after slice 1 lands goes red in its own pull request.

When a waiting slice starts, its files have moved. The lead has its counts taken again with the
rule, and an amendment to this plan records the new numbers before the tests step runs.

## Calls taken

- **The built-in rule holds all three methods now; the plugin's rule is not waited for (85%).**
  0554 on main names it, and the sev0 does not wait on an install.
- **Only the `JSON.parse` fire of that rule can advise (80%).** See the first doubt.
- **The ban turns on through blocks that list clean folders, folded into the base blocks at the end
  (85%).** It is the form 0168 and 0562 describe. The other form, a shrinking list of dirty
  folders, would cover a new folder at once, but it is a list of leftovers in all but name.
- **`globalThis.Reflect` is refused too (90%).** The probe showed the gap, and 0554 asked the lint
  pull request to find out.
- **An alias of `Reflect` is left to review (85%).** No built-in rule reads it, and a rule of our
  own for one shape nobody writes is a cost with no hit.
- **`@ts-expect-error` replaces `Reflect.apply(Reflect.get(...))` for a value a type refuses
  (85%).** 0554 left it open. It is the Effect team's way and already ours 151 times.
- **One helper, `Stub.make`, in `next/packages/vitest/src/Stub.ts` (80%).** 0554 gave the shape to
  this plan.
- **`twin.integration.test.ts` keeps its `Reflect.get` text (85%).** It is an input the law tries.
- **One pull request per folder,** as the brief asks. Slices 2 to 7 are 1 to 4 lines each; the lead
  may run them as one chain.

**Is this a setting?** No, for each choice. Which calls are banned and where the ban is on are
rules about our own source, held by lint, and nothing a person running fabrika picks. They are not
`fabrika.toml` values (0069).

## Validation

- The tests step of each slice: `pnpm format`, then `pnpm lint`, then
  `nice -n 19 pnpm exec vitest run --maxWorkers=1` on the narrow path of each file it edited.
- A file named `.integration.` or `.visual.` is not run on the laptop. It runs on the schedule
  (0536), and the slice's pull request says which files that leaves unrun.
- Each plant is run once and recorded in the step's report.
- The lead runs the one type check for a slice with a type law (slice 9) and for each slice that
  swaps a `Reflect.get` for a typed read, since the new read is checked only there.
- Each pull request reports, per 0523: the fires it met, the ones it fixed, and each disable line
  with its reason.

## Size

Fifteen pull requests, each landing whole. Confidence 70%: the doubt is slice 12, where the schema
for each loop of the window laws is checked by hand, and the waiting slices, whose files will have
moved.

1. The rule and the tooling: about 60 lines of configuration, about 20 lines of lint tooling,
   about 150 test lines, about 40 lines of prose. 0 product lines.
2. `tuval/src/browser`: about 15 test lines. 0 product lines.
3. `codehost`: about 3 test lines. 0 product lines.
4. `transport`: about 6 test lines. 0 product lines.
5. `settings`: 8 product lines, about 40 test lines.
6. `programs/pipeline`: about 8 test lines. 0 product lines.
7. `programs/counter`: about 10 test lines. 0 product lines.
8. The shared stub: 31 product lines, about 60 test lines.
9. `node`, with the typed dev client: 115 product lines, about 140 test lines (amendment of
   2026-11-15: the new `runtime/ObjectCalls.ts` and the edit of `cloudflare/bindings.ts`; point 6
   adds about 60 test lines in five app tests).
10. `cloudflare`, with the control table: 60 product lines, about 250 test lines (point 7: unchanged).
11. `runtime`: about 80 test lines. 0 product lines.
12. `client`: about 300 test lines. 0 product lines.
13. The app's `e2e`: about 60 test lines. 0 product lines.
14. The app's `src`: about 210 test lines. 0 product lines (two more files since the count, and two more from pull request 1366, point 7).
15. The fold: about 40 lines of configuration. 0 product lines.

Priced from the rows in `field/runs/` for 2026-11-10 to 2026-11-15, at list price: a tests step
averages $5.78, a build $4.78, a review $2.71 and a fix round $4.18. The six small cold slices are
priced at $4 each for tests and review. The others: slice 1 $9, slice 8 $13, slice 9 $16, slice 10
$16, slice 11 $10, slice 12 $14, slice 13 $8, slice 14 $14, slice 15 $5, and four send-backs at $7.
That is 33 steps and 4 send-backs. Amendment point 6 adds slice 9's second tests step, at $6.

Estimate: 38 steps, $163

## Records

- **What is lost if it is not recorded now:** the per-folder count before the cleanup, which no
  later run can give back. It is in "The count" above, with its commit. Each slice's pull request
  records the fires it met, its fixes and its disable lines (0523).
- `oxlint-plugins/README.md`: the ban's section, the probe's results, and the two corrected lines.
- `next/AGENTS.md`: one row in "What lint holds".
- `.glossary/TERMS.md`: no new word. "Stub" is the industry's word for a stand-in that gives
  canned answers (Meszaros, xUnit Test Patterns), and the row is added in slice 8 if the glossary
  lacks it.
- `field/`: one run row per step, the same day.
- No decision file. This plan builds 0554 and takes no ruling of the owner's.
- A tracker ticket. It does not exist yet; the title and body are in the plan step's report.

## What this cannot tell us

- **Whether any "after" block compiles.** None was compiled or run. The first typecheck of each
  slice tells.
- **The waiting slices' real numbers.** Three open branches change those folders. The counts above
  are main's at `ca4444777`.
- **Whether every loop's new schema reads all the old loop read.** Only a hand comparison per loop
  tells, and the window laws have about ten such loops.
- **Whether the integration and visual laws still pass,** until the schedule runs them. 17 of the
  39 files are of those two kinds.
- **What the plugin's `no-reflect-get` fires on.** Its source was not read here. 0563 counted 155
  hits for it by syntax, the same as this plan's `get` count.
- **Whether an alias of `Reflect` will ever be written.** Lint will not see it.
- **`Reflect.apply`, `Reflect.construct` and `Reflect.deleteProperty`.** 104 uses stay. 0554 does
  not decide them, and after this quest many `Reflect.apply` calls lose the `Reflect.get` beside
  them and need their own answer.

## Amendments

### 2026-11-15, before slices 9 to 14 start (lead)

Read on `origin/main` at `9ca24b1`. The merge session made two rulings: choice (A) for slice 9, and
the `ping` call. This amendment writes them down, recounts the waiting slices and records the new
order. Nothing else in the signed plan changes.

#### 1. Slice 9: where the dev client's method types live

**The answer first.** The Process object's calls move type-only to
`next/packages/libfabrika/src/runtime/ObjectCalls.ts`, a new file in the `next-runtime` row of
`layer-rules.json`. Both `next-node` and `next-workers` list `next-runtime` in their `imports`, and
`next-runtime` may import `next-processes`, which is all the moved types need. No
`layer-rules.json` edit.

The Project object's calls cannot move the same way, and this is a finding against the ruling's
premise, not a choice:

- Its methods name `transport/` (`checkHello` for `initialize`, `Answer` for `route` and `knock`),
  `ledger/` (`LedgerCalls`, `Appended`), `settings/` and `runtime/` at once.
- The layers both `node/` and `cloudflare/` may import are `next-runtime`, `next-runtime-coordination`
  and the layers below them. `next-runtime` may not import `next-transport` or `next-ledger`.
  `next-runtime-coordination` may not import `next-runtime` or `next-transport`. `next-transport`
  imports only `next-shared`. No `runtime/` file on main imports `transport/`.
- The `grant`, `sign` and `commit` answers are typed by schemas that are values in
  `cloudflare/bindings.ts` (`GrantReply`, `SigningReply`, `CommitReply`), so even a move that is not
  type-only would have to carry them.
- The layer check reads `import type` too: the planted `import type` in
  `next/apps/fabrika/src/exam/layers.integration.test.ts:289` is refused as `outside-imports`.

So the lean for the Project half (75%) is the tests step's choice (C): `dev.ts` names the Project
calls its control door allows, from modules `next-node` may import, and the type law L7 holds each
one equal to `ProjectBinding`'s. L7's file is a test, and a test keeps only the upward and sideways
rules (`testFiles` in `layer-rules.json`), so it may import `cloudflare/bindings.ts`, as
`next/packages/libfabrika/src/node/IsolateUsage.integration.test.ts:12` does today. The doubt: the
merge session may prefer (B), one `layer-rules.json` line that lets `next-node` import
`next-workers`, over a copy held by a law. Its signature on this plan is the yes to (C); a send-back
picks (B), and then `dev.ts` imports `ProjectBinding` and `ProcessBinding` and the new file is not
made.

**A name, decided here.** The tests step called the moved types `ProjectCalls` and `ProcessCalls`.
`ProcessCalls` is taken: `next/packages/libfabrika/src/processes/ProcessManager.ts:601` exports it
as the process manager's calls, and `cloudflare/bindings.ts:16` imports it under that meaning. A
short word keeps one meaning, so the Process object's calls are `ProcessObjectCalls`. The dev
client's two types are `DevProject` and `DevProcess`; `ProjectCalls` is not used, since two app tests
already name a local `ProjectCalls` for the Effect service
(`next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts:49`).

The moved types, a sketch, not compiled:

```ts
// next/packages/libfabrika/src/runtime/ObjectCalls.ts (new, row next-runtime)
/**
 * The calls a Durable Object answers over RPC, as Promises, named once for both platforms.
 *
 * @stability unstable
 */
import type { Effect } from "effect";
import type { Activity } from "../processes/Process.ts";
import type * as IsolateUsage from "./IsolateUsage.ts";
import type { Descriptor, ProgramRunner } from "./Runner.ts";

/** One Effect call as the Promise call RPC answers. */
export type RemoteCall<F> = F extends (...args: infer A) => infer B ? (...args: A) => Promise<Effect.Success<B>> : never;

/** Every call of `S` over RPC. */
export type Remote<S> = { [K in keyof S]: RemoteCall<S[K]> };

type Runner = (typeof ProgramRunner)["Service"];

/** A Process object's calls: the runner's msg, open, due, restart and swap, plus configuration, usage, alarm and abort. */
export type ProcessObjectCalls = Remote<Pick<Runner, "msg" | "open" | "due" | "restart" | "swap">> & {
  mailed: RemoteCall<(trace?: { traceId: string; spanId: string }) => Runner["mailed"]>;
  configure: RemoteCall<(descriptor: Descriptor, drain?: boolean) => Effect.Effect<void>>;
  usage: RemoteCall<typeof IsolateUsage.record>;
  descriptor: RemoteCall<(process?: string) => Effect.Effect<Descriptor>>;
  activity: RemoteCall<(value: typeof Activity.Type) => Effect.Effect<void>>;
  recover: RemoteCall<() => Effect.Effect<unknown>>;
  savedAlarm: RemoteCall<() => Effect.Effect<number | null>>;
  abort: RemoteCall<() => Effect.Effect<void>>;
};
```

```ts
// next/packages/libfabrika/src/cloudflare/bindings.ts, the file the types leave
import type { ProcessObjectCalls, Remote, RemoteCall } from "../runtime/ObjectCalls.ts";
// `RemoteCall` and `Remote` are deleted here; `ProjectBinding`, `ConnectionBinding` and
// `RecordBinding` keep using them through this import.
export type ProcessBinding = Rpc.DurableObjectBranded & ProcessObjectCalls;
```

The new client type, a sketch:

```ts
// next/packages/libfabrika/src/node/dev/dev.ts
import type { ProcessObjectCalls, RemoteCall } from "../../runtime/ObjectCalls.ts";
// and, for the Project half, types from ledger/, processes/, presence/, runtime/ and transport/

/** The dev client's Process: the calls its control door allows, and `alarm` for `savedAlarm`. */
export type DevProcess = Pick<
  ProcessObjectCalls,
  "msg" | "open" | "due" | "restart" | "abort" | "activity" | "recover" | "savedAlarm"
> & { readonly alarm: ProcessObjectCalls["savedAlarm"] };

/** The dev client's Project: the calls its control door allows, and `connect` for `clientConnect`. */
export type DevProject = Pick<LedgerCalls, "read" | "append" | "wait"> & {
  readonly connect: () => Promise<string>;
  readonly start: RemoteCall<(request: Start, from: From) => ReturnType<ProcessCalls["start"]>>;
  readonly info: RemoteCall<() => ProcessCalls["info"]>;
  // one line per name of the door's `methods.project` set, typed as `ProjectBinding` types it;
  // `grant`, `sign` and `commit` answer `Promise<unknown>`, since their reply schemas are values in
  // cloudflare/ and the dev door's answer has crossed JSON undecoded
  readonly gateways: Pick<DevProject, "join" | "leave" | "online">;
  readonly forProcess: (pid: string) => {
    readonly append: (input: {
      readonly id: string;
      readonly parent: string;
      readonly kind: string;
      readonly stream: string;
      readonly event: unknown;
    }) => Promise<unknown>;
  };
};

// the client the driver answers: `Binding`, the bare record at dev.ts:52, goes
project: (project: string): DevProject => ...,
process: (pid: string): DevProcess => ...,
```

`DevProject` lists exactly the door's names, so a name the door refuses is a type error at the call.
Slice 10's typed table replaces the door's `methods` sets; L7 then compares `DevProject`'s keys with
that table's keys, and until slice 10 with the set in `cloudflare/control.ts:31`, read as a type in
the test.

One call, before and after:

```ts
// next/apps/fabrika/src/worker-mail.integration.test.ts:355, before
const started = await Reflect.get(instance.project(PROJECT), "start")(request, from);
// after
const started = await instance.project(PROJECT).start(request, from);

// next/apps/fabrika/src/scheduled-job-alarm.integration.test.ts:184, before
const alarm = yield* Effect.promise(() => Reflect.get(instance.process(pid), "savedAlarm")());
// after
const alarm = yield* Effect.promise(() => instance.process(pid).savedAlarm());
```

L7 grows by one plant: drop `restart` from `DevProcess`'s `Pick`, and the law that names it goes red
in a typecheck. Its existing plant (type the client as a bare record again) stays.

#### 2. The `ping` call

`next/packages/libfabrika/src/node/dev/dev-control.laws.integration.test.ts:470` calls
`dev.process(name).ping()`. No real caller of a `ping` method on a Process exists:
`nice -n 19 rg -n '\bping\b' next` finds only the wire's text ping (`instance-wire.integration.test.ts:406`
sends the string `"ping"`) and the door's `ping` timing option in the app's tests. `ProcessBinding`
has no `ping`, and the control door's `methods.process` set (`cloudflare/control.ts:52`) refuses it.
The law fakes `fetch`, so the name only has to reach the wire. So `ping` is a fake member, typed
only in the test, by kind 10:

```ts
// before
const answered = (Reflect.get(dev.process(name), "ping")() as Promise<unknown>).then(/* ... */);
// after, a sketch
// @ts-expect-error ping is no method of a Process; this law fakes fetch, so any name reaches the wire
const ping: () => Promise<unknown> = dev.process(name).ping;
const answered = ping().then(/* ... */);
```

`DevProcess` does not grow a `ping`, and no index signature is added for it.

#### 3. The recount

Taken with the rule itself: oxlint 1.90.0, a throwaway config with the four entries of "The hold",
over each slice's folder, on `9ca24b1`. Only `eslint(no-restricted-properties)` fires are counted.
Slices 11 and 12 are a check only: their tests steps are done on `fabrikalfa/reflect-s11`
(`6e27f66`) and `fabrikalfa/reflect-s12` (`fed14b15`) and are not run again.

| Slice | Folder | Was | Now | Per file now |
|---|---|---|---|---|
| 9 | `libfabrika/src/node` | 6 in 4 | 6 in 4 | `dev-control.laws.integration.test.ts` 3, `dev-secrets.laws.integration.test.ts` 1, `watch.laws.integration.test.ts` 1, `launchd/Launchd.test-support.ts` 1 |
| 10 | `libfabrika/src/cloudflare` | 28 in 5 | 28 in 5 | `platform.test.ts` 19, `readers.laws.test.ts` 5, `ObjectService.test.ts` 2, `error-cause.test.ts` 1, `control.ts` 1 |
| 11 | `libfabrika/src/runtime` | 18 in 3 | 18 in 3 | `Program.test.ts` 10, `Patch.test.ts` 5, `Client.laws.test.ts` 3 |
| 12 | `libfabrika/src/client` | 50 in 3 | 50 in 3 | `WindowMachine.laws.test.ts` 33, `WindowStart.laws.test.ts` 9, `Tezgah.laws.test.ts` 8 |
| 13 | `apps/fabrika/e2e` | 15 in 5 | 15 in 5 | `client-protocol.test-support.ts` 5, `first-window.visual.test.ts` 3, `page-runtime.laws.visual.test.ts` 3, `p14.test-support.ts` 2, `tezgah-focus.visual.test.ts` 2 |
| 14 | `apps/fabrika/src` | 33 in 10 | 37 in 12 | `runtime-recovery.laws.integration.test.ts` 9, `scheduled-job-alarm.integration.test.ts` 6, `runtime.decode.test.ts` 5, `checklist-instance.laws.integration.test.ts` 3, `worker-mail.integration.test.ts` 3, `door.integration.test.ts` 2, `hands-launcher.integration.test.ts` 2, `worker-monitor.integration.test.ts` 2, `worker-supervision.integration.test.ts` 2, `input-recording.integration.test.ts` 1, `instance-records.integration.test.ts` 1, `tasks-wire.integration.test.ts` 1 |

- Slices 9 to 14 hold 154 fires in 32 files: 147 `get`, 4 `set`, 3 `has`. Over the whole scope, main
  has 169 at `9ca24b1`; the other 15 are slices 2 to 7's, on their own branches.
- Slice 14 grew by two files that merged after the first count:
  `hands-launcher.integration.test.ts` and `worker-monitor.integration.test.ts`, two fires each.
  Both are rows in slice 14's table now. Three of the four are kind 6, so they wait for slice 9's
  types too.
- Kind 6 is now 17 fires in 8 files. The `ping` call leaves it (point 2).
- `cloudflare/bindings.ts` has 0 fires; slice 9 edits it only to take the moved types.
- The text matches lint cannot see are unchanged: `twin.integration.test.ts:93-95` and the generated
  text in `instance-records.integration.test.ts:288` stay with slice 14, at the same lines.

#### 4. The order

- **One sweep pull request for slices 9, 11 and 12,** on `fabrikalfa/reflect-rest` (the owner's
  ruling: one pull request per sweep, never one per slice). Each slice keeps its own steps and its
  own branch; the integrator folds the reviewed branches in. Pull requests 1331 and 1341, which slice
  9 waited on, have merged. Slice 9's tests step runs after this amendment is signed. Slices 11 and
  12 have their tests done and go on to build and review.
- **Slices 10 and 14 wait for slice 8's `Stub.make` on main.** Pull request 1433 (slice 8) was
  closed unmerged, and `next/packages/vitest/src/Stub.ts` is not on main. Slice 14 also needs slice
  9's types for its kind 6 calls.
- **Slice 13 waits for https://github.com/kamp-us/tea-fabrika/pull/1099 and
  https://github.com/kamp-us/tea-fabrika/pull/1312,** both still open.
- **Slice 15 folds the blocks and comes last,** after every other slice.

#### 5. Fixed by slice 9's tests step, 2026-11-16 (the merge session's ruling)

- The sketch's `gateways: Pick<DevProject, "join" | "leave" | "online">` refers to the type it sits in; `gateways` gets its own named type for the three calls, which `DevProject` also includes, and L7 reads it as `DevProject["gateways"]`.

#### 6. Five app tests that slice 9's typed client turns red, 2026-11-16 (lead)

**The answer first.** Slice 9's tests step takes five more test files. Each one called the dev
client as the old bare record of functions. With `DevProject` and `DevProcess` typed (point 1),
`pnpm typecheck` is red with 13 errors in them, and the build may not touch a test. Each fix makes
the call a plain typed call, kind 6 of "What replaces each kind of call". No `Reflect.get`,
`Reflect.set` or `Reflect.has` fire is removed or added, so the counts of slices 13 and 14 stay as
point 3 gives them. This reassigns files inside the signed plan and makes no new design call.

Read on `fabrikalfa/reflect-rest` at `3897bced3`, slice 9's build (row
`field/runs/2026-11-15-reflect-ban-s9-build1.json`). `tsc --noEmit -p next/apps/fabrika` at that
head gives exactly these 13 errors, and no other:

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/apps/fabrika/e2e/chaos-revoke.integration.test.ts | tests | tests | slice 9: 5 errors (TS2345) at :343, :354, :423, :438, :509; `invoke` takes a thunk; the `route` call's `"p90-control"` gets a kind 10 `@ts-expect-error`; 0 fires before and after |
| next/apps/fabrika/e2e/client-protocol.test-support.ts | tests | tests | slice 9: 2 errors (TS2345) at :365, :373; `invoke` takes a thunk; its 5 fires (:125, :213, :250) stay for slice 13 |
| next/apps/fabrika/src/worker-usage.integration.test.ts | tests | tests | slice 9: 4 errors (TS2345) at :278, :292, :381, :386; the four calls go through the file's own `call`; `invoke` stays for `instance.record(...)`; 0 fires |
| next/apps/fabrika/src/start-child.laws.integration.test.ts | tests | tests | slice 9: 1 error (TS7053) at :207; the string-keyed `call` helper goes, its three callers call `project()` plainly; 0 fires |
| next/apps/fabrika/src/worker-mail.integration.test.ts | tests | tests | slice 9: 1 error (TS2345) at :951; the local `start` takes `Start`, not `object`; its 3 fires (:355, :748, :951) stay for slice 14 |

**The cause, one for four files.** Each file keeps a local copy of the old client type,
`Readonly<Record<string, (...args: ReadonlyArray<unknown>) => Promise<unknown>>>`, and looks a
method up by a string. `DevProject` has no index signature (point 2 rules one out), so it is not
assignable to that record, and `target[method]` with `method: string` has no type.

**Why a thunk, and not a lookup typed by a union of method names (85%).** A helper typed as
`<M extends "start" | "read">(project: DevProject, method: M, args: Parameters<DevProject[M]>)`
cannot call `project[method](...args)`: TypeScript widens `DevProject[M]` to a union of functions
and refuses the spread (the correlated-union limit, microsoft/TypeScript#30581, not fetched for this
plan). Getting past it takes a cast, which `fabrika/no-type-assertions` refuses, or `Reflect.apply`,
which answers `any`. A thunk is a plain typed call with no lookup at all, the shape point 1 gives
every kind 6 call. What the old helpers also did, refuse a missing method at run time, a typed call
does at compile time, so nothing a law checked is lost.

The fixes, a sketch, not compiled:

```ts
// next/apps/fabrika/e2e/chaos-revoke.integration.test.ts:246, before
type Binding = Readonly<Record<string, (...args: ReadonlyArray<unknown>) => Promise<unknown>>>;
const invoke = Effect.fn("RevokeTest.control")(function* (binding: Binding, method: string, args: ReadonlyArray<unknown>) {
  const target = binding[method];
  if (target === undefined) {
    return yield* new WireFailure({ cause: new Error(`the binding has no ${method} call`) });
  }
  return yield* Effect.tryPromise({ try: () => Reflect.apply(target, binding, args), catch: (cause) => new WireFailure({ cause }) });
});

// after: `Binding` goes, and the helper runs one typed call
const invoke = Effect.fn("RevokeTest.control")(function* <A>(call: () => Promise<A>) {
  return yield* Effect.tryPromise({ try: call, catch: (cause) => new WireFailure({ cause }) });
});

// :343 and :354
const started = yield* invoke(() => instance.project(PROJECT).start(Start.cases.first.make({ /* as today */ }), from));
const read = (stream: string) => invoke(() => instance.project(PROJECT).read(stream, 0, "p17b-audit"));

// :423 and :509: the proof is made before the thunk, since a `yield*` cannot sit inside an arrow
const armored = yield* root.proof(grant);
expect(yield* RevokeTest.invoke(() => project.grant({ text: grant, armored }))).toMatchObject({ _tag: "applied" });

// :438: the one value the type refuses on purpose, kind 10 (the plan's call on @ts-expect-error)
const hold = (method: string, params: unknown = {}) =>
  RevokeTest.invoke(() =>
    // @ts-expect-error p90-control is no ConnectionId: only the test's control binding takes it (chaos-revoke.worker.test-support.ts:90)
    project.route("p90-control", method, params, "p90-control"),
  );
```

```ts
// next/apps/fabrika/e2e/client-protocol.test-support.ts:318, after: `Binding` goes; the label keeps the failure's words
const invoke = Effect.fnUntraced(function* <A>(method: string, call: () => Promise<A>) {
  // oxlint-disable-next-line fabrika/no-promises -- edge: the local instance's Durable Object RPC answers a Promise
  return yield* Effect.tryPromise({
    try: call,
    catch: () => new SuiteError({ waited: `the control endpoint's ${method}` }),
  });
});

// :365 and :373
yield* invoke("exit", () => s.control.exit(first, ExitReason.cases.crashed.make({ phase: "step" }), s.from()));
const started = yield* invoke("start", () => s.control.start(Start.cases.again.make({ /* as today */ }), s.from()));
// `field`, :125 and :213 are not touched: their 5 fires are slice 13's
```

```ts
// next/apps/fabrika/src/worker-usage.integration.test.ts, after: the file's own `call` (:250) runs each typed call
const start = (world: World["Service"], name: string, program: string) =>
  call(() =>
    world.instance.project(PROJECT).start(
      { _tag: "first", id: `start-${name}`, name, code: { program, hash: world.built.programs[program]?.hash ?? "missing" } },
      world.from,
    ),
  ).pipe(Effect.map((reply) => Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(reply).process));

yield* call(() => world.instance.process(process).open("usage-probe")); // :292
yield* call(() => instance.process(checklist).restart({ id: "replay", build: /* as today */ })); // :381
call(() => instance.project(PROJECT).read("processes/checklist:2", 0, "usage-probe")); // :386
// `invoke` stays, typed as today, for `instance.record(...)` only: dev.ts:788 still answers the bare
// record there, and this plan does not type the record client. If `world.from` is refused as a
// `From`, `FROM` (:20) gets the annotation `From`, as start-child.test-support.ts:159 has it.
```

```ts
// next/apps/fabrika/src/start-child.laws.integration.test.ts:203, after: `call` goes
const helpers = ({ instance, hashes, from }: Fixture) => {
  const project = () => (instance as Instance).project(PROJECT);
  return {
    start: async (name: string, program: "starter" | "child") => {
      const started = await project().start(
        { _tag: "first", id: `start-${name}`, name, code: { program: `p42/${program}`, hash: hashes[program] } },
        from,
      );
      return Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(started).process;
    },
    facts: async (stream: string) =>
      ((await project().read(stream, 0, "audit")) as Array<any>).map((row) => ({ ...row.body, _tag: row._tag })),
    live: async (name: string): Promise<string | undefined> =>
      ((await project().info()) as Array<any>).find((row) => row.name === name)?.process,
  };
};
// The `as Instance` and `as Array<any>` lines are as they are on main; this point does not touch them.
```

```ts
// next/apps/fabrika/src/worker-mail.integration.test.ts:949, after: only the parameter's type changes
import type { Start } from "@kampus/libfabrika/processes/Process";
const start = async (request: Start) =>
  Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(
    await Reflect.get(project, "start")(request, from),
  ).process;
```

**What slice 9 edits in the two files slices 13 and 14 also own.** Only the type errors.

- `client-protocol.test-support.ts`: `Binding`, `invoke` and its two callers, lines 318 to 333,
  365 and 373. The 5 fires at :125 (2), :213 (2) and :250 (1) stay for slice 13. They are
  `Reflect.get`, not `Reflect.apply`, and the fix does not reach them.
- `worker-mail.integration.test.ts`: one import line and the parameter type at :949. The fire at
  :951 stays, with the two at :355 and :748, for slice 14. The plainer fix,
  `await project.start(request, from)`, would also remove the fire at :951. It is left to slice 14
  on purpose, so that its three fires go as one kind 6 change and slice 14's count does not move.
- Recount: slice 13 stays 15 fires in 5 files, slice 14 stays 37 in 12, and slices 9 to 14 stay 154
  in 32. The other three files have no fire, and none is in a slice's table until now.
  `start-child.laws.integration.test.ts` and `worker-usage.integration.test.ts` are in slice 14's
  folder and `chaos-revoke.integration.test.ts` in slice 13's, and each is already at zero.
- Slices 13 and 14 start from these files as slice 9 leaves them. Their line numbers move by a few
  lines, and point 3's rule holds: the lead takes the counts again before their tests steps.

**Clashes with the open pull requests.** None. Read with the GitHub tool, all files of each:
https://github.com/kamp-us/tea-fabrika/pull/1099 (16 files) and
https://github.com/kamp-us/tea-fabrika/pull/1312 (50 files) edit none of the five files and not
`next/packages/libfabrika/src/node/dev/dev.ts`. Pull request 1312 edits `next/apps/fabrika/dev.ts`,
a different file, and adds no `instance.project(` or `instance.process(` call. It adds one
`Reflect.get` in `next/packages/libfabrika/src/client/WindowMachine.laws.test.ts`, which is slice
12's and point 4's wait already names.

**The steps.** Slice 9's tests step runs once more for these five rows. Then the build's
typecheck is run again with no build change, then the review. The new laws are none: L7 already
holds the client's type, and these files only follow it. All five are `.integration.` or
`.test-support.` files; `tsc` proves the fix, and the tests step lists which laws ran in the box
under the 0178 guard.

#### 7. Slices 10 and 14 recounted after main came in, 2026-11-16 (lead)

**The answer first.** Slice 10 is unchanged: 28 fires in 5 files. Slice 14 grows from 37 fires in
12 files to 43 in 14: pull request 1366 added `runtime-quotas.laws.test.ts` (5) and
`worker-quotas.integration.test.ts` (1). Those 6 are the only fires that came with 1366, and they
are now slice 14's like any other. `Stub.make` on main is stricter than this plan's sketch in one
way: `rest` must answer a value of one of the stubbed type's members. No row asks for what the real
shape cannot do, so this point records counts, the tests' shape and the order, and makes no new
design call.

Read on `fabrikalfa/reflect-rest` at `a6a37add0`, which merged `origin/main` with
https://github.com/kamp-us/tea-fabrika/pull/1366 and https://github.com/kamp-us/tea-fabrika/pull/1481.
Counted as point 3 did: oxlint 1.90.0, a throwaway config outside the repo with only the four
entries of "The hold", only `eslint(no-restricted-properties)` fires counted.

| Slice | Folder | Point 3 | Now | Per file now |
|---|---|---|---|---|
| 10 | `libfabrika/src/cloudflare` | 28 in 5 | 28 in 5 | `platform.test.ts` 19, `readers.laws.test.ts` 5, `ObjectService.test.ts` 2, `error-cause.test.ts` 1, `control.ts` 1 |
| 14 | `apps/fabrika/src` | 37 in 12 | 43 in 14 | `runtime-recovery.laws.integration.test.ts` 9, `scheduled-job-alarm.integration.test.ts` 6, `runtime.decode.test.ts` 5, `runtime-quotas.laws.test.ts` 5, `checklist-instance.laws.integration.test.ts` 3, `worker-mail.integration.test.ts` 3, `door.integration.test.ts` 2, `hands-launcher.integration.test.ts` 2, `worker-monitor.integration.test.ts` 2, `worker-supervision.integration.test.ts` 2, `input-recording.integration.test.ts` 1, `instance-records.integration.test.ts` 1, `tasks-wire.integration.test.ts` 1, `worker-quotas.integration.test.ts` 1 |

- Slice 10 is 27 `get` and 1 `has` (`platform.test.ts:30`). Slice 14 is 41 `get`, 1 `has`
  (`runtime.decode.test.ts:165`) and 1 `set` (`runtime-quotas.laws.test.ts:660`). Each row in
  "Files" now gives its fires' lines.
- Slice 13 was counted too, as a check: still 15 in 5. The `runtime` and `node` folders have 0
  fires on this branch, so 1366's edits there added none.
- No row is dropped: no file lost its fires or moved. The text matches lint cannot see are where
  point 3 put them: `exam/twin.integration.test.ts:93` and `:95`, and the generated text at
  `instance-records.integration.test.ts:288`.

**The fires that waited on 1366.** The signed order made slices 9, 10 and 11 wait for the quotas
slice, branch `fabrikalfa/p34c-s4`, which landed as pull request 1366. No row named a single fire as
waiting on it. In slice 10's folder it edited `ObjectService.test.ts` (its 2 fires, at :208 and
:370, are as point 3 counted them) and `alarm.laws.test.ts` (no fire, its 4 guards still there). It
added these 6 fires to slice 14, each part of the slice now:

- `next/apps/fabrika/src/runtime-quotas.laws.test.ts:320` and `:371`: kind 5, a method picked by a
  name inside the file's Project and Process stand-ins, as `runtime-recovery.laws.integration.test.ts`
  has them. The two `new Proxy` stand-ins (:305, :353) become `Stub.make`.
- `next/apps/fabrika/src/runtime-quotas.laws.test.ts:488` and `:491`: kind 1, the `name` and `id` of a
  saved descriptor, decoded once by one schema of two optional fields.
- `next/apps/fabrika/src/runtime-quotas.laws.test.ts:660`: `Reflect.set(env, "INSTANCE", ...)`, which
  writes past `Env`'s `readonly INSTANCE`. The lean (85%), "Assign through the type" as the entry's
  message says: the start's input is a local `let`, and `env` reads it through a getter. The object
  `processRuntime` holds stays the same one, as today.

```ts
// next/apps/fabrika/src/runtime-quotas.laws.test.ts, a sketch, not compiled
let start = instance(limits);
const env = {
  get INSTANCE() {
    return start;
  },
  // PROJECT, PROCESS and the rest as today
} as unknown as Env; // the cast on main, unchanged
// :660, before
Reflect.set(env, "INSTANCE", instance({ ...limits, storage: 1_000_000_000 }, "quota-laws-widened"));
// after
start = instance({ ...limits, storage: 1_000_000_000 }, "quota-laws-widened");
```

- `next/apps/fabrika/src/worker-quotas.integration.test.ts:189`: kind 6. Its `rpc` helper takes a
  binding and a method name. It takes a thunk instead, as point 6's `invoke` does, and its six callers
  (:263, :272, :385, :399, :404, :416) call `DevProject` and `DevProcess` plainly: `start`, `read`,
  `info`, `abort` and `restart` are all names those types have.

**`Stub.make` as built, against the sketch.** On main, `next/packages/vitest/src/Stub.ts`:

```ts
// the sketch in "The shared stub"
export const make: <A extends object>(rest: (method: string) => (...args: ReadonlyArray<unknown>) => unknown, own?: Partial<A>) => A;
// as built (pull request 1481)
export const make = <A extends object>(rest: (method: string) => A[keyof A], own: Partial<A> = {}): A => ...
```

The shape slice 10's and slice 14's tests must use:

- **`rest` answers a member of `A`.** `async () => { throw fault; }` is `() => Promise<never>` and fits
  any member that answers a Promise; a guard that throws, such as `unexpected`, answers `never` and
  fits every member. So the rejecting stubs and the guards move as they are.
- **No generic wrapper.** Inside `const rejecting = <A extends object>(...) => Stub.make<A>(...)`,
  TypeScript cannot show that `() => Promise<never>` is an `A[keyof A]`. Each use names its type,
  `Stub.make<ProjectBinding>(...)` as the plan's sketch already writes it, or a helper is written for
  one concrete type.
- **An answer the type refuses on purpose is kind 10.** `answeringProcess(envelope)` and
  `answering(...)` in `platform.test.ts` answer the bridge's error envelope, which no member's type
  names: the law feeds it in on purpose. That `rest` line carries one `@ts-expect-error` with its
  reason, the plan's call on kind 10, never a cast. The same holds for any other stub whose canned
  answer no member type takes (`p14.test.ts:45`'s `{ _tag: "ok" }`, the `RecordCalls` stub in
  `telemetry/Records.integration.test.ts:499`), unless the tests step types the answer as a member's.
- **A stub stands for calls only.** Its `Proxy` wraps an empty null-prototype object, so `Object.keys`,
  `in` and a spread see nothing. No row spreads or lists a stub: the `Object.keys` calls in
  `platform.test.ts` (:79, :135) list a client made over a stub, not the stub.

Every "becomes `Stub.make`" note names a stub that is on this branch, with its line now in its row.
`platform.test.ts:138`'s `answering`, a third stub of the same shape in that file, is named in its
row too.

**Slice 10's neighbor.** The mock sweep's cloudflare slice 2, branch `fabrikalfa/mock-cloudflare-s2`,
edits the same cloudflare test files and was to go first. It is not on origin: `git ls-remote` finds
only `fabrikalfa/mock-cloudflare`. Slice 10 starts without it. Whichever of the two lands later
carries the other's lines in its merge, and its tests step counts the folder again.

**The order now.**

- Slices 10 and 14 start. `Stub.make` is on main (1481), slice 9's types are on this branch, and
  1366 has merged. Slice 14's kind 6 calls use slice 9's `DevProject` and `DevProcess`.
- Slice 13 still waits for https://github.com/kamp-us/tea-fabrika/pull/1099 and
  https://github.com/kamp-us/tea-fabrika/pull/1312, both still open on 2026-11-16 (read with the
  GitHub tool).
- Slice 15 folds the blocks and comes last.

**Size.** Slice 14 grows by about 40 test lines, to about 210, for the two new files. The estimate
stays 38 steps and $163: the growth sits inside slice 14's one tests step, priced at $14.

#### What this amendment cannot tell us

- Whether `ObjectCalls.ts` and `DevProject` compile as sketched. Nothing was compiled; slice 9's
  typecheck tells.
- Whether the merge session takes (C) for the Project half. Its signature or its send-back tells.
- Whether point 6's sketches compile as written, `world.from` as a `From` above all. The tests
  step's `tsc --noEmit -p next/apps/fabrika` tells; a refusal there is a test edit in the same files.
- The counts move again if a branch lands in these folders before a slice's tests step. Pull
  requests 1099, 1232 and 1312 edit files of slices 11, 12 and 13.
- Whether `Stub.make`'s real signature fits every stub point 7 names without more `@ts-expect-error`
  lines than it lists. Nothing was compiled; slice 10's and slice 14's typecheck tells.
- Whether the mock sweep's cloudflare slice 2 clashes with slice 10 by more than lines. Its branch
  is not on origin, so it was not read.

#### 8. Slice 13 starts, and slice 15's fold keeps main's new entry, 2026-11-18 (lead)

**The answer first.** Slice 13 starts now and no longer waits for pull request 1312. Its count is
unchanged: 15 fires in 5 files. Slice 15 runs after it, in the same pull request. One fact is new
since point 7: main now puts a `Data.TaggedError` entry first in every block that sets
`eslint/no-restricted-properties` (0573), so the fold keeps that entry in each block it writes.
This point records the order, the counts and that entry. It makes no new design call.

Read on `fabrikalfa/reflect-rest` at `70dddec3e`, which merged `origin/main` at `a6761bce1`.

- **Pull request 1099 merged on 2026-11-17,** and it is in that merge.
- **Pull request 1312 is a draft that waits for the owner's look,** stacked on
  https://github.com/kamp-us/tea-fabrika/pull/1232, with no date. Of slice 13's files it edits only
  `next/apps/fabrika/e2e/tezgah-focus.visual.test.ts` (24 lines), where slice 13 has 2 kind 7
  fires. Waiting on it held the whole sweep for two days for 2 fires. So slice 13 takes the rule
  slice 10 took for its neighbor: whichever lands later carries the other's lines in its merge.
  Once this lands, the ban holds in `e2e/`, so a `Reflect.get` in 1312's merge is red in 1312's
  own pull request, as the ban means it to be. 1312 already owes a one-line edit in
  `WindowMachine.laws.test.ts` (this pull request's description).

**Slice 13's count at `70dddec3e`.** Counted by reading every hit, as point 7 did.

- `next/apps/fabrika/e2e/client-protocol.test-support.ts`: 5 fires of kind 1, at :128 (2), :228 (2) and :269.
- `next/apps/fabrika/e2e/first-window.visual.test.ts`: 3 fires, kind 7 at :136 and :241, kind 2 at :333.
- `next/apps/fabrika/e2e/p14.test-support.ts`: 2 fires of kind 1, at :768 and :772.
- `next/apps/fabrika/e2e/page-runtime.laws.visual.test.ts`: 3 fires of kind 7, at :222, :224 and :307.
- `next/apps/fabrika/e2e/tezgah-focus.visual.test.ts`: 2 fires of kind 7, at :59 and :70.

- 11 `get` and 4 `set`, and no `has`. Kind 7 follows
  `next/apps/fabrika/e2e/one-file.visual.test.ts`, which already declares its `globalThis` values.
- `e2e/*` joins the warn-level Reflect block in `.oxlintrc.json`, as `src/*` did in slice 14.
  `e2e/node/**` is already in the blocking block.
- No other folder of `next/` or our tooling has a fire. The text matches left are the six allowed
  disable lines, the plants and their tests, the README, `next/AGENTS.md`'s row, and the kind 11
  text in `exam/twin.integration.test.ts`.

**Slice 15's fold at `70dddec3e`.** The base blocks it folds into, as `.oxlintrc.json` has them:

```jsonc
// A sketch of the fold, not run. Each block keeps its entries in this order, then adds the four.
{ "files": ["next/**/*"],
  "rules": { "eslint/no-restricted-properties": ["error", /* Data.TaggedError, JSON.parse, the four */] } },
{ "files": ["next/packages/libfabrika/src/client/**"],
  "rules": { "eslint/no-restricted-properties": ["error", /* Data.TaggedError, JSON.parse, Effect.retry, Stream.retry, the four */] } },
{ "files": [/* the JSON.parse warn block's folders, unchanged */],
  "rules": { "eslint/no-restricted-properties": ["warn", /* Data.TaggedError, JSON.parse, the four */] } }
```

- The three `next/` Reflect list blocks go: the blocking one, the warn one and the `client/` one.
- The block for the three tooling folders stays as it is. No base
  block covers only our tooling: the top-level rule reaches today's code too, which 0554 does not
  cover. It is the ban's scope, not a list of folders at zero.
- L10's plant goes in a folder of `next/` that no block names. L4 still holds, so each block keeps
  `JSON.parse` at its level and `client/` keeps both retry entries. L1 and L2 still hold for
  `Data.TaggedError`.

**The split this pull request lands under.** Under 0589's amendments, a mechanical part gets no
review agent. The main merge's tool-output hunks are mechanical. Its hand-resolved hunks (the merge
commit's body names them), slice 13 and slice 15 are judgment, and get the one review.

**Size.** Slices 13 and 15 are priced at $8 and $5 already, so the budget stays as signed.

#### What point 8 cannot tell us

- Whether the owner's look at 1312 changes `tezgah-focus.visual.test.ts` more than lines. Its
  later merge tells.
- Whether the visual files' laws pass in a cloud box with no `ssh-keygen`. CI's visual job tells.

#### 9. Slice 15 leaves this pull request and lands from main on its own, 2026-11-18 (lead, on the owner's answer)

**The answer first.** Slice 15, the fold, comes out of pull request
https://github.com/kamp-us/tea-fabrika/pull/1494 by a plain revert (`5c9f7a977`). So that pull
request lands slices 9 to 14 and 13, with the four list blocks and L4 as they stand on main and
slice 13's `e2e/*` line added. The fold lands later, in its own pull request cut from main once 1494
has merged. Ticket 1056 stays open until then. The owner picked this through fabrikaa: it stops six
good slices waiting on the one that kept missing. Landing the fold with a known gap was ruled out.

**Why it came out.** After the fold, L4 missed the same fault three times. In each case one glob added
to the `JSON.parse` warn block stripped `client/`'s retry entries, or turned `JSON.parse` into advice
where it blocks, and every law stayed green. The rows are
`field/runs/2026-11-18-reflect-ban-s13-s15-review1.json`, `-review2.json` and `-review3.json`.

**Why each miss happened.**

- **The common cause.** An override replaces a rule's options, and a file takes the last override
  whose globs match it.
- **Before the fold.** The Reflect list blocks came last in `.oxlintrc.json`, so they decided every
  listed folder's final options. They also recorded, apart from the warn block, which folders block.
  The old L4 checked one against the other.
- **What the fold changed.** It put the entries into the base blocks, which keep main's order:
  `next/**/*`, then `client/**`, then the warn block last. So the warn block now wins for any file
  its globs reach, `client/` included, and nothing else in the file records which folders block.
- **Miss 1, a glob for the whole library package.** L4 read each block's own entries, never the setting a
  file ends with.
- **Miss 2, a glob for the app's whole e2e folder.** L4 read the final setting, but it judged "this folder still
  has a `JSON.parse` fire" at a coarser folder than the glob reaches. The warn block names only the
  files directly in the e2e folder, yet its `node` subfolder was counted with them.
- **Miss 3, a glob for the library's test files only.** L4 planted one made-up file name per
  folder, but a glob matches a file's path and name. A glob for one kind of file never met the sample.
- **What the three share.** Each version of L4 modeled oxlint's matching itself, first by block, then
  by folder, then by one name per folder, instead of asking oxlint about the real files. Meanwhile
  the block order left `client/` and the `JSON.parse` level decided by whichever glob came last.

**What the fold's own pull request builds.** The fix goes at both causes:

```jsonc
// .oxlintrc.json after the fold, a sketch: client/** goes back after the warn block, so its
// entries win by order for every client/ file, whatever glob the warn block gains.
{ "files": ["next/**/*"], "rules": { "eslint/no-restricted-properties": ["error", /* Data.TaggedError, JSON.parse, the four */] } },
{ "files": [/* the JSON.parse warn block's folders */], "rules": { "eslint/no-restricted-properties": ["warn", /* Data.TaggedError, JSON.parse, the four */] } },
{ "files": ["next/packages/libfabrika/src/client/**"], "rules": { "eslint/no-restricted-properties": ["error", /* Data.TaggedError, JSON.parse, Effect.retry, Stream.retry, the four */] } }
```

- **The sample.** L4 plants its sample at every tracked `next/` code file's own path and name,
  inside a temp copy of the repo. It reads what each real file ends with, and groups the results by
  folder for the fire check, as review 3 proposed.
- **Its laws and plants.**
  - L10's expected block order follows the move.
  - Each of the three misses' globs stays a plant that must be red.
  - The paragraph above goes in that pull request's description and in a finding row.
- **Steps.** It runs its own steps: an amendment with the recount, tests, the `next/AGENTS.md` build
  row and one review.

**What this amendment cannot tell us.**

- Whether sampling every tracked file is fast enough for the lint suite. Today's L4 takes about 16 s
  for 66 folders; the fold pull request's tests step measures it.
- Whether a glob for a file kind no tracked file has could still pass. That is the stated limit of
  any sample of the real tree.

#### 10. Slice 15 starts from main, 2026-11-18 (lead)

**The answer first.** Slice 15 starts on `fabrikalfa/reflect-fold`, cut from main at `f79fc38db`,
where https://github.com/kamp-us/tea-fabrika/pull/1494 landed. This point records the count there
and what the steps build. Amendment 9 already set the shape, so this point makes no new design call.

**The count at `f79fc38db`.** No folder of `next/` or our tooling has a fire. The text matches left
are the six allowed disable lines, `next/AGENTS.md`'s row, and the kind 11 text in
`exam/twin.integration.test.ts`. The only folder no list block names is
`next/packages/libfabrika/src/mcp/`, and it has no call.

**What the steps build.**

```jsonc
// .oxlintrc.json after the fold, a sketch. Order: next/**/*, then the JSON.parse warn block, then
// client/**, so client/'s entries win by order for every client/ file whatever glob the warn block gains.
{ "files": ["next/**/*"], "rules": { "eslint/no-restricted-properties": ["error", /* Data.TaggedError, JSON.parse, the four */] } },
{ "files": [/* the JSON.parse warn block's folders, unchanged */], "rules": { "eslint/no-restricted-properties": ["warn", /* Data.TaggedError, JSON.parse, the four */] } },
{ "files": ["next/packages/libfabrika/src/client/**"], "rules": { "eslint/no-restricted-properties": ["error", /* Data.TaggedError, JSON.parse, Effect.retry, Stream.retry, the four */] } }
```

- **The config.** The four Reflect entries go after each base block's own entries. The three `next/`
  Reflect list blocks go. The tooling block stays. The `client/**` block moves after the warn block.
  Every other block that sets the rule keeps its place.
- **L4.** In a temp copy of the repo, L4 writes one sample at every tracked `next/` code file's own
  path, plus one in a new folder. The sample holds one fire each of `JSON.parse`, the four Reflect
  forms, `Effect.retry` and `Stream.retry`. L4 lints the copy with the real config and reads each
  file's final severity per fire. It holds:
  - every file ends with `JSON.parse` and the four at one level;
  - every file outside the warn block's reach, the new folder's and every `client/` file end at
    error, and `client/` files with both retry entries;
  - a file that ends at warn sits in a folder that holds a real `JSON.parse` fire, counted at the
    grain the warn glob is written for.
  The grain rules of `4dc340aab` on `fabrikalfa/reflect-rest` hold: a package's `src` root and an
  app's `src` and `e2e` roots count only their direct files, and each child folder is its own top.
- **Its plants.** Each must be red:
  - the three globs the reviews named, in `field/runs/2026-11-18-reflect-ban-s13-s15-review1.json`,
    `-review2.json` and `-review3.json`;
  - the fix rounds' plants, from `field/runs/2026-11-18-reflect-ban-s15-tests2.json` and `-tests3.json`;
  - `client/**` moved back before the warn block;
  - a retry entry dropped, and `client/` set to warn.
- **L10.** Its expected block order follows the move.
- **Where to look.** Slice 15's first round on `fabrikalfa/reflect-rest` (`cbb780add`, `76384f4ed`,
  `4dc340aab`, reverted in `5c9f7a977`) is a reference for the fold and L10, not a source to
  copy whole: L4 is rebuilt as above.
- **Files.** The tests step owns `.oxlintrc.json`, `oxlint-plugins/builtin-plants.ts`,
  `oxlint-plugins/plants.test.ts`, `oxlint-plugins/advice.test.ts` and `oxlint-plugins/README.md`,
  as slice 1's table gives them. The build step owns `next/AGENTS.md`'s row.

**What point 10 cannot tell us.**

- How long L4 takes with a sample at every tracked file; the tests step measures it.
- Whether a glob for a file kind no tracked file has could pass. That is the stated limit of any
  sample of the real tree.

## Open questions

None.

## Findings

```json
{"id":"2026-11-15-restricted-properties-advises-by-code","date":"2026-11-15","where":"oxlint-plugins/advice.ts","what":"pnpm lint grades advice by rule code, so any entry added to eslint/no-restricted-properties in one of the 14 folders of the JSON.parse warn override at .oxlintrc.json:2296 only advises. Today the two retry entries are safe only because client/ is not in that override.","proof":"oxlint-plugins/advice.ts: `advises` is `ADVICE.has(fire.code) && fire.severity === \"warning\"`; oxlint-plugins/README.md:879 records that no-cause-squash became a rule of our own for this reason.","note":"The reflect-ban plan fixes this in its slice 1; the row is here so the trap is on record if that slice is cut or reordered."}
```
