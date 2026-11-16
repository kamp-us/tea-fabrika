// A piped value on its way in, next/ (pipe slice 1, 0553, 0037, 0046). The reader's runner steps one
// of these per piped input with each chunk message the writer's runner sent, and with `down` when that
// life of the writer ended. Its three states are the whole control state of a value arriving: nothing,
// a send in progress, or one send complete. `whole` is never saved: in the turn a chunk makes it, the
// runner hands the value to the program and steps `handed`. So the fold never holds a value the
// program has seen, and a cut send or a crash cannot change what the program holds.
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Part } from "../Chunk.ts";

/** @internal */
export const State = Schema.TaggedUnion({
  /** Nothing is arriving. */
  empty: {},
  /** Send `id` came in order from its seq 0 through `seq`, holding `items` so far. */
  arriving: { id: Schema.NonEmptyString, seq: Schema.Int, items: Schema.Array(Schema.Json) },
  /** One send came whole, and the program has not been handed it yet. */
  whole: { items: Schema.Array(Schema.Json) },
});
type State = typeof State.Type;

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("chunk"), items: Schema.Array(Schema.Json), part: Part }),
  Schema.Struct({ type: Schema.Literal("down") }),
  Schema.Struct({ type: Schema.Literal("handed") }),
]);

const empty = (): [State, []] => [State.cases.empty.make({}), []];

/** @internal */
export const machine = Machine.make({
  model: State,
  msg: Msg,
  cmds: [],
  init: (loaded) => [loaded ?? State.cases.empty.make({}), []],
  update: {
    chunk: (s, { items, part }) => {
      // Seq 0 starts a new value and drops any other; seq n adds only to n - 1 of the same send.
      const held =
        part.seq === 0 ? [] : s._tag === "arriving" && s.id === part.id && s.seq === part.seq - 1 ? s.items : null;

      // A cut or stray chunk: what was arriving is gone, and nothing is handed.
      if (held === null) {
        return empty();
      }

      const all = [...held, ...items];
      return [
        part.last
          ? State.cases.whole.make({ items: all })
          : State.cases.arriving.make({ id: part.id, seq: part.seq, items: all }),
        [],
      ];
    },
    // A value still arriving is dropped; the program's own value is untouched.
    down: empty,
    handed: empty,
  },
});
