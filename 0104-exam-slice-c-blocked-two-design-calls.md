# 0104: exam slice C is blocked on two design calls and one refusal

Slice C of 0591 (`reads` on LawOptions) stopped after its tests step.

- **Branch:** `fabrikalfa/exam-to-lint-c`, head `6b3e6fd`, pushed, leakgrep clean.
- **Not run yet:** the build and the review.
- **Not merged yet:** 0580's reviewed head `492feb546`. It goes in right before the build.

## Done

| Piece | State |
|---|---|
| R1 and R2 in `vitest.reads.test.ts` | seed 119120; green, and each turned red by its plant |
| R3 in `Law.types.test.ts` | red, as planned, until the build adds `reads` to `Law.ts` |
| `lawReads` and `readsOf` | in `vitest.reads.ts`, wired into `vitest.config.ts` |
| `reads:` declarations | in 9 files |

**Blocked:** 8 more files have no `reads:` declared yet.

## (1) A permission refusal, on `exam/commits-git-chain.integration`

A permission check refused the step's edit of that file. That is a stop, and nothing retries it.
The path holds the word "git", so I suspect the same worktree check that refuses any argument
holding "git". I have asked for the exact refusal text and will send it. If it is that check, it
is a new sighting for the compound-command ticket. A file the check will not let a step edit then
needs another way in: the package-script fix that ticket asks for, or a person.

## (2) A design call: `it.each` on `@kampus/vitest`

`commits-git-person`, `-signatures` and `-steps` use `it.each`. `@kampus/vitest`'s `it` has no
`each`, `for` or `skipIf`, so these laws cannot take `reads:` without a change. The plan does not
cover it.

| Option | What it costs |
|---|---|
| (a) Grow `Law.ts` with `each`, vitest's own name and shape, taking the same `LawOptions` | One new API on the package, with its own type law. 0580 owns that package, so its plan or this one needs a row. |
| (b) Rewrite the three laws without `it.each` | The test bodies change, so plant-check counts them as changed laws, with heavy plant runs. |

**My lean: (a), about 70%.** It keeps the industry's name, and the three laws stay untouched. My
doubt: whether `each` on a property-law package fits 0580's shape, since 0580's laws are mostly
`it.prop`.

## (3) A design call: plant-check reads options only as a trailing object

The laws in `bytes.integration`, `build.integration`, and `node/build`'s `build-assets`,
`build-one-file` and `css` pass their options second, as a number (a timeout) or by name.
`.github/ci/plant-check.ts:214` strips options only when they are a trailing object literal. So
moving these laws to `reads:` counts as changing them, with heavy plant runs.

| Option | What it costs |
|---|---|
| (a) Teach plant-check to strip vitest's second-argument options too: `it(name, options, fn)` and `it(name, fn, timeout)` | A change to a CI check, with its own law and plant. |
| (b) Accept the plant runs for these 5 files | Box time, with no new risk. |

**My lean: (a), about 75%.** vitest's own signature takes options second, so the check is simply
short of vitest's API. My doubt: the change touches plant-check, which is 0580's work too, now
reviewed. It would come in as a small follow-up slice with its own review.

The step's finding row `2026-11-16-plant-check-options-in-body` is being committed now.

## Two notes for the build, once C resumes

- `toTestOptions` must move `reads` into `meta`. That goes beyond the plan's 6 type lines, because
  the step extended the `Law.test.ts` property.
- Plan notes: Slice F's M8 plant leaves L9 green. `node/build/error-cause` is now a `.test.ts`.

Slice D waits on C.
