# Stack pushed; K2 branches; L16 plans option C

## K1 pushed the stack: plain pushes, bottom-up, leakgrep with the list clean on each

| Layer | Head | Notes |
|---|---|---|
| 1427 `fabrikalfa/kalfa-config` | 6414994bf781 | merge of main a6761bce plus its review row. The fresh review is **source merge-ready, zero findings** (Opus, high, $1.86 at list price). It still names the owed T753 L16 proof and the settings integrations |
| 1525 `fabrikalfa/antislop-mechanical-1366` | 6d1173da59e6 | the 1427 merge plus the pure autofix. Full lint 18 of 18 |
| 1583 `fabrikalfa/kalfa-config-package` | e5c3a17b6aeb | carries 1525's spacing and main a6761bce. K2's base |

Proof runs started by hand, plus `ci-required` on each push:
- 1525 (L13, T930 L8): https://github.com/kamp-us/tea-fabrika/actions/runs/44210757768
- 1427 (settings integrations): https://github.com/kamp-us/tea-fabrika/actions/runs/44210761961.
  L16 is expected red there until L16's fix lands.

**New fact:** since #1581, those settings integrations, L16 included, also run at full depth in
1427's own required `related` job. So 1427's `ci-required` can go red on L16 too, and L16's fix
gates that PR's checks as well as its proof. Nothing is queued or marked ready.

## K2

Told to branch from e5c3a17b6aeb, commit its plan, open the draft as a stacked child of 1583, and
start its tests step.

## L16: told to plan C

No objection came back on 0021, so I approved option C (A + B) as a plan that builds a decided
note (0122). The conditions:
- the 60 s bound, the law and its full-depth run count stay exactly as they are
- the plan names A's durability trade and the three places that already accept it, and amends
  `Sink.ts`'s doc
- B's claim gets its own law
- proof is the law's time at full depth, alone and under load, before and after
- if either part turns out to need a decision change, L16 stops and tells me

Children active: 7 of 7.
