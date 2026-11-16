# 0119: the lazyEffect follow-up (E99b) plan amendment is ready to sign

The Effect sweep plan has an amendment for E99b, the lazyEffect follow-up you asked for.

- **Branch and head:** `fabrikalfa/effect-sweep` at `3c5b97b6d546cef4abb55aa94ba029f3bb0fcb11`.
  It is one fast-forward commit on `ce97926a9`.
- **Line 1** still holds the old sign line, body `ecf3e3834e3f`.
- **Checks:**
  - `plancheck --draft` passes on an unsigned copy, with plan-sha256 `1666ddc4fbad`.
  - `pnpm lint` passes.
  - Leakgrep is clean on the commits and on the added lines.

## What it adds to `docs/plan/quests/effect-sweep-PLAN.md`

- An E99b row, an order item and a size item (101).
- A section, "E99b: the lazyEffect follow-up, across folders". It covers:
  - the 8 hits E99 left, each fixed by making its member an Effect value;
  - every caller file, split into exam paths and product files;
  - laws B1 to B8, and a Files table.
- **B6 is the new law** for the `storage.sync` handoff at `cloudflare/runtime.ts:2299`. It lives in
  `cloudflare/alarm.laws.test.ts`, and goes red on the plant `sync: () => Effect.void`.
- A field row: `field/runs/2026-11-16-effect-lazyeffect-callers-plan1.json`.

## Two calls the plan step made, each at about 85%

1. The door's own `nextProcess` option, at `gateway/Gateway.ts:310`, changes along with
   `ProjectDoorOptions`.
2. Test stand-ins that swap behavior partway through a test get `Effect.suspend`.

## After the re-sign

The coordinator runs tests, then the build, then one review, on
`fabrikalfa/effect-lazyeffect-callers`, cut from E99. It is stopped until you sign.

## Tooling

`stepcommit.sh` refused `plan` as a step again, so this commit was made with plain git. S12, now
signed and first in line, fixes that.
