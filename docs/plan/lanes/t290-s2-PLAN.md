Approved by the lead agent, builds Tier 1's P18 row (the OTP answer of 2026-11-13) and the browser note's C5; body 792fd3088c22
Plancheck-Version: 3
# Plan: ticket 290, P18 slice 2: a tile monitors its process and follows the restart

This is about `next/`. Every path is checked against `origin/main` at `af9e494f2`. Installed: effect
4.1.2, `@demlik/tea` 0.25.0 (patched), vitest 5.0.5, fast-check 4.10.2, playwright 1.64.1.

```ts
// The whole idea. A window monitors the pid its tile shows; the DOWN lands in its own inbox; the
// tile looks the name up again and monitors the successor with a fresh ref, as erlang:monitor/2
// resolves a registered name once and never follows it.
read  processes/checklist:1 after 0   -> live A        // the window's whereis
write process.monitor {ref: "w9", pid: A}              // to = {client: tab, session}, from the door
write view.open {pid: A}
// A crashes. One brain turn writes `exited` and the DOWN:
client:tab_01k…/inbox  ["DOWN", to, "w9", 1]  {_tag: "DOWN", ref: "w9", process: A, reason: {_tag: "crashed", …}, to}
// The window's parked ledger.wait on its inbox wakes; it reads the DOWN; the tile reads the name again:
read  processes/checklist:1 after 0   -> no live life, newest exit A crashed  -> "Ended (crashed)", wait
// The supervisor writes `restarted {process: B, after: A}`; the wait wakes; the tile reads again:
read  processes/checklist:1 after 0   -> live B
write process.monitor {ref: "w16", pid: B} ; view.open {pid: B}   // fresh ref, never "w9"
```

## The answer

Slice 2 makes a tile follow its process across restarts, the OTP way.

- The window parent monitors each pid it resolves, before it opens it, under a ref it has never
  used. The door fills in the recipient from the checked connection: the window's tab id and the
  socket's session id. Params never name it.
- The window reads its own inbox, `client:<tab>/inbox`, with the protocol's existing `ledger.wait`
  and `ledger.read`, and keeps a cursor. A browser can do this: it is plain JSON-RPC text.
- On a DOWN for a tile's current ref and pid, the tile reads `processes/<name>` again, every page.
  A live successor is monitored and opened. No live process shows `Ended` and the reason in the
  title bar, the one word `Ended` in the body where the last view was, and parks a `ledger.wait` on
  the name's stream until the next start.
- When a socket closes, the brain ends that session's watches with `watcher_exited`, as OTP ends a
  dead watcher's monitors.
- `keep` and closing a tile stay in slice 4. Until then every tile whose process ended stays, with
  its reason.

## What I read, and what runs today

- **The row:** `docs/plan/tier-1.md`, P18. Slice 2 is answered by OTP (2026-11-13): each restart
  is a new process id, a monitor never follows the name, and a surviving tile looks the name up
  again and monitors the process it finds with a fresh ref. From P33: the window's monitor names
  its exact client session, and its DOWN lands in `client:<id>/inbox`.
