---
id: 0605
title: A rule changes where it lives, and no record patches another with an Amendments section, a still-holds line or a carried-forward copy, held by a records check in pnpm lint
status: accepted
date: 2026-11-18
tags: [records, decisions, amendments, rules, lint, kalfa-records]
---

# 0605: A rule changes where it lives, and no record patches another with an Amendments section, a still-holds line or a carried-forward copy, held by a records check in pnpm lint

```text
a ruling that changes a rule
  -> one edit to the rule's home (a check, a config file, the instruction read for that job,
     or the record itself while it is still the home), in the same pull request
  -> one new record that says why, and in its context what it changed
never
  ## Amendments                         a heading in a record
  "the rest of 0534 still holds"        a line that patches a record from outside
  "carried forward from 0023: ..."      a copy of another record's rule
```

**What this decides:** how a rule changes, and what a record may not hold.

## Context

The [rules and records guidelines](../docs/guidelines/rules-and-records.md), R2, approved in
[0604](0604-rules-and-records-guidelines-approved.md). [Experiment 298](../experiments/298-rules-and-records-guidelines.md)
counted 72 records with an `## Amendments` section and 44 with a still-holds line on 2026-11-17. A
reader of 0534 met a title that still said "every 3 hours" above an Amendments section that changed
it. Consolidated law keeps the revised text in one place and leaves each amending act as enacted
([legislation.gov.uk](https://www.legislation.gov.uk/help)).

This changes the [adr skill](../.agents/skills/adr/SKILL.md)'s step 4, whose table told a writer to
add a dated line under an older file's `## Amendments`.

## Decision

**A change to a rule edits the rule's home in the same pull request as the record of why, and no
record holds an `## Amendments` heading, a still-holds line or a carried-forward copy of another
record's rule.**

- A record whose why was reversed whole is superseded whole ([0606](0606-a-record-is-accepted-or-superseded.md)).
- A rule with no other home yet stays in its own record, which is edited in place.
- The check lives in `@kalfa/records` ([0585](0585-kalfa-is-six-domain-packages.md)) and runs in
  `pnpm lint`. Its message names the line and says where the change goes instead.

## Consequences

- Today's records that break it are cleaned up before the check turns on, by the
  [build plan](../docs/plan/quests/rules-and-records-build-PLAN.md).
- A line that only tells history ("0146 was superseded on 2026-11-12") is not a patch and stays.
- Not decided here: which phrasings beyond these three the check fails; the build plan lists them,
  and a new one is added when a review finds it a second time (R8).
