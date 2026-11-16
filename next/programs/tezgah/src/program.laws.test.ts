// Desk S2a, next/ (the desk program fabrika/tezgah, ticket named by its title): laws L6, L7, L8's
// pure half, L9 and L11's program half of the approved plan, on the real program through the
// library's own `stepper`, the pure step the runner itself takes: a fresh letter is checked, maybe
// refused, then stepped; an answer to a Cmd is folded as the runner saves it. Written before
// `program.ts` exists. L8's real half runs on the real instance (`RunnerTest.ts`, run by the app's
// `tezgah-runner.laws.integration.test.ts`).
//
// The shape these laws hold `program.ts` to, from the plan (the build may add more):
// - It exports `tezgah`, `Program.make({ name: "fabrika/tezgah", ... })`, whose Cmds are the
//   built-in `start_child` and `stop_child`.
// - Its view is `TezgahView`: {workspaces: [{id, n, layout, focus, recent}], tiles: [{id, n, shows,
//   program, child, keep, cursor}]}. A layout is a tile id or {dir: "row" | "column", parts:
//   [{percent, inner}]}. `tiles` holds every tile some workspace's layout holds, and no other.
// - Msg `attach {workspace, tile}`: a window's first look. A workspace that does not exist yet asks
//   for one `start_child` for its first tile and changes nothing else; its `start_child_ok` makes
//   workspace `workspace` with that one tile, focused, showing the start's `name`. (Workspace 1's
//   first tile shows the boot list's `checklist:1`, whose start answers `already_started`.)
// - Msg `did {does, from, via, tile?}`: `does` is `tezgah.split_right`, `tezgah.split_down` or
//   `tezgah.close`; `from` is the tile the command was given in; `via` is the keybindings note's Via,
//   `{_tag: "key", keys}` here; a split's `tile` is the new tile's id, minted by the window.
// - A split asks for one `start_child` and changes nothing else (L6); its tile enters the layout on
//   that start's `start_child_ok`, after `from`, with half of `from`'s share (a split right takes
//   the right half of `from`'s rectangle, a split down the bottom half), and takes focus. The new
//   tile shows the start's `name` and `program`, `child` true when the answer is `started`, and a
//   null cursor. A `start_child_err` drops the split and changes nothing.
// - A close removes `from` at once. When `from` had focus, focus goes to the next open tile after it
//   in reading order, else the one before (the tile guidelines' rule B). A close of a tile tezgah
//   started (`child`) asks one `stop_child {name: shows}`; any other close asks for none (L8).
// - `refuse` (L7, L9): `last_tile` for a close of a workspace's only tile; `id_reused` for a split
//   whose `tile` is already a tile's or a waiting split's; `missing` for a `from` on no workspace;
//   `no_workspace` for any `did` while tezgah has no workspace at all. A refusal changes nothing.
//
// Every law walks: each move is picked from what is possible in the state the walk folded, such as a
// split from a live tile, an answer to a start that is really waiting, or a close of a live tile.
//
// Plan amendment, 2026-11-14 (after S2a's tests step), two cases the walk now reaches on purpose:
// - L6: a close of the tile a waiting split is placed at, before its `start_child` answers. On the
//   answer the new tile goes after the workspace's focused tile, with half of that tile's share, in
//   the split's direction; the started process is never lost: the tile shows it.
// - L9: an `attach` of a workspace that already exists changes nothing: it is taken, not refused,
//   and the view, the model and the Cmds stay as they were.
import { arbMsgSequence } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { type Stepper, stepper } from "@kampus/libfabrika";
import { Result, Schema } from "effect";
import * as fc from "fast-check";

/** The key of each Msg, Cmd and answer these laws write or expect, made by a schema (0569, 0562).
 *  A law hands over only the fields it reads, so a case holds the key alone. */
const Tag = Schema.TaggedUnion({
  attach: {},
  did: {},
  start_child_err: {},
  start_child_ok: {},
  stop_child_err: {},
  stop_child_ok: {},
});

const SEED = 119120;
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
// Loaded per law, so a missing module reds its law and not the file's collection.
const load = () => import("./program.ts");

/** A canonical UUIDv7 TypeID for `n`, made here so the laws do not lean on the generator they check. */
const typeId = (prefix: string, n: number): string => {
  let uuid = (BigInt(n) << 80n) | (7n << 76n) | (2n << 62n);
  let suffix = "";

  for (let i = 0; i < 26; i++) {
    suffix = ALPHABET[Number(uuid & 31n)] + suffix;
    uuid >>= 5n;
  }

  return `${prefix}_${suffix}`;
};

type Node = string | { readonly dir: string; readonly parts: ReadonlyArray<{ percent: number; inner: Node }> };

const isNode = (u: unknown): u is Node =>
  typeof u === "string" ||
  (typeof u === "object" &&
    u !== null &&
    "dir" in u &&
    "parts" in u &&
    Array.isArray(u.parts) &&
    u.parts.every(
      (p: unknown) =>
        typeof p === "object" &&
        p !== null &&
        "percent" in p &&
        typeof p.percent === "number" &&
        "inner" in p &&
        isNode(p.inner),
    ));

/** The view as a client reads it, written here so a dropped field shows (L11's program half). */
const View = Schema.Struct({
  workspaces: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      n: Schema.Int,
      layout: Schema.declare<Node>(isNode),
      focus: Schema.String,
      recent: Schema.Array(Schema.String),
    }),
  ),
  tiles: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      n: Schema.Int,
      shows: Schema.String,
      program: Schema.String,
      child: Schema.Boolean,
      keep: Schema.Literals(["never", "failed", "always"]),
      cursor: Schema.NullOr(Schema.String),
    }),
  ),
});
type View = typeof View.Type;
type Space = View["workspaces"][number];
type Tile = View["tiles"][number];

