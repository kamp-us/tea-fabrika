// Desk S2a, next/ (the desk program fabrika/tezgah, ticket named by its title): law L11 of the
// approved plan, tezgah's view through the window's own tezgah child. Written before
// `client/Tezgah.ts` and `tezgah/Workspace.ts` exist. The program's half of L11 (every view tezgah
// steps decodes as a client reads it, `child` and all) is in `next/programs/tezgah/src/program.laws.test.ts`.
//
// The shape this law holds the build to, from the plan (the build may add more):
// - `tezgah/Workspace.ts` exports the Effect Schema `TezgahView`: {workspaces: [{id, n, layout,
//   focus, recent}], tiles: [{id, n, shows, program, child, keep, cursor}]}.
// - `client/Tezgah.ts` is the window's side of 0167: one tea machine, `tezgahMachine`, whose Model
//   is `TezgahClient` {workspace, serverState, rev, pendingMutations}. `init(null, {workspace})` has
//   no server state yet, at rev 0, with no pending mutation. Its Msg `server {rev, view}` carries a
//   view as the wire carries it, JSON; a view that decodes as `TezgahView` becomes the server state,
//   one that does not changes nothing. `optimisticState(model)` is derived from the server state
//   and the pending mutations, never stored: with none pending it is the server state.
import { applyCell } from "@demlik/tea";
import { arbMsgSequence } from "@demlik/tea/pbt";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as fc from "fast-check";
import { diff } from "../runtime/Patch.ts";
import type { Binding } from "../runtime/Program.ts";
import * as Layout from "../tezgah/Layout.ts";
import { type Tile, type TileId, TezgahView, Workspace } from "../tezgah/Workspace.ts";
import * as Keys from "./Keys.ts";
import { optimisticState, type PendingMutation, type TezgahClient, type TezgahMsg, tezgahMachine } from "./Tezgah.ts";
import {
  type Handling,
  handle,
  type KeyPress,
  lastCursor,
  type Unread,
  type WindowModel,
  type WindowMsg,
  windowMachineFor,
} from "./WindowMachine.ts";

const SEED = 119120;

/** JSON text, the only form a view takes on the wire. */
const Json = Schema.fromJsonString(Schema.Unknown);

/** A tile's fields as every client reads them off the wire: none may be left out. */
const FIELDS = ["id", "n", "shows", "program", "child", "keep", "cursor"] as const;

const step = (m: TezgahClient, msg: TezgahMsg) => applyCell(tezgahMachine, m, msg)[0];

describe("Desk S2a L11: tezgah's view in the window", () => {
  it.prop(
    "L11: tezgah's view round-trips through TezgahView in the window: the encoded wire keeps every tile's fields, child included, and the window's server state is the view",
    {
      view: Arbitrary.schema(TezgahView),
      rev: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 }))),
    },
    ({ view, rev }) => {
      const wire: unknown = Schema.decodeSync(Json)(Schema.encodeSync(Json)(Schema.encodeSync(TezgahView)(view)));
      // The view as JSON carries it: JSON has no `-0`, which a schema's Arbitrary may make.
      const same = Schema.decodeUnknownSync(TezgahView)(wire);
      expect(JSON.stringify(Schema.encodeSync(TezgahView)(same)), "L11: the wire view decodes to the view it was").toBe(
        JSON.stringify(wire),
      );
      // SAFETY: `wire` is the JSON of an encoded TezgahView, an object whose `tiles` is an array of tile objects.
      const tiles = (wire as { readonly tiles: ReadonlyArray<Record<string, unknown>> }).tiles;
      expect(tiles, "L11: one wire tile per tile").toHaveLength(view.tiles.length);

      for (const [i, tile] of tiles.entries()) {
        expect(Object.keys(tile).sort(), "L11: the wire tile keeps every field").toEqual(
          expect.arrayContaining([...FIELDS].sort()),
        );
        expect(tile["child"], "L11: the wire says whether tezgah started the tile").toBe(view.tiles[i]?.child);
        expect(Predicate.isBoolean(tile["child"]), "L11: child is a boolean on the wire").toBe(true);
      }

      const [fresh] = tezgahMachine.init(null, { workspace: 1 });
      expect(fresh, "L11: a window's tezgah child starts with no server state").toMatchObject({
        workspace: 1,
        serverState: null,
        rev: 0,
        pendingMutations: [],
      });
      const after = step(fresh, { type: "server", rev, view: wire });
      expect(after.serverState, "L11: the window's server state is tezgah's view").toEqual(same);
      expect(optimisticState(after), "L11: with nothing pending, the drawn state is the server's").toEqual(same);

      // A wire view that drops `child` from a tile is not tezgah's view: the window keeps what it had.
      if (tiles.length > 0) {
        // SAFETY: `wire` is the JSON of an encoded TezgahView, so it is an object.
        const dropped = { ...(wire as object), tiles: tiles.map(({ child: _child, ...rest }) => rest) };
        const kept = step(after, { type: "server", rev: rev + 1, view: dropped });
        expect(kept.serverState, "L11: a view without child changes nothing").toEqual(same);
      }
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// Desk S2a, first review: a view patch in the window's tezgah child, as a program client takes one
// (`runtime/Client.ts`). A patch whose base is the shown revision and whose revision is one past it
// moves the server state to the patched view; any other patch past the shown revision keeps the
// shown view and asks for a whole one (one `ask` Cmd); a patch at or before the shown revision is
// old and changes nothing, asking for nothing. The walk folds the real machine from its real init:
// each step reads the revision it reached and makes a patch of one of those three kinds, or a whole
// view, from generated views and the real `diff`.
const Kind = Schema.Literals(["next", "next", "gap_base", "gap_rev", "old", "whole"]);

const PatchStep = Schema.Struct({
  kind: Kind,
  skew: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 })),
  to: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000 })),
});

const both = (m: TezgahClient, msg: TezgahMsg) => applyCell(tezgahMachine, m, msg);

/** The two view Msgs the L11 walk sends: a whole view or a patch, each with its `rev`. */
type ViewMsg = Extract<TezgahMsg, { readonly type: "server" | "patch" }>;

/** A view as the wire carries it, JSON. */
const onWire = (view: TezgahView): Schema.Json =>
  Schema.decodeSync(Schema.fromJsonString(Schema.Json))(Schema.encodeSync(Json)(Schema.encodeSync(TezgahView)(view)));

const text = (state: TezgahView | null) =>
  state === null ? "null" : Schema.encodeSync(Json)(Schema.encodeSync(TezgahView)(state));

