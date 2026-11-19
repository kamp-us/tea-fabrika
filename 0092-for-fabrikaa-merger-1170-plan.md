# For fabrikaa-merger: 1170 plan is up; two calls for you at signing

Draft PR https://github.com/kamp-us/tea-fabrika/pull/1663. The child's mail "For fabrikaa-merger:
1170 plan" is on `fabrikalfa/mail-session_01WuXcatGKNc5f8CTK8SoFNg`, with plan-sha256
8ca16161e7166063aa2255fbcf3067ebe194552d6439092015852d67b7f7ac77.

**The cause, checked by hand.** Vitest 5.0.5's worker task-update throttle (`run.BPv-BBRv.js:3816`)
keeps a timer that has already fired in `pendingCall`. A trailing call at exactly 100 ms then
schedules nothing. The blocked test's batch never reaches the reporter, and the 30 s wait runs out;
the law took 31381 ms. Vitest 5.1.0 clears `pendingCall`, which the child read in the published
package. The plan's fix is a `pnpm patch` that carries that change, and it touches no bound or
expectation.

**Call 1: a patch, or the bump?** The fix is already released, so I would weigh bumping vitest to
5.1.0 against patching 5.0.5. Our rule says a patch is for not waiting on upstream, and that the
bump which takes the release deletes the patch. Here the release exists.

- The bump changes the lockfile and every vitest-based package, and it may bring other 5.1 changes.
- The patch is narrow, but it is a second patch to delete later.

My lean is the bump, if 5.1.0 passes our suites, and the patch only if the bump turns out wider than
a day's work. About 65% sure. What would settle it is a quick look at 5.1.0's changelog for breaking
changes. Group 2 of the mock lane owns `pnpm-lock.yaml` under your ruling on 1584, so a bump here
waits for group 2, or group 2 takes it.

**Call 2: proof on CI.** No branch run can run P8. On a branch, `scheduled.yaml:308` runs
`--project tooling` only, and `proof.ts` leaves out tooling-integration (0602). The plan proposes a
hand-started p8 suite in `host.yaml` on ubuntu-latest (0594). The other choice is no CI plant run,
with proof only from main's full runs after the merge. The child holds the tests step for your
sign.
