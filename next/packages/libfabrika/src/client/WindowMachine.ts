/**
 * A window client's parent machine: one tea machine factory for every client, a browser tab, a
 * headless program or Electron's page alike. It steps the Link, the hello exchange, the program
 * client and each tile's own machine by sending each its own Msgs, and it decodes every frame the
 * door sends. It reads no socket and no clock: the start turns socket events into Msgs and its Cmds
 * into writes.
 */
import { applyCell, type Cmd as TeaCmd, type Sub } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Types from "effect/Types";
import { ExitReason } from "../processes/ExitReason.ts";
import { clientInbox, Down, inSignalSpace } from "../processes/Process.ts";
import * as C from "../runtime/Client.ts";
import type { Program } from "../runtime/Program.ts";
import { Sent } from "../runtime/Runner.ts";
import type { AnyTile, WindowData, WindowMsg as ProgramMsg } from "../runtime/Window.ts";
import { fold } from "../tezgah/Fold.ts";
import { focus as focusOn, neighbor, order, type Side, split } from "../tezgah/Layout.ts";
import { CursorKey, type Dir, tezgahName, TileId, type Workspace } from "../tezgah/Workspace.ts";
import { ClientKeyError } from "../transport/ClientKey.ts";
import { ClientRecord, ClientRowsError, ErrorClass, Pixels } from "../transport/ClientRows.ts";
import { Handshake, handshakeMachine, HandshakeMsg, hello, knock } from "../transport/Handshake.ts";
import { Link, linkMachine, LinkMsg, ping, socketDial, timerDeps } from "../transport/Link.ts";
import { PAGE } from "../transport/Wire.ts";
import * as Keys from "./Keys.ts";
import { Prefix, prefixMachine, PrefixMsg } from "./Prefix.ts";
import { optimisticState, TezgahClient, type TezgahCmd, TezgahMsg, tezgahMachine } from "./Tezgah.ts";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Ms = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));

const Reach = Schema.TaggedUnion({
  unresolved: {},
  // Reading `processes/<name>` page by page: what every page read so far says of the name's life.
  // (A model key never says fold: that word is the window's strips, which it never stores.)
  resolving: { id: Schema.Int, life: C.NameFold },
  // From its monitor on, the tile holds a watch on `pid` under `ref`.
  opening: { pid: Schema.String, id: Schema.Int, ref: Schema.String },
  open: { pid: Schema.String, ref: Schema.String },
  // No live process: the newest exit, and the wait on `processes/<name>` for the next start.
  ended: { pid: Schema.String, reason: ExitReason, id: Schema.Int },
  missing: {},
});

type Reach = typeof Reach.Type;

// The window's own inbox, `client:<tab>/inbox`, read past the cursor `after`, one call at a time.
const Inbox = Schema.TaggedUnion({
  idle: { after: Schema.Int },
  waiting: { after: Schema.Int, id: Schema.Int },
  reading: { after: Schema.Int, id: Schema.Int },
});

// A status message for the window's polite region (WCAG 4.1.3), written by the step its event
// happened in: a tile without focus whose process ended, or a tile's refused letter. The region says
// the messages of one burst as one line and never the standing state, so a tile that stays ended is
// shown by its tile and never said again (0504).
const StatusMessage = Schema.TaggedUnion({
  ended: { tile: Schema.String, reason: ExitReason },
  refused: { tile: Schema.String, m: Schema.Json, reason: Schema.String },
});

type StatusMessage = typeof StatusMessage.Type;

// A bad recovery answer does not permit another ask. A checked whole or a new dial does.
const Recovery = Schema.Literals(["ready", "asked"]);

const Call = Schema.TaggedUnion({
  read: { stream: Schema.String, after: Schema.Int },
  wait: { stream: Schema.String, after: Schema.Int },
  // `tile` asked: its answer's record names that tile even after the tile moved on.
  monitor: { ref: Schema.String, pid: Schema.String, tile: Schema.String },
  open: { pid: Schema.String },
  send: {
    pid: Schema.String,
    letter: Schema.String,
    n: Schema.Int,
    m: Schema.Json,
    sentAt: Schema.String,
    seen: Schema.Int,
    traceId: Schema.optionalKey(Schema.String),
  },
  knock: {},
});

type Call = typeof Call.Type;

const CallError = Schema.TaggedUnion({
  unreachable: {},
  unknown: { reason: Schema.optionalKey(Schema.String) },
  closed: {},
});

const OnWrite = { id: Schema.Int, dial: Schema.Int };

const Via = Schema.Literals(["button", "key"]);

// How a letter's command was given, for its press row: a click is also Tab, DOM focus moved into
// another tile by the page's own means.
const By = Schema.Literals(["button", "key", "click"]);

// How far a tezgah window reached its person's tezgah process: read once, then opened. The window
// holds no watch on it; a tile's watch and its name's fold are the tile's own (`Reach`).
const TezgahReach = Schema.TaggedUnion({
  unresolved: {},
  resolving: { id: Schema.Int },
  opening: { pid: Schema.String, id: Schema.Int },
  open: { pid: Schema.String },
  missing: {},
});

// A tezgah window's own attach to its workspace: nothing asked yet, a tile id being minted for it,
// or its letter written.
const Attach = Schema.Literals(["waiting", "minting", "sent"]);

/** A tezgah window's tie to its person's tezgah: how far the window reached tezgah's process, the
 *  pid it last opened, so a focus move made offline still goes on the press path and leaves once
 *  the link is back, the window's tezgah child, its own attach, and the `data-cursor` key the page
 *  last said DOM focus was on in each tile (null for none), which a letter leaving the tile carries. */
const TezgahLink = Schema.Struct({
  reach: TezgahReach,
  last: Schema.NullOr(Schema.String),
  client: TezgahClient,
  attach: Attach,
  cursors: Schema.Record(Schema.String, Schema.NullOr(CursorKey)),
});

type TezgahLink = typeof TezgahLink.Type;

/** What the window says in its polite region on its own: a split refused because a tile would be
 *  under the 220x120 floor at the window's size. The words are the page's. */
const Polite = Schema.TaggedUnion({ no_room: { tile: TileId } });

/** The size of the area a window lays its tiles out in, inside the frame's padding, in CSS pixels. */
const Size = Schema.Struct({ width: Pixels, height: Pixels });

/**
 * Schema for a window's whole state, which a client may save and load again.
 *
 * **Details**
 *
 * `link` is where the connection is, `handshake` the hello exchange of its dial, and `fingerprint`
 * the key the window dials with, once the key store has answered. `tab` is the window's own tab,
 * and `inbox` reads that tab's inbox for the DOWNs of the watches its tiles hold. `said` holds the
 * status messages of the polite region's current burst. `flight` holds each written call by its id
 * and dial until its answer comes. `client` holds the program client's letters and views.
 * `tezgah` is null for a window given fixed tiles; a window started on tezgah takes its tiles
 * from its person's tezgah, whose view its tezgah child holds. `prefix` is the window's own prefix
 * key (`Prefix`), `polite` what the window says on its own in the polite region, and `size` the
 * area its tiles are laid out in, inside the frame's padding, once the page has said it.
 * `presses` counts the key presses the window has read, so a page can tell which of the presses it
 * handed over are still waiting in the run's line (`handle`).
 *
 * @category models
 */
export const WindowModel = Schema.Struct({
  tiles: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      last: Schema.NullOr(Schema.String),
      reach: Reach,
      recovery: Recovery,
      own: Schema.Json,
      refusal: Schema.NullOr(Schema.Struct({ m: Schema.Json, reason: Schema.String })),
      // The process whose end this tile's status message told, so a re-read that finds it ended again is quiet.
      told: Schema.NullOr(Schema.String),
    }),
  ),
  tab: Schema.String,
  inbox: Inbox,
  // The status messages of the polite region's current burst, in order. `id` grows with each one
  // appended; the resend tick ends the burst and empties the list, keeping `id`.
  said: Schema.Struct({ id: Count, messages: Schema.Array(StatusMessage) }),
  link: Link,
  handshake: Handshake,
  fingerprint: Schema.NullOr(Schema.String),
  dials: Schema.Int,
  tries: Count,
  client: C.Client,
  serial: Schema.Int,
  flight: Schema.Array(Schema.Struct({ ...OnWrite, call: Call })),
  sent: Schema.Array(Schema.String),
  attempts: Schema.Record(Schema.String, Count),
  patches: Schema.Record(Schema.String, Count),
  persist: Schema.Literals(["not_due", "due", "asked"]),
  rejected: Schema.NullOr(Schema.String),
  trouble: Schema.NullOr(Schema.String),
  // Slot ownership survives reconnects and identifies the tile whose answer is refused.
  // A letter to tezgah also names its command, as the press row says it.
  from: Schema.Record(
    Schema.String,
    Schema.Struct({ tile: Schema.String, via: By, does: Schema.optionalKey(Schema.String) }),
  ),
  redate: Schema.Array(Schema.Int),
  tezgah: Schema.NullOr(TezgahLink),
  prefix: Prefix,
  polite: Schema.NullOr(Polite),
  size: Schema.NullOr(Size),
  presses: Count,
});

/**
 * The type of a window's whole state.
 *
 * @category models
 */
export type WindowModel = typeof WindowModel.Type;

/**
 * Returns where DOM focus last sat in `tile`, for a window on tezgah (0165): the cursor key the page
 * last said for that tile, when it said one, else the cursor tezgah's view gives the tile.
 *
 * **Details**
 *
 * The window's own note is newer than the view's, which learns a tile's cursor only when focus
 * leaves it. A note of null is a note: focus sat on a control with no row key, such as the add
 * box, so the tile lands at its top and never on the row the view still keeps. Every landing in a
 * tile reads this one answer: focus coming back to it, and a click on its own title bar.
 *
 * @category getters
 */
export const lastCursor = (
  tezgah: WindowModel["tezgah"],
  tile: { readonly id: string; readonly cursor: string | null },
): string | null => {
  const notes = tezgah?.cursors ?? {};

  return Object.hasOwn(notes, tile.id) ? (notes[tile.id] ?? null) : tile.cursor;
};

