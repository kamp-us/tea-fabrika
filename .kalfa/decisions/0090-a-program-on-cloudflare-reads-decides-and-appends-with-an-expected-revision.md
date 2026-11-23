# A program on Cloudflare reads, decides, and appends once with an expected revision

On Cloudflare the Ledger sits in a Durable Object class of its own and runs no program code (decision 0076), and a
Ledger transaction is a synchronous step that cannot cross a call between objects. Program's takeover check and its
journal save, and CI's choice of a build (decision 0083), each need to write only when the stream still holds what they
read, and no ruling said how a program does that from its own object
(https://github.com/kamp-us/tea-fabrika/issues/1920). We decided that on Cloudflare such a caller reads the stream,
decides in its own object, then makes one conditional append over the call between objects:
`append(stream, id, entry, { expectedRevision })`. The Ledger writes the entry only when the stream's head is still at
that revision. Otherwise it fails with a conflict, and the caller reads again, decides again and retries. This is
EventStoreDB's expected-revision append
(https://github.com/kamp-us/tea-fabrika/issues/1920#issuecomment-7091204466). We chose this because the Ledger's class
keeps running no program code and holds no named steps, so decision 0076 stands as written, and because one conditional
append is the only part of a program's transaction that has to be atomic.

## Considered Options

- Hand each step to the Ledger's class when the app is put together, as admissions are, and call it by name with plain
  data: rejected, because the class then runs code a program wrote, which is what decision 0076 keeps out, and every
  step becomes a name both sides must keep in step.
- Run Program's journal and CI inside the Ledger's class: rejected, because it undoes the Ledger being apart from every
  program.
- A lock held across the read and the append: rejected, because a lock across a call between objects can be left
  held by a caller that fails.

## Consequences

- This brings back the expected revision that the Ledger's protocol
  (https://github.com/kamp-us/tea-fabrika/issues/1764) dropped, as an option on `append` and not as a second call. The
  line in decision 0083 that rejected it is reworded, with a pointer here.
- Program's takeover and CI's choice are written once, as this read, decide and append, so the same code runs on every
  Ledger and not only on Cloudflare.
- The Ledger's `transaction` stays for code that runs where the Ledger is, and admissions still run inside the
  append's own synchronous transaction (decision 0078). A `RemoteLedger` still has no `transaction` (decision 0076); its
  `append` takes the option.
- A conflict is an answer, not a fault: a retry that reads first sees the entry that won. A caller bounds its retries.
- Known doubt, to revisit: one expected revision guards one stream. If Program's takeover must see two streams at once,
  one revision does not cover both. Tracing takeover's reads settles it, and a two-stream read there reopens this.
- Nothing here was type-checked or run.
