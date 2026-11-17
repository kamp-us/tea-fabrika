Approved by the lead agent, builds 0170, 0531, 0526, 0536; body a3c6df9f5bcc
Plancheck-Version: 3

# Plan: a program can monitor another running program and gets one `DOWN` when it ends

This is `next/`. It is the first piece of plumbing that pipes need: a reader learns that its writer
is gone the way Erlang/OTP does it, with a monitor. It builds two built-in Cmds, `monitor` and
`demonitor`, on the watches the brain already keeps (`processes/ProcessManager.ts`). Nothing in this
slice draws or changes what a person sees. One pull request, about 540 product lines.

```ts
// The whole idea, a sketch in a program's own terms. `monitor` and `demonitor` are new; DOWN is today's.
update: {
  watch: (m, msg) => [m, [Monitor.monitor({ name: msg.writer })]],      // asks to watch a name
  monitor_ok: (m, msg) => [{ ...m, ref: msg.value.ref }, []],           // { ref, process, name }
  monitor_err: (m, msg) => [{ ...m, problem: msg.reason }, []],         // "no_name" | "forbidden" | "stale_sender"
  DOWN: (m, msg) => [{ ...m, writer: { ended: msg.reason } }, []],      // one, after the life's last message
  forget: (m) => [m, m.ref === null ? [] : [Monitor.demonitor({ ref: m.ref })]],
},
// What lands in the watcher's inbox, in this order, for a writer that sent two messages and ended:
// { type: "monitor_ok", value: { _tag: "monitored", ref: "process_7/12/0", process: "process_9", name: "tracker:1" } }
// { type: "rows", ... }   { type: "rows", ... }           <- the writer's own messages, as today
// { type: "DOWN", ref: "process_7/12/0", process: "process_9", name: "tracker:1", reason: { _tag: "normal" }, to: ... }
```

## What changes, in one paragraph

A program returns `monitor({ name })`. Its runner asks a new brain-side service, `Monitors`, which
checks who may watch (the member behind the Cmd, 0170 and 0531, through the one permission model,
0526), resolves the name to its current life once, as Erlang's `monitor(process, Name)` does, and in
one ledger turn writes the `monitored` row, the Cmd's answer message and, for a life that already
ended, the `DOWN` with `noproc`. When the watched life ends, today's `ProcessManager.exit` writes one
`DOWN` into the watcher's inbox in the `exited` turn, so it lands after every message that life
saved. `demonitor({ ref })` ends the watch, and a `DOWN` still unread for it is dropped, as today's
`demonitor` already does for windows. The watch binds one life and never follows the name: a
restart under the name gives one `DOWN` for the old life, and a watcher that wants the new life
monitors again, as a window tile does today.

## Searched first

Searched on 2026-11-15 in `.decisions/`, `docs/direction/`, `.glossary/TERMS.md`, `experiments/`,
`docs/plan/`, and the tracker, for "monitor", "DOWN", "demonitor", "watch", "noproc" and "pipe end".

- **The pipe note, proposed:** `docs/direction/how-a-pipe-carries-output.md` on branch
  `fabrikalfa/pipe-carry`. Its text is the lean. Decided on 2026-11-15, in talk: the right side gets
  the whole current value, newest wins; a pipe fits when the output has the fields the input needs;
  the brain checks the member and records the pipe. The monitor as the end of output is a lean the
  owner asked to have built while the screen is decided, since the plumbing is the same whatever it
  shows. This plan builds only the monitor, never the `pipe` Cmd.
- **Monitors are built in the brain, links are Tier 4:** `docs/direction/follows/otp.md`, rows
  "Monitor", "Monitor a gone process", "Monitor a registered name", "A watcher ends" and
  "demonitor". The "registered name" row already gives the Erlang answer for a restart: resolve the
  name once, never follow it, monitor again after the `DOWN`.
- **The glossary:** `DOWN`, `monitor reference`, `recipient life`, `ProcessManager`. A watch is
  keyed by (recipient life, ref), binds a process id, and never follows the name. The glossary says
  the caller picks the ref "so a retried request finds the same watch"; for a program the caller is
  its runner, and the Cmd's own stable id does that (see "Calls taken").
- **Permissions:** [0170](../../../.decisions/0170-a-start-is-checked-against-its-sender.md),
  [0531](../../../.decisions/0531-a-start-carries-its-member-down.md),
  [0526](../../../.decisions/0526-one-rebac-permission-system.md), and
  `next/packages/libfabrika/src/permissions/Model.ts` (`StartProgram`, the first rule).
- **Tracker ticket 1039** (open): a tile that tezgah closes keeps its watch until the session ends;
  the window needs a `process.demonitor` call at the door, with flush. It is the window's own path
  (`client/WindowMachine.ts`, the gateway), not a program Cmd. This slice does not close it, but its
  program side follows the same OTP rule, and the brain-side `demonitor` it needs is already built.
