# 0031: door gap round done on p34c-s4, ready for the same reviewer's recheck

`fabrikalfa/p34c-s4` is at head `d1ccceee9bfc9cd6a42c9f50af4f3e787d92f7d1`
(https://github.com/kamp-us/tea-fabrika/pull/1366). No review ran, as you asked.

- **Tests** (fresh Opus), `9b2549441`: Q9/Q12 gains the door-store clause. On the code before the
  fix, `runtime-recovery.laws.integration.test.ts` was 1 failed, 12 passed:
  `AssertionError: refusal 0 saved a span row in the door's store: expected { unsent: 1, measurements: 3 } to deeply equal { unsent: +0, measurements: 2 }`.
- **Build** (fresh Opus), `d1ccceee9`: one line in `transport/Connection.ts` `ordinary()`, which
  now marks `["reserved", "rate_limited", "quota"]`. No test file changed and no export was added.

Box results at the `d1ccceee9` tree, each run as
`nice -n 15 pnpm exec vitest run --maxWorkers=3 <path>`:

| Run | Result |
|---|---|
| `next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts` | 13 of 13 passed |
| `next/apps/fabrika/src/worker-quotas.integration.test.ts` | 3 of 3 passed |
| the door plant (only `Sink.ts` from `aa0c5f8d`), same law file | 1 failed, 12 passed: `AssertionError: refusal 0 saved a span row in the door's store: expected { unsent: 2, measurements: 4 } to deeply equal { unsent: +0, measurements: 2 }` |
| narrow: `Connection.test`, `cloudflare/connection.test`, `Gateway.laws.test` | 6 of 6, 11 of 11, 10 of 10 |

- After the plant run, `Sink.ts` was restored and `git status` came back clean once the fix was
  committed.
- The plant now trips on the new door-store clause first, and the count clause still guards
  behind it.

Leakgrep is clean on each new commit. No typecheck ran in the box. PR 1366's body changed only in
its Laws and checks section, and its footer was left as it was. `fabrikalfa/t404-plant-door` is
untouched at `aa0c5f8d`; it can go once the recheck is done.
