import { applyCell } from "@demlik/tea";
// P18 slice 1, next/ (ticket 290): the window parent, moved from Tuval into the library with its
// laws. P14 slice 2's laws (ticket 828: L8 connection, L9 records) keep every assertion (P18 L1); P18
// adds L3 (each frame reaches one owner), L6 (a cut Model continues the same), L10 (the wire's
// frame families) and L11 (a closed dial's connect row keeps its code), at the end of this file.
//
// The shape the P14 laws hold `client/WindowMachine.ts` to, from P14's plan (the build may add more):
// - `windowMachineFor({ decode, tile })`: one tea machine factory, whose ctx is `{ tiles: [{id, name}] }`.
//   `decode(pid)` is that pid's own view decoder (it returns the checked view or throws), passed to
//   libfabrika's client machine, which captures it. `tile(name)` is the tile machine of the window
//   registered for that tile, or undefined when it has none: a tea machine whose one Cmd is
//   `press {m}`, which the parent never runs but sends on as a letter. Init is the link's `dialing` on
//   dial 1, every tile `unresolved` with `own` its tile machine's init Model (`{}` without one) and
//   `refusal` null, and one `key {rejected: null}` Cmd.
// - Model `WindowModel`: {tiles: [{id, name, reach, own, refusal}], link, dials, client, serial,
//   flight: [{id, dial, call}], sent, attempts, patches, persist: not_due | due | asked, rejected,
//   trouble}. `reach` is unresolved{} | resolving{id} | opening{pid, id} | open{pid} | missing{}.
//   `refusal` is null or {m, reason}: the tile's last refused letter, until its next press.
// - A brain call is `write {call, id, dial}`, settling when its frame is handed over (A13). `call` is
//   read{stream, after} (ledger.read of `processes/<name>`), open{pid} (view.open), send{pid, letter,
//   n, m, sentAt, seen, traceId?} (process.send) or knock{}. The link's knock may also go out as the
//   link's own `knock` Cmd.
// - Msgs by `type`: the link's own (admitted, not_granted, granted, closed, retry, beat, pong,
//   stalled, renew, blocked, ask_again), each passed to the link machine; press{tile, m, via?}; a tile's
//   own Msg tile{id, msg}, stepped through that tile's machine, whose `press` Cmd becomes a press; a view
//   notice view{pid, note}; seen{rev}; resend{dial}; the socket's answers to writes, each naming its
//   write's {id, dial}: read_ok{value: entries, ms}, read_err{error}, open_ok{value: {rev, view}, ms},
//   open_err{error}, send_ok{value: accepted{rev, pos} | refused{reason}, ms}, send_err{error}; and
//   tea's answers to its Cmds, `<cmd>_ok {cmd, value}` and `<cmd>_err {cmd, error}`, for key (value
//   {found: created | reused | replaced}), now (value {letter, sentAt, traceId?}), write, persist
//   (value boolean), record and ping.
// - Cmds: write, now{n}, record{record}, persist{}, key{rejected}, ping, knock. A `record` carries
//   one libfabrika `ClientRecord`; its handler adds the row's id, tab, build and `sentAt` (L10). A
//   refused `reply` row carries `reason`: the answer's reason when it is a word (/^[a-z_]{1,40}$/),
//   else `other`. No input text reaches a row.
//
// The walk starts at the real init and folds the real update. Each step reads the folded model and the
// walk's ledger of what is really waiting (the writes in flight, the Cmds not answered yet, the old
// dials' flights) and picks one move possible there: a socket event legal for the link's state, an
// answer to a current flight, a stale answer to an old one, a timer, a press, a tile's own Msg legal for
// its Model, a view notice built from a list program's real edits and the real `diff`, or a Cmd's
// answer. The tiles are the checklist's tile shape (a draft and a submit that presses `add`), a second
// generated tile machine, and a tile with none. Tuval may not import a program, so the checklist's own
// tile is stepped through its registration in the checklist's laws (L22, L24).
import { Cmd as TeaCmd, Machine } from "@demlik/tea/effect";
import { arbMsgSequence } from "@demlik/tea/pbt";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import type { Data, SchemaAST } from "effect";
import { Arbitrary, Option, Result, Schema } from "effect";
import * as fc from "fast-check";
import type { Entry } from "../ledger/Log.ts";
import { ExitReason } from "../processes/ExitReason.ts";
import { clientInbox, Down, inSignalSpace, NoProc, Recipient, signalId } from "../processes/Process.ts";
import { diff } from "../runtime/Patch.ts";
import type { Binding } from "../runtime/Program.ts";
import * as Layout from "../tezgah/Layout.ts";
import { type TezgahView, type Tile, type TileId, Workspace } from "../tezgah/Workspace.ts";
import { ClientRecord } from "../transport/ClientRows.ts";
import { linkTimer } from "../transport/Link.ts";
import { PAGE } from "../transport/Wire.ts";
import * as Keys from "./Keys.ts";
import { optimisticState, type TezgahClient } from "./Tezgah.ts";
import { type WindowModel, type WindowMsg, windowMachineFor } from "./WindowMachine.ts";

const SEED = 119120;
const opts = { seed: SEED, numRuns: 300 };
const NAMES = ["checklist:1", "tally:1", "plain:1"] as const;
const TILES = NAMES.map((name, i) => ({ id: `tile_${i + 1}`, name }));

/** A list view, the checklist's own shape cut to what a parent law reads. */
const ListView = Schema.Struct({
  items: Schema.Array(Schema.Struct({ name: Schema.String, state: Schema.Literals(["open", "checked"]) })),
  left: Schema.Int,
});
type ListView = typeof ListView.Type;
const EMPTY: ListView = { items: [], left: 0 };

const press = TeaCmd.make("press", { input: Schema.Struct({ m: Schema.Json }), ok: Schema.Null, err: [] });

/** The checklist tile's shape: a draft, and a submit that presses `add` with it. */
const draftTile = Machine.make({
  model: Schema.Struct({ draft: Schema.String }),
  msg: Schema.Union([
    Schema.Struct({ type: Schema.Literal("typed"), text: Schema.String }),
    Schema.Struct({ type: Schema.Literal("submit") }),
  ]),
  cmds: [press],
  init: () => [{ draft: "" }, []],
  update: {
    typed: (_s, m) => [{ draft: m.text }, []],
    submit: (s) => (s.draft === "" ? [s, []] : [{ draft: "" }, [press({ m: { type: "add", name: s.draft } })]]),
    press_ok: (s) => [s, []],
    press_err: (s) => [s, []],
  },
});

/** A second tile machine: it counts bumps and presses `check` on the item it counted to. */
const tallyTile = Machine.make({
  model: Schema.Struct({ n: Schema.Int }),
  msg: Schema.Union([Schema.Struct({ type: Schema.Literal("bump") }), Schema.Struct({ type: Schema.Literal("go") })]),
  cmds: [press],
  init: () => [{ n: 0 }, []],
  update: {
    bump: (s) => [{ n: s.n + 1 }, []],
    go: (s) => [{ n: 0 }, [press({ m: { type: "check", name: `item ${s.n}` } })]],
    press_ok: (s) => [s, []],
    press_err: (s) => [s, []],
  },
});

const TILE_MACHINES: Readonly<Record<string, typeof draftTile | typeof tallyTile>> = {
  "checklist:1": draftTile,
  "tally:1": tallyTile,
};

const tileFor = (name: string) => TILE_MACHINES[name];
const machine = windowMachineFor({ decode: () => Schema.decodeUnknownSync(ListView), tile: tileFor });
/** The window's tab, as `WindowStart` makes one and passes it in the ctx (P18 slice 2). */
const TAB = "tab_01m6v5270hf3c8x2q7w9z4k5mn";
const ctx = { tiles: TILES, tab: TAB };

/** Refusal reasons: the program's words, other words, and free text a reply row must not copy. */
const REASONS = ["taken", "missing", "bad_msg", "too_many", "Not A Word!", "has space", "x".repeat(41)] as const;
const isWord = (reason: string) => /^[a-z_]{1,40}$/.test(reason);
/** What the walk's presses name: items, so a pressed letter's body is the program's Msg. */
const POOL = ["milk", "bread", "eggs"] as const;
/** A typed draft is marked, so a row or an unsent write that copies it shows. */
const DRAFT = "draft~";

type Cmd = { readonly type: string; readonly [key: string]: unknown };
/** A call as a write carries it: its case from the model's own, and any field read by name. */
type Call = Pick<WindowModel["flight"][number]["call"], "_tag"> & { readonly [key: string]: unknown };
type Write = { readonly type: "write"; readonly call: Call; readonly id: number; readonly dial: number };
/** A record row: its case from `ClientRecord`, and any field read by name. */
type Row = Pick<typeof ClientRecord.Type, "_tag"> & { readonly [key: string]: unknown };

const step = (s: WindowModel, m: WindowMsg): readonly [WindowModel, ReadonlyArray<Cmd>] => applyCell(machine, s, m);
const isWrite = (c: Cmd): c is Write => c.type === "write";
/** A saved Model as it mounts: the polite region's burst is empty, and its id is kept (0504). */
const mounted = (s: WindowModel): WindowModel => ({ ...s, said: { id: s.said.id, messages: [] } });
const recordIn = (c: Cmd): Row | null => (c.type === "record" ? (c["record"] as Row) : null);

const socketDial = (s: WindowModel): number | null =>
  s.link._tag === "dialing" || s.link._tag === "waiting_grant" || s.link._tag === "online" ? s.link.dial : null;

const linkDial = (s: WindowModel): number | null => ("dial" in s.link ? s.link.dial : null);

/** A list program per pid, so a notice is a real edit's whole or patch, array ops included. */
type Brain = { rev: number; views: Array<ListView> };

const listEdit = (v: ListView, aux: number, word: string): ListView => {
  const i = v.items.length === 0 ? 0 : aux % v.items.length;
  const items =
    v.items.length === 0 || aux % 3 === 0
      ? [...v.items, { name: word, state: "open" as const }]
      : aux % 3 === 1
        ? v.items.filter((_, j) => j !== i)
        : v.items.map((it, j) => (j === i ? { ...it, state: "checked" as const } : it));
  return { items, left: items.filter((it) => it.state === "open").length };
};

const choice = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  aux: fc.nat(),
  ms: fc.integer({ min: 0, max: 20_000 }),
  word: fc.stringMatching(/^[a-z0-9]{6}$/),
});

type Choice = typeof choice extends fc.Arbitrary<infer C> ? C : never;
const walks = fc.array(choice, { minLength: 1, maxLength: 240, size: "max" });

/** What the walk knows beside the model: what is really waiting, and what it already delivered. */
type World = {
  s: WindowModel;
  waiting: Array<Cmd>; // tea Cmds handed out and not answered yet
  flights: Array<Write>; // writes the brain has, by id and dial, not answered yet
  old: Array<Write>; // writes of ended dials or already answered: their answers are stale
  brains: Map<string, Brain>; // by pid
  pids: Map<string, string>; // by tile name: the live process the brain has for it
  dials: number;
  from: Map<number, string>; // by Client slot: the tile whose press made that letter
  typed: Set<string>; // every draft text typed into a tile
  submitted: Set<string>; // the drafts a submit pressed as a letter
};

type Event = {
  readonly prev: WindowModel;
  readonly m: WindowMsg;
  readonly next: WindowModel;
  readonly cmds: ReadonlyArray<Cmd>;
  readonly world: World;
};

const brainFor = (w: World, pid: string): Brain => {
  const b = w.brains.get(pid) ?? { rev: 0, views: [EMPTY] };
  w.brains.set(pid, b);
  return b;
};

const OUTCOMES = ["accepted", "refused"] as const;

/**
 * A Msg of slice 2's, as the door's answer frames become them: `wait_ok {value: {rev}, ms}`,
 * `wait_err {error}`, `monitor_ok {value: null, ms}` and `monitor_err {error}`, each on its write's
 * `{id, dial}`. Built by the walk from what is waiting, then handed to the real update.
 */
const answerMsg = (m: { readonly type: string; readonly [key: string]: unknown }): WindowMsg => m as WindowMsg;

/** A walk's own answers to a flight, in place of the slice 1 brain's; none leaves them to it. */
type Answer = (
  f: Write,
  on: { readonly id: number; readonly dial: number },
  c: Choice,
) => ReadonlyArray<() => WindowMsg> | undefined;

