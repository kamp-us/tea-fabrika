---
summary: What one Cloudflare Durable Object may hand to another over RPC (data, a function stub, an RpcTarget), whether any such call is synchronous, whether anything called from another object can join transactionSync or the async transaction so that a refusal undoes it, what the input and output gates let interleave while one object awaits another, what Cloudflare's own docs do when two objects must change together, and the limits that bite; from the docs, the workerd source, the installed types and a local workerd trial, every claim cited and marked
---

# What can cross between two Durable Objects inside one synchronous storage transaction?

Question (ticket https://github.com/kamp-us/tea-fabrika/issues/1919): the Ledger sits in a Durable Object class of its
own (decision `.kalfa/decisions/0076-a-far-read-is-a-remote-ledger-over-the-signed-in-connection.md`). Its transaction
step is synchronous (the answer on https://github.com/kamp-us/tea-fabrika/issues/1899). A program in another Durable
Object needs a Ledger transaction: read, then append, undone as a whole on a refusal. What does the platform allow? This
note gives facts. It decides nothing.

Read on 2026-11-22. Every claim carries one mark:

- **docs**: Cloudflare's developer docs, read on that date.
- **source**: the `workerd` source at tag
  [`v1.20261026.1`](https://github.com/cloudflare/workerd/tree/3466f2c644cc6405878f8c698605ab28712456c0) (commit
  `3466f2c`). I read it. I did not run that build.
- **types**: the installed `@cloudflare/workers-types` (`5.20261109.1` in `node_modules`; the repo pins `5.20261027.1`
  in `next/packages/libfabrika/package.json`; the RPC and storage types I cite are the same in both).
- **tried**: I ran it on the installed `miniflare` `4.20260730.0`, which bundles `workerd` `1.20260730.1`. That is an
  older build than the source tag. The trial is listed at the end.
- **my reading**: mine, not a source's claim.

Two earlier notes cover the neighbors, and I do not repeat them:
[`.kalfa/research/durable-object-async-transaction.md`](https://github.com/kamp-us/tea-fabrika/blob/origin/research/do-async-transaction/.kalfa/research/durable-object-async-transaction.md)
(branch `research/do-async-transaction`: the async `transaction()` is a `blockConcurrencyWhile` plus one savepoint, with
the output gate held only at commit) and
[`.kalfa/research/store-up-app-down.md`](https://github.com/kamp-us/tea-fabrika/blob/origin/research/store-up-app-down/.kalfa/research/store-up-app-down.md)
(branch `research/store-up-app-down`: what keeps a Ledger class answering when a program fails). Below, "the earlier
async note" means the first one.

Short glosses. A **stub** is a stand-in object: calling it sends the call to the real object somewhere else. The
**input gate** holds back new events while an object waits on its storage. The **output gate** holds back outgoing
messages until the object's writes are saved. A **critical section** is workerd's name for the span of
`blockConcurrencyWhile`: nothing else reaches the object until it ends.

## The short answer

1. **What crosses.** Plain data (structured-cloneable, up to 32 MiB), a function (arrives as a stub), an `RpcTarget`
   class instance (arrives as a stub), streams, `Request`/`Response`, and other stubs. A plain class instance cannot
   cross. A function or an `RpcTarget` never moves: each call on its stub is a new awaited round trip back to the
   object that made it. **No cross-object call is synchronous.**
2. **Joining a transaction.** Nothing from another object can be inside `transactionSync`, because the callback cannot
   await, and an RPC call returns a thenable that you cannot wait on there. In the async `transaction()` the callback
   may await another object, and a throw rolls back the Ledger's own writes. It does not undo anything the other object
   committed. If the other object calls back into the Ledger by name while the callback waits, the two deadlock until
   the 30 second limit resets the Ledger.
3. **Gates.** While an object awaits another object outside a transaction, its input gate is open: other events,
   including a second "read, then append", interleave. Inside `transaction()` they wait. So "read, then append" is
   atomic only if the Ledger holds it in one synchronous step or inside its own `transaction()`.
4. **Cloudflare's own shape.** Confirmed. Their examples put the whole check-then-write in one RPC method on the owning
   object. The docs say a split that needs a transaction across objects is the wrong split. They offer no cross-object
   transaction, and I found no two-phase commit or saga example.
5. **Limits.** CPU 30 seconds per invocation by default, 5 minutes at most. An RPC call has no wall-time limit, but a
   critical section ends at 30 seconds with the object reset. Serialized RPC size is 32 MiB. A class cannot be handed
   code at start-up. Functions it holds die with the call that made them. Loading code at run time is a separate
   feature (Dynamic Workers and facets).

One more result you may not expect, from the trial: in the local build, a function stub that the Ledger creates
**inside** its `transaction()` can be called back **once**. A second call on the same stub waits until the 30 second
reset. See finding 2d.

## 1. What one object may pass to another

**Plain data (docs).** "Nearly all types that are Structured Cloneable can be used as a parameter or return value of an
RPC method." Application-defined classes and objects with custom prototypes cannot, "except as described below"
([Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/)). A class that does not extend `RpcTarget`
"cannot be sent over RPC at all", on purpose: structured clone would drop the class and keep only the fields. The
limit: "The maximum serialized RPC limit is 32 MiB". Bigger data goes in a `ReadableStream` (same page,
"Limitations").

**A function (docs).** "When you do so, the function is replaced by a 'stub'. The recipient can call the stub like a
function, but doing so makes a new RPC back to the place where the function originated." It runs in the sender, not in
the receiver. A function can be a parameter too, "which enables the 'server' to call back to the 'client'" (same page,
"Functions").

**A class instance (docs).** A class that extends `RpcTarget` is "replaced by a stub", and calling a method on the stub
"actually makes an RPC back to the original object". One stub per instance, however many methods. A plain object of
functions makes one stub per function, so the docs advise a class. Only methods and getters on the class cross.
Instance fields are always private ([Visibility](https://developers.cloudflare.com/workers/runtime-apis/rpc/visibility/)).

**The types (types).** `Rpc.Stubable` is `RpcTargetBranded | ((...args: any[]) => any)`. `Rpc.Serializable<T>` is the
structured-cloneable set plus `Stub<Stubable>` and `Stubable`
(`node_modules/.pnpm/@cloudflare+workers-types@5.20261109.1/node_modules/@cloudflare/workers-types/index.d.ts`, the
`Rpc` namespace, from line 16224). A Durable Object stub is typed `DurableObjectStub<T>`, a `Fetcher<T, ...>` (line
638). `RpcTarget` is declared at line 16454.

**What each costs.**

| Passed as | Cost |
|---|---|
| Plain data | Copied. 32 MiB cap. No later link to the sender. |
| Function stub | One awaited round trip per call, run in the sender. The call's execution context stays open until every stub passed in it is disposed (docs, [Lifecycle](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/)). A stub received as a parameter "is automatically disposed when the call returns" unless you call `dup()`. |
| `RpcTarget` stub | The same, with one stub for many methods. It can also have a `Symbol.dispose` method that runs after the last stub is dropped. |
| Any call whose arguments hold a function, stub, stream or `RpcTarget` | The runtime never retries it automatically (docs, [Automatic retries](https://developers.cloudflare.com/durable-objects/best-practices/automatic-retries/)). |

Also from the docs: a method "never runs twice because of a retry, unless you mark it with `retryable()`". If the
connection drops, the caller may not know whether the call ran.

**Is any cross-object call synchronous? No.**

- Docs: "Whether or not the method you are calling was declared asynchronous on the server side, it will behave as such
  on the client side. You must `await` the result." The result is a "custom thenable", not a `Promise`.
- Source: the call's reply is awaited through `IoContext::awaitIo`
  ([worker-rpc.c++ L1425](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/api/worker-rpc.c%2B%2B#L1425)).
- Tried: a stub call made inside `transactionSync` returns `[object JsRpcPromise]`.
- A facet (a child object loaded under a Dynamic Worker) is reached through a `Fetcher` too (types, line 827). I did not
  try whether a facet call is any different. My reading: it is the same RPC.

## 2. Can anything called from another object join the transaction?

### 2a. `transactionSync`: no

- Docs: "The callback must complete synchronously, that is, it should not be declared `async` nor otherwise return a
  Promise. Only synchronous storage operations can be part of the transaction." If it throws, "the transaction will be
  rolled back" ([SQLite-backed storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), also
  at `https://developers.cloudflare.com/durable-objects/api/storage-api/`).
- Source: it is `SAVEPOINT`, run the callback, `RELEASE`, or `ROLLBACK TO` and `RELEASE` on a throw. It hands the
  callback's return value straight back and never checks for a Promise
  ([actor-state.c++ L742-L785](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/api/actor-state.c%2B%2B#L742-L785)).
- Types: `transactionSync<T>(closure: () => T): T` (line 788). `T` may be a `Promise`, so the compiler does not stop you.
- Tried (trial A): an RPC call started inside the callback gives back a `JsRpcPromise` that nothing can wait on, and a
  later throw in the callback rolled back the Ledger write. Whether the call itself had already left before the rollback
  I did not check.
- Tried (trial B): `transactionSync(async () => { write; await; write; throw })` is accepted, returns a `Promise`, and
  keeps both writes. The first write is saved when the callback first yields. The write after the `await` happens
  outside the savepoint. The throw after the `await` undoes nothing. The docs forbid this, but the runtime does not
  refuse it.

### 2b. The async `transaction()`: the callback may await another object

- Docs: it "runs the sequence of storage operations ... in a single transaction that either commits successfully or
  aborts". With the SQLite engine, "the `txn` object is obsolete. Any storage operations performed directly on the
  `ctx.storage` object, including SQL queries using `ctx.storage.sql.exec()`, will be considered part of the
  transaction" (same page).
- Source: `transaction()` runs the callback inside `blockConcurrencyWhile`, so one critical section and one savepoint.
  If the callback throws or rejects, the code rolls back and passes the error on, "We don't actually want to reset the
  object"
  ([actor-state.c++ L660-L740](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/api/actor-state.c%2B%2B#L660-L740)).
  The earlier async note found the same at another commit.
- Source: the reply to an RPC call that the callback made counts as "initiated by the critical section", so it is
  delivered inside it. The wait is `awaitIo` with the current critical section
  ([io-context.h L1602-L1608](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/io/io-context.h#L1602-L1608)).
  Tried: it works (trial C).

### 2c. A refusal undoes only this object's writes

Source and docs describe one SQLite savepoint inside one object. Nothing in either links two objects' savepoints. Each
object has its own database, its own input gate and its own output gate. Tried (trial C): the Ledger awaited
`program.write("c-program-write")` inside `transaction()`, then threw. The Ledger's entry was gone. The Program's
write stayed.

Facets: the docs say a facet gets "its own isolated SQLite database" and that "the supervisor's database and the
facet's database are stored together as part of the same overall Durable Object"
([Durable Object Facets](https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/)). They do not
say whether a facet's write joins the supervisor's savepoint. Not checked.

### 2d. What happens if the other object calls the Ledger back during the transaction

Two ways, and they differ.

- **A fresh call by name or by a stub taken from the binding.** It is a new event on the Ledger. The critical section
  holds back every event that it did not start (docs, [State](https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile):
  "All events that were not explicitly initiated as part of the callback itself will be blocked"; source,
  [io-gate.h L174-L176](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/io/io-gate.h#L174-L176)).
  The Ledger waits for the Program, which waits for the Ledger. Tried (trial F): still blocked after 4 seconds, and the
  Ledger was reset at 30 seconds with "A call to blockConcurrencyWhile() in a Durable Object waited for too long. The
  call was canceled and the Durable Object was reset." The docs name the 30 second timeout as the deadlock guard.
- **A function stub or `RpcTarget` stub that the Ledger created inside the callback.** The source says such a stub is
  allowed in: the runtime's re-entry callback "is allowed to run within the critical section ... from which it was
  called", and it names the deadlock case it avoids
  ([io-context.h L790-L800](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/io/io-context.h#L790-L800)).
  Tried (trial E): the program's function ran, called a Ledger stub, the Ledger append landed in the savepoint, and a
  throw in the program's function rolled the Ledger's append back (`ledger: []`). A commit kept it.

**The catch, tried and read.** In the local build each such stub worked **once**. Two calls on one `RpcTarget` stub, or
two calls on one function stub, blocked until the 30 second reset (trial E, two calls: reset message at 30 s, ledger
empty). Two different function stubs, one call each, worked. The same two calls outside a transaction worked. My
reading of why: the re-entry lambda keeps the critical section it was made in and hands it to `run()` with
`kj::mv(cs)` on every call
([io-context.h L1928-L1952](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/io/io-context.h#L1928-L1952)),
though the same file says "The returned function can be called multiple times" (L806). After the first call the moved
value is spent, so the second call goes through the object's normal input gate and waits behind the critical section.
That is a reading of source plus a result, not a confirmed cause. I found no workerd issue about it. I did not test
whether a stub returned from a re-entered call carries a fresh critical section, which would give one working stub per
step.

## 3. Gates: what interleaves while one object awaits another

**Outside a transaction.**

- Docs: input gates block new events "while synchronous JavaScript execution is in progress. Awaiting async operations
  like `fetch()` or KV storage methods opens the input gate". "Input gates only protect during storage operations.
  Non-storage I/O like `fetch()` or writing to R2 allows other requests to interleave, which can cause race
  conditions". The docs' example is a read, then a `fetch`, then a write
  ([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/),
  "Understand how input and output gates work").
- My reading: an RPC call to another object is non-storage I/O, so the same holds.
- Tried (trial D): two concurrent calls that each read the entry count, awaited a Program call, then appended based on
  the count both read it as 0: `["saw0","saw0"]`. A lost update.
- SQLite calls are synchronous and run to completion without a transaction (docs,
  [State](https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile): "SQLite storage
  operations are synchronous and do not yield the event loop, so they execute atomically").

**Inside `transaction()`.** Other events wait (2b, 2d). Tried (trial D): the same two calls inside `transaction()` gave
`["saw0","saw1"]`. The docs page above says to prefer `transaction()` over `blockConcurrencyWhile()` because it blocks
"unrelated concurrent requests" less. The source does not show that: `transaction()` is built on
`blockConcurrencyWhile` (2b), and the second call did wait. I trust the source and the trial over that sentence.

**Output gate, both directions (source).**

- An outgoing RPC call waits for the caller's output gate before it leaves
  ([worker-rpc.c++ L1216](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/api/worker-rpc.c%2B%2B#L1216)).
  So a write made before the call is saved before the other object hears of it. Inside an explicit transaction the
  gate is held only when the commit is confirmed, so a call from inside the callback leaves at once (the earlier async
  note, finding 6; source `actor-sqlite.c++` L249).
- The callee's return value, and its exception too, wait for the callee's own output gate
  ([worker-rpc.c++ L2283-L2300](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/api/worker-rpc.c%2B%2B#L2283-L2300)).
  So the caller never sees the result of a callee write that is not yet saved.

**What this means for "read, then append".** It is atomic in two cases: inside one synchronous step on the owning
object, or inside that object's own `transaction()`. Awaiting another object between the read and the append, without a
transaction, is not atomic. With a transaction, it costs that object every other event for the length of the wait.

## 4. What Cloudflare's own docs and examples do

**The named method that does the whole step. Confirmed.** The docs' `SeatBooking.bookSeat(seatId, userId)` reads the
row, checks it, and inserts, all in one synchronous method on the owning object: "this is safe because Durable Objects
are single-threaded" ([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/),
"Use Durable Objects for stateful coordination"). The caller sends plain data and gets plain data back. The Architecture guidance
page says the same of `ChatRoom.sendMessage`: "No race conditions, no distributed locks needed".

**What they say about two objects (docs, [Architecture guidance](https://developers.cloudflare.com/durable-objects/best-practices/architecture-guidance/)).**

- "The atom is the largest unit you need to update atomically, and the smallest unit you can serve on its own."
- "Signs your atom is too fine: You need a transaction that spans several objects."
- "When not to split further: ... The split would require a transaction across the new objects."
- Anti-pattern: "Avoid splitting a hot Durable Object without considering upstream connections, hot keys, or
  cross-object transactions."
- Design checklist: "Cross-object operations account for the absence of a shared transaction."
- For an agent run: "Tool calls inside an agent loop need ordered, atomic checkpoints. Keep them inside the run object,
  or use Workflows when you need durable per-step retries."

**What their examples do when two objects both change.** One-way steps with a retry rule, not a shared transaction.

- Parent and child: the parent inserts its own row, then `await childStub.init(...)`. If `init` fails, the parent's row
  stays. There is no undo in the example (Architecture guidance, "Use child Durable Objects").
- "A local storage transaction and an external write do not form one transaction. Persist enough state to retry a failed
  publication, and use configuration versions" ([Architecture examples](https://developers.cloudflare.com/durable-objects/best-practices/architecture-examples/),
  "Separate account control from resource traffic").
- "Make the backend idempotent by deduplicating on `event_id`" after a repeated flush (same page, ingest buffer).
- Queues for delivery and Workflows for per-step retries are the pointers for multi-step work.

I searched those pages and the Cloudflare docs search for a cross-object transaction, two-phase commit and saga. I
found none. That is not proof that none exists.

## 5. Limits that matter

- **CPU (docs).** 30 seconds per invocation by default, up to 5 minutes with `limits.cpu_ms`. The docs list "HTTP
  request, WebSocket message, or Alarm" and say each new request tops the budget up. They do not name an RPC call.
  Source: an RPC into an object tops the budget up too. The re-entry callback is built with `TOP_UP`, and an
  entry-point RPC says the budget was "already topped up by IncomingRequest::delivered()"
  ([worker-rpc.c++ L2015-L2035](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/api/worker-rpc.c%2B%2B#L2015-L2035)).
  CPU time is active compute: waiting on another object does not count
  ([Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).
- **Wall time (docs).** A Durable Object RPC call has no hard wall limit while the caller stays connected
  ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), wall-time table). A critical section
  does: 30 seconds, then the object is reset (docs, State page; source
  [io-context.h L2066-L2074](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/io/io-context.h#L2066-L2074);
  tried: reset at about 30 seconds on the local build). So a program step awaited inside the Ledger's `transaction()`
  has 30 seconds of wall time in all, whatever the RPC limit says. Nesting depth is capped at 64 (source, L53).
- **Argument size (docs).** 32 MiB serialized per RPC. Streams are exempt.
- **Subrequests (docs).** Workers cap subrequests per invocation (50 free, 10,000 paid). The docs do not say whether a
  Durable Object RPC call counts. Not confirmed.
- **Can a class hold code handed to it at start-up? No, not as source.**
  - A Durable Object class is part of the deployed Worker version. Another class cannot give it new code.
  - What can be handed over is a stub. It keeps the code in the sender. A function stub lasts only as long as the
    sender's execution context: stubs made during an event are "automatically disposed" when the handler is done
    (docs, Lifecycle), and a call on one after that fails with "The execution context which hosts this callback is no
    longer running" (source, io-context.h, the re-entry callback). So a function handed over once at start-up cannot be
    kept across requests or after the object sleeps.
  - Source only: an RPC stub can be written to storage only if it is a "persistent stub" (one made from a binding)
    under the `allow_irrevocable_stub_storage` flag
    ([worker-rpc.c++ L1884-L1892](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/api/worker-rpc.c%2B%2B#L1884-L1892)).
    Not tried.
  - Loading code at run time is a different feature. A Durable Object can load a class from a Dynamic Worker with the
    Worker Loader and run it as a child with `ctx.facets.get(name, () => ({ class }))`. The child has its own SQLite
    database and the supervisor controls access. The loaded code can have `cpuMs` and `subRequests` limits
    ([Durable Object Facets](https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/),
    [Custom resource limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/)). The store-up-app-down
    note already covers its failure sharing. I did not try it here.

## What this means for the Ledger (my reading; it decides nothing)

- **Plain data into a named Ledger method** is Cloudflare's own shape. It needs the whole "read, decide, append" to run
  inside the Ledger's isolate. A program in another object can only take part by sending data.
- **A Ledger `transaction()` that calls the program's function** does work on the local build. It rolls back the
  Ledger's writes on a refusal. But the Ledger is then closed to every other event while the program thinks, up to 30
  seconds, and a program that hangs resets the Ledger. That runs against the ruling that an append never calls into a
  program (the resolution comment on https://github.com/kamp-us/tea-fabrika/issues/1876, rule 1) and against decision
  0076's "a program throws, hangs, spins" coverage. It also needs one stub per step in the build I tried.
- **The program's own writes are never part of it.** Anything the program saves in its object before a Ledger refusal
  stays.
- A check by revision, where the append says what it read, needs no cross-object transaction at all. Nothing I read says
  whether the Ledger already has it. I mention it only because the docs' own advice is to stay inside one object.

## What this cannot tell us

- Nothing ran in a deployed Worker. The trial used a local `workerd` older than the source tag I read. The once-per-stub
  result may be a bug fixed later, or may not happen in production. Test it on the platform before relying on it or on
  its absence.
- Local runs did enforce the 30 second critical-section limit. They did not enforce CPU limits, and I did not try them.
- I did not test facets joining a savepoint, a stub returned from a re-entered call, `retryable()`, or whether the
  call inside `transactionSync` left before the rollback.
- The docs say transactions block less than `blockConcurrencyWhile`. The source and the trial say otherwise. I did not
  find which one the platform follows in production.
- My search for a Cloudflare cross-object transaction example covered the Durable Objects docs and the docs search.
  Blog posts and sample repositories beyond the 2021 transactions post were not combed.
- The docs pages change often. Several were updated in November 2026.

## The trial

Local, no deploy, no account. `miniflare` `4.20260730.0` from the repo's `node_modules`, two SQLite-backed classes,
compatibility date `2026-04-21`, run with `nice`. A Worker `fetch` handler calls the scenarios below. Results:

| Scenario | Result |
|---|---|
| A. `transactionSync`, RPC call inside, then throw | call returns `[object JsRpcPromise]`, Ledger write rolled back |
| B. `transactionSync(async () => ...)` with a throw after an `await` | accepted, returns `[object Promise]`, both writes kept |
| C. async `transaction()`, `await program.write(...)`, then throw | Ledger empty, Program write kept |
| D. read, await a Program call, append, two at once | without `transaction()`: `["saw0","saw0"]`; with it: `["saw0","saw1"]` |
| E. function stub, one call, program returns | Ledger append kept |
| E. function stub, one call, program throws | Ledger append rolled back |
| E. two function stubs (read, append), one call each | works |
| E. one `RpcTarget` stub, one call | works |
| E. one `RpcTarget` stub, two calls | blocked; reset at about 30 s; Ledger empty |
| F. program calls the Ledger by name during `transaction()` | blocked; reset at about 30 s |

The worker, trimmed to what matters (`Ledger` and `Program` are `DurableObject` subclasses with SQLite tables):

```js
// Ledger
async transact(programFn, shape) {          // programFn is a stub to the program's function
  return await this.ctx.storage.transaction(async () => {
    const arg = shape === "fn" ? (v) => { this.append(v); return this.all(); }
              : shape === "target" ? new Tx(this)        // class Tx extends RpcTarget { read(); append(v) }
              : { read: () => this.all(), append: (v) => this.append(v) };
    return await programFn(arg);
  });
}
async transactThenCallee(name) {            // trial F
  return await this.ctx.storage.transaction(async () => {
    this.append("f-in-txn");
    return await this.env.PROGRAM.getByName(name).callBack(name);   // callBack() calls Ledger.append by name
  });
}
// Program
async run(name, shape, mode) {
  const fn = async (arg) => {
    if (shape === "fn") await arg("e-one-call");
    else if (shape === "target" && mode === "two-calls") { await arg.read(); await arg.append("e-second-call"); }
    if (mode === "refuse") throw new Error("refusal");
    return "ok";
  };
  return await this.env.LEDGER.getByName(name).transact(fn, shape);
}
```

## Sources

- Cloudflare Workers RPC:
  [overview](https://developers.cloudflare.com/workers/runtime-apis/rpc/),
  [lifecycle](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/),
  [visibility](https://developers.cloudflare.com/workers/runtime-apis/rpc/visibility/),
  [error handling](https://developers.cloudflare.com/workers/runtime-apis/rpc/error-handling/).
- Cloudflare Durable Objects:
  [SQLite-backed storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
  [State](https://developers.cloudflare.com/durable-objects/api/state/),
  [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/),
  [Architecture guidance](https://developers.cloudflare.com/durable-objects/best-practices/architecture-guidance/),
  [Architecture examples](https://developers.cloudflare.com/durable-objects/best-practices/architecture-examples/),
  [Invoke methods](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/),
  [Automatic retries](https://developers.cloudflare.com/durable-objects/best-practices/automatic-retries/),
  [Limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
  [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
- Cloudflare Dynamic Workers:
  [Durable Object Facets](https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/),
  [Bindings](https://developers.cloudflare.com/dynamic-workers/usage/bindings/),
  [Custom resource limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/).
- Cloudflare blog: [Durable Objects: Easy, Fast, Correct, Choose Three](https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/).
- `workerd` at tag `v1.20261026.1` (commit `3466f2c644cc6405878f8c698605ab28712456c0`):
  [`src/workerd/api/actor-state.c++`](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/api/actor-state.c%2B%2B),
  [`src/workerd/api/worker-rpc.c++`](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/api/worker-rpc.c%2B%2B),
  [`src/workerd/io/io-context.h`](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/io/io-context.h),
  [`src/workerd/io/io-gate.h`](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/io/io-gate.h),
  [`src/workerd/io/actor-sqlite.c++`](https://github.com/cloudflare/workerd/blob/3466f2c644cc6405878f8c698605ab28712456c0/src/workerd/io/actor-sqlite.c%2B%2B).
- This repo: decision `.kalfa/decisions/0076-a-far-read-is-a-remote-ledger-over-the-signed-in-connection.md`; tickets
  https://github.com/kamp-us/tea-fabrika/issues/1876 and https://github.com/kamp-us/tea-fabrika/issues/1899; the two
  earlier notes named at the top.
