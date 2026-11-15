Approved by the lead agent, builds 0554, 0562, 0524, 0523, 0168; body 85b32e4d5f35
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
- **Where the dev client's method types come from (70%).** Slice 9 gives the local dev client real
  types. Its file is in `node/`, and the types that name the methods are in `cloudflare/`. The lean
  is one type-only contract both may import. Three open pull requests change `node/` now, so this
  is settled by an amendment when slice 9 starts.

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

15 fires in 7 files are this kind. All wait for slice 9.

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
Promise. The 15 calls made through `Reflect.get` then become plain calls. See the second doubt at
the top for where the method types come from.

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
| next/packages/libfabrika/src/node/dev/dev.ts | build | 40 | slice 9: the typed client |
| next/packages/libfabrika/src/node/dev/dev.types.test.ts | tests | tests | slice 9: L7 |
| next/packages/libfabrika/src/node/dev/dev-control.laws.integration.test.ts | tests | tests | slice 9: kinds 6 and 9, 3 fires |
| next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts | tests | tests | slice 9: kind 6, 1 fire |
| next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts | tests | tests | slice 9: kind 9, a wrapper becomes a plain object |
| next/packages/libfabrika/src/node/launchd/Launchd.test-support.ts | tests | tests | slice 9: kind 9, the handle wrapper becomes a plain object |
| next/packages/libfabrika/src/cloudflare/control.ts | build | 60 | slice 10: kind 5, the typed table |
| next/packages/libfabrika/src/cloudflare/control.laws.test.ts | tests | tests | slice 10: L8 |
| next/packages/libfabrika/src/cloudflare/platform.test.ts | tests | tests | slice 10: kinds 3, 5 and 9, 19 fires; `rejecting` and `answeringProcess` become `Stub.make` |
| next/packages/libfabrika/src/cloudflare/readers.laws.test.ts | tests | tests | slice 10: kind 9, 5 fires |
| next/packages/libfabrika/src/cloudflare/ObjectService.test.ts | tests | tests | slice 10: kind 3, 2 fires; its two guards become `Stub.make` |
| next/packages/libfabrika/src/cloudflare/error-cause.test.ts | tests | tests | slice 10: kind 9, 1 fire; its stubs become `Stub.make` |
| next/packages/libfabrika/src/cloudflare/alarm.laws.test.ts | tests | tests | slice 10: no fire; its 4 hand-written guards become `Stub.make` |
| next/packages/libfabrika/src/cloudflare/index.test.ts | tests | tests | slice 10: no fire; its guard becomes `Stub.make` |
| next/packages/libfabrika/src/cloudflare/p14.test.ts | tests | tests | slice 10: no fire; its stub becomes `Stub.make` |
| next/packages/libfabrika/src/telemetry/Records.integration.test.ts | tests | tests | slice 10: no fire; its stub becomes `Stub.make` |
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
| next/apps/fabrika/src/checklist-instance.laws.integration.test.ts | tests | tests | slice 14: kinds 2 and 5, 3 fires; its 2 stubs become `Stub.make` |
| next/apps/fabrika/src/door.integration.test.ts | tests | tests | slice 14: kind 1, 2 fires |
| next/apps/fabrika/src/input-recording.integration.test.ts | tests | tests | slice 14: kind 5, 1 fire |
| next/apps/fabrika/src/instance-records.integration.test.ts | tests | tests | slice 14: kind 6, 1 fire; kind 11, the generated text |
| next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts | tests | tests | slice 14: kinds 1 and 5, 9 fires; its 2 stubs become `Stub.make` |
| next/apps/fabrika/src/runtime.decode.test.ts | tests | tests | slice 14: kind 2, 3 fires; kind 9, 2 lines stay in the hostile input |
| next/apps/fabrika/src/scheduled-job-alarm.integration.test.ts | tests | tests | slice 14: kind 6, 6 fires |
| next/apps/fabrika/src/tasks-wire.integration.test.ts | tests | tests | slice 14: kind 6, 1 fire |
| next/apps/fabrika/src/worker-mail.integration.test.ts | tests | tests | slice 14: kind 6, 3 fires |
| next/apps/fabrika/src/worker-supervision.integration.test.ts | tests | tests | slice 14: kind 6, 2 fires |
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

**Waiting, each named with what it waits on:**

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
9. `node`, with the typed dev client: 40 product lines, about 60 test lines.
10. `cloudflare`, with the control table: 60 product lines, about 250 test lines.
11. `runtime`: about 80 test lines. 0 product lines.
12. `client`: about 300 test lines. 0 product lines.
13. The app's `e2e`: about 60 test lines. 0 product lines.
14. The app's `src`: about 150 test lines. 0 product lines.
15. The fold: about 40 lines of configuration. 0 product lines.

Priced from the rows in `field/runs/` for 2026-11-10 to 2026-11-15, at list price: a tests step
averages $5.78, a build $4.78, a review $2.71 and a fix round $4.18. The six small cold slices are
priced at $4 each for tests and review. The others: slice 1 $9, slice 8 $13, slice 9 $14, slice 10
$16, slice 11 $10, slice 12 $14, slice 13 $8, slice 14 $14, slice 15 $5, and four send-backs at $7.
That is 33 steps and 4 send-backs.

Estimate: 37 steps, $155

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

## Open questions

None.

## Findings

```json
{"id":"2026-11-15-restricted-properties-advises-by-code","date":"2026-11-15","where":"oxlint-plugins/advice.ts","what":"pnpm lint grades advice by rule code, so any entry added to eslint/no-restricted-properties in one of the 14 folders of the JSON.parse warn override at .oxlintrc.json:2296 only advises. Today the two retry entries are safe only because client/ is not in that override.","proof":"oxlint-plugins/advice.ts: `advises` is `ADVICE.has(fire.code) && fire.severity === \"warning\"`; oxlint-plugins/README.md:879 records that no-cause-squash became a rule of our own for this reason.","note":"The reflect-ban plan fixes this in its slice 1; the row is here so the trap is on record if that slice is cut or reordered."}
```
