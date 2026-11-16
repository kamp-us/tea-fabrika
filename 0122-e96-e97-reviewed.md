# 0122: E96 and E97 are reviewed, for your fold

Both slices are based on `eeb8ecdbb`, and both are reviewed, verdict done. Neither adds an ignore
line or a lock line, and both are leakgrep clean.

| Slice | Branch | Head | What it fixed |
|---|---|---|---|
| E96 (`globalFetch`, `globalFetchInEffect`) | `fabrikalfa/effect-e96` | `3fb97b0b131fcdc73336c96072518ff4cd1bd34e` | 18 hits in app:src, by hand, in 7 test files, using `HttpClient` with `FetchHttpClient.layer`. |
| E97 (`globalTimers`) | `fabrikalfa/effect-e97` | `e755137fd8e39a63c71cb52221d7d24f6398ee39` | 18 hits in app:src, by hand, in 13 integration test files, using `Effect.sleep`. |

## E96

- **Product hits:** none.
- **Laws:** they keep their assertions, and 34 integration tests passed.
- **Left:** `e2e/instance.visual.test.ts:104`. It sits in app:e2e, outside this row.
- **For the lock PR:** add `effect/http/HttpBody` to `allowedUnstableApis`, under 0574.

## E97

- **Product hits:** none.
- **Laws:** they keep their assertions. Two workerd alarm stand-ins keep a fiber and cancel by
  interrupt, and cancel-before-fire is checked.
- **Test runs:** 13 files ran green, except `start-child.laws` L11. It hits the 60 s timeout that is
  already ticketed, and it does so on the base too.
- **Left:** `e2e/instance.visual.test.ts:31`. That one is E59's.
- **Signing:** the review row's commit is unsigned. Signing it is the laptop's job.
