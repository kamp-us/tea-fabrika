# CI chooses and records a build in one Ledger transaction

Decision 0061 had the Ledger's revision check stop two copies of CI from both starting builds. Ledger's protocol
(https://github.com/kamp-us/tea-fabrika/issues/1764) then dropped the expected revision on an append, because
transactions stop clashing writes, and no record said what does that job for CI. We decided that CI reads its stream,
asks the pure value what to start and what to cancel, and appends the facts that say so, all inside one Ledger
transaction. We chose this because a second copy's transaction then reads the first copy's admit and sees the slot
taken, and it uses what the Ledger already promises. The design ticket is
https://github.com/kamp-us/tea-fabrika/issues/1887.

Decision 0090 changes the how: CI reads, asks the pure value, and appends one fact with an expected revision, then reads
again, in place of one Ledger transaction. The rest of this decision stands.

## Considered Options

- Bring the expected revision back on an append: rejected then, because Ledger's protocol dropped it and CI would be its
  only user. Decision 0090 brings it back for a program on Cloudflare, with Program's takeover as a second user.
- Lean on the host's find-or-start by build id: rejected, because it stops one request from starting twice, and does
  not stop two copies from each letting a different build into the last free slot.
- A lock that lets only one copy of CI run: rejected, because it is one more thing to keep, and the transaction
  already puts the two copies in order.

## Consequences

- CI needs a Ledger with `transaction`. Decision 0090 changes this: CI reads, chooses and appends with an expected
  revision, so it needs only `append` and `read`. A `RemoteLedger` has no `transaction` (decision 0076), so a CI that
  needed one would have to run where the Ledger is.
- A transaction is synchronous, so the call to the host comes after it lands. A crash between the two leaves an admit
  with no build on the host. A restart replays the entries, and the host's start finds or starts by build id, so that
  build is started then.
- Nothing here was type-checked when it was decided.