/** Every move the world allows now, made only when picked. */
const moves = (w: World, c: Choice, reply?: Answer): ReadonlyArray<() => WindowMsg> => {
  const s = w.s;
  const out: Array<() => WindowMsg> = [];
  const dial = socketDial(s);
  const timer = linkTimer(s.link);
  const fingerprint = `SHA256:${c.word}`;

  if (timer !== null) {
    out.push(() => timer.msg);
  }

  if (s.link._tag === "dialing") {
    const d = s.link.dial;
    out.push(
      () => ({ type: "admitted", dial: d, ping: 30_000, ms: c.ms }),
      () => ({ type: "not_granted", dial: d, fingerprint, code: c.word.slice(0, 4), until: c.ms, ms: c.ms }),
    );

    // Favor admission enough to finish several letters before a generated drop.
    for (let n = 0; n < 8; n++) {
      out.push(() => ({ type: "admitted", dial: d, ping: 30_000, ms: c.ms }));
    }
  }

  if (s.link._tag === "waiting_grant") {
    const d = s.link.dial;
    out.push(() => ({ type: "granted", dial: d }));
  }

  if (s.link._tag === "online") {
    const d = s.link.dial;
    out.push(() => ({ type: "pong", dial: d }));
  }

  if (dial !== null) {
    out.push(() => ({ type: "closed", dial, code: c.aux % 3 === 0 ? 4003 : 1006, fingerprint, ms: c.ms }));
  }

  if (s.link._tag === "removed") {
    out.push(() => ({ type: "ask_again", dial: w.dials + 1 }));
  }

  // A press on a tile, open or not: only an open tile's press may become a letter.
  const tile = s.tiles[c.pick % s.tiles.length]!;
  out.push(() => ({
    type: "press",
    tile: tile.id,
    m: { type: ["check", "uncheck", "remove"][c.aux % 3]!, name: POOL[c.ms % POOL.length]! },
  }));
  const openedTiles = s.tiles.filter((t) => t.reach._tag === "open");

  if (openedTiles.length > 0) {
    const opened = openedTiles[c.pick % openedTiles.length]!;
    out.push(() => ({ type: "press", tile: opened.id, m: { type: "add", name: c.word } }));
  }

  const refusedTiles = openedTiles.filter((t) => t.refusal !== null);

  if (refusedTiles.length > 0) {
    const refused = refusedTiles[c.pick % refusedTiles.length]!;
    out.push(() => ({ type: "press", tile: refused.id, m: { type: "add", name: c.word } }));
  }

  // A tile's own Msg, legal for its machine's Model now.
  const own = s.tiles.filter((t) => tileFor(t.name) !== undefined);

  if (own.length > 0) {
    const t = own[c.aux % own.length]!;

    if (t.name === "checklist:1") {
      const draft = c.ms % 5 === 0 ? "" : `${DRAFT}${c.word}`;
      out.push(
        () => {
          w.typed.add(draft);
          return { type: "tile", id: t.id, msg: { type: "typed", text: draft } };
        },
        () => ({ type: "tile", id: t.id, msg: { type: "submit" } }),
      );
    } else {
      out.push(
        () => ({ type: "tile", id: t.id, msg: { type: "bump" } }),
        () => ({ type: "tile", id: t.id, msg: { type: "go" } }),
      );
    }
  }

  out.push(() => ({ type: "seen", rev: c.ms % 50 }));

  if (dial !== null) {
    out.push(() => ({ type: "resend", dial }));
  }

  // A view notice for an open tile's pid: its program steps (a patch) or is shown whole; or an old one.
  const open = s.tiles.flatMap((t) => (t.reach._tag === "open" || t.reach._tag === "opening" ? [t.reach.pid] : []));

  if (open.length > 0) {
    const pid = open[c.pick % open.length]!;
    out.push(() => {
      const b = brainFor(w, pid);
      const before = b.views[b.rev]!;
      const after = listEdit(before, c.aux, POOL[c.ms % POOL.length]!);
      b.views.push(after);
      b.rev += 1;
      return { type: "view", pid, note: { type: "patch", base: b.rev - 1, rev: b.rev, patch: diff(before, after) } };
    });
    out.push(() => {
      const b = brainFor(w, pid);
      return { type: "view", pid, note: { type: "whole", rev: b.rev, view: b.views[b.rev] } };
    });
    out.push(() => ({ type: "view", pid, note: { type: "whole", rev: 1, view: { items: "bad", left: 0 } } }));
  }

  // Answers to the writes the brain has, on their own id and dial.
  if (w.flights.length > 0) {
    const unsettled = w.flights.filter((f) => s.flight.some((live) => live.id === f.id && live.dial === f.dial));
    const letters = unsettled.filter((f) => f.call._tag === "send");
    const available = c.aux % 4 !== 0 && letters.length > 0 ? letters : w.flights;
    const f = available[c.pick % available.length]!;
    const on = { id: f.id, dial: f.dial };
    const own = reply?.(f, on, c);

    if (own !== undefined) {
      out.push(...own);
    } else if (f.call._tag === "read") {
      const name = String(f.call["stream"]).replace(/^processes\//, "");
      out.push(() => {
        const live = c.aux % 4 === 0 ? null : (w.pids.get(name) ?? `process_${name}_${c.word}`);
        const entries =
          live === null
            ? []
            : [{ _tag: "started", by: "brain", body: { process: live, name }, rev: 1, arrivedAt: "t" }];

        if (live !== null) {
          w.pids.set(name, live);
        }

        return { type: "read_ok", ...on, value: entries, ms: c.ms };
      });
      out.push(() => ({ type: "read_err", ...on, error: { _tag: "unreachable" } }));
    } else if (f.call._tag === "open") {
      const pid = String(f.call["pid"]);
      out.push(() => {
        const b = brainFor(w, pid);
        return { type: "open_ok", ...on, value: { rev: b.rev, view: b.views[b.rev]! }, ms: c.ms };
      });
      out.push(() => ({ type: "open_err", ...on, error: { _tag: "unknown" } }));
    } else if (f.call._tag === "send") {
      out.push(() => ({
        type: "send_ok",
        ...on,
        value:
          OUTCOMES[c.aux % 2] === "accepted"
            ? { _tag: "accepted", rev: c.ms, pos: c.aux }
            : { _tag: "refused", reason: REASONS[c.ms % REASONS.length]! },
        ms: c.ms,
      }));
      out.push(() => ({ type: "send_err", ...on, error: { _tag: c.aux % 2 === 0 ? "unreachable" : "unknown" } }));
    } else if (f.call._tag === "wait") {
      // P18 slice 2: the door's ledger.wait answers the rev it woke at, or an error.
      out.push(() => answerMsg({ type: "wait_ok", ...on, value: { rev: c.ms }, ms: c.ms }));
      out.push(() =>
        answerMsg({ type: "wait_err", ...on, error: { _tag: c.aux % 2 === 0 ? "unreachable" : "unknown" } }),
      );
    } else if (f.call._tag === "monitor") {
      // P18 slice 2: the door's process.monitor answers null, or refuses.
      out.push(() => answerMsg({ type: "monitor_ok", ...on, value: null, ms: c.ms }));
      out.push(() => answerMsg({ type: "monitor_err", ...on, error: { _tag: "unknown" } }));
    }
  }

  // A stale answer: to a write of an ended dial, or one already answered.
  if (w.old.length > 0) {
    const f = w.old[c.pick % w.old.length]!;
    const on = { id: f.id, dial: f.dial };
    out.push(() =>
      f.call._tag === "open"
        ? { type: "open_ok", ...on, value: { rev: 0, view: EMPTY }, ms: c.ms }
        : f.call._tag === "send"
          ? { type: "send_ok", ...on, value: { _tag: "accepted", rev: 1, pos: 1 }, ms: c.ms }
          : f.call._tag === "wait"
            ? answerMsg({ type: "wait_ok", ...on, value: { rev: c.ms }, ms: c.ms })
            : f.call._tag === "monitor"
              ? answerMsg({ type: "monitor_ok", ...on, value: null, ms: c.ms })
              : { type: "read_ok", ...on, value: [], ms: c.ms },
    );
    const current = w.flights[c.aux % Math.max(1, w.flights.length)];
    const oldDial = w.old.find((old) => old.dial !== current?.dial)?.dial;

    if (current !== undefined && oldDial !== undefined) {
      // A current id on an ended dial must not match. Ids alone are insufficient.
      out.push(() =>
        current.call._tag === "open"
          ? { type: "open_ok", id: current.id, dial: oldDial, value: { rev: 0, view: EMPTY }, ms: c.ms }
          : current.call._tag === "send"
            ? { type: "send_ok", id: current.id, dial: oldDial, value: { _tag: "accepted", rev: 1, pos: 1 }, ms: c.ms }
            : { type: "read_ok", id: current.id, dial: oldDial, value: [], ms: c.ms },
      );
    }
  }

  // tea's answers to the Cmds handed out and not answered yet.
  if (w.waiting.length > 0) {
    const due = w.waiting.filter((cmd) => ["key", "now", "persist"].includes(cmd.type));
    const available = c.aux % 4 !== 0 && due.length > 0 ? due : w.waiting;
    const cmd = available[c.pick % available.length]!;
    const ok = c.aux % 5 !== 0;
    const answer = (value: unknown, error: unknown) => (): WindowMsg =>
      (ok ? { type: `${cmd.type}_ok`, cmd, value } : { type: `${cmd.type}_err`, cmd, error }) as WindowMsg;

    if (cmd.type === "key") {
      out.push(
        answer(
          {
            found: cmd["rejected"] === null ? (c.aux % 2 === 0 ? "created" : "reused") : "replaced",
            fingerprint: `SHA256:${c.word}`,
          },
          { _tag: "ClientKeyError", op: "open", error: "QuotaExceededError" },
        ),
      );
    } else if (cmd.type === "now") {
      out.push(
        answer(
          {
            letter: `letter_${c.word}_${c.ms}`,
            sentAt: `2026-11-11T00:00:00.${String(c.ms % 1000).padStart(3, "0")}Z`,
          },
          { _tag: "clock" },
        ),
      );
    } else if (cmd.type === "write") {
      out.push(answer(null, { _tag: "unreachable" }));
    } else if (cmd.type === "persist") {
      out.push(answer(c.aux % 2 === 0, { _tag: "unsupported" }));
    } else {
      out.push(answer(null, { _tag: "failed" }));
    }
  }

  return out;
};

/** A fresh walk's world at the real init, and the init's Cmds. */
const fresh = (): readonly [World, ReadonlyArray<Cmd>] => {
  const [s0, cmds0] = machine.init(null, ctx);
  return [
    {
      s: s0,
      waiting: [],
      flights: [],
      old: [],
      brains: new Map(),
      pids: new Map(),
      dials: 1,
      from: new Map(),
      typed: new Set(),
      submitted: new Set(),
    },
    cmds0,
  ];
};

/** Folds a walk, keeping the world beside the model, and hands each step to `each`. */
const fold = (list: ReadonlyArray<Choice>, each: (e: Event) => void): World => {
  const [w, cmds0] = fresh();
  return walk(w, cmds0, list, { moves: (c) => moves(w, c) }, each);
};

/**
 * What a walk adds to slice 1's fold: its own moves, what its world does before each step, and
 * what it does after the model stepped.
 */
type Walker<C extends Choice> = {
  readonly moves: (c: C) => ReadonlyArray<() => WindowMsg>;
  readonly before?: (c: C) => void;
  readonly after?: (e: { readonly prev: WindowModel; readonly next: WindowModel; readonly c: C }) => WindowModel;
};

const walk = <W extends World, C extends Choice>(
  w: W,
  cmds0: ReadonlyArray<Cmd>,
  list: ReadonlyArray<C>,
  walker: Walker<C>,
  each: (e: Event & { readonly world: W }) => void,
): W => {
  const s0 = w.s;
  const handOut = (cmds: ReadonlyArray<Cmd>) => {
    for (const cmd of cmds) {
      if (["key", "now", "write", "persist", "record"].includes(cmd.type)) {
        w.waiting.push(cmd);
      }

      if (isWrite(cmd)) {
        w.flights.push(cmd);
      }
    }
  };
  handOut(cmds0);
  each({ prev: s0, m: { type: "seen", rev: 0 }, next: s0, cmds: cmds0, world: w });

  for (const c of list) {
    walker.before?.(c);
    const options = walker.moves(c);
    const m = options[c.move % options.length]!();
    const prev = w.s;
    const [stepped, cmds] = step(prev, m);
    const next = walker.after?.({ prev, next: stepped, c }) ?? stepped;
    // The world after the step: an answered Cmd waits no more; a socket answer ends its flight.
    w.waiting = w.waiting.filter((cmd) => !("cmd" in m) || m.cmd !== cmd);

    if (m.type === "write_err") {
      // A frame that could not be handed over never reached the brain.
      const lost = w.flights.find((f) => f.id === m.cmd.id && f.dial === m.cmd.dial);
      w.flights = w.flights.filter((f) => f !== lost);
      w.old.push(...(lost === undefined ? [] : [lost]));
    }

    if ("id" in m && typeof m.id === "number" && "dial" in m) {
      const answer = m;
      const answered = w.flights.find((f) => f.id === answer.id && f.dial === answer.dial);

      if (answered !== undefined) {
        w.flights = w.flights.filter((f) => f !== answered);
        w.old.push(answered);
      }
    }

    // A dial whose socket ended takes its flights with it: their answers can only be stale now.
    const open = socketDial(next);
    w.old.push(...w.flights.filter((f) => f.dial !== open));
    w.flights = w.flights.filter((f) => f.dial === open);
    handOut(cmds);
    w.dials = Math.max(w.dials, linkDial(next) ?? 0, next.dials);

    // A new letter is from the tile that pressed it, by a button or through its own machine's press.
    for (const p of next.client.pending.filter((p) => p.n >= prev.client.written)) {
      w.from.set(p.n, m.type === "press" ? m.tile : m.type === "tile" ? m.id : "?");

      if (m.type === "tile") {
        const sent: unknown = Reflect.get(Object(p.m), "name");
        w.submitted.add(typeof sent === "string" ? sent : "");
      }
    }

    w.s = next;
    each({ prev, m, next, cmds, world: w });
  }

  return w;
};

const writes = (cmds: ReadonlyArray<Cmd>, tag: string) => cmds.filter(isWrite).filter((c) => c.call._tag === tag);

describe("L8: the window parent's connection", () => {
  // P18 slice 2 amended this law's one clause (the plan's mapping row): after a DOWN a tile must read
  // its name again on the same dial, so a second read of a tile's stream on one dial is allowed only
  // in the step of that tile's DOWN, of its wait's answer, or of its full page. It runs on slice 1's
  // walk, which now answers the new calls, and on slice 2's walk, where all three reasons happen.
  it("L8 scenario: going online reads each tile's processes/<name> once on that dial, opens each resolved pid once per dial, and reads a tile's stream again on that dial only after that tile's DOWN, its wait answer or a full page", () => {
    const seen = { online: 0, opened: 0, missing: 0 };
    const again = { DOWN: 0, wait: 0, page: 0 };
    const law = () => {
      const reads = new Map<string, number>(); // `${dial} ${stream}`
      const opens = new Map<string, number>(); // `${dial} ${pid}`
      const asks = new Map<string, number>();
      return (e: Event) => {
        const { prev, m, next, cmds } = e;

        if (prev.link._tag !== "online" && next.link._tag === "online") {
          seen.online++;
          const d = next.link.dial;
          expect(
            writes(cmds, "read")
              .map((c) => [c.dial, c.call["stream"]])
              .sort(),
          ).toEqual(NAMES.map((n) => [d, `processes/${n}`]).sort());
          expect(next.tiles.every((t) => t.reach._tag === "resolving")).toBe(true);
        }

        const answer = msgKey(m);
        const page = tilePage(e);
        const downed = inboxPage(e) !== null;

        for (const t of next.tiles) {
          const stream = `processes/${t.name}`;
          const mine = writes(cmds, "read").filter((c) => c.call["stream"] === stream);
          expect(mine.length, `${stream} read twice in one step`).toBeLessThanOrEqual(1);

          for (const c of mine) {
            const key = `${c.dial} ${stream}`;
            reads.set(key, (reads.get(key) ?? 0) + 1);
            const was = reachIn(prev, t.id);
            // The three reasons a tile's stream is read again on the dial it was already read on.
            const reread =
              downed && holds(was)
                ? "DOWN"
                : (answer.type === "wait_ok" || answer.type === "wait_err") &&
                    was._tag === "ended" &&
                    was.id === answer.id
                  ? "wait"
                  : page?.tile.id === t.id && page.page.length === PAGE
                    ? "page"
                    : null;
            again[reread ?? "DOWN"] += reads.get(key)! > 1 && reread !== null ? 1 : 0;
            expect(
              reads.get(key) === 1 || reread !== null,
              `${key} read again with no DOWN, wait answer or full page`,
            ).toBe(true);
          }
        }

        for (const r of cmds.map(recordIn)) {
          if (r?._tag === "view" && r["result"] === "asked") {
            const key = `${linkDial(next)} ${String(r["pid"])}`;
            asks.set(key, (asks.get(key) ?? 0) + 1);
          }
        }

        for (const c of writes(cmds, "open")) {
          seen.opened++;
          const key = `${c.dial} ${String(c.call["pid"])}`;
          opens.set(key, (opens.get(key) ?? 0) + 1);
          expect(opens.get(key)!, `${key} opened past once and its asks`).toBeLessThanOrEqual(1 + (asks.get(key) ?? 0));
          expect(c.dial).toBe(socketDial(next));
        }

        if (m.type === "read_ok" && Array.isArray(m.value) && m.value.length === 0) {
          const tile = prev.tiles.find((t) => t.reach._tag === "resolving" && t.reach.id === m.id);

          if (tile !== undefined && prev.link._tag === "online" && prev.link.dial === m.dial) {
            seen.missing++;
            expect(next.tiles.find((t) => t.id === tile.id)?.reach._tag, "no live pid is missing").toBe("missing");
          }
        }
      };
    };
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, law());
      }),
      opts,
    );
    fc.assert(
      fc.property(follows, (list) => {
        follow(list, law());
      }),
      opts,
    );
    expect(seen.online).toBeGreaterThan(0);
    expect(seen.opened).toBeGreaterThan(0);
    expect(seen.missing).toBeGreaterThan(0);
    expect(
      Object.values(again).every((n) => n > 0),
      `tiles read their name again for each of its three reasons: ${JSON.stringify(again)}`,
    ).toBe(true);
  });

  it("L8 scenario: leaving a dial drops its flights and every tile's reach, and keeps every letter", () => {
    let left = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, next }) => {
          const open = socketDial(next);
          expect(
            next.flight.every((f) => f.dial === open),
            "a flight outlived its dial",
          ).toBe(true);

          if (socketDial(prev) !== null && socketDial(prev) !== open) {
            left++;
            expect(next.flight).toEqual([]);
            expect(next.sent).toEqual([]);
            expect(next.tiles.every((t) => t.reach._tag === "unresolved")).toBe(true);
            expect(next.client.pending, "a dial's end dropped a letter").toEqual(prev.client.pending);
          }
        });
      }),
      opts,
    );
    expect(left).toBeGreaterThan(0);
  });

  it("L8 scenario: Ask again dials past every old dial and asks the key store to replace only the removed key", () => {
    let asked = 0;
    fc.assert(
      fc.property(walks, (list) => {
        let highest = 1;
        fold(list, ({ prev, m, next, cmds }) => {
          const asking = prev.link._tag === "removed" && m.type === "ask_again" ? prev.link : null;
          asked += asking === null ? 0 : 1;
          expect(
            asking === null
              ? null
              : [next.link._tag, (linkDial(next) ?? 0) > highest, cmds.filter((c) => c.type === "key")],
          ).toEqual(asking === null ? null : ["dialing", true, [{ type: "key", rejected: asking.fingerprint }]]);

          highest = Math.max(highest, linkDial(next) ?? 0);
        });
      }),
      opts,
    );
    expect(asked).toBeGreaterThan(0);
  });

  it("L8 scenario: persistence is asked once, at the first online after a fresh grant", () => {
    let grants = 0;
    fc.assert(
      fc.property(walks, (list) => {
        let due = false;
        fold(list, ({ prev, m, next, cmds }) => {
          const persists = cmds.filter((c) => c.type === "persist").length;

          const granted = m.type === "granted" && prev.link._tag === "waiting_grant" && prev.link.dial === m.dial;
          grants += granted ? 1 : 0;
          due = due || granted;
          const first = prev.link._tag !== "online" && next.link._tag === "online" && due;
          expect(persists, `${m.type} asked persistence`).toBe(first ? 1 : 0);
          expect(granted || first ? next.persist : null).toBe(granted ? "due" : first ? "asked" : null);
          due = due && !first;
        });
      }),
      opts,
    );
    expect(grants).toBeGreaterThan(0);
  });

  it("L8 scenario: a write settles at hand-off: write_ok changes nothing, write_err frees its flight, and no step waits on an answer", () => {
    const seen = { ok: 0, err: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next }) => {
          seen.ok += m.type === "write_ok" ? 1 : 0;
          seen.err += m.type === "write_err" ? 1 : 0;
          expect(m.type === "write_ok" ? next : null, "a handed-over write moved the window").toEqual(
            m.type === "write_ok" ? prev : null,
          );
          const lost = m.type === "write_err" ? m.cmd : null;
          expect(lost !== null && next.flight.some((f) => f.id === lost.id && f.dial === lost.dial)).toBe(false);
        });
      }),
      opts,
    );
    expect(seen.ok).toBeGreaterThan(0);
    expect(seen.err).toBeGreaterThan(0);
  });

  it("L8 scenario: an answer that matches no flight's id and dial does nothing", () => {
    let stale = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next, cmds }) => {
          if (!["read_ok", "read_err", "open_ok", "open_err", "send_ok", "send_err"].includes(m.type)) {
            return;
          }

          const on = m as { readonly id: number; readonly dial: number };

          if (prev.flight.some((f) => f.id === on.id && f.dial === on.dial)) {
            return;
          }

          stale++;
          expect(next, `${m.type} ${on.id}@${on.dial} moved the window`).toEqual(prev);
          expect(cmds).toEqual([]);
        });
      }),
      opts,
    );
    expect(stale).toBeGreaterThan(0);
  });

  it("L8 scenario: invalid recovery-open answers keep the last checked view and ask once until a valid whole arrives", () => {
    let recovered = 0;
    fc.assert(
      fc.property(walks, fc.array(choice, { minLength: 2, maxLength: 8 }), (list, failures) => {
        let checked = false;
        fold(list, ({ next }) => {
          const tile = next.tiles.find((t) => t.reach._tag === "open");

          if (checked || next.link._tag !== "online" || tile?.reach._tag !== "open") {
            return;
          }

          checked = true;
          recovered++;
          const pid = tile.reach.pid;
          const dial = next.link.dial;
          let state = next;
          let shown = state.client.views[pid]!;

          // A checked whole ends an episode. The next bad view may ask once again.
          for (let episode = 0; episode < 2; episode++) {
            let opens = 0;

            for (const c of failures) {
              const flight = state.flight.find((f) => f.call._tag === "open" && f.call.pid === pid);
              const index = c.aux % 3;
              const view = (
                [
                  { items: null, left: 0 },
                  { ...(shown.view as ListView), left: c.word },
                  { items: [{ name: c.word, state: "invalid" }], left: 1 },
                ] satisfies readonly [Schema.Json, Schema.Json, Schema.Json]
              )[index === 0 ? 0 : index === 1 ? 1 : 2];
              const value = { rev: shown.rev + 1, view };
              const m: WindowMsg =
                flight === undefined
                  ? { type: "view", pid, note: { type: "whole", ...value } }
                  : { type: "open_ok", id: flight.id, dial: flight.dial, value, ms: c.ms };
              const [after, cmds] = step(state, m);
              opens += writes(cmds, "open").filter((c) => c.call["pid"] === pid).length;
              expect(after.client.views[pid], "an invalid recovery changed the checked view").toEqual(shown);
              expect(opens, "bad recovery answers must not start replacement opens").toBe(1);
              state = after;
            }

            const value = { rev: shown.rev + 1, view: listEdit(shown.view as ListView, episode, "recovered") };
            const [after] = step(state, { type: "view", pid, note: { type: "whole", ...value } });
            expect(after.client.views[pid]).toEqual(value);
            expect(after.link).toEqual(next.link);
            expect(after.flight.filter((f) => f.dial === dial && f.call._tag === "open" && f.call.pid === pid)).toEqual(
              [],
            );
            state = after;
            shown = state.client.views[pid]!;
          }
        });
      }),
      opts,
    );
    expect(recovered, "the walks reached checked views before the recovery failures").toBeGreaterThan(0);
  });

  it("L8 scenario: A14: a notice that installs a pid's view ends that pid's open, so its late answer is stale", () => {
    let raced = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next }) => {
          if (m.type !== "view" || next.client.views[m.pid] === prev.client.views[m.pid]) {
            return;
          }

          const opening = prev.flight.filter((f) => f.call._tag === "open" && f.call.pid === m.pid);
          raced += opening.length;
          expect(next.flight.filter((f) => f.call._tag === "open" && f.call.pid === m.pid)).toEqual([]);

          for (const f of opening) {
            const late = step(next, {
              type: "open_ok",
              id: f.id,
              dial: f.dial,
              value: { rev: 0, view: EMPTY },
              ms: 1,
            });
            expect(late[0], "a late open rolled the view back").toEqual(next);
          }
        });
      }),
      opts,
    );
    expect(raced).toBeGreaterThan(0);
  });

  it("L8 scenario: a press on a tile that is not open makes no letter; an open tile's press keeps its pid", () => {
    const seen = { open: 0, closed: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next, cmds }) => {
          if (m.type !== "press") {
            return;
          }

          const reach = prev.tiles.find((t) => t.id === m.tile)?.reach;

          const open = reach?._tag === "open" ? reach : null;
          seen[open === null ? "closed" : "open"]++;
          expect(open === null ? {} : next.client.pending.at(-1)).toMatchObject(
            open === null ? {} : { _tag: "dating", pid: open.pid, n: prev.client.written },
          );
          expect(cmds.filter((c) => c.type === "now")).toEqual(
            open === null ? [] : [{ type: "now", n: prev.client.written }],
          );
          expect(open === null ? next.client : null, "a closed tile's press made a letter").toEqual(
            open === null ? prev.client : null,
          );
        });
      }),
      opts,
    );
    expect(seen.open).toBeGreaterThan(0);
    expect(seen.closed).toBeGreaterThan(0);
  });

  it("L8 scenario: a tile's own Msg steps only that tile's machine, and its press Cmd becomes exactly one Client press for that tile's pid", () => {
    const seen = { stepped: 0, pressed: 0, closed: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next, cmds }) => {
          if (m.type !== "tile") {
            return;
          }

          const before = prev.tiles.find((t) => t.id === m.id)!;
          const tileMachine = tileFor(before.name)!;
          const [own, out] = applyCell(tileMachine, before.own as never, m.msg as never) as readonly [
            unknown,
            ReadonlyArray<Cmd>,
          ];
          seen.stepped++;
          const blockedPress = before.reach._tag !== "open" && out.some((c) => c.type === "press");
          expect(
            next.tiles.find((t) => t.id === m.id)!.own,
            "a blocked submit keeps the draft until it can send",
          ).toEqual(blockedPress ? before.own : own);
          expect(
            next.tiles.filter((t) => t.id !== m.id).map((t) => t.own),
            "another tile's Model moved",
          ).toEqual(prev.tiles.filter((t) => t.id !== m.id).map((t) => t.own));
          expect(
            cmds.filter((c) => c.type === "press"),
            "a tile machine's press left the parent as a Cmd",
          ).toEqual([]);

          const pressed = out.filter((c) => c.type === "press");
          const open = before.reach._tag === "open" ? before.reach : null;
          const letters = next.client.pending.filter((p) => p.n >= prev.client.written);

          if (pressed.length === 0 || open === null) {
            seen.closed += pressed.length > 0 ? 1 : 0;
            expect(next.client, "no press, or a tile that is not open, made a letter").toEqual(prev.client);
            return;
          }

          seen.pressed++;
          expect(letters).toEqual([
            {
              _tag: "dating",
              n: prev.client.written,
              pid: open.pid,
              m: pressed[0]!["m"],
              seen: prev.client.seen,
              viewRev: prev.client.views[open.pid]?.rev ?? 0,
            },
          ]);
          expect(cmds.filter((c) => c.type === "now")).toEqual([{ type: "now", n: prev.client.written }]);
        });
      }),
      opts,
    );
    expect(seen.stepped).toBeGreaterThan(0);
    expect(seen.pressed).toBeGreaterThan(0);
    expect(seen.closed, "some tile presses came while the tile was not open").toBeGreaterThan(0);
  });

  it("L8 scenario: a tile's refusal is set only by a refused reply to its own letter, and cleared by its next press", () => {
    const seen = { set: 0, cleared: 0, others: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next, world }) => {
          const answer = m;
          const flight =
            "id" in answer && typeof answer.id === "number" && "dial" in answer
              ? prev.flight.find((f) => f.id === answer.id && f.dial === answer.dial)
              : undefined;
          const call = flight?.call;
          const refusedLetter =
            m.type === "send_ok" && call?._tag === "send" && m.value._tag === "refused"
              ? prev.client.pending.find((p) => p._tag === "ready" && p.letter === call["letter"])
              : undefined;
          const owner = refusedLetter === undefined ? undefined : world.from.get(refusedLetter.n);
          const made = next.client.pending.filter((p) => p.n >= prev.client.written);
          const aimed = m.type === "press" ? m.tile : m.type === "tile" ? m.id : null;

          for (const t of next.tiles) {
            const was = prev.tiles.find((x) => x.id === t.id)!.refusal;
            const pressedHere = made.some((p) => world.from.get(p.n) === t.id);

            const own = refusedLetter !== undefined && owner === t.id;
            seen.set += own ? 1 : 0;
            seen.others += !own && refusedLetter !== undefined ? 1 : 0;
            seen.cleared += !own && pressedHere && was !== null ? 1 : 0;

            const [allowed, label]: readonly [ReadonlyArray<unknown>, string] = own
              ? [
                  [
                    {
                      m: refusedLetter.m,
                      reason: (m as { readonly value: { readonly reason: string } }).value.reason,
                    },
                  ],
                  `${t.id}'s own refused letter`,
                ]
              : pressedHere
                ? [[null], `${t.id}'s next press clears its refusal`]
                : aimed === t.id && made.length === 0
                  ? // A press that made no letter (the tile is not open) may clear the words or keep them.
                    [[was, null], `${t.id} after a press that sent nothing`]
                  : [[was], `${t.id} after ${m.type}`];
            expect(allowed, label).toContainEqual(t.refusal);
          }
        });
      }),
      opts,
    );
    expect(seen.set).toBeGreaterThan(0);
    expect(seen.cleared, "a refusal was cleared by its tile's next press").toBeGreaterThan(0);
    expect(seen.others, "a refusal for one tile left the other tiles alone").toBeGreaterThan(0);
  });

  it("L8 scenario: the tile's own Model never leaves the tab: no record holds a draft, and no write holds one never submitted", () => {
    let typed = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ cmds, world }) => {
          typed = Math.max(typed, world.typed.size);

          for (const c of cmds) {
            const text = JSON.stringify(c);
            const drafts = [...world.typed].filter((d) => d !== "" && text.includes(d));

            const recorded = c.type === "record" ? drafts : [];
            const unsent = isWrite(c) ? drafts.filter((d) => !world.submitted.has(d)) : [];
            expect(recorded, "a record copied typed text").toEqual([]);
            expect(unsent, "a write carried a draft nobody submitted").toEqual([]);
          }
        });
      }),
      opts,
    );
    expect(typed).toBeGreaterThan(0);
  });
});