/** Reading order: a container's parts in order, depth first. */
const order = (node: Node): ReadonlyArray<string> =>
  typeof node === "string" ? [node] : node.parts.flatMap((p) => order(p.inner));

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** Each tile's rectangle in the unit square: a row splits the width by percent, a column the height. */
const rects = (node: Node, r: Rect = { x: 0, y: 0, w: 1, h: 1 }, out = new Map<string, Rect>()) => {
  if (typeof node === "string") {
    out.set(node, r);
    return out;
  }

  let at = 0;

  for (const p of node.parts) {
    const share = p.percent / 100;
    rects(
      p.inner,
      node.dir === "row"
        ? { x: r.x + r.w * at, y: r.y, w: r.w * share, h: r.h }
        : { x: r.x, y: r.y + r.h * at, w: r.w, h: r.h * share },
      out,
    );
    at += share;
  }

  return out;
};

const near = (a: Rect | undefined, b: Rect, label: string) => {
  expect(a, label).toBeDefined();

  for (const k of ["x", "y", "w", "h"] as const) {
    expect(Math.abs((a?.[k] ?? Number.NaN) - b[k]), `${label}: ${k}`).toBeLessThan(1e-9);
  }
};

type Cmd = { readonly _tag: string; readonly [key: string]: unknown };

type Waiting =
  | { readonly _tag: "attach"; readonly workspace: number; readonly tile: string; readonly cmd: Cmd }
  | {
      readonly _tag: "split";
      readonly from: string;
      readonly tile: string;
      readonly dir: Dir;
      readonly cmd: Cmd;
      /** The workspace `from` was on when the split was asked. */
      readonly space: string;
    };

type Dir = "right" | "down";
const DOES = { right: "tezgah.split_right", down: "tezgah.split_down" } as const;

/** What the walk keeps beside the program's saved model: the starts waiting on an answer. */
type World = {
  model: unknown;
  view: View;
  waiting: Array<Waiting>;
  stops: Array<Cmd>;
  next: number;
  at: number;
};

/** One fold of the walk, with what it was, what it became and what it asked for. */
type Event = {
  readonly move: string;
  readonly before: View;
  readonly after: View;
  readonly result: { readonly _tag: string; readonly reason?: string };
  readonly cmds: ReadonlyArray<Cmd>;
  readonly waiting?: Waiting;
  readonly answer?: "started" | "already_started" | "refused";
  readonly from?: string;
};

const spaceWith = (v: View, tile: string): Space | undefined =>
  v.workspaces.find((w) => order(w.layout).includes(tile));

const live = (v: View): ReadonlyArray<string> => v.workspaces.flatMap((w) => order(w.layout));

/** A world at the program's real init, through the stepper. */
const begin = (p: Stepper): World => {
  const s = p.init(null);
  expect(s._tag).toBe("stepped");
  const stepped = s as Extract<typeof s, { _tag: "stepped" }>;
  return {
    model: stepped.model,
    view: Schema.decodeUnknownSync(View)(stepped.view),
    waiting: [],
    stops: [],
    next: 1,
    at: 1,
  };
};

/** One letter or answer through the stepper; a stepped answer moves the world on. */
const take = (p: Stepper, w: World, msg: unknown, saved: boolean) => {
  const s = saved ? p.fold(w.model, msg) : p.step(w.model, msg);
  const before = w.view;

  if (s._tag === "stepped") {
    w.model = s.model;
    // L11's program half: every view decodes as a client reads it, `child` and all.
    w.view = Schema.decodeUnknownSync(View)(s.view);
    const cmds = s.cmds as ReadonlyArray<Cmd>;
    w.stops.push(...cmds.filter((c) => c._tag === "stop_child"));
    return { before, after: w.view, result: { _tag: "stepped" }, cmds };
  }

  return { before, after: w.view, result: { _tag: s._tag, reason: s.reason }, cmds: [] as ReadonlyArray<Cmd> };
};

const via = { _tag: "key", keys: "ctrl+b %" };
const starts = (cmds: ReadonlyArray<Cmd>) => cmds.filter((c) => c._tag === "start_child");

/** The answer a start gets: `started`, or for an attach maybe the boot list's `already_started`. */
const started = (cmd: Cmd, kind: "started" | "already_started", w: World) => {
  const process = typeId("process", 500 + w.next++);
  return kind === "started"
    ? { _tag: "started", process, name: cmd["name"], rev: w.at }
    : { _tag: "already_started", process, name: cmd["name"] };
};

type Kind =
  | "attach"
  | "reattach"
  | "attach_reused"
  | "split_right"
  | "split_down"
  | "close"
  | "close_waiting"
  | "answer"
  | "refuse"
  | "stop"
  | "reused"
  | "unknown";

