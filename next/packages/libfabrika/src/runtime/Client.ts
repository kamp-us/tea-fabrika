/**
 * A program client's own rules. One tea machine, made by one factory (decision 0046 and its
 * 2026-11-10 amendments): its Model is `Client`, its Msgs are plain data, and it does no input or
 * output. It is the same in a browser tab, in Electron and in a headless client. It imports no
 * transport and no window code; the library's window parent (`client/WindowMachine.ts`) steps it
 * by hand, by sending it Msgs.
 *
 * Its states: each pending letter is `dating` or `ready`. `press` adds a `dating` letter, `dated`
 * moves `dating` to `ready`, and `reply` (accepted, or a program's refusal) removes a `ready` one.
 * `read` and `notice` move no letter.
 *
 * A press reserves a numbered slot first and captures what the person saw: the view revision shown
 * for that process and the ledger revision last read. Its time and letter id come later, from a
 * Cmd the window runs, and fill that same slot. A letter keeps its id and body on every resend, and
 * only its own terminal answer removes it.
 */
import { Cmd, Machine } from "@demlik/tea/effect";
import { Option, Result, Schema } from "effect";
import * as Arr from "effect/Array";
import { ExitReason } from "../processes/ExitReason.ts";
import { apply } from "./Patch.ts";
import { Sent } from "./Runner.ts";

// --- The Model ----------------------------------------------------------------------------------

/**
 * Schema for one press on its way: `dating` until the window has given it a letter id and time,
 * then `ready`. `n` is the local queue position, never another letter id. `pid` is the tile's
 * process: its id, or the registered name the client resolves on each dial.
 *
 * @category schemas
 */
export const Pending = Schema.TaggedUnion({
  dating: {
    n: Schema.Int,
    pid: Schema.String,
    m: Schema.Json,
    seen: Schema.Int,
    viewRev: Schema.Int,
  },
  ready: {
    n: Schema.Int,
    pid: Schema.String,
    m: Schema.Json,
    seen: Schema.Int,
    viewRev: Schema.Int,
    letter: Schema.String,
    sentAt: Schema.String,
    traceId: Schema.optionalKey(Schema.String),
  },
});

export type Pending = typeof Pending.Type;

/**
 * Schema for a checked view as installed: the revision it was made at, and the value.
 *
 * @category schemas
 */
export const Shown = Schema.Struct({ rev: Schema.Int, view: Schema.Json });

export type Shown = typeof Shown.Type;

/**
 * Schema for everything a program client keeps between messages: what it promised (`pending`), and
 * what it shows (`views`, by process).
 *
 * @category schemas
 */
export const Client = Schema.Struct({
  /** Presses made so far: the next slot's number. */
  written: Schema.Int,
  /** The highest ledger revision this client has actually read. Never a view revision. */
  seen: Schema.Int,
  pending: Schema.Array(Pending),
  views: Schema.Record(Schema.String, Shown),
});

export type Client = typeof Client.Type;

const emptyClient: Client = Client.make({ written: 0, seen: 0, pending: [], views: {} });

// --- The Msgs and the one Cmd -------------------------------------------------------------------

/** What came back for one letter: a decoded `Sent` (placed, or the program's refusal), a transport
 *  failure to retry, or an answer the client cannot read. */
const Reply = Schema.TaggedUnion({
  accepted: Sent.cases.accepted.fields,
  refused: Sent.cases.refused.fields,
  unreachable: {},
  unknown: {},
});

/**
 * Schema for what the client machine takes, each Msg made with its case's maker.
 *
 * @category schemas
 */
export const ClientMsg = Schema.TaggedUnion({
  /** A person pressed `m`, one of the program's Msgs, on the tile of `pid`. */
  press: { pid: Schema.String, m: Schema.Unknown },
  /** Slot `n`'s letter id and time, from the Cmd the window ran. */
  dated: {
    n: Schema.Int,
    letter: Schema.String,
    sentAt: Schema.String,
    traceId: Schema.optionalKey(Schema.String),
  },
  /** What came back for `letter`. */
  reply: { letter: Schema.String, answer: Reply },
  /** This client has read the ledger up to revision `rev`. */
  read: { rev: Schema.Int },
  /** One view notification for `pid`, as it arrived: a whole view, a patch, or junk. */
  notice: { pid: Schema.String, note: Schema.Unknown },
});

/**
 * A Msg the client machine takes: `press`, `dated`, `reply`, `read` or `notice`.
 *
 * @category models
 */
export type ClientMsg = typeof ClientMsg.Type;

/** Ask for a whole view of `pid`: the last good one stays shown until it comes. The window turns
 *  it into its own move. */
const ask = Cmd.make("ask", { input: Schema.Struct({ pid: Schema.String }), ok: Schema.Null, err: [] });

/**
 * What a client checks a view with: each program's own decoder, by pid. The factory captures it, so
 * it is never in the Model, a Msg or a Cmd's input.
 *
 * @category models
 */
