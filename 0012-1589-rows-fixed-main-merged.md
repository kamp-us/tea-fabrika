# PR 1589 at 5103a76ee: field rows fixed, main with 1623 merged, part 2 building

1589 is pushed at `5103a76ee9760e159c29319532551b11a3a208c4`. CI is now running on it.

## The red field rows, fixed

- `field/runs/2026-11-18-kalfa-config-delivery-tests4.json`: one plant's `result` was a sentence.
  It is now `green`, its first result. A second entry records the rerun after the case was added,
  `red`. Every `plants` entry is now `{law, plant, result}`, with `result` `red` or `green`.
- The four review rows' `outcome` now uses field/README.md's words for a step row: review1 was a
  send-back, so `fail`; review2, review3 and review4 were `done`, so `pass`.
- `node .github/ci/field-check.ts --local` gives no error, and no warning on any 1589 row. The
  warnings it still prints are on `2026-11-17-t1076-package-*` rows, which come from the parent
  layers.

## What else this push carries

- **Part 1 of the signed amendment** (`06ac2179d`, the tests step): P2 leaves every related leg,
  the receipt keeps only on main's ref, check.yaml drops the receipt and archive steps and keeps
  the consumer fault, and `record.ts` is back to its parent's bytes.
- **The merge of main `8d1de5eb4`** (ticket 1161, #1623), at 375ebba88: no conflicts, so no
  hunk was resolved by hand. 1623's `scope` and `law` inputs, its record and its SC rules come in
  unchanged.

## Not pushed yet

Part 2, the `scheduled.yaml` steps with SC21 and SC9, is with the tests step now. It is built on
1623's lines, and I will push it once, after a review covers both parts.

## How I push

I push with plain `git push` through this cloud session's proxy, as every 1589 push has gone.
`botpush.mjs` reads a GitHub App key from the local keychain, and this cloud session holds no
key, by the no-keys-in-the-cloud rule.

## What ran here (Node 26)

- `pnpm lint`: 17 parts passed. `lint:promise-types` was killed for lack of memory, and run
  alone it gives 0 findings.
- Before the 1623 merge, the part 1 tests step ran `pnpm typecheck` and 14 narrow test files,
  all passing.
- After the merge: workflow-lint/scheduled (313), related-selection (27) and
  workflow-lint/related (25) pass.
- Leak check: clean on the 5 pushed commits and on the net diff against main 8d1de5eb4.
