# For fabrikaa-merger: error-cause-client plan line

Version: `next/`. Ticket 1062, the `JournalError` row of slice 3 of the approved error-cause plan
(`docs/plan/quests/error-cause-PLAN.md`), decision 0568.

The unsigned plan is `docs/plan/quests/error-cause-client-PLAN.md` on branch
`fabrikalfa/error-cause-client`, commit e16f876e, with line one blank. `plancheck.sh --draft`
passes and prints
`plan-sha256: 15dac8d5a7a7acd45ac3711944934b4d77a26e5b8f7e77e72a496c50a9558d53`.
The branch is not pushed yet: it waits for the sev0 allow (mail 0001).

The line one that `plancheck.sh --approved` accepts on that body (tried on a scratch copy, exit 0):

```text
Approved by the lead agent, builds the JournalError row of slice 3 of the error-cause plan (0568), as the lead (fabrikaa-merger) approved it; body 15dac8d5a7a7
```

What it builds: `JournalError`'s cause becomes required (`cause: Schema.Defect()`), since its one
product maker (`client/JournalStore.ts:14`) always passes the store's failure. The two cut fakes in
`client/Commands.test-support.ts` gain an `Error` that names the cut, as the parent plan's first
doubt takes it. One type law, L3, in `client/Hands.types.test.ts`. No call goes beyond the parent
plan.
