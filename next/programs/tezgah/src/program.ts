// tezgah, next/: the window manager as a program, `fabrika/tezgah`, one process per person,
// `tezgah:<the person id's body>` (0274, 0491). It holds each workspace's layout and focus, and
// starts and stops the processes its tiles show, as a supervisor starts and ends its children
// (OTP's start_child and terminate_child). A pure tea machine: a split waits for its start, so a
// tile enters a layout only once its process exists, and a window never draws a tile with nothing
// behind it. Layout geometry and the view's shapes are the library's (its `Layout` and `Workspace`),
// shared with every window; a program's box takes them from the library's root, as every name.
import { Machine } from "@demlik/tea/effect";
import { Layout, Program, ProgramName, type Refusal, StartChild, type Started, Workspace } from "@kampus/libfabrika";
import { Schema } from "effect";

/** The part of the core pack's settings tezgah reads: `tezgah.new`, the program a new tile starts.
 *  The runner hands it at every init, as Elm hands `init` its flags. */
const Settings = Schema.Struct({ tezgah: Schema.Struct({ new: ProgramName }) });

/** The only program tezgah v1 started, and so what a v1 saved start asked for. */
const CHECKLIST = "fabrika/checklist";

/** Workspace 1's first tile shows the process the instance boots with; its start answers
 *  `already_started`, as OTP's whereis does. It stays the boot list's checklist until fabsh can
 *  show a program it starts (fabsh slice 2b); then this goes and the first tile reads `new` too. */
const FIRST = { program: CHECKLIST, name: "checklist:1" } as const;

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
 *  wire, `workspace` is a workspace's number; a split's workspace is kept by its id, as `space`.
 *  Each keeps the program it asked for, so its tile shows that program whatever `new` is by then. */
