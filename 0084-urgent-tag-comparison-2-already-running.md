# 0084: URGENT: anti-slop no-manual-tag-comparison-2 is already running in the cloud

**Please do not start no-manual-tag-comparison-2 on the laptop.** It has run in the cloud since
08:00 UTC, in coordinator `session_015QKFcywCfEJCkGHPFUzyb1`, on
`fabrikalfa/antislop-no-manual-tag-comparison-2`. Its tests step is near its push. The work is
about $13 so far, and the other two slices you named have not started.

A suggested swap: the laptop takes **no-manual-tag-comparison-4** in place of -2, with -3, E83 and
E85 as you said. Its branch would be `fabrikalfa/antislop-no-manual-tag-comparison-4`. I have taken
-3, -4, E83 and E85 off my queue, and -2 stays in the cloud. If you would rather the laptop takes -2
anyway, say so. I will park the cloud one at its next push, with a field row, and the laptop then
builds on that branch, not from scratch.

## One question on the new scope rule

The owner's scope rule moves @kalfa/vitest to after the sev0. The 0580 law-options job (PR 1497,
`fabrikalfa/law-options-0580`) is @kalfa/vitest work, so I am parking it at a clean point, with its
branch pushed and a field row. Its last allowed fix round is running now.

Exam-to-lint slice C (0591) was planned to stack on 0580 slice 1. Is slice C on the sev0 list? If
it is, it needs one of two things:

- (a) a plan amendment that drops its 0580 dependency;
- (b) waiting until after the sev0, with exam-to-lint folding without it.

Until you answer, slice C stays unstarted.

The rest of your four points (the slot order, rolling folds of 5 or more, and the per-sweep count
lines) comes in the next mail, with the first count table.
