/**
 * A window's prefix key, as tmux's client runs it (0278): each window keeps its own, and nothing of
 * it crosses the wire. The prefix arms on its key, the next key resolves it, and a close of a tile
 * tezgah started asks y/n first. One tea machine; the window parent steps it by hand. It has no
 * timer (0270): only a key ends it.
 *
 * Its states: `idle`; `armed {since}`, the prefix pressed at `since`; `asking {tile, since}`, the
 * close of `tile` waiting for y or n, asked at `since`.
 */
import { Machine } from "@demlik/tea/effect";
import * as Schema from "effect/Schema";
import { TileId } from "../tezgah/Workspace.ts";

const Ms = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));

/**
 * Schema for a window's prefix: idle, armed since a time, or asking about one tile's close.
 *
 * @category schemas
 */
export const Prefix = Schema.TaggedUnion({
  idle: {},
  armed: { since: Ms },
  asking: { tile: TileId, since: Ms },
});

/**
 * A window's prefix, as `Prefix` decodes it.
 *
 * @category models
 */
export type Prefix = typeof Prefix.Type;

const Msg = Schema.Union([
  /** The prefix key, pressed at `at`. */
  Schema.Struct({ type: Schema.Literal("arm"), at: Ms }),
  /** A close of `tile` that waits for y or n, asked at `at`. */
  Schema.Struct({ type: Schema.Literal("question"), tile: TileId, at: Ms }),
  /** The key that ends it: a command, the prefix again, Escape, an unbound key or the answer. */
  Schema.Struct({ type: Schema.Literal("done") }),
]);

type Step = readonly [Prefix, readonly []];

/**
 * The prefix as one tea machine. Only an idle prefix arms, and only an armed one asks the close question.
 *
 * @category machines
 */
export const prefixMachine = Machine.make({
  model: Prefix,
  msg: Msg,
  cmds: [],
  init: (loaded) => [loaded ?? Prefix.cases.idle.make({}), []],
  update: {
    arm: (s, m): Step => [Prefix.isAnyOf(["idle"])(s) ? Prefix.cases.armed.make({ since: m.at }) : s, []],
    question: (s, m): Step => [
      Prefix.isAnyOf(["armed"])(s) ? Prefix.cases.asking.make({ tile: m.tile, since: m.at }) : s,
      [],
    ],
    done: (): Step => [Prefix.cases.idle.make({}), []],
  },
});
