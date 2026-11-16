# 0079: AS-no-manual-tagged-type-1's plan amendment is ready to sign; other status

The plan step for AS-no-manual-tagged-type-1 answered yes: the exam's control answers can be built
through the wire's own `Answer` schema, so both loose types go. The amendment is pushed and waits
for your re-sign. Further down: four status items since 0078, and two open items.

## The amendment

- **Branch:** `fabrikalfa/antislop-no-manual-tagged-type-1`, head
  `80f636342602db83f2d8dd24485506614f8bccc4`. No PR, and leakgrep is clean.
- **Plan file:** `docs/plan/quests/antislop-no-manual-tagged-type-1-PLAN.md`, with plan-sha256
  `367e1b645fe468410e354e96d20f60570eac966aa88224e73b208d486e770ac6`. `plancheck --draft` passes.
- **Field row:** `field/runs/2026-11-16-antislop-no-manual-tagged-type-1-plan.json`.

Decision 0562 supports the change and does not ask for loose answers. Line 121 of
`.decisions/0562-nothing-teaches-the-wrong-shape.md` says: "A tagged value in a test is made with
the schema's maker".

The new shape, at `agent-may.test.ts:452` and `:466`:

```ts
import * as Wire from "@kampus/libfabrika/transport/Wire"
type Answer = typeof Wire.Answer.Type
const methodAnswer = (method: string, actual: Answer) => { /* unchanged */ }
// Every control or planted answer is built with Wire.Answer.cases.<tag>.make(...):
// ok with result: null; parked with stream "ledger", after 0; the refused knock plant with reason "not_for_agents".
```

The 14 typecheck lines that change, numbered at `55e3418c1`: 608, 615, 619, 650, 654, 661, 675,
696, 699, 709, 735, 738, 739 and 741.

Before pushing, the plan step checked the shape on a scratch copy and then restored it:

| Check | Result |
|---|---|
| Typecheck, full shape | 0 errors |
| Typecheck, type swap alone | 14 errors |
| `agent-may.test.ts` | 10 passed, 1 skipped |
| Rule hits in the file | 2 down to 0 |

No assertion was deleted or narrowed. About 12 other hand-written `_tag` lines in the file belong
to the rule `no-manual-tagged-construction`, not this slice, and were left for that rule's slices.

**After the re-sign:** one tests step edits the exam, and the same reviewer rechecks it.

## Since 0078

| Job | State now |
|---|---|
| Mock plans | Every group's plans pass `plancheck --approved` at `7c84f1c35`. Group 1: app-e2e's L5 round has started, and lib-top's build is still running. Group 3: draining from three running agents down to the cap. Then it runs app-src s2's build, cloudflare s2's tests round for 0095, and cloudflare s2's build. Group 2: writing node-s1's amendment for the second re-sign. |
| App-src s1 | **Reviewed done** at `d821377bb`, with no merge conflict against main. A1 to A4 are merge-ready, and A5 is counted as moved, with no lock. Still owed: a small docs-only pass that writes the two pattern-doc cases for slice 1's build, and commits the reviewer's finding row. The row is about six new plant comments, which 0580 forbids, tied to ticket 1067. |
| PR 1519 (T753 L16) | A coordinator started on `297895bf9`. It runs one narrow review against 0535 and 0036, and box runs at fast and at full depth, with timings and a plant. Counts come in the next mail. |
| The stack | The rule is in the step rules at `80087ddc8`, and the effect-mechanical-2 and anti-slop coordinators are told. The anti-slop mechanical coordinator acked and is archived. Its last own head was `06b6d48`; `7a6af40` and later are the merge session's. |

## Open items

1. **The anti-slop mechanical follow-up.** `pnpm format` over the 9 folders that waited on 1366:
   libfabrika's cloudflare, gateway, ledger, processes, runtime, settings, telemetry and transport,
   plus `next/apps/fabrika`. It bases on `fabrikalfa/antislop-mechanical`, which you are
   restacking. Shall I start it on your rebuilt 1507 head, or wait until the stack lands?
2. **The compound-command ticket.** A fourth sighting today, on exam slice E: a `node` call whose
   quoted argument held the word "git" (skillscheck's path) was refused the same way. The rule is
   in the step rules at `4a85ed405`.

## What this cannot tell you

Whether a run of `agent-may.test.ts` under load shows the cold-cache flake that app-src s1's
reviewer saw in other files. Nobody has run it that way.
