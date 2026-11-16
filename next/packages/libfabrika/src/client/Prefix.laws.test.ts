// Desk S2b, next/ (the desk program fabrika/tezgah, ticket named by its title): laws L13, L14 (the
// window's half), L17 and L18 of the approved plan. Written before `client/Prefix.ts`, before
// `client/Keys.ts` and before the window parent reads a key.
//
// The shape these laws hold the build to, from the plan's "The shape" and "One value traced through"
// (the build may add more):
// - `windowMachineFor({decode, tile, keys})` takes the window's key table as a value, `keys`, the
//   `Table` `Keys.load` answers (the window is handed it; it never reads a file). Without `keys` a
//   window reads no key, so every older caller is unchanged.
// - The window parent takes two more Msgs from the page: `{type: "key", key, at}`, one press spelled
//   the keybindings note's way (`ctrl+b`, `%`, `escape`), and `{type: "size", width, height}`, the
//   size of the area its tiles are drawn in.
// - `WindowModel.prefix` is the `Prefix` machine's Model (`client/Prefix.ts`): `idle`, `armed {since}`
//   or `asking {tile, since}`. The window steps it by hand. A key only arms the window it reached:
//   nothing but a `record` Cmd leaves before the command is known, and no key crosses the wire.
// - A finished command goes out on the press path to the window's tezgah pid as one letter,
//   `{type: "did", does, from, via: {_tag: "key", ...}}`, `from` the workspace's focused tile in the
//   window's drawn state, and for a split `tile`, a new tile id minted by the window's `mint` Cmd
//   (`mint_ok {value: {tile}}`), as the window's own attach mints one.
// - A close of a tile tezgah started (`child`) asks first: the prefix goes to `asking {tile}`; `y`
//   sends one close; `n`, Escape or any other key sends nothing and ends the ask. A close of a tile
//   tezgah did not start goes out at once (the plan's lean on the close).
// - A split that would draw its tile or the new one under 220x120 at the window's last size (the
//   area inside the frame's padding; plan amendment 7: each container leaves 4px between its parts),
//   is refused in the window: nothing is minted or sent, the prefix
//   goes back to `idle`, and `WindowModel.polite` is `{_tag: "no_room", tile}` for the polite region
//   (null until then). The words are the page's.
//
// Every walk starts at the window's real `init`, goes online through the real hello exchange, opens
// tezgah's view and each tile's process view, and folds the real update. A fake tezgah applies each
// letter it is sent with the library's real `Layout.split` and `Layout.remove` and sends its whole
// view to every window that opened it, so a second window of the same person sees the first one's
// commands land. Each step answers only what really waits: the calls in flight and the Cmds handed out.
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Match, Result, Schema } from "effect";
import * as fc from "fast-check";
import type { Binding } from "../runtime/Program.ts";
import * as Layout from "../tezgah/Layout.ts";
import { type Dir, type TezgahView, type Tile, type TileId, Workspace } from "../tezgah/Workspace.ts";
import * as Keys from "./Keys.ts";
import { Prefix } from "./Prefix.ts";
import { type WindowModel, type WindowMsg, windowMachineFor } from "./WindowMachine.ts";

const SEED = 119120;
const PREFIX = "ctrl+b";
const SMALLEST = { width: 220, height: 120 } as const;
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

const PERSON = typeId("person", 41);
const TEZGAH_PID = "process_of_tezgah";
const ADMITTED = { version: 1, ping: 5_000, identity: { key: "SHA256:k", person: PERSON, as: "window" } };
const rpc = (body: object) => JSON.stringify({ jsonrpc: "2.0", ...body });

/** tezgah's default rows for this slice, as `next/programs/tezgah/src/commands.ts` ships them. The
 *  library may not import a program, so the laws hand the window the same rows themselves. */
const ROWS: ReadonlyArray<Binding> = [
  { does: "tezgah.split_right", keys: ["<prefix>%", "<prefix>|"], word: "split right", label: "Split right" },
  { does: "tezgah.split_down", keys: ['<prefix>"', "<prefix>-"], word: "split down", label: "Split down" },
  { does: "tezgah.close", keys: ["<prefix>x"], word: "close", label: "Close tile" },
];

const BACKEND = Keys.backend("browser", "linux");
const loadedTable = Keys.load(Keys.ship(ROWS, BACKEND), BACKEND);
const TABLE = Result.isSuccess(loadedTable) ? loadedTable.success : null;

