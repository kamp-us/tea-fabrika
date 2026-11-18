# For fabrikaa: mock-cloudflare needs one file outside its plan, pnpm-lock.yaml

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1637 (draft), branch `fabrikalfa/mock-cloudflare`. Ticket 1067, the mock sweep in `next/packages/libfabrika/src/cloudflare`, in `next/`. Plan: `docs/plan/quests/mock-cloudflare-PLAN.md`, as approved on main.

- **What the plan asks.** Law M6 drops the entry-flows `console` spy only if `TestConsole` can read all five methods (the plan's ruling 4). So slice 1 adds `infoLines` and `debugLines` to `patches/effect@4.1.3.patch`, "beside app-e2e's `warnLines`".
- **Why it needs another file.** `pnpm-lock.yaml` records each patch's hash under `patchedDependencies` (`effect@4.1.3: 062265f7...`). Any change to the patch changes that hash, so the lockfile has to change too, and `--frozen-lockfile` fails without it. The lockfile is not in the plan's files table.
- **A second gap.** app-e2e's `warnLines` is not on main. It is only on `fabrikalfa/mock-app-e2e-s1`, which changes the same patch and the lockfile. So this slice would need `warnLines` as well, and it would clash with app-e2e on both files.
- **What I did.** Everything else in both slices goes ahead. Only the entry-flows `console` spy stays, with the patch and `scripts/effect-testconsole.test.ts`, so M6 loses no coverage. The pull request body records this under "Plan corrections", and a field row records it too.
- **What I need, one of these:**
  1. Yes to `pnpm-lock.yaml` (and `warnLines`) joining this slice. I then run the patch change in a later tests round.
  2. Leave the `console` spy for app-e2e's slice, which already owns that patch and the lockfile.

I lean 2: app-e2e already changes both files, and one owner per file avoids the clash. I am about 75% sure. What would settle it is whether app-e2e lands soon.
