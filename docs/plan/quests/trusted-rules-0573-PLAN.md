Approved by the lead agent, builds 0573, 0575, 0524, 0168; body 7a6d649b42b4
Plancheck-Version: 3

# Plan: our lint rules give way to trusted ones (0573), in next/ and our tooling

This is `next/` and our tooling (`.agents/`, `oxlint-plugins/`, `.github/ci/`, the root `scripts/`).
Today's app is not changed. It is a named job of the sev0 the owner called on 2026-11-15. It builds
[0573](../../../.decisions/0573-trusted-lint-rule-replaces-ours.md), as amended by
[0575](../../../.decisions/0575-deterministic-keys-is-the-service-id-form.md), with
[0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md) and
[0168](../../../.decisions/0168-old-lint-breaks-are-fixed.md).

```jsonc
// The whole idea, as a sketch: one pull request turns the trusted rule on at zero where ours ran,
// and deletes ours, so no file is ever unguarded.
{ "rules": { "eslint/no-restricted-properties": ["error", { "object": "Data", "property": "TaggedError" }] } }
// deleted in the same diff: oxlint-plugins/no-data-taggederror.ts, no-node-filesystem.ts (+ test),
// one-id-module.ts (+ test), their plants and README rows. no-context-tag.ts stays (ticket 486).
```

The plan has three parts. Pull request 1 swaps three of 0573's four "go now" rules
(`no-data-taggederror`, `no-node-filesystem`, `one-id-module`) and adds the check on main that 0573
asks for before `padding-line-between-statements` may go. It is planned in full. Three rules wait for
work outside this quest, `no-context-tag` among them, and the plan names what must reach zero first.
The rest of 0573's list is not in this quest: each is its own later pull request, as 0573's
Consequences say.

Round 2 of this plan applies the merge session's send-back of 2026-11-16: `no-context-tag` waits for
ticket 486, the override count holds 0592's block and pull request 1494's, the order section says
who carries whose entries, and the `service-id` swap is placed outside this quest.

## Doubts, first

