---
id: 0078
title: An agent fabrika starts and a flow fabrika runs join the core ideas, so a flow gets a thin slice from Tier 1, never only in Tier 6, and an agent is built for real as summon
status: accepted
date: 2026-11-10
tags: [tiers, plan, next, agent, flow, pipeline, slice]
---

# 0078: An agent fabrika starts and a flow fabrika runs join the core ideas, so a flow gets a thin slice from Tier 1, never only in Tier 6, and an agent is built for real as summon

**What this decides:** [0068](0068-tiers-carry-every-part.md)'s list of core ideas grows from four
to six: an agent that fabrika starts and a flow that fabrika runs. The flow gets a thin working
slice from Tier 1, and Tier 6 hardens it. The agent is built for real as `summon`, one of the four
primitives ([0159](0159-fabsh-pipes-summon-join-first.md)), and gets no thin slice.

## Context

0068 says each tier carries and updates a working slice of every core idea, and named four. It left
open whether an agent that fabrika starts (Tier 5) and the pipeline (Tier 6) are core ideas too.
Tracker ticket 677 asked it.

- The labs study, experiment 250, in an open pull request, looked at how other teams work. It found
  that code should hold the edges of the work while an agent holds the path inside a step, and that
  the tooling around agents is what breaks next.
- Our own cost sits in the coordinating session, which holds the loop by hand.
  [0064](0064-the-lead-drives-with-flows.md) already says no agent holds a loop.
- [0073](0073-a-lane-has-a-room.md) (a lane has a room), [0074](0074-agent-hands-over-a-flow.md)
  (an agent hands fabrika a flow as data) and [0076](0076-a-lane-stops-at-its-budget.md) (a lane has
  a budget) each need a flow that fabrika itself runs. All three were decided before that base had
  an early slice.
- "Hands do not exist before Tier 4" is no blocker: 0068 already removed it for hands, and the same
  rule covers every case it fits, these two included.

This amends 0068 in part: its list grows from four to six.

## Decision

**An agent fabrika starts and a flow fabrika runs are core ideas. A flow gets a thin slice from
Tier 1, and an agent is built for real as `summon`.**

- **An agent fabrika starts:** fabrika can start one agent run for one bounded job and record how it
  ended. `summon` is that start, built for real with the other three primitives and not as a thin
  slice ([0159](0159-fabsh-pipes-summon-join-first.md)).
- **A flow fabrika runs:** fabrika can run a saved list of typed steps handed to it as data (0074),
  and stop at an ask, before Tier 6.
- Tier 6 still builds the flow for real. The full pipeline stays in Tier 6. Nothing about the
  pipeline's steps, its laws or [the Tier 5 laws](../docs/plan/tiers.md#tier-5-laws-decided-2026-11-07)
  moves.
- 0068's binding constraints apply to the flow's slice: each tier plan says what the slice gains,
  the slice works with no stub, and it records now what a later hardening needs.

## Consequences

- [The tiers](../docs/plan/tiers.md) get a dated line. No tier table row moves.
- Cost: Tier 1 grows by the flow's slice and by what `summon` needs. By the tier rules, a tier that
  grows too big splits.
- Not decided here: how thin each slice is. The final Tier 1 plan says, with one question each, as
  0068 and [0069](0069-choices-are-settings.md) leave their sizes to the plan.
- Not decided here: whether today's lead flow runner (lead tooling, tracker ticket 656) and the
  `next/` slice share code or only the shape. [0070](0070-flow-runner-stays-a-machine.md) keeps the
  lead's runner a plain tea machine for now.
- Not decided here: where an agent fabrika starts runs. The laptop, as today, is the default until
  hands and the Tier 5 laws say otherwise.