const Starting = Schema.TaggedUnion({
  attach: { workspace: Schema.Int, tile: Workspace.TileId, program: ProgramName, name: Schema.String },
  split: {
    space: Workspace.WorkspaceId,
    at: Workspace.TileId,
    dir: Workspace.Dir,
    tile: Workspace.TileId,
    program: ProgramName,
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
  /** The program a new tile starts: `tezgah.new` as init was last handed it. */
  new: ProgramName,
});
type Model = typeof Model.Type;

/** A saved model as v1 wrote it, read only as JSON: the upgrade touches nothing else in it. */
const SavedV1 = Schema.Record(Schema.String, Schema.Json);
const StartsV1 = Schema.Struct({ starting: Schema.Array(Schema.Record(Schema.String, Schema.Json)) });

/** v1 to v2: every start v1 left waiting asked for the checklist, the only program v1 started, so
 *  the climb loses nothing. `init` sets `new` from the settings right after. */
const keepsItsProgram = (raw: unknown) => ({
  ...Schema.decodeUnknownSync(SavedV1)(raw),
  new: CHECKLIST,
  starting: Schema.decodeUnknownSync(StartsV1)(raw).starting.map((s) => ({ ...s, program: CHECKLIST })),
});

type Step = readonly [
  Model,
  ReadonlyArray<ReturnType<typeof StartChild.startChild> | ReturnType<typeof StartChild.stopChild>>,
];

const DIRS = { "tezgah.split_right": "row", "tezgah.split_down": "column" } as const;

const holding = (m: Model, tile: string) =>
  m.workspaces.find((w) => Layout.order(w.layout).includes(tile as Workspace.TileId));

const known = (m: Model, tile: string) => m.tiles.some((t) => t.id === tile) || m.starting.some((s) => s.tile === tile);

const exists = (m: Model, n: number) =>
  m.workspaces.some((w) => w.n === n) || m.starting.some((s) => s._tag === "attach" && s.workspace === n);

/** A workspace takes its first tile's id body: windows mint ids, and tezgah mints none. */
const workspaceId = Schema.decodeSync(Workspace.WorkspaceId);

/** `from`'s tile keeps the cursor a letter leaves on it, when the letter carries one. */
const leaving = (m: Model, from: Workspace.TileId, cursor: string | null | undefined): Model =>
  cursor === undefined ? m : { ...m, tiles: m.tiles.map((t) => (t.id === from ? { ...t, cursor } : t)) };

/** The tile a start's answer makes, numbered next, showing the program its start asked for. */
const made = (m: Model, s: Starting, answer: Started): Workspace.Tile => ({
  id: s.tile,
  n: m.next,
  shows: answer.name,
  program: s.program,
  child: answer._tag === "started",
  keep: "failed",
  cursor: null,
});

/** A start answered: a first tile makes its workspace; a split's tile goes after its tile, or after
 *  the focused one when its tile closed while the start waited (plan amendment, 2026-11-14). */
const placed = (m: Model, s: Starting, answer: Started): Model => {
  const rest = { ...m, starting: m.starting.filter((x) => x !== s) };

  if (s._tag === "attach") {
    if (m.workspaces.some((w) => w.n === s.workspace)) {
      return rest;
    }

    const space = Workspace.Workspace.make({
      id: workspaceId(`workspace_${s.tile.slice(s.tile.lastIndexOf("_") + 1)}`),
      n: s.workspace,
      layout: s.tile,
      focus: s.tile,
      recent: [s.tile],
    });
    return { ...rest, workspaces: [...m.workspaces, space], tiles: [...m.tiles, made(m, s, answer)], next: m.next + 1 };
  }

  const w = m.workspaces.find((x) => x.id === s.space);

  if (w === undefined) {
    return rest;
  }

  const at = Layout.order(w.layout).includes(s.at) ? s.at : w.focus;
  return {
    ...rest,
    workspaces: m.workspaces.map((x) => (x === w ? Layout.split(w, at, s.dir, s.tile) : x)),
    tiles: [...m.tiles, made(m, s, answer)],
    next: m.next + 1,
  };
};

export const tezgahMachine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [StartChild.startChild, StartChild.stopChild],
  types: { ctx: {} as typeof Settings.Type },
  // Every load takes `new` as handed now: a restart with another value changes only later starts.
  init: (loaded, settings) => [
    { ...(loaded ?? { workspaces: [], tiles: [], next: 1, starting: [] }), new: settings.tezgah.new },
    [],
  ],
  update: {
    attach: (m, msg): Step => {
      if (exists(m, msg.workspace)) {
        return [m, []];
      }

      const asked = msg.workspace === 1 ? FIRST : { program: m.new, name: Workspace.childName(m.new, msg.tile) };
      return [
        {
          ...m,
          starting: [...m.starting, Starting.cases.attach.make({ workspace: msg.workspace, tile: msg.tile, ...asked })],
        },
        [StartChild.startChild(asked)],
      ];
    },
    did: (m, msg): Step => {
      const w = holding(m, msg.from);

      if (w === undefined) {
        return [m, []];
      }

      if (msg.does === "tezgah.close") {
        const shown = m.tiles.find((t) => t.id === msg.from);
        return [
          {
            ...m,
            workspaces: m.workspaces.map((x) => (x === w ? Layout.remove(w, msg.from) : x)),
            tiles: m.tiles.filter((t) => t.id !== msg.from),
          },
          shown?.child === true ? [StartChild.stopChild({ name: shown.shows })] : [],
        ];
      }

      // A focus move: the only letter that names a `to`.
      if ("to" in msg) {
        const moved = leaving(m, msg.from, msg.cursor);
        return [{ ...moved, workspaces: moved.workspaces.map((x) => (x === w ? Layout.focus(w, msg.to) : x)) }, []];
      }

      const asked = { program: m.new, name: Workspace.childName(m.new, msg.tile) };
      const split = Starting.cases.split.make({
        space: w.id,
        at: msg.from,
        dir: DIRS[msg.does],
        tile: msg.tile,
        ...asked,
      });
      return [
        { ...leaving(m, msg.from, msg.cursor), starting: [...m.starting, split] },
        [StartChild.startChild(asked)],
      ];
    },
    start_child_ok: (m, msg): Step => {
      const s = m.starting.find((x) => x.name === msg.cmd.name);
      return s === undefined ? [m, []] : [placed(m, s, msg.value), []];
    },
    // A refused start drops what waited on it, and nothing else changes.
    start_child_err: (m, msg): Step => [{ ...m, starting: m.starting.filter((x) => x.name !== msg.cmd.name) }, []],
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

  const w = holding(m, msg.from);

  if (w === undefined) {
    return { reason: "missing" };
  }

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
  settings: Settings,
  state: { v: 2, upgrades: [{ name: "a start keeps its program", from: 1, run: keepsItsProgram }] },
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
