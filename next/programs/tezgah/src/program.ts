// tezgah, next/: the window manager as a program, `fabrika/tezgah`, one process per person,
// `tezgah:<the person id's body>` (0274, 0491). It holds each workspace's layout and focus, and
// starts and stops the processes its tiles show, as a supervisor starts and ends its children
// (OTP's start_child and terminate_child). A pure tea machine: a split waits for its start, so a
// tile enters a layout only once its process exists, and a window never draws a tile with nothing
// behind it. Layout geometry and the view's shapes are the library's (its `Layout` and `Workspace`),
// shared with every window; a program's box takes them from the library's root, as every name.
import { Machine } from "@demlik/tea/effect";
import { Layout, Program, type Refusal, StartChild, type Started, Workspace } from "@kampus/libfabrika";
import { Array as Arr, String as Str } from "effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The program a new tile shows. A constant until programs read pack settings (P38 slice 5); then
 *  it is the pack's `tezgah.new`, and `fabrika/fabsh` its default once the shell lands. */
export const NEW_TILE = "fabrika/checklist";

/** Workspace 1's first tile shows the process the instance boots with; its start answers
 *  `already_started`, as OTP's whereis does. */
const FIRST = "checklist:1";

/** The keybindings note's Via: how a person gave the command. */
const Via = Schema.TaggedUnion({ key: { keys: Schema.String }, click: {}, word: {}, palette: {} });

/** The commands that move focus: the key rows' moves, and `tezgah.focus` for a click or Tab. */
const FOCUS = [
  "tezgah.focus",
  "tezgah.focus_next",
  "tezgah.focus_previous",
  "tezgah.focus_last",
  "tezgah.focus_left",
  "tezgah.focus_right",
  "tezgah.focus_up",
  "tezgah.focus_down",
] as const;

/** The cursor a letter leaves on `from` (0165): the `data-cursor` key of the element that had DOM
 *  focus there, or null. A letter with no `cursor` key leaves `from`'s cursor as it was. */
const Leaves = Schema.optionalKey(Schema.NullOr(Workspace.CursorKey));

const Msg = Schema.Union([
  /** A window's first look at workspace `workspace`: makes it, with `tile` first, when it is missing. */
  Schema.Struct({ type: Schema.Literal("attach"), workspace: Schema.Int, tile: Workspace.TileId }),
  /** A split, given in tile `from`; `tile` is the new tile's id, minted by the window. */
  Schema.Struct({
    type: Schema.Literal("did"),
    does: Schema.Literals(["tezgah.split_right", "tezgah.split_down"]),
    from: Workspace.TileId,
    via: Via,
    tile: Workspace.TileId,
    cursor: Leaves,
  }),
  /** A focus move from tile `from` to tile `to`, which the window worked out on its own drawn
   *  layout and sends absolute (0278); tezgah takes moves in arrival order, never by `sentAt`. */
  Schema.Struct({
    type: Schema.Literal("did"),
    does: Schema.Literals(FOCUS),
    from: Workspace.TileId,
    to: Workspace.TileId,
    via: Via,
    cursor: Leaves,
  }),
  /** A close of tile `from`. */
  Schema.Struct({
    type: Schema.Literal("did"),
    does: Schema.Literal("tezgah.close"),
    from: Workspace.TileId,
    via: Via,
  }),
]);

type Msg = typeof Msg.Type;

/** A start tezgah asked for and waits on: a workspace's first tile, or a split's new tile. As on the
 *  wire, `workspace` is a workspace's number; a split's workspace is kept by its id, as `space`. */
const Starting = Schema.TaggedUnion({
  attach: { workspace: Schema.Int, tile: Workspace.TileId, name: Schema.String },
  split: {
    space: Workspace.WorkspaceId,
    at: Workspace.TileId,
    dir: Workspace.Dir,
    tile: Workspace.TileId,
    name: Schema.String,
  },
});

type Starting = typeof Starting.Type;

