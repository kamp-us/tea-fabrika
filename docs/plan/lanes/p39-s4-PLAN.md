Approved by the lead agent, builds 0102, 0105, 0171, 0061, 0045, 0178, 0536; body bdd9a6909d64
Plancheck-Version: 3

```ts
// next/, sketch. The hands client: one tea machine that asks for work, runs it once, and reports.
//   jobs.list {}            -> { jobs: [{ id: "P/7/0", process: P }], rev: 12 }   // open jobs for my key
//   jobs.take { process: P } -> assigned { job }       // slice 2's call, unchanged
//   journal: prepared -> jobs.started -> journal: executing -> Commands.execute -> journal: result
//   jobs.finish { result }  -> ok                       // then journal: acknowledged, list again
//   nothing open            -> jobs.wait { after: 12 } -> parked, until a request names my key
```

# P39 slice 4a: the hands client, as a tea machine, against the real gateway in memory

ticket: to be filed

Writer: the plan step for P39 slice 4. Version: `next/` only. Today's version is not touched.

Base read: branch `fabrikalfa/p39-s3` at `c2b8345a6` (slice 3, pull request
https://github.com/kamp-us/tea-fabrika/pull/1309, reviewed and not merged yet). This slice stacks
on it. Every code line cited here is read on that branch.

Builds [0102](../../../.decisions/0102-hands-is-a-grant-rank-and-work-is-taken.md),
[0105](../../../.decisions/0105-a-durable-object-never-stays-awake-on-its-own.md),
[0171](../../../.decisions/0171-make-it-work-then-better-then-secure.md),
[0061](../../../.decisions/0061-resources-are-acquired-in-a-scope.md),
[0045](../../../.decisions/0045-test-steps-run-in-containers.md),
[0178](../../../.decisions/0178-host-only-laws-run-first.md),
[0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md) and
[brain, hands, window, agent](../../direction/brain-hands-window-agent.md). Row P39 of
[`docs/plan/tier-1.md`](../tier-1.md).

## The doubt first

**A hands key cannot find its work today.** `jobs.take` needs a `process` (slice 2,
`gateway/Jobs.ts:12`), and a hands key may call nothing but `jobs.*`
(`gateway/Gateway.ts:1180`), so it can neither read which process asked nor park a `ledger.wait`.
The five-slice plan assumed "the existing read/wait pattern"; slice 2 closed it to hands, rightly.

My lean adds two hands-only calls and one index stream: `jobs.list` (the open jobs whose target is
the caller's own key) and `jobs.wait` (park until a new request names that key), over a stream
`target:<fingerprint>` that `Jobs.request` writes in the same transaction as the job. This is
Kubernetes' list-then-watch: the kubelet lists the pods bound to its node, then watches from that
version. **Confidence: 75%.** The doubt: it is new wire, and it names a new stream. What would
settle it: the lead's read against 0102, whose text says "`jobs.take` is the only way work reaches a
machine". `jobs.list` gives pointers (id and process), never the command, so take stays the only
door. The other ways weighed are in [How others do it](#how-others-do-it).

Nobody sees or presses anything in this part. It is still built as a draft pull request that
waits for the owner's look, and is not merged on the lead's lean: the call above is under 80% and
adds wire beside a sentence of 0102.

## What lands now, and what waits

**Part 4a, this pull request, built now as a draft for the owner's look:**

- The hands client is a tea machine in libfabrika's `client/` module, beside the window client. It
  steps the existing link and hello machines (`transport/Link.ts`, `transport/Handshake.ts`) as
  children, the way the window does, and adds its own work state.
- It lists, waits, takes, starts, executes and finishes one job at a time. A local journal saves
  each step before the next, so a crash never runs a command twice.
- The command is run through a new `Commands` service. In this part only a fake layer exists, in
  tests. No real process is spawned.
- The journal is a contract over Effect's own `KeyValueStore`, so memory, a file and a browser's
  `localStorage` are each one existing layer.
- `jobs.list`, `jobs.wait` and the `target:` stream, with their laws, in `jobs/` and `gateway/`.
- One end-to-end law: the real client start, over the in-memory socket the window laws use, against
  the real `Gateway` and `Jobs` on `node:sqlite` at `:memory:`. Fast, on the merge line. No port,
  no socket, no container, nothing on a person's Mac.

**Part 4b, later, waits on the owner:**

- The real `Commands` layer: `git --version` through Effect's `ChildProcess`, with the output limit
  that gives `failed output_limit`.
- The launcher `next/apps/fabrika/hands.ts`: the hands key on disk, the instance address from
  `instance.port`, the journal file's place as a declared setting.
- How the hands start on a Mac: started by the app, as the brain is (0280), or a launchd entry of
  its own. A launchd entry waits for the owner.
- A person approves the hands key in a window: a person presses it.
- The host-only run of the real command on the owner's Mac, after the lead's read and his yes
  (0178).

Slice 5, a real program asking for a real `git --version`, stays after 4b and needs P40.

## How others do it

Fetched on 2026-11-15, unless marked.

- **GitHub Actions self-hosted runner.** It "connect[s] to GitHub to receive job assignments" over
  outbound HTTPS on port 443, and a job with no online runner stays queued, failing after 24 hours
  ([self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)).
  Kept: the hands dial out and are never dialed. Left: no 24-hour timeout, since 0102 says a job
  whose host is lost waits for a person.
- **Buildkite agent.** `ping-mode` "selects available protocols for dispatching work to this
  agent", preferring streaming and falling back to polling, and `spawn`, how many jobs run at once,
  defaults to `1` ([agent configuration](https://buildkite.com/docs/agent/v3/configuration)). Kept:
  one job at a time, and a parked wait in place of a poll. A count would be a setting only when a
  second job at once is built.
- **Kubernetes kubelet.** "Watch is a verb that is used to track changes to an object ... as a
  stream", and lists are consistent so clients can "track, and synchronize"
  ([API concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/)). The kubelet lists
  the pods bound to its node, then watches from the list's version. That is `jobs.list` then
  `jobs.wait { after: rev }`.
- **Temporal workers** poll for tasks and must make activities safe to retry
  ([activities](https://docs.temporal.io/activities), from the five-slice plan's read, not fetched
  now). Kept the split: a retry repeats delivery, and never the command.
- **Elm.** The client is one parent `update` that steps its children by hand
  ([Elm first](../../direction/elm-first.md)); every effect is a Cmd, and every answer comes back as
  one Msg.
- **OTP `gen_statem`.** State plus event gives the next state and actions
  ([gen_statem](https://www.erlang.org/doc/system/statem.html), cited from slice 3's plan, not
  fetched now). The work state below is that table.

**The other ways weighed for finding work:**

| Way | What it costs | Why not |
|---|---|---|
| Give the hands a process id at start | Nothing on the wire | A process is a generation: it changes on every restart, so the hands go deaf |
| Make `process` optional on `jobs.take` | One optional field | Two programs asking at once would answer `ambiguous`, and 0102's sketch names `process` |
| Poll `jobs.take` per known process | No new call | Still needs the process list, and every poll wakes two Durable Objects (0105's cost) |
| Let hands call `ledger.read` and `ledger.wait` | No new call | Opens every stream to a key 0102 says reads no person-only view |

## The shape

Installed versions read in the lockfile: Effect 4.1.2, `@demlik/tea` 0.25.0, fast-check 4.10.2,
vitest 5.0.5. Effect's `persistence/KeyValueStore` in 4.1.2 has `layerMemory`, `layerFileSystem`,
`layerStorage` and `toSchemaStore` (read in its `.d.ts`). `process/ChildProcess` is there for 4b.

### Where it lives

The libfabrika test (`next/AGENTS.md`): a from-scratch client would have to write the hands loop
again, so it is libfabrika. "Client" means any of hands, a window or an agent at the door
(glossary), so the files go in `client/`, layer 7. The module's row in `layer-rules.json` gains
`next-jobs`, for the `Command`, `Result` and `Job` schemas. That is a downward import, and it is
the only permission that widens.

| Piece | Lives in | Layer |
|---|---|---|
| The hands machine | `client/HandsMachine.ts` | 7 |
| Its start: socket, journal and command Cmds | `client/HandsStart.ts` | 7 |
| The dial Sub both starts share | `client/internal/dial.ts`, moved out of `client/WindowStart.ts` | 7 |
| The journal contract | `client/Journal.ts` | 7 |
| The journal over `KeyValueStore` | `client/JournalStore.ts` | 7 |
| The command contract | `client/Commands.ts` | 7 |
| The `target:` stream, `forTarget` | `jobs/Jobs.ts`, `jobs/JobsLedger.ts` | 4 |
| `jobs.list` and `jobs.wait` | `gateway/Jobs.ts`, `gateway/Gateway.ts` | 7 |

Nothing in `client/` imports `node:`, a socket of its own, or a file: a browser tab could run it,
as 0102 requires ("A browser tab can be a `hands` client").

### The wire, two new calls

```ts
// gateway/Jobs.ts, sketch. Both need a live `hands` grant and a hello, as the other jobs calls do.
const List = Schema.Struct({});                      // strict: any field is bad_input
const Waited = Schema.Struct({ after: Rev });        // strict: no stream, no key, no target

const Listed = Schema.Struct({
  /** Open jobs whose target is the caller's key: requested, assigned or started. Pointers only. */
  jobs: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, process: ProcessId })),
  /** The `target:<key>` stream's last rev, the cursor a `jobs.wait` starts after. */
  rev: Rev,
});
// jobs.list {}            -> ok Listed
// jobs.wait { after }     -> ok { rev } now, or parked on `target:<key>` until an append past `after`
```

The stream comes from the authenticated identity, never from the params (0102, 0140). `jobs.wait`
goes through the same parked-wait path `ledger.wait` uses (`gateway/Gateway.ts:1597-1607`), outside
the write turn, so the referee rings it when an append lands. A window or agent key calling either
gets `not_allowed`, as the other jobs calls do (`gateway/Jobs.ts:42`).

```ts
// jobs/Jobs.ts, sketch of the additions.
/** The stream that indexes the jobs one hands key is asked for, one line per accepted request. */
export const targetStream = (key: string): string => `target:${key}`;
// JobsShape gains:
readonly forTarget: (key: string) => Effect.Effect<{ jobs: ReadonlyArray<Job>; rev: Rev }, JobsError>;
```

`JobsLedger.request` appends `{ id, process }` to `target:<request.target>` in the same
transaction as the `requested` event, only when the call is accepted. A repeat or a refusal writes
nothing there. `forTarget` reads that one stream and each job it names, never every `job:` stream,
so it does not grow ticket 1030's scan.

Jobs saved before this slice have no line in `target:`. They exist only on dev instances since
slice 3, so nothing is migrated: a person who wants one run asks again. Said once in the PR.

### The journal

```ts
// client/Journal.ts, sketch. The contract only (0095).
export const Entry = Schema.TaggedUnion({
  /** Taken; nothing ran. Safe to start. */
  prepared: { execution: Schema.NonEmptyString, at: Schema.String },
  /** Saved before the command starts. Found on reopen without a result: `unknown`. */
  executing: { execution: Schema.NonEmptyString, at: Schema.String },
  /** The command's result, saved before it is sent. */
  result: { execution: Schema.NonEmptyString, result: Result, at: Schema.String },
  /** The brain answered ok to this finish. */
  acknowledged: { execution: Schema.NonEmptyString, result: Result, rev: Rev, at: Schema.String },
});

export class JournalError extends Schema.TaggedError<JournalError>()("JournalError", {
  reason: Schema.Literals(["storage", "bad_entry"]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class Journal extends Context.Service<Journal, {
  readonly read: (job: string) => Effect.Effect<typeof Entry.Type | null, JournalError>;
  readonly write: (job: string, entry: typeof Entry.Type) => Effect.Effect<void, JournalError>;
}>()("@kampus/libfabrika/client/Journal") {}
```

`JournalStore.layer` builds it on `KeyValueStore.toSchemaStore(store, Entry)`, one key per job id.
`at` is the client's own clock (`sentAt`'s meaning, 0212). The journal needs no list of its keys:
the brain is the index, and the client reads the entry of the job the brain just assigned it.

### The command

```ts
// client/Commands.ts, sketch. The contract only. 4a has no live layer; 4b adds the Node one.
export class Commands extends Context.Service<Commands, {
  /** What this host can do, sent as the hello's `has`. A fact about the layer, never a setting. */
  readonly has: ReadonlyArray<string>;
  /** Runs one closed command once. A failure to start is a `failed` Result, never an error. */
  readonly execute: (command: Command) => Effect.Effect<Result>;
}>()("@kampus/libfabrika/client/Commands") {}
```

The name follows 0029's plural service names. It is not `Runner` (the program runner) and not
`Executor` (`jobs/Job.ts`'s record of who took a job).

### The machine

```ts
// client/HandsMachine.ts, sketch. One machine (0046); it steps Link and Handshake by hand.
const Ptr = Schema.Struct({ id: Schema.NonEmptyString, process: ProcessId });
const Exec = { ...Ptr.fields, execution: Schema.NonEmptyString };

const Work = Schema.TaggedUnion({
  /** The link is not online, and no local work is running. */
  offline: {},
  listing: { call: CallId },
  /** Nothing open: a `jobs.wait` after `rev` is out, parked. */
  watching: { rev: Rev, call: CallId },
  taking: { ...Ptr.fields, call: CallId },
  /** Assigned to me: the journal entry for this job is being read. */
  recalling: { ...Exec, state: Schema.Literals(["assigned", "started"]) },
  /** A journal write is out. Its entry's `_tag` says which step follows it. */
  saving: { ...Exec, entry: Entry },
  starting: { ...Exec, call: CallId },
  /** `executing` is saved; `Commands.execute` is out. The one place the command runs. */
  executing: Exec,
  reporting: { ...Exec, result: Result, call: CallId, tries: Count },
  /** The brain refused the finish for good (revoked, conflict): the result stays in the journal. */
  holding: { ...Exec, result: Result, reason: Schema.String },
});

const Model = Schema.Struct({ link: Link, handshake: Handshake, work: Work, sent: Count });
```

The recovery table, the heart of the machine. `recalling` reads the journal, then:

| Brain says | Journal says | Next |
|---|---|---|
| `assigned` | nothing, or `prepared` with this execution | save `prepared`, then `jobs.started` |
| `started` | `prepared` with this execution | save `executing`, then execute |
| `started` | `executing` with this execution | result `unknown interrupted`, save it, then finish |
| `started` | `result` or `acknowledged` with this execution | finish with the saved result |
| `started` | nothing, or another execution | result `unknown interrupted`: the journal was lost, the command may have run |

`unknown` is the five-slice plan's rule: a crash just before the spawn may also read as unknown,
and that is better than saying a command did not run when it may have.

The update, in plain conditionals on `_tag`:

```ts
//   link becomes online, work offline              -> listing (jobs.list)
//   link drops, work executing or saving           -> unchanged: local work goes on
//   link drops, any other work                     -> offline
//   listing  + ok { jobs: [], rev }                -> watching rev (jobs.wait { after: rev })
//   listing  + ok { jobs: [p, ...] }               -> taking p (jobs.take { process: p.process })
//   watching + ok { rev }                          -> listing
//   taking   + assigned { job } for my key         -> recalling, with the job's state and execution
//   taking   + idle | refused                      -> listing after backoff
//   recalling + journal entry                      -> the table above
//   saving   + written                             -> starting | executing | reporting, by entry
//   starting + ok                                  -> saving executing
//   executing + result                             -> saving result
//   reporting + ok rev                             -> saving acknowledged, then listing
//   reporting + refused unavailable                -> reporting again after backoff(tries), same result
//   reporting + refused other                      -> holding
//   a journal write fails                          -> unchanged, retried after backoff; never executes
//   any answer for a call id that is not the live one -> unchanged
```

Backoff reuses `transport/Link.ts`'s `backoff`, capped at its `CAP`: no new number. Each call id
is `j<dial>.<n>`, the way `Handshake` names its ids, so an answer from an old dial never matches.
`ProcessId` and `Rev` come from the shared names beside `Id.ts`.

The start (`client/HandsStart.ts`) interprets `write`, `hello`, `knock`, `ping`, `journal_read`,
`journal_write` and `execute`, and stamps each call's `sentAt` with its own clock. Its hello sends
`has: commands.has`, `platform: "headless"` and `build`, which the jobs route requires
(`gateway/Jobs.ts:46`). Its knock sends `as: "hands"` (`gateway/Gateway.ts:701`). The dial Sub is
the one the window uses, moved to `client/internal/dial.ts`; `WindowStart.ts` keeps its behavior
and its laws.

## One value traced through

Made up for this example: process `P`, job `P/7/0`, hands key `SHA256:H`, the fake `Commands` that
answers `exited { code: 0, version: "git version 2.47.0" }`.

1. Slice 3's runner asks; `Jobs.request` commits `requested` on `job:P/7/0` and `{ id: "P/7/0",
   process: P }` on `target:SHA256:H` at rev 3, in one transaction.
2. The client was already `watching` after rev 2. The referee rings the parked `jobs.wait`, which
   answers `{ rev: 3 }`. Work goes to `listing`.
3. `jobs.list` answers `{ jobs: [{ id: "P/7/0", process: P }], rev: 3 }`. Work goes to `taking`.
4. `jobs.take { process: P }` answers `assigned` with execution `e1`. Work goes to `recalling`.
   The journal has nothing; it saves `prepared e1`, then `jobs.started` answers ok.
5. It saves `executing e1`, then calls `execute`. **The process dies here**, before a result.
6. On restart the link comes online: `listing` shows `P/7/0` again, `take` repeats and answers the
   same `e1`, state `started`. The journal says `executing e1` and no result.
7. The table gives `unknown interrupted`. It is saved as `result`, then `jobs.finish` sends it.
   The gateway wakes `check:1` (slice 3's W1), then answers ok. The journal saves `acknowledged`.
8. `execute` ran once. The program folds `hands_ok` with `unknown`.

Without the crash in step 5, step 6 is the fake's `exited` result, saved as `result`, then sent. If
the finish answer is lost, the next `reporting` sends the same result and the brain answers
`repeated` (slice 1's L5). If the wake failed, the brain answers `refused unavailable`, and the
client sends the same finish again after backoff (slice 3's contract).

## Laws

Seed **119120** for every generated law. Each walk reads the state it reached and picks its next
move from what is possible there: a job really requested, a call really out, a cut at a real
journal or call boundary (0093). Shrinking replays the shorter walk. Each walk requires its
transition at least once, so an empty walk cannot pass. The oracle keeps its own count of `execute`
calls and of results sent; it never calls the product's `update`.

Cuts are a test layer around `Journal` and `Commands` that fails or stops before or after it
delegates, and the in-memory socket's `drop`. The fake `Commands` lives in a test-support file and
is the only `Commands` layer in 4a. Each plant runs once, is recorded and is undone; no plant is
committed.

| Law | Kind | Generator | Plant that must fail | Law lives in | Runs |
|---|---|---|---|---|---|
| H1: the client calls `execute` only in `executing`, only after `jobs.started` answered ok and `executing` was saved, and at most once per job across every restart | test | @demlik/tea/pbt.arbGuidedSequence: Msgs picked from the current state on the real `init` and `update`, with answers, drops and journal results; 100 runs | Call `execute` before the `executing` write lands | `client/HandsMachine.laws.test.ts` | fast |
| H2: after a cut at any journal or call boundary and a restart, the job ends `finished` with the fake's result when the journal held one, and with `unknown interrupted` when it held `executing` and no result | test | fc.commands: from the current state, cut before or after each journal write, each call and `execute`, then restart; 100 runs | Read `executing` without a result as nothing, so the command runs again | `client/HandsStart.laws.test.ts` | fast |
| H3: a finish refused `unavailable` is sent again with the same result until ok; any other refusal holds the result and sends nothing more; a second, different result is never sent for one job | test | fc.commands: answer each finish ok, lost, `unavailable`, `not_allowed` or `conflict`, from the current state; 60 runs | Count `unavailable` as done and save `acknowledged` | `client/HandsMachine.laws.test.ts` | fast |
| H4: the client runs only work assigned to its own key: an `idle`, a refusal, another key's assignment or an answer to a stale call id changes nothing it would execute | test | @demlik/tea/pbt.arbGuidedSequence: take answers for this key, another key, idle and refused, with stale call ids; 100 runs | Execute the job in any `assigned` answer, whoever it names | `client/HandsMachine.laws.test.ts` | fast |
| H5: a dropped link during `executing` or `saving` lets the local work finish; on reconnect the client lists, takes and reports it, and runs nothing again | test | fc.commands: drop and reopen the socket at every state, with execution in flight; 60 runs | Move every work state to `offline` on a drop, losing the result | `client/HandsStart.laws.test.ts` | fast |
| G1: `jobs.list` answers exactly the open jobs whose target is the caller's key; an accepted request writes one `target:` line in its own transaction and a repeat or refusal writes none; a window or agent key is refused | test | fc.array: requests for two hands keys, repeats, conflicts, finishes and collects, with list calls by each key and by a window key; 100 runs | Append the `target:` line on a repeated request too | `gateway/JobsTest.ts` and `jobs/JobsTest.ts` | file twin, as these suites run today |
| G2: `jobs.wait { after }` answers `{ rev }` when the key's stream is past `after`, else parks and is rung by the next request for that key only; params with any other field are `bad_input` | test | fc.commands: wait, request for this key, request for another key, or wait with an extra `stream` or `key` field; 60 runs | Take the stream name from the params | `gateway/JobsTest.ts` | file twin, as the suite runs today |
| E1: a requested job ends `finished` with the fake's result through the real client start, the in-memory socket, the real `Gateway` and `Jobs` on `:memory:`, with sockets dropped and answers lost at chosen points; `execute` runs once | test | fc.commands: request, drop the socket, lose an answer, restart the client, or let it run, from the current state; 60 runs | Leave `jobs.list` answering an empty list | `next/apps/fabrika/src/hands-client.test.ts` | fast |
| S1: [secrets] the hands key's private bytes never appear in a frame the client writes, a journal entry, a ledger row or a span | test | fc.record: generated key pairs and job flows; scan every written frame, every journal value and every `job:` and `target:` row; 60 runs | Put the private key's armored text in the hello's `build` | `next/apps/fabrika/src/hands-client.test.ts` | fast |
| B1: `client/` files import no `node:` module and no platform | lint | lint | Import `node:fs` in `client/JournalStore.ts` | existing `fabrika/no-node-imports` | lint |
| K1: `client/` imports `jobs/` and `transport/`, never `gateway/` or `ledger/` | lint | lint | Import `gateway/Jobs.ts` in `client/HandsMachine.ts` | existing `pnpm lint:layers` | lint |
| T1: `Journal` and `Commands` speak their own errors and shared names only, never `KeyValueStore`'s or `PlatformError` | type | type | Put `PlatformError` in `Journal.write`'s error channel | `client/Hands.types.test.ts` | typecheck |
| W1: the window start behaves as before the dial moved: its laws run unchanged | test | scenario: the existing `client/WindowStart.laws.test.ts`, untouched, passes on the moved dial | Drop the jitter in the moved `dialWait` | `client/WindowStart.laws.test.ts` | fast |

No law here needs a port, a real socket, a real process, workerd or a container. No law is
host-only, and nothing runs on a person's Mac. The existing job, gateway and window laws stay as
they are; this slice adds cases and narrows none.

Part 4b's laws, named now so they are not lost: the real `git --version` result and its exit code,
the output limit, scope closure releasing the child (L16 of the five-slice plan), a SIGKILL of the
client leaving no child behind (a container boundary, not a finalizer), and the host-only run on
the owner's Mac.

## Files

Product lines count additions and deletions.

| File | Change | Product lines expected | Owner |
|---|---|---|---|
| `next/packages/libfabrika/src/client/HandsMachine.ts` | New: the hands machine, its Model, Msgs and update | 320 | build |
| `next/packages/libfabrika/src/client/HandsStart.ts` | New: the start, its Cmd interpreters | 170 | build |
| `next/packages/libfabrika/src/client/internal/dial.ts` | New: the dial Sub, moved out of the window start | 90 | build |
| `next/packages/libfabrika/src/client/WindowStart.ts` | Uses the moved dial | 90 | build |
| `next/packages/libfabrika/src/client/Journal.ts` | New: the journal contract | 50 | build |
| `next/packages/libfabrika/src/client/JournalStore.ts` | New: the journal over `KeyValueStore` | 45 | build |
| `next/packages/libfabrika/src/client/Commands.ts` | New: the command contract | 25 | build |
| `next/packages/libfabrika/src/jobs/Jobs.ts` | `targetStream`, `forTarget` | 15 | build |
| `next/packages/libfabrika/src/jobs/JobsLedger.ts` | The `target:` line in the request transaction; `forTarget` | 40 | build |
| `next/packages/libfabrika/src/gateway/Jobs.ts` | `jobs.list` | 30 | build |
| `next/packages/libfabrika/src/gateway/Gateway.ts` | `jobs.wait` on the parked path, outside the write turn | 35 | build |
| `next/packages/libfabrika/package.json` | Exports for the new `client/` files, if the map needs lines | 4 | build |
| `layer-rules.json` | `next-client` imports gain `next-jobs` | tests | tests |
| `next/apps/fabrika/src/exam/layers.test.ts` | Read-only boundary check; no change unless the new row needs one | tests | tests |
| `next/packages/libfabrika/src/client/Commands.test-support.ts` | New: the fake `Commands`, with its cut points | tests | tests |
| `next/packages/libfabrika/src/client/HandsMachine.laws.test.ts` | New: H1, H3, H4 | tests | tests |
| `next/packages/libfabrika/src/client/HandsStart.laws.test.ts` | New: H2, H5 | tests | tests |
| `next/packages/libfabrika/src/client/Hands.types.test.ts` | New: T1 | tests | tests |
| `next/packages/libfabrika/src/client/WindowStart.laws.test.ts` | Read-only: W1, must pass unchanged | 0 | tests |
| `next/packages/libfabrika/src/jobs/JobsTest.ts` | Extend: G1's stream half | tests | tests |
| `next/packages/libfabrika/src/jobs/Jobs.types.test.ts` | Extend: `forTarget` in the contract | tests | tests |
| `next/packages/libfabrika/src/gateway/JobsTest.ts` | Extend: G1's list half, G2 | tests | tests |
| `next/apps/fabrika/src/hands-client.test.ts` | New: E1, S1 | tests | tests |
| `.glossary/TERMS.md` | Rows: hands client, `jobs.list`, `jobs.wait`, `target:` stream, journal (client), `Commands` | docs | lead |
| `docs/direction/follows/kubernetes.md` | Row: list then watch, as the kubelet does; differs: no lease, no reassignment | docs | lead |
| `docs/plan/tier-1.md` | P39: slice 4a landed, 4b waits on the owner; row stays open | docs | lead |
| `docs/plan/README.md` | Where we are now | docs | lead |

### Its edges

- **Must not touch:** `jobs.take`, `jobs.started`, `jobs.finish` and `jobs.read` as they behave
  now, `JobAccess.select`, `runtime/`, `transport/Wire.ts`, `access/`, today's version, and any
  program under `next/programs/`.
- **What 4b needs from this slice:** a `Commands` contract to fill, a `Journal` over any
  `KeyValueStore`, and a start that takes a `ClientKey`. 4b adds layers and a launcher, and changes
  no line of the machine.
- **What slice 5 needs:** a program that returns `hands`, and P40's pack path.

## Is this a setting?

| Choice | Setting? | Answer and why |
|---|---|---|
| How many jobs run at once | No | One is the only behavior built. Buildkite's `spawn` is a setting because it has more than one; ours becomes one when a second is built |
| Retry spacing after a refusal or lost answer | No new one | `transport/Link.ts`'s `backoff` and `CAP`, already the client's numbers |
| What the hands `has` | No | A fact about the `Commands` layer in use, as 0102 says `has` is "can" |
| Where the journal lives | Yes, in 4b | A person-scoped path, declared once (0069, 0086). 4a has no file, only layers |
| The brain's address | No new one | 4b reads the existing `instance.port` |
| Which hands key is asked | Already one | Slice 3's `hands.target`; this slice reads nothing of it |
| The `target:` stream's name | No | A protocol fact, not a choice between behaviors |
| A timeout on a parked wait | No | None is built. The link's ping keeps the socket honest; a timeout would be a new choice, and a setting, in the slice that adds it |

## Records

Facts that exist only when they happen, kept now:

| Row | Where | Keeps | Why |
|---|---|---|---|
| The `target:` line (new) | `target:<fingerprint>`, written with `requested` | `id`, `process`, the writer facts of the request (`by`, `for`, `sentAt`, `seen`, `parent`, `traceId`, `build`), `rev`, `arrivedAt` | When each job was put before which key, in order: what a later lease or reassignment needs, and it cannot be rebuilt once keys change |
| `taken`, `started`, `finished` (slice 1's events, now written by a real client) | `job:<cmd-id>` | The executor key, connection, `has`, hands build, execution id, the hands' `sentAt` and `seen` | Which machine, which build and what it claimed it could do, at each step |
| Journal entries (new, local) | the hands' own `KeyValueStore` | Each step's execution id, the result, the brain's `rev` on ack, the client's own clock `at` | The only record of "the command was about to start" on the machine that ran it; it decides `unknown` |

Would a later piece need a field these rows can never get? Checked against 4b, slice 5 and Tier
4's leases: a lease needs "when was it put before a key", which the `target:` line keeps. One fact
is not kept in 4a: the command's raw output. It does not exist until 4b runs a real command, and
then it goes to deletable P37 content, never into a lifecycle row.

No secret is in any row: a fingerprint is public, and S1 checks the private key stays out. Each
step records its run and plant results in `field/` the same day.

## Validation

A boxed step runs its own narrow vitest paths under the repo's caps, its plants once each, and
`pnpm lint`. The lead runs the changed-tests run once, one type check, the leak check, ownership
and `loosening.sh`, and reads the moved dial against the window's old one. CI runs the file twins
on the schedule. No container and no host step is needed for 4a.

This plan step ran no tests and changed no file but this plan.

## Size

One pull request for 4a: about 915 product lines, 1,500 test lines and 40 doc lines, about 2.5 to
3.5 agent hours. Confidence: 65%. The doubt: the hands machine's recovery table and its laws, and
how much of the window's dial code moves cleanly.

1. **The hands client, in memory, against the real gateway: 915 lines.** The machine, its start,
   the journal and command contracts, the moved dial, `jobs.list`, `jobs.wait` and the `target:`
   stream, with laws H1 to H5, G1, G2, E1, S1, B1, K1, T1 and W1.
2. **Part 4b, the real command and how the hands start, waits on the owner: about 300 lines.** Not
   planned in full here; it gets its own plan once the open question below is answered.

Budget basis: slice 3's plan read `field/runs.jsonl` list-price medians of $1.14 for tests steps,
$1.24 for build steps and $1.17 for reviews, with maxima from $3.69 to $9.41. This slice is bigger
than slice 3 in new code, so allow tests, build, review, one fix round, one recheck and one more
tests round, each well above the median.

Estimate: 6 steps, $20

## What this cannot tell us

- Whether a real `git --version` comes back right, with its exit code. 4a runs no process; 4b does.
- Whether a file journal survives a power cut. `KeyValueStore.layerFileSystem` writes a file; I did
  not read whether it writes to a temp name and renames. 4b checks it before it trusts it.
- Whether the parked `jobs.wait` behaves on the real Connection Durable Object across hibernation.
  E1 runs the gateway in Node; the real Worker path is slice 5's.
- What a program that returns two `hands` Cmds at once gets: slice 2's take answers `ambiguous`
  for two open jobs of one process, and the client then never takes either. See Findings.
- Whether one job at a time is fast enough. The first real numbers come with 4b.
- Spans from the client itself go nowhere yet: the hands have no span sink at the brain.

## Calls the lead should look at twice

1. **`jobs.list`, `jobs.wait` and the `target:` stream.** See [the doubt first](#the-doubt-first).
   Confidence: 75%.
2. **The client lives in `client/`, and that row imports `jobs/`.** A new `hands/` module would keep
   `client/` free of jobs, but would copy the dial code, since modules on one layer cannot share.
   Confidence: 80%.
3. **The dial Sub moves to `client/internal/dial.ts`.** It touches working window code; W1 keeps it
   honest. The other way is a second copy of about 90 lines. Confidence: 80%.
4. **`started` with no journal entry reports `unknown`.** It may call a command that never ran
   unknown. That is the five-slice plan's rule, and 0102 says an uncertain job is recovered by
   hand. Confidence: 90%.
5. **The journal is Effect's `KeyValueStore`, not our ledger or SQLite.** It has a memory, a file
   and a browser layer already (0040). Confidence: 85%.
6. **A finish refused for any reason but `unavailable` is held, not retried.** A revoked key keeps
   its result locally (the five-slice plan's edge case) and a person sees it. Confidence: 85%.
7. **The service is `Commands`, the module word "journal" is new.** Neither clashes with a word
   in the glossary today. Confidence: 75%.

## Open questions

1. **Part 4b only, nothing in 4a waits on it: how do the hands start on a Mac?** Lean: the app
   starts them as a child service beside the brain, the way 0280 starts the brain, so a person still
   opens only the app; 70%. The other way is a launchd entry of its own, which survives the app
   quitting, and a launchd entry waits for the owner. What settles it: the owner's pick, then 4b's
   host-only run after the lead's read and his yes (0178).

Searched first: `.decisions/` (0102, 0105, 0171, 0178, 0045, 0061, 0280, 0322, 0333, 0424, 0526,
0536), `docs/direction/brain-hands-window-agent.md`, `.glossary/TERMS.md` (hands, hands key,
hands Cmd, `hands.target`, client, job, dispatched), `docs/plan/tier-1.md` rows P38 to P40, and
slice 3's plan. P38's settings are on main and 4a needs none of them; P40 is slice 5's. Who may ask
the hands is slice 3's call on 0171, unchanged here.

## Findings

```json
{"_tag": "finding", "id": "2026-11-15-jobs-take-ambiguous-wedges", "date": "2026-11-15", "by": "plan", "model": "claude-opus-5-5", "rule": "bug", "location": {"path": "next/packages/libfabrika/src/gateway/JobAccess.ts", "line": 49}, "says": "In next/, when one process has two open jobs for the same hands key, jobs.take answers refused ambiguous every time, and no other call assigns a job, so neither job ever runs.", "proof": "gateway/JobAccess.ts:49 returns Result.fail(\"ambiguous\") whenever more than one candidate matches the process and key; gateway/Jobs.ts:87 turns that into refused { reason: \"ambiguous\" } and returns before any jobs.take; jobs.take is the only call that writes a taken event (gateway/Jobs.ts, jobs/JobsLedger.ts take). A program update that returns two hands Cmds makes two open jobs for one process (runtime/Runner.ts saves each Cmd under its own id).", "cost": "A program that asks the hands twice in one step waits forever with no error; the hands client in P39 slice 4 can only hold and wait.", "head": "c2b8345a6cfc07ad6680f0d7673fd72568d219ae", "ticket": null, "pr": "kamp-us/tea-fabrika#1309"}
```
