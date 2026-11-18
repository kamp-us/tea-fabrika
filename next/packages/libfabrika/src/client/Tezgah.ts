/**
 * A window's side of tezgah (0167): the server state tezgah last sent, and the focus moves this
 * window made that the server has not answered yet. The drawn state is derived from the two by
 * `optimisticState` and is never stored. One tea machine; the window parent steps it by hand.
 *
 * Its states: `serverState` is null until the first view that decodes as `TezgahView`, then the
 * newest one. A patch must start at the shown revision and end one past it; anything else keeps
 * the shown view and asks for a whole one, as a program client does (`runtime/Client.ts`).
 *
 * Each pending move is `waiting {n}` for its press slot `n` to be given a letter id, then
 * `sent {letter}`, then `answered {letter, pos, ms}` once tezgah accepted it at inbox position
 * `pos`. Only a waiting move is dated, and only an answered move is dropped on a view: once a view
 * at or past `pos` is shown, in either order. A refused move is dropped at once, whatever its state,
 * as Replicache drops a mutation the server has confirmed. Each drop asks the window to record it:
 * `overridden` when tezgah refused it or when dropping it moves the drawn focus, a jump back the
 * window records and never announces; `kept` otherwise, so an earlier move its own next move
 * superseded is kept. Moves dropped together are taken one at a time, oldest first.
 */
import { Cmd, Machine } from "@demlik/tea/effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { apply } from "../runtime/Patch.ts";
import { focus } from "../tezgah/Layout.ts";
import { CursorKey, TezgahView, TileId } from "../tezgah/Workspace.ts";

const Ms = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));

/**
 * Schema for how far a pending move has gone: waiting for press slot `n` to be given its letter id,
 * sent as `letter`, or answered by tezgah at inbox position `pos`, `ms` after it was written.
 *
 * @category schemas
 */
export const MoveState = Schema.TaggedUnion({
  waiting: { n: Schema.Int },
  sent: { letter: Schema.String },
  answered: { letter: Schema.String, pos: Schema.Int, ms: Ms },
});

/**
 * Schema for one focus move this window made and the server has not answered: the tile it left and
 * the tile it moved to, the cursor it left behind on `from`, and how far it has gone.
 *
 * @category schemas
 */
export const PendingMutation = Schema.Struct({
  from: TileId,
  to: TileId,
  cursor: Schema.NullOr(CursorKey),
  state: MoveState,
});

/**
 * Schema for the window's tezgah child: the workspace it shows, tezgah's last view and its
 * revision, and the moves still pending.
 *
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
 * @category models
 */
export type TezgahCmd = ReturnType<typeof ask> | ReturnType<typeof settled>;

type Step = readonly [TezgahClient, ReadonlyArray<TezgahCmd>];

type Mutation = typeof PendingMutation.Type;

const S = MoveState.cases;

/** The letter a move went out as, or null while it waits for one. */
const sentAs = (p: Mutation): string | null => (p.state._tag === "waiting" ? null : p.state.letter);

/** The focus the window draws on its workspace with `pending` over the server state. */
const drawnFocus = (s: TezgahClient, pending: ReadonlyArray<Mutation>): string | null =>
  optimisticState({ ...s, pendingMutations: pending })?.workspaces.find((w) => w.n === s.workspace)?.focus ?? null;

/** Drops each answered move the shown view is at or past, one at a time, oldest first: each is
 *  `overridden` when dropping it moves the drawn focus, else `kept`. */
const confirmed = (s: TezgahClient): Step => {
  let pending = s.pendingMutations;
  const rows: Array<TezgahCmd> = [];

  for (const p of s.pendingMutations) {
    if (p.state._tag !== "answered" || p.state.pos > s.rev) {
      continue;
    }

    const was = drawnFocus(s, pending);
    pending = pending.filter((x) => x !== p);
    const result = drawnFocus(s, pending) === was ? "kept" : "overridden";
    rows.push(settled({ letter: p.state.letter, result, ms: p.state.ms }));
  }

  return rows.length === 0 ? [s, []] : [{ ...s, pendingMutations: pending }, rows];
};

const decodeView = Schema.decodeUnknownResult(TezgahView);

const encodeView = Schema.encodeUnknownResult(TezgahView);

/**
 * The window's tezgah child as one tea machine. Its ctx names the workspace the window shows.
 *
 * @category machines
 */
export const tezgahMachine = Machine.make({
  model: TezgahClient,
  msg: Msg,
  cmds: [ask, settled],
  // SAFETY: tea's `types` slot only carries the ctx type, the workspace's number; tea never reads
  // this empty value (0561).
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
          PendingMutation.make({
            from: m.from,
            to: m.to,
            cursor: m.cursor,
            state: S.waiting.make({ n: m.n }),
          }),
        ],
      },
      [],
    ],
    dated: (s, m): Step => [
      {
        ...s,
        pendingMutations: s.pendingMutations.map((p) =>
          p.state._tag === "waiting" && p.state.n === m.n ? { ...p, state: S.sent.make({ letter: m.letter }) } : p,
        ),
      },
      [],
    ],
    // Only a sent move is answered; an answer to anything else changes nothing.
    accepted: (s, m): Step =>
      confirmed({
        ...s,
        pendingMutations: s.pendingMutations.map((p) =>
          p.state._tag === "sent" && p.state.letter === m.letter
            ? { ...p, state: S.answered.make({ letter: m.letter, pos: m.pos, ms: m.ms }) }
            : p,
        ),
      }),
    // tezgah's state did not change, so the move is dropped now: the drawn focus goes back to the server's.
    refused: (s, m): Step => {
      const gone = s.pendingMutations.filter((p) => sentAs(p) === m.letter);

      return [
        { ...s, pendingMutations: s.pendingMutations.filter((p) => sentAs(p) !== m.letter) },
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
 * @category getters
 */
export const optimisticState = (m: TezgahClient): TezgahView | null =>
  m.pendingMutations.reduce(applyFocus, m.serverState);