- **Decided notes:** [0276](../../../.decisions/0276-a-tile-shows-one-process.md) (a tile shows one
  process, monitored as OTP monitors, then follows its `keep`); the desktop layer's W3
  (`docs/direction/the-desktop-layer.md`); [a browser is always a
  client](../../direction/a-browser-is-always-a-client.md); the five layers' C5
  (`docs/direction/a-local-first-sync-engine.md`, lines 539 to 577: "a browser reads its `DOWN`s
  from `client:<id>/inbox` like any letter"); `docs/plan/tier-1-detail.md`, "Processes, as P33
  built it" ("P18 binds a window's monitor to its exact client session");
  `docs/direction/follows/otp.md`; the glossary's DOWN, monitor reference, recipient life,
  ProcessManager and processes rows. The settled search found nothing that decides the window side
  in any other way.
- **The window as built (slice 1, PR 1208):** `client/WindowMachine.ts` is one tea machine
  factory. A tile's `reach` is `unresolved | resolving {id} | opening {pid, id} | open {pid} |
  missing`. Going online reads each tile's `processes/<name>` from 0 and opens the pid
  `C.resolveName` finds. The pid is only looked up again after a reconnect. Nothing monitors it,
  so a restart today leaves the tile on a dead pid until the next reconnect, and every press is
  refused.
- **The brain as built:** `ProcessManager.monitor(ref, process, from)` writes `monitored` and, for
  a gone target, a `noproc` DOWN in the same turn. `exit` writes one DOWN per live watch into the
  recipient's inbox (`client:<client>/inbox` for a client) under `signalId(to, ref, round)`. A
  watch is keyed by recipient and ref; the same ref on another pid is `bad_ref`. A client id must
  match `^[a-z0-9][a-z0-9._-]*$` (`processes/Process.ts`, `ClientId`). The recipient is fixed when
  the layer is built: the Project builds one ProcessManager whose recipient is `{client: "brain"}`
  (`cloudflare/runtime.ts:652-659`).
- **The door has no monitor method.** Its public set is `process.send`, `view.open`,
  `ledger.read`, `ledger.wait`, `spans.*` and `gateway.watch` and `gateway.deny`
  (`gateway/Gateway.ts:250-260`). A window can already read any stream and park a `ledger.wait`;
  the Doorbell rings the parked wait when its stream gets an entry, a DOWN included.
- **What the door knows of a connection:** its `ConnectionId` (random base64url, so it has capital
  letters and is no client id) and, at `initialize`, a trusted `{url, tab, name}` from the
  connection object (`cloudflare/connection.ts:95-104`). The tab is `Id.Tab` (`tab_<26>`, lower
  case) and the hello's signature covers it (`helloText({url, tab, nonce})`). The connection
  object also has the socket's session, a fresh process id per socket, in its tags; it hands that
  to `register`, `join` and `leave`, but not to `initialize`.
- **Watches outlive a socket today.** `exit` ends only process recipients' watches
  (`table.outbound`). Nothing ends a client session's watches, so every reconnect would leave its
  watches live, and every later exit would write DOWNs no one reads.
- **Paging:** `ledger.read` answers at most `PAGE` = 256 entries (`ledger/Log.ts:221`). A name has
  about two entries per life, so past about 128 lives the first page no longer shows the newest
  life. Slice 1 reads one page. With restarts followed, that would loop: the first page's live pid
  is dead, the monitor answers `noproc`, the tile reads the same page again.

## How others do it

- **OTP, monitor by name.** `erlang:monitor(process, Name)` resolves a registered name once, at the
  call, and monitors that pid. A later re-registration is not followed; a name with no process gives
  `DOWN` with `noproc` at once ([erlang docs](https://www.erlang.org/doc/apps/erts/erlang.html),
  the source the OTP table cites; not fetched this session). The caller that needs the successor
  calls `whereis/1` again after the `DOWN` and monitors the new pid. That is exactly this slice.
- **OTP, a watcher that ends.** Its monitors go with it
  ([processes](https://www.erlang.org/doc/system/ref_man_processes.html), as the OTP table's row
  says). A socket's session is the watcher here, so its close ends its watches.
- **Elm.** An outside answer reaches `update` as a Msg. A long poll is a chain of Cmds: each answer
  is a Msg whose handler issues the next request. The window already speaks to the brain only
  through its `write` Cmd and decoded answer frames, so the inbox is one more such chain, not a new
  Sub. Parents step children by hand: each tile's reach is a field the parent's `update` changes.
- **Kubernetes, list then watch.** A client lists, keeps the `resourceVersion`, and watches from
  it; when the watch ends it lists again (not fetched this session). The inbox cursor is the
  `resourceVersion`; reading `processes/<name>` from 0 after a DOWN is the re-list.
- **0040, existing tools first.** No new transport: `ledger.wait` and `ledger.read` already do the
  long poll, and the Doorbell already rings it.

Where this departs from OTP, and why:

- **The window resolves the name itself,** by reading `processes/<name>`, and then monitors the
  pid. OTP's `monitor(process, Name)` does the lookup inside the call. Here `status(name)` is the
  `whereis`, but it is owner-gated, and a window owns no name. The read gives the same answer, with
  the exit reason too.
- **A DOWN is read from a durable inbox,** not taken as a signal: a browser has no pid
  (the OTP table's "Signals" row, already decided).

## The shape

### 1. The door: `process.monitor`, with the recipient from the hello (`gateway/Gateway.ts`)

```ts
// The public params are exactly these two keys; any other key is bad_input.
const Monitor = Schema.Struct({ ref: Text, pid: ProcessId }); // Text: non-empty, at most 256

// A door option, like `open`. The Project supplies it; the door never builds a recipient from params.
readonly monitor?: (
  ref: string,
  pid: string,
  to: typeof Recipient.cases.client.Type,
  from: From,
) => Effect.Effect<void, ProcessError | LedgerError, RDeliver>;

// initialize's trusted input gains the socket's session. The connection object passes it.
trusted: { readonly url: string; readonly tab: string; readonly name: string; readonly session?: string }
// On an admitted hello, the door saves `recipient/<ConnectionId>` beside `client/<ConnectionId>`:
Recipient.cases.client.make({ client: trusted.tab, session: trusted.session })
// and deletes it wherever it deletes `client/` and `key/` (a reconnect's challenge, the pending prune).

// In the routed block, after view.open:
if (method === "process.monitor" && options.monitor !== undefined) {
  const asked = Schema.decodeUnknownResult(Monitor, { onExcessProperty: "error" })(params);
  if (Result.isFailure(asked)) return no("bad_input");
  const to = yield* store.atomic(() => store.get(`recipient/${client}`, ClientRecipient));
  if (to === null) return no("no_session");
  return yield* options.monitor(asked.success.ref, asked.success.pid, to, fromBinding(binding)).pipe(
    Effect.as(ok(null)),
    Effect.catchTag("ProcessError", (e) => Effect.succeed(no(e.reason))),
  );
}
```

- `process.monitor` joins `methods`. Hands are refused `not_allowed`, as for every method past
  that check.
- `from` comes from the call's own binding, as `process.send`'s envelope does: its `by`, `for`,
  `sentAt`, and the binding id as `parent`. ProcessManager stamps the brain's `by` and keeps the
  window's key as `asked`.
- `session` is optional because a door started without a socket (the door laws, the exam's runner
  contract and the control endpoint) has none. Such a door answers `no_session`. Every real socket
  has one: `cloudflare/connection.ts` passes it.
- No `process.demonitor` yet: nothing in this slice cancels a watch. Slice 4 adds it with closing
  a tile.

### 2. The brain: a session's own ProcessManager, and `leave` (`processes/`, `cloudflare/runtime.ts`)

```ts
// processes/ProcessManager.ts, one new member
/**
 * Ends every live watch whose recipient is the client session `session`, as a watcher's exit
 * ends its watches: each gets `demonitored {reason: "watcher_exited"}`. With none it writes nothing.
 */
readonly leave: (session: string, from: From) => Effect.Effect<void, Failure>;

// processes/Process.ts, the table's query beside `outbound`
held(session: string): ReadonlyArray<Watch> // live watches with to._tag === "client" && to.session === session

// cloudflare/runtime.ts, the door options. The session's own caller: its owner is its own pid,
// which registered no name, so any owner-gated call through it is `not_parent`.
monitor: (ref, pid, to, from) =>
  write(
    ProcessManager.use((own) => own.monitor(ref, pid, from)).pipe(
      Effect.provide(
        ProcessManager.layer({ by, owner: Owner.cases.process.make({ process: to.session }), recipient: to }, ids.next),
      ),
      Effect.provideContext(services),
    ),
  ),
// and Project.leave(client, session), which a socket's close already calls, also runs:
yield* wrapped(write(processes.leave(session, brainFrom)));
```

- Why a layer per call and not a recipient argument: the glossary's rule is that the caller's
  checked identity supplies the recipient through the wiring. `ProcessManager.layer` already takes
  that wiring, so its contract stays as P33 wrote it. Building the layer costs one read of the
  `LedgerTransaction` service.
- The session's id is a process id from the same generator as every process (`ids.next` in the
  connection object), and the glossary calls it "one connection's process ID". So `Owner.process`
  with it is a true statement, not a stand-in.
- `write` holds the Project's turn and sends the Doorbell's rings after it, so a `noproc` DOWN wakes
  the window's parked inbox wait.

### 3. The window parent (`client/WindowMachine.ts`)

```ts
const Reach = Schema.TaggedUnion({
  unresolved: {},
  resolving: { id: Schema.Int, fold: C.NameFold },             // reading processes/<name>, page by page
  opening: { pid: Schema.String, id: Schema.Int, ref: Schema.String },
  open: { pid: Schema.String, ref: Schema.String },              // the watch this tile holds
  ended: { pid: Schema.String, reason: ExitReason, id: Schema.Int }, // no live process; a wait under `id`
  missing: {},
});

// The window's own inbox, read with a cursor. One call in flight at most.
const Inbox = Schema.TaggedUnion({
  idle: { after: Schema.Int },                   // offline, or after an error
  waiting: { after: Schema.Int, id: Schema.Int }, // ledger.wait on client:<tab>/inbox past `after`
  reading: { after: Schema.Int, id: Schema.Int }, // ledger.read on it past `after`
});

// WindowModel gains:  tab: Schema.String,  inbox: Inbox
// ctx gains `tab`:    { tiles: [{id, name}], tab }   (WindowStart already makes the tab)
const Call = Schema.TaggedUnion({
  read: { stream: Schema.String, after: Schema.Int },      // processes/<name> and the inbox alike
  wait: { stream: Schema.String, after: Schema.Int },      // new: ledger.wait
  monitor: { ref: Schema.String, pid: Schema.String },     // new: process.monitor
  open: { pid: Schema.String },
  send: { /* unchanged */ },
  knock: {},
});
// New Msgs from answer frames, through answerTo as the others: wait_ok {value: {rev}}, wait_err,
// monitor_ok {value: null}, monitor_err. read_ok routes by its flight: the inbox's id, or a tile's.
```

The steps, each in `update`:

| Msg | When | Then |
|---|---|---|
| link goes online | always | as slice 1, plus one `wait {stream: inbox, after}` and inbox `waiting` |
| `read_ok` for a tile | `resolving {id, fold}` | fold the page with `C.foldName`. A full page (`PAGE` entries) reads the next page after its last rev. Else decide: `live` → `monitor {ref: "w" + id, pid}` then `open {pid}`, reach `opening {pid, id, ref}`; no live but `ended` → `wait {stream: processes/<name>, after: fold.after}`, reach `ended`; neither → `missing` |
| `wait_ok` for a tile | `ended {id}` | reach `resolving`, read `processes/<name>` after 0 |
| `wait_ok` for the inbox | `waiting {id}` | `read {stream: inbox, after}`, inbox `reading` |
| `read_ok` for the inbox | `reading {id}` | take each DOWN (below), cursor = highest rev seen, never lower; then `wait` again |
| a DOWN taken | a tile `opening` or `open` with this `ref` and `pid` | that tile `resolving`, read `processes/<name>` after 0, one `down` record |
| `monitor_ok` / `monitor_err` | any | one `monitor` record, `watching` or `refused`; the tile's reach is unchanged |
| `wait_err` or `read_err`, inbox | its flight | inbox `idle`; the 2 s resend timer arms it again while online |
| `wait_err`, tile | `ended {id}` | reach `resolving`, read the name again; a read error is `missing`, as slice 1 |
| link goes offline | always | as slice 1 (every reach `unresolved`), and inbox `idle` with its cursor kept |

A letter is a DOWN to take only when all of these hold. Anything else changes no tile:

```ts
const taken = (entry: unknown, s: WindowModel) =>
  isBrain(entry.by) &&                 // the same writer test resolveName uses
  inSignalSpace(entry.id) &&           // only the brain writes under ["DOWN", …]
  Schema.is(Down)(entry.body.m) &&
  entry.body.m.to._tag === "client" && entry.body.m.to.client === s.tab;
// and then it must name a tile's current watch: reach opening|open with ref === m.ref && pid === m.process
```

- **Refs:** `"w" + <the monitor call's flight id>`. `serial` only grows and is in the saved Model,
  so a ref never repeats for one tab, across dials and saved cuts. The brain keys watches by
  recipient and ref, and a new socket is a new session, so a reused ref could never collide there
  either; the window still needs unique refs to tell an earlier dial's DOWN from the current one.
- **Why the reason comes from `exited`, not the DOWN:** after a reconnect the window may never see
  the DOWN (it was for an earlier session's ref). The name's stream always has the `exited` fact
  with its reason, so the tile shows the same thing whichever way it got there. A DOWN with
  `noproc` names no reason of its own.
- **The states are explicit (0037), in one tea machine (0046).** `Reach` and `Inbox` are named
  tagged unions stepped only by `update`. An open tile cannot lack a ref, and an ended tile cannot
  lack its reason.

### 4. The name's fold (`runtime/Client.ts`)

```ts
export const NameFold = Schema.Struct({
  after: Schema.Int,                                                    // the last rev folded
  live: Schema.NullOr(Schema.String),                                   // the newest start, unless a later exit ended it
  ended: Schema.NullOr(Schema.Struct({ pid: Schema.String, reason: ExitReason })), // the newest exit
});
export const foldName: (
  fold: NameFold,
  entries: ReadonlyArray<unknown>,
  name: string,
  by: (writer: string) => boolean,
) => NameFold;
// resolveName(entries, name, by) stays, as foldName(empty, entries, name, by).live, for its test callers.
```

### 5. The start and the records

- `client/WindowStart.ts` passes `tab` in the machine's ctx and maps the two new calls:
  `wait` → `ledger.wait {stream, after}`, `monitor` → `process.monitor {ref, pid}`.
- `transport/ClientRows.ts` gains two `ClientRecord` cases:

```ts
monitor: { name: Schema.String, pid: Schema.String, result: Schema.Literals(["watching", "refused"]) },
down: { name: Schema.String, pid: Schema.String, reason: Word, rev: Count }, // reason: the DOWN reason's _tag
```

### 6. The drawing (`next/packages/tuval/src/window/main.tsx`)

Amended 2026-11-15: an ended tile follows the tile guideline's empty state, by the owner's ruling
of 2026-11-15 that `next/` follows the approved guidelines written for today's app as written
(`docs/direction/tile-guidelines.md`, its Tuval line on a tile kept after a crash, and "Empty and
loading").

- The state slot says `Ended (crashed)` for `ended`, with the reason's `_tag` as the word.
- The body shows the one word `Ended` where the view was, in `--tile-text` at `--manti-text-base`,
  and never the ended process's last view. The tile stays `inert`, as for every tile that is not
  open. Both words come from `next/packages/tuval/src/window/words.ts`: `stateWord` for the slot,
  `bodyWord` for the body.
- ~~The page's polite live region says `checklist:1 in tile_1 ended (crashed)` once, beside the
  refusal words: the guideline's `tracker in t2 ended`, with this slice's reason after it.~~
  Amended 2026-11-15 (fix round): the guideline's words replace this plan's, by 0543, which says
  `next/` follows an approved guideline as written and a lean in a plan is no license to differ.
  The guideline's row is "Program ends, unfocused tile | Polite | `tracker in t2 ended`"
  (`docs/direction/tile-guidelines.md`, "What a screen reader is told"). So the polite region says
  `checklist in t1 ended`, once: the program's own name and the tile's short handle, both from
  `tileWords` in `next/packages/tuval/src/window/Layout.tsx`, the source `tileName` reads, and no
  exit reason, which stays in the title bar. It is said only when the ended tile is not the drawn
  focus at that moment; the window machine's `tellEnded` holds that, where focus is known. The
  guideline has no row for the focused tile's own end, so nothing extra is said for it. It stays
  polite, not `role="alert"`, as the guideline's live-region table and 0504 say.
- Color is never the cue: the state is words (0502). This is no new screen, so there is no Linear
  question; the state word follows 0502.

### Is any of this a setting? (0069)

- **The ref format, the inbox cursor and the paging:** no. Nobody running fabrika picks them; they
  are how the code keeps a decided rule.
- **Following the successor:** no. It is the OTP answer on the row. What a tile does when nothing
  follows is `keep`, decided per tile in 0276, built in slice 4.
- **The 2 s re-arm of an idle inbox:** no new value; it reuses the resend timer slice 1 has.
- **`no_session`:** a refusal word, not a choice.

### Where each file lives (next/AGENTS.md's libfabrika test)

A client written from scratch would need the monitor, the inbox reader, the fold and the door
method, so all of them are in libfabrika. Only the drawing is Tuval's, and only a type changes in
the app (`next/apps/fabrika/src/brain.ts`). The client module (layer 6) may import `processes/`
(layer 3) for `Down`, `inSignalSpace`, `clientInbox` and `ExitReason`.

## One value traced: checklist:1 crashes and restarts

The window's tab is `tab_x`; its socket's session is `S1`; the tile is `t1`.

1. **Online, dial 2.** The window writes `read processes/checklist:1 after 0` (id 7) and
   `wait client:tab_x/inbox after 0` (id 8). Tile `resolving {id 7}`, inbox `waiting {after 0, id 8}`.
2. **`read_ok` id 7:** `[started A at rev 10]`. The fold says live A. The window writes
   `monitor {ref "w9", pid A}` (id 9) and `open {pid A}` (id 10). Tile `opening {A, 10, "w9"}`.
3. **The door** reads `recipient/<conn>` = `{client: tab_x, session: S1}` and writes
   `monitored {ref "w9", process A, to, asked: <window key>}`. `monitor_ok` writes the
   `monitor {checklist:1, A, watching}` row.
4. **`open_ok`:** tile `open {A, "w9"}`, `last` = A. The tile shows A's view and says `Online`.
5. **A throws.** The runner's exit writes, in one turn, `exited {A, crashed {phase: step, error:
   TypeError}}` at rev 31 on `processes/checklist:1`, and the DOWN at rev 32 in
   `client:tab_x/inbox` under `["DOWN", to, "w9", 1]`. The Doorbell rings the connection, which
   answers the parked wait id 8 with `{rev 32}`.
6. **`wait_ok` id 8:** the window writes `read client:tab_x/inbox after 0` (id 11). Inbox `reading`.
7. **`read_ok` id 11:** one entry, by `brain:<project>`, id in signal space, `to.client` = tab_x,
   ref "w9" and pid A match t1. Tile `resolving {id 12}`, `read processes/checklist:1 after 0`
   (id 12), and a `down {checklist:1, A, crashed, 32}` row. Inbox cursor 32, `wait after 32` (id 13).
8. **`read_ok` id 12:** `[started A 10, exited A 31]`. No live life; the newest exit is A crashed.
   Tile `ended {A, crashed, id 14}`, `wait processes/checklist:1 after 31` (id 14). The tile's body
   shows the one word `Ended` in place of A's last view, its title bar says `Ended (crashed)`, and
   the polite region says `checklist in t1 ended` when t1 does not have focus, and nothing when it
   does (amended 2026-11-15, as in section 6); presses are blocked.
9. **The supervisor's backoff ends** (100 ms on main) and it writes `restarted {process B, after A}`
   at rev 35. The ring answers wait id 14 with `{rev 35}`.
10. **`wait_ok` id 14:** tile `resolving {id 15}`, `read processes/checklist:1 after 0`. The answer
    `[started A, exited A, restarted B]` folds to live B. The window writes `monitor {ref "w16", pid
    B}` and `open {pid B}`.
11. **`open_ok`:** tile `open {B, "w16"}`, `last` = B. The tile shows B's view, `Online`. A press now
    goes to B.
12. **The tab's socket closes.** The connection object's close calls `Project.leave(conn, S1)`,
    which calls `ProcessManager.leave(S1)`: `demonitored {ref "w16", to {tab_x, S1}, reason
    watcher_exited}`. Dial 3 gets session S2; t1 reads the name, finds B, monitors it as "w20" under
    S2. When B later exits, there is one DOWN, for S2's "w20", and none for S1.

## Laws

Every new walk law runs on slice 1's window walk (`fold` over generated moves at the real init),
extended with these moves: answers to `monitor` and `wait` flights, inbox pages that hold genuine
DOWNs for current refs, DOWNs for earlier dials' refs, forged ones (another writer, plain ids,
another tab), `noproc` DOWNs, name histories with exits and restarts, and histories over one page.
Slice 1's laws keep their own walk and every assertion, except L8's one amended clause below.

| Law | What it holds | Kind (lint, type or test) | Generator | Plant |
|---|---|---|---|---|
| S1 | Each pid a tile resolves is monitored, then opened, in the same step on that dial. Every monitor's ref was never written before in the Model's life, across dials and saved cuts. `opening` and `open` hold that ref | test | fc.array: the window walk with DOWN, inbox and successor moves, 300 runs | Ref = the tile id (red: a second monitor repeats it). Write `open` before `monitor` (red). Monitor only on the first dial (red) |
| S2 | A letter is taken as a DOWN only when it is the brain's, under a signal id, decodes as `Down` with `to.client` the window's tab, and names a tile's current ref and pid. Taking it moves that one tile to `resolving` with one read of its `processes/<name>` after 0. Any other letter changes no tile | test | fc.array: the same walk, with forged and stale DOWNs, 300 runs | Drop the writer test (red: a person key's DOWN moves a tile). Drop the signal id test (red: plain mail shaped like a DOWN). Match on pid only (red: an earlier dial's ref for the same pid moves the tile) |
| S3 | After a DOWN the tile decides from every page of its name: a live successor is monitored and opened with a fresh ref, and the dead pid is never opened again; no live life but an exit gives `ended` with that exit's reason and one `wait` on `processes/<name>` after the last folded rev, whose answer reads the name again; no life gives `missing` | test | fc.array: the same walk with name histories of exits and restarts, 300 runs | Reopen the DOWN's pid (red). Take the reason from a `noproc` DOWN, not from `exited` (red). Skip the wait (red: no `wait` write) |
| S4 | The inbox: going online writes one `wait` on `client:<tab>/inbox` after the cursor; a wait answer writes one read; a read answer sets the cursor to its highest rev and waits again. The cursor never goes back. Leaving a dial or an error makes it `idle` with the cursor kept, and the resend timer arms it again while online. At most one inbox call is in flight | test | fc.array: the same walk, 300 runs | Reset the cursor to 0 when going online (red). Write a second wait while one is in flight (red). Never arm an idle inbox (red: no inbox call after an error, while online) |
| S5 | Paging: a tile read answer of exactly `PAGE` entries reads the next page after its last rev before the tile decides, and the decision equals `foldName` over every page | test | fc.array: the same walk with histories of 1 to 700 entries, 300 runs | Decide on the first page (red with a history over 256 entries) |
| S6 | Records: one `down` row per DOWN taken and one `monitor` row per monitor answer, each with the tile's name and pid, `down` with the reason's tag and the entry's rev. An ignored letter writes no row. No row holds a view or a draft (L9's leak check covers the two new cases) | test | fc.array: the same walk, 300 runs | Write a `down` row for an ignored DOWN (red). Copy the view into a row (red) |
| L8 | Amended clause (mapping below): going online reads each tile's `processes/<name>` once on that dial and opens each resolved pid once per dial, and a tile's stream is read again on that dial only after that tile's DOWN, its wait answer or a full page | test | fc.array: slice 1's walk, with answers to the new calls, 300 runs | Read every tile's stream again on every view notice (red) |
| F1 | `foldName` over any split of an entry list into pages equals `foldName` over the whole list, and its `live` equals `resolveName` over the whole list. Entries by other writers never count | test | fc.array: generated `started`, `restarted` and `exited` entries by the brain and by others, split at generated points, 300 runs | Reset `live` at each page (red). Count another writer's `exited` (red) |
| D1 | `process.monitor {ref, pid}` from a checked window writes one `monitored` whose `to` is `{client: <the hello's tab>, session: <the socket's session>}` and whose `asked` is the window's key. The same call again writes nothing new. Params with any other key are `bad_input` and write nothing. A hands client is `not_allowed`. A door with no session answers `no_session` | test | fc.record: a ref, a pid and extra keys (`to`, `client`, `session`, others), 100 runs | Read `to` from params (red). Use the ConnectionId as the client (red: `bad_name`, no `monitored`). Let excess keys through (red) |
| D2 | Through the door, a monitored process's exit puts one DOWN by the brain into `client:<tab>/inbox` under `signalId(to, ref, 1)`, with the exit reason; a monitor of a gone pid puts a `noproc` DOWN there in the same turn; a `ledger.wait` parked on that inbox is answered | test | scenario: the door laws' one SQLite world, with a started counter | Write the DOWN to the brain's own client inbox (red: the window's inbox stays empty) |
| D3 | A ref that is empty or over 256 characters is `bad_text`; the same ref on another pid is `bad_ref`; a refusal writes nothing | test | fc.string: refs of length 0 to 300, 100 runs | Skip the ref's decode (red: a 300-character ref is written) |
| P1 | `ProcessManager.leave(session)` ends exactly the live watches whose recipient is a client with that session, each with `demonitored {reason: "watcher_exited"}`. Another session of the same client, process recipients and canceled watches stay as they were. A later exit writes no DOWN for the ended ones. A second `leave` writes nothing | test | fc.array: generated watches over two clients, three sessions and two processes, 100 runs | Match on the client id, not the session (red: the other session's watch ends). Skip the `demonitored` line (red: a later DOWN is written) |
| T1 | The door's `monitor` option takes `to` typed as the client case of `Recipient`, and the `process.monitor` params schema's keys are exactly `ref` and `pid` (the schema is not exported, so D1 holds this clause at run time: any other key is refused) | type | type | Add `to` to the params schema (red) |
| T2 | `Reach`'s `opening` and `open` require `ref`, and `ended` requires `reason: ExitReason` | type | type | Make `ref` optional (red) |
| E1 | On a real local instance, in Chromium and in the headless client: the checklist tile is open; the test ends its process as crashed and starts its successor through the control endpoint, as the chaos-revoke suite's `invoke` does. The tile says `Ended (crashed)`, and in Chromium its body shows one word where the view was, in the tile's text token `--tile-text` (amended 2026-11-15, the tile guideline's empty state); then it shows the successor's view, and an `add` lands on the successor pid. `processes` holds one `monitored` per pid, each with `to.client` the tab. After the tab closes, its session's watch is `demonitored` with `watcher_exited` | test | scenario: a real local instance, both backends of slice 1's round-trip suite | Drop the window's DOWN handler (red: the tile stays `Online` on the dead pid and the `add` is refused). `bodyWord` back to the last view (red in Chromium: the body reads the checklist's empty view) |
| W1 | Amended 2026-11-15, the tile guideline's empty state. `words.test.ts`, "property: an ended tile's body is one word, whether or not a last view is there to draw, while its online title bar names the exit's reason; an open tile with a view draws it": `bodyWord` gives an ended tile one word whether or not a view is there, the online state slot names the reason, an open tile with a view draws it, and no tile's body is blank. It draws the Model's `Reach` and `link` and a boolean with Effect's `Arbitrary.schema`, seed 119120, 300 runs. A second property holds that the generated tiles reach ended tiles with and without a last view | test | Effect Arbitrary: WindowModel.fields.tiles.value.fields.reach | `bodyWord` back to the old rule, the last view while one is there and else `Ended (reason)` (red on `Ended (normal)`) |

- **L8's mapping,** for `loosening.sh`. The old clause cannot hold any more: after a DOWN the tile
  must read its name again on the same dial. The new clause keeps the online read-once rule and
  names the only three reasons for a second read, so a read with none of them between is still
  red. The lead's hand check decides; I read it as a change the decided OTP answer forces, not a
  loosening.

| Removed | Replacement |
|---|---|
| L8 scenario: going online reads each tile's processes/&lt;name&gt; once on that dial, and opens each resolved pid once per dial | L8 scenario: going online reads each tile's processes/&lt;name&gt; once on that dial, opens each resolved pid once per dial, and reads a tile's stream again on that dial only after that tile's DOWN, its wait answer or a full page |

- **Slice 1's other laws** gain only new cases: L3 (each frame reaches one owner) and L10 (the
  wire's frame families) learn the `wait` and `monitor` answers and the `process.monitor` and
  `ledger.wait` methods. Those are additions, with no narrowed `expect`.
- **Lint, type or test:** S1 to S6, L8, F1, D1 to D3, P1, E1 and W1 hold behavior over runs, so they
  are tests. T1 and T2 are shapes, so they are type laws. No rule here is about how code is
  written, so there is no new lint rule.
- **No host-only law.** E1 needs workerd and Chromium. It is a visual test, so it runs on the
  3-hour full run on Linux, and on a pull request only with the `visual` label (0536), as slice
  1's suite does. Nothing here touches launchd or the owner's Mac.
- **The OTP behaviors already proven** (one DOWN per watch, `noproc`, a stale DOWN never reaching a
  new life) keep their P33 laws in `ProcessMonitors.integration.test.ts`. D2 proves the door's path into them.

## Files

| Path | Change | Product lines expected | Owner |
|---|---|---|---|
| `next/packages/libfabrika/src/client/WindowMachine.ts` | `Reach` with `ref` and `ended`; `Inbox`; `tab`; the `wait` and `monitor` calls; the steps table above | 180 | build |
| `next/packages/libfabrika/src/client/WindowStart.ts` | `tab` in ctx; `wait` and `monitor` mapped to `ledger.wait` and `process.monitor` | 15 | build |
| `next/packages/libfabrika/src/runtime/Client.ts` | `NameFold`, `foldName`; `resolveName` through it | 40 | build |
| `next/packages/libfabrika/src/transport/ClientRows.ts` | `monitor` and `down` record cases | 12 | build |
| `next/packages/libfabrika/src/gateway/Gateway.ts` | `process.monitor`; the `monitor` option; `session` in trusted; `recipient/<id>` saved and deleted | 60 | build |
| `next/packages/libfabrika/src/processes/ProcessManager.ts` | `leave` | 30 | build |
| `next/packages/libfabrika/src/processes/Process.ts` | `held(session)` on the table | 10 | build |
| `next/packages/libfabrika/src/cloudflare/runtime.ts` | the door's `monitor` option; `leave` ends the session's watches | 25 | build |
| `next/packages/libfabrika/src/cloudflare/connection.ts` | pass `session` to `initialize` | 2 | build |
| `next/packages/libfabrika/src/cloudflare/bindings.ts` | `initialize`'s trusted type | 1 | build |
| `next/apps/fabrika/src/brain.ts` | `initialize`'s trusted type | 1 | build |
| `next/packages/tuval/src/window/main.tsx` | `Ended (reason)` in the state slot and the live region; the body word `Ended` in place of an ended tile's view, from `bodyWord` | 20 | build |
| `next/packages/tuval/src/window/words.ts` | New (amended 2026-11-15): `stateWord` and `bodyWord`, the words a tile shows in its slot and its body | 45 | build |
| `next/packages/tuval/src/window/style.css` | `.tile-empty`: the body word in `--tile-text` at `--manti-text-base` | 8 | build |
| `docs/direction/the-desktop-layer.md` | W3's sketch to the built DOWN (`reason`, the tab as client, `client:tab_…/inbox`); the open bullet becomes the answer | docs | build |
| `docs/direction/follows/otp.md` | New row "Monitor a registered name"; "A watcher ends" covers client sessions; "Signals" cites the window's inbox reader; the count line | docs | build |
| `.glossary/TERMS.md` | ProcessManager gains `leave`; recipient life: a window's `client` is its tab, and a session's close ends its watches | docs | build |
| `docs/plan/tier-1.md` | P18's row: slice 2 built, with its PR | docs | build |
| `next/packages/libfabrika/src/client/WindowMachine.laws.test.ts` | The walk's new moves; S1 to S6; L8's amended clause; L3 and L10's new cases | tests | tests |
| `next/packages/libfabrika/src/client/WindowMachine.types.test.ts` | New: T2 | tests | tests |
| `next/packages/libfabrika/src/client/WindowStart.laws.test.ts` | The two new calls on the wire | tests | tests |
| `next/packages/libfabrika/src/client/WindowStart.test-support.ts` | The fake door answers `process.monitor` and `ledger.wait`, if the laws above need it | tests | tests |
| `next/packages/libfabrika/src/runtime/Client.laws.test.ts` | F1 | tests | tests |
| `next/packages/libfabrika/src/processes/ProcessMonitors.integration.test.ts` | P1 | tests | tests |
| `next/packages/libfabrika/src/gateway/Gateway.types.test.ts` | T1 | tests | tests |
| `next/apps/fabrika/src/door.integration.test.ts` | D1 to D3 | tests | tests |
| `next/apps/fabrika/e2e/client-protocol.visual.test.ts` | E1 in the round-trip suite, both backends | tests | tests |
| `next/apps/fabrika/e2e/client-protocol.test-support.ts` | E1's crash and restart steps and the tile's state reads | tests | tests |
| `next/apps/fabrika/e2e/p14.test-support.ts` | The tile helper reads the state slot, and the body's words and whether they are in `--tile-text` | tests | tests |
| `next/packages/tuval/src/window/words.test.ts` | New (amended 2026-11-15): W1 | tests | tests |
| `next/apps/fabrika/e2e/chaos-revoke.integration.test.ts` | Read only: how a suite calls the control endpoint | 0 | tests |

About 395 product lines. The tests step owns every test file; the build owns the product code and
the docs.

**No list lets broken code pass (0524).** No ledger entry, skip or waiver is added. L8's clause is
replaced, with its mapping above, and gets stricter about why a read repeats.

## What fact is lost if not recorded now

- **When the window saw a DOWN, and which life it followed.** The brain's ledger has `exited`,
  `restarted` and `monitored`, but not the moment a window took the DOWN or that it moved on. The
  `down` and `monitor` rows record it, with each row's own `sentAt`, the tile's name and the
  entry's rev. The gap from DOWN to the successor's first view is then the time between the `down`
  row and the next `view whole` row for that name.
- **Which window asked for each watch.** `monitored` keeps the window's key as `asked` and its tab
  in `to.client`. The tab is also every `ClientRow`'s `tab`, so brain facts and window rows join.
- **Nothing else is lost by waiting.** Closing a tile and `keep` record their own facts in slice 4.

## Size

1. One pull request, about 395 product lines: a tile monitors its process and follows the
   restart. It lands whole: the door method without the window reader shows nothing, and the
   window without the door method gets `unknown_method` on every resolve. About 70% sure of the
   size; the window steps may grow by a third once the walk finds the cases between dials.

Validation for the tests and build steps:

- `nice -n 15 pnpm exec vitest run --maxWorkers=3 next/packages/libfabrika/src/client next/packages/libfabrika/src/runtime/Client.laws.test.ts next/packages/libfabrika/src/processes/ProcessMonitors.integration.test.ts next/apps/fabrika/src/door.integration.test.ts`, and `pnpm lint`.
- The lead runs `--changed` and the one typecheck.
- E1 runs on the 3-hour full run, and on this pull request through its `visual` label (0536). It
  needs workerd and Chromium, so no step's box runs it. D1 to D3 and P1 are integration tests: the
  full run runs them, and each step runs their narrow paths.
- **Shots:** the window changes, so the PR carries shots of `Ended (crashed)` and of the followed
  tile, from the real built page, taken with `page.screenshot` the way E1 drives it. The lead takes
  them by running E1's capture once on the laptop under the caps, or from CI's job if it keeps
  them, and attaches them with alt text. `next/`'s page has one fixed desk and no split layouts yet
  (the desk program is not built), so the shots cover two sizes, about 1440x900 and 1024x700, and
  the PR says the split layouts do not exist yet.

Cost: priced from P18 slice 1's rows in `field/runs/` (tests about $14.5 and $11.8, build $28.0,
review $6.0, fix round $6.6). Expected steps: tests, build, review, a second tests round (slice 1
needed one), a fix round, and the recheck.

Estimate: 6 steps, $70

## Records

- No new decision file: this builds 0276 and the row's OTP answer.
- The OTP table changes in this PR (0017): a new row for monitoring a registered name ("same"),
  and the watcher row now covers client sessions ("same").
- Glossary rows change for `ProcessManager` and `recipient life`. No new word: `leave` is
  `Connections.leave`'s word, the session's end.
- The desktop note's W3 gets the built DOWN shape, as the row asks.
- Each step's run goes in `field/runs/`; the findings below go in `field/findings/`.

## What this plan cannot tell us

- **Whether every socket close reaches `leave`.** A connection object that is evicted without its
  close event leaves its session's watches live. They cost one DOWN letter each when the process
  ends, and no window reads them. Only a long real run shows how often that happens.
- **How the reason word reads to a person.** `Ended (crashed)` is the `_tag`. The error class
  (`TypeError`) is kept in the row but not drawn. A screen reader run is still owed for the live
  region; nothing here was heard on a real one.
- **The time from a crash to the successor's first view.** It is the backoff (100 to 800 ms on
  main), one wait, two reads and an open. The new rows will measure it; I have no number.
- **The interim look.** Until slice 4, a tile whose process exited cleanly stays, saying
  `Ended (normal)`. 0276's default closes it; slice 4 builds that.
- **Old views stay in memory.** Each life a tile followed leaves its view in the client's `views`
  (the second finding). It was true on every reconnect after a restart before this slice; now it
  happens on every restart.

## Answered questions

- **Which id is the window's client id in a recipient:** its tab. One door object serves each
  client per the browser note, a tab is `Id.Tab` in lower case so it fits `ClientId`, and the
  hello's signature covers it. The ConnectionId cannot be used: it has capital letters, and it
  changes on every dial.
- **Does a closed socket end its watches:** yes, as OTP ends a dead watcher's monitors (the OTP
  table's "A watcher ends" row, "same").
- **Push or read for the DOWN:** read. C5 says a browser reads its DOWNs from its inbox like any
  letter, and `ledger.wait` already does the waiting.

## Open questions

None.

## Findings

```json
{"_tag":"finding","id":"2026-11-14-project-monitor-delivers-every-down-to-the-brain-client","date":"2026-11-14","by":"plan","model":"claude-opus-5-5","rule":"bug","location":{"path":"next/packages/libfabrika/src/cloudflare/runtime.ts","line":1175},"says":"On the Worker, a Process object's monitor goes through the Project's one ProcessManager, whose recipient is the brain's own client, so a program's DOWN would land in client:brain/inbox and never in its own inbox.","proof":"runtime.ts:652-659 builds ProcessManager.layer with recipient Recipient.cases.client.make({client: \"brain\", ...}); runtime.ts:1175-1176 serves processMonitor with that one manager; runtime.ts:1449-1450 is how a Process object's monitor reaches it; ProcessManager.ts:318 uses caller.recipient for every watch.","cost":"No program monitors yet, so nothing breaks today; the first program that monitors another on Workers would never get its DOWN.","head":"af9e494f2c2368984136c056439525cd062bdbc1","ticket":"kamp-us/tea-fabrika#290","pr":null}
{"_tag":"finding","id":"2026-11-14-client-views-keep-every-dead-pid","date":"2026-11-14","by":"plan","model":"claude-opus-5-5","rule":"bug","location":{"path":"next/packages/libfabrika/src/runtime/Client.ts","line":210},"says":"The program client adds a view per pid and never removes one, so each life a tile ever showed keeps its last view in memory until the window closes.","proof":"rg -n views next/packages/libfabrika/src/runtime/Client.ts shows the only write at line 210, views: {...c.views, [pid]: shown}, and no delete; WindowMachine.ts never drops a key from client.views either.","cost":"A long-lived tab on a program that restarts often grows by one view per restart.","head":"af9e494f2c2368984136c056439525cd062bdbc1","ticket":"kamp-us/tea-fabrika#290","pr":null}
```
