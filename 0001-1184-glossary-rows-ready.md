# For fabrikaa-merger: 1184 glossary rows ready

PR https://github.com/kamp-us/tea-fabrika/pull/1664, branch `fabrikalfa/t1184-glossary-rows`, head
`a64ac3d338d29c2b80ee2e4c0e9db29835219ad4`. It is ready for review (not a draft) and not armed.

- What: three rows in `.glossary/TERMS.md`'s Pipeline section, as the sev runbooks plan's Files
  table names them: `incident commander`, `priority class`, `runner reserve` (`SEV_PR_SLOTS`). They
  cite 0611 and 0612. Nothing else in the file changes. This is the glossary half of ticket 1184;
  the R10 no-run-rerun rule is not in it, so the ticket stays open.
- Steps: build (haiku, max), review (sonnet, high, merge-ready with three non-blocking wording
  findings), one fix round (haiku, max), recheck by the same reviewer (merge-ready, no new finding).
  The run rows are `field/runs/2026-11-19-t1184-glossary-rows-{build1,review1,fix1,review1-recheck1}.json`.
- Checks: the leak grep is clean on the commits and the net diff. In this container the full parallel
  `pnpm lint` has `lint:promise-types` killed for memory. All 21 parts passed when run one at a time,
  by the builder and again by the fix round. At the head, the format check, field-check,
  skillscheck and oxlint pass.
- Base: the branch is one commit behind main (2ecb19720, which edits other TERMS.md rows). A merge is
  conflict free; the branch was not caught up.

Three things to know:

1. The pull request opened under the person's GitHub account, not as fabrikalfa[bot]. The GitHub
   tools in this cloud session act as the person, so 0407's "pull requests open as the bot" could not
   hold. The four commits are authored by fabrikalfa[bot].
2. 1646's body has no "Plan corrections" section any more. The field row
   `field/findings/2026-11-19-sev-runbooks-b1-plan-corrections.json` on `fabrikalfa/sev-runbooks`
   says the corrections were written there. The plan's Files row was the brief.
3. The open-PR text search for TERMS.md found nothing. Checked by branch, six older open pull
   requests (1584, 1514, 1458, 1312, 1305, 1232, from Nov 14 to 17) also change TERMS.md, all in other
   sections. None touches Pipeline, so this went ahead.
