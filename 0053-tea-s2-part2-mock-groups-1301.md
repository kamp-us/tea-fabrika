# 0053: tea-s2 part 2 done (local); mock groups running; PR 1301 box started

## tea slice 2: done locally, waiting only on the leakgrep fix

The branch is fixed except for the push. Origin is still at `2a248ba`. The local branch is
`2a248ba`, then `18a737b` (the 966 patch, held for leakgrep), then `a75c121` (part 2). A keep-alive
loop keeps the container up.

- **Part 2** (`a75c121`, row `field/runs/2026-11-16-tea-s2-tests5.json`) fixed all 27 sites the
  build sent back: 10 run-time faults and 17 type-error sites.
  - No product file changed and no product fault was found, so no build round is needed.
  - The row lists 28 plants, each red then green. No assertion was dropped, no run count lowered,
    and nothing skipped.
- **Chunk.test.ts L1 now expects `_tag`.** A chunk letter arrives as the reader's Msg
  (`runtime/Runner.ts:1838-1842`). 0569 puts every tea Msg on `_tag`, and the plan's files row says
  every expected Msg is keyed `_tag`. So the build's `Chunk.ts` change stands.
- **Wire frames keep `type`,** as the product schema does (`ViewNotice` at
  `client/WindowMachine.ts:400`, `Whole`/`Patched` at `runtime/Client.ts:197-204`). So WindowMachine
  L10's wrong-frame mutation is back on `type`.
- **For the reviewer:**
  - two hand-written `_tag` keys, at `next/programs/inbox/src/RunnerTest.ts:37` and
    `desktop/Menu.test-support.ts:78` (a type);
  - Runner's `<cmd>_ok`/`<cmd>_err` writes, still under their ignore.
- **Ran green with the 966 patch:**
  - 15 unit files, among them MsgKey (K1 to K2c), Program (K3) and counter (K9);
  - 6 integration files: Runner.integration (117), RunnerAdmission (11), ProgramMail (9),
    ProgramMailRuntime (23), chaos.laws (17) and inbox-runner (1). The guard refused none.
  - `pnpm lint`, the ratchet and the root `pnpm typecheck` pass.
- `leakgrep --commits 18a737b..HEAD` exits 0, so part 2 is clean. Only `18a737b` waits.
- Once the leakgrep PR (`fabrikalfa/leakgrep-patch-added-lines`) is on main, tea-s2 merges main
  in, re-runs leakgrep, pushes both commits only on exit 0, and updates PR 1431. The review comes
  after that.

## Mock sweep groups

- **Group 1:** each plan is one slice. app-e2e-s1 and lib-top-s1 are in tests. pipeline-s1 waits
  on app-e2e-s1's Effect patch (`warnLines`) and on tea-s2's 966 patch.
- **Group 2:** node-s1 and transport-s1 are in tests.
  - node-repositories-s1 and oxlint-plugins-s1 follow node-s1, because they extend its lock block.
  - transport-s2 follows both.
  - Stub.make is on main (through 1481), so nothing waits on it.
- **Group 3:** in tests are gateway-processes-telemetry s1, app-src s1 and app-src s2. app-src s5
  is next. The cloudflare, node-dev, node-client, gateway s2 and app-src s3/s4 slices wait on group
  1's foundations.
- **My call on the day,** which the cloudflare plan leaves to the lead: **cloudflare s2 goes
  first.** Reflect slice 10 has no branch yet. Reflect rest is told to merge mock-cloudflare-s2 in
  when its slice 10 starts, so whichever lands later carries the other's lines. Reflect slices 10
  and 14 can start after slice 9, since Stub.make is on main.

## PR 1301 box

One fresh box at exactly `808a511e9` runs `worker-quotas.integration.test.ts`, then counter's
`runner.laws.integration.test.ts`, each with
`nice -n 15 pnpm exec vitest run --maxWorkers=3 <file>`, no override and no code change. Counts
follow.
