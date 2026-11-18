---
id: 0607
title: No instruction file, plan file, pattern doc, glossary row or code comment links a superseded record, held by a link check in pnpm lint
status: accepted
date: 2026-11-18
tags: [records, decisions, links, superseded, agents-md, skills, lint, kalfa-records]
---

# 0607: No instruction file, plan file, pattern doc, glossary row or code comment links a superseded record, held by a link check in pnpm lint

```text
$ node .agents/skills/lead/scripts/records.ts resolve 0146
0146  superseded  live: .decisions/0162-no-friction-before-a-merge.md

docs/plan/README.md:300  links 0146, which is superseded; link 0162, or the rule's home
```

**What this decides:** which files may never link a superseded record, and what holds that.

## Context

The [rules and records guidelines](../docs/guidelines/rules-and-records.md), R5, approved in
[0604](0604-rules-and-records-guidelines-approved.md). Claude Code's docs say that when two
instructions contradict each other, Claude may pick one arbitrarily
([memory docs](https://code.claude.com/docs/en/memory)); a link to a reversed record hands an agent
that contradiction. On 2026-11-18, `docs/plan/README.md` linked superseded 0146 to say how a pull
request lands now.

## Decision

**No instruction file (an `AGENTS.md` or `CLAUDE.md`, a skill, a guideline page, a runbook), plan
file, pattern doc, glossary row or code comment links a superseded record, and `pnpm lint` fails one
that does.**

- A link is a Markdown link, or in a code comment a `.decisions/NNNN-slug.md` path. A bare number
  in prose is not a link, and the check does not read it.
- The check resolves each link the way `records.ts resolve` does, and its message names the live
  record.
- A link meant to state a rule goes to the rule's home, not to a record that once held it. That part
  is the review's, since no check can tell a link's intent.
- Records, experiments, field rows and direction notes are history and may link a superseded record.
- The check lives in `@kalfa/records` ([0585](0585-kalfa-is-six-domain-packages.md)).

## Consequences

- The links that break it today are fixed before the check turns on
  ([the build plan](../docs/plan/quests/rules-and-records-build-PLAN.md)).
- A pull request that supersedes a record fixes every link to it in the same pull request.
