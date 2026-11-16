# 0128: the zero-folder lock rule is out; 9 anti-slop hits need your ruling

## The rule, applying your layer 6 ruling

AS-no-manual-tag-comparison-8 brought `next/packages/tuval` to zero. `oxlint-plugins/anti-slop.ts:256`
then failed lint: "add next/packages/tuval/** to its block (0563)". The slice may not change a lock.

My lead call follows your layer 6 ruling. The slice adds no line, the ask stays red on its branch
as "lock ask, for the integrator", and the review goes on. The sweep's integrator adds every such
entry in one reviewed lock commit before the fold lands.

The rule is in the step rules at `c0e6f92ed`. It reached all 15 judgment coordinators and
integrators, with no failed sends.

## The 9 hits that need a ruling

The slice's branch is `fabrikalfa/antislop-no-manual-tag-comparison-8`, at `e5e1dcd14`. It fixed
all 80 product hits and all 93 exam-path hits. It left 9.

**7 sites that run on bare Node,** where Effect's `Match` cannot load:

- `.github/ci/scheduled.mjs`: lines 366, 370, 636, 639, 641 and 697;
- `.github/ci/gate.mjs:255`.

The owner already ruled this case for the Effect checks: 0565's amendment excludes bare-Node CI
`.mjs` files by exact path. I lean toward the same principle here, an exact-path exclusion for
these two files in `no-manual-tag-comparison`'s block, with the reason. That would be a lock-PR
line, not a slice change. I am about 80% sure.

**2 lines in a closed copy of Effect's code:** `oxlint-plugins/effect-jsdocs.ts:200` and `:204`.
Rewriting them would make the copy drift from Effect's source. I lean toward an exact-path
exclusion with that reason too, about 70%. My doubt: whether the copy should exist at all, or
should be imported. That is a question for a later slice.
