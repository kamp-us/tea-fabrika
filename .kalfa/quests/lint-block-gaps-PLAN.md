Approved by the lead agent, builds tickets 2369 and 2380; body 6d6a097bfb3b
Plancheck-Version: 3

# Plan: lint blocks that drop import bans, and kalfa packages the Effect rules miss (tickets 2369 and 2380)

This is lint config and lint tooling: `.oxlintrc.json`, a new test in `oxlint-plugins/`, one change to its shared
config reader, and small fixes in three kalfa packages. It touches `next/` and today's frozen version (`apps/`,
`packages/`, `programs/`, `scripts/`) only through `.oxlintrc.json` blocks: the check judges every tracked file, as
the lead decided. The tickets are
https://github.com/kamp-us/tea-fabrika/issues/2369 and https://github.com/kamp-us/tea-fabrika/issues/2380, in one pull
request with one shared check.

```ts
// The whole idea, a sketch. Nothing here was type-checked.

// oxlint 1.90 gives a file the rule entry of the LAST block that names the rule, whole. Options never merge, and a
// block that writes only a severity ("error") drops every option an earlier block set (a tryout, below).

// oxlint-plugins/config-blocks.test.ts asks oxlint itself, once, whether every ban still holds:
//   for each set of blocks that reaches some file, plant one file at a real path with that set,
//   holding two imports per ban any of those blocks sets, a value one and a type-only twin
//   (`import { useState as p3 } from "react";`, `import type { useState as t3 } from "react";`),
//   lint it with the config's import-ban blocks alone (plant.ts, `only`), and read which lines fired.
//   A line that did not fire is a dropped ban, unless an exemption names it for that file.
//   The rule is read under all three names oxlint gives it: `eslint/no-restricted-imports`,
//   `typescript/no-restricted-imports` and the bare `no-restricted-imports`.
const EXEMPTIONS: ReadonlyArray<Exemption> = [
  {
    block: ["next/packages/libfabrika/src/settings/**", "kalfa/config/src/**", "next/packages/libfabrika/src/node/settings/**"],
    imports: "all",
    bans: ["**/settings/TomlParser.ts", "**/settings/TomlParser" /* ...the other four of that group */],
    reason: "the settings module and its Node loader take the TOML adapter",
  },
  // ...ten more, each the block's own comment in words; three of them `imports: "type"`
];

// .oxlintrc.json, the kalfa product block: a glob, so a new package cannot be left out.
"files": ["kalfa/*/src/**", "kalfa/config/*.ts"],
```

## Calls under 80%, read these first

None now. The one doubt of the first draft, how far the check reaches, was the lead's to decide, and the lead decided
it: every tracked file, today's frozen version included. This revision takes an independent review's changes: the
rule's other two names, type-only imports, globs that reach no file, the glob forms the check cannot read, a strict
ban reader, and the order with https://github.com/kamp-us/tea-fabrika/pull/2379.

## How oxlint merges a block's options: the tryout

Run on oxlint 1.90.0 (`pnpm-lock.yaml`), in a scratch folder, with `eslint/no-restricted-imports` and
`eslint/id-denylist`:

- Block 1 bans `**/one.ts` for `**/*.ts`; block 2 bans `**/two.ts` for `a/**`. In `a/x.ts`, only `./two.ts` is refused.
  The later entry replaces the earlier one whole: arrays are not joined.
- Block 2 written as `"eslint/no-restricted-imports": "error"` or `"warn"`, with no options: nothing is refused in
  `b/x.ts`. The same for `eslint/id-denylist` (`["error", "where"]`, then `"error"`: `where` passes). This differs
  from ESLint, which keeps the options when a later config gives only a severity.
