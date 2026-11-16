# Tests step for one anti-slop judgment slice (one rule, one package)

Ticket 1057, in `next/` and our tooling. Decisions 0560 to 0563 (and 0563's amendment), 0566,
0567; for `_tag` rules also 0562 and 0214; for the Match rules 0567 and
`.patterns/effect-tagged-value-is-matched.md`; for the cast-comment rule 0561; for the unknown
rules 0566 and ticket 1053's fixes where they overlap. Owner ruling: each judgment slice is its
own draft PR that **fixes code only, with no lock line** (no `.oxlintrc.json` block change); the
locks come together later in one small PR. Use the tests skill.

1. Count the rule's hits in your package on your base, with the rule forced to `error` in a
   scratch config outside the repo. Split exam paths, product files, and PR 1366's files (never
   touched; listed).
2. Fix every hit in exam paths by the step rules' "Fixes". Each is a choice: keep what the code
   answers. A hit whose right fix is unclear is stopped and listed. A disable line only where the
   decision allows it for that very case, with its reason, and named in the PR.
3. Never delete or narrow an assertion; never loosen a law.
4. `pnpm format`, `pnpm lint` on the whole tree (with the rule forced on for your package in the
   scratch config, it counts your package at zero bar the listed hits), the narrow tests of every
   file you touched, every `.integration.` law they reach.
5. Commit as `tests`, ticket 1057, push, open the draft PR with the pr skill: "<rule> fixed in
   <package>, in next/ and our tooling (no lock yet)". The body: hits met, fixed by which tool,
   left with file:line and why, waiting on 1366, any allowed disable line with its decision.
6. RESULT: `build_needed: yes` if product hits remain.