- **Mail order per pair:** pull request
  [1310](https://github.com/kamp-us/tea-fabrika/pull/1310) (ticket 1041), `behind` in
  `runtime/Runner.ts`.
- **Who writes a Cmd's answer message:** the hands Cmd's answer `<cmd id>/answer` is written by the
  Project inside its own turn (`runtime/HandsTasksLive.ts`, "collected by the asking process into the
  Cmd's answer letter"). This plan follows that precedent for the order law.

## How others do it

- **Erlang/OTP, read from the processes reference and `erlang:monitor/2`'s docs (cited in the OTP
  table as [proc] and [erl]):** `monitor(process, Pid | RegName)` returns a fresh reference made by
  the system. A monitor by name resolves the name once, at the call. The `DOWN` is
  `{'DOWN', Ref, process, Object, Info}`, where `Object` is the pid, or `{RegName, Node}` for a
  monitor made by name, and `Info` is the exit reason, or `noproc` when the target did not exist at
  the call. Messages between one pair keep their order, so a `DOWN` comes after every message the
  dead process sent. `demonitor(Ref, [flush])` ends the watch and removes a `DOWN` already queued. A
  monitor needs no permission inside a node. When the watcher dies, its monitors go.
- **Elm:** no processes, so no monitor. The closest is a `Sub` that ends when the program stops
  asking for it. What we take: the program asks with a Cmd and gets its answer as a Msg, as every
  host Cmd does here.
- **Akka:** `context.watch(ref)` gives one `Terminated(ref)` after the actor's last message;
  `unwatch` drops a queued one ([Akka docs, "Lifecycle Monitoring aka DeathWatch"], not fetched for
  this plan, from memory: a guess until read).
- **Kubernetes:** a watch on an object gives a `DELETED` event; a new pod under the same name is a
  new object with a new uid. What we take: a new life is a new thing to watch.

The plain reading: OTP's monitor, with the name resolved once, is the whole design. The only parts
that need our own answer are the ones OTP gets from a synchronous call: who picks the ref, and how
the answer comes before the `DOWN`.

## The shape

### The two Cmds

```ts
// next/packages/libfabrika/src/runtime/Monitor.ts (new). The runner performs both itself.
import { Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Down } from "../processes/Process.ts";

/** monitor's operands: the registered name to watch. The runner binds the watcher and makes the ref. */
export const MonitorInput = Schema.Struct({ name: Schema.String });

/** The answer: the watch's ref (this Cmd's own id), the life it binds, and the name asked. */
export const Monitored = Schema.TaggedStruct("monitored", {
  ref: Schema.NonEmptyString,
  process: ProcessId,
  name: ProcessName,
});

/** Why a watch is refused. Each is final, and a refusal writes nothing. */
export const MonitorRefusal = Schema.Literals([
  "forbidden",    // the member behind the Cmd may not watch here, or no member and no related pair
  "stale_sender", // the watcher's own life ended, or the cause was delivered to a life that ended
  "no_name",      // no process was ever registered under the name: `send`'s answer to the same question
  "bad_name",     // the name is not a process name
]);

export const monitor = Cmd.make("monitor", { input: Asked, ok: Monitored, err: MonitorRefusal.literals });

/** demonitor's operands: a ref this life got from `monitor`. Another life's ref is never touched. */
export const DemonitorInput = Schema.Struct({ ref: Schema.String });
export const demonitor = Cmd.make("demonitor", { input: AskedRef, ok: Schema.Null, err: [] });

/** The input port a program that monitors declares under `DOWN`: today's Down, as a Msg. */
export const down = { schema: Down, description: "A process this program monitors has ended" };
```

`Asked` and `AskedRef` are the same loose declarations `StartChild.ts` uses, so a malformed Cmd is
answered `bad_cmd` by the host and never fails the step that asked.

### The DOWN a program gets

```ts
// next/packages/libfabrika/src/processes/Process.ts: today's Down, plus `name`, Erlang's `{RegName, Node}`.
export const Down = Schema.TaggedStruct("DOWN", {
  ref: Text,
  process: ProcessId,
  name: Schema.optionalKey(ProcessName),            // new: set when the watch was made by name
  reason: Schema.Union([ExitReason, NoProc]),       // normal | shutdown | kill | crashed{phase, error?} | noproc
  to: Recipient,
});
```

The reason is today's tagged union, unchanged: `ExitReason` (`normal`, `shutdown`, `kill`,
`crashed` with `phase` and an optional error class) or `noproc`. A window's `DOWN` has no `name`, so
nothing it reads changes.

### What the brain records

```ts
// next/packages/libfabrika/src/processes/internal/processTable.ts: `monitored` gains two optional keys.
monitored: {
  ref: Text,
  process: ProcessId,
  to: Recipient,
  name: Schema.optionalKey(ProcessName),   // new: the name asked, as the watcher said it
  member: Schema.optionalKey(Sender),      // new: the member the watch was checked against (0170, 0531)
},
// demonitored is unchanged: { ref, to, reason: "canceled" | "watcher_exited" }.
```

Each row is a ledger entry, so it also keeps `by` (the brain's key), `asked` (the caller's key),
`sentAt` on the writer's clock, `arrivedAt` on the ledger's, `parent` (the message whose step made
the Cmd) and `traceId`.

