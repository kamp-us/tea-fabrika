
Plancheck-Version: 3

# Plan: lint blocks that drop import bans, and kalfa packages the Effect rules miss (tickets 2369 and 2380)

This is lint config and lint tooling: `.oxlintrc.json`, a new test in `oxlint-plugins/`, and small fixes in three
kalfa packages. It touches `next/` only through `.oxlintrc.json` blocks. Today's frozen version (`apps/`, `packages/`,
`programs/`, `scripts/`) is not changed and not judged. The tickets are
https://github.com/kamp-us/tea-fabrika/issues/2369 and https://github.com/kamp-us/tea-fabrika/issues/2380, in one pull
request with one shared check.

```ts
// The whole idea, a sketch. Nothing here was type-checked.

// oxlint 1.90 gives a file the rule entry of the LAST block that names the rule, whole. Options never merge, and a
// block that writes only a severity ("error") drops every option an earlier block set (a tryout, below).

// oxlint-plugins/config-blocks.test.ts asks oxlint itself, once, whether every ban still holds:
//   for each set of blocks that reaches some file, plant one file at a real path with that set,
//   holding one import per ban any of those blocks sets (`import { useState as p3 } from "react";`),
//   lint it with the config's import-ban blocks alone (plant.ts, `only`), and read which lines fired.
//   A line that did not fire is a dropped ban, unless an exemption names it for that file.
const EXEMPTIONS: ReadonlyArray<Exemption> = [
  {
    block: ["next/packages/libfabrika/src/settings/**", "kalfa/config/src/**", "next/packages/libfabrika/src/node/settings/**"],
    bans: ["**/settings/TomlParser.ts", "**/settings/TomlParser" /* ...the other four of that group */],
    reason: "the settings module and its Node loader take the TOML adapter",
  },
  // ...five more, each the block's own comment in words
];

// .oxlintrc.json, the kalfa product block: a glob, so a new package cannot be left out.
"files": ["kalfa/*/src/**", "kalfa/config/*.ts"],
```

## Calls under 80%, read these first

- **The check judges `next/`, `kalfa/`, `.agents/`, `oxlint-plugins/` and `.github/ci/`, not only `kalfa/`. 75% sure.**
  Both tickets are about kalfa, but the class of mistake is the config's, and the same check finds six `next/` blocks
  that drop the `useState` ban (one of them also the `_electron` bans and the TOML writer's). Fixing them is about 45
  JSON lines in this pull request. The doubt: neither ticket names `next/`. If the lead wants this pull request kalfa
  only, the check's folder list becomes `["kalfa/"]` and the six `next/` blocks become a ticket. Nothing else in the
  plan changes.

## How oxlint merges a block's options: the tryout

Run on oxlint 1.90.0 (`pnpm-lock.yaml`), in a scratch folder, with `eslint/no-restricted-imports` and
`eslint/id-denylist`:

- Block 1 bans `**/one.ts` for `**/*.ts`; block 2 bans `**/two.ts` for `a/**`. In `a/x.ts`, only `./two.ts` is refused.
  The later entry replaces the earlier one whole: arrays are not joined.
- Block 2 written as `"eslint/no-restricted-imports": "error"` or `"warn"`, with no options: nothing is refused in
  `b/x.ts`. The same for `eslint/id-denylist` (`["error", "where"]`, then `"error"`: `where` passes). This differs
  from ESLint, which keeps the options when a later config gives only a severity.
- A block whose `excludeFiles` leaves a file out does not touch it: the earlier entry stays.
- `typescript/no-restricted-imports` is the same rule as `eslint/no-restricted-imports`: set in two blocks, the later
  one replaces the earlier. So the bans cannot be split across the two names.
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

Run as a prototype over main (a scratch script, `t2369-probe.mjs`, 48 ms of oxlint for 1,190 planted imports in 41
sets of blocks), the check reports 32 dropped bans in the five folders. After 2380's change it reports 38: the four
`kalfa/quality` blocks (Q8, Q15, V3, V4) and two `kalfa/secrets` blocks now drop the kalfa block's bans for product
files. Sorted:

- **Exemptions, on purpose (6 blocks).** Each block's comment says it lets the import in:
  - the TOML parser group, in the start files of `next/apps` (the T664 block near line 1667);
  - the same group, in the settings module, its Node loader and `kalfa/config/src/**` (the T664 block near line 1909);
  - `@decimalturn/toml-patch` and `toml-eslint-parser`, in the two adapter files (`TomlParser.ts` and `internal/toml.ts`,
    near line 1982);
  - `**/oxlint-plugins/plant(.ts)`, in the reader-list tests (the two CI-paths law 20 blocks near lines 4889 and
    4963);
  - the Alchemy and own-folder patterns, in `kalfa/transport/src/cloudflare/**` (near line 6732).
- **Ticket 2369.** `kalfa/quality`'s 15 test files lose the kalfa test block's bans to Q8: the TOML writer and parser,
  `useState`, the plant helper and the TOML parser group.
- **Every per-package kalfa block** (diagnostics, git twice, ledger twice, markdown, github twice, transport four
  times, permissions, and after 2380 quality four times and secrets twice: 19 blocks) says "this repeats the base
  entries". It repeats the root `rules` entries and drops the kalfa block's own: the TOML writer and parser, `useState`,
  the plant helper, the TOML parser group's relative paths.
- **`kalfa/config`'s three blocks** near lines 5394, 5479 and 5561 drop `**/oxlint-plugins/plant`, and the last also
  `useState`.
- **Six `next/` blocks** drop `react`'s `useState` (the libfabrika layer block near 2029, inbox's `program.ts` near
  2397, `desktop/**` near 2567, `desktop/PersonCheck.ts` near 2686, `schedules/**` near 2798), and the layer block also
  the two `_electron` bans, `schedules/**` also the TOML writer.

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
};

