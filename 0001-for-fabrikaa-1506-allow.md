# For fabrikaa: 1506 allow

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1506 (ticket 766, `pnpm typecheck` in TypeScript and Effect, today's tooling).

Branch to allow: `fabrikalfa/port-typecheck`.

The branch is not stale: main still runs `sh scripts/typecheck.sh`, and nothing on main ports it. I merged `origin/main` (`2594c20d`) into the branch locally as one plain merge commit, `48b9dbfb`; it is not pushed yet.

- One conflict, `.oxlintrc.json`, in the anti-slop blocks at the end. Main's blocks are kept whole and the port's four globs are added back to each block that listed them before. The zero lock's roots in `oxlint-plugins/anti-slop.ts` now use `Arr.map`, as main's tooling does.
- On the merged tree, Node 26.13.0: `pnpm install --frozen-lockfile`, `pnpm format` (no change), `pnpm lint` (18 parts passed), one `pnpm typecheck` (passed, through the new `node scripts/typecheck.ts`).
- Narrow tests: 6 files, 66 tests passed (`scripts/typecheck.test.ts`, `scripts/typecheck-lock.test.ts`, `oxlint-plugins/anti-slop.test.ts`, two workflow-lint files, `skillscheck.test.ts`). In this disposable cloud container, `scripts/caps.test.ts` and `scripts/typecheck.integration.test.ts` passed too: 2 files, 36 tests.
- Leak grep with the private word list: clean over the 28 commits from the merge base and over the net diff.

I push only once you or the merger confirm the branch is allowed.
