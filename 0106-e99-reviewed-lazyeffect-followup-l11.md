# 0106: E99 is reviewed for layer 5; a lazyEffect follow-up slice needs an owner; L11 times out too

## E99 (`lazyEffect`): reviewed, merge-ready

`fabrikalfa/effect-e99` is at `e1e43937f40fa4a35b169b7949feaa5aa8fcee30`, leakgrep clean. A new
head with two finding rows comes next.

- **Hits:** the recount found 11, where the plan said 8.
- **Fixed, 3:** `StorageClient.sync` and `deleteAlarm` are now Effect values, and `fromLedger` is a
  `Layer.fresh`.
- **Left on purpose, 8.** Each fix reaches callers outside the slice's folders, in `apps/fabrika`
  and lib:node:
  - `GatewayCalls`, `ProjectService` and `Gateway.connect`;
  - `ProjectDoorOptions.nextProcess`;
  - `ProcessService`'s `init`, `alarm` and `recover`;
  - `ProgramRunner.init`.
- **Folders with hits:** lib:cloudflare 9, lib:gateway 1 and lib:runtime 1.

**The ask: a follow-up slice needs an owner.** The reviewer agreed the 8 were right to leave under
the brief. But nobody owns them, so `lazyEffect` cannot lock those folders until one slice takes
the libfabrika, app and lib:node callers together. That is yours to assign. I can start it in the
cloud if you say so.

**Two finding rows,** being committed on the branch now:

- `2026-11-16-lint-parts-oom-in-shared-box`: lint parts killed for memory in a shared box, each one
  passing alone.
- `2026-11-16-cloudflare-process-sync-has-no-law`: no law holds that `cloudflare/runtime.ts:2299`
  hands `ProcessStore` a real `storage.sync`. A plant of `sync: () => Effect.void` stays green.

## The same coordinator's other slices

- E98: done at `6dfde759d`.
- E87: in review, at `363983f7a`.
- E82: its build is running, with tests at `78f0bc551`.

## Two timeouts at 60 s, seen by three slices

They time out in this box, on main's own versions too:

- `runtime-recovery.laws.integration` T753 L16. PR 1519 fixes it.
- `start-child.laws.integration` L11. That makes a second sighting, after the build-one-file and
  start-child rows from earlier today, so under 0036 it needs its own ticket.

## Your rulings are passed on

- **E60** goes to your layer 5.
- **Exam slice C:**
  - (2) `each` on Law is going in as a plan amendment for your re-sign.
  - (3) The plant runs are accepted, and the plant-check change waits as a ticket for after the
    sev0.
  - (1) The refusal's exact text is being fetched. If the refusal was on a "git" argument, a fresh
    agent edits the file with the Edit tool only.
