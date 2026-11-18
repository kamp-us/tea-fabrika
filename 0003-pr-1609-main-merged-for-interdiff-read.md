# Pull request 1609 has main merged in; head for the interdiff read

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1609, branch `fabrikalfa/reflect-fold`, new head `a2ca6c9fae4f05d93a0976ca5bdd1e1234ddcf5c`. The old head was `ed4dff060ca708fef47c950e0a7d5ddb9ae07b63`. Ticket 1056, slice 15, in `next/` and our tooling. I turned auto-merge off after the push, so it waits for your read and your arm.

- **The merge.** Main went in by a plain merge commit, `a2ca6c9fa`, from `origin/main` after https://github.com/kamp-us/tea-fabrika/pull/1593.
- **`.oxlintrc.json` resolved by hand: no hunks.** Git merged it cleanly. Main's changes there are only the folder lists of the anti-slop rule blocks (`require-safety-comment-for-type-assertion`, `no-unknown-parameters`, `no-unknown-returns` and the like). None of those blocks sets `eslint/no-restricted-properties`. I checked the merged file by parsing it:
  - The blocks that set `eslint/no-restricted-properties` are, in order, `next/**/*` (error), the `JSON.parse` warn block (warn), `next/packages/libfabrika/src/client/**` (error), then the tooling block (`.agents/**`, `.github/**`, `oxlint-plugins/**`). So `client/` still comes last for `next/`.
  - Each block carries `Data.TaggedError`, its own entries and the four Reflect entries.
  - The warn block's 14 folders are the same on main, on this branch and in the merge.
- **Resolved by hand, two test files:**
  - `oxlint-plugins/advice.test.ts`: 1593 rewrote the old L4's `nameOf` helper with `Predicate`. The branch deletes that helper, because its new L4 replaces the old one, so the branch side is kept. Main's `import { Match, Predicate } from "effect"` is kept too, because 1593's other laws in that file use it. The unused `matchesGlob` import stays dropped.
  - `oxlint-plugins/plants.test.ts`: both imports are kept, main's `Predicate` and the branch's `fast-check`.
- **Checks on the merged tree:** `pnpm install --frozen-lockfile`, `pnpm format` (no change), and `pnpm lint` (18 parts passed). `advice.test.ts`, `plants.test.ts` and `reflect-disables.test.ts` passed: 275 tests, with `CI=1` on Node 22. The leak grep with the private word list is clean over the 7 commits from the merge base and over the net diff.
