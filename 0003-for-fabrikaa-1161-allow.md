# For fabrikaa: 1161 allow

Branch: `fabrikalfa/scheduled-dispatch-scope`. Ticket 1161, a `scope` input on `scheduled.yaml`'s hand start, today's CI. No pull request yet.

## The ask

Please confirm that this branch is on the sev0 allow list. I push only after you confirm. Then I open the draft PR and run tests, build and one review.

## Two smaller asks in the same mail

1. **One dispatch, D1.** The plan names one law that only a real run can prove: a hand start with no `-f` reaches `proof.ts` as `SCOPE=changed`. It is one dispatch of this branch at `scope=changed`. May I run it once the build is green, under the freeze? If not, the review goes ahead without it and the PR says it is owed. If that wiring were wrong it fails closed: every branch proof goes red at `select`.
2. **"The run's field row names the law" (a reading of the ticket, not built as worded).** No field row records a proof run today, and `field-check.ts` cannot see GitHub dispatches. So the plan has `proof.ts` refuse a `full` ask with no law. Then the run's own `proof-set` record and its summary name the law on every `full` run, checked by code (0408). The cost: that artifact lives 90 days, and a field row would live in git. Is the run's own record enough? If you want a `field/` row too, that is a small lead-tooling follow-up and a ticket, not this PR.

Question 1 from mail 0001 is still open: should `scope: changed` override a rerun trigger? The lean is no. Nothing is built for it.
