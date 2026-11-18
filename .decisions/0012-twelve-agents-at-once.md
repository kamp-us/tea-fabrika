---
id: 0012
title: One type check, one Electron test app and one Docker box run at a time across all agents, whatever the staffing target
status: accepted
date: 2026-11-09
tags: [machine, load, agents, laptop]
---

# 0012: One type check, one Electron test app and one Docker box run at a time across all agents, whatever the staffing target

**What this decides:** the shared-resource limits on the laptop: one `pnpm typecheck`, one Electron
test app and one Docker box at a time across all code agents, however many agents run.

## Context

The cap on code agents went from 2 to 4 and then 5 on 2026-11-03, to 8 on 2026-11-08, and to 12 on
2026-11-09, each time with the owner asking for more speed. The rule and its history live in the
"Under load" bullet of [AGENTS.md](../AGENTS.md#go-easy-on-the-machine). Ticket 397 records the
raise to 12.

Most lane agents spend their time waiting on Codex steps, which are light on the laptop. What froze
the laptop before was two type checks at once, not the number of agents.

The agent-count cap has since been replaced: [0596](0596-eight-active-tracker-tickets.md) counted
active tickets, and [0597](0597-eight-workers-before-twelve.md), which replaced 0596, counts actual
productive workers. The staffing targets live in 0597.

## Decision

**One `pnpm typecheck`, one Electron test app and one Docker box run at a time across all code
agents (owner, 2026-11-09).**

- One `pnpm typecheck` at a time across all agents: wait while `pgrep -x tsgo` finds one.
- One Electron test app at a time, and one Docker box.
- If the laptop feels slow, reduce demand: run fewer agents or fewer checks at once.

## Consequences

- The type check stays the bottleneck, so more agents may mean longer waits for it.
- Not decided here: the test caps (`--maxWorkers`, `nice` levels) and the mutation sample size.