const Model = Schema.Struct({
  workspaces: Schema.Array(Workspace.Workspace),
  tiles: Schema.Array(Workspace.Tile),
  /** The next tile's number, printed `t<n>`. */
  next: Schema.Int,
  starting: Schema.Array(Starting),
});

type Model = typeof Model.Type;

type Step = readonly [
  Model,
  ReadonlyArray<ReturnType<typeof StartChild.startChild> | ReturnType<typeof StartChild.stopChild>>,
];

const DIRS = { "tezgah.split_right": "row", "tezgah.split_down": "column" } as const;

const holding = (m: Model, tile: string) =>
  Arr.findFirst(m.workspaces, (w) => Layout.order(w.layout).includes(tile as Workspace.TileId));

const known = (m: Model, tile: string) =>
  Arr.some(m.tiles, (t) => t.id === tile) || Arr.some(m.starting, (s) => s.tile === tile);

const exists = (m: Model, n: number) =>
  Arr.some(m.workspaces, (w) => w.n === n) || Arr.some(m.starting, (s) => s._tag === "attach" && s.workspace === n);

/** A workspace takes its first tile's id body: windows mint ids, and tezgah mints none. */
const workspaceId = Schema.decodeSync(Workspace.WorkspaceId);

/** `from`'s tile keeps the cursor a letter leaves on it, when the letter carries one. */
const leaving = (m: Model, from: Workspace.TileId, cursor: string | null | undefined): Model =>
  cursor === undefined ? m : { ...m, tiles: Arr.map(m.tiles, (t) => (t.id === from ? { ...t, cursor } : t)) };

/** The tile a start's answer makes, numbered next. */
const made = (m: Model, s: Starting, answer: Started): Workspace.Tile => ({
  id: s.tile,
  n: m.next,
  shows: answer.name,
  program: NEW_TILE,
  child: answer._tag === "started",
  keep: "failed",
  cursor: null,
});

/** A start answered: a first tile makes its workspace; a split's tile goes after its tile, or after
 *  the focused one when its tile closed while the start waited (plan amendment, 2026-11-14). */
const placed = (m: Model, s: Starting, answer: Started): Model => {
  const rest = { ...m, starting: Arr.filter(m.starting, (x) => x !== s) };

  if (s._tag === "attach") {
    if (Arr.some(m.workspaces, (w) => w.n === s.workspace)) {
      return rest;
    }

    const body = Option.match(Str.lastIndexOf("_")(s.tile), {
      onNone: () => s.tile,
      onSome: (underscore) => Str.slice(underscore + 1)(s.tile),
    });

    const space = Workspace.Workspace.make({
      id: workspaceId(`workspace_${body}`),
      n: s.workspace,
      layout: s.tile,
      focus: s.tile,
      recent: [s.tile],
    });

    return { ...rest, workspaces: [...m.workspaces, space], tiles: [...m.tiles, made(m, s, answer)], next: m.next + 1 };
  }

  const found = Arr.findFirst(m.workspaces, (x) => x.id === s.space);

  if (Option.isNone(found)) {
    return rest;
  }

  const w = found.value;
  const at = Layout.order(w.layout).includes(s.at) ? s.at : w.focus;

  return {
    ...rest,
    workspaces: Arr.map(m.workspaces, (x) => (x === w ? Layout.split(w, at, s.dir, s.tile) : x)),
    tiles: [...m.tiles, made(m, s, answer)],
    next: m.next + 1,
  };
};

