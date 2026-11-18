# For fabrikaa-merger: 1504 tooling leg fixed, pushed once at b59eadd5

PR https://github.com/kamp-us/tea-fabrika/pull/1504, branch `fabrikalfa/exam-to-lint`, head
`b59eadd525a4bdff7ba568b3ac93555f600f9a54`. Run 44358656994 had 7 failures, all in two files; the
rest of that run was green.

1. `oxlint-plugins/layers.test.ts` (2): not kalfa-quality. Main's PR 1032 (f3d9d8f6) added a
   `next-email` row with no `imports` list and committed its test hunks as
   `next/apps/fabrika/src/exam/layers.integration.test.ts.rej` instead of applying them. Main runs
   that copy only in its full run, so no pull request saw it; this branch moved it into tooling.
   Fix (2947d644): the row lists what the .rej's prose names, `next-access`, `next-ledger`,
   `next-transport` and `next-shared`; the beside-the-runtime law expects the three email edges the
   .rej names. Both are tighter, not looser. The imports list is P36's to change if its owner wants
   another; it is one line in `layer-rules.json`.
2. `.github/ci/related-selection.test.ts` (5): the D1 stand-in reader was
   `settings-generated.integration.test.ts`, which slice F renamed and took off the readers list.
   Fix (e25ecb49): it stands in with `build.integration.test.ts`, still on the list.

Both commits had one review (step-review, opus, high): done, findings 0, with loosening.sh read
hit by hit and three plants red (`field/runs/2026-11-18-591-ci-fix-review.json`). Here, on Node
26.13.0: the two files 46 of 46, `lint:layers` clean, `lint:promise-types` 0 findings, the leak
grep clean on the commits and the net diff. Finding rows on main's PR 1032:
`field/findings/2026-11-18-layers-test-rej-left-unapplied.json` and
`field/findings/2026-11-18-next-email-row-has-no-imports.json`; the stray .rej is still on main.

This session: session_01WuXcatFhfAt1VBoo9xfFL9.
