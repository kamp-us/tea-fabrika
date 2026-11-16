# 0030: Playwright half added to the environment; exam-to-lint plan PR 1504

## Environment (the owner's yes)

- `cdn.playwright.dev` is on the tea-fabrika environment's allowed hosts. The owner approved the
  prompt.
- I tested the line in my own box before proposing it. From `next/packages/tuval`,
  `pnpm exec playwright install --with-deps chromium` (Playwright 1.64.1) downloaded
  `chromium-1248`, `chromium_headless_shell-1248` and `ffmpeg-1013` into `/opt/pw-browsers`.
- The setup script now ends with these lines (owner-approved prompt):

  ```bash
  if [ -d tea-fabrika/next/packages/tuval ]; then
    (cd tea-fabrika && pnpm install --frozen-lockfile)
    (cd tea-fabrika/next/packages/tuval && pnpm exec playwright install --with-deps chromium)
  fi
  ```

  The repo's own install comes first because the script starts in the folder above the checkout,
  and `pnpm exec playwright` needs the repo's `node_modules`.
- A fresh box is checking it now: `ssh-keygen`, real (not linked) 1248 folders, and
  `key.laws.visual.test.ts` launching with no link. Result follows. Until then the script is
  unproven in a fresh box.
- The PR 1462 box run was started before this, so it keeps the 1243 link if it needs one. Its
  result will say so.

## Exam to lint (0591): plan PR https://github.com/kamp-us/tea-fabrika/pull/1504

The plan is at head `7339ed0`, with your added rule. Every lint row names its plants, the law
that runs them against the replacing rule, and one break that must turn that law red. An exam
file is deleted last, in its own commit, only after the new law is green on the real code, red
under each break, and the old test is still green on the same head.

How the 47 files sort:

| Class | Files |
|---|---|
| lint | 21 |
| already held | 0 whole files (one twin law is held by `lint:twin`) |
| `reads:` | 16 |
| open | 1 |
| no check (reads no text, checks no shape: `edges.ts`, `ratchet.ts`, their laws, the runner contract laws) | 9 |

- Four lint files become new checks: `secret-types`, `tsconfig-scope`, `node-kinds`, and `deps`
  as `next-manifests.ts` plus a `fabrika/package-deps` rule.
- No 0573 trusted rule holds an exam check today. `no-hand-tag` is the one overlap, and it waits
  on 0573's second PR.
- Order: slices A (move the plant tests) and B (new checks) wait on nothing. C (`reads:`) waits
  on 0580's first slice. D (the `readers` list goes) waits on C and on PR 1496. All four fold
  into PR 1504.

Open questions for the owner:

1. `laws-scan.integration.test.ts` looks for `defineMachine(`, which no `next/` file calls any
   more, so it checks nothing today. Make it a rule on `Machine.make(` (about 30 hits to fix
   first; the plan leans this way at 70%), or keep the old text?
2. `build.test.ts` and the L9 laws of `settings-generated.test.ts` read source text to check its
   shape. 0591 names them as `reads:` examples, but the repo rule says a shape check is lint. Keep
   them as `reads:` (lean, 75%), or move them to lint?

Tool note: `stepcommit.sh` refuses `plan` as a step ("unknown step plan"), so plan commits from
the cloud are plain `git commit`, unsigned. The other plan jobs hit the same thing. Ticket it if
plans should go through `stepcommit.sh`.
