# 0111: exam slice C's `each` amendment is ready to sign; PR 1520's new head

## Exam slice C: the `it.each` amendment, for re-sign

`fabrikalfa/exam-to-lint` (PR 1504's branch) is at `01ddbee70`, which is one plan commit on top of
`5c18d7893`. The plan file had not changed since the approved `262d4dc`.

**Checks:**

- `plancheck --draft` exits 0, with plan-sha256
  `7292fedef1c2a9a9f895467245e287036f9b0306963055e7680da31b0b50905a` and 20 product lines.
- `pnpm lint` exits 0 on all 18 parts.
- Leakgrep is clean over `origin/main..HEAD`.
- Line 1, the approval line, is blank and unsigned, for you to sign.

**What it adds:**

- **`each` on the package's `it`,** in the form `(cases)(name, options, fn)` only. It cites vitest
  5.0.5's installed types and vitest's title formatting.
- **R7,** a test in `Law.runner.test.ts` with fixtures. Titles must match vitest's own `it.each`,
  and options must land in `meta`.
- **R8,** a type law in `Law.types.test.ts`.
- **R1's generator** now covers `it.each` calls, so `readsOf` finds `reads` written that way too.
- **The three commits-git rows** declare `exam-paths.json` through `it.each`.
- **Your plant-check ruling,** recorded under Laws.
- **Size:** `Law.ts` gains 12 product lines (18 in all), and the slice grows to about 2.5 agent
  hours.
- **New sections:** Existing tools, and New names (`each` and `reads`).

**The plan step made three calls, written in the plan for you to check:**

1. The `(name, fn, timeout)` form and the template-string form are left out, because no law in the
   sweep uses them. The step is 80% sure.
2. The body returns void, as 0579 has it.
3. Files lists `.github/ci/plant-check.ts` as unchanged, because plancheck asks for a row for every
   file the plan names.

**A tool gap:** `stepcommit.sh` has no `plan` step. It gives "unknown step plan" and exits 2, so
this commit was a plain `git add` and commit. That fix is already folded into the 0113 S12 slice.

**After your re-sign:**

1. Merge 0580's `492feb546` into `exam-to-lint-c`.
2. Tests: `each`, R7, R8, and the plant runs for the 5 files, one at a time.
3. The build.
4. The review.

`commits-git-chain` stays held for the owner.

## PR 1520: new head `9e1c76a82`

demlik#968 is now linked in two places:

- **The patch note:** one comment line in `pnpm-workspace.yaml`'s `patchedDependencies` note for
  `@demlik/code-graph@0.15.0`, added with stepcommit as the lead step. It changes no code.
- **PR 1520's body:** updated through `update_pull_request` after `leakgrep --text`. It links
  https://github.com/kamp-us/demlik/issues/968 and adds the lead row to the Steps table.

Leakgrep is clean over all 14 commits. The PR is still a draft, and nothing is merged or armed. It
is ready for your merge session to land after stack #1522.
