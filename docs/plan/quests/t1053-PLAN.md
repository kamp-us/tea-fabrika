
Plancheck-Version: 3

# Plan: the 97 `unknown` parameters in product code get a type, one Schema per wire value (ticket 1053)

This is `next/`. The owner ruled on 2026-11-15 that the 97 faulty `unknown` parameters get fixed and
the 156 right ones stay. This plan cuts the work into nine pull requests by wire value, and plans
the first one in full: what a client's socket is told, and the view update inside it.

This quest is one of the fixes of the sev0 the owner called on 2026-11-15, so it ends with the 97
at zero.

```ts
// The whole idea, a sketch. One value, named once, and every hop takes it.

// before: the gateway builds a typed value, and the first hop drops the type
yield* notify(client, { method: "client.granted", params: { nonce } }); // gateway/Gateway.ts
const notify = function* (client: string, news: unknown) {};            // 10 parameters say this
if (typeof news === "object" && news !== null && "close" in news) {}    // the last hop guesses by hand

// after: runtime/News.ts holds the one Schema
export const News = Schema.TaggedUnion({
  close: { code: Schema.Int },   // close the client's sockets, 4003 when its key was removed
  granted: { nonce: Schema.String },
  view: { update: Published },   // a watcher's view update, with its pid
});
yield* notify(client, News.cases.granted.make({ nonce }));
const notify = function* (client: string, news: News) {};               // every hop
const told = yield* Schema.decodeUnknownEffect(News)(news);             // the Connection object's door
```

## What changes, in one paragraph

