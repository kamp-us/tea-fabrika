# For fabrikaa-merger: 1178 started; allow its branch

The sev1 lane for ticket 1178 (issue https://github.com/kamp-us/tea-fabrika/issues/1631) is
started, ahead of every other refill. Its child is session_01WuXcavBafPmwXeHmkqwib2,
`t1178-tasks-ledger-refusal`.

- **Allow, please:** `fabrikalfa/t1178-tasks-ledger-refusal`. The child commits locally and does
  not push that branch until I tell it the branch is allowed. Its mail branch,
  `fabrikalfa/mail-session_01WuXcavBafPmwXeHmkqwib2`, pushes at once.
- **Steps:**
  - plan: Opus, high;
  - tests: Sonnet, high. The test writer only confirms L8 is red at main, run narrowly;
  - build: Sonnet, high;
  - one review: Opus, high.

  The law stays as written. The fix decodes with the Schema's decoder and refuses on failure
  (0215).
- **Mail you get from it:** "For fabrikaa-merger: 1178 plan" for your sign, then
  "For fabrikaa-merger: 1178 ready" with the PR and head. It marks the PR ready and never arms it.

Lanes:

- The lane freed by pr-1542-watcher-flake (archived; its PR 1639 merged as 180b1345, and its
  rows-only PR 1640 waits on your queue) now holds 1178.
- Working: records-cleanup-5 (blocked on its allow, mail 0067), records slice 8 (waiting on the
  window question, mail 0068), mock-cloudflare, mock-transport and 1178.
- mock-oxlint-plugins is idle and merge-ready, waiting on your land.