describe("L9: the records the window emits", () => {
  it("L9 scenario: a failed record attempts one failure row and keeps the window working without retrying a failed failure row", () => {
    let failed = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next, cmds }) => {
          if (m.type !== "record_err") {
            return;
          }

          failed++;
          expect(next, "a store failure changed the window").toEqual(prev);
          expect(cmds).toEqual(
            m.cmd.record._tag === "failure"
              ? []
              : [{ type: "record", record: { _tag: "failure", op: "record", error: "other" } }],
          );
        });
      }),
      opts,
    );
    expect(failed, "the walks failed record writes").toBeGreaterThan(0);
  });

  it("L9 scenario: each record Cmd carries one checked ClientRecord and nothing else", () => {
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ cmds }) => {
          for (const c of cmds.filter((c) => c.type === "record")) {
            expect(Object.keys(c).sort()).toEqual(["record", "type"]);
            expect(Schema.is(ClientRecord)(c["record"]), JSON.stringify(c)).toBe(true);
          }
        });
      }),
      opts,
    );
  });

  it("L9 scenario: one key row per key read, one connect row per link outcome with its ms, one persist row per answer", () => {
    const seen = { key: 0, connect: 0, persist: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next, cmds }) => {
          const rows = cmds.map(recordIn).filter((r): r is Row => r !== null);
          const keys = rows.filter((r) => r._tag === "key");
          const connects = rows.filter((r) => r._tag === "connect");
          const persists = rows.filter((r) => r._tag === "persist" || (r._tag === "failure" && r["op"] === "persist"));

          seen.key += m.type === "key_ok" ? 1 : 0;
          expect(keys).toEqual(m.type === "key_ok" ? [{ _tag: "key", result: m.value.found }] : []);

          const outcome =
            prev.link._tag !== "online" && next.link._tag === "online"
              ? "online"
              : prev.link._tag !== "waiting_grant" && next.link._tag === "waiting_grant"
                ? "waiting"
                : prev.link._tag !== "removed" && next.link._tag === "removed"
                  ? "removed"
                  : prev.link._tag !== "retrying" && next.link._tag === "retrying"
                    ? m.type === "closed"
                      ? "closed"
                      : "stalled"
                    : null;

          const connected = outcome !== null && "ms" in m && "dial" in m ? { dial: m.dial, ms: m.ms } : null;
          seen.connect += connected === null ? 0 : 1;
          expect(connects, `${m.type}'s connect rows`).toEqual(
            connected === null
              ? []
              : [
                  {
                    _tag: "connect",
                    dial: connected.dial,
                    result: outcome,
                    ms: connected.ms,
                    // P18 L11: a closed dial's row also keeps the close code it saw.
                    ...(m.type === "closed" ? { code: m.code } : {}),
                  },
                ],
          );
          const answered = m.type === "persist_ok" || m.type === "persist_err";
          seen.persist += answered ? 1 : 0;
          expect(persists).toHaveLength(answered ? 1 : 0);
        });
      }),
      opts,
    );
    expect(seen.key).toBeGreaterThan(0);
    expect(seen.connect).toBeGreaterThan(0);
    expect(seen.persist).toBeGreaterThan(0);
  });

  it("L9 scenario: a press row comes before its letter's first write, and one reply row at settlement counts every send", () => {
    const seen = { press: 0, reply: 0, resent: 0, free: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        const pressed = new Set<string>();
        const sends = new Map<string, number>();
        fold(list, ({ prev, m, cmds }) => {
          // A press row comes before any send of its letter, in this step's Cmds or an earlier step's.
          const pressRows = cmds.flatMap((c) => {
            const r = recordIn(c);
            return r?._tag === "press" ? [String(r["letter"])] : [];
          });
          seen.press += pressRows.length;
          expect(
            pressRows.filter((l) => sends.has(l)),
            "a press row came after its letter's send",
          ).toEqual([]);
          const sent = cmds.flatMap((c, i) =>
            isWrite(c) && c.call._tag === "send" ? [{ letter: String(c.call["letter"]), at: i }] : [],
          );
          expect(
            sent.filter(
              (s) => !pressed.has(s.letter) && !cmds.slice(0, s.at).some((p) => recordIn(p)?.["letter"] === s.letter),
            ),
            "a letter went before its press row",
          ).toEqual([]);

          for (const l of pressRows) {
            pressed.add(l);
          }

          for (const s of sent) {
            sends.set(s.letter, (sends.get(s.letter) ?? 0) + 1);
          }

          const replies = cmds.map(recordIn).filter((r) => r?._tag === "reply");

          if (m.type === "send_ok") {
            const f = prev.flight.find((x) => x.id === m.id && x.dial === m.dial);

            if (f !== undefined && f.call._tag === "send") {
              seen.reply++;
              const letter = String(f.call.letter);
              seen.resent += (sends.get(letter) ?? 0) > 1 ? 1 : 0;
              const reason =
                m.value._tag === "refused" ? { reason: isWord(m.value.reason) ? m.value.reason : "other" } : {};
              seen.free += m.value._tag === "refused" && !isWord(m.value.reason) ? 1 : 0;
              expect(replies).toEqual([
                {
                  _tag: "reply",
                  letter,
                  result: m.value._tag,
                  attempts: sends.get(letter) ?? 0,
                  ms: m.ms,
                  ...reason,
                },
              ]);
              return;
            }
          }

          expect(replies, `${m.type} wrote a reply row`).toEqual([]);
        });
      }),
      opts,
    );
    expect(seen.press).toBeGreaterThan(0);
    expect(seen.reply).toBeGreaterThan(0);
    expect(seen.resent, "some letters went more than once").toBeGreaterThan(0);
    expect(seen.free, "some refusals had free-text reasons").toBeGreaterThan(0);
  });

  it("L9 scenario: a whole row per whole installed, an asked row per ask, and one patch row per ended run with its count", () => {
    const seen = { whole: 0, asked: 0, run: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        const run = new Map<string, number>(); // installed patches per pid since the last view row
        fold(list, ({ prev, m, next, cmds }) => {
          const rows = cmds.map(recordIn).filter((r): r is Row => r?._tag === "view");
          const ended = new Map(
            rows.filter((r) => r["result"] === "patch").map((r) => [String(r["pid"]), r["patches"]]),
          );

          for (const [pid, count] of ended) {
            seen.run++;
            expect(count, `${pid}'s run`).toBe(run.get(pid));
            run.delete(pid);
          }

          for (const r of rows.filter((r) => r["result"] !== "patch")) {
            seen[r["result"] === "whole" ? "whole" : "asked"]++;
            expect(run.get(String(r["pid"])) ?? 0, "a run did not end before its pid's next view row").toBe(0);
          }

          const changed = Object.keys(next.client.views).filter(
            (pid) => next.client.views[pid] !== prev.client.views[pid],
          );

          for (const pid of changed) {
            const whole =
              m.type === "open_ok" || (m.type === "view" && (m.note as { type?: unknown }).type === "whole");
            expect(rows.filter((r) => r["pid"] === pid && r["result"] === "whole")).toHaveLength(whole ? 1 : 0);

            if (!whole) {
              run.set(pid, (run.get(pid) ?? 0) + 1);
            }
          }

          if (prev.link._tag === "online" && next.link._tag !== "online") {
            expect(
              [...run.entries()].filter(([, n]) => n > 0),
              "leaving online ends every run",
            ).toEqual([]);
          }
        });
      }),
      opts,
    );
    expect(seen.whole).toBeGreaterThan(0);
    expect(seen.asked).toBeGreaterThan(0);
    expect(seen.run).toBeGreaterThan(0);
  });
});

// --- P18 slice 1: frames, cuts and close codes -----------------------------------------------------
//
// What these laws hold `client/WindowMachine.ts` to, from P18's approved plan (the build may add more):
// - Two new Msgs carry what the socket saw, raw: `frame {dial, text, at, ms?}` and
//   `socket_closed {dial, code, at}`. `update` decodes every frame; the start decodes nothing.
// - A frame of a dial that is not the link's socket dial does nothing. Text `pong` is the link's
//   `pong`. A JSON-RPC answer with a number id goes to the flight with that id and dial and becomes
//   the `*_ok` or `*_err` Msg its call already had, with the frame's `ms`. A string id goes to the
//   handshake. `challenge`, `client.granted` and `gateway.waiting` go to the handshake, and
//   `view.whole` and `view.patch` become the `view` Msg. Anything else does nothing.
// - The model gains `handshake` (the `Handshake` of `transport/Handshake.ts`, whose live request id
//   is its `id`) and `fingerprint` (from `key_ok`, whose ok gains `fingerprint`). The handshake's
//   `hello` Cmd carries `{dial, id, nonce}`.
// - `socket_closed` is the link's `closed`, and a `connect` row of a closed or removed dial keeps
//   the close `code`.
//
// The walk starts at the real init and reaches the door's states only through frames: a challenge
// makes a hello, the door answers the handshake's live id, and the window goes online. Each step
// picks one move possible in the state it folded, stale ones on purpose.

/** The door's frame for one JSON-RPC answer or notice, as text. */
const rpc = (body: object) => JSON.stringify({ jsonrpc: "2.0", ...body });
const ADMITTED = { version: 1, ping: 5_000, identity: { key: "SHA256:k", person: "person_x", as: "window" } };
const NOT_GRANTED = { code: -32000, message: "no", data: { reason: "not_granted" } };
/** Error reasons the door sends; the first four are the ones a client may try again after. */
const ERROR_REASONS = ["unreachable", "not_granted", "no_hello", "storage", "nope", "rate_limited"] as const;
const AGAIN = new Set<string>(["unreachable", "not_granted", "no_hello", "storage"]);
/** Texts that are no frame the window reads. `ping` is the client's own word, never the door's. */
const JUNK = ["{ not json", "[1,2]", rpc({ id: true, result: 1 }), "ping", "", "PONG", rpc({ method: "nope" })];

/** A blind draw the fold reads in the state it reached: which move, which target, and its values. */
const Draw = Schema.Struct({
  move: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  aux: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  ms: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20_000 })),
  word: Schema.Literals(["milk", "bread", "eggs", "n0nce1", "k7q2"]),
  // Close codes as a door or a network sends them: the common ones, the removal, and any private one.
  code: Schema.Union([
    Schema.Literals([1000, 1001, 1006, 1011, 4003]),
    Schema.Int.check(Schema.isBetween({ minimum: 3000, maximum: 4999 })),
  ]),
});
type Draw = typeof Draw.Type;
const Draws = Schema.Array(Draw).check(Schema.isMinLength(40), Schema.isMaxLength(200));

/** What the step's frame should do, known when the move was made. */
type Expect = Data.TaggedEnum<{
  owner: { readonly owner: WindowMsg }; // the same as the Msg its owner already had
  nothing: Record<never, never>; // changes nothing and asks for nothing
  handshake: Record<never, never>; // a string id or a handshake notice: no flight moves
  settles: { readonly id: number; readonly dial: number }; // only that flight leaves
  none: Record<never, never>;
}>; // not a frame

type Flight = WindowModel["flight"][number];

type FrameWorld = {
  s: WindowModel;
  waiting: Array<Cmd>;
  at: number;
  ids: Set<string>; // every handshake id the walk has seen
  old: Array<Flight>; // flights that left the model
  dials: Set<number>; // every socket dial the walk has seen
};

type FrameEvent = {
  readonly prev: WindowModel;
  readonly m: WindowMsg;
  readonly next: WindowModel;
  readonly cmds: ReadonlyArray<Cmd>;
  readonly expect: Expect;
};

/** The model's handshake: its state, its dial and its live request id. */
const handshakeIn = (
  s: WindowModel,
): (Pick<WindowModel["handshake"], "_tag"> | Data.TaggedEnum<{ none: Record<never, never> }>) & {
  readonly dial?: number;
  readonly id?: string;
} => Reflect.get(s, "handshake") ?? { _tag: "none" };

const frame = (w: FrameWorld, dial: number, text: string, ms?: number): WindowMsg =>
  ({ type: "frame", dial, text, at: w.at, ...(ms === undefined ? {} : { ms }) }) as WindowMsg;

/**
 * A good answer for a flight's call, and the Msg the call's own handler takes for it. A renewed
 * knock's code is the Link's only while the handshake still waits on that dial; at any other time
 * the answer is stale, and only the knock's own handler takes it.
 */
const goodAnswer = (
  f: Flight,
  c: Draw,
  hs: ReturnType<typeof handshakeIn>,
): { readonly result: unknown; readonly owner: WindowMsg | null } => {
  const on = { id: f.id, dial: f.dial };

  if (f.call._tag === "read") {
    const name = f.call.stream.replace(/^processes\//, "");
    const entries = [{ _tag: "started", by: "brain", body: { process: `process_${name}_${c.word}`, name }, rev: 1 }];
    return { result: { entries }, owner: { type: "read_ok", ...on, value: entries, ms: c.ms } };
  }

  if (f.call._tag === "open") {
    const value = { rev: c.aux % 5, view: listEdit(EMPTY, c.aux, c.word) };
    return { result: value, owner: { type: "open_ok", ...on, value, ms: c.ms } };
  }

  if (f.call._tag === "send") {
    const value =
      c.aux % 2 === 0
        ? { _tag: "accepted" as const, rev: c.ms, pos: c.aux }
        : { _tag: "refused" as const, reason: REASONS[c.ms % REASONS.length]! };
    return { result: value, owner: { type: "send_ok", ...on, value, ms: c.ms } };
  }

  // P18 slice 2: the door's answers to ledger.wait and process.monitor.
  if (f.call._tag === "wait") {
    const value = { rev: c.aux % 1000 };
    return { result: value, owner: answerMsg({ type: "wait_ok", ...on, value, ms: c.ms }) };
  }

  if (f.call._tag === "monitor") {
    return { result: null, owner: answerMsg({ type: "monitor_ok", ...on, value: null, ms: c.ms }) };
  }

  const result = { code: c.word, until: c.ms };
  return hs._tag === "waiting" && hs.dial === f.dial
    ? { result, owner: null }
    : { result, owner: { type: "knock_ok", ...on, value: null, ms: c.ms } };
};

/** Every move the world allows now, each with what its frame should do. */
const frameMoves = (w: FrameWorld, c: Draw): ReadonlyArray<() => readonly [WindowMsg, Expect]> => {
  const s = w.s;
  const out: Array<() => readonly [WindowMsg, Expect]> = [];
  const none: Expect = { _tag: "none" };
  const nothing: Expect = { _tag: "nothing" };
  const dial = socketDial(s);
  const past = [...w.dials].filter((d) => d !== dial);
  const timer = linkTimer(s.link);
  const hs = handshakeIn(s);

  // tea's answers to the Cmds handed out and not answered yet.
  if (w.waiting.length > 0) {
    const due = w.waiting.filter((cmd) => ["key", "now"].includes(cmd.type));
    const from = c.aux % 3 !== 0 && due.length > 0 ? due : w.waiting;
    const cmd = from[c.pick % from.length]!;
    const ok = (value: unknown) => (): readonly [WindowMsg, Expect] => [
      { type: `${cmd.type}_ok`, cmd, value } as WindowMsg,
      none,
    ];
    out.push(
      cmd.type === "key"
        ? ok({ found: cmd["rejected"] === null ? "created" : "replaced", fingerprint: `SHA256:${c.word}` })
        : cmd.type === "now"
          ? ok({ letter: `letter_${c.word}_${c.ms}`, sentAt: "2026-11-13T00:00:00.000Z" })
          : cmd.type === "persist"
            ? ok(c.aux % 2 === 0)
            : ok(null),
    );
  }

  // A live link's timer is offered now and then, so dials live long enough to go online. A retrying
  // link waits on nothing but its retry, so the retry is always offered, and favored, like the
  // door's next move below: no walk sits in `retrying` for good.
  if (timer !== null && s.link._tag === "retrying") {
    const retry = (): readonly [WindowMsg, Expect] => [timer.msg, none];
    out.push(retry, retry, retry);
  } else if (timer !== null && s.link._tag === "waiting_grant" && !s.flight.some((f) => f.call._tag === "knock")) {
    // A grant wait renews before its grant now and then, so a renewed knock is out when the grant
    // comes and its answer can land after it.
    const renew = (): readonly [WindowMsg, Expect] => [timer.msg, none];
    out.push(renew, renew, renew, renew);
  } else if (timer !== null && c.aux % 4 === 0) {
    out.push(() => [timer.msg, none]);
  }

  if (s.link._tag === "removed") {
    out.push(() => [{ type: "ask_again", dial: Math.max(...w.dials, 0) + 1 }, none]);
  }

  const open = s.tiles.filter((t) => t.reach._tag === "open");

  if (open.length > 0) {
    const t = open[c.pick % open.length]!;
    out.push(() => [{ type: "press", tile: t.id, m: { type: "add", name: c.word } }, none]);
  }

  if (dial !== null) {
    const d = dial;
    const nonce = `nonce_${c.word}_${c.ms}`;
    out.push(
      () => [frame(w, d, rpc({ method: "challenge", params: { nonce } })), { _tag: "handshake" }],
      () => [frame(w, d, rpc({ method: "client.granted", params: { nonce } })), { _tag: "handshake" }],
      () => [
        frame(w, d, rpc({ method: "gateway.waiting", params: { code: c.word, until: c.ms } })),
        { _tag: "handshake" },
      ],
      () => [frame(w, d, "pong"), { _tag: "owner", owner: { type: "pong", dial: d } }],
      () => [frame(w, d, JUNK[c.aux % JUNK.length]!), nothing],
    );

    // The live socket closes now and then, like its timer, so a dial lives long enough to go online.
    if (c.aux % 4 === 0) {
      out.push(() => [{ type: "socket_closed", dial: d, code: c.code, at: w.at } as WindowMsg, none]);
    }

    // Favor the door's next move for the handshake's own state, so walks go online: a challenge to
    // a dial not challenged yet, an admission of the live hello (or now and then `not_granted`, so
    // walks also wait for a grant), a code for the live knock, and a grant to a waiting dial.
    if (hs.dial === d) {
      const next =
        hs._tag === "opened"
          ? rpc({ method: "challenge", params: { nonce } })
          : hs._tag === "initializing"
            ? rpc(c.aux % 3 === 0 ? { id: hs.id, error: NOT_GRANTED } : { id: hs.id, result: ADMITTED })
            : hs._tag === "knocking"
              ? rpc({ id: hs.id, result: { code: c.word, until: c.ms } })
              : hs._tag === "waiting"
                ? rpc({ method: "client.granted", params: { nonce } })
                : null;

      if (next !== null) {
        const move = (): readonly [WindowMsg, Expect] => [frame(w, d, next), { _tag: "handshake" }];
        out.push(move, move, move);
      }
    }

    if (hs.id !== undefined && hs.dial === d) {
      const id = hs.id;
      const answers = [
        rpc({ id, result: ADMITTED }),
        rpc({ id, result: ADMITTED }),
        rpc({ id, result: ADMITTED }),
        rpc({ id, error: NOT_GRANTED }),
        rpc({ id, result: { code: c.word, until: c.ms } }),
      ];

      for (const text of answers) {
        out.push(() => [frame(w, d, text), { _tag: "handshake" }]);
      }
    }

    const stale = [...w.ids].filter((id) => id !== hs.id);

    if (stale.length > 0) {
      const id = stale[c.pick % stale.length]!;
      out.push(() => [frame(w, d, rpc({ id, result: ADMITTED })), nothing]);
    }

    // Answers to the flights the window has, on their own id and dial.
    if (s.flight.length > 0) {
      const f = s.flight[c.pick % s.flight.length]!;
      const good = goodAnswer(f, c, hs);
      const reason = ERROR_REASONS[c.aux % ERROR_REASONS.length]!;
      const error: WindowMsg = {
        type: `${f.call._tag}_err`,
        id: f.id,
        dial: f.dial,
        error: { _tag: AGAIN.has(reason) ? "unreachable" : "unknown" },
      } as WindowMsg;
      out.push(
        () => [
          frame(w, f.dial, rpc({ id: f.id, result: good.result }), c.ms),
          good.owner === null ? { _tag: "settles", id: f.id, dial: f.dial } : { _tag: "owner", owner: good.owner },
        ],
        () => [
          frame(w, f.dial, rpc({ id: f.id, result: good.result }), c.ms),
          good.owner === null ? { _tag: "settles", id: f.id, dial: f.dial } : { _tag: "owner", owner: good.owner },
        ],
        () => [
          frame(w, f.dial, rpc({ id: f.id, error: { code: -32000, message: "no", data: { reason } } }), c.ms),
          { _tag: "owner", owner: error },
        ],
        () => [frame(w, f.dial, rpc({ id: f.id, result: { rev: "bad", entries: 7, _tag: 1 } }), c.ms), nothing],
        // The flight's id as a string is the handshake's kind of id: it never settles the flight.
        () => [frame(w, f.dial, rpc({ id: String(f.id), result: good.result }), c.ms), { _tag: "handshake" }],
      );
    }

    // A renewed knock still out once the handshake has moved past waiting, as after a grant: its
    // late answer is favored, so walks reach it.
    const late = s.flight.find((f) => f.call._tag === "knock" && !(hs._tag === "waiting" && hs.dial === f.dial));

    if (late !== undefined) {
      const good = goodAnswer(late, c, hs);
      const move = (): readonly [WindowMsg, Expect] => [
        frame(w, late.dial, rpc({ id: late.id, result: good.result }), c.ms),
        good.owner === null ? { _tag: "settles", id: late.id, dial: late.dial } : { _tag: "owner", owner: good.owner },
      ];
      out.push(move, move, move, move);
    }

    out.push(() => [
      frame(w, d, rpc({ id: Math.max(0, ...s.flight.map((f) => f.id), s.serial) + 1 + c.aux, result: {} }), c.ms),
      nothing,
    ]);

    const pids = s.tiles.flatMap((t) => ("pid" in t.reach ? [t.reach.pid] : []));

    if (pids.length > 0) {
      const pid = pids[c.pick % pids.length]!;
      const params = { pid, type: "whole", rev: c.aux % 7, view: listEdit(EMPTY, c.aux, c.word) };
      out.push(
        () => [
          frame(w, d, rpc({ method: "view.whole", params })),
          { _tag: "owner", owner: { type: "view", pid, note: params } },
        ],
        () => [frame(w, d, rpc({ method: "view.whole", params: { ...params, pid: undefined } })), nothing],
      );
    }
  }

  // A frame, a close or a late answer of a dial that is not the socket's any more.
  if (past.length > 0) {
    const d = past[c.pick % past.length]!;
    const late = w.old.filter((f) => f.dial === d);
    out.push(
      () => [frame(w, d, "pong"), nothing],
      () => [frame(w, d, rpc({ method: "challenge", params: { nonce: `old_${c.word}` } })), nothing],
      () => [{ type: "socket_closed", dial: d, code: c.code, at: w.at } as WindowMsg, none],
    );

    if (late.length > 0) {
      const f = late[c.aux % late.length]!;
      out.push(() => [frame(w, f.dial, rpc({ id: f.id, result: goodAnswer(f, c, hs).result }), c.ms), nothing]);
    }

    // A live flight's own id and a good answer, on a past dial: the id alone never settles it.
    if (s.flight.length > 0) {
      const f = s.flight[c.aux % s.flight.length]!;
      out.push(() => [frame(w, d, rpc({ id: f.id, result: goodAnswer(f, c, hs).result }), c.ms), nothing]);
    }
  }

  return out;
};

/** Folds a frame walk from the real init, handing each step to `each`, and returns every step. */
const foldFrames = (list: ReadonlyArray<Draw>, each: (e: FrameEvent) => void = () => {}): Array<FrameEvent> => {
  const [s0, cmds0] = machine.init(null, ctx);
  const w: FrameWorld = { s: s0, waiting: [...cmds0], at: 0, ids: new Set(), old: [], dials: new Set([1]) };
  const events: Array<FrameEvent> = [];

  for (const c of list) {
    const options = frameMoves(w, c);
    const [m, expect] = options[c.move % options.length]!();
    const prev = w.s;
    const [next, cmds] = step(prev, m);
    w.waiting = [
      ...w.waiting.filter((cmd) => !("cmd" in m) || m.cmd !== cmd),
      ...cmds.filter((c) => c.type !== "record"),
    ];
    w.old.push(...prev.flight.filter((f) => !next.flight.some((n) => n.id === f.id && n.dial === f.dial)));
    const id = handshakeIn(next).id;

    if (id !== undefined) {
      w.ids.add(id);
    }

    const open = socketDial(next);

    if (open !== null) {
      w.dials.add(open);
    }

    w.at += c.ms % 700;
    w.s = next;
    const event = { prev, m, next, cmds, expect };
    events.push(event);
    each(event);
  }

  return events;
};

const frameRuns = { arbitrary: { seed: SEED, runs: 300, size: 200 } };

/** The id of a JSON-RPC answer, read as the door wrote it. */
const answerId = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ id: Schema.Union([Schema.String, Schema.Number]) })),
);

/** What a frame on `prev` did, beside what its owner says it must do, with a label for a failure. */
const verdict = (
  prev: WindowModel,
  m: Extract<WindowMsg, { readonly type: "frame" }>,
  after: readonly [WindowModel, ReadonlyArray<Cmd>],
  e: Expect,
): readonly [string, unknown, unknown] => {
  const unmoved = [prev, []];

  if (m.dial !== socketDial(prev)) {
    return [`a frame of old dial ${m.dial} moved the window`, after, unmoved];
  }

  if (e._tag === "owner") {
    return [`${m.text} did not reach its owner ${e.owner.type}`, after, step(prev, e.owner)];
  }

  if (e._tag === "settles") {
    return [
      "an answer settled another flight",
      after[0].flight,
      prev.flight.filter((x) => x.id !== e.id || x.dial !== e.dial),
    ];
  }

  const named = Option.getOrUndefined(answerId(m.text))?.id;

  if (e._tag === "handshake" && !(typeof named === "string" && named !== handshakeIn(prev).id)) {
    return [
      `${m.text}: a handshake frame settled a flight`,
      after[0].flight.filter((x) => prev.flight.includes(x)),
      prev.flight,
    ];
  }

  // Malformed text, an unknown id, or a string id that is not the handshake's own.
  return [`${m.text} moved the window`, after, unmoved];
};