A value that crosses our own hops is named again as `unknown` at each hop today, and some hops pick
it apart with `typeof` and `in`. Each such value gets one Effect Schema. The place the value enters
decodes it once. Every later hop takes the Schema's type. A call between two of our objects is
typed and still decoded on arrival, as `exit` already is (`cloudflare/runtime.ts`, "Project RPC
input is untrusted"). A hand decode becomes a Schema decode, and a value the caller already had
typed keeps its type. No lint rule is planned here: how this kind of fault is kept from coming back
is a later talk between the owner and the lead.

## What was checked against main

Counted on `origin/main` at `98bcdfa22` with a syntax-tree scan of every `.ts` and `.tsx` file under
`next/` (the scan script is not in the repo).

- **The counts hold.** Main has 308 `unknown` parameters in product files. 46 are named `cause` and
  9 are type guards (`(u: unknown): u is X`), which the public rule does not count. That leaves 253:
  47 passed along, 33 decoded by hand, 17 avoidable, 75 doors, 70 program slots, 11 other. All 253
  rows of the research list are on main.
- **The lines differ.** The research was read at `a3dc79551`, which held quotas slice 4. Main is
  without it again, so 76 rows sit at the line the list calls `lineAtCount`, not at its `line`. This
  plan uses main's lines.
- **The four parameters the research could not place are gone.** `gateway/Gateway.ts:1146`,
  `runtime/RecoveryStore.ts:144` and `:369`, and `runtime/ProcessStore.ts:185` came with slice 4 and
  left with it. They come back when ticket 404 lands slice 4 again (see slice 7).
- **The news chain is 10 parameters, not 8 functions.** `news: unknown` is written 10 times: 8
  passed along, 1 hand decode, 1 avoidable. Three more hops take it with no annotation
  (`cloudflare/platform.ts:316`, `cloudflare/ConnectionObject.ts:90`, `cloudflare/runtime.ts:1168`).
- **Guideline E1 is in `docs/direction/effect-code-guidelines.md`.** There is no `docs/guidelines/`
  folder on main.
- **The hands pull request does not change the gateway today.** Its product files are
  `client/HandsStart.ts`, `transport/PublicKey.ts`, the new files under `node/client/` and the app's
  `hands.ts` (https://github.com/kamp-us/tea-fabrika/pull/1331, read 2026-11-15).
- **`{ type: string }`:** a Schema at `runtime/Execution.ts:29` and at `runtime/Runner.ts:370`, and
  the hand guard `isTyped` at `runtime/Program.ts:592`, used by `decodeTyped` at `:595`.

## How others do it

- **Effect: decode at the edge, typed inside.** Its guide says "**AVOID using predicates or manual
  parsing**, instead use `Schema` to parse untrusted data" and "**NEVER** write your own helper
  functions like `isRecord`" (`node_modules/effect/AGENTS.md`, read in the installed 4.1.2). The
  decode family is `decodeUnknownEffect`, `decodeUnknownExit`, `decodeUnknownOption`,
  `decodeUnknownResult` and `decodeUnknownSync` (`node_modules/effect/src/Schema.ts:1535` to
  `:1883`). There is no bare `decodeUnknown`.
- **Effect types JSON as JSON.** `JsonPatch.get(oldValue: Schema.Json, newValue: Schema.Json)`
  (`node_modules/effect/src/JsonPatch.ts:184`). `Schema.Json` is a named type and a codec
  (`Schema.ts:18921`, `:18955`).
- **Elm.** A value from outside enters through a port and a `Json.Decode` decoder, and every
  function after that takes the decoded type. From memory of the Elm guide's interop chapter, not
  fetched for this plan.
- **Erlang/OTP.** A process gets a tagged term and matches on the tag, as `{close, Code}`. Not
  fetched for this plan.
- **JSON-RPC 2.0.** A message with a method and no id is a Notification. `client.granted`,
  `view.whole` and `view.patch` are notifications. From memory of the spec, not fetched.
- **WebSocket.** Close codes 4000 to 4999 are for private use (RFC 6455, section 7.4.2). From
  memory, not fetched.
- **Ours.** `exit(pid, input: ExitReason, origin: From)` is typed and still decoded, while
  `msg(input: unknown)` beside it is not. Decision
  [0215](../../../.decisions/0215-untrusted-input-never-throws.md) picks the call: the wire goes
  through `decodeUnknownEffect`, and `make` is for a value our own code builds.
  [0554](../../../.decisions/0554-no-reflect-get-set-has.md) says a field is read through its type
  or a decode.

## The nine slices

One pull request each, by wire value. The counts are parameters of the 97.

| Slice | The wire value | Hits | Waits on |
|---|---|---|---|
| 1 | What a socket is told, and the view update inside it | 20 | nothing |
| 2 | The view notice on the client | 2 | slice 1 |
| 3 | A client's call: the hello, a route's params, the grant | 14 | slice 1 merged, since both edit the same lines of three files |
| 4 | A ledger line and a program's own event | 10 | slice 3 merged, for the same reason |
| 5 | Three short hand-offs: the code install row, a process's input, a program's declaration | 9 | slice 4 merged; the pipe build, for `Execution.ts` |
| 6 | A Cmd and its settled Msg, as the runtime reads them | 11 | the watch and the pipe builds |
| 7 | What the runner saves: the recovery journal and a runtime record | 7 | quotas slice 4 landing again (ticket 404) |
| 8 | A TOML value | 12 | nothing |
| 9 | A thrown platform error, a letter's body, and four leftovers | 12 | the hands pull request, for `HandsStart.ts` only |

20 + 2 + 14 + 10 + 9 + 11 + 7 + 12 + 12 = 97.

**Slice 2, the view notice on the client.** `client/WindowMachine.ts:683` reads `note.type` by hand
and `runtime/Client.ts:254` hands a view on untyped. The window decodes `Published` from slice 1
once, where it decodes `ViewNotice` today, and `noticed` takes the type. `ViewNotice` goes.

**Slice 3, a client's call.** Passed along: the hello (`brain.ts:62`, `bindings.ts:159`,
`runtime.ts:1827`), a route's params (`brain.ts:69`, `bindings.ts:178`, `runtime.ts:1830` and
`:1975`, `transport/Answer.ts:28`, `transport/Connection.ts:38`) and the grant (`brain.ts:79`,
`bindings.ts:185`, `runtime.ts:1842`). By hand: `rawObject` and `reserved` (`gateway/Gateway.ts:78`,
`:81`). The shape: the frame is the door, so its `params` decode as `Schema.Json` and every hop to
`Gateway.route` takes `Schema.Json`. The Connection object already decodes `Hello`
(`cloudflare/connection.ts`) and then sends the raw params on: it sends the decoded `Hello`. The two
copies of the JSON-RPC `Request` schema (`transport/Answer.ts` and `transport/Connection.ts`) become
one in `transport/Wire.ts`. `reserved` becomes a Schema. A union of every method's params is not in
this slice: it is the gateway's dispatch, the open call of experiment 174.

**Slice 4, a ledger line and a program's own event.** The line: `brain.ts:134`, `runtime.ts:1404`,
`:1868` and `:2018`, `ledger/Ledger.ts:70`. The event: `brain.ts:149`, `bindings.ts:263`,
`runtime.ts:1908` and `:2037`, and the avoidable `runtime.ts:2292`, whose contract already says
`Event`. Both Schemas exist: `Line` in `ledger/Log.ts` and `Event` in `runtime/Entry.ts`.

