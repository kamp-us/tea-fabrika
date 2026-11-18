# PR 1525 is green at c6c750e4; what the tezgah focus red was, and the stack state

From the K1 session, for the merger.

## Green head

PR 1525 (https://github.com/kamp-us/tea-fabrika/pull/1525) head `c6c750e4c3697d5dbf471b4f1bdd5ba6ee57f20b`: check run https://github.com/kamp-us/tea-fabrika/actions/runs/44247206536 passed. Every job is a success: `ci-required`, `check`, `typecheck`, `select`, `next` 1 to 3, `next (e2e-1)`, `next (e2e-2)` and `related` 1 to 7. The tezgah focus L28/L30 and fold L33 laws passed in the end-to-end legs. 1525 holds main `f79fc38d`.

## What the red was, and what it was not

The two red attempts of run 44243295809 at `3ec74923` both waited on `getByRole('region', { name: 'checklist, t2', exact: true })` at `next/apps/fabrika/e2e/tezgah.test-support.ts:161`. The region was in the ARIA snapshot but never gave a bounding box within 30 s. The attempts differed: attempt 1 also failed fold L33, and attempt 2 passed it. Main's passing full run 44242548956 took 31.5 s for `tezgah-focus` against that 30 s per-call limit.

It was not a resolution or spacing change in behavior:

1. The hand-resolved files take main's code exactly, with zero non-blank lines against main. They are `cloudflare/runtime.ts`, `runtime/Runner.ts` and `telemetry/Sink.ts` from #1591 (Sink batching and the once-per-step lifecycle read as #1591 wrote them), and five test files from `f79fc38d`. The spacing rule's own fixer added blank lines on top.
2. 1525 changes no file under `next/programs/`, `next/packages/tuval/`, `next/packages/libfabrika/src/client/` or `desktop/`, and no tezgah or window file. Its changes in `next/apps/fabrika/` are test and test-support files only, so no function sent to the browser changed.
3. Against main, 1525's only non-blank changes are `.oxlintrc.json`, the two generated separators in `oxlint-plugins/prefer-schema-arbitrary.test.ts`, and field rows.

The head that turned green adds only the merge of main `f79fc38d`, which itself edits `tezgah-focus.visual.test.ts`, plus blank lines. My read is a scenario that runs close to its time limit. That is about 80% sure, because I could not run the visual laws here (Node 22, no Electron). It is an open question for the tezgah law's owner, not a 1525 fault.

## Stack

- PR 1583 (https://github.com/kamp-us/tea-fabrika/pull/1583): head `51acff46b`, a merge of 1525's green head. Full `pnpm lint` passes, 18 of 18 parts, and leakgrep is clean from the merge base. It is still a draft, so its own check runs lint and typecheck only. Its five shard laws were fixed at `be477b33` and passed in run https://github.com/kamp-us/tea-fabrika/actions/runs/44232835828. #1569 deleted a row from `vitest.shards.full.json`, so those laws need a rerun on the new head. That comes from 1589's next run.
- PR 1589 (https://github.com/kamp-us/tea-fabrika/pull/1589): still at `429c7dff`, which lacks 1525's and 1583's new heads. It needs `51acff46` merged in (watcher or K2), then its check. I do not write 1589.
- Not yet "every layer green": 1525 is green; 1583 and 1589 wait for that 1589 run.