describe("P18 L3: each frame reaches exactly one owner", () => {
  it.prop(
    "a number id settles only its own flight on its dial, a string id only the handshake, pong only the link, a view notice its pid, and an old dial's frame or a malformed text nothing",
    { list: Arbitrary.schema(Draws) },
    ({ list }) => {
      const seen = { online: 0 };
      foldFrames(list, ({ prev, m, next, cmds, expect: e }) => {
        seen.online += prev.link._tag !== "online" && next.link._tag === "online" ? 1 : 0;

        if (m.type !== "frame") {
          return;
        }

        const [label, got, wanted] = verdict(prev, m, [next, cmds], e);
        expect(got, label).toEqual(wanted);
      });
      expect(seen.online, "walks went online through frames alone").toBeGreaterThan(0);
      return true;
    },
    frameRuns,
  );

  it.prop(
    "over all walks every route is taken",
    { list: Arbitrary.array(Arbitrary.schema(Draws), { minLength: 40, maxLength: 40 }) },
    ({ list }) => {
      // A knock's answer settles only once a grant wait renews, which few walks reach: not counted.
      // `stolen` is a live flight's id on a past dial, the frame only the dial check stops. `late`
      // is a renewed knock's answer that lands after the handshake left waiting, as after a grant.
      const seen: Record<Expect["_tag"] | "old" | "online" | "stolen" | "late", number> = {
        owner: 0,
        nothing: 0,
        handshake: 0,
        settles: 0,
        none: 0,
        online: 0,
        old: 0,
        stolen: 0,
        late: 0,
      };

      for (const walk of list) {
        foldFrames(walk, ({ prev, m, next, expect: e }) => {
          if (m.type === "frame") {
            const dial = m.dial;
            const route = dial === socketDial(prev) ? e._tag : "old";
            seen[route] += 1;
            const named = Option.getOrUndefined(answerId(m.text))?.id;
            seen.stolen += route === "old" && prev.flight.some((f) => f.id === named) ? 1 : 0;
            const hs = handshakeIn(prev);
            seen.late +=
              route !== "old" &&
              hs._tag !== "waiting" &&
              prev.flight.some((f) => f.id === named && f.dial === dial && f.call._tag === "knock")
                ? 1
                : 0;
          }

          seen.online += prev.link._tag !== "online" && next.link._tag === "online" ? 1 : 0;
        });
      }

      expect(
        (["owner", "nothing", "handshake", "online", "old", "stolen", "late"] as const).every((k) => seen[k] > 0),
        JSON.stringify(seen),
      ).toBe(true);
      return true;
    },
    { arbitrary: { seed: SEED, runs: 3, size: 200 } },
  );

  it.prop(
    "P18 slice 2: over all walks, an answer to a wait and an answer to a monitor each reach their call's own handler",
    { list: Arbitrary.array(Arbitrary.schema(Draws), { minLength: 40, maxLength: 40 }) },
    ({ list }) => {
      const seen: Record<string, number> = { wait: 0, monitor: 0 };

      for (const walk of list) {
        foldFrames(walk, ({ prev, m, next, cmds, expect: e }) => {
          const named = m.type === "frame" ? Option.getOrUndefined(answerId(m.text))?.id : undefined;
          const call = prev.flight.find((f) => m.type === "frame" && f.id === named && f.dial === m.dial)?.call._tag;

          const owned =
            m.type === "frame" && e._tag === "owner" && (call === "wait" || call === "monitor")
              ? { call, owner: e.owner, text: m.text }
              : null;
          seen[owned?.call ?? "other"] = (seen[owned?.call ?? "other"] ?? 0) + 1;
          // Every other step is judged by the slice 1 law above; here only the two new calls' answers.
          expect(
            owned === null ? null : [next, cmds],
            `${owned?.text} did not reach its ${owned?.call} handler`,
          ).toEqual(owned === null ? null : step(prev, owned.owner));
        });
      }

      expect(seen.wait! > 0 && seen.monitor! > 0, JSON.stringify(seen)).toBe(true);
      return true;
    },
    { arbitrary: { seed: SEED, runs: 3, size: 200 } },
  );
});

describe("P18 L6: a cut Model continues as the uncut run", () => {
  it.prop(
    "a WindowModel saved at a reached state and loaded again takes the same Msgs to the same Models and Cmds, the handshake's live id included",
    { list: Arbitrary.schema(Draws), cut: Arbitrary.schema(Draw.fields.pick) },
    ({ list, cut }) => {
      const events = foldFrames(list);
      const live = events.flatMap((e, i) => (handshakeIn(e.next).id === undefined ? [] : [i]));
      const pool = live.length > 0 && cut % 2 === 0 ? live : events.map((_, i) => i);
      const k = pool[cut % pool.length]!;
      const saved = Schema.encodeSync(Schema.fromJsonString(machine.model))(events[k]!.next);
      const loaded = Schema.decodeUnknownSync(Schema.fromJsonString(machine.model))(saved);
      let [s] = machine.init(loaded, ctx);
      expect(s, "the saved Model did not load back as it was, with an empty region").toEqual(mounted(events[k]!.next));
      // The loaded run's region lacks the burst said before the cut, until the uncut run's burst ends.
      let before = events[k]!.next.said.messages.length;

      for (const e of events.slice(k + 1)) {
        const [next, cmds] = step(s, e.m);
        before = e.next.said.messages.length === 0 ? 0 : before;
        const want = { ...e.next, said: { id: e.next.said.id, messages: e.next.said.messages.slice(before) } };
        expect([next, cmds], `${e.m.type} after the cut`).toEqual([want, e.cmds]);
        s = next;
      }

      return true;
    },
    { arbitrary: { seed: SEED, runs: 100, size: 200 } },
  );

  it.prop(
    "some walks reach a state whose handshake has a live id, so a cut can fall there",
    { list: Arbitrary.array(Arbitrary.schema(Draws), { minLength: 20, maxLength: 20 }) },
    ({ list }) => {
      expect(list.some((walk) => foldFrames(walk).some((e) => handshakeIn(e.next).id !== undefined))).toBe(true);
      return true;
    },
    { arbitrary: { seed: SEED, runs: 3, size: 200 } },
  );
});

describe("P18 L11: the connect row of a closed dial keeps its close code", () => {
  it.prop(
    "a socket_closed on the link's dial writes one closed or removed connect row with the code it saw, removed only for 4003, and no other connect row carries a code",
    { list: Arbitrary.schema(Draws) },
    ({ list }) => {
      foldFrames(list, ({ prev, m, next, cmds }) => {
        const rows = cmds.map(recordIn).filter((r): r is Row => r?._tag === "connect");
        const closed = m.type === "socket_closed" && m.dial === socketDial(prev) ? m : null;
        const label =
          closed === null ? `connect rows after ${m.type}` : `a close ${closed.code} on dial ${closed.dial}`;
        expect(
          rows.map((r) => [r["result"], r["code"]]),
          label,
        ).toEqual(
          closed === null
            ? rows.map((r) => [r["result"], undefined])
            : [[closed.code === 4003 ? "removed" : "closed", closed.code]],
        );
        expect(closed === null || (next.link._tag === "removed") === (closed.code === 4003), "only 4003 removes").toBe(
          true,
        );
      });
      return true;
    },
    { arbitrary: { seed: SEED, runs: 100, size: 200 } },
  );
});

// --- L10: the wire's frame families ----------------------------------------------------------------

/** The door's wire vocabulary, as the door writes it (P12 as built): what the window must read. */
const Finite = Schema.Number.check(Schema.isFinite());

const Wire = {
  nonce: Schema.Struct({ nonce: Schema.String }),
  code: Schema.Struct({ code: Schema.String, until: Finite }),
  admitted: Schema.Struct({
    version: Schema.Int,
    ping: Finite.check(Schema.isGreaterThanOrEqualTo(0)),
    identity: Schema.Struct({ key: Schema.String, person: Schema.String, as: Schema.Literals(["window"]) }),
  }),
  entries: Schema.Struct({
    entries: Schema.Array(
      Schema.Struct({
        _tag: Schema.Literal("started"),
        by: Schema.Literal("brain"),
        body: Schema.Struct({ process: Schema.String, name: Schema.Literal("checklist:1") }),
        rev: Schema.Int,
      }),
    ),
  }),
  opened: Schema.Struct({ rev: Schema.Int, view: ListView }),
  sent: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("accepted"), rev: Schema.Int, pos: Schema.Int }),
    Schema.Struct({ _tag: Schema.Literal("refused"), reason: Schema.String }),
  ]),
  whole: Schema.Struct({ rev: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), view: ListView }),
  patch: Schema.Struct({ base: Schema.Int, rev: Schema.Int }),
  woke: Schema.Struct({ rev: Schema.Int }),
  // An error answer's data: one of the door's words, or any text a door could send.
  refusal: Schema.Struct({
    reason: Schema.Union([Schema.String.check(Schema.isPattern(/^[a-z_]{1,40}$/)), Schema.String]),
  }),
};

/** The window a few frames into a dial, each state reached through the door's frames alone. */
const door = {
  /** Booted, with its key: the link is dialing on dial 1. */
  boot: (): WindowModel => {
    const [s, cmds] = machine.init(null, ctx);
    const key = cmds.find((c) => c.type === "key");
    return step(s, { type: "key_ok", cmd: key, value: { found: "created", fingerprint: "SHA256:fp" } } as WindowMsg)[0];
  },
  frame: (s: WindowModel, text: string, ms?: number) =>
    step(s, { type: "frame", dial: 1, text, at: 1_000, ...(ms === undefined ? {} : { ms }) } as WindowMsg),
  /** After a challenge: `initialize` is out with the handshake's live id. */
  initializing: (): WindowModel => door.frame(door.boot(), rpc({ method: "challenge", params: { nonce: "n1" } }))[0],
  /** After `not_granted`: the handshake's knock is out. */
  knocking: (): WindowModel => {
    const s = door.initializing();
    return door.frame(s, rpc({ id: handshakeIn(s).id, error: NOT_GRANTED }))[0];
  },
  /** Showing a code: the link waits for a grant. */
  waiting: (): WindowModel => {
    const s = door.knocking();
    return door.frame(s, rpc({ id: handshakeIn(s).id, result: { code: "K7Q2", until: 9_000 } }))[0];
  },
  online: (): WindowModel => {
    const s = door.initializing();
    return door.frame(s, rpc({ id: handshakeIn(s).id, result: ADMITTED }))[0];
  },
  /** Online with its tile's view open in flight. */
  opening: (): WindowModel => {
    const s = door.online();
    const read = s.flight.find((f) => f.call._tag === "read")!;
    const entries = [{ _tag: "started", by: "brain", body: { process: PID_A, name: "checklist:1" }, rev: 1 }];
    return door.frame(s, rpc({ id: read.id, result: { entries } }), 1)[0];
  },
  /** Online with one letter in flight. */
  sending: (): WindowModel => {
    const s = door.opening();
    const open = s.flight.find((f) => f.call._tag === "open")!;
    const [shown] = door.frame(s, rpc({ id: open.id, result: { rev: 1, view: EMPTY } }), 1);
    const [pressed, cmds] = step(shown, { type: "press", tile: "tile_1", m: { type: "add", name: "milk" } });
    const now = cmds.find((c) => c.type === "now");
    return step(pressed, {
      type: "now_ok",
      cmd: now,
      value: { letter: "letter_a", sentAt: "2026-11-13T00:00:00.000Z" },
    } as WindowMsg)[0];
  },
};

const PID_A = "process_01m6v5270hf3c8x2q7w9z4k5mn";

type Family = {
  readonly schema: Schema.Top;
  readonly from: () => WindowModel;
  /** The frame for a result or params object, and the frame's `ms` for an answer to a flight. */
  readonly text: (s: WindowModel, sent: Record<string, unknown>) => readonly [string, number?];
  /** The object the frame carries for a generated value: the value itself, unless a notice adds its pid. */
  readonly sent?: (value: Record<string, unknown>) => Record<string, unknown>;
  readonly good: (prev: WindowModel, after: readonly [WindowModel, ReadonlyArray<Cmd>], value: any) => void;
  readonly drop: ReadonlyArray<string>;
  readonly wrong: Readonly<Record<string, unknown>>;
};

const flightFor = (s: WindowModel, tag: string) => {
  const found = s.flight.find((f) => f.call._tag === tag);
  expect(found, `the window has no ${tag} call in flight`).toBeDefined();
  return found!;
};

const sameAs = (prev: WindowModel, after: readonly [WindowModel, ReadonlyArray<Cmd>], owner: WindowMsg) =>
  expect(after, `not the same as ${owner.type}`).toEqual(step(prev, owner));

const helloWith = (after: readonly [WindowModel, ReadonlyArray<Cmd>], nonce: string) =>
  expect(
    after[1].filter((c) => c.type === "hello").map((c) => c["nonce"]),
    "the hello carries its nonce",
  ).toEqual([nonce]);

const FAMILIES: Readonly<Record<string, Family>> = {
  challenge: {
    schema: Wire.nonce,
    from: door.boot,
    text: (_s, params) => [rpc({ method: "challenge", params })],
    good: (_p, after, v) => helloWith(after, v.nonce),
    drop: ["nonce"],
    wrong: { nonce: 7 },
  },
  "client.granted": {
    schema: Wire.nonce,
    from: door.waiting,
    text: (_s, params) => [rpc({ method: "client.granted", params })],
    good: (_p, after, v) => helloWith(after, v.nonce),
    drop: ["nonce"],
    wrong: { nonce: 7 },
  },
  "gateway.waiting": {
    schema: Wire.code,
    from: door.knocking,
    text: (_s, params) => [rpc({ method: "gateway.waiting", params })],
    good: (_p, [next], v) => expect(next.link).toMatchObject({ _tag: "waiting_grant", code: v.code, until: v.until }),
    drop: ["code", "until"],
    wrong: { code: 7, until: "soon" },
  },
  Admitted: {
    schema: Wire.admitted,
    from: door.initializing,
    text: (s, result) => [rpc({ id: handshakeIn(s).id, result })],
    good: (_p, [next], v) => expect(next.link).toMatchObject({ _tag: "online", dial: 1, ping: v.ping }),
    drop: ["version", "ping", "identity"],
    wrong: { version: "one", ping: "5s", identity: "me" },
  },
  // The door's error answer to the live `initialize`: `not_granted` knocks, any other reason ends the
  // hello as refused, with one connect row that keeps the reason when it is a word. The Link keeps
  // its own stall and backoff path.
  refusal: {
    schema: Wire.refusal,
    from: door.initializing,
    text: (s, data) => [rpc({ id: handshakeIn(s).id, error: { code: -32000, message: "no", data } })],
    good: (p, [next, cmds], v) => {
      const word = /^[a-z_]{1,40}$/.test(v.reason) ? v.reason : "other";
      const knocks = v.reason === "not_granted";
      expect(handshakeIn(next), `the hello's outcome for ${v.reason}`).toMatchObject(
        knocks ? { _tag: "knocking", dial: 1 } : { _tag: "refused", dial: 1, reason: word },
      );
      expect(
        cmds.map(recordIn).filter((r) => r?._tag === "connect"),
        `the connect rows for ${v.reason}`,
      ).toEqual(knocks ? [] : [{ _tag: "connect", dial: 1, result: "refused", reason: word, ms: 0 }]);
      expect(next.link, "the link keeps its own path").toEqual(p.link);
    },
    drop: ["reason"],
    wrong: { reason: 7 },
  },
  WaitingCode: {
    schema: Wire.code,
    from: door.knocking,
    text: (s, result) => [rpc({ id: handshakeIn(s).id, result })],
    good: (_p, [next], v) => expect(next.link).toMatchObject({ _tag: "waiting_grant", code: v.code, until: v.until }),
    drop: ["code", "until"],
    wrong: { code: 7, until: "soon" },
  },
  Entries: {
    schema: Wire.entries,
    from: door.online,
    text: (s, result) => [rpc({ id: flightFor(s, "read").id, result }), 3],
    good: (p, after, v) =>
      sameAs(p, after, { type: "read_ok", id: flightFor(p, "read").id, dial: 1, value: v.entries, ms: 3 }),
    drop: ["entries"],
    wrong: { entries: "all" },
  },
  Opened: {
    schema: Wire.opened,
    from: door.opening,
    text: (s, result) => [rpc({ id: flightFor(s, "open").id, result }), 3],
    good: (p, after, v) => sameAs(p, after, { type: "open_ok", id: flightFor(p, "open").id, dial: 1, value: v, ms: 3 }),
    drop: ["rev", "view"],
    wrong: { rev: "one" },
  },
  Sent: {
    schema: Wire.sent,
    from: door.sending,
    text: (s, result) => [rpc({ id: flightFor(s, "send").id, result }), 3],
    good: (p, after, v) => sameAs(p, after, { type: "send_ok", id: flightFor(p, "send").id, dial: 1, value: v, ms: 3 }),
    drop: ["_tag"],
    wrong: { _tag: 7 },
  },
  "view.whole": {
    schema: Wire.whole,
    from: door.opening,
    sent: (v) => ({ pid: PID_A, type: "whole", ...v }),
    text: (_s, params) => [rpc({ method: "view.whole", params })],
    good: (p, after, v) => sameAs(p, after, { type: "view", pid: PID_A, note: { pid: PID_A, type: "whole", ...v } }),
    drop: ["pid", "type"],
    wrong: { pid: 7, type: "other" },
  },
  // P18 slice 2: ledger.wait answers the rev it woke at; the window waits on its inbox once online.
  Woke: {
    schema: Wire.woke,
    from: door.online,
    text: (s, result) => [rpc({ id: flightFor(s, "wait").id, result }), 3],
    good: (p, after, v) =>
      sameAs(p, after, answerMsg({ type: "wait_ok", id: flightFor(p, "wait").id, dial: 1, value: v, ms: 3 })),
    drop: ["rev"],
    wrong: { rev: "one" },
  },
  // P18 slice 2: process.monitor answers null; the window monitors before it opens.
  Monitored: {
    schema: Schema.Null,
    from: door.opening,
    text: (s, result) => [rpc({ id: flightFor(s, "monitor").id, result }), 3],
    good: (p, after) =>
      sameAs(p, after, answerMsg({ type: "monitor_ok", id: flightFor(p, "monitor").id, dial: 1, value: null, ms: 3 })),
    drop: [],
    wrong: { watching: true },
  },
  "view.patch": {
    schema: Wire.patch,
    from: door.opening,
    sent: (v) => ({ pid: PID_A, type: "patch", patch: [], ...v }),
    text: (_s, params) => [rpc({ method: "view.patch", params })],
    good: (p, after, v) =>
      sameAs(p, after, { type: "view", pid: PID_A, note: { pid: PID_A, type: "patch", patch: [], ...v } }),
    drop: ["pid", "type"],
    wrong: { pid: 7, type: "other" },
  },
};

/** The params of a notice, or the result of an answer, with one field dropped or of the wrong type. */
const mutations = (family: Family, sent: Record<string, unknown>) => [
  ...family.drop.map((k) => Object.fromEntries(Object.entries(sent).filter(([key]) => key !== k))),
  ...Object.entries(family.wrong).map(([k, v]) => ({ ...sent, [k]: v })),
];

/** JSON text, the only form a frame's value takes on the wire. */
const Json = Schema.fromJsonString(Schema.Unknown);

describe("P18 L10: every frame family the parent reads decodes or reaches its typed failure", () => {
  for (const [name, family] of Object.entries(FAMILIES)) {
    it.prop(
      `format: ${name}, from its schema, reaches its handler, and with one field dropped or mistyped changes nothing`,
      { generated: Arbitrary.schema(family.schema) },
      ({ generated }) => {
        // The value as the window reads it after the wire: JSON cannot carry what a schema's
        // Arbitrary may make, such as `-0`, so the owner's Msg is built from the value JSON carries.
        const value = Schema.decodeSync(Json)(Schema.encodeSync(Json)(generated));
        const prev = family.from();
        const sent = (family.sent ?? ((v) => v))(value as Record<string, unknown>);
        const [text, ms] = family.text(prev, sent);
        family.good(prev, door.frame(prev, text, ms), value);

        for (const bad of mutations(family, sent)) {
          const [badText, badMs] = family.text(prev, bad);
          expect(door.frame(prev, badText, badMs), `${name} took ${badText}`).toEqual([prev, []]);
        }

        return true;
      },
      { arbitrary: { seed: SEED, runs: 50 } },
    );
  }
});

// --- P18 slice 2, next/ (ticket 979): a tile monitors its process and follows the restart ----------
//
// The shape these laws hold `client/WindowMachine.ts` to, from the approved plan (the build may add more):
// - ctx is `{tiles, tab}`. The Model gains `tab` and `inbox`: idle{after} | waiting{after, id} |
//   reading{after, id}, the window's own `client:<tab>/inbox`, read past a cursor `after` with at
//   most one call in flight.
// - A tile's reach is unresolved | resolving{id, fold} | opening{pid, id, ref} | open{pid, ref} |
//   ended{pid, reason, id} | missing. `ref` is the watch the tile holds on `pid`; `ended` holds the
//   exit's reason and the id of its wait on `processes/<name>`.
// - Two new calls, `wait {stream, after}` (ledger.wait) and `monitor {ref, pid}` (process.monitor),
//   answered by `wait_ok {value: {rev}, ms}`, `wait_err {error}`, `monitor_ok {value: null, ms}` and
//   `monitor_err {error}` on the write's {id, dial}.
// - Two new records: `monitor {name, pid, result: watching | refused}` and `down {name, pid, reason,
//   rev}`, the reason being the DOWN reason's `_tag` and the rev the letter's.
//
// The walk is slice 1's fold with a brain beside it, which keeps what the ledger would: each name's
// `processes/<name>` stream (starts, restarts, exits, a supervisor's `down`, and entries by another
// writer), the window's inbox, the watches each session made, and which session each dial was. It
// answers a read with the stream's next page of at most 256 entries, a wait only once its stream
// has an entry past it, and a monitor by keeping the watch, or by writing its noproc DOWN when the
// pid is not live. An exit writes one DOWN per live watch. A socket's end ends its session's watches,
// except for a session whose connection object was evicted without its close. Before each step the
// brain may crash a name's process, restart it, churn hundreds of lives at once, add another
// writer's entry, or put a forged letter in the inbox: another writer's, under a plain id, for
// another tab, for an earlier dial's ref, or no DOWN at all.

const OTHER_TAB = "tab_01m6v5270hf3c8x2q7w9z4k5mp";
const INBOX = clientInbox(TAB);
/** The brain's own writer, as the window trusts it: `brain` or `brain:<project>`. */
const BRAIN_BY = "brain:p18";
const PERSON_BY = "SHA256:person";
const trusted = (by: unknown) => typeof by === "string" && (by === "brain" || by.startsWith("brain:"));
/** Real process ids, one per life the brain places, so a DOWN for one decodes as `Down`. */
const processAt = (n: number) => `process_0000000000e00800${String(n).padStart(10, "0")}`;

const EXITS: ReadonlyArray<ExitReason> = [
  ExitReason.cases.normal.make({}),
  ExitReason.cases.shutdown.make({}),
  ExitReason.cases.kill.make({}),
  ExitReason.cases.crashed.make({ phase: "step", error: "TypeError" }),
  ExitReason.cases.crashed.make({ phase: "saved_letter" }),
  ExitReason.cases.crashed.make({ phase: "interrupted" }),
];

/** One entry as `ledger.read` answers it. */
type Fact = Pick<Entry, "_tag"> & {
  readonly by: string;
  readonly id: string;
  readonly rev: number;
  readonly arrivedAt: number;
  readonly body: object;
};

type Follow = World & {
  rev: number;
  names: Map<string, Array<Fact>>;
  live: Map<string, string | null>;
  inbox: Array<Fact>;
  watches: Array<{ readonly ref: string; readonly pid: string; readonly session: string; live: boolean }>;
  sessions: Map<number, { readonly id: string; readonly evicted: boolean }>;
  monitors: Array<{ readonly ref: string; readonly pid: string; readonly session: string }>;
  next: number;
  cuts: number;
};

const followChoice = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  aux: fc.nat(),
  ms: fc.integer({ min: 0, max: 20_000 }),
  word: fc.stringMatching(/^[a-z0-9]{6}$/),
  brain: fc.nat(),
  cut: fc.nat(),
});

type FollowChoice = typeof followChoice extends fc.Arbitrary<infer C> ? C : never;
const follows = fc.array(followChoice, { minLength: 1, maxLength: 240, size: "max" });

type FollowEvent = Event & { readonly world: Follow };

/** A reach as the laws read it, whichever case it is. */
type ReachView = Pick<WindowModel["tiles"][number]["reach"], "_tag"> & {
  readonly pid?: string;
  readonly ref?: string;
  readonly id?: number;
  readonly reason?: unknown;
};

type InboxView = (Pick<WindowModel["inbox"], "_tag"> | Data.TaggedEnum<{ none: Record<never, never> }>) & {
  readonly after: number;
  readonly id?: number;
};