**Slice 5, three short hand-offs.** Each is two to four lines, so they share a pull request. The
code install row (`runtime.ts:1786`, `:1787`, `:1953`, `:1954`) takes `Install` and the
`code.failed` case, which `bindings.ts` already names. A process's input (`objects.ts:40`,
`runtime.ts:2347`, `:2401`) takes `Incoming`. A program's declaration (`cloudflare/box.ts:25`,
`runtime/Execution.ts:252`) takes the authoring type that `stepper` decodes.

**Slice 6, a Cmd and its settled Msg.** By hand in `runtime/Runner.ts`: `operands` (`:274`),
`withoutInput` (`:297`), `hasParent` (`:2768`), `stamp` (`:2770`), `errTag` (`:2784`). By hand in
`runtime/Program.ts`: `decodeTyped` (`:595`), `isTagged` (`:623`), `settled` (`:627`). Avoidable:
`checkpoint`'s `turn` (`Runner.ts:1303`) and the `schema` of `accepts` (`Program.ts:619`) and
`encodeAnswer` (`Execution.ts:186`). `Typed`, the `{ type: string }` Schema, is named once. The watch
pull request adds two more callers of `operands` and edits `settled`, so this slice starts after it.

**Slice 7, what the runner saves.** `runtime/RecoveryStore.ts`: `save` takes `S` (`:56`, `:208`),
and `receiptFor`, `textIn` and `generationIn` (`:65`, `:90`, `:93`) become row Schemas.
`runtime/ProcessStore.ts`: `record` takes `RuntimeRecord` (`:133`, `:314`). Quotas slice 4 rewrites
both files and adds three `unknown` parameters of its own there, so this slice starts after it and
fixes those too. Its fourth is in `gateway/Gateway.ts`: whichever of slice 3 here and quotas slice 4
lands second reads it.

**Slice 8, a TOML value.** Passed along: `settings/Toml.ts:87`, `settings/TomlParser.ts:198` and
`:243`, `settings/internal/edit.ts:189`. By hand: `settings/Files.ts:58`, `:62`, `:69`,
`settings/JsonSchema.ts:15`, `TomlParser.ts:159`, `edit.ts:60` and both sides of `:67`. One recursive
Schema, a scalar, an array or a table, built on the `Scalar` schema `TomlParser.ts` has. Decision
0554's cleanup fixes `Reflect.get` at `TomlParser.ts:35` and `edit.ts:63`, so the two are planned
together.

**Slice 9, the rest.** A thrown platform error read by hand: `ledger/internal/ledgerStore.ts:149`,
`telemetry/Sink.ts:139` and `:149`, the app's `local-instance.ts:15`, tuval's `browser/index.ts:10`
and `browser/key.ts:29`. A letter's body: `processes/Process.ts:758` and
`processes/internal/programMail.ts:21`. Leftovers: `client/HandsStart.ts:48`, tuval's
`browser/key.ts:120`, and `Testing.ts:13` twice.

The seven `unknown` returns the research calls faults go with their slice: three in slice 6, two in
slice 8, two in slice 9.

## The shape of slice 1

Two wire values travel together, so they land together. The view update goes from a Process object
to the Project object (`publish`). The news goes from the Project object to a Connection object
(`notify`), and a view update is one kind of news.

```ts
// next/packages/libfabrika/src/runtime/Patch.ts (a sketch): the Schema it has, now exported.
export const Patch = Schema.Union([
  Schema.Struct({ op: Schema.Literal("add"), path: Schema.String, value: Schema.Json }),
  Schema.Struct({ op: Schema.Literal("replace"), path: Schema.String, value: Schema.Json }),
  Schema.Struct({ op: Schema.Literal("remove"), path: Schema.String }),
]);
export type Patch = typeof Patch.Type;
export const diff = (before: Schema.Json, after: Schema.Json): ReadonlyArray<Patch> => { /* as today */ };
```

```ts
// next/packages/libfabrika/src/runtime/News.ts (new, a sketch)
const whole = { type: Schema.Literal("whole"), rev: Schema.Number, view: Schema.Json };
const patch = { type: Schema.Literal("patch"), base: Schema.Number, rev: Schema.Number, patch: Schema.Array(Patch) };

/** What a watcher is sent: the whole view once, then one patch per installed step. */
export const Update = Schema.Union([Schema.Struct(whole), Schema.Struct(patch)]);
export type Update = typeof Update.Type;

/** A view update on its way to one client, with the process it came from. */
export const Published = Schema.Union([
  Schema.Struct({ ...whole, pid: Schema.String }),
  Schema.Struct({ ...patch, pid: Schema.String }),
]);
export type Published = typeof Published.Type;

/** What the brain tells one client's sockets. */
export const News = Schema.TaggedUnion({
  close: { code: Schema.Int.check(Schema.isBetween({ minimum: 4000, maximum: 4999 })) },
  granted: { nonce: Schema.String },
  view: { update: Published },
});
export type News = typeof News.Type;
```