describe("Desk S2a L11: a tezgah view patch in the window", () => {
  it.prop(
    "L11: a patch from the shown rev to one past it applies, a gap asks for a whole view and keeps the shown one, an old rev changes nothing",
    {
      // One view from the schema; the walk's other views are cut from it (tiles and workspaces dropped,
      // reordered, or none), since two independent draws of tezgah's view exhaust fast-check's discards.
      first: Arbitrary.schema(TezgahView),
      steps: Arbitrary.array(Arbitrary.schema(PatchStep), { minLength: 4, maxLength: 16 }),
      start: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 6, maximum: 1_000_000 }))),
    },
    ({ first, steps, start }) => {
      const wires = [
        first,
        { workspaces: first.workspaces.slice(1), tiles: first.tiles.slice(1) },
        { workspaces: [...first.workspaces].reverse(), tiles: [...first.tiles].reverse() },
        { workspaces: [], tiles: [] },
      ].map(onWire);

      const [fresh] = tezgahMachine.init(null, { workspace: 1 });
      let [m] = both(fresh, { type: "server", rev: start, view: wires[0] });
      let shown = wires[0];
      expect(text(m.serverState), "L11: the first whole view is shown").toBe(
        text(Schema.decodeUnknownSync(TezgahView)(shown)),
      );
      const seen = { applied: 0, asked: 0, old: 0 };

      // Each walk takes every kind once first, so each is walked; then the generated steps.
      const walk = [
        { kind: "next" as const, skew: 1, to: 1 },
        { kind: "gap_base" as const, skew: 1, to: 0 },
        { kind: "gap_rev" as const, skew: 2, to: 0 },
        { kind: "old" as const, skew: 1, to: 0 },
        ...steps,
      ];

      for (const { kind, skew, to } of walk) {
        const target = wires[to % wires.length];
        const rev = m.rev;

        const msg = Match.value(kind).pipe(
          Match.when("whole", (): ViewMsg => ({ type: "server", rev: rev + skew, view: target })),
          Match.when("next", (): ViewMsg => ({ type: "patch", base: rev, rev: rev + 1, patch: diff(shown, target) })),
          Match.when("gap_base", (): ViewMsg => ({
            type: "patch",
            base: rev - skew,
            rev: rev + 1,
            patch: diff(shown, target),
          })),
          Match.when("gap_rev", (): ViewMsg => ({
            type: "patch",
            base: rev,
            rev: rev + 1 + skew,
            patch: diff(shown, target),
          })),
          Match.orElse((): ViewMsg => ({
            type: "patch",
            base: rev - skew - 1,
            rev: rev - skew + 1,
            patch: diff(shown, target),
          })),
        );

        const [next, cmds] = both(m, msg);
        const asks = cmds.filter((c) => c.type === "ask").length;

        if (kind === "next" || kind === "whole") {
          seen.applied++;
          expect(text(next.serverState), `L11: ${kind} shows the new view`).toBe(
            text(Schema.decodeUnknownSync(TezgahView)(target)),
          );
          expect(next.rev, `L11: ${kind} moves the shown rev`).toBe(msg.rev);
          expect(asks, `L11: ${kind} asks for nothing`).toBe(0);
          shown = target;
        } else {
          seen[kind === "old" ? "old" : "asked"]++;
          expect(text(next.serverState), `L11: ${kind} keeps the shown view`).toBe(text(m.serverState));
          expect(next.rev, `L11: ${kind} keeps the shown rev`).toBe(rev);
          expect(
            asks,
            kind === "old" ? "L11: an old patch asks for nothing" : `L11: ${kind} asks for a whole view`,
          ).toBe(kind === "old" ? 0 : 1);
        }

        m = next;
      }

      expect(seen.applied + seen.asked + seen.old, "L11: every step was one of the three").toBe(walk.length);
      expect(Math.min(seen.applied, seen.asked, seen.old), "L11: the walk applied, asked and ignored").toBeGreaterThan(
        0,
      );
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// Desk S3, next/: laws L23, L24, L25 and L29 of the approved plan, the window's optimistic focus
// (0167), on the real window parent (`windowMachineFor`) and its real tezgah child. Written before a
// window moves focus. The shape these laws hold `WindowMachine.ts`, `Tezgah.ts` and `ClientRows.ts`
// to, from the plan's "The shape" and "The lead's lean" (the build may add more):
// - The window's key table holds tezgah's focus rows (`commands.ts`; the library may not import a
//   program, so the laws hand the window the same rows): `tezgah.focus_next` on `<prefix>o` and
//   `f6`, `focus_previous` on `shift+f6`, `focus_last` on `<prefix>;`, `focus_left` ... `_down` on
//   `<prefix>h l k j` and the arrows after the prefix.
// - A focus key is resolved on the window's own drawn state, `optimisticState` of its tezgah child:
//   `from` is the drawn workspace's focus; next and previous follow reading order and wrap; last is
//   the drawn `recent[1]`; a direction is `Layout.neighbor(drawn layout, from, side)`. A move whose
//   target is none, or `from` itself, changes nothing and sends nothing.
// - Any other move is drawn on the same step that reads its key, as one entry in the tezgah child's
//   `pendingMutations` (never a stored focus, L23), and goes out on the press path to tezgah's pid
//   as one letter `{type: "did", does, from, to, via, cursor}`, `to` absolute (the lead's lean).
// - The window takes one more Msg from the page, `{type: "focus", tile, cursor}`: DOM focus is now in
//   tile `tile`, on an element whose `data-cursor` key is `cursor` (null for none). On the drawn
//   focus it is only noted; on another tile of the drawn workspace it is a move there, `does:
//   "tezgah.focus"`, `via: {_tag: "click"}`. A move's `cursor` is the last one the page said for
//   `from`, null when it said none.
// - A pending mutation is matched by its letter id. It is dropped once its reply has come and a view
//   at or past the reply's inbox position (`accepted.pos`, the number a view's `rev` counts) has
//   arrived, in either order. An offline window keeps its pending mutations.
// - Each drop writes one client row `record {focus {letter, result, ms}}`: `kept` when the server's
//   focus is the move's `to`, `overridden` when the drawn focus jumped back on that drop (the lead's
//   lean: a jump back is recorded, never announced).
// - Plan amendment 9, point 5: a refused move is dropped when its refusal arrives, since tezgah's
//   state did not change, and writes `focus {letter, result: "overridden"}`.
// - Plan amendment 9, point 3: a split's letter also carries the cursor the page last said for the
//   tile it leaves, as `cursor` beside `from`.
//
// The walk: two windows of one person, each online through the real hello exchange with tezgah's
// view and every tile open, then each step picks one move possible in the state the walk folded: a
// focus key or a click in either window, an answer to a `now` Cmd really waiting, a written letter
// arriving at the fake tezgah, a reply or a view notice tezgah sent reaching its window. The fake
// tezgah applies a move as the program does (L27: in arrival order), answers `accepted {rev, pos}`
// (a ledger revision unlike the inbox position, as the brain's are), and sends its whole view to
// every window that opened it. Records and writes are answered as soon as they are handed out.
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const TEZGAH_PID = "process_of_tezgah";

const ADMITTED = { version: 1, ping: 5_000, identity: { key: "SHA256:k", person: PERSON, as: "window" } };

const rpc = (body: object) => JSON.stringify({ jsonrpc: "2.0", ...body });

const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** How far a reply's ledger revision runs ahead of its inbox position: the ledger holds more. */
const LEDGER = 1_000;

const typeId = (prefix: string, n: number): string => {
  let uuid = (BigInt(n) << 80n) | (7n << 76n) | (2n << 62n);
  let suffix = "";

  for (let i = 0; i < 26; i++) {
    suffix = ID_ALPHABET[Number(uuid & 31n)] + suffix;
    uuid >>= 5n;
  }

  return `${prefix}_${suffix}`;
};

/** tezgah's default rows as `next/programs/tezgah/src/commands.ts` ships them after S3. */
const ROWS: ReadonlyArray<Binding> = [
  { does: "tezgah.split_right", keys: ["<prefix>%", "<prefix>|"], word: "split right", label: "Split right" },
  { does: "tezgah.split_down", keys: ['<prefix>"', "<prefix>-"], word: "split down", label: "Split down" },
  { does: "tezgah.close", keys: ["<prefix>x"], word: "close", label: "Close tile" },
  { does: "tezgah.focus_next", keys: ["<prefix>o", "f6"], word: "focus next", label: "Focus next tile" },
  { does: "tezgah.focus_previous", keys: ["shift+f6"], word: "focus previous", label: "Focus previous tile" },
  { does: "tezgah.focus_last", keys: ["<prefix>;"], word: "focus last", label: "Focus last tile" },
  { does: "tezgah.focus_left", keys: ["<prefix>h", "<prefix>arrowleft"], word: "focus left", label: "Focus left" },
  { does: "tezgah.focus_right", keys: ["<prefix>l", "<prefix>arrowright"], word: "focus right", label: "Focus right" },
  { does: "tezgah.focus_up", keys: ["<prefix>k", "<prefix>arrowup"], word: "focus up", label: "Focus up" },
  { does: "tezgah.focus_down", keys: ["<prefix>j", "<prefix>arrowdown"], word: "focus down", label: "Focus down" },
];

// A Mac's browser keeps F6 for the page, so F6 and Shift-F6 are walked too (Chrome keeps F6 only on
// Windows and Linux, the S2b backend rule).
const BACKEND = Keys.backend("browser", "macos");

const loadedTable = Keys.load(Keys.ship(ROWS, BACKEND), BACKEND);

const TABLE = Result.isSuccess(loadedTable) ? loadedTable.success : null;

const focusWindow = windowMachineFor({
  decode: () => Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown)),
  tile: () => undefined,
  keys: TABLE!,
});

type Side = "left" | "right" | "up" | "down";

/** Each focus key as a person presses it, and what it asks for. */
const FOCUS_KEYS: ReadonlyArray<{
  readonly keys: ReadonlyArray<string>;
  readonly does: string;
  readonly to: "next" | "previous" | "last" | Side;
}> = [
  { keys: ["ctrl+b", "o"], does: "tezgah.focus_next", to: "next" },
  { keys: ["f6"], does: "tezgah.focus_next", to: "next" },
  { keys: ["shift+f6"], does: "tezgah.focus_previous", to: "previous" },
  { keys: ["ctrl+b", ";"], does: "tezgah.focus_last", to: "last" },
  { keys: ["ctrl+b", "h"], does: "tezgah.focus_left", to: "left" },
  { keys: ["ctrl+b", "arrowleft"], does: "tezgah.focus_left", to: "left" },
  { keys: ["ctrl+b", "l"], does: "tezgah.focus_right", to: "right" },
  { keys: ["ctrl+b", "arrowright"], does: "tezgah.focus_right", to: "right" },
  { keys: ["ctrl+b", "k"], does: "tezgah.focus_up", to: "up" },
  { keys: ["ctrl+b", "arrowup"], does: "tezgah.focus_up", to: "up" },
  { keys: ["ctrl+b", "j"], does: "tezgah.focus_down", to: "down" },
  { keys: ["ctrl+b", "arrowdown"], does: "tezgah.focus_down", to: "down" },
];

