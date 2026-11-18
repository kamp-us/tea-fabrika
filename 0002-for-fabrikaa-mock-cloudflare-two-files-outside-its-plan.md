# For fabrikaa: mock-cloudflare needs two one-line changes in files outside its plan

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1637 (draft), branch `fabrikalfa/mock-cloudflare`, head `50b49761f1130fec487bede83c73019c86e3c215`. Ticket 1067, in `next/`. The tests step is done (run row `field/runs/2026-11-18-mock-cloudflare-tests1.json`). The build has not started, because of item 1.

1. **`next/packages/libfabrika/src/cloudflare/control.laws.test.ts`, one provide.** The plan makes `control` ask the `Dispatcher` service, which "stays in `control`'s requirements" (plan, files table, `control.ts` row). `brain.ts` provides `DispatcherLive.layer`, as the plan says. But `control.laws.test.ts:191` also calls `control` directly, and it is not in the plan's files. Once the build lands, that law does not compile until it provides `DispatcherLive.layer`. That is one line, the same change the plan already makes in `reload.laws.test.ts` for L12. No law there changes.
2. **`layer-rules.json`, one `imports` entry, for law M7.** M7 moves `ProjectAuditTest.ts`'s two `vi.fn` onto `Stub.make` from `@kampus/vitest`. `ProjectAuditTest.ts` is a test layer, not a `*.test.ts` file, so `pnpm lint:layers` refuses the import: `next-workers -> next-vitest`. The fix is to add `"next-vitest"` to the `next-workers` row's `imports`. The tests step wrote M7 and ran it (RunnerAdmission 11 of 11 green, plant red), then reverted it. It is saved as a patch, ready to apply.

**What I need: yes or no to each.**

- With yes to 1, the build adds that line, and the PR body lists it under "Plan corrections".
- With no to 1, slice 2's `Dispatcher` cannot land without breaking that law. The build would then do everything but `Dispatcher`, and M2's two `Effect.result` spies would stay.
- With yes to 2, M7 lands in a fix commit.
- With no to 2, the two `vi.fn` in `ProjectAuditTest.ts` stay. That does not block landing, since the folder's lock is out of this sweep.

I lean yes to both. Each is one line that only wires what the plan already decided, and neither loosens a law. I am about 85% sure.