No `_tag` is written by hand anywhere in this slice (decision 0562 on main,
`.decisions/0562-nothing-teaches-the-wrong-shape.md`, and the rule `fabrika/no-hand-tag`). A value
is made with its case's maker, `News.cases.granted.make(...)`. The one place that tells the cases apart
is the Connection's door, with `News.match`, which `Schema.TaggedUnion` ships in the installed
4.1.2 beside `guards`, `isAnyOf` and `matchOrElse` (`node_modules/effect/src/Schema.ts:6528` to
`:6592`). No type names a case by its tag: no function here takes "news that is not a close", so
none is needed.

The hops, each with the type it takes after the build:

```ts
// gateway/Gateway.ts
readonly notify: (client: string, news: News) => Effect.Effect<void, LedgerError, RNotify>; // Options
yield* notify(client, News.cases.granted.make({ nonce }));
yield* notify(client, News.cases.close.make({ code: 4003 }));

// cloudflare/Publish.ts: one traced function, two typed fronts
export const make = <E>(sql: Sql, send: (connection: string, client: string, news: News) => Effect.Effect<void, E>) => {
  const deliver = Effect.fn("project.publish")(function* (client: string, news: News) {
    /* the route lookup of today: `gone` with no route, else send and answer `sent` */
  });
  return {
    publish: (client: string, update: Published) => deliver(client, News.cases.view.make({ update })),
    notify: (client: string, news: News) => deliver(client, news).pipe(Effect.asVoid),
  };
};

// cloudflare/runtime.ts
readonly notify: (client: string, news: News) => Effect.Effect<void, LedgerError>;              // ProjectDoorOptions
readonly publish: (client: string, update: Published) => Effect.Effect<typeof Publication.Type, LedgerError>; // ProjectService
publish: (client, update) => Schema.decodeUnknownEffect(Published)(update).pipe(/* bad_row, then told.publish */),

// cloudflare/bindings.ts and cloudflare/objects.ts
publish: RemoteCall<(client: string, update: Published) => Effect.Effect<typeof Publication.Type>>;
notify: (client: string, news: News) => Effect.Effect<void>;             // ConnectionBinding
readonly notify: (client: string, news: News) => Effect.Effect<void, LedgerError>; // ConnectionShape

// cloudflare/connection.ts: the door decodes, then one `News.match`
const METHOD = { whole: "view.whole", patch: "view.patch" } as const;
const frame = (method: string, params: Schema.Json) => JSON.stringify({ jsonrpc: "2.0", method, params });

const told = yield* Schema.decodeUnknownEffect(News)(news).pipe(
  Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
);
yield* Effect.annotateCurrentSpan("fab.gateway.news", told._tag); // a read, see below
News.match(told, {
  close: ({ code }) => ws.close(code, "permission changed"),
  granted: ({ nonce }) => ws.send(frame("client.granted", { nonce })),
  view: ({ update }) => ws.send(frame(METHOD[update.type], update)),
});

// next/apps/fabrika/src/brain.ts
import type { Published } from "@kampus/libfabrika/runtime/News";
publish(client: string, update: Published) { /* the one-line handoff of today */ }
```

- **The span attribute reads the case's name as a value.** `told._tag` handed to a call is a read,
  and the rule lets a read pass. Its own header says "A read passes: `x._tag === "a"`,
  `const {_tag} = x`, `switch (x._tag)`" (`no-hand-tag.ts` in the lint plugins folder, lines 5 and
  6), and it visits only an object key, a class field and a type member (lines 42 to 54).
- **The update's method is a lookup, not a conditional.** `METHOD` is keyed by the update's own
  `type`, so a third kind of update fails the typecheck there.
- **The app may name `Published`.** The library's export map offers `./runtime/*`, and the app's
  files already import `@kampus/libfabrika/runtime/Program` and three more from that folder.

Three small edits make the view update JSON, since `Published` cannot be built from an `unknown`
view:

- `runtime/Entry.ts`: `View` becomes `Schema.Json`. `View` and `Update` are re-exported from
  `News.ts`, so the nine files that import them from `Entry.ts` do not change.
- `runtime/Patch.ts`: `same`, `walk` and `diff` take `Schema.Json`. That fixes its six avoidable
  parameters. The hand type `Patch` and the private `Operation` schema become the one `Patch` above.
