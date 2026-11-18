# PR 1589 merged the package layer at 51acff46b; head 7a6862eb9

1589 is pushed at `7a6862eb99a19665fadea7e5bd7b34e09e5dc849`: a merge commit of
`origin/fabrikalfa/kalfa-config-package` at 51acff46b. CI is now running on the top.

`runtime.ts`, `Runner.ts` and `Sink.ts` came in clean from the parent; none of them
differs from 51acff46b. Only 1589's five CI files conflicted. I kept main's lines (1569
removed the checklist plants) and laid 1589's on top.

## Hunks resolved by hand

1. `.github/ci/related.ts`:
   - `select` returns `{ legs, projects, archive, consumer }`. The plants assignment and its
     owner checks are gone; our `owner()` helper stays.
   - `outputs` prints `archive=` and `consumer=`, with no `plants=`.
   - In `main()`, next-integration is `confirmed(withReaders(...))` with main's
     `wantsChecklistLaw(changed) ? [checklistFixture] : []`, in place of our old
     `wanted`/`fixture`. Our `kalfa/` reader clause and the PACKAGE/CONSUMER `confirmed(...)`
     wrappers stay.
   - One comment now names `wantsChecklistLaw`, not plant-related.ts's `wanted`.
2. `.github/ci/workflow-lint/related.ts`: OUTPUTS is
   `["run","legs","files","projects","archive","consumer"]`. R1's ordered command list is
   install, INTEGRATION, RECEIPT, TOOLING, FAULT, time-table, with the plant-related.ts
   command dropped.
3. `.github/workflows/check.yaml`: select's outputs keep archive and consumer, with no plants.
   The `package receipt` step stays after integration. The `checklist faults` step is dropped.
4. `.github/ci/changes.test.ts`: both sides added separate laws at the same place. I kept
   both, ours (T1076 O3) and then main's `.gitattributes` laws, with nothing edited.
5. `.github/ci/related-selection.test.ts`: the imports join ours with main's
   `wantsChecklistLaw` and drop the plant-related.ts import. The output-key laws drop
   `plants`: six emitted keys and four result keys.

## Follow-on edits outside the hunks, needed by main's change

- `related-selection.test.ts`: the D-law printed-keys list drops `plants`, and its comment
  says six outputs.
- `workflow-lint/related.test.ts`:
  - The D4 law says six outputs, not seven.
  - The D3 order list drops `checklist faults`.
  - The R1 fault case `receipt_after_checklist_faults` becomes `receipt_after_tooling`, which
    places the receipt after the tooling step. R1 itself still refuses it.

## What ran here (Node 26)

- `pnpm lint` passed.
- `pnpm typecheck` passed.
- These narrow tests passed: related, related-selection, changes, legs, and the
  workflow-lint tests related, record, changes, next-job, merge-line and time-tables, plus
  `scripts/kalfa-config.test.ts`.
- Leak check: clean on the 13 pushed commits and on the net diff against the parent.

Next: the same reviewer rechecks the moved lines, and I keep 1589 green.
