# For fabrikaa: pull request 1494's L4 fault came back a third time, which way?

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1494 (draft), branch `fabrikalfa/reflect-rest`, head `58f78f2816882417efb5502ad1dd487804538118`. Ticket 1056, the Reflect ban, in `next/` and our tooling.

## The question

Slice 15 folds the Reflect ban into the base lint blocks, so all of `next/` holds it and no folder list is left. After the fold, law L4 (`oxlint-plugins/advice.test.ts`) has missed the same fault three times, each time by a different glob shape. The fault: one glob added to the `JSON.parse` warn block in `.oxlintrc.json` strips `client/`'s `Effect.retry` and `Stream.retry` entries, or turns `JSON.parse` into advice where it blocks today, and every law stays green. Main's L4 refuses each of these globs today, so landing as is narrows a law on main. The lead skill says a fault that comes back a third time goes to the owner. Pick one:

1. **One more fix round, with a structural fix (my lean, about 80% sure).** Put the `client/**` block back after the warn block, as it stood before the fold, so `client/`'s entries win by block order whatever the glob shape. L4 then plants its sample at every tracked `next/` file's own path and name, not one sample per folder, so a file-kind glob meets the files it reaches. Cost: one sonnet fix round and one opus recheck. The doubt: a file kind that no tracked file has yet.
2. **Land the fold with the gap written down.** A finding row records that a file-kind glob in the warn block slips past L4. That is a known narrowing of main's L4, which "never loosen a gate" forbids, so I do not recommend it.
3. **Take slice 15 out of this pull request.** Revert the fold's commits on top and land slices 9 to 14 and 13 now, with main's L4 as it is. The fold, L10 and the new L4 become their own pull request. Nothing is loosened, and ticket 1056 stays open for slice 15.

## What happened

- Review 1 (`field/runs/2026-11-18-reflect-ban-s13-s15-review1.json`): sent back. After the fold, L4 read each block's entries, not the setting a file ends with. The glob `next/packages/libfabrika/**` stripped `client/`'s retry entries.
- Fix round 1, `76384f4ed`: L4 plants one sample per folder and reads oxlint's final severity.
- Recheck 1 (`...-review2.json`): merge-ready, with one finding. `next/apps/fabrika/e2e/**` moved `e2e/node` to advice.
- Fix round 2, `4dc340aab` (the lead's call, decision 0564): the `e2e` children count their own fires, which also closed `next/packages/libfabrika/*`.
- Recheck 2 (`...-review3.json`): sent back. `next/packages/libfabrika/src/**/*.test.ts` strips the retry entries in `client/` test files and turns `JSON.parse` into advice in `access/` test files. The one sample per folder, `zz-sample.ts`, never matches a file-kind glob.

## What is done and waits on nothing

- Main is merged in (`70dddec3e`).
- Plan amendment 8 is signed (`dc196e81e`).
- Slice 13 is done (`6cbd89720`): the app's `e2e/` folder is at zero and under the ban. The review found it sound.
- The main merge's hand-resolved hunks were reviewed. They lose nothing main changed.
- `next/AGENTS.md`'s row is updated (`2f87d96ca`). It is true only with the fold.

Until you answer, the pull request stays a draft, and I do not arm it.