- `runtime/Runner.ts`: the `view` field of `Live` (`:385`) becomes `Schema.Json`. Every value put
  there today comes from a `Step`, whose `view` is already `Schema.Json` (`runtime/Program.ts:493`).

## One value traced: a key is granted

1. The owner lets a waiting key in. `Gateway.grant` makes a nonce `"n1"` for the waiting client
   `c7` and builds `News.cases.granted.make({ nonce: "n1" })`, a `granted` news holding
   that nonce.
2. `gateway.notify("c7", news)` calls `options.notify`, the Project's `notify` from `Publish.make`.
3. `deliver` reads `c7`'s route row and finds its Connection object. With no row it answers `gone`
   and stops.
4. `GatewayClient.notify("c7", news)` makes the RPC. The stub and the object class pass `News` on.
5. `ConnectionService.notify` decodes the value as `News`. A value that is not `News` fails with
   `LedgerError` `bad_row`, and nothing is sent.
6. The span gets `fab.gateway.news = "granted"`.
7. `News.match` takes the `granted` arm. Each of `c7`'s sockets is sent
   `{"jsonrpc":"2.0","method":"client.granted","params":{"nonce":"n1"}}`, the same JSON as today.

A view update goes the same way from step 3 on. The Process object calls
`publish("c7", { type: "patch", base: 4, rev: 5, patch: [], pid: "process_a1" })`. The Project
decodes it as `Published`, wraps it with `News.cases.view.make({ update })`, and the socket is sent
`{"jsonrpc":"2.0","method":"view.patch","params":{...}}`.

## Laws

The typecheck reads a type law; vitest only loads the file. A type law is red only in a typecheck,
which the lead and CI run.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1, `News`, `Published` and `Update` each decode what they encode, and the decoded value equals the first. Fast, 100 runs | test | Effect Arbitrary: News | drop the `pid` from the `view` case's update: L1 red | next/packages/libfabrika/src/runtime/News.test.ts |
| L2, the frame a socket is sent is today's wire JSON, checked where the frame is built, at the Connection's door: `granted` is method `client.granted` with params holding only the nonce; a whole view is `view.whole` and a patch is `view.patch`, each with params equal to the update, pid included. Fast, 100 runs | test | Effect Arbitrary: News | send a patch as `view.whole`: L2 red | next/packages/libfabrika/src/cloudflare/connection.test.ts |
| L3, the view is JSON: `View`, the `view` of `Opened`, both parameters of `diff` and a patch's `value` are `Schema.Json`, and `Update` is the Schema's type | type | type | put `unknown` back on `diff`'s `before`: the typecheck fails | next/packages/libfabrika/src/runtime/News.types.test.ts |
| L4, in the cloud files every hop's `news` parameter is `News` and every hop's `update` parameter is `Published`: `ConnectionShape`, `ConnectionBinding`, the `ConnectionService` and `GatewayClient` services, `ProjectDoorOptions`, the send function `Publish.make` takes and both fronts it returns, `ProjectBinding` and the `ProjectService` service | type | type | put `unknown` back on any one of them: the typecheck fails | next/packages/libfabrika/src/cloudflare/News.types.test.ts |
| L5, the gateway's `notify` option takes `News` | type | type | put `unknown` back on `Options.notify`: the typecheck fails | next/packages/libfabrika/src/gateway/Gateway.types.test.ts |
| L6, the Project class's `publish` takes `Published` | type | type | put `unknown` back on the class's `update`: the typecheck fails | next/apps/fabrika/src/brain.types.test.ts |
| L7, `Publish.make`: with a route, `publish` sends exactly one `view` news holding the update and answers `sent`, and `notify` sends its news unchanged; with no route both send nothing and `publish` answers `gone`. This replaces the old law that any object passes through `publish` unchanged. Fast, 100 runs | test | Effect Arbitrary: News | route a `granted` news through `publish`'s front: L7 red | next/packages/libfabrika/src/cloudflare/Watchers.test.ts |
| L8, the Connection object's `notify`: a `close` closes the client's sockets with its code and sends nothing; any other news sends exactly one text frame, the one L2 checks; another client's socket gets nothing; the span carries `fab.gateway.news` with the case. Fast, 50 runs | test | Effect Arbitrary: News | send a frame for a `close` too: L8 red | next/packages/libfabrika/src/cloudflare/connection.test.ts |
| L9, a value that is not `News` fails the Connection's `notify` with `LedgerError` `bad_row`, and a value that is not `Published` fails the Project's `publish` the same way; neither sends or closes anything. Fast, 50 runs | test | fc.oneof: fc.jsonValue, and a generated News with one field removed or retyped | forward the raw value when the decode fails: L9 red | next/packages/libfabrika/src/cloudflare/connection.test.ts |