const reachIn = (s: WindowModel, tile: string): ReachView => s.tiles.find((t) => t.id === tile)!.reach;
const inboxIn = (s: WindowModel): InboxView => Reflect.get(s, "inbox") ?? { _tag: "none", after: -1 };
const holds = (r: ReachView) => r._tag === "opening" || r._tag === "open";

/** A Msg's type and the write it answers, read the same for the Msgs slice 2 adds. */
const msgKey = (m: WindowMsg) => ({
  type: m.type as string,
  id: Reflect.get(m, "id") as unknown,
  dial: Reflect.get(m, "dial") as unknown,
});

const answeredFlight = (s: WindowModel, m: WindowMsg) => {
  const on = msgKey(m);
  return s.flight.find((f) => f.id === on.id && f.dial === on.dial);
};

const streamIn = (call: { readonly [key: string]: unknown }) => call["stream"];

const append = (w: Follow, into: Array<Fact>, fact: Omit<Fact, "rev" | "arrivedAt">) => {
  w.rev += 1;
  into.push({ ...fact, rev: w.rev, arrivedAt: w.rev });
};

const lifeFacts = (w: Follow, name: string): Array<Fact> => {
  const found = w.names.get(name) ?? [];
  w.names.set(name, found);
  return found;
};

const clientTo = (session: string, client = TAB) => Recipient.cases.client.make({ client, session });

/** The brain's DOWN for a watch, under the watch's own signal id, in the window's inbox. */
const signal = (w: Follow, ref: string, pid: string, reason: typeof Down.Type.reason, session: string) =>
  append(w, w.inbox, {
    _tag: "send",
    by: BRAIN_BY,
    id: signalId(clientTo(session), ref, 1),
    body: { m: Down.make({ ref, process: pid, reason, to: clientTo(session) }) },
  });

const lastLife = (w: Follow, name: string): string | null => {
  const lives = lifeFacts(w, name).filter((f) => trusted(f.by) && (f._tag === "started" || f._tag === "restarted"));
  const body = lives.at(-1)?.body;
  return body === undefined ? null : String(Reflect.get(body, "process"));
};

const crash = (w: Follow, name: string, reason: ExitReason) => {
  const pid = w.live.get(name) ?? null;

  if (pid === null) {
    return;
  }

  append(w, lifeFacts(w, name), {
    _tag: "exited",
    by: BRAIN_BY,
    id: JSON.stringify(["exited", pid]),
    body: { process: pid, reason },
  });
  w.live.set(name, null);

  for (const watch of w.watches.filter((x) => x.live && x.pid === pid)) {
    signal(w, watch.ref, pid, reason, watch.session);
    watch.live = false;
  }
};

const place = (w: Follow, name: string) => {
  const pid = processAt(w.next++);
  const after = lastLife(w, name);
  append(w, lifeFacts(w, name), {
    _tag: "started",
    by: BRAIN_BY,
    id: `start:${pid}`,
    body: { process: pid, name, program: "fabrika/checklist", hash: "h" },
  });

  if (after !== null) {
    append(w, lifeFacts(w, name), {
      _tag: "restarted",
      by: BRAIN_BY,
      id: JSON.stringify(["restarted", pid]),
      body: { process: pid, after, name, reason: "crashed", build: "h" },
    });
  }

  w.live.set(name, pid);
};

/** One thing the brain or a forger does before the window's next step, or nothing. */
const brainStep = (w: Follow, c: FollowChoice) => {
  const name = NAMES[c.pick % NAMES.length]!;
  const live = w.live.get(name) ?? null;
  const k = c.brain % 16;

  if (k <= 1) {
    crash(w, name, EXITS[c.aux % EXITS.length]!);
  } else if (k <= 3 && live === null) {
    place(w, name);
  } else if (k === 4 && c.aux % 4 === 0) {
    // Many lives at once: a history past one page, ending live or ended.
    crash(w, name, EXITS[c.aux % EXITS.length]!);

    for (let n = 0; n < 1 + (c.ms % 233); n++) {
      place(w, name);
      crash(w, name, EXITS[n % EXITS.length]!);
    }

    if (c.aux % 8 === 0) {
      place(w, name);
    }
  } else if (k === 5) {
    const kind = c.aux % 3;
    const pid = live ?? lastLife(w, name) ?? processAt(0);
    append(
      w,
      lifeFacts(w, name),
      kind === 0
        ? { _tag: "exited", by: PERSON_BY, id: `forged:${w.rev}`, body: { process: pid, reason: EXITS[0]! } }
        : kind === 1
          ? {
              _tag: "started",
              by: PERSON_BY,
              id: `forged:${w.rev}`,
              body: { process: processAt(w.next++), name, program: "fabrika/checklist", hash: "h" },
            }
          : {
              _tag: "down",
              by: BRAIN_BY,
              id: JSON.stringify(["down", pid, w.rev]),
              body: { process: pid, reason: "too_many", crashes: 1, until: 0 },
            },
    );
  } else if (k <= 7) {
    forge(w, c);
  }
};

/** A letter in the window's inbox that is no DOWN for the watch a tile holds. */
const forge = (w: Follow, c: FollowChoice) => {
  const held = w.s.tiles.flatMap((t) => {
    const r: ReachView = t.reach;
    return holds(r) && typeof r.ref === "string" && r.pid !== undefined ? [{ ref: r.ref, pid: r.pid }] : [];
  });

  if (held.length === 0) {
    return;
  }

  const { ref, pid } = held[c.pick % held.length]!;
  const session = w.sessions.get(socketDial(w.s) ?? 0)?.id ?? processAt(1);
  const reason = EXITS[c.ms % EXITS.length]!;
  const m = Down.make({ ref, process: pid, reason, to: clientTo(session) });
  const kind = c.aux % 5;

  if (kind === 0) {
    append(w, w.inbox, { _tag: "send", by: PERSON_BY, id: signalId(clientTo(session), ref, 1), body: { m } });
  } else if (kind === 1) {
    append(w, w.inbox, { _tag: "send", by: BRAIN_BY, id: `letter_${c.word}`, body: { m } });
  } else if (kind === 2) {
    const to = clientTo(session, OTHER_TAB);
    append(w, w.inbox, {
      _tag: "send",
      by: BRAIN_BY,
      id: signalId(to, ref, 1),
      body: { m: Down.make({ ref, process: pid, reason, to }) },
    });
  } else if (kind === 3) {
    // An earlier dial's watch of this same pid, which an evicted session may still hold.
    const old = w.monitors.filter((x) => x.ref !== ref);
    const was = old[c.ms % Math.max(1, old.length)] ?? { ref: "w0", session: processAt(1) };
    const to = clientTo(was.session);
    append(w, w.inbox, {
      _tag: "send",
      by: BRAIN_BY,
      id: signalId(to, was.ref, 1),
      body: { m: Down.make({ ref: was.ref, process: pid, reason, to }) },
    });
  } else {
    append(w, w.inbox, {
      _tag: "send",
      by: BRAIN_BY,
      id: signalId(clientTo(session), ref, 2),
      body: { m: { hello: 1 } },
    });
  }
};

/** The brain's answers: pages of what it holds, a wait once its stream moved, a monitor it keeps. */
const followAnswer =
  (w: Follow): Answer =>
  (f, on, c) => {
    const call = f.call;
    const stream = String(streamIn(call) ?? "");
    const after = Number(call["after"] ?? 0);
    const all = stream === INBOX ? w.inbox : stream.startsWith("processes/") ? lifeFacts(w, stream.slice(10)) : [];

    if (call._tag === "read") {
      const page = all.filter((e) => e.rev > after).slice(0, PAGE);
      const ok = (): WindowMsg => ({ type: "read_ok", ...on, value: page, ms: c.ms });
      return [ok, ok, ok, (): WindowMsg => ({ type: "read_err", ...on, error: { _tag: "unreachable" } })];
    }

    if (call._tag === "wait") {
      const top = Math.max(0, ...all.map((e) => e.rev));
      const ok = () => answerMsg({ type: "wait_ok", ...on, value: { rev: top }, ms: c.ms });
      return [
        ...(top > after ? [ok, ok, ok] : []),
        ...(c.aux % 6 === 0 ? [() => answerMsg({ type: "wait_err", ...on, error: { _tag: "unreachable" } })] : []),
      ];
    }

    if (call._tag === "monitor") {
      const ok = () => {
        const ref = String(call["ref"]);
        const pid = String(call["pid"]);
        const session = w.sessions.get(f.dial)?.id ?? processAt(1);
        w.monitors.push({ ref, pid, session });

        if ([...w.live.values()].includes(pid)) {
          w.watches.push({ ref, pid, session, live: true });
        } else {
          signal(w, ref, pid, NoProc.make({}), session);
        }

        return answerMsg({ type: "monitor_ok", ...on, value: null, ms: c.ms });
      };
      return [ok, ok, ok, () => answerMsg({ type: "monitor_err", ...on, error: { _tag: "unknown" } })];
    }

    return undefined;
  };

/** Slice 1's moves with the brain's answers, plus a nudge for a wait that can wake and a monitor out. */
const followMoves = (w: Follow, c: FollowChoice): ReadonlyArray<() => WindowMsg> => {
  const reply = followAnswer(w);
  const due = w.flights.filter((f) => f.call._tag === "monitor" || f.call._tag === "wait");
  const f = due[c.aux % Math.max(1, due.length)];
  const nudge = f === undefined ? [] : (reply(f, { id: f.id, dial: f.dial }, c) ?? []);
  return [...moves(w, c, reply), ...nudge, ...nudge];
};

/** Folds a slice 2 walk: slice 1's fold, with the brain beside it, and a saved cut now and then. */
const follow = (list: ReadonlyArray<FollowChoice>, each: (e: FollowEvent) => void, cuts = false): Follow => {
  const [base, cmds0] = fresh();
  const w: Follow = Object.assign(base, {
    rev: 0,
    names: new Map<string, Array<Fact>>(),
    live: new Map<string, string | null>(),
    inbox: [],
    watches: [],
    sessions: new Map<number, { readonly id: string; readonly evicted: boolean }>(),
    monitors: [],
    next: 0,
    cuts: 0,
  });
  // Two names start live; the third has never started.
  place(w, NAMES[0]);
  place(w, NAMES[1]);
  const save = Schema.fromJsonString(machine.model);
  return walk(
    w,
    cmds0,
    list,
    {
      before: (c) => brainStep(w, c),
      moves: (c) => followMoves(w, c),
      after: ({ prev, next, c }) => {
        if (prev.link._tag !== "online" && next.link._tag === "online") {
          w.sessions.set(next.link.dial, { id: processAt(w.next++), evicted: c.aux % 5 === 0 });
        }

        const was = socketDial(prev);

        if (was !== null && was !== socketDial(next)) {
          const session = w.sessions.get(was);

          for (const watch of w.watches.filter(
            (x) => session !== undefined && !session.evicted && x.session === session.id,
          )) {
            watch.live = false;
          }
        }

        if (!cuts || c.cut % 37 !== 0) {
          return next;
        }

        w.cuts++;
        const [loaded] = machine.init(Schema.decodeUnknownSync(save)(Schema.encodeSync(save)(next)), ctx);
        expect(loaded, "a saved Model did not load back as it was, with an empty region").toEqual(mounted(next));
        return loaded;
      },
    },
    each,
  );
};

/** The test's own reading of a name's pages: the newest trusted start unless a later exit ended it, the
 *  newest trusted exit, and the last rev read. */
const readName = (entries: ReadonlyArray<unknown>, name: string) => {
  let live: string | null = null;
  let ended: { readonly pid: string; readonly reason: ExitReason } | null = null;
  let after = 0;

  for (const raw of entries) {
    const entry = Object(raw);
    const rev: unknown = Reflect.get(entry, "rev");
    after = typeof rev === "number" ? Math.max(after, rev) : after;
    const body = Object(Reflect.get(entry, "body"));
    const process: unknown = Reflect.get(body, "process");

    if (!trusted(Reflect.get(entry, "by")) || typeof process !== "string") {
      continue;
    }

    const tag: unknown = Reflect.get(entry, "_tag");

    if (tag === "started" || tag === "restarted") {
      const named: unknown = Reflect.get(body, "name");
      live = named === undefined || named === name ? process : live;
    } else if (tag === "exited") {
      const reason: unknown = Reflect.get(body, "reason");
      ended = Schema.is(ExitReason)(reason) ? { pid: process, reason } : ended;
      live = process === live ? null : live;
    }
  }

  return { after, live, ended };
};

/** A letter the window must take as a DOWN, read on `s`, the Model before its page was taken. */
const takenOn = (s: WindowModel, letter: unknown) => {
  const entry = Object(letter);
  const id: unknown = Reflect.get(entry, "id");
  const m: unknown = Reflect.get(Object(Reflect.get(entry, "body")), "m");

  if (!trusted(Reflect.get(entry, "by")) || typeof id !== "string" || !inSignalSpace(id) || !Schema.is(Down)(m)) {
    return null;
  }

  const tile = s.tiles.find((t) => {
    const r: ReachView = t.reach;
    return holds(r) && m.to._tag === "client" && m.to.client === TAB && r.ref === m.ref && r.pid === m.process;
  });
  return tile === undefined ? null : { tile, down: m, rev: Number(Reflect.get(entry, "rev")) };
};

/** Why the window leaves a letter alone, for the laws' counts. */
const ignoredAs = (s: WindowModel, letter: unknown): string => {
  const entry = Object(letter);
  const id: unknown = Reflect.get(entry, "id");
  const m: unknown = Reflect.get(Object(Reflect.get(entry, "body")), "m");
  return !trusted(Reflect.get(entry, "by"))
    ? "writer"
    : typeof id !== "string" || !inSignalSpace(id)
      ? "plain"
      : !Schema.is(Down)(m)
        ? "shape"
        : m.to._tag !== "client" || m.to.client !== TAB
          ? "tab"
          : s.tiles.some((t) => {
                const r: ReachView = t.reach;
                return holds(r) && r.pid === m.process;
              })
            ? "stale"
            : "gone";
};

/** The step reads the window's inbox page: its read was the inbox's own call in flight. */
const inboxPage = (e: Event): ReadonlyArray<unknown> | null => {
  const was = inboxIn(e.prev);
  return e.m.type === "read_ok" &&
    was._tag === "reading" &&
    was.id === e.m.id &&
    answeredFlight(e.prev, e.m) !== undefined
    ? e.m.value
    : null;
};

/** The step answers a tile's read of its name: the tile, and its page. */
const tilePage = (e: Event) => {
  const m = e.m;
  const tile =
    m.type === "read_ok" && answeredFlight(e.prev, m)?.call._tag === "read"
      ? e.prev.tiles.find((t) => t.reach._tag === "resolving" && t.reach.id === m.id)
      : undefined;
  return tile === undefined || m.type !== "read_ok" ? null : { tile, page: m.value };
};

/** Per tile, every page of its name read since its last read from 0. */
const pageBook = () => {
  const book = new Map<string, ReadonlyArray<unknown>>();
  return {
    /** The pages so far, this step's page included. */
    read: (tile: string, page: ReadonlyArray<unknown>) => [...(book.get(tile) ?? []), ...page],
    /** Keeps this step's pages and starts over for each tile this step reads from 0. */
    after: (e: Event, kept: { readonly tile: string; readonly pages: ReadonlyArray<unknown> } | null) => {
      if (kept !== null) {
        book.set(kept.tile, kept.pages);
      }

      for (const c of writes(e.cmds, "read")) {
        const tile = e.next.tiles.find((t) => `processes/${t.name}` === streamIn(c.call));

        if (tile !== undefined && c.call["after"] === 0) {
          book.set(tile.id, []);
        }
      }
    },
  };
};

/** What a tile must do with a full page of its name: read the next page after that page's last rev,
 *  and nothing else for that tile, before it decides. */
const readsOn = (e: Event, tile: WindowModel["tiles"][number], page: ReadonlyArray<unknown>) => {
  const last = Reflect.get(Object(page.at(-1)), "rev");
  const stream = `processes/${tile.name}`;
  const mine = e.cmds
    .filter(isWrite)
    .filter((c) => streamIn(c.call) === stream || c.call._tag === "monitor" || c.call._tag === "open");
  expect(
    mine.map((c) => [c.call._tag, streamIn(c.call), c.call["after"]]),
    `${tile.name}'s full page`,
  ).toEqual([["read", stream, last]]);
  expect(reachIn(e.next, tile.id)).toMatchObject({ _tag: "resolving", id: mine[0]!.id });
};

/**
 * What a tile must do with the last page of its name, checked against every page it read: monitor
 * and open the live pid, wait on its name after the last rev when it only ended, or be missing.
 */
const decides = (e: Event, tile: WindowModel["tiles"][number], pages: ReadonlyArray<unknown>) => {
  const want = readName(pages, tile.name);
  const now = reachIn(e.next, tile.id);
  const stream = `processes/${tile.name}`;
  const mine = e.cmds
    .filter(isWrite)
    .filter((c) => streamIn(c.call) === stream || (want.live !== null && c.call["pid"] === want.live));

  if (want.live !== null) {
    expect(
      mine.map((c) => [c.call._tag, c.call["pid"], c.dial]),
      `${tile.name} resolved ${want.live}: monitor, then open, on this dial`,
    ).toEqual([
      ["monitor", want.live, socketDial(e.next)],
      ["open", want.live, socketDial(e.next)],
    ]);
    expect(now, `${tile.name}'s reach after its monitor and open`).toMatchObject({
      _tag: "opening",
      pid: want.live,
      ref: mine[0]!.call["ref"],
      id: mine[1]!.id,
    });
    return "live" as const;
  }

  if (want.ended !== null) {
    expect(
      mine.map((c) => [c.call._tag, streamIn(c.call), c.call["after"]]),
      `${tile.name} ended: one wait on its name after the last rev read`,
    ).toEqual([["wait", stream, want.after]]);
    expect(now, `${tile.name}'s reach when it ended`).toMatchObject({
      _tag: "ended",
      pid: want.ended.pid,
      id: mine[0]!.id,
    });
    expect(now.reason, `${tile.name}'s ended reason is its exit's`).toEqual(want.ended.reason);
    return "ended" as const;
  }

  expect(mine, `${tile.name} has no life and wrote a call`).toEqual([]);
  expect(now._tag, `${tile.name} has no life`).toBe("missing");
  return "missing" as const;
};

