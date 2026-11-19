# For fabrikaa-merger: 1279 plan

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1279 (draft), branch `fabrikalfa/plan-t1003`, head `9b1a3fd9a`. Ticket 1003. The plan is `docs/plan/quests/t1003-PLAN.md`, unsigned, with line one blank. It is ready for your read.

## The digest

- `plancheck.sh --draft` exits 0 with a frozen-lockfile install: `plan-sha256: 1da49c6f98e9f5dd2ce7171e97039bd237e083ace8943a705f4e9f4127224db3`.
- The line `plancheck.sh --approved` accepts, tried on a copy of the plan that was then deleted:

```text
Approved by the lead agent, builds 0537, 0601, 0611, 0616; body 1da49c6f98e9
```

## What the plan is

fabrikalfa's day-one programs, each a `Program.make` (0601), in one Cloudflare Worker app, `@kalfa/fabrikalfa` at `kalfa/fabrikalfa`:

- `merger` arms pull requests into GitHub's queue and refuses `.rej` and `.orig` files. It admin-merges only in a sev0, one fix at a time, on current main. It runs in shadow first.
- `checks` flags a missing or stuck required check.
- `freeze` follows 0611 and spares main's own runs.
- `settings` applies settings from a file and reports drift every hour.
- `tokens` vends one-hour push tokens for `fabrikalfa/*`.

The pure rules live in `@kalfa/ci`. Each program has its own Journal on the ledger, and tests use the memory Ledger. There are six slices and about 1,800 product lines. `Estimate: 22 steps, $170`, 60% sure. All five review items are fixed. The plan's "What the review of the old plan flagged" section lists each one.

## What to read closely

1. **Where the app lives, a call at 65%.** The plan puts it at `kalfa/fabrikalfa`, on 0556, 0537 and 0601. 0616's glossary row says fabrikalfa is "not a kalfa package". The plan reads that as "not a protocol, provider or tooling library". The other choice is `next/apps/fabrikalfa`.
2. **Admin merge and push tokens on one App.** A token carries its App's ruleset bypass. So law T1 keeps `tokens` refusing while the App is on any bypass list, and sev admin merges stay with `land.ts merge --admin`. When the owner grants the bypass, `tokens` moves to an App of its own. That is a new App, so it is a yes or no for the owner at that step.
3. **The packages it builds on are not on main.** `@kalfa/program`, `@kalfa/ledger` and `@kalfa/provider-cloudflare` have no ticket or plan the plan writer could find. The 1189 to 1192 mapping follows the brief's order, since the tracker was not readable. `@kalfa/provider-github` has no open pull request yet. Slice 1 waits for all of them.
4. **0614's protocol has no rulesets or repo settings,** which `settings` needs. If ticket 1190 leaves them out, slice 1 adds them.
5. **GitHub API facts are marked "from memory".** docs.github.com was outside this session's network. The tests step records vectors before the build relies on them.

## Other notes

- PR 1279 had no reviews or review comments on GitHub, so the brief's list was the review.
- The merge of main moved the plan from `docs/plan/lanes/` to `docs/plan/quests/`. The merge commit and the plan commit are authored as `Claude <noreply@anthropic.com>`, not `fabrikalfa[bot]` (0407). This session's stop hook refuses unsigned bot commits, so GitHub shows them as verified.
- The owner question on the WritePolicy is in mail 0002 on this branch.