const Own = Schema.TaggedUnion({
  // What one dial's socket saw, raw: it opened, the door sent a text frame, or it closed with a code.
  // `ms` on a frame is how long ago the call it answers was written, when it answers one.
  socket_opened: { dial: Schema.Int, at: Ms },
  frame: {
    dial: Schema.Int,
    text: Schema.String,
    at: Ms,
    ms: Schema.optionalKey(Ms),
  },
  socket_closed: { dial: Schema.Int, code: Schema.Int, at: Ms },
  socket_failure: {
    dial: Schema.Int,
    op: Schema.Literals(["key", "connect"]),
    error: ErrorClass,
  },
  press: { tile: Schema.String, m: Schema.Json, via: Schema.optionalKey(Via) },
  tile: { id: Schema.String, msg: Schema.Unknown },
  // One press, spelled as `Keys` spells it, and the size of the area the tiles are laid out in, inside the frame's padding.
  key: { key: Schema.String, at: Ms },
  size: { width: Pixels, height: Pixels },
  // DOM focus is now in tile `tile`, by a click or Tab, on an element whose `data-cursor` key is
  // `cursor` (null for none).
  focus: { tile: Schema.String, cursor: Schema.NullOr(CursorKey) },
  view: { pid: Schema.String, note: Schema.Unknown },
  seen: { rev: Schema.Int },
  resend: { dial: Schema.Int },
  read_ok: { ...OnWrite, value: Schema.Array(Schema.Unknown), ms: Ms },
  read_err: { ...OnWrite, error: CallError },
  wait_ok: { ...OnWrite, value: Schema.Struct({ rev: Schema.Int }), ms: Ms },
  wait_err: { ...OnWrite, error: CallError },
  monitor_ok: { ...OnWrite, value: Schema.Null, ms: Ms },
  monitor_err: { ...OnWrite, error: CallError },
  open_ok: {
    ...OnWrite,
    value: Schema.Struct({ rev: Schema.Int, view: Schema.Json }),
    ms: Ms,
  },
  open_err: { ...OnWrite, error: CallError },
  send_ok: { ...OnWrite, value: Sent, ms: Ms },
  send_err: { ...OnWrite, error: CallError },
  knock_ok: { ...OnWrite, value: Schema.Null, ms: Ms },
  knock_err: { ...OnWrite, error: CallError },
});

/**
 * Schema for the window's own Msgs: what its socket saw, what a page hands it (a press, a tile's
 * Msg, a key, a size, a focus), and its calls' answers. A page makes one with
 * `WindowOwn.cases.<name>.make`.
 *
 * @stability unstable
 * @category schemas
 */
export const WindowOwn = Own;

const key = Cmd.make("key", {
  input: Schema.Struct({ rejected: Schema.NullOr(Schema.String) }),
  ok: Schema.Struct({ found: Schema.Literals(["created", "reused", "replaced"]), fingerprint: Schema.String }),
  err: ["ClientKeyError"],
});

// The hello exchange's knock, as the window sends it on. Its own name keeps its answers apart from
// the answers of a knock the window writes as a call when the Link renews a grant wait.
const enroll = Cmd.make("enroll", {
  input: Schema.Struct({ dial: Schema.Int, id: Schema.String }),
  ok: Schema.Null,
  err: ["closed"],
});

// A fresh tile id, minted as a letter id is: for the tezgah window's own attach, or for the new tile
// of a split, which the input names.
const Split = Schema.Struct({
  does: Schema.Literals(["tezgah.split_right", "tezgah.split_down"]),
  from: Schema.toType(TileId),
  keys: Schema.String,
});

/** How a person gave a command to tezgah, in tezgah's own Via: by keys, or by a click or Tab. */
const ByKeys = Schema.TaggedStruct("key", { keys: Schema.String });

const ByClick = Schema.TaggedStruct("click", {});

/** What this window sends tezgah, in tezgah's own inputs (next/programs/tezgah): a first look at a
 *  workspace, and a split, a focus move or a close given in a tile. */
const TezgahAttach = Schema.TaggedStruct("attach", { workspace: Schema.Int, tile: Schema.String });

const TezgahDid = Schema.TaggedStruct("did", {
  does: Schema.String,
  from: Schema.String,
  to: Schema.optionalKey(Schema.String),
  tile: Schema.optionalKey(Schema.String),
  via: Schema.Union([ByKeys, ByClick]),
  cursor: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const mint = Cmd.make("mint", {
  input: Schema.Struct({ split: Schema.optionalKey(Split) }),
  ok: Schema.Struct({ tile: Schema.String }),
  err: ["entropy"],
});

const platformFailure = (error: unknown) => {
  const decoded = Schema.decodeUnknownResult(Schema.Union([ClientKeyError, ClientRowsError]))(error);

  return Result.isSuccess(decoded) ? decoded.success.error : ("other" as const);
};

const now = Cmd.make("now", {
  input: Schema.Struct({ n: Schema.Int }),
  ok: Schema.Struct({ letter: Schema.String, sentAt: Schema.String, traceId: Schema.optionalKey(Schema.String) }),
  err: ["clock", "entropy"],
});

/**
 * Cmd that writes one JSON-RPC call to the brain on the dial's socket, with `id` as its request id.
 *
 * **Details**
 *
 * It settles when the frame is handed to the socket, never when the brain answers: the answer
 * arrives later as a frame. It fails `unreachable` at once when the dial has no open socket.
 *
 * @category constructors
 */
export const write = Cmd.make("write", {
  input: Schema.Struct({ call: Call, ...OnWrite }),
  ok: Schema.Null,
  err: ["unreachable"],
});

const persist = Cmd.make("persist", {
  input: Schema.Struct({}),
  ok: Schema.Boolean,
  err: ["unsupported", "failed", "ClientKeyError"],
});

const record = Cmd.make("record", {
  input: Schema.Struct({ record: ClientRecord }),
  ok: Schema.Null,
  err: ["failed", "ClientRowsError"],
});

type Out = ReadonlyArray<
  | ReturnType<typeof key>
  | ReturnType<typeof now>
  | ReturnType<typeof write>
  | ReturnType<typeof persist>
  | ReturnType<typeof record>
  | ReturnType<typeof ping>
  | ReturnType<typeof hello>
  | ReturnType<typeof enroll>
  | ReturnType<typeof mint>
>;

// --- The door's frames ----------------------------------------------------------------------------

const RpcAnswer = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Finite]),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(
    Schema.Struct({ data: Schema.optionalKey(Schema.Struct({ reason: Schema.optionalKey(Schema.String) })) }),
  ),
});

const Notice = Schema.Struct({ method: Schema.String, params: Schema.optionalKey(Schema.Unknown) });

const decodeFrame = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Union([RpcAnswer, Notice])));

const Nonce = Schema.Struct({ nonce: Schema.String });

const WaitingCode = Schema.Struct({ code: Schema.String, until: Schema.Finite });

const Opened = Schema.Struct({ rev: Schema.Int, view: Schema.Json });

const Entries = Schema.Struct({ entries: Schema.Array(Schema.Unknown) });

const Woke = Schema.Struct({ rev: Schema.Int });

const ViewNotice = Schema.Struct({ pid: Schema.String, type: Schema.Literals(["whole", "patch"]) });

/** The door's error reasons after which the same call may be tried again. */
const AGAIN: ReadonlySet<string> = new Set(["unreachable", "not_granted", "no_hello", "storage"]);

type Step = readonly [WindowModel, Out];

type ClientStep = (client: C.Client, msg: C.ClientMsg) => readonly [C.Client, ReadonlyArray<string>];

type AnyProgram = Program<any, any, any, any, any>;

type ProgramTile<P extends AnyProgram> = Machine<any, any, TeaCmd<"press"> & { readonly m: ProgramMsg<P> }, any, any> &
  Pick<AnyTile, "model" | "msg">;

type WindowChecks<P extends AnyProgram> = {
  readonly decode?: (pid: string) => (view: unknown) => WindowData<P>;
  readonly tile?: (name: string) => ProgramTile<P> | undefined;
  /** The window's key table, as `Keys.load` answers it. Without one the window reads no key. */
  readonly keys?: Keys.Table;
};

type WindowCtx = {
  readonly tiles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly tab: string;
  /** The window takes its tiles from this workspace of its person's tezgah. */
  readonly tezgah?: { readonly workspace: number };
};

type Shown = { readonly id: string; readonly name: string };

type TileRow = WindowModel["tiles"][number];

type SocketSub = Sub<"socket", { readonly dial: number; readonly rejected: string | null; readonly tries: number }>;

const wrote = (s: WindowModel, dial: number, calls: ReadonlyArray<Call>): Step => {
  const out = calls.map((call, i) => write({ call, id: s.serial + i, dial }));

  return [
    {
      ...s,
      serial: s.serial + out.length,
      flight: [...s.flight, ...out.map((c) => ({ id: c.id, dial, call: c.call }))],
    },
    out,
  ];
};

const flush = (s: WindowModel): Step => {
  if (s.link._tag !== "online") {
    return [s, []];
  }

  const calls = C.sendable(s.client)
    .filter((p) => !s.sent.includes(p.letter))
    .map((p) =>
      Call.cases.send.make({
        pid: p.pid,
        letter: p.letter,
        n: p.n,
        m: p.m,
        sentAt: p.sentAt,
        seen: p.seen,
        ...(p.traceId === undefined ? {} : { traceId: p.traceId }),
      }),
    );

  const attempts = { ...s.attempts };

  for (const call of calls) {
    attempts[call.letter] = (attempts[call.letter] ?? 0) + 1;
  }

  return wrote({ ...s, sent: [...s.sent, ...calls.map((c) => c.letter)], attempts }, s.link.dial, calls);
};

/** The write an answer is for: its id and dial. */
type On = { readonly id: number; readonly dial: number };

const answered = (s: WindowModel, m: On, tag: Call["_tag"]) => {
  const found = s.flight.find((f) => f.id === m.id && f.dial === m.dial && f.call._tag === tag);

  return found === undefined ? null : { call: found.call, rest: s.flight.filter((f) => f !== found) };
};

// --- Following a tile's process ---------------------------------------------------------------------

/** The writer the window trusts for process facts and DOWNs: the brain's own. */
const isBrain = (by: string): boolean => by === "brain" || by.startsWith("brain:");

/** The watch a tile holds and the pid it shows, while it is opening or open. */
const held = (reach: Reach): { readonly pid: string; readonly ref: string } | null =>
  reach._tag === "opening" || reach._tag === "open" ? reach : null;

const nameStream = (name: string): string => `processes/${name}`;

const reached = (s: WindowModel, tile: string, reach: Reach): WindowModel => ({
  ...s,
  tiles: s.tiles.map((t) => (t.id === tile ? { ...t, reach } : t)),
});

/** Appends one status message to the current burst, under the next id. */
const say = (s: WindowModel, message: StatusMessage): WindowModel => ({
  ...s,
  said: { id: s.said.id + 1, messages: [...s.said.messages, message] },
});

/** The burst is over: the next status message starts a new line. The id is kept, so the clearing
 *  itself is no new line. */
