# Main's fault catalog pins a commit that main does not have. Route (c) is withdrawn

K1 found a deeper cause before writing the re-bind, and I checked it here.

**Facts, verified on origin/main:**
- `.github/ci/plant-related.ts:16` takes the catalog commit from
  `cases["checklist-body"].source`, which is 3ca406a62f5f, a branch commit of PR 1543.
- At lines 253-255 it then requires `merge-base --is-ancestor <catalog> $GITHUB_SHA`. That runs
  **before** the byte and hash checks.
- **3ca406a6 is not reachable from origin/main at all.** My fetch of main does not even contain
  the object, because 1543 was squash-merged.

**So every PR whose change selects the ten checklist fault cases fails the `checklist faults` step
on today's main,** before any fault runs: any PR touching that fixture or `plant*.ts`.
- 1525 hit it, and its two blank lines are not the cause.
- 1581's own runs passed because 3ca406a6 was on its branch.
- This is a main-side defect from #1581.

**Why route (c) cannot hold:** re-binding to a 1525 branch commit would pass 1525's PR check.
But the merge queue squashes, so that commit never reaches main either. The step would then fail
in the queue, and on main for every later fixture PR. The binding has to survive a squash, by
bytes (sha256s of the fixture and manifests) or by a commit that is on main. That is a fix to the
runner, ticket 1155's code.

**Decided, per K1's lean (e) plus (d):**
- **(e)** 1427 lands alone first. It does not touch the fixture and is green; its queue go stands,
  with your stack condition.
- 1525 holds. It writes nothing until the binding fix is on main. Then it merges main, re-binds to
  the spaced bytes if the fix still needs that, and gets a fresh review.
- **(d)** the binding fix itself. **I need you to say who does it.** Options:
  - a child of mine when a slot frees (the cap of 7 is full now)
  - your laptop agents
  - Codex, if its 1155 owner is still around

  `plant-related.ts` and `plant-cases.ts` are not on K2's 18 paths. `check.yaml` is not touched.

**One thing the laptop can settle:** K1 could not read the run's result artifact, because the
proxy refuses the artifact host. It is
https://github.com/kamp-us/tea-fabrika/actions/runs/44210743213/artifacts/14387856455
(`checklist-faults-1/result.json`). Its `reason` field should name the ancestry check. K1 is
about 90% sure from the code path.

**Ticket text, for when the tracker is back:**

> **Title:** Fault runner's catalog pin names a squashed-away branch commit, so every
> fixture-touching PR fails
>
> **Body:** `.github/ci/plant-cases.ts` pins `checklist-body.source` (and the other nine checklist
> cases) to 3ca406a62f5f5a7e4300ebc8cd5c3918ecbf64db, a PR 1543 branch commit that is not an
> ancestor of main. `.github/ci/plant-related.ts:253-255` requires the catalog to be an ancestor
> of `GITHUB_SHA`, so the automatic `checklist faults` step fails for any PR that selects these
> cases, before any fault runs. Seen on PR 1525 at 6d1173da:
> https://github.com/kamp-us/tea-fabrika/actions/runs/44210743213/job/134489632974 (integration
> 440 of 440 passed, then `checklist faults` exited 1 in 3.5 s and the run canceled itself). Fix:
> bind by bytes (sha256 of the fixture and manifests) or by a commit reachable from main after
> squash; do not require a branch commit to be an ancestor.

**Effect on the stack:** 1583 and 1589 sit on 1525, so the whole kalfa landing now waits on (d).
1427 is the only layer that can move today.

Children active: 7.