export const tezgahMachine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [StartChild.startChild, StartChild.stopChild],
  init: (loaded) => [loaded ?? { workspaces: [], tiles: [], next: 1, starting: [] }, []],
  update: {
    attach: (m, msg): Step => {
      if (exists(m, msg.workspace)) {
        return [m, []];
      }

      const name = msg.workspace === 1 ? FIRST : Workspace.childName(NEW_TILE, msg.tile);

      return [
        {
          ...m,
          starting: [...m.starting, Starting.cases.attach.make({ workspace: msg.workspace, tile: msg.tile, name })],
        },
        [StartChild.startChild({ program: NEW_TILE, name })],
      ];
    },
    did: (m, msg): Step => {
      const found = holding(m, msg.from);

      if (Option.isNone(found)) {
        return [m, []];
      }

      const w = found.value;

      if (msg.does === "tezgah.close") {
        const shown = Arr.findFirst(m.tiles, (t) => t.id === msg.from);

        return [
          {
            ...m,
            workspaces: Arr.map(m.workspaces, (x) => (x === w ? Layout.remove(w, msg.from) : x)),
            tiles: Arr.filter(m.tiles, (t) => t.id !== msg.from),
          },
          Option.isSome(shown) && shown.value.child ? [StartChild.stopChild({ name: shown.value.shows })] : [],
        ];
      }

      // A focus move: the only letter that names a `to`.
      if ("to" in msg) {
        const moved = leaving(m, msg.from, msg.cursor);

        return [
          { ...moved, workspaces: Arr.map(moved.workspaces, (x) => (x === w ? Layout.focus(w, msg.to) : x)) },
          [],
        ];
      }

      const name = Workspace.childName(NEW_TILE, msg.tile);

      const split = Starting.cases.split.make({
        space: w.id,
        at: msg.from,
        dir: DIRS[msg.does],
        tile: msg.tile,
        name,
      });

      return [
        { ...leaving(m, msg.from, msg.cursor), starting: [...m.starting, split] },
        [StartChild.startChild({ program: NEW_TILE, name })],
      ];
    },
    start_child_ok: (m, msg): Step => {
      const s = Arr.findFirst(m.starting, (x) => x.name === msg.cmd.name);

      return Option.isNone(s) ? [m, []] : [placed(m, s.value, msg.value), []];
    },
    // A refused start drops what waited on it, and nothing else changes.
    start_child_err: (m, msg): Step => [{ ...m, starting: Arr.filter(m.starting, (x) => x.name !== msg.cmd.name) }, []],
    stop_child_ok: (m): Step => [m, []],
    // `noproc`: the tile's process ended before its close; the tile is already gone.
    stop_child_err: (m): Step => [m, []],
  },
});

/** `no_workspace` before any workspace exists; `missing` for a `from` no workspace holds, or a
 *  focus move's `to` that `from`'s workspace does not hold;
 *  `last_tile` for a close of a workspace's only tile; `id_reused` for a new tile's id that is
 *  already a tile's or a waiting start's. */
const refuse = (m: Model, msg: Msg): Refusal | null => {
  if (msg.type === "attach") {
    return !exists(m, msg.workspace) && known(m, msg.tile) ? { reason: "id_reused" } : null;
  }

  if (m.workspaces.length === 0) {
    return { reason: "no_workspace" };
  }

  const found = holding(m, msg.from);

  if (Option.isNone(found)) {
    return { reason: "missing" };
  }

  const w = found.value;

  if (msg.does === "tezgah.close") {
    return Layout.order(w.layout).length === 1 ? { reason: "last_tile" } : null;
  }

  if ("to" in msg) {
    return Layout.order(w.layout).includes(msg.to) ? null : { reason: "missing" };
  }

  return known(m, msg.tile) ? { reason: "id_reused" } : null;
};

const view = (m: Model): Workspace.TezgahView => ({ workspaces: m.workspaces, tiles: m.tiles });

export const tezgah = Program.make({
  name: "fabrika/tezgah",
  machine: tezgahMachine,
  state: { v: 1, upgrades: [] },
  view,
  refuse,
  inputs: {
    attach: "A window's first look at workspace `workspace`: makes it, with tile `tile` first, when it is missing",
    did: "A command given in tile `from`: `tezgah.split_right` or `tezgah.split_down` with the new `tile`, `tezgah.close`, or a focus move to tile `to`; a split or a move leaves its `cursor` on `from`",
  },
  outputs: {},
  writes: {},
  wake: () => null,
});
