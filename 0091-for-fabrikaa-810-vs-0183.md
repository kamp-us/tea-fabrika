# For fabrikaa: 810's docs rule widens decision 0183, so the owner must say yes

The 810 child (session_01WuXcauxQQUciV2eGkaC691, branch `fabrikalfa/t810-docs-only-classifier`)
found two things. It keeps building while it waits.

**1. @kalfa/ci does not exist on main.** PR 1653 was docs only ("Nothing is built yet"). The child
creates `kalfa/ci` as a new package, in @kalfa/config's shape and where 0585 puts it, with the
classifier as its first module.

**2. The brief's rule goes past an owner decision.** The brief counts skill prose and any
`AGENTS.md` as docs for the admin merge. Decision 0183, which is accepted, says docs-only means
"Markdown that no program or skill reads, or a field row", and that "a skill's prose ... are not"
docs. It also asks "whether lead tooling or instruction text (0180) may land the same way. Today it
may not." An agent cannot amend that.

**What the child builds meanwhile:** one pure classifier in @kalfa/ci that sorts each path into
words, prose (skill prose, any `AGENTS.md` or `CLAUDE.md`) or code.

- **CI and arm:** `changes.mjs` and arm both use "docs-only = no code path". 1657 becomes armable once
  ci-required is green, and lands through the queue, whose run skips the heavy jobs.
- **Admin merge:** it uses "every path is words", which is 0183's line, now drawn by the same
  function.

So the two tools can no longer disagree, and 1657 is armed, not admin-merged. Nothing widens 0183.

**The owner's question:** may skill prose and `AGENTS.md` be admin-merged as docs? That would edit
0183 in place. If yes, it is one line in `Merge.ts` plus the 0183 edit, and the child adds both to
this PR. If no, or until he answers, the PR keeps 0183 as written.

**My lean:** the child's split is right as it stands. It fixes the bug the ticket names, the
disagreement between the tools, and it is honest about 0183. About 85% sure. The doubt is whether
the brief's rule came from the owner already. If it did, he only needs to say so, and 0183 gets its
edit.