export type ClientChecks = { readonly decode?: (pid: string) => (view: unknown) => unknown };

// --- The rules the update uses ------------------------------------------------------------------

type Step = readonly [Client, ReadonlyArray<ReturnType<typeof ask>>];

/** Reserves the next slot for a press on `pid`, with what this client showed and had read. */
const press = (c: Client, input: { readonly pid: string; readonly m: unknown }): Client => {
  const m = Schema.decodeUnknownResult(Schema.Json)(input.m);

  const slot = Pending.cases.dating.make({
    n: c.written,
    pid: input.pid,
    m: Result.isSuccess(m) ? m.success : null,
    seen: c.seen,
    viewRev: c.views[input.pid]?.rev ?? 0,
  });

  return { ...c, written: c.written + 1, pending: [...c.pending, slot] };
};

/** Fills slot `n` with its letter id and time. A missing slot or one already dated is unchanged: a
 *  second answer never rewrites a letter. */
const dated = (
  c: Client,
  n: number,
  stamp: { readonly letter: string; readonly sentAt: string; readonly traceId?: string },
): Client => {
  const at = Option.getOrElse(
    Arr.findFirstIndex(c.pending, (p) => p.n === n),
    () => -1,
  );

  const slot = c.pending[at];

  if (slot === undefined || slot._tag !== "dating") {
    return c;
  }

  const ready = Pending.cases.ready.make({
    n: slot.n,
    pid: slot.pid,
    m: slot.m,
    seen: slot.seen,
    viewRev: slot.viewRev,
    letter: stamp.letter,
    sentAt: stamp.sentAt,
    ...(stamp.traceId === undefined ? {} : { traceId: stamp.traceId }),
  });

  return { ...c, pending: Arr.map(c.pending, (p, i) => (i === at ? ready : p)) };
};

/** Settles `letter` only on its own terminal answer. Every other answer keeps it for a resend. */
const reply = (c: Client, letter: string, answer: Pick<typeof Reply.Type, "_tag">): Client => {
  if (answer._tag !== "accepted" && answer._tag !== "refused") {
    return c;
  }

  const kept = Arr.filter(c.pending, (p) => p._tag !== "ready" || p.letter !== letter);

  return kept.length === c.pending.length ? c : { ...c, pending: kept };
};

/** Raises what this client has read to ledger revision `rev`. */
const read = (c: Client, rev: number): Client => (rev > c.seen ? { ...c, seen: rev } : c);

const Whole = Schema.Struct({ type: Schema.Literal("whole"), rev: Schema.Int, view: Schema.Unknown });

const Patched = Schema.Struct({
  type: Schema.Literal("patch"),
  base: Schema.Int,
  rev: Schema.Int,
  patch: Schema.Unknown,
});

const decodeNote = Schema.decodeUnknownResult(Schema.Union([Whole, Patched]));

/** Runs the program's own decoder on a candidate, so a throw is a refusal and never escapes. */
const check = (decode: (u: unknown) => unknown, candidate: unknown) =>
  Result.flatMap(Result.try({ try: () => decode(candidate), catch: () => "refused" as const }), (checked) =>
    Schema.decodeUnknownResult(Schema.Json)(checked),
  );

const install = (c: Client, pid: string, shown: Shown): Client => ({
  ...c,
  views: { ...c.views, [pid]: shown },
});

/**
 * One view notification for `pid`. A whole view that decodes replaces the shown one, a lower
 * revision included (the data was reset). A patch must start at the shown revision and end one
 * past it; an older one does nothing, and a gap, a bad patch or a candidate the decoder refuses
 * keeps the last good view and asks for a whole one. Junk does nothing. It never throws.
 */
const noticed = (c: Client, pid: string, note: unknown, decode: (u: unknown) => unknown): Step => {
  const same: Step = [c, []];
  const asked: Step = [c, [ask({ pid })]];
  const decoded = decodeNote(note);

  if (Result.isFailure(decoded)) {
    return same;
  }

  const n = decoded.success;

  if (n.type === "whole") {
    const view = check(decode, n.view);

    return Result.isSuccess(view) ? [install(c, pid, { rev: n.rev, view: view.success }), []] : asked;
  }

  const shown = c.views[pid];

  if (shown === undefined) {
    return asked;
  }

  if (n.rev <= shown.rev) {
    return same;
  }

  if (n.base !== shown.rev || n.rev !== shown.rev + 1) {
    return asked;
  }

  const next = Result.flatMap(apply(shown.view, n.patch), (candidate) => check(decode, candidate));

  return Result.isSuccess(next) ? [install(c, pid, { rev: n.rev, view: next.success }), []] : asked;
};

const anyView = (view: unknown): unknown => view;

// --- The machine --------------------------------------------------------------------------------

/**
 * Makes the client machine, checking each view with `checks`: the program's own decoder for its pid,
 * else any JSON view.
 *
 * @category machines
 */
