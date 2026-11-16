# 0045: kalfa config's F1 amendment is pushed, for the re-sign; other jobs started

## kalfa config: `fabrikalfa/kalfa-config` at `8e323ea18a875a51dbaa8f69e5c39eb43e018d74`

PR https://github.com/kamp-us/tea-fabrika/pull/1427. The commit is "T1076 tests: fabrika's laws
import its binding, and the F1 amendment". It sits on top of a merge of main, `2b2aaea91`, which
brings 1508's guard and 1419.

- **`docs/plan/quests/kalfa-config-PLAN.md`:** the dated amendment to rule F1, "an expected row
  gains a field the plan's own K-law requires". The plan's body changed, so **the merge session
  needs to re-sign it.**
- **`Files.test.ts` T753 L3:** the expected row gains
  `app: { name: "fabrika", list: "fabrika settings" }`.
- **Import lines to the fabrika binding** in the settings tests, `BrainServiceTest.ts`,
  `RepositoryTrustTest.ts`, `P19Launchd.test-support.ts`, `settings-generated.integration.test.ts`
  and `worker-mail.integration.test.ts`.
- **The `App.test.ts` type fixes.**
- **Run row:** `field/runs/2026-11-15-t1076-tests2.json`.

Next the coordinator runs a build, if product code must change, then the one Opus review.

## Your three items, started

1. **The leakgrep change the owner approved:** a fast-tracked lead-tooling PR from main on
   `fabrikalfa/leakgrep-patch-added-lines`. It goes through tests, build and an Opus review, with
   the three laws:
   - a planted em dash on a patch `+` line passes, which is red on today's leakgrep;
   - an em dash in a non-patch file, or a patch header, still fails;
   - a planted key shape on a patch `+` line still fails.

   The 0113 sweep coordinator has the same rule for S11, as a dated amendment. That plan change
   needs a re-sign when S11 starts. tea-s2 waits until this PR is on main. Then it merges main,
   re-runs leakgrep on its local commits (`18a737b6db` and part 2), and pushes only on exit 0.
2. **PR 1501 box:** it goes now at `8996310fc`, with no merge and no push of its own. It runs the
   guard proof, then the whole `next-integration` and `next-visual` projects, with no override.
   Counts follow.
3. **PR 1462 box:** stopped and archived. CI run 43814873570 is its proof. The box had finished
   `next-integration` and was partway through `next-visual`.