describe("P18 slice 2: a tile monitors its process and follows the restart", () => {
  it("S1 property: each pid a tile resolves is monitored, then opened, in the same step on that dial; every monitor's ref is new in the Model's life, across dials and saved cuts; opening and open hold that ref", () => {
    const seen = { resolved: 0, redial: 0, cut: 0, held: 0 };
    fc.assert(
      fc.property(follows, (list) => {
        const refs = new Set<string>();
        let onlines = 0;
        const w = follow(
          list,
          ({ prev, next, cmds }) => {
            onlines += prev.link._tag !== "online" && next.link._tag === "online" ? 1 : 0;

            for (const c of writes(cmds, "monitor")) {
              const ref = String(c.call["ref"]);
              expect(refs.has(ref), `ref ${ref} was written before`).toBe(false);
              refs.add(ref);
            }

            for (const t of next.tiles) {
              const was = reachIn(prev, t.id);
              const now: ReachView = t.reach;
              seen.held += holds(now) ? 1 : 0;
              expect(
                !holds(now) || (typeof now.ref === "string" && refs.has(now.ref)),
                `${t.id} ${now._tag} holds no ref a monitor wrote`,
              ).toBe(true);
              expect(holds(was) && holds(now) && was.pid === now.pid ? now.ref : null, `${t.id}'s ref changed`).toBe(
                holds(was) && holds(now) && was.pid === now.pid ? was.ref : null,
              );

              if (was._tag === "resolving" && now._tag === "opening") {
                seen.resolved++;
                seen.redial += onlines > 1 ? 1 : 0;
                const order = cmds
                  .filter(isWrite)
                  .filter((c) => (c.call._tag === "monitor" || c.call._tag === "open") && c.call["pid"] === now.pid);
                expect(
                  order.map((c) => [c.call._tag, c.dial]),
                  `${t.id} resolved ${now.pid}`,
                ).toEqual([
                  ["monitor", socketDial(next)],
                  ["open", socketDial(next)],
                ]);
                expect(now.ref, `${t.id} opens under the ref it monitored with`).toBe(order[0]!.call["ref"]);
              }
            }
          },
          true,
        );
        seen.cut += w.cuts;
      }),
      opts,
    );
    expect(seen.held, "tiles held a watch").toBeGreaterThan(0);
    expect(seen.resolved, "tiles resolved a pid").toBeGreaterThan(0);
    expect(seen.redial, "tiles resolved again on a later dial").toBeGreaterThan(0);
    expect(seen.cut, "walks were saved and loaded midway").toBeGreaterThan(0);
  });

  it("S2 property: a letter is a DOWN only when the brain wrote it under a signal id, it decodes as Down for the window's tab, and it names a tile's current ref and pid; it moves that one tile to resolving with one read of processes/<name> after 0, and any other letter changes no tile", () => {
    const seen: Record<string, number> = { taken: 0, noproc: 0, writer: 0, plain: 0, shape: 0, tab: 0, stale: 0 };
    fc.assert(
      fc.property(follows, (list) => {
        follow(list, (e) => {
          const page = inboxPage(e);

          if (page === null) {
            return;
          }

          const takes = page.flatMap((letter) => {
            const taken = takenOn(e.prev, letter);
            const as = taken === null ? ignoredAs(e.prev, letter) : "taken";
            seen[as] = (seen[as] ?? 0) + 1;
            seen.noproc! += taken?.down.reason._tag === "noproc" ? 1 : 0;
            return taken === null ? [] : [taken];
          });
          const moved = new Set(takes.map((t) => t.tile.id));

          for (const t of e.next.tiles) {
            const reads = writes(e.cmds, "read").filter((c) => streamIn(c.call) === `processes/${t.name}`);
            expect(moved.has(t.id) ? null : t.reach, `a letter that is no DOWN for ${t.id} moved it`).toEqual(
              moved.has(t.id) ? null : reachIn(e.prev, t.id),
            );
            expect(
              reads.map((c) => c.call["after"]),
              `${t.id}'s reads of its name on its inbox page`,
            ).toEqual(moved.has(t.id) ? [0] : []);
            const now = reachIn(e.next, t.id);
            expect(moved.has(t.id) ? [now._tag, now.id] : null, `${t.id} after its DOWN`).toEqual(
              moved.has(t.id) ? ["resolving", reads[0]?.id] : null,
            );
          }
        });
      }),
      opts,
    );

    for (const [as, n] of Object.entries(seen)) {
      expect(n, `letters seen as ${as}`).toBeGreaterThan(0);
    }
  });

  it("S3 property: after a DOWN the tile decides from every page of its name: a live successor is monitored and opened with a fresh ref and the dead pid is never opened again; no live life but an exit gives ended with that exit's reason and one wait on processes/<name> after the last rev read, whose answer reads the name again; no life gives missing", () => {
    const seen = { followed: 0, ended: 0, noproc: 0, woke: 0, missing: 0 };
    fc.assert(
      fc.property(follows, (list) => {
        const dead = new Set<string>();
        const downed = new Map<string, string>(); // tile id → the reason tag of the DOWN it took
        const book = pageBook();
        follow(list, (e) => {
          for (const taken of (inboxPage(e) ?? []).flatMap((l) => takenOn(e.prev, l) ?? [])) {
            dead.add(taken.down.process);
            downed.set(taken.tile.id, taken.down.reason._tag);
          }

          for (const c of [...writes(e.cmds, "open"), ...writes(e.cmds, "monitor")]) {
            expect(
              dead.has(String(c.call["pid"])),
              `${String(c.call["pid"])} is down and was ${c.call._tag}ed again`,
            ).toBe(false);
          }

          const read = tilePage(e);
          const pages = read === null ? null : book.read(read.tile.id, read.page);

          if (read !== null && pages !== null && read.page.length < PAGE) {
            const outcome = decides(e, read.tile, pages);
            const after = downed.get(read.tile.id);
            seen.missing += outcome === "missing" ? 1 : 0;
            seen.followed += after !== undefined && outcome === "live" ? 1 : 0;
            seen.ended += after !== undefined && outcome === "ended" ? 1 : 0;
            seen.noproc += after === "noproc" && outcome === "ended" ? 1 : 0;
            downed.delete(read.tile.id);
          }

          const answer = msgKey(e.m);
          const waiting = e.prev.tiles.find((t) => {
            const r = reachIn(e.prev, t.id);
            return r._tag === "ended" && r.id === answer.id;
          });

          if (
            (answer.type === "wait_ok" || answer.type === "wait_err") &&
            waiting !== undefined &&
            answeredFlight(e.prev, e.m) !== undefined
          ) {
            seen.woke++;
            const reads = writes(e.cmds, "read").filter((c) => streamIn(c.call) === `processes/${waiting.name}`);
            expect(
              reads.map((c) => c.call["after"]),
              `${waiting.name}'s wait answer reads it again`,
            ).toEqual([0]);
            expect(reachIn(e.next, waiting.id)).toMatchObject({ _tag: "resolving", id: reads[0]!.id });
          }

          book.after(e, read === null || pages === null ? null : { tile: read.tile.id, pages });
        });
      }),
      opts,
    );
    expect(seen.missing, "tiles with no life were missing").toBeGreaterThan(0);
    expect(seen.followed, "tiles followed a successor after a DOWN").toBeGreaterThan(0);
    expect(seen.ended, "tiles ended after a DOWN").toBeGreaterThan(0);
    expect(seen.noproc, "tiles ended after a noproc DOWN, with the exit's own reason").toBeGreaterThan(0);
    expect(seen.woke, "ended tiles' waits were answered").toBeGreaterThan(0);
  });

  it("S4 property: going online writes one wait on client:<tab>/inbox after the cursor; a wait answer writes one read; a read answer moves the cursor to its highest rev and waits again; the cursor never goes back; leaving a dial or an error makes the inbox idle with its cursor kept, and while online the resend timer arms it again; at most one inbox call is in flight", () => {
    const seen = { online: 0, woke: 0, pages: 0, moved: 0, errors: 0, offline: 0, armed: 0 };
    const armed = (s: WindowModel): boolean =>
      (machine.subs ?? []).some((sub) => {
        const deps: unknown = sub.deps(s as never);
        const msg = Object(Reflect.get(Object(deps), "msg"));
        return (
          sub.type === "timer" && Reflect.get(msg, "type") === "resend" && Reflect.get(msg, "dial") === socketDial(s)
        );
      });
    fc.assert(
      fc.property(follows, (list) => {
        follow(list, (e) => {
          const { prev, m, next, cmds } = e;
          const was = inboxIn(prev);
          const now = inboxIn(next);
          const answer = msgKey(m);
          const current = answeredFlight(prev, m) !== undefined;
          const calls = cmds
            .filter(isWrite)
            .filter((c) => streamIn(c.call) === INBOX)
            .map((c) => [c.call._tag, c.call["after"], c.id]);
          expect(now.after, `${m.type} moved the inbox cursor back`).toBeGreaterThanOrEqual(was.after);
          expect(
            next.flight.filter((f) => streamIn(f.call) === INBOX).length,
            "two inbox calls in flight",
          ).toBeLessThanOrEqual(1);
          const page = inboxPage(e);
          // An error answer to the inbox's own call, or its write that never reached the door.
          const lost =
            (current && (answer.type === "wait_err" || answer.type === "read_err") && answer.id === was.id) ||
            (m.type === "write_err" &&
              m.cmd.id === was.id &&
              prev.flight.some((f) => f.id === m.cmd.id && f.dial === m.cmd.dial && streamIn(f.call) === INBOX));
          const top = Math.max(was.after, ...(page ?? []).map((l) => Number(Reflect.get(Object(l), "rev"))));
          const [want, label]: readonly [unknown, string] =
            prev.link._tag !== "online" && next.link._tag === "online"
              ? [
                  {
                    calls: [["wait", was.after, calls[0]?.[2]]],
                    now: { _tag: "waiting", after: was.after, id: calls[0]?.[2] },
                  },
                  "online",
                ]
              : answer.type === "wait_ok" && current && was._tag === "waiting" && was.id === answer.id
                ? [
                    {
                      calls: [["read", was.after, calls[0]?.[2]]],
                      now: { _tag: "reading", after: was.after, id: calls[0]?.[2] },
                    },
                    "woke",
                  ]
                : page !== null
                  ? [
                      {
                        calls: [["wait", top, calls[0]?.[2]]],
                        now: { _tag: "waiting", after: top, id: calls[0]?.[2] },
                      },
                      "pages",
                    ]
                  : lost
                    ? [{ calls: [], now: { _tag: "idle", after: was.after } }, "errors"]
                    : prev.link._tag === "online" && next.link._tag !== "online"
                      ? [{ calls: [], now: { _tag: "idle", after: was.after } }, "offline"]
                      : m.type === "resend" &&
                          m.dial === socketDial(prev) &&
                          prev.link._tag === "online" &&
                          was._tag === "idle"
                        ? [
                            {
                              calls: [["wait", was.after, calls[0]?.[2]]],
                              now: { _tag: "waiting", after: was.after, id: calls[0]?.[2] },
                            },
                            "armed",
                          ]
                        : [{ calls: [], now: was }, "other"];

          if (label !== "other") {
            seen[label as keyof typeof seen]++;
          }

          seen.moved += label === "pages" && top > was.after ? 1 : 0;
          expect({ calls, now }, `the inbox after ${m.type} (${label})`).toEqual(want);
          expect(
            next.link._tag === "online" && now._tag === "idle" && !armed(next),
            "an idle inbox is not armed while online",
          ).toBe(false);
        });
      }),
      opts,
    );

    for (const [k, n] of Object.entries(seen)) {
      expect(n, `inbox steps seen as ${k}`).toBeGreaterThan(0);
    }
  });

  it("S5 property: a tile read answer of exactly 256 entries reads the next page after its last rev before the tile decides, and the decision equals the fold over every page", () => {
    const seen = { paged: 0, decided: 0 };
    fc.assert(
      fc.property(follows, (list) => {
        const book = pageBook();
        follow(list, (e) => {
          const read = tilePage(e);

          if (read === null) {
            book.after(e, null);
            return;
          }

          const pages = book.read(read.tile.id, read.page);

          if (read.page.length === PAGE) {
            seen.paged++;
            readsOn(e, read.tile, read.page);
          } else {
            decides(e, read.tile, pages);
            seen.decided += pages.length > PAGE ? 1 : 0;
          }

          book.after(e, { tile: read.tile.id, pages });
        });
      }),
      opts,
    );
    expect(seen.paged, "names were read past one page").toBeGreaterThan(0);
    expect(seen.decided, "tiles decided after more than one page").toBeGreaterThan(0);
  });

  it("S6 property: one down row per DOWN taken and one monitor row per monitor answer, each with the tile's name and pid, the down row with its reason's tag and its letter's rev; an ignored letter writes no row, and a row holds nothing else", () => {
    const seen = { down: 0, watching: 0, refused: 0, ignored: 0 };
    fc.assert(
      fc.property(follows, (list) => {
        const named = new Map<string, string>(); // monitor ref → the tile name it was written for
        follow(list, (e) => {
          const rows = e.cmds.map(recordIn).filter((r): r is Row => r !== null);
          const page = inboxPage(e) ?? [];
          const takes = page.flatMap((l) => takenOn(e.prev, l) ?? []);
          seen.down += takes.length;
          seen.ignored += page.length - takes.length;
          expect(
            rows.filter((r) => r._tag === "down"),
            `${e.m.type}'s down rows`,
          ).toEqual(
            takes.map((t) => ({
              _tag: "down",
              name: t.tile.name,
              pid: t.down.process,
              reason: t.down.reason._tag,
              rev: t.rev,
            })),
          );
          const answer = msgKey(e.m);
          const flight = answeredFlight(e.prev, e.m);
          const monitored =
            (answer.type === "monitor_ok" || answer.type === "monitor_err") && flight?.call._tag === "monitor"
              ? flight
              : null;
          const result = answer.type === "monitor_ok" ? "watching" : "refused";
          seen.watching += monitored !== null && result === "watching" ? 1 : 0;
          seen.refused += monitored !== null && result === "refused" ? 1 : 0;
          expect(
            rows.filter((r) => r._tag === "monitor"),
            `${e.m.type}'s monitor rows`,
          ).toEqual(
            monitored === null
              ? []
              : [
                  {
                    _tag: "monitor",
                    name: named.get(String(Reflect.get(monitored.call, "ref"))),
                    pid: Reflect.get(monitored.call, "pid"),
                    result,
                  },
                ],
          );

          for (const c of writes(e.cmds, "monitor")) {
            named.set(
              String(c.call["ref"]),
              e.next.tiles.find((t) => reachIn(e.next, t.id).ref === c.call["ref"])?.name ?? "?",
            );
          }
        });
      }),
      opts,
    );
    expect(seen.down, "DOWNs were taken").toBeGreaterThan(0);
    expect(seen.watching, "monitors were answered").toBeGreaterThan(0);
    expect(seen.refused, "monitors were refused").toBeGreaterThan(0);
    expect(seen.ignored, "letters were left alone").toBeGreaterThan(0);
  });

  it("S7 property: a saved Model loaded into another tab carries that tab, an inbox cursor of 0 and an empty polite region with its id kept, its next inbox wait names that tab's inbox, and a DOWN there for a tile's watch sends the tile back to read its name; loaded into its own tab only its region empties", () => {
    const seen = { moved: 0, waited: 0, downed: 0, burst: 0 };
    const save = Schema.fromJsonString(machine.model);
    const there = clientInbox(OTHER_TAB);
    fc.assert(
      fc.property(follows, fc.nat(), (list, cut) => {
        const reached: Array<WindowModel> = [];
        follow(list, (e) => reached.push(e.next));
        // Online cuts first, so the inbox's next wait comes from the resend timer on the cut's dial.
        const online = reached.filter((s) => s.link._tag === "online");
        const pool = online.length > 0 && cut % 4 !== 0 ? online : reached;
        const saved = pool[cut % pool.length]!;
        const load = () => Schema.decodeUnknownSync(save)(Schema.encodeSync(save)(saved));

        const [home] = machine.init(load(), ctx);
        seen.burst += saved.said.messages.length > 0 ? 1 : 0;
        expect(home, "a Model loaded into its own tab changed more than its region").toEqual(mounted(saved));

        const [away] = machine.init(load(), { tiles: TILES, tab: OTHER_TAB });
        seen.moved++;
        expect(away.tab, "the loaded Model's tab").toBe(OTHER_TAB);
        expect(inboxIn(away), "the loaded Model's inbox").toEqual({ _tag: "idle", after: 0 });
        expect(away.said, "the moved Model's region").toEqual({ id: saved.said.id, messages: [] });
        expect(
          { ...away, tab: saved.tab, inbox: saved.inbox, said: saved.said },
          "a move changed more than the tab, the inbox and the region",
        ).toEqual(saved);

        const dial = socketDial(away);

        if (away.link._tag !== "online" || dial === null) {
          return;
        }

        const [waiting, armed] = step(away, { type: "resend", dial });
        const waits = writes(armed, "wait").filter((c) => streamIn(c.call) === there);
        expect(
          writes(armed, "wait").map((c) => [streamIn(c.call), c.call["after"]]),
          "the moved Model's next inbox wait",
        ).toEqual([[there, 0]]);
        seen.waited++;

        const watch = waiting.tiles.find((t) => holds(t.reach));
        const r: ReachView | undefined = watch?.reach;

        if (watch === undefined || r === undefined || r.ref === undefined || r.pid === undefined) {
          return;
        }

        const rev = 1 + (cut % 50);
        const wait = waits[0]!;
        const [reading, read] = step(waiting, answerMsg({ type: "wait_ok", id: wait.id, dial, value: { rev }, ms: 0 }));
        const inboxRead = writes(read, "read").filter((c) => streamIn(c.call) === there);
        expect(
          inboxRead.map((c) => c.call["after"]),
          "the woken wait reads the moved Model's inbox",
        ).toEqual([0]);
        const to = clientTo(processAt(9_999), OTHER_TAB);
        const letter = {
          _tag: "send",
          by: BRAIN_BY,
          id: signalId(to, r.ref, 1),
          rev,
          arrivedAt: rev,
          body: { m: Down.make({ ref: r.ref, process: r.pid, reason: EXITS[3]!, to }) },
        };
        const [after, cmds] = step(
          reading,
          answerMsg({ type: "read_ok", id: inboxRead[0]!.id, dial, value: [letter], ms: 0 }),
        );
        const again = writes(cmds, "read").filter((c) => streamIn(c.call) === `processes/${watch.name}`);
        expect(
          again.map((c) => c.call["after"]),
          `${watch.name}'s DOWN in the moved Model's inbox reads its name again`,
        ).toEqual([0]);
        expect(reachIn(after, watch.id), `${watch.name} after its DOWN`).toMatchObject({
          _tag: "resolving",
          id: again[0]!.id,
        });
        seen.downed++;
      }),
      opts,
    );
    expect(seen.moved, "Models were moved to another tab").toBeGreaterThan(0);
    expect(seen.waited, "moved Models waited on their new inbox").toBeGreaterThan(0);
    expect(seen.downed, "moved Models took a DOWN in their new inbox").toBeGreaterThan(0);
    expect(seen.burst, "saved Models held a burst").toBeGreaterThan(0);
  });

  it("S8 property: the polite region's status messages are written by the steps their events happen in and joined into one burst: each end and each refusal appends one message under the next id, in order; a resend tick with messages empties the list and keeps the id, and one with none changes nothing; a tile tells each process's end once and a successor's end again; a loaded Model's region is empty with its id kept; any other step leaves the region as it was", () => {
    const seen = { ended: 0, again: 0, refused: 0, burst: 0, cleared: 0, idle: 0, quiet: 0, resaid: 0, cut: 0 };
    fc.assert(
      fc.property(follows, (list) => {
        const told = new Set<string>(); // `${tile} ${pid}`: each end a status message told
        const ends = new Map<string, number>(); // tile → how many ends it told
        const hushed = new Set<string>(); // the messages of every burst a tick ended
        let cuts = 0;
        follow(
          list,
          ({ prev, m, next, world }) => {
            const was = prev.said;
            const ended = next.tiles.flatMap((t) => {
              const r = t.reach;
              const before = reachIn(prev, t.id);
              const turned = r._tag === "ended" && !(before._tag === "ended" && before.pid === r.pid);
              seen.quiet += turned && told.has(`${t.id} ${r.pid}`) ? 1 : 0;
              return turned && !told.has(`${t.id} ${r.pid}`) ? [{ tile: t.id, pid: r.pid, reason: r.reason }] : [];
            });
            // A refused answer to a letter in flight, whose press a tile of this window made.
            const flight = answeredFlight(prev, m)?.call;
            const letter = flight?._tag === "send" ? flight.letter : null;
            const slot = prev.client.pending.find((p) => p._tag === "ready" && p.letter === letter);
            const owner = slot === undefined ? undefined : prev.from[slot.n]?.tile;
            const refused =
              m.type === "send_ok" &&
              m.value._tag === "refused" &&
              slot !== undefined &&
              prev.tiles.some((t) => t.id === owner)
                ? [{ _tag: "refused", tile: owner, m: slot.m, reason: m.value.reason }]
                : [];
            const messages = [...ended.map(({ tile, reason }) => ({ _tag: "ended", tile, reason })), ...refused];
            const tick = m.type === "resend";
            seen.cleared += tick && was.messages.length > 0 ? 1 : 0;
            seen.idle += tick && was.messages.length === 0 ? 1 : 0;

            if (tick) {
              for (const message of was.messages) {
                hushed.add(JSON.stringify(message));
              }
            }

            const start = tick ? { id: was.id, messages: [] } : was;
            const stepped = {
              id: start.id + messages.length,
              messages: [...start.messages, ...messages],
            };
            const cut = world.cuts > cuts;
            cuts = world.cuts;
            seen.cut += cut && stepped.messages.length > 0 ? 1 : 0;
            expect(next.said, `the region after ${m.type}${cut ? " and a saved cut" : ""}`).toEqual(
              cut ? { id: stepped.id, messages: [] } : stepped,
            );
            seen.burst += messages.length > 0 && start.messages.length > 0 ? 1 : 0;
            seen.refused += refused.length;
            seen.resaid += messages.filter((x) => hushed.has(JSON.stringify(x))).length;

            for (const e of ended) {
              seen.ended++;
              seen.again += (ends.get(e.tile) ?? 0) > 0 ? 1 : 0;
              ends.set(e.tile, (ends.get(e.tile) ?? 0) + 1);
              told.add(`${e.tile} ${e.pid}`);
            }
          },
          true,
        );
      }),
      opts,
    );

    for (const [k, n] of Object.entries(seen)) {
      expect(n, `region steps seen as ${k}`).toBeGreaterThan(0);
    }
  });
});

// Desk S2a, next/ (the desk program fabrika/tezgah, ticket named by its title): law L10 of the
// approved plan. Written before the window has a desk. The shape it holds `WindowMachine.ts` to,
// from the plan (the build may add more):
// - The ctx may carry `tezgah: {workspace}` (never `desk`). A window started with it shows no tile of
//   `ctx.tiles`: once its hello is admitted, it reads `processes/tezgah:<person>`, the person from
//   the door's admission (`Handshake`'s `admitted` keeps it), opens that pid's view and decodes it
//   as `TezgahView` itself, never through `checks.decode`. Its tiles are then the tiles of its
//   workspace in tezgah's latest view, each named by the process it shows (`shows`): a view change
//   adds and removes tiles, and a tile that is new while online has its `processes/<shows>` read
//   written in that same step, and its pid opened once the read answers.
// - With no desk, the given tiles stay, and the window never reads a tezgah stream.
// The walk goes online through the real hello exchange, then each step reads the folded model and
// the walk's brain and picks one move possible there: an answer to a written call really in flight,
// an answer to a Cmd really waiting, or an edit of tezgah's workspaces, sent as a view notice once
// the window has opened tezgah's view. The brain's views are real `TezgahView` wire values: tile
// and workspace ids are canonical TypeIDs, and every layout's parts sum to 100.
const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

const typeId = (prefix: string, n: number): string => {
  let uuid = (BigInt(n) << 80n) | (7n << 76n) | (2n << 62n);
  let suffix = "";

  for (let i = 0; i < 26; i++) {
    suffix = ID_ALPHABET[Number(uuid & 31n)] + suffix;
    uuid >>= 5n;
  }

  return `${prefix}_${suffix}`;
};

/** The tiles a start is given, named by processes tezgah never shows, so a read of one of their
 *  streams can only come from the given list, never from tezgah's view. */
const GIVEN = ["given:1", "given:2", "given:3"].map((name, i) => ({ id: `given_${i + 1}`, name }));
const DESK_PERSON = typeId("person", 41);
const TEZGAH_PID = "process_of_tezgah";
const DESK_ADMITTED = { version: 1, ping: 5_000, identity: { key: "SHA256:k", person: DESK_PERSON, as: "window" } };
const deskWindow = windowMachineFor({ decode: () => Schema.decodeUnknownSync(ListView), tile: tileFor });

/** tezgah's workspaces as the brain holds them: each workspace's tiles in reading order, by number. */
type Desk = { rev: number; spaces: Map<number, Array<string>>; shows: Map<string, string>; next: number };

/** The brain's view as the wire carries it: each workspace one row, its percents summing to 100. */
const deskView = (d: Desk) => ({
  workspaces: [...d.spaces].map(([n, tiles]) => {
    const base = Math.floor(100 / tiles.length);
    return {
      id: typeId("workspace", n),
      n,
      layout:
        tiles.length === 1
          ? tiles[0]
          : {
              dir: "row",
              parts: tiles.map((inner, i) => ({ percent: i === 0 ? 100 - base * (tiles.length - 1) : base, inner })),
            },
      focus: tiles[0],
      recent: [tiles[0]],
    };
  }),
  tiles: [...d.spaces.values()].flat().map((id, i) => ({
    id,
    n: i + 1,
    shows: d.shows.get(id),
    program: "fabrika/checklist",
    child: i > 0,
    keep: "failed",
    cursor: null,
  })),
});

const DeskPick = fc.record({
  type: fc.constant("pick" as const),
  move: fc.nat(),
  pick: fc.nat(),
  ms: fc.integer({ min: 0, max: 5_000 }),
});
type DeskPick = typeof DeskPick extends fc.Arbitrary<infer A> ? A : never;

type DeskWorld = {
  s: WindowModel;
  waiting: Array<Cmd>;
  desk: Desk;
  /** The workspace-1 tiles of the last view the window was sent, or null before any. */
  shown: ReadonlyArray<{ readonly id: string; readonly name: string }> | null;
  subscribed: boolean;
  /** Whether the brain has started this person's tezgah: the boot starts only the founder's, so for
   *  any other person a read of `processes/tezgah:<person>` finds no process until something starts it
   *  (plan amendment 11, point 2). */
  up: boolean;
};

type DeskEvent = {
  readonly prev: WindowModel;
  readonly m: WindowMsg;
  readonly next: WindowModel;
  readonly cmds: ReadonlyArray<Cmd>;
  readonly w: DeskWorld;
};

const deskTiles = (d: Desk) => (d.spaces.get(1) ?? []).map((id) => ({ id, name: d.shows.get(id) ?? "" }));

/** Steps the desk window and keeps every Cmd it hands out until it is answered. */
const deskStep = (w: DeskWorld, m: WindowMsg, machine: typeof deskWindow, each: (e: DeskEvent) => void) => {
  const prev = w.s;
  const [next, cmds] = applyCell(machine, prev, m) as readonly [WindowModel, ReadonlyArray<Cmd>];
  w.waiting = [...w.waiting.filter((cmd) => !("cmd" in m) || m.cmd !== cmd), ...cmds];
  w.s = next;
  each({ prev, m, next, cmds, w });
};

/** The hello exchange on dial 1, as the door runs it: a challenge, a hello, the admission. */
const goOnline = (w: DeskWorld, machine: typeof deskWindow, each: (e: DeskEvent) => void, dial = 1) => {
  const key = w.waiting.find((c) => c.type === "key");

  if (key !== undefined) {
    deskStep(
      w,
      { type: "key_ok", cmd: key, value: { found: "created", fingerprint: "SHA256:k" } } as WindowMsg,
      machine,
      each,
    );
  }

  deskStep(w, { type: "socket_opened", dial, at: 0 } as WindowMsg, machine, each);
  deskStep(
    w,
    { type: "frame", dial, text: rpc({ method: "challenge", params: { nonce: `n0nce${dial}` } }), at: 1 } as WindowMsg,
    machine,
    each,
  );
  const hello = w.waiting.find((c) => c.type === "hello" && c["dial"] === dial);

  if (hello !== undefined) {
    deskStep(w, { type: "hello_ok", cmd: hello, value: null } as WindowMsg, machine, each);
    deskStep(
      w,
      { type: "frame", dial, text: rpc({ id: hello["id"], result: DESK_ADMITTED }), at: 2 } as WindowMsg,
      machine,
      each,
    );
  }
};

