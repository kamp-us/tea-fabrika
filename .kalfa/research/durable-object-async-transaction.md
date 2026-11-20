---
summary: Whether a SQLite-backed Durable Object's async ctx.storage.transaction() gives the same all-or-nothing, nothing-in-between guarantee as transactionSync(), and what the input and output gates do during it, from Cloudflare's docs and workerd's source
---

# Does a SQLite Durable Object offer an async transaction?

Question: does `ctx.storage.transaction(async ...)` on a SQLite-backed Durable Object give the same guarantee as
`transactionSync`: nothing else is written between its reads and its appends, and its appends land together or not at
all? What do input and output gates do during it, and what if the step awaits a fetch or a timer?

Read on 2026-11-20. Source code was read at workerd commit
[7545be6](https://github.com/cloudflare/workerd/tree/7545be644952d71d76b904b37ae71b10c0ba8cad). A line marked "my
reading" is mine, not a source's claim.

## The short answer

Yes, with one caveat. The async `transaction()` runs inside a critical section (workerd's name for
`blockConcurrencyWhile`). The critical section keeps every event that the callback did not start from being delivered
to the object. The callback's own storage calls run inside one SQLite savepoint, which is released on success and
rolled back if the callback throws or rejects. So the reads and writes in it are isolated and atomic, even across
awaits.

The caveat is that the callback is not atomic with respect to the outside world. The output gate does not hold
outgoing messages while the callback runs, only while the commit is flushing. A `fetch()` the callback sends goes out
at once, and cannot be taken back if the transaction later rolls back. The whole callback also has a 30 second limit,
and past it the object is reset.

## Findings

1. **`transactionSync` is the simple case.** The docs say the callback "must complete synchronously, that is, it should
   not be declared `async`", and that if it throws "the transaction will be rolled back"
   ([Storage API](https://developers.cloudflare.com/durable-objects/api/storage-api/)). In source it is one savepoint:
   `SAVEPOINT _cf_sync_savepoint`, then `RELEASE`, or `ROLLBACK TO` on a throw
   ([actor-state.c++, `transactionSync`](https://github.com/cloudflare/workerd/blob/7545be644952d71d76b904b37ae71b10c0ba8cad/src/workerd/api/actor-state.c++#L742-L785)).
   No other JavaScript can run in the middle, so nothing else can be written.

2. **The async `transaction()` is wrapped in `blockConcurrencyWhile`.** `DurableObjectStorage::transaction` calls
   `context.blockConcurrencyWhile(...)` and then `asyncTransactionImpl`. A source comment says why: the SQLite engine
   runs `BEGIN TRANSACTION` when `startTransaction()` is called, so it must happen inside the block "so we don't
   accidentally catch some other asynchronous event in our transaction"
   ([actor-state.c++, `transaction`](https://github.com/cloudflare/workerd/blob/7545be644952d71d76b904b37ae71b10c0ba8cad/src/workerd/api/actor-state.c++#L660-L740)).

3. **What the critical section does to the input gate.** workerd's own comment: "While a CriticalSection is running,
   all events that were not initiated by the CriticalSection itself will be blocked from being delivered"
   ([io-gate.h](https://github.com/cloudflare/workerd/blob/7545be644952d71d76b904b37ae71b10c0ba8cad/src/workerd/io/io-gate.h#L174-L176)).
   The docs say the same of `blockConcurrencyWhile`: "All events that were not explicitly initiated as part of the
   callback itself will be blocked"
   ([State API](https://developers.cloudflare.com/durable-objects/api/state/)). Other requests, timers and fetch
   replies that belong to other work wait until the callback finishes.

4. **The callback's writes are one savepoint.** `ExplicitTxn` runs `SAVEPOINT _cf_savepoint_<depth>` when it is
   created. Commit runs `RELEASE`. Rollback runs `ROLLBACK TO` and then `RELEASE`. While an explicit transaction is
   open, an ordinary `ctx.storage` call goes into it; the docs say storage operations done directly on `ctx.storage`
   "will be considered part of the transaction", and that with the SQLite engine the `txn` object is "obsolete"
   ([actor-sqlite.c++, `ExplicitTxn`](https://github.com/cloudflare/workerd/blob/7545be644952d71d76b904b37ae71b10c0ba8cad/src/workerd/io/actor-sqlite.c++#L126-L300),
   [Storage API](https://developers.cloudflare.com/durable-objects/api/storage-api/)). If the callback throws or
   rejects, `asyncTransactionImpl` calls `maybeRollback()` and passes the error on without resetting the object.

5. **If an implicit transaction is open or other blocking work is pending, `startTransaction()` waits, then retries.**
   An implicit transaction is the one SQLite storage opens around writes outside any transaction. The comment says
   pending work must finish first, "otherwise they might accidentally deliver their writes inside the nested
   transaction"
   ([actor-sqlite.c++, `startTransaction`](https://github.com/cloudflare/workerd/blob/7545be644952d71d76b904b37ae71b10c0ba8cad/src/workerd/io/actor-sqlite.c++#L851-L866)).
   The retry loop is before the callback starts, so the callback itself does not run twice on this path. (The 2021
   blog says the callback "can be called multiple times"; that describes the older cache-based engine, my reading.
   [Blog](https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/))

6. **Output gate.** The gate "blocks all outgoing messages from an actor that would allow the rest of the world to
   observe the actor's state. Held while writes that have been confirmed to the application are still being flushed"
   ([io-gate.h](https://github.com/cloudflare/workerd/blob/7545be644952d71d76b904b37ae71b10c0ba8cad/src/workerd/io/io-gate.h#L18-L21)).
   For an explicit transaction, the source says it "only locks when we're going to confirm the commit", not at the
   start or during the callback
   ([actor-sqlite.c++, `commitImpl`](https://github.com/cloudflare/workerd/blob/7545be644952d71d76b904b37ae71b10c0ba8cad/src/workerd/io/actor-sqlite.c++#L215-L270)).
   So a message sent from inside the callback is not held by this gate. My reading: a `fetch()` to another service
   from inside the callback can arrive before, and without, the commit.

7. **Awaiting a fetch or a timer inside the callback.** The docs do not say anything about this case: the Storage API
   page "does not document `fetch` inside a transaction closure", and the State API page only lists `fetch()` as a
   reason to use `blockConcurrencyWhile` ("make external async calls"). From the rules in findings 3 and 4, my reading
   is that the fetch reply and the timer event were started by the callback, so they are delivered, and everything
   else keeps waiting. The wait is bounded: "there is a 30 second timeout applied when executing the callback", and if
   it is exceeded "the Durable Object will be reset"
   ([State API](https://developers.cloudflare.com/durable-objects/api/state/)). The source matches: after 30 seconds
   it throws "A call to blockConcurrencyWhile() in a Durable Object waited for too long. The call was canceled and the
   Durable Object was reset."
   ([io-context.h](https://github.com/cloudflare/workerd/blob/7545be644952d71d76b904b37ae71b10c0ba8cad/src/workerd/io/io-context.h#L2319-L2360)).
   I did not run this; I only read it.

8. **Nesting.** A `transaction()` inside another one is a nested savepoint at depth + 1, and only one child at a time.
   Calling `blockConcurrencyWhile` in the callback nests up to a fixed depth, then throws
   ([io-context.h](https://github.com/cloudflare/workerd/blob/7545be644952d71d76b904b37ae71b10c0ba8cad/src/workerd/io/io-context.h#L2319-L2330)).

## What this means for the Ledger (my reading)

- A ledger transaction that takes an Effect step is possible: reads and appends inside it are isolated from other
  events and commit together.
- Cost: every other request to that object waits, for as long as the step waits. Slow steps stall the whole object, and
  at 30 seconds the object resets.
- Risk: a side effect in the step (a fetch that changes something elsewhere) is not held back by the output gate and is
  not undone by a rollback.
- The guarantee comes from workerd's implementation. The public docs do not state it for `transaction()` as plainly as
  they do for `transactionSync()`.

## What this cannot tell us

- No test was run. Everything is read from docs and source at one commit, and behavior may change.
- The docs say nothing about fetch or timers inside `transaction()`. Finding 7 is inferred from the gate code.
- I did not trace every kind of event (for example alarms, or a promise another request already resolved before the
  transaction began) through the input gate.
- I did not check which Cloudflare compatibility flags or runtime versions change this path.
