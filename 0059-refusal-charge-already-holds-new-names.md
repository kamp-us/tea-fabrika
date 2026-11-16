# 0059: the refusal-charge law is green on main (two calls for you); New names rolled out

## Refusal across the hour: the law holds on main already

The coordinator stopped after the tests step and needs your call. No build has run, no review, and
no PR is open.

- **The law** is pushed on `fabrikalfa/refusal-hour-charge` at `f27c48bd9`, under ticket 404, since
  the finding names none. Leakgrep is clean.
- It is a property in `next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts` ("P34c live
  object accounting"): a refused send whose span crosses the hour leaves the program's local writes
  and bytes unchanged, and the refusal is counted under the hour its span ended in.
- How it is built: `Date` is frozen with a scoped `vi.useFakeTimers` inside `Effect.acquireRelease`,
  and a test-world hook on the Project transport moves the clock across the hour when the crossing
  refusal's route arrives. It needs no product seam.

**It is green on main's product code. The finding blamed the wrong cause.**

- A refused send only reaches the Project's route. The door's room check
  (`next/packages/libfabrika/src/gateway/Gateway.ts`, `roomFor` / `no("quota")`, about line 1270)
  refuses it before any Process call, so a refusal never charges the Process's local account.
- The finding's write going from 15 to 16 is the **supervisor's healthy mark**
  (`next/packages/libfabrika/src/runtime/internal/supervisor.ts:601-604`). Once `resetAfterMs`
  (5000 ms) has passed since `healthyAt`, the next idle turn saves the journal again, and
  `RecoveryStore.ts:278` charges that as one 0-byte write.
- The finding's run jumped the clock about an hour, and the hour itself played no part. With a
  frozen clock and no hour turn:

  | Clock jump | Writes | Bytes |
  |---|---|---|
  | 1 s | unchanged | unchanged |
  | 4 s | 15 | unchanged |
  | 5.1 s | 16 | 934 |

- **Plants:** each of these turns the law red, the first with the finding's exact numbers
  (`expected writes 16 to deeply equal writes 15`):
  1. the healthy handler also saving on the first idle turn of a new hour;
  2. a room check that never refuses.
- **Runs:**
  - the whole law file ran in the box with no override: 14 passed, 0 failed, at `f27c48bd9`;
  - the new law alone passed at full depth (40 runs);
  - `worker-quotas.integration.test.ts` was not touched or run.

**Two calls for you:**

- **(a) Land the law as a guard anyway?** It would go in one PR that closes the finding as "already
  holds; the extra write is the healthy mark". My lean is yes, at about 80%: it pins a behavior no
  law held before. It also needs a build step that changes nothing and checks green, a review, and
  the quota files in the box.
- **(b) Should a program pay for the supervisor's healthy-mark write?** Your ruling on refusals does
  not cover this. My guess is that it is a design call for the owner.

## `## New names` (0587): rolled out

- It is in the twin's `step-rules.md`, so every step that writes a PR body includes it.
- **The owning coordinators** got the rule, to apply now or at their next body update: 1427 (kalfa,
  in its rename round), 1431 (tea-s2, at its push), 1494 (reflect), 1497 (0580), 1504
  (exam-to-lint), 1505 and its three integrator PRs (0113), and 1506 (typecheck).
- **One job adds the section** to the three PRs whose coordinators are gone: 1491 (mock plans),
  1501 (mechanical fold) and 1510 (leakgrep). Each gets a real cited source per name, or "None.".
- **1498** you already fixed. The refusal-charge PR, if it opens, gets the section from the start.
- I also told the 0113 coordinator that PR 1454 is merged, so its S10 (plancheck) slice can start.
