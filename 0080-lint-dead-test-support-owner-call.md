# 0080: lint:dead's test-support change loosens 0006 for one case; an owner call

PR https://github.com/kamp-us/tea-fabrika/pull/1520 builds the owner's `*.test-support.ts` ruling
for `lint:dead`. It works, but it loosens decision 0006 in one case nobody hits today. That needs
the owner's call. Separately, its review sent it back a second time, for a different fault, and I
allowed one more fix round as lead.

## Where it stands

- **Branch:** `fabrikalfa/lint-dead-test-support`, head `2bb92bd`. It is a draft, and its commits
  are leak-grepped clean.
- **What it changes:** `node-kinds.json` sets code-graph 0.15.0's `testSupportFilePatterns`.
  Setting that key replaces the defaults, so it writes both default groups out again and adds
  `test-support-module: ["\\.test-support\\.tsx?$"]`.
- **Its laws:** three, in `next/apps/fabrika/src/exam/unreachable.integration.test.ts`. Law 1 was
  red on main, and every plant turned its law red.
- **Checks:** `lint:dead` passes with the ledger unchanged, and `pnpm lint` passes.
- **loosening.sh:** one hit, `node-kinds.json` line 7. That is the loosening below.

## The owner call: a loosening of 0006

An export of a `.test-support.ts` file that nothing uses at all was `dead` on main. Now it is
withheld, because code-graph skips test-support files before it counts uses. Main has no such
export today.

| Option | What it means |
|---|---|
| (a) Accept it and amend 0006 | An unused export in a test-support file is never reported. |
| (b) `pnpm patch` code-graph so such an export stays `dead` | Then file the upstream issue the same day, and the patch goes when a release takes it. |

The reviewer leans (b), about 65% sure, and so do I. (b) keeps 0006 whole and follows "never wait
on upstream". What it costs: a patch to keep, and an upstream report proved by a repro, under 0054.

## My lead call: one more fix round

The recheck found one fault that is named, located and inside the plan. The `Segment` schema at
`unreachable.integration.test.ts:82-85` can draw `index`, `dist` or `vendor`. For those names
law 2 is false by code-graph's design, so the unseeded law can flake.

It is a new fault, and it needs no design call and no loosened law. Under 0564 I allowed one more
fix round:

1. One fresh tests agent excludes `index`, `dist`, `vendor` and `__generated__` from `Segment`.
2. It plants one of them drawn, and runs the law under several seeds.
3. The same reviewer rechecks.

The PR's status carries the one line that 0564 asks for. Fault 2 is not touched until the owner
rules.

## What this cannot tell you

Whether code-graph's maintainers see the skip as a bug or a choice. Their docs for
`testSupportFilePatterns` have not been read here.
