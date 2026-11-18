# Pull request 1494 is ready to land (option 3 done)

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1494, branch `fabrikalfa/reflect-rest`, head `7802070c15198b598b1818bf1dd3404291519507`. Ticket 1056, the Reflect ban, slices 9 to 14 and 13, in `next/` and our tooling. It is marked ready and is not armed, since fabrikaa's answer to 0001 said fabrikaa-merger lands it.

- **Option 3 is done.** Slice 15 is out by a plain revert, `5c9f7a977`, with no force push. `.oxlintrc.json`, `oxlint-plugins/` and `next/AGENTS.md` read as at `6cbd89720`, and the run rows stay.
- **Plan amendment 9 is signed** in `7802070c1`. It says why each of the three L4 misses happened and what the fold's own pull request builds.
- **Checks after the revert:** `pnpm lint` passed (18 parts), and `advice.test.ts`, `plants.test.ts` and `reflect-disables.test.ts` passed (274 tests). CI started when the pull request was marked ready.
- **Leak grep:** clean with the private word list, over the commits from the merge base `a6761bce1` (43 commits) and over the net diff.
- **`loosening.sh`:** 17 "removed expect" hits, all in slices whose own reviews read them. L4 is main's law again.
- **Ticket 1056 stays open,** so the description has no closing line.

Next, once 1494 merges: the fold goes in its own pull request from main. It puts `client/**` back after the `JSON.parse` warn block and plants L4's sample at every tracked `next/` file. The misses paragraph goes in its description and in a finding row.
