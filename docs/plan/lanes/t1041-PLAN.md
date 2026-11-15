Approved by the lead agent, builds 0109, 0103, 0069, 0159, 0526, 0536; body 49df49401b2a
Plancheck-Version: 3

# Plan: pipe plumbing, the inbox cap, `full`, chunked sends and their two settings (ticket 1041)

This is `next/`. It builds piece 4 of [Tier 1](../tier-1.md) ("Pipes, for built-ins first"), the
parts nothing on screen depends on, all bound by
[0109](../../../.decisions/0109-a-pipe-is-saved-program-mail.md) (a pipe is saved program mail).
Two pull requests: the measurement that picks the two defaults lands first, then the plumbing.

```ts
// The whole idea, a sketch. Cap 2: an inbox holds at most 2 unread letters.
deliver(w -> r, letter 1)  // unread = head pos 0 - acked pos 0 = 0 -> saved at pos 1
deliver(w -> r, letter 2)  // unread = 1 -> saved at pos 2
deliver(w -> r, letter 3)  // unread = 2 -> ProgramMailError { reason: "full" }; nothing saved; r is pinged
// r's runner folds pos 1 and 2, saves its checkpoint, then the brain records
{ _tag: "acked", process: "process_r1", pos: 2 }  // on processes/r:1/acked
deliver(w -> r, letter 3)  // unread = 2 - 2 = 0 -> saved at pos 3

// A large value goes as letters of at most `mail.chunk` bytes, in order, and the runner waits on `full`.
sendChunks({ to: "r:1", type: "rows", items }) // -> send_chunks_ok { _tag: "queued", id, letters: 3 }
{ type: "rows", items: [/* ... */], part: { id: "process_w1/4/1", seq: 2, last: true } }
```

## What changes, in one paragraph

An inbox gets a cap on unread letters, the `mail.unread` setting. Program mail counts unread letters
in the same ledger turn that would save the letter, as the inbox's newest position minus the
reader's acked position, and answers `full` with nothing saved when the inbox is at its cap. The
reader's runner tells the brain how far it has read, after each checkpoint save, and the brain keeps
that on a brain-only stream. A program's plain `send` gets `full` as its answer and decides what to
do. A new built-in Cmd, `send_chunks`, cuts a list of items into letters of at most `mail.chunk`
bytes, delivers them in order, and waits like a blocked Unix pipe writer while the inbox is full. A
reader tells a whole value from a cut one by each letter's `part` (`id`, `seq`, `last`).

## How others do it

