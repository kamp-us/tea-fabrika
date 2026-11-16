
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
// tsconfig.base.json, same diff: "outdatedApi": "error", "preferSchemaTaggedError": "error"
// deleted in the same diff: oxlint-plugins/no-data-taggederror.ts, no-context-tag.ts,
// no-node-filesystem.ts (+ test), one-id-module.ts (+ test), their plants and README rows
```

The plan has three parts. Pull request 1 swaps the four "go now" rules and adds the check on main
that 0573 asks for before `padding-line-between-statements` may go. It is planned in full. Two
rules wait for work outside this quest, and the plan names what must reach zero first. The rest of
0573's list is not in this quest: each is its own later pull request, as 0573's Consequences say.

## Doubts, first

- **The audit's premise for two of the four is only partly true.** A probe on 2026-11-15 (below)
  found that the Effect checker's `preferSchemaTaggedError` catches `class X extends
  Data.TaggedError(...)` but not a bare reference (`const r = Data.TaggedError`) or a call outside a
  class (`const C = Data.TaggedError("C")`). Ours catches both. And 73 tracked files that ours lints
  are in no type-checked project, so the checker and the type check never see them. Without more,
  deleting ours would leave a gap that 0573 forbids. The plan closes it with oxlint's own
  `no-restricted-properties` and `typescript/no-restricted-types`, set beside the checker. One
  type-only form is still missed there, and that is the one open question.
- **The two waiting swaps are far from zero.** The anti-slop pair for `no-hand-tag` fires 20 times
  where ours runs. `require-readable-spacing` fires 15,791 times in the scope and has no block yet.

## What was run for this plan

All on `origin/main` at `9186e6c49` (pull request 1373, the anti-slop install, merged), with
oxlint 1.90.0, `@effect/tsgo` 0.63.0, TypeScript's `tsc` from the lockfile, effect 4.1.3, and Node
26.13.0. No test, no `pnpm typecheck`. Scratch configs and probe files lived in the session's
scratchpad, outside the repo, and were never committed.

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
   ours catches through its `TSQualifiedName` visitor.
5. **The count of the four, now.** Ours: 0 fires, since `pnpm lint` is green on main, and 0
   disable lines naming any of the four (`rg` over the tree; the one hit is
   `.agents/skills/lead/scripts/chain.ts:113`, which names `fabrika/no-node-filesystem` beside
   `fabrika/no-node-imports`). Source sites: `rg` for `Data\.TaggedError`, `Context\.Tag\b`,
   `Context\.GenericTag` and `Effect\.Service\b` in `next/`, `.agents/`, `oxlint-plugins/`,
   `.github/ci/`, `scripts/` and the root `vitest.*.ts` finds 0 lines of code: two comments
   (`oxlint-plugins/modules.ts:42`, `match.ts:10`) and planted strings in tests. The checker:
   `preferSchemaTaggedError` is `error` in `tsconfig.base.json` since ticket 438, and `outdatedApi`
   is at its default `warning`, which fails `tsc` here; CI's `typecheck` is green on `9186e6c49`, so
   both are at 0 in every project.
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

## How others do it

- **ESLint and typescript-eslint** retire a rule by pointing at its replacement and removing it in
  one release (their `deprecated` and `replacedBy` rule meta). We have no users of our plugin, so we
  delete in one pull request. Read from memory of their docs, not fetched.
- **Effect's own repo** relies on its checker and the type check, with no lint rule for v3 forms.
  It has no untyped scripts, so it has no gap to fill. Its `tsconfig.base.json` was read for 0565 at
  `d5f8bdf4f`; not read again here.
- **This repo's own precedent** is the Reflect ban (0554): oxlint's `no-restricted-properties`, one
  entry set in every override that holds the rule, a plant that runs in every folder a block lists,
  and documented misses written as `false` plant lines. Pull request 1 copies that shape for the four
  Effect v3 names.

## The shape

### The four swaps

| Ours | Trusted rule that takes over | Where ours ran | Count now |
|---|---|---|---|
| `no-data-taggederror` | the checker's `preferSchemaTaggedError` (already `error`) in every typed file, and oxlint's `no-restricted-properties` on `Data.TaggedError` everywhere ours ran | root `rules` | 0 and 0 |
| `no-context-tag` | the type check and the checker's `outdatedApi`, named `error` in `tsconfig.base.json`; `no-restricted-properties` on `Context.Tag`, `Context.GenericTag`, `Effect.Service`; `typescript/no-restricted-types` on `Context.Tag`, `Context.GenericTag` | root `rules` | 0, 0 and 0 |
| `no-node-filesystem` | our `no-node-imports` (0573 names it) | `next/**` and `.agents/**` | 0 unwaived; 8 ledger lines already held by `no-node-imports` entries |
| `one-id-module` | our `modules`, rule 2 | root `rules`, one path | 0 |

### The config, as a sketch

The four entries go in the root `rules` and in each of the seven overrides that set
`no-restricted-properties` today, since an override replaces a rule's options. In the blocks at
`"warn"` (the `JSON.parse` advice folders), `lint.ts` already blocks every fire of the rule but
`JSON.parse` at any level (`advice.ts`), so the new entries block there too.

```jsonc
// .oxlintrc.json, a sketch. The same four objects are written out in every block that sets the rule.
"eslint/no-restricted-properties": ["error",
  { "object": "Data", "property": "TaggedError", "message": "Use Schema.TaggedErrorClass (0573, preferSchemaTaggedError)." },
  { "object": "Context", "property": "Tag", "message": "Effect v3 form. Use Context.Service (0573, outdatedApi)." },
  { "object": "Context", "property": "GenericTag", "message": "Effect v3 form. Use Context.Service (0573, outdatedApi)." },
  { "object": "Effect", "property": "Service", "message": "Effect v3 form. Use Context.Service (0573, outdatedApi)." }
],
"typescript/no-restricted-types": ["error", { "types": {
  "Context.Tag": "Effect v3 type. Use Context.Service (0573).",
  "Context.GenericTag": "Effect v3 type. Use Context.Service (0573)."
} }]
```

```jsonc
// tsconfig.base.json, inside diagnosticSeverity: a later default cannot switch it off (0573).
"outdatedApi": "error",
```

`modules` and `no-node-imports` need no change. Deleted: the four `fabrika/...` lines of
`.oxlintrc.json` (root lines for three, and `no-node-filesystem` in both the `next/**` block and its
`.agents/` copy, which `edge-comment.test.ts` keeps equal), the four rule files, their two test
files, their plant entries, their `index.ts` names, the `one-id-module.test.ts` row of
`vitest.shards.json`, the 8 ledger entries, and the name in `chain.ts:113`'s disable line.

## One value, traced

An agent writes `class Gone extends Data.TaggedError("Gone") {}` in a new script
`.agents/skills/lead/scripts/gone.ts`, which no tsconfig includes.

1. Before pull request 1: `fabrika(no-data-taggederror)` fires; the checker never runs on the file.
2. In pull request 1's diff: `fabrika/no-data-taggederror` is gone. The `.agents/**` Reflect block
   now carries the four Effect entries, and it is the last override for that file that sets the
   rule, so `eslint(no-restricted-properties)` fires at the `Data.TaggedError` member, line 1.
   `pnpm lint` exits 1.
3. The same line in `next/packages/libfabrika/src/ledger/Gone.ts`, a typed file, fires the same
   oxlint rule from the `next/` block that lists `ledger/**`, and `tsc` fails it again with
   `effect(preferSchemaTaggedError)`.
4. Written as `class Gone extends D2.TaggedError("Gone") {}` with `import { Data as D2 } from
   "effect"`: ours would have missed it. oxlint misses it too, and the checker catches it in the
   typed file. In the untyped script it is missed, as it was before.

## Laws

The lint rules and their config are the exam, so the tests step writes all of these and deletes
ours. Each law runs through the repository's own `.oxlintrc.json` or `tsconfig.base.json`.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1, the four Effect v3 names are refused by `no-restricted-properties` in every folder that any block setting the rule lists, at the root, and at one path under no block (a root `scripts/` path): `extends Data.TaggedError(...)`, a bare reference, a call, `const { TaggedError } = Data`, `Data["TaggedError"]`, `Data?.TaggedError`, `Context.Tag(...)`, `Context.GenericTag(...)`, `Effect.Service(...)` are refused; `Context.Service`, `Other.TaggedError`, a comment, a string and `typeof Data.TaggedError` pass; an alias (`const D = Data; D.TaggedError`) passes as a documented miss | test | scenario: the config read by `oxlint --print-config`, each glob of every override that sets the rule, as the Reflect law does | delete the `Data.TaggedError` entry from one block: that folder's lines are not refused, L1 red | oxlint-plugins/builtin-plants.ts (the `EFFECT_V3` plant), oxlint-plugins/plants.test.ts |
| L2, every override that sets `no-restricted-properties` carries the four Effect entries, and so do the root `rules`, so no later block drops them for a folder | test | scenario: every override in `--print-config` | add a new block that sets the rule with only `JSON.parse` for one folder: L2 red | oxlint-plugins/plants.test.ts |
| L3, `typescript/no-restricted-types` refuses `type U = Context.Tag<A, B>` and `Context.GenericTag` used as a type, in the root scope and in each block's folder, and passes `Context.Service` as a type; `interface I extends Context.Tag<A, B> {}` is a `false` line, the documented miss | test | scenario: the same plant harness, with the `TYPES_V3` plant | drop the rule from the root `rules`: L3 red | oxlint-plugins/builtin-plants.ts, oxlint-plugins/plants.test.ts |
| L4, the checker's two levels hold: `tsconfig.base.json` names `outdatedApi` and `preferSchemaTaggedError` as `error`, and no override in it, and no `@effect/language-service` block in any tsconfig of the 31 projects, sets either to a lower level for any path | type | scenario: every tsconfig that `git ls-files` lists, read as JSON with comments, as `namespace-imports.test.ts` law 6 reads its list | set `"outdatedApi": "warning"`, or add `{ "include": ["next/**/*.ts"], "options": { "diagnosticSeverity": { "preferSchemaTaggedError": "off" } } }`: L4 red | oxlint-plugins/effect-checks-held.test.ts (new) |
| L5, `no-node-imports` holds every form `no-node-filesystem` held: for each of the 8 module names and 10 import forms of the old test, at a product path, an `exam/` path and a `.d.ts` path, `no-node-imports` fires on each form's line; at `.test.ts`, `.test-support.ts` and `e2e/` paths it fires on none; an `// edge: <why>` on the source line passes | test | fc.constantFrom: the 8 modules, seed 119120, 8 runs, examples `node:fs`, `fs/promises`, `node:path`; RuleTester in process, then one oxlint run through the real config | add `fs` to a skip in `no-node-imports.ts`: L5 red | oxlint-plugins/no-node-imports.test.ts |
| L6, `modules` refuses the retired Id module: the old test's four generated bodies (empty, a string const, a number const, a forwarding `export *`) at `next/packages/libfabrika/src/data/id.ts` get `fabrika(modules)` at line 1; `src/Id.ts` and `transport/id.ts` get none | test | fc.string: with fc.integer, seed 119120, 10 runs, as `one-id-module.test.ts` drew them | add `"data"` to the `folders` list of the `modules` block: L6 red | oxlint-plugins/modules.test.ts |
| L7, ours is gone: `index.ts` names none of the four, and the config names none of them | lint | lint | leave `"fabrika/one-id-module": "error"` in `.oxlintrc.json` after the file is deleted: `pnpm lint` fails to start | `.oxlintrc.json` via `oxlint-plugins/lint.ts` |
| L8, the spacing superset, the check on main that 0573 asks for: every line that `padding-line-between-statements` reports, `anti-slop/require-readable-spacing` reports too. On the generated files of `padding-line-between-statements.test.ts` (imports, one-line and multi-line consts, schema-type pairs, overloads, class members) with their blank lines removed, and on a fixed sample of real `next/` and tooling files with their blank lines removed. One oxlint run with both rules on, from a config the test writes | test | scenario: the generated files of `padding-line-between-statements.test.ts` at seed 119120 and their run count, plus every 15th non-test `next/packages/**/src/**/*.ts` file of `git ls-files` | run with the spacing rule left out of the test's config: every line of ours is missed, L8 red | oxlint-plugins/padding-superset.test.ts (new) |

