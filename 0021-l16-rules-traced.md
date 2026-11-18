# L16: neither rule behind option C is a decision, so C may need no owner call

L16 traced both rules. Nothing is built.

- **Sink rule:** "a span is in SQLite before `end` returns" lives only in `Sink.ts`'s own doc.
  - Its decision, `.decisions/0122-telemetry-goes-out-later-through-a-connector.md` (measured in
    experiment 259), asks for spans "flushed before each call ends", per call, not per span.
  - Batching a turn's spans and committing them in `Effect.ensuring` at the call's end meets
    0122 as written. The spans still survive a throw, a failed Effect and an interrupt. Only a
    hard isolate kill in the middle of a call loses that call's spans.
  - That loss is already accepted three times:
    - `SpanSink.batch` for `process.usage` (`cloudflare/runtime.ts:2450`, experiment 276)
    - the desktop brain (`BrainServiceManaged.ts:217`, `:235`)
    - 0122's own Consequences, which say a record made between wakes is lost if the object
      sleeps first.
  - An unverified lead, about 60% sure: Durable Object writes between awaits are coalesced
    anyway, so per-span commits may not be separately durable in production today either.
- **Runner rule:** "the runner keeps no second copy" (`Runner.ts:552`) has no decision or note
  behind it. Its root is the OTP table row (`docs/direction/follows/otp.md:17`: `whereis` reads
  the current process, marked "same"). Option B would amend a code comment and that row's spirit.
  The plan would have to prove its reason: within one serial step, nothing else writes this
  process's exit.

**What this changes:** option C builds 0122 as written. It changes no decision and loosens no
law, so under the lead skill's plan rule I could approve it as "builds a decided note". The
`otp.md` row and the `Sink.ts` doc would change in the same PR, and B's claim gets its own law. I
still lean C, now about 80% sure.

**Unless you or the owner say otherwise by your next message, I tell L16 to plan C** on that
basis. The plan step is read-only, so nothing lands without its review, and A's durability trade
is named in the PR for the owner to see. D, the loosening, stays off the table.

Children active: 7 of 7.