/** A ban a later block lets go on purpose, for every file that block reaches. */
type Exemption = {
  readonly block: ReadonlyArray<string>; // the exempting block's `files`, exactly as the config writes them
  readonly bans: ReadonlyArray<string>; // Ban keys
  readonly reason: string; // the block's own comment, in words
};

/** What the check reports, one line each. */
type Drop = {
  readonly file: string; // the planted file: the first tracked file with this set of blocks
  readonly same: number; // how many tracked files share that set
  readonly ban: string;
  readonly setBy: string; // the first block that sets it, named by its first `files` glob
  readonly last: string; // the last block that reaches the file
};

const reaches = (block: Block, file: string): boolean => matched(block.files, file) && !matched(block.excludeFiles, file);

/** Every ban an entry sets. A `!` glob lets a path back in, so it is no ban. */
const bansOf = (entry: unknown): ReadonlyArray<Ban> => { /* paths x importNames, patterns' groups x importNames */ };

/** A specifier the glob matches: a `[...]` class becomes its first character, `**` and `*` become `x`. */
const specifier = (glob: string): string => glob.replace(/\[(.)[^\]]*\]/g, "$1").replaceAll("**", "x").replaceAll("*", "x");

/** The dropped bans: each ban some reaching block sets, whose planted line did not fire and no exemption covers. */
const dropsOf = (
  groups: ReadonlyArray<{ readonly file: string; readonly same: number; readonly blocks: ReadonlyArray<Block> }>,
  fired: (file: string, line: number) => boolean,
  exemptions: ReadonlyArray<Exemption>,
  config: ReadonlyArray<Block>,
): { readonly drops: ReadonlyArray<Drop>; readonly unused: ReadonlyArray<Exemption> } => { /* ... */ };
```

- `ruleBlocks(text, "eslint/no-restricted-imports")` from `oxlint-plugins/one-rule.test-support.ts` reads the blocks:
  the root entry and each override that names the rule, in the config's order.
- The files are `git ls-files` under the five folders, every `.ts`, `.tsx`, `.mts`, `.js` and `.mjs`. Files with the
  same reaching blocks behave the same under oxlint, so one planted file stands for each set: 41 sets today.
- The planted file holds one import per ban of every reaching block, the last block's own included. A ban the
  last block sets that does not fire means the specifier is wrong, not the config: the check says so in its own
  words ("the planted import for `<glob>` is not refused even by the block that sets it").
- `plant(files, undefined, "eslint/no-restricted-imports")` lints them in a temp folder with only that rule's blocks,
  0.07 s a run by its own comment.
- An exemption holds for a ban in a file when the exemption's block reaches that file. Each exemption must cover at
  least one drop, so one that no longer does is reported for deletion, as the lint ledger prunes its rows.
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
   the six exemptions stay dropped.

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

## Laws

B1, B2, B3 and K1 read the real config and the real tree, all of it in one run each, so they have no generator. B4
runs 100 cases in memory. All run on every pull request.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| B1, every import ban a block sets for a file in `next/`, `kalfa/`, `.agents/`, `oxlint-plugins/` or `.github/ci/` is still refused there by oxlint, unless an exemption whose block reaches the file names it | test | scenario: the real config over every tracked file in the five folders, one planted file per set of reaching blocks, one oxlint run | delete the new `kalfa/quality` test block: red, naming `kalfa/quality/src/cli.test.ts` and `react#useState`; delete the `react` entry from the `kalfa/git/src/**` block: red; write the `kalfa/markdown/src/**` block's entry as plain `"error"`: red for every ban of the root and kalfa blocks there | oxlint-plugins/config-blocks.test.ts |
| B2, each planted import is refused by the block that sets it when that block is the last to reach the file | test | scenario: the same run as B1, the last block's own bans | keep `[A-Z]` as written in `specifier`: the `../ledger/[A-Z]*` ban of the libfabrika layer block reports itself, red; keep `!` globs as bans: `!alchemy` reports itself, red | oxlint-plugins/config-blocks.test.ts |
| B3, each exemption covers at least one drop B1 would report without it | test | scenario: the six exemptions against the same run | add an exemption for the `kalfa/records/src/**` files and `react#useState`: red, "unused"; delete the `next/apps` start files' TOML block and keep its exemption: red, "unused" | oxlint-plugins/config-blocks.test.ts |
| B4, `dropsOf` reports exactly the drops and unused exemptions the generator's answer holds. 100 runs | test | fc.record: blocks, planted files, a fired set and exemptions over (a) to (f) | (a) read `files` only and skip `excludeFiles`: a ban of a block that leaves the file out is expected, red; (b) drop exemptions: the exempted ban is reported, red; (c) match an exemption by its ban only, not its block's reach: a drop outside the block passes, red; (d) match an exemption by its block only: another ban in its files passes, red; (e) never report an unused exemption: red; (f) skip the root entry: its bans pass unchecked, red | oxlint-plugins/config-blocks.test.ts |
| K1, every tracked non-test file under each `kalfa/<package>/src/` is reached by the kalfa product block, found as the one override whose `files` holds `kalfa/*/src/**` | test | scenario: the real config and the tracked kalfa tree | add `"kalfa/records/src/**"` to the block's `excludeFiles`: red, naming `kalfa/records/src/MapSize.ts`; put back the old explicit list without `kalfa/ci/src/**`: red, "no block holds kalfa/*/src/**" | oxlint-plugins/config-blocks.test.ts |
| K2, the four packages pass every rule of the kalfa product block | lint | lint | name `countLines` back `linesOf` in `kalfa/records/src/MapSize.ts`: `pnpm lint` red with `fabrika(no-of)`; delete the edge line over `import(url.href)` in `kalfa/quality/src/cli.ts`: red with `fabrika(no-promises)` | .oxlintrc.json |
| Q1, a `kalfa/quality` test file is refused the imports kalfa's other test files are refused | lint | lint | a scratch `kalfa/quality/src/vitest/t2369-Probe.test.ts` that imports `react`'s `useState`: `pnpm lint` red; deleted again | .oxlintrc.json |