const SPLITS: Readonly<Record<string, { readonly does: string; readonly dir: Dir }>> = {
  "%": { does: "tezgah.split_right", dir: "row" },
  "|": { does: "tezgah.split_right", dir: "row" },
  '"': { does: "tezgah.split_down", dir: "column" },
  "-": { does: "tezgah.split_down", dir: "column" },
};

const machine = windowMachineFor({
  // A tile's own view: the laws read none of it, so any object will do.
  decode: () => Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown)),
  tile: () => undefined,
  keys: TABLE!,
});

type Cmd = { readonly type: string; readonly [key: string]: unknown };
type Call = { readonly _tag: string; readonly [key: string]: unknown };

type Did = {
  readonly type: "did";
  readonly does: string;
  readonly from: string;
  readonly tile?: string;
  readonly via: { readonly _tag: string };
};

/** One window of the person, with every Cmd it handed out that is not answered yet. */
type Win = { s: WindowModel; waiting: Array<Cmd>; subscribed: boolean; answered: Set<string> };

/** The fake tezgah: its view and revision, and what each window sent it, in arrival order. */
type World = {
  rev: number;
  view: TezgahView;
  wins: Array<Win>;
  minted: number;
  letters: number;
  sent: Array<{ readonly win: number; readonly m: unknown }>;
};

const tileRow = (id: string, n: number, child: boolean): Tile =>
  ({
    id: id as TileId,
    n,
    shows: child ? `checklist:t${n}` : "checklist:1",
    program: "fabrika/checklist",
    child,
    keep: "failed",
    cursor: null,
  }) as Tile;

const step = (world: World, i: number, m: WindowMsg): ReadonlyArray<Cmd> => {
  const w = world.wins[i]!;
  const [next, cmds] = applyCell(machine, w.s, m) as readonly [WindowModel, ReadonlyArray<Cmd>];
  w.waiting = [...w.waiting.filter((c) => !("cmd" in m) || m.cmd !== c), ...cmds];
  w.s = next;

  for (const c of cmds) {
    const call = c["call"] as Call | undefined;

    if (c.type === "write" && call?._tag === "send" && call["pid"] === TEZGAH_PID) {
      world.sent.push({ win: i, m: call["m"] });
      apply(world, call["m"]);
    }
  }

  return cmds;
};

/** tezgah takes one letter: a split or a close, with the library's own geometry, then sends its view. */
const apply = (world: World, m: unknown) => {
  const did = m as Did;
  const w = world.view.workspaces[0]!;

  if (did?.type !== "did" || !Layout.order(w.layout).includes(did.from as TileId)) {
    return;
  }

  let next: Workspace = w;
  let tiles = world.view.tiles;

  if (did.does === "tezgah.close") {
    next = Layout.remove(w, did.from as TileId);
    tiles = tiles.filter((t) => t.id !== did.from || next === w);
  } else if (did.tile !== undefined && !tiles.some((t) => t.id === did.tile)) {
    const dir = did.does === "tezgah.split_down" ? "column" : "row";
    next = Layout.split(w, did.from as TileId, dir, did.tile as TileId);
    tiles = [...tiles, tileRow(did.tile, Math.max(...tiles.map((t) => t.n)) + 1, true)];
  }

  if (next === w) {
    return;
  }

  world.view = { workspaces: [next, ...world.view.workspaces.slice(1)], tiles };
  world.rev++;

  for (const [i, win] of world.wins.entries()) {
    if (win.subscribed) {
      pending.push([
        i,
        {
          type: "view",
          pid: TEZGAH_PID,
          note: { pid: TEZGAH_PID, type: "whole", rev: world.rev, view: world.view },
        } as WindowMsg,
      ]);
    }
  }
};

/** View notices tezgah has sent and the windows have not taken yet. */
const pending: Array<readonly [number, WindowMsg]> = [];

/** Answers everything that really waits in window `i`, then delivers tezgah's notices, until quiet.
 *  A letter's own send is left in flight: tezgah has it, and its answer changes no key law. */
