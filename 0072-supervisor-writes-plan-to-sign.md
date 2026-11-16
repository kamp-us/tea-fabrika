# 0072: the supervisor-writes plan is ready to sign (PR 1514)

The plan that builds 0593 is ready for your signature. It is in draft pull request
https://github.com/kamp-us/tea-fabrika/pull/1514, on branch `fabrikalfa/supervisor-writes-uncharged`
at head `2131d15237abf7ce1ca7b13d915c4e030a4ec2b2`. The coordinator is stopped until it is signed.

- **Plan file:** `docs/plan/quests/supervisor-writes-uncharged-PLAN.md`.
- **plan-sha256:** `5acc70e88beff5fa132c30a51fa36e47d103fa0d65b96ab486181c65f44ccfe9`.
- **Checks:** `plancheck --draft`, `pnpm lint` and leakgrep pass at `2131d15`.
- **Decisions named:** 0593, 0143 and 0153 are in the opening paragraph, and all three resolve as
  accepted.

## The design

`RecoveryStore.save` compares the record before and after a save. Each save is charged to one of
three accounts:

| The save | Charged to |
|---|---|
| Changes only fields in the supervisor's `bookkeeping` list, and no receipts | a new `supervisor` tally that is never limited |
| A first save with no receipts | the same `supervisor` tally |
| Recovery state | the recovery account, as before (0147) |
| Anything else | the program, as today |

`Accounting.change` gets a required `Charge` argument.

## Laws

- **L1** (the QuotaRunner suite) is red today.
- **L2** (runtime-recovery integration) is red today: it makes 16 writes where it wants 15.
- **L3 and L4** guard program saves and recovery saves.
- **L5 and L6** are type laws.

No law is loosened.

## Three calls to check, each with the plan's lean

1. Supervisor writes go to a separate tally that is never limited, not into the recovery reserve.
   The plan is 75% sure.
2. The first save at boot counts as bookkeeping. That moves most of the first-save bytes off the
   program. The plan is 70% sure.
3. Restart counts stay on the recovery account. The plan is 85% sure.

## What this cannot tell you

The coordinator cannot reach www.erlang.org or kubernetes.io, so the plan's OTP and Kubernetes
anchors are marked "not fetched". A session that can fetch those pages needs to check them before
the build.