- **The audit's premise for `no-data-taggederror` is only partly true.** A probe on 2026-11-15
  (below) found that the Effect checker's `preferSchemaTaggedError` catches `class X extends
  Data.TaggedError(...)` but not a bare reference (`const r = Data.TaggedError`) or a call outside a
  class (`const C = Data.TaggedError("C")`). Ours catches both. And 73 tracked files that ours lints
  are in no type-checked project, so the checker and the type check never see them. Without more,
  deleting ours would leave a gap that 0573 forbids. The plan closes it with oxlint's own
  `no-restricted-properties`, set beside the checker.
- **The same 73 files keep `no-context-tag`.** One v3 form there,
  `interface I extends Context.Tag<A, B> {}`, is caught by ours and by no trusted rule. 0573 allows
  no gap, so ours stays until ticket 486 brings those files into a type-checked project (merge
  session, 2026-11-16). That is the same wait as `no-implicit-effect-concurrency`.
- **The three waiting swaps beside it are far from zero.** The anti-slop pair for `no-hand-tag`
  fires 20 times where ours runs. `require-readable-spacing` fires 15,791 times in the scope and has
  no block yet.
- **Four pull requests edit one option list.** 0592's libfabrika override, pull request 1494 and
  this plan's pull request 1 all set `no-restricted-properties`, and an override replaces a rule's
  options. "Order against other work" below says who carries what.

## What was run for this plan

All on `origin/main` at `9186e6c49` (pull request 1373, the anti-slop install, merged), with
oxlint 1.90.0, `@effect/tsgo` 0.63.0, TypeScript's `tsc` from the lockfile, effect 4.1.3, and Node
26.13.0. No test, no `pnpm typecheck`. Scratch configs and probe files lived in the session's
scratchpad, outside the repo, and were never committed. Round 2 read `origin/main` again at
`d3a444e` and pull request 1494 at `1e54b6e73`; it ran no new probe.

1. **Where ours ran.** Read from `.oxlintrc.json`: `no-context-tag`, `no-data-taggederror` and
   `one-id-module` are in the root `rules`, so they run on every file oxlint lints, today's frozen
   paths included. `no-node-filesystem` is in the `next/**` block and its `.agents/` copy.
2. **What the type check sees.** `tsc --listFilesOnly -p .` in each of the 31 packages that have a
   `typecheck` script, against `git ls-files` for `.ts`, `.tsx`, `.mts`, `.cts`, `.mjs`, `.js` and
   `.jsx` outside `fixtures/`. **73 files are in no project:** 66 under `.agents/` (58 in
   `skills/lead/scripts/`, 3 each in `mutation/` and `plan/`, 1 in `step-commit/`, and
   `.agents/vitest.config.ts`), and 7 at the root (`scripts/vitest.setup.ts`, `scripts/testhome.ts`,
   `scripts/testhome.test.ts`, `scripts/effect-arbitrary.test.ts`, `scripts/caps.test.ts`,
   `vitest.shards.test.ts`, `vitest.changed.test.ts`). `.agents/tsconfig.json` says why: those
   scripts "still hold type errors and join with ticket 486". A scratch project over the 73 found
   68 type errors in 11 files.
3. **What the checker catches.** A probe file in a scratch project that extends
   `tsconfig.base.json`, run with `effect-tsgo diagnostics --project` and with `tsc`:

   | Line | Ours | `preferSchemaTaggedError` / `outdatedApi` / type check |
   |---|---|---|
   | `class A extends Data.TaggedError("A")<{...}> {}` | fires | `preferSchemaTaggedError` |
   | `class B extends D2.TaggedError("B") {}`, `import { Data as D2 } from "effect"` | misses | `preferSchemaTaggedError` |
   | `const ref = Data.TaggedError;` | fires | misses |
   | `const made = Data.TaggedError("C");` | fires | misses |
   | `class S extends Context.Tag("S")<S, {}>() {}` | fires | type error (no `Tag` in v4); `outdatedApi` at the file's line 1 |
   | `Context.GenericTag<{}>("G")` | fires | type error; `outdatedApi` at line 1 |
   | `class T extends Effect.Service<T>()("T", ...) {}` | fires | `outdatedApi` on `Service` |
   | `type U = Context.Tag<string, string>` | fires | type error |

4. **What oxlint's own rules catch.** One scratch config with `eslint/no-restricted-properties`
   on `Data.TaggedError`, `Context.Tag`, `Context.GenericTag`, `Effect.Service`, and
   `typescript/no-restricted-types` on `Context.Tag` and `Context.GenericTag`. It fired on the
   `extends`, the bare reference, `const { TaggedError } = Data`, `Data["TaggedError"]`, all three
   v3 service forms, and `type U = Context.Tag<...>`. It did not fire on `Context.Service`, a
   comment or a string. **It missed `interface I extends Context.Tag<string, string> {}`**, which
   ours catches through its `TSQualifiedName` visitor. That miss is why `no-context-tag` waits.
5. **The count of the three, now.** Ours: 0 fires, since `pnpm lint` is green on main, and 0
   disable lines naming any of them (`rg` over the tree; the one hit is
   `.agents/skills/lead/scripts/chain.ts:113`, which names `fabrika/no-node-filesystem` beside
   `fabrika/no-node-imports`). Source sites: `rg` for `Data\.TaggedError` in `next/`, `.agents/`,
   `oxlint-plugins/`, `.github/ci/`, `scripts/` and the root `vitest.*.ts` finds 0 lines of code:
   one comment (`oxlint-plugins/match.ts:10`) and planted strings in tests. The checker:
   `preferSchemaTaggedError` is `error` in `tsconfig.base.json` since ticket 438, and CI's
   `typecheck` is green on `9186e6c49`, so it is at 0 in every project.
6. **`no-node-filesystem` against `no-node-imports`.** Read both. `no-node-imports` checks every
   builtin, so `fs`, `fs/promises`, `path`, `path/posix` and `path/win32` with or without `node:`;
   every import form ours checks plus `TSImportType` and `module.require`; the same `// edge:` rule
   on the source line; and it also runs on `exam/` paths and `.d.ts` files, which ours skips. No
   override turns it off where ours is on: both are set only at `.oxlintrc.json`'s `next/**` block
   and its `.agents/` copy. `agents-ledger.json` has 8 `no-node-filesystem` entries; each line also
   has a `no-node-imports` entry (the multi-line import in `drive.ts` has `} from "node:fs";`, where
   `no-node-imports` reports). So the 8 are pruned and no entry is added.
7. **`one-id-module` against `modules`.** `modules` (rule 2) refuses any file in a folder of
   libfabrika's `src/` that its config does not list, at line 1. `data` is not listed. The retired
   file does not exist on main, so both are at 0.
8. **The anti-slop pair against `no-hand-tag`.** One scratch oxlint run over the scope's four roots
   with `no-manual-tagged-construction` and `no-manual-tagged-type` on everywhere. Where ours runs
   (`next/**` and `.agents/**`, without `*.test.ts(x)`, the two shared law suites and `.agents/`
   tests): **20 lines**, 19 and 1. By folder: `ledger/Log.ts` 4 (lines 62, 102, 105, 114, ours' one
   edge), `next/apps/fabrika/src/exam/commits-git.test-support.ts` 5, libfabrika `node/` 4,
   `processes/` 2, `runtime/` 2, and `.agents/skills/lead/scripts/` 3 (`chain.ts:1345`,
   `codexexec.ts:125`, `:129`). Over the whole scope, tests included: 1,951 and 164.
9. **`require-readable-spacing` against `padding-line-between-statements`.** The same run with the
   spacing rule: 15,791 lines in the scope (3,864 outside test files). A probe for the superset:
   18 libfabrika source files (every 15th of `git ls-files`), blank lines stripped, both rules on
   in one run. Ours flagged 391 lines, theirs 652, and **0 lines that ours flagged and theirs did
   not**. The rule has a whitespace-only fix.
10. **Who sets `no-restricted-properties`.** Read from `.oxlintrc.json` on `d3a444e` with a script
    that lists each override's `files` and the rule's options: 7 overrides set it today, and the
    root `rules` do not. They are `apps/fabrika/e2e.ts` with `*-e2e.ts` (window size), `next/**/*`
    (`JSON.parse`), `next/packages/libfabrika/src/client/**` (`JSON.parse` and the two P18 retry
    entries), the two `JSON.parse` advice blocks at `"warn"` (one with the Reflect entries), the
    `.agents/**`, `.github/**`, `oxlint-plugins/**` Reflect block, and the `next/` Reflect block.
    Pull request 1494 (open, draft, `1e54b6e73`) adds `runtime/**` to one advice block and an 8th
    override for `next/packages/libfabrika/src/client/**` with the Reflect entries. Decision
    [0592](../../../.decisions/0592-libfabrika-writes-output-only-through-effects-console.md) adds a
    9th, for `next/packages/libfabrika/**`, with `process.stdout.write` and `process.stderr.write`;
    its build lands with the mock sweep's one pull request (0589) and is not on main yet.

## How others do it

- **ESLint and typescript-eslint** retire a rule by pointing at its replacement and removing it in
  one release (their `deprecated` and `replacedBy` rule meta). We have no users of our plugin, so we
  delete in one pull request. Read from memory of their docs, not fetched.
- **Effect's own repo** relies on its checker and the type check, with no lint rule for v3 forms.
  It has no untyped scripts, so it has no gap to fill. Its `tsconfig.base.json` was read for 0565 at
  `d5f8bdf4f`; not read again here.
- **This repo's own precedent** is the Reflect ban (0554): oxlint's `no-restricted-properties`, one
  entry set in every override that holds the rule, a plant that runs in every folder a block lists,
  and documented misses written as `false` plant lines. Pull request 1 copies that shape for
  `Data.TaggedError`.

## The shape

### The three swaps

| Ours | Trusted rule that takes over | Where ours ran | Count now |
|---|---|---|---|
| `no-data-taggederror` | the checker's `preferSchemaTaggedError` (already `error`) in every typed file, and oxlint's `no-restricted-properties` on `Data.TaggedError` everywhere ours ran | root `rules` | 0 and 0 |
| `no-node-filesystem` | our `no-node-imports` (0573 names it) | `next/**` and `.agents/**` | 0 unwaived; 8 ledger lines already held by `no-node-imports` entries |
| `one-id-module` | our `modules`, rule 2 | root `rules`, one path | 0 |

`no-context-tag` stays in the root `rules`, unchanged, until ticket 486 (below).

### The config, as a sketch

The entry goes in the root `rules` and in every override that sets `no-restricted-properties`
when pull request 1 lands, since an override replaces a rule's options. Today that is the 7 above;
with pull request 1494 it is 8, and with 0592's block 9. In the blocks at `"warn"` (the
`JSON.parse` advice folders), `lint.ts` already blocks every fire of the rule but `JSON.parse` at
any level (`advice.ts`), so the new entry blocks there too.

```jsonc
// .oxlintrc.json, a sketch. The same object is written out in the root rules and in every block
// that sets the rule, beside that block's own entries.
"eslint/no-restricted-properties": ["error",
  { "object": "Data", "property": "TaggedError",
    "message": "Use Schema.TaggedErrorClass (0573, preferSchemaTaggedError)." }
],
```

`modules`, `no-node-imports` and `tsconfig.base.json` need no change. Deleted: three `fabrika/...`
names of `.oxlintrc.json` (`no-data-taggederror` and `one-id-module` in the root, and
`no-node-filesystem` in both the `next/**` block and its `.agents/` copy, which
`edge-comment.test.ts` keeps equal), the three rule files, their two test files, the
`no-data-taggederror` plant entry, their `index.ts` names, the `one-id-module.test.ts` row of
`vitest.shards.json`, the 8 ledger entries, and the name in `chain.ts:113`'s disable line.

## One value, traced

An agent writes `class Gone extends Data.TaggedError("Gone") {}` in a new script
`.agents/skills/lead/scripts/gone.ts`, which no tsconfig includes.

1. Before pull request 1: `fabrika(no-data-taggederror)` fires; the checker never runs on the file.
2. In pull request 1's diff: `fabrika/no-data-taggederror` is gone. The `.agents/**` Reflect block
   now carries the `Data.TaggedError` entry, and it is the last override for that file that sets
   the rule, so `eslint(no-restricted-properties)` fires at the `Data.TaggedError` member, line 1.
   `pnpm lint` exits 1.
3. The same line in `next/packages/libfabrika/src/ledger/Gone.ts`, a typed file, fires the same
   oxlint rule from the last block that lists it (today the `ledger/**` advice block; once 0592
   lands, whichever of the libfabrika blocks comes last), and `tsc` fails it again with
   `effect(preferSchemaTaggedError)`.
4. Written as `class Gone extends D2.TaggedError("Gone") {}` with `import { Data as D2 } from
   "effect"`: ours would have missed it. oxlint misses it too, and the checker catches it in the
   typed file. In the untyped script it is missed, as it was before.
5. Written as `export class S extends Context.Tag("S")<S, {}>() {}` in either file:
   `fabrika(no-context-tag)` fires, as today, since that rule stays.

## Laws

The lint rules and their config are the exam, so the tests step writes all of these and deletes
ours. Each law runs through the repository's own `.oxlintrc.json` or `tsconfig.base.json`.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1, `Data.TaggedError` is refused by `no-restricted-properties` in every folder that any block setting the rule lists, at the root, and at one path under no block (a root `scripts/` path): `extends Data.TaggedError(...)`, a bare reference, a call, `const { TaggedError } = Data`, `Data["TaggedError"]` and `Data?.TaggedError` are refused; `Other.TaggedError`, a comment, a string and `typeof Data.TaggedError` pass; an alias (`const D = Data; D.TaggedError`) passes as a documented miss | test | scenario: the config read by `oxlint --print-config`, each glob of every override that sets the rule, as the Reflect law does | delete the `Data.TaggedError` entry from one block: that folder's lines are not refused, L1 red | oxlint-plugins/builtin-plants.ts (the `TAGGED_ERROR` plant), oxlint-plugins/plants.test.ts |
| L2, every override that sets `no-restricted-properties` carries the `Data.TaggedError` entry, and so do the root `rules`, so no later block drops it for a folder | test | scenario: every override in `--print-config` | add a new block that sets the rule with only `JSON.parse` for one folder: L2 red | oxlint-plugins/plants.test.ts |
| L3, the checker's level holds: `tsconfig.base.json` names `preferSchemaTaggedError` as `error`, and no override in it, and no `@effect/language-service` block in any tsconfig of the 31 projects, sets it to a lower level for any path | type | scenario: every tsconfig that `git ls-files` lists, read as JSON with comments, as `namespace-imports.test.ts` law 6 reads its list | set `"preferSchemaTaggedError": "warning"`, or add `{ "include": ["next/**/*.ts"], "options": { "diagnosticSeverity": { "preferSchemaTaggedError": "off" } } }`: L3 red | oxlint-plugins/effect-checks-held.test.ts (new) |
| L4, `no-node-imports` holds every form `no-node-filesystem` held: for each of the 8 module names and 10 import forms of the old test, at a product path, an `exam/` path and a `.d.ts` path, `no-node-imports` fires on each form's line; at `.test.ts`, `.test-support.ts` and `e2e/` paths it fires on none; an `// edge: <why>` on the source line passes | test | fc.constantFrom: the 8 modules, seed 119120, 8 runs, examples `node:fs`, `fs/promises`, `node:path`; RuleTester in process, then one oxlint run through the real config | add `fs` to a skip in `no-node-imports.ts`: L4 red | oxlint-plugins/no-node-imports.test.ts |
| L5, `modules` refuses the retired Id module: the old test's four generated bodies (empty, a string const, a number const, a forwarding `export *`) at `next/packages/libfabrika/src/data/id.ts` get `fabrika(modules)` at line 1; `src/Id.ts` and `transport/id.ts` get none | test | fc.string: with fc.integer, seed 119120, 10 runs, as `one-id-module.test.ts` drew them | add `"data"` to the `folders` list of the `modules` block: L5 red | oxlint-plugins/modules.test.ts |
| L6, ours is gone: `index.ts` names none of the three, and the config names none of them | lint | lint | leave `"fabrika/one-id-module": "error"` in `.oxlintrc.json` after the file is deleted: `pnpm lint` fails to start | `.oxlintrc.json` via `oxlint-plugins/lint.ts` |
| L7, the spacing superset, the check on main that 0573 asks for: every line that `padding-line-between-statements` reports, `anti-slop/require-readable-spacing` reports too. On the generated files of `padding-line-between-statements.test.ts` (imports, one-line and multi-line consts, schema-type pairs, overloads, class members) with their blank lines removed, and on a fixed sample of real `next/` and tooling files with their blank lines removed. One oxlint run with both rules on, from a config the test writes | test | scenario: the generated files of `padding-line-between-statements.test.ts` at seed 119120 and their run count, plus every 15th non-test `next/packages/**/src/**/*.ts` file of `git ls-files` | run with the spacing rule left out of the test's config: every line of ours is missed, L7 red | oxlint-plugins/padding-superset.test.ts (new) |

