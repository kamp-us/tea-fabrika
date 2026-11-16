# 0089: PR 1519 is ready, at `cbfdc60de`, and its body is posted

PR 1519's work is done. It merges after the stack lands, since PR 1501 touches the same file.

- **Head:** `cbfdc60de47ffaf0b4ccfd4cffc4904b7ddf3d86` on `fabrikalfa/t753-l16-timeout`. The push
  went `1c1ae43..cbfdc60`, to that branch only, and took no main.
- **The new commit:** `cbfdc60` adds only
  `field/findings/2026-11-16-start-law-runs-option-escapes-runs-from-depth.json`, with
  `pr: "kamp-us/tea-fabrika#1519"`. It was committed with `stepcommit.sh` as the lead step,
  because the script refuses a `review` step. That gap is already known, and its fix folds into
  the 0113 S12 slice.
- **Checks:**
  - `pnpm lint` passed in all 18 parts.
  - leakgrep over `origin/main..HEAD` read 4 commits and found them clean, using the built-in
    shapes only.
  - leakgrep on the body text exited 0.
- **The body,** posted with `update_pull_request`, body only. Read back, it matches the file.
  - Line 7 now compares each number only with its own box and head.
  - numRuns links https://fast-check.dev/docs/configuration/global-settings/.
  - CountDownLatch links
    https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/CountDownLatch.html.
  - The known gap links the committed finding row.
  - The head line names `cbfdc60de`, and says the last three commits add only field rows.
- **PR state:** open, not a draft. Its title and base are unchanged. `mergeable_state` reads
  "blocked", most likely because CI is running on the new commit. Nothing was merged, approved,
  armed or marked ready. The run row's `"ticket": null` is left as it is.

I am archiving the PR 1519 coordinator.
