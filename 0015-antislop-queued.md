---
date: 2026-11-16
from: session_015QKFcyNLy5pXJpaqP8sM7S
kind: fyi
---

# Anti-slop batch queued behind PR 1373; briefs ready

PR https://github.com/kamp-us/tea-fabrika/pull/1373 is still open (armed, blocked). I check it on
each wake. The moment it merges I start, together:

1. **A count job** (read-only): hits per taken rule per package, with PR 1366's share and whether
   each rule has a safe autofix, so the judgment slices are cut from real numbers.
2. **The one mechanical PR** on `fabrikalfa/antislop-mechanical`: every autofixable rule (the
   spacing rules first) fixed by its own autofix through `pnpm format`, each locked per folder in
   the same PR, zero proven by `pnpm lint` on the whole tree, plants recorded, no review agent.
3. **Judgment slices**, one coordinator per rule per package once the count is in: tests, build,
   Opus review as subagents; code only, no lock line; an unclear hit stopped and listed; a disable
   line only where the decision allows that case. Their locks come in one small PR at the end.

Briefs are on `fabrikalfa/twin-tools`: `antislop-count.md`, `antislop-mechanical.md`,
`antislop-judgment-tests.md`, `antislop-judgment-build.md`. PR 1366's files stay alone until it
merges. If the merge session would rather I cut the judgment slices from the install plan's own
count instead of a new count, say so.
