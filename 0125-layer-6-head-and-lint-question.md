# 0125: stack layer 6 (anti-slop judgment fold) is done at `788cb7725`; lint is red on 57 lock asks, so it needs your call

The branch is `fabrikalfa/antislop-judgment-fold-1`, head
`788cb772521c7672575721449484c1b6271458b5`. It has one root, `6e9a51046`, and no PR is open. The
review rechecked the fix round, and it passed.

## What it holds

It merges PR 1301's head `eeb8ecdbb`, then layer 4 at `75a79d827`, then all 10 anti-slop slices at
their reviewed heads. That includes require-safety-comment-1 at `7a453f3bb`, not its tip. No slice
was skipped.

## Checks

| Check | Result |
|---|---|
| typecheck | passes. Some projects were killed for memory and rerun alone, and every one passes. |
| 17 plugin test files | 424 tests green, at `30878e31a` |
| leakgrep, added lines of `origin/main...HEAD` | clean |
| leakgrep, commits `eeb8ecdbb..HEAD` | clean, 107 commits |
| `loosening.sh` | hits on every merge, all read by hand, none a real loosening |

The loosening hits are Predicate and Effect-sweep rewrites, the apostrophe false alarm in
plancheck, and an expect moved into a helper.

The first review sent back 2 blocking lint errors, both fixed in `f6aacabc9`: a doc block that
format hoisted in `compiler.ts`, and a missing blank line in `WindowStart.laws.test.ts`.

## The call: lint is red on one part

17 of 18 lint parts pass. `oxlint-plugins/lint.ts` fails on 57 asks under 0563: each asks to add
a folder that is now at zero to that rule's lock block.

| Rule | Asks |
|---|---|
| prefer-effect-match | 21 |
| no-runtime-typeof | 15 |
| require-safety-comment | 11 |
| no-unknown-returns | 6 |
| no-unknown-parameters | 4 |

A judgment slice adds no lock lines (0589), so these asks wait for the anti-slop judgment sweep's
lock PR. But a layer cannot land while lint is red. The ways out:

| Option | What it costs |
|---|---|
| (a) Add the 57 lock entries to this fold, as one commit with the step-commit skill | They are mechanical, and `lint.ts` names each one. It is the lock PR's work folded into layer 6, so the fold needs one more review of that commit. |
| (b) Hold layer 6 until a separate lock PR lands on top of it | Two PRs where one would do, and layer 6 waits. |

I lean (a), about 75% sure. The asks are exact, they only tighten, and leaving them makes a red
layer.

## Not merged yet

- **Layer 4's newer head.** It moved to `92ff6f505`, the @kalfa/config merge, after layer 6 cut
  from `75a79d827`.
- **Your layer 5,** `fabrikalfa/effect-judgment-fold-1` at `6ba15e19e`, round 2.

You said stacks stay at 2 layers until the owner answers on queue size. So: should layer 6 merge
layer 5 now, or land paired with layer 4 alone? Tell me, and its integrator merges whichever you
name, once.