- If L8 is red when the tests step first runs it on real code, the tests step stops that law and
  reports the missed lines: by 0573, `padding-line-between-statements` then stays. The law is never
  committed red and never weakened to pass.
- No host-only law. Nothing needs launchd, the real app or the owner's Mac. The tests spawn oxlint,
  as `plants.test.ts` already does. L4 reads files only.
- No secret is near this work.

## What waits, and what must reach zero first

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
- **Then pull request 2** of this quest turns nothing on (the blocks already hold) and deletes
  `no-hand-tag.ts`, its plants in `next/apps/fabrika/src/exam/`, its entry in `plants.test.ts`'s
  list, its `.oxlintrc.json` lines (the `next/**` block, its `.agents/` copy, and three test
  overrides), its ledger entry and its README row. Its law: a check that both rules' blocks cover
  every folder of the `next/**` and `.agents/**` scope, with a plant that drops one folder.

### `padding-line-between-statements`, to `anti-slop/require-readable-spacing`

- **The check on main is L8,** in pull request 1.
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
- **It also waits for the 73 untyped files.** The checker never sees them, and ours runs at the
  root. Either they join a project at zero type errors (ticket 486; 68 errors in 11 files today), or
  a trusted rule that sees them takes the swap.

### Not in this quest

`service-id` goes with the `deterministicKeys` sweep, by 0575. `no-redacted-value`,
`no-secret-env`, `no-expect-in-if`, `no-wall-clock`, `no-clock-in-view`, `no-node-imports`,
`no-cause-squash` and `no-effect-run-outside-edge` are each their own later pull request, by
0573. The "stay" lists are left alone: no rule there is turned off, and nothing is listed to reach
zero (0524).

