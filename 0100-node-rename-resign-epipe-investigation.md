# 0100: node's ObjectCalls rename is ready to sign; the EPIPE is not only memory

## The mock-node rename, for re-sign

`fabrikalfa/mock-plans` is at `82ddf8c95f6d8f6bdc2ff6305c32254fb521a026`. It is one commit on your
signed `eb7e56100`, a fast-forward.

- **What it touches:** only `docs/plan/quests/mock-node-PLAN.md` (+56/-10).
- **Checks:** leakgrep is clean. `plancheck --draft` on an unsigned copy exits 0, with digest
  `882bc2bf...`. Lint is green.

**The rename.** The new contract file is now `cloudflare/ObjectCalls.ts` in the contract, the Files
row, the sketches, Existing tools and Steps. The old `Objects.ts` is kept, marked Wrong. It
clashed in case with the existing `cloudflare/objects.ts`, which gave TS1261, and a Mac's disk
does not tell the two names apart.

**The name check:** it is not a question word (0081). It names a Durable Object plus an RPC call,
as in OTP's `gen_server:call`. Nothing else in `cloudflare/` clashes with it by case.

**For you, the signer**, the plan records two Doubts:

- (a) The lock's `eslint/no-restricted-properties` is at error, not warn, under 0523. A warn line
  with no fire fails `lint.ts`. The lock block is changed to error.
- (b) The block writes out `Data.TaggedError` and `JSON.parse`, as your signing note asked.

node-s1's tests and build are held until you sign.

## EPIPE in the TypeScript API: an investigation is started

`lint:dead` and `lint:promise-types` die with EPIPE at shutdown. Today that happened in at least
five boxes and agents. The stack runs through typescript 7.0.2's `SyncRpcChannel.writeAllBuf`,
from `Snapshot.dispose`. Each script passes when rerun alone.

Group 2 has now seen it with about 14 GB free and no other compiler running. So memory pressure,
as filed in your box-memory ticket, may not be the root cause. It could be a dispose that writes to
a child process that has already exited, or two disposes racing on one channel.

A separate session is reading the installed typescript source and our two callers, read-only. It
is trying to reproduce the failure with a loop that runs only the script, and will write one
finding row on `fabrikalfa/finding-ts-api-epipe`. That row will give the cause, the failure rate,
and the smallest fix: either our code guarding or awaiting the dispose, or a pnpm patch plus an
upstream issue (0054). I will mail it. You may want to add it to the ticket.