Laws that already hold the wire, changed only where they build or read news: the door's laws that a
grant tells the waiting client and a removed key gets a 4003 close, the checklist instance law that
each view notice carries its pid and its update unchanged, and the window laws that a client takes
`client.granted`, `view.whole` and `view.patch`. They run on the schedule, as today.

No host-only law: nothing here needs launchd, the real Electron app or the owner's Mac. Nothing new
is a real-resource test.

## Files

| File | Owner | Product lines expected | What |
|---|---|---|---|
| next/packages/libfabrika/src/runtime/News.ts | build | 65 | new: `Update`, `Published`, `News`, each with its doc block |
| next/packages/libfabrika/src/runtime/Patch.ts | build | 15 | `Patch` is the exported Schema and its type; `same`, `walk` and `diff` take `Schema.Json` |
| next/packages/libfabrika/src/runtime/Entry.ts | build | 8 | `View` is `Schema.Json`; `View` and `Update` re-exported from `News.ts` |
| next/packages/libfabrika/src/runtime/Runner.ts | build | 2 | the `view` field of `Live` |
| next/packages/libfabrika/src/gateway/Gateway.ts | build | 6 | `Options.notify`, `notify`, and the two places that build news |
| next/packages/libfabrika/src/cloudflare/Publish.ts | build | 25 | `deliver` and its two fronts; the hand check goes |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 14 | `ProjectDoorOptions.notify`, the wiring of both fronts, `ProjectService.publish` typed and decoded |
| next/packages/libfabrika/src/cloudflare/bindings.ts | build | 4 | `publish` on `ProjectBinding`, `notify` on `ConnectionBinding` |
| next/packages/libfabrika/src/cloudflare/objects.ts | build | 2 | `notify` on `ConnectionShape` |
| next/packages/libfabrika/src/cloudflare/connection.ts | build | 32 | the door's decode, the span attribute, `METHOD`, `frame` and the one `News.match`; both `notify` types |
| next/apps/fabrika/src/brain.ts | build | 2 | `publish`'s `update` is `Published`, imported by name |
| .glossary/TERMS.md | build | docs | a row for `news` |
| next/packages/libfabrika/src/runtime/News.test.ts | tests | tests | new: L1 |
| next/packages/libfabrika/src/runtime/News.types.test.ts | tests | tests | new: L3 |
| next/packages/libfabrika/src/cloudflare/News.types.test.ts | tests | tests | new: L4 |
| next/packages/libfabrika/src/gateway/Gateway.types.test.ts | tests | tests | one more block: L5 |
| next/apps/fabrika/src/brain.types.test.ts | tests | tests | new: L6 |
| next/packages/libfabrika/src/cloudflare/Watchers.test.ts | tests | tests | L7, in place of the pass-through law; its fake send takes `News` |
| next/packages/libfabrika/src/cloudflare/connection.test.ts | tests | tests | L2, L8, L9 |
| next/packages/libfabrika/src/cloudflare/readers.laws.test.ts next/packages/libfabrika/src/cloudflare/platform.test.ts | tests | tests | each hands `notify` one real `News` value where it hands `{}` or a loose object today |
| next/packages/libfabrika/src/gateway/TasksTest.ts next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts | tests | tests | the kept notices are `News` |
| next/apps/fabrika/src/door.integration.test.ts next/apps/fabrika/src/checklist-instance.laws.integration.test.ts next/apps/fabrika/src/runtime.laws.integration.test.ts | tests | tests | read a notice with `News.guards` or `News.match` and its fields, never by searching its JSON text; build `News` with `make` |
| next/packages/libfabrika/src/runtime/Patch.test.ts next/packages/libfabrika/src/runtime/Client.laws.test.ts next/packages/libfabrika/src/client/Tezgah.laws.test.ts next/packages/libfabrika/src/client/WindowMachine.laws.test.ts next/programs/checklist/src/client.laws.test.ts | tests | tests | only if the typecheck asks: a value handed to `diff` is typed as JSON |

`cloudflare/platform.ts` and `cloudflare/ConnectionObject.ts` need no edit: their `news` takes its
type from the binding and the shape.

## Calls taken

