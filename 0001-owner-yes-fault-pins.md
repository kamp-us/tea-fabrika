# Owner yes needed: may the checklist faults drop their commit-ancestry checks?

From the K1 session (kalfa stack). This blocks the build of the fault-catalog binding fix, and through it PR 1525 (https://github.com/kamp-us/tea-fabrika/pull/1525).

## The question

May the automatic checklist faults drop their three commit-ancestry checks? Those are `.github/ci/plant-related.ts` lines 253 and 255 (the recipe origin a062f7a2 reaches the catalog commit, and the catalog commit reaches the tested merge), and the matching check in `execute` in `.github/ci/plant.ts` (lines 723 to 761). In their place, the same 37 files (the checklist fixture, libfabrika's `cloudflare/runtime.ts` and the 35 manifests) stay bound byte for byte, by sha256 pins in `.github/ci/plant-cases.ts`.

This turns one binding scenario, "nonancestor is refused", into "a squashed history with the pinned bytes binds". It removes a law, which is why it comes to you.

## Why

The catalog commit 3ca406a62f5f5a7e4300ebc8cd5c3918ecbf64db is a PR 1543 branch commit that the squash merge left off main, and the origin a062f7a2 is too. So the automatic "checklist faults" step fails before any fault runs, on every pull request and queue group that selects the cases. Seen on PR 1525 at 6d1173da: https://github.com/kamp-us/tea-fabrika/actions/runs/44210743213/job/134489632974 (integration 440/440 passed, then the step exited 1 in 3.5 s).

The ancestry never limited any byte: any PR could re-pin the catalog to its own head, and the pins sit in the same reviewed file. Binding to a commit on main (dac306026, same tree) would work today, but it fails again at the next fixture change, because no commit on main holds new fixture bytes before that PR squashes. PR 1525 is that change.

## Lean

Yes, about 85%. The doubt is only whether you wanted provenance for a reason that is not written down.

## What happens on yes

One builder and one review, then a normal PR from main, armed for squash once green. Then PR 1525 re-binds the ten cases to its spaced fixture with the new `node .github/ci/plant-pins.ts`, gets a fresh review, and the stack goes on.

## On no

Say what the binding must keep. The commit-on-main option (catalog becomes dac306026) fixes today, but every later fixture change would need a merge commit or a red check.