- **Erlang/OTP: no bound, and a send never waits.** "All communication between Erlang processes
  ... is done by sending and receiving asynchronous signals"
  ([processes](https://www.erlang.org/doc/system/ref_man_processes.html), fetched for experiment
  258). The one exception is a busy distribution buffer between nodes, where
  `erlang:send_nosuspend/2` returns `false` instead of suspending, and the caller decides (erlang
  module docs, not fetched for this plan). `gen_server:call` gives up after a timeout, 5000 ms by
  default (gen_server docs, not fetched). For streams OTP goes outside the mailbox: GenStage's
  consumer sends demand upstream, bounded by `:max_demand`
  ([GenStage](https://gen-stage.hexdocs.pm/GenStage.html), fetched for 258).
  **Where we leave OTP and why:** an OTP mailbox lives in memory and dies with the process. Ours is
  saved on the ledger and read again after a restart, so a fast writer and a slow reader grow an
  inbox without end in one 10 GB object (experiment 258, "What it tells us"). 0109 decided the cap.
- **Unix pipes: a small byte buffer, and a full one blocks the writer.** "Since Linux 2.6.11, the
  pipe capacity is 16 pages (i.e., 65,536 bytes ...)", and "If the pipe is full, then a write will
  block or fail" with `O_NONBLOCK` (`EAGAIN`)
  ([pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html), fetched for 258). We take both
  halves: a plain `send` is the non-blocking write (`full` comes back, like `EAGAIN`), and
  `send_chunks` is the blocking write (the runner waits).
- **Kubernetes: refuse with a typed answer, and the client backs off.** API Priority and Fairness
  rejects a request past its queue with HTTP 429 and a `Retry-After` (Kubernetes flow control docs,
  not fetched). Our `full` is that 429. We give no `Retry-After`: the brain cannot know when a
  reader will read.
- **Kafka and TCP: the reader's position is a committed number the sender side can read.** A Kafka
  consumer commits its offset to the log (`__consumer_offsets`), and the coordinator refuses a
  commit from a fenced member of an older generation (`ILLEGAL_GENERATION`). TCP's receiver sends a
  cumulative ACK and a window (RFC 9293). Neither fetched for this plan. Our `acked` row is the
  committed offset, and the brain fences a stale life the same way.
- **Cutting a large message: a flag on the last piece.** WebSocket fragments a message into frames
  and sets FIN on the last (RFC 6455, section 5.4). MIME `message/partial` carries `id`, `number`
  and `total` (RFC 2046, section 5.2.2). Neither fetched. We take WebSocket's flag over a total,
  since a pipe's stream has no known total.
- **Elm:** a Cmd is asked for and answered as a Msg. A full inbox is one more answer, and a waiting
  host Cmd is an answer that comes later. Nothing here needs a new tea feature.

## The shape

### `full`, at the host

```ts
// processes/ProgramMail.ts. MailRefusal stays "refused for good" (ProgramMail.ts:22); full is not.
export const MailRefusal = Schema.Literals(["no_name", "forbidden", "stale_sender", "bad_message", "id_reused"]);
export class ProgramMailError extends Schema.TaggedError<ProgramMailError>()("ProgramMailError", {
  /** `full`: the target's inbox holds its cap of unread letters. Nothing was saved, the reader
   *  was pinged, and the same letter may be sent again once the reader reads. */
  reason: Schema.Union([MailRefusal, Schema.Literals(["full", "storage"])]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

// processes/ProgramMailLedger.ts
export const layer = (config: { readonly grants: Grants; readonly cap: number }) => /* ... */;

// processes/internal/programMail.ts, pure
export const unread = (head: Rev, acked: Rev): number => Math.max(0, head - acked);
export const full = (head: Rev, acked: Rev, cap: number): boolean => unread(head, acked) >= cap;
```

Inside the one commit turn (`ProgramMailLedger.ts:192`), in this order: the lifecycle recheck, then
the saved receipt (a repeat answers its first receipt, even when the inbox is full), then the cap,
then the two appends. The cap reads two rows by index: the inbox's newest entry, as
`turn.read(inbox, turn.head(inbox) - 1)`, and the acked stream's newest entry the same way. Both are
one index read (`ledger/LedgerTransaction.ts:28-32`, `ledger/internal/ledgerStore.ts:26-27`), so the
reads law PR 1203 built stays flat.

The span gets `fab.mail.answer: "full"`, `fab.mail.unread` and `fab.mail.cap`. The program gets
only the tag: tea's `Cmd.make` takes `err` as a tag list, and its error is `TaggedError<Tag>`
(`@demlik/tea` 0.25.0, `dist/effect/index.d.ts:169-173`).

Over the cloud's Project RPC, `MailReplies` (`cloudflare/bindings.ts:36`) gets a third case,
`full: { unread, cap }`, and `cloudflare/mail.ts`'s `fromMailReply` maps it to the same error.
`MailDeliveryLive` wakes the target on `full` before it fails, so a reader whose ack was lost reads
again and writes it.

### The ack, how the brain knows what was read

```ts
// processes/Process.ts. Brain-only by its prefix (Process.ts:125-127): no program write and no
// mailbox send can forge it (Runner.ts:1514, Mailbox.ts:265).
export const acked = (name: string): string => `${PROCESSES}/${name}/acked`;
export const Acked = Schema.TaggedStruct("acked", { process: ProcessId, pos: Rev });

// processes/ProcessManager.ts: the reader's life says how far it read; the brain writes it.
readonly ack: (process: string, pos: Rev, from: From) => Effect.Effect<void, Failure>;
```

- The brain binds the name from the live process, never from a parameter (as 0103 binds a sender).
  A life that is no longer its name's live process changes nothing. A `pos` at or behind the newest
  ack changes nothing. So the ack only moves forward.
- The entry's id is `<process>/acked/<pos>`, so a repeat is one line.
- The runner calls it in `catchUp` right after `store.save(checkpoint(next, null), placed)`
  (`Runner.ts:1380`), when `next.pos` moved. The ack never runs ahead of a saved checkpoint, so a
  crash between the two leaves the ack behind, which only makes `full` come early.
- The runner keeps the last pos it acked. At the start of a turn, if the saved pos is ahead of it
  (a lost ack write), it acks again before it reads.
- In the cloud this is one more Project RPC, `processAck`, beside `processIsLive`.

### The chunked send

```ts
// runtime/Chunk.ts
export const Part = Schema.Struct({
  /** The send it belongs to: the send_chunks command's id. */
  id: Schema.NonEmptyString,
  /** Its place in that send, from 0. */
  seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** True on the send's final letter. */
  last: Schema.Boolean,
});
/** One letter of a chunked send: the reader's input `type`, its share of the items, and its part. */
export const Chunk = Schema.Struct({ type: Schema.NonEmptyString, items: Schema.Array(Schema.Json), part: Part });
/** The reader's typed input for one chunked port. */
export const input = <T extends string, A>(type: T, item: Schema.Codec<A>) =>
  Schema.Struct({ type: Schema.Literal(type), items: Schema.Array(item), part: Part });

export class TooBig extends Schema.TaggedError<TooBig>()("TooBig", { index: Schema.Int, bytes: Schema.Int }) {}
/** Cuts items into chunks whose encoded JSON is at most `size` bytes each, in order. An empty list is
 *  one chunk. An item that cannot fit alone fails, and nothing is cut. */
export const cut: (send: { id: string; type: string; items: ReadonlyArray<Schema.Json> }, size: number)
  => Result.Result<NonEmptyReadonlyArray<typeof Chunk.Type>, TooBig>;
/** The whole list when the chunks are one send's seq 0 to n with `last` at n, else none (a cut send). */
export const join: (chunks: ReadonlyArray<typeof Chunk.Type>) => Option.Option<ReadonlyArray<Schema.Json>>;

// runtime/Send.ts
export const send = Cmd.make("send", { input: SendInput, ok: Queued, err: [...MailRefusal.literals, "full"] });
export const ChunksInput = Schema.Struct({
  to: Schema.NonEmptyString,
  type: Schema.NonEmptyString,
  items: Schema.Array(Schema.Json),
});
export const Chunked = Schema.TaggedStruct("queued", { id: Schema.NonEmptyString, letters: Schema.Int });
export const sendChunks = Cmd.make("send_chunks", {
  input: ChunksInput,
  ok: Chunked,
  err: [...MailRefusal.literals, "too_big"],
});
```

How the runner runs `send_chunks` (a new host Cmd beside `send`, `Runner.ts:224`):

- At dispatch, operands over `INPUT_BYTES` (`processes/Children.ts:24`) are answered `too_big`, as
  `start_child`'s oversize path does (`Runner.ts:266-293`). The dispatched entry keeps the chunk size
  it was cut with, so a restart under a changed `mail.chunk` still cuts the same way.
- It cuts first. `TooBig` is answered `too_big` with nothing sent.
- It delivers part `seq` under the command id `<cmd id>/part/<seq>`, so its mail id is
  `<cmd id>/part/<seq>/mail` (`processes/internal/programMail.ts:9`), outside the runner, signal and
  notice id spaces (`Process.ts:143-144`, `:405`, `:414`).
- Every attempt starts at part 0. A part already saved answers its first receipt and writes nothing
  (`ProgramMailLedger.ts:161-166`), so the parts need no stored cursor and no new state machine.
- `full` leaves the Cmd dispatched and owed. The turn answers normally, and the owed-host-Cmd alarm
  tries it again, 100 ms doubling to 800 ms by the default policy (`Runner.ts:546-549`).
- A final refusal on a later part is the Cmd's answer. The parts already saved stay, and the
  reader's `join` says the send is cut.
- After the last part: `send_chunks_ok { _tag: "queued", id, letters }`.
- **Order per pair.** A `send` or `send_chunks` to a target waits while an earlier one to the same
  target still waits. So the letters one writer sends one reader arrive in the order its Cmds were
  made, as OTP keeps order per sender and receiver (`docs/direction/follows/otp.md`, row 19).

### The two settings

```ts
// settings/Declarations.ts, a sketch. The defaults and the cap's maximum come from experiment 294.
export const mailUnread = Setting.make("mail.unread", {
  schema: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MOST_MEASURED })),
  default: CAP_FROM_294,
  doc: "The most unread letters one inbox holds. A send past it answers full, and nothing is saved.",
  scope: ["repo"],
  reload: "restart",
  since: "0.0.0",
});
export const mailChunk = Setting.make("mail.chunk", {
  schema: ChunkBytes, // Schema.ByteSize checked to 1 KiB through 1 MiB, half the ledger's row cap
  format: "text", // written "64 KiB" in the file, as Codec.test.ts:64 holds
  default: CHUNK_FROM_294,
  doc: "The most bytes in one letter of a chunked send.",
  scope: ["repo"],
  reload: "restart",
  since: "0.0.0",
});
```

- The brain reads them at its edge and hands them in: `mail.unread` to `ProgramMailLedger.layer`
  (`cloudflare/runtime.ts:878`), and `mail.chunk` to the runner as a new `RunnerOptions.chunk`
  (`cloudflare/runtime.ts:2234`). No machine reads a file (0086).
- The upper bound of `mail.chunk` is 1 MiB, below the 2,000,000-byte row cap (`ledger/Log.ts:211`)
  with room for a letter's own fields. The lower bound is 1 KiB, so one chunk's `part` and command
  id (about 150 bytes) always fit with room for items.
- The cap's maximum is the largest unread count experiment 294 measured. No number past what we
  measured.
- Not settings, and why: the retry wait of a waiting `send_chunks` is the supervision policy's
  backoff, a program fact (the settings note's table, row "restart policy"); the ack cadence is
  plumbing (0086, S1).

## One value traced: a send that fills an inbox

`mail.unread = 2`. Writer `w:1` (process `process_w1`), reader `r:1` (process `process_r1`). Empty
inbox, no ack.

1. `w:1` sends `{ type: "hello", n: 1 }`. The turn reads head pos 0 and acked pos 0: unread 0, under
   2. It saves the letter at `r:1/inbox` pos 1 and its receipt in `w:1/outbox`. The Send answers
   `send_ok { _tag: "queued", id }`.
2. The same for `n: 2`: unread 1, saved at pos 2.
3. `n: 3`: unread 2, so `ProgramMailError { reason: "full" }`. Nothing is appended. The span says
   `fab.mail.answer = full`, `fab.mail.unread = 2`, `fab.mail.cap = 2`. `MailDeliveryLive` wakes
   `r:1`. The program folds `send_err { error: { _tag: "full" } }`.
4. `w:1` resends the same message once it chooses: same answer while `r:1` has not read.
5. `r:1`'s alarm runs. `catchUp` folds pos 1 and 2, saves its checkpoint at pos 2, then calls
   `ack("process_r1", 2)`. The brain checks `process_r1` is `r:1`'s live process and appends
   `{ _tag: "acked", process: "process_r1", pos: 2 }` to `processes/r:1/acked`, id
   `process_r1/acked/2`.
6. `w:1` resends `n: 3` under a new command. Unread = 2 - 2 = 0. Saved at pos 3.

## One value traced: a large output cut in three

`mail.chunk = 1 KiB`, `mail.unread = 2`. `w:1` asks for
`sendChunks({ to: "r:1", type: "rows", items })` with five rows of about 400 bytes each. The Cmd id
is `process_w1/4/1`.

1. Dispatch: the operands are under `INPUT_BYTES`, and the dispatched entry keeps `chunk: 1024`.
2. `cut` packs greedily under 1,024 bytes of encoded JSON per letter:
   - `{ type: "rows", items: [r0, r1], part: { id: "process_w1/4/1", seq: 0, last: false } }`
   - `{ type: "rows", items: [r2, r3], part: { id: "process_w1/4/1", seq: 1, last: false } }`
   - `{ type: "rows", items: [r4], part: { id: "process_w1/4/1", seq: 2, last: true } }`
3. Part 0 is saved at `r:1/inbox` under `process_w1/4/1/part/0/mail`, then part 1.
4. Part 2 answers `full`. The Cmd stays dispatched and owed, the turn answers normally, and the alarm
   is set 100 ms out. A `send` to `r:1` that `w:1` makes now waits behind it.
5. `r:1` reads. Its program holds the parts with seq 0 and 1: `join` says none, the send is cut so
   far. It acks pos 2.
6. The alarm fires. Parts 0 and 1 answer their saved receipts and write nothing. Part 2 is saved.
7. `w:1` folds `send_chunks_ok { value: { _tag: "queued", id: "process_w1/4/1", letters: 3 } }`, and
   the waiting `send` runs.
8. `r:1` reads part 2. `join` of all three gives the five rows: the send is whole.

## The measurement (pull request 1, first)

Experiment 294 (the number `records.ts next experiments` gave, 2026-11-15), as
`experiments/294-inbox-cap.md` on main, with the script `experiments/294-inbox-cap.ts` kept only on
its branch, `fabrikalfa/294-inbox-cap` (0027).

- **What it runs on:** main's own `LedgerSql` and `LedgerTransactionSql` on node:sqlite in a temp
  folder, WAL with `synchronous=OFF` as experiment 258 did. No network, no key, $0. Under
  `nice -n 15`, one process.
- **What it measures, five runs per cell:**
  - Write: one deliver-shaped turn (the two index reads of the cap, the inbox append and the outbox
    append) at letter sizes 1, 4, 16, 64, 256 and 1,024 KiB, into an inbox already holding 0,
    1,000 and 10,000 letters (and 100,000 at 1 and 4 KiB), skipping any cell over 1 GiB on disk.
    200 sends per run, p50 and p95, and WAL bytes per letter.
  - Read: one reader's catch-up over k unread letters past its ack (`Mailbox.read` collected, as
    `catchUp` does at `Runner.ts:1235`), k = 1, 4, 16, 64, 256, 1,024, 4,096, 16,384, at the same
    letter sizes, under the same 1 GiB bound. p50 and p95.
  - The ack append, alone.
- **How its numbers pick the defaults:**
  - `mail.chunk`: the smallest size whose write time per KiB is within 10% of the 1 MiB size's.
    Bigger letters stop paying past there. Our own data.
  - `mail.unread`: the largest k, a power of two, where a catch-up over k unread letters of that
    chunk size reads in 100 ms or less at p95, and k times the chunk size is at most 16 MiB. The 100
    ms is the classic limit for a reply that feels instant (Nielsen, "Response Times: The 3
    Important Limits", 1993). The 16 MiB is one eighth of a Worker's 128 MB memory, since `catchUp`
    holds every unread letter at once (Cloudflare Workers limits page, not fetched for this plan).
  - The cap's maximum: the largest k it measured.
  - It also checks that the write time at 10,000 letters stays within 10% of the time at 0, so the
    cap's reads do not grow with the inbox.
- **Why first:** both defaults cite it, and it needs no plumbing code. It adds no product code, so it
  runs as one agent and the lead's read, as any experiment does (`AGENTS.md`, the Checks table).

## Laws

Fast laws run on every pull request. Laws on real SQLite, workerd or real runners are
`*.integration.test.ts` and run on the 3-hour schedule (0536), as program mail's laws already do.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1, `cut`: every chunk's encoded JSON is at most `size` bytes, seqs run 0 to n-1, `last` is on the final chunk only, every chunk carries the send's id, the items in order are the input; an empty list is one chunk; an item too big alone fails `TooBig` with its index and nothing is cut. Fast, 200 runs | test | fc.record: items from fc.array of fc.jsonValue, size from fc.integer 1,024 to 8,192, an id | (a) compare with `>` in place of `>=`, (b) set `last` on every chunk, (c) cut an empty list to no chunks: each turns L1 red | next/packages/libfabrika/src/runtime/Chunk.test.ts |
| L2, `join`: all chunks of one cut give back the items; any strict prefix, a gap, a repeat, a reorder or chunks of two sends mixed give none. Fast, 200 runs | test | fc.record: a cut from L1's inputs, and a tamper from fc.constantFrom prefix, gap, repeat, swap, mix | join ignoring gaps: L2 red | next/packages/libfabrika/src/runtime/Chunk.test.ts |
| L3, the pure cap rule: `full` holds exactly when unread is at least the cap, and `unread` is never negative. Fast, 200 runs | test | fc.record: head, acked and cap from fc.nat and fc.integer 1 to 64 | `>` in place of `>=`: L3 red | next/packages/libfabrika/src/processes/internal/programMail.test.ts |
| L4, `mail.unread` and `mail.chunk` read through their declarations in the common source order; `"64 KiB"` decodes to bytes; a value out of range fails and names the key; an empty file gives the default. Fast, 100 runs | test | fc.record: value from fc.integer around each bound, source from fc.constantFrom flag, env, repo, person | widen `mail.chunk`'s upper bound past 1 MiB: L4 red | next/packages/libfabrika/src/settings/Mail.test.ts |
| L5, a program's `send_err` sees `full` among `send`'s tags, `send_chunks`'s tags hold `too_big` and no `full`, and `Chunk.input`'s type is the reader's item type | type | type | drop `"full"` from `send`'s `err`: the typecheck fails | next/packages/libfabrika/src/runtime/Send.types.test.ts |
| L6, on the ledger, over generated sends, acks and reader restarts with a cap of 1 to 4: unread never passes the cap; a send answers `full` exactly when unread is at the cap; `full` appends nothing to the inbox or the outbox; a repeat of a saved send answers its first receipt even when full. Integration, 50 runs | test | fc.commands: send, ack, restart the reader | (a) drop the cap check, (b) check the cap before the saved receipt: each turns L6 red | next/packages/libfabrika/src/processes/ProgramMailTest.ts, run by next/packages/libfabrika/src/node/ProgramMail.integration.test.ts |
| L7, `deliver` reads the same number of rows whatever the inbox and the acked stream hold, the cap's reads included. Integration, 20 runs | test | fc.record: inbox and ack sizes from fc.integer 0 to 2,000 | count unread by reading the inbox past the ack: rows grow, L7 red | next/packages/libfabrika/src/processes/ProgramMailReadsTest.ts, run by next/packages/libfabrika/src/node/ProgramMailReads.integration.test.ts |
| L8, `ack`: the acked pos only moves forward; only the name's live process moves it, and a stale life's ack changes nothing; a program write and a mailbox send to `processes/<name>/acked` are refused. Integration, 50 runs | test | fc.commands: ack from the live or a stale life at a generated pos, restart, a forged write | (a) accept a stale life, (b) accept a pos behind the newest: each turns L8 red | next/packages/libfabrika/src/processes/ProgramMailTest.ts, run by next/packages/libfabrika/src/node/ProgramMail.integration.test.ts |
| L9, through real runners, over generated plain sends, reader turns and crash cuts: the acked pos is never ahead of the reader's saved pos; a plain send to a full inbox folds `send_err` with `full` and nothing lands; once the reader drains, the writer's next send lands. Integration, 30 runs | test | fc.commands: send, reader turn, crash at a generated cut point | (a) ack before the checkpoint save, (b) never ack: each turns L9 red | next/packages/libfabrika/src/runtime/ProgramMailTest.ts, run by next/packages/libfabrika/src/node/ProgramMailRuntime.integration.test.ts |
| L10, a lost ack is repaired: a generated failure of the ack write, then a `full` answer, wakes the reader, which acks again, and the next send lands. Integration, 30 runs | test | fc.record: which ack write fails, cap from fc.integer 1 to 3 | drop the wake on `full`: the send never lands, L10 red | next/packages/libfabrika/src/runtime/ProgramMailTest.ts, run by next/packages/libfabrika/src/node/ProgramMailRuntime.integration.test.ts |
| L11, `send_chunks` over generated items, caps, reader turns and crash cuts: the parts land in seq order, each once; the Cmd answers `queued` with the letter count only after the last; while full, the call answers normally and the Cmd stays owed; a restart under a changed `mail.chunk` keeps the size the send was cut with; letters one writer sends one reader arrive in its Cmd order. Integration, 30 runs | test | fc.commands: send_chunks with fc.array items, plain send, reader turn, crash, change the chunk setting and restart | (a) answer `full` in place of waiting, (b) cut again with the new setting after a restart, (c) run a send to the same target past a waiting one: each turns L11 red | next/packages/libfabrika/src/runtime/ProgramMailTest.ts, run by next/packages/libfabrika/src/node/ProgramMailRuntime.integration.test.ts |
| L12, `send_chunks` refusals: an item too big alone, or operands over `INPUT_BYTES`, answer `too_big` with no part saved; a final refusal after some parts (the target stopped) is the answer, and the reader's `join` of what landed is none. Integration, 30 runs | test | fc.record: items with one oversize item at a generated index, the stop at a generated part | deliver the parts before the cut is checked: a part lands, L12 red | next/packages/libfabrika/src/runtime/ProgramMailTest.ts, run by next/packages/libfabrika/src/node/ProgramMailRuntime.integration.test.ts |
| L13, the cloud wire: `MailReplies` carries `full` with its counts and the process object maps it to the node layer's answer; `processAck` binds the process from the call and never from a parameter. Fast, 50 runs | test | fc.record: a reply from fc.constantFrom ok, refused, full, and a generated process id | map `full` to `storage`: L13 red | next/packages/libfabrika/src/cloudflare/mail.test.ts |
| L14, end to end: a repo file with `mail.unread = 2`; the third send between two real programs answers `full`; after the reader reads, a resend lands | test | scenario: one real local instance on workerd, as this file's P41 slice 2 laws run | hand the default in place of the file's value: the third send lands, L14 red | next/apps/fabrika/src/worker-mail.integration.test.ts |

The settings laws that already read `Declarations.all` (the generated person and repo files and the
reference page, `next/apps/fabrika/src/settings-generated.test.ts`) cover the two new declarations
with no change. The build regenerates their outputs.

No host-only law: nothing here needs launchd, the real Electron app or the owner's Mac. L14 needs
workerd and sockets, so it runs on the schedule.

## Files

### Pull request 1, the measurement

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| experiments/294-inbox-cap.md | build | docs | the write-up, with frontmatter `date`, `scripts`, `summary`, the numbers, the two defaults, what it cannot tell us |
| experiments/294-inbox-cap.ts | build | 0 | the script, on branch `fabrikalfa/294-inbox-cap` only, never on main |

### Pull request 2, the plumbing

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/processes/ProgramMail.ts | build | 15 | `full` beside `storage` in `ProgramMailError`, its doc |
| next/packages/libfabrika/src/processes/ProgramMailLedger.ts | build | 35 | `layer({ grants, cap })`, the cap in the commit turn after the saved receipt, the span tags |
| next/packages/libfabrika/src/processes/internal/programMail.ts | build | 10 | `unread`, `full` |
| next/packages/libfabrika/src/processes/Process.ts | build | 15 | `acked(name)`, `Acked` |
| next/packages/libfabrika/src/processes/ProcessManager.ts | build | 45 | `ack`, its ledger side, `remoteProcessManager`'s call |
| next/packages/libfabrika/src/runtime/MailDelivery.ts | build | 5 | `full` in `MailDeliveryError` |
| next/packages/libfabrika/src/runtime/MailDeliveryLive.ts | build | 10 | wake the target on `full`, then fail |
| next/packages/libfabrika/src/runtime/Send.ts | build | 30 | `full` in `send`'s tags; `ChunksInput`, `Chunked`, `sendChunks` |
| next/packages/libfabrika/src/runtime/Chunk.ts | build | 90 | `Part`, `Chunk`, `input`, `TooBig`, `cut`, `join` |
| next/packages/libfabrika/src/runtime/Runner.ts | build | 110 | `full` passed to the program; the `send_chunks` host Cmd; the ack after the save and its repair; the per-pair wait; `RunnerOptions.chunk` |
| next/packages/libfabrika/src/settings/Declarations.ts | build | 35 | `mailUnread`, `mailChunk`, in `all` |
| next/packages/libfabrika/src/cloudflare/bindings.ts | build | 5 | `MailReplies`' `full` case |
| next/packages/libfabrika/src/cloudflare/mail.ts | build | 5 | map `full` |
| next/packages/libfabrika/src/cloudflare/platform.ts | build | 5 | `processAck` on the Project client |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 30 | hand `mail.unread` and `mail.chunk` in; the Project's `processAck` |
| next/packages/libfabrika/src/index.ts | build | 1 | `export * as Chunk` |
| next/apps/fabrika/repo.json | build | generated | by `settings-generate.ts` |
| docs/settings-reference.md | build | generated | by `settings-generate.ts` |
| .glossary/TERMS.md | build | docs | rows `chunk`, `ack (inbox)`, `full`; the `pipe` row says letters are chunks |
| docs/direction/follows/otp.md | build | docs | a row "Mailbox bound": OTP has none and a send never waits; ours caps unread letters, `send` answers `full`, `send_chunks` waits |
| docs/plan/tier-1.md | build | docs | piece 4: the cap, `full`, chunked sends and the two settings move to "In code now"; the right for two programs on one line stays open |
| next/packages/libfabrika/src/runtime/Chunk.test.ts | tests | tests | L1, L2 |
| next/packages/libfabrika/src/processes/internal/programMail.test.ts | tests | tests | L3 |
| next/packages/libfabrika/src/settings/Mail.test.ts | tests | tests | L4 |
| next/packages/libfabrika/src/runtime/Send.types.test.ts | tests | tests | L5 |
| next/packages/libfabrika/src/processes/ProgramMailTest.ts | tests | tests | L6, L8 |
| next/packages/libfabrika/src/node/ProgramMail.integration.test.ts | tests | tests | runs L6 and L8 |
| next/packages/libfabrika/src/processes/ProgramMailReadsTest.ts | tests | tests | L7 |
| next/packages/libfabrika/src/node/ProgramMailReads.integration.test.ts | tests | tests | runs L7 |
| next/packages/libfabrika/src/runtime/ProgramMailTest.ts | tests | tests | L9 to L12 |
| next/packages/libfabrika/src/node/ProgramMailRuntime.integration.test.ts | tests | tests | runs L9 to L12 |
| next/packages/libfabrika/src/runtime/internal/chunkPrograms.test-support.ts | tests | tests | the writer and reader fixture programs L9 to L12 run |
| next/packages/libfabrika/src/cloudflare/mail.test.ts | tests | tests | L13 |
| next/apps/fabrika/src/worker-mail.integration.test.ts | tests | tests | L14 |
| next/apps/fabrika/src/settings-generated.test.ts | tests | none | not changed: its laws cover the new declarations |

**Must not touch:** shell syntax or `fabsh`; how a program's declared `outputs` reach another
program (0159 lists it as not decided); anything drawn; the host's mail grants and
`ProgramMailLedger.ts`'s `related` rule (0526 moves mail grants into one permission system);
`ledger/` (the two index reads use the turn's existing `read` and `head`).

**Beside PR 1092** (https://github.com/kamp-us/tea-fabrika/pull/1092, a draft: per-program write
and storage quotas): it adds `quota` to `MailRefusal` and wraps the same commit block. `quota` is a
writer over its own limit and final; `full` is a reader behind and not final. They do not overlap.
Whichever lands second rebases: the cap check goes inside 1092's `commit` before the appends, and
`send_chunks`' tags take `quota` from `MailRefusal` with no edit.

**What the shell's pipe will need from this later:** the runner's chunked send, called for an
output's value in place of a program's Cmd (the same cut, wait and per-pair order); `Chunk.input`
and `join` on the reader's side; the right for a pipe's writer to reach its reader (open, below);
and the wiring itself (0159).

## Calls taken

Each is the lead's call, taken while the owner is away, on the owner's rule for tonight (80% or
more: build it).

1. The cap counts every unread entry in the inbox, as its newest pos minus the acked pos, not bytes
   and not only peer letters. 0109 decided "a cap on unread letters"; one count by index is O(1).
   85%.
2. The reader's runner acks through the brain onto a brain-only stream, after its checkpoint save.
   Kafka's committed offset with generation fencing; TCP's cumulative ACK. 85%.
3. An ack on every turn that moved the read position, not thinned. Simple and exact; it costs one
   entry per such turn. 80%.
4. `full` carries only its tag to the program, and its counts on the span. tea's Cmd errors are
   tags only (`@demlik/tea` 0.25.0). 85%.
5. `full` is not a `MailRefusal`, which means "refused for good" (`ProgramMail.ts:22`). 90%.
6. A repeat of a saved send answers its receipt before the cap is checked (`ProgramMail.ts:96-98`).
   90%.
7. On `full` the brain wakes the reader, so a lost ack cannot leave a writer stuck. 85%.
8. A chunked send is a new host Cmd, `send_chunks`, that the runner cuts and delivers, and that waits
   on `full` on the existing owed-host-Cmd retry. 0109: "inside a's runner", and "the writer side
   owns the chunking"; Unix's blocking write. 80%.
9. A chunk is a letter, with its transport facts in a nested `part: { id, seq, last }`. WebSocket's
   FIN, RFC 2046's `message/partial`. 80%.
10. The reader knows the end from `last`, not from a total: a stream has no known total. 80%.
11. The chunk size is bytes of the encoded letter, written as a byte size. The row cap is bytes, and
    0109 says the chunk stays under it. 85%.
12. An item too big for one chunk is `too_big`, and nothing is sent. 80%.
13. A mail Cmd to a target waits behind an earlier waiting one to that target: OTP's order per pair
    (`otp.md`, row 19). 85%.
14. The dispatched `send_chunks` keeps its chunk size, so a restart cuts the same way and its saved
    parts still match. 85%.
15. Operands over `INPUT_BYTES` are `too_big` at dispatch, as `start_child`'s are. 80%.
16. Both settings are `["repo"]` and reload on restart: a project's limit, as the settings note's
    table puts the record cap in the repo's file. 85%.
17. The right for two programs on one line is left out (open question below). 0526 forbids a list
    beside the one permission system, and 0159 leaves the wiring that would write the right
    undecided. 85% that it does not follow from decided notes.
18. Two pull requests, the measurement first: each is read whole on its own (a measurement and its
    rule; code and its laws), and the plumbing's defaults cite the measurement. 80%.

## Doubts, under 80%

- **A plain `send` answers `full` (75%).** The other reading of 0109's "answers `full`, and the
  sender waits" is that every send waits in the runner, as `send_chunks` does. The ticket's "in
  words the sender can act on" points at the program hearing it. What settles it: the first
  program that sends plain mail into a full inbox, or the owner's word.
- **The names `mail.unread` and `mail.chunk` (75%).** Short, and they read as a sentence in the
  file, but `mail.unread` could be read as a count, not a limit. What settles it: the reference
  page's line read cold by a second person. A rename before release costs one edit.
- **The measurement's two budgets (75%).** The 100 ms and the one-eighth of 128 MB are reasoned, not
  measured on a Durable Object. What settles it: the same script on Alchemy's local runtime, which
  258 also named.

## Owner list

None.

- The ack row keeps `process`, `pos`, and the line's own `by`, `sentAt`, `parent` and `traceId`,
  with the referee's `arrivedAt`. A later field can never reach rows written before it, but only the
  newest ack is ever read, so nothing that decides is lost.
- A chunk letter keeps `type`, `items` and `part { id, seq, last }`, saved forever as any letter. A
  later field (a total, say) can never reach letters written before it, so a reader's schema must
  take it as optional. That is the same for every letter shape and is not a one-way door.
- No signed text changes, and nothing needs a secret, a paid account or the owner's Mac.

## Validation

- Pull request 1: the script run once under `nice -n 15` on its branch, its numbers in the
  write-up; `pnpm lint` on the write-up.
- Pull request 2, the tests step: `pnpm format`, then `nice -n 15 pnpm exec vitest run
  --maxWorkers=3` on the fast files (`runtime/Chunk.test.ts`, `processes/internal/programMail.test.ts`,
  `settings/Mail.test.ts`, `cloudflare/mail.test.ts`), and the integration files named in the laws
  table, one at a time. Each plant run once and recorded.
- The lead runs one `pnpm typecheck` (L5 is a type law), `pnpm lint` (`settings-generated` and dead
  exports), and the leak grep.

## Size

Two pull requests, each landing whole.

1. The measurement: about 150 lines of write-up on main, and about 250 lines of script on its own
   branch. 0 product lines.
2. The plumbing: about 450 product lines over 16 files, about 900 test lines over 12 files, and
   about 40 lines of prose.

Priced from ticket 971's plan, the newest priced lane (tests $8.41, build $0.87, review $2.70 on
https://github.com/kamp-us/tea-fabrika/pull/1199). This lane has far more law and product code, much
of it on real runners: the measurement about $6, tests about $12, build about $14, review about $4,
one fix round about $5, its recheck about $2. Confidence 70%: the doubt is L11, where crash cuts
across a waiting chunked send meet the runner's retry code, which is the hardest part of
`Runner.ts` to test.

Estimate: 6 steps, $43

## Records

- What is lost if not recorded now: who read how far, and when. The ack row keeps it from the first
  read. A `full` answer saves nothing on the ledger, by 0109; its who, when and counts live on the
  span only.
- `.glossary/TERMS.md`, `docs/direction/follows/otp.md` and `docs/plan/tier-1.md`, as in the files
  table, in pull request 2.
- `experiments/294-inbox-cap.md`, in pull request 1, the source for both defaults.
- `field/runs/` rows for each step, by the lead.
- No `.decisions/` file. Decisions hold the owner's rulings; the calls above are the lead's, kept
  here and in the glossary.

## What this cannot tell us

- How a full pipe feels in a `fabsh` line. Nothing on screen uses this yet.
- Whether a Durable Object's write path changes the numbers. The measurement runs node:sqlite, as
  258 did.
- Whether the extra ack entry per turn matters in the cloud bill. It is one more entry, about four
  rows written; it was not measured on Cloudflare.
- Whether a reader that refuses every letter it gets looks full to its writers. Its refused letters
  still move its saved position, so it acks them; a law covers folded letters, not a reader whose
  program is down for good.
- How the shell will wire outputs, and so whether `send_chunks`' per-pair order is the order a pipe
  needs across two outputs of one program.

## Open questions

1. May two programs on one line mail each other with no host grant, and how is that right written?
   Lean: when `fabsh` starts a line, it writes one relation row per pipe edge (writer may mail
   reader) in the permission system 0526 decides, in the wiring pull request, never as a new rule
   beside it in `ProgramMailLedger.ts`. 70%. Today such mail needs a host grant
   (`ProgramMailLedger.ts:184-189`).

## Findings

None.
