/**
 * A window's side of tezgah (0167): the server state tezgah last sent, and the focus moves this
 * window made that the server has not answered yet. The drawn state is derived from the two by
 * `optimisticState` and is never stored. One tea machine; the window parent steps it by hand.
 *
 * Its states: `serverState` is null until the first view that decodes as `TezgahView`, then the
 * newest one. A patch must start at the shown revision and end one past it; anything else keeps
 * the shown view and asks for a whole one, as a program client does (`runtime/Client.ts`).
 *
 * Each pending move is undated (`letter` null) until the window gives its press slot a letter id,
 * then sent, then answered (`answer` set) once tezgah accepted it at an inbox position. It is
 * dropped when it is answered and a view at or past that position is shown, in either order, or at
 * once when tezgah refused it, as Replicache drops a mutation the server has confirmed. Each drop
 * asks the window to record it: `kept` when the server's focus is the move's tile, else
 * `overridden`, which the window records and never announces.
 *
 * @stability unstable
 */
import { Cmd, Machine } from "@demlik/tea/effect";
import { Result, Schema } from "effect";
import { apply } from "../runtime/Patch.ts";
import { focus } from "../tezgah/Layout.ts";
import { CursorKey, TezgahView, TileId } from "../tezgah/Workspace.ts";

const Ms = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));

/**
 * Schema for one focus move this window made and the server has not answered: its press slot `n`,
 * its letter once dated, the tile it left and the tile it moved to, the cursor it left behind on
 * `from`, and tezgah's answer once it came: the inbox position it was taken at, and how long the
 * answer took.
 *
 * @stability unstable
 * @category schemas
 */
export const PendingMutation = Schema.Struct({
  n: Schema.Int,
  letter: Schema.NullOr(Schema.String),
  from: TileId,
  to: TileId,
  cursor: Schema.NullOr(CursorKey),
  answer: Schema.NullOr(Schema.Struct({ pos: Schema.Int, ms: Ms })),
});

/**
 * Schema for the window's tezgah child: the workspace it shows, tezgah's last view and its
 * revision, and the moves still pending.
 *
 * @stability unstable
 * @category schemas
 */
export const TezgahClient = Schema.Struct({
  workspace: Schema.Int,
  serverState: Schema.NullOr(TezgahView),
  rev: Schema.Int,
  pendingMutations: Schema.Array(PendingMutation),
});

/**
 * The window's tezgah child, as `TezgahClient` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type TezgahClient = typeof TezgahClient.Type;

const Msg = Schema.Union([
  /** A whole view from tezgah, as the wire carries it. */
  Schema.Struct({ type: Schema.Literal("server"), rev: Schema.Int, view: Schema.Unknown }),
  /** One view patch from tezgah, from revision `base` to `rev`. */
  Schema.Struct({ type: Schema.Literal("patch"), base: Schema.Int, rev: Schema.Int, patch: Schema.Unknown }),
  /** The window moved focus from `from` to `to`, leaving `cursor` on `from`, as the letter in press
   *  slot `n`. */
  Schema.Struct({
    type: Schema.Literal("move"),
    n: Schema.Int,
    from: TileId,
    to: TileId,
    cursor: Schema.NullOr(CursorKey),
  }),
  /** Press slot `n` was given its letter id. */
  Schema.Struct({ type: Schema.Literal("dated"), n: Schema.Int, letter: Schema.String }),
  /** tezgah took `letter` at inbox position `pos`, answered after `ms`. */
  Schema.Struct({ type: Schema.Literal("accepted"), letter: Schema.String, pos: Schema.Int, ms: Ms }),
  /** tezgah refused `letter`, answered after `ms`: its state did not change. */
  Schema.Struct({ type: Schema.Literal("refused"), letter: Schema.String, ms: Ms }),
]);

/**
 * The type of a Msg the window's tezgah child takes: a whole view, or a patch.
 *
 * @stability unstable
 * @category models
 */
export type TezgahMsg = typeof Msg.Type;

/** Ask tezgah for a whole view: the shown one stays until it comes. The window turns it into its
 *  own open call and never runs it. */
const ask = Cmd.make("ask", { input: Schema.Struct({}), ok: Schema.Null, err: [] });

/** A pending move dropped: the window records it as its `focus` row and never runs it. */
const settled = Cmd.make("settled", {
  input: Schema.Struct({ letter: Schema.String, result: Schema.Literals(["kept", "overridden"]), ms: Ms }),
  ok: Schema.Null,
  err: [],
});

/**
 * The type of a Cmd the window's tezgah child asks of its window: a whole view, or a move's row.
 *
 * @stability unstable
 * @category models
 */
export type TezgahCmd = ReturnType<typeof ask> | ReturnType<typeof settled>;

type Step = readonly [TezgahClient, ReadonlyArray<TezgahCmd>];

