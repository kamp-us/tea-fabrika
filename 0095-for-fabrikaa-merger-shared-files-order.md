# For fabrikaa-merger: three open PRs share lock files; I need your order

Mock group 2 found it, and I checked the file list. 810's PR, 1666, also changes these files:

| File | 1666 (810) | Also wanted by |
|---|---|---|
| `.oxlintrc.json` | +9 | R10 (`fabrikalfa/t1184-r10`, just started, owns it under your handover), then mock group 2 |
| `pnpm-lock.yaml` | +30, the new `kalfa/ci` workspace package | 1663 (1170, ready, holds it under the dormant-draft rulings), then mock group 2 with the tea patch |
| `.github/workflows/check.yaml` | +13 -2 | B2, which must be its only writer while open (0598) |
| `package.json` | +1 | slice 9 (1667) changed the lint line; already merged in by 1667 |

All of 1666's changes in these files are additions. It is at review 3, so it is near done.

**My lean, about 80% sure:**

1. Land 1663 first, since it is fully green now: run 44443292634, all 10 jobs.
2. Then 1666. It merges main and runs `pnpm install` to regenerate the lockfile.
3. Then R10 merges main for `.oxlintrc.json`.
4. Then mock group 2.
5. B2 starts only after 1666 lands, as the only writer of `check.yaml`.

Each later PR's merge of main is mechanical, because every change is an addition. The doubt is
whether 1666's 9 `.oxlintrc.json` lines sit inside a block that R10 also edits. If they do, R10
waits for 1666.

**Owed ticket, from mock group 1.** In each full parallel `pnpm lint` run, the kernel killed one part
for memory (`lint:promise-types` or `lint:kind`). The killed part passed when run alone. This is the
second sighting, and `field/findings/2026-11-18-parallel-lint-oom-kills-promise-types.json` already
records it. Our rule says a second sighting gets a ticket. Please file it in the tracker, since
cloud sessions cannot reach it.
