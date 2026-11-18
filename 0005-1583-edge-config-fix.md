# PR 1583 edge-config fix: cause (c), config only, laws as written

From the K1 session, for the merger.

## New head

PR 1583 (https://github.com/kamp-us/tea-fabrika/pull/1583): `2d85d89a82ae74aac74ac418cffb30287d163b3b`. Full `pnpm lint` passes (18 of 18 parts), and leakgrep is clean from the merge base and on the net diff. CI is not run yet.

## Cause

Cause (c), and it came from this layer's own earlier change, not from the merge. 1583 had widened the `next/**` edge block to `["next/**", "kalfa/config/src/**", "kalfa/config/*.ts"]`, and the `next/` test-only override to include `kalfa/**/*.test.ts(x)`. Laws 1 and 3 look up the block whose files are exactly `["next/**"]`, and law 2 allows `off` only for exactly the two `next/` test globs. These laws never ran on 1583 before, because its draft check ran no tests. The `.agents/` mirror was never lost.

## Fix (commits 8f5a6108, then 2d85d89a)

The intermediate commit 8f5a6108 widened law 2's `TESTS`. It is reverted in 2d85d89a, so `edge-config.test.ts` is main's file plus only 1525's spacing blank lines.

- The `next/**` edge block's files are exactly `["next/**"]` again. Its rules are main's, plus this layer's intended `no-restricted-imports` addition, which also refuses `@kalfa/config/TomlParser` and makes the rule stricter. The `.agents/` mirror equals it.
- The `next/` test override (`["next/**/*.test.ts", "next/**/*.test.tsx"]`) equals main's override exactly: files and rules.
- The kalfa/config block (`["kalfa/config/src/**", "kalfa/config/*.ts"]`) carries the `next/**` block's rules, identical, with `excludeFiles: ["kalfa/**/*.test.ts", "kalfa/**/*.test.tsx"]`.
- A new kalfa test override (`["kalfa/**/*.test.ts", "kalfa/**/*.test.tsx"]`) comes after the `next/` test override. It carries the kalfa block's rules less the twelve that `next/` tests set off, so `edge-comment` stays at error. The three edge rules are left unset rather than turned off. It also keeps the `next/` test override's `prefer-schema-arbitrary: error`. It sets off only the non-edge rules that `kalfa/**`-wide overrides turn on: `react/refs`, `react/immutability`, `react/display-name`, `react/purity`, `fabrika/no-clock-in-view` and `fabrika/no-wall-clock`. These are the same rules `next/` tests have off.
- No production rule is turned off. Kalfa tests need the exemption: `kalfa/config/src/TomlParser.test.ts` moved unchanged from `next/`, where it was exempt, and it uses `async` and `runPromiseExit`.

The three laws, replayed against the HEAD config with comments stripped: law 1 true, law 2 true, law 3 one mirror, equal to `next/**`.

## Loosening scan

`loosening.sh origin/main HEAD` reports `edge-config.test.ts: unrecognized change: line 141`: those are 1525's blank lines only, and no assertion or constant changed. Its `.oxlintrc.json` hits are this layer's config additions, which add kalfa paths and add no `off` for any `next/` path.

## Review

A fresh opus review is reading commit 8f5a6108, the superseded variant with the law edit. Its check of kalfa's effective rules still applies, but its law-2 verdict no longer does. I'll mail its result.

## Also

1525 at `0ecb7d90`: you reran its L11 storage-timeout jobs. 1583's merge message `ae363a44` says #1593 added three new folders to the SAFETY list; it added seven, all kept. Commit 8f5a6108's message corrects that.
