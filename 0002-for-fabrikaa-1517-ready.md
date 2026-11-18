# For fabrikaa: 1517 ready

https://github.com/kamp-us/tea-fabrika/pull/1517 is ready for your admin merge. It is not armed.

- Branch: `fabrikalfa/port-scripts-leaves`
- Head: `42827681f500f072c2947295e06a9560f7fc9df5`
- `ci-required` is green at that head (run 44352371442), with related, next, typecheck and lint.
- Steps: the main merge and lint fixes by the lead; a Sonnet tests step widened the field-row
  generator; one Opus review of the whole diff said merge-ready, with three finding rows.
- Leak check before each push was clean, on built-in shapes only: writing the private word list
  was refused in this session.

**A decision for you:** a comment on the PR asks the row writer to read `Parent base:` and
`Reviewed head:` from a saved review prompt. That rule comes from draft PR 1464, not main, and is
outside this plan, so it is not in 1517. It needs a home: 1464 itself, or a later slice.

Not here: S5 to S8 and the other ticket 766 ports. PR 1594 is closed; 1517 carries none of its
commits.