- **`News` lives in `runtime/News.ts`. 80%.** The gateway builds it, the cloud files carry it, and
  it holds the runner's view update. `gateway/` and `cloudflare/` may not import each other, and
  `runtime/` may not import `transport/` (the layer rules that `pnpm lint:layers` reads).
  `runtime/` is the one module all of them may import. The cost: a grant notice is defined in the
  runner's module.
- **The name is `News`. 80%.** The code says `news` in all ten parameters. "Notice" already means a
  brain notice in the glossary, and JSON-RPC's "notification" does not cover a close.
- **`News` is tagged `_tag`; the view update keeps `type`. 85%.** `News` is a new union of ours, so
  0214 gives it `_tag`. The update's `type` is on the wire to every client today, and this quest
  changes no wire. See Findings.
- **Both doors decode. 75%.** The Project decodes `Published` and the Connection decodes `News`, as
  `exit` is typed and still decoded. The cost is one walk of the view at each door on every
  publish. If a measurement shows it, the Connection door, whose only caller is the Project, is the
  one to drop.
- **A close code is 4000 to 4999, and 4003 stays where the gateway writes it today. 85%.** Is it a
  setting (0069)? No: it is a protocol constant the client's `Link` reads as "key removed".
- **`fab.gateway.news` is recorded now. 85%.** One line. It holds the case's name and never the
  nonce or the view.
- **Patch.ts is typed here and replaced later. 85%.** E1 says to delete it for `effect/JsonPatch`.
  That changes behavior: Effect's `get` sorts keys and does not copy values, and its `apply` throws
  where ours answers `bad_patch` and refuses `__proto__` (read in
  `node_modules/effect/src/JsonPatch.ts`). It is its own pull request with its own laws.
- **Three small hand-offs share slice 5, and the leftovers share slice 9. 80%.** Each is a few
  lines, and none lands half done.

## Doubts, under 80%

- **The view cascade, 75%.** `Live.view` is the one field read here that must become JSON. Another
  place may hold a view as `unknown`, and only a typecheck shows it.
- **`Array.isArray` on `Schema.Json`.** TypeScript narrows a read-only array poorly. `Patch.ts`'s
  body may need Effect's own `Array.isArray`, which narrows to the read-only member
  (`node_modules/effect/src/Array.ts:1631`). Read, not compiled.
- **An Arbitrary for `Schema.Json`.** Not checked in 4.1.2. If Effect cannot generate it, the laws
  draw the view from `fc.jsonValue`, which 0411 allows for data Effect cannot generate.

## Clashes with open work

