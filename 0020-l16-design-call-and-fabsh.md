# T753 L16 needs an owner pick; fabsh is queued

## L16: the cause is on main and it is real CPU work, so the fix is a design call

**Answer:** the law is slow, not flaky by a hang. Every fix that holds changes a written rule or a
law's run count, so the owner picks. L16 has built nothing.

- **The law:** `T753 L16 real first/later process steps, recovery and successors keep the shared
  instance gate`, at `next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts:1161`. It
  runs 100 cases at full depth in the scheduled run, and failed with "Test timed out in 60000ms"
  on run 44110982551.
- **Not 1427:** alone at full depth it takes 36.0 s on main 397e63f and 35.6 s on 1427's head.
  1427 just drew a slow, shared leg. Main runs it at 30 to 59 s per 1519's own data, so main is
  near the bound too.
- **Why 1519 did not hold:** it cut only the fast depth to 10 cases. Full depth is still 100, at
  about 0.36 s a case alone and about 0.6 s on a contended leg.
- **Where the CPU goes:**
  - The telemetry sink commits every span to SQLite in its own transaction before `end` returns:
    about 1,450 spans a case, about 30% of the CPU.
  - The Runner asks the Project for its lifecycle 14 to 18 times per step, each a Project RPC
    with a ledger turn: about 11%. Production makes the same extra RPCs.
  - The rest is SQL and schema work spread evenly. Idle time is 2%, and nothing grows
    quadratically.
- **Measured alone, with throwaway changes:** base 36.2 s; lifecycle checks without an RPC
  32.2 s; spans not persisted 22.1 s; both 20.9 s.

| Option | Change | Expected | The rule it changes |
|---|---|---|---|
| A | spans batched per RPC turn, through the sink's existing `SpanSink.batch` (IsolateUsage and the desktop brain already use it) | about 22 to 25 s alone, about 40 s worst on CI | `Sink.ts`: a span is in SQLite before `end` returns. With batching, a turn that crashes mid-RPC loses its spans |
| B | the Runner reads the lifecycle once per turn | about 32 s alone, not enough on its own | `Runner.ts`: "the runner keeps no second copy" |
| C | A plus B | about 21 s alone, about 35 s worst | both |
| D | fewer full-depth cases, e.g. `runsFor({ fast: 10, full: 50 })` | about 18 s alone | loosens a law. 1519's evidence: on seed 119120 the first 10 cases reach all 14 state and move pairs by case 6 |

**L16's lean is C, about 70% sure.** Both parts cut work production pays too, and neither
touches the law. The doubt is A's durability trade.

**Mine is C too.** The 60 s bound and the law stay whole, and the margin goes from about 0 to
about 25 s worst case. I would say no to D: it is a loosening, and C fixes the cause. What would
settle A: whether losing the spans of a turn that crashes mid-RPC is acceptable. The sink's own
batch path already makes that trade for IsolateUsage and the desktop brain. L16 is finding the note
that set each rule, so the plan can amend it.

**I need from the owner:** A, B, C, D or another. 1427 cannot land until this proof passes.

## Fabsh (PR 1584, ticket 1078)

Noted, no writes. It takes the next free slot, ahead of items 3 and 4, since item 1 (the Effect
fold) is already running. It starts on your write go and head SHA.

Its CI route, if `related.ts` or `check.yaml` needs one, takes a turn after C2 and before K2.
The order on the shared lines is C2, then fabsh's route, then K2.

Children active: 7 of 7.