type Mutation = typeof PendingMutation.Type;

/** The server's focus on the client's workspace, or null before its first view. */
const serverFocus = (s: TezgahClient): string | null =>
  s.serverState?.workspaces.find((w) => w.n === s.workspace)?.focus ?? null;

/** Drops each move that is answered and shown: its answer came and the shown view is at or past it. */
const confirmed = (s: TezgahClient): Step => {
  const done = s.pendingMutations.filter((p) => p.answer !== null && p.answer.pos <= s.rev);
  return done.length === 0
    ? [s, []]
    : [
        { ...s, pendingMutations: s.pendingMutations.filter((p) => !done.includes(p)) },
        done.map((p) =>
          settled({
            letter: p.letter ?? "",
            result: serverFocus(s) === p.to ? "kept" : "overridden",
            ms: p.answer?.ms ?? 0,
          }),
        ),
      ];
};

/** The moves with `letter`'s one changed by `change`. */
const changed = (s: TezgahClient, letter: string, change: (p: Mutation) => Mutation): TezgahClient => ({
  ...s,
  pendingMutations: s.pendingMutations.map((p) => (p.letter === letter ? change(p) : p)),
});

const decodeView = Schema.decodeUnknownResult(TezgahView);
const encodeView = Schema.encodeUnknownResult(TezgahView);

/**
 * The window's tezgah child as one tea machine. Its ctx names the workspace the window shows.
 *
 * @stability unstable
 * @category machines
 */
export const tezgahMachine = Machine.make({
  model: TezgahClient,
  msg: Msg,
  cmds: [ask, settled],
  types: { ctx: {} as { readonly workspace: number } },
  init: (loaded, ctx) => [
    loaded ?? TezgahClient.make({ workspace: ctx.workspace, serverState: null, rev: 0, pendingMutations: [] }),
    [],
  ],
  update: {
    server: (s, m): Step => {
      const view = decodeView(m.view);
      return Result.isSuccess(view) ? confirmed({ ...s, serverState: view.success, rev: m.rev }) : [s, []];
    },
    patch: (s, m): Step => {
      if (s.serverState === null) {
        return [s, [ask({})]];
      }

      if (m.rev <= s.rev) {
        return [s, []];
      }

      const view = s.serverState;
      const next: Result.Result<TezgahView, unknown> =
        m.base === s.rev && m.rev === s.rev + 1
          ? Result.flatMap(
              Result.flatMap(encodeView(view), (before) => apply(before, m.patch)),
              decodeView,
            )
          : Result.fail("gap");
      return Result.isSuccess(next) ? confirmed({ ...s, serverState: next.success, rev: m.rev }) : [s, [ask({})]];
    },
    move: (s, m): Step => [
      {
        ...s,
        pendingMutations: [
          ...s.pendingMutations,
          PendingMutation.make({ n: m.n, letter: null, from: m.from, to: m.to, cursor: m.cursor, answer: null }),
        ],
      },
      [],
    ],
    dated: (s, m): Step => [
      {
        ...s,
        pendingMutations: s.pendingMutations.map((p) =>
          p.n === m.n && p.letter === null ? { ...p, letter: m.letter } : p,
        ),
      },
      [],
    ],
    accepted: (s, m): Step => confirmed(changed(s, m.letter, (p) => ({ ...p, answer: { pos: m.pos, ms: m.ms } }))),
    // tezgah's state did not change, so the move is dropped now: the drawn focus goes back to the server's.
    refused: (s, m): Step => {
      const gone = s.pendingMutations.filter((p) => p.letter === m.letter);
      return [
        { ...s, pendingMutations: s.pendingMutations.filter((p) => p.letter !== m.letter) },
        gone.map(() => settled({ letter: m.letter, result: "overridden", ms: m.ms })),
      ];
    },
    ask_ok: (s): Step => [s, []],
    ask_err: (s): Step => [s, []],
    settled_ok: (s): Step => [s, []],
    settled_err: (s): Step => [s, []],
  },
});

/** One pending focus move over a view: the workspace that holds `to` focuses it, and `from`'s tile
 *  shows the cursor the move left on it, as tezgah will once it takes the move (0165, 0167). */
const applyFocus = (view: TezgahView | null, mutation: Mutation): TezgahView | null =>
  view === null
    ? null
    : {
        workspaces: view.workspaces.map((w) => focus(w, mutation.to)),
        tiles: view.tiles.map((t) => (t.id === mutation.from ? { ...t, cursor: mutation.cursor } : t)),
      };

/**
 * Returns the state a window draws: the server state with every pending move applied on top. It
 * is derived on each read and never stored (0167); with nothing pending it is the server state.
 *
 * @stability unstable
 * @category getters
 */
export const optimisticState = (m: TezgahClient): TezgahView | null =>
  m.pendingMutations.reduce(applyFocus, m.serverState);