## Files

Pull request 1 only. Every file under `oxlint-plugins/` and the two configs are the exam's, so the
tests step writes and deletes them. The build writes the prose that names the rules.

| File | Owner | Product lines expected | What |
|---|---|---|---|
| .oxlintrc.json | tests | tests | drop the four `fabrika/...` lines and both `no-node-filesystem` lines; the four Effect entries in the root `rules` and in each of the seven blocks that set `no-restricted-properties`; `typescript/no-restricted-types` in the root `rules`. About 70 lines added, 5 removed |
| tsconfig.base.json | tests | tests | `"outdatedApi": "error"`, with a comment that names 0573 |
| oxlint-plugins/no-context-tag.ts oxlint-plugins/no-data-taggederror.ts oxlint-plugins/no-node-filesystem.ts oxlint-plugins/one-id-module.ts | tests | tests | deleted, 127 lines |
| oxlint-plugins/no-node-filesystem.test.ts oxlint-plugins/one-id-module.test.ts | tests | tests | deleted, 173 lines; their cases move into L5 and L6 |
| oxlint-plugins/index.ts | tests | tests | drop four imports and four names |
| oxlint-plugins/builtin-plants.ts | tests | tests | `EFFECT_V3` and `TYPES_V3` plants. About 50 lines |
| oxlint-plugins/plants.test.ts | tests | tests | drop the two plants and the two names in the "elsewhere" list and the header comment; L1, L2, L3 through the Reflect law's harness. About 60 lines |
| oxlint-plugins/no-node-imports.test.ts | tests | tests | drop the `noNodeFilesystem` cases; L5. About 70 lines |
| oxlint-plugins/modules.test.ts | tests | tests | L6. About 40 lines |
| oxlint-plugins/ledger.test.ts | tests | tests | line 109 expects `fabrika(no-node-imports)` on the planted script's source line |
| oxlint-plugins/effect-checks-held.test.ts | tests | tests | new: L4. About 60 lines |
| oxlint-plugins/padding-superset.test.ts | tests | tests | new: L8. About 110 lines |
| agents-ledger.json | tests | tests | the 8 `no-node-filesystem` entries pruned by a whole `pnpm lint` run, none added |
| vitest.shards.json | tests | tests | drop the `one-id-module.test.ts` row; add rows for the two new tests as `shard-rows.ts` asks |
| oxlint-plugins/README.md | tests | tests | drop the `one-id-module` and `no-node-filesystem` paragraphs and their mention in the `.agents/` paragraph; a section "Rules that gave way to trusted ones (0573)" with the table of the four swaps, the counts above and the documented misses; and a line on L8 under `padding-line-between-statements` |
| .agents/skills/lead/scripts/chain.ts | build | 1 | line 113's disable comment names only `fabrika/no-node-imports` |
| next/AGENTS.md | build | 1 | the row at line 40 names only `fabrika/no-node-imports` |
| .patterns/effect-services-and-layers.md | build | docs | lines 86 and 219 name the checker's `outdatedApi`, the type check and `no-restricted-properties` |
| .patterns/effect-errors-keep-their-cause.md | build | docs | line 142 names `preferSchemaTaggedError` and `no-restricted-properties` |
| oxlint-plugins/modules.ts oxlint-plugins/no-node-imports.ts oxlint-plugins/advice.ts oxlint-plugins/anti-slop.ts oxlint-plugins/lint.ts oxlint-plugins/no-hand-tag.ts | tests | tests | read for this plan, not changed; `no-hand-tag.ts` goes in pull request 2 |
| oxlint-plugins/ .github/ci .github/ci/ next/apps/fabrika/src/exam/ next/apps/fabrika/src/exam/commits-git.test-support.ts scripts/caps.test.ts scripts/effect-arbitrary.test.ts scripts/testhome.test.ts | tests | tests | named in this plan as folders of the scope or as counted files; pull request 1 changes no file in them beyond the rows above |

