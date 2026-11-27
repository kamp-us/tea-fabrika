
Plancheck-Version: 3

# Plan: the Effect rules from `@kalfa/quality/oxlint` (ticket 2242)

This is new work in the kalfa packages, in `kalfa/quality`. It is neither today's frozen version nor `next/`, though the
second pull request renames disable comments in both, and changes two CI tools that live in `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2242, under
[Code quality's protocol](https://github.com/kamp-us/tea-fabrika/issues/1763) and
[the owner's answers on its own gaps](https://github.com/kamp-us/tea-fabrika/issues/1763#issuecomment-7084076309).
Words: `kalfa/quality/GLOSSARY.md` (Rule, Diagnostic) and Diagnostics' glossary (Code).

Eleven lint rules leave our own plugin (`oxlint-plugins/`, named `fabrika`) for a new entry point, `@kalfa/quality/oxlint`:
`effect-functions`, `no-cause-squash`, `no-context-tag`, `no-data-taggederror`, `no-effect-promise`,
`no-effect-run-outside-edge`, `no-hand-tag`, `no-promises`, `no-raw-try-catch`, `no-throw-in-effect-gen` and
`no-type-assertions`. Each keeps what it refuses. Its messages lose our paths and ticket numbers. The one path a rule
held (`no-hand-tag`'s log file) becomes a rule option that our settings fill. Our settings load the package by name,
and the 670 or so disable comments that name these rules move to the new name. Two pull requests: the package first,
then the switch.

```ts
// The whole idea, a sketch. Nothing here was type-checked.

// kalfa/quality/src/oxlint/index.ts: what any repo loads.
import type { Plugin } from "@oxlint/plugins";
const plugin: Plugin = {
  meta: { name: "@kalfa/quality" }, // the open question below; every code reads `<name>(<rule>)`
  rules: { "effect-functions": effectFunctions, "no-promises": noPromises, /* ...the other nine */ },
};
export default plugin;

// .oxlintrc.json, ours
"jsPlugins": ["./oxlint-plugins/index.ts", "@kalfa/quality/oxlint", /* anti-slop, unchanged */],
"@kalfa/quality/no-hand-tag": ["error", { "allow": ["next/packages/libfabrika/src/ledger/Log.ts"] }],

