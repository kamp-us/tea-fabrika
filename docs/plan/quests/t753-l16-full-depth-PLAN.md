Approved by the lead agent, builds 0122; body 635a36fa6321
Plancheck-Version: 3
# T753 L16 fits its 60 s bound at full depth, next/

```text
before: one Process or Project call
  -> ~25 spans, each committed in its own SQLite transaction as it ends
  -> `ended` + `isLive` asked of the Project at every check: 14-18 Project RPCs per counter step
after:
  -> the call's spans are collected, committed once in Effect.ensuring, before the call answers
     (the runner's own flush still ships them: it commits what its call has collected first)
  -> one lifecycle read per serial step (the permit-held section), dropped at the section's end
     and whenever this runner writes a lifecycle fact itself
```

## Doubt first

**About 65% sure** that parts A and B together bring L16 under the margin this plan asks for: at
most 25 s alone and 40 s with other files running beside it, both at full depth on the 4-core cloud
box. The lead's throwaway hacks measured an upper bound. Turning span persistence off saved 14 s,
and answering the lifecycle with no RPC saved 4 s. Part A does not turn persistence off. It removes
the per-span transaction, the sink machine's step per commit and its bookkeeping. Every row is
still built, encoded and inserted. So A's real saving lies somewhere between a few seconds and 14
s, and nobody has measured it.

The build settles this first. It lands A, measures L16 alone at full depth three times, then lands
B and measures again. If A plus B misses the margin, the build stops and returns its numbers and
one `--cpu-prof` profile of a single case to the lead. Any further cut needs a plan amendment, and
a new design call goes to the owner. Nothing else is tried silently. In particular, no retry, skip
or timeout change is allowed: those are hard limits, not fallbacks.

## Result and evidence

This plan covers next/ only. Product code changes in three files: `telemetry/Sink.ts`,
`cloudflare/runtime.ts` and `runtime/Runner.ts`, all under `next/packages/libfabrika/src/`.

The failure: scheduled run https://github.com/kamp-us/tea-fabrika/actions/runs/44110982551 , leg
`changed (9)`. The law `T753 L16 real first/later process steps, recovery and successors keep the
shared instance gate` (`next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts:1161`) timed
out at 60 s. Scheduled legs set `FABRIKA_TEST_DEPTH=full`, so the law runs its 100 cases
(`runsFor({ fast: 10, full: 100 })`). PR 1519 cut only the fast depth and one 50 ms poll
(`field/runs/2026-11-16-t753-l16-timeout-fix.json`). Since PR 1581, the required `related` job on
pull requests also runs this law at full depth. This is the third sighting, after
`field/findings/2026-11-14-t753-l16-times-out-on-a-loaded-ci-machine.json` and
`field/findings/2026-11-16-t753-l16-at-its-timeout-in-the-cloud-box.json`.

The lead measured the cause on the 4-core cloud box with Node 26.13.0, running the law alone at
full depth. It took 36.0 s on main 397e63f and 35.6 s on 0fe5ff4b, so PR 1427 is not the cause. The
time is CPU-bound (2% idle), flat per move, with no timer waits. That is about 0.36 s per case
alone and about 0.6 s on a loaded CI leg. A counter step costs about 36 ms and makes up about 63% of
the law.

Two costs dominate:

- The span sink commits each ended span in its own SQLite transaction. That is about 1,450 spans
  per case and about 30% of CPU (`telemetry/Sink.ts`, the tracer's `onEnd` calls `commit` once per
  span).
- The Runner's `ended` (`runtime/Runner.ts:553`, `manager.status`) and `manager.isLive` ask the
  Project 14 to 18 times per counter step. Each ask is a Project RPC with a ledger turn and a flush
  (`cloudflare/runtime.ts`, `wrapped` around `processStatus` and `processIsLive`). This is about
  11% of CPU.

The throwaway hacks measured:

| Hack | L16 alone |
|---|---|
| Base | 36.2 s |
| Lifecycle answered with no RPC | 32.2 s |
| Span persistence off | 22.1 s |
| Both | 20.9 s |

The coordinator session approved option C. Option C builds decided note 0122. Its part A follows
0122's "flushed before each call ends", and its part B builds no new design. Per 0036, the fix
removes the cause. Hard limits: the 60 s bound, L16, its assertions and `runsFor({ fast: 10, full:
100 })` stay exactly as they are. No retry, skip or timeout change is allowed. The CI selection and
workflow files the brief names are not touched.

**No decision blocks either part.** I searched for a decision that would require one span
transaction per span, or a lifecycle read per check, and found none. 0122 says "flushed before each
call ends". 0038, 0124, 0143 and 0202 govern names, metrics, refusals and retention, not when a row
commits. Searches: `records.ts find` with "span sink commit transaction per span", "span durable
before end returns", "sink batch flush before call ends", "runner lifecycle status read every check"
and "normal exit process status isLive runner", then `rg` over `.patterns/`, `docs/direction/` and
`docs/plan/` for "before `end` returns" and "no second copy". The only places that say per span are
descriptive text:

- `Sink.ts` lines 3 and 337
- the glossary's `SpanSink` row
- tier-1.md's P37 row
- `tier-1-detail.md:2357`, P37's law list
- `Sink.integration.test.ts`'s header

This plan amends the first three. The last two state p98, which stays true for every span that
ends outside a batch, and p98 keeps running unchanged.

## How others do it

- **Elm** ([commands and subscriptions](https://guide.elm-lang.org/effects/)). `update` works on the
  Model it is handed. The world's answers come back as the next message, never as re-queries
  inside one update. Part B is that rule for the runner: one step reads the lifecycle once, and a
  change arrives at the next step. Its own writes arrive at once, because the runner made them.
- **Erlang/OTP.** A `gen_server` handles one message at a time. `whereis/1` is a point read, and a
  process learns of another's exit by message, not by polling. Experiment 239 read OTP's
  [processes reference](https://www.erlang.org/doc/system/ref_man_processes.html): a receiver not
  trapping exits dies on any reason "other than the atom `normal`"
  (`experiments/239-supervision-vs-otp.md:70`). So in OTP, only a process itself ends with `normal`.
  That is B's premise. I could not fetch the `erlang:exit/2` page in this session: www.erlang.org
  does not resolve here. The quote above is experiment 239's reading.
- **OpenTelemetry's span processors.** The SDK's Simple processor hands each finished span to the
  exporter as it ends. The Batching processor queues them and exports in batches, with
  `ForceFlush` to drain. This is from memory of the trace SDK specification; opentelemetry.io does
  not resolve in this session, so it is unread here. Part A moves our sink from "simple" to "batch
  per call, forced at the end of the call". That is the shape experiment 259 measured as mode
  `fixed`: no timer, and a flush at the end of every wake.
- **Effect 4.1.3**, read installed (`node_modules/effect/src/Tracer.ts`, `Fiber.ts`). `Tracer.make`
  takes a `span(options)` that Effect calls synchronously on the running fiber.
  `Fiber.getCurrent()` (stable, since 4.0.0) returns that fiber, and `fiber.getRef(reference)`
  reads a `Context.Reference`. `Effect.ensuring` runs on success, failure and interruption.
- **In the repo, three places already accept "one commit per call, lost on a hard kill"**:
  - `SpanSink.batch` on `process.usage` (`cloudflare/runtime.ts:2450`, experiment 276: "The sink
    writes the batch in one transaction and holds the whole batch after a failed write").
  - The desktop brain (`desktop/BrainServiceManaged.ts:217` and `:235`): `sink.batch(observed)`,
    then `flush`.
  - 0122's Consequences: "A record made between wakes waits in memory and is lost if the object
    sleeps first."

Installed versions read from the lockfile: `effect` 4.1.3 (patched), `@demlik/tea` 0.27.0, vitest
5.0.5, fast-check 4.10.2. The builder reads `node_modules/effect/AGENTS.md` whole before writing
Effect code. No upstream package is patched.

## Settled rules and calls

- **The durability trade, named.** Today, a span that ended before a hard isolate kill survives the
  kill. After A, a hard kill in the middle of a call loses all of that call's spans. A clean failure
  or a fiber interruption loses nothing, because the commit is in `Effect.ensuring`. This meets
  0122 as written, and it matches the three places above. An object sleeps only between calls
  (0105), so a sleeping object still keeps every span. The pattern row in
  `.patterns/effect-differences-say-why.md:62` stays true.
- **Kept as they are:**
  - Refusal counting. A batched span with its own refusal tag, or a refusal-tagged ancestor, is
    counted and leaves no row, the rule `batch` applies today. Q9 and U3 hold it. Today's Project
    refusal laws already require no row for a refused call, so applying that rule to whole calls
    changes no row they see. 85% sure.
  - Full-disk hold and retry: a failed batch commit holds the whole batch, and the next `flush`
    fails `storage`.
  - Flush semantics: a call's flush still ships every span that call ended before the flush.
  - Measurements: one measurements row per span, as before.
- **A1: collect per batch through a reference on the fiber, never by swapping the tracer.** Call:
  80%. Today `batch` replaces the tracer, so spans inside it skip every wrapping tracer:
  `recordingLayer`'s `fab.settings` and `fab.build`, and the Runner's `stop` `safe` tracer.
  Wrapping whole calls with today's `batch` would drop those tags from every Process and Project
  span. The fix: the sink's own tracer reads the open batch at span creation through
  `Fiber.getCurrent()?.getRef(...)`, so every wrapper still applies. The other way, moving
  `recordingLayer`'s tags into span annotations, still needs a reference on the fiber for `flush`
  to find the open batch. So it saves nothing and touches the Project too.
- **A2: a batch belongs to its sink.** A span made by another sink's tracer inside this batch
  ignores it. A span that ends after its batch closed commits at once, as today. A forked fiber can
  inherit the reference and outlive the call. Call: 90%.
- **A3: where the batch goes.**
  - On the Process side, `attributed` in `processLogic` wraps each runner call. The runner's own
    `recording.flush` then runs inside the batch, so `flush` commits the open batch first.
  - On the Project side, `wrapped` becomes `complete(batched(effect))`, so the batch commits before
    `complete`'s flush.
  - `publish` (not wrapped, no flush today) gets `batched` without a flush.
  - `referee.wait` stays unbatched: a parked wait can last long, and its spans should land when
    they end.
  - Call: 85%. This covers every Process and Project call L16 drives: `info`, `connect`,
    `challenge`, `initialize`, `route`, the `process*` RPCs, `inbox`, `own`, `sign`, `commit`,
    `publish`, and the Process `open`, `msg`, `due`, `alarm`, `init`, `restart` and `mailed`.
- **B1: one read per serial step.** A serial step is one `permit.withPermit` body in the Runner: a
  call's turn, `place`, `settle`, `mailed`, and the ended-life section in `dispatch`. Within one
  step, `ended` and `isLive(process.id)` both answer from one `manager.status(process.name)`
  answer. `isLive(process.id)` is that answer's state being `live` with `process === process.id`.
  The ProcessTable keeps one current life per name (`processes/Process.ts:607-629`). Call: 80%. Law
  B2 checks the derived answer against a fresh `isLive` at every check point. The snapshot is
  seeded by reads the step already makes: `ensure`'s `status(initial.name)` and `step`'s and
  recovery's `status` reads for `at`. Those reads stay fresh, since `at` is the referee's clock and
  must not be cached.
- **B2: own writes drop the snapshot.** Any `manager` call that writes (`exit`, `down`, `start`,
  `dead`, `monitor`, `demonitor`, `ack`) drops it, through one wrapper on the `manager` that the
  runner and `coordinator` use. That includes the built-in exit's `manager.exit(normal)`, which
  runs in `dispatch`, outside any step, and may overlap another call's step. Dropping more often
  than needed only costs a read. A check outside a step (`dispatch`'s guard) reads fresh, as today.
  Call: 90%.
- **B3: the premise, as built.** The only product code that writes `exited {reason: normal}` is
  the Runner's built-in exit (`runtime/Runner.ts:2082`). The other writers of a process's exit
  write `shutdown` or a crash: `ChildrenLedger.ts:484` and recovery's `writing_exit`
  (`Runner.ts:840-842`). An outside `shutdown` mid-step is seen at the next step. Today the same
  staleness already exists within one `catchUp` (`alive` is read once there, `Runner.ts:1452`), and
  every write is checked again by the Project in its own turn (`isLive` in `inbox`, `own`, `ack`,
  `sign`). One gap is outside this task: the Project's public `exit` RPC takes any decoded reason,
  `normal` included, for any pid, and has no caller. It is a finding below, not a change here. Call:
  80%.
- **Lint, type or test.** All laws below are tests. They state behavior over generated call
  sequences: when rows land, which answer a check sees, who writes `normal`. No code shape holds
  them. A lint rule on `ExitReason.cases.normal` would miss a decoded reason, and a type change to
  `exit` would change the Project's RPC, which is a design call.
- **Settings (0069).** Neither batching nor the per-step read is a setting. Both are correctness
  choices that 0122 and the code's own serial steps decide, and nobody would pick another value.
- **What is lost if not recorded now:** the before and after timings and the per-case cost. They
  go into the PR and the build's field run row with the exact heads. Product data loses nothing,
  because every row is still written.
- **Placement (next/AGENTS.md).** All product changes are in libfabrika: a from-scratch client
  needs the sink and the runner. The laws sit in the module that owns each piece. B's suite is
  `runtime/RunnerLifecycleTest.ts`, run by `node/RunnerLifecycle.test.ts`, which owns the SQLite
  driver (0062).

## Existing tools

- `SpanSink.batch` in `next/packages/libfabrika/src/telemetry/Sink.ts`: reused and changed in
  place, not added. Searched `rg "\.batch\(" next`. Its users are `process.usage`
  (`cloudflare/runtime.ts:2450`), `desktop/BrainServiceManaged.ts` and the U3 and Q9 laws. All keep
  its signature.
- The open-batch reference inside `next/packages/libfabrika/src/telemetry/Sink.ts`: a new private
  `Context.Reference`, read with Effect's `Fiber.getCurrent` and `getRef`. Searched the installed
  `effect/src/Tracer.ts` and `effect/src/Fiber.ts` for a per-fiber span hook. The `Tracer.context`
  hook wraps every primitive, not span creation, so it does not fit. `TracerSpanAnnotations` adds
  attributes but cannot route an ended span.
- `batched` inside `next/packages/libfabrika/src/cloudflare/runtime.ts`: a one-line local beside
  `wrapped` and `attributed`, which it composes with. Searched the file for an existing
  batch-and-flush helper: `complete` only flushes.
- The per-step lifecycle read inside `next/packages/libfabrika/src/runtime/Runner.ts`: it replaces
  `ended` and adds a `manager` wrapper. Searched Runner.ts and `processes/ProcessManager.ts` for an
  existing cached status: `processLogic`'s `active` follows status answers but caches no state.
  Effect's `Effect.cached` caches for the life of the value, not one step, so it does not fit.

## Shape

Sketch only. The builder fits it to the code.

```ts
// telemetry/Sink.ts, inside make(): a batch is a list the sink's own tracer fills.
type Open = { readonly sink: symbol; readonly spans: Array<Done>; closed: boolean };
const Batch = Context.Reference<Open | null>("@kampus/libfabrika/telemetry/Sink.batch", {
  defaultValue: () => null,
});
const self = Symbol(options.object);

const tracer = Tracer.make({
  span: (init) => {
    const open = Fiber.getCurrent()?.getRef(Batch) ?? null;
    return new SinkSpan(init, (span, time, exit) =>
      open !== null && open.sink === self && !open.closed
        ? void open.spans.push({ span, time, exit }) // committed by the batch, or by an earlier flush
        : commitOne(span, time, exit), // today's per-span path, unchanged
    );
  },
});

const batch = <A, E, R>(work: Effect.Effect<A, E, R>) =>
  Effect.suspend(() => {
    const open: Open = { sink: self, spans: [], closed: false };
    return work.pipe(
      Effect.provideService(Batch, open),
      Effect.ensuring(Effect.sync(() => { open.closed = true; commitOpen(open); })),
    );
  });

// flush: first commitOpen(the fiber's open batch, if it is this sink's), then today's flush.
// commitOpen applies today's batch rule (own or ancestor refusal tag is counted, no row),
// lands the rest in one commit, and empties `open.spans`.
```

```ts
// cloudflare/runtime.ts
const batched = <A, E, R>(effect: Effect.Effect<A, E, R>) => SpanSink.use((sink) => sink.batch(effect));
const wrapped = <A, E>(effect: Effect.Effect<A, E>) =>
  complete(batched(effect)).pipe(projectStorage, Effect.provideContext(services)); // project side
const attributed = <A, E, R>(work: Effect.Effect<A, E, R>) =>
  Effect.suspend(() =>
    sink.batch(work).pipe(Effect.annotateSpans({ "fab.process": active }), Effect.provideContext(services)),
  ); // process side
```

```ts
// runtime/Runner.ts: one lifecycle read per serial step.
type Seen = { readonly status: Status } | null; // Status: manager.status's answer
let seen: Seen = null;
let inStep = false;
const read = Effect.suspend(() =>
  !inStep ? manager.status(process.name)
    : seen !== null ? Effect.succeed(seen.status)
    : Effect.tap(manager.status(process.name), (status) => Effect.sync(() => { seen = { status }; })),
);
const ended = Effect.map(read, ({ state }) =>
  state._tag === "ended" && state.process === process.id && state.reason._tag === "normal");
const live = Effect.map(read, ({ state }) => state._tag === "live" && state.process === process.id);
/** A permit-held section: the snapshot lives exactly as long as it does. */
const serial = <A, E, R>(work: Effect.Effect<A, E, R>) =>
  permit.withPermit(Effect.suspend(() => { inStep = true; seen = null; return work; }).pipe(
    Effect.ensuring(Effect.sync(() => { inStep = false; seen = null; }))));
// manager wrapper: status reads `learn` (seen = { status } when inStep); every write drops `seen`.
```

The Runner.ts comment "Read the lifecycle from its machine; the runner keeps no second copy"
becomes: "Read the lifecycle from its machine once per serial step. This runner's own lifecycle
writes drop that read, and nothing else writes this process's normal exit."

In `docs/direction/follows/otp.md`, row 17 ("Find a name's process") gets "`status(name)` reads its
current process (`processes/Process.ts:274-296`); a runner reads it at most once per serial step,
as a gen_server reads `whereis` once per message (`runtime/Runner.ts`)". It stays "same".

## One value through the code

1. L16 makes a `step` move. `w.project.route(client, "process.send", { m: { type: "inc" } })`
   enters the Project. `wrapped` opens a Project batch, and the gateway's spans go into its list.
2. The Project calls the Process object's `msg`. On the Process side, `attributed` opens a Process
   batch. The runner's `call` takes the permit through `serial`: `inStep` is set and `seen` is
   empty.
3. `ensure` reads `status("counter:1")` once. The wrapper stores it in `seen`. `msg`'s `ended`,
   `accept`'s `ended`, `catchUp`'s `ended` and `setAlarm`'s `ended` and `live` all answer from
   `seen`. That is 0 more Project RPCs where there were about 6 to 9. `step` reads `status` for its
   `at` and refreshes `seen`.
4. The permit is released and `seen` is dropped. The runner calls `recording.flush`. `flush` first
   commits the Process batch's spans so far in one transaction, then ships them. This is the same
   set today's flush ships.
5. The Process call returns. `ensuring` commits any span that ended after the flush, if there is
   one. The Project's route ends, its batch commits once, and `complete` flushes.
6. L16's next `open` sees `{ count }`. Its assertions are unchanged. The case's work is the same;
   only the commit count fell, from about 1,450 per case to about one per call.

## Laws

| Law | Kind | Generator | Plant |
|---|---|---|---|
| A1: spans that end inside a batch are not in `unsent` or `measurements` until the batch ends. At its end, on success, failure or interruption, all of them are, in one transaction, with one measurements row each. Spans that end outside a batch still land before `end` returns. Runs: 100 runs full, 10 runs fast. | test | fc.array: span trees (name, depth 1 to 4, exit success, failure or interrupt), each inside or outside a batch | Commit per span inside the batch: red on "none before the end". Drop `ensuring` on failure: red on the failure case. |
| A2: a `flush` inside a batch ships every span the batch ended before the flush. Spans that end after it land at the batch's end and ship at the next flush. Runs: 100 runs full, 10 runs fast. | test | fc.array: interleavings of span ends and one flush inside a batch | Flush skips the open batch: the shipped count is short, red. |
| A3: a batched span keeps every wrapping tracer's attributes. Under `recordingLayer` that means `fab.settings` and `fab.build`; in the sink test, a generic wrapper's tag. Runs: 100 runs full, 10 runs fast. | test | fc.array: span names and wrapper tags | Today's tracer-swapping `batch`: tags missing, red. This law starts red. |
| A4: a batch belongs to its sink, and a span that ends after its batch closed commits at once. Two sinks in one fiber, and a forked fiber that outlives the batch. Runs: 100 runs full, 10 runs fast. | test | fc.array: which sink makes each span, and whether it ends before or after the batch closes | Ignore the batch's sink: the span lands in the wrong database, red. Drop the `closed` check: the late span never lands, red. |
| A5: a batch commit that meets a full disk holds the whole batch and tries it again at the next commit. The next `flush` fails `storage` before sending anything. No span is dropped. Runs: 100 runs full, 10 runs fast. | test | fc.array: batches, with a `PRAGMA max_page_count` cut at a generated point | Drop the held batch on failure: rows are lost, red. |
| A6: every Process call (`msg`, `open`, `due`, `alarm`, `init`, `restart`, `mailed`) and every wrapped Project call commits its spans in at most one sink transaction before it answers. Its spans are shipped by its own flush, as before, and carry `fab.settings` and `fab.build`. Runs: 40 runs full, 5 runs fast. | test | fc.array: fc.constantFrom move kinds, 4 to 12 calls | Remove the batch from `attributed`: many commits, red. Remove it from `wrapped`: red. Batch outside the runner's flush with no flush commit: not shipped, red. |
| B1: within a run of generated runner calls, each serial step makes at most one lifecycle read beyond the `status` reads it makes for `at`. Runs: 100 runs full, 10 runs fast. | test | fc.array: fc.constantFrom msg, due, open, exit Cmd, crash, restart, start_child, stop_child | Restore the per-check reads: the count is above one, red. |
| B2: at every `ended` and `isLive` check inside a step, the snapshot's answer equals a fresh read of the ProcessManager. That includes after the program's built-in exit (even when it overlaps another call's step), after crash recovery, a successor and a parent's `stop_child` between steps. Runs: 100 runs full, 10 runs fast. | test | fc.array: the B1 moves plus outside `shutdown` writes placed between steps | Make the exit not drop the snapshot: red after an exit. Keep the snapshot past a step's end: red after an outside shutdown. Derive `live` without the process id: red after a successor. |
| B3: a process's `exited {reason: normal}` fact is written only by its own runner's built-in exit, over every product path that can end it: `stop_child`, a person's restart, crash recovery, `down` and dead letters. The Project's public `exit` RPC is excluded and named (finding below). Runs: 100 runs full, 10 runs fast. | test | fc.array: the B1 moves, with children and restarts | Make `ChildrenLedger` stop write `normal`: red. Make a manual restart's `writing_exit` write `normal`: red. |
| L16 itself: unchanged and green at full depth in the time this plan asks, with its 100 runs and its 60 s bound. | test | pinned: the existing L16 law and seed, byte for byte | none. Its time, not a plant, is the proof here. |

The laws for A go in `next/packages/libfabrika/src/telemetry/SinkBatch.test.ts` (A1 to A5, on
`:memory:` SQLite) and `next/packages/libfabrika/src/cloudflare/call-spans.laws.test.ts` (A6, on
the same in-memory platform handles `entry-flows.laws.test.ts` uses). B's laws go in
`next/packages/libfabrika/src/runtime/RunnerLifecycleTest.ts`, run by
`next/packages/libfabrika/src/node/RunnerLifecycle.test.ts` on in-memory SQLite. Every new law runs
on a stand-in, so none is `.integration.` (0581), and each runs on every pull request. No law here
is host-only: none needs launchd, Electron, a real process signal or a real Worker.

These existing laws must stay green unchanged. Each is listed with owner `tests` in the files
table, because they are exam files this plan names, and none of them changes.

## Files

| File | Change | Owner | Product lines expected |
|---|---|---|---|
| `next/packages/libfabrika/src/telemetry/SinkBatch.test.ts` | A1 to A5 (new) | tests | tests |
| `next/packages/libfabrika/src/cloudflare/call-spans.laws.test.ts` | A6 (new) | tests | tests |
| `next/packages/libfabrika/src/runtime/RunnerLifecycleTest.ts` | B1 to B3 suite (new) | tests | tests |
| `next/packages/libfabrika/src/node/RunnerLifecycle.test.ts` | runs the B suite on in-memory SQLite (new) | tests | tests |
| `next/packages/libfabrika/src/telemetry/Sink.integration.test.ts` | no change: p98 and p99 stay green | tests | tests |
| `next/packages/libfabrika/src/node/IsolateUsage.integration.test.ts` | no change: U3 stays green | tests | tests |
| `next/packages/libfabrika/src/node/QuotaRefusal.test.ts` | no change: Q9 stays green | tests | tests |
| `next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts` | no change: L16 and the whole file, refusal laws included, stay green; L16 is timed | tests | tests |
| `next/apps/fabrika/src/door-spans.test.ts` | no change: stays green | tests | tests |
| `next/packages/libfabrika/src/cloudflare/connection.test.ts` | no change: stays green | tests | tests |
| `next/packages/libfabrika/src/cloudflare/entry-flows.laws.test.ts` | no change: stays green; runs beside L16 as load | tests | tests |
| `next/packages/libfabrika/src/cloudflare/readers.laws.test.ts` | no change: runs beside L16 as load | tests | tests |
| `next/packages/libfabrika/src/cloudflare/reload.laws.test.ts` | no change: runs beside L16 as load | tests | tests |
| `next/packages/libfabrika/src/node/StartChildExit.integration.test.ts` | no change: the built-in exit stays green | tests | tests |
| `next/packages/libfabrika/src/node/Children.integration.test.ts` | no change: stop_child stays green | tests | tests |
| `next/packages/libfabrika/src/node/ProgramMailRuntime.integration.test.ts` | no change: stays green | tests | tests |
| `next/packages/libfabrika/src/runtime/Runner.integration.test.ts` | no change: stays green | tests | tests |
| `next/packages/libfabrika/src/runtime/RunnerSupervision.integration.test.ts` | no change: stays green | tests | tests |
| `next/apps/fabrika/src/worker-usage.integration.test.ts` | no change: stays green, remote proof | tests | tests |
| `next/packages/libfabrika/src/telemetry/Sink.ts` | batch collects through the open-batch reference, keeps the tracer chain; flush commits the open batch first; doc lines 3 and 337 say "before the call ends" for batched spans | build | 60 |
| `next/packages/libfabrika/src/cloudflare/runtime.ts` | `batched`; `wrapped` and `attributed` batch; `publish` batched | build | 15 |
| `next/packages/libfabrika/src/runtime/Runner.ts` | `serial`, the per-step read, the `manager` wrapper, the amended comment | build | 70 |
| `docs/direction/follows/otp.md` | row 17's wording | build | docs |
| `.glossary/TERMS.md` | the `SpanSink` row: a batched span lands before its call ends | build | docs |
| `docs/plan/tier-1.md` | one dated "Changed" sentence on P37's row | build | docs |
| `field/findings/2026-11-18-t753-l16-times-out-at-full-depth.json` | the owed `flaky_test` row, from `## Findings` | lead | docs |
| `field/findings/2026-11-18-project-exit-rpc-accepts-normal-unused.json` | the second row, from `## Findings` | lead | docs |

The layer rules need no new import: `cloudflare/` already imports `telemetry/`, and `runtime/`
does not import telemetry. If `pnpm lint:layers` asks for a root entry for a new test file, the
tests step adds it.

## Validation

This plan step ran no test, install, lint or typecheck.

The test writer runs `pnpm format`, `pnpm lint` and the four new files narrow, each plant once,
then restores it. A3, A6, B1 and B2 start red on main. A1, A2, A4, A5 and B3 may start green on
main, and their plants prove that they bite.

The build runs `pnpm format`, `pnpm lint` and the new files, plus the in-memory laws in the list
above, under `nice -n 15` and `--maxWorkers=3`. The guard decides which listed files may run
locally. A file it refuses gets remote proof.

**The timing proof** is owed in the PR, measured on the same 4-core cloud box and session, with
Node 26.13.0. "Before" is `origin/main` a6761bce, the worktree's base. "After" is the branch head.
Each of these runs is done five times:

- **Alone:** `FABRIKA_TEST_DEPTH=full nice -n 15 pnpm exec vitest run
  next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts -t "T753 L16" --maxWorkers=1
  --reporter=verbose`. The law's own milliseconds are read from the verbose line.
- **Under CI-like load:** the same command, started together with a second process,
  `FABRIKA_TEST_DEPTH=full nice -n 15 pnpm exec vitest run
  next/packages/libfabrika/src/cloudflare/entry-flows.laws.test.ts
  next/packages/libfabrika/src/cloudflare/readers.laws.test.ts
  next/packages/libfabrika/src/cloudflare/reload.laws.test.ts --maxWorkers=2`. That is three
  workers in all, the machine cap.
- The PR reports min, median and max for each of the four cells, plus the `related` job's L16 time
  on the PR's own CI run, which runs L16 at full depth (PR 1581).

**The bar:**

- After, alone: at most 25 s.
- After, loaded: at most 40 s.
- The CI `related` time: at most 45 s.

**Why five runs and this bar:**

- L16 is CPU-bound, flat per move and waits on no timer, by the lead's measurement. So run-to-run
  spread is load noise, not a tail of waits. Five runs show that spread, and 0036 asks for the
  count in the PR.
- 0.6 s against 0.36 s per case puts a loaded CI leg at about 1.67 times the alone time. 25 s
  alone then gives about 42 s on a leg. That is a 30% margin under 60 s, against the 0% margin
  today.
- 40 s loaded is 1.5 times under the bound.

If any cell misses the bar, the build stops and reports, as "Doubt first" says.

The lead runs `--changed origin/main` once at the end and one `pnpm typecheck`. It also runs the
listed `.integration.` files that the local guard refuses through an eligible remote branch-proof
run, and keeps the run's URL and exact head.

Review must reject any change to L16's lines, its run counts, the 60 s limit, or the CI files the
brief names.

## Records

The build writes its field run row with the 20 timing numbers, the CI time, the heads and the
plant outcomes, the same day. Raw logs stay out of git.

## What this cannot tell us

- A's real saving, until it runs (see "Doubt first").
- Whether a hard isolate kill in the middle of a call ever happens often enough to matter. No law
  here kills a real isolate. The loss is accepted by 0122, not measured.
- B's premise holds for the code as built. A future product path that writes `normal` for another
  process would break it, and B3 catches only the paths it lists. The Project's public `exit` RPC
  is the known gap, filed below.
- The cloud's own CPU, since every number here is from the cloud box and CI legs, not workerd.

## Size

1. One pull request, about 145 product lines in three files, about 450 test lines in four new
   files, and three docs lines. Tests take about 1.5 agent hours and the build about 2.5 agent
   hours, the timing proof included. Confidence 70%: the per-step snapshot touches many checks in
   a 2,945-line file.

Comparable step rows in `field/runs.jsonl` cost $0.30 to $2.70 for runs of about 5 minutes. These
steps are many times longer, so the figure below is a budget estimate scaled by time, not a
measured spend. It assumes tests, build, one review and one likely send-back.

Estimate: 4 steps, $60

## Amendment 1, 2026-11-18, by the lead

The build met the doubt this plan opened with, and stopped as "Doubt first" asks. These are the lead's
calls on what came back. None is a new design call, and none loosens a law.

**Measured.** L16 at full depth, the 4-core cloud box, Node 26.13.0, one worker, five runs each:

| Cell | Runs (s) | Median |
|---|---|---|
| Before, alone (main's L16 code, head d54d299ba) | 37.2, 38.4, 39.5, 37.3, 38.3 | 38.3 |
| Before, alone (a6761bce) | 38.3, 37.9, 37.9, 38.1, 38.5 | 38.1 |
| Before, loaded (a6761bce) | 39.7, 40.7, 39.3, 38.0, 38.3 | 39.3 |
| After A only, alone (the build) | 37.3, 36.0, 34.0, 34.7 | 35.4 |
| After A and B, alone (9c6598413) | 28.2, 29.6, 29.2, 28.2, 28.8 | 28.8 |
| After A and B, loaded (9c6598413) | 30.6, 28.7, 28.4, 30.1, 30.8 | 30.1 |

"Loaded" is the law started beside a second vitest process running `entry-flows.laws.test.ts`,
`readers.laws.test.ts` and `reload.laws.test.ts` at full depth with two workers, three workers in all,
as "Validation" says. After the fix, L16 is about 25% faster alone and 23% faster loaded.

**The guess that was wrong.** "Doubt first" put A's saving between a few seconds and 14 s. It saved about
3 s: the per-span transaction was not the cost, the per-row work is (a validated `SpanRow.make`, a JSON
encode and two inserts, about 47 microseconds per span). B saved about 8 s, twice the hack's 4 s.

**The bar.** The 25 s alone bar was this plan's own margin guess, set before anything was measured. It is
replaced by the two cells that decide the bound: loaded at most 40 s (met, 30.1 s median, max 30.8 s) and
the PR's own `related` job at most 45 s. The `related` job runs only once the PR is out of draft, so that
time is checked after the review, before the PR is armed. If it is over 45 s, the PR goes back for a
further cut (the per-row sink work, the Quotas SQL, the ledger fold), which is a new amendment.

**The build's deviations, accepted.**

- `batch` also installs a collecting tracer that wraps the running one. The reference-only shape lost
  every span of a batch run with no sink tracer installed, which broke U3 and the desktop brain. A span
  the running tracer already made through this sink is kept as it is, so the wrappers' tags stay. A3
  holds that.
- The step's snapshot is dropped on the runner's `start`, `exit` and `down` writes only. `ack`, `dead`,
  `monitor` and `demonitor` write lines the process table's `status` does not read.
- The snapshot belongs to the fiber that holds the permit (a `Context.Reference`), with an epoch that a
  write moves, so an answer a write overtook is not kept. A read outside a step is always fresh.
- `ensure` reads `status` fresh while `supervision` is null, and from the step's snapshot after that.
  The review checks that `at` still comes from a fresh read where the referee needs one.
- `publish` gets a batch that commits nothing today: its spans are not made by the sink's tracer.

**Sent back.** B2's three snapshot plants stay green on the build, so B2 does not bite. The tests step
strengthens it, so that each named plant turns it red, before the review.

## Ready tracker ticket

Owed under 0036, the same day. This cloud session has no tracker tool, so the lead files it and
names the ticket in the PR and in the finding's rating row.

Title: next/: T753 L16 times out at full depth; spans commit once per call and the Runner reads
its lifecycle once per step

Body:

Scheduled run https://github.com/kamp-us/tea-fabrika/actions/runs/44110982551, leg changed (9):
`T753 L16 real first/later process steps, recovery and successors keep the shared instance gate`
(next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts:1161) timed out at 60 s with its
full 100 cases. The PR `related` job runs it at full depth too since PR 1581. Third sighting.

Cause, measured alone at full depth on a 4-core box: 36 s, CPU-bound, no timer waits. The span sink
commits each ended span in its own SQLite transaction, about 1,450 per case and about 30% of CPU.
The Runner asks the Project for its lifecycle 14 to 18 times per counter step, about 11%.

Fix (plan docs/plan/quests/t753-l16-full-depth-PLAN.md, building 0122): spans of one Process or
Project call commit together before the call ends, and the Runner reads its lifecycle once per
serial step. L16, its assertions, its run counts and the 60 s bound stay exactly as they are. Proof:
five runs each, alone and loaded, before and after, plus the PR's CI time.

## Open questions

None.

A new design call, if the measurement misses the bar, goes back to the lead and the owner.

## Findings

```json
{"_tag":"finding","id":"2026-11-18-t753-l16-times-out-at-full-depth","date":"2026-11-18","by":"plan","model":"claude-opus-5-5","rule":"flaky_test","location":{"path":"next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts","line":1161},"says":"In next/, the law 'T753 L16 real first/later process steps, recovery and successors keep the shared instance gate' times out at its 60 s limit at full depth (100 cases) on a scheduled leg, and the required related job on pull requests runs it at full depth since PR 1581; third sighting after 2026-11-14-t753-l16-times-out-on-a-loaded-ci-machine and 2026-11-16-t753-l16-at-its-timeout-in-the-cloud-box.","proof":"Scheduled run https://github.com/kamp-us/tea-fabrika/actions/runs/44110982551 leg changed (9): the law timed out at 60 s. The lead's local measurement, law alone at full depth on a 4-core box with Node 26.13.0: 36.0 s on main 397e63f and 35.6 s on 0fe5ff4b, CPU-bound with 2% idle, about 0.36 s per case alone against about 0.6 s per case on a loaded CI leg.","cost":"Any pull request whose related job reaches this file, and every scheduled run, can go red for no fault of the change; a rerun hides it and 0036 forbids that.","head":"a6761bce1d846d856d7260b2e8c8338d86a16448","ticket":null,"pr":null}
{"_tag":"finding","id":"2026-11-18-project-exit-rpc-accepts-normal-unused","date":"2026-11-18","by":"plan","model":"claude-opus-5-5","rule":"dead_code","location":{"path":"next/apps/fabrika/src/brain.ts","line":124},"says":"In next/, the Project object's public exit RPC (brain.ts exit, ProjectClient.exit in libfabrika cloudflare/platform.ts:163) has no caller in product code and writes any decoded exit reason, normal included, for any pid, while OTP ignores a normal exit signal from another process and the Runner's lifecycle read relies on only a process's own exit Cmd writing normal.","proof":"rg -n '\\bp\\.exit\\(|project\\.exit\\(|stub\\.exit\\(' next/packages next/apps --glob '!*test*' prints only brain.ts:126 (the method itself), cloudflare/runtime.ts:1536 (its implementation) and platform.ts:165 (the stub wrapper); the Runner's own exits go through processExit. cloudflare/runtime.ts:1530-1538 decodes the reason with decodeExitReason, which accepts normal.","cost":"A future caller could end another process with normal mid-step, which the Runner's per-step lifecycle read (plan t753-l16-full-depth) would see only at the next step; unused surface to keep in step with the process table's rules.","head":"a6761bce1d846d856d7260b2e8c8338d86a16448","ticket":null,"pr":null}
```