/** One move of `kind`, picked from what is possible in `w`, or null when nothing of that kind is. */
const move = (p: Stepper, w: World, kind: Kind, pick: number): Event | null => {
  const tiles = live(w.view);
  const pending = new Set(w.waiting.flatMap((x) => (x._tag === "split" ? [x.from] : [])));
  const ids = new Set([...tiles, ...w.waiting.map((x) => x.tile)]);
  w.at++;

  switch (kind) {
    case "attach": {
      const free = [1, 2, 3].filter(
        (n) =>
          !w.view.workspaces.some((s) => s.n === n) && !w.waiting.some((x) => x._tag === "attach" && x.workspace === n),
      );
      const n = free[pick % Math.max(free.length, 1)];

      if (n === undefined) {
        return null;
      }

      const tile = typeId("tile", w.next++);
      const e = take(p, w, { ...Tag.cases.attach.make({}), workspace: n, tile }, false);
      const cmd = starts(e.cmds)[0];

      if (cmd !== undefined) {
        w.waiting.push({ _tag: "attach", workspace: n, tile, cmd });
      }

      return { move: `attach ${n} ${tile}`, ...e };
    }

    case "split_right":
    case "split_down": {
      const from = tiles[pick % Math.max(tiles.length, 1)];

      if (from === undefined) {
        return null;
      }

      const dir: Dir = kind === "split_right" ? "right" : "down";
      const tile = typeId("tile", w.next++);
      const e = take(p, w, { ...Tag.cases.did.make({}), does: DOES[dir], from, via, tile }, false);
      const cmd = starts(e.cmds)[0];
      const space = spaceWith(w.view, from)?.id ?? "";
      const waiting: Waiting | undefined =
        cmd === undefined ? undefined : { _tag: "split", from, tile, dir, cmd, space };

      if (waiting !== undefined) {
        w.waiting.push(waiting);
      }

      return { move: `split ${dir} ${from} -> ${tile}`, ...e, from, ...(waiting === undefined ? {} : { waiting }) };
    }

    case "reattach": {
      const n = w.view.workspaces[pick % Math.max(w.view.workspaces.length, 1)]?.n;

      if (n === undefined) {
        return null;
      }

      return {
        move: `reattach ${n}`,
        ...take(p, w, { ...Tag.cases.attach.make({}), workspace: n, tile: typeId("tile", w.next++) }, false),
      };
    }

    case "close_waiting":
    case "close": {
      const free = tiles.filter((t) => (kind === "close") !== pending.has(t));
      const from = free[pick % Math.max(free.length, 1)];

      if (from === undefined) {
        return null;
      }

      return {
        move: `close ${from}`,
        ...take(p, w, { ...Tag.cases.did.make({}), does: "tezgah.close", from, via }, false),
        from,
      };
    }

    case "answer":
    case "refuse": {
      const waiting = w.waiting[pick % Math.max(w.waiting.length, 1)];

      if (waiting === undefined) {
        return null;
      }

      w.waiting = w.waiting.filter((x) => x !== waiting);

      if (kind === "refuse") {
        const error = { _tag: (["forbidden", "bad_name", "name_taken"] as const)[pick % 3] };
        return {
          move: `refuse ${waiting.tile}`,
          ...take(p, w, { ...Tag.cases.start_child_err.make({}), cmd: waiting.cmd, error, at: w.at }, true),
          waiting,
          answer: "refused",
        };
      }

      const answer = waiting._tag === "attach" && pick % 2 === 0 ? "already_started" : "started";
      const value = started(waiting.cmd, answer, w);
      return {
        move: `${answer} ${waiting.tile}`,
        ...take(p, w, { ...Tag.cases.start_child_ok.make({}), cmd: waiting.cmd, value, at: w.at }, true),
        waiting,
        answer,
      };
    }

    case "stop": {
      const cmd = w.stops[pick % Math.max(w.stops.length, 1)];

      if (cmd === undefined) {
        return null;
      }

      w.stops = w.stops.filter((c) => c !== cmd);
      const msg =
        pick % 3 === 0
          ? { ...Tag.cases.stop_child_err.make({}), cmd, error: { _tag: "noproc" }, at: w.at }
          : { ...Tag.cases.stop_child_ok.make({}), cmd, value: null, at: w.at };
      return { move: `stop answer ${String(cmd["name"])}`, ...take(p, w, msg, true) };
    }

    case "attach_reused": {
      // An attach of a new workspace whose first tile id is already a live tile's, or a waiting
      // start's: a reused id, which would put one tile on two workspaces.
      const free = [1, 2, 3, 4].filter(
        (n) =>
          !w.view.workspaces.some((s) => s.n === n) && !w.waiting.some((x) => x._tag === "attach" && x.workspace === n),
      );
      const n = free[pick % Math.max(free.length, 1)];
      const known = pick % 2 === 0 ? tiles : w.waiting.map((x) => x.tile);
      const reused = known[(pick >> 1) % Math.max(known.length, 1)];

      if (n === undefined || reused === undefined) {
        return null;
      }

      return {
        move: `attach ${n} reusing ${pick % 2 === 0 ? "live" : "waiting"} ${reused}`,
        ...take(p, w, { ...Tag.cases.attach.make({}), workspace: n, tile: reused }, false),
      };
    }

    case "reused": {
      const reused = [...ids][pick % Math.max(ids.size, 1)];
      const from = tiles[(pick >> 3) % Math.max(tiles.length, 1)];

      if (reused === undefined || from === undefined) {
        return null;
      }

      const does = pick % 2 === 0 ? DOES.right : DOES.down;
      return {
        move: `split reusing ${reused}`,
        ...take(p, w, { ...Tag.cases.did.make({}), does, from, via, tile: reused }, false),
        from,
      };
    }

    case "unknown": {
      const from = typeId("tile", 90_000 + w.next++);
      const does = (["tezgah.split_right", "tezgah.split_down", "tezgah.close"] as const)[pick % 3];
      const msg = {
        ...Tag.cases.did.make({}),
        does,
        from,
        via,
        ...(does === "tezgah.close" ? {} : { tile: typeId("tile", w.next++) }),
      };
      return { move: `${does} from unknown ${from}`, ...take(p, w, msg, false), from };
    }
  }
};

/** fc.commands over the walk: each command is one kind, run only where the world allows it. */
const tape = (kinds: ReadonlyArray<Kind>, most: number) =>
  fc.commands(
    kinds.map((kind) =>
      fc.nat().map((pick): fc.Command<{ events: Array<Event> }, { p: Stepper; w: World }> => ({
        check: () => true,
        run: (m, r) => {
          const e = move(r.p, r.w, kind, pick);

          if (e !== null) {
            m.events.push(e);
          }
        },
        toString: () => `${kind} ${pick}`,
      })),
    ),
    { maxCommands: most, size: "max" },
  );

