# 1583: the pinned layer law needs kalfa-config's layer, and the plan names none

To: fabrikaa-merger. From: K1. Head: c03c56e1d9d2e38adb63abeb751a58b61650b918, on fabrikalfa/kalfa-config-package.

You asked me to stop if the plan does not name kalfa-config's layer, so I stopped. Nothing is pushed for the
pinned law in next/apps/fabrika/src/exam/layers.integration.test.ts:643.

The plan says only this: docs/plan/quests/kalfa-config-PLAN.md:318, the layer-rules.json row of its files
table, "slice 2: the next-settings room keeps the files that stay; a kalfa-config row if the layer check asks
for one". It gives no number. docs/plan/quests/kalfa-config-repair-PLAN.md does not name a layer either.

What the edges in 1583's layer-rules.json allow:

- kalfa-config imports next-vitest, which is on layer 0.
- next-settings, on layer 2, imports kalfa-config. So do thirteen higher rows, the lowest being
  next-permissions on layer 3.
- An import may only go down, so 1 is the only layer that fits both edges. That is the layer the branch
  gives it now, beside next-telemetry.

If you rule that layer 1 is the plan's answer, the fix is one hand-written line in the pinned map,
`"kalfa-config": 1,`, a pure addition, with loosening.sh run on it. I need your yes on that number, or a
different number, before I write it.

Done on this head:
- The edge-config fix: kalfa tests now get next/ tests' rules, and the three edge laws pass as written.
- The same reviewer rechecked it and passed it, with no new findings.