- `no-context-tag` keeps its own test and its plant in `plants.test.ts` unchanged; no law of this
  plan touches it.
- If L7 is red when the tests step first runs it on real code, the tests step stops that law and
  reports the missed lines: by 0573, `padding-line-between-statements` then stays. The law is never
  committed red and never weakened to pass.
- L2 is also the guard for the order below: a block that lands later without the entry turns it red.
- No host-only law. Nothing needs launchd, the real app or the owner's Mac. The tests spawn oxlint,
  as `plants.test.ts` already does. L3 reads files only.
- No secret is near this work.

## Order against other work

Three pieces of work edit the same `eslint/no-restricted-properties` option list in
`.oxlintrc.json`: 0592's libfabrika override (the mock sweep's one pull request), pull request 1494
(the Reflect ban in `runtime/` and `client/`), and this plan's pull request 1. An override replaces
the rule's options for its files, so an entry one of them adds is dropped wherever a later block
that lacks it matches.

- **Whichever lands later carries the others' entries** (merge session, 2026-11-16). If pull
  request 1 lands after 1494, it writes the `Data.TaggedError` entry into 1494's `client/**` block
  too. If it lands after 0592's block, it writes it there too. If either of those lands after pull
  request 1, that pull request copies the `Data.TaggedError` entry into its new block, and 0592's
  block also carries the `JSON.parse` and Reflect entries of the libfabrika folders it covers.