type Cmd = { readonly type: string; readonly [key: string]: unknown };

type Call = { readonly _tag: string; readonly [key: string]: unknown };

/** One move a window drew: where from and to, its command, the cursor the page last said in `from`
 *  when it was made, and its letter once written. */
type Move = {
  readonly from: string;
  readonly to: string;
  readonly does: string;
  readonly cursor: string | null;
  letter: string | null;
};

type Did = { readonly type: string; readonly does: string; readonly from: string; readonly to?: string };

/** One window: its model, the Cmds it handed out not answered yet, and what reached it or left it. */
type Win = {
  s: WindowModel;
  waiting: Array<Cmd>;
  answered: Set<string>;
  subscribed: boolean;
  /** Letters it wrote to tezgah that have not arrived yet, in order. */
  outbox: Array<{ readonly id: number; readonly dial: number; readonly letter: string; readonly m: unknown }>;
  replies: Array<{ readonly id: number; readonly dial: number; readonly pos: number }>;
  notices: Array<{ readonly rev: number; readonly view: TezgahView }>;
  /** The highest view revision it took, and each letter's reply position once the reply reached it. */
  seen: number;
  got: Map<string, number>;
  /** Letters whose refusal reached it. */
  refused: Set<string>;
  /** Every move it drew, in order, with its letter once written. */
  moves: Array<Move>;
  /** The cursor the page last said for each tile. */
  cursors: Map<string, string | null>;
};

type World = { pos: number; view: TezgahView; wins: Array<Win>; letters: number };

// SAFETY: with a tile TypeID, a process name in `shows`, a Keep of `failed` and
// a null cursor, the row holds every field the Tile schema has.
const tileRow = (id: string, n: number): Tile =>
  ({
    // SAFETY: every caller passes an id that `typeId("tile", n)` spelled, a canonical tile TypeID.
    id: id as TileId,
    n,
    shows: n === 1 ? "checklist:1" : `checklist:t${n}`,
    program: "fabrika/checklist",
    child: n > 1,
    keep: "failed",
    cursor: null,
  }) as Tile;

/** A workspace of 1 + cuts tiles, split by `cuts`, focus on the tile `focus` picks. */
const makeDesk = (cuts: ReadonlyArray<{ readonly at: number; readonly down: boolean }>, focus: number): TezgahView => {
  // SAFETY: `typeId` spells a canonical TypeID with the `tile` prefix, which is what TileId decodes.
  const first = typeId("tile", 1) as TileId;

  let w: Workspace = Schema.decodeSync(Workspace)({
    id: typeId("workspace", 1),
    n: 1,
    layout: first,
    focus: first,
    recent: [first],
  });

  const tiles: Array<Tile> = [tileRow(first, 1)];

  for (const [k, cut] of cuts.entries()) {
    const at = Layout.order(w.layout)[cut.at % Layout.order(w.layout).length]!;
    // SAFETY: `typeId` spells a canonical TypeID with the `tile` prefix, which is what TileId decodes.
    const id = typeId("tile", k + 2) as TileId;
    w = Layout.split(w, at, cut.down ? "column" : "row", id);
    tiles.push(tileRow(id, k + 2));
  }

  const on = Layout.order(w.layout)[focus % Layout.order(w.layout).length]!;

  return { workspaces: [{ ...w, focus: on, recent: [on, ...w.recent.filter((t) => t !== on)] }], tiles };
};

/** The workspace a window draws: workspace 1 of its tezgah child's `optimisticState`. */
const drawnSpace = (s: WindowModel) => {
  const client = s.tezgah?.client;
  const view = client === undefined ? null : optimisticState(client);

  return view?.workspaces.find((w) => w.n === client?.workspace) ?? null;
};

const drawnFocus = (s: WindowModel) => drawnSpace(s)?.focus ?? null;

const serverFocus = (s: WindowModel) =>
  s.tezgah?.client.serverState?.workspaces.find((w) => w.n === s.tezgah?.client.workspace)?.focus ?? null;

/** A pending move's letter, wherever its state keeps it (plan amendment 10: `waiting {n}`, `sent
 *  {letter}`, `answered {letter, pos, ms}`), or null while it waits for one. */
const letterIn = (p: object): string | null => {
  const own: unknown = Reflect.get(p, "letter");

  if (Predicate.isString(own)) {
    return own;
  }

  for (const v of Object.values(p)) {
    const inner: unknown = Predicate.isObjectOrArray(v) ? Reflect.get(v, "letter") : undefined;

    if (Predicate.isString(inner)) {
      return inner;
    }
  }

  return null;
};

const waitingMoves = (s: WindowModel): ReadonlyArray<typeof PendingMutation.Type> =>
  s.tezgah?.client.pendingMutations ?? [];

/** Where a focus key goes on the drawn workspace, by the plan's words; null when nowhere new. */
const target = (s: WindowModel, to: (typeof FOCUS_KEYS)[number]["to"]): string | null => {
  const space = drawnSpace(s);

  if (space === null) {
    return null;
  }

  const tiles = Layout.order(space.layout);
  const i = tiles.indexOf(space.focus);

  const found = Match.value(to).pipe(
    Match.when("next", () => tiles[(i + 1) % tiles.length]),
    Match.when("previous", () => tiles[(i - 1 + tiles.length) % tiles.length]),
    Match.when("last", () => space.recent[1]),
    Match.orElse((side) => Layout.neighbor(space.layout, space.focus, side) ?? undefined),
  );

  return found === undefined || found === space.focus ? null : found;
};

type Event = {
  readonly win: number;
  readonly m: WindowMsg;
  readonly prev: WindowModel;
  readonly next: WindowModel;
  readonly cmds: ReadonlyArray<Cmd>;
  readonly world: World;
};

/** Steps window `i`, keeps what it handed out, and hands every letter it wrote to tezgah's outbox. */
const stepWin = (world: World, i: number, m: WindowMsg, each: (e: Event) => void) => {
  const w = world.wins[i]!;
  const prev = w.s;
  // SAFETY: `focusWindow` is a window machine, whose model is WindowModel and whose Cmds each have a `type`.
  const [next, cmds] = applyCell(focusWindow, prev, m) as readonly [WindowModel, ReadonlyArray<Cmd>];
  w.waiting = [...w.waiting.filter((c) => !("cmd" in m) || m.cmd !== c), ...cmds];
  w.s = next;

  for (const c of cmds) {
    // SAFETY: only a write Cmd has a `call`, a tagged Call (WindowMachine.ts), and other Cmds have none.
    const call = c["call"] as Call | undefined;

    if (c.type === "write" && call?._tag === "send" && call["pid"] === TEZGAH_PID) {
      // SAFETY: a send's `m` is the letter's Msg; every field read off it is checked below, `type === "did"` first.
      const did = call["m"] as Did;
      const letter = String(call["letter"]);

      if (
        did?.type === "did" &&
        did.does.startsWith("tezgah.focus") &&
        !w.outbox.some((o) => o.letter === letter) &&
        !w.got.has(letter)
      ) {
        const move = w.moves.find((x) => x.letter === null);

        if (move !== undefined && !w.moves.some((x) => x.letter === letter)) {
          move.letter = letter;
        }
      }

      w.outbox.push({ id: Number(c["id"]), dial: Number(c["dial"]), letter, m: call["m"] });
    }
  }

  if (m.type === "view" && Reflect.get(Object(m.note), "type") === "whole") {
    w.seen = Math.max(w.seen, Number(Reflect.get(Object(m.note), "rev")));
  }

  each({ win: i, m, prev, next, cmds, world });
};

/** Answers every record, write, ping and persist Cmd window `i` handed out: they change no focus. */
const housekeep = (world: World, i: number, each: (e: Event) => void) => {
  for (let guard = 0; guard < 200; guard++) {
    const w = world.wins[i]!;
    const cmd = w.waiting.find((c) => ["record", "write", "ping", "persist"].includes(c.type));

    if (cmd === undefined) {
      return;
    }

    // SAFETY: `cmd` is a waiting record, write, ping or persist Cmd, and each has a
    // `<type>_ok` Msg of `cmd` and `value`: a boolean for persist, null for the rest.
    stepWin(world, i, { type: `${cmd.type}_ok`, cmd, value: cmd.type === "persist" ? true : null } as WindowMsg, each);
  }
};