- A block whose `excludeFiles` leaves a file out does not touch it: the earlier entry stays.
- `typescript/no-restricted-imports` and the bare `no-restricted-imports` are the same rule as
  `eslint/no-restricted-imports`: set in a later block under any of the three names, the later entry replaces the
  earlier one. So the bans cannot be split across names, and a check that reads one name misses a block written under
  another (the review's tryout `t2369r-e2`).
- An entry with `allowTypeImports: true` refuses `import { x }` and lets `import type { x }` through. A later block
  that adds it to a ban drops the type-only half (the review's tryout `t2369r-e1`).
- Oxlint reads a glob with no `/` as reaching any depth: `excludeFiles: ["*.test.ts"]` leaves out `a/b/x.test.ts`.
  It also reads a leading `./`. `node:path`'s `matchesGlob`, which the check uses to know which blocks reach a file,
  reads neither so (the review's tryout `t2369r-e3`). No block naming the rule uses either form today.
- Ticket 2369's proof, on main's own config: a scratch `kalfa/quality/src/vitest/t2369-Probe.test.ts` that imports
  `./exam/plant.ts` and `react`'s `useState` passes; the same file in `kalfa/config/src/` is refused twice.

## Is ticket 2380's gap on purpose? No, 90% sure

`git blame` on the kalfa product block (`.oxlintrc.json` near line 742) shows it was made for `kalfa/config` by
https://github.com/kamp-us/tea-fabrika/pull/1583 on 2026-11-18, and each later package added its own line.

- `@kalfa/quality` (https://github.com/kamp-us/tea-fabrika/pull/1603, the same day) was planned in
  `.kalfa/quests/kalfa-quality-stryker-PLAN.md`, which says "on main no `next/` override covers `kalfa/**`, so Q8 and
  Q15 need their own". It was written before the kalfa block existed, and nothing says to stay out of it.
- `@kalfa/records` (https://github.com/kamp-us/tea-fabrika/pull/1634, the same day): its plan,
  `.kalfa/quests/rules-and-records-build-PLAN.md`, says nothing about the block.
- `@kalfa/secrets` (https://github.com/kamp-us/tea-fabrika/pull/2058): `.kalfa/quests/kalfa-secrets-sign-PLAN.md`'s
  Lint section says "Slice 1 adds `kalfa/secrets/src/**` to the kalfa Effect block". The build added the package's
  own override and missed the block.
- A fourth package the ticket does not name, `@kalfa/ci` (https://github.com/kamp-us/tea-fabrika/pull/1666, two
  product files), is missing too.

The doubt is Stryker's real Promises in `@kalfa/quality`. They were already marked as edges in comments ("Edge (a
Promise API, marked as `next/` marks one)"), which is the shape `fabrika/edge-comment` holds. So the code was written
to the rules, and only the config missed it.

**What fires once the four packages are in.** A real `pnpm lint` in a scratch worktree of main, with `kalfa/ci`,
`kalfa/quality`, `kalfa/records` and `kalfa/secrets` added to the block: 41 s, 22 of 23 parts pass, and oxlint reports
17 blocking findings. No import ban fires.

| Rule | Count | Where | Fix |
|---|---|---|---|
| `fabrika/no-promises` | 5 | `kalfa/quality/src/stryker/node/MutantsStryker.ts` lines 38, 43, 45; `kalfa/quality/src/cli.ts` line 55 (two on one line) | each existing "Edge (...)" comment becomes `// oxlint-disable-next-line fabrika/no-promises -- edge: <its reason>`, one per firing line |
| `fabrika/no-of` | 10 | `targetOf` (stryker/Report.ts), `packageOf` (stryker/Run.ts), `offsetOf` and `spansOf` (stryker/Target.ts), `positionOf` (stryker/Built.test-support.ts), `textOf` and `slugOf` (records/Records.test-support.ts), `linesOf` (records/MapSize.ts), `fieldsOf` (secrets/Secrets.test-support.ts), `environmentOf` (secrets/Fetch.test-support.ts) | a verb or a plain noun; `slugOf` is also called in `kalfa/records/src/Runbooks.test.ts` and `fieldsOf` in `kalfa/secrets/src/Errors.test.ts` |
| `fabrika/no-hand-tag` | 2 | `PlatformError.systemError({ _tag: "NotFound", ... })` in `kalfa/quality/src/stryker/MemoryFiles.test-support.ts` line 8 and `kalfa/records/src/Records.test-support.ts` line 28 | the disable line `next/packages/libfabrika/src/node/client/MemoryFiles.test-support.ts` already uses: "Effect's PlatformError takes its system error tag as `_tag`" |

`no-of` is not one of the ticket's five rules: the four packages miss every rule of the block, not only five.

## What else the check finds on main today

Run as a prototype over main (a scratch script, `t2369-probe.mjs`, value imports only, 48 ms of oxlint for 1,190
planted imports in 41 sets of blocks), the check reports 32 dropped bans in `next/`, `kalfa/`, `.agents/`,
`oxlint-plugins/` and `.github/ci/`, and 3 more in today's version. After 2380's change it reports 38 in the first
folders: the four `kalfa/quality` blocks (Q8, Q15, V3, V4) and two `kalfa/secrets` blocks now drop the kalfa block's
bans for product files. Sorted:

- **Exemptions, on purpose (8 blocks, value and type).** Each block's comment says it lets the import in:
  - the TOML parser group, in the start files of `next/apps` (the T664 block near line 1667);
  - the same group, in the settings module, its Node loader and `kalfa/config/src/**` (the T664 block near line 1909);
  - `@decimalturn/toml-patch` and `toml-eslint-parser`, in the TOML format file `kalfa/config/src/internal/toml.ts`
    (near line 1982; its other glob, `next/packages/libfabrika/src/settings/TomlParser.ts`, names a file that moved,
    and goes);
  - `**/oxlint-plugins/plant(.ts)`, in the reader-list tests (the two CI-paths law 20 blocks near lines 4889 and
    4963);
  - the Alchemy and own-folder patterns, in `kalfa/transport/src/cloudflare/**` (near line 6732);
  - in today's version, `_electron` in `apps/fabrika/test-window.ts` (near line 2229, ticket 733) and Radix in
    `packages/fabrika-design/src/build/**` (near line 565, the token build).
- **Type-only exemptions, on purpose (3 blocks).** The prototype planted value imports only, so these come from the
  review: `next/packages/libfabrika/src/cloudflare/objects.ts` (near line 2158, `"**"` with `allowTypeImports`: type
  imports erase at build time), and the `@octokit/openapi-types` group in `kalfa/github/src/**` (near line 5693) and in
  `kalfa/github/src/Settings.ts` (near line 5912): the package has no JavaScript, so its types come in by `import
  type`. Each exemption lists the type-only bans B1 reports there.
- **Ticket 2369.** `kalfa/quality`'s 15 test files lose the kalfa test block's bans to Q8: the TOML writer and parser,
  `useState`, the plant helper and the TOML parser group.
- **Every per-package kalfa block** (diagnostics, git twice, ledger twice, markdown, github twice, transport four
  times, permissions, and after 2380 quality four times and secrets twice: 19 blocks) says "this repeats the base
  entries". It repeats the root `rules` entries and drops the kalfa block's own: the TOML writer and parser, `useState`,
  the plant helper, the TOML parser group's relative paths.
- **`kalfa/config`'s three blocks** near lines 5394, 5479 and 5561 drop `**/oxlint-plugins/plant`, and the last also
  `useState`.
- **Five `next/` blocks** drop `react`'s `useState` (the libfabrika layer block near 2029, inbox's `program.ts` near
  2397, `desktop/**` near 2567, `desktop/PersonCheck.ts` near 2686, `schedules/**` near 2798), and the layer block also
  the two `_electron` bans, `schedules/**` also the TOML writer.
- **One block of today's version,** `scripts/vitest.setup.ts` and `scripts/testhome.ts` (near line 448), drops the
  root entry's Radix bans. It is not on purpose: its comment is about home folders.

**Globs that reach no file.** Of the `files` and `excludeFiles` globs of blocks that name the rule, these reach no
tracked file today:

| Glob | Block | What happens |
|---|---|---|
| `next/packages/libfabrika/src/settings/TomlParser.ts` | the TOML adapter block, near 1982 | goes: the adapter moved to `kalfa/config` |
| `next/programs/inbox/src/**/tile.ts` | inbox's block, near 2397 | goes: inbox has no tile file |
| `kalfa/config/src/Starts.ts`, `kalfa/config/src/RecordedStart.ts` | the service-contract block, near 2493 | go: both live only in `next/packages/libfabrika/src/settings/` |
| `kalfa/ledger/src/LedgerTest.ts` | its own block near 4761, and the ledger block's `excludeFiles` near 4474 | stays, with a reason: slice 2 of https://github.com/kamp-us/tea-fabrika/issues/2082 (open) adds the file |
| `kalfa/**/*.test.tsx`, `kalfa/quality/**/*.test.tsx` | the kalfa blocks near 742 and 841, V3, diagnostics, and the new `kalfa/quality` test block | stays, with a reason: a React test in a kalfa package is still to come, and it must meet the same rules |

**The kalfa blocks ban a file that no longer exists.** The kalfa product and test blocks ban `**/exam/plant.ts`. The
exam's plant helper moved to `oxlint-plugins/plant.ts` in https://github.com/kamp-us/tea-fabrika/pull/1504, the same
day the kalfa block was made, and `next/`'s blocks ban `**/oxlint-plugins/plant` instead. This plan swaps the dead path
for the live one in the four kalfa blocks that hold it, so the repeats carry a live ban. No kalfa file imports either.

## How others do it

- **ESLint (flat config).** Later config objects override earlier ones rule by rule; a later entry with options
  replaces the earlier options, and one with only a severity keeps them. Since the config is JavaScript, shared ban
  lists are constants spread into each object. ESLint's `--print-config <file>` shows the config one file ends with.
  Read from memory; not fetched. Oxlint 1.90's `--print-config` takes no file (`oxlint --help`), so it cannot answer
  "what does this file end with".
- **elm-review (Elm).** A rule's exceptions are written next to the rule, per file:
  `Rule.ignoreErrorsForFiles [ "src/Log.elm" ]`. This plan's exemptions are that shape, as data the check reads.
  Read from memory; not fetched.
- **Elvis (Erlang).** Each rule takes an `ignore` list of modules in `elvis.config`. Read from memory; not fetched.
- **This repo.** `oxlint-plugins/test-helpers/effect-config.ts` folds the Effect checker's overrides file by file to
  answer the level a file ends with, and `oxlint-plugins/plant.ts` lints planted files with one rule's blocks of the real
  config. The check uses `plant.ts` as it is, and folds only to know which blocks reach a file.

The plain way, from ESLint, is to stop writing the same bans by hand. Oxlint can read a JS or TS config, but its
`--help` calls that experimental, and 71 files in the repo name `.oxlintrc.json`, many of them tests that copy it. So this plan keeps the repo's
written convention ("an override replaces a rule's options, so this repeats the base entries") and adds the check that
catches a missed repeat. The generated config is a ticket (Findings).

## The shape

The two laws that read the config both need the same answer first: which blocks reach a file. So the test reads the
blocks once, under every name of the rule, refuses the glob forms it cannot read the way oxlint does, and then asks
oxlint about bans and checks reach.

```ts
// oxlint-plugins/config-blocks.test.ts, a sketch. Plain functions and data: no Effect service, no IO but the files
// read and plant.ts's one oxlint run.

/** One block of `.oxlintrc.json` that sets `eslint/no-restricted-imports`: the root `rules` is a block for every file. */
type Block = {
  readonly files: ReadonlyArray<string>;
  readonly excludeFiles: ReadonlyArray<string>;
  readonly entry: unknown; // the rule's value as the block writes it: "error", or ["error", { paths, patterns }]
};

/** One ban: a `paths` name or a `patterns` glob, with `#name` when the entry lists `importNames`. */
type Ban = {
  readonly key: string; // "react#useState", "**/oxlint-plugins/plant.ts"
  readonly specifier: string; // what the planted import names: "react", "x/oxlint-plugins/plant.ts"
  readonly name: string | null; // "useState": the import is `import { useState as pN } from ...`
  readonly types: boolean; // false when the entry has `allowTypeImports: true`: it sets no type-only half
};

/** A ban a later block lets go on purpose, for every file that block reaches: both halves, or the type-only half. */
type Exemption = {
  readonly block: ReadonlyArray<string>; // the exempting block's `files`, exactly as the config writes them
  readonly imports: "all" | "type";
  readonly bans: ReadonlyArray<string>; // Ban keys
  readonly reason: string; // the block's own comment, in words
};

/** A glob that reaches no tracked file, and why it stays. */
type Unreached = { readonly glob: string; readonly reason: string };

/** What the check reports, one line each. */
type Drop = {
  readonly file: string; // the planted file: the first tracked file with this set of blocks
  readonly same: number; // how many tracked files share that set
  readonly ban: string;
  readonly imports: "value" | "type";
  readonly setBy: string; // the first block that sets it, named by its first `files` glob
  readonly last: string; // the last block that reaches the file
};

const reaches = (block: Block, file: string): boolean => matched(block.files, file) && !matched(block.excludeFiles, file);

/**
 * Every ban an entry sets. A `!` glob lets a path back in, so it is no ban. A `paths` item may be a plain string (a
 * name). Known keys only: options `paths` and `patterns`; a path `name`, `message`, `importNames`, `allowTypeImports`;
 * a pattern `group`, `message`, `importNames`, `allowTypeImports`. Any other key (`regex`, `importNamePattern`,
 * `allowImportNames`, `caseSensitive`, ...) throws, naming the block, so a ban the check cannot read is never skipped.
 */
const bansOf = (entry: unknown): ReadonlyArray<Ban> => { /* paths x importNames, patterns' groups x importNames */ };

/**
 * A specifier the glob matches: `**` and `*` become `x`; a class `[A-Z]` becomes its first character, `A`; a negated
 * class, `[!o]` or `[^o]`, becomes the first of `x`, `a`, `z`, `0` it does not hold.
 */
const specifier = (glob: string): string => { /* ... */ };

/** A glob the check reads as oxlint does: it has a `/` (or is `**`) and does not start with `./`. */
const readable = (glob: string): boolean => (glob === "**" || glob.includes("/")) && !glob.startsWith("./");

/** The dropped bans: each ban some reaching block sets, whose planted line did not fire and no exemption covers. */
const dropsOf = (
  groups: ReadonlyArray<{ readonly file: string; readonly same: number; readonly blocks: ReadonlyArray<Block> }>,
  fired: (file: string, line: number) => boolean,
  exemptions: ReadonlyArray<Exemption>,
  config: ReadonlyArray<Block>,
): { readonly drops: ReadonlyArray<Drop>; readonly unused: ReadonlyArray<Exemption> } => { /* ... */ };
```

- `ruleBlocks(text, "eslint/no-restricted-imports")` from `oxlint-plugins/one-rule.test-support.ts` reads the blocks:
  the root entry and each override that names the rule, in the config's order. It changes in one way: a rule has a
  list of the names oxlint reads as it (`eslint/no-restricted-imports`, `typescript/no-restricted-imports`,
  `no-restricted-imports`), and an entry under any of them is read, and written back, under the asked name. A block
  that names the rule twice, under two names, throws: which one oxlint keeps is not something to rely on. `plant.ts`
  reads its one-rule config through `ruleBlocks`, so the oxlint run sees the same blocks.
- Before anything else, every `files` and `excludeFiles` glob of those blocks must be readable (`readable`), and must
  reach a tracked file or stand in the `Unreached` list with its reason. An `Unreached` row whose glob now reaches a
  file is reported for deletion.
- The files are `git ls-files`, every `.ts`, `.tsx`, `.mts`, `.js` and `.mjs` of the repo. Files with the same
  reaching blocks behave the same under oxlint, so one planted file stands for each set: about 50 sets.
- The planted file holds a value import and a type-only import per ban of every reaching block, the last block's own
  included; a ban whose entry allows type imports plants its value import only. A ban the last block sets that does
  not fire means the specifier is wrong, not the config: the check says so in its own words ("the planted import for
  `<glob>` is not refused even by the block that sets it").
- `plant(files, undefined, "eslint/no-restricted-imports")` lints them in a temp folder with only that rule's blocks,
  0.07 s a run by its own comment.
- An exemption holds for a ban in a file when the exemption's block reaches that file: for both halves when its
  `imports` is `all`, for the type-only half alone when it is `type`. Each exemption must cover at least one drop, so
  one that no longer does is reported for deletion, as the lint ledger prunes its rows.
- The kalfa reach law reads the same blocks with a second rule's list: the kalfa product block is the one override
  whose `files` holds `kalfa/*/src/**`, and every tracked non-test file under each `kalfa/<package>/src/` must be
  reached by it. "Non-test" is the block's own `excludeFiles`: `*.test.ts` and `*.test.tsx`.

**The config changes** (`.oxlintrc.json`, written by the tests step):

1. The kalfa product block's `files` becomes `["kalfa/*/src/**", "kalfa/config/*.ts"]`. That adds `kalfa/ci`,
   `kalfa/quality`, `kalfa/records` and `kalfa/secrets`.
2. In the kalfa product and test blocks and `kalfa/config`'s two plant-holding blocks, `**/exam/plant.ts` and
   `**/exam/plant` become `**/oxlint-plugins/plant.ts` and `**/oxlint-plugins/plant`, with `next/`'s message for them.
3. A new block for `kalfa/quality`'s tests, after V4: `files` `["kalfa/quality/**/*.test.ts",
   "kalfa/quality/**/*.test.tsx"]`, holding the kalfa test block's entries and Q8's own. Its comment says why it is
   there: Q8 reaches the tests, and an override replaces a rule's options.
4. Each block the check names gets the dropped entries written in again, in the entry's own words and message. Only
   the eleven exemptions stay dropped.
5. The four stale globs in the table above go. `kalfa/ledger/src/LedgerTest.ts` and the two `*.test.tsx` globs stay,
   in `Unreached` with their reasons.

## One value traced

`kalfa/quality/src/cli.test.ts` and the ban `react#useState`, before the fix:

1. `ruleBlocks` gives 50 blocks: the root entry and 49 overrides. Three reach the file: the root entry (`**`), the kalfa test block
   (`kalfa/**/*.test.ts`), and Q8 (`kalfa/quality/**`), in that order. The kalfa product block does not: its
   `excludeFiles` takes `*.test.ts` out.
2. Fourteen other tracked test files of `kalfa/quality` reach the same three blocks, so `cli.test.ts` is the planted
   file for 15.
3. The kalfa test block's `paths` entry `{ name: "react", importNames: ["useState"] }` gives the ban
   `react#useState`, whose planted line is, for example, line 8: `import { useState as p7 } from "react";`.
4. `plant` lints the file at `kalfa/quality/src/cli.test.ts` in its temp folder. Oxlint gives the file Q8's entry
   alone, which has no `react` entry, so line 8 does not fire.
5. No exemption's block reaches the file. The check reports: `kalfa/quality/src/cli.test.ts (and 14 more): react#useState,
   set by kalfa/**/*.test.ts, dropped by kalfa/quality/**`.
6. After change 3, the new block is the last to reach the file and holds the `react` entry. Line 8 fires, and the
   report is empty.

## Generators

B4 builds a small made-up config in memory: two to four blocks, each with one or two `files` globs over the folders
`a/`, `a/b/` and `c/`, maybe an `excludeFiles` glob, and a set of bans drawn from five keys; one to three planted
files; a fired set; and zero to two exemptions. It runs `dropsOf` and compares with an answer the generator builds
from the same draw. Every run builds each class:

- (a) a file under a block's `files` and its `excludeFiles` too: the block does not reach it, so its bans are not
  expected there. This class reaches the `excludeFiles` read, the one check after the `files` match.
- (b) a ban that did not fire, named by an exemption whose block reaches the file: no drop.
- (c) a ban that did not fire, named by an exemption whose block does not reach the file: a drop. This reaches the
  exemption's reach check, after its ban matched.
- (d) a ban that did not fire, in a file an exemption's block reaches, but the exemption names another ban: a drop.
  This reaches the exemption's ban equality, after its reach passed.
- (e) an exemption that covers no drop anywhere: reported as unused.
- (f) a ban set by the root entry, which has no `files`: expected in every file.
- (g) a ban whose entry has `allowTypeImports: true`: its type-only import is not expected to fire. This reaches the
  `types` read, after the ban was found.
- (h) a type-only drop in a file an exemption's block reaches, with the exemption's `imports` `type`: no drop; the
  same ban's value import not firing there: a drop. This reaches the `imports` read, after reach and ban matched.

## Laws

B1, B2, B3, G1 and K1 read the real config and the real tree, all of it in one run each, so they have no generator.
B5 and G2 read fixed configs. B4 runs 100 cases in memory. All run on every pull request.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| B1, every import ban a block sets for a tracked file is still refused there by oxlint, as a value import and as a type-only one, unless an exemption whose block reaches the file names it | test | scenario: the real config over every tracked file, one planted file per set of reaching blocks, one oxlint run | delete the new `kalfa/quality` test block: red, naming `kalfa/quality/src/cli.test.ts` and `react#useState`; delete the `react` entry from the `kalfa/git/src/**` block: red; write the `kalfa/markdown/src/**` block's entry as plain `"error"`: red for every ban of the root and kalfa blocks there; rename the `kalfa/markdown/src/**` block's rule key to `typescript/no-restricted-imports`, then to bare `no-restricted-imports`, with an entry that leaves out `react`: red each time; add `allowTypeImports: true` to the `react` entry of the `kalfa/git/src/**` block: red, type-only | oxlint-plugins/config-blocks.test.ts |
| B2, each planted import is refused by the block that sets it when that block is the last to reach the file | test | scenario: the same run as B1, the last block's own bans | keep `[A-Z]` as written in `specifier`: the `../ledger/[A-Z]*` ban of the libfabrika layer block reports itself, red; read `[!o]` as its first character: the `@octokit/[!o]*` ban of the `kalfa/github/src/**` block reports itself, red; keep `!` globs as bans: `!alchemy` reports itself, red | oxlint-plugins/config-blocks.test.ts |
| B3, each exemption covers at least one drop B1 would report without it | test | scenario: the eleven exemptions against the same run | add an exemption for the `kalfa/records/src/**` files and `react#useState`: red, "unused"; delete the `next/apps` start files' TOML block and keep its exemption: red, "unused" | oxlint-plugins/config-blocks.test.ts |
| B4, `dropsOf` reports exactly the drops and unused exemptions the generator's answer holds. 100 runs | test | fc.record: blocks, planted files, a fired set and exemptions over (a) to (h) | (a) read `files` only and skip `excludeFiles`: a ban of a block that leaves the file out is expected, red; (b) drop exemptions: the exempted ban is reported, red; (c) match an exemption by its ban only, not its block's reach: a drop outside the block passes, red; (d) match an exemption by its block only: another ban in its files passes, red; (e) never report an unused exemption: red; (f) skip the root entry: its bans pass unchecked, red; (g) ignore `types`: an `allowTypeImports` ban's type-only import is expected, red; (h) read every exemption as `all`: the value drop beside a type-only exemption passes, red | oxlint-plugins/config-blocks.test.ts |
| B5, `ruleBlocks` reads the rule under each of its three names, and `bansOf` reads each known key and throws on any other | test | pinned: a config text with the rule under each name in turn, one with two names in one block, and entries with a plain-string path, `[!o]`, `[^o]`, `[A-Z]`, `allowTypeImports`, and an unknown key `regex` | read only the asked name in `ruleBlocks`: the `typescript/` and bare blocks are missed, red; take the first name of a block that has two: no throw, red; skip unknown keys in `bansOf`: `regex` passes, red | oxlint-plugins/config-blocks.test.ts |
| G1, every `files` and `excludeFiles` glob of a block naming the rule reaches a tracked file, or stands in `Unreached` with its reason; no `Unreached` row reaches one | test | scenario: the real config and `git ls-files` | put back `next/programs/inbox/src/**/tile.ts`: red, naming the glob; add an `Unreached` row for `kalfa/git/src/**`: red, "reaches 18 files" | oxlint-plugins/config-blocks.test.ts |
| G2, every such glob is readable: it holds a `/` or is `**`, and does not start with `./` | test | pinned: the real config, and the review's two forms `*.test.ts` and `./a/b/y.ts` in a fixed config | let `readable` pass a glob with no `/`: the fixed config's `*.test.ts` passes, red; let it pass `./`: `./a/b/y.ts` passes, red | oxlint-plugins/config-blocks.test.ts |
| K1, every tracked non-test file under each `kalfa/<package>/src/` is reached by the kalfa product block, found as the one override whose `files` holds `kalfa/*/src/**` | test | scenario: the real config and the tracked kalfa tree | add `"kalfa/records/src/**"` to the block's `excludeFiles`: red, naming `kalfa/records/src/MapSize.ts`; put back the old explicit list without `kalfa/ci/src/**`: red, "no block holds kalfa/*/src/**" | oxlint-plugins/config-blocks.test.ts |
| K2, the four packages pass every rule of the kalfa product block | lint | lint | name `countLines` back `linesOf` in `kalfa/records/src/MapSize.ts`: `pnpm lint` red with `fabrika(no-of)`; delete the edge line over `import(url.href)` in `kalfa/quality/src/cli.ts`: red with `fabrika(no-promises)` | .oxlintrc.json |
| Q1, a `kalfa/quality` test file is refused the imports kalfa's other test files are refused | lint | lint | a scratch `kalfa/quality/src/vitest/t2369-Probe.test.ts` that imports `react`'s `useState`: `pnpm lint` red; deleted again | .oxlintrc.json |

**Where they run.** B1 to B5, G1, G2 and K1 run in one test file, about 1 s with its one oxlint run, on every pull request
and on the laptop by name. K2 and Q1 run in `pnpm lint`. No law is host-only: a temp folder and the oxlint binary are
not launchd, the Electron app, a socket or a signal. No `.integration.` file.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| .oxlintrc.json | tests | tests | the kalfa block's glob; the plant path swapped in four kalfa blocks; a new block for `kalfa/quality`'s tests after V4; the dropped entries written again in 19 kalfa blocks, `kalfa/config`'s three, five `next/` blocks and the `scripts/` block; four stale globs gone. About 860 lines, nearly all copied entries |
| oxlint-plugins/config-blocks.test.ts | tests | tests | new: B1 to B5, G1, G2, K1, the eleven exemptions and the `Unreached` rows with their reasons, and a top comment with oxlint's merge rule from the tryouts. About 400 lines |
| oxlint-plugins/one-rule.test-support.ts | tests | tests | `ruleBlocks` reads the rule under each of its names and throws on a block that names it twice. About 15 lines |
| kalfa/quality/src/stryker/node/MutantsStryker.ts | build | 10 | `load().then(...)` inside one `Effect.tryPromise` (line 45) splits into two `Effect.tryPromise` calls, one that loads the instrumenter and one that runs it; the two "Edge (...)" comments become edge lines over the `import()` line and each `tryPromise` |
| kalfa/quality/src/cli.ts | build | 1 | the "Edge (...)" comment over `import(url.href)` becomes an edge line |
| kalfa/quality/src/stryker/Report.ts | build | 2 | `targetOf` renamed |
| kalfa/quality/src/stryker/Run.ts | build | 2 | `packageOf` renamed |
| kalfa/quality/src/stryker/Target.ts | build | 4 | `offsetOf` and `spansOf` renamed |
| kalfa/records/src/MapSize.ts | build | 2 | `linesOf` renamed |
| kalfa/quality/src/stryker/Built.test-support.ts | tests | tests | `positionOf` renamed |
| kalfa/quality/src/stryker/MemoryFiles.test-support.ts | tests | tests | the `no-hand-tag` disable line with its reason |
| kalfa/records/src/Records.test-support.ts | tests | tests | `textOf` and `slugOf` renamed; the `no-hand-tag` disable line |
| kalfa/records/src/Runbooks.test.ts | tests | tests | calls `slugOf`'s new name |
| kalfa/secrets/src/Secrets.test-support.ts | tests | tests | `fieldsOf` renamed |
| kalfa/secrets/src/Errors.test.ts | tests | tests | calls `fieldsOf`'s new name |
| kalfa/secrets/src/Fetch.test-support.ts | tests | tests | `environmentOf` renamed |
| oxlint-plugins/plant.ts | tests | none | not changed: reused as it is, and it reads its blocks through the changed `ruleBlocks` |
| kalfa/quality/GLOSSARY.md kalfa/records/GLOSSARY.md kalfa/secrets/GLOSSARY.md | build | none | not changed: no new domain word |
| oxlint-plugins/ oxlint-plugins/** oxlint-plugins/plant oxlint-plugins/one-rule.test.ts oxlint-plugins/plants.test.ts oxlint-plugins/test-helpers/effect-config.ts | tests | none | named only: folders and globs the check reads, and tests run by name; not changed |
| .github/ci .github/ci/ kalfa/**/*.test.ts kalfa/quality/**/*.test.ts kalfa/quality/src/cli.test.ts | tests | none | named only: folders, config globs and the traced file; not changed |
| kalfa/quality/src/vitest/t2369-Probe.test.ts | tests | none | Q1's scratch plant, written and deleted, never committed |
| apps/fabrika/src/host/settings.laws.test.ts next/apps/fabrika/src/exam/edges.ts next/packages/libfabrika/src/node/client/MemoryFiles.test-support.ts pnpm-lock.yaml kalfa/ledger/src/LedgerTest.ts oxlint-plugins/no-hand-tag.ts | tests | none | named only, as evidence, prior art or a file still to come; not changed |

**Beside https://github.com/kamp-us/tea-fabrika/pull/2379 (ticket 2242's plan), which touches the same blocks.**

- Its first pull request adds law O15's block for `kalfa/quality/src/oxlint/**` after V4, test files left out, and
  says it "repeats every entry of every earlier block that reaches its files". Once this plan lands, the kalfa product
  block reaches those files too, so O15's block must also repeat the kalfa block's entries. B1 says so by name if it
  does not. This plan's new test block reaches the new test files in `src/oxlint/` with no edit there, as 2379's plan
  expects.
- **The glob puts 2379's copied rules under the kalfa Effect rules.** `kalfa/*/src/**` reaches
  `kalfa/quality/src/oxlint/**`, so the eleven files 2379 copies there meet every rule of the kalfa product block,
  `fabrika/no-of` included. One finding is known already: `oxlint-plugins/no-hand-tag.ts`'s `constantsOf` fires
  `no-of` once copied. 2379's build renames it, and runs `pnpm lint` for the rest. The lead tells 2379.
- **This lands before 2379's rename sweep,** so the build here writes today's names: the edge lines are
  `fabrika/no-promises` and the tag lines `fabrika/no-hand-tag`. 2379's second pull request renames `fabrika/<moved>`
  to `@kalfa/quality/<moved>` across the tree with one sweep, and that sweep reaches these six lines. The new test
  reads the import-ban rule and `files` globs only, so the rename changes nothing in it.
- **Order: this pull request first, 80% sure.** It is smaller, it fixes the hole 2379's new test files share, and
  then B1 holds O15's block on the day it is written. The second to land rebases on `.oxlintrc.json` (both add a
  block after V4), and its lead reruns `pnpm lint` and B1.

## Existing tools

- oxlint-plugins/config-blocks.test.ts: searched `oxlint-plugins/` and `.github/ci/` for tests that read
  `.oxlintrc.json` (71 files name it, by `rg -l`), and the installed oxlint for a per-file config print. Found
  `ruleBlocks` (`oxlint-plugins/one-rule.test-support.ts`), which reads one rule's blocks in order, and `plant`
  (`oxlint-plugins/plant.ts`), which lints planted files at real paths with those blocks: both reused. Not reused:
  `oneRuleConfig`, since `plant` already writes the one-rule config beside the planted files;
  `test-helpers/effect-config.ts`'s `matches`, since that module reads the Effect checker's schema when it loads, so
  the test keeps its own three-line `matched` over `node:path`'s `matchesGlob`, as that helper does. `oxlint
  --print-config` takes no file, so it cannot say what one file ends with. No npm package answers "which override
  drops which option" for oxlint; ESLint's `--print-config <file>` is ESLint's.
- `bansOf`, `specifier`, `readable`, `reaches` and `dropsOf`, new functions in that new file: searched the same tests
  for a reader of `no-restricted-imports` options, a glob-to-sample function or a glob-form check; none exists.
- The name list in `ruleBlocks` (`oxlint-plugins/one-rule.test-support.ts`), a change to an existing function:
  searched the installed oxlint (`configuration_schema.json`, `oxlint --help`) for a list of a rule's other names to
  read; it ships none, so the list is written from the review's tryout, for the one rule that needs it.

## Calls taken

- **The gap of 2380 was not on purpose.** 90% sure. The secrets plan says to add the package; the quality and records
  plans predate the block or say nothing; the quality Promises were already marked as edges.
- **One check, and it asks oxlint.** 85% sure. A fold that copies oxlint's merge and compares lists by hand would
  report false drops where a later block's broader glob still bans the path (`"**"` with `!` globs, near line 2158),
  and would carry a copy of oxlint's rule to drift. Planting one import per ban lets oxlint answer, in one run.
- **The check reads every tracked file.** The lead's decision. Today's version gets config edits only: its one
  accidental drop (the `scripts/` block) gets its Radix entries back, and its two on-purpose ones become exemptions.
- **The rule's three names are one rule, and a block naming two throws.** 90% sure, from the review's tryout. Throwing
  beats guessing which one oxlint keeps; no block does it today.
- **Type-only imports get their own planted twin.** 90% sure. A loosening that lets `import type` through is a real
  drop of half a ban; the three that are on purpose get `imports: "type"` exemptions. The doubt is the two
  `@octokit/openapi-types` ones: if B1 reports nothing there, B3 calls them unused and the tests step drops them,
  saying so in its report.
- **Globs that reach no file go, unless a file is still to come.** 85% sure. A glob for a file that moved is a ban or
  an exemption that no longer means what it says; one for a planned file keeps its reason in `Unreached`.
- **Import bans only.** 85% sure. Both tickets ask for import bans. The same mistake in two other rules goes to a
  ticket (Findings), and a second rule can join by adding its own `bansOf`.
- **Exemptions are data in the test, named by the exempting block's `files`, each with a reason.** 80% sure. Oxlint's
  config schema refuses any extra key in a block (`additionalProperties: false`), so the config cannot say it. Naming
  the block by its `files` means a block that later reaches more files carries its exemption with it.
- **A glob for the kalfa block, `kalfa/*/src/**`.** 85% sure. It makes a missed package impossible to write, which
  K1 then holds. It adds `kalfa/ci`, which the ticket missed. A package that must stay out would need an
  `excludeFiles` line, which K1 refuses: none exists today.
- **The dead plant path is swapped for the live one,** not copied into 19 blocks. 85% sure. The ban's own message names
  the helper that now lives in `oxlint-plugins/`, and `next/`'s blocks already made that swap.
- **The new `kalfa/quality` test block comes after V4,** so it is last for those files whatever Q15, V3 or V4 do.
  90% sure. V3 and V4 leave test files out today, so after Q8 works too; after V4 is the safe place.
- **The new edge lines need no extra ask.** 85% sure. `fabrika/edge-comment` holds their shape, and CI's edge list
  (`next/apps/fabrika/src/exam/edges.ts`) shows the owner each new one, as it does for every edge.

Is anything here a setting? The rule's names are oxlint's fact, and the exemptions and `Unreached` rows are reasons,
not values. None is a value a user would turn, so none is a `fabrika.toml` key.

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run oxlint-plugins/config-blocks.test.ts` red on main's config (B1 lists
  the drops above, K1 names `kalfa/ci`, `kalfa/quality`, `kalfa/records` and `kalfa/secrets`), then green after its
  own config edits. `pnpm lint` then red on the findings in product files only (10 on main's code), which its plant
  record names.
- Build step: `pnpm lint` green; each plant above run once and undone.
- `oxlint-plugins/**` and `.oxlintrc.json` select every test, so each step names its test files:
  `oxlint-plugins/config-blocks.test.ts`, `oxlint-plugins/plants.test.ts`, `oxlint-plugins/one-rule.test.ts`, and the
  kalfa tests whose helpers were renamed (`kalfa/records/src/Runbooks.test.ts`, `kalfa/secrets/src/Errors.test.ts`,
  and the `kalfa/quality/src/stryker/` tests). CI runs the rest.
- The lead's own one typecheck covers the renames.

## Size

1. One pull request: about 41 product lines (five renames, the split `tryPromise`, four edge lines), about 860 lines
   of `.oxlintrc.json`, nearly all entries copied from the blocks above them, one new test file of about 400 lines and
   a 15-line change to `ruleBlocks`. It lands whole: the
   check is red until every drop is fixed or exempted, and the four packages fail lint until the fixes are in.

About 2.5 agent hours across tests, build and review, 80% sure. The doubt is the tests step's JSON: 28 blocks to edit
by hand, and the type-only half's first run may show drops the value-only prototype did not, which may take one
send-back. Basis: Opus steps at about $10 each, over the $7 to $8 a step of mostly-copied work in
`.kalfa/quests/kalfa-quality-vitest-PLAN.md`, for the larger config edit and test: tests, build, review, and one
likely send-back.

Estimate: 4 steps, $40

## New names

None in a glossary. The test's names (`Ban`, `Exemption`, `Unreached`, `Drop`, `reaches`, `readable`, `specifier`)
are code-local plain words.
"Exemption" is the word the config's own comments already use for such a block.

## Records

- The tryout's answer goes in the new test's top comment, where the next agent who writes a block reads it: oxlint 1.90
  takes the last block's entry whole, a severity-only entry drops every option, the rule's three names are one rule,
  `allowTypeImports` lets the type-only half through, and a glob with no `/` reaches any depth. The lead posts the
  same lines on both tickets.
- The 2380 count (17 findings, by rule and file) is in this plan and in the pull request body.
- No decision record: the repeat rule is already the config's written convention, and the check holds it.

## What fact is lost if it is not recorded now

That oxlint drops options on a severity-only block, unlike ESLint, and that its three names for the rule are one.
Every agent knows ESLint's rule and would write `"error"` in a later block thinking it keeps the bans. Only the tryout showed otherwise, and without the test's comment
the next block writer finds out from a hole like 2369's.

## What this cannot tell us

- A ban is tried with one specifier per glob (`x/settings/TomlParser.ts` for `**/settings/TomlParser.ts`). A later block
  that bans that one string but not every string the glob matches would pass B1. No block in the config does that
  today, as far as the prototype shows.
- Type-only imports are planted as `import type { x }`. An inline `import { type x }` is not planted; oxlint treats
  both as type imports by the review's tryout, but that one form was not tried.
- Which blocks reach a file comes from `node:path`'s `matchesGlob`, not oxlint's own glob code. A mismatch shows as a
  red line (a ban expected where oxlint gives another block), not as a silent pass, except where both readings pick
  blocks that agree by chance.
- A repeated entry with a different message passes: the check reads bans, not their words.
- `Unreached` reasons say a file is still to come; nothing checks that the plan naming it is still open.

## Open questions

None.

Each choice picks how the code does what the two tickets and the config's own convention already say.

## Findings

1. **The same mistake in two other rules.** In `next/`, four blocks re-set `eslint/no-restricted-properties` without
   the `process.stdout` and `process.stderr` ban (the blocks near lines 2929, 3050, 3199 and 3361; about 350 file
   reaches in all). In `kalfa/transport/src/cloudflare/**`, the block near line 6732 re-sets `eslint/id-denylist` and drops 17 words the block near line 1426 sets (`room`, `rooms`, ...). Not
   checked whether either is on purpose. Ready ticket: "Lint: two more rules lose earlier blocks' options. Add
   `no-restricted-properties` and `id-denylist` to `oxlint-plugins/config-blocks.test.ts`, then repeat or exempt what
   it finds."
2. **The hand repeats are the root cause.** About 860 of this plan's lines are entries copied into later blocks. Oxlint
   1.90 can read a JS or TS config (experimental, per `oxlint --help`), where each block could spread shared ban lists.
   71 files name `.oxlintrc.json`, many of them tests that copy it, so the move is its own pull request. Ready ticket: "Lint: build the
   repeated import bans from shared lists, so a later block cannot drop one."
