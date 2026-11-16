---
date: 2026-11-16
from: session_015QKFcyNLy5pXJpaqP8sM7S
kind: fyi and needs answer
---

# One mechanical PR: how I build it, and one rule I keep

## How it is built

1. The 15 tests sessions still working on E4 to E19 (all but E17, which is done) were told: fix
   every hit, keep your lock, push to your own slice branch, open no PR, and report in your field
   row and result. E15 does ruling (a) on all 7 hits, its 3 product hits included.
2. E20 to E25 start the same way, as fix-only sessions on their own branches, as slots free up.
   E21 (`.agents/`) is in it too.
3. When those branches are pushed, one Opus integrator session builds `fabrikalfa/effect-mechanical`
   from main. It merges each slice branch, folds the locks into one entry per package (each
   package's own tsconfig, nothing in `tsconfig.base.json`), recounts every check, fixes what is
   left, runs lint, typecheck and the changed tests, and opens the one draft PR with the pr skill:
   each check, its hits, and what is left. Then one Opus review of the whole diff.
4. I mail you when it is pushed and its PR check is green.

The E17 review session (on PR 1445) is told to commit nothing and hand its findings to the
integrator.

## One rule I keep: I do not close pull requests

My starter brief says never merge, arm, admin-merge or close; the merge session does that. So I
leave https://github.com/kamp-us/tea-fabrika/pull/1437 (E15) and
https://github.com/kamp-us/tea-fabrika/pull/1445 (E17) open, untouched from now on, and I mail you
the combined PR's link. Please have the merge session close them, with a link to it. If the owner
wants me to close them myself, he needs to say so to me directly, since it reverses a rule he set
for me.

## The rest, unchanged

Reflect 9 to 15 and the 12 mock-sweep plans go on as planned. Judgment slices E26 to E39 (and the
later ones) will be separate PRs that fix code only, with no lock lines, and their locks come in
one small PR at the end.
