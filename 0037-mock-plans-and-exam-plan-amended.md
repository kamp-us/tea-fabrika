# 0037: mock plans and the exam-to-lint plan amended, both ready to sign

## Mock plans: https://github.com/kamp-us/tea-fabrika/pull/1491 at `6de2b17`

All 12 plans were amended in `cac6041` with every sweep-wide and per-plan ruling, and the
cloudflare readers item. The stdout/stderr ruling arrived after `cac6041` was pushed, so it is a
second commit, `6de2b17`, not part of the one commit. No history was rewritten, so the merge
session signs over two commits.

`6de2b17` changes three plans:

- **cloudflare:**
  - Question 1 moves to "Answered".
  - The two entry-flow `process` spies go in slice 1.
  - New law M13: oxlint's built-in `no-restricted-properties` refuses `process.stdout` and
    `process.stderr` in every libfabrika file except `*.test.ts`. Its planted
    `process.stdout.write(secret)` is refused in a product path and in a test-support path, and
    allowed in a test file.
- **node-dev:** M3 is the same law. Whichever slice folds first turns it on at zero, in the same
  fold PR.
- **node-client:** its two `process` spies and its lock no longer wait on the owner, so they go in
  its own slice. You did not name this plan, but it was waiting on this exact answer, so the child
  changed it too.

Notes:

- **The one exception:** `next/packages/libfabrika/src/node/client/JournalSqlite.child.test-support.ts:37`.
  A child process prints a "ready" line that its parent law reads as a start signal. It gets a
  disable line with that reason. On main at `0683861` it is the only raw write outside test files,
  and `node/dev` has none.
- **Lint config:** five `.oxlintrc.json` blocks already set `no-restricted-properties` on libfabrika
  paths. oxlint keeps only the last matching block's options, so the plans add the two `process`
  entries to each of those five blocks, not a new block. One of M13's plants goes red if any
  existing entry, such as the bare `JSON.parse` ban, is lost.

plancheck passes on all 12 plans, and so do format, lint and leakgrep. The row
`field/runs/2026-11-15-mock-plans-amend-stdout.json` has an empty end time; the child did not read
the clock before it committed.

Still for the merge session:

1. **Interim lock:** do files that still hold another sweep's `vi.mock`, `vi.doMock` or
   `vi.stubEnv` keep a narrower lock as an interim block? This is cloudflare Q2, app-src Q3 and
   node-dev Q3.
2. **Fold branch:** confirm the name `fabrikalfa/mock-fold`, which the child picked.

## Exam to lint: https://github.com/kamp-us/tea-fabrika/pull/1504 at `4b7a59d`

The plan now has no open questions.

- **`laws-scan` becomes the rule `fabrika/machine-has-laws`**, on `Machine.make(`.
  - It requires each machine to have a laws file beside it, with a property law and either a
    `syncTest(` call or a written reason for leaving it out.
  - It has exactly 30 hits on main, out of 35 files that call `Machine.make(`. 14 machines have no
    laws file; for `Access.ts` that is a rename of `AccessMachine.laws.test.ts`. 16 laws files have
    no sync test and no reason.
  - A new slice E fixes all 30 first, so the rule turns on at zero. Then the exam file goes. If a
    new sync test fails, that is a real fault in the machine, and the build fixes it.
- **`build.test.ts`:** its one law becomes the rule `fabrika/one-page-runtime`. It checks that the
  page entry starts one Effect program through `runMain`, once, at module scope.
- **`settings-generated.test.ts`** splits three ways:
  - L9, which files may import the TOML adapter, is already held by `no-restricted-imports`, so its
    plants move into `oxlint-plugins/`.
  - The law that the committed `person.json`, `repo.json` and settings reference match the
    generator's output keeps `reads:`, because lint cannot run the generator.
  - Its other two laws work by import, so they stay as they are.
- **Classes now:** lint 22, already held 0, `reads:` 16, open 0, and 9 with no check (unchanged).
  The plan has six slices, 21 steps, and costs about $84.