**Where they run.** B1 to B4 and K1 run in one test file, about 1 s with its one oxlint run, on every pull request
and on the laptop by name. K2 and Q1 run in `pnpm lint`. No law is host-only: a temp folder and the oxlint binary are
not launchd, the Electron app, a socket or a signal. No `.integration.` file.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| .oxlintrc.json | tests | tests | the kalfa block's glob; the plant path swapped in four kalfa blocks; a new block for `kalfa/quality`'s tests after V4; the dropped entries written again in 19 kalfa blocks, `kalfa/config`'s three and six `next/` blocks. About 850 lines, nearly all copied entries |
| oxlint-plugins/config-blocks.test.ts | tests | tests | new: B1 to B4, K1, the exemptions with their reasons, and a top comment with oxlint's merge rule from the tryout. About 300 lines |
| kalfa/quality/src/stryker/node/MutantsStryker.ts | build | 4 | the two "Edge (...)" comments become edge lines, one over each of the three firing lines |
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
| oxlint-plugins/plant.ts oxlint-plugins/one-rule.test-support.ts | tests | none | not changed: reused as they are |
| kalfa/quality/GLOSSARY.md kalfa/records/GLOSSARY.md kalfa/secrets/GLOSSARY.md | build | none | not changed: no new domain word |
| oxlint-plugins/ oxlint-plugins/** oxlint-plugins/plant oxlint-plugins/one-rule.test.ts oxlint-plugins/plants.test.ts oxlint-plugins/test-helpers/effect-config.ts | tests | none | named only: folders and globs the check reads, and tests run by name; not changed |
| .github/ci .github/ci/ kalfa/**/*.test.ts kalfa/quality/**/*.test.ts kalfa/quality/src/cli.test.ts | tests | none | named only: folders, config globs and the traced file; not changed |
| kalfa/quality/src/vitest/t2369-Probe.test.ts | tests | none | Q1's scratch plant, written and deleted, never committed |
| apps/fabrika/src/host/settings.laws.test.ts next/apps/fabrika/src/exam/edges.ts next/packages/libfabrika/src/node/client/MemoryFiles.test-support.ts pnpm-lock.yaml | tests | none | named only, as evidence or prior art; not changed |

