# For fabrikaa: mock-node-repositories held, three of its files are owned by 1644

Slice `mock-node-repositories` (ticket 1067, `next/packages/libfabrika/src/node/repositories`, in
`next/`). Plan: `docs/plan/quests/mock-node-repositories-PLAN.md` on main. Branch
`fabrikalfa/mock-node-repositories`. Nothing is pushed to it and no pull request is open: this
slice stopped before the tests step, as the brief says to when an open pull request already changes
a file it needs.

## Why it stopped

Open pull request https://github.com/kamp-us/tea-fabrika/pull/1644 (`fabrikalfa/mock-cloudflare-clean`,
ready, head `f9ddee07a5f4`) changes three files this plan's lock needs:

| File | This plan's change | 1644's change |
|---|---|---|
| `.oxlintrc.json` | the lock block (the pair: `vitest/no-restricted-vi-methods` and `eslint/no-restricted-properties`) for this folder | +153 lines |
| `oxlint-plugins/builtin-plants.ts` | V1 and V2 plant lines in `VI_METHODS` and `VI_PROPERTIES` | +55 lines |
| `oxlint-plugins/plants.test.ts` | runs the plants under a test name in this folder | +158 lines |

The plan also says "Whichever slice lands later carries the entries the others landed first", so
the lock part of this slice should be written on top of 1644 once it is on main. No other open pull
request touches this slice's files (checked 1638, 1643; 1637 is closed).

## Not stale

On main at `b17dfa8` the folder still has its one mock call: `vi.spyOn(SettingsSnapshot, "make")`
in law L3 "a malformed snapshot made upstream is refused", now at
`next/packages/libfabrika/src/node/repositories/OpenRepository.composed.integration.test.ts:229`,
and no lock block names the folder.

## Main moved under the plan (plan corrections for when it runs)

1. **The test file was renamed.** `OpenRepository.test.ts` is now
   `OpenRepository.composed.integration.test.ts` (pull request 1420, and its header cites 0584): its
   injected L8 writes to a real temp folder. An `.integration.` law does not run on pull requests
   (0536), but the plan says the rewritten L3 needs no real resource and runs on every pull request.
   So either L3 is rewritten in place and runs only on the schedule, or L3 moves to a new
   `OpenRepository.test.ts` (the plan's own file name, now free), taking the `reader` stub and the
   `services` layer it uses. That is a call for you or the lead, not for this session.
2. **`Snapshot.ts` and `Load.ts` moved to `@kalfa/config`** (pull request 1583). The plan foresaw
   this: the new law names only Effect's `Digest`, so the move does not break it.
3. **The plan's fold amendment is moot.** It says the slice lands on `fabrikalfa/mock-fold` with no
   pull request of its own. That branch does not exist on origin, and 1526 and 1636 landed as their
   own pull requests, so this slice opens its own, as the brief says.

## What I need

One of:

- **Wait:** I run the whole slice after 1644 merges, on top of its `.oxlintrc.json` and plants.
- **Split:** I run L3 now (one file in this folder, no overlap with 1644), and the lock follows
  after 1644. Say which file L3 lives in (point 1).

## Also

This session may not set `fabrikalfa[bot]` as a commit's author: the session's permission check
refused both `git config user.name` and `git commit --author`. So this mail's commit carries the
session's own git identity. The branch `fabrikalfa/mock-node-repositories` has a local merge of
origin/main (net diff to main empty) that was not pushed.