// a line in next/, before and after
// oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object answers a Promise
// oxlint-disable-next-line @kalfa/quality/no-promises -- edge: a Durable Object answers a Promise
```

## Calls under 80%, read these first

- **The plugin's name, `@kalfa/quality`, 70% sure.** It is the one open question below. The build can start on the
  lean: a different answer is one search-and-replace over the same files, done before the second pull request lands.
- **Two pull requests, not one, 75% sure.** The first adds about 1,000 lines of rule code, nearly all copied. The
  second is mostly a mechanical rename across about 190 files. In one diff the rename hides the new code from the
  review. The cost is a second round of tests, build and review, about $32 more. One pull request with the rename in
  its own commit is the fallback if the lead prefers one round.

## Ticket 2369, the dropped test-file import bans

This plan does not fix https://github.com/kamp-us/tea-fabrika/issues/2369, and it does not wait for it. 85% sure.

- The new test files in `kalfa/quality/src/oxlint/` sit under `kalfa/quality/**`, so they share the hole until #2369
  lands, as the stryker and vitest test files do today.
- #2369's fix adds a block for `kalfa/quality`'s test files after Q8. Its glob reaches the new test files with no edit
  here.
- This plan's own import block (law O15) leaves test files out, as V3 does, and repeats every entry of every earlier
  block that reaches its files. So it already passes the check #2369 adds: "a later block never drops an earlier
  block's import bans for the same files".
- Either order works. Whichever lands second rebases on `.oxlintrc.json`, and the lead reruns `pnpm lint`.

## How others do it

- **Elm:** elm-review rules ship as packages, each rule configured in the user's `ReviewConfig.elm`, and a file a rule
  must skip is named there, `Rule.ignoreErrorsForFiles [ "src/Log.elm" ]`, never in the rule. Read from memory; not
  fetched.
- **Erlang/OTP:** Elvis, Erlang's style reviewer, configures each rule in `elvis.config` with an options map, and a
  module a rule must skip goes in that rule's `ignore` option, such as `{elvis_style, no_debug_call, #{ignore =>
  [my_mod]}}`. Read from memory; not fetched. The ticket picks this shape: a path of ours is a rule option.
- **ESLint and typescript-eslint:** a plugin is a package, and a scoped package's rules are named by its scope and name,
  `@typescript-eslint/no-explicit-any`, `@stylistic/indent`. A rule declares its options as JSON Schema in
  `meta.schema`, reads them from `context.options`, and is tested on its own with `RuleTester`. Read from memory; not
  fetched. Oxlint follows ESLint here, checked below.
- **Effect** keeps its lint rules in their own package, `@effect/eslint-plugin`, beside the library. Read from memory;
  not fetched.
- **Oxlint 1.90.0, as installed** (`pnpm-workspace.yaml` catalog: `oxlint` and `@oxlint/plugins` 1.90.0, Effect 4.1.3,
  vitest 5.0.5). Tried in a scratch folder, with a scratch package linked into `node_modules/@kalfa/quality` the way
  pnpm links a workspace package:
  1. A config entry `"jsPlugins": ["@kalfa/quality/oxlint"]` loads a `.ts` file through the package's `exports` and
     the link. Each of the names `@kalfa/quality`, `kalfa` and `kalfa-quality` works: the code prints as
     `@kalfa/quality(demo)`, and a disable comment naming `@kalfa/quality/demo` silences its line with no unused
     report.
  2. A rule with no `meta.schema` refuses any option and the whole run fails: "Rule ... does not accept options". With
     a schema, oxlint checks the options against it and fails the run on a bad one, before any file.
  3. `context.id` is the rule's full name as the config wrote it. A config alias (`{ "name": "q", "specifier": ... }`)
     makes it `q/demo`, and oxlint's `RuleTester` (`oxlint/plugins-dev`) makes it `rule-to-test/<rule>`.
  4. A disable comment that names a rule which no longer exists is reported as unused, and the line's fire comes back.
     So a stale `fabrika/no-promises` fails `pnpm lint` by itself.
- **Effect 4.1.3, as installed.** Every name the rules match exists: `Context.Service`, `Schema.TaggedError`,
  `Cause.findErrorOption`, `Exit.findErrorOption`, `Cause.findDefect`, `Effect.try`, `Effect.fail`, `Effect.die`,
  `Effect.catch`. `Context.Tag`, `Context.GenericTag` and `Effect.Service` do not exist in v4, which is why the rule
  bans them. `effect/Effect`'s `run*` exports are exactly the twelve run names `no-effect-run-outside-edge` lists, and
  `FiberSet`, `FiberMap` and `FiberHandle` each export the two runner makers. Schema's `*Promise` exports and Stream's
  `*AsyncIterable*` exports are exactly the ones `no-promises` lists.
- **This repo:** the protocol on issue 1763 settled what moves and how: neutral messages, our values as options, own
  tests, Effect v4, no kalfa import. `oxlint-plugins/no-sleep-on-test-clock.test.ts` and
  `oxlint-plugins/one-machine-per-file.test.ts` already test rules in process with `RuleTester` and generated code.
  `oxlint-plugins/inner-cause.ts` is the one rule of ours that reads an option, `allow`.

## The shape

### Files and the entry point

```text
kalfa/quality/src/oxlint/
  index.ts                      the plugin: meta.name and the eleven rules
  internal/Syntax.ts            what the rules share: dotted, plainCall, isWritten, grouped, pathIn, imported,
                                effectNames, ancestors, banNames (copied from oxlint-plugins/match.ts)
  effect-functions.ts ... no-type-assertions.ts    one file per rule, named for its rule
  <rule>.test.ts                each rule's laws, in process through RuleTester
  Tester.test-support.ts        one RuleTester wired to vitest, and one firing line per rule for law O12
  index.types.test.ts           law O13
  Plugin.integration.test.ts    law O14: the real oxlint loads the package by name
```

`package.json` gains `"./oxlint": "./src/oxlint/index.ts"`, a description that names `/oxlint`, and `oxlint` and
`@oxlint/plugins` as optional peer dependencies and dev dependencies. That is the shape it gives Stryker already, and
decision 0048 asks it: a tool's package is a peer needed only by the entry point that uses it. The rule files import
`@oxlint/plugins` for types only and `effect` (a peer already) for `Array` and `Predicate`.

Each rule file is a copy of its file in `oxlint-plugins/`, with four kinds of edit and no other:

1. **Imports** come from `./internal/Syntax.ts`, never from `oxlint-plugins/match.ts`.
2. **Messages are neutral.** No `fabrika`, no ticket or issue number, no path of ours, no `FateWireCode`, no "the
   owner reads". Each reason stays in words. A message that shows how to mark an exception builds the rule's name from
   `context.id`, so it stays right under any plugin name or alias.
3. **Comments are neutral**, as the vitest copy did: the top comment keeps what the rule refuses, what passes and what
   it misses, and loses ticket numbers, experiments and our folder names. Each exported rule gets the doc block that
   kalfa's `fabrika/jsdocs` block asks of `kalfa/*/src/**`.
4. **`no-hand-tag` reads its edge from an option** in place of its `EDGE` constant.

```ts
// A sketch of no-promises' message. Nothing here was type-checked.
const refuse = (node: Node, what: string) =>
  context.report({
    node,
    message: `${what}: this code is Effect all the way. Write it as an Effect, or mark the one line the platform demands with \`// oxlint-disable-next-line ${context.id} -- edge: <why>\`.`,
  });

// no-data-taggederror's reason, neutral: the repo's wire-code annotation goes.
"`class ... extends Data.TaggedError` is banned: an error is a `Schema.TaggedError`, so it is a schema that can be encoded, decoded and annotated. Fix: `class MyError extends Schema.TaggedError<MyError>()('MyError', { ...fields }) {}`."
```

### `no-hand-tag`'s option

```ts
// A sketch. Nothing here was type-checked.
export const noHandTag: CreateRule = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: {
          // Files from where oxlint runs, as `pnpm lint` names them: no leading `./`, no absolute path.
          allow: { type: "array", items: { type: "string", pattern: "^(?!\\./|/)" } },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const [given] = context.options; // oxlint already checked it against meta.schema
    const allow: ReadonlyArray<string> = isAllow(given) ? given.allow : [];
    if (allow.includes(pathIn(context))) return {};
    // ...the copied visitors
  },
};
```

The schema is the guard. A bad option fails the whole run before any file is read, which the tryout showed, so no
option shape gets through quietly. The only option forms are: none (`"error"`), `["error"]`, `["error", {}]`,
`["error", { "allow": [] }]` and `["error", { "allow": [<paths>] }]`. Law O7 runs each, and the bad ones.

### Our side, in the second pull request

```jsonc
// .oxlintrc.json, a sketch
"jsPlugins": ["./oxlint-plugins/index.ts", "@kalfa/quality/oxlint", /* anti-slop, unchanged */],
"rules": { "@kalfa/quality/no-effect-promise": "error", /* ...every `fabrika/<moved>` key renamed in place */ },
// the next/** block, the only one whose files hold the log:
"@kalfa/quality/no-hand-tag": ["error", { "allow": ["next/packages/libfabrika/src/ledger/Log.ts"] }],
```

- **The root `package.json`** gains `"@kalfa/quality": "workspace:*"`, so the config's specifier resolves from the top
  of the repo.
- **Our plugin** loses the eleven rules from `oxlint-plugins/index.ts`, their files, and their five test files. Their
  rule laws are the package's now. Their settings laws, which paths each rule is on in, move to one new file,
  `oxlint-plugins/quality-rules.test.ts`.
- **The shared plants test** (`oxlint-plugins/plants.test.ts`) drops the six `PLANTS` entries for moved rules. Its L1
  keeps `DATA_TAGGEDERROR`'s type lines under the new code, since L1 checks our settings in every folder, not the rule.
  Its `lint.ts` laws keep their two example rules under the new codes.
- **Our scripts that name the rules** get the new names: `edge-comment.ts`'s two edge rules, `promise-types.ts`'s edge
  check and its printed code, `advice.ts`'s two advice rules, and `agents-ledger.json`'s 44 rows.
- **Every temp-folder copy of the config** (`plant.ts`, the tests that copy `.oxlintrc.json`, and `replay.ts`) links
  `node_modules/@kalfa/quality` to the real package, or the copied config no longer loads.
- **CI's change map and vitest's triggers** treat `kalfa/quality/src/oxlint/` as lint code, as they treat
  `oxlint-plugins/`: a change there changes what every lint-reading test sees.
- **Two CI tools learn that a rule can move plugins** (next section).
- **The sweep.** One rewrite over the tracked files, `fabrika/<moved>` to `@kalfa/quality/<moved>` and
  `fabrika(<moved>)` to `@kalfa/quality(<moved>)`, for the eleven names only. It leaves `.kalfa/quests/*-PLAN.md`
  (records of what was planned then) and `*.fixture` files (bytes a test reads as they are). The tests step runs it on
  test files and exam paths, the build on the rest:

```sh
# A sketch. NAMES is the eleven names joined with |.
git grep -lzE "fabrika[/(]($NAMES)([^a-z-]|$)" -- . ':!.kalfa/quests' ':!*.fixture' \
  | xargs -0 perl -pi -e "s{fabrika([/(])($NAMES)(?![a-z-])}{\@kalfa/quality\$1\$2}g"
```

### Two CI tools that key on a rule's full code

Both are in `next/apps/fabrika/src/exam/`, an exam path, so the tests step owns them. They stay where they are: they
are this repo's CI, and no client of libfabrika would write them.

- **The ratchet** (`ratchet.ts`) refuses a ledger row the head holds beyond the base, keyed by file, rule and code.
  Renaming 44 rows from `fabrika(no-promises)` to `@kalfa/quality(no-promises)` reads as 44 added rows, and CI fails.
  The ratchet already treats a file git renamed as the same row. It now also keys a row by the rule's name without its
  plugin: `fabrika(no-promises)` and `@kalfa/quality(no-promises)` are one rule. #2244 moves `no-node-imports`, with
  18 more rows, so this is fixed once here, not worked around twice. 80% sure; the doubt is a row moving between two
  different rules that share a name in two plugins, which no ledger holds and which still could not grow the list.
- **The edge ask** (`edges.ts`) asks the owner about each edge comment the head has that the base lacks, keyed by
  path, rules as written and reason. The sweep rewrites 417 edge comments under `next/`, so each would ask once. It now
  knows an edge rule by its name without its plugin, and keys an edge on those names. A moved edge asks nothing; a new
  one asks as before. 80% sure; the doubt is that any plugin's `no-promises` now counts as an edge, which can only add
  asks, never hide one.

```ts
// A sketch, for both files. Nothing here was type-checked.
/** A rule's name without its plugin: `@kalfa/quality(no-promises)` and `fabrika/no-promises` are `no-promises`. */
const ruleName = (rule: string): string => /\(([^()]+)\)$/.exec(rule)?.[1] ?? rule.slice(rule.lastIndexOf("/") + 1);