const drain = (world: World, i: number) => {
  for (let guard = 0; guard < 2_000; guard++) {
    const w = world.wins[i]!;
    const flight = w.s.flight.find((f) => f.call._tag !== "send" && !w.answered.has(`${f.dial} ${f.id}`));

    if (flight !== undefined) {
      w.answered.add(`${flight.dial} ${flight.id}`);
      const on = { id: flight.id, dial: flight.dial };

      if (flight.call._tag === "read") {
        const name = flight.call.stream.replace(/^processes\//, "");
        const process = name.startsWith("tezgah:") ? TEZGAH_PID : `process_of_${name}`;
        step(world, i, {
          type: "read_ok",
          ...on,
          value: [{ _tag: "started", by: "brain", body: { process, name }, rev: 1 }],
          ms: 1,
        } as WindowMsg);
      } else if (flight.call._tag === "open" && flight.call.pid === TEZGAH_PID) {
        w.subscribed = true;
        step(world, i, { type: "open_ok", ...on, value: { rev: world.rev, view: world.view }, ms: 1 } as WindowMsg);
      } else if (flight.call._tag === "open") {
        step(world, i, { type: "open_ok", ...on, value: { rev: 0, view: {} }, ms: 1 } as WindowMsg);
      } else {
        step(world, i, { type: "knock_ok", ...on, value: null, ms: 1 } as WindowMsg);
      }

      continue;
    }

    const cmd = w.waiting.find((c) => ["now", "record", "write", "persist", "ping", "mint"].includes(c.type));

    if (cmd !== undefined) {
      const value = Match.value(cmd.type).pipe(
        Match.when("now", () => ({ letter: `letter_${++world.letters}`, sentAt: "2026-11-14T00:00:00.000Z" })),
        Match.when("mint", () => ({ tile: typeId("tile", 5_000 + ++world.minted) })),
        Match.when("persist", () => true),
        Match.orElse(() => null),
      );
      step(world, i, { type: `${cmd.type}_ok`, cmd, value } as WindowMsg);
      continue;
    }

    const notice = pending.findIndex(([at]) => at === i);

    if (notice >= 0) {
      const [, m] = pending.splice(notice, 1)[0]!;
      step(world, i, m);
      continue;
    }

    const other = pending.findIndex(([at]) => at !== i);

    if (other >= 0) {
      const [at] = pending[other]!;
      drain(world, at);
      continue;
    }

    return;
  }

  throw new Error("the window never went quiet");
};

/** The hello exchange on dial 1, as the door runs it: the key, a challenge, a hello, the admission. */
const online = (world: World, i: number) => {
  const w = world.wins[i]!;
  const key = w.waiting.find((c) => c.type === "key");

  if (key !== undefined) {
    step(world, i, { type: "key_ok", cmd: key, value: { found: "created", fingerprint: "SHA256:k" } } as WindowMsg);
  }

  step(world, i, { type: "socket_opened", dial: 1, at: 0 } as WindowMsg);
  step(world, i, {
    type: "frame",
    dial: 1,
    text: rpc({ method: "challenge", params: { nonce: `n0nce${i}` } }),
    at: 1,
  } as WindowMsg);
  const hello = world.wins[i]!.waiting.find((c) => c.type === "hello");

  if (hello !== undefined) {
    step(world, i, { type: "hello_ok", cmd: hello, value: null } as WindowMsg);
    step(world, i, { type: "frame", dial: 1, text: rpc({ id: hello["id"], result: ADMITTED }), at: 2 } as WindowMsg);
  }

  drain(world, i);
};

/** A workspace of `count` tiles split by `cuts`, focus on the tile `focus` picks; tile 1 shows the
 *  boot list's `checklist:1`, every other tile a process tezgah started. */
const desk = (cuts: ReadonlyArray<{ readonly at: number; readonly down: boolean }>, focus: number): TezgahView => {
  const first = typeId("tile", 1) as TileId;
  let w: Workspace = Schema.decodeUnknownSync(Workspace)({
    id: typeId("workspace", 1),
    n: 1,
    layout: first,
    focus: first,
    recent: [first],
  });
  const tiles: Array<Tile> = [tileRow(first, 1, false)];

  for (const [k, cut] of cuts.entries()) {
    const at = Layout.order(w.layout)[cut.at % Layout.order(w.layout).length]!;
    const id = typeId("tile", k + 2) as TileId;
    w = Layout.split(w, at, cut.down ? "column" : "row", id);
    tiles.push(tileRow(id, k + 2, true));
  }

  const on = Layout.order(w.layout)[focus % Layout.order(w.layout).length]!;
  return { workspaces: [{ ...w, focus: on, recent: [on, ...w.recent.filter((t) => t !== on)] }], tiles };
};

/** A world of `count` windows of one person on workspace 1 of `view`, each online with every tile
 *  open, each drawing its tiles in `size`. */
const world = (view: TezgahView, count: number, size = { width: 1440, height: 868 }): World => {
  pending.length = 0;
  const out: World = { rev: 1, view, wins: [], minted: 0, letters: 0, sent: [] };

  for (let i = 0; i < count; i++) {
    const [s, cmds] = machine.init(null, {
      tiles: [],
      tab: `tab_${i + 1}`,
      tezgah: { workspace: 1 },
    } as never) as readonly [WindowModel, ReadonlyArray<Cmd>];
    out.wins.push({ s, waiting: [...cmds], subscribed: false, answered: new Set() });
    step(out, i, { type: "size", ...size } as WindowMsg);
    online(out, i);
  }

  for (const [i, w] of out.wins.entries()) {
    expect(
      w.s.tiles.map((t) => t.reach._tag),
      `window ${i}: every tile of tezgah's workspace is open before the first key`,
    ).toEqual(Layout.order(view.workspaces[0]!.layout).map(() => "open"));
  }

  return out;
};

let clock = 10;

/** One press in window `i`: the key's own step, then everything it set waiting, answered. */
const press = (w: World, i: number, key: string) => {
  const before = w.sent.length;
  const cmds = step(w, i, { type: "key", key, at: (clock += 10) } as WindowMsg);
  drain(w, i);
  return { cmds, sent: w.sent.slice(before) };
};

const prefix = (s: WindowModel) => (s as WindowModel & { readonly prefix: typeof Prefix.Type }).prefix;
const polite = (s: WindowModel) => (s as WindowModel & { readonly polite: unknown }).polite;
const focused = (w: World) => w.view.workspaces[0]!.focus;
const dids = (sent: World["sent"]) => sent.map((x) => x.m as Did);

/** The gap the frame draws between two parts, and its padding: 0492's 4px divider (plan amendment 7). */
const GAP = 4;

type Size = { readonly width: number; readonly height: number };

// Desk S4: the room check measures with the fold's one drawn geometry (plan amendment 13, point 4),
// written here from its words and never read from the product: a strip takes 22px along a row or 20px
// along a column, a container whose tiles all fold takes one strip's size, the open parts share what
// is left by percent, and the part on the focused tile's path is held at `min(220 or 120, what the
// container has)`. A window's strips are the fixpoint: from none, every open tile but the focused one
// drawn under 220x120, again until nothing changes. A split is taken exactly when it folds no tile at
// once: every tile the window draws as a strip after it (focus on the new tile) was a strip before.
const ACROSS = { row: 22, column: 20 } as const;

const tilesIn = (node: Workspace["layout"]): ReadonlyArray<string> =>
  typeof node === "string" ? [node] : node.parts.flatMap((p) => tilesIn(p.inner));

/** Each open tile's drawn size under amendment 13 when `strips` are strips. */
const drawnWith = (w: Workspace, size: Size, strips: ReadonlySet<string>): ReadonlyMap<string, Size> => {
  const out = new Map<string, Size>();
  const walk = (node: Workspace["layout"], box: Size): void => {
    if (typeof node === "string") {
      out.set(node, box);
      return;
    }

    const row = node.dir === "row";
    const left = (row ? box.width : box.height) - (node.parts.length - 1) * GAP;
    const fixed = node.parts.map((p) => tilesIn(p.inner).every((t) => strips.has(t)));
    const has = left - fixed.filter((f) => f).length * ACROSS[node.dir];
    const total = node.parts.reduce((sum, p, i) => (fixed[i] ? sum : sum + p.percent), 0);
    const lead = node.parts.findIndex((p) => tilesIn(p.inner).includes(w.focus));
    let shares = node.parts.map((p, i) => (fixed[i] ? ACROSS[node.dir] : (has * p.percent) / total));
    const least = Math.min(row ? SMALLEST.width : SMALLEST.height, has);

    if (lead >= 0 && shares[lead]! < least) {
      const rest = total - node.parts[lead]!.percent;
      shares = node.parts.map((p, i) => {
        if (i === lead) {
          return least;
        }

        return fixed[i] ? ACROSS[node.dir] : rest > 0 ? ((has - least) * p.percent) / rest : 0;
      });
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

/** A window's strips at `size`, the fixpoint, and whether any round drew a tile within half a pixel
 *  of the floor. */
const foldedAt = (w: Workspace, size: Size) => {
  let strips = new Set<string>();
  let close = false;

  for (;;) {
    const boxes = drawnWith(w, size, strips);
    const open = [...boxes].filter(([t]) => !strips.has(t) && t !== w.focus);
    close ||= open.some(
      ([, r]) => Math.abs(r.width - SMALLEST.width) <= 0.5 || Math.abs(r.height - SMALLEST.height) <= 0.5,
    );
    const due = open.filter(([, r]) => r.width < SMALLEST.width || r.height < SMALLEST.height).map(([t]) => t);

    if (due.length === 0) {
      return { strips, close };
    }

    strips = new Set([...strips, ...due]);
  }
};

const FRESH = typeId("tile", 9_999) as TileId;

/** Whether a split of `at` in `dir` folds no tile at once in the area `size`, and whether that
 *  answer sits within half a pixel of the floor. */
const splitRoom = (view: TezgahView, at: TileId, dir: Dir, size: Size) => {
  const space = Layout.focus(view.workspaces[0]!, at);
  const before = foldedAt(space, size);
  const after = foldedAt(Layout.split(space, at, dir, FRESH), size);
  return { fits: [...after.strips].every((t) => before.strips.has(t)), close: before.close || after.close };
};

/** Whether a split of `at` in `dir` folds no tile at once in the area `size`. */
const fits = (view: TezgahView, at: TileId, dir: Dir, size: Size) => splitRoom(view, at, dir, size).fits;

const KEYS = [PREFIX, "%", '"', "|", "-", "x", "y", "n", "escape", "a", "enter", "o"] as const;

describe("L13: the prefix arms only the window it was pressed in", () => {
  it("L13: across two windows, a key changes only its own window's prefix, nothing but a record leaves before the command is known, and the next key resolves to one command", () => {
    expect(TABLE, "the laws' key table loads").not.toBeNull();
    const counts = { armed: 0, commands: 0, crossed: 0 };
    fc.assert(
      fc.property(
        fc.array(fc.record({ win: fc.integer({ min: 0, max: 1 }), key: fc.constantFrom(...KEYS) }), {
          minLength: 1,
          maxLength: 40,
        }),
        (events) => {
          const w = world(desk([], 0), 2);

          for (const e of events) {
            const me = w.wins[e.win]!;
            const other = w.wins[1 - e.win]!;
            const before = prefix(me.s);
            const otherBefore = prefix(other.s);
            expect(Schema.is(Prefix)(before), "L13: the window's prefix is the Prefix machine's Model").toBe(true);
            const focus = focused(w);
            const shownBefore = w.view;
            const { cmds, sent } = press(w, e.win, e.key);
            const after = prefix(me.s);
            expect(Schema.is(Prefix)(after), "L13: the prefix stays the Prefix machine's Model").toBe(true);
            expect(prefix(other.s), `L13: ${e.key} in window ${e.win} leaves the other window's prefix`).toEqual(
              otherBefore,
            );
            counts.crossed += sent.length > 0 ? 1 : 0;

            const split = SPLITS[e.key];
            const closing = e.key === "x";
            const child = shownBefore.tiles.find((t) => t.id === focus)?.child === true;
            const several = Layout.order(shownBefore.workspaces[0]!.layout).length > 1;

            // A close of a workspace's last tile is tezgah's to refuse (`last_tile`); whether the window
            // asks first is not this law's.
            if (before._tag === "armed" && closing && !several) {
              expect(sent.length, "L13: x resolves to at most one command").toBeLessThanOrEqual(1);
              continue;
            }

            const known =
              (before._tag === "armed" && (split !== undefined || (closing && !(child && several)))) ||
              (before._tag === "asking" && e.key === "y");

            if (before._tag === "idle" && e.key === PREFIX) {
              counts.armed++;
              expect(after._tag, "L13: the prefix key arms the window it was pressed in").toBe("armed");
            }

            if (!known) {
              expect(
                cmds.filter((c) => c.type !== "record").map((c) => c.type),
                `L13: ${e.key} with the prefix ${before._tag} hands out only records`,
              ).toEqual([]);
              expect(sent, `L13: ${e.key} with the prefix ${before._tag} sends nothing`).toEqual([]);
              continue;
            }

            expect(after._tag, `L13: ${e.key} finishes the command and disarms`).toBe("idle");
            expect(sent.length, `L13: ${e.key} resolves to at most one command`).toBeLessThanOrEqual(1);

            if (split !== undefined && fits(shownBefore, focus, split.dir, { width: 1440, height: 868 })) {
              counts.commands++;
              expect(dids(sent), `L13: ${e.key} after the prefix is one ${split.does}`).toMatchObject([
                { type: "did", does: split.does, from: focus, via: { _tag: "key" } },
              ]);
              expect(
                shownBefore.tiles.some((t) => t.id === dids(sent)[0]!.tile),
                "L13: a split names a new tile",
              ).toBe(false);
            }
          }
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
    expect(counts.armed, "L13: the walks arm the prefix").toBeGreaterThan(0);
    expect(counts.commands, "L13: the walks finish commands").toBeGreaterThan(0);
    expect(counts.crossed, "L13: letters reach tezgah").toBeGreaterThan(0);
  });
});

describe("L14: the keys after the prefix (the window's half)", () => {
  it("L14: the prefix again, Escape and an unbound key after the prefix disarm and send nothing", () => {
    const unbound = [PREFIX, "escape", "a", "o", ";", "y", "n", "enter", "ctrl+x", "shift+x", "q"] as const;
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...unbound), { minLength: 1, maxLength: 12 }), (keys) => {
        const w = world(desk([{ at: 0, down: false }], 1), 1);

        for (const key of keys) {
          press(w, 0, PREFIX);
          expect(prefix(w.wins[0]!.s)._tag, "L14: the prefix arms").toBe("armed");
          const { cmds, sent } = press(w, 0, key);
          expect(prefix(w.wins[0]!.s)._tag, `L14: ${key} after the prefix disarms`).toBe("idle");
          expect(sent, `L14: ${key} after the prefix sends nothing`).toEqual([]);
          expect(
            cmds.filter((c) => c.type !== "record").map((c) => c.type),
            `L14: ${key} after the prefix hands out only records`,
          ).toEqual([]);
        }
      }),
      { seed: SEED, numRuns: 200 },
    );
  });
});

describe("L17: a close of a tezgah child asks y/n", () => {
  it("L17: C-b x on a tile tezgah started asks; y sends one close of that tile, n, Escape or any other key sends nothing", () => {
    const after = ["y", "n", "escape", "x", "a", "%", "enter", "space", "Y"] as const;
    const seen = { y: 0, no: 0 };
    fc.assert(
      fc.property(
        fc.array(fc.record({ at: fc.nat(), down: fc.boolean() }), { minLength: 1, maxLength: 3 }),
        fc.nat(),
        fc.array(fc.constantFrom(...after), { minLength: 1, maxLength: 6 }),
        (cuts, pick, keys) => {
          const view = desk(cuts, pick);
          const w = world(view, 1);
          const focus = focused(w);
          const child = view.tiles.find((t) => t.id === focus)!.child;
          fc.pre(child);
          press(w, 0, PREFIX);
          const asked = press(w, 0, "x");
          expect(asked.sent, "L17: the ask sends nothing").toEqual([]);
          expect(prefix(w.wins[0]!.s), "L17: the window asks about the focused tile").toMatchObject({
            _tag: "asking",
            tile: focus,
          });

          const sent = keys.flatMap((key) => press(w, 0, key).sent);
          const closes = dids(sent).filter((d) => d.does === "tezgah.close");

          if (keys[0] === "y") {
            seen.y++;
            expect(closes, "L17: y sends one close of the asked tile").toMatchObject([
              { type: "did", does: "tezgah.close", from: focus, via: { _tag: "key" } },
            ]);
          } else {
            seen.no++;
            expect(closes, `L17: ${keys[0]} after the ask sends no close`).toEqual([]);
          }

          expect(prefix(w.wins[0]!.s)._tag, "L17: the ask has ended").toBe("idle");

          expect(sent.length, "L17: nothing but that close is sent").toBe(closes.length);
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.y, "L17: the walks answer y").toBeGreaterThan(0);
    expect(seen.no, "L17: the walks answer something else").toBeGreaterThan(0);
  });

  it("L17: C-b x on a tile tezgah did not start closes it at once, with no ask", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ at: fc.nat(), down: fc.boolean() }), { minLength: 1, maxLength: 3 }), (cuts) => {
        const view = desk(cuts, 0);
        const w = world(view, 1);
        const focus = focused(w);
        expect(view.tiles.find((t) => t.id === focus)!.child, "the boot list's tile is focused").toBe(false);
        press(w, 0, PREFIX);
        const { sent } = press(w, 0, "x");
        expect(prefix(w.wins[0]!.s)._tag, "L17: no ask for a tile tezgah did not start").toBe("idle");
        expect(dids(sent), "L17: one close of the focused tile").toMatchObject([
          { type: "did", does: "tezgah.close", from: focus, via: { _tag: "key" } },
        ]);
      }),
      { seed: SEED, numRuns: 100 },
    );
  });
});

