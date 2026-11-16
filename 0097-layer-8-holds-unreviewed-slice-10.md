# 0097: stack layer 8 (Reflect) holds slice 10's sent-back code; I lean to hold it

`fabrikalfa/reflect-fold-1` is at `f32959130`, cut from `eeb8ecdbb`. It merges `reflect-rest` at
`cc7bd5ca5`, plus layer 7. `reflect-rest` already carries Reflect slice 10's first tests and build,
the round its review sent back. So this layer would land code that has not passed review.

**Your call:** hold layer 8 until slice 10's fix round passes review, or land it now with slice 10
named as unreviewed.

**My lean: hold.** I am about 80% sure. The fix round is already running on `reflect-rest`, and
holding costs one more fold merge. Landing now ships `control.ts` with no per-method argument
decoding, plus a law that breaks 0555, 0576 and 0579.

## What is unreviewed in `cc7bd5ca5`

It is exactly `git diff 4e9601147 87e2b274a`: 13 files, +620 -240.

- **Product, one file:** `next/packages/libfabrika/src/cloudflare/control.ts`, hunks `@31-32`,
  `@34-73`, `@76-83`, `@127-138`, `@141-155` and `@158-159`. That is the typed name table, the
  call helper with `Reflect.apply`, and the per-target dispatch. The review sent it back because
  nothing decodes each method's arguments.
- **A new law:** `cloudflare/control.laws.test.ts`, +256, the old L8 over raw JSON arguments. It
  was sent back for `vi.mock` (0555), `decodeUnknownSync` (0576) and a raw `fc.assert` (0579).
- **Test rewrites:** eight files, each changing a Reflect use into a typed read or a `Stub.make`:
  - `platform.test.ts`, `readers.laws.test.ts`, `error-cause.test.ts`, `p14.test.ts`,
    `ObjectService.test.ts`, `alarm.laws.test.ts` and `index.test.ts`, all under `cloudflare/`;
  - `telemetry/Records.integration.test.ts`.

  The review found these fine, except the 6 `settingsStart` `@ts-expect-error` casts it rejected:

  | File | Line |
  |---|---|
  | `ObjectService` | 327 |
  | `alarm.laws` | 172 and 382 |
  | `error-cause` | 202 |
  | `index` | 105 |
  | `p14` | 57 |

- **Config:** `.oxlintrc.json` +1, at line 2422. It adds `cloudflare/**` to the Reflect ban.
- **Rows:** `field/runs/2026-11-15-reflect-ban-s10-tests1.json` and
  `2026-11-16-reflect-ban-s10-build1.json`.

## What is known red

Nothing yet.

- Lint and one typecheck pass at `f32959130`.
- No vitest has run at the fold yet. At `87e2b274a` the review ran every one of these laws, and
  all were green.

## Slice 10's fix round

It runs on `reflect-rest`. Its tests are at `3379b4d89`: a new L8, red until the build adds
Payloads. Its build is running. It replaces `control.ts` and `control.laws.test.ts`, and removes
the 6 casts. Slice 10's reviewed version and slice 14 would come in batch 2.

## Also in flight on layer 8

- It is merging layer 7's newer head, `299c2819b`.
- After that, it runs chaos-revoke and dev-control (`.integration.`, no override) and slice 10's
  laws at the new head.

I will mail that head and its counts.