const hushed = (s: WindowModel): WindowModel =>
  s.said.messages.length === 0 ? s : { ...s, said: { id: s.said.id, messages: [] } };

/**
 * A tile whose process `pid` ended tells it once, and only when it is not the drawn focus at that
 * moment: the tile guideline's row is "Program ends, unfocused tile", followed as written (0543). It
 * has no row for the focused tile's own end, so that end is noted as told and says nothing; the tile
 * shows it in its state slot and body. Finding the same end again tells nothing.
 */
const tellEnded = (s: WindowModel, tile: TileRow, pid: string, reason: ExitReason): WindowModel => {
  if (tile.told === pid) {
    return s;
  }

  const noted: WindowModel = { ...s, tiles: s.tiles.map((t) => (t.id === tile.id ? { ...t, told: pid } : t)) };

  return drawnSpace(s.tezgah)?.space.focus === tile.id
    ? noted
    : say(noted, StatusMessage.cases.ended.make({ tile: tile.id, reason }));
};

/** Reads each tile in `ids` from rev 0 of its name, as a dial's start does, with a fresh fold. */
const resolveAgain = (s: WindowModel, dial: number, ids: ReadonlySet<string>): Step => {
  const picked = s.tiles.filter((t) => ids.has(t.id));
  const reads = picked.map((t) => Call.cases.read.make({ stream: nameStream(t.name), after: 0 }));
  const [written, out] = wrote(s, dial, reads);
  const flights = new Map(picked.map((t, i) => [t.id, s.serial + i]));

  const tiles = written.tiles.map((t) => {
    const id = flights.get(t.id);

    // A new life starts its own view recovery, as a new dial does.
    return id === undefined
      ? t
      : { ...t, reach: Reach.cases.resolving.make({ id, life: C.emptyFold }), recovery: Recovery.make("ready") };
  });

  return [{ ...written, tiles }, out];
};

/** Parks one `ledger.wait` on the window's own inbox past `after`. */
const waitInbox = (s: WindowModel, dial: number, after: number): Step => {
  const [written, out] = wrote(s, dial, [Call.cases.wait.make({ stream: clientInbox(s.tab), after })]);

  return [{ ...written, inbox: Inbox.cases.waiting.make({ after, id: s.serial }) }, out];
};

/** The inbox is idle again with its cursor kept; the resend timer arms it while online. */
const inboxIdle = (s: WindowModel): WindowModel => ({ ...s, inbox: Inbox.cases.idle.make({ after: s.inbox.after }) });

/**
 * Decides a tile from `life`, its name's fold after one more page. A full page reads the next page
 * first.
 * Then a live process is monitored under a ref never used before, and opened; a name whose newest
 * life ended waits for its next start; a name with neither is missing.
 */
const resolved = (s: WindowModel, dial: number, tile: TileRow, life: C.NameFold, full: boolean): Step => {
  const stream = nameStream(tile.name);

  if (full) {
    const [written, out] = wrote(s, dial, [Call.cases.read.make({ stream, after: life.after })]);

    return [reached(written, tile.id, Reach.cases.resolving.make({ id: s.serial, life })), out];
  }

  if (life.live !== null) {
    const pid = life.live;
    // `serial` only grows and is saved, so a ref made from it never repeats in the Model's life.
    const ref = `w${s.serial}`;
    const calls = [Call.cases.monitor.make({ ref, pid, tile: tile.id }), Call.cases.open.make({ pid })];
    const [written, out] = wrote(s, dial, calls);

    return [reached(written, tile.id, Reach.cases.opening.make({ pid, id: s.serial + 1, ref })), out];
  }

  if (life.ended !== null) {
    const { pid, reason } = life.ended;
    const [written, out] = wrote(s, dial, [Call.cases.wait.make({ stream, after: life.after })]);

    return [
      tellEnded(reached(written, tile.id, Reach.cases.ended.make({ pid, reason, id: s.serial })), tile, pid, reason),
      out,
    ];
  }

  return [reached(s, tile.id, Reach.cases.missing.make({})), []];
};

const decodeLetter = Schema.decodeUnknownOption(
  Schema.Struct({ by: Schema.String, id: Schema.String, rev: Schema.Int, body: Schema.Struct({ m: Schema.Unknown }) }),
);

const decodeRev = Schema.decodeUnknownOption(Schema.Struct({ rev: Schema.Int }));

const decodeDown = Schema.decodeUnknownOption(Down);

/**
 * The tile a letter is a DOWN for, or null. It is one only when the brain wrote it under a signal
 * id, it decodes as a `Down` for this window's tab, and it names the watch a tile holds now.
 */
const downFor = (s: WindowModel, raw: unknown) => {
  const letter = Option.getOrNull(decodeLetter(raw));

  if (letter === null || !isBrain(letter.by) || !inSignalSpace(letter.id)) {
    return null;
  }

  const down = Option.getOrNull(decodeDown(letter.body.m));

  if (down === null || down.to._tag !== "client" || down.to.client !== s.tab) {
    return null;
  }

  const tile = s.tiles.find((t) => {
    const watch = held(t.reach);

    return watch !== null && watch.ref === down.ref && watch.pid === down.process;
  });

  return tile === undefined ? null : { tile, down, rev: letter.rev };
};

/**
 * One page of the window's inbox. Each DOWN for a watch a tile holds sends that tile back to read
 * its name from 0, with one `down` row. The cursor moves to the page's highest rev, and the inbox
 * waits past it again.
 */
const inboxRead = (s: WindowModel, dial: number, page: ReadonlyArray<unknown>): Step => {
  const downs = page.flatMap((letter) => downFor(s, letter) ?? []);
  const revs = page.flatMap((letter) => Option.toArray(decodeRev(letter)).map(({ rev }) => rev));

  const rows = downs.map(({ tile, down, rev }) =>
    record({
      record: ClientRecord.cases.down.make({ name: tile.name, pid: down.process, reason: down.reason._tag, rev }),
    }),
  );

  const [again, reads] = resolveAgain(s, dial, new Set(downs.map(({ tile }) => tile.id)));
  const [waited, waits] = waitInbox(again, dial, Math.max(s.inbox.after, ...revs));

  return [waited, [...rows, ...reads, ...waits]];
};

/** A monitor's answer: one row naming the tile that asked. The tile's reach does not change. */
const monitorAnswered = (s: WindowModel, m: On, result: "watching" | "refused"): Step => {
  const found = answered(s, m, "monitor");

  if (found === null || found.call._tag !== "monitor") {
    return [s, []];
  }

  const { pid, tile } = found.call;
  const asker = s.tiles.find((t) => t.id === tile);

  const rows =
    asker === undefined ? [] : [record({ record: ClientRecord.cases.monitor.make({ name: asker.name, pid, result }) })];

  return [{ ...s, flight: found.rest }, rows];
};

/**
 * A wait's answer, an error included. The inbox's own wait reads its letters; an ended tile's wait
 * reads its name from 0 again; an error makes the inbox idle.
 */
const waitAnswered = (s: WindowModel, m: On, woke: boolean): Step => {
  const found = answered(s, m, "wait");

  if (found === null) {
    return [s, []];
  }

  const next = { ...s, flight: found.rest };

  if (s.inbox._tag === "waiting" && s.inbox.id === m.id) {
    if (!woke) {
      return [inboxIdle(next), []];
    }

    const { after } = s.inbox;
    const [written, out] = wrote(next, m.dial, [Call.cases.read.make({ stream: clientInbox(s.tab), after })]);

    return [{ ...written, inbox: Inbox.cases.reading.make({ after, id: s.serial }) }, out];
  }

  const tile = s.tiles.find((t) => t.reach._tag === "ended" && t.reach.id === m.id);

  return tile === undefined ? [next, []] : resolveAgain(next, m.dial, new Set([tile.id]));
};

/** A tezgah link whose read `id` failed: its process is missing. */
const lostRead = (link: TezgahLink | null, id: number): TezgahLink | null =>
  link !== null && link.reach._tag === "resolving" && link.reach.id === id
    ? { ...link, reach: TezgahReach.cases.missing.make({}) }
    : link;

const runEnd = (s: WindowModel, pid: string): ReadonlyArray<ReturnType<typeof record>> =>
  (s.patches[pid] ?? 0) === 0
    ? []
    : [
        record({
          record: ClientRecord.cases.view.make({
            pid,
            result: "patch",
            rev: Math.max(0, s.client.views[pid]?.rev ?? 0),
            patches: s.patches[pid] ?? 0,
          }),
        }),
      ];

const noticed = (
  s: WindowModel,
  step: ClientStep,
  pid: string,
  note: unknown,
): readonly [WindowModel, Out, ReadonlyArray<string>] => {
  const [client, requested] = step(s.client, C.ClientMsg.cases.notice.make({ pid, note }));
  const asks = requested.filter((p) => !s.tiles.some((t) => held(t.reach)?.pid === p && t.recovery === "asked"));
  const shown = client.views[pid];
  const changed = shown !== undefined && shown !== s.client.views[pid];
  const patch = Predicate.isObject(note) && Predicate.hasProperty(note, "type") && note.type === "patch";

  if (changed && patch) {
    return [{ ...s, client, patches: { ...s.patches, [pid]: (s.patches[pid] ?? 0) + 1 } }, [], asks];
  }

  if (!changed && asks.length === 0) {
    return [{ ...s, client }, [], asks];
  }

  const rows = [
    ...runEnd(s, pid),
    ...(changed
      ? [record({ record: ClientRecord.cases.view.make({ pid, result: "whole", rev: Math.max(0, shown?.rev ?? 0) }) })]
      : []),
    ...asks.map((p) =>
      record({
        record: ClientRecord.cases.view.make({
          pid: p,
          result: "asked",
          rev: Math.max(0, s.client.views[p]?.rev ?? 0),
        }),
      }),
    ),
  ];

  return [
    {
      ...s,
      client,
      tiles: s.tiles.map((t) =>
        held(t.reach)?.pid === pid
          ? { ...t, recovery: Recovery.make(changed ? "ready" : asks.includes(pid) ? "asked" : t.recovery) }
          : t,
      ),
      patches: Object.fromEntries(Object.entries(s.patches).filter(([p]) => p !== pid)),
    },
    rows,
    asks,
  ];
};

const opened = (s: WindowModel, pid: string): WindowModel => ({
  ...s,
  trouble: null,
  tiles: s.tiles.map((t) => {
    const watch = held(t.reach);

    return watch?.pid === pid ? { ...t, last: pid, reach: Reach.cases.open.make({ pid, ref: watch.ref }) } : t;
  }),
  flight: s.flight.filter((f) => f.call._tag !== "open" || f.call.pid !== pid),
});

