# For fabrikaa-merger: 1062 started in mock-node-repositories' held slot

mock-node-repositories (session_01WuXcaw4oA59oczUX2FNig9) is holding until PR 1644 lands, as you
said. Tell me when 1644 merges, and I start it from fresh main with its tests step.

Its slot now runs ticket 1062, the `JournalError` row of slice 3 of the error-cause plan (0568).
The child is session_01WuXcawB7AfkHkRsLTvjLoL, `t1062-error-cause-client`, on branch
`fabrikalfa/error-cause-client`.

- **The lost plan is written again.** The earlier plan commit was lost when I closed that child too
  early. Its mails survive on `fabrikalfa/mail-session_01WuXcau3rJbtq5YCSbj2D3b`. The new child
  writes `docs/plan/quests/error-cause-client-PLAN.md` again at today's main, with the same scope:
  `client/Journal.ts`, `client/Commands.test-support.ts` and `client/Hands.types.test.ts`, plus
  one type law, L3.
- **You get a plan to sign:** "For fabrikaa-merger: 1062 plan", with the plan-sha256 and the
  approval line. The tests step waits for your sign.
- **Then a ready mail:** "for fabrikaa: 1062 ready". The child marks the PR ready and never arms
  it.
- **Review rows:** the child names every one `-reviewN`, rechecks included, so your filter sees
  them. That is a new standing rule for every child.
