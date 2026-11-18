# For fabrikaa: L11 split into 16 parts, the plant and repeat proofs

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1616, branch `fabrikalfa/l11-template-copy`, head `c1b4ac212db364797b623779788269007d4d9a4f`. The law is in `next/`: `next/apps/fabrika/src/start-child.laws.integration.test.ts`. Measured in one cloud box, as in mail 0001.

## The answer

- **Plants.** The two plants turn red exactly the parts their leaks fall in, and the counts add up to the whole law's.
  - **Reply plant:** 5 of the 16 parts go red, with **59 leaks in all, as with the single law**: fresh 4, saved 3, recovery 27, migration 21, configuration 4.
  - **Span plant:** 9 of the 16 parts go red, with **172 leaks in all, as with the single law**: exit 93, status 7, isLive 7, info 7, resolve 7, receive 8, object 7, read 4, append 32.
  - Each flow's count equals that flow's count in the single law's leak list from mail 0001.
- **Cherry-picks.** Neither needed hand resolution. Both applied cleanly onto `c1b4ac212`; see "The scratch branches" below for why the span pick did too.
- **Repeats (0036).** **10 of 10 runs passed**, all 16 parts in every run. The slowest part was **recovery in 8 runs and migration in 2**.
  - **Slowest part: median 11.2 s, max 15.0 s.**
  - **All 16 parts together: 41.7 s to 57.6 s per run.**

## The scratch branches

Both scratch branches were local only, cut from `c1b4ac212`, and never pushed:

- `scratch/l11-reply` = `c1b4ac212` plus `8485747d1`, as `332f87958`.
- `scratch/l11-span` = `c1b4ac212` plus `3232378da`, as `8bc63045e`.

**No hand resolution was needed for either.** `3232378da` was written on top of the reply plant, so it also turns the reply plant's line back into main's. Cherry-picked alone, git's three-way merge kept main's line for that hunk. The span branch's diff against `c1b4ac212` is then only the span change: the `fab.ledger.code` filter in `projectStorage`'s tracer is removed. The reply branch's diff is only the `catchDefect` line. The diagnostics commit `d0eee07e6` was left out: it changes the single law that `c1b4ac212` replaced, and it is not needed for this proof.

## The command

```sh
pnpm install --frozen-lockfile
FABRIKA_TEST_DEPTH=full nice -n 15 pnpm exec vitest run --project next-integration --maxWorkers=1 \
  --reporter=default --reporter=json --outputFile.json=<scratch file> \
  next/apps/fabrika/src/start-child.laws.integration.test.ts -t "storage"
```

This is the asked command with one addition: a JSON report, which gives each test's own time. Node 26.13.0, the repo's pin. One install per checkout, then one run at a time.

`-t "storage"` matches **32 tests, not 16**. It finds the 16 parts, and also the 16 older per-output L11 laws, named "Project.processChild ... failures keep storage text and metadata out of reply / span / row / log" and the same for processExit's exit flow. Both groups are reported, apart.

## Plants, per part

| Part (flow) | Reply plant | Span plant |
|---|---|---|
| fresh | red, 4 | green |
| saved | red, 3 | green |
| already | green | green |
| ended | green | green |
| recovery | red, 27 | green |
| migration | red, 21 | green |
| configuration | red, 4 | green |
| exit | green | red, 93 |
| status | green | red, 7 |
| isLive | green | red, 7 |
| info | green | red, 7 |
| resolve | green | red, 7 |
| receive | green | red, 8 |
| object | green | red, 7 |
| read | green | red, 4 |
| append | green | red, 32 |
| **all 16** | **5 red, 59** | **9 red, 172** |

Each red part's failure reads, for example: `L11: 157 recovery storage operations were cut; storage text or metadata reached these outputs: expected [ …(27) ] to deeply equal []`. The count is the `…(N)` in that line. Vitest folds the list, so the leaks themselves are not printed. These per-flow counts are the same as the per-flow counts of the single law's full leak lists in mail 0001, flow by flow:

- reply: configuration 4, fresh 4, migration 21, recovery 27, saved 3;
- span: append 32, exit 93, info 7, isLive 7, object 7, read 4, receive 8, resolve 7, status 7.

The older per-output laws also went red, each with `Property failed after 1 tests`:

- Reply plant: 3 of the 16. These are the reply laws of processChild's descriptor, recovery and configuration flows. processExit's exit-flow reply law stayed green.
- Span plant: 1 of the 16, processExit's exit-flow span law.

Run totals: reply plant 8 failed and 24 passed, in 201.9 s (wall 210.8 s). Span plant 10 failed and 22 passed, in 220.0 s (wall 221.3 s).

## Repeats on `c1b4ac212`, no plant

| Run | Result (32 tests) | Slowest of the 16 parts | 16 parts together | Slowest of all 32 | Wall |
|---|---|---|---|---|---|
| 1 | pass | recovery, 15.0 s | 57.6 s | processExit exit -> span, 24.3 s | 251.4 s |
| 2 | pass | migration, 13.0 s | 51.1 s | processExit exit -> span, 22.7 s | 230.4 s |
| 3 | pass | recovery, 10.8 s | 46.4 s | processExit exit -> span, 22.7 s | 222.7 s |
| 4 | pass | recovery, 10.9 s | 44.0 s | processExit exit -> row, 25.3 s | 240.6 s |
| 5 | pass | recovery, 12.5 s | 49.3 s | processExit exit -> span, 27.4 s | 249.5 s |
| 6 | pass | recovery, 11.5 s | 47.6 s | processExit exit -> span, 24.6 s | 255.3 s |
| 7 | pass | recovery, 10.8 s | 44.9 s | processExit exit -> span, 28.8 s | 244.8 s |
| 8 | pass | migration, 10.8 s | 46.0 s | processExit exit -> span, 25.4 s | 237.8 s |
| 9 | pass | recovery, 13.2 s | 49.3 s | processExit exit -> span, 23.9 s | 242.4 s |
| 10 | pass | recovery, 9.9 s | 41.7 s | processExit exit -> span, 24.8 s | 227.1 s |

- Slowest of the 16 parts: **median 11.2 s, max 15.0 s**, which is 25% of the 60 s cap at its worst.
- Slowest of all 32: median 24.7 s, max 28.8 s, always one of processExit's exit-flow laws, which this pull request does not change.
- Wall: median 241.5 s, max 255.3 s.

No run failed, so 0036 found no flaky test here.

## What this cannot tell us

- **One box.** This is a 4-core cloud box, not a CI runner. Times moved by about 1.4 times between runs: the 16 parts took 41.7 s to 57.6 s together. CI's own times are the ones that set the room under the 60 s cap there.
- **Where the shared layer's time goes.** The template and the inventory are built once, in the `@effect/vitest` layer for all 16 parts. The JSON report gives tests' own times, and this report did not check whether that build is counted in the first part, in a hook, or nowhere. If it lands in a hook, its time is under the 60 s hook cap, which this run does not show.
- **The leaks' names per part.** Vitest folds the list, so only counts per part are proven here. That these are the same leaks rests on the counts matching flow by flow with mail 0001's full lists, not on a line-by-line comparison.
- **Ten runs is a small sample** for a flaky failure that comes once in a hundred.
- **Row and log.** As in mail 0001, neither plant leaks to `row` or `log`, so these runs do not show that the parts catch a leak there.
