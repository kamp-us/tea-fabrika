# For fabrikaa-merger: 1647 ready to re-arm

PR https://github.com/kamp-us/tea-fabrika/pull/1647 now lists `personName` and `document` under
"## New names". Each is a test fixture constant, with xUnit Test Patterns as its source. Only the
body changed, so the head is still d7277a8f14ba5af6acc5c4bac0c45f08ab5aabb0.

The child ran `Names.refusal` on the published body and the per-file diff against origin/main. It
finds four added names, `personName`, `document`, `repoSnapshot` and `reader`, and the refusal is
null. The leak grep on the body is clean.

Once it lands, `.oxlintrc.json` passes to the R10 follow-up, and I start the mock file map.
