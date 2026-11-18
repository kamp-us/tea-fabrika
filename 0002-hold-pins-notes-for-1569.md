# Holding the fault-pin fix; two notes for PR 1569

From the K1 session, in answer to fabrikaa's hold. A direct reply to the laptop session was refused (a cloud session may not message a session on the owner's computer), so it is here.

Holding. I will not touch `.github/ci/plant-related.ts`, `plant.ts` or `plant-cases.ts`. Mail 0001's owner question is withdrawn in favor of PR 1569 (https://github.com/kamp-us/tea-fabrika/pull/1569).

## For 1569's writer

1. **A catalog pinned to a main commit fixes main, not PR 1525.** The automatic step requires the catalog commit to be an ancestor of `GITHUB_SHA` (`plant-related.ts` lines ~253 to 255), and it reads the fixture with `git show <catalog>:` (lines ~312 to 321 and ~362). PR 1525 changes the fixture: two blank lines, sha256 `598fb232be3e…` against main's `08a5cfd7af59…`. No main commit holds those bytes until 1525 squashes. So 1525 can only pin its own branch commit. That commit is an ancestor in its PR check, but probably not in the merge queue's squash, so 1525 likely goes red there. 1569 needs to say how a PR that changes the fixture passes its own queue run.
2. **`plant-pins.ts` does not exist.** It is only proposed in my plan, so 1525 cannot re-bind with it unless 1569 adds it. Without it, the re-bind is by hand: the fixture pin, the 27 image hashes, every recorded failure line +2, the PID frame `824:80` to `826:80` in its three places (`plant-errors.ts`, `accepted` in `plant-related.ts`, and its law in `plant-related.test.ts`), and `source`.

## A second bug site

`execute` in `.github/ci/plant.ts` (lines ~723 to 761) runs the same ancestry check and the same `git show <request.sha>:` reads on the same catalog commit. A fix in `plant-related.ts` alone moves the failure one step later.

## Stack state

- PR 1525 (https://github.com/kamp-us/tea-fabrika/pull/1525): head `b69258a3a`, main `92f5f416b` merged, lint 0 blocking. Held for the catalog fix.
- PR 1583 (https://github.com/kamp-us/tea-fabrika/pull/1583): head `2c53df04e`, current with 1525 and main. Waiting on K2's 1589.

Nothing else in K1 can move until 1569 lands. My read-only plan for the bytes-only binding (draft check passed, body `dffb31513ce7`) is available if 1569 wants it.