**Beside https://github.com/kamp-us/tea-fabrika/pull/2379 (ticket 2242's plan), which touches the same blocks.**

- Its first pull request adds law O15's block for `kalfa/quality/src/oxlint/**` after V4, test files left out, and
  says it "repeats every entry of every earlier block that reaches its files". Once this plan lands, the kalfa product
  block reaches those files too, so O15's block must also repeat the kalfa block's entries. B1 says so by name if it
  does not. This plan's new test block reaches the new test files in `src/oxlint/` with no edit there, as 2379's plan
  expects.
- Its second pull request renames `fabrika/<moved>` to `@kalfa/quality/<moved>` across the tree with one sweep. The
  five `fabrika/no-promises` edge lines and two `fabrika/no-hand-tag` lines this plan adds are in that sweep's reach if
  it runs after this lands. The new test reads `eslint/no-restricted-imports` and `files` globs only, so the rename
  changes nothing in it.
- **Order: this pull request first, 80% sure.** It is smaller, it fixes the hole 2379's new test files share, and
  then B1 holds O15's block on the day it is written. Either order works: the second to land rebases on
  `.oxlintrc.json` (both add a block after V4), and its lead reruns `pnpm lint` and B1.

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
- `bansOf`, `specifier`, `reaches` and `dropsOf`, new functions in that new file: searched the same tests for a reader
  of `no-restricted-imports` options or a glob-to-sample function; none exists.

## Calls taken

- **The gap of 2380 was not on purpose.** 90% sure. The secrets plan says to add the package; the quality and records
  plans predate the block or say nothing; the quality Promises were already marked as edges.
- **One check, and it asks oxlint.** 85% sure. A fold that copies oxlint's merge and compares lists by hand would
  report false drops where a later block's broader glob still bans the path (`"**"` with `!` globs, near line 2158),
  and would carry a copy of oxlint's rule to drift. Planting one import per ban lets oxlint answer, in one run.
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
- **The scope is the five new-work folders.** 75% sure; see the top.
- **The new edge lines need no extra ask.** 85% sure. `fabrika/edge-comment` holds their shape, and CI's edge list
  (`next/apps/fabrika/src/exam/edges.ts`) shows the owner each new one, as it does for every edge.

