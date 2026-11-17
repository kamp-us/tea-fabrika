---
id: 0596
title: At most eight tracker tickets are active
status: accepted
date: 2026-11-16
tags: [operations, tickets, agents, resources]
---

# 0596: At most eight tracker tickets are active

**What this decides:** the operating cap counts active tracker tickets rather than agents.

## Decision

**Drive at most eight active tracker tickets at once.**

- The merger keeps one ledger of active ticket IDs, each with its owner and blocker.
- Review, proof and landing remain active work. Finished tickets and tickets explicitly parked
  with saved state are not active. Park excess tickets with their state intact; cancel no jobs.
  Start no new step for a parked ticket until it reenters the ledger.
- A ticket may use as many bounded agents as its steps need. Keep one file owner, fresh steps,
  review and required proof. Work on a separate ticket counts even when called helper work.
- Keep one global typecheck, one Electron test app, one Docker box, existing nice and worker
  limits, and the rule that dangerous laws run on eligible disposable CI away from the laptop.

## Context

This replaces only [0012](0012-twelve-agents-at-once.md)'s agent-headcount cap. Its shared-resource
limits remain. No replacement agent-count setting is introduced. Recording this operating rule
is coordinator bookkeeping, not a new product ticket.
