// The pipe stream's fold, next/ (pipe slice 1, 0037, 0046): one `recorded` entry at a time. A pipe
// is `live` from its `piped` row to its `unpiped` row, and `ended` after it; nothing else moves it, so
// a crash or a restart of either end keeps it. Only the brain's own rows count, as in the process
// table. A turn that decides on pipes reads this fold of its own rows, never a cache.
import { applyCell } from "@demlik/tea";
import { Machine } from "@demlik/tea/effect";
import { Option, Schema } from "effect";
import type { LedgerTurn } from "../../ledger/LedgerTransaction.ts";
import { type Entry, valueFor } from "../../ledger/Log.ts";
import { type Listed, PipeEvent, STREAM } from "../Pipes.ts";

/** One pipe the fold knows: its `piped` row, and whether it is still live. */
const Held = Schema.Struct({ piped: PipeEvent.cases.piped, live: Schema.Boolean, order: Schema.Int });

const Model = Schema.Struct({ pipes: Schema.ReadonlyMap(Schema.String, Held) });
type Model = typeof Model.Type;

const Msg = Schema.Struct({ type: Schema.Literal("recorded"), event: PipeEvent });

const fold = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: () => [{ pipes: new Map() }, []],
  update: {
    recorded: (s, { event }) =>
      PipeEvent.match(event, {
        // A second `piped` under one id changes nothing: the first one is the pipe.
        piped: (piped): [Model, []] =>
          s.pipes.has(piped.pipe)
            ? [s, []]
            : [{ pipes: new Map(s.pipes).set(piped.pipe, { piped, live: true, order: s.pipes.size }) }, []],
        unpiped: ({ pipe }): [Model, []] => {
          const held = s.pipes.get(pipe);
          return held === undefined || !held.live
            ? [s, []]
            : [{ pipes: new Map(s.pipes).set(pipe, { ...held, live: false }) }, []];
        },
      }),
  },
});

const decodeEvent = Schema.decodeUnknownOption(PipeEvent);

const listed = ({ piped, live }: typeof Held.Type): Listed => ({
  pipe: piped.pipe,
  from: piped.from,
  to: piped.to,
  live,
});

/**
 * The pipes the brain recorded, as one turn reads them.
 *
 * @internal
 */
export class PipeTable {
  private readonly model: Model;

  constructor(entries: Iterable<Entry>, by: string) {
    let model = fold.init(null, undefined)[0];

    for (const entry of entries) {
      if (entry.by !== by || !Object.hasOwn(PipeEvent.cases, entry._tag)) {
        continue;
      }

      const event = decodeEvent(valueFor(entry));

      if (Option.isSome(event)) {
        model = applyCell(fold, model, { type: "recorded", event: event.value })[0];
      }
    }

    this.model = model;
  }

  /** The brain's pipe rows inside one ledger turn. */
  static read(turn: Pick<LedgerTurn, "read">, by: string): PipeTable {
    return new PipeTable(turn.read(STREAM, 0), by);
  }

  /** The pipe saved under `pipe`, live or ended. */
  saved(pipe: string): Option.Option<Listed> {
    return Option.map(Option.fromUndefinedOr(this.model.pipes.get(pipe)), listed);
  }

  /** The `piped` row saved under `pipe`, with every fact it keeps. */
  row(pipe: string): Option.Option<typeof PipeEvent.cases.piped.Type> {
    return Option.map(Option.fromUndefinedOr(this.model.pipes.get(pipe)), (held) => held.piped);
  }

  /** Every live pipe with `name` as an end, oldest first. */
  touching(name: string): ReadonlyArray<typeof PipeEvent.cases.piped.Type> {
    return [...this.model.pipes.values()]
      .filter((held) => held.live && (held.piped.from.name === name || held.piped.to.name === name))
      .map((held) => held.piped);
  }

  /** The live pipe into `name`'s `input`, if any: a pipe never fans in. */
  into(name: string, input: string): Option.Option<Listed> {
    return Option.fromUndefinedOr(
      [...this.model.pipes.values()].find(
        (held) => held.live && held.piped.to.name === name && held.piped.to.input === input,
      ),
    ).pipe(Option.map(listed));
  }

  /** The pipes `name` is an end of: each live one, and the last one made into each of its inputs. */
  list(name: string): ReadonlyArray<Listed> {
    const all = [...this.model.pipes.values()].sort((a, b) => a.order - b.order);
    const last = new Map<string, typeof Held.Type>();

    for (const held of all) {
      if (held.piped.to.name === name) {
        last.set(held.piped.to.input, held);
      }
    }

    return all
      .filter((held) => (held.live && held.piped.from.name === name) || [...last.values()].includes(held))
      .map(listed);
  }
}
