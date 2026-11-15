---
state: "proposed 2026-11-14; a user scenario, not a plan"
summary: "Watching CI during a sev0 should be a pack of small programs opened as tiles in a new workspace, not a hand-built page. Recorded from the CI sev0 of 2026-11-14, when the owner had to ask the lead for every number."
---

# Scenario: watch CI in a workspace

**Proposed 2026-11-14.** A user scenario from a real day, kept so the desk and packs can be judged
against it. Nothing here is decided.

```text
(made up: the pack and program names below)
$ open ci
workspace 3 · ci
┌ queue ────────────────┬ runners ──────────────┐
│ 1 pr 1276  testing 4m │ 14 of 20 in use       │
│ 2 pr 1202  waiting    │ oldest wait 1.2 min   │
├ goals ────────────────┼ slow legs ────────────┤
│ pr checks 2.8 / 3 met │ test (1)  7.5m  out   │
│ queue     2.4 / 3 met │ next (2)  5.1m  ok    │
└───────────────────────┴───────────────────────┘
```

## What happened

- On 2026-11-14 CI was in a sev0 ([0532](../../.decisions/0532-a-sev0-freezes-ci.md)). The owner wanted
  to see the queue, the runners in use, each ready pull request and the goal numbers at a glance.
- Every number came from asking the lead session in chat. That cost the owner's attention all day.
- The lead built one HTML page by hand, outside the product, that a background loop rewrites every
  minute.

## The scenario

**Given** a person in a sev0 who needs to watch a few live things at once,
**when** they open one workspace,
**then** each thing shows in its own tile, updates by itself, and needs nobody to ask.

- Each view is a small program: the merge queue, runners in use, the ready pull requests, the goal
  numbers, the slowest legs. Each one does one job.
- They ship together as one pack, in `.fabrika/packs/<name>/`, turned on by one `[pack.<name>]`
  table in `fabrika.toml` (see [packs are programs](./packs-are-programs.md)).
- Opening the pack puts each program in a tile of a new workspace
  ([the desktop layer](./the-desktop-layer.md)). The person rearranges tiles like any other.
- A program reads GitHub through the `CodeHost` service, never `gh` straight
  ([0231](../../.decisions/0231-ledger-and-codehost-are-separate.md)), and wakes on a timer or a
  webhook: its `wake` names its next wake time, as any program's does.

```ts
// Sketch, made up: one of the pack's programs, in the shape `counter` uses today
// (next/programs/counter/src/program.ts).
export const queue = Program.make({
  name: "ci/queue",
  machine: queueMachine, // tea: Model is the queue's entries, Msg is a fetch result or a tick
  state: { v: 1, upgrades: [] },
  view: (model) => ({ entries: model.entries }),
  refuse: () => null,
  inputs: {},
  outputs: {},
  writes: {},
  wake: (model) => model.nextFetch, // its next wake time, which the runner sets as the alarm
});
```

## Why it matters

- A dashboard stops being a project. It is a line of small programs a person or an agent can write
  in minutes, then keep, share or throw away.
- An agent can build one for the person on request and open it, instead of answering the same
  question in chat ten times.
- It tests the desk and packs on a real need: live data, several tiles, no clicks to keep it fresh.

## What this cannot tell us yet

- Whether a timed wake is enough, or each program needs a webhook to feel live.
- How a pack opens a new workspace with its own layout: the desk has no such call today.
- Whether five programs or one program with five tiles is the right cut.
