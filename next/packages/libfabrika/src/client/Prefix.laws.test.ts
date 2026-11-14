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
import { Result, Schema } from "effect";
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
      const value =
        cmd.type === "now"
          ? { letter: `letter_${++world.letters}`, sentAt: "2026-11-14T00:00:00.000Z" }
          : cmd.type === "mint"
            ? { tile: typeId("tile", 5_000 + ++world.minted) }
            : cmd.type === "persist"
              ? true
              : null;
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
    const [s, cmds] = machine.init(null, { tiles: [], tezgah: { workspace: 1 } } as never) as readonly [
      WindowModel,
      ReadonlyArray<Cmd>,
    ];
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

/** Each tile's drawn size in the area `size` the window lays its parts out in, by the plan's seventh
 *  amendment, written here from the rule and never from the product's `rects`: a container leaves
 *  `parts - 1` gaps between its parts, and each part takes its percent of what is left. */
const drawn = (layout: Workspace["layout"], size: Size): ReadonlyMap<string, Size> => {
  const out = new Map<string, Size>();
  const walk = (node: Workspace["layout"], box: Size): void => {
    if (typeof node === "string") {
      out.set(node, box);
      return;
    }

    const left = (node.dir === "row" ? box.width : box.height) - (node.parts.length - 1) * GAP;

    for (const p of node.parts) {
      const share = (left * p.percent) / 100;
      walk(p.inner, node.dir === "row" ? { width: share, height: box.height } : { width: box.width, height: share });
    }
  };
  walk(layout, size);
  return out;
};

/** The split of `at` in `dir`, drawn: the size of `at` and of the new tile. */
const halves = (view: TezgahView, at: TileId, dir: Dir, size: Size): ReadonlyArray<Size> => {
  const fresh = typeId("tile", 9_999) as TileId;
  const after = drawn(Layout.split(view.workspaces[0]!, at, dir, fresh).layout, size);
  return [after.get(at)!, after.get(fresh)!];
};

/** Whether a split of `at` in `dir` draws both halves at least 220x120 in the area `size`. */
const fits = (view: TezgahView, at: TileId, dir: Dir, size: Size) =>
  halves(view, at, dir, size).every((h) => h.width >= SMALLEST.width && h.height >= SMALLEST.height);

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
  it("L18: a split that would leave a tile under 220x120 at this window's size sends nothing and is said politely; one with room is sent", () => {
    const seen = { refused: 0, sent: 0 };
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
          const before = drawn(view.workspaces[0]!.layout, size);
          // Every tile fits before the split, and no half sits within half a pixel of the floor, so
          // the two readings of "a tile under the floor" and float rounding cannot disagree.
          fc.pre([...before.values()].every((r) => r.width >= SMALLEST.width && r.height >= SMALLEST.height));
          const at = view.workspaces[0]!.focus;
          const split = SPLITS[key]!;
          fc.pre(
            halves(view, at, split.dir, size).every(
              (h) => Math.abs(h.width - SMALLEST.width) > 0.5 && Math.abs(h.height - SMALLEST.height) > 0.5,
            ),
          );
          const w = world(view, 1, size);
          press(w, 0, PREFIX);
          const { cmds, sent } = press(w, 0, key);
          expect(prefix(w.wins[0]!.s)._tag, "L18: the split ends the prefix").toBe("idle");

          if (fits(view, at, split.dir, size)) {
            seen.sent++;
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
  });

  // pinned: the first review of S2b (bug: the room check measured bare percent shares, ignoring the
  // frame's 4px padding and its 4px divider). A 444x600 area drawn with its padding is a size Msg of
  // 436x592; C-b % there drew two tiles about 216px wide. The cases sit on both sides of the floor,
  // the middle one where bare shares say 220 and drawn tiles are 218.
  it('pinned: one tile in a 436x592, 440x592 area refuses C-b % and in 444x592 takes it; 592x236, 592x240 refuse C-b " and 592x244 takes it', () => {
    const cases = [
      { width: 436, height: 592, key: "%", taken: false },
      { width: 440, height: 592, key: "%", taken: false },
      { width: 444, height: 592, key: "%", taken: true },
      { width: 592, height: 236, key: '"', taken: false },
      { width: 592, height: 240, key: '"', taken: false },
      { width: 592, height: 244, key: '"', taken: true },
    ] as const;

    for (const c of cases) {
      const view = desk([], 0);
      const at = view.workspaces[0]!.focus;
      expect(fits(view, at, SPLITS[c.key]!.dir, c), `the drawn rule at ${c.width}x${c.height}`).toBe(c.taken);
      const w = world(view, 1, { width: c.width, height: c.height });
      press(w, 0, PREFIX);
      const { sent } = press(w, 0, c.key);
      expect(
        dids(sent).length,
        `L18: ${c.key} in a ${c.width}x${c.height} area is ${c.taken ? "taken" : "refused"}`,
      ).toBe(c.taken ? 1 : 0);
      expect(polite(w.wins[0]!.s), `L18: ${c.width}x${c.height} says the refusal, or nothing`).toEqual(
        c.taken ? null : { _tag: "no_room", tile: at },
      );
    }
  });
});