// ratchet.ts
Arr.map(entries, (row) => JSON.stringify([renames.get(row.file) ?? row.file, ruleName(row.rule), row.code]));

// edges.ts
const EDGE_RULES: ReadonlySet<string> = new Set(["no-promises", "no-effect-run-outside-edge"]);
if (!Arr.some(rules, (rule) => EDGE_RULES.has(ruleName(rule)))) return [];
const matchKey = (edge: Edge) => JSON.stringify([edge.path, Arr.map(edge.names, ruleName), edge.reason]);
```

`Edge.rules` keeps the rules as written, so an ask still prints the new name.

### What stays

- **None of the eleven stays ours.** Each was read past its top comment. Only two held anything of ours: `no-hand-tag`
  its `EDGE` path, which becomes the option, and `no-promises` its message's "next/ is Effect all the way", which
  becomes "this code is Effect all the way". The rest held our paths and ticket numbers in messages only. 90% sure.
- **`oxlint-plugins/match.ts`** stays whole: the fifteen rules that stay, and the 26 that move later, still import it.
- **`edge-comment` stays ours** until #2244 moves it. Here it only learns the two new names.
- **Spans: none.** Oxlint calls a rule's `create` and its visitors as plain functions. No rule runs an Effect, so there
  is no step to trace, and no law is written for it.

## One value traced

A line `await p;` in `next/packages/libfabrika/src/runtime/Execution.ts`, under
`// oxlint-disable-next-line @kalfa/quality/no-promises -- edge: a Durable Object answers a Promise`, after the second
pull request.

1. `pnpm lint` runs `oxlint-plugins/lint.ts`, which runs oxlint with `.oxlintrc.json`. Its `jsPlugins` names
   `@kalfa/quality/oxlint`. Oxlint resolves it from the top of the repo: `node_modules/@kalfa/quality` is pnpm's link to
   `kalfa/quality`, whose `exports["./oxlint"]` is `src/oxlint/index.ts`. Node strips its types, since the real path is
   not under `node_modules`.
2. The plugin's `meta.name` is `@kalfa/quality`, so its rules are `@kalfa/quality/<rule>`. The `next/**` block turns
   `@kalfa/quality/no-promises` on.
3. The rule's `AwaitExpression` visitor reports the line. Its message ends with the disable line, built from
   `context.id`: `// oxlint-disable-next-line @kalfa/quality/no-promises -- edge: <why>`.
4. The disable comment names that rule, so oxlint drops the fire and counts the comment as used. `fabrika/edge-comment`
   finds `@kalfa/quality/no-promises` in its edge set, and the reason starts `edge: `, so it passes.
5. In CI, `edges.ts` reads the file at the base and at the head. The base's comment names `fabrika/no-promises`, the
   head's `@kalfa/quality/no-promises`. Both are edges by the name `no-promises`, and both key as
   `[path, ["no-promises"], "a Durable Object answers a Promise"]`. They match, so nothing asks.
6. A line in `.agents/` with no edge comment fires as `@kalfa/quality(no-promises)`. `lint.ts` finds the ledger row the
   sweep rewrote to that code and waives it. The ratchet keys the base row and the head row as
   `[file, "no-promises", code]`, so the list did not grow.

## Generators

- (a) Effect reached under another spelling: a renamed named import (`import { Effect as E } from "effect"`), a module
  namespace (`import * as E from "effect/Effect"`), the barrel as a namespace (`import * as X from "effect"`, then
  `X.Cause.squash`), and a member imported by its own name (`import { squash } from "effect/Cause"`). Each rule's law
  draws only the spellings that rule resolves today.
- (b) a look-alike that must pass: the same member on a local or another module (`const Cause = { squash }`,
  `other.promise()`, `Other.TaggedError("B")`), and `.catch` called on a name imported from Effect.
- (c) a firing form nested deeper: a `throw` inside an `if`, inside a nested arrow, inside the Effect body, at depth 0 to
  4.
- (d) a file the `allow` option lists, which passes.
- (e) a file that reaches the `allow` check and is not listed: it holds a hand-written `_tag`, so it passes every
  earlier check, and it ends like a listed file but sits in another folder (`other/ledger/Log.ts`).
- (f) an option the schema refuses: `allow` that is not a list, an item that is not a string, an item starting with
  `./` or `/`, and an unknown key (`alow`).
- (g) every run name the installed Effect exports: each `run*` export of `effect/Effect`, read at test time, and
  `runtimePromise` and `makeRuntimePromise` of `FiberSet`, `FiberMap` and `FiberHandle`, as a bare call, a member call
  and a runtime's method.
- (h) every Promise call the installed Effect exports: `Effect.promise`, `Effect.tryPromise`, each `*Promise` export of
  `Schema` and each `*AsyncIterable*` export of `Stream`, read at test time, under each spelling of (a).
- (i) one firing line of each of the eleven rules, read for its message.
- (j) ledger rows at the base and the head that differ only in the rule's plugin (`fabrika(x)` and
  `@kalfa/quality(x)`).
- (k) a head ledger row whose rule name or code the base lacks. It passes the plugin step, so it reaches the count, the
  ratchet's one guard.
- (l) edge comments at the base and the head that differ only in the rule's plugin.
- (m) a head edge comment, under the new name, whose file or reason the base lacks.

## Laws

