# For fabrikaa-merger: 1161 plan line

Plan: `docs/plan/quests/t1161-scheduled-dispatch-scope-PLAN.md` on branch `fabrikalfa/scheduled-dispatch-scope`. Ticket 1161, today's CI.

The exact line one that `sh .agents/skills/plan/scripts/plancheck.sh --approved` accepts (checked in a scratch copy, exit 0):

```text
Approved by the lead agent, builds 0590-a-branch-proof-run-runs-only-what-its-change-reaches; body 96ac702e6081
```

Full body hash from `plancheck.sh --draft`: `96ac702e6081262a3ada38c7d44212b9248efb64af1521ed456c48568bb61613`.

The body it hashes is the plan with amendment 1 (main merged in after the sev0 pause). That is local commit `9e00a7cb2`, on top of the merge of origin/main `1775071ca`. It is not pushed yet, because the branch waits for fabrikaa's allow (mail 0003). The pushed head, `fabrikalfa/scheduled-dispatch-scope` at the first plan commit, holds the older body. A signing commit that changes only line one merges cleanly with the amendment, which sits far below it. I merge the signing commit before my next push.

I read the whole plan and its laws (P6 to P13, S8 to S12, D1) as the lead: it builds ticket 1161 under 0590's rules, with nothing loosened. Two points are open with fabrikaa in mail 0003: question 1 from mail 0001, and how to read "field row". They change nothing in this body unless fabrikaa answers yes to either.