const pressed = (s: WindowModel, step: ClientStep, tile: string, m: Schema.Json, via: "button" | "key"): Step => {
  const found = s.tiles.find((t) => t.id === tile);

  if (found?.reach._tag !== "open") {
    return [s, []];
  }

  const n = s.client.written;
  const [client] = step(s.client, C.ClientMsg.cases.press.make({ pid: found.reach.pid, m }));
  return [
    {
      ...s,
      client,
      from: { ...s.from, [n]: { tile, via } },
      tiles: s.tiles.map((t) => (t.id === tile ? { ...t, refusal: null } : t)),
    },
    [now({ n })],
  ];
};

/** The tiles of a tezgah link's workspace in its drawn state, in reading order, each named by the process
 *  it shows. */
const tezgahTiles = (link: TezgahLink): ReadonlyArray<Shown> => {
  const view = optimisticState(link.client);
  const space = view?.workspaces.find((w) => w.n === link.client.workspace);

  return view === null || space === undefined
    ? []
    : order(space.layout).flatMap((id) =>
        view.tiles.filter((t) => t.id === id).map((t) => ({ id: t.id, name: t.shows })),
      );
};

/** A tezgah window's tiles follow tezgah's drawn state: a tile tezgah added joins, and is read at
 *  once while online; a tile it removed leaves; a kept tile keeps its reach and its own state. */
const followed = (s: WindowModel, fresh: (t: Shown) => TileRow): Step => {
  if (s.tezgah === null) {
    return [s, []];
  }

  const want = tezgahTiles(s.tezgah);
  const kept = new Map(s.tiles.map((t) => [t.id, t]));
  const added = want.filter((t) => !kept.has(t.id));
  const tiles = want.map((t) => kept.get(t.id) ?? fresh(t));

  if (tiles.length === s.tiles.length && tiles.every((t, i) => t === s.tiles[i])) {
    return [s, []];
  }

  const next = { ...s, tiles };

  if (s.link._tag !== "online" || added.length === 0) {
    return [next, []];
  }

  return resolveAgain(next, s.link.dial, new Set(added.map((t) => t.id)));
};

/** tezgah's view reached the tezgah window, whole or as a patch: its tezgah child takes it, the tiles
 *  follow, a patch it cannot apply opens the view again, and a first look at a workspace tezgah does
 *  not have yet mints the tile id for the window's own attach. */
const tezgahTook = (s: WindowModel, pid: string, msg: TezgahMsg, fresh: (t: Shown) => TileRow): Step => {
  if (s.tezgah === null) {
    return [s, []];
  }

  const link = s.tezgah;
  const [client, cmds] = applyCell<TezgahClient, TezgahMsg, TezgahCmd>(tezgahMachine, link.client, msg);
  const asks = cmds.filter((c) => c._tag === "ask");
  const view = client.serverState;
  const due = link.attach === "waiting" && view !== null && !view.workspaces.some((w) => w.n === client.workspace);

  const [after, reads] = followed(
    {
      ...s,
      tezgah: {
        ...link,
        reach: TezgahReach.cases.open.make({ pid }),
        last: pid,
        client,
        attach: due ? "minting" : link.attach,
      },
    },
    fresh,
  );

  const reopen =
    asks.length > 0 &&
    after.link._tag === "online" &&
    !after.flight.some((f) => f.call._tag === "open" && f.call.pid === pid);

  const [written, writes] =
    reopen && after.link._tag === "online"
      ? wrote(after, after.link.dial, [Call.cases.open.make({ pid })])
      : ([after, []] as const);

  return [written, [...focusRows(cmds), ...reads, ...writes, ...(due ? [mint({})] : [])]];
};

/** The `focus` row of each move the window's tezgah child dropped. */
const focusRows = (cmds: ReadonlyArray<TezgahCmd>) =>
  cmds.flatMap((c) =>
    c._tag === "settled"
      ? [record({ record: ClientRecord.cases.focus.make({ letter: c.letter, result: c.result, ms: c.ms }) })]
      : [],
  );

/** Steps the window's tezgah child by hand with one Msg about its pending moves, and records what
 *  it dropped. */
const tezgahStep = (s: WindowModel, msg: TezgahMsg): Step => {
  if (s.tezgah === null) {
    return [s, []];
  }

  const [client, cmds] = applyCell<TezgahClient, TezgahMsg, TezgahCmd>(tezgahMachine, s.tezgah.client, msg);

  return [{ ...s, tezgah: { ...s.tezgah, client } }, focusRows(cmds)];
};

const DIRS: Readonly<Record<(typeof Split.Type)["does"], Dir>> = {
  "tezgah.split_right": "row",
  "tezgah.split_down": "column",
};

/** The workspace a tezgah window draws, in its drawn state, with that state's tiles. */
const drawnSpace = (link: TezgahLink | null) => {
  const view = link === null ? null : optimisticState(link.client);
  const space = view?.workspaces.find((w) => w.n === link?.client.workspace);

  return view === null || space === undefined ? null : { view, space };
};

/** The tiles a window draws as strips now: `fold` of its drawn workspace at its last size, none
 *  before the page has said one. Worked out on each step, never stored (0277). */
const stripsNow = (s: WindowModel): ReadonlySet<TileId> => {
  const drawn = drawnSpace(s.tezgah);

  return s.size === null || drawn === null ? new Set() : fold(drawn.space, s.size);
};

/** A step, with one `fold` row when it changed which tiles the window draws as strips, by a size, a
 *  view or a focus move: how many strips there are now and the size they folded at. */
const folded = (was: WindowModel, [next, cmds]: Step): Step => {
  const before = stripsNow(was);
  const after = stripsNow(next);

  if (before.size === after.size && [...before].every((t) => after.has(t))) {
    return [next, cmds];
  }

  const size = next.size ?? { width: 0, height: 0 };
  const row = ClientRecord.cases.fold.make({ strips: after.size, width: size.width, height: size.height });

  return [next, [...cmds, record({ record: row })]];
};

/** A tile id no window mints (a UUIDv7 of time zero and no randomness): the new tile of a split the
 *  window only measures. */
const PROBE = Schema.decodeSync(TileId)("tile_0000000000e008000000000000");

/** Whether a split of `at` in `dir` folds no tile at once in an area of `size`: measured with the
 *  fold's one drawn geometry (plan amendment 13, point 4), every tile the window would draw as a strip
 *  after it, focus on the new tile, is one it draws as a strip before. */
const roomFor = (space: Workspace, at: TileId, dir: Dir, size: typeof Size.Type): boolean => {
  const here = focusOn(space, at);
  const before = fold(here, size);

  return [...fold(split(here, at, dir, PROBE), size)].every((t) => before.has(t));
};

/** One letter to the window's tezgah on the press path, named by its command for the press row. */
const toTezgah = (s: WindowModel, step: ClientStep, m: Schema.Json, does: string, from: string): Step => {
  const link = s.tezgah;

  if (link === null || link.reach._tag !== "open") {
    return [s, []];
  }

  const n = s.client.written;
  const [client] = step(s.client, C.ClientMsg.cases.press.make({ pid: link.reach.pid, m }));
  return [{ ...s, client, from: { ...s.from, [n]: { tile: from, via: "key", does } } }, [now({ n })]];
};

/** A close of `tile`, given by keys. */
const closing = (s: WindowModel, step: ClientStep, tile: TileId, keys: string): Step =>
  toTezgah(
    s,
    step,
    TezgahDid.make({ does: "tezgah.close", from: tile, via: ByKeys.make({ keys }) }),
    "tezgah.close",
    tile,
  );

/** Where each focus command a key row gives goes from the drawn focus. */
type Aim = "next" | "previous" | "last" | Side;

const AIMS: Readonly<Record<string, Aim>> = {
  "tezgah.focus_next": "next",
  "tezgah.focus_previous": "previous",
  "tezgah.focus_last": "last",
  "tezgah.focus_left": "left",
  "tezgah.focus_right": "right",
  "tezgah.focus_up": "up",
  "tezgah.focus_down": "down",
};

/** The tile a focus command goes to on the drawn workspace: next and previous follow reading order
 *  and wrap, as tmux's do; last is the drawn `recent[1]`; a side is the drawn layout's neighbor
 *  there. Null when it finds no other tile: the key does nothing (0278: the window resolves a
 *  direction on its own drawn layout and sends an absolute tile). */
const aimed = (space: Workspace, aim: Aim): TileId | null => {
  const tiles = order(space.layout);
  const at = tiles.indexOf(space.focus);

  const found =
    aim === "next"
      ? tiles[(at + 1) % tiles.length]
      : aim === "previous"
        ? tiles[(at - 1 + tiles.length) % tiles.length]
        : aim === "last"
          ? space.recent[1]
          : neighbor(space.layout, space.focus, aim);

  return found === undefined || found === null || found === space.focus ? null : found;
};

/**
 * A focus move from the drawn focus `from` to `to`, optimistic as 0167 says: the window's tezgah
 * child takes it as a pending move on this step, so it is drawn before any frame from the brain,
 * and it goes to tezgah as one letter on the press path, carrying the cursor the page last said in
 * `from`. Offline it goes on the press path all the same, to the tezgah pid the window last opened,
 * and leaves once the link is back.
 */
const moved = (
  s: WindowModel,
  step: ClientStep,
  does: string,
  from: TileId,
  to: TileId,
  via: typeof ByKeys.Type | typeof ByClick.Type,
): Step => {
  const link = s.tezgah;
  const pid = link === null ? null : link.reach._tag === "open" ? link.reach.pid : link.last;

  if (link === null || pid === null) {
    return [s, []];
  }

  const cursor = link.cursors[from] ?? null;
  const n = s.client.written;
  const [client] = step(
    s.client,
    C.ClientMsg.cases.press.make({ pid, m: TezgahDid.make({ does, from, to, via, cursor }) }),
  );
  const [moving] = applyCell(tezgahMachine, link.client, TezgahMsg.cases.move.make({ n, from, to, cursor }));
  return [
    {
      ...s,
      client,
      polite: null,
      tezgah: { ...link, client: moving },
      from: { ...s.from, [n]: { tile: from, via: via._tag === "click" ? "click" : "key", does } },
    },
    [now({ n })],
  ];
};

/** DOM focus moved into tile `tile` of the drawn workspace, on an element whose cursor key is
 *  `cursor`: noted for the tile, and a move there when it is not the drawn focus (desk focus
 *  follows DOM focus). */