/** Every move the desk world allows now. */
const deskMoves = (w: DeskWorld, c: DeskPick): ReadonlyArray<() => WindowMsg | null> => {
  const s = w.s;
  const out: Array<() => WindowMsg | null> = [];
  const d = w.desk;
  const notice = (): WindowMsg | null => {
    d.rev++;

    if (!w.subscribed) {
      return null;
    }

    w.shown = deskTiles(d);
    return {
      type: "view",
      pid: TEZGAH_PID,
      note: { pid: TEZGAH_PID, type: "whole", rev: d.rev, view: deskView(d) },
    } as WindowMsg;
  };

  for (const f of s.flight) {
    const on = { id: f.id, dial: f.dial };
    out.push(() => {
      if (f.call._tag === "read") {
        const name = f.call.stream.replace(/^processes\//, "");
        const process = name.startsWith("tezgah:") ? TEZGAH_PID : `process_of_${name}`;
        // A stream no process was ever started on reads as the brain sends it: no entries.
        const none = name.startsWith("tezgah:") && !w.up;
        return {
          type: "read_ok",
          ...on,
          value: none ? [] : [{ _tag: "started", by: "brain", body: { process, name }, rev: 1 }],
          ms: c.ms,
        } as WindowMsg;
      }

      if (f.call._tag === "open") {
        if (f.call.pid === TEZGAH_PID) {
          w.subscribed = true;
          w.shown = deskTiles(d);
          return { type: "open_ok", ...on, value: { rev: d.rev, view: deskView(d) }, ms: c.ms } as WindowMsg;
        }

        return { type: "open_ok", ...on, value: { rev: 0, view: EMPTY }, ms: c.ms } as WindowMsg;
      }

      if (f.call._tag === "send") {
        return { type: "send_ok", ...on, value: { _tag: "accepted", rev: c.ms, pos: c.pick }, ms: c.ms } as WindowMsg;
      }

      return { type: "knock_ok", ...on, value: null, ms: c.ms } as WindowMsg;
    });
  }

  for (const cmd of w.waiting.filter((x) => ["now", "record", "persist", "write", "ping"].includes(x.type))) {
    out.push(
      () =>
        ({
          type: `${cmd.type}_ok`,
          cmd,
          value:
            cmd.type === "now"
              ? { letter: `letter_${c.pick}`, sentAt: "2026-11-14T00:00:00.000Z" }
              : cmd.type === "persist"
                ? true
                : null,
        }) as WindowMsg,
    );
  }

  // The socket drops while online: the brain sends nothing more to it, and the Link retries.
  if (s.link._tag === "online") {
    const dial = s.link.dial;
    out.push(() => {
      w.subscribed = false;
      return { type: "socket_closed", dial, code: 1006, at: 3 } as WindowMsg;
    });
  }

  const timer = linkTimer(s.link);

  if (timer !== null && s.link._tag === "retrying") {
    out.push(
      () => timer.msg,
      () => timer.msg,
      () => timer.msg,
    );
  }

  // The brain starts this person's tezgah, which tells the window nothing on its own.
  if (!w.up) {
    out.push(() => {
      w.up = true;
      return null;
    });
  }

  // tezgah's edits: a tile joins or leaves workspace 1, or workspace 2, which this window never shows.
  for (const n of [1, 1, 2]) {
    out.push(() => {
      const tiles = d.spaces.get(n) ?? [];
      const id = typeId("tile", 100 + d.next++);
      d.spaces.set(n, [
        ...tiles.slice(0, (c.pick % (tiles.length + 1)) | 0),
        id,
        ...tiles.slice(c.pick % (tiles.length + 1)),
      ]);
      d.shows.set(id, `checklist:t${d.next}`);
      return notice();
    });
    out.push(() => {
      const tiles = d.spaces.get(n) ?? [];

      if (tiles.length < 2) {
        return null;
      }

      d.spaces.set(
        n,
        tiles.filter((_, i) => i !== c.pick % tiles.length),
      );
      return notice();
    });
  }

  return out;
};

const deskFold = (
  picks: ReadonlyArray<DeskPick>,
  machine: typeof deskWindow,
  withDesk: boolean,
  each: (e: DeskEvent) => void,
  up = true,
) => {
  const desk: Desk = {
    rev: 1,
    spaces: new Map([[1, [typeId("tile", 1)]]]),
    shows: new Map([[typeId("tile", 1), "checklist:1"]]),
    next: 2,
  };
  const ctx = withDesk ? { tiles: GIVEN, tab: TAB, tezgah: { workspace: 1 } } : { tiles: GIVEN, tab: TAB };
  const [s0, cmds0] = machine.init(null, ctx as never);
  const w: DeskWorld = { s: s0, waiting: [...cmds0], desk, shown: null, subscribed: false, up };
  each({ prev: s0, m: { type: "seen", rev: 0 } as WindowMsg, next: s0, cmds: cmds0, w });
  goOnline(w, machine, each);
  const dialed = new Set([1]);

  for (const c of picks) {
    if (w.s.link._tag === "dialing" && !dialed.has(w.s.link.dial)) {
      dialed.add(w.s.link.dial);
      goOnline(w, machine, each, w.s.link.dial);
      continue;
    }

    const options = deskMoves(w, c);
    const m = options[c.move % options.length]!();

    if (m !== null) {
      deskStep(w, m, machine, each);
    }
  }

  return w;
};

const reads = (cmds: ReadonlyArray<Cmd>) =>
  cmds.filter(isWrite).flatMap((c) => (c.call._tag === "read" ? [String(c.call["stream"])] : []));

describe("Desk S2a L10: a window with a desk takes its tiles from tezgah", () => {
  it("L10: a window started with the tezgah option takes its tiles only from tezgah's view: a view change adds and removes tiles and opens each new one's process view, after a redial too", () => {
    let online = 0;
    let redials = 0;
    fc.assert(
      fc.property(arbMsgSequence(DeskPick, { minLength: 10, maxLength: 120, size: "max" }), (picks) => {
        deskFold(picks, deskWindow, true, ({ prev, m, next, cmds, w }) => {
          online += m.type === "frame" && next.link._tag === "online" && prev.link._tag !== "online" ? 1 : 0;
          redials +=
            m.type === "frame" && next.link._tag === "online" && prev.link._tag !== "online" && next.link.dial > 1
              ? 1
              : 0;
          const want = w.shown ?? [];
          const got = next.tiles.map((t) => ({ id: t.id, name: t.name }));
          expect(
            [...got].sort((a, b) => (a.id < b.id ? -1 : 1)),
            `L10: after ${m.type} the window's tiles are workspace 1's in tezgah's latest view`,
          ).toEqual([...want].sort((a, b) => (a.id < b.id ? -1 : 1)));

          for (const name of GIVEN.map((t) => t.name)) {
            expect(reads(cmds), `L10: a desk window never reads the given tile ${name}`).not.toContain(
              `processes/${name}`,
            );
          }

          if (next.link._tag === "online" && prev.link._tag !== "online") {
            expect(
              reads(cmds).filter((r) => r.startsWith("processes/tezgah:")),
              "L10: going online, the first time or after a redial, reads the admitted person's tezgah once",
            ).toHaveLength(1);
          }

          if (next.link._tag === "online") {
            for (const t of next.tiles.filter((t) => !prev.tiles.some((p) => p.id === t.id))) {
              expect(reads(cmds), `L10: a new tile ${t.id} reads processes/${t.name} in the same step`).toContain(
                `processes/${t.name}`,
              );
            }
          }

          if (m.type === "read_ok" && m.value.length > 0) {
            const name = String(Reflect.get(Object(Reflect.get(Object(m.value[0]), "body")), "name"));

            if (next.tiles.some((t) => t.name === name)) {
              expect(
                writes(cmds, "open").map((c) => c.call["pid"]),
                `L10: ${name}'s read opens its process view`,
              ).toContain(`process_of_${name}`);
            }
          }
        });
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(online, "L10: the walks go online").toBeGreaterThan(0);
    expect(redials, "L10: the walks drop the link and go online again on a later dial").toBeGreaterThan(0);
  });

  it("L10: with no tezgah option the given tiles stay, and the window never reads a tezgah stream", () => {
    let opened = 0;
    fc.assert(
      fc.property(arbMsgSequence(DeskPick, { minLength: 10, maxLength: 120, size: "max" }), (picks) => {
        deskFold(picks, deskWindow, false, ({ prev, next, cmds }) => {
          opened += next.tiles.filter((t, i) => t.reach._tag === "open" && prev.tiles[i]?.reach._tag !== "open").length;
          expect(
            next.tiles.map((t) => [t.id, t.name]),
            "L10: the given tiles stay",
          ).toEqual(GIVEN.map((t) => [t.id, t.name]));
          expect(
            reads(cmds).filter((r) => r.startsWith("processes/tezgah:")),
            "L10: no desk, no tezgah read",
          ).toEqual([]);
        });
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(opened, "L10: the walks go online and open the given tiles").toBeGreaterThan(0);
  });
});

// Desk round R, next/: plan amendment 11, point 2. The boot starts only the founder's tezgah, so a
// window whose person has none finds no process at `processes/tezgah:<person>`. The walk is L10's,
// started with no tezgah for the window's person; one of its moves has the brain start it later.
describe("Desk R: a window whose person has no tezgah says so, and follows tezgah once it exists", () => {
  it("R2: a read that finds no tezgah takes the window's tezgah link to missing, with no tile and nothing opened; each redial reads processes/tezgah:<person> again, and once tezgah exists the window opens it and takes its tiles", () => {
    const stream = `processes/tezgah:${DESK_PERSON.slice("person_".length)}`;
    const seen = { missing: 0, redialed: 0, followed: 0 };
    fc.assert(
      fc.property(arbMsgSequence(DeskPick, { minLength: 10, maxLength: 120, size: "max" }), (picks) => {
        let wasMissing = false;
        let counted = false;
        deskFold(
          picks,
          deskWindow,
          true,
          ({ prev, m, next, cmds, w }) => {
            const reach = next.tezgah?.reach._tag;
            const tezgahRead = (x: WindowModel) =>
              x.flight.some((f) => f.call._tag === "read" && f.call.stream === stream);

            const emptied = m.type === "read_ok" && m.value.length === 0 && tezgahRead(prev) && !tezgahRead(next);
            const opened = writes(cmds, "open").map((c) => c.call["pid"]);
            seen.missing += emptied ? 1 : 0;
            wasMissing ||= emptied;
            expect(emptied ? reach : "missing", "R2: a read that finds no tezgah takes the link to missing").toBe(
              "missing",
            );
            expect(emptied ? opened : [], "R2: no tezgah, nothing opened").toEqual([]);
            expect(reach === "missing" ? next.tiles : [], "R2: a window with no tezgah shows no tile").toEqual([]);
            expect(reach === "missing" && opened.includes(TEZGAH_PID), "R2: a missing tezgah is never opened").toBe(
              false,
            );

            const online = next.link._tag === "online" && prev.link._tag !== "online";
            seen.redialed += online && wasMissing ? 1 : 0;
            expect(
              online ? reads(cmds).filter((r) => r.startsWith("processes/tezgah:")) : [stream],
              "R2: each time the window goes online it reads its own person's tezgah once",
            ).toEqual([stream]);

            const follows = wasMissing && w.up && reach === "open" && !counted;
            counted ||= follows;
            seen.followed += follows ? 1 : 0;
            const want = deskTiles(w.desk)
              .map((t) => t.name)
              .sort();
            expect(
              follows ? [...next.tiles].map((t) => t.name).sort() : want,
              "R2: once tezgah exists, the window takes workspace 1's tiles from its view",
            ).toEqual(want);
          },
          false,
        );
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.missing, "R2: the walks reach a window with no tezgah").toBeGreaterThan(0);
    expect(seen.redialed, "R2: the walks redial after finding no tezgah").toBeGreaterThan(0);
    expect(seen.followed, "R2: the walks follow tezgah once it exists").toBeGreaterThan(0);
  });
});

// Desk S3, next/: the window's focus moves walked through the link's life, L26's window half and the
// lean's offline rule. Written before a window moves focus; `client/Tezgah.laws.test.ts` holds L23 to
// L25 and L29 on two windows. The shape it holds `WindowMachine.ts` to, from the plan's "The lead's
// lean" (the build may add more):
// - A focus key is resolved on the window's own drawn state (`optimisticState` of its tezgah child),
//   never on tezgah's: `focus_next` and `focus_previous` follow reading order and wrap, `focus_last`
//   goes to the drawn `recent[1]`, and a direction goes to `Layout.neighbor` of the drawn layout. A
//   key that finds no other tile changes nothing. The move is drawn on the step that reads the key,
//   online or not, and the page's `{type: "focus", tile, cursor}` on another tile is a move too.
// - An offline window keeps its pending mutations, and each move's letter reaches tezgah once the
//   link is back, as every letter on the press path does (the lean, 70%).
// The walk goes online through the real hello exchange, and each step picks one move possible in the
// state it folded: a focus key or a click, an answer to a call in flight or a Cmd waiting, a socket
// drop while online, the link's timer, or a view tezgah sent. The fake tezgah takes a letter when its
// send is answered, focuses its `to` and sends its whole view to the window while it is subscribed.
const FOCUS_ROWS: ReadonlyArray<Binding> = [
  { does: "tezgah.focus_next", keys: ["<prefix>o", "f6"], word: "focus next", label: "Focus next tile" },
  { does: "tezgah.focus_previous", keys: ["shift+f6"], word: "focus previous", label: "Focus previous tile" },
  { does: "tezgah.focus_last", keys: ["<prefix>;"], word: "focus last", label: "Focus last tile" },
  { does: "tezgah.focus_left", keys: ["<prefix>h", "<prefix>arrowleft"], word: "focus left", label: "Focus left" },
  { does: "tezgah.focus_right", keys: ["<prefix>l", "<prefix>arrowright"], word: "focus right", label: "Focus right" },
  { does: "tezgah.focus_up", keys: ["<prefix>k", "<prefix>arrowup"], word: "focus up", label: "Focus up" },
  { does: "tezgah.focus_down", keys: ["<prefix>j", "<prefix>arrowdown"], word: "focus down", label: "Focus down" },
];

const FOCUS_BACKEND = Keys.backend("electron", "linux");
const focusTable = Keys.load(Keys.ship(FOCUS_ROWS, FOCUS_BACKEND), FOCUS_BACKEND);

const focusWindow = windowMachineFor({
  decode: () => Schema.decodeUnknownSync(ListView),
  tile: tileFor,
  keys: Result.getOrThrow(focusTable),
});

type FocusTo = "next" | "previous" | "last" | "left" | "right" | "up" | "down";

const FOCUS_PRESSES: ReadonlyArray<{ readonly keys: ReadonlyArray<string>; readonly to: FocusTo }> = [
  { keys: ["ctrl+b", "o"], to: "next" },
  { keys: ["f6"], to: "next" },
  { keys: ["shift+f6"], to: "previous" },
  { keys: ["ctrl+b", ";"], to: "last" },
  { keys: ["ctrl+b", "h"], to: "left" },
  { keys: ["ctrl+b", "arrowright"], to: "right" },
  { keys: ["ctrl+b", "k"], to: "up" },
  { keys: ["ctrl+b", "arrowdown"], to: "down" },
];

/** The workspace the window draws. */
const drawnHere = (s: WindowModel) => {
  const client = s.tezgah?.client;
  const view = client === undefined ? null : optimisticState(client);
  return view?.workspaces.find((w) => w.n === client?.workspace) ?? null;
};

/** Where a focus key goes on the drawn workspace, by the lean's words; null when nowhere new. */
const resolved = (s: WindowModel, to: FocusTo): string | null => {
  const space = drawnHere(s);

  if (space === null) {
    return null;
  }

  const tiles = Layout.order(space.layout);
  const i = tiles.indexOf(space.focus);
  const found =
    to === "next"
      ? tiles[(i + 1) % tiles.length]
      : to === "previous"
        ? tiles[(i - 1 + tiles.length) % tiles.length]
        : to === "last"
          ? space.recent[1]
          : (Layout.neighbor(space.layout, space.focus, to) ?? undefined);
  return found === undefined || found === space.focus ? null : found;
};

type FocusWorld = DeskWorld & {
  view: TezgahView;
  pos: number;
  notices: Array<{ readonly rev: number; readonly view: TezgahView }>;
  moves: Array<{ readonly to: string; letter: string | null }>;
  /** Letters tezgah took, in the order it took them. */
  took: Array<string>;
  letters: number;
};

/** A workspace split by `cuts`, focus on the tile `focus` picks. */
const focusDesk = (cuts: ReadonlyArray<{ readonly at: number; readonly down: boolean }>, focus: number): TezgahView => {
  const first = typeId("tile", 1) as TileId;
  let w: Workspace = Schema.decodeUnknownSync(Workspace)({
    id: typeId("workspace", 1),
    n: 1,
    layout: first,
    focus: first,
    recent: [first],
  });
  const tiles: Array<Tile> = [];
  const row = (id: string, n: number) =>
    ({
      id,
      n,
      shows: n === 1 ? "checklist:1" : `plain:${n}`,
      program: "fabrika/checklist",
      child: n > 1,
      keep: "failed",
      cursor: null,
    }) as Tile;
  tiles.push(row(first, 1));

  for (const [k, cut] of cuts.entries()) {
    const at = Layout.order(w.layout)[cut.at % Layout.order(w.layout).length]!;
    const id = typeId("tile", k + 2) as TileId;
    w = Layout.split(w, at, cut.down ? "column" : "row", id);
    tiles.push(row(id, k + 2));
  }

  const on = Layout.order(w.layout)[focus % Layout.order(w.layout).length]!;
  return { workspaces: [{ ...w, focus: on, recent: [on, ...w.recent.filter((t) => t !== on)] }], tiles };
};

/** Whether flight `f` is the window's own inbox wait, the one call the door parks in the focus world
 *  that the window means to leave parked: its id is the one the inbox waits under. */
const inboxParked = (s: WindowModel, f: WindowModel["flight"][number]): boolean =>
  f.call._tag === "wait" && s.inbox._tag === "waiting" && f.id === s.inbox.id;

/** Every move the focus world allows now. With `ends`, a read of a tile's name finds, by the pick,
 *  either a live process or one that started and then ended with one of the exit reasons. */
const focusMoves = (
  w: FocusWorld,
  c: DeskPick,
  each: (e: DeskEvent) => void,
  ends = false,
): ReadonlyArray<() => void> => {
  const s = w.s;
  const out: Array<() => void> = [];
  const send = (m: WindowMsg) => deskStep(w, m, focusWindow, each);

  // A `ledger.wait` stays parked at the door: nothing in this world writes past its cursor, the
  // window's inbox or a tile's name, so the door never answers it (P18 slice 2's inbox wait).
  for (const f of s.flight.filter((x) => x.call._tag !== "wait")) {
    const on = { id: f.id, dial: f.dial };
    out.push(() => {
      if (f.call._tag === "read") {
        const name = f.call.stream.replace(/^processes\//, "");
        const process = name.startsWith("tezgah:") ? TEZGAH_PID : `process_of_${name}`;
        const started = { _tag: "started", by: "brain", body: { process, name }, rev: 1 };
        const ended = ends && !name.startsWith("tezgah:") && c.pick % 2 === 1;
        const reason = EXITS[c.pick % EXITS.length]!;
        send({
          type: "read_ok",
          ...on,
          value: ended ? [started, { _tag: "exited", by: "brain", body: { process, reason }, rev: 2 }] : [started],
          ms: c.ms,
        } as WindowMsg);
      } else if (f.call._tag === "open" && f.call.pid === TEZGAH_PID) {
        w.subscribed = true;
        send({ type: "open_ok", ...on, value: { rev: w.pos, view: w.view }, ms: c.ms } as WindowMsg);
      } else if (f.call._tag === "open") {
        send({ type: "open_ok", ...on, value: { rev: 0, view: EMPTY }, ms: c.ms } as WindowMsg);
      } else if (f.call._tag === "send") {
        const pos = w.took.indexOf(f.call.letter) + 2;
        send({
          type: "send_ok",
          ...on,
          value: { _tag: "accepted", rev: pos + 1_000, pos },
          ms: c.ms,
        } as WindowMsg);
      } else if (f.call._tag === "monitor") {
        // P18 slice 2: the door's process.monitor answers null.
        send({ type: "monitor_ok", ...on, value: null, ms: c.ms } as WindowMsg);
      } else {
        send({ type: "knock_ok", ...on, value: null, ms: c.ms } as WindowMsg);
      }
    });
  }

  for (const cmd of w.waiting.filter((x) => ["now", "record", "persist", "write", "ping"].includes(x.type))) {
    out.push(() =>
      send({
        type: `${cmd.type}_ok`,
        cmd,
        value:
          cmd.type === "now"
            ? { letter: `letter_${++w.letters}`, sentAt: "2026-11-14T00:00:00.000Z" }
            : cmd.type === "persist"
              ? true
              : null,
      } as WindowMsg),
    );
  }

  if (s.link._tag === "online") {
    const dial = s.link.dial;
    out.push(() => {
      w.subscribed = false;
      w.notices = [];
      send({ type: "socket_closed", dial, code: 1006, at: 3 } as WindowMsg);
    });
  }

  const timer = linkTimer(s.link);

  if (timer !== null && s.link._tag === "retrying") {
    out.push(() => send(timer.msg));
  }

  const n = w.notices.shift();

  if (n !== undefined) {
    w.notices.unshift(n);
    out.push(() => {
      w.notices.shift();
      send({
        type: "view",
        pid: TEZGAH_PID,
        note: { pid: TEZGAH_PID, type: "whole", rev: n.rev, view: n.view },
      } as WindowMsg);
    });
  }

  // A person's moves, three times as likely as any one answer.
  for (let k = 0; k < 3; k++) {
    out.push(() => {
      const press = FOCUS_PRESSES[(c.pick + k) % FOCUS_PRESSES.length]!;

      for (const [i, key] of press.keys.entries()) {
        if (i === press.keys.length - 1) {
          const to = resolved(w.s, press.to);

          if (to !== null) {
            w.moves.push({ to, letter: null });
          }
        }

        send({ type: "key", key, at: 10 } as WindowMsg);
      }
    });
  }

  out.push(() => {
    const space = drawnHere(w.s);

    if (space === null) {
      return;
    }

    const tile = Layout.order(space.layout)[c.pick % Layout.order(space.layout).length]!;

    if (tile !== space.focus) {
      w.moves.push({ to: tile, letter: null });
    }

    send({ type: "focus", tile, cursor: c.pick % 2 === 0 ? "item:milk" : null } as WindowMsg);
  });

  return out;
};

describe("Desk S3: the window's focus moves, walked through the link's life", () => {
  it("L26 (the window's half): each focus key and click is drawn on its step, resolved on the window's drawn layout, offline too; each move reaches tezgah as one letter once the link is back, and the window ends on tezgah's focus", () => {
    const seen = { offline: 0, redial: 0, moves: 0 };
    fc.assert(
      fc.property(
        fc.array(fc.record({ at: fc.nat(), down: fc.boolean() }), { minLength: 1, maxLength: 5 }),
        fc.nat(),
        arbMsgSequence(DeskPick, { minLength: 10, maxLength: 120, size: "max" }),
        (cuts, focus, picks) => {
          const view = focusDesk(cuts, focus);
          const [s0, cmds0] = focusWindow.init(null, { tiles: [], tab: TAB, tezgah: { workspace: 1 } } as never);
          const w: FocusWorld = {
            s: s0,
            waiting: [...cmds0],
            desk: { rev: 1, spaces: new Map(), shows: new Map(), next: 1 },
            shown: null,
            subscribed: false,
            up: true,
            view,
            pos: 1,
            notices: [],
            moves: [],
            took: [],
            letters: 0,
          };
          /** tezgah takes a letter as the socket hands it over, in order: a move to a tile on its
           *  workspace focuses it, and its view goes to the window while it is subscribed. */
          const take = (letter: string, m: unknown) => {
            const did = m as { readonly to?: string };
            const space = w.view.workspaces[0]!;

            if (
              w.took.includes(letter) ||
              did.to === undefined ||
              !Layout.order(space.layout).includes(did.to as TileId)
            ) {
              return;
            }

            w.took.push(letter);
            w.pos++;
            const to = did.to as TileId;
            w.view = {
              ...w.view,
              workspaces: [{ ...space, focus: to, recent: [to, ...space.recent.filter((t) => t !== to)] }],
            };

            if (w.subscribed) {
              w.notices.push({ rev: w.pos, view: w.view });
            }
          };
          /** The tile each letter to tezgah named, by letter. */
          const named = new Map<string, unknown>();
          const each = ({ m, next, cmds }: DeskEvent) => {
            for (const c of cmds.filter(isWrite)) {
              if (c.call._tag === "send" && c.call["pid"] === TEZGAH_PID) {
                const letter = String(c.call["letter"]);
                take(letter, c.call["m"]);
                named.set(letter, Reflect.get(Object(c.call["m"]), "to"));
                const move = w.moves.find((x) => x.letter === null);

                if (move !== undefined && !w.moves.some((x) => x.letter === letter)) {
                  move.letter = letter;
                }
              }
            }

            seen.offline += (m.type === "key" || m.type === "focus") && next.link._tag !== "online" ? 1 : 0;
          };
          goOnline(w, focusWindow, each);
          const dialed = new Set([1]);
          const pump = (c: DeskPick) => {
            if (w.s.link._tag === "dialing" && !dialed.has(w.s.link.dial)) {
              dialed.add(w.s.link.dial);
              seen.redial++;
              goOnline(w, focusWindow, each, w.s.link.dial);
              return;
            }

            const options = focusMoves(w, c, each);
            options[c.move % options.length]!();
          };

          for (const c of picks) {
            const before = w.moves.length;
            pump(c);

            // A key or a click that made a move draws it at once.
            if (w.moves.length > before) {
              expect(drawnHere(w.s)?.focus, "L26: the window draws the move it made").toBe(w.moves.at(-1)!.to);
            }
          }

          // Settle: back online, every call and Cmd answered, every view delivered. The inbox's own
          // parked `ledger.wait` is no call left to answer: the door holds it until its stream grows.
          // Any other wait is: no tile in this world ends, so a tile that waits where it should read
          // leaves the world unsettled.
          for (let guard = 0; guard < 3_000; guard++) {
            const s = w.s;
            const unanswered = s.flight.filter((f) => !inboxParked(s, f));
            const answerable = unanswered.filter((f) => f.call._tag !== "wait");

            if (s.link._tag === "dialing" && !dialed.has(s.link.dial)) {
              dialed.add(s.link.dial);
              goOnline(w, focusWindow, each, s.link.dial);
              continue;
            }

            const options = focusMoves(w, { type: "pick", move: 0, pick: 0, ms: 1 }, each);
            const quiet =
              s.link._tag === "online" &&
              unanswered.length === 0 &&
              w.notices.length === 0 &&
              !w.waiting.some((x) => ["now", "record", "persist", "write", "ping"].includes(x.type)) &&
              w.moves.every((x) => x.letter !== null && w.took.includes(x.letter));

            // The first options are the answers; a timer when retrying; never a socket drop or a key.
            const answers =
              answerable.length +
              w.waiting.filter((x) => ["now", "record", "persist", "write", "ping"].includes(x.type)).length;
            // Online with nothing left to answer or deliver, and only a call the door holds: no move
            // of this world will ever settle it.
            const stuck = s.link._tag === "online" && answers === 0 && w.notices.length === 0 && unanswered.length > 0;

            if (quiet || stuck) {
              break;
            }

            if (answers > 0) {
              options[0]!();
            } else if (s.link._tag === "retrying" && linkTimer(s.link) !== null) {
              deskStep(w, linkTimer(s.link)!.msg, focusWindow, each);
            } else if (w.notices.length > 0) {
              const n = w.notices.shift()!;
              deskStep(
                w,
                {
                  type: "view",
                  pid: TEZGAH_PID,
                  note: { pid: TEZGAH_PID, type: "whole", rev: n.rev, view: n.view },
                } as WindowMsg,
                focusWindow,
                each,
              );
            } else {
              const timer = linkTimer(s.link);
              const resend = { type: "resend", dial: s.link._tag === "online" ? s.link.dial : 0 } as WindowMsg;
              deskStep(w, s.link._tag === "online" ? resend : timer!.msg, focusWindow, each);
            }
          }

          seen.moves += w.moves.length;
          expect(
            w.s.flight.filter((f) => !inboxParked(w.s, f)).map((f) => f.call),
            "L26: the world settles: every call but the inbox's own parked wait is answered",
          ).toEqual([]);
          expect(
            w.moves.filter((x) => x.letter === null || !w.took.includes(x.letter)).map((x) => x.to),
            "L26: every move the window drew reached tezgah as one letter, after any drop of the link",
          ).toEqual([]);
          expect(
            w.moves.map((x) => named.get(x.letter ?? "")),
            "L26: each move's letter names the tile the window drew",
          ).toEqual(w.moves.map((x) => x.to));
          expect(w.took, "L26: tezgah took each move once, in the order they were made").toEqual(
            w.moves.map((x) => x.letter),
          );
          expect(drawnHere(w.s)?.focus, "L26: once all is answered the window draws tezgah's focus").toBe(
            w.view.workspaces[0]!.focus,
          );
          expect(w.s.tezgah?.client.pendingMutations, "L26: nothing is left pending").toEqual([]);
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.moves, "the walks move focus").toBeGreaterThan(0);
    expect(seen.offline, "the walks press focus keys while the link is down").toBeGreaterThan(0);
    expect(seen.redial, "the walks drop the link and dial again").toBeGreaterThan(0);
  });
});

// P18 slice 2's fix round, next/: the tile guideline's live-region row is "Program ends, unfocused
// tile | Polite | `tracker in t2 ended`" (docs/direction/tile-guidelines.md, followed as written by
// 0543). Focus at the moment of the end is known only in the window's step, on its drawn workspace,
// so the machine holds the rule: an end is a status message only for a tile that is not the drawn
// focus then. The guideline has no row for the focused tile's own end, so nothing extra is said; the
// tile shows it in its state slot and body. The walk is L26's focus world, where a tile's name read
// finds, by the pick, a live process or one that started and ended.
describe("S9: an ended tile's end is said only when the tile has no focus", () => {
  it("S9 property: on each step, a tile whose process end it has not told before tells it as one status message when it is not the drawn focus, and as none when it is; it is told once either way, and no ended message is ever for the drawn focus", () => {
    const seen = { focused: 0, unfocused: 0, again: 0 };
    fc.assert(
      fc.property(
        fc.array(fc.record({ at: fc.nat(), down: fc.boolean() }), { minLength: 1, maxLength: 5 }),
        fc.nat(),
        arbMsgSequence(DeskPick, { minLength: 10, maxLength: 120, size: "max" }),
        (cuts, focus, picks) => {
          const [s0, cmds0] = focusWindow.init(null, { tiles: [], tab: TAB, tezgah: { workspace: 1 } } as never);
          const w: FocusWorld = {
            s: s0,
            waiting: [...cmds0],
            desk: { rev: 1, spaces: new Map(), shows: new Map(), next: 1 },
            shown: null,
            subscribed: false,
            up: true,
            view: focusDesk(cuts, focus),
            pos: 1,
            notices: [],
            moves: [],
            took: [],
            letters: 0,
          };
          const told = new Set<string>(); // `${tile} ${pid}`: each end the window has met
          const each = ({ prev, m, next }: DeskEvent) => {
            const here = drawnHere(next)?.focus ?? null;
            const appended = next.said.messages.slice(next.said.messages.length - (next.said.id - prev.said.id));

            for (const x of appended.filter((x) => x._tag === "ended")) {
              expect(x.tile, `S9: after ${m.type}, an end was said for the drawn focus`).not.toBe(here);
            }

            for (const t of next.tiles) {
              const before = prev.tiles.find((p) => p.id === t.id)?.reach;
              const r = t.reach;

              if (r._tag !== "ended" || (before?._tag === "ended" && before.pid === r.pid)) {
                continue;
              }

              const key = `${t.id} ${r.pid}`;
              const said = appended.filter((x) => x._tag === "ended" && x.tile === t.id).length;
              seen.again += told.has(key) ? 1 : 0;
              const want = told.has(key) || t.id === here ? 0 : 1;
              seen.focused += !told.has(key) && t.id === here ? 1 : 0;
              seen.unfocused += !told.has(key) && t.id !== here ? 1 : 0;
              expect(said, `S9: ${t.name}'s end after ${m.type}, ${t.id === here ? "focused" : "unfocused"}`).toBe(
                want,
              );
              told.add(key);
            }
          };
          goOnline(w, focusWindow, each);
          const dialed = new Set([1]);

          for (const c of picks) {
            if (w.s.link._tag === "dialing" && !dialed.has(w.s.link.dial)) {
              dialed.add(w.s.link.dial);
              goOnline(w, focusWindow, each, w.s.link.dial);
              continue;
            }

            const options = focusMoves(w, c, each, true);
            options[c.move % options.length]!();
          }
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.focused, "the walks end a focused tile's process").toBeGreaterThan(0);
    expect(seen.unfocused, "the walks end an unfocused tile's process").toBeGreaterThan(0);
    expect(seen.again, "the walks meet a told end again, after a redial").toBeGreaterThan(0);
  });
});

// Desk S4, next/: a smaller window folds what does not fit. The `fold` client row of the plan's "What
// it records" and law L32, walked on the S3 focus world. Written before a window folds. The shape
// these hold `WindowMachine.ts` and `transport/ClientRows.ts` to, from the plan (the build may add
// more):
// - Size belongs to the viewer (0277). A window's strips are `fold` of its drawn workspace (the
//   `optimisticState` of its tezgah child) at its last `size`: every tile but the drawn focus that the
//   frame draws under 220x120 there (`Layout.rects` with `GAP`, plan amendment 7). Before the page
//   says a size, nothing folds. The rule is written here from the plan's words, never read from the
//   product's `fold`; `tezgah/Fold.laws.test.ts` holds `fold` to the same rule.
// - "What it records": `fold {strips, width, height}` on change. On each step whose strips differ from
//   the step before (a new size, a view, a focus move), the window hands out one `record` Cmd of
//   `{_tag: "fold", strips, width, height}`: `strips` how many tiles it draws as strips now, and
//   `width` and `height` the size it folded at. A step that changes no strip writes no fold row. The
//   tiles folded are not written: the layout, the focus and the size rebuild them.
// - L32: a fold is never sent to tezgah and never stored. No key of the window's model, its tezgah
//   link, its tezgah child or tezgah's wire shapes names a fold or a strip; a `size` Msg changes the
//   model in its `size` alone and writes nothing to the brain; and every letter the window sends
//   tezgah carries only the keys of tezgah's `did`.
// A step where a drawn tile sits within half a pixel of the floor is left out of the fold row's
// check, so float rounding cannot decide it.
const FOLD_SMALLEST = { width: 220, height: 120 } as const;

const FOLD_ACROSS = { row: 22, column: 20 } as const;

const foldTiles = (node: Workspace["layout"]): ReadonlyArray<string> =>
  typeof node === "string" ? [node] : node.parts.flatMap((p) => foldTiles(p.inner));

type Extent = { readonly width: number; readonly height: number };

/** Each open tile's drawn size by plan amendment 13, written here from its words: a strip takes 22px
 *  along a row or 20px along a column, a container whose tiles all fold one strip's size, the open
 *  parts share what is left by percent, and the part on the focused path is held at
 *  `min(220 or 120, what the container has)`. */
const foldDrawn = (w: Workspace, size: Extent, strips: ReadonlySet<string>): ReadonlyMap<string, Extent> => {
  const out = new Map<string, Extent>();
  const walk = (node: Workspace["layout"], box: Extent): void => {
    if (typeof node === "string") {
      out.set(node, box);
      return;
    }

    const row = node.dir === "row";
    const left = (row ? box.width : box.height) - (node.parts.length - 1) * Layout.GAP;
    const fixed = node.parts.map((p) => foldTiles(p.inner).every((t) => strips.has(t)));
    const has = left - fixed.filter((f) => f).length * FOLD_ACROSS[node.dir];
    const total = node.parts.reduce((sum, p, i) => (fixed[i] ? sum : sum + p.percent), 0);
    const lead = node.parts.findIndex((p) => foldTiles(p.inner).includes(w.focus));
    let shares = node.parts.map((p, i) => (fixed[i] ? FOLD_ACROSS[node.dir] : (has * p.percent) / total));
    const least = Math.min(row ? FOLD_SMALLEST.width : FOLD_SMALLEST.height, has);

    if (lead >= 0 && shares[lead]! < least) {
      const rest = total - node.parts[lead]!.percent;
      shares = node.parts.map((p, i) =>
        i === lead ? least : fixed[i] ? FOLD_ACROSS[node.dir] : rest > 0 ? ((has - least) * p.percent) / rest : 0,
      );
    }

    for (const [i, p] of node.parts.entries()) {
      if (!fixed[i] || typeof p.inner === "string") {
        walk(p.inner, row ? { width: shares[i]!, height: box.height } : { width: box.width, height: shares[i]! });
      }
    }
  };
  walk(w.layout, size);
  return out;
};

/** The tiles a window draws as strips now, the fixpoint of plan amendment 13 on its drawn workspace
 *  at its size, in reading order; null when a round draws a tile within half a pixel of the floor. */
const stripsNow = (s: WindowModel): ReadonlyArray<string> | null => {
  const space = drawnHere(s);

  if (s.size === null || space === null) {
    return [];
  }

  let strips = new Set<string>();

  for (;;) {
    const open = [...foldDrawn(space, s.size, strips)].filter(([t]) => !strips.has(t) && t !== space.focus);

    if (
      open.some(
        ([, r]) => Math.abs(r.width - FOLD_SMALLEST.width) <= 0.5 || Math.abs(r.height - FOLD_SMALLEST.height) <= 0.5,
      )
    ) {
      return null;
    }

    const due = open.filter(([, r]) => r.width < FOLD_SMALLEST.width || r.height < FOLD_SMALLEST.height);

    if (due.length === 0) {
      return Layout.order(space.layout).filter((t) => strips.has(t));
    }

    strips = new Set([...strips, ...due.map(([t]) => t)]);
  }
};

/** The record and Msg fields a law reads by their schema: every object case of a union. */
const objectsIn = (ast: SchemaAST.AST): ReadonlyArray<SchemaAST.Objects> =>
  ast._tag === "Union" ? ast.types.flatMap(objectsIn) : ast._tag === "Objects" ? [ast] : [];

const fieldIn = (o: SchemaAST.Objects | undefined, name: string) =>
  o?.propertySignatures.find((p) => p.name === name)?.type;

/** The window Msg whose `type` is `t`, as the machine's own Msg schema says it. */
const msgCase = (t: string) =>
  objectsIn(focusWindow.msg.ast).find((o) => {
    const ty = fieldIn(o, "type");
    return ty?._tag === "Literal" && ty.literal === t;
  });

/** Every key in a value, at any depth. */
const keysIn = (v: unknown): ReadonlyArray<string> =>
  Array.isArray(v)
    ? v.flatMap(keysIn)
    : v !== null && typeof v === "object"
      ? Object.entries(v).flatMap(([k, x]) => [k, ...keysIn(x)])
      : [];

/** A key that would hold a fold: the one thing L32 forbids the model and the wire. */
type Folded = `${string}${"fold" | "Fold" | "strip" | "Strip"}${string}`;
const FOLDED = /fold|strip/i;

/** The keys of tezgah's `did`, the plan's "The shape": what a letter from a window may carry. */
const DID_KEYS = new Set(["type", "does", "from", "via", "tile", "to", "cursor"]);

/** One walk of the focus world, with sizes the page says among its moves. */
const foldWalk = (
  cuts: ReadonlyArray<{ readonly at: number; readonly down: boolean }>,
  focus: number,
  picks: ReadonlyArray<DeskPick>,
  check: (e: DeskEvent) => void,
) => {
  const view = focusDesk(cuts, focus);
  const [s0, cmds0] = focusWindow.init(null, { tiles: [], tab: TAB, tezgah: { workspace: 1 } } as never);
  const w: FocusWorld = {
    s: s0,
    waiting: [...cmds0],
    desk: { rev: 1, spaces: new Map(), shows: new Map(), next: 1 },
    shown: null,
    subscribed: false,
    up: true,
    view,
    pos: 1,
    notices: [],
    moves: [],
    took: [],
    letters: 0,
  };
  /** tezgah takes a move as the socket hands it over and sends its view while the window listens. */
  const each = (e: DeskEvent) => {
    for (const c of e.cmds.filter(isWrite)) {
      const to = Reflect.get(Object(c.call["m"]), "to");
      const space = w.view.workspaces[0]!;
      const letter = String(c.call["letter"]);

      if (
        c.call._tag === "send" &&
        c.call["pid"] === TEZGAH_PID &&
        typeof to === "string" &&
        !w.took.includes(letter) &&
        Layout.order(space.layout).includes(to as TileId)
      ) {
        w.took.push(letter);
        w.pos++;
        w.view = { ...w.view, workspaces: [Layout.focus(space, to as TileId)] };

        if (w.subscribed) {
          w.notices.push({ rev: w.pos, view: w.view });
        }
      }
    }

    check(e);
  };
  goOnline(w, focusWindow, each);
  const dialed = new Set([1]);

  for (const c of picks) {
    if (w.s.link._tag === "dialing" && !dialed.has(w.s.link.dial)) {
      dialed.add(w.s.link.dial);
      goOnline(w, focusWindow, each, w.s.link.dial);
      continue;
    }

    // The page says a size: often a small one, where tiles fold, sometimes the same one again.
    const small = c.pick % 2 === 0;
    const size = {
      width: small ? 320 + ((c.ms * 13) % 700) : 320 + ((c.ms * 13) % 2_241),
      height: small ? 240 + ((c.pick * 7) % 400) : 240 + ((c.pick * 7) % 1_361),
    };
    const options = [
      ...focusMoves(w, c, each),
      () => deskStep(w, { type: "size", ...size } as WindowMsg, focusWindow, each),
      () => deskStep(w, { type: "size", ...size } as WindowMsg, focusWindow, each),
      () => deskStep(w, { type: "size", ...(w.s.size ?? size) } as WindowMsg, focusWindow, each),
    ];
    options[c.move % options.length]!();
  }

  return w;
};

const FoldCuts = fc.array(fc.record({ at: fc.nat(), down: fc.boolean() }), { minLength: 1, maxLength: 6 });

describe("Desk S4: a window folds at its own size, records each change of its folds, and keeps no fold", () => {
  it("fold row: on each step that changes which tiles the window draws as strips, by a size, a view or a focus move, one record fold {strips, width, height}, its count and the size it folded at; a step that changes none writes no fold row; and a pixel size is typed by its own schema, never the duration's", () => {
    // Plan amendment 13, point 7 (0212: one meaning, one way): the fold row's and the size Msg's width
    // and height are pixels, never `Ms`. A law can say only that they are not the very schema a
    // duration field uses; that they are pixels by name is typecheck's and review's to read.
    const fold = ClientRecord.cases.fold.fields;
    expect(fold.width.ast, "the fold row's width is not the duration schema").not.toBe(
      ClientRecord.cases.reply.fields.ms.ast,
    );
    expect(fold.height.ast, "the fold row's height is not the duration schema").not.toBe(
      ClientRecord.cases.reply.fields.ms.ast,
    );
    expect(msgCase("size"), "the window takes a size Msg").toBeDefined();
    expect(fieldIn(msgCase("size"), "width"), "the size Msg's width is not the duration schema").not.toBe(
      fieldIn(msgCase("socket_opened"), "at"),
    );
    expect(fieldIn(msgCase("size"), "height"), "the size Msg's height is not the duration schema").not.toBe(
      fieldIn(msgCase("socket_opened"), "at"),
    );
    const seen = { rows: 0, bySize: 0, byOther: 0, quiet: 0 };
    fc.assert(
      fc.property(
        FoldCuts,
        fc.nat(),
        arbMsgSequence(DeskPick, { minLength: 10, maxLength: 120, size: "max" }),
        (cuts, focus, picks) => {
          foldWalk(cuts, focus, picks, ({ prev, m, next, cmds }) => {
            const before = stripsNow(prev);
            const after = stripsNow(next);
            const rows = cmds.flatMap((c) => {
              const r = recordIn(c);
              return r?._tag === "fold" ? [r] : [];
            });

            if (before === null || after === null) {
              return;
            }

            const changed = JSON.stringify([...before].sort()) !== JSON.stringify([...after].sort());
            expect(
              rows,
              changed
                ? `fold row: after ${m.type} the strips went from ${before.length} to ${after.length}, one fold row`
                : `fold row: after ${m.type} no strip changed, no fold row`,
            ).toEqual(
              changed
                ? [{ _tag: "fold", strips: after.length, width: next.size!.width, height: next.size!.height }]
                : [],
            );
            seen.rows += rows.length;
            seen.bySize += changed && m.type === "size" ? 1 : 0;
            seen.byOther += changed && m.type !== "size" ? 1 : 0;
            seen.quiet += !changed && m.type === "size" ? 1 : 0;
          });
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.bySize, "fold row: the walks fold and unfold by a new size").toBeGreaterThan(0);
    expect(seen.byOther, "fold row: the walks fold and unfold by a view or a focus move").toBeGreaterThan(0);
    expect(seen.quiet, "fold row: the walks say sizes that change no strip").toBeGreaterThan(0);
  });

  it("L32: a fold is never stored in the window's model nor sent to tezgah: no model or wire key names one, a size Msg changes only the model's size and writes nothing, and every letter to tezgah carries only did's keys", () => {
    // L32's type half is checked by `tsc` over this file (CI's typecheck job, 0133): a key that names a
    // fold or a strip on the window's model, its tezgah link, its tezgah child or tezgah's wire shapes
    // fails typecheck. The walk checks the same at run time, on every state.
    expectTypeOf<Extract<keyof WindowModel, Folded>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof NonNullable<WindowModel["tezgah"]>, Folded>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof TezgahClient, Folded>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof TezgahView, Folded>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof Workspace, Folded>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof Tile, Folded>>().toEqualTypeOf<never>();
    const seen = { sizes: 0, folded: 0, letters: 0 };
    fc.assert(
      fc.property(
        FoldCuts,
        fc.nat(),
        arbMsgSequence(DeskPick, { minLength: 10, maxLength: 120, size: "max" }),
        (cuts, focus, picks) => {
          foldWalk(cuts, focus, picks, ({ prev, m, next, cmds }) => {
            expect(
              keysIn(next).filter((k) => FOLDED.test(k)),
              `L32: after ${m.type} the window's model holds no fold`,
            ).toEqual([]);

            if (m.type === "size") {
              seen.sizes++;
              seen.folded += (stripsNow(next) ?? []).length > 0 ? 1 : 0;
              expect({ ...next, size: null }, "L32: a size Msg changes the model in its size alone").toEqual({
                ...prev,
                size: null,
              });
              expect(
                cmds.filter(isWrite).map((c) => c.call._tag),
                "L32: a size Msg writes nothing to the brain",
              ).toEqual([]);
            }

            for (const c of cmds
              .filter(isWrite)
              .filter((c) => c.call._tag === "send" && c.call["pid"] === TEZGAH_PID)) {
              seen.letters++;
              expect(
                Object.keys(Object(c.call["m"])).filter((k) => !DID_KEYS.has(k)),
                "L32: a letter to tezgah carries only did's keys",
              ).toEqual([]);
              expect(
                keysIn(c.call["m"]).filter((k) => FOLDED.test(k)),
                "L32: a letter to tezgah names no fold",
              ).toEqual([]);
            }
          });
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.sizes, "L32: the walks say sizes").toBeGreaterThan(0);
    expect(seen.folded, "L32: the walks say sizes at which tiles fold").toBeGreaterThan(0);
    expect(seen.letters, "L32: the walks send tezgah letters").toBeGreaterThan(0);
  });
});
