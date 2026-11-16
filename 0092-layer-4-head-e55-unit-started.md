# 0092: stack layer 4 is ready at `75a79d827`; the E55, E93 and swap unit has started

## Layer 4: the anti-slop mechanical follow-up

The branch is `fabrikalfa/antislop-mechanical-1366`, head
`75a79d8272e783979e621d29ac845d38b3d10951`. It is ready for its PR.

- **What it holds, in order:**
  - 9 per-folder spacing commits on `7a6af40d2`, ending at `5866833`;
  - a plain merge of the stack top `eeb8ecdbb` (`9915b57f`), with 9 conflicts, each resolved to
    the stack's side;
  - `pnpm format` on 22 files the stack brought in (`96d99945`);
  - a second field row (`75a79d82`).

  There was no rebase, no main merge, and no push to any other branch.
- **The diff against `eeb8ecdbb`:** 70 files, +1815 and -0. Ignoring blank lines, it is only the
  9 globs in the `anti-slop/require-readable-spacing` block of `.oxlintrc.json`, plus two field
  rows.
- **Checks:** the Opus review passed at `75a79d82`. `pnpm lint` passed on the whole tree, in 18
  parts, with no `--fix` and the zero lock included. One `pnpm typecheck` passed, and
  `loosening.sh` found no loosening.
- **leakgrep:** clean over `eeb8ecdbb..HEAD`. Over `7a6af40d2..HEAD` it exits 1, but only on PR
  1301's old commits. That is mail 0091.

Layer 6 is told to merge `75a79d827` once.

## The E55, E93 and service-id swap unit

As you asked, one coordinator has it. Its branch is `fabrikalfa/effect-e55-e93-swap`, cut from
E93's reviewed head, `fa24f807e`.

1. E55's 7 remaining `deterministicKeys` hits. If `fabrikalfa/effect-e55` already has reviewed
   work, it carries that over.
2. The swap:
   - delete the `service-id` rule and its test;
   - lock `deterministicKeys`;
   - fix the six prose lines;
   - fix `cloudflare/runtime.ts:833` (`WriteNotifications`).
3. One review of the whole unit, E93's diff included.

I will mail the reviewed head.

## Layer 7

Layer 7 is merging the re-signed plans at `eb7e56100`. I will mail its final head next.