const focusedIn = (s: WindowModel, step: ClientStep, tile: string, cursor: string | null): Step => {
  const link = s.tezgah;
  const drawn = drawnSpace(link);
  const at = drawn === null ? undefined : order(drawn.space.layout).find((t) => t === tile);

  if (link === null || drawn === null || at === undefined) {
    return [s, []];
  }

  const noted: WindowModel = { ...s, tezgah: { ...link, cursors: { ...link.cursors, [at]: cursor } } };

  return at === drawn.space.focus
    ? [noted, []]
    : moved(noted, step, "tezgah.focus", drawn.space.focus, at, ByClick.make({}));
};

const idle = Prefix.cases.idle.make({});

/**
 * One press in this window, routed by its table (0272) against its own prefix (0278). Nothing but
 * a record leaves before the command is known. A split is checked against the window's size and
 * minted its tile; a close of a tile tezgah started asks first; a close of any other goes at once.
 */
const pressedKey = (s: WindowModel, step: ClientStep, table: Keys.Table, key: string, at: number): Step => {
  const routed = Keys.route(table, s.prefix, null, { key });
  const prefix = (msg: typeof prefixMachine.msg.Type) => applyCell(prefixMachine, s.prefix, msg)[0];

  if (routed._tag === "platform") {
    return [s, []];
  }

  if (routed._tag === "prefix") {
    return [{ ...s, prefix: prefix(PrefixMsg.cases.arm.make({ at })), polite: null }, []];
  }

  if (routed._tag === "answer") {
    const asked = s.prefix;
    const done = { ...s, prefix: prefix(PrefixMsg.cases.done.make({})) };
    return routed.yes && asked._tag === "asking" ? closing(done, step, asked.tile, `${table.prefix} x y`) : [done, []];
  }

  if (routed._tag === "tile" || routed._tag === "dropped") {
    return [s.prefix._tag === "idle" ? s : { ...s, prefix: prefix(PrefixMsg.cases.done.make({})) }, []];
  }

  const does = routed.does;
  const keys = s.prefix._tag === "armed" ? `${table.prefix} ${key}` : key;

  const row = record({
    record: ClientRecord.cases.prefix.make({
      does,
      ms: s.prefix._tag === "armed" ? Math.max(0, at - s.prefix.since) : 0,
    }),
  });
  const done: WindowModel = { ...s, prefix: prefix(PrefixMsg.cases.done.make({})) };
  const drawn = drawnSpace(s.tezgah);

  if (drawn === null) {
    return [done, [row]];
  }

  const from = drawn.space.focus;
  const aim = AIMS[does];

  if (aim !== undefined) {
    const to = aimed(drawn.space, aim);

    if (to === null) {
      return [done, [row]];
    }

    const [sent, cmds] = moved(done, step, does, from, to, ByKeys.make({ keys }));

    return [sent, [row, ...cmds]];
  }

  if (does === "tezgah.close") {
    const tile = drawn.view.tiles.find((t) => t.id === from);

    if (tile?.child === true && order(drawn.space.layout).length > 1) {
      return [{ ...s, prefix: prefix(PrefixMsg.cases.question.make({ tile: from, at })), polite: null }, [row]];
    }

    const [sent, cmds] = closing({ ...done, polite: null }, step, from, keys);

    return [sent, [row, ...cmds]];
  }

  if (does === "tezgah.split_right" || does === "tezgah.split_down") {
    if (s.size !== null && !roomFor(drawn.space, from, DIRS[does], s.size)) {
      return [{ ...done, polite: Polite.cases.no_room.make({ tile: from }) }, [row]];
    }

    return [{ ...done, polite: null }, [row, mint({ split: { does, from, keys } })]];
  }

  return [done, [row]];
};

const Whole = Schema.Struct({ type: Schema.Literal("whole"), rev: Schema.Int, view: Schema.Unknown });

const Patched = Schema.Struct({
  type: Schema.Literal("patch"),
  base: Schema.Int,
  rev: Schema.Int,
  patch: Schema.Unknown,
});

const decodeTezgahNote = Schema.decodeUnknownOption(Schema.Union([Whole, Patched]));

const dated = (
  s: WindowModel,
  step: ClientStep,
  n: number,
  stamp: { readonly letter: string; readonly sentAt: string; readonly traceId?: string },
): Step => {
  const before = s.client.pending.find((p) => p.n === n);
  const [client] = step(s.client, C.ClientMsg.cases.dated.make({ n, ...stamp }));
  const slot = client.pending.find((p) => p.n === n);
  const owner = s.from[n];
  const tile = s.tiles.find((t) => t.id === owner?.tile);

  const type =
    slot &&
    Predicate.isObject(slot.m) &&
    Predicate.hasProperty(slot.m, "_tag") &&
    Predicate.isString(slot.m._tag) &&
    /^[a-z_]{1,40}$/.test(slot.m._tag)
      ? slot.m._tag
      : "other";

  const command = owner?.does ?? `${tile?.name.split(":")[0] ?? "program"}.${type}`;

  const rows =
    before?._tag === "dating" && slot?._tag === "ready" && owner !== undefined
      ? [
          record({
            record: ClientRecord.cases.press.make({
              command,
              via: owner.via,
              pid: slot.pid,
              viewRev: Math.max(0, slot.viewRev),
              seen: Math.max(0, slot.seen),
              letter: slot.letter,
              depth: client.pending.length,
            }),
          }),
        ]
      : [];

  // A focus move's pending entry takes its letter, so tezgah's answer finds it.
  const [noted] = tezgahStep(
    { ...s, client, redate: s.redate.filter((r) => r !== n) },
    TezgahMsg.cases.dated.make({
      n,
      letter: stamp.letter,
    }),
  );

  const [next, cmds] = flush(noted);

  return [next, [...rows, ...cmds]];
};

const linked = (s: WindowModel, m: LinkMsg): Step => {
  const input = m._tag === "ask_again" ? { ...m, dial: Math.max(s.dials + 1, m.dial) } : m;
  const [link, cmds] = applyCell(linkMachine, s.link, input);
  const open = socketDial(link);
  const granted = m._tag === "granted" && s.link._tag === "waiting_grant" && s.link.dial === m.dial;
  let next: WindowModel = {
    ...s,
    link,
    // A new dial starts its own hello exchange.
    handshake:
      open !== null && open > s.handshake.dial
        ? applyCell(handshakeMachine, s.handshake, HandshakeMsg.cases.opened.make({ dial: open }))[0]
        : s.handshake,
    dials: Math.max(s.dials, open ?? 0),
    tries: link._tag === "dialing" && open !== socketDial(s.link) ? (link.tries ?? 0) : s.tries,
    persist: granted ? "due" : s.persist,
    rejected: link._tag === "removed" ? link.fingerprint : s.rejected,
    flight: s.flight.filter((f) => f.dial === open),
  };
  const out: Array<Out[number]> = cmds.filter((c): c is ReturnType<typeof ping> => c._tag === "ping");
  const knocks = cmds.filter((c) => c._tag === "knock").map(() => Call.cases.knock.make({}));
  const [knocked, writes] = wrote(next, open ?? 0, knocks);
  next = knocked;
  out.push(...writes);

  const result =
    s.link._tag !== "online" && link._tag === "online"
      ? "online"
      : s.link._tag !== "waiting_grant" && link._tag === "waiting_grant"
        ? "waiting"
        : s.link._tag !== "removed" && link._tag === "removed"
          ? "removed"
          : s.link._tag !== "retrying" && link._tag === "retrying"
            ? m._tag === "closed"
              ? "closed"
              : "stalled"
            : null;

  if (result !== null && "ms" in m) {
    out.push(
      record({
        record: ClientRecord.cases.connect.make({
          dial: m.dial,
          result,
          ms: m.ms,
          ...(m._tag === "closed" ? { code: m.code } : {}),
        }),
      }),
    );
  }

  if (s.link._tag === "removed" && m._tag === "ask_again" && link._tag === "dialing") {
    out.push(key({ rejected: s.link.fingerprint }));
  }

  if (link._tag !== "online") {
    if (s.link._tag === "online") {
      out.push(...Object.keys(s.patches).flatMap((pid) => runEnd(s, pid)));
    }

    return [
      {
        ...inboxIdle(next),
        tiles: next.tiles.map((t) => ({
          ...t,
          reach: Reach.cases.unresolved.make({}),
          recovery: Recovery.make("ready"),
        })),
        tezgah: next.tezgah === null ? null : { ...next.tezgah, reach: TezgahReach.cases.unresolved.make({}) },
        sent: [],
        patches: s.link._tag === "online" ? {} : s.patches,
      },
      out,
    ];
  }

  if (s.link._tag === "online") {
    return [next, out];
  }

  // A tezgah window reads its person's tezgah first: the person is the one the door admitted.
  const person = next.handshake._tag === "admitted" ? next.handshake.person : null;

  const first =
    next.tezgah === null || person === null
      ? []
      : [Call.cases.read.make({ stream: nameStream(tezgahName(person)), after: 0 })];

  const [asked, firsts] = wrote(next, link.dial, first);

  const tezgah =
    asked.tezgah === null || first.length === 0
      ? asked.tezgah
      : { ...asked.tezgah, reach: TezgahReach.cases.resolving.make({ id: next.serial }) };

  const [reading, reads] = resolveAgain({ ...asked, tezgah }, link.dial, new Set(s.tiles.map((t) => t.id)));
  const [waiting, waits] = waitInbox(reading, link.dial, reading.inbox.after);
  next = { ...waiting, trouble: null };
  const askPersist = next.persist === "due";

  if (askPersist) {
    next = { ...next, persist: "asked" };
  }

  const [flushed, sends] = flush(next);

  return [flushed, [...out, ...firsts, ...reads, ...waits, ...sends, ...(askPersist ? [persist({})] : [])]];
};

const linkUpdate = Object.fromEntries(
  [
    "admitted",
    "not_granted",
    "granted",
    "closed",
    "retry",
    "beat",
    "pong",
    "stalled",
    "renew",
    "blocked",
    "ask_again",
  ].map((type) => [type, linked]),
) as { readonly [K in LinkMsg["_tag"]]: (s: WindowModel, m: Types.ExtractTag<LinkMsg, K>) => Step };

type HandshakeIn =
  typeof handshakeMachine extends Machine<Handshake, infer M, infer _C, infer _U, infer _X> ? M : never;

/** The Link Msg a change of the hello exchange means, if any. */
const outcome = (was: Handshake, now: Handshake, fingerprint: string): LinkMsg | null => {
  if (now._tag === "admitted" && was._tag !== "admitted") {
    return LinkMsg.cases.admitted.make({ dial: now.dial, ping: now.ping, ms: now.ms });
  }

  if (now._tag === "waiting" && (was._tag !== "waiting" || was.code !== now.code || was.until !== now.until)) {
    return LinkMsg.cases.not_granted.make({
      dial: now.dial,
      fingerprint,
      code: now.code,
      until: now.until,
      ms: now.ms,
    });
  }

  return was._tag === "waiting" && now._tag === "initializing" ? LinkMsg.cases.granted.make({ dial: now.dial }) : null;
};