`docs/direction/effect-code-guidelines.md:499` names `fabrika/no-data-taggederror` in a lean that is
history, and stays as written.

## Calls taken

- **Pull request 1 holds the four together, and the L8 check. 85%.** The brief names one pull
  request; each swap is whole in itself, so a review can still read each one.
- **`no-restricted-properties` and `no-restricted-types` stand beside the checker. 85%.** 0573 says
  a trusted rule that adds something is turned on beside; here the checker alone catches less than
  ours. The cost is four entries written out in eight places, which L2 keeps equal.
- **They go in the root `rules`, so today's frozen paths keep the same cover. 80%.** Ours ran there;
  0573 does not cover today's app, so the plan changes nothing it would lose.
- **Ours' messages' pointers to `packages/fate-effect/...` are not carried over. 90%.** That folder
  is not in this repo; the new messages name the trusted rule and the fix.
- **`chain.ts`, `next/AGENTS.md` and the two pattern docs go to the build. 85%.** They are prose or
  lead tooling, not the exam.
- **None of this is a setting. 95%.** Each choice is a lint or checker level that holds code, not a
  value a person sets in `fabrika.toml` (0069).

## What this cannot tell us

- Whether the checker in 0.63.0 misses other forms than the ones probed. The probe tried eight.
- Whether L8 holds on every file of the tree. It is a sample and generated files, as 0573 asks:
  "a check on main shows it flags every line ours does".