- **L2 makes a missed copy red** in CI on the pull request that lands later, so the rule does not
  rest on a reader's memory.
- Pull request 1 rebases on main at its build and recounts the blocks with the same read as item 10
  above; the number in its description is the count at that head.

## What waits, and what must reach zero first

### `no-context-tag`, to the type check, `outdatedApi` and oxlint's own rules

- **It waits for ticket 486,** which brings the 73 untyped files into a type-checked project
  (merge session, 2026-11-16, by 0573's "never a gap"). In those files the type check and the
  checker never run, and `interface I extends Context.Tag<A, B> {}` is caught by ours alone. It is
  the same wait as `no-implicit-effect-concurrency`.
- **What must reach zero first:** the 68 type errors in 11 of those files, so each joins a project
  at zero (0524).
- **Then its own pull request** names `outdatedApi` as `error` in `tsconfig.base.json`, which 0573
  ties to this swap; adds `Context.Tag`, `Context.GenericTag` and `Effect.Service` to the
  `no-restricted-properties` entries and `typescript/no-restricted-types` on `Context.Tag` and
  `Context.GenericTag`, if a probe then shows they add something beside the type check; and deletes
  `no-context-tag.ts`, its plant, its `index.ts` name and its root line. Its laws are this plan's
  L1 to L3 widened to those names, with the probe's `interface` line as a `true` line held by the
  type check. That plan counts it.

### `no-hand-tag`, to `anti-slop-effect/no-manual-tagged-construction` and `no-manual-tagged-type`

Anti-slop is on main since pull request 1373. Both rules hold only in the folders their blocks list:
10 and 15 folders. Ours runs in every folder of `next/` and `.agents/`, without tests.

- **What must reach zero first:** the 20 lines counted above, in 0562's cleanup, and both blocks
  must list every folder of ours' scope (in practice, the four whole-scope globs).
- **`ledger/Log.ts` is ours' one edge.** Its `Line` holds `_tag` as an open string (`_tag: Text`),
  and theirs has no file edge. The cleanup either changes the shape or keeps the four lines with a
  `// oxlint-disable-next-line anti-slop-effect/no-manual-tagged-type -- <why>` reason, as `AGENTS.md`
  allows for right code where the rule does not fit. That is 0562's cleanup's call, not this plan's.
- **`.agents/skills/lead/scripts/chain.ts:1345`** is waived for ours by `agents-ledger.json`; theirs
  has no ledger entry and none may be added (0524), so the cleanup fixes the line.
- **Then its pull request** turns nothing on (the blocks already hold) and deletes
  `no-hand-tag.ts`, its plants in `next/apps/fabrika/src/exam/`, its entry in `plants.test.ts`'s
  list, its `.oxlintrc.json` lines (the `next/**` block, its `.agents/` copy, and three test
  overrides), its ledger entry and its README row. Its law: a check that both rules' blocks cover
  every folder of the `next/**` and `.agents/**` scope, with a plant that drops one folder.

### `padding-line-between-statements`, to `anti-slop/require-readable-spacing`

- **The check on main is L7,** in pull request 1.
- **What must reach zero first:** the 15,791 lines, by the spacing sweeps of the anti-slop quest
  ([anti-slop-install-PLAN.md](./anti-slop-install-PLAN.md), "The sweeps"), until its block lists
  every folder of the scope. The fix is whitespace only.
- **Ours runs at the root, theirs only in the four scope globs.** At the swap, today's frozen paths
  (`apps/`, `programs/`, `packages/`, `bin/`) are held by 0525's frozen-path guard, which fails any
  change there. The live ones outside the scope, `packages/fabrika-design/**`, `scripts/` and the
  root `*.ts` files, must be listed in theirs' block or the swap waits. That pull request's own plan
  counts them.

### `no-implicit-effect-concurrency`, to the checker's `missingConcurrencyOption`

- The check is not in `@effect/tsgo` 0.63.0 (`node_modules/@effect/tsgo/schema.json` has no such
  key). It needs 0.69.0.
- **It waits for the bump's own pull request.** 0573 leaves the bump undecided and 0565 says the
  bump's pull request counts its hits: a bump can add checks and change defaults, and by 0565 every
  new check is on as an error, so the bump reruns every check in all 31 projects. This plan does not
  size it.
- **It also waits for the 73 untyped files,** as `no-context-tag` does. The checker never sees
  them, and ours runs at the root. Either they join a project at zero type errors (ticket 486), or a
  trusted rule that sees them takes the swap.

### Not in this quest

- **`service-id` and `deterministicKeys` are not in this quest's scope; they swap together in one
  pull request of the Effect checks sweep, its slice E55 (merge session, 2026-11-16).** 0575 says
  `service-id` is deleted "in the pull request that turns `deterministicKeys` on as an error where
  `service-id` ran, at zero hits", and rolls the check out "as 0565 says: one folder at a time ...
  with the level set in `overrides` of `tsconfig.base.json`", with a search for stored or sent IDs
  before any rename. That is the checker sweep's work, which owns `tsconfig.base.json`'s levels
  folder by folder (ticket 1075, branch `fabrikalfa/effect-e55`), and this job's brief named E55 for
  it and left the rest of 0573's lists alone. Doing it here would split one swap across two
  pull requests, which 0573 and 0575 forbid. 90%.
- `no-redacted-value`, `no-secret-env`, `no-expect-in-if`, `no-wall-clock`, `no-clock-in-view`,
  `no-node-imports`, `no-cause-squash` and `no-effect-run-outside-edge` are each their own later
  pull request, by 0573. The "stay" lists are left alone: no rule there is turned off, and nothing
  is listed to reach zero (0524).

## Files

Pull request 1 only. Every file under `oxlint-plugins/` and the two configs are the exam's, so the
tests step writes and deletes them. The build writes the prose that names the rules.

| File | Owner | Product lines expected | What |
|---|---|---|---|
| .oxlintrc.json | tests | tests | drop `fabrika/no-data-taggederror` and `fabrika/one-id-module` from the root and both `no-node-filesystem` lines; the `Data.TaggedError` entry in the root `rules` and in each block that sets `no-restricted-properties` at its head (7 today, 8 with 1494, 9 with 0592's). About 40 lines added, 4 removed |
| oxlint-plugins/no-data-taggederror.ts oxlint-plugins/no-node-filesystem.ts oxlint-plugins/one-id-module.ts | tests | tests | deleted, 97 lines |
| oxlint-plugins/no-node-filesystem.test.ts oxlint-plugins/one-id-module.test.ts | tests | tests | deleted, 173 lines; their cases move into L4 and L5 |
| oxlint-plugins/index.ts | tests | tests | drop three imports and three names |
| oxlint-plugins/builtin-plants.ts | tests | tests | the `TAGGED_ERROR` plant. About 25 lines |
| oxlint-plugins/plants.test.ts | tests | tests | drop the `no-data-taggederror` plant and its name in the "elsewhere" list and the header comment; L1 and L2 through the Reflect law's harness. About 45 lines |
| oxlint-plugins/no-node-imports.test.ts | tests | tests | drop the `noNodeFilesystem` cases; L4. About 70 lines |
| oxlint-plugins/modules.test.ts | tests | tests | L5. About 40 lines |
| oxlint-plugins/ledger.test.ts | tests | tests | line 109 expects `fabrika(no-node-imports)` on the planted script's source line |
| oxlint-plugins/effect-checks-held.test.ts | tests | tests | new: L3. About 50 lines |
| oxlint-plugins/padding-superset.test.ts | tests | tests | new: L7. About 110 lines |
| agents-ledger.json | tests | tests | the 8 `no-node-filesystem` entries pruned by a whole `pnpm lint` run, none added |
| vitest.shards.json | tests | tests | drop the `one-id-module.test.ts` row; add rows for the two new tests as `shard-rows.ts` asks |
| oxlint-plugins/README.md | tests | tests | drop the `one-id-module` and `no-node-filesystem` paragraphs and their mention in the `.agents/` paragraph, and the `no-data-taggederror` row; a section "Rules that gave way to trusted ones (0573)" with the table of the three swaps, the counts above and the documented misses, and one line that `no-context-tag` waits for ticket 486; and a line on L7 under `padding-line-between-statements` |
| .agents/skills/lead/scripts/chain.ts | build | 1 | line 113's disable comment names only `fabrika/no-node-imports` |
| next/AGENTS.md | build | 1 | the row at line 40 names only `fabrika/no-node-imports` |
| .patterns/effect-errors-keep-their-cause.md | build | docs | line 142 names `preferSchemaTaggedError` and `no-restricted-properties` |
| oxlint-plugins/modules.ts oxlint-plugins/no-node-imports.ts oxlint-plugins/advice.ts oxlint-plugins/anti-slop.ts oxlint-plugins/lint.ts oxlint-plugins/no-hand-tag.ts oxlint-plugins/no-context-tag.ts tsconfig.base.json | tests | tests | read for this plan, not changed; `no-context-tag.ts` waits for ticket 486 and `no-hand-tag.ts` for 0562's cleanup |
| oxlint-plugins/ oxlint-plugins/** oxlint-plugins/match.ts .github/ .github/** .github/ci .github/ci/ apps/fabrika/e2e.ts next/apps/fabrika/src/exam/ next/apps/fabrika/src/exam/commits-git.test-support.ts scripts/caps.test.ts scripts/effect-arbitrary.test.ts scripts/testhome.test.ts | tests | tests | named in this plan as folders of the scope or as counted files; pull request 1 changes no file in them beyond the rows above |

`docs/direction/effect-code-guidelines.md:499` names `fabrika/no-data-taggederror` in a lean that is
history, and stays as written. `.patterns/effect-services-and-layers.md` names `no-context-tag` at
lines 86 and 219, and stays: that rule stays.

## Calls taken

- **Pull request 1 holds the three together, and the L7 check. 85%.** The brief names one pull
  request; each swap is whole in itself, so a review can still read each one.
- **`no-restricted-properties` stands beside the checker for `Data.TaggedError`. 85%.** 0573 says a
  trusted rule that adds something is turned on beside; here the checker alone catches less than
  ours. The cost is one entry written out in every block that sets the rule, which L2 keeps equal.
- **It goes in the root `rules`, so today's frozen paths keep the same cover. 80%.** Ours ran there;
  0573 does not cover today's app, so the plan changes nothing it would lose.
- **`outdatedApi` is named `error` in `no-context-tag`'s own pull request, not in pull request 1.
  80%.** 0573 names it as part of that swap, "in the same pull request", and while `no-context-tag`
  stays it guards nothing ours does not. Its level today is `warning`, which already fails `tsc`.
- **The Context and `Effect.Service` entries of oxlint's rules wait with `no-context-tag`. 80%.**
  0573's "turned on beside" is for what a trusted rule adds; with ours staying at the root they add
  nothing, and they would be ten more entries for L2 to keep equal.
- **`service-id` with `deterministicKeys` is outside this quest, in E55. 90%.** The reason is in
  "Not in this quest" above.
- **Ours' messages' pointers to `packages/fate-effect/...` are not carried over. 90%.** That folder
  is not in this repo; the new message names the trusted rule and the fix.
- **`chain.ts`, `next/AGENTS.md` and the pattern doc go to the build. 85%.** They are prose or lead
  tooling, not the exam.
- **None of this is a setting. 95%.** Each choice is a lint or checker level that holds code, not a
  value a person sets in `fabrika.toml` (0069).

## What this cannot tell us

- Whether the checker in 0.63.0 misses other forms than the ones probed. The probe tried eight.
- Whether L7 holds on every file of the tree. It is a sample and generated files, as 0573 asks:
  "a check on main shows it flags every line ours does".
- Where 0592's block will sit in `.oxlintrc.json`, and so which block is last for a libfabrika file.
  Its plan is on `fabrikalfa/mock-plans`; L2 holds the entry wherever it sits.
- When ticket 486 lands, and so when `no-context-tag` can go.

## Validation

The tests step runs
`nice -n 15 pnpm exec vitest run --maxWorkers=3 oxlint-plugins/plants.test.ts oxlint-plugins/no-node-imports.test.ts oxlint-plugins/modules.test.ts oxlint-plugins/ledger.test.ts oxlint-plugins/effect-checks-held.test.ts oxlint-plugins/padding-superset.test.ts`,
then `pnpm format` and `NODE_OPTIONS=--max-old-space-size=6144 pnpm lint`, whose whole run prunes
`agents-ledger.json`. Each law's plant is made once and seen red, then undone. The build runs
`pnpm lint` after its three edits. The lead runs the one `pnpm typecheck` and CI the rest.

## Records

- **What is lost if it is not recorded now:** why each rule of ours went, what its trusted rule
  misses, and why `no-context-tag` stayed. The README section and this plan keep the probe's table;
  no stored data or span changes.
- The pull request lists, per swap, hits met (0), fixed (0), disable lines changed (1, `chain.ts`),
  ledger lines pruned (8), and the count of blocks that carry the `Data.TaggedError` entry at its
  head.

## Size

1. The three swaps and L7, in one pull request: about 380 lines added and 345 removed, all exam
   paths but 2 lines of code and 1 line of docs by the build, 3 product lines. About 2 agent hours.
2. `no-context-tag`'s deletion, after ticket 486 brings the 73 files in at zero: 68 type errors
   there first; the deletion itself about 60 lines removed and 80 added, 0 product lines.
3. `no-hand-tag`'s deletion, after 0562's cleanup reaches zero: 20 hits there first; the deletion
   itself about 150 lines removed and 40 added, 0 product lines.
4. `padding-line-between-statements`'s deletion, after the spacing sweeps: 15,791 blank lines by
   the fixer in those sweeps; the deletion itself about 350 lines removed, 0 product lines.
5. `no-implicit-effect-concurrency`'s deletion, after the `@effect/tsgo` 0.69.0 bump and the 73
   untyped files: not sized here; its own plan counts it, 0 product lines expected.

Confidence 80% on item 1's line count, 50% on items 2 to 4, which are guesses of the files those
deletions touch.

The budget is item 1's: tests, build, review, and one likely fix round with its recheck. Priced
from the anti-slop install plan's figures from `field/runs.jsonl` (tests median $1.14, build $1.24,
review $1.18) and ticket 971's lane (tests $8.41, review $2.70), taken from that plan, not
recounted. Item 1 is a little smaller than in round 1, but the price is set by the tests step's
runs of oxlint, which do not shrink, so the estimate stays.

Estimate: 5 steps, $16

## Open questions

None.

The one question of round 1 (keep `no-context-tag` or accept a documented miss) was closed by
the merge session on 2026-11-16: it stays until ticket 486.

## Findings

```json
{"_tag":"finding","id":"2026-11-15-readme-no-hand-tag-edge-path","date":"2026-11-15","by":"plan","model":"claude-opus-5-5","rule":"doc_drift","location":{"path":"oxlint-plugins/README.md","line":381},"says":"In our tooling, the README's no-hand-tag row names its edge as next/packages/libfabrika/src/data/log.ts, but the rule's edge is next/packages/libfabrika/src/ledger/Log.ts, and data/ no longer exists.","proof":"oxlint-plugins/no-hand-tag.ts sets EDGE to \"next/packages/libfabrika/src/ledger/Log.ts\"; ls next/packages/libfabrika/src shows no data folder, at 9186e6c49.","cost":"A reader of the README looks for the edge in a file that is gone.","head":"9186e6c494325e87c703f7c7e1518b7cfdf46836","ticket":null,"pr":null}
```
