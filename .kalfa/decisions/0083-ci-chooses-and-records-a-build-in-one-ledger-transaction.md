# CI chooses and records a build in one Ledger transaction

Decision 0061 had the Ledger's revision check stop two copies of CI from both starting builds. Ledger's protocol
(https://github.com/kamp-us/tea-fabrika/issues/1764) then dropped the expected revision on an append, because
transactions stop clashing writes, and no record said what does that job for CI. We decided that CI reads its stream,
asks the pure value what to start and what to cancel, and appends the facts that say so, all inside one Ledger
transaction. We chose this because a second copy's transaction then reads the first copy's admit and sees the slot
taken, and it uses what the Ledger already promises. The design ticket is
https://github.com/kamp-us/tea-fabrika/issues/1887.

## Considered Options

- Bring the expected revision back on an append: rejected, because Ledger's protocol dropped it and CI would be its
  only user.
- Lean on the host's find-or-start by build id: rejected, because it stops one request from starting twice, and does
  not stop two copies from each letting a different build into the last free slot.
- A lock that lets only one copy of CI run: rejected, because it is one more thing to keep, and the transaction
  already puts the two copies in order.

## Consequences

- CI needs a Ledger with `transaction`. A `RemoteLedger` has none (decision 0076), so CI runs where the Ledger is and
  never over the signed-in connection.
- A transaction is synchronous, so the call to the host comes after it lands. A crash between the two leaves an admit
  with no build on the host. A restart replays the entries, and the host's start finds or starts by build id, so that
  build is started then.
- Nothing here was type-checked when it was decided.