- Whether a v3 form would really be written in one of the 73 untyped files. Nothing has in the
  history of `no-context-tag` (0 hits since #2736).

## Validation

The tests step runs
`nice -n 15 pnpm exec vitest run --maxWorkers=3 oxlint-plugins/plants.test.ts oxlint-plugins/no-node-imports.test.ts oxlint-plugins/modules.test.ts oxlint-plugins/ledger.test.ts oxlint-plugins/effect-checks-held.test.ts oxlint-plugins/padding-superset.test.ts`,
then `pnpm format` and `NODE_OPTIONS=--max-old-space-size=6144 pnpm lint`, whose whole run prunes
`agents-ledger.json`. Each law's plant is made once and seen red, then undone. The build runs
`pnpm lint` after its four edits. The lead runs the one `pnpm typecheck`, which shows
`outdatedApi` at `error` is still at 0, and CI the rest.

## Records

- **What is lost if it is not recorded now:** why each rule of ours went, and what its trusted rule
  misses. The README section and this plan keep the probe's table; no stored data or span changes.
- The pull request lists, per swap, hits met (0), fixed (0), disable lines changed (1, `chain.ts`),
  and ledger lines pruned (8).

## Size

1. The four swaps and L8, in one pull request: about 500 lines added and 400 removed, all exam
   paths but 2 lines of code and 3 lines of docs by the build, 5 product lines. About 2 agent hours.
2. `no-hand-tag`'s deletion, after 0562's cleanup reaches zero: 20 hits there first; the deletion
   itself about 150 lines removed and 40 added, 0 product lines.
3. `padding-line-between-statements`'s deletion, after the spacing sweeps: 15,791 blank lines by
   the fixer in those sweeps; the deletion itself about 350 lines removed, 0 product lines.
4. `no-implicit-effect-concurrency`'s deletion, after the `@effect/tsgo` 0.69.0 bump and the 73
   untyped files: not sized here; its own plan counts it, 0 product lines expected.

Confidence 80% on item 1's line count, 50% on items 2 and 3, which are guesses of the files those
deletions touch.

The budget is item 1's: tests, build, review, and one likely fix round with its recheck. Priced
from the anti-slop install plan's figures from `field/runs.jsonl` (tests median $1.14, build $1.24,
review $1.18) and ticket 971's lane (tests $8.41, review $2.70), taken from that plan, not
recounted.

Estimate: 5 steps, $16

## Open questions

- In the 73 files no project type-checks, one v3 form, `interface I extends Context.Tag<A, B> {}`, is caught by ours today and by nothing after the swap: accept it as a documented miss (lean, 75%), or keep `no-context-tag` until those files join a project (ticket 486)?

## Findings

```json
{"_tag":"finding","id":"2026-11-15-readme-no-hand-tag-edge-path","date":"2026-11-15","by":"plan","model":"claude-opus-5-5","rule":"doc_drift","location":{"path":"oxlint-plugins/README.md","line":381},"says":"In our tooling, the README's no-hand-tag row names its edge as next/packages/libfabrika/src/data/log.ts, but the rule's edge is next/packages/libfabrika/src/ledger/Log.ts, and data/ no longer exists.","proof":"oxlint-plugins/no-hand-tag.ts sets EDGE to \"next/packages/libfabrika/src/ledger/Log.ts\"; ls next/packages/libfabrika/src shows no data folder, at 9186e6c49.","cost":"A reader of the README looks for the edge in a file that is gone.","head":"9186e6c494325e87c703f7c7e1518b7cfdf46836","ticket":null,"pr":null}
```