/** Steps the hello exchange by hand, sends its Cmds on and tells the Link what changed. */
const shook = (s: WindowModel, m: HandshakeIn): Step => {
  const [handshake, cmds] = applyCell<Handshake, HandshakeIn, ReturnType<typeof hello> | ReturnType<typeof knock>>(
    handshakeMachine,
    s.handshake,
    m,
  );

  if (handshake === s.handshake && cmds.length === 0) {
    return [s, []];
  }

  const next: WindowModel = { ...s, handshake };
  const sent: Out = cmds.map((c) => (c._tag === "knock" ? enroll({ dial: c.dial, id: c.id }) : c));

  if (handshake._tag === "failed" && s.handshake._tag !== "failed") {
    const [blocked, out] = linked(next, LinkMsg.cases.blocked.make({ reason: handshake.error }));
    return [
      blocked,
      [...sent, ...out, record({ record: ClientRecord.cases.failure.make({ op: "key", error: handshake.error }) })],
    ];
  }

  // The door's reason exists only in its answer, so the refusal is written the moment it comes. The
  // Link keeps its own stall and backoff path, so a passing refusal heals on its own.
  if (handshake._tag === "refused" && s.handshake._tag !== "refused") {
    const { dial, reason, ms } = handshake;

    return [
      next,
      [...sent, record({ record: ClientRecord.cases.connect.make({ dial, result: "refused", reason, ms }) })],
    ];
  }

  const told = outcome(s.handshake, handshake, s.fingerprint ?? "");

  if (told === null) {
    return [next, sent];
  }

  const [after, out] = linked(next, told);

  return [after, [...sent, ...out]];
};

/** A dial's socket closed: the Link's `closed`, timed from when the dial opened. */
const closedIn = (s: WindowModel, m: { readonly dial: number; readonly code: number; readonly at: number }): Step => {
  if (socketDial(s.link) !== m.dial) {
    return [s, []];
  }

  const h = s.handshake;
  const ms = h.dial === m.dial && "since" in h && h.since !== undefined ? Math.max(0, m.at - h.since) : 0;
  return linked(s, LinkMsg.cases.closed.make({ dial: m.dial, code: m.code, fingerprint: s.fingerprint ?? "", ms }));
};

type OwnerMsg = LinkMsg | typeof Own.Type;
type Frame = typeof Own.cases.frame.Type;

/** The Msg the call's own handler takes for an answer to it, or nothing for a malformed result. */
const answerTo = (
  call: Call["_tag"],
  on: { readonly id: number; readonly dial: number },
  result: unknown,
  ms: number,
  fingerprint: string,
  handshake: Handshake,
): ReadonlyArray<OwnerMsg> => {
  switch (call) {
    case "read":
      return Option.match(Schema.decodeUnknownOption(Entries)(result), {
        onNone: () => [],
        onSome: (read) => [Own.cases.read_ok.make({ ...on, value: read.entries, ms })],
      });
    case "wait":
      return Option.match(Schema.decodeUnknownOption(Woke)(result), {
        onNone: () => [],
        onSome: (value) => [Own.cases.wait_ok.make({ ...on, value, ms })],
      });
    case "monitor":
      return Schema.is(Schema.Null)(result) ? [Own.cases.monitor_ok.make({ ...on, value: null, ms })] : [];
    case "open":
      return Option.match(Schema.decodeUnknownOption(Opened)(result), {
        onNone: () => [],
        onSome: (value) => [Own.cases.open_ok.make({ ...on, value, ms })],
      });
    case "send":
      return Option.match(Schema.decodeUnknownOption(Sent)(result), {
        onNone: () => [],
        onSome: (value) => [Own.cases.send_ok.make({ ...on, value, ms })],
      });
    case "knock":
      // A renewed knock keeps or renews the code the Link shows, but only while the handshake still
      // waits on its dial: the handshake decides whether the reply is current. After a grant it is
      // stale, and only its flight settles.
      return Option.match(Schema.decodeUnknownOption(WaitingCode)(result), {
        onNone: () => [],
        onSome: (w) => [
          ...(handshake._tag === "waiting" && handshake.dial === on.dial
            ? [LinkMsg.cases.not_granted.make({ dial: on.dial, fingerprint, ...w, ms })]
            : []),
          Own.cases.knock_ok.make({ ...on, value: null, ms }),
        ],
      });
  }
};

/**
 * Decodes one frame of the link's dial and hands it to its one owner: a number id to its flight's
 * call, a string id or a hello notice to the hello exchange, `pong` to the Link and a view notice
 * to its pid. Anything else changes nothing.
 */
const frameIn = (s: WindowModel, m: Frame, own: (s: WindowModel, msg: OwnerMsg) => Step): Step => {
  if (m.dial !== socketDial(s.link)) {
    return [s, []];
  }

  if (m.text === "pong") {
    return own(s, LinkMsg.cases.pong.make({ dial: m.dial }));
  }

  const decoded = decodeFrame(m.text);

  if (Option.isNone(decoded)) {
    return [s, []];
  }

  const frame = decoded.value;

  if ("id" in frame) {
    const reason = frame.error?.data?.reason;

    if (Predicate.isString(frame.id)) {
      return shook(
        s,
        HandshakeMsg.cases.answer.make({
          dial: m.dial,
          id: frame.id,
          result: frame.result ?? null,
          ...(reason === undefined ? {} : { reason }),
          at: m.at,
        }),
      );
    }

    const id = frame.id;
    const flight = s.flight.find((f) => f.id === id && f.dial === m.dial);

    if (flight === undefined) {
      return [s, []];
    }

    const on = { id, dial: m.dial };
    const tag = flight.call._tag;

    const msgs: ReadonlyArray<OwnerMsg> =
      frame.error === undefined
        ? answerTo(tag, on, frame.result, m.ms ?? 0, s.fingerprint ?? "", s.handshake)
        : [
            Own.cases[`${tag}_err`].make({
              ...on,
              error:
                reason !== undefined && AGAIN.has(reason)
                  ? CallError.cases.unreachable.make({})
                  : CallError.cases.unknown.make({}),
            }),
          ];

    return msgs.reduce<Step>(
      ([acc, cmds], msg) => {
        const [next, more] = own(acc, msg);

        return [next, [...cmds, ...more]];
      },
      [s, []],
    );
  }

  const params = frame.params;

  if (frame.method === "challenge" || frame.method === "client.granted") {
    return Option.match(Schema.decodeUnknownOption(Nonce)(params), {
      onNone: (): Step => [s, []],
      onSome: ({ nonce }) =>
        shook(
          s,
          HandshakeMsg.cases[frame.method === "challenge" ? "challenge" : "granted"].make({
            dial: m.dial,
            nonce,
            at: m.at,
          }),
        ),
    });
  }

  if (frame.method === "gateway.waiting") {
    return Option.match(Schema.decodeUnknownOption(WaitingCode)(params), {
      onNone: (): Step => [s, []],
      onSome: (w) => shook(s, HandshakeMsg.cases.waiting.make({ dial: m.dial, ...w, at: m.at })),
    });
  }

  if (frame.method === "view.whole" || frame.method === "view.patch") {
    return Option.match(Schema.decodeUnknownOption(ViewNotice)(params), {
      onNone: (): Step => [s, []],
      onSome: (notice) => own(s, Own.cases.view.make({ pid: notice.pid, note: params })),
    });
  }

  return [s, []];
};

/**
 * A saved Model loaded into a tab: its own tab keeps its inbox cursor; another tab's inbox is not
 * this one's, so the cursor starts over there. Either way the region mounts empty (0504): the
 * saved burst is not said again, and its id is kept.
 */
const loadedInto = (loaded: WindowModel, tab: string): WindowModel =>
  hushed(loaded.tab === tab ? loaded : { ...loaded, tab, inbox: Inbox.cases.idle.make({ after: 0 }) });

/**
 * Makes the window parent for one client, from the checks of the programs its tiles show.
 *
 * **Details**
 *
 * `decode(pid)` is that pid's own view decoder and `tile(name)` the tile machine of the window
 * registered for a tile's name. Decoder functions and child machines stay outside the saved
 * Model. The machine's `socket` Sub asks for one socket per dial the Link has; its `ctx` names the
 * tiles.
 *
 * @category constructors
 */
