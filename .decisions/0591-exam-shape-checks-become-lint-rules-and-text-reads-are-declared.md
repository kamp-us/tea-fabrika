---
id: 0591
title: The exam's code-shape checks become lint rules, and a test that reads files as text declares its reads on its law, so the changed set sees them and the hand-kept readers list goes
status: accepted
date: 2026-11-15
tags: [lint, exam, oxlint-plugins, vitest, kalfa, changed, proof-run, readers, ci]
---

# 0591: The exam's code-shape checks become lint rules, and a test that reads files as text declares its reads on its law

```ts
// Sketch: a test that still reads a file as text says so on its law,
// beside 0580's plant and label. The changed-set picker treats `reads`
// like an import.
law("the bundle holds no node: import", {
  label: "bundle",
  plant: "an import of node:fs in a browser file",
  reads: ["next/apps/fabrika/dist/**"],
}, () => { /* ... */ })
```

## Decision

The owner ruled on 2026-11-15, at 9:45 PM Pacific:

1. **The exam's code-shape checks leave the tests and become lint rules.** That covers the 47
   files in `next/apps/fabrika/src/exam/`: no-promises, no-hand-tag, no-of, effect-functions,
   layers, edges, deps and the like. Each rule keeps its tests and plants beside it in
   `oxlint-plugins/`. AGENTS.md already says a check on the shape of code is a lint rule, never a
   test, and `pnpm lint` already covers the same files.
2. **A test that still reads files as text declares what it reads.** It uses a `reads:` option
   on its `@kalfa/vitest` law, beside the plant and label options from
   [0580](0580-law-options-carry-plant-and-label.md). Examples are the build and bundle tests,
   settings-generated, and any exam check that lint cannot express, such as bundle output or the
   commit chain. The changed-set picker treats those reads like imports.
3. **The hand-kept `readers` list in `.github/ci/changes.mjs` goes** once points 1 and 2 land.

This amends [0590](0590-a-branch-proof-run-runs-only-what-its-change-reaches.md) point 4. A file a
law reads without importing it is declared on the law through `reads:`; it is not added to
`forceRerunTriggers`. Until this lands, the changed-set run adds the reader tests whenever
`next/` changes, as the 0590 build does.

## Consequences

- The build is one sev0 job, plan first, beside the jobs for
  [0573](0573-trusted-lint-rule-replaces-ours.md) and 0580. Point 1 overlaps 0573's trusted rules,
  and point 2 sits on 0580's law options.
- A rule that replaces an exam check proves it catches what the test caught, with that test's
  plants, before the test is deleted.
- A text read that a law does not declare is a miss. Main's full run (0581) shows it, and the
  fix adds the `reads:` entry.