/** tezgah takes the next letter window `i` wrote: a focus move whose `to` is on workspace 1 focuses
 *  it, keeps the cursor on `from`, answers accepted and sends its view to every window that opened it. */
const arrive = (world: World, i: number) => {
  const w = world.wins[i]!;
  const letter = w.outbox.shift();

  if (letter === undefined) {
    return;
  }

  // SAFETY: a letter's `m` is the Msg it carried; the check below reads `type === "did"` before any other field.
  const did = letter.m as Did & { readonly cursor?: string | null };
  const space = world.view.workspaces[0]!;
  const tiles = Layout.order(space.layout);

  if (
    did?.type !== "did" ||
    did.to === undefined ||
    // SAFETY: `includes` only looks the value up: a string that is not a tile of the layout is not found.
    !tiles.includes(did.to as TileId) ||
    // SAFETY: `includes` only looks the value up: a string that is not a tile of the layout is not found.
    !tiles.includes(did.from as TileId)
  ) {
    w.replies.push({ id: letter.id, dial: letter.dial, pos: -1 });

    return;
  }

  world.pos++;
  // SAFETY: the check above found `did.to` in the layout's tile order, so it is one of its TileIds.
  const to = did.to as TileId;
  world.view = {
    workspaces: [{ ...space, focus: to, recent: [to, ...space.recent.filter((t) => t !== to)] }],
    tiles: world.view.tiles.map((t) =>
      t.id === did.from && did.cursor !== undefined ? { ...t, cursor: did.cursor } : t,
    ),
  };
  w.replies.push({ id: letter.id, dial: letter.dial, pos: world.pos });

  for (const win of world.wins) {
    if (win.subscribed) {
      win.notices.push({ rev: world.pos, view: world.view });
    }
  }
};

/** tezgah refuses the next letter window `i` wrote, as it refuses a move whose tile another window
 *  closed: its state does not change, and only the refusal goes back. */
const reject = (world: World, i: number) => {
  const w = world.wins[i]!;
  const letter = w.outbox.shift();

  if (letter !== undefined) {
    w.replies.push({ id: letter.id, dial: letter.dial, pos: -1 });
  }
};

/** Window `i` takes the next reply tezgah sent it. */
const reply = (world: World, i: number, each: (e: Event) => void) => {
  const w = world.wins[i]!;
  const r = w.replies.shift();

  if (r === undefined) {
    return;
  }

  const flight = w.s.flight.find((f) => f.id === r.id && f.dial === r.dial && f.call._tag === "send");
  const letter = flight?.call._tag === "send" ? flight.call.letter : null;

  if (letter !== null && r.pos >= 0) {
    w.got.set(letter, r.pos);
  }

  if (letter !== null && r.pos < 0) {
    w.refused.add(letter);
  }

  stepWin(
    world,
    i,
    // SAFETY: send_ok is its write's id and dial, a Sent (refused with a reason, or accepted with rev and pos) and ms.
    {
      type: "send_ok",
      id: r.id,
      dial: r.dial,
      value: r.pos < 0 ? { _tag: "refused", reason: "missing" } : { _tag: "accepted", rev: r.pos + LEDGER, pos: r.pos },
      ms: 3,
    } as WindowMsg,
    each,
  );
  housekeep(world, i, each);
};

const notice = (world: World, i: number, each: (e: Event) => void) => {
  const w = world.wins[i]!;
  const n = w.notices.shift();

  if (n === undefined) {
    return;
  }

  stepWin(
    world,
    i,
    // SAFETY: the view case is `{type, pid, note}` with any note, and this note is tezgah's whole view.
    { type: "view", pid: TEZGAH_PID, note: { pid: TEZGAH_PID, type: "whole", rev: n.rev, view: n.view } } as WindowMsg,
    each,
  );
  housekeep(world, i, each);
};

/** Window `i` takes its oldest `now` Cmd's answer: its letter id and clock. */
const date = (world: World, i: number, each: (e: Event) => void) => {
  const w = world.wins[i]!;
  const cmd = w.waiting.find((c) => c.type === "now");

  if (cmd === undefined) {
    return;
  }

  stepWin(
    world,
    i,
    // SAFETY: `cmd` is a waiting now Cmd, and `{letter, sentAt}` is the now Cmd's ok value.
    {
      type: "now_ok",
      cmd,
      value: { letter: `letter_${++world.letters}`, sentAt: "2026-11-14T00:00:00.000Z" },
    } as WindowMsg,
    each,
  );
  housekeep(world, i, each);
};

let clock = 10;

/** A focus key in window `i`, one step per key, with the move it should draw noted first. */
const pressFocus = (world: World, i: number, k: (typeof FOCUS_KEYS)[number], each: (e: Event) => void) => {
  const w = world.wins[i]!;

  for (const [n, key] of k.keys.entries()) {
    if (n === k.keys.length - 1) {
      const from = drawnFocus(w.s);
      const to = target(w.s, k.to);

      if (from !== null && to !== null) {
        w.moves.push({ from, to, does: k.does, cursor: w.cursors.get(from) ?? null, letter: null });
      }
    }

    // SAFETY: the key case is exactly `{type, key, at}`, the fields this builds.
    stepWin(world, i, { type: "key", key, at: (clock += 10) } as WindowMsg, each);
    housekeep(world, i, each);
  }
};

/** The page says DOM focus is in tile `tile` of window `i`, on an element with cursor `cursor`. */
const focusIn = (world: World, i: number, tile: string, cursor: string | null, each: (e: Event) => void) => {
  const w = world.wins[i]!;
  const from = drawnFocus(w.s);

  // SAFETY: `includes` only looks the value up: a string that is not a tile of the layout is not found.
  if (from !== null && tile !== from && Layout.order(drawnSpace(w.s)!.layout).includes(tile as TileId)) {
    w.moves.push({ from, to: tile, does: "tezgah.focus", cursor: w.cursors.get(from) ?? null, letter: null });
  }

  // SAFETY: the focus case is `{type, tile, cursor}`, and each cursor here is null or a short CURSORS key.
  stepWin(world, i, { type: "focus", tile, cursor } as WindowMsg, each);
  w.cursors.set(tile, cursor);
  housekeep(world, i, each);
};

/** The hello exchange on dial 1, then every read and open answered, so the window is online with
 *  tezgah's view and every tile open. */
