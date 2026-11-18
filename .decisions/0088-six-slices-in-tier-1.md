---
id: 0088
title: All six core ideas get their thin slice in Tier 1, each as small as it can be and still work, never in an early tier left unnamed
status: accepted
date: 2026-11-10
tags: [tiers, plan, next, hands, programs, packs, pipes, agent, flow, slice, tier-1]
---

# 0088: All six core ideas get their thin slice in Tier 1, each as small as it can be and still work, never in an early tier left unnamed

**What this decides:** the four core ideas that [0068](0068-tiers-carry-every-part.md) said start
"early" start in Tier 1, beside the two that [0078](0078-agent-and-flow-slices-start-early.md)
already put there, so every core idea has a working slice in Tier 1. Later records say where each is
built for real: [0159](0159-fabsh-pipes-summon-join-first.md) builds pipes, `fabsh` and `summon`
first, and [0185](0185-tier-2-runs-agents-after-the-four-primitives.md) builds hands and an agent
fabrika starts in Tier 2, after them.

| Core idea | Built for real in | Thin slice in | Which record says so |
|---|---|---|---|
| Hands | Tier 2 ([0185](0185-tier-2-runs-agents-after-the-four-primitives.md)) | Tier 1 | this one |
| Programs written outside fabrika's own source | Tiers 5 and 7 | Tier 1 | this one |
| Programs working together | First, as pipes ([0159](0159-fabsh-pipes-summon-join-first.md)) | Tier 1 | this one |
| A person starting a program | First, as `fabsh` (0159) | Tier 1 | this one |
| An agent fabrika starts | First, as `summon` (0159), then Tier 2 (0185) | Tier 1 | [0078](0078-agent-and-flow-slices-start-early.md) |
| A flow fabrika runs | Tier 6 | Tier 1 | [0078](0078-agent-and-flow-slices-start-early.md) |

## Context

Tracker ticket 677. The owner decided this on 2026-11-10.

- [0068](0068-tiers-carry-every-part.md) says each tier carries a working slice of every core idea,
  and named four that started late. It gave each a slice "before" its tier, and left open which tier
  each lands in. [The tiers](../docs/plan/tiers.md) said the same: "which tier each slice lands in is
  not decided yet".
- [0078](0078-agent-and-flow-slices-start-early.md) added two more core ideas and put both slices in
  Tier 1.
- The reason now: a tier is a whole small vehicle across the five layers and across the core ideas
  ([every update builds every layer](../docs/direction/every-update-builds-every-layer.md), 0068).
  These four are core parts beside the five layers, so Tier 1 is not a whole vehicle without them.
- On 2026-11-13, [0159](0159-fabsh-pipes-summon-join-first.md) made the four primitives the next
  thing built: `fabsh`, pipes, `summon` and `join`, working for real and not as thin slices of
  themselves. It removed no thin slice. All six stay in Tier 1: the Tier 1 table keeps P41 and P42,
  the slices of programs working together and a person starting a program, as "needed", and pipes
  ride on P41's first two slices.
- The same day, [0185](0185-tier-2-runs-agents-after-the-four-primitives.md) put the real build of
  hands and of an agent fabrika starts in Tier 2, after the four primitives and never before or
  beside them. Tier 1 holds a thin slice of each: hands far enough to run one turn, and the link to
  the agent harnesses that `summon` needs.

This amends 0068 in part: it answers 0068's "which tier each thin slice lands in".

## Decision

**Hands, programs written outside fabrika's own source, programs working together and a person
starting a program each get their thin slice in Tier 1, as 0078 already gives an agent fabrika
starts and a flow fabrika runs.**

- Each slice does what 0068 says it must, now in Tier 1:
  - **Hands:** a program can ask for a command and see it run.
  - **Programs written outside fabrika's own source:** a person can run a program the app's source
    does not list.
  - **Programs working together:** one program can reach another.
  - **A person starting a program:** a person can start a program while the app runs.
- **Each is as small as it can be and still work.** No stub and no dead path.
- **The outside programs slice builds [0083](0083-every-program-in-a-pack.md) and
  [0084](0084-own-pack-listed-by-path.md) in small:** every program is in a pack, and a repo's own
  pack is listed in `fabrika.toml` with a `from` that starts with `./`. The slice is that path, not
  a second way to load a program. 0075's cold author check runs on it in Tier 1.
- The tiers that build these for real keep them: hands in Tier 2 (0185); the queue, claims, leases
  and a program that starts another in Tier 4; a repo's own pack in Tier 5; packs from elsewhere
  and the lock file in Tier 7. They harden the slice. Pipes and `fabsh` come first, as 0159 says;
  pipes ride on the first two slices of programs working together.

**Binding constraints**

- 0068's rules for a slice hold for all six: it works, it records now every fact a later tier
  needs, and each later tier's plan says what the slice gains, or why it gains nothing.
- Each slice has its own plan before any builder starts, as every Tier 1 row does.

## Consequences

- **Cost: Tier 1 grows by four rows,** P39 to P42 in
  [the Tier 1 table](../docs/plan/tier-1.md#the-pull-requests-one-at-a-time), each with the one line
  it must do, as P38 was added. The row count lives in
  [where we are now](../docs/plan/README.md#where-we-are-now) and changes with the rows
  ([0013](0013-plan-docs-change-with-the-work.md)).
- 0078's two slices have no row in the table either. Their rows come with their plans; this record
  does not add them.
- **Rows that may already half-cover a slice,** as facts to check in each plan, not rulings:
  - Hands: the host's capabilities, `has`, go in the hello from Tier 1
    ([Tier 1's detail](../docs/plan/tier-1-detail.md#the-biggest-calls), call 21). No row runs a command.
  - Outside programs: P16's program table, the build's `programs` option in
    `next/apps/fabrika/src/build.ts`, and P38, whose lead sketch loads the list of programs a stage
    runs from `fabrika.toml`.
  - Programs working together: P9's `Mailbox.send` between processes, and P33's monitors, where
    `DOWN` reaches another process.
  - A person starting a program: P9's and P33's `ProcessManager.start`, P34's restart and the tile's
    `[Restart]` in P15.
- **Not decided here:**
  - The size of each slice. Each plan says, as 0068, 0069 and 0078 leave sizes to the plan.
  - The order of the four, and where they sit in the waves.
  - Whether Tier 1 splits. By [the tier rules](../docs/plan/tiers.md#the-rules), a tier that grows
    too big splits; this record does not pre-empt that.
  - Whether a slice's plan folds it into a row above instead of keeping its own row. Each plan
    says.
- [The tiers](../docs/plan/tiers.md) get a dated line, and 0068's "which tier" line points here.