Laws O1 to O15 are the first pull request's, M1 to M12 the second's. Each generated law runs 100 cases in memory on
every pull request. Each rule law runs in process through `RuleTester` with neutral file names (`src/a.ts`), the
rule's cases copied from today's tests and from `plants.test.ts`, never the repo's config.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| O1, `effect-functions` refuses a span wrapper returned by a named function (a direct `Effect.withSpan(...)`, one inside a `.pipe(...)` at any place, a curried one) and passes an inner span, a consumed `Stream.withSpan`, `Effect.fn` and unnamed callbacks, for each (a) spelling it resolves. 100 runs | test | fc.record: the wrapper form, its place in the pipe and an (a) spelling | (a) match the written name `Effect` only: the renamed import passes, red; read only the pipe's last argument: a span first in the pipe passes, red | kalfa/quality/src/oxlint/effect-functions.test.ts |
| O2, `no-cause-squash` reports exactly Effect's `squash`, through every (a) spelling and use form (a call, a reference, `?.`, a string-literal member, a destructured pattern, a named import), and never a (b) look-alike, a comment, a string or a type position. The copied law 2. 100 runs | test | fc.record: an (a) spelling or a (b) look-alike, and a use form | (b) resolve `Cause` by name, not by scope: a local `Cause` fires, red; drop the import-declaration visitor: `import { squash } from "effect/Cause"` passes, red | kalfa/quality/src/oxlint/no-cause-squash.test.ts |
| O3, `no-context-tag` and `no-data-taggederror` refuse their forms in value and type positions, and pass `Context.Service`, a (b) look-alike, a comment and a string | test | pinned: the two rules' lines in plants.test.ts and their type forms, copied | stop visiting `TSQualifiedName` in `banNames`: the type lines pass, red; drop the `isWritten` check: the planted `Data.TaggedError = f` fires, red | kalfa/quality/src/oxlint/no-context-tag.test.ts |
| O4, `no-effect-promise` refuses `Effect.promise` and every `Effect.tryPromise` that is not one plain object literal: an arrow, a name, a parenthesized object, no argument, two arguments | test | pinned: each call shape once | drop the `grouped` check: `Effect.tryPromise(({ try: f, catch: g }))` passes, red; take two arguments when the first is an object: red | kalfa/quality/src/oxlint/no-effect-promise.test.ts |
| O5, `no-effect-run-outside-edge` refuses every (g) name, and passes `NodeRuntime.runMain` and a line under its disable comment. 100 runs | test | fc.constantFrom: the (g) names read from the installed `effect`, by call form | (g) drop `runSyncExitWith` from the list: red; match member calls only: a bare `runFork(e)` passes, red | kalfa/quality/src/oxlint/no-effect-run-outside-edge.test.ts |
| O6, `no-hand-tag` refuses a hand-written `_tag` key, type member, class field and computed key (a literal, a template with no hole, a same-file constant), passes a read, a maker, the schema tools and a computed key it cannot read, and skips exactly the files its `allow` option lists. 100 runs | test | fc.record: the key form, and a file in (d) or (e) | (d) ignore the option: the listed file fires, red; (e) compare the path's last part only: `other/ledger/Log.ts` passes, red; skip the file's constants: `{ [TAG]: x }` passes, red | kalfa/quality/src/oxlint/no-hand-tag.test.ts |
| O7, `no-hand-tag`'s options: no option, `[]`, `{}`, `{ allow: [] }` and a list of paths are taken, and every (f) option fails the run before any file is read. 100 runs | test | fc.oneof: an (f) option or one of the five good forms | (f) drop `additionalProperties: false`: `{ alow: [...] }` is taken, red; drop the item pattern: `./x.ts` is taken, red | kalfa/quality/src/oxlint/no-hand-tag.test.ts |
| O8, `no-promises` refuses every Promise shape (`async`, `await`, `for await`, `new Promise`, `Promise.x(...)`, `.then`, `import()`, a `.catch` off a name not from Effect) and every (h) call, and passes a (b) look-alike. 100 runs | test | fc.constantFrom: the (h) calls read from the installed `effect`, by (a) spelling, with the copied shape lines | (h) drop `toAsyncIterableEffect` from the list: red; (b) refuse every `.catch`: `Effect.catch(...)` fires, red | kalfa/quality/src/oxlint/no-promises.test.ts |
| O9, `no-raw-try-catch` refuses a `try/catch` only in a file that imports Effect (the barrel, a subpath, a string-named specifier), and passes `try/finally` and a file with no Effect import | test | pinned: each import form once, with and without a catch | drop the import gate: a plain file's `try/catch` fires, red; report `try/catch/finally` too: red | kalfa/quality/src/oxlint/no-raw-try-catch.test.ts |
| O10, `no-throw-in-effect-gen` refuses a `throw` at any (c) depth inside `Effect.gen(...)`, `Effect.fn(...)` and `Effect.fn("name")(...)`, and passes one outside any Effect body. 100 runs | test | fc.record: a (c) depth and a body form | (c) look at the nearest call only: a `throw` inside a nested arrow passes, red; drop the curried form: `Effect.fn("n")(function* ...)` passes, red | kalfa/quality/src/oxlint/no-throw-in-effect-gen.test.ts |
| O11, `no-type-assertions` refuses `as any`, `as unknown as T` and `as never as T` with at most one pair of parentheses around the inner cast, and `<T>x`; it passes `as const`, one `as T` and `as (any)` | test | pinned: each form once | make `grouped(...) <= 1` into `=== 0`: `(x as unknown) as T` passes, red; drop the `TSTypeAssertion` visitor: red | kalfa/quality/src/oxlint/no-type-assertions.test.ts |
| O12, every message is neutral: for each (i) fire, the message holds no `fabrika`, no `#` followed by digits, no `ticket`, and none of `next/`, `packages/`, `apps/`, `.kalfa/`, `oxlint-plugins/`; and a message that shows a disable line names the rule as `context.id` gives it (`rule-to-test/<rule>` under RuleTester). 100 runs | test | fc.constantFrom: (i) the eleven firing lines | (i) write `@kalfa/quality/no-cause-squash` into its message by hand: red; put `(#2736)` back into `no-throw-in-effect-gen`'s message: red | kalfa/quality/src/oxlint/Tester.test-support.ts |
| O13, the entry point's type: `@kalfa/quality/oxlint`'s default export is a `Plugin`, and its `rules` keys are exactly the eleven names, each the type of its own file's export | type | type | drop `no-hand-tag` from `index.ts`: the key check fails, red; point `./oxlint` at `no-promises.ts`: the import is no `Plugin`, red | kalfa/quality/src/oxlint/index.types.test.ts |
| O14, the real oxlint loads the entry point by its package name: in a scoped temp folder with `node_modules/@kalfa/quality` linked to the package, a config naming `@kalfa/quality/oxlint` reports a planted `await` as `@kalfa/quality(no-promises)`; a disable naming `@kalfa/quality/no-promises` silences its line with no unused report; a config with a bad `no-hand-tag` option exits non-zero and names the rule | test | scenario: one oxlint 1.90 run per case on a three-line file | name the plugin `kalfa` in `index.ts`: the code reads `kalfa(no-promises)`, red; drop `no-hand-tag`'s `meta.schema`: the config with an option fails to load, red | kalfa/quality/src/oxlint/Plugin.integration.test.ts |
| O15, what `/oxlint` ships imports no kalfa package and no path into `oxlint-plugins/`, and keeps every entry of Q8 and the blocks before it | lint | lint | add `import * as Hidden from "@kalfa/diagnostics/Hidden"` to `no-promises.ts`: `pnpm lint` red; import `../../../../oxlint-plugins/match.ts` from `internal/Syntax.ts`: red; the same kalfa import in a test file of the folder stays green | .oxlintrc.json |
| M1, our config loads the package and reports its rules under `@kalfa/quality`: a planted `await` in a `next/` file fires as `@kalfa/quality(no-promises)`, and nothing fires as `fabrika(<moved rule>)` | test | scenario: one `plant.ts` run over M2's planted files | drop `@kalfa/quality/oxlint` from `jsPlugins`: the config does not load, red; drop the `node_modules/@kalfa/quality` link from `plant.ts`: red | oxlint-plugins/quality-rules.test.ts |
| M2, our settings scope each moved rule as before: for each of the eleven, one firing line at a path where today's config turns it on fires, and the same line at a path where it is off (a test file, today's version, a folder no block names) does not | test | pinned: one on-path and one off-path per rule, read from today's `.oxlintrc.json` blocks | drop `@kalfa/quality/no-promises` from the `next/**` block: red; leave `@kalfa/quality/effect-functions` on in kalfa's test block: red | oxlint-plugins/quality-rules.test.ts |
| M3, our settings give `no-hand-tag` its one allowed file: `next/packages/libfabrika/src/ledger/Log.ts` passes, and `next/packages/libfabrika/src/ledger/Other.ts` with the same line fires | test | scenario: the two files in one run | drop the option from the `next/**` block: `Log.ts` fires, red | oxlint-plugins/quality-rules.test.ts |
| M4, our plugin holds none of the eleven: `oxlint-plugins/index.ts`'s rule names and the package's are disjoint | test | pinned: both plugins' rule names | leave `no-promises` in our `index.ts`: red | oxlint-plugins/quality-rules.test.ts |
| M5, no disable comment names a moved rule under `fabrika`: oxlint reports such a comment as unused, and the line's fire comes back | lint | lint | put one `fabrika/no-promises` disable back on a line in `next/`: `pnpm lint` red | .oxlintrc.json |
| M6, the ratchet counts a ledger row whose rule moved plugins as the same row: for drawn bases, a head that differs only by (j) rows has not grown, and each (k) row is added. 100 runs | test | fc.record: base rows, then (j) copies under the other plugin and (k) extra rows | (j) key on the whole code: the moved rows count as added, red; (k) key on the rule name and drop the code: a new code passes, red | next/apps/fabrika/src/exam/ratchet.test.ts |
| M7, the edge ask counts an edge whose rule moved plugins as the same edge: for drawn bases, a head that differs only by (l) edges asks nothing, and each (m) edge asks once. 100 runs | test | fc.record: base edges, then (l) copies under the other plugin and (m) new edges | (l) key on the rules as written: every moved edge asks, red; (m) know only the `fabrika/` names: a new edge under `@kalfa/quality/no-promises` asks nothing, red | next/apps/fabrika/src/exam/edges.test.ts |
| M8, `edge-comment` holds a disable naming `@kalfa/quality/no-promises` or `@kalfa/quality/no-effect-run-outside-edge` to `-- edge: <why>`, at the existing law's own count (default runs) | test | fc.constantFrom: the two edge rules under their new names, in the existing law | keep the `fabrika/` names in `EDGE_RULES`: a bad edge comment under the new name passes, red | oxlint-plugins/edge-comment.test.ts |
| M9, `promise-types` skips a line under an edge comment with a new name, and prints its own finding as `@kalfa/quality(no-promises)`, at the existing law's own count (default runs) | test | fc.constantFrom: the two edge rules under their new names, in the existing law | keep the old names in its edge check: a line under a new-name edge is reported, red | oxlint-plugins/promise-types.test.ts |
| M10, advice reads its two moved rules under their new codes: a `no-effect-promise` fire in a folder a warn block names advises, and in a folder at zero it blocks | test | scenario: the existing advice laws with the new codes | keep `fabrika(no-effect-promise)` in `advice.ts`: the warn-folder fire blocks, red | oxlint-plugins/advice.test.ts |
| M11, a change under `kalfa/quality/src/oxlint/` counts as lint code: CI's change map runs the lint-reading tests for it, and `vitest.config.ts`'s `forceRerunTriggers` names it | test | pinned: one path in the folder and one beside it | drop the prefix from `changes.mjs`'s `lint`: red; drop the trigger line: red | .github/ci/changes.test.ts |
| M12, replay lays this version's rules over an old tree: its lint world links `node_modules/@kalfa/quality` to this checkout's package, and a change under `kalfa/quality/src/oxlint/` picks the oxlint check | test | scenario: replay's own world law | drop the link: the replayed config does not load, red; drop the prefix from the check's `matches`: red | .agents/skills/lead/scripts/replay.test.ts |

