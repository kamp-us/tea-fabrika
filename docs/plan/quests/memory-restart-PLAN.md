Approved by the lead agent, builds 0069, 0045, 0178, 0536; body 614440414c07
Plancheck-Version: 3

# Plan: a memory restart of the local runtime ends the old workerd in bounded time, and no control call dials it, in next/

Ticket: to be confirmed by the lead (title: "A memory restart of the local runtime hangs while a
WebSocket is open, so the control connection refuses every call, in next/"). One `tracker_query`
for "memory restart" did not show it. This plan is about `next/` only. Code read on main at
`72553f8da`; Alchemy read in the installed `@alchemy.run/cloudflare-runtime@2.0.0-beta.85`, with our
patch `patches/@alchemy.run__cloudflare-runtime@2.0.0-beta.85.patch` applied.

```ts
// The whole idea, a sketch. The brain sends SIGTERM once, waits a grace, then SIGKILL.
// Its life state says `replacing` from the first signal, so the sampler stops and no call dials.
online   --memory >= limit-->  replacing (SIGTERM sent, facts: replacing)
replacing --exit within grace--> exited --> waiting --> online(new pid, same ports)
replacing --grace runs out----> replacing (SIGKILL sent, fact: killed) --exit--> exited --> ...
// A control call: while a replacement is pending it waits for the new listener,
// at most the grace plus 30 s, then fails as `offline`. It never dials the old port.
```

## Doubts first

The owner is away, so each call below is taken at its lean. Two are under 80%:

- **A call during a replace waits; it does not fail at once (75%).** OTP's answer to a call on a
  restarting child is an error (`noproc`), and the caller retries. Waiting is kinder here: the
  replace takes about the grace plus 200 ms, and every caller of the control door (the app's
  bindings, the brain's own outbox flush, the span flush) would otherwise each need a retry. The
  doubt: a caller that holds a turn while it waits could stall up to the grace plus 30 s. What would
  settle it: the scheduled run of L7 with many callers, and a week of `replacing` facts.
- **This fix will not make L8 green on `fabrikalfa/tezgah-new` by itself (70% that it stays red).**
  After the fix, the memory replace there ends in about 5 s and the runtime comes back, but every
  WebSocket drops on a restart (experiment 93; `docs/direction/a-local-first-sync-engine.md`, line
  354). L8's suite holds one door WebSocket for the whole walk, so it will likely see that socket
  close in place of ECONNREFUSED. Whether 512 MB for about ten shells is a real need or a leak is
  the measuring ticket below. A higher limit is not this fix.

## How others do it

Every supervisor bounds a stop the same way: ask, wait a grace, then kill.

- **Erlang/OTP supervisor.** A child spec's `shutdown` is an integer timeout or `brutal_kill`: the
  supervisor sends `exit(Child, shutdown)`, and "if no exit signal is received within the specified
  number of milliseconds, the child process is unconditionally terminated using
  `exit_signal(Child,kill)`". The default for a worker is 5000 ms
  (https://www.erlang.org/doc/apps/stdlib/supervisor.html,
  https://www.erlang.org/doc/system/sup_princ.html, both read 2026-11-15). And while it waits,
  `which_children/1` reports the child as the atom `restarting`, not as a live pid: a restarting
  child is not up.
- **systemd.** `TimeoutStopSec=`: the service gets SIGTERM, and "if it does not terminate in the
  specified time, it will be forcibly terminated by SIGKILL". The default is
  `DefaultTimeoutStopSec=`, 90 s
  (https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html and
  `systemd-system.conf(5)`, read 2026-11-15).
- **Kubernetes.** The kubelet sends SIGTERM, waits `terminationGracePeriodSeconds` (default 30 s),
  then sends SIGKILL. While the pod shuts down, its endpoints are `ready: false`, "so load balancers
  will not use it for regular traffic"
  (https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/, read 2026-11-15). That is the
  same rule as OTP's `restarting`: a stopping process gets no new calls.
- **Elm.** The life state is already a tea machine (`DevLife.ts`), so the new state is one more
  case of its Model and two more Msgs, folded by the driver as today.
- **workerd itself drains on SIGTERM.** Its `src/workerd/server/AGENTS.md` says the server
  "drains on SIGTERM", and `src/workerd/server/server/entry.rs` installs the SIGTERM handler as "the
  signal to drain gracefully" (read on workerd's main branch with `gh search code`, not on the
  1.20261026.1 tag we run). A drain waits for open connections, and a WebSocket stays open until a
  side closes it. That fits the proof: the control and debug ports closed, the public port still
  listening, one WebSocket open, no exit.
- **Alchemy, read in the installed code.** `dist/core/node/Runtime.mjs` restarts on any exit it is
  told of: `Queue.take(exits)` (line 193), the `exit` lifecycle event, a 250 ms backoff, then
  `startProcess(ports)` on the pinned ports. `dist/core/node/workerd/Workerd.mjs` reports an exit
  when the child's `close` event fires (line 329), and its own finalizer kills with SIGKILL (line
  341). Alchemy never sends SIGTERM. So a SIGKILL from outside is seen as an ordinary exit and
  restarted on the same ports. **No patch and no upstream issue are needed (85%):** there is no
  Alchemy gap the brain cannot close from outside, and workerd's drain is its design, not a bug we
  proved. A stop with a grace in Alchemy's API would be a feature, and 0054 says features found by
  reading are not reported in bulk.

## The shape

### The life state (`next/packages/libfabrika/src/node/dev/DevLife.ts`)

One new case, `replacing`, and two Msgs. A sketch:

```ts
// DevLife.ts, a sketch of the new parts. `Replacement.cases.pending` is the case schema.
const Signal = Schema.Literals(["SIGTERM", "SIGKILL"]);

export const DevState = Schema.TaggedUnion({
  // ...the nine cases today, unchanged...
  replacing: {
    session: Session,
    pid: Schema.Number,
    listener: Listener,
    // Always pending: a replace is a replacement waiting from its first signal.
    replacement: Replacement.cases.pending,
    bytes: Schema.Int,
    at: Schema.Number,
    signal: Signal, // the last signal sent: SIGTERM, then SIGKILL once the grace runs out
  },
});

const Msg = Schema.Union([
  // ...today's seven...
  Schema.Struct({
    type: Schema.Literal("replacing"),
    replacement: Schema.String,
    bytes: Schema.Int,
    at: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("killed") }),
]);
```

The step function, sketch:

```ts
replacing: (s, m) => {
  // Only a running process is replaced, and only once per start.
  if (s._tag !== "spawned" && s._tag !== "online") return [s, []];
  return [
    DevState.cases.replacing.make({
      session: s.session,
      pid: s.pid,
      listener: heard(address(s)),
      replacement: Replacement.cases.pending.make({ id: m.replacement }),
      bytes: m.bytes,
      at: m.at,
      signal: "SIGTERM",
    }),
    [],
  ];
},
killed: (s) => [s._tag === "replacing" ? { ...s, signal: "SIGKILL" } : s, []],
// exited: also accepts `replacing`, as it accepts spawned and online today.
// listened: `replacing` ignores it; the old process already listened.
// started, braked, stop: unchanged; they already read latest, address and replacement.
```

The getters change in three small ways:

- `target(replacing)` is `null`. The memory sampler reads `target`, so it stops sampling the old
  pid. That is what makes the kill "once per start": a second `replacing` cannot be reached until a
  `started` gives a new pid. Today the state stays `online` and the sampler sends SIGTERM every
  second.
- `address(replacing)` is its listener's port, as `exited` keeps it. Alchemy pins the ports, so the
  port is right for the replacement. It is never used to dial while a replacement is pending (next).
- A new getter, `reachable(s)`: the port a call may dial. It is the port in `listening` or
  `online` when no replacement is pending, and `null` everywhere else.

```ts
export const reachable = (s: DevState): number | null =>
  pending(s) === null && (s._tag === "listening" || s._tag === "online") ? s.port : null;
```

`online` with a pending replacement happens today: a replacement's `started` comes before its
`listened`, and `started` keeps the old port. So `reachable`, not `address`, is the rule for calls,
in the crash path too. The proof's ECONNREFUSED came from `call` reading `address` at
`dev.ts:154`.

### The driver (`next/packages/libfabrika/src/node/dev/dev.ts`)

- `life` becomes a `SubscriptionRef` (in the installed effect 4.1.2: `make`, `get`, `modify`,
  `changes`), so a waiter can follow the state.
- **A call** reads the state. If a replacement is pending, it waits on `changes` for the first state
  with none pending, or one that is braked, stopping or stopped, for at most the grace plus 30 s
  (the same 30 s the first start waits for its listener, `dev.ts:384`). Then it dials
  `reachable(s)`, or fails as `offline` when that is `null`.
- **The memory check's `replace`** folds `replacing` first. If the fold did not move the state to a
  new `replacing`, it does nothing more. Otherwise it sets `cause` as today, adds the `replacing`
  fact to the outbox, and forks `terminate` (below) in the brain's scope.
- **The kill once the grace runs out** folds `killed` and adds the `killed` fact, before the
  SIGKILL goes out, so the outbox reads in the order things happened.
- **Stop** keeps its order. A waiting call wakes on `stopping` and fails as `offline`. The
  `terminate` fiber's wait ends on `stopping` too, so it sends no SIGKILL after a stop. Alchemy's
  own finalizer SIGKILLs workerd when `runtimeScope` closes, as today.
- The head comment says the new rules: SIGTERM, then SIGKILL after the grace; a call during a
  replacement waits for it.

```ts
// dev.ts, a sketch of the call's new head.
const settled = Effect.fnUntraced(function* () {
  const now = yield* SubscriptionRef.get(life);
  if (pending(now) === null) return now;
  return yield* SubscriptionRef.changes(life).pipe(
    Stream.filter((s) => pending(s) === null || !running(s)),
    Stream.runHead,
    Effect.flatten, // the stream never ends, so runHead is Some
    Effect.timeoutOrElse({ duration: wait, orElse: () => Effect.fail(new ControlError({ reason: "offline" })) }),
  );
});
const port = reachable(yield* settled());
if (port === null) return yield* new ControlError({ reason: "offline" });
```

`running` is DevLife's private `active`, exported under a plain name, or the build adds a
`terminal` getter; that pick is the build's.

### The bounded stop (`next/packages/libfabrika/src/node/dev/local-dev.ts`)

`checkMemory` takes `limit` (bytes) in place of the 500 MB literal at line 40. A new combinator,
`terminate`, in the same shape: it takes its effects as functions, so a law runs it in memory with a
stand-in process and the test clock.

```ts
// local-dev.ts, a sketch.
const Ended = Schema.TaggedUnion({ itself: {}, killed: {} });

export const terminate = Effect.fn("brain.terminate")(function* <E, R>(options: {
  readonly pid: number;
  readonly grace: Duration.Input;
  readonly signal: (pid: number, signal: "SIGTERM" | "SIGKILL") => Effect.Effect<void, E, R>;
  readonly gone: Effect.Effect<void>; // ends when the runtime reports this pid's exit
  readonly killing: Effect.Effect<void, E, R>; // records the kill before it is sent
}) {
  yield* options.signal(options.pid, "SIGTERM");
  const ended = yield* options.gone.pipe(Effect.timeoutOption(options.grace));
  if (Option.isSome(ended)) return Ended.cases.itself.make({});
  yield* options.killing;
  yield* options.signal(options.pid, "SIGKILL");
  return Ended.cases.killed.make({});
});
```

In `dev.ts`, `signal` is `process.kill(pid, signal)` inside `Effect.sync`, one edge as today's line
410 is. An ESRCH from it (the process ended between the grace and the kill) counts as gone, not as
a failure. `gone` waits on `changes` for a state that is not `replacing` with this pid.

**The kill stays a function argument, not a new service (80%).** `checkMemory` already takes
`sample` and `replace` that way, and the integration laws already spy on `process.kill`. A
`Signals` service would add a contract file and a layer to every `startDev` caller for one call.
If a second caller needs to send a signal, it becomes a service then.

### The facts (`next/packages/libfabrika/src/runtime/BrainEvent.ts`)

Two new cases. Each is written at the moment it happens, by the brain, on its own clock.

```ts
replacing: { ...Life, reason: Schema.Literal("memory"), pid: Schema.Int, bytes: Schema.Int, limit: Schema.Int, grace: Schema.Number },
killed: { ...Life, pid: Schema.Int },
// ids: `${start}/replacing` and `${start}/killed`, in the outbox's id style.
```

How a replace ended needs no third fact: `replacing` then `exited` is "by itself"; `replacing`,
`killed`, then `exited` with `signal: "SIGKILL"` is "killed". The `exited` and `started` facts keep
`reason: "memory"` and `bytes` as today. The project appends every brain event to `gateway/brain`
as it comes (`cloudflare/runtime.ts:1743`), so a new case needs no change there.

### The settings (`next/packages/libfabrika/src/settings/Declarations.ts`)

Is this a setting? (0069, `docs/direction/settings.md`, "Is this a setting?"):

- **The memory limit: yes (85%).** A person with more memory, or a test, would choose differently,
  and it is no wall, secret or state. `desktop.brain-memory`, `Schema.ByteSize` per the settings
  note's "a byte size has one spelling: a string with its unit", default `"500 MB"`, the mark 0292
  and experiment 93 set. Scope person, reload restart, since 0.0.0. The L14 law in
  `DesktopBrain.test.ts` proves it survives a snapshot; if the settings codec cannot carry a
  `ByteSize`, the build reports that to the lead in place of falling back to a bare number.
- **The grace: yes (80%).** systemd, Kubernetes and OTP all make it a knob.
  `desktop.brain-grace`, whole milliseconds, as `desktop.brain-poll` and
  `desktop.brain-stop-timeout` are, default 5000, OTP's worker default. Scope person, reload
  restart. Why not 30 s or 90 s: the control door is closed for the whole grace, and a local
  runtime holds no work a drain can save that the log does not (0292: a restart "loses nothing").
- **The call's wait bound: no.** It is the grace plus the 30 s first-start bound already in
  `dev.ts`, a constant nobody varies apart from those two.
- **The sample interval (1 s): no,** unchanged, not in this ticket.

`next/apps/fabrika/src/instance.ts` passes both values from `checked.values` into `startDev`, beside
`port`. `startDev` takes `memory` (bytes) and `grace` (ms) as required options, so the default lives
once, in the declaration (80%). Every test that calls `startDev` passes them.

## One value traced

The proof's run, replayed on the fix. Start `s1`, pid 41000, control port 40123, the door's
WebSocket open, grace 5000 ms.

1. t=10,000 ms. The sampler reads `target(online) = 41000`, and `ps` says 512,000,000 bytes, at or
   over 500 MB. `replace` folds `{type: "replacing", replacement: "s1", bytes: 512000000, at: 10000}`.
   The state is now `replacing {pid: 41000, listener: known 40123, replacement: pending s1, signal:
   SIGTERM}`. The outbox gets `s1/replacing` with `limit: 500000000, grace: 5000`.
2. `terminate` sends SIGTERM to 41000. workerd closes its control and debug ports and drains; the
   WebSocket keeps it alive.
3. t=10,390. A control call (the proof's first ECONNREFUSED) reads `pending = "s1"` and waits. No
   request goes to 40123.
4. t=11,000 to 14,000. Each sample reads `target(replacing) = null` and does nothing. No second
   SIGTERM (the proof had nine).
5. t=15,000. The grace runs out. `killing` folds `killed` (signal SIGKILL) and adds `s1/killed`.
   Then SIGKILL goes to 41000.
6. The child closes. Alchemy's `onExit` queues the exit, the brain hears `exit`, adds `s1/exited`
   with `reason: memory, bytes: 512000000, signal: SIGKILL`, and the state is `exited` (pending s1).
7. t=15,250. Alchemy's backoff ends; `restart` makes the state `waiting`. Alchemy starts pid 41077
   on the pinned ports. `started` gives `online {pid: 41077, port: 40123, replacement: pending s1}`:
   `reachable` is still `null`.
8. t=15,450. The control plugin hears `listened 40123`: `online {replacement: none}`. The waiting
   call wakes, dials 40123 and gets its answer. The sampler now reads 41077.
9. The outbox reads `s1/replacing`, `s1/killed`, `s1/exited`, `s1/restarting`, `s2/started`, in
   that order, and the project gets them on the next flush.

Without the WebSocket, step 2 ends in about 200 ms by itself: no `killed` fact, and `exited` has
`signal: SIGTERM`.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1, DevLife's walk with the two new Msgs matches the reference transition table at every step, from any start, with late Msgs of every kind, 200 runs | test | fc.record: today's Choice plus bytes, at and a pick of replacing and killed | let `replacing` from `spawned` be ignored, or let `listened` end a `replacing`: the walk and the reference differ | next/packages/libfabrika/src/node/dev/DevLife.laws.test.ts |
| L2, once per start: after a `replacing`, `target` is null and a second `replacing` changes nothing until a `started` with a new pid, in every walk, 200 runs | test | fc.record: walks that put one to five `replacing` Msgs between starts | `target(replacing)` returns the pid: a second `replacing` is reachable and L2 fails | next/packages/libfabrika/src/node/dev/DevLife.laws.test.ts |
| L3, `reachable` is a port only in `listening` or `online` with no pending replacement, and equals `address` there, in every walk, 200 runs | test | fc.record: the same walks | `reachable` returns the port of an `online` with a pending replacement: L3 fails on the walk that starts before it listens | next/packages/libfabrika/src/node/dev/DevLife.laws.test.ts |
| L4, `replacing` holds a pid and a pending replacement that cannot be `none`, and its Msg needs bytes and at | type | type | type the field as `Replacement` (both cases): the `not` check on the none case fails to compile | next/packages/libfabrika/src/node/dev/DevLife.laws.test.ts |
| L5, `terminate` sends SIGTERM once, and SIGKILL once exactly at the grace if and only if the process has not gone, with `killing` run just before it; it answers `itself` or `killed` to match, on the test clock, 100 runs | test | fc.record: grace 1 to 10,000 ms, exit moment none or 0 to twice the grace, whether the stand-in honors SIGTERM | sleep half the grace, or drop the SIGKILL branch, or run `killing` after the signal: L5 fails | next/packages/libfabrika/src/node/dev/local-dev.laws.test.ts |
| L6, a SIGKILL that finds the process already gone (ESRCH) ends `terminate` as `killed` with no failure, 50 runs | test | fc.record: grace and the moment the stand-in exits, inside the gap between timeout and kill | let the ESRCH error escape: L6 fails | next/packages/libfabrika/src/node/dev/local-dev.laws.test.ts |
| L7, the driver with a stand-in runtime that ignores SIGTERM: samples at or over the limit for many seconds send SIGTERM once and SIGKILL once, at the grace; the outbox holds replacing, killed, exited, restarting, started in order with unique ids; a stand-in that honors SIGTERM gives no killed fact, 20 runs | test | fc.record: bytes at or over the limit, the limit, grace, seconds sampled, whether SIGTERM is honored | main's `dev.ts` (no `replacing`): SIGTERM is sent every second and L7 fails on the count | next/packages/libfabrika/src/node/dev/dev.laws.integration.test.ts |
| L8, during a replace no control request goes to the old port: every call made between the SIGTERM and the new listener either answers after the listener or fails `offline` after the bound; a stop while replacing ends every waiting call as `offline` and sends no SIGKILL, 20 runs | test | fc.record: call moments, the listener's delay, whether a stop comes, its moment | dial `address` in place of `reachable`: the fetch stand-in sees a request to the old port; or clear the waiters on stop without waking them: the call times out | next/packages/libfabrika/src/node/dev/dev.laws.integration.test.ts |
| L9, `desktop.brain-memory` and `desktop.brain-grace` are declared in the group, read a provider, keep their defaults (500 MB, 5000) and survive a snapshot, 50 runs | test | Effect Arbitrary: Schema.Tuple | default the limit to 50 MB, or leave the grace out of `all`: L9 fails | next/packages/libfabrika/src/settings/DesktopBrain.test.ts |
| L10, real workerd through Alchemy with the founder's door WebSocket held open: once the memory sample stand-in reports the limit plus one, the old pid is gone within the grace plus 2 s, a new pid answers `info` on the same control and public ports, a poller calling `info` every 50 ms sees only answers or `offline` and never ECONNREFUSED, and `gateway/brain` holds replacing, killed, exited, started | test | scenario: real workerd, the app's own build and door, a WebSocket held open, the `ps` sample switched by the test | run it on main's `dev.ts`: the poller sees ECONNREFUSED and the old pid outlives the bound, the proof's shape | next/apps/fabrika/src/memory-replace.laws.integration.test.ts |
| L11, the same with no WebSocket open: the old workerd ends by itself on SIGTERM, no killed fact, and the first `exited` has signal SIGTERM | test | scenario: real workerd, the app's own build, no client connected | send SIGKILL at once in place of SIGTERM: the killed fact appears and L11 fails | next/apps/fabrika/src/memory-replace.laws.integration.test.ts |

Notes on the laws:

- **How workerd ignores SIGTERM without 500 MB.** L1 to L8 use stand-ins: a stand-in process whose
  SIGTERM handling is a generated boolean, on the test clock. L10 uses real workerd and its real
  drain, made by a real open WebSocket, the cause the proof found. Only the memory number is a
  stand-in: `next/apps/fabrika/src/rss.test-support.ts` gives a `ChildProcessSpawner` that answers
  `ps -o rss= -p <pid>` from a value the test sets, and hands every other command to the real
  spawner. The test switches it to the limit plus one once the WebSocket is open.
- **Why not a low limit setting in L10 (80%).** With the limit at, say, 1 MB, the first sample, about
  1 s after the start, replaces workerd before the test can open its WebSocket, so the run would
  race. The setting is still proved by L9. If the build finds the spawner does not reach `startDev`
  through `localInstance`, the tests step reports it, and the stand-in moves to `dev.fixture.ts`'s
  `rssLayer` shape.
- **Where each runs.** L1 to L6 and L9 run in memory, on every pull request. L7 and L8 drive real
  temp folders (the outbox), and L10 and L11 real workerd and sockets, so all four are
  `*.integration.test.ts` and run only on the 3-hour schedule (0536).
- **Existing tests that change.** Every `startDev` caller passes `memory` and `grace`:
  `dev.laws.integration.test.ts`, `dev-secrets.laws.integration.test.ts`,
  `dev-control.laws.integration.test.ts`, `dev-errors.laws.integration.test.ts`, and
  `next/apps/fabrika/src/local-instance.integration.test.ts`. The memory law in
  `dev.laws.integration.test.ts` that expects `process.kill(pid, "SIGTERM")` per sample keeps its
  check, now once per start. `StartsTest.ts` lists every setting's origin and gains the two.
- Every plant is run once by the tests step and recorded in its report and run row, never committed.

**Host-only laws: L10 and L11.** They need a real OS process, real signals and real sockets. They
run before the first review, in the step's container (0045, 0178), never on the owner's Mac. Their
only signal lines go to a workerd pid the law found under its own instance, as
`next/apps/fabrika/src/workerd.test-support.ts` does; the lead reads those lines before the run.

## How the fix is proven before merge

The scheduled run comes after the merge, so it cannot be the proof. Before the first review:

1. The tests step runs L1 to L6 and L9 in the box, and each plant once.
2. The tests step runs L7, L8, L10 and L11 once in the container, and their plants once, L10's
   plant being main's `dev.ts`.
3. The lead reruns L10 once in the container on the build's head, and reads its output: the old
   pid's end time, the facts in order, the poller's counts.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| `next/packages/libfabrika/src/node/dev/DevLife.ts` | build | 45 | the `replacing` case, the `replacing` and `killed` Msgs, `target`, `reachable`, and the head comment |
| `next/packages/libfabrika/src/node/dev/dev.ts` | build | 60 | `SubscriptionRef` life, the call's wait and `reachable`, the replace with its facts and `terminate`, stop wakes waiters, `memory` and `grace` options, the head comment |
| `next/packages/libfabrika/src/node/dev/local-dev.ts` | build | 35 | `checkMemory` takes `limit`; `terminate` |
| `next/packages/libfabrika/src/runtime/BrainEvent.ts` | build | 10 | the `replacing` and `killed` cases |
| `next/packages/libfabrika/src/settings/Declarations.ts` | build | 35 | `desktop.brain-memory` and `desktop.brain-grace`, and both in `all` |
| `next/apps/fabrika/src/instance.ts` | build | 4 | pass both values into `startDev` |
| `next/packages/libfabrika/src/node/dev/DevLife.laws.test.ts` | tests | tests | L1 to L4, the reference table gains the new rows |
| `next/packages/libfabrika/src/node/dev/local-dev.laws.test.ts` | tests | tests | L5 and L6, new |
| `next/packages/libfabrika/src/node/dev/dev.laws.integration.test.ts` | tests | tests | L7 and L8, and the new options |
| `next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts` | tests | tests | the new options |
| `next/packages/libfabrika/src/node/dev/dev-control.laws.integration.test.ts` | tests | tests | the new options |
| `next/packages/libfabrika/src/node/dev/dev-errors.laws.integration.test.ts` | tests | tests | the new options |
| `next/packages/libfabrika/src/settings/DesktopBrain.test.ts` | tests | tests | L9 |
| `next/packages/libfabrika/src/settings/StartsTest.ts` | tests | tests | the two origins |
| `next/apps/fabrika/src/local-instance.integration.test.ts` | tests | tests | the new options |
| `next/apps/fabrika/src/memory-replace.laws.integration.test.ts` | tests | tests | L10 and L11, new |
| `next/apps/fabrika/src/rss.test-support.ts` | tests | tests | the `ps` stand-in that delegates every other command, new |
| `next/apps/fabrika/src/workerd.test-support.ts` | tests | none | not changed: cited as the model for L10's signal lines |
| `patches/@alchemy.run__cloudflare-runtime@2.0.0-beta.85.patch` | tests | none | not changed: no new patch to Alchemy (see "How others do it") |
| `patches/` | tests | none | not changed: no new patch |
| `.glossary/TERMS.md` | build | docs | rows for `replacing (brain)`, `killed (brain)` and the grace; the `brainOutbox, checkMemory` row names the limit setting |

Placement by `next/AGENTS.md`'s libfabrika test: the life state, the bounded stop and the facts are
in libfabrika, since any client that runs a local instance needs them; the app only passes its two
settings, as it passes the port.

## Validation

- The tests step: `pnpm format`, then `nice -n 15 pnpm exec vitest run --maxWorkers=3` on the three
  in-memory files (DevLife.laws.test.ts, local-dev.laws.test.ts, DesktopBrain.test.ts), then the
  four integration laws once in the container, and `pnpm lint`.
- The build step: the same narrow paths, and `pnpm lint`.
- The lead: one `pnpm typecheck`, the L10 rerun above, the leak grep.

## Size

One pull request that lands whole.

1. The bounded memory replace: about 190 product lines in six files, plus about 450 test lines in
   eleven files and four glossary rows.

Priced from similar lanes in `field/runs/`: ticket 955's tests $1.60, build $0.68, review $1.75;
ticket 502's slice 2, a libfabrika driver change with secrets laws, tests $1.51, a fix round
$6.47, review $5.09. This one has more laws than 955 and two real-workerd laws. Expected: tests
about $6, build about $4, review about $4, one fix round about $5. Confidence 70%: the doubt is L10,
the first law here that holds a real door WebSocket open across a restart.

Estimate: 4 steps, $19

## Measuring is its own ticket

**Measuring workerd memory per program process is a separate experiment ticket, not this fix
(85%).** Why: its output is a number and a write-up in `experiments/`, not a law; the hang is a bug
at any limit, so the fix should not wait on it; and the limit is now a setting, so the experiment's
answer lands as a one-value change. The lead files it, with this lean: real workerd, 0, 1, 5, 10
and 20 shells and checklists, RSS sampled every second for 10 minutes idle and 10 minutes with
input, and one run with a heap snapshot, to tell a per-process need from a leak. L8 on
`fabrikalfa/tezgah-new` (about 350 MB to 512 MB in 20 s with a shell per tile) is its first case.

## Records

- **What is lost if not written now:** the moment the brain sent SIGTERM and the bytes it saw (the
  `replacing` fact), and the moment it gave up and sent SIGKILL (the `killed` fact). Today neither
  exists anywhere: the `exited` fact carries the exit time, not the kill time, and nothing says
  whether a kill was forced. The number of live program processes at the replace is not recorded:
  it rebuilds from the process facts on the ledger at the `replacing` fact's time, so nothing is
  lost.
- `.glossary/TERMS.md`, as in the files table.
- `field/runs/` rows for each step, written by the lead. The finding
  `field/findings/2026-11-12-local-control-door-refuses-in-long-runs.json` gets its pull request
  once one exists.
- No `.decisions/` file: the calls here build 0292 ("restarts at its 500 MB mark"), 0069 and 0536,
  and pick how the code does it.

## What this cannot tell us

- Why the public port keeps listening after SIGTERM. The read of workerd's drain fits, but it was
  read on workerd's main branch, not on 1.20261026.1, and not run.
- The ECONNRESET form the brief names. No run showed it; L10 counts ECONNREFUSED and every other
  error apart, so a reset would show as a failure, not as a pass.
- Whether 500 MB is right for about ten shells, or a leak: the measuring ticket.
- Whether a waiting call can stall a caller that holds a turn (the 75% doubt above). L7 and L8 use
  stand-in callers; only real use will show it.
- pid reuse: if workerd ends and the OS gives its pid to another process inside the gap between the
  grace and the SIGKILL, the kill could reach that process. The gap is microseconds and the state is
  checked first; no law can prove it absent.

## Open questions

None.
