// The relation rows' fold, one row at a time (0037, 0046): `related` adds its tuple and `unrelated`
// removes it, in the referee's order. Which rows count is the layer's call, never this machine's:
// `RelationsLedger.ts` trusts only its own writer, and `RelationsMemory.ts` trusts what it was given.
import { applyCell } from "@demlik/tea";
import { Machine } from "@demlik/tea/effect";
import * as Schema from "effect/Schema";
import { Row } from "../Relation.ts";

const Model = Schema.Struct({ tuples: Schema.ReadonlySet(Schema.String) });

type Model = typeof Model.Type;

const Msg = Schema.Struct({ type: Schema.Literal("recorded"), row: Row });

/**
 * The brand of the live tuples: only this module reads or makes them.
 *
 * @internal
 */
export const TuplesTypeId: unique symbol = Symbol.for("@kampus/libfabrika/permissions/Tuples");

/**
 * One tuple as a set member: Zanzibar's `object#relation@user`, written subject first.
 *
 * @internal
 */
export const tupleKey = (subject: string, relation: string, object: string): string =>
  `${subject}#${relation}@${object}`;

/** @internal */
export const relations = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: () => [{ tuples: new Set<string>() }, []],
  update: {
    recorded: (s, { row }) => {
      const key = tupleKey(row.subject, row.relation, row.object);
      const tuples = new Set(s.tuples);

      Row.match(row, {
        related: () => tuples.add(key),
        unrelated: () => tuples.delete(key),
      });

      return [{ tuples }, []];
    },
  },
});

/**
 * The live tuples after these rows, folded in their order.
 *
 * @internal
 */
export const fold = (rows: Iterable<typeof Row.Type>) => {
  let model: Model = relations.init(null, undefined)[0];

  for (const row of rows) {
    model = applyCell(relations, model, { type: "recorded", row })[0];
  }

  return { [TuplesTypeId]: model.tuples } as const;
};

/**
 * Whether the tuples hold this one.
 *
 * @internal
 */
export const holds = (tuples: { readonly [TuplesTypeId]: ReadonlySet<string> }, key: string): boolean =>
  tuples[TuplesTypeId].has(key);