### The service and its permission

```ts
// next/packages/libfabrika/src/processes/Monitors.ts (new, contract only, 0095).
export type Watch = {
  readonly id: string;                                   // the Cmd's id, which becomes the ref
  readonly name: string;
  readonly watcher: typeof Recipient.cases.process.Type; // bound by the runner, never the program
};
export type Unwatch = { readonly ref: string; readonly watcher: typeof Recipient.cases.process.Type };

export class MonitorsError extends Schema.TaggedError<MonitorsError>()("MonitorsError", {
  reason: Schema.Literals(["forbidden", "stale_sender", "no_name", "bad_name", "storage"]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class Monitors extends Context.Service<Monitors, {
  readonly monitor: (watch: Watch, from: From) => Effect.Effect<typeof Monitored.Type, MonitorsError>;
  readonly demonitor: (unwatch: Unwatch, from: From) => Effect.Effect<void, MonitorsError>;
}>()("@kampus/libfabrika/processes/Monitors") {}

// next/packages/libfabrika/src/permissions/Model.ts: one new permission and its right.
permissions: {
  start: (p) => p.union("owner", "admin", "member"),
  watch: (p) => p.union("owner", "admin", "member"),     // new: 0170's first rule, applied to a watch
},
export class WatchProcess extends Rebac.Permission<WatchProcess>()(
  "@kampus/libfabrika/permissions/Model.WatchProcess",
  { model: Model, on: "fabrika", permission: "watch" },
) {}
```

`MonitorsLedger.layer({ fabrika })` decides in this order, as `ChildrenLedger` does, so a refused
caller never learns whether a name exists:

1. `bad_name`: the name is not a `ProcessName`.
2. A saved watch under this ref: answer it again, write nothing (a retry).
3. `stale_sender`: the watcher's life is not live, or `Senders` says the cause went to a life that
   ended.
4. The permission step: the member is the sender of `from.parent`, else the watcher's recorded
   member (0531). A member is checked with `WatchProcess` on this fabrika. With no member, the watch
   is allowed only for a related pair, the watcher's own child or its starter, read by name as
   `ProgramMailLedger`'s `related` reads it. Else `forbidden`.
5. `no_name`: the name was never registered.
6. In one turn: the `monitored` row (`ref` = the Cmd id, `process` = the name's current life,
   `name`, `member`), the answer message `<cmd id>/answer` in the watcher's inbox, and, when that life
   is not live, the `DOWN` with `noproc` after it.

The member pick (step 4) is today's `judge` in `processes/ChildrenLedger.ts`. It moves to
`processes/internal/member.ts` so both services read one function; the start's own grant rule stays
in `ChildrenLedger`.

### How the turn writes as the watcher

`ProcessManager.monitor` and `demonitor` today deliver to the wiring's own `recipient`. They gain one
optional trusted last argument, `as: { to: Recipient.process, name, member? }`, which only a
brain-side service passes. `ProcessCalls`, the shape a Process object reaches over RPC, keeps the
three-argument forms, so no object across an RPC can name another recipient.

```ts
// next/packages/libfabrika/src/processes/ProcessManager.ts, a sketch of the new signature.
readonly monitor: (ref: string, process: string, from: From, as?: Watcher) => Effect.Effect<void, Failure>;
readonly demonitor: (ref: string, from: From, as?: Pick<Watcher, "to">) => Effect.Effect<void, Failure>;
// Watcher = { to: Recipient.process, name: ProcessName, member?: Sender, answer: { id, m } }
```

`answer` is the Cmd's answer message, which the monitor's turn appends to the watcher's inbox
before any `noproc` `DOWN`. The runner's `place` then finds it saved, as it does for a finished
hands Cmd.

### The runner

```ts
// next/packages/libfabrika/src/runtime/Runner.ts, a sketch.
const MONITOR = "monitor";
const DEMONITOR = "demonitor";
const HOST = new Set([SEND, SEND_CHUNKS, START_CHILD, STOP_CHILD, EXIT, HANDS, MONITOR, DEMONITOR]);

/** The built-in monitor, OTP's monitor(process, Name): this life is the watcher, this Cmd's id the ref. */
const watch = Effect.fnUntraced(function* (state: Live, job: Dispatched) {
  const input = decodeMonitor(job.cmd);
  if (!state.loaded.declaration.cmds.includes(MONITOR) || Option.isNone(monitors) || Option.isNone(input)) {
    return yield* err(job, "bad_cmd");
  }
  const watched = yield* monitors.value
    .monitor({ id: job.id, name: input.value.name, watcher: Recipient.cases.process.make({ process: process.id }) },
      yield* from(job.parent, job.traceId))
    .pipe(Effect.result);
  if (Result.isSuccess(watched)) return yield* ok(job, Schema.encodeSync(Monitored)(watched.success));
  const { reason } = watched.failure;
  return reason === "storage" ? yield* new LedgerError({ reason: "storage" }) : yield* err(job, reason);
});
```