export const windowMachineFor = <P extends AnyProgram = AnyProgram>(checks: WindowChecks<P>) => {
  const client = C.clientMachineFor(checks);

  const step: ClientStep = (s, m) => {
    const [next, cmds] = applyCell<C.Client, C.ClientMsg, ReturnType<typeof client.init>[1][number]>(client, s, m);

    return [next, cmds.map((c) => c.pid)];
  };

  const fresh = (t: Shown): TileRow => ({
    ...t,
    reach: Reach.cases.unresolved.make({}),
    recovery: "ready",
    own: checks.tile?.(t.name)?.init(null, {})[0] ?? {},
    refusal: null,
    last: null,
    told: null,
  });

  const machine = Machine.make({
    model: WindowModel,
    msg: Schema.Union([LinkMsg, Own]),
    cmds: [key, now, write, persist, record, ping, hello, enroll, mint],
    types: { ctx: {} as WindowCtx, sub: {} as SocketSub },
    init: (loaded, ctx) => [
      loaded === null
        ? WindowModel.make({
            // A window on tezgah shows no given tile: its tiles come from tezgah's view.
            tiles: ctx.tezgah === undefined ? ctx.tiles.map(fresh) : [],
            tab: ctx.tab,
            inbox: Inbox.cases.idle.make({ after: 0 }),
            said: { id: 0, messages: [] },
            link: linkMachine.init(null, {})[0],
            // Dial 1's exchange waits for its challenge; its socket opening times it.
            handshake: applyCell(
              handshakeMachine,
              handshakeMachine.init(null, {})[0],
              HandshakeMsg.cases.opened.make({ dial: 1 }),
            )[0],
            fingerprint: null,
            dials: 1,
            tries: 0,
            client: client.init(null, {})[0],
            serial: 1,
            flight: [],
            sent: [],
            attempts: {},
            patches: {},
            persist: "not_due",
            rejected: null,
            trouble: null,
            from: {},
            redate: [],
            tezgah:
              ctx.tezgah === undefined
                ? null
                : {
                    reach: TezgahReach.cases.unresolved.make({}),
                    last: null,
                    client: tezgahMachine.init(null, { workspace: ctx.tezgah.workspace })[0],
                    attach: "waiting",
                    cursors: {},
                  },
            prefix: idle,
            polite: null,
            size: null,
            presses: 0,
          })
        : loadedInto(loaded, ctx.tab),
      [key({ rejected: null })],
    ],
    update: {
      ...linkUpdate,
      press: (s, m): Step => pressed(s, step, m.tile, m.m, m.via ?? "button"),
      key: (s, m): Step => {
        const [next, cmds] = checks.keys === undefined ? [s, []] : pressedKey(s, step, checks.keys, m.key, m.at);

        return [{ ...next, presses: s.presses + 1 }, cmds];
      },
      size: (s, m): Step => [{ ...s, size: { width: m.width, height: m.height } }, []],
      focus: (s, m): Step => focusedIn(s, step, m.tile, m.cursor),
      tile: (s, m): Step => {
        const t = s.tiles.find((t) => t.id === m.id);
        const child = t && checks.tile?.(t.name);

        if (t === undefined || child === undefined) {
          return [s, []];
        }

        const msg = Schema.decodeUnknownResult(Schema.toType(child.msg))(m.msg);

        // A tile's own Msg names its case by its key, as every tea Msg does.
        // oxlint-disable-next-line fabrika/no-hand-tag -- a reader that knows no cases: a tile's own Msg, any machine's, so its key is an open string (as for ledger/Log.ts)
        if (Result.isFailure(msg) || !Schema.is(Schema.Struct({ _tag: Schema.String }))(msg.success)) {
          return [s, []];
        }

        const [own, cmds] = applyCell(child, t.own, msg.success);

        if (!Schema.is(child.model)(own) || !Schema.is(Schema.Json)(own)) {
          return [s, []];
        }

        // A queued submit can arrive after the link drops. Keep its draft until a press can land.
        if (cmds.some((cmd) => cmd._tag === "press") && t.reach._tag !== "open") {
          return [s, []];
        }

        let next: WindowModel = { ...s, tiles: s.tiles.map((row) => (row.id === t.id ? { ...row, own } : row)) };
        const out: Array<Out[number]> = [];

        for (const cmd of cmds) {
          if (cmd._tag === "press" && Schema.is(Schema.Struct({ m: Schema.Json }))(cmd)) {
            const [after, sent] = pressed(next, step, t.id, cmd.m, "button");
            next = after;
            out.push(...sent);
          }
        }

        return [next, out];
      },
      key_ok: (s, m): Step => [
        { ...s, fingerprint: m.value.fingerprint },
        [record({ record: ClientRecord.cases.key.make({ result: m.value.found }) })],
      ],
      key_err: (s, m): Step => {
        const error = platformFailure(m.error);
        const [next, cmds] = linked(s, LinkMsg.cases.blocked.make({ reason: error }));
        return [next, [...cmds, record({ record: ClientRecord.cases.failure.make({ op: "key", error }) })]];
      },
      socket_failure: (s, m): Step => [
        s,
        socketDial(s.link) === m.dial
          ? [record({ record: ClientRecord.cases.failure.make({ op: m.op, error: m.error }) })]
          : [],
      ],
      socket_opened: (s, m): Step =>
        socketDial(s.link) === m.dial ? shook(s, HandshakeMsg.cases.opened.make({ dial: m.dial, at: m.at })) : [s, []],
      frame: (s, m): Step => frameIn(s, m, (at, msg) => applyCell(machine, at, msg)),
      socket_closed: (s, m): Step => closedIn(s, m),
      hello_ok: (s, m): Step => shook(s, m),
      hello_err: (s, m): Step => shook(s, m),
      enroll_ok: (s, m): Step => shook(s, knock.ok(knock(m.cmd), null, m.at)),
      enroll_err: (s, m): Step =>
        // oxlint-disable-next-line fabrika/no-hand-tag -- the enroll answer re-keyed as the knock answer it stands for: tea's `knock.err` takes only knock's own errors, and this one can carry tea's `malformed_result`
        shook(s, { _tag: "knock_err", cmd: knock(m.cmd), error: m.error, at: m.at }),
      now_ok: (s, m): Step => dated(s, step, m.cmd.n, m.value),
      now_err: (s, m): Step => [{ ...s, redate: [...new Set([...s.redate, m.cmd.n])] }, []],
      write_ok: (s): Step => [s, []],
      write_err: (s, m): Step => {
        const found = answered(s, m.cmd, m.cmd.call._tag);

        if (found === null) {
          return [s, []];
        }

        const call = found.call;

        const next: WindowModel = {
          ...s,
          flight: found.rest,
          tezgah: call._tag === "read" ? lostRead(s.tezgah, m.cmd.id) : s.tezgah,
          sent: call._tag === "send" ? s.sent.filter((l) => l !== call.letter) : s.sent,
          tiles:
            call._tag === "read"
              ? s.tiles.map((t) =>
                  t.reach._tag === "resolving" && t.reach.id === m.cmd.id
                    ? { ...t, reach: Reach.cases.missing.make({}) }
                    : t,
                )
              : s.tiles,
        };

        // The inbox's own call never reached the door: it waits for the resend timer.
        return [s.inbox._tag !== "idle" && s.inbox.id === m.cmd.id ? inboxIdle(next) : next, []];
      },
      read_ok: (s, m): Step => {
        const found = answered(s, m, "read");

        if (found === null) {
          return [s, []];
        }

        if (s.inbox._tag === "reading" && s.inbox.id === m.id) {
          return inboxRead({ ...s, flight: found.rest }, m.dial, m.value);
        }

        const link = s.tezgah;

        if (link !== null && link.reach._tag === "resolving" && link.reach.id === m.id && found.call._tag === "read") {
          const name = found.call.stream.slice("processes/".length);
          const pid = C.resolveName(m.value, name, isBrain);
          const next = { ...s, flight: found.rest };

          if (pid === null) {
            return [{ ...next, tezgah: { ...link, reach: TezgahReach.cases.missing.make({}) } }, []];
          }

          const [written, cmds] = wrote(next, m.dial, [Call.cases.open.make({ pid })]);

          return [
            { ...written, tezgah: { ...link, reach: TezgahReach.cases.opening.make({ pid, id: written.serial - 1 }) } },
            cmds,
          ];
        }

        const tile = s.tiles.find((t) => t.reach._tag === "resolving" && t.reach.id === m.id);

        if (tile?.reach._tag !== "resolving") {
          return [{ ...s, flight: found.rest }, []];
        }

        const life = C.foldName(tile.reach.life, m.value, tile.name, isBrain);
        const [seen] = step(
          s.client,
          C.ClientMsg.cases.read.make({
            rev: Math.max(
              s.client.seen,
              ...m.value.flatMap((e) =>
                Predicate.isObject(e) && Predicate.hasProperty(e, "rev") && Predicate.isNumber(e.rev) ? [e.rev] : [],
              ),
            ),
          }),
        );
        return resolved({ ...s, client: seen, flight: found.rest }, m.dial, tile, life, m.value.length === PAGE);
      },
      read_err: (s, m): Step => {
        const found = answered(s, m, "read");

        if (found !== null && s.inbox._tag === "reading" && s.inbox.id === m.id) {
          return [inboxIdle({ ...s, flight: found.rest }), []];
        }

        return found === null
          ? [s, []]
          : [
              {
                ...s,
                flight: found.rest,
                trouble: "No process",
                tezgah: lostRead(s.tezgah, m.id),
                tiles: s.tiles.map((t) =>
                  t.reach._tag === "resolving" && t.reach.id === m.id
                    ? { ...t, reach: Reach.cases.missing.make({}) }
                    : t,
                ),
              },
              [],
            ];
      },
      open_ok: (s, m): Step => {
        const found = answered(s, m, "open");

        if (found === null || found.call._tag !== "open") {
          return [s, []];
        }

        const pid = found.call.pid;

        // tezgah's view is the window's tezgah link's own, decoded as `TezgahView` by its tezgah child, never by a
        // program's decoder.
        if (s.tezgah !== null && "pid" in s.tezgah.reach && s.tezgah.reach.pid === pid) {
          return tezgahTook(
            { ...s, flight: found.rest, trouble: null },
            pid,
            TezgahMsg.cases.server.make({ ...m.value }),
            fresh,
          );
        }

        const [next, rows, asks] = noticed({ ...s, flight: found.rest }, step, pid, { type: "whole", ...m.value });

        if (asks.length > 0 && s.link._tag === "online") {
          const calls = asks
            .filter((p) => next.tiles.some((t) => held(t.reach)?.pid === p))
            .filter((p) => !next.flight.some((f) => f.call._tag === "open" && f.call.pid === p))
            .map((p) => Call.cases.open.make({ pid: p }));

          const [written, writes] = wrote({ ...next, trouble: "Bad view" }, s.link.dial, calls);

          return [written, [...rows, ...writes]];
        }

        return [
          next.client.views[pid] !== s.client.views[pid] ? opened(next, pid) : { ...next, trouble: "Bad view" },
          rows,
        ];
      },
      open_err: (s, m): Step => {
        const found = answered(s, m, "open");

        return found === null ? [s, []] : [{ ...s, flight: found.rest, trouble: "No view" }, []];
      },
      send_ok: (s, m): Step => {
        const found = answered(s, m, "send");

        if (found === null || found.call._tag !== "send") {
          return [s, []];
        }

        const letter = found.call.letter;
        const slot = s.client.pending.find((p) => p._tag === "ready" && p.letter === letter);
        const [client] = step(s.client, C.ClientMsg.cases.reply.make({ letter, answer: m.value }));
        const owner = slot && s.from[slot.n]?.tile;

        // A letter to tezgah names its command, and its refusal is no tile's.
        const refusal =
          m.value._tag === "refused" &&
          slot !== undefined &&
          s.from[slot.n]?.does === undefined &&
          s.tiles.some((t) => t.id === owner)
            ? { m: slot.m, reason: m.value.reason }
            : null;

        // A focus move is dropped on its refusal, or once its position is shown (0167).
        const [moves, rows] = tezgahStep(
          s,
          m.value._tag === "accepted"
            ? TezgahMsg.cases.accepted.make({ letter, pos: m.value.pos, ms: m.ms })
            : TezgahMsg.cases.refused.make({ letter, ms: m.ms }),
        );

        const settled = {
          ...moves,
          client,
          flight: found.rest,
          sent: s.sent.filter((l) => l !== letter),
          attempts: Object.fromEntries(Object.entries(s.attempts).filter(([l]) => l !== letter)),
          from: Object.fromEntries(Object.entries(s.from).filter(([n]) => Number(n) !== slot?.n)),
          tiles: refusal === null ? s.tiles : s.tiles.map((t) => (t.id === owner ? { ...t, refusal } : t)),
        };

        return [
          refusal === null || owner === undefined
            ? settled
            : say(settled, StatusMessage.cases.refused.make({ tile: owner, ...refusal })),
          [
            record({
              record: ClientRecord.cases.reply.make({
                letter,
                result: m.value._tag,
                attempts: s.attempts[letter] ?? 0,
                ms: m.ms,
                ...(m.value._tag === "refused"
                  ? { reason: /^[a-z_]{1,40}$/.test(m.value.reason) ? m.value.reason : "other" }
                  : {}),
              }),
            }),
            ...rows,
          ],
        ];
      },
      send_err: (s, m): Step => {
        const found = answered(s, m, "send");

        if (found === null || found.call._tag !== "send") {
          return [s, []];
        }

        const letter = found.call.letter;

        return [
          {
            ...s,
            flight: found.rest,
            sent: m.error._tag === "unreachable" ? s.sent.filter((l) => l !== letter) : s.sent,
          },
          [],
        ];
      },
      wait_ok: (s, m): Step => waitAnswered(s, m, true),
      wait_err: (s, m): Step => waitAnswered(s, m, false),
      monitor_ok: (s, m): Step => monitorAnswered(s, m, "watching"),
      monitor_err: (s, m): Step => monitorAnswered(s, m, "refused"),
      knock_ok: (s, m): Step => {
        const f = answered(s, m, "knock");

        return f === null ? [s, []] : [{ ...s, flight: f.rest }, []];
      },
      knock_err: (s, m): Step => {
        const f = answered(s, m, "knock");

        return f === null ? [s, []] : [{ ...s, flight: f.rest }, []];
      },
      view: (s, m): Step => {
        if (s.tezgah !== null && "pid" in s.tezgah.reach && s.tezgah.reach.pid === m.pid) {
          const note = decodeTezgahNote(m.note);

          return Option.isNone(note)
            ? [s, []]
            : tezgahTook(
                s,
                m.pid,
                note.value.type === "whole"
                  ? TezgahMsg.cases.server.make({ rev: note.value.rev, view: note.value.view })
                  : TezgahMsg.cases.patch.make({ base: note.value.base, rev: note.value.rev, patch: note.value.patch }),
                fresh,
              );
        }

        const [next, rows, asks] = noticed(s, step, m.pid, m.note);
        const after = next.client.views[m.pid] !== s.client.views[m.pid] ? opened(next, m.pid) : next;

        if (asks.length === 0 || s.link._tag !== "online" || !s.tiles.some((t) => held(t.reach)?.pid === m.pid)) {
          return [after, rows];
        }

        if (after.flight.some((f) => f.call._tag === "open" && f.call.pid === m.pid)) {
          return [after, rows];
        }

        const [written, writes] = wrote(after, s.link.dial, [Call.cases.open.make({ pid: m.pid })]);

        return [written, [...rows, ...writes]];
      },
      seen: (s, m): Step => [{ ...s, client: step(s.client, C.ClientMsg.cases.read.make({ rev: m.rev }))[0] }, []],
      resend: (s, m): Step => {
        // Every tick ends the polite region's burst, on any dial or none.
        const quiet = hushed(s);

        if (socketDial(quiet.link) !== m.dial) {
          return [quiet, []];
        }

        const [flushed, out] = flush({ ...quiet, redate: [] });

        const [next, waits] =
          flushed.link._tag === "online" && flushed.inbox._tag === "idle"
            ? waitInbox(flushed, flushed.link.dial, flushed.inbox.after)
            : [flushed, []];

        return [next, [...s.redate.map((n) => now({ n })), ...out, ...waits]];
      },
      persist_ok: (s, m): Step => [
        s,
        [record({ record: ClientRecord.cases.persist.make({ result: m.value ? "granted" : "refused" }) })],
      ],
      persist_err: (s, m): Step => [
        s,
        [
          record({
            record:
              m.error._tag === "unsupported"
                ? ClientRecord.cases.failure.make({ op: "persist", error: "NotSupportedError" })
                : m.error._tag === "ClientKeyError"
                  ? ClientRecord.cases.failure.make({ op: "persist", error: platformFailure(m.error) })
                  : ClientRecord.cases.persist.make({ result: "failed" }),
          }),
        ],
      ],
      record_ok: (s): Step => [s, []],
      // A failure row is attempted once; a failing failure row cannot recurse.
      record_err: (s, m): Step => [
        s,
        m.cmd.record._tag === "failure"
          ? []
          : [record({ record: ClientRecord.cases.failure.make({ op: "record", error: platformFailure(m.error) }) })],
      ],
      ping_ok: (s): Step => [s, []],
      ping_err: (s): Step => [s, []],
      // The window's own attach, as a letter to its tezgah: it makes the workspace when it is missing.
      mint_ok: (s, m): Step => {
        const link = s.tezgah;
        const split = m.cmd.split;

        // A split's new tile: sent only while its tile is still on the drawn workspace.
        if (split !== undefined) {
          const drawn = drawnSpace(link);

          if (drawn === null || !order(drawn.space.layout).includes(split.from)) {
            return [s, []];
          }

          // A split moves focus off its tile, so it carries that tile's cursor (0165).
          const did = TezgahDid.make({
            does: split.does,
            from: split.from,
            tile: m.value.tile,
            via: ByKeys.make({ keys: split.keys }),
            cursor: link?.cursors[split.from] ?? null,
          });
          return toTezgah(s, step, did, split.does, split.from);
        }

        if (link === null || link.attach !== "minting") {
          return [s, []];
        }

        if (link.reach._tag !== "open") {
          return [{ ...s, tezgah: { ...link, attach: "waiting" } }, []];
        }

        const n = s.client.written;
        const attach = TezgahAttach.make({ workspace: link.client.workspace, tile: m.value.tile });
        const [client] = step(s.client, C.ClientMsg.cases.press.make({ pid: link.reach.pid, m: attach }));
        return [{ ...s, client, tezgah: { ...link, attach: "sent" } }, [now({ n })]];
      },
      mint_err: (s, m): Step =>
        m.cmd.split === undefined && s.tezgah?.attach === "minting"
          ? [{ ...s, tezgah: { ...s.tezgah, attach: "waiting" } }, []]
          : [s, []],
    },
    subs: [
      // oxlint-disable-next-line fabrika/no-hand-tag -- a tea Sub entry: tea gives a built-in Sub no maker, and its `deps` is a function no schema makes
      { _tag: "timer", deps: (s) => timerDeps(s.link) },
      {
        // oxlint-disable-next-line fabrika/no-hand-tag -- a tea Sub entry: tea gives a built-in Sub no maker, and its `deps` is a function no schema makes
        _tag: "timer",
        deps: (s) =>
          s.redate.length > 0 ||
          s.said.messages.length > 0 ||
          (s.link._tag === "online" &&
            (s.inbox._tag === "idle" || C.sendable(s.client).some((p) => !s.sent.includes(p.letter))))
            ? { ms: 2000, msg: Own.cases.resend.make({ dial: socketDial(s.link) ?? 0 }) }
            : null,
      },
      {
        // oxlint-disable-next-line fabrika/no-hand-tag -- a tea Sub entry: a Sub is named by its runner, and its `deps` is a function no schema makes
        _tag: "socket",
        deps: (s) => {
          const dial = socketDial(s.link);

          return dial === null ? null : { dial, rejected: s.rejected, tries: s.tries };
        },
      },
    ],
  });

  // Every step, whatever its Msg, records a change of the window's strips (the plan's `fold` row).
  const update = Object.fromEntries(
    Object.entries(machine.update).map(([type, cell]: [string, (s: WindowModel, m: never) => Step]) => [
      type,
      (s: WindowModel, m: never): Step => folded(s, cell(s, m)),
    ]),
  ) as typeof machine.update;

  // The machine's `model` is `WindowModel` itself; its own type lets a caller save and load it.
  return Object.assign(machine, { model: WindowModel, update });
};