- **The watch pull request** (https://github.com/kamp-us/tea-fabrika/pull/1341) edits
  `Runner.ts`, `Program.ts`, `processes/Process.ts`, `cloudflare/runtime.ts`, `bindings.ts`,
  `platform.ts` and the app's `brain.ts`. Slice 1 does not wait on it: its hunks add calls, and
  none is at a line slice 1 edits (read from the diff on 2026-11-15). Whichever lands second merges
  main. Slice 6 waits on it. Slice 9's `Process.ts` line is 40 lines from a watch hunk, so it merges
  main after it.
- **The pipe pull request** (https://github.com/kamp-us/tea-fabrika/pull/1344) is a plan only
  today. Its plan adds about 220 lines to `Runner.ts` and edits `Program.ts`, `Execution.ts`,
  `ProcessStore.ts` and the same cloud files. Slice 6 waits on its build. Slice 5's `Execution.ts`
  line waits on it too. Slices 1, 3 and 4 do not wait.
- **The hands pull request** (https://github.com/kamp-us/tea-fabrika/pull/1331) edits
  `client/HandsStart.ts`. Only slice 9's one line there waits. Slice 3, the gateway slice, does not
  wait on it today; read its file list again when slice 3 starts.
- **Quotas slice 4** (ticket 404, branch `fabrikalfa/p34c-s4`) is off main and will land again. It
  edits `gateway/Gateway.ts` and `cloudflare/runtime.ts` too: whichever of it and slice 1 lands
  second merges main. Slice 7 waits on it.

## Validation

The tests step runs its own new files with
`nice -n 15 pnpm exec vitest run --maxWorkers=3 <path>`. The build runs `pnpm format`, `pnpm lint`
and the same narrow paths. The lead runs the one type check and the changed tests at the end, since
four of the nine laws are read only there.

## Size

Nine pull requests, each landing whole. Product lines only.

1. What a socket is told, and the view update inside it: 175 lines over 11 files.
2. The view notice on the client: 30 lines.
3. A client's call: 90 lines.
4. A ledger line and a program's own event: 40 lines.
5. Three short hand-offs: 40 lines.
6. A Cmd and its settled Msg: 120 lines.
7. What the runner saves: 60 lines.
8. A TOML value: 110 lines.
9. A thrown platform error, a letter's body, and the leftovers: 70 lines.

Slice 1 also has about 350 test lines over 15 files. Confidence 70% on slice 1's size: the doubt is
the view cascade. Slices 2 to 9 are sized from reading and get their own plans; 60% on those.

The budget below is slice 1's: tests, build, review, one fix round and its recheck. Priced from the
list prices in `field/runs.jsonl` (tests median $1.14, build $1.24, review $1.18) and from ticket
971's lane, the newest priced one of this kind (tests $8.41, build $0.87, review $2.70).

Estimate: 5 steps, $19

## Records

- **Nothing new is saved.** No ledger entry, no table and no stored row changes. The JSON a client
  gets is the same value as today; key order inside `params` may differ.
- **One new span attribute:** `fab.gateway.news` on the `connection.notify` span, the news's case.
  What is lost if it is not recorded now: which kind of news each past notify carried. No span
  written before it gets it later.
- **Span names stay:** `gateway.notify`, `project.publish` and `connection.notify`. A grant notice
  is still recorded under `project.publish`, as today.
- **A refused value is recorded as today's errors are:** `LedgerError` `bad_row` with its cause.
- **One call between objects changes shape.** `notify` between the Project and a Connection object
  carries a `News` case in place of `{ method, params }` or `{ close }`. Both objects ship in one
  deploy. A call that crosses a deploy is refused as `bad_row`, and the watcher's next update or the
  client's reconnect repairs it.

## What comes after

- **How this fault is kept from coming back.** No lint rule is planned here. That is a later talk
  between the owner and the lead. E1 names `fabrika/no-hand-guard`, and the research measured the
  public rule at 62% false alarms.
- **Patch.ts replaced by `effect/JsonPatch`,** as E1 decides, in its own pull request.
- **One `Call` union for every route method,** which is the gateway's dispatch (experiment 174).
- **The 544 `unknown` parameters in tests and tooling,** which nobody has read.
- **A program's own model slot typed `Schema.Json`.** Not in this quest: the lead answered that the
  slots stay `unknown`, as the owner ruled, and carries the question to the owner. The reading, for
  that talk: it is about 57 of the 70 slots (`Execution` and `ExecutionCalls` in
  `runtime/Execution.ts`, the box in `cloudflare/box.ts`, the `Stepper` type). It can be done for
  the model, since every model the runner holds comes from `Step.stepped.model`
  (`runtime/Program.ts:492`) or a saved row (`runtime/State.ts:15`), both `Schema.Json`. It cannot
  yet for a Msg: `Incoming.envelope.input` is `Schema.Unknown` (`runtime/Entry.ts:70`), and making
  it JSON moves one refusal earlier. The box's own methods would stay `unknown`, since they are
  doors. One typecheck of `Execution.ts` settles the doubt.

## What this cannot tell us

- Nothing here was compiled. Every "after" block is a sketch read against the installed source.
- Whether a second decode of a large view on every publish costs time we can measure.
- Whether a test or a fake somewhere hands `publish` a view that is not JSON. The typecheck finds
  it.
- Whether hand decoding has caused a bug. This fixes where the code leaves the repo's own rule, not
  a known failure.
- The sizes of slices 2 to 9. Each was read, none was planned in full.

## Open questions

None.

## Findings

```json
{"_tag":"finding","id":"2026-11-15-view-update-tagged-type-not-tag","date":"2026-11-15","by":"plan","model":"claude-fable-5-2","rule":"rule_break","location":{"path":"next/packages/libfabrika/src/runtime/Entry.ts","line":47},"says":"In next/, the view update a watcher is sent is a union of ours tagged with `type` (\"whole\" or \"patch\"), where decision 0214 says every union we define is tagged `_tag`. It is not a tea Msg or a third-party shape, the two cases 0214 leaves alone.","proof":"next/packages/libfabrika/src/runtime/Entry.ts:48 reads `| { readonly type: \"whole\"; readonly rev: number; readonly view: View }`, and .decisions/0214-unions-are-tagged-with-tag.md reads \"Every union we define uses `_tag`, written by Effect Schema\". The client decodes the same key at next/packages/libfabrika/src/client/WindowMachine.ts:380.","cost":"A rename is a change to the wire every client reads, so it grows harder with each client. Ticket 1053 keeps `type` and makes the union a Schema.","head":"98bcdfa226f92fb702ae4a42ea19aa1a0592ad01","ticket":"kamp-us/tea-fabrika#1053","pr":null}
```