const online = (world: World, i: number, each: (e: Event) => void) => {
  const w = world.wins[i]!;
  const key = w.waiting.find((c) => c.type === "key");

  if (key !== undefined) {
    stepWin(
      world,
      i,
      // SAFETY: `key` is the key Cmd the window handed out, and `{found, fingerprint}` is the key Cmd's ok value.
      { type: "key_ok", cmd: key, value: { found: "created", fingerprint: "SHA256:k" } } as WindowMsg,
      each,
    );
  }

  // SAFETY: the socket_opened case is exactly `{type, dial, at}`, the fields this builds.
  stepWin(world, i, { type: "socket_opened", dial: 1, at: 0 } as WindowMsg, each);
  stepWin(
    world,
    i,
    // SAFETY: the frame case is `{type, dial, text, at, ms?}`, and this builds it without `ms`.
    { type: "frame", dial: 1, text: rpc({ method: "challenge", params: { nonce: `n0nce${i}` } }), at: 1 } as WindowMsg,
    each,
  );
  const hello = w.waiting.find((c) => c.type === "hello");

  if (hello !== undefined) {
    // SAFETY: `hello` is the hello Cmd the window handed out, whose ok value is null.
    stepWin(world, i, { type: "hello_ok", cmd: hello, value: null } as WindowMsg, each);
    stepWin(
      world,
      i,
      // SAFETY: the frame case is `{type, dial, text, at, ms?}`, and this builds it without `ms`.
      { type: "frame", dial: 1, text: rpc({ id: hello["id"], result: ADMITTED }), at: 2 } as WindowMsg,
      each,
    );
  }

  for (let guard = 0; guard < 200; guard++) {
    housekeep(world, i, each);
    const flight = w.s.flight.find((f) => f.call._tag !== "send" && !w.answered.has(`${f.dial} ${f.id}`));

    if (flight === undefined) {
      return;
    }

    w.answered.add(`${flight.dial} ${flight.id}`);
    const on = { id: flight.id, dial: flight.dial };

    if (flight.call._tag === "read") {
      const name = flight.call.stream.replace(/^processes\//, "");
      const process = name.startsWith("tezgah:") ? TEZGAH_PID : `process_of_${name}`;
      stepWin(
        world,
        i,
        // SAFETY: this flight is a read, and read_ok is its write's id and dial, an array of entries and ms.
        {
          type: "read_ok",
          ...on,
          value: [{ _tag: "started", by: "brain", body: { process, name }, rev: 1 }],
          ms: 1,
        } as WindowMsg,
        each,
      );
    } else if (flight.call._tag === "open" && flight.call.pid === TEZGAH_PID) {
      w.subscribed = true;
      w.seen = Math.max(w.seen, world.pos);
      stepWin(
        world,
        i,
        // SAFETY: this flight is an open of tezgah's pid, and open_ok's value is `{rev, view}` with a JSON view.
        { type: "open_ok", ...on, value: { rev: world.pos, view: world.view }, ms: 1 } as WindowMsg,
        each,
      );
    } else if (flight.call._tag === "open") {
      // SAFETY: this flight is an open, and open_ok's value is `{rev, view}` with a JSON view.
      stepWin(world, i, { type: "open_ok", ...on, value: { rev: 0, view: {} }, ms: 1 } as WindowMsg, each);
    } else {
      // SAFETY: sends are left out above, and the window's other calls here are
      // knocks: knock_ok is its id, dial, a null value and ms.
      stepWin(world, i, { type: "knock_ok", ...on, value: null, ms: 1 } as WindowMsg, each);
    }
  }
};

/** A world of `count` windows on workspace 1 of `view`, each online with every tile open. */
const makeWorld = (view: TezgahView, count: number, each: (e: Event) => void): World => {
  const world: World = { pos: 1, view, wins: [], letters: 0 };

  for (let i = 0; i < count; i++) {
    // SAFETY: this is the window's WindowCtx (no tiles, a tab, tezgah's workspace 1), which
    // WindowMachine.ts does not export; `init` answers its WindowModel and Cmds, each with a `type`.
    const [s, cmds] = focusWindow.init(null, {
      tiles: [],
      tab: `tab_${i + 1}`,
      tezgah: { workspace: 1 },
    } as never) as readonly [WindowModel, ReadonlyArray<Cmd>];

    world.wins.push({
      s,
      waiting: [...cmds],
      answered: new Set(),
      subscribed: false,
      outbox: [],
      replies: [],
      notices: [],
      seen: 0,
      got: new Map(),
      refused: new Set(),
      moves: [],
      cursors: new Map(),
    });
    // SAFETY: the size case is exactly `{type, width, height}`, both finite and not negative.
    stepWin(world, i, { type: "size", width: 1440, height: 868 } as WindowMsg, each);
    online(world, i, each);
  }

  for (const [i, w] of world.wins.entries()) {
    expect(drawnFocus(w.s), `window ${i} draws tezgah's focus before the first key`).toBe(view.workspaces[0]!.focus);
    expect(
      w.s.tiles.map((t) => t.reach._tag),
      `window ${i}: every tile is open before the first key`,
    ).toEqual(Layout.order(view.workspaces[0]!.layout).map(() => "open"));
  }

  return world;
};

/** Whether move `m` of window `w` is answered: its refusal came, or its reply came and a view at or
 *  past its position. */
const answered = (w: Win, m: Move): boolean => {
  const pos = m.letter === null ? undefined : w.got.get(m.letter);

  return (m.letter !== null && w.refused.has(m.letter)) || (pos !== undefined && w.seen >= pos);
};

/** A `data-cursor` key a view may give, up to `CursorKey`'s real limit of 256 (plan amendment 10),
 *  with keys past the checklist's 85 drawn as often as short ones, or none. fast-check, not the
 *  schema's Arbitrary: the walk must reach the limit itself, not the schema's cap. */
const CURSOR_MOST = 256;

const Cursor = fc.oneof(
  fc.constant(null),
  fc.string({ minLength: 1, maxLength: 80 }),
  fc.string({ minLength: 81, maxLength: CURSOR_MOST }),
);

const Pick = fc.record({
  type: fc.constant("pick" as const),
  win: fc.integer({ min: 0, max: 1 }),
  move: fc.nat(),
  pick: fc.nat(),
  cursor: Cursor,
});

type Pick = typeof Pick extends fc.Arbitrary<infer A> ? A : never;

const Desk = fc.record({
  cuts: fc.array(fc.record({ at: fc.nat(), down: fc.boolean() }), { minLength: 1, maxLength: 5 }),
  focus: fc.nat(),
});

const CURSORS = ["item:milk", "item:eggs", null] as const;

/** One pick: the move it names among those possible in window `win` now. */
const play = (world: World, c: Pick, each: (e: Event) => void) => {
  const i = c.win;
  const w = world.wins[i]!;
  const space = drawnSpace(w.s);
  const tiles = space === null ? [] : Layout.order(space.layout);

  const options: Array<() => void> = [
    () => pressFocus(world, i, FOCUS_KEYS[c.pick % FOCUS_KEYS.length]!, each),
    () => pressFocus(world, i, FOCUS_KEYS[c.pick % FOCUS_KEYS.length]!, each),
    () => focusIn(world, i, tiles[c.pick % Math.max(tiles.length, 1)] ?? "", c.cursor, each),
    () => focusIn(world, i, drawnFocus(w.s) ?? "", c.cursor, each),
    ...(w.waiting.some((x) => x.type === "now") ? [() => date(world, i, each)] : []),
    ...(w.outbox.length > 0 ? [() => arrive(world, i), () => arrive(world, i), () => reject(world, i)] : []),
    ...(w.replies.length > 0 ? [() => reply(world, i, each)] : []),
    ...(w.notices.length > 0 ? [() => notice(world, i, each)] : []),
  ];

  options[c.move % options.length]!();
};

/** Everything that waits, delivered, until the world is quiet. */
const settle = (world: World, each: (e: Event) => void, batched = false) => {
  // Batched: every letter dated, arrived and replied before any view, so one view answers two or more
  // of one window's moves at once (plan amendment 10's case of an earlier move its next superseded).
  for (let guard = 0; batched && guard < 2_000; guard++) {
    const busy = world.wins.findIndex(
      (w) => w.waiting.some((x) => x.type === "now") || w.outbox.length > 0 || w.replies.length > 0,
    );

    if (busy < 0) {
      break;
    }

    date(world, busy, each);
    arrive(world, busy);
    reply(world, busy, each);
  }

  // tezgah's whole views coalesce: a window that was behind takes only the newest one.
  for (const w of batched ? world.wins : []) {
    w.notices = w.notices.slice(-1);
  }

  for (let guard = 0; guard < 2_000; guard++) {
    const busy = world.wins.findIndex(
      (w) =>
        w.waiting.some((x) => x.type === "now") || w.outbox.length > 0 || w.replies.length > 0 || w.notices.length > 0,
    );

    if (busy < 0) {
      return;
    }

    // Views before replies, so a reply can find the server already past its move: a jump back.
    date(world, busy, each);
    arrive(world, busy);
    notice(world, busy, each);
    reply(world, busy, each);
  }

  throw new Error("the world never went quiet");
};

/** Runs one walk: two windows on `desk`, then `picks`, then everything delivered. */
const walk = (desk: TezgahView, picks: ReadonlyArray<Pick>, each: (e: Event) => void, count = 2) => {
  const world = makeWorld(desk, count, () => {});

  for (const c of picks) {
    play(world, c, each);
  }

  // Half the walks end batched, half with views before replies (a jump back), by the picks' count.
  settle(world, each, picks.length % 2 === 0);

  return world;
};

/** A key that would hold a drawn focus beside the server state: the one thing L23 forbids. */
type Stored = "focus" | "drawn" | `optimistic${string}` | `drawn${string}`;

const STORED = /^(focus|drawn|optimistic)/;

describe("Desk S3 L23: the window stores no optimistic focus", () => {
  // L23's type half is checked by `tsc` over this file (CI's typecheck job, 0133): a stored focus
  // beside the server state fails typecheck. The walk checks the same at run time, on every state.
  it("L23: the window's tezgah child holds the server state and the pending moves and no focus of its own, and on any walk the drawn focus is the newest pending move's to, or the server's focus when none is pending", () => {
    expectTypeOf<TezgahClient>().toHaveProperty("serverState");
    expectTypeOf<TezgahClient>().toHaveProperty("pendingMutations");
    expectTypeOf<typeof PendingMutation.Type>().toHaveProperty("to");
    expectTypeOf<typeof PendingMutation.Type>().toHaveProperty("cursor");
    expectTypeOf<Extract<keyof TezgahClient, Stored>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof WindowModel, Stored>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof NonNullable<WindowModel["tezgah"]>, Stored>>().toEqualTypeOf<never>();
    const fresh = tezgahMachine.init(null, { workspace: 1 })[0];
    expect(
      Object.keys(fresh).filter((k) => STORED.test(k)),
      "L23: the tezgah child stores no drawn focus",
    ).toEqual([]);
    expect(TABLE, "the laws' key table loads").not.toBeNull();
    const seen = { pending: 0, none: 0 };
    fc.assert(
      fc.property(Desk, arbMsgSequence(Pick, { minLength: 4, maxLength: 40, size: "max" }), (d, picks) => {
        walk(makeDesk(d.cuts, d.focus), picks, ({ win, next, world }) => {
          const w = world.wins[win]!;
          const open = w.moves.filter((m) => !answered(w, m));
          const pending = waitingMoves(next);
          seen[pending.length > 0 ? "pending" : "none"]++;
          expect(
            [next, next.tezgah ?? {}, next.tezgah?.client ?? {}]
              .flatMap((o) => Object.keys(o))
              .filter((k) => STORED.test(k)),
            `L23: window ${win} stores no drawn focus`,
          ).toEqual([]);
          expect(pending, `L23: window ${win} keeps one pending mutation per move not answered`).toHaveLength(
            open.length,
          );
          expect(drawnFocus(next), `L23: window ${win}'s drawn focus`).toBe(
            open.length > 0 ? open.at(-1)!.to : serverFocus(next),
          );
        });
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.pending, "L23: the walks hold pending moves").toBeGreaterThan(0);
    expect(seen.none, "L23: the walks answer every move").toBeGreaterThan(0);
  });
});

describe("Desk S3 L24: two windows' moves and the server's answers, in any order", () => {
  it("L24: each window's drawn focus is the server's once its mutations are answered, a pending mutation goes only once its reply and a view at or past its position came, or its refusal, and a window whose move lost follows the server", () => {
    const seen = { lost: 0, both: 0, early: 0, moves: 0, refused: 0 };
    fc.assert(
      fc.property(Desk, arbMsgSequence(Pick, { minLength: 8, maxLength: 60, size: "max" }), (d, picks) => {
        const world = walk(makeDesk(d.cuts, d.focus), picks, ({ win, m, next, world: at }) => {
          const w = at.wins[win]!;
          const open = w.moves.filter((x) => !answered(w, x));
          const pending = waitingMoves(next);

          // A mutation is matched by its letter: while it waits, its letter is in the pending list.
          for (const x of open.filter((x) => x.letter !== null)) {
            expect(
              pending.map(letterIn),
              `L24: window ${win}'s move to ${x.to} waits under its letter ${x.letter}`,
            ).toContain(x.letter);
          }

          // A view before its reply keeps the mutation: the reply has not come.
          seen.early +=
            m.type === "view" && w.moves.some((x) => x.letter !== null && !w.got.has(x.letter) && w.seen > 0) ? 1 : 0;
          expect(
            pending,
            `L24: window ${win} after ${m.type}: one pending mutation per move not answered`,
          ).toHaveLength(open.length);

          if (open.length === 0) {
            expect(drawnFocus(next), `L24: window ${win} with every move answered draws the server's focus`).toBe(
              serverFocus(next),
            );
          }
        });

        const focus = world.view.workspaces[0]!.focus;

        for (const [i, w] of world.wins.entries()) {
          seen.moves += w.moves.length;
          seen.refused += w.moves.filter((x) => x.letter !== null && w.refused.has(x.letter)).length;
          const dids = w.moves.map((x) => x.letter);
          expect(
            dids.every((l) => l !== null),
            `L24: every move window ${i} drew went out as a letter`,
          ).toBe(true);
          expect(waitingMoves(w.s), `L24: window ${i} holds nothing pending once all is answered`).toEqual([]);
          expect(drawnFocus(w.s), `L24: window ${i} follows the server`).toBe(focus);
          const last = w.moves.at(-1);
          seen.lost += last !== undefined && last.to !== focus ? 1 : 0;
        }

        seen.both += world.wins.every((w) => w.moves.length > 0) ? 1 : 0;
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.moves, "L24: the walks move focus").toBeGreaterThan(0);
    expect(seen.both, "L24: both windows move in one walk").toBeGreaterThan(0);
    expect(seen.lost, "L24: a window's last move loses to the other's").toBeGreaterThan(0);
    expect(seen.refused, "L24: the walks refuse moves, which leave as their refusal arrives").toBeGreaterThan(0);
    expect(seen.early, "L24: the walks deliver a view before a move's reply").toBeGreaterThan(0);
  });

  it("L24: every letter a window sends for a move names the drawn focus it left, the tile it drew and its command, with the cursor the page last said there", () => {
    let checked = 0;
    let long = 0;
    fc.assert(
      fc.property(Desk, arbMsgSequence(Pick, { minLength: 8, maxLength: 60, size: "max" }), (d, picks) => {
        walk(makeDesk(d.cuts, d.focus), picks, ({ win, cmds, world }) => {
          for (const c of cmds) {
            // SAFETY: only a write Cmd has a `call`, a tagged Call (WindowMachine.ts), and other Cmds have none.
            const call = c["call"] as Call | undefined;

            if (c.type !== "write" || call?._tag !== "send" || call["pid"] !== TEZGAH_PID) {
              continue;
            }

            // SAFETY: a send's `m` is the letter's Msg; the expect below checks it is a `did` before the law reads it.
            const did = call["m"] as Did & {
              readonly via?: { readonly _tag: string };
              readonly cursor?: string | null;
            };

            const move = world.wins[win]!.moves.find((x) => x.letter === call["letter"]);
            expect(move, `L24: window ${win}'s letter ${String(call["letter"])} is one of its moves`).toBeDefined();
            checked += move!.cursor === null ? 0 : 1;
            long += (move!.cursor?.length ?? 0) > 80 ? 1 : 0;
            expect(did, "L24: the letter is the move").toMatchObject({
              type: "did",
              does: move!.does,
              from: move!.from,
              to: move!.to,
            });
            expect(did.via?._tag, "L24: a key move says so, a click says so").toBe(
              move!.does === "tezgah.focus" ? "click" : "key",
            );
            expect(did.cursor ?? null, `L24: the move carries the cursor the page last said in ${move!.from}`).toBe(
              move!.cursor,
            );
          }
        });
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(checked, "L24: the walks send moves that leave a cursor").toBeGreaterThan(0);
    expect(long, "L24: the walks send cursor keys of 81 to 256 characters").toBeGreaterThan(0);
  });
});

describe("Desk S3 L25: a focus key is drawn on the step that reads it", () => {
  it("L25: with the link slow or down, each focus key and click draws its move on its own step, before any frame from the brain, sends nothing while down, and keeps every move pending", () => {
    const seen = { slow: 0, down: 0, drawn: 0, still: 0 };
    fc.assert(
      fc.property(
        Desk,
        fc.boolean(),
        fc.array(fc.record({ key: fc.nat(), click: fc.boolean(), pick: fc.nat() }), { minLength: 1, maxLength: 30 }),
        (d, down, presses) => {
          const world = makeWorld(makeDesk(d.cuts, d.focus), 1, () => {});
          const w = world.wins[0]!;

          if (down) {
            // SAFETY: the socket_closed case is exactly `{type, dial, code, at}`, the fields this builds.
            stepWin(world, 0, { type: "socket_closed", dial: 1, code: 1006, at: 3 } as WindowMsg, () => {});
            housekeep(world, 0, () => {});
            expect(w.s.link._tag, "the socket dropped").not.toBe("online");
          }

          seen[down ? "down" : "slow"]++;

          for (const p of presses) {
            const before = drawnFocus(w.s);
            const moves = w.moves.length;

            const check = ({ m, next, cmds }: Event) => {
              if (m.type !== "key" && m.type !== "focus") {
                return;
              }

              if (down) {
                expect(
                  cmds.filter((c) => c.type === "write"),
                  "L25: nothing is written while the link is down",
                ).toEqual([]);
              }

              const last =
                m.type === "focus" ||
                (FOCUS_KEYS.some((k) => k.keys.at(-1) === Reflect.get(m, "key")) && Reflect.get(m, "key") !== "ctrl+b");

              if (!last) {
                return;
              }

              const made = w.moves.length > moves ? w.moves.at(-1)! : null;
              seen[made === null ? "still" : "drawn"]++;
              expect(
                drawnFocus(next),
                `L25: ${String(Reflect.get(m, "key") ?? "a click")} is drawn on its own step`,
              ).toBe(made === null ? before : made.to);
            };

            if (p.click) {
              const space = drawnSpace(w.s)!;
              const tiles = Layout.order(space.layout);
              focusIn(world, 0, tiles[p.pick % tiles.length]!, CURSORS[p.pick % 3]!, check);
            } else {
              pressFocus(world, 0, FOCUS_KEYS[p.key % FOCUS_KEYS.length]!, check);
            }

            expect(waitingMoves(w.s), "L25: every move waits, none answered").toHaveLength(w.moves.length);
          }
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    expect(
      Object.values(seen).every((n) => n > 0),
      `L25: the walks reached every case ${JSON.stringify(seen)}`,
    ).toBe(true);
  });
});

describe("Desk S3 L29: a move the server overrode is recorded", () => {
  it("L29: each answered move writes one focus row with its letter on the step it is dropped: overridden when tezgah refused it or dropping it moves the drawn focus, else kept", () => {
    const seen = { kept: 0, overridden: 0, refused: 0, batch: 0, superseded: 0 };
    fc.assert(
      fc.property(Desk, arbMsgSequence(Pick, { minLength: 8, maxLength: 60, size: "max" }), (d, picks) => {
        const rows = [new Map<string, number>(), new Map<string, number>()];

        const world = walk(makeDesk(d.cuts, d.focus), picks, ({ win, m, prev, next, cmds, world: at }) => {
          const w = at.wins[win]!;

          const focusRows = cmds.flatMap((c) => {
            const record =
              // SAFETY: a `record` Cmd's input is `{ record: ClientRecord }`, a tagged union.
              c.type === "record" ? (c["record"] as { readonly _tag: string; readonly [k: string]: unknown }) : null;

            return record?._tag === "focus" ? [record] : [];
          });

          const before = new Set(waitingMoves(prev).map(letterIn));
          const after = new Set(waitingMoves(next).map(letterIn));
          const dropped = w.moves.filter((x) => x.letter !== null && before.has(x.letter) && !after.has(x.letter));
          expect(
            focusRows.map((r) => r["letter"]).sort(),
            `L29: window ${win} writes one focus row per move dropped on this step`,
          ).toEqual(dropped.map((x) => x.letter).sort());

          seen.batch += dropped.length > 1 ? 1 : 0;
          // The amendment's rule, written here: drop the moves one by one, oldest first, against the
          // server state this step left. Each is `overridden` when tezgah refused it or when dropping it
          // moves the drawn focus (the newest still pending move's `to`, else the server's focus);
          // otherwise `kept`, so an earlier move its own next move superseded is kept.
          const drawnWith = (list: ReadonlyArray<Move>) => list.at(-1)?.to ?? serverFocus(next);
          let current = w.moves.filter((x) => x.letter !== null && before.has(x.letter));

          for (const move of dropped) {
            const was = drawnWith(current);
            current = current.filter((x) => x !== move);
            const jumped = drawnWith(current) !== was;
            const refused = w.refused.has(move.letter!);
            const want = refused || jumped ? "overridden" : "kept";
            const row = focusRows.find((r) => r["letter"] === move.letter);
            rows[win]!.set(move.letter!, (rows[win]!.get(move.letter!) ?? 0) + 1);
            seen[refused ? "refused" : jumped ? "overridden" : "kept"]++;
            seen.superseded += !refused && !jumped && move !== dropped.at(-1) ? 1 : 0;
            expect(
              row?.["result"],
              `L29: window ${win}'s move to ${move.to}, ${refused ? "refused" : jumped ? "jumped back" : "kept"} on ${m.type}`,
            ).toBe(want);
          }
        });

        for (const [i, w] of world.wins.entries()) {
          for (const x of w.moves) {
            expect(rows[i]!.get(x.letter ?? ""), `L29: window ${i}'s move to ${x.to} has one focus row`).toBe(1);
          }
        }
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.kept, "L29: the walks keep moves").toBeGreaterThan(0);
    expect(seen.overridden, "L29: the walks override moves").toBeGreaterThan(0);
    expect(seen.refused, "L29: the walks refuse moves").toBeGreaterThan(0);
    expect(seen.batch, "L29: the walks drop two of one window's moves on one step").toBeGreaterThan(0);
    expect(seen.superseded, "L29: the walks keep a move its own next move superseded").toBeGreaterThan(0);
  });
});

describe("Desk S3: a split's letter carries the cursor it leaves", () => {
  it("S3 cursor (the window's half): each split letter names the drawn focus it leaves and the cursor the page last said there", () => {
    const seen = { splits: 0, cursor: 0 };
    fc.assert(
      fc.property(
        Desk,
        fc.array(fc.record({ move: fc.nat(), pick: fc.nat() }), { minLength: 4, maxLength: 30 }),
        (d, picks) => {
          /** The splits the window minted, in order: the tile each leaves and its cursor then. */
          const due: Array<{ readonly from: string; readonly cursor: string | null }> = [];

          const each = ({ cmds }: Event) => {
            for (const c of cmds) {
              // SAFETY: only a write Cmd has a `call`, a tagged Call (WindowMachine.ts), and other Cmds have none.
              const call = c["call"] as Call | undefined;
              // SAFETY: no tile here has a program (`focusWindow`'s `tile` is undefined), so
              // every send is a letter to tezgah, a `did` Msg with `does` and `from`.
              const did = call?.["m"] as (Did & { readonly cursor?: string | null }) | undefined;

              if (c.type !== "write" || call?._tag !== "send" || !did?.does.startsWith("tezgah.split_")) {
                continue;
              }

              const want = due.shift();
              expect(want, "S3: a split letter the window minted").toBeDefined();
              seen.splits++;
              seen.cursor += want!.cursor === null ? 0 : 1;
              expect(did.from, "S3: the split leaves the drawn focus").toBe(want!.from);
              expect(did.cursor ?? null, `S3: the split carries the cursor the page last said in ${want!.from}`).toBe(
                want!.cursor,
              );
            }
          };

          const world = makeWorld(makeDesk(d.cuts.slice(0, 2), d.focus), 1, () => {});
          const w = world.wins[0]!;

          for (const c of picks) {
            const space = drawnSpace(w.s)!;
            const tiles = Layout.order(space.layout);

            const options: Array<() => void> = [
              () => focusIn(world, 0, space.focus, CURSORS[c.pick % 3]!, each),
              () => focusIn(world, 0, tiles[c.pick % tiles.length]!, CURSORS[(c.pick >> 2) % 3]!, each),
              () => pressFocus(world, 0, FOCUS_KEYS[c.pick % FOCUS_KEYS.length]!, each),
              () => {
                const from = drawnFocus(w.s)!;
                const cursor = w.cursors.get(from) ?? null;

                for (const key of ["ctrl+b", c.pick % 2 === 0 ? "%" : '"']) {
                  // SAFETY: the key case is exactly `{type, key, at}`, the fields this builds.
                  stepWin(world, 0, { type: "key", key, at: (clock += 10) } as WindowMsg, each);
                  housekeep(world, 0, each);
                }

                const mint = w.waiting.find((x) => x.type === "mint");

                if (mint !== undefined) {
                  due.push({ from, cursor });
                  stepWin(
                    world,
                    0,
                    // SAFETY: `mint` is the mint Cmd the window handed out, and `{tile}` is the mint Cmd's ok value.
                    {
                      type: "mint_ok",
                      cmd: mint,
                      value: { tile: typeId("tile", 6_000 + world.letters++) },
                    } as WindowMsg,
                    each,
                  );
                  housekeep(world, 0, each);
                }
              },
              () => date(world, 0, each),
            ];

            options[c.move % options.length]!();
          }

          settle(world, each);
          expect(due, "S3: every split the window minted went out as a letter").toEqual([]);
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.splits, "S3: the walks split").toBeGreaterThan(0);
    expect(seen.cursor, "S3: the walks split a tile left on a cursor").toBeGreaterThan(0);
  });
});

describe("Desk S3 L28: a tile lands where focus last sat in it", () => {
  it("L28 (the window's half, 0165): after every step, lastCursor of each drawn tile is the cursor the page last said in it in that window, a null included, else the cursor tezgah's view gives the tile", () => {
    const seen = { newer: 0, none: 0, view: 0 };

    /** Each drawn tile of each window lands where the page last said focus sat in it. */
    const check = (world: World) => {
      for (const w of world.wins) {
        const client = w.s.tezgah?.client;
        const view = client === undefined ? null : optimisticState(client);
        const space = drawnSpace(w.s);

        for (const id of space === null ? [] : Layout.order(space.layout)) {
          const tile = view!.tiles.find((t) => t.id === id)!;
          const noted = w.cursors.has(id);
          const want = noted ? w.cursors.get(id)! : tile.cursor;
          seen.newer += noted && want !== null && want !== tile.cursor ? 1 : 0;
          seen.none += noted && want === null && tile.cursor !== null ? 1 : 0;
          seen.view += !noted && tile.cursor !== null ? 1 : 0;
          expect(
            lastCursor(w.s.tezgah, tile),
            noted
              ? `L28: ${id} lands where the page last said focus sat in it, ${String(want)}, over the view's ${String(tile.cursor)}`
              : `L28: ${id}, with no note in this window, lands on the cursor tezgah's view gives it`,
          ).toBe(want);
        }
      }
    };

    fc.assert(
      fc.property(Desk, arbMsgSequence(Pick, { minLength: 8, maxLength: 60, size: "max" }), (d, picks) => {
        const world = makeWorld(makeDesk(d.cuts, d.focus), 2, () => {});

        for (const c of picks) {
          play(world, c, () => {});
          check(world);
        }

        settle(world, () => {}, picks.length % 2 === 0);
        check(world);
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.newer, "L28: the walks note a row newer than the view's cursor for the tile").toBeGreaterThan(0);
    expect(seen.none, "L28: the walks note focus on no row while the view keeps a row").toBeGreaterThan(0);
    expect(seen.view, "L28: the walks land a window with no note on the view's cursor").toBeGreaterThan(0);
  });
});

// Ticket 1043, next/: a burst of presses is judged as the same presses one step apart. The page must
// answer each press at once, to keep or stop its default, while the run reads its line later, so a
// press can arrive before the window has read the ones before it. `handle` judges each press against
// the window as it is after every earlier press. The walk presses what a person types, a key alone
// or the prefix and the key after it, with no read between the two, and after each the run reads as
// many of the presses waiting in its line as the walk picks, from none to all. The same presses go
// through three runs: one that reads each press as soon as it is handed over, the walk's own, and a
// burst that reads nothing until the last press. Each run then reads what is left, has its splits'
// tiles minted, and delivers everything until quiet.

/** What a person types: tezgah's focus keys, the splits and the close after the prefix, an answer, the
 *  prefix again or Escape after it, an unbound key, a key a browser keeps, and the prefix alone. */
const CHORDS: ReadonlyArray<ReadonlyArray<string>> = [
  ...FOCUS_KEYS.map((k) => k.keys),
  ["ctrl+b", "%"],
  ["ctrl+b", '"'],
  ["ctrl+b", "|"],
  ["ctrl+b", "-"],
  ["ctrl+b", "x"],
  ["y"],
  ["n"],
  ["ctrl+b", "ctrl+b"],
  ["ctrl+b", "escape"],
  ["ctrl+b", "q"],
  ["a"],
  ["meta+w"],
  ["ctrl+b"],
];

const MOVES = new Set(FOCUS_KEYS.filter((k) => k.keys.length === 2).map((k) => k.keys[1]!));

const SPLIT_KEYS = new Set(["%", '"', "|", "-"]);

const Typed = fc.record({ chord: fc.nat(), reads: fc.nat() });

type Typed = typeof Typed extends fc.Arbitrary<infer A> ? A : never;

type Schedule = "apart" | "walked" | "burst";

/** The two schedules held to the run that reads each press at once. */
const SCHEDULES: ReadonlyArray<Schedule> = ["walked", "burst"];

/** One run of `picks` on `desk`: each press judged by `handle` against the run's state, the presses
 *  handed over waiting in the run's line until the schedule reads them. */
const typed = (desk: TezgahView, picks: ReadonlyArray<Typed>, schedule: Schedule) => {
  const letters: Array<unknown> = [];

  const each = (e: Event) => {
    for (const c of e.cmds) {
      // SAFETY: only a write Cmd has a `call`, a tagged Call (WindowMachine.ts), and other Cmds have none.
      const call = c["call"] as Call | undefined;

      if (c.type === "write" && call?._tag === "send") {
        letters.push(call["m"]);
      }
    }
  };

  const world = makeWorld(desk, 1, () => {});
  const w = world.wins[0]!;
  const line: Array<WindowMsg> = [];

  const read = (n: number) => {
    for (const m of line.splice(0, n)) {
      stepWin(world, 0, m, each);
    }
  };

  let unread: Unread = { from: w.s.presses, keys: [] };
  let at = 10;
  const handlings: Array<{ readonly key: string; readonly handling: Handling; readonly waiting: number }> = [];

  for (const pick of picks) {
    for (const key of CHORDS[pick.chord % CHORDS.length]!) {
      const press: KeyPress = { type: "key", key, at: (at += 10) };
      const judged = handle(focusWindow, TABLE!, w.s, unread, press);
      unread = judged.unread;
      handlings.push({ key, handling: judged.handling, waiting: line.length });

      if (judged.handling !== "leave") {
        line.push(press);
      }

      if (schedule === "apart") {
        read(line.length);
      }
    }

    if (schedule === "walked") {
      read(pick.reads % (line.length + 1));
    }
  }

  read(line.length);

  for (let minted = 0, guard = 0; guard < 200; guard++) {
    const mint = w.waiting.find((c) => c.type === "mint");

    if (mint === undefined) {
      break;
    }

    // The world answers a Cmd as its other steps do (`date`, the S3 cursor walk's mint).
    stepWin(
      world,
      0,
      // SAFETY: `mint` is the mint Cmd the window handed out, and `{tile}` is the mint Cmd's ok value.
      { type: "mint_ok", cmd: mint, value: { tile: typeId("tile", 7_000 + ++minted) } } as WindowMsg,
      each,
    );
    housekeep(world, 0, each);
  }

  settle(world, each);

  return { handlings, world, letters, s: w.s };
};

describe("Ticket 1043: a burst of presses is judged as the same presses one step apart", () => {
  it("1043: for any presses, however many the run has not read yet when each is judged, the page keeps or stops the same defaults, and the window ends with the same tiles, focus, prefix and letters as when it reads each press at once", () => {
    const counts = { raced: 0, unread: 0, splits: 0 };
    fc.assert(
      fc.property(Desk, fc.array(Typed, { minLength: 1, maxLength: 24 }), (d, picks) => {
        const desk = makeDesk(d.cuts, d.focus);
        const apart = typed(desk, picks, "apart");
        counts.splits += apart.letters.filter((m) =>
          String(Reflect.get(Object(m), "does")).startsWith("tezgah.split"),
        ).length;

        for (const schedule of SCHEDULES) {
          const run = typed(desk, picks, schedule);
          counts.unread += run.handlings.filter((h) => h.waiting > 0).length;

          for (const [i, h] of run.handlings.entries()) {
            const before = run.handlings.slice(Math.max(0, i - 3), i);
            counts.raced +=
              before.length === 3 &&
              SPLIT_KEYS.has(h.key) &&
              h.waiting >= 3 &&
              MOVES.has(before[1]!.key) &&
              [...before, h].every((x, k) => apart.handlings[i - 3 + k]!.handling === "take" && x.handling === "take")
                ? 1
                : 0;
          }

          expect(
            run.handlings.map((h) => `${h.key} ${h.handling}`),
            `1043 (${schedule}): each press keeps or stops its default as when the window has read every press before it`,
          ).toEqual(apart.handlings.map((h) => `${h.key} ${h.handling}`));
          expect(run.world.view, `1043 (${schedule}): tezgah ends with the same tiles and layout`).toEqual(
            apart.world.view,
          );
          expect(drawnFocus(run.s), `1043 (${schedule}): the window draws the same focus`).toBe(drawnFocus(apart.s));
          expect(run.s.prefix, `1043 (${schedule}): the prefix ends the same`).toEqual(apart.s.prefix);
          expect(run.letters, `1043 (${schedule}): the window sends tezgah the same letters`).toEqual(apart.letters);
          expect(run.s, `1043 (${schedule}): the window ends in the same state`).toEqual(apart.s);
        }
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(counts.splits, "1043: the walks send split letters").toBeGreaterThan(0);
    expect(counts.unread, "1043: the walks judge presses while earlier ones wait unread").toBeGreaterThan(0);
    expect(
      counts.raced,
      "1043: the walks reach a prefix move followed at once by a prefix split, judged while the move waits unread",
    ).toBeGreaterThan(0);
  });
});
