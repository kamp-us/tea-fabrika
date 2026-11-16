# 0105: the typecheck port's fix-round amendment, ready to sign; layer 7's interim head

## The T766 typecheck port: fix-round amendment, for re-sign

The amendment is on `fabrikalfa/port-typecheck` at `aff5ac9fd`, plan-sha256
`d4265e208adba3f943a0e05d245c308f1f292daa81d63a54ad198c1f9b89f83e`.

**Checks:** `plancheck --draft` passes on an unsigned copy. `pnpm format` changes nothing,
`pnpm lint` passes 18 of 18, and leakgrep is clean over `origin/main..aff5ac9fd`.

**Step 4** now reads: "A dead .break is broken the same way, under <lock>.break.break". It cites
Mercurial 7.2.4, `mercurial/lock.py`:

- `_testlock`, lines 374 to 386: `lock(self.vfs, self.f + b'.break', timeout=0)`;
- `_trylock`, lines 297 to 343.

The old sentence stays, marked Wrong, with the review named as finder.

**The new section,** "Amendment, 2026-11-16 (fix round)", names:

| Law | Kind | What it holds |
|---|---|---|
| **N7** | test | A dead `.break`, a gone holder and two live takers, in the review's order, give one holder. Red now. Its plant puts `fs.remove(breaker)` back. |
| **L3** | lint | `scripts/typecheck*` joins `anti-slop-effect/no-manual-tag-comparison`. Red on the 8 product hits until the build. |

It also covers the tests step's 16 sites, and the build's work: `breakStale(breaker)`, removing
only its own `.break`, the `LocksFile.ts:100` comment, and the 8 product matchers.

After the re-sign, the run is: tests, then build, then the same reviewer. PR 1523 is not on main
yet, so the merge of main waits until right before the proof.

## Layer 7: interim head `da9bda73f`

`fabrikalfa/mock-fold-1` (PR 1526) folded app-src s1's final head `ab9dd3cff`. The fold's head is
`da9bda73f3fd5639642cfc9cf2af543adb41d033`.

- **The merge** (`2c635642`) had no conflicts. It brings only docs and rows: the Recorder pattern
  doc, a finding row and 2 run rows. `loosening.sh` found 0 hits.
- **The review passed,** with one finding that does not block. Every path:line in
  `.patterns/a-law-watches-calls-with-a-recorder.md` is stale, because the stack's spacing commits
  moved `Recorder.ts` and the tests it cites. The row is
  `field/findings/2026-11-16-mock-fold-1-recorder-doc-lines.json`. The fix is one docs commit,
  held until the spacing stops moving the lines.
- **Checks at `da9bda73`:**
  - `pnpm lint` passed 17 of 18 on the first run. `lint:dead` was killed by the box's memory limit,
    and passed alone.
  - `pnpm typecheck` passed.
  - Both leak checks are clean.
  - The clone is full, with one root, `6e9a51046`.
- **Not covered by this fold's review:** while the review ran, another session pushed
  `92ff6f505..2061cfce7` to this branch. That is the anti-slop mechanical follow-up merge
  (`6fa33e288`) and blank lines in three mock-fold test files (`2061cfce7`). I read that as your
  merge session. If it was not, say so.

**Still to come:** the plans merge at `4a17276e0`, which I asked for. It is not in this head yet,
and it moves the head again. Layer 6's head and newly reviewed mock slices follow.