/** Runs one tape from the real init, with workspace 1 attached first, and hands every event to `each`. */
const walk = (p: Stepper, cmds: Iterable<fc.Command<{ events: Array<Event> }, { p: Stepper; w: World }>>) => {
  const w = begin(p);
  const events: Array<Event> = [];
  const first = move(p, w, "attach", 0);
  const opened = move(p, w, "answer", 0);
  events.push(...(first === null ? [] : [first]), ...(opened === null ? [] : [opened]));
  fc.modelRun(() => ({ model: { events }, real: { p, w } }), cmds);
  return events;
};

const loaded = async () => {
  const { tezgah } = await load();
  const p = stepper(tezgah);
  expect(Result.isSuccess(p), "the program's declaration loads").toBe(true);
  return Result.getOrThrow(p);
};

describe("Desk S2a: tezgah's layout changes, at the program", () => {
  it("L6: a split puts the new tile after the focused one with half its share, and focus moves to it, only after start_child_ok", async () => {
    const p = await loaded();
    const seen = { asked: 0, dropped: 0, placed: 0, attached: 0, rehomed: 0 };
    fc.assert(
      fc.property(
        tape(
          ["split_right", "split_down", "answer", "refuse", "attach", "close", "close_waiting", "close_waiting"],
          40,
        ),
        (cmds) => {
          const events = walk(p, cmds);
          expect(
            events.slice(0, 2).map((e) => [e.result._tag, starts(e.cmds).length, live(e.after).length]),
            "L6: each walk's attach asks for one start and shows nothing, and its answer makes workspace 1's one tile",
          ).toEqual([
            ["stepped", 1, 0],
            ["stepped", 0, 1],
          ]);

          for (const e of events) {
            if (e.move.startsWith("split") && e.waiting !== undefined) {
              seen.asked++;
              expect(e.result._tag, `L6: ${e.move} is taken`).toBe("stepped");
              expect(e.after, `L6: ${e.move} changes no view before its start answers`).toEqual(e.before);
              expect(starts(e.cmds), `L6: ${e.move} asks for one start`).toHaveLength(1);
              expect(live(e.after), `L6: ${e.move}'s tile is not on any workspace yet`).not.toContain(e.waiting.tile);
            }

            if (e.waiting?._tag === "split" && e.answer === "refused") {
              seen.dropped++;
              expect(e.after, `L6: ${e.move} drops the split and changes nothing`).toEqual(e.before);
            }

            if (e.waiting?._tag === "split" && e.answer === "started") {
              seen.placed++;
              const { tile, dir, cmd, space: home } = e.waiting;
              const was = e.before.workspaces.find((s) => s.id === home);
              // Plan amendment (a): a split whose tile was closed while its start waited is placed
              // after the workspace's focused tile instead.
              const gone = !live(e.before).includes(e.waiting.from);
              seen.rehomed += gone ? 1 : 0;
              const from = gone ? was!.focus : e.waiting.from;
              const now = spaceWith(e.after, tile);
              expect(was, `L6: ${e.waiting.from}'s workspace is still there`).toBeDefined();
              expect(now?.id, `L6: ${tile} joins the split's workspace, never lost`).toBe(was?.id);
              const old = rects(was!.layout);
              const fresh = rects(now!.layout);
              const r = old.get(from)!;
              const half =
                dir === "right"
                  ? { kept: { ...r, w: r.w / 2 }, made: { ...r, x: r.x + r.w / 2, w: r.w / 2 } }
                  : { kept: { ...r, h: r.h / 2 }, made: { ...r, y: r.y + r.h / 2, h: r.h / 2 } };
              near(fresh.get(from), half.kept, `L6: ${from} keeps the first half after a split ${dir}`);
              near(fresh.get(tile), half.made, `L6: ${tile} takes the second half, after ${from}`);

              for (const [other, rect] of old) {
                if (other !== from) {
                  near(fresh.get(other), rect, `L6: ${other} keeps its place`);
                }
              }

              const shown = order(now!.layout);
              expect(shown.indexOf(tile), `L6: ${tile} follows ${from} in reading order`).toBe(shown.indexOf(from) + 1);
              expect(now?.focus, "L6: focus moves to the new tile").toBe(tile);
              expect(now?.recent[0], "L6: the new tile is the newest in recent").toBe(tile);
              const made = e.after.tiles.find((t) => t.id === tile);
              expect(
                made,
                "L6: the new tile shows the started process, as tezgah's child, with no cursor",
              ).toMatchObject({
                shows: cmd["name"],
                program: cmd["program"],
                child: true,
                cursor: null,
              });
              expect(new Set(e.after.tiles.map((t) => t.n)).size, "L6: each tile has its own t<n>").toBe(
                e.after.tiles.length,
              );

              for (const space of e.after.workspaces) {
                if (space.id !== now?.id) {
                  expect(space, "L6: another workspace is untouched").toEqual(
                    e.before.workspaces.find((s) => s.id === space.id),
                  );
                }
              }
            }

            if (e.waiting?._tag === "attach" && e.answer !== undefined && e.answer !== "refused") {
              seen.attached++;
              const { workspace, tile } = e.waiting;
              const space = e.after.workspaces.find((s) => s.n === workspace);
              expect(space, "L6: an attach's answer makes its workspace with its one tile, focused").toMatchObject({
                layout: e.waiting.tile,
                focus: e.waiting.tile,
                recent: [e.waiting.tile],
              });
              expect(
                e.after.tiles.find((t) => t.id === tile),
                "L6: the first tile shows its start",
              ).toMatchObject({
                shows: e.waiting.cmd["name"],
                child: e.answer === "started",
              });
            }

            if (e.result._tag === "stepped") {
              expect([...e.after.tiles.map((t) => t.id)].sort(), `${e.move}: the tiles are the layouts' tiles`).toEqual(
                [...live(e.after)].sort(),
              );
            }
          }
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    // Every case of the law was walked: a split asked, refused, placed, placed after the focused
    // tile once its own tile closed (plan amendment (a)), and a workspace attached.
    expect(
      Object.values(seen).every((n) => n > 0),
      `L6: the walks reached every case ${JSON.stringify(seen)}`,
    ).toBe(true);
  });

  it("L7: closing the last tile is refused last_tile and changes nothing; a close sends focus to the next open tile in reading order", async () => {
    const p = await loaded();
    const seen = { last: 0, heir: 0, kept: 0 };
    fc.assert(
      fc.property(
        tape(["close", "close", "close_waiting", "split_right", "split_down", "answer", "answer", "attach"], 40),
        (cmds) => {
          for (const e of walk(p, cmds)) {
            if (!e.move.startsWith("close") || e.from === undefined) {
              continue;
            }

            const space = spaceWith(e.before, e.from)!;
            const was = order(space.layout);

            if (was.length === 1) {
              seen.last++;
              expect(e.result, "L7: the last tile of a workspace never closes").toEqual({
                _tag: "refused",
                reason: "last_tile",
              });
              expect(e.after, "L7: a refused close changes nothing").toEqual(e.before);
              continue;
            }

            expect(e.result._tag, `L7: ${e.move} is taken`).toBe("stepped");
            const now = e.after.workspaces.find((s) => s.id === space.id)!;
            expect(order(now.layout), `L7: ${e.from} leaves and the rest keep their order`).toEqual(
              was.filter((t) => t !== e.from),
            );
            const i = was.indexOf(e.from);
            const heir = was[i + 1] ?? was[i - 1];
            seen[space.focus === e.from ? "heir" : "kept"]++;
            expect(now.focus, "L7: focus goes to the next open tile in reading order, else the one before").toBe(
              space.focus === e.from ? heir : space.focus,
            );
            expect(now.recent, "L7: recent drops the closed tile").not.toContain(e.from);
            expect(
              e.after.tiles.map((t) => t.id),
              "L7: the closed tile leaves the tiles",
            ).not.toContain(e.from);
          }
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    expect(
      Object.values(seen).every((n) => n > 0),
      `L7: the walks reached every case ${JSON.stringify(seen)}`,
    ).toBe(true);
  });

  it("L8: a close of a tile tezgah started asks one stop_child for its process; a close of any other tile asks for none", async () => {
    const p = await loaded();
    const seen = { child: 0, other: 0 };
    fc.assert(
      fc.property(
        tape(["attach", "answer", "split_right", "split_down", "answer", "close", "close", "stop"], 30),
        (cmds) => {
          for (const e of walk(p, cmds)) {
            const stops = e.cmds.filter((c) => c._tag === "stop_child");

            if (!e.move.startsWith("close") || e.from === undefined || e.result._tag !== "stepped") {
              expect(stops, `L8: ${e.move} stops nothing`).toEqual([]);
              continue;
            }

            const tile: Tile = e.before.tiles.find((t) => t.id === e.from)!;
            seen[tile.child ? "child" : "other"]++;
            expect(
              stops.map((c) => c["name"]),
              tile.child
                ? `L8: a close of tezgah's child ${tile.shows} stops it`
                : `L8: a close of ${tile.shows} stops nothing`,
            ).toEqual(tile.child ? [tile.shows] : []);
          }
        },
      ),
      { seed: SEED, numRuns: 100 },
    );
    expect(
      Object.values(seen).every((n) => n > 0),
      `L8: the walks closed both kinds ${JSON.stringify(seen)}`,
    ).toBe(true);
  });
});

/** L9's blind draw: which kind of move, and which target the fold picks in the state it reached. */
const Pick = fc.record({
  type: fc.constant("pick" as const),
  kind: fc.constantFrom<Kind>(
    "attach",
    "reattach",
    "reattach",
    "attach_reused",
    "attach_reused",
    "split_right",
    "split_down",
    "answer",
    "close",
    "reused",
    "reused",
    "unknown",
    "unknown",
  ),
  pick: fc.nat(),
});

describe("Desk S2a L9: tezgah refuses what names nothing", () => {
  it("L9: a reused tile id, an unknown from or a missing workspace is refused with its reason and writes nothing", async () => {
    const p = await loaded();
    const seen: Record<string, number> = {
      no_workspace: 0,
      id_reused: 0,
      missing: 0,
      reattach: 0,
      attach_live: 0,
      attach_waiting: 0,
    };
    fc.assert(
      fc.property(
        fc.boolean(),
        arbMsgSequence(Pick, { minLength: 4, maxLength: 40, size: "max" }),
        (attached, picks) => {
          const w = begin(p);

          if (attached) {
            move(p, w, "attach", 0);
            move(p, w, "answer", 0);
          }

          for (const { kind, pick } of picks) {
            const model = JSON.stringify(w.model);
            const e = move(p, w, kind, pick);

            if (e !== null && kind === "reattach") {
              // Plan amendment (b): an attach of a workspace that exists is taken and changes nothing.
              seen["reattach"] = (seen["reattach"] ?? 0) + 1;
              expect(e.result, `L9: ${e.move} is taken, not refused`).toEqual({ _tag: "stepped" });
              expect(e.after, `L9: ${e.move} changes no view`).toEqual(e.before);
              expect(JSON.stringify(w.model), `L9: ${e.move} changes no model`).toBe(model);
              expect(e.cmds, `L9: ${e.move} starts nothing`).toEqual([]);
              continue;
            }

            if (e !== null && kind === "attach_reused") {
              const which = e.move.includes("reusing live") ? "attach_live" : "attach_waiting";
              seen[which] = (seen[which] ?? 0) + 1;
              expect(e.result, `L9: ${e.move}`).toEqual({ _tag: "refused", reason: "id_reused" });
              expect(e.after, "L9: a refused attach changes no view").toEqual(e.before);
              expect(JSON.stringify(w.model), "L9: a refused attach writes nothing to the model").toBe(model);
              expect(e.cmds, "L9: a refused attach starts nothing").toEqual([]);
              continue;
            }

            if (e === null || (kind !== "reused" && kind !== "unknown")) {
              continue;
            }

            const want = w.view.workspaces.length === 0 ? "no_workspace" : kind === "reused" ? "id_reused" : "missing";
            seen[want] = (seen[want] ?? 0) + 1;
            expect(e.result, `L9: ${e.move}`).toEqual({ _tag: "refused", reason: want });
            expect(e.after, "L9: a refusal changes no view").toEqual(e.before);
            expect(JSON.stringify(w.model), "L9: a refusal writes nothing to the model").toBe(model);
            expect(e.cmds, "L9: a refusal asks for nothing").toEqual([]);
          }
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    expect(
      Object.values(seen).every((n) => n > 0),
      `L9: the walks met every refusal ${JSON.stringify(seen)}`,
    ).toBe(true);
  });

  it("L9: with no workspace at all, every did is no_workspace", async () => {
    const p = await loaded();
    fc.assert(
      fc.property(arbMsgSequence(Pick, { minLength: 1, maxLength: 10 }), (picks) => {
        const w = begin(p);

        for (const { pick } of picks) {
          const e = move(p, w, "unknown", pick)!;
          expect(e.result, `L9: ${e.move} before any attach`).toEqual({ _tag: "refused", reason: "no_workspace" });
        }
      }),
      { seed: SEED, numRuns: 50 },
    );
  });
});

// Desk S3, next/: law L27, each tile's cursor (0165), and the focus moves' rows in tezgah's one
// commands table, on the real program through the same `stepper`. Written before tezgah takes a
// focus move. The shape these laws hold `program.ts` and `commands.ts` to, from the plan's "The
// shape" and "The lead's lean" (the build may add more):
// - `commands.ts` gains the focus rows, tmux's keys after the prefix (0503's lesson): `focus_next`
//   on `<prefix>o` and `f6`, `focus_previous` on `shift+f6`, `focus_last` on `<prefix>;`, and
//   `focus_left`, `_right`, `_up`, `_down` on `<prefix>h`, `l`, `k`, `j` and the arrows after the
//   prefix (`<prefix>arrowleft` and so on, as `Keys.spell` spells an arrow). L19 holds each row to
//   its word and label.
// - Msg `did {does, from, to, via, cursor}` is a focus move: `does` is one of those commands, or
//   `tezgah.focus` for a move by a click or by Tab (the window's `focus` Msg, which no key row
//   names); `from` the tile the window had focus on, `to` the tile it moved to, an absolute tile id
//   the window worked out on its own drawn layout (the lead's lean, 80%); `cursor` the `data-cursor`
//   key of the element that had DOM focus in `from` (the checklist's `item:<name>`), or null.
// - A move is taken in arrival order: the workspace holding `to` focuses `to`, `recent` becomes `to`
//   then the rest in their order, and `from`'s tile keeps `cursor` as its cursor, which every later
//   view shows until a move leaves that tile again. Nothing else changes and no Cmd is asked.
// - Plan amendment 9, point 3: every letter that moves focus off a tile carries that tile's cursor,
//   a split included. A split's `did {does, from, via, tile, cursor}` is taken as before, and tezgah
//   stores `cursor` on `from` at once, so a return to `from` never resets it to the top (0165). A
//   close carries none: its tile is gone. A letter with no `cursor` key leaves the cursor as it was.
// - `refuse`: `missing` for a `to` that is not on `from`'s workspace (an unknown tile, or another
//   workspace's), as for an unknown `from`. A refusal changes nothing.
// - L27: tezgah never reads `sentAt`. A letter's body may carry one, as a window's clock wrote it;
//   the moves are applied in the order they arrive, whatever their clocks say.
const loadCommands = () => import("./commands.ts");

/** A move by a click or by Tab: the window's `focus` Msg, which no key row names. */
const CLICK = "tezgah.focus";
const CURSORS = ["item:milk", "item:eggs", "item:bread", null] as const;

/** A cursor key up to `CursorKey`'s real limit of 256 (plan amendment 10): the checklist's keys,
 *  any short key, or one of 81 to 256 characters, or none. fast-check, so the limit itself is
 *  reached, not the schema's cap. */
const Cursor = fc.oneof(
  fc.constantFrom(...CURSORS),
  fc.string({ minLength: 1, maxLength: 80 }),
  fc.string({ minLength: 81, maxLength: 256 }),
);

const VIAS = [{ _tag: "key", keys: "ctrl+b o" }, { _tag: "click" }, { _tag: "key", keys: "f6" }] as const;

const FocusPick = fc.record({
  type: fc.constant("pick" as const),
  kind: fc.constantFrom(
    "split_right",
    "split_down",
    "answer",
    "answer",
    "attach",
    "close",
    "focus",
    "focus",
    "focus",
    "focus",
    "focus_far",
    "split_cursor",
    "split_cursor",
  ),
  pick: fc.nat(),
  cursor: Cursor,
  sentAt: fc.integer({ min: 0, max: 10_000_000 }),
});
type FocusPick = typeof FocusPick extends fc.Arbitrary<infer A> ? A : never;

const iso = (ms: number) => new Date(Date.UTC(2026, 10, 14) + ms).toISOString();

/** A focus move from a live tile to another tile on its workspace, picked in the state `w` reached,
 *  or for `focus_far` a `to` that is on no workspace or on another one. */
const focusMove = (
  p: Stepper,
  w: World,
  does: ReadonlyArray<string>,
  c: FocusPick,
): (Event & { readonly to: string; readonly cursor: string | null; readonly far: boolean }) | null => {
  const tiles = live(w.view);
  const from = tiles[c.pick % Math.max(tiles.length, 1)];
  const space = from === undefined ? undefined : spaceWith(w.view, from);

  if (from === undefined || space === undefined) {
    return null;
  }

  const others = tiles.filter((t) => !order(space.layout).includes(t));
  const near = order(space.layout).filter((t) => t !== from);
  const far = c.kind === "focus_far";
  const pool = far ? [...others, typeId("tile", 80_000 + (c.pick % 997))] : near;
  const to = pool[(c.pick >> 4) % Math.max(pool.length, 1)];

  if (to === undefined) {
    return null;
  }

  const name = does[(c.pick >> 2) % does.length]!;
  const msg = {
    ...Tag.cases.did.make({}),
    does: name,
    from,
    to,
    via: name === CLICK ? { _tag: "click" } : VIAS[c.pick % VIAS.length],
    cursor: c.cursor,
    sentAt: iso(c.sentAt),
  };
  w.at++;
  return { move: `${name} ${from} -> ${to}`, ...take(p, w, msg, false), from, to, cursor: c.cursor, far };
};

/** A split that carries the cursor it leaves on `from` (plan amendment 9, point 3), picked in `w`. */
const splitMove = (p: Stepper, w: World, c: FocusPick) => {
  const tiles = live(w.view);
  const from = tiles[c.pick % Math.max(tiles.length, 1)];

  if (from === undefined) {
    return null;
  }

  const dir: Dir = c.pick % 2 === 0 ? "right" : "down";
  const tile = typeId("tile", w.next++);
  const space = spaceWith(w.view, from)?.id ?? "";
  w.at++;
  const e = take(p, w, { ...Tag.cases.did.make({}), does: DOES[dir], from, via, tile, cursor: c.cursor }, false);
  const cmd = starts(e.cmds)[0];

  if (cmd !== undefined) {
    w.waiting.push({ _tag: "split", from, tile, dir, cmd, space });
  }

  return { move: `split ${dir} ${from} -> ${tile} leaving ${String(c.cursor)}`, ...e, from, split: c.cursor };
};

/** tezgah's focus commands, from its one commands table, and the click's move. */
const focusCommands = async () => {
  const { commands } = await loadCommands();
  return [...commands.map((c) => c.does as string).filter((d) => d.startsWith("tezgah.focus_")), CLICK];
};

describe("Desk S3: focus moves at the program", () => {
  // The plan's S3 default rows (tezgah's commands table in "The shape"); the walk below draws its
  // moves from this table, so every row is also a command tezgah's did takes, between any two tiles.
  it("S3 commands: tezgah's one table names every focus move on tmux's keys, after the prefix, and tezgah's did takes each, and the click's, from any tile to another", async () => {
    const { commands } = await loadCommands();
    const boundKeys = (does: string) => commands.find((c) => c.does === does)?.keys ?? [];
    // The plan's default key rows for S3 ("The shape", tezgah's commands table).
    const want: Readonly<Record<string, ReadonlyArray<string>>> = {
      "tezgah.focus_next": ["<prefix>o", "f6"],
      "tezgah.focus_previous": ["shift+f6"],
      "tezgah.focus_last": ["<prefix>;"],
      "tezgah.focus_left": ["<prefix>h", "<prefix>arrowleft"],
      "tezgah.focus_right": ["<prefix>l", "<prefix>arrowright"],
      "tezgah.focus_up": ["<prefix>k", "<prefix>arrowup"],
      "tezgah.focus_down": ["<prefix>j", "<prefix>arrowdown"],
    };

    const p = await loaded();
    const seen = new Set<string>();
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.keys(want), CLICK),
        fc.array(fc.record({ down: fc.boolean(), at: fc.nat() }), { minLength: 1, maxLength: 4 }),
        fc.nat(),
        fc.nat(),
        (does, cuts, from, to) => {
          seen.add(does);
          expect(boundKeys(does), `S3: ${does} is bound to its default keys`).toEqual(
            expect.arrayContaining([...(want[does] ?? [])]),
          );
          const w = begin(p);
          move(p, w, "attach", 0);
          move(p, w, "answer", 0);

          for (const cut of cuts) {
            move(p, w, cut.down ? "split_down" : "split_right", cut.at);
            move(p, w, "answer", 0);
          }

          const tiles = live(w.view);
          const a = tiles[from % tiles.length]!;
          const others = tiles.filter((t) => t !== a);
          const b = others[to % others.length]!;
          const e = take(
            p,
            w,
            { ...Tag.cases.did.make({}), does, from: a, to: b, via: { _tag: "key", keys: "ctrl+b o" }, cursor: null },
            false,
          );
          expect(e.result, `S3: tezgah takes ${does} from ${a} to ${b}`).toEqual({ _tag: "stepped" });
        },
      ),
      { seed: SEED, numRuns: 100 },
    );
    expect(seen.size, "S3: the walk tries every focus move and the click").toBe(Object.keys(want).length + 1);
  });

  it("S3 cursor: a focus move focuses its to, puts it first in recent, and keeps the cursor it left on its from, as a split's letter does, which every later view shows until a letter leaves that tile again", async () => {
    const p = await loaded();
    const does = await focusCommands();
    const seen = { moved: 0, far: 0, cursor: 0, kept: 0, stale: 0, split: 0, long: 0 };
    fc.assert(
      fc.property(arbMsgSequence(FocusPick, { minLength: 8, maxLength: 60, size: "max" }), (picks) => {
        const w = begin(p);
        move(p, w, "attach", 0);
        move(p, w, "answer", 0);
        /** Each tile's cursor as the moves that left it set it; a tile never left has none. */
        const cursors = new Map<string, string | null>();

        for (const c of picks) {
          const model = JSON.stringify(w.model);
          // The focus move keeps its own type: TypeScript folds `Event | (Event & {to, cursor, far})`
          // into `Event`, so `"to" in e` could not narrow a union of the three.
          const focus = c.kind === "focus" || c.kind === "focus_far" ? focusMove(p, w, does, c) : null;
          const e =
            focus ??
            (c.kind === "focus" || c.kind === "focus_far"
              ? null
              : c.kind === "split_cursor"
                ? splitMove(p, w, c)
                : move(p, w, c.kind as Kind, c.pick));

          if (e !== null && "split" in e) {
            expect(e.result, `S3: ${e.move} is taken`).toEqual({ _tag: "stepped" });
            expect(starts(e.cmds), `S3: ${e.move} asks for its start as before`).toHaveLength(1);
            cursors.set(e.from, e.split);
            seen.split += e.split === null ? 0 : 1;
          }

          if (focus !== null) {
            const e = focus;
            const before = spaceWith(e.before, e.from!)!;

            if (e.far) {
              seen.far++;
              expect(e.result, `S3: ${e.move} names a tile not on its workspace`).toEqual({
                _tag: "refused",
                reason: "missing",
              });
              expect(e.after, "S3: a refused move changes no view").toEqual(e.before);
              expect(JSON.stringify(w.model), "S3: a refused move writes nothing").toBe(model);
              continue;
            }

            seen.moved++;
            seen.stale += before.focus === e.from ? 0 : 1;
            expect(e.result, `S3: ${e.move} is taken`).toEqual({ _tag: "stepped" });
            expect(e.cmds, `S3: ${e.move} asks for no Cmd`).toEqual([]);
            const now = e.after.workspaces.find((s) => s.id === before.id)!;
            expect(now.focus, `S3: ${e.move} focuses its to`).toBe(e.to);
            expect(now.recent, `S3: ${e.move} puts its to first in recent, the rest in their order`).toEqual([
              e.to,
              ...before.recent.filter((t) => t !== e.to),
            ]);
            expect(now.layout, `S3: ${e.move} changes no layout`).toEqual(before.layout);

            for (const space of e.after.workspaces.filter((s) => s.id !== before.id)) {
              expect(space, "S3: another workspace is untouched").toEqual(
                e.before.workspaces.find((s) => s.id === space.id),
              );
            }

            cursors.set(e.from!, e.cursor);
            seen.cursor += e.cursor === null ? 0 : 1;
            seen.long += (e.cursor?.length ?? 0) > 80 ? 1 : 0;
          }

          // Every tile's cursor is the one the last move that left it carried, through splits,
          // closes and other moves alike; a tile no move left has none (0165).
          for (const t of w.view.tiles) {
            seen.kept += cursors.has(t.id) && cursors.get(t.id) !== null ? 1 : 0;
            expect(t.cursor, `S3: ${t.id}'s cursor after ${e?.move ?? c.kind}`).toBe(cursors.get(t.id) ?? null);
          }
        }
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(
      Object.values(seen).every((n) => n > 0),
      `S3: the walks reached every case ${JSON.stringify(seen)}`,
    ).toBe(true);
  });

  it("L27: tezgah applies moves in arrival order and never reads sentAt", async () => {
    const p = await loaded();
    const does = await focusCommands();
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.array(fc.record({ from: fc.nat(), to: fc.nat(), cursor: Cursor, does: fc.nat() }), {
          minLength: 2,
          maxLength: 20,
        }),
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 20, maxLength: 20 }),
        (count, moves, clocks) => {
          /** A workspace of `count` tiles, then `moves` with the clocks `clock(i)`; the views in order. */
          const run = (clock: (i: number) => number) => {
            const w = begin(p);
            move(p, w, "attach", 0);
            move(p, w, "answer", 0);

            for (let i = 1; i < count; i++) {
              move(p, w, i % 2 === 0 ? "split_down" : "split_right", i);
              move(p, w, "answer", 0);
            }

            const tiles = live(w.view);
            const views: Array<View> = [];
            const tos: Array<string> = [];

            for (const [i, m] of moves.entries()) {
              const from = tiles[m.from % tiles.length]!;
              const to = tiles.filter((t) => t !== from)[m.to % (tiles.length - 1)]!;
              const name = does[m.does % does.length]!;
              const e = take(
                p,
                w,
                {
                  ...Tag.cases.did.make({}),
                  does: name,
                  from,
                  to,
                  via: { _tag: "click" },
                  cursor: m.cursor,
                  sentAt: iso(clock(i)),
                },
                false,
              );
              expect(e.result, `L27: move ${i} is taken`).toEqual({ _tag: "stepped" });
              views.push(w.view);
              tos.push(to);
            }

            return { views, tos };
          };
          const shuffled = run((i) => clocks[i] ?? 0);
          const ascending = run((i) => i * 1_000);
          const descending = run((i) => (moves.length - i) * 1_000);

          for (const [i, view] of shuffled.views.entries()) {
            expect(view.workspaces[0]!.focus, `L27: after move ${i} the focus is that move's to`).toBe(shuffled.tos[i]);
          }

          expect(shuffled.views, "L27: the clocks a letter carries change no view").toEqual(ascending.views);
          expect(descending.views, "L27: moves whose clocks run backward are still taken in arrival order").toEqual(
            ascending.views,
          );
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
  });
});
