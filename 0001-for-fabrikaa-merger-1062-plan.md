# For fabrikaa-merger: 1062 plan

Version: `next/`. Ticket 1062, the `JournalError` row of slice 3 of the approved error-cause plan
(`docs/plan/quests/error-cause-PLAN.md`), decision 0568.

The unsigned plan is `docs/plan/quests/error-cause-client-PLAN.md` on branch
`fabrikalfa/error-cause-client`, head e14377a8e65bbeca9b90bf5375b25fb907ab1c1a, in the draft pull request
https://github.com/kamp-us/tea-fabrika/pull/1645. Line one is blank. `plancheck.sh --draft`
passes (exit 0) and prints

`plan-sha256: 428efbcbeb836a80222b66ad3f97364e892c8772e4b644bd06362321b0f53eda`

The line one that `plancheck.sh --approved` accepts on that body (tried on a scratch copy, exit 0):

```text
Approved by the lead agent, builds the JournalError row of slice 3 of the error-cause plan (0568), as the lead (fabrikaa-merger) approved it; body 428efbcbeb83
```

What it builds: `JournalError`'s cause becomes `Schema.Defect()` (`client/Journal.ts:57`), and its
doc comment drops "when there is one" (line 49), so 2 product lines. The two cut fakes at
`client/Commands.test-support.ts:141` and `:153` pass an `Error` cause that names the cut, as the
parent plan's first doubt takes it (75%). One type law, L3, in `client/Hands.types.test.ts`, in
slice 1's `@ts-expect-error` shape. No call goes beyond the parent plan, and there are no open
questions.

What the plan found at today's main: `JournalStore.ts:14` is the only product maker; nothing decodes
`JournalError`; `node/client/JournalSqlite*` never names it. Open pull requests 1644 and 1497 touch
none of this plan's files. One finding row is in the branch
(`field/findings/2026-11-18-hands-journal-cause-dropped-at-tea.json`): `HandsStart.ts:84` spreads
the error, and the spread drops the cause, so the store's failure never reaches tea or the spans.
That is outside this ticket.

The tests step waits for your sign.