describe("L18: a split with no room is refused in the window", () => {
  it("L18: a split that would fold a tile at once at this window's size, measured with the fold's one drawn geometry (amendment 13), sends nothing and is said politely; one with room is sent", () => {
    const seen = { refused: 0, sent: 0, folded: 0 };
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: 200, max: 2_600 }),
          height: fc.integer({ min: 150, max: 1_700 }),
          cuts: fc.array(fc.record({ at: fc.nat(), down: fc.boolean() }), { minLength: 0, maxLength: 5 }),
          focus: fc.nat(),
          key: fc.constantFrom("%", '"', "|", "-"),
        }),
        ({ width, height, cuts, focus, key }) => {
          const size = { width, height };
          const view = desk(cuts, focus);
          // The window may already fold some tiles (Desk S4); no round of the fold sits within half a
          // pixel of the floor, so float rounding cannot decide the law.
          const folded = foldedAt(view.workspaces[0]!, size).strips.size > 0;
          const at = view.workspaces[0]!.focus;
          const split = SPLITS[key]!;
          fc.pre(!splitRoom(view, at, split.dir, size).close);
          const w = world(view, 1, size);
          press(w, 0, PREFIX);
          const { cmds, sent } = press(w, 0, key);
          expect(prefix(w.wins[0]!.s)._tag, "L18: the split ends the prefix").toBe("idle");

          if (fits(view, at, split.dir, size)) {
            seen.sent++;
            seen.folded += folded ? 1 : 0;
            expect(dids(sent), `L18: a split with room at ${width}x${height} is sent`).toMatchObject([
              { type: "did", does: split.does, from: at },
            ]);
            return;
          }

          seen.refused++;
          expect(sent, `L18: a split with no room at ${width}x${height} sends nothing`).toEqual([]);
          expect(
            cmds.filter((c) => c.type !== "record").map((c) => c.type),
            "L18: a refused split mints nothing",
          ).toEqual([]);
          expect(polite(w.wins[0]!.s), "L18: the refusal is said politely, naming the tile").toEqual({
            _tag: "no_room",
            tile: at,
          });
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
    expect(seen.refused, "L18: the walks refuse splits").toBeGreaterThan(0);
    expect(seen.sent, "L18: the walks send splits").toBeGreaterThan(0);
    expect(seen.folded, "L18: the walks send splits from a window that already folds a tile").toBeGreaterThan(0);
  });

  it("L18: at the floor's edge, one tile's split is taken exactly when its drawn halves, one gap between them, reach 220x120", () => {
    const seen = { refused: 0, taken: 0 };
    /** One tile, its area a few pixels either side of two floors and a gap on the split's own side. */
    const Edge = fc.oneof(
      fc.record({
        key: fc.constantFrom("%", "|"),
        width: fc.integer({ min: 2 * SMALLEST.width + GAP - 12, max: 2 * SMALLEST.width + GAP + 12 }),
        height: fc.integer({ min: SMALLEST.height, max: 1_700 }),
      }),
      fc.record({
        key: fc.constantFrom('"', "-"),
        width: fc.integer({ min: SMALLEST.width, max: 2_600 }),
        height: fc.integer({ min: 2 * SMALLEST.height + GAP - 12, max: 2 * SMALLEST.height + GAP + 12 }),
      }),
    );
    fc.assert(
      fc.property(Edge, (c) => {
        const view = desk([], 0);
        const at = view.workspaces[0]!.focus;
        const dir = SPLITS[c.key]!.dir;
        // The rule as decided (plan amendment 7): each drawn half is what is left after one gap, halved.
        const half = ((dir === "row" ? c.width : c.height) - GAP) / 2;
        const taken = half >= (dir === "row" ? SMALLEST.width : SMALLEST.height);
        seen[taken ? "taken" : "refused"]++;
        expect(fits(view, at, dir, c), `the drawn rule at ${c.width}x${c.height}`).toBe(taken);
        const w = world(view, 1, { width: c.width, height: c.height });
        press(w, 0, PREFIX);
        const { sent } = press(w, 0, c.key);
        expect(
          dids(sent).length,
          `L18: ${c.key} in a ${c.width}x${c.height} area is ${taken ? "taken" : "refused"}`,
        ).toBe(taken ? 1 : 0);
        expect(polite(w.wins[0]!.s), `L18: ${c.width}x${c.height} says the refusal, or nothing`).toEqual(
          taken ? null : { _tag: "no_room", tile: at },
        );
      }),
      {
        seed: SEED,
        numRuns: 200,
        // pinned: the first review of S2b (bug: the room check measured bare percent shares, ignoring
        // the frame's 4px padding and its 4px divider). A 444x600 area drawn with its padding is a size
        // Msg of 436x592; C-b % there drew two tiles about 216px wide. The cases sit on both sides of
        // the floor, the middle one where bare shares say 220 and drawn tiles are 218.
        examples: [
          [{ key: "%", width: 436, height: 592 }],
          [{ key: "%", width: 440, height: 592 }],
          [{ key: "%", width: 444, height: 592 }],
          [{ key: '"', width: 592, height: 236 }],
          [{ key: '"', width: 592, height: 240 }],
          [{ key: '"', width: 592, height: 244 }],
        ],
      },
    );
    expect(seen.refused, "L18: the walks refuse splits at the edge").toBeGreaterThan(0);
    expect(seen.taken, "L18: the walks take splits at the edge").toBeGreaterThan(0);
  });
});