A `DOWN` already folds into a program as the Msg `{type: "DOWN", ...}` today (`Runner.ts`, the
read loop's `decodeDown`). Nothing there changes. A program that declares `monitor` must declare a
`DOWN` input: a load of one that does not is `ProgramDown load`, with a message that says so.

### The Process object and the Project

A Process object reaches `Monitors` the way it reaches `Children`: two new Project calls,
`processMonitor` and `processDemonitor` already exist for the object's own manager, so the new ones
are `programMonitor(watch, from)` and `programDemonitor(unwatch, from)`, with replies decoded as
`StopReplies` are (`cloudflare/runtime.ts`, `cloudflare/bindings.ts`, `cloudflare/platform.ts`). The
Project builds `MonitorsLedger.layer` beside `ChildrenLedger.layer`, over its own manager.

## One value traced: watch, two messages, end, then a watch on the restarted name

`reader:1` (life `process_7`, started by a member's line, so its `started` row has `member`)
watches `tracker:1` (life `process_9`).

1. A step of `reader:1` at inbox pos 12 returns `monitor({ name: "tracker:1" })`, dispatched as
   `process_7/12/0`.
2. The runner calls `Monitors.monitor({ id: "process_7/12/0", name: "tracker:1", watcher: process_7 })`.
3. The name is a process name, no watch is saved under the ref, `process_7` is live, the member is
   `process_7`'s recorded member, `WatchProcess` passes, and `tracker:1` is registered.
4. One turn writes `monitored {ref: "process_7/12/0", process: "process_9", to: process_7, name:
   "tracker:1", member}` on `processes`, and `reader:1/inbox` pos 13, `process_7/12/0/answer`, the
   `monitor_ok`. `process_9` is live, so no `DOWN`.
5. `reader:1` folds pos 13: `monitor_ok {value: {ref, process: "process_9", name}}`.
6. `tracker:1` sends two messages: `reader:1/inbox` pos 14 and 15.
7. `tracker:1` crashes. Its supervision exits it with `crashed {phase: "step"}`. In that one turn the
   brain writes `exited` and `reader:1/inbox` pos 16, `["DOWN", process_7, "process_7/12/0", 1]`.
   A message from `process_9` can no longer be saved: the brain refuses a sender that is not live
   (`stale_sender`), so pos 16 is the last thing from that life.
8. `reader:1` folds 14, 15, then the `DOWN` with `name: "tracker:1"` and the crash reason.
9. The supervisor starts `process_11` under `tracker:1`. `reader:1` gets nothing about it: its watch
   bound `process_9`.
10. `reader:1` returns `monitor({ name: "tracker:1" })` again, as `process_7/16/0`, a new ref. Its
    turn binds `process_11`. Had it asked during the backoff, while the name's current life was the
    ended `process_9`, the turn would have written the `monitor_ok` and then `DOWN noproc` at once.

## What fact is lost today

Today a program cannot watch at all, so nothing is lost yet. Once it can, these exist only at the
moment of the watch and go in now, even though nothing reads them:

- **Which name the watcher asked for.** The row keeps the life it bound, but a name is not readable
  from a life after a restart without the full history, and a `DOWN` for a watch made by name says
  the name, as Erlang's does.
- **Which member the watch was checked against.** The permission rule will change (0526); a later
  reader needs to know which rule let a watch through.
- **Both clocks and the cause:** `sentAt`, `arrivedAt`, `parent` and `traceId`, on every row, as the
  ledger already records.

What can wait, since it rebuilds from the log: how long a watch lived, how many watches a process
holds, how often a watcher re-monitors after a restart.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| M1, a monitor on a live name: for generated names, lives and members, `monitor({name})` answers `monitored {ref, process, name}` where `ref` is the Cmd id and `process` the name's current life, and writes exactly one `monitored` row carrying `name`, `member` and `to` = the watcher's life. 100 runs | test | fc.record: name, lives, member or none | (a) bind the name's first life, not its current one: M1 red after a restart; (b) drop `member` from the row: M1 red | next/packages/libfabrika/src/processes/MonitorsTest.ts, run by next/packages/libfabrika/src/node/Monitors.integration.test.ts |
| M2, one DOWN after the last message: for a generated interleaving of the watched life's sends and its end with any `ExitReason`, the watcher folds exactly one `DOWN` with that reason, its `name` and `ref`, and no message from that life folds after it. 100 runs | test | Effect Arbitrary: ExitReason | (a) write the DOWN in a turn after `exited`: an interleaving saves a message between, M2 red; (b) write the DOWN twice on a retried exit: M2 red | next/packages/libfabrika/src/runtime/MonitorTest.ts, run by next/packages/libfabrika/src/node/Monitor.integration.test.ts |
| M3, the answer folds before its DOWN: for a generated race of the watched life's end against the monitor's turn and the answer's placement, the watcher always folds `monitor_ok` before the `DOWN` for that ref, `noproc` included. 100 runs | test | fc.commands: end, monitor, place, wake | let the runner place the answer after the brain turn, as other host Cmds do: the end lands between, M3 red | next/packages/libfabrika/src/runtime/MonitorTest.ts, run by next/packages/libfabrika/src/node/Monitor.integration.test.ts |
| M4, an ended or down name: a name whose current life ended or went down answers `monitored` with that life, then one `DOWN noproc`, in that order, in one turn. A name never registered answers `no_name` and writes nothing. 100 runs | test | fc.constantFrom: live, ended, down, never | (a) answer `no_name` for an ended name; (b) write the `noproc` DOWN before the answer: M4 red | next/packages/libfabrika/src/processes/MonitorsTest.ts, run by next/packages/libfabrika/src/node/Monitors.integration.test.ts |
| M5, the refusal order: a generated request that fails more than one check gets the first refusal of `bad_name`, `stale_sender`, `forbidden`, `no_name`, and every refusal writes nothing, so a refused caller cannot tell whether a name exists. 100 runs | test | fc.record: bad name, stale watcher, denied member, missing name | check `no_name` before the permission step: M5 red | next/packages/libfabrika/src/processes/MonitorsTest.ts, run by next/packages/libfabrika/src/node/Monitors.integration.test.ts |
| M6, who may watch: a member that `WatchProcess` allows may watch any name; a member it denies gets `forbidden`; with no member, only the watcher's own child or starter may be watched. 100 runs | test | fc.record: member allowed, denied or none, pair related or not | (a) skip the check when there is no member; (b) read the program's member, not the cause's sender: M6 red | next/packages/libfabrika/src/processes/MonitorsTest.ts, run by next/packages/libfabrika/src/node/Monitors.integration.test.ts |
| M7, a retry is one watch: the same Cmd id asked again after a crash between the brain's turn and the answer's fold, any number of times, gives one `monitored` row, one answer message and the same ref. 100 runs | test | fc.integer: retries 1 to 5 | write a new round on each retry: M7 red | next/packages/libfabrika/src/runtime/MonitorTest.ts, run by next/packages/libfabrika/src/node/Monitor.integration.test.ts |
| M8, demonitor: after `demonitor_ok` folds, no `DOWN` for that ref folds, including one already saved in the inbox but not yet read; a ref the life never got answers `demonitor_ok` and writes nothing; another life's ref is never touched. 100 runs | test | fc.commands: monitor, end, demonitor, read | (a) cancel by ref alone, not (watcher, ref): another life's watch ends, M8 red; (b) skip the receive filter: a saved DOWN folds, M8 red | next/packages/libfabrika/src/runtime/MonitorTest.ts, run by next/packages/libfabrika/src/node/Monitor.integration.test.ts |
| M9, the watcher ends first: when the watcher's life ends, each of its watches gets `demonitored watcher_exited`, and a new life under the watcher's name folds no `DOWN` for them when the watched life ends later. 100 runs | test | fc.commands: watch, watcher end, restart, target end | keep the watch on the watcher's name: the new life folds the DOWN, M9 red | next/packages/libfabrika/src/runtime/MonitorTest.ts, run by next/packages/libfabrika/src/node/Monitor.integration.test.ts |
| M10, a restart does not follow: when the watched name is restarted, the watcher folds exactly one `DOWN` for the old life and nothing about the new one; a new `monitor` binds the new life under a new ref. 100 runs | test | Effect Arbitrary: ExitReason | bind the watch to the name and move it on `restarted`: M10 red | next/packages/libfabrika/src/runtime/MonitorTest.ts, run by next/packages/libfabrika/src/node/Monitor.integration.test.ts |
| M11, a program that monitors declares `DOWN`: a program whose `cmds` hold `monitor` and whose inputs have no `DOWN` port does not load, `ProgramDown load` with a message naming the port; with the port it loads | test | scenario: two programs, one with the port and one without | load it anyway: M11 red | next/packages/libfabrika/src/runtime/Program.test.ts |
| M12, the shapes: `monitor`'s input is only `{name}`, `demonitor`'s only `{ref}`, their answers are `monitor_ok`, `monitor_err` and `demonitor_ok`, and `ProcessCalls.monitor` takes no `as` | type | type | add `to` to `MonitorInput`, or `as` to `ProcessCalls`: tsc red | next/packages/libfabrika/src/runtime/Monitor.types.test.ts |
| M13, across the objects: on the real Worker runtime, a program in one Process object monitors a program in another, the other exits, and the first folds `monitor_ok` then the `DOWN`. Host-only (workerd): it runs only in CI's scheduled full run, never on the laptop, and before the first review | test | scenario: two programs on one local instance on workerd | route the new calls to the object's own manager, whose recipient is the brain: no DOWN reaches the program, M13 red | next/packages/libfabrika/src/cloudflare/monitor.laws.integration.test.ts |
| M14, today's watches unchanged: P33's monitor laws and the window's monitor at the door stay green with the new optional argument and the new optional keys | test | Effect Arbitrary: Tape | (already planted) | next/packages/libfabrika/src/processes/ProcessMonitors.integration.test.ts |

**Lint, type or test?** M1 to M11 and M13 to M14 are about what a ledger holds and in which order,
which no type or lint rule sees: tests. M12 is a shape: type. No law is lint: no new rule on the
shape of code is needed, since the operands and the trusted argument are held by types.

**Where they run.** The suites run through `node/*.integration.test.ts` on node:sqlite in a temp
folder, so under [0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md) a
pull request leaves them to the schedule; the tests and build steps run those paths narrowly on the
laptop while they work, since they need no real machine, signal or socket. M13 is the one host-only
law: it needs workerd, so it runs in CI's full run only, before the first review, and never on the
owner's Mac.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/runtime/Monitor.ts | build | 80 | new: `monitor`, `demonitor`, their schemas and refusals, the `down` port |
| next/packages/libfabrika/src/processes/Monitors.ts | build | 70 | new: the `Monitors` contract and `MonitorsError` |
| next/packages/libfabrika/src/processes/MonitorsLedger.ts | build | 150 | new: the checks in order, the one turn that writes |
| next/packages/libfabrika/src/processes/internal/member.ts | build | 40 | new: the member pick, moved out of `ChildrenLedger.ts` |
| next/packages/libfabrika/src/processes/ChildrenLedger.ts | build | 20 | reads the member pick from `internal/member.ts` |
| next/packages/libfabrika/src/processes/ProcessManager.ts | build | 30 | `monitor` and `demonitor` take the trusted `as`; `ProcessCalls` keeps three arguments |
| next/packages/libfabrika/src/processes/internal/processTable.ts | build | 6 | `monitored` gains `name` and `member` |
| next/packages/libfabrika/src/processes/Process.ts | build | 4 | `Down` gains `name` |
| next/packages/libfabrika/src/permissions/Model.ts | build | 15 | the `watch` permission and `WatchProcess` |
| next/packages/libfabrika/src/runtime/Runner.ts | build | 70 | `monitor` and `demonitor` as host Cmds, `watch` and `unwatch` performers |
| next/packages/libfabrika/src/runtime/Program.ts | build | 15 | the load check for a `DOWN` port |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 45 | `programMonitor` and `programDemonitor`, the remote `Monitors`, `MonitorsLedger` in the Project |
| next/packages/libfabrika/src/cloudflare/bindings.ts | build | 6 | the two calls' types |
| next/packages/libfabrika/src/cloudflare/platform.ts | build | 8 | the two calls' Promise edges, each one marked line |
| next/packages/libfabrika/src/index.ts | build | 3 | exports `Monitor` and `Monitors` |
| next/packages/libfabrika/src/processes/MonitorsTest.ts | tests | tests | M1, M4, M5, M6 |
| next/packages/libfabrika/src/node/Monitors.integration.test.ts | tests | tests | runs `MonitorsTest` on node:sqlite |
| next/packages/libfabrika/src/runtime/MonitorTest.ts | tests | tests | M2, M3, M7, M8, M9, M10 |
| next/packages/libfabrika/src/node/Monitor.integration.test.ts | tests | tests | runs `MonitorTest` on node:sqlite |
| next/packages/libfabrika/src/runtime/Program.test.ts | tests | tests | M11 |
| next/packages/libfabrika/src/runtime/Monitor.types.test.ts | tests | tests | M12 |
| next/packages/libfabrika/src/cloudflare/monitor.laws.integration.test.ts | tests | tests | M13, CI's full run only |
| next/packages/libfabrika/src/processes/ProcessMonitors.integration.test.ts | tests | tests | M14: stays green; the fixture's new optional argument only |
| .glossary/TERMS.md | build | docs | new rows `monitor (Cmd)` and `demonitor (Cmd)`; `DOWN`, `monitor reference` and `ProcessManager` updated |
| docs/direction/follows/otp.md | build | docs | the "Monitor a registered name" row adds the program Cmd; a new row for who picks the ref |
| next/packages/libfabrika/src/node/StartChild.integration.test.ts | tests | tests | no change: must stay green after the member pick moves |
| layer-rules.json | tests | tests | a row for `processes/Monitors` only if the layer check asks for one; it is an exam path, so the tests step owns it |

Ticket 1039's window path, `client/WindowMachine.ts` and `gateway/Gateway.ts`, does not change.

## Calls taken

Each is mine to decide by the open questions test: it picks how the code does what a note already
says.

- **The words are `monitor` and `demonitor`,** Erlang's, already in the glossary and the OTP table
  ([use the industry's names](../../../docs/direction/use-the-industrys-names.md)). Not "watch",
  which in `next/` already means a client watching a view (`runtime/Watchers.ts`).
- **The ref is the Cmd's own id.** OTP makes the ref, and the glossary says the caller picks one so a
  retry finds the same watch. The Cmd id is both: the runner makes it, it is stable across retries
  (M7), and it is never reused within a life, so today's `bad_ref` (a ref already bound to another
  process) can never happen for a program. A ref the program picked would hit `bad_ref` the second
  time it watched one name after a restart.
- **The brain writes the answer message in the watch's own turn,** as the hands Cmd's answer is
  written by the Project. OTP gets "the answer before the `DOWN`" from a synchronous call; a tea Cmd
  is not synchronous, so without this a watched life that ends between the brain's turn and the
  answer's placement would put the `DOWN` first (M3). The other branch, the runner holding a `DOWN`
  back until its answer folds, would fold the inbox out of position order, which the checkpoint's
  `after` rests on.
- **The `DOWN` carries `name`,** Erlang's `{RegName, Node}`, and the `monitored` row carries `name`
  and `member`: facts that exist only at the watch (see "What fact is lost today").
- **A name never registered is `no_name`; a name whose life ended is a `DOWN noproc`.** Erlang gives
  `noproc` for both. Ours cannot for a name with no life, since a `DOWN` names a process id; `no_name`
  is the answer `send` already gives to the same question. A name with an ended life keeps OTP's
  answer, so a reader that came late learns the end the same way as one that watched in time.
- **A restart does not move the watch.** The Erlang answer, the glossary's ("never follows the name
  to a new life"), and the window tile's today. For pipes, the proposed note's lean is that a pipe
  follows the name; that belongs to the `pipe` Cmd, which can renew its own watch on `restarted`,
  not to this primitive. What following the name here would lose: one `DOWN` per life, the crash
  reason of the life that died, and the rule that a watch binds a process id. What not following
  loses: a program that watches a name in restart backoff gets `noproc` at once and must wait before
  it asks again; the pipe slice, which needs it most, does that brain-side.
- **demonitor is in this slice.** A watch you cannot end is half a tool: a reader that stops caring
  (its pipe is removed, its tile closes) would keep the watch for its whole life, which is ticket
  1039's harm on the program side. The brain's `demonitor` and its flush already exist, so the Cmd is
  about 25 lines.
- **The trusted `as` argument, not a manager per watcher.** The Project builds one manager per window
  session today (`cloudflare/runtime.ts`, `windowManager`). One per watching process would fold the
  table again for each new process and need an eviction nobody calls. An argument only brain-side
  code can pass, and that `ProcessCalls` leaves out, keeps the rule "the recipient is never a public
  field" in types (M12).
- **Ordering relative to the name's data needs no new code.** The `DOWN` is written in the `exited`
  turn, and the brain refuses any later message from that life, so no message from it lands after
  its `DOWN` (M2). The proposed note's fix, that `exit` waits behind an owed `send_chunks`, is about
  not cutting the last value short; it belongs to the pipe slice, and this plan does not build it.
- **A browser is always a client.** Both Cmds are JSON a program returns; the `DOWN` is a JSON
  message in an inbox; the Project calls are the RPC every Process object already uses. No Node, no
  socket, no file. A window already monitors at the door with the same rows.
- **Is this a setting?** No. The ref rule, the order, the refusal order and the no-follow rule are
  what a monitor is. A cap on watches per process would be a setting, but OTP has none and nothing
  measured a need, so there is no cap ([0069](../../../.decisions/0069-choices-are-settings.md)).
- **Typed services only.** The runner reaches `Monitors` as a service; nothing calls a command-line
  tool ([0231](../../../.decisions/0231-ledger-and-codehost-are-separate.md)).

## Validation

- tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3` on
  `next/packages/libfabrika/src/node/Monitors.integration.test.ts`,
  `next/packages/libfabrika/src/node/Monitor.integration.test.ts` and
  `next/packages/libfabrika/src/runtime/Program.test.ts` shows each law red on main, then each plant
  red once the build lands.
- build step: the same paths green, and
  `next/packages/libfabrika/src/processes/ProcessMonitors.integration.test.ts` and
  `next/packages/libfabrika/src/node/StartChild.integration.test.ts` still green.
- The lead runs `--changed origin/main` and one `pnpm typecheck`; M13 runs only in CI's full run.

## Size

1. One pull request: about 540 product lines (MonitorsLedger 150, Monitor 80, Monitors 70, Runner
   70, the Project calls 60, member 40, ProcessManager 30, the rest under 20 each), plus two suites.
   It lands whole: the Cmd is no use without the service, and the service has no caller without the
   Cmd.

About 4 agent hours across the steps, 70% sure. The doubt is M3: the race between the end, the
brain's turn and the answer's placement is in the hardest part of `Runner.ts`, and the hands path
the plan copies may need a send-back to match. Budget basis: ticket 1041's plan
(`docs/plan/lanes/t1041-PLAN.md`), a runner host Cmd of similar size, at 6 steps and $43.

Estimate: 6 steps, $40

## Records

- `field/runs/` rows for each step, by the lead.
- Glossary rows in this pull request: `monitor (Cmd)`, `demonitor (Cmd)`, and the updated `DOWN`
  and `monitor reference` rows.
- No `.decisions/` file: every call here applies a decided note. The pipe note stays proposed.

## What this cannot tell us

- Whether "a restart does not follow" is right for a pipe's reader. The first real pipe line will
  show it; the pipe slice may need the brain to renew its own watch.
- Whether a program that watches a name in restart backoff spins. Nothing stops a program from
  asking again at once after `noproc`; a real program shows whether that needs a wait.
- Whether `WatchProcess`'s first rule (any member may watch) is too loose once there are guests. The
  rule is one value in `Model.ts`, so a smarter one changes only that.
- How a `DOWN` reads to a person. Nothing here draws it.

## Open questions

1. **Should a watch be checked against the member at all?** Lean yes, with the first rule "any
   member may watch any process" and, with no member, only the watcher's own child or starter. Why:
   0526 says every permission is one system, and 0170's principle (check the member behind the
   program, never the program) fits a watch as it fits a start. Cost: one permission in `Model.ts`,
   one check per watch, and the member pick moved to one place. 70% sure. The doubt: OTP checks no
   monitor, and a window already monitors any process at the door with no check past admission, so
   the owner could say "a watch only tells what `ps` tells, check nothing" without breaking a
   decision. The build does not wait: the check is step 4 of six, and dropping it deletes one step
   and law M6.

## Findings

None.

## Amendment A-Workerd, 2026-11-15

Two changes to the files table, found by the tests step after the build. Each replaces what the
table above says where they differ; nothing else in the plan changes.

- **M13 moves to the app.** Its old path, `next/packages/libfabrika/src/cloudflare/monitor.laws.integration.test.ts`,
  cannot start workerd: libfabrika has no code that does, and it may not import the app. The app
  has that setup (`worker-mail.integration.test.ts`, `record-wire.test-support.ts`,
  `port.test-support.ts`), so M13 is written there, in the same shape. Its two programs are source
  text inside the test file, bundled by the real app build, so it needs no fixture file of its own.
- **`brain.ts` forwards the two new Project calls.** The Process object's watch reaches the Project
  over RPC, and on workerd the Project class in the app is what answers it. It forwards
  `programMonitor` and `programDemonitor` to `ProjectService` as it forwards `processChild` and
  `processStop` today. Without them M13 is red on workerd.

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/apps/fabrika/src/worker-monitor.integration.test.ts | tests | tests | M13, on real workerd, CI's full run only; replaces the libfabrika path above |
| next/apps/fabrika/src/brain.ts | build | 10 | `programMonitor` and `programDemonitor` on the Project class, forwarding to `ProjectService` |

## Amendment A-Recheck, 2026-11-15

Found by the second review, after the build that wakes a watcher. The laws table stops at M14, but
the branch holds two more laws, and M13 holds more than its row says. Each row below replaces or adds
to the tables above; nothing else in the plan changes.

- **M13 holds more.** Besides the `monitor_ok` and the `DOWN`, M13 holds a `no_name` refusal and a
  demonitor across the Project's RPC, and its path is the app file amendment A-Workerd names.
- **M15 is new.** A catch-up may fold the brain's saved `monitor_ok` before the runner's settle does.
  The Cmds that step returns must still run once. It holds the `settled` rule in `runtime/Runner.ts`.
- **M16 is new.** On workerd a Process object reads its inbox only once something calls it, so a
  watcher that only waits needs the Project to wake it after the turn that wrote its `DOWN`.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| M13, across the objects: on the real Worker runtime, a program in one Process object is refused `no_name` for a name nobody registered, monitors a program in another by name twice, ends the first watch with a demonitor, and when the other exits folds one `DOWN`, for the watch it kept. Host-only (workerd): CI's scheduled full run only, never on the laptop | test | scenario: two programs on one local instance on workerd | (a) drop the `programDemonitor` forward: tsc and M13 red; (b) make the remote demonitor ignore its ref: the dropped watch's `DOWN` folds, M13 red; (c) answer a refusal as a transport failure: no `monitor_err` folds, M13 red | next/apps/fabrika/src/worker-monitor.integration.test.ts |
| M15, a follow-up runs once: the Cmds a `monitor_ok` step returns run exactly once, whether a catch-up folds the brain's saved answer before the runner's settle or the settle folds it. 100 runs | test | fc.commands: `watch`, `watch_overtake`, `watch_lost`, `end`, `restart`, `wake`; must reach `overtake`, `settle`, `lose_after` and `noproc`; the program is `chaserProgram`, whose `monitor_ok` returns a `ping` | (a) drop the catch-up's handling of its own answer to a pending monitor Cmd: the follow-up never runs, M15 red; (b) run the follow-up twice: M15 red | next/packages/libfabrika/src/runtime/MonitorTest.ts, run by next/packages/libfabrika/src/node/Monitor.integration.test.ts |
| M16, a watcher that only waits: on the real Worker runtime, a watcher that opens no view and gets no call into its object after its watch is set folds the `DOWN` from pushed frames alone, for an exit (`normal`) and for a child its parent ends with `stop_child` (`shutdown`). Host-only (workerd): CI's scheduled full run only | test | scenario: only workerd has an object that sleeps until called | (a) drop the Project's wake after an exit: the exit case red, CI full run 43772292846; (b) drop the wake after a child stop: the stop case red, CI full run 43784614754 | next/apps/fabrika/src/worker-monitor.integration.test.ts |

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 25 | `wakeWatchers`, run after the turn of `exit` and of `stopChild`, wakes each process that watches the life that ended |
| next/apps/fabrika/src/brain.ts | build | 1 | the Project class `implements ProjectBinding`, so a Project call it forgets to forward is a type error |
