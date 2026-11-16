// next/: the relation rows' fold is one tea machine (0037, 0046), walked from its real `init` with
// its real update (0093). Each cell is read against the tuples the walk holds so far: it relates a
// fresh tuple or one already held, or unrelates a held one or one that was never there. The expected
// tuples are this file's own set of written triples, never the machine's.
//
// sync test left out: the table is never saved. `RelationsLedger.ts` and `RelationsMemory.ts` fold
// it again from the relation rows with `fold` on every read, so its `init` takes no saved model, and
// its Model holds a Set, which JSON text cannot hold as it is (S2, docs/direction/saved-state.md).
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import * as fc from "fast-check";
import { Row } from "../Relation.ts";
import { fold, holds, relations, tupleKey } from "./relationsTable.ts";

const SEED = 119120;

type Triple = readonly [subject: string, relation: string, object: string];
type Move = "relate_fresh" | "relate_held" | "unrelate_held" | "unrelate_absent";

const SUBJECTS = ["person:a", "person:b", "agent:c"] as const;
const RELATIONS = ["member", "owner", "reader"] as const;
const OBJECTS = ["fabrika:demo", "fabrika:work", "repo:x"] as const;

const Cell = fc.record({
  move: fc.noBias(fc.nat()),
  pick: fc.noBias(fc.nat()),
  triple: fc.tuple(fc.constantFrom(...SUBJECTS), fc.constantFrom(...RELATIONS), fc.constantFrom(...OBJECTS)),
});

const Walk = fc.array(Cell, { minLength: 1, maxLength: 60 });

const id = ([s, r, o]: Triple) => JSON.stringify([s, r, o]);

const row = (tag: "related" | "unrelated", [subject, relation, object]: Triple): typeof Row.Type =>
  Row.cases[tag].make({ subject, relation, object });

describe("the relation rows' fold", () => {
  // Plant, run once (0093): `unrelated` leaves its tuple in place (the `tuples.delete(key)` line
  // dropped): red, "an unrelated tuple no longer holds".
  it("a related row holds its tuple until an unrelated row of the same tuple, in the rows' order, and fold agrees with the steps", () => {
    const reached = new Set<Move>();
    fc.assert(
      fc.property(Walk, (cells) => {
        const [start, cmds] = relations.init(null, undefined);
        let model = start;
        expect(cmds).toEqual([]);
        expect(model.tuples.size, "a fresh table holds nothing").toBe(0);
        const held = new Map<string, Triple>();
        const gone = new Map<string, Triple>();
        const rows: Array<typeof Row.Type> = [];

        for (const cell of cells) {
          const present = [...held.values()];
          const absent = (t: Triple) => !held.has(id(t));
          const moves: ReadonlyArray<Move> =
            present.length === 0
              ? ["relate_fresh", "unrelate_absent"]
              : ["relate_fresh", "relate_held", "unrelate_held", "unrelate_held", "unrelate_absent"];
          const move = moves[cell.move % moves.length] ?? "relate_fresh";
          const target =
            move === "relate_held" || move === "unrelate_held" ? present[cell.pick % present.length] : null;
          const triple = target ?? cell.triple;

          if ((move === "relate_fresh" || move === "unrelate_absent") && !absent(triple)) {
            continue;
          }

          reached.add(move);
          const next = row(move.startsWith("relate") ? "related" : "unrelated", triple);
          rows.push(next);
          const [after, out] = applyCell(relations, model, { type: "recorded", row: next });
          expect(out, "a row runs no Cmd").toEqual([]);

          if (next._tag === "related") {
            held.set(id(triple), triple);
            gone.delete(id(triple));
          } else {
            held.delete(id(triple));
            gone.set(id(triple), triple);
          }

          expect(after.tuples.size, `${move}: the table holds exactly the related tuples`).toBe(held.size);
          const folded = fold(rows);

          for (const t of held.values()) {
            expect(holds(folded, tupleKey(...t)), `${move}: a related tuple holds`).toBe(true);
          }

          for (const t of gone.values()) {
            expect(holds(folded, tupleKey(...t)), `${move}: an unrelated tuple no longer holds`).toBe(false);
          }

          model = after;
        }
      }),
      { seed: SEED, numRuns: 100 },
    );
    expect([...reached].toSorted(), "every move ran at least once").toEqual([
      "relate_fresh",
      "relate_held",
      "unrelate_absent",
      "unrelate_held",
    ]);
  });
});