/**
 * The type of every Msg a window parent takes.
 *
 * @category models
 */
export type WindowMsg =
  ReturnType<typeof windowMachineFor> extends Machine<WindowModel, infer M, infer _C, infer _U, infer _X> ? M : never;

/**
 * One key press a page hands its window, as the window's `key` Msg says it.
 *
 * @category models
 */
export type KeyPress = Types.ExtractTag<WindowMsg, "key">;

/**
 * The presses a page handed its window that the window may not have read yet, in the order they
 * were pressed. `from` is how many presses the window had read when the first of `keys` was handed
 * over, so the window's `presses` says how many of them it has read since.
 *
 * @category models
 */
export type Unread = { readonly from: number; readonly keys: ReadonlyArray<KeyPress> };

/**
 * What a page does with one press: `leave` it to the browser and the focused tile, with no Msg;
 * `pass` it to the window and keep its default, as the prefix again reaches the tile (tmux's
 * send-prefix); or `take` it, for the window alone.
 *
 * @category models
 */
export type Handling = "leave" | "pass" | "take";

/**
 * Returns what a page does with one press, judged as the window will judge it when it reads it:
 * against the window as it is after every press the page handed it before this one (0278). A page
 * must answer at once, to keep or stop the press's default, while the run reads its line later, so
 * `now`, the run's state, may not have read the presses in `unread` yet. Those it has not read are
 * read here first, by the window's own update, and nothing of that is kept: the answer's `unread`
 * holds only presses still waiting, with this one added when the window is handed it.
 * Only presses are read ahead. A click or a tezgah frame still waiting in the run's line before
 * them is not seen here, so a press right behind one is judged against the older focus and tiles
 * (finding 2026-11-15-handle-skips-non-press-msgs).
 *
 * @category getters
 */
export const handle = (
  window: ReturnType<typeof windowMachineFor>,
  table: Keys.Table,
  now: WindowModel,
  unread: Unread,
  press: KeyPress,
): { readonly handling: Handling; readonly unread: Unread } => {
  const waiting = unread.keys.slice(Math.max(0, now.presses - unread.from));
  const ahead = waiting.reduce((s, m) => applyCell(window, s, m)[0], now);
  const routed = Keys.route(table, ahead.prefix, null, press);

  const handling: Handling =
    routed._tag === "platform" || (routed._tag === "tile" && ahead.prefix._tag === "idle")
      ? "leave"
      : routed._tag === "tile"
        ? "pass"
        : "take";

  return {
    handling,
    unread: { from: now.presses, keys: handling === "leave" ? waiting : [...waiting, press] },
  };
};
