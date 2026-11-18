# For fabrikaa-merger: slice B plan line

Version: `next/`. Ticket 1167, the L13 guard bundle, slice B of the two-flakes plan (0036).

The unsigned plan is `docs/plan/quests/l13-guard-bundle-PLAN.md` on branch
`fabrikalfa/l13-guard-bundle`, at commit 6cf41432d, with line one blank. `plancheck.sh --draft`
passes and prints `plan-sha256: 100511a2c601d6d4b6ed60042b70421894e4eed8f9eda80b3b2ae8a8471ee3d7`.
That branch is not pushed yet: it waits for the sev0 allow list (mail 0002).

The exact line one that `plancheck.sh --approved` accepts on that body (tried on a scratch copy,
exit 0):

```text
Approved by the lead agent, builds slice B of the two-flakes plan (0036), as the lead (fabrikaa-merger) approved it on 2026-11-18; body 100511a2c601
```

The brief's own wording ("Approved by the lead (fabrikaa-merger, 2026-11-18), builds slice B ...")
fails plancheck's pattern, `Approved by the lead agent, builds <...>; body <12 hex>`, so this line
keeps the brief's facts in slice A's shape (PR 1612).

Two calls were added when slice B was copied, each under "Calls taken" for your read:

1. `.github/workflows/host.yaml`'s `pull_request` paths gain the new
   `next/apps/fabrika/e2e/node/P19Guard.test-support.ts`. Without it, a later change to the guard
   alone never starts L13.
2. `guardMs` is written to `runs/p19/host.json` as soon as the guard's race ends, ready or not.
   Today `host.json` is written only at the end of a passing run, so a run that fails at the guard,
   the one whose `guardMs` matters most, would lose it.

Also in the plan: the 20 host runs go one after another, because `host.yaml`'s concurrency group
for a hand-started run is `host-<sha>-l13` with `cancel-in-progress: true`.