export const clientMachineFor = (checks: ClientChecks) =>
  Machine.make({
    model: Client,
    msg: ClientMsg,
    cmds: [ask],
    init: (loaded: Client | null) => [loaded ?? emptyClient, []],
    update: {
      press: (c, m): Step => [press(c, m), []],
      dated: (c, m): Step => [dated(c, m.n, m), []],
      reply: (c, m): Step => [reply(c, m.letter, m.answer), []],
      read: (c, m): Step => [read(c, m.rev), []],
      notice: (c, m): Step => noticed(c, m.pid, m.note, checks.decode?.(m.pid) ?? anyView),
      // The window turns `ask` into its own move and never runs it, so no answer comes back.
      ask_ok: (c): Step => [c, []],
      ask_err: (c): Step => [c, []],
    },
  });

// --- Reads of the Model -------------------------------------------------------------------------

type Ready = typeof Pending.cases.ready.Type;

const isReady = (p: Pending): p is Ready => p._tag === "ready";

/**
 * Returns the letters that may go now: ready ones ahead of the first slot still waiting for its
 * time.
 *
 * @category getters
 */
export const sendable = (c: Client): ReadonlyArray<Ready> => {
  const out: Array<Ready> = [];

  for (const p of c.pending) {
    if (!isReady(p)) {
      break;
    }

    out.push(p);
  }

  return out;
};

// --- Resolving the fixed names ------------------------------------------------------------------

/** What `resolveName` reads of a process entry as `ledger.read` sent it: one of the three cases it
 *  folds, its writer and its body. `app/` does not import `data/`, whose `Entry` this is a part of;
 *  an entry of any other case is not one of these, and is skipped. */
const Life = { by: Schema.String, body: Schema.Unknown };

const decodeEntry = Schema.decodeUnknownOption(Schema.TaggedUnion({ started: Life, restarted: Life, exited: Life }));

const decodeLife = Schema.decodeUnknownOption(
  Schema.Struct({
    process: Schema.String,
    name: Schema.optionalKey(Schema.String),
    reason: Schema.optionalKey(Schema.Unknown),
  }),
);

const decodeRev = Schema.decodeUnknownOption(Schema.Struct({ rev: Schema.Int }));

/**
 * Schema for what a client knows of a registered name after reading some of its `processes/<name>`
 * entries: `after`, the last rev folded; `live`, the newest start or restart, unless a later exit
 * ended it; and `ended`, the newest exit with its reason.
 *
 * @category schemas
 */
export const NameFold = Schema.Struct({
  after: Schema.Int,
  live: Schema.NullOr(Schema.String),
  ended: Schema.NullOr(Schema.Struct({ pid: Schema.String, reason: ExitReason })),
});

export type NameFold = typeof NameFold.Type;

/**
 * The fold of a name before any entry is read.
 *
 * @category constructors
 */
export const emptyFold: NameFold = { after: 0, live: null, ended: null };

/** One entry folded in. Only the brain's own `started`, `restarted` and `exited` count. */
const foldEntry = (fold: NameFold, raw: unknown, name: string, by: (writer: string) => boolean): NameFold => {
  const after = Option.match(decodeRev(raw), { onNone: () => fold.after, onSome: ({ rev }) => rev });
  const entry = Option.getOrNull(decodeEntry(raw));
  const life = entry === null || !by(entry.by) ? null : Option.getOrNull(decodeLife(entry.body));

  if (entry === null || life === null) {
    return { ...fold, after };
  }

  if (entry._tag !== "exited") {
    const named = life.name === undefined || life.name === name;

    return { ...fold, after, live: named ? life.process : fold.live };
  }

  const reason = Schema.decodeUnknownOption(ExitReason)(life.reason);

  return {
    after,
    live: life.process === fold.live ? null : fold.live,
    ended: Option.match(reason, { onNone: () => fold.ended, onSome: (r) => ({ pid: life.process, reason: r }) }),
  };
};

/**
 * Folds one page of a name's `processes/<name>` entries, as `ledger.read` sent them, into `fold`.
 * `by` says whether a writer is the brain's own, the one the client trusts for process facts. A
 * fold over the pages in order is the fold over the whole list.
 *
 * @category getters
 */
export const foldName = (
  fold: NameFold,
  entries: ReadonlyArray<unknown>,
  name: string,
  by: (writer: string) => boolean,
): NameFold => Arr.reduce(entries, fold, (acc, raw) => foldEntry(acc, raw, name, by));

/**
 * Returns the live process a registered name points at, from its `processes/<name>` entries as read:
 * the newest start or restart by the brain's own writer, unless a later exit ended it. It returns
 * `null` when no such process is live.
 *
 * @category getters
 */
export const resolveName = (
  entries: ReadonlyArray<unknown>,
  name: string,
  by: (writer: string) => boolean,
): string | null => foldName(emptyFold, entries, name, by).live;