**Where they run.** O1 to O13 and M2 to M12 run on every pull request, M5 and O15 in `pnpm lint`, and O13 in the
lead's `pnpm typecheck` and CI. O14 starts the real oxlint binary on a temp folder, so it is
`Plugin.integration.test.ts`: the laptop refuses it by name, pull requests and the merge queue run none, and main's full
run does. No stand-in will do: its one job is to show that real oxlint loads the package by name and prints the code
the stand-in assumes. `RuleTester` is the stand-in for every rule law. The lead's proof run before the first pull
request merges runs `Plugin.integration.test.ts`. No law is host-only: a temp folder and an oxlint child process run
the same in CI.

The `oxlint-plugins/` laws (M1 to M4, M8 to M10) spawn oxlint as that folder's tests do today, through `plant.ts`.
The package's laws meet kalfa's test lint block (`fabrika/no-node-imports` and `fabrika/law-shape` are on there), so
`Plugin.integration.test.ts` reaches files and the child process through Effect's `FileSystem` and
`effect/process`, as `oxlint-plugins/plant.ts` does. Where a copied law trips a rule, the tests step fixes the law,
never the rule.

## Files

### Pull request 1: the package

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/quality/src/oxlint/index.ts | build | 45 | new: the plugin, `meta.name` and the eleven rules |
| kalfa/quality/src/oxlint/internal/Syntax.ts | build | 150 | new: the nine helpers the rules use, copied from `oxlint-plugins/match.ts` |
| kalfa/quality/src/oxlint/effect-functions.ts | build | 120 | new: copy, neutral comment |
| kalfa/quality/src/oxlint/no-cause-squash.ts | build | 115 | new: copy, neutral message naming `context.id` |
| kalfa/quality/src/oxlint/no-context-tag.ts | build | 25 | new: copy, neutral messages with the fix inline |
| kalfa/quality/src/oxlint/no-data-taggederror.ts | build | 20 | new: copy, neutral reason |
| kalfa/quality/src/oxlint/no-effect-promise.ts | build | 55 | new: copy, neutral messages |
| kalfa/quality/src/oxlint/no-effect-run-outside-edge.ts | build | 60 | new: copy, message naming `context.id` |
| kalfa/quality/src/oxlint/no-hand-tag.ts | build | 125 | new: copy, `allow` option with its `meta.schema` |
| kalfa/quality/src/oxlint/no-promises.ts | build | 105 | new: copy, neutral reason, message naming `context.id` |
| kalfa/quality/src/oxlint/no-raw-try-catch.ts | build | 50 | new: copy, neutral message |
| kalfa/quality/src/oxlint/no-throw-in-effect-gen.ts | build | 45 | new: copy, neutral message |
| kalfa/quality/src/oxlint/no-type-assertions.ts | build | 75 | new: copy |
| kalfa/quality/package.json | tests | 12 | `exports["./oxlint"]`; `oxlint` and `@oxlint/plugins` as optional peers and dev dependencies; the description names `/oxlint`. The tests step owns it, since its laws import `oxlint/plugins-dev` and it writes the lockfile |
| kalfa/quality/README.md | build | docs | the opening says three subpaths; a new `/oxlint` section: how a repo loads it, each rule in one line, `no-hand-tag`'s option, the edge disable shape, that the rules assume Effect v4, the four oxlint facts from the tryout, and a row per file |
| kalfa/quality/GLOSSARY.md | build | docs | Edge, under Lint (New names) |
| kalfa/quality/src/oxlint/effect-functions.test.ts kalfa/quality/src/oxlint/no-cause-squash.test.ts kalfa/quality/src/oxlint/no-context-tag.test.ts kalfa/quality/src/oxlint/no-effect-promise.test.ts kalfa/quality/src/oxlint/no-effect-run-outside-edge.test.ts kalfa/quality/src/oxlint/no-hand-tag.test.ts kalfa/quality/src/oxlint/no-promises.test.ts kalfa/quality/src/oxlint/no-raw-try-catch.test.ts kalfa/quality/src/oxlint/no-throw-in-effect-gen.test.ts kalfa/quality/src/oxlint/no-type-assertions.test.ts | tests | tests | new: O1 to O11 (`no-data-taggederror`'s lines sit in `no-context-tag.test.ts`, law O3) |
| kalfa/quality/src/oxlint/Tester.test-support.ts | tests | tests | new: one `RuleTester` wired to vitest, the eleven firing lines, and O12 |
| kalfa/quality/src/oxlint/index.types.test.ts | tests | tests | new: O13 |
| kalfa/quality/src/oxlint/Plugin.integration.test.ts | tests | tests | new: O14 |
| .oxlintrc.json | tests | tests | O15: one `no-restricted-imports` block for `kalfa/quality/src/oxlint/**`, test files left out, after V4 |
| pnpm-lock.yaml | tests | tests | the two new dev dependencies, written with one `pnpm install --offline` |

### Pull request 2: the switch

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| .oxlintrc.json | tests | tests | the package in `jsPlugins`; every `fabrika/<moved>` key and comment renamed in place; `no-hand-tag`'s `allow` in the `next/**` block; the five old tests' scope comments kept |
| package.json | tests | tests | `"@kalfa/quality": "workspace:*"` beside the other kalfa packages |
| pnpm-lock.yaml | tests | tests | the root's new link, with one `pnpm install --offline` |
| oxlint-plugins/index.ts | tests | tests | the eleven imports and keys out |
| oxlint-plugins/effect-functions.ts oxlint-plugins/no-cause-squash.ts oxlint-plugins/no-context-tag.ts oxlint-plugins/no-data-taggederror.ts oxlint-plugins/no-effect-promise.ts oxlint-plugins/no-effect-run-outside-edge.ts oxlint-plugins/no-hand-tag.ts oxlint-plugins/no-promises.ts oxlint-plugins/no-raw-try-catch.ts oxlint-plugins/no-throw-in-effect-gen.ts oxlint-plugins/no-type-assertions.ts | tests | tests | deleted with `git rm`: the package holds them |
| oxlint-plugins/effect-functions.test.ts oxlint-plugins/no-cause-squash.test.ts oxlint-plugins/no-effect-run-outside-edge.test.ts oxlint-plugins/no-hand-tag.test.ts oxlint-plugins/no-promises.test.ts | tests | tests | deleted: rule laws are O1 to O11, settings laws are M2 and M3 |
| oxlint-plugins/quality-rules.test.ts | tests | tests | new: M1 to M4 |
| oxlint-plugins/plants.test.ts | tests | tests | six `PLANTS` entries out; L1 and the `lint.ts` laws under the new codes; its copied config folder links the package |
| oxlint-plugins/edge-comment.ts oxlint-plugins/edge-comment.test.ts | tests | tests | the two edge rules' new names, M8 |
| oxlint-plugins/promise-types.ts oxlint-plugins/promise-types.test.ts | tests | tests | the two edge rules' new names and its printed code, M9 |
| oxlint-plugins/advice.ts oxlint-plugins/advice.test.ts | tests | tests | the two advice rules' new codes, M10; its copied config folders link the package |
| oxlint-plugins/plant.ts oxlint-plugins/one-rule.test-support.ts oxlint-plugins/one-rule.test.ts oxlint-plugins/one-store-hook.test.ts oxlint-plugins/program-package-layout.test.ts oxlint-plugins/prefer-schema-arbitrary.test.ts | tests | tests | each temp copy of the config links `node_modules/@kalfa/quality`; `oneRuleConfig` names the package's `index.ts` for an `@kalfa/quality/` rule |
| oxlint-plugins/ledger.test.ts oxlint-plugins/anti-slop.test.ts oxlint-plugins/no-stage-word.test.ts | tests | tests | new codes; `anti-slop.test.ts` draws a rule our plugin still has in place of `fabrika/no-promises` |
| oxlint-plugins/README.md | tests | tests | each moved rule's section keeps only what is about our repo (where our settings turn it on, counts measured here) and points to the package's README |
| agents-ledger.json | tests | tests | 44 rows to the new code |
| next/apps/fabrika/src/exam/ratchet.ts next/apps/fabrika/src/exam/ratchet.test.ts | tests | tests | `ruleName` in the lint key, M6 |
| next/apps/fabrika/src/exam/edges.ts next/apps/fabrika/src/exam/edges.test.ts | tests | tests | edge rules by name, keyed by name, M7 (`edges.test.ts` is new: the pure `asks` on maps) |
| next/apps/fabrika/src/exam/edge-config.test.ts next/apps/fabrika/src/exam/edges.integration.test.ts | tests | tests | the new names |
| .github/ci/changes.mjs .github/ci/changes.test.ts | tests | tests | `lint` also takes `kalfa/quality/src/oxlint/`, M11 |
| vitest.config.ts | tests | tests | `**/kalfa/quality/src/oxlint/**` in `forceRerunTriggers` |
| .agents/skills/lead/scripts/replay.test.ts | tests | tests | M12 |
| **/*.test.ts **/*.test.tsx **/*.test-support.ts **/*Test.ts | tests | tests | the sweep, over every test file that names a moved rule (about 130 files) |
| .agents/skills/lead/scripts/replay.ts | build | 6 | the oxlint check's `matches` and archive take `kalfa/quality/src/oxlint/`; the lint world links `node_modules/@kalfa/quality` to this checkout's package |
| next/packages/libfabrika/src/client/WindowMachine.ts next/packages/libfabrika/src/runtime/Runner.ts kalfa/cli/src/internal/packages.ts packages/pipeline/src/primitives.ts | build | 266 | the sweep over every other tracked file that names a moved rule: 56 files, about 266 lines, under `next/`, `kalfa/`, `packages/`, `programs/`, `.agents/` and `scripts/`; the four named are examples, and `git grep` lists the rest |
| AGENTS.md next/AGENTS.md | build | docs | the checks table's trigger row names `kalfa/quality/src/oxlint/**`; next/'s edge line names the new rule |
| .kalfa/patterns/effect-tests-run-in-it-effect.md .kalfa/patterns/effect-swallowed-failures-leave-a-trace.md .kalfa/patterns/effect-errors-keep-their-cause.md .kalfa/patterns/effect-platform-wrapped-once.md .kalfa/patterns/effect-pure-domain-returns-result.md .kalfa/patterns/effect-services-and-layers.md .kalfa/patterns/effect-crypto-through-services.md | build | docs | the sweep: patterns describe the code as it is now |
| .kalfa/quests/kalfa-quality-vitest-PLAN.md .github/ci/l11-source.fixture | tests | none | not changed, nor any other `.kalfa/quests/*-PLAN.md` or `*.fixture`: records and saved bytes |
| oxlint-plugins/match.ts oxlint-plugins/inner-cause.ts oxlint-plugins/lint.ts oxlint-plugins/no-sleep-on-test-clock.test.ts oxlint-plugins/one-machine-per-file.test.ts pnpm-workspace.yaml vendor/anti-slop/src/effect vendor/anti-slop/src/effect/ | tests | none | not changed: named above as sources or prior art; the catalog already holds `oxlint` and `@oxlint/plugins` 1.90.0 |
| next/apps/fabrika/src/exam/ oxlint-plugins/ | tests | none | folders, named in the text; only the files listed above in them change |
| kalfa/quality/GLOSSARY.md | build | none | not changed in this pull request |

**Beside other work in flight.** #2369 is above. #2243, #2244 and #2245 are blocked by this ticket and touch the same
files after it. The first pull request touches no file of #2235, which moves tests to `@kalfa/quality/vitest`. The
second renames disable comments in test files #2235 may also edit; whichever lands second reruns the sweep command on
its own diff, which is safe to run twice.

## Existing tools

- kalfa/quality/src/oxlint/index.ts: searched the repo (`oxlint-plugins/index.ts`) and `@oxlint/plugins` 1.90.0's
  types for a plugin shape; the plugin is the `Plugin` object oxlint documents, as ours is. No helper fits:
  `definePlugin` only adds a type, which `Plugin` gives already.
- kalfa/quality/src/oxlint/internal/Syntax.ts: searched for the helpers in the repo (`oxlint-plugins/match.ts` holds
  all nine), in `@oxlint/plugins` (its `Context` has `sourceCode`, `getScope` and token reads, but no dotted-name or
  import lookup) and on npm (`@typescript-eslint/utils` has `ASTUtils`, built for ESTree from typescript-estree, and
  would add a dependency and a second AST type to a package that must load fast). The copy is the way: lint refuses a
  path into `oxlint-plugins/` from the package (O15), and `match.ts` must stay for the rules that stay.
- kalfa/quality/src/oxlint/effect-functions.ts: searched as below; the copy of `oxlint-plugins/effect-functions.ts`.
- kalfa/quality/src/oxlint/no-cause-squash.ts: searched as below; the copy of its rule.
- kalfa/quality/src/oxlint/no-context-tag.ts: searched as below; the copy of its rule.
- kalfa/quality/src/oxlint/no-data-taggederror.ts: searched as below; the copy of its rule. oxlint's own
  `no-restricted-properties` covers only the value forms (our settings keep that entry beside it), not the type forms.
- kalfa/quality/src/oxlint/no-effect-promise.ts: searched as below; the copy of its rule.
- kalfa/quality/src/oxlint/no-effect-run-outside-edge.ts: searched as below; the copy of its rule.
- kalfa/quality/src/oxlint/no-hand-tag.ts: searched as below; the copy of its rule. The option's reader follows
  `oxlint-plugins/inner-cause.ts`'s `allowIn`, the one rule of ours that reads an option.
- kalfa/quality/src/oxlint/no-promises.ts: searched as below; the copy of its rule.
- kalfa/quality/src/oxlint/no-raw-try-catch.ts: searched as below; the copy of its rule.
- kalfa/quality/src/oxlint/no-throw-in-effect-gen.ts: searched as below; the copy of its rule.
- kalfa/quality/src/oxlint/no-type-assertions.ts: searched as below; the copy of its rule. oxlint's
  `typescript/no-explicit-any` covers `any` in a type, not `as unknown as T`, so it does not replace the rule.
- What was searched for the eleven: the repo, for each rule in `oxlint-plugins/`, the one source; oxlint 1.90.0's
  built-in rules (`oxlint --rules`), for one that catches as much (a trusted rule replaces ours where it catches as
  much); and the vendored anti-slop plugins (`vendor/anti-slop/src/effect/`), whose Effect rules are other checks. None
  replaces one of the eleven.
- `ruleName` in next/apps/fabrika/src/exam/ratchet.ts and next/apps/fabrika/src/exam/edges.ts: searched the repo for a
  reader of an oxlint code (`oxlint-plugins/advice.ts` and `ledger.ts` match codes whole; `no-bare-disable.ts` has a
  name pattern, not a split) and Effect's `String` module; none splits a code from its plugin. It is one line in each
  file; a shared module between two CI scripts is not worth the import.
- The temp-folder link in the config-copying tests: `fs.symlink` and `symlinkSync`, as each of those files already
  links `oxlint-plugins/`. No helper is written.
- `RuleTester` for the package's laws: `oxlint/plugins-dev`, already used by
  `oxlint-plugins/no-sleep-on-test-clock.test.ts`.

## Calls taken

- **All eleven move; none stays ours.** 90% sure. Read past each top comment; only two held a value of ours, and both
  become neutral (What stays).
- **`no-hand-tag`'s edge becomes `allow`, a list of exact paths from where oxlint runs.** 85% sure. The ticket asks
  for an option, the Elvis shape. `allow` is the name `inner-cause` already uses. Exact paths, not globs, keep "one edge"
  hard to widen; the schema refuses `./` and absolute paths, which could never match.
- **A message names its rule through `context.id`.** 90% sure. The tryout shows it follows an alias and `RuleTester`,
  so a message never names a plugin name the user did not write.
- **The `edge: <why>` shape stays in two messages.** 80% sure. It is advice in a message, not a check: the check is
  `edge-comment`, which moves to the package in #2244.
- **Helpers are copied into `internal/Syntax.ts`; `match.ts` stays.** 85% sure. `internal/` keeps them off the public
  entry point and out of the doc rule; the doubt is a second copy of nine helpers that a later ticket could fold.
- **`RuleTester` for the rule laws, one oxlint run for the loading law.** 90% sure.
- **`oxlint` and `@oxlint/plugins` are optional peers and dev dependencies.** 85% sure, by decision 0048 and the
  Stryker peers beside them.
- **The five old tests split: rule laws to the package, settings laws to `quality-rules.test.ts`.** 80% sure. Our
  settings are ours to test; the package must not read our config.
- **The ratchet and the edge ask key a rule by its name without its plugin.** 80% sure each (the doubts are under "Two
  CI tools").
- **`promise-types` prints its finding as `@kalfa/quality(no-promises)`.** 80% sure. It is the typed half of that
  rule, and the line's waiver names that rule.
- **Quest plans and fixtures keep the old names.** 90% sure. A plan records what was planned then, and a fixture is
  bytes a test reads.
- **#2369 is neither fixed nor waited for.** 85% sure (its own section).
- **Is this a setting?** `allow` is one, set in our `.oxlintrc.json`. The plugin's name is not: oxlint already lets a
  config rename it with an alias. The run names and Promise calls are not: they are Effect's API, and O5 and O8 pin
  them to the installed version. The messages are not: a setting that rewrites a message would hide what the rule
  means.

## Validation

- **Pull request 1, tests step:** `nice -n 15 pnpm exec vitest run` on the ten rule test files and
  `kalfa/quality/src/oxlint/index.types.test.ts`, red on the branch head since the rule files do not exist; it says so in
  its plant record. `pnpm lint` shows O15's plants red once the build's files exist.
- **Pull request 1, build step:** the same files green; each plant above run once and undone; `pnpm lint` green.
- **Pull request 1, lead:** one `pnpm typecheck` for O13; a proof run of `Plugin.integration.test.ts` before merge;
  `--changed` is refused, since `.oxlintrc.json` and a manifest changed, so the lead names the files above.
- **Pull request 2, tests step:** the config switch, the exam files and the test-file sweep. `pnpm lint` is then red on
  the build's files only: each old disable comment there is unused, and its line fires (fact 4 of the tryout). The
  tests step lists those files in its record. `nice -n 15 pnpm exec vitest run` on
  `oxlint-plugins/quality-rules.test.ts`, `oxlint-plugins/edge-comment.test.ts`,
  `oxlint-plugins/promise-types.test.ts`, `oxlint-plugins/advice.test.ts`, `oxlint-plugins/plants.test.ts`,
  `oxlint-plugins/ledger.test.ts`, `next/apps/fabrika/src/exam/ratchet.test.ts`,
  `next/apps/fabrika/src/exam/edges.test.ts`, `.github/ci/changes.test.ts` and
  `.agents/skills/lead/scripts/replay.test.ts`.
- **Pull request 2, build step:** the sweep on the rest, `replay.ts`, and the docs; `pnpm lint` green; the same test
  files green.
- **Pull request 2, lead:** `git grep -nE "fabrika[/(](<the eleven>)([^a-z-]|$)" -- . ':!.kalfa/quests' ':!*.fixture'`
  prints nothing. CI's `edges` step on the pull request asks nothing, and its `ratchet` step passes: that is M6 and M7
  on the real diff. One `pnpm typecheck`.

## Size

1. Pull request 1, the package: about 1,000 product lines (the eleven rules 795, `internal/Syntax.ts` 150,
   `index.ts` 45, `package.json` 12), nearly all copied, plus the README section, one glossary line, thirteen new test
   files and one lint block. It lands whole: any repo can load the entry point, and nothing of ours changes yet.
2. Pull request 2, the switch: about 270 product lines (the sweep over 56 product files, 266 lines, and `replay.ts`
   6), plus the tests step's side: the config, the deleted rules and tests, the scripts that name the rules, two CI
   tools, the ledger and about 130 test files of sweep. It lands whole: the rename and the switch must land together,
   or `pnpm lint` fails on every old disable comment.

About 4 agent hours across both rounds of tests, build and review, 75% sure. The doubt is the second pull request's
tests step, which touches the most files and may meet lint findings in the copied harness code. Basis: Opus steps at
about $8 each, as the vitest plan priced mostly copied code ($7) with the wide sweep on top: tests, build and review
for each pull request, plus one likely send-back each.

Estimate: 8 steps, $64

## New names

- **Edge**, a domain word for `kalfa/quality/GLOSSARY.md`, under Lint: "One line where the platform demands what a
  rule refuses, such as running an Effect or answering a Promise, marked where it stands by a disable comment that
  gives its reason." _Avoid_: exception, escape hatch, boundary. Two of the package's messages use it, and
  `edge-comment` joins them in #2244.
- **`allow`**, a rule option: ESLint's word for a rule's list of what it lets through (`no-console`'s `allow`), and
  already the name in `oxlint-plugins/inner-cause.ts`. Not a domain word.
- **Plugin**, **rule option**, **`meta.schema`**, **`context.id`**, **`RuleTester`**: oxlint's and ESLint's words,
  cited, not glossary words. The glossary's Tool entry avoids "plugin" for a tool the package drives; here it is only
  oxlint's name for what a repo loads.
- `quality-rules.test.ts`, `Tester.test-support.ts`, `Syntax.ts` and `ruleName` are file and code names for what they
  hold.

## Records

- **The package README's `/oxlint` section**, in the first pull request: how to load it, the rules, the option, and the
  four oxlint facts the tryout found.
- **The glossary line** for Edge.
- **`oxlint-plugins/README.md`**, trimmed in the second pull request, and the seven pattern docs and two maps renamed.
- No decision record: the protocol on issue 1763 and the owner's answers there are the decisions. If the owner's answer
  on the plugin's name is not the lean, the lead records it on the ticket and in the package README; it rises to a
  decision only if he says so, since a config alias can rename the plugin locally at any time.

## What fact is lost if it is not recorded now

What oxlint 1.90.0 does that its docs do not say plainly: a rule without `meta.schema` refuses every option and fails
the whole run, `context.id` follows a config alias and `RuleTester`, and a disable comment naming a removed rule fails
`pnpm lint`. The next three move tickets lean on all three. If they live only in this plan, each ticket's plan writer
runs the same tryout again. The package README keeps them.

## What this cannot tell us

- Whether the moved rules fire exactly where they did across the whole repo, until the second pull request's
  `pnpm lint` runs: the laws plant one path per rule, and the sweep's diff is the real check.
- Whether oxlint's JS plugin API, which is alpha, keeps `context.id` and `meta.schema` as they are in the next release.
  The catalog pins 1.90.0, and O14 fails if loading changes.
- Whether another repo can load the package from a registry. Node refuses to strip types under `node_modules`, so a
  published copy would need a build to JavaScript. That holds for every kalfa package today, which are private and
  ship `.ts`; here it only works through a workspace link.
- Whether the `edges` step's new key misses a real ask. M7 covers moved and new edges; a reworded reason on a moved
  line still asks, as before.

## Open questions

1. Plugin name: `@kalfa/quality` (lean, 70%), `kalfa`, or `quality`? Sets every code (`@kalfa/quality(no-promises)`) and
   all ~670 disable lines. Lean because it is the package a reader installs and ESLint's scoped-plugin norm
   (`@typescript-eslint/...`), and it leaves room if another kalfa package ever ships rules. Cost: 7 more characters
   than `fabrika/` on each disable line. `quality` would match Diagnostics' "a code starts with its subcommand's root
   name", but is a common word another plugin could also take.

## Findings

1. **Five of the moved rules never reach `kalfa/quality`, `kalfa/records` or `kalfa/secrets`.** The `.oxlintrc.json`
   block that turns `no-promises`, `no-effect-run-outside-edge`, `effect-functions`, `no-cause-squash` and
   `no-hand-tag` on for kalfa (near line 742) lists `kalfa/cli/src/**`, `kalfa/config/src/**`, `kalfa/config/*.ts`,
   `kalfa/diagnostics/src/**`, `kalfa/git/src/**`, `kalfa/github/src/**`, `kalfa/ledger/src/**`,
   `kalfa/markdown/src/**`, `kalfa/permissions/src/**` and `kalfa/transport/src/**`, and no other block sets those
   rules for the three packages left out. So their product code is held to none of the five. Not checked: whether it
   was left out on purpose, as the Stryker layer's real Promises might need. Worth one ticket that adds them with a
   count of what fires first. This plan keeps the scope as it is (M2).