// Desk S4, next/: law L32's "never sent" half on the split path (plan amendment 12, point 5). The window
// machine's laws walk focus moves; here a person's keys walk splits and closes in a window whose size
// folds some of its tiles. A fold is the viewer's (0277): the window works it out from its size and
// never sends it, so every letter to tezgah carries only the keys of tezgah's `did` (the plan's "The
// shape") and nothing that names a fold or a strip, whatever the window folds when it sends it.
/** The keys of tezgah's `did`: what a letter from a window may carry. */
const DID_KEYS = new Set(["type", "does", "from", "via", "tile", "to", "cursor"]);
const FOLDED = /fold|strip/i;

/** Every key in a value, at any depth. */
const keysIn = (v: unknown): ReadonlyArray<string> =>
  Array.isArray(v)
    ? v.flatMap(keysIn)
    : v !== null && typeof v === "object"
      ? Object.entries(v).flatMap(([k, x]) => [k, ...keysIn(x)])
      : [];

/** How many tiles a window of `size` draws as strips, by the plan's rule written here: every tile
 *  but the focused one drawn under 220x120. */
const stripCount = (view: TezgahView, size: Size) => {
  return foldedAt(view.workspaces[0]!, size).strips.size;
};

describe("Desk S4 L32: a split's letter never carries a fold", () => {
  it("L32 (the split path): in a window whose size folds some of its tiles, every letter its keys send tezgah, a split or a close, carries only did's keys and nothing about folds or strips", () => {
    const seen = { splits: 0, folded: 0 };
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: 480, max: 1_600 }),
          height: fc.integer({ min: 300, max: 1_000 }),
          cuts: fc.array(fc.record({ at: fc.nat(), down: fc.boolean() }), { minLength: 1, maxLength: 6 }),
          focus: fc.nat(),
          keys: fc.array(fc.constantFrom(PREFIX, PREFIX, "%", '"', "|", "-", "x", "y"), {
            minLength: 2,
            maxLength: 24,
          }),
        }),
        ({ width, height, cuts, focus, keys }) => {
          const size = { width, height };
          const w = world(desk(cuts, focus), 1, size);

          for (const key of keys) {
            const strips = stripCount(w.view, size);
            const { sent } = press(w, 0, key);

            for (const m of sent.map((x) => x.m)) {
              expect(
                Object.keys(Object(m)).filter((k) => !DID_KEYS.has(k)),
                "L32: a letter to tezgah carries only did's keys",
              ).toEqual([]);
              expect(
                keysIn(m).filter((k) => FOLDED.test(k)),
                "L32: a letter to tezgah names no fold",
              ).toEqual([]);
            }

            const splits = dids(sent).filter((d) => d.does !== "tezgah.close").length;
            seen.splits += splits;
            seen.folded += strips > 0 ? splits : 0;
          }
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.splits, "L32: the walks send splits").toBeGreaterThan(0);
    expect(seen.folded, "L32: the walks send splits from a window that folds some of its tiles").toBeGreaterThan(0);
  });
});