Is anything here a setting? The five folders are which version of the repo is new work, which `AGENTS.md` fixes; the
exemptions are reasons, not values. Neither is a value a user would turn, so neither is a `fabrika.toml` key.

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run oxlint-plugins/config-blocks.test.ts` red on main's config (B1 lists
  the drops above, K1 names `kalfa/ci`, `kalfa/quality`, `kalfa/records` and `kalfa/secrets`), then green after its
  own config edits. `pnpm lint` then red on the 10 findings in product files only, which its plant record names.
- Build step: `pnpm lint` green; each plant above run once and undone.
- `oxlint-plugins/**` and `.oxlintrc.json` select every test, so each step names its test files:
  `oxlint-plugins/config-blocks.test.ts`, `oxlint-plugins/plants.test.ts`, `oxlint-plugins/one-rule.test.ts`, and the
  kalfa tests whose helpers were renamed (`kalfa/records/src/Runbooks.test.ts`, `kalfa/secrets/src/Errors.test.ts`,
  and the `kalfa/quality/src/stryker/` tests). CI runs the rest.
- The lead's own one typecheck covers the renames.

## Size

1. One pull request: about 35 product lines (five renames, five edge lines), about 850 lines of `.oxlintrc.json`,
   nearly all entries copied from the blocks above them, and one new test file of about 300 lines. It lands whole: the
   check is red until every drop is fixed or exempted, and the four packages fail lint until the fixes are in.

About 2 agent hours across tests, build and review, 80% sure. The doubt is the tests step's JSON: 26 blocks to edit by
hand, which may take one send-back. Basis: Opus steps at about $9 each, a little over the $7 to $8 a step of
mostly-copied work in `.kalfa/quests/kalfa-quality-vitest-PLAN.md`, for the larger config edit: tests, build, review,
and one likely send-back.

Estimate: 4 steps, $36

## New names

None in a glossary. The test's names (`Ban`, `Exemption`, `Drop`, `reaches`, `specifier`) are code-local plain words.
"Exemption" is the word the config's own comments already use for such a block.

## Records

- The tryout's answer goes in the new test's top comment, where the next agent who writes a block reads it: oxlint 1.90
  takes the last block's entry whole, and a severity-only entry drops every option. The lead posts the same lines on
  both tickets.
- The 2380 count (17 findings, by rule and file) is in this plan and in the pull request body.
- No decision record: the repeat rule is already the config's written convention, and the check holds it.

## What fact is lost if it is not recorded now

That oxlint drops options on a severity-only block, unlike ESLint. Every agent knows ESLint's rule and would write
`"error"` in a later block thinking it keeps the bans. Only the tryout showed otherwise, and without the test's comment
the next block writer finds out from a hole like 2369's.

## What this cannot tell us

- A ban is tried with one specifier per glob (`x/settings/TomlParser.ts` for `**/settings/TomlParser.ts`). A later block
  that bans that one string but not every string the glob matches would pass B1. No block in the config does that
  today, as far as the prototype shows.
- `allowTypeImports`: a later block that lets type imports through bans the planted value import, so B1 does not see
  that loosening. Three entries use it today.
- Which blocks reach a file comes from `node:path`'s `matchesGlob`, not oxlint's own glob code. A mismatch shows as a
  red line (a ban expected where oxlint gives another block), not as a silent pass, except where both readings pick
  blocks that agree by chance.
- A repeated entry with a different message passes: the check reads bans, not their words.
- Whether the six `next/` repeats belong here or in their own pull request is the lead's call (top of this plan).

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
2. **The hand repeats are the root cause.** About 850 of this plan's lines are entries copied into later blocks. Oxlint
   1.90 can read a JS or TS config (experimental, per `oxlint --help`), where each block could spread shared ban lists.
   71 files name `.oxlintrc.json`, many of them tests that copy it, so the move is its own pull request. Ready ticket: "Lint: build the
   repeated import bans from shared lists, so a later block cannot drop one."
3. **Today's version has the same drops,** not judged here since it is frozen: `scripts/vitest.setup.ts` and
   `scripts/testhome.ts`, `apps/fabrika/src/host/settings.laws.test.ts` and `programs/trace/src/**` lose bans the root
   entry or `next/**` block sets. `apps/fabrika/test-window.ts` and `packages/fabrika-design/src/build/**` lose theirs
   on purpose.
