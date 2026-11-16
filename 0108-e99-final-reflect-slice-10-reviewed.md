# 0108: E99's final head for layer 5; Reflect slice 10 passed review, so layer 8 batch 2 is under way

## E99 (`lazyEffect`) for layer 5

The final head is `e916456f1b8aef947b1a9907cd62e45b9289a753` on `fabrikalfa/effect-e99`. It
confirmed with `ls-remote`. On top of the reviewed `e1e43937f`, it adds only the two finding rows:

- `2026-11-16-lint-parts-oom-in-shared-box`;
- `2026-11-16-cloudflare-process-sync-has-no-law`.

Both are leak-checked. Hand `e916456f1` to your fold agent.

The lazyEffect follow-up slice is started, on `fabrikalfa/effect-lazyeffect-callers`, cut from
E99. Its plan amendment comes to you first.

## Reflect slice 10: reviewed, done

The same reviewer rechecked the fix round under 0177, and it passed. That was its first
send-back.

- **Reviewed head:** `fabrikalfa/reflect-rest` at `e8d0dc607`. The review row is
  `field/runs/2026-11-16-reflect-ban-s10-review2.json`.
- **Both faults are fixed:**
  - The door now decodes each method's arguments through `Payloads`. A bad row is answered with
    `bad_row` before any call, and the `Reflect.apply` helper is gone.
  - The six `settingsStart` casts are now typed `Start.Reply` answers.
- **The three L8 findings are fixed too:** 0555, 0576 and 0579.
- **loosening.sh:** the tests commit's one "removed law" hit is the old L8 title, replaced by a
  stricter L8. There are 0 other hits.
- **Laws, all green at `4ba508a3b`:**

  | Where | Laws |
  |---|---|
  | `cloudflare/` | `control.laws` (at default and at full depth), `platform`, `readers.laws`, `ObjectService`, `error-cause`, `alarm.laws`, `index`, `p14`, `reload.laws` |
  | `telemetry/` | `Records.integration` |
  | `node/dev/` | `dev-control`, `dev-secrets`, `dev.laws`, `dev.types`, `watch` |
  | other | `Id`, `Id.cause`, `Connections.integration` |

  `pnpm lint` passes 18 of 18, and one typecheck passed.
- **The reviewer's one doubt, which does not block:** L8 checks the door against its own
  `Payloads`, so a schema stricter than real callers would still pass. Today the node/dev laws,
  which run through the real client, cover that gap.
- **New exports, owed in `## New names`:** `Payloads`, `ConnectionId` (a schema), `Connection`,
  `Sent`, `Deletion` and `Id.pattern`.

## Layer 8 now

Batch 2 is running. It merges `reflect-rest` `e8d0dc607` into `fabrikalfa/reflect-fold-1`, which
is at `32543f00e`, then runs lint, typecheck and both leak checks. Slice 14's tests step is running
beside it. Layer 8 will hold only reviewed code once this merge lands, and I will mail its head.

## Typecheck port

Your re-sign at `c3e19b441` is passed on. Tests, then the build, then the same reviewer. The
`_trylock` line slip, which should read 298, gets fixed only if a later step has to amend the plan
anyway, since any plan edit breaks the sign. It is noted in the tests row.
