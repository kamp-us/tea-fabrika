Approved by the lead agent, builds 0102, 0159, 0069, 0105, 0109, 0171, 0230; body aaa6faccdcae
Plancheck-Version: 3

```ts
// next/, sketch. A program asks the hands with one built-in Cmd, and gets one answer letter back.
const cmd = hands({ command: Command.cases.git_version.make({}) }); // { type: "hands", command }

// The runner saves it as dispatched `P/7/0`, then asks the Project:
//   HandsJobs.ask({ id: "P/7/0", process: P, ... }) -> waiting | finished | refused
// waiting:  nothing to answer yet; the Cmd stays, and no backoff alarm runs.
// finished: the job is marked collected by P, and the runner writes `P/7/0/answer`:
//   { type: "hands_ok", cmd, value: { _tag: "exited", code: 0, version: "..." }, at }
// refused:  `hands.target` is unset, so `P/7/0/answer` is `hands_err` with reason `no_hands`.
// A finish on the gateway wakes the program's name after the write turn, so the next due asks again.
```

# T1040: P39 slice 3, a program's command becomes a saved job, and its result one answer

Writer: the plan step for ticket 1040. Version: `next/` only. Today's version is not touched.

Base read: the worktree at `706bac372` (today's main when the lane started). `origin/main` is at
`ce15d9cb6`, which changed only `docs/plan/` (PR 1307), so every code line cited here holds on both.

Builds [0102](../../../.decisions/0102-hands-is-a-grant-rank-and-work-is-taken.md),
[0103](../../../.decisions/0103-a-program-may-mail-another-by-name.md),
[0105](../../../.decisions/0105-a-durable-object-never-stays-awake-on-its-own.md),
[0069](../../../.decisions/0069-choices-are-settings.md),
[0086](../../../.decisions/0086-settings-are-declared-once.md) and
[brain, hands, window, agent](../../direction/brain-hands-window-agent.md). Row P39 of
[`docs/plan/tier-1.md`](../tier-1.md), umbrella ticket 714.

## What lands

A program declares the built-in Cmd `hands` and returns it with one closed command, today only
`git_version`. The runner saves it as dispatched, as it saves every Cmd, and asks the Project to
keep it as a job request through `Jobs.request`, under the Cmd's own id. When the hands finish that
job (slice 2's `jobs.finish`), the gateway wakes the program's name, the runner reads the saved
result, marks the job `collected` by that exact process, and writes the one answer letter
`<cmd-id>/answer` through its own protected mailbox path. The program folds `hands_ok` with the
typed `Result`, or `hands_err` with `no_hands` when the person set no hands key.

It lands whole: the Cmd, the delivery machine, the runner and Project wiring, the setting, and their
laws. A hands client that runs the command is slice 4. The real `git --version` run end to end is
slice 5. No agent turn. P39 stays open.

I recommend reusing the runner's host-Cmd path (the one `send`, `start_child`, `stop_child` and
`exit` use) and the mail wake (`MailWakeups`, the one `send` uses), not a new queue or a poll.
The cost is a new saved field on a dispatched Cmd and a new event on a job. Confidence: 80%. The
doubt is the size of the `Runner.ts` change, which the tests step will feel first.

## How others do it

- **Elm.** A Cmd is a request for an effect; the runtime performs it and later feeds one Msg back
  to `update`. The program never waits ([Elm guide, commands](https://guide.elm-lang.org/effects/)).
  This slice keeps exactly that: `hands` is a Cmd, `hands_ok` or `hands_err` is its one Msg.
- **OTP `gen_server:call`.** The caller tags its request with a unique ref, monitors the server,
  and waits for `{Ref, Reply}` or `DOWN`; a late reply for a dead caller is dropped, and the default
  timeout is 5 seconds
  ([gen_server](https://www.erlang.org/doc/apps/stdlib/gen_server.html#call/3)). Here the Cmd id
  is the ref, and the answer letter `<cmd-id>/answer` is the tagged reply. Where this leaves OTP: no
  caller blocks, since a Durable Object never stays awake on its own (0105), and there is no
  timeout, since a hands machine may be off for a day; a waiting job stays observable and is never
  reported as success. The "dead caller" rule is kept: a result for a process that has ended is
  never given to its successor (L14).
- **OTP `gen_statem`.** State plus event gives actions and the next state
  ([gen_statem](https://www.erlang.org/doc/system/statem.html)). The delivery is one small tea
  machine with that shape (0037, 0046).
- **Temporal.** An activity's result is recorded in the workflow's own history before the workflow
  code sees it, and a replay reads the recorded result instead of running the activity again
  ([Temporal activities](https://docs.temporal.io/activities)). This is our answer letter in the
  program's inbox: a replay folds the letter and never asks the hands again
  ([0230](../../../.decisions/0230-replay-reruns-code-only.md)).
- **tea 0.25.0** ships `work-queue` and `idempotency` model slices (read in
  `node_modules/@demlik/tea/dist/work-queue/index.d.ts` and `idempotency/index.d.ts`). Both keep a
  pending and done cache inside one program's Model. Not used: here the dedupe is the ledger's own
  ids (one line per id) and the runner's saved dispatched list, which already exist and already
  survive a restart. No upstream patch is proposed.
- **This repo's own pattern.** The built-in `send` is the model: the runner saves it, marks it owed
  (`mail: true`), runs it once at a time, retries it by stable id, and the Project saves the letter
  and wakes the target (`runtime/Runner.ts:224`, `:1582-1615`, `:1870-1879`;
  `runtime/MailDeliveryLive.ts:24-41`; `cloudflare/mail.ts:24-58`; the OTP table's "Send to another
  process" row, `docs/direction/follows/otp.md:20`).

The external links above were not fetched in this session; they are cited from the two earlier P39
plans' reads. Installed versions read in the lockfile: Effect 4.1.2, tea 0.25.0, fast-check
4.10.2, vitest 5.0.5, each with its local patch kept. Effect's installed `AGENTS.md` was
read whole. New code uses `Schema`, `Context.Service`, `Layer.effect`, `Effect.fn` and
`Schema.TaggedError` as it says.

## Where main moved since the five-slice plan

The five-slice plan read main at `4ba80a31b`. What changed for this slice:

- Slice 1 (PR 917) and slice 2 (PR 1146, the batch that carried PR 1074) are on main: `jobs/`,
  `gateway/Jobs.ts`, `gateway/JobAccess.ts`, the `hands` rank, and `Jobs.forProcess`.
- The five-slice plan named `runtime/HandsCommand.ts` and `internal/handsDelivery.ts`. This plan
  keeps `internal/handsDelivery.ts` and splits the rest by 0095: `runtime/Hands.ts` (the Cmd),
  `runtime/HandsJobs.ts` (the contract), `runtime/HandsJobsLive.ts` (its layer).
- The five-slice plan said "Integrate the saved submission and answer path in `Runner.ts`". Main's
  runner has since grown host Cmds and the mail wake (P41, `runtime/Runner.ts:1582-1615`,
  `:2061-2069`), so this slice rides that path instead of a new one.
- P38's settings are on main (`settings/Declarations.ts`, `RecordedStart`). The setting this slice
  adds is declared there and read from `RecordedStart` in the Project, as `gateway.limit` is
  (`next/apps/fabrika/src/runtime.ts:53-55`).
- The five-slice plan's states `pending`, `submitted`, `result`, `answered` become `pending`,
  `waiting`, `result`, `answered` here: `waiting` says what the Cmd is doing, and the job module
  already uses `requested` for the other side.
- The 600-line ceiling is gone (0099).

## Calls the lead made for this plan

These are the lead's, from the brief, and this plan builds them as given:

1. **Which hands key a request targets is a setting, per person, with no default.** An unset one
   starts no work, and the program gets a refusal it can read (0069; 0102 leaves how a person picks
   a host in the app open, and this slice draws nothing). Built as `hands.target`, below.
2. **The delivery records are new ledger rows,** each with every fact it keeps and why. See
   [Records](#records).
3. **A law that needs ports, sockets or a real local instance runs in a container (0045) and is
   named `*.integration.test.ts` (0536).** Nothing here runs on a person's Mac. This slice has no
   law that needs ports or sockets; its SQLite-file twins are `*.integration.test.ts` and run on the
   schedule.

## The shape

### The Cmd a program uses

```ts
// runtime/Hands.ts, new. Like runtime/Send.ts: the Cmd and its input, nothing that runs.
import { Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Command, Result } from "../jobs/Job.ts";

/** What a program may ask the hands to do: one closed command, never shell text. */
export const HandsInput = Schema.Struct({ command: Command });

/** The built-in Cmd. The runner performs it; a program's handler never runs it. */
export const hands = Cmd.make("hands", { input: HandsInput, ok: Result, err: ["no_hands"] });
```

`hands` joins `BUILT_IN` in `runtime/Entry.ts:110`, so `ProgramLoader` never gives a handler for
it, and joins `HOST` in `runtime/Runner.ts:224`, so the runner owes it until it is answered. A
program that returns `hands` without declaring it gets `hands_err` `bad_cmd`, as an undeclared
`send` does today (`runtime/Runner.ts:1587`).

The trusted command declaration lives with the command, in the jobs module:

```ts
// jobs/Job.ts, added. The needs of a command are a fact about it, never a caller's choice.
export const needs = (command: Command): ReadonlyArray<string> =>
  command._tag === "git_version" ? ["git"] : [];
```

### The contract the runner talks to

```ts
// runtime/HandsJobs.ts, new. The contract only (0095).
export const Ask = Schema.Struct({
  /** The dispatched Cmd's id, `<process>/<pos>/<index>`; it is the job's id too. */
  id: Schema.NonEmptyString,
  process: ProcessId,
  /** The registered name, which a finish wakes. */
  name: Schema.NonEmptyString,
  /** The pack-qualified program. */
  program: Schema.NonEmptyString,
  build: Schema.NonEmptyString,
  command: Command,
  parent: Schema.NullOr(ParentText),
  traceId: TraceId,
});

export const Reply = Schema.TaggedUnion({
  /** The job is saved and has no result yet. `rev` and `arrivedAt` are its `requested` event's. */
  waiting: { rev: Rev, arrivedAt: Schema.Int },
  /** The job finished and is now collected by this process. `rev` is the `collected` event's. */
  finished: { result: Result, rev: Rev, arrivedAt: Schema.Int },
  /** No job was made: the person set no `hands.target`. */
  refused: { reason: Schema.Literal("no_hands") },
});

export class HandsJobsError extends Schema.TaggedError<HandsJobsError>()("HandsJobsError", {
  /** `storage`: a ledger write failed. `unavailable`: the call did not come back. `conflict`: the
   *  saved job does not belong to this process. Each leaves the Cmd dispatched. */
  reason: Schema.Literals(["storage", "unavailable", "conflict"]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class HandsJobs extends Context.Service<
  HandsJobs,
  { readonly ask: (ask: typeof Ask.Type, from: From) => Effect.Effect<typeof Reply.Type, HandsJobsError> }
>()("@kampus/libfabrika/runtime/HandsJobs") {}
```

`ask` is one idempotent call that does both halves, so a lost reply is only ever "ask again":

```ts
// runtime/HandsJobsLive.ts, new, sketch. Runs in the Project, beside its Jobs.
export const layer = (options: { readonly target: string | null; readonly settings: string }) =>
  Layer.effect(HandsJobs, Effect.gen(function* () {
    const jobs = yield* Jobs;
    return HandsJobs.of({
      ask: Effect.fn("hands_jobs.ask")(function* (ask, from) {
        const saved = yield* jobs.read(ask.id).pipe(/* not_found -> null */);
        if (saved === null) {
          if (options.target === null) return Reply.cases.refused.make({ reason: "no_hands" });
          const receipt = yield* jobs.request({ ...requestFor(ask), needs: needs(ask.command),
            target: options.target, settings: options.settings }, from);
          return Reply.cases.waiting.make(receipt);
        }
        const s = saved.state;
        if (s._tag !== "finished" && s._tag !== "collected") return Reply.cases.waiting.make(/* requested */);
        const receipt = yield* jobs.collected(ask.id, { process: ask.process, letter: `${ask.id}/answer` }, from);
        return Reply.cases.finished.make({ result: s.result, ...receipt });
      }),
    });
  }));
```

Read first, then request: a retry after the person changed `hands.target` reads the saved job and
never sends other bytes under the same id (which `Jobs.request` would refuse as `conflict`). Every
`ask` runs under the Project's shared write turn, as every job operation does since slice 2, and as
`mail` does (`cloudflare/runtime.ts:1730-1731`).

On the Process side, `cloudflare/hands.ts` supplies `HandsJobs` over a new Project RPC `hands`,
the way `cloudflare/mail.ts:24-58` supplies `ProgramMail`: a reply decodes strictly, and a transport
failure or an undecodable reply becomes `unavailable`, never a refusal.

### The job gains one event

The job machine (`jobs/internal/job.ts`) gains one Msg and one state, so "who got this result" is a
fact on the job itself:

```ts
// jobs/Job.ts, sketch of the additions.
export const Collection = Schema.Struct({ process: ProcessId, letter: Schema.NonEmptyString });

export const State = Schema.TaggedUnion({
  absent: {},
  requested: { request: Request },
  assigned: { request: Request, assignment: Assignment },
  started: { request: Request, assignment: Assignment },
  finished: { request: Request, assignment: Assignment, result: Result },
  collected: { request: Request, assignment: Assignment, result: Result, collection: Collection },
});
// Event's `event` literal gains "collected".

// jobs/internal/job.ts, the new cell, sketch.
collect: (model, { collection }) => {
  const s = model.state;
  if (s._tag === "absent") return refused(model, "not_found");
  if (s._tag !== "finished" && s._tag !== "collected") return refused(model, "wrong_state");
  if (collection.process !== s.request.process) return refused(model, "wrong_process");
  if (s._tag === "finished") return moved(State.cases.collected.make({ ...s, collection }));
  return Equal.equals(s.collection, collection) ? answered(model, REPEATED) : refused(model, "conflict");
},
```

In `collected`, `take`, `start` and `finish` answer as they do in `finished` (repeat or refuse),
so it never leads back to execution. `JobsError` and the machine's `Reason` gain `wrong_process`.
`Jobs` gains `collected(id, collection, recorded) => Receipt`. `JobAccess.select`
(`gateway/JobAccess.ts:40-49`) leaves `collected` jobs out, as it leaves `finished` ones.

### The delivery machine

```ts
// runtime/internal/handsDelivery.ts, new. One hands Cmd's delivery (0037, 0046).
const State = Schema.TaggedUnion({
  /** Saved as dispatched; the Project has not confirmed the request. Owed: the backoff retries it. */
  pending: {},
  /** The Project saved the request; no result yet. Not owed: only a wake or a due asks again. */
  waiting: { rev: Rev, arrivedAt: Schema.Int },
  /** A reply settled it; the answer letter is not placed yet. Never saved: the next ask repeats. */
  result: { answer: Schema.TaggedUnion({ ok: { result: Result }, err: { reason: Schema.Literal("no_hands") } }) },
  /** The answer letter is placed. The runner drops the Cmd when that letter folds. */
  answered: { rev: Rev, pos: Rev },
});

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("replied"), reply: Reply }),
  Schema.Struct({ type: Schema.Literal("failed"), reason: Schema.Literals(["storage", "unavailable", "conflict"]) }),
  Schema.Struct({ type: Schema.Literal("placed"), rev: Rev, pos: Rev }),
]);

// update, with plain conditionals on _tag:
//   pending  + replied waiting  -> waiting
//   pending  + replied finished -> result ok       waiting + replied finished -> result ok
//   pending  + replied refused  -> result err      waiting + replied waiting  -> waiting (same)
//   any      + failed           -> unchanged       result  + placed           -> answered
//   answered + anything         -> unchanged       anything else              -> unchanged
```

The runner saves `pending` or `waiting` on the dispatched Cmd, as a new optional field:

```ts
// runtime/Runner.ts:181, Dispatched gains one optional key. Absent reads as pending.
hands: Schema.optionalKey(Schema.TaggedUnion({ pending: {}, waiting: { rev: Rev, arrivedAt: Schema.Int } })),
```

Only the machine changes it. `owesHostCmd` (`runtime/Runner.ts:227`) stops counting a hands Cmd in
`waiting`, so a waiting job sets no backoff alarm (0105). `due` already runs every `mail: true` Cmd
(`runtime/Runner.ts:2160`), so a waiting hands Cmd is asked again on every wake or timer, which is
cheap: one read in the Project.

### The runner's part

A new branch in `dispatch` (`runtime/Runner.ts:1777-1867`), beside `send`:

1. Not declared, or no `HandsJobs` service: `hands_err` `bad_cmd`, as `send` does.
2. `ask` with the Cmd's facts and `from(job.parent, job.traceId)`.
3. Step the delivery machine with `replied` or `failed`.
4. `waiting`: save the new state on the dispatched Cmd under the permit, answer nothing, return no
   follow-up Cmds. A `failed`: return the error, so the Cmd stays owed and the existing backoff
   applies.
5. `result`: build the answer with the runner's own `ok` or `err` (`runtime/Runner.ts:1467-1484`),
   so `value` is the encoded `Result` and `cmd` echoes the Cmd. Then the existing tail runs: the
   old-life check (`:1824`), `mailbox.send` of `<cmd-id>/answer` with `RunnerMail`, and
   `catchUp(current, { mine: answer })`, which folds it and drops the Cmd (`:1337-1339`).

Nothing waits: the Cmd fiber returns after one `ask`, so the command permit is never held while a
job is out (L20).

### The wake

The gateway's job route (`gateway/Jobs.ts:114-145`) returns, beside its answer, the requester's
registered name when a `jobs.finish` was accepted or repeated. `Gateway.ts:1119-1130` calls
`MailWakeups.wake(name)` after the write turn is released and before it answers. A wake that fails
answers `refused { reason: "unavailable" }`: the result is saved, and the hands client sends the
same finish again, which repeats and wakes again. This is `MailDelivery`'s rule, "queued only after
both" (`runtime/MailDeliveryLive.ts:12-23`). The Project supplies `MailWakeups` with the
implementation `cloudflare/mail.ts:43-55` already has, moved into one exported layer both use.

### What talks to what

| Piece | Where | Layer | Imports |
|---|---|---|---|
| `hands` Cmd, `HandsJobs` contract, live layer, delivery machine | `runtime/` | 6 | jobs, processes, shared |
| `collected` event and `needs` | `jobs/` | 4 | ledger, shared |
| The wake after a finish | `gateway/` | 7 | runtime, jobs |
| RPC adapter, Project RPC, setting read, wiring | `cloudflare/` | 9 | all of the above |
| `hands.target` | `settings/` | 2 | shared |

Every import is allowed by `layer-rules.json` as it stands; no permission widens. `runtime/` still
never imports `ledger/`.

## One value traced through

The program is made up for this example: `check:1`, program `fabrika/check`, process `P`. Its
`update` on input `check` returns `hands({ command: { _tag: "git_version" } })`.

1. The person's file has `[hands] target = "SHA256:H"`. The instance start records the settings
   snapshot, hash `S`.
2. The runner steps `check`, saves the checkpoint with dispatched `P/7/0`: `mail: true`, no `hands`
   key (pending).
3. `dispatch` asks: `ask({ id: "P/7/0", process: P, name: "check:1", ... })`. The Project, in its
   write turn, finds no job, and calls `Jobs.request` with `target: "SHA256:H"`, `needs: ["git"]`,
   `settings: S`. The `requested` event commits at rev 41. **The reply is lost.**
4. The runner gets `HandsJobsError` `unavailable`. The machine stays `pending`. The Cmd stays owed,
   so `setAlarm` sets the backoff alarm (100 ms by the default policy).
5. The alarm's `due` asks again. The Project reads the job, now `requested`, and answers
   `waiting { rev: 41 }`. The machine moves to `waiting`; the runner saves it on `P/7/0`. Nothing is
   owed, so the alarm clears.
6. The hands take, start and finish the job with slice 2's methods:
   `exited { code: 0, version: "git version 2.47.0" }`. The gateway saves the finish, leaves the
   turn, wakes `check:1`, and answers ok. Process `P`'s `mailed` sets the alarm to now.
7. `due` asks again. The job is `finished`; the Project appends `collected { process: P, letter:
   "P/7/0/answer" }` at rev 44 and answers `finished`.
8. The machine moves to `result`. The runner writes `P/7/0/answer`:
   `{ type: "hands_ok", cmd, value: { _tag: "exited", code: 0, version: "git version 2.47.0" }, at }`,
   placed at rev 45. `catchUp` folds it, the program's model moves, `P/7/0` leaves `cmds`, and the
   runner records `stepped:P/7/0/answer`.
9. **A duplicate.** The hands lost the finish's answer and send it again: `repeated`, and the
   gateway wakes `check:1` again. `due` finds no `P/7/0` in `cmds` and asks nothing. Had two dues
   raced in step 7, `sendOnce` runs one at a time, a second `collected` repeats, and a second
   `mailbox.send` under `P/7/0/answer` is one line. The program steps once.
10. **A cut between 7 and 8.** The object dies after rev 44. On the next due, `P/7/0` is still
    `waiting` in the saved checkpoint, `ask` repeats `collected`, and step 8 runs. The result was
    never lost: it is in the job stream the whole time.
11. **An old process.** Had `P` crashed after step 5 and a successor `Q` started, `Q`'s checkpoint
    has no `P/7/0`. The wake in step 6 reaches the object, `Q`'s due asks nothing, and the job stays
    `finished` with its result, never collected. `Q`'s model never changes because of it. A
    `collected` from `Q` would be refused `wrong_process` by the job machine.

With `hands.target` unset, step 3 answers `refused`, no job stream is written, and step 8 writes
`hands_err` with reason `no_hands`.

## Laws

Seed **119120** for every generated law. Each walk reads the state it has reached and picks the
next move from what is possible there: a Cmd really dispatched, a job really finished, a cut at a
real boundary (0093). Shrinking replays the shorter walk. Each walk requires its transition to
happen at least once, so an empty walk cannot pass. The oracle keeps its own record of finished
jobs, placed letters and folded answers; it never calls the product's step function.

Cuts are made with a test layer around `HandsJobs` and `Mailbox` that fails before or after it
delegates, and with the runner's existing `fault` option. Each plant runs once, is recorded and is
undone; no plant is committed.

| Law | Kind | Generator | Plant that must fail | Law lives in | Runs |
|---|---|---|---|---|---|
| L12: request submission survives each runner-to-project cut: after any cut and reopen there is one job under the Cmd id, with its first bytes, and the Cmd stays dispatched until answered | test | fc.commands: pick a dispatched hands Cmd and cut before ask, after the request commits with the reply lost, after the reply before the checkpoint, after `collected` before the letter, or after the letter before the fold; then reopen or due; 100 runs | Give the request a fresh id on each retry, or answer `bad_cmd` after a lost reply | `runtime/RunnerHandsTest.ts` | fast, and its file twin on the schedule |
| L13: one saved result produces one program answer, through duplicate wakes, dues, lost ask replies, lost letter replies and repeated finishes | test | fc.commands: from the current state pick wake, due, lose a reply, repeat a finish or finish a waiting job; 100 runs | Give each delivery a fresh answer id, `<cmd-id>/answer/<n>` | `runtime/RunnerHandsTest.ts` | fast, and its file twin |
| L14: an old process's result never changes its successor: its model, view and inbox stay as if the job never existed, the job stays finished with its result, and a `collected` by the successor is refused | test | fc.commands: restart a process while hands work is pending, waiting or in flight, then finish the job and wake the name; 100 runs | Route the answer by registered name alone: answer any finished job whose request names this name | `runtime/RunnerHandsTest.ts` | fast, and its file twin |
| L20: failed or waiting work in one program leaves another responsive, and leaves the same program's later inputs responsive | test | fc.commands: interleave inputs to two live programs while one's ask fails, is refused or waits forever; 60 runs | Hold the command permit while waiting: poll `ask` inside `dispatch` until it answers finished | `runtime/RunnerHandsTest.ts` | fast |
| R1: the result stays until delivery is confirmed: until the answer letter folds, the job reads `finished` or `collected` with its result and the Cmd stays dispatched; after the fold the Cmd is gone and the job is `collected` by its process | test | fc.commands: finish jobs and cut at each boundary between the finish and the fold; 100 runs | Drop the Cmd from `cmds` when `ask` answers finished, before the letter is placed | `runtime/RunnerHandsTest.ts` | fast, and its file twin |
| D1: the delivery machine never leaves `answered`, never goes from `waiting` back to `pending`, a failure changes nothing, and only `pending` is owed | test | @demlik/tea/pbt.arbGuidedSequence: Msgs picked from the current state on the real `init` and reducer; 100 runs | Let `failed` move `waiting` back to `pending`, so a waiting job re-arms the backoff | `runtime/internal/handsDelivery.test.ts` | fast |
| J1: `collect` is legal only in `finished`, once, by the requesting process; `collected` never leads back to execution; `select` never offers it | test | @demlik/tea/pbt.arbGuidedSequence: job Msgs from the current state, with collect by the requester or another process; 100 runs | Accept `collect` in `started`, or let another process collect | `jobs/internal/job.test.ts` and `gateway/JobAccess.test.ts` | fast |
| J2: a `collected` event survives reopen; an equal retry answers the first receipt; a different collection is refused and writes nothing | test | fc.array: collect and retry over saved finished jobs, with reopen after any commit; 60 runs | Append `collected` without folding first, so a retry writes a second event | `jobs/JobsTest.ts` | file twin only, as the suite runs today |
| S1: an unset `hands.target` writes no job and answers `refused no_hands`, which the program folds as `hands_err`; a set one is the request's `target`, and the snapshot hash its `settings` | test | fc.record: an optional target key, asks and retries, and a target changed between two asks; 100 runs | Fall back to the first live hands key, or rebuild the request on a retry so a changed target is a `conflict` | `runtime/HandsJobsTest.ts` | fast |
| W1: an accepted or repeated `jobs.finish` wakes the requester's name after the write turn and before it answers; a failed wake answers `refused unavailable` and leaves the job finished | test | fc.commands: finish, repeat a finish, or fail the wake, from the current job state; 60 runs | Wake only on the first finish, or wake inside the write turn | `gateway/JobsTest.ts` | file twin, as the suite runs today |
| C1: the Process-side `HandsJobs` over Project RPC turns a lost, failed or undecodable reply into `unavailable`, never a refusal, and decodes a good reply strictly | test | fc.constantFrom: reply cases ok-waiting, ok-finished, refused, transport failure, undecodable, extra field; 60 runs | Map an RPC failure to `refused no_hands` | `cloudflare/hands.test.ts` | fast |
| B1: no program handler and no client input can produce a `hands` answer: `ProgramLoader` gives no handler for `hands`, and a forged `hands_ok` through `process.send` is refused | test | fc.array: program declarations and inputs that try a handler named `hands` or send a forged answer; 60 runs | Take `hands` out of `BUILT_IN` | `runtime/RunnerHandsTest.ts` | fast |
| T1: `HandsJobs` speaks its own error and shared names only, never `JobsError` or `LedgerError` | type | type | Put `JobsError` in `ask`'s error channel | `runtime/HandsJobs.types.test.ts` | typecheck |
| K1: `runtime/` imports jobs and processes, never ledger; transport imports no jobs | lint | lint | Import `ledger/Ledger.ts` in `runtime/HandsJobsLive.ts` | existing `pnpm lint:layers` | lint |

The four rules map onto these laws:

| Rule | Law |
|---|---|
| The result stays until delivery is confirmed | R1, J2 |
| A lost reply is delivered again under the same id | L12, L13 |
| A duplicate never steps the program twice | L13 |
| An old process's answer never enters its successor | L14, J1 |

"Fast" means the suite runs on in-memory layers on the merge line (0536): `node:sqlite` at
`:memory:`, opened and closed in a scope, as `ledger/LedgerTransaction.test.ts:14-18` does. "File
twin" means the same suite on SQLite files in a `*.integration.test.ts` runner on the 3-hour
schedule. No law here needs a port, a socket, workerd or a container. No law is host-only, and
nothing runs on a person's Mac.

The existing job, gateway, runner and mail laws stay as they are. This slice adds cases to them; it
narrows none.

## Files

Product lines count additions and deletions.

| File | Change | Product lines expected | Owner |
|---|---|---|---|
| `next/packages/libfabrika/src/runtime/Hands.ts` | New: the `hands` Cmd and its input | 30 | build |
| `next/packages/libfabrika/src/runtime/HandsJobs.ts` | New: the contract, `Ask`, `Reply`, `HandsJobsError` | 70 | build |
| `next/packages/libfabrika/src/runtime/HandsJobsLive.ts` | New: read-then-request-or-collect over `Jobs` | 80 | build |
| `next/packages/libfabrika/src/runtime/internal/handsDelivery.ts` | New: the delivery tea machine | 75 | build |
| `next/packages/libfabrika/src/runtime/Runner.ts` | `hands` in `HOST`, `hands` key on `Dispatched`, `owesHostCmd`, the dispatch branch, saving `waiting` | 130 | build |
| `next/packages/libfabrika/src/runtime/Entry.ts` | `hands` joins `BUILT_IN` | 2 | build |
| `next/packages/libfabrika/src/jobs/Job.ts` | `Collection`, the `collected` state and event, `needs` | 30 | build |
| `next/packages/libfabrika/src/jobs/Jobs.ts` | `collected` method, `wrong_process` reason | 12 | build |
| `next/packages/libfabrika/src/jobs/internal/job.ts` | `collect` cell; `collected` answers like `finished` elsewhere | 40 | build |
| `next/packages/libfabrika/src/jobs/JobsLedger.ts` | `collected` stored case, its Msg, the method | 25 | build |
| `next/packages/libfabrika/src/gateway/JobAccess.ts` | `select` leaves `collected` out | 3 | build |
| `next/packages/libfabrika/src/gateway/Jobs.ts` | Return the requester's name after an ok finish | 15 | build |
| `next/packages/libfabrika/src/gateway/Gateway.ts` | Require `MailWakeups`; wake after the turn, before the answer | 25 | build |
| `next/packages/libfabrika/src/settings/Declarations.ts` | `hands.target`, joined to `all` | 20 | build |
| `next/packages/libfabrika/src/cloudflare/hands.ts` | New: Process-side `HandsJobs` over Project RPC | 55 | build |
| `next/packages/libfabrika/src/cloudflare/mail.ts` | Export the `MailWakeups` layer both mail and the gateway use | 12 | build |
| `next/packages/libfabrika/src/cloudflare/bindings.ts` | `hands` on the Project binding, its reply schema | 25 | build |
| `next/packages/libfabrika/src/cloudflare/platform.ts` | `hands` on `ProjectClient` | 6 | build |
| `next/packages/libfabrika/src/cloudflare/runtime.ts` | Project: `HandsJobsLive` from `RecordedStart`, the `hands` call under `write`, `MailWakeups` for the door; Process: the remote layer | 60 | build |
| `next/apps/fabrika/src/brain.ts` | One forwarding `hands` method on the Project class, one marked Promise edge | 5 | build |
| `next/apps/fabrika/person.json` | Regenerated by `settings-generate.ts` | generated | build |
| `docs/settings-reference.md` | Regenerated by `settings-generate.ts` | generated | build |
| `next/packages/libfabrika/src/runtime/RunnerHandsTest.ts` | New suite: L12, L13, L14, L20, R1, B1 | tests | tests |
| `next/packages/libfabrika/src/runtime/HandsJobsTest.ts` | New suite: S1 | tests | tests |
| `next/packages/libfabrika/src/runtime/internal/handsDelivery.test.ts` | New: D1 | tests | tests |
| `next/packages/libfabrika/src/runtime/HandsJobs.types.test.ts` | New: T1 | tests | tests |
| `next/packages/libfabrika/src/node/runtime/RunnerHands.test.ts` | New: runs both suites on `:memory:` | tests | tests |
| `next/packages/libfabrika/src/node/runtime/RunnerHands.integration.test.ts` | New: runs both suites on files, on the schedule | tests | tests |
| `next/packages/libfabrika/src/cloudflare/hands.test.ts` | New: C1 | tests | tests |
| `next/packages/libfabrika/src/jobs/internal/job.test.ts` | Extend: J1 | tests | tests |
| `next/packages/libfabrika/src/jobs/JobsTest.ts` | Extend: J2 | tests | tests |
| `next/packages/libfabrika/src/jobs/Job.test.ts` | Extend: the new state and event round-trip | tests | tests |
| `next/packages/libfabrika/src/jobs/Jobs.types.test.ts` | Extend: `collected` in the contract | tests | tests |
| `next/packages/libfabrika/src/gateway/JobAccess.test.ts` | Extend: J1's `select` half | tests | tests |
| `next/packages/libfabrika/src/gateway/JobsTest.ts` | Extend: W1; supply `MailWakeups` | tests | tests |
| `next/packages/libfabrika/src/node/gateway/Jobs.integration.test.ts` | Supply `MailWakeups` | tests | tests |
| `next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts` | Supply `MailWakeups`; keep assertions | tests | tests |
| `next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts` | Supply `MailWakeups`; keep assertions | tests | tests |
| `next/apps/fabrika/src/door.integration.test.ts` | Supply `MailWakeups` in its shared settings; keep assertions | tests | tests |
| `next/apps/fabrika/src/door-recovery.integration.test.ts` | Supply `MailWakeups`; keep assertions | tests | tests |
| `next/apps/fabrika/src/door-spans.test.ts` | Supply `MailWakeups`; keep assertions | tests | tests |
| `next/apps/fabrika/src/exam/agent-may.test.ts` | Supply `MailWakeups`; keep assertions | tests | tests |
| `next/apps/fabrika/src/exam/runner-contract-replay.test.ts` | Supply `MailWakeups`; keep assertions | tests | tests |
| `next/apps/fabrika/e2e/chaos-revoke.worker.test-support.ts` | Supply `MailWakeups` | tests | tests |
| `next/packages/libfabrika/src/settings/StartsTest.ts` | The full values list gains `handsTarget` | tests | tests |
| `next/packages/libfabrika/src/settings/Start.test.ts` | The declared paths list gains `hands.target` | tests | tests |
| `next/packages/libfabrika/src/cloudflare/SettingsInput.test.ts` | The values it builds gain `handsTarget` | tests | tests |
| `next/apps/fabrika/src/settings-generated.test.ts` | Read-only: must pass on the regenerated files | 0 | tests |
| `fixtures/next/port-home`, `fixtures/next/port-home/` | Only if a law decodes its saved `INSTANCE` with the new declarations: regenerate it (see below) | tests | tests |
| `layer-rules.json` | Read-only import check; no change | 0 | tests |
| `next/apps/fabrika/src/exam/layers.test.ts` | Read-only boundary check; no change | 0 | tests |
| `docs/direction/follows/otp.md` | New row: "A call that waits on the hands", same as `gen_server:call`'s ref, differs on blocking and timeout | docs | lead |
| `.glossary/TERMS.md` | Rows: `hands (Cmd)`, `collected (job)`, `hands.target` | docs | lead |
| `docs/plan/tier-1.md` | P39: slice 3 landed; row stays open | docs | lead |
| `docs/plan/README.md` | Where we are now | docs | lead |

The test files that build `Gateway.layer` were found with `rg -n "Gateway\.layer\(" next` at the
base. The tests step reruns that search before it starts and adds any new call site to its own
list; supplying a required service there keeps every assertion.

One more file may need the tests step: the saved Alchemy state of the port-home fixture, under
`fixtures/next/port-home/`, holds an `INSTANCE` written with today's nine settings. If a law decodes
it with the new declarations, the tests step regenerates it in the same commit and names it in its
report; if none does, it stays.

### Its edges

- **Must not touch:** `transport/Wire.ts` (ticket 922's `Who`), `access/`, `jobs.take`'s
  selection beyond leaving `collected` out, `JobsLedger.forProcess`, the gateway's take and read
  routes, today's version, and any program under `next/programs/`.
- **Ticket 1030** (`Jobs.forProcess` reads every job of every process): this slice avoids it. The
  runner asks by id with `Jobs.read`, never `forProcess`. The new `collected` jobs still sit in
  `job:` streams, so 1030's scan grows by the same jobs it already reads; nothing new depends on it.
- **Ticket 922** (`Wire.ts`'s `Who` misses hands): avoided. No new wire identity is added; the only
  wire change is the meaning of the `unavailable` refusal on `jobs.finish`.
- **What slice 4 needs from this slice:** `jobs.finish` answers ok only after the requester is
  woken, and `refused unavailable` means "saved; send the same finish again". The hands client
  keeps its local result until it gets that ok. Slice 4 needs no new field from these rows.
- **What slice 5 needs:** a real pack whose program returns `hands`, which this slice makes possible
  and does not add.

## Is this a setting?

| Choice | Setting? | Answer and why |
|---|---|---|
| Which hands key a request targets | Yes | `hands.target`, scope `["person"]`, reload `restart`, since `0.0.0`, schema a non-empty key fingerprint or `null`. `Setting.make` requires a default (`settings/Setting.ts`), so the default is `null`, meaning unset: TOML has no null, so a person sets it by writing the key and unsets it by leaving it out. The lead's call |
| Retry spacing after a lost reply | No new one | The runner's existing backoff, `policy.backoff.minMs`, already a declared program or wiring policy (`runtime/Runner.ts:546-549`). A waiting job has no retry: it is asked on a wake |
| A timeout on a waiting job | No | There is no timeout behavior in this slice. A job waits and stays observable until the hands finish it or a person reopens it (0102). A timeout would be a new choice, and a setting, in the slice that adds it |
| A cap on saved results | No | Results live in job streams on the ledger, which keeps every stream (C5). `Result` is a closed schema; slice 4's `output_limit` bounds its text |
| The Cmd name and its one command | No | The implemented contract, not a choice between implemented behaviors |
| `needs` of a command | No | A fact about the command, kept beside it |
| Who may make a program's request | No | Authority, not a switch; see the calls to look at twice |
| Waking on finish | No | The protocol (0103's "saves the mail before it schedules the target") |

## Records

Facts that exist only when they happen, kept now:

| Row | Where | Keeps | Why |
|---|---|---|---|
| `requested` (slice 1's event, now written from this path) | `job:<cmd-id>` | The request: Cmd id, exact process, registered name, pack-qualified program, command, `needs`, `target`, program build, settings hash, parent input, trace. The writer: `by` and `for` (the process owner's key and person), `sentAt` (the runner's clock), `seen`, `parent`, `traceId`, `build`. The referee's `rev` and `arrivedAt` | Which process and build asked, for whom, caused by which input, and which settings chose the host: none of it can be rebuilt later |
| `collected` (new) | `job:<cmd-id>` | `process` (the generation that took the result), `letter` (the answer letter's id), the same writer facts, `rev`, `arrivedAt` | Which result went to which process generation, and when, on the job itself |
| The answer letter (existing line, new body) | `<name>/inbox`, id `<cmd-id>/answer` | `m`: `hands_ok` with the typed `Result` and the Cmd echo, or `hands_err` with its reason, and `at` (the runner's clock); the line's `by`, `for`, `sentAt`, `seen`, `parent`, `traceId`, `build`; its `rev` and `pos` | The program's recorded input: a replay folds it and never asks the hands again (0230). A refusal for an unset `hands.target` is kept here, the only row it gets |
| `stepped:<cmd-id>/answer` (existing) | the process's own stream | The input, its `pos`, the build that folded it, and the writer facts | The confirmation that the answer folded: the delivery is done |
| `cmd.answered` (existing) | the old process's stream | The answer, the Cmd id, the old build | When an answer is in flight across a restart, the old life keeps it, as today (`runtime/Runner.ts:1824-1845`) |

Would a later slice need a field these rows can never get? I checked each against slices 4 and 5
and Tier 4's leases and found none: slice 4 reads only the job's own events; slice 5 reads the
program's view; a future re-wake sweep needs "finished and not collected", which is the job's state.
One fact is not a row: how many times a lost reply was asked again. Each `ask` is its own span with
the Cmd id (`runner.cmd`, `hands_jobs.ask`), and spans are kept (P37), so the count can be rebuilt.

No secret is in any of these rows: a key fingerprint is public. Each step records its run and plant
results in `field/` the same day.

## Validation

A boxed step runs its own narrow vitest paths under the repo's caps, its plants once each, and
`pnpm lint`. The lead runs `--changed` once, one `pnpm typecheck`, the leak check, ownership and
`loosening.sh`, and reads the new Promise edge in `next/apps/fabrika/src/brain.ts`. CI runs the
file twins on the schedule. No container and no host step is needed.

This plan step ran no tests and changed no file but this plan.

## Size

One pull request: about 760 product lines, 1,600 test lines and 40 doc lines, about 2 to 3 agent
hours. Confidence: 70%. The runner's dispatch branch and the test-file ripple of a required gateway
service carry most of the doubt; a settings fixture that decodes an old saved start could add more.

1. **A program's command becomes a saved job, and its result one answer: 760 lines.** The Cmd, the
   delivery machine, the `HandsJobs` contract and both layers, the `collected` event, the wake after
   a finish, `hands.target`, and the wiring, with laws L12, L13, L14, L20, R1, D1, J1, J2, S1, W1,
   C1, B1, T1 and K1.

Budget basis: `field/runs.jsonl` list-price medians of $1.14 for 131 tests steps, $1.24 for 62 build
steps and $1.17 for 72 reviews, with maxima from $3.69 to $9.41. This slice touches the runner, so
allow tests, build, review, one fix round and one recheck, each well above the median.

Estimate: 5 steps, $15

## What this cannot tell us

- Whether the real Worker path, two Durable Objects and a real WebSocket, delivers the answer. The
  Cloudflare adapters are tested in Node at their RPC handles, as `cloudflare/mail.test.ts` does.
  The real path waits for slice 5's program (law L18 of the five-slice plan).
- Whether a hands client honors `refused unavailable` on a finish. Slice 4 builds that client.
- What happens to a finished job whose process ended before collecting it, past "it stays finished
  with its result". Nothing sweeps it. That is correct for the rules, and a person sees it with
  `jobs.read`.
- Whether adding a declared setting breaks a saved start input written before it. The strict check
  (`cloudflare/SettingsInput.ts:28-40`) needs every declared path, so an `INSTANCE` saved by an
  older build fails to decode. Each dev start writes a new one, so I expect no break in daily use,
  but I did not run it.
- How long a real hands job waits, so whether "asked again on every due" costs anything measurable.
  The ask is one read; the first real numbers come in slice 5.

## Calls the lead should look at twice

1. **No new permission on who may ask the hands.** A program that declares `hands` reaches the
   instance's `hands.target`, whoever's input started it. I built on 0171 (make it work, then
   better, then secure; a first slice does not defend against a person's own agents) and Tier 1's
   one-person scope. Under 0526 a "may ask these hands" right would be a relation row in the one
   ReBAC model; that belongs with the second person (Tier 3). Confidence: 75%.
2. **The gateway requires `MailWakeups`,** which touches about ten test files that build
   `Gateway.layer`. The other way, an optional wake, hides a required dependency, which slice 2 ruled
   out for `Jobs`. Confidence: 85%.
3. **A failed wake answers `refused unavailable` on `jobs.finish`.** It gives an existing reason
   word a meaning slice 4 must follow. Confidence: 80%.
4. **The Cmd is named `hands` and the new job event `collected`.** "job" already means two things
   in the glossary, so the Cmd is not `job`. `collected` says what happened: the result was taken by
   its process; the letter fold, already recorded as `stepped`, is the confirmation.
   Confidence: 70%.
5. **The delivery state is a new optional key on a saved dispatched Cmd,** not a new table.
   Checkpoints saved before this slice have no hands Cmds, so the absent key reads as `pending` and
   nothing is migrated. Confidence: 85%.

## Open questions

None.

Searched first: `.decisions/` (0102, 0103, 0105, 0069, 0086, 0171, 0230, 0526, 0531, 0536, 0045,
0099), `docs/direction/brain-hands-window-agent.md`, `docs/direction/settings.md`,
`docs/direction/follows/otp.md`, `.glossary/TERMS.md` (job, hands, hands key, Cmd, dispatched,
letter, mailed, process), and `docs/plan/tier-1.md`'s P39 row. Each place this plan had to choose,
a decided note or the lead's call answered it, as the sections above cite. Who may ask the hands
is answered by 0171 for this tier, so it is listed above for the lead, not here.

## Findings

None outside this ticket's scope.
