# 0101: E85's six integration files all pass at `f77aafc6e`

The six files E85 touches all pass in a fresh box, at `f77aafc6ef48053b0537011920b8fbba8e448a33`
on `fabrikalfa/effect-e85`. None failed, none were skipped, and the 0178 guard refused none.

| File | Passed | Failed | Duration |
|---|---|---|---|
| `next/packages/libfabrika/src/ledger/Ledger.integration.test.ts` | 31 | 0 | 1.32 s |
| `next/packages/libfabrika/src/ledger/LedgerSpans.integration.test.ts` | 16 | 0 | 1.13 s |
| `next/packages/libfabrika/src/ledger/Log.integration.test.ts` | 41 | 0 | 2.07 s |
| `next/packages/libfabrika/src/ledger/Rings.integration.test.ts` | 10 | 0 | 0.73 s |
| `next/packages/libfabrika/src/ledger/LedgerTurnReads.integration.test.ts` | 1 | 0 | 1.90 s |
| `next/packages/libfabrika/src/node/ledger/LedgerStreams.integration.test.ts` | 2 | 0 | 6.08 s |

## How it ran

- **The clone:** it was shallow, so the box ran `git fetch --unshallow origin` first.
- **Node:** v26.13.0, from `/opt/node-v26.13.0-linux-x64/bin`.
- **vitest:** v5.0.5. Each file ran once, from the repo root, with
  `nice -n 15 pnpm exec vitest run --maxWorkers=3 <path>`.
- **No override:** neither `CI` nor `FABRIKA_HOST_RUN_OWNER_APPROVED` was set.
- **Order:** the last five files went in one batch, but their start times show each run finished
  before the next began.
- **Nothing changed:** no file was edited, nothing was committed or pushed, and no field row was
  written.

With your review at `f33dbeda4`, E85 is merge-ready.

## Still running

- **E89's box:** 12 files.
- **E86's box:** every changed `.integration.` file.
- **E83:** a fourth box runs its 25 files at `dfd033025`, in parallel rather than after the
  others, since every box is free to use.

I will mail their counts as they land.

## The lock-PR finding is noted

E85's new `Arr` import makes `NodeSqlite.ts` an Effect-importing file. So
`fabrika/no-raw-try-catch` now advises on its correct sync `node:sqlite` try/catch at line 59.
Whoever brings `src/ledger` to zero needs one of two fixes:

- a reasoned disable at that edge;
- keeping the file free of Effect imports.

I have added this to the judgment fold's notes for the lock PR.
