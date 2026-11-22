---
summary: Whether a Cloudflare Durable Object's store can take a write while the program that guards it cannot answer, checked failure by failure (uncaught exception, bad deploy, stuck call, CPU and memory limits, held input gate, failing alarm, platform outage, spending cap), what a second append door in the same class, in its own class, or in its own Worker would share with the broken part, and whether the storage can be reached from outside the object at all; every claim cited
---

# Can the store answer on Cloudflare while the app's process cannot?

Question (ticket https://github.com/kamp-us/tea-fabrika/issues/1871): a `kalfa` command run with `--direct` appends an
entry straight into the app's own Ledger "when the app is down". The decision says "the app is down" means the guarding
process is not answering while the store still is
([resolution comment on 1863](https://github.com/kamp-us/tea-fabrika/issues/1863#issuecomment-7074392640)). Does that
state exist on Cloudflare? In which failures can a direct append work, and in which can it not?

Read on 2026-11-21. Primary sources only: Cloudflare's own Durable Objects, Workers and API docs, two Cloudflare
post-mortems, and this repo's tickets and code (pinned to commit
[`0676aed`](https://github.com/kamp-us/tea-fabrika/tree/0676aed66520b04d1be22ad5c7714f9b1c62615c)). A line marked "my
reading" is mine, not a source's claim. A line marked "not confirmed" says what I could not check. I ran no code and
deployed nothing. Everything here comes from docs and source.

A Durable Object (DO) is a small server with its own private database. There is one instance per name. Its code runs on
one thread. The "input gate" holds back new events while the object waits on its storage. The "output gate" holds back
replies until a write is saved.

## The short answer

1. **The state exists, but only for part of the failures, and only if the append door is code the broken part does not
   share.** A direct append can work when the program's logic fails: a step throws, a call hangs, an alarm fails, a
   step spins and the platform resets the object. It cannot work when the whole object fails to start, when the whole
   Worker's deploy is bad, or when the platform or the account's spending cap stops the store itself.
2. **With one object, one class and one Worker, the door shares the constructor, the deploy and the thread with the
   program.** Then it fails in the cases that most often mean "the app is totally down": a deploy that breaks start-up
   (my reading of what is most likely; no source ranks causes) and a program that spins on every start.
3. **Splitting helps in steps.** A Ledger in its own class (with a start-up that imports no program code) removes the
   shared constructor and thread. Putting it in its own Worker also removes the shared deploy and rollback. Neither
   helps against a platform outage.
4. **"The storage can't be reached from outside the object" is mostly true, with one real exception.** The docs say the
   storage is private to its instance and that a DO is reached only through a Worker. But Cloudflare's API has a "Query a
   Durable Object" endpoint that runs SQL against an object's storage with an account API token. A `kalfa` command with a
   project client key cannot use it, and raw SQL would skip the Ledger's rules.
5. **The decision does not need reversing. It needs a rider.** The choice (write into the app's own Ledger, not a device
   Ledger) still holds. But "the app is down" should say which down it covers, and the Ledger's Cloudflare entry point
   should be built so its append door shares as little as possible with Program.

Confidence: about 80% on the structure of this verdict, because it follows from documented behavior (one thread, one
constructor, one deploy per Worker, storage private to an instance). About 60% on the timing details (how long a
spinning object stays blocked, whether a reset also hits neighbors), because the docs are thin there and one source is
from 2021. The doubts are listed at the end.

## The cases

"Same class" means the append door is another method on the DO class that also runs the program. "Own class" means the
Ledger is a separate DO class and the program calls it by RPC. The last column also covers "own Worker" where it
differs.

| Failure | Does a new call still reach a handler? | Can a handler write storage? | Direct door in the same class | Direct door in its own class |
|---|---|---|---|---|
| A handler throws (uncaught exception) | Yes | Yes | Works, if the append method does not run the failing code | Works |
| Bad deploy, refused at upload (syntax error, start-up over 1 s of CPU or 128 MB) | Yes, the old version keeps serving | Yes | Not down | Not down |
| Bad deploy, accepted, but the constructor throws when it runs | No: every call to that class fails | No | Fails | Works if the throw is in the program's class. Fails if it is in code both classes share. Works in its own Worker. |
| Bad deploy, accepted, but one handler's logic is wrong | Yes | Yes | Works | Works |
| A call hangs while awaiting a network call | Yes (the input gate is open during non-storage waits) | Yes | Works | Works |
| A step is stuck inside `blockConcurrencyWhile` or an async transaction | No: other events wait up to 30 s, then the object is reset | After the reset | Waits, then works | Works (a different object) |
| A step spins on the CPU | No, until the CPU limit (30 s by default, 5 min at most), then the object is reset | After the reset | Waits, then works. Unreliable if the spin restarts on every start. | Works |
| Memory over 128 MB | The isolate is replaced; in-flight calls finish | Yes, on the new isolate | Works after the swap. A neighbor object in the same isolate can be hit. | Works. Whether a different class shares the isolate is not confirmed. |
| An alarm keeps failing | Yes | Yes | Works | Works |
| Platform outage in the storage layer, a region, or Workers | No | No | Fails | Fails |
| Account spending cap reached | No: new calls are rejected | No: SQL reads and writes are rejected | Fails | Fails |

The sections below give the source for each row.

## What the design says (and where I read it)

- **What "down" means.** The 1863 resolution says a `--direct` entry goes "straight into the app's own Ledger", and
  "the app is down" means "the guarding process is not answering while the store still is"
  ([1863 resolution](https://github.com/kamp-us/tea-fabrika/issues/1863#issuecomment-7074392640)). A comment on 1862 adds
  that a `--direct` write appends "with no gateway"
  ([1862 comment](https://github.com/kamp-us/tea-fabrika/issues/1862#issuecomment-7074393056)). The record is decision
  0075
  ([`.kalfa/decisions/0075-a-direct-entry-is-a-case-of-identitys-sender.md`](https://github.com/kamp-us/tea-fabrika/blob/0676aed66520b04d1be22ad5c7714f9b1c62615c/.kalfa/decisions/0075-a-direct-entry-is-a-case-of-identitys-sender.md)).
  It already says "If the store is down too, `--direct` cannot write either", and "Not checked yet: whether the store
  can answer on Cloudflare while the app's process cannot".
- **What the write passes through.** The app's Ledger admission refuses a direct entry for an act that asks for presence.
  Identity's admission checks the signature and that the key is still in (0075, steps 3 and 4). Admission is a
  synchronous `admit(entry)` that runs "inside the append's transaction"
  ([Ledger's protocol, 1764](https://github.com/kamp-us/tea-fabrika/issues/1764), the "LedgerAdmission" bullet). So the
  app's admission code runs inside the Ledger object. My reading: the door is only as independent as that code is.
- **Where the Ledger sits on Cloudflare.** `@kalfa/ledger/cloudflare` is "the Durable Object referee, the stub other
  objects call, wait's ready and parked form, and `Waker`". `@kalfa/ledger/sqlite` runs on any synchronous SQLite,
  a DO included. The core "imports no kalfa package" ([1764](https://github.com/kamp-us/tea-fabrika/issues/1764), "Entry
  points"). "The stub other objects call" means the design already expects other objects to call the Ledger object.
- **Where the program sits.** Program's protocol is
  [1765](https://github.com/kamp-us/tea-fabrika/issues/1765), listed in the map's Decisions so far
  ([suite map, 1706](https://github.com/kamp-us/tea-fabrika/issues/1706)). A program's journal and inbox are Ledger
  streams (`@kalfa/program/ledger`, `JournalLedger`). The place that runs programs on Cloudflare is not built: "Is the
  Durable Object runner (one alarm for the earliest timer) a `@kalfa/program/cloudflare` entry point, or libfabrika's?
  No ticket builds the sleeping place." (1765, "Gaps found"). The timer rule is in
  [1810](https://github.com/kamp-us/tea-fabrika/issues/1810): "a Durable Object sets its one alarm to the earliest
  timer".
- **The "one project object hosts both" premise.** I did not find that sentence in 1764, 1765 or 1706. It is the
  premise of ticket 1871. Today's frozen code does not do it: it has separate `Project`, `Process`, `Connection` and
  `RecordPart` object classes
  ([`objects.ts` L72-L78](https://github.com/kamp-us/tea-fabrika/blob/0676aed66520b04d1be22ad5c7714f9b1c62615c/next/packages/libfabrika/src/cloudflare/objects.ts#L72-L78)).
  The Project object holds the Ledger and the door. Each program name has its own Process object
  ([`runtime.ts` L407-L416](https://github.com/kamp-us/tea-fabrika/blob/0676aed66520b04d1be22ad5c7714f9b1c62615c/next/packages/libfabrika/src/cloudflare/runtime.ts#L407-L416)).
  A program's steps run in a "box" on a separate Worker, over RPC, and a program failure crosses back as data
  (`ProgramDown`)
  ([`Execution.ts` L1-L5](https://github.com/kamp-us/tea-fabrika/blob/0676aed66520b04d1be22ad5c7714f9b1c62615c/next/packages/libfabrika/src/runtime/Execution.ts#L1-L5),
  [`Program.ts` L640](https://github.com/kamp-us/tea-fabrika/blob/0676aed66520b04d1be22ad5c7714f9b1c62615c/next/packages/libfabrika/src/runtime/Program.ts#L640)).
  Today's version is frozen and is not the design, but it shows the split is workable. The kalfa design leaves the
  placement open, and the answer in this note depends on it.

## 1. Failure by failure

### An uncaught exception in a handler

- An uncaught exception in a DO "will be propagated to the callsite of the client". Many exceptions leave the caller's
  stub "broken", so the caller must make a new stub for the next call
  ([Error handling](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/)).
- The docs do not say that every uncaught exception resets the object. One page says in-memory state is lost "if it
  crashes from an uncaught exception"
  ([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)).
  Storage is not touched either way. Another handler on the same object can still run in the same instance, or in a
  new one after a reset.
- The runtime retries a call by itself only when the request "never reached the Durable Object" (for example it was
  restarting) or the connection dropped. It does not retry errors thrown by your code. A method runs twice only if it is
  marked `retryable()`
  ([Automatic retries](https://developers.cloudflare.com/durable-objects/best-practices/automatic-retries/)).
- Verdict: a handler can write storage. A direct append works if it does not call the failing code. My reading: an
  append that is idempotent by its entry id (the Ledger's resend rule in
  [1764](https://github.com/kamp-us/tea-fabrika/issues/1764)) is a good fit for `retryable()`.

### A bad deploy

Three different things hide behind this word.

- **The upload is refused.** Cloudflare loads the top-level code at deploy time and refuses a Worker that throws there
  (error 10021), or that spends over 1 s of CPU or over 128 MB in start-up
  ([Workers errors](https://developers.cloudflare.com/workers/observability/errors/),
  [Workers limits, startup time](https://developers.cloudflare.com/workers/platform/limits/#worker-startup-time)).
  The old version keeps serving. Nothing is down.
- **The constructor throws when it runs.** The docs' own example: "Any exceptions that are raised in your constructor
  will also set the .remote property to True", with `throw new Error("no good")` in the constructor
  ([Error handling](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/)). The first event
  to an object runs the constructor
  ([Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)). My reading: a
  constructor that throws on every start means no call to that class gets to a handler, so no method on that class can
  write. This is the case where the same-class door fails.
- **A handler's logic is wrong.** Same as the exception case above.
- **Rolling back.** You can roll back to any of the last 100 versions with `wrangler rollback` or the dashboard. You
  cannot roll back across a change to a Durable Object class's lifecycle (create, delete, rename, transfer)
  ([Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)).
- **How fast a bad deploy reaches objects.** By default an active object keeps its old code until it sleeps or up to 300
  seconds pass (`deferred`), then it resets and takes the new code. With `immediate` it resets at once. Only in-memory
  state is lost. Storage is not affected. "Cloudflare can reset an object before `max_delay` is reached"
  ([Code updates](https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/),
  [Troubleshooting](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/)). A `code_update_strategy`
  covers every class a Worker exports. A binding to a class in another Worker (`script_name`) follows that other
  Worker's own strategy (Code updates page, "Configure a code update strategy"). So one Worker deploys its classes as a
  unit, and a class in a second Worker deploys on its own.

### A call that hangs or loops

- **Hanging on a network wait.** "Awaiting async operations like `fetch()` ... opens the input gate, allowing other
  requests to interleave." Only storage operations close it
  ([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)).
  So a step stuck on a hung `fetch()` does not stop a second call from reaching the object. Also, pending I/O keeps the
  object from being evicted, for up to 15 minutes per operation
  ([Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)).
- **Stuck inside `blockConcurrencyWhile`.** It blocks every event not started by its own callback. There is a 30 second
  timeout, and "If this timeout is exceeded, the Durable Object will be reset". If its callback throws, "the object will
  be terminated and reset"
  ([State API](https://developers.cloudflare.com/durable-objects/api/state/)). An async `ctx.storage.transaction()`
  runs inside it
  ([research on 1779](https://github.com/kamp-us/tea-fabrika/blob/research/do-async-transaction/.kalfa/research/durable-object-async-transaction.md);
  [1779](https://github.com/kamp-us/tea-fabrika/issues/1779)). The Ledger's own transaction is synchronous (1764), so
  the Ledger does not use this path. A program that does, shares the object's gate with the append door.
- **Spinning on the CPU.** The object has one thread: "A single instance of a Durable Object cannot do more work than is
  possible on a single thread"
  ([Troubleshooting](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/)). The default
  limit is 30 seconds of CPU per call, up to 5 minutes by setting. Each new request tops it up. "If you consume more
  than 30 seconds of compute between incoming network requests, there is a heightened chance that the individual
  Durable Object is evicted and reset"
  ([Limits](https://developers.cloudflare.com/durable-objects/platform/limits/), footnote 4;
  [FAQ](https://developers.cloudflare.com/durable-objects/reference/faq/)). A 2021 changelog entry is stricter: "When a
  Durable Object exceeds its CPU time limit, the entire object will be discarded and recreated"
  ([Historical changelog](https://developers.cloudflare.com/workers/platform/changelog/historical-changelog/)). While it
  spins, other calls queue. If they wait too long they fail with an "overloaded" error ("Requests queued for too
  long") that must not be retried (Troubleshooting).
- Verdict: a direct append waits for the limit and the reset, then works. My reading: if a poison message makes the
  program spin again on every start, the object keeps resetting, and the append may land only between spins.

### Memory

- A Worker isolate has 128 MB. "When an isolate exceeds 128 MB, the Workers runtime lets in-flight requests complete and
  creates a new isolate for subsequent requests"
  ([Workers limits, memory](https://developers.cloudflare.com/workers/platform/limits/#memory)). The 2021 changelog says
  that when a DO's isolate exceeds its limit "all stubs pointing to the object will become invalidated" (Historical
  changelog).
- "A single isolate can host multiple Durable Objects of the same class, along with the surrounding Worker code, and
  they all share that isolate's memory"
  ([Metrics and analytics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/)).
  So a memory leak in one program's object can reset a Ledger object of the same class that sits in the same isolate.
  This is another reason to keep the Ledger a different class. Whether a different class shares the isolate: not
  confirmed.

### An alarm that keeps failing

- Alarms are retried "using exponential backoff starting at a 2 second delay from the first failure with up to 6
  retries". After that the alarm is not run again until the next `setAlarm`. "Only one instance of `alarm()` will ever
  run at a given time per Durable Object instance"
  ([Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)). An alarm handler runs under the same CPU
  limit (30 s by default), and has a 15 minute wall-clock limit
  ([Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).
- My reading: a failing alarm is one more event on the object. Calls from outside still reach fetch and RPC handlers
  and can write. The docs do not say this in a sentence, so it is a reading of how events are delivered.
  A spinning alarm is the CPU case above.
- The Ledger's `Waker` (1764) tells a waiting reader that a stream grew. The append must not fail because that wake
  fails. My reading: the ring must come after the commit and be allowed to fail. Today's code makes it a call to
  another object (`ring` in `ConnectionShape`, [`objects.ts`](https://github.com/kamp-us/tea-fabrika/blob/0676aed66520b04d1be22ad5c7714f9b1c62615c/next/packages/libfabrika/src/cloudflare/objects.ts)).

### The input gate held

The gate closes only while the object is running storage work or `blockConcurrencyWhile`
([Glossary](https://developers.cloudflare.com/durable-objects/reference/glossary/),
[Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)).
SQLite storage calls are synchronous, so they do not hold it across a wait. A storage call that runs too long resets the
object ("Durable Object storage operation exceeded timeout which caused object to be reset",
[Troubleshooting](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/)). In practice a held
gate is the `blockConcurrencyWhile` case above.

### A platform outage

- **Storage layer.** On 2025-06-12 a failure in a central data store behind Workers KV stopped many products.
  "SQLite-backed Durable Objects share the same underlying storage infrastructure as Workers KV. The average error rate
  during the incident window peaked at 22%, and dropped to 2% as services started to recover." Durable Objects on the
  old key-value backend were not hit
  ([Cloudflare service outage June 12, 2025](https://blog.cloudflare.com/cloudflare-service-outage-june-12-2025/)).
  Both the store and the program were affected, so a direct append had no store to write to.
- **A smaller one.** On 2025-02-06 an R2 outage raised the error rate of calls to Durable Objects in North America by
  0.09 percent for about 23 minutes, from reconnecting R2 clients
  ([Cloudflare incident on February 6, 2025](https://blog.cloudflare.com/cloudflare-incident-on-february-6-2025/)).
- **Moves and updates.** "A Durable Object may be replaced in the event of a network partition or a software update"
  ([Known issues](https://developers.cloudflare.com/durable-objects/platform/known-issues/)). In-flight HTTP and RPC
  calls that touch storage during a shutdown are stopped at once and return an error
  ([Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)). That is brief.
  The runtime retries calls that never reached the object (Automatic retries).
- Verdict: if the platform has the store, the direct append fails with everything else. The decision already says so.

### The account's spending cap

If a Durable Objects spending limit is reached, "New requests through a Durable Object stub" are rejected, "SQL queries:
Reads and writes are rejected", and new alarms are rejected. Stored data is kept
([Spending limits](https://developers.cloudflare.com/durable-objects/platform/spend-management/)). This stops the store
and the program together. It is a platform-side "down" that the app cannot see coming from its own code. My reading: it
is not rare for a small project, because the limit is the account's, not the app's.

## 2. Is a second door possible?

A DO has no address of its own. The docs describe two pieces of code: "a front-end Worker which routes incoming requests
from the Internet to a unique Durable Object, and the Durable Object itself"
([Access Durable Objects Storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/),
"SQL in Durable Objects vs D1"). So even a `--direct` write with "no gateway" needs a Worker route that holds the
binding. The question is how much that route and the object it calls share with the broken part. Four options:

| Door | What it shares with the program | What survives |
|---|---|---|
| Another method on the same class | The isolate, the constructor, the Worker's deploy, the single thread | A throw in another handler, a hung network wait, a failing alarm |
| Its own DO class in the same Worker | The Worker's deploy and its top-level code. My reading: possibly the isolate (not confirmed for different classes) | Everything above, plus a constructor that throws in the program's class, plus a spin in the program's object |
| Its own DO class in a second Worker | Nothing in code. Only the account and the platform | Everything above, plus a bad deploy of the app's Worker. A rollback of the app does not touch it. |
| The program as a facet or a Dynamic Worker under the Ledger's object | The object's thread and storage file | A throw in the program. A runaway program that has a `cpuMs` limit throws, instead of resetting its host |

Why each row says what it says:

- **Same class.** Everything on one instance runs on one thread, behind one constructor, in one isolate, from one deploy
  (sources in section 1). The storage is "private to its unique instance and cannot be accessed by other objects"
  ([SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)), so the code that
  appends has to be the class that owns the store. A second class cannot append to the first class's database.
  This is why the split has to be "the Ledger is its own class", not "an append helper elsewhere".
- **Own class, same Worker.** Separate constructors and separate objects. But one `code_update_strategy` covers every
  class a Worker exports, and the Worker deploys as one version (Code updates page). Top-level code is shared. My
  reading: a bad top-level change still takes both down.
- **Own class, own Worker.** A binding with `script_name` points at a class in another Worker, and that class's code
  updates follow "that other Worker's own `code_update_strategy`" (Code updates page). Rollback is per Worker
  ([Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)). The cost is two
  deploys and a contract between the two that must stay compatible when versions differ: "Ensure that API changes
  between your Workers and Durable Objects are forward and backward compatible"
  ([Known issues](https://developers.cloudflare.com/durable-objects/platform/known-issues/)). Today's Process/Project
  split shows the calls are workable. Today's code does not put them in two Workers.
- **Facet or Dynamic Worker.** A facet gets "its own isolated SQLite database, while your class acts as a supervisor".
  But "The supervisor's database and the facet's database are stored together as part of the same overall Durable Object"
  ([Durable Object Facets](https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/)). A Dynamic
  Worker can have custom limits, and "If a Dynamic Worker reaches either limit, it immediately throws an exception"
  ([Custom resource limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/)). My reading: this
  turns a program's overrun into an exception the host catches. Not confirmed: whether a facet that spins blocks the
  supervisor's thread.
- **What a second door must not do.** It must not wait on the program. Today's door calls the process for `isLive`,
  `deliver` and `admit`
  ([`runtime.ts` L330-L355](https://github.com/kamp-us/tea-fabrika/blob/0676aed66520b04d1be22ad5c7714f9b1c62615c/next/packages/libfabrika/src/cloudflare/runtime.ts#L330-L355)).
  A direct append that goes through those calls inherits the program's outage. My reading: the direct path has to be
  the plain function 0075 describes, with no call to a guarded service.

## 3. Can storage be reached from outside the object?

- **Not by another object.** "A Durable Object's attached storage is private to its unique instance and cannot be
  accessed by other objects"
  ([SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)).
- **Not by a plain client.** "By design, Durable Objects are accessed with Workers-only." D1 is the product with an HTTP
  API for outside access (Access Durable Objects Storage page). A laptop cannot open a connection to a DO.
- **But through Cloudflare's own API and dashboard, yes.** The API spec lists
  `POST /accounts/{account_id}/workers/durable_objects/namespaces/{id}/query/v2`, "Executes one or more SQL queries
  against a Durable Object", with the token permission "Workers Scripts Write". It also lists a GET export that
  "Downloads a SQLite-backed Durable Object's database as a zip"
  ([Cloudflare OpenAPI spec at `6468b01`](https://github.com/cloudflare/api-schemas/blob/6468b0158971220db1a76ee20f7b64e1826f030e/openapi.json)).
  The dashboard has Data Studio, "to view and write to an object's stored data". It needs at least `Editor` on the
  Worker. Its queries "send requests to your remote, deployed objects", are billed, and are audit logged
  ([Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/),
  [roles](https://developers.cloudflare.com/workers/authorization/durable-objects/)). Point-in-time restore exists, but
  only from inside the object (`onNextSessionRestoreBookmark`, SQLite storage API).
- **Why this is not the `--direct` door.**
  - It needs a Cloudflare account API token with Workers write rights. That is a platform admin credential. A `kalfa`
    command has a project client key (0072, 0075). Putting an account token on every device is a much bigger step.
  - It writes raw SQL. It would skip the Ledger's revision and position counters, the resend rule, admission, the
    signature check and the Waker. My reading: it is a repair tool for an operator, not an append door.
  - Whether it works when the class's constructor throws is not documented. Not confirmed. A spending cap blocks "SQL
    queries" (Spending limits), which my reading says includes these.

## 4. What this means for decision 0075

My lean, with the cost and my confidence:

- **Keep the decision. Add a rider.** The choice stands: a device Ledger needs a merge and pages nobody, and the app's
  Ledger is the one place the other readers look. The rider says what "down" covers (a failing program, a hung or spinning
  step, a failing alarm), and what it does not (a failing start-up of the object or the Worker, the platform, the spending
  cap). Cost: one paragraph and a diagnostic. Confidence 85%.
- **Build the Ledger's Cloudflare entry point as its own DO class** whose constructor and append method import no Program
  code, and which the program calls by RPC (1764 already speaks of "the stub other objects call"). Cost: the program's
  reads and writes cross an RPC, and a step can no longer share one transaction with its Ledger writes. Today's frozen
  code already lives with this. Confidence 75%, because the placement is still open (1765's gap about "the sleeping
  place").
- **Decide whether the Worker route for `--direct` lives in its own Worker.** That is the only way a bad deploy of the app
  does not take the door with it. Cost: two deploys and a version contract. Confidence 60%, because for a small project
  the extra Worker may cost more than a bad deploy does. The decision could also accept that a bad deploy is "down for
  `--direct` too" and say so.
- **Keep the append path free of the program.** No `isLive`, no `deliver`, no wait on a ring. A failed ring must not fail
  the append. Mark the append `retryable()`, since a resend by entry id is safe (1764).
- **Name the other cost.** The app's admission code (the presence line, Identity's key check) runs inside the Ledger
  object (1764, 0075). A bug there breaks the door. So the admission code is part of the door's deploy risk. This is
  worth a line in the Ledger's or Identity's build ticket.
- **A direct entry lands in the stream the sick program will read first when it recovers.** My reading: a direct entry that
  the program cannot handle could keep it down. Not sourced, and not checked.

## What this cannot tell us

- I ran nothing. I did not deploy a Durable Object that throws, spins, leaks or hangs, and I did not call the Query
  endpoint. Every behavior above is from documentation. A throwaway Worker with five failing classes would settle the
  "does a second call still reach a handler" column. Local `wrangler dev` would not be enough, because the reset rules
  belong to the platform.
- Not confirmed: whether any uncaught exception in an RPC method resets the object. The docs only say in-memory state is
  lost "if it crashes from an uncaught exception".
- Not confirmed: that an object spinning on the CPU always resets at the limit. The current docs say "heightened chance
  ... evicted and reset". The stricter statement ("discarded and recreated") is from a 2021 changelog entry, which may
  be out of date.
- Not confirmed: whether a Durable Object class other than the program's can share an isolate with it. I only found the
  statement for objects of the same class.
- Not confirmed: whether a facet or a Dynamic Worker that spins blocks its supervisor's thread. The docs do not say.
- Not confirmed: whether the "Query a Durable Object" endpoint or Data Studio works while the object's constructor
  throws. The docs do not say, and the endpoint has no page in the guides I read. I read only the API spec.
- I did not find where the design says one project object hosts both the Ledger and the program. I read only 1764, 1765,
  1706 and the tickets it lists for Program, plus 1810 for timers. Another ticket or note may say it.
- I did not check how likely each failure is for a real app, so "a bad deploy is the most likely total outage" is my
  guess, not a finding. Cloudflare publishes no ranking of causes.
- I checked two post-mortems and no status-page history. Other incidents may have hit Durable Objects differently.
- The cap and the limits in this note are Cloudflare's current values on 2026-11-21 (30 s CPU, 128 MB, 30 s
  `blockConcurrencyWhile`, 6 alarm retries, 5 minute deferral). They are settings the account or Cloudflare can change.

## Sources

Read on 2026-11-21.

- This repo's tickets: [1871](https://github.com/kamp-us/tea-fabrika/issues/1871),
  [1863 (resolution)](https://github.com/kamp-us/tea-fabrika/issues/1863#issuecomment-7074392640),
  [1862](https://github.com/kamp-us/tea-fabrika/issues/1862),
  [1764](https://github.com/kamp-us/tea-fabrika/issues/1764),
  [1765](https://github.com/kamp-us/tea-fabrika/issues/1765),
  [1706](https://github.com/kamp-us/tea-fabrika/issues/1706),
  [1779](https://github.com/kamp-us/tea-fabrika/issues/1779),
  [1810](https://github.com/kamp-us/tea-fabrika/issues/1810).
- This repo's records and code at
  [`0676aed`](https://github.com/kamp-us/tea-fabrika/tree/0676aed66520b04d1be22ad5c7714f9b1c62615c):
  `.kalfa/decisions/0072-a-write-command-goes-through-the-running-app.md`,
  `.kalfa/decisions/0075-a-direct-entry-is-a-case-of-identitys-sender.md`,
  `next/packages/libfabrika/src/cloudflare/objects.ts`, `.../cloudflare/runtime.ts`, `.../runtime/Execution.ts`,
  `.../runtime/Program.ts`. Research on async transactions:
  [`.kalfa/research/durable-object-async-transaction.md`](https://github.com/kamp-us/tea-fabrika/blob/research/do-async-transaction/.kalfa/research/durable-object-async-transaction.md)
  on branch `research/do-async-transaction`.
- Cloudflare Durable Objects docs:
  [Error handling](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/),
  [Automatic retries](https://developers.cloudflare.com/durable-objects/best-practices/automatic-retries/),
  [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/),
  [Access Durable Objects Storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/),
  [Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/),
  [State API](https://developers.cloudflare.com/durable-objects/api/state/),
  [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
  [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/),
  [Troubleshooting](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/),
  [Limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
  [FAQ](https://developers.cloudflare.com/durable-objects/reference/faq/),
  [Known issues](https://developers.cloudflare.com/durable-objects/platform/known-issues/),
  [Code updates](https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/),
  [Metrics and analytics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/),
  [Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/),
  [Spending limits](https://developers.cloudflare.com/durable-objects/platform/spend-management/),
  [Glossary](https://developers.cloudflare.com/durable-objects/reference/glossary/),
  [roles and permissions](https://developers.cloudflare.com/workers/authorization/durable-objects/).
- Cloudflare Workers docs:
  [Limits](https://developers.cloudflare.com/workers/platform/limits/),
  [Errors](https://developers.cloudflare.com/workers/observability/errors/),
  [Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/),
  [Historical changelog](https://developers.cloudflare.com/workers/platform/changelog/historical-changelog/).
- Cloudflare Dynamic Workers docs:
  [Durable Object Facets](https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/),
  [Custom resource limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/).
- Cloudflare API: [OpenAPI spec at `6468b01`](https://github.com/cloudflare/api-schemas/blob/6468b0158971220db1a76ee20f7b64e1826f030e/openapi.json)
  (`/accounts/{account_id}/workers/durable_objects/namespaces/{id}/query/v2` and `.../export`).
- Cloudflare post-mortems:
  [June 12, 2025](https://blog.cloudflare.com/cloudflare-service-outage-june-12-2025/),
  [February 6, 2025](https://blog.cloudflare.com/cloudflare-incident-on-february-6-2025/).
