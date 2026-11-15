// The ratchet on the list files (0524, ticket 933): a list only shrinks until it is deleted. The core
// is judged on generated rows here; ratchet.integration.test.ts runs the script on a planted git
// repository, as CI runs it, so it runs on the schedule (0536).
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import * as fc from "fast-check";
import { ROWS, text } from "./ratchet.test-support.ts";

import { added, judge, LISTS } from "./ratchet.ts";

/** A lint row's key, as the ratchet reads it. */
const lintKey = (r: { file: string; rule: string; code: string }) => JSON.stringify([r.file, r.rule, r.code]);

const runs = { seed: 119120, numRuns: 100 };
const [NEXT, AGENTS, DEAD] = LISTS as [(typeof LISTS)[0], (typeof LISTS)[0], (typeof LISTS)[0]];

const answer = (list: (typeof LISTS)[0], base: string | null, head: string | null) =>
  Effect.runSync(judge(list, base, head));

const deadKey = (r: { scope: string; kind: string; id: string }) => JSON.stringify([r.scope, r.kind, r.id]);

// Five letters, so a key is often repeated and the counting matters.
const key = fc.constantFrom("a", "b", "c", "d", "e");

describe("added (L1)", () => {
  it("L1: a head drawn from the base adds nothing; one more key, new or a further copy, is added", () => {
    fc.assert(
      fc.property(
        fc.array(key, { maxLength: 12 }).chain((base) =>
          fc.record({
            base: fc.constant(base),
            subset: fc.shuffledSubarray(base),
            order: fc.shuffledSubarray(base, { minLength: base.length }),
            sorted: fc.subarray(base),
            extra: fc.oneof(key, fc.constant("z")),
            at: fc.nat({ max: base.length }),
          }),
        ),
        ({ base, subset, order, sorted, extra, at }) => {
          expect(added(base, subset)).toEqual([]);
          expect(added(base, sorted)).toEqual([]);
          expect(added(base, order)).toEqual([]);
          expect(added(base, [...order.slice(0, at), extra, ...order.slice(at)])).toEqual([extra]);
        },
      ),
      runs,
    );
  });
});

const field = fc.string({ maxLength: 8 });
// A change that keeps the old text and adds to it, spaces included, so it is never the same string.
const change = fc.constantFrom(" ", "  ", "\t", "x");

const lintRow = fc.record({ file: field, rule: field, code: field });
const deadRow = fc.record({ scope: field, kind: field, id: field, reason: field });

describe("row identity follows each reader (L2)", () => {
  it("L2: in the lint lists, a changed file, rule or code is an added row; an extra key or a new order is not", () => {
    fc.assert(
      fc.property(
        fc.array(lintRow, { minLength: 1, maxLength: 6 }).chain((rows) =>
          fc.record({
            rows: fc.constant(rows),
            i: fc.nat({ max: rows.length - 1 }),
            name: fc.constantFrom("file" as const, "rule" as const, "code" as const),
            suffix: change,
            order: fc.shuffledSubarray(rows, { minLength: rows.length }),
            list: fc.constantFrom(NEXT, AGENTS),
          }),
        ),
        ({ rows, i, name, suffix, order, list }) => {
          const moved = rows.map((r, j) => (j === i ? { ...r, [name]: r[name] + suffix } : r));
          expect(answer(list, text(rows), text(moved))).toEqual({
            _tag: "stuck",
            file: list.file,
            reason: "row_added",
            rows: [lintKey(moved[i]!)],
          });
          const extra = order.map((r) => ({ ...r, note: suffix }));
          expect(answer(list, text(rows), text(extra))).toEqual({ _tag: "done", file: list.file });
        },
      ),
      runs,
    );
  });

  it("L2: in unreachable-ledger.json, a changed scope, kind or id is an added row; a new reason or order is not", () => {
    fc.assert(
      fc.property(
        fc.array(deadRow, { minLength: 1, maxLength: 6 }).chain((rows) =>
          fc.record({
            rows: fc.constant(rows),
            i: fc.nat({ max: rows.length - 1 }),
            name: fc.constantFrom("scope" as const, "kind" as const, "id" as const),
            suffix: change,
            order: fc.shuffledSubarray(rows, { minLength: rows.length }),
          }),
        ),
        ({ rows, i, name, suffix, order }) => {
          const moved = rows.map((r, j) => (j === i ? { ...r, [name]: r[name] + suffix } : r));
          expect(answer(DEAD, text(rows), text(moved))).toEqual({
            _tag: "stuck",
            file: DEAD.file,
            reason: "row_added",
            rows: [deadKey(moved[i]!)],
          });
          const reworded = order.map((r) => ({ ...r, reason: r.reason + suffix }));
          expect(answer(DEAD, text(rows), text(reworded))).toEqual({ _tag: "done", file: DEAD.file });
        },
      ),
      runs,
    );
  });
});

describe("a file that comes, goes or does not read (L3)", () => {
  it("L3 scenario: per list, a new file is all added, a deleted file is done, an unreadable head is not a list", () => {
    for (const list of LISTS) {
      const rows = ROWS[list.file as keyof typeof ROWS];
      const keys = rows.map((r) => ("scope" in r ? deadKey(r) : lintKey(r)));
      expect(answer(list, null, text(rows))).toEqual({
        _tag: "stuck",
        file: list.file,
        reason: "row_added",
        rows: keys,
      });
      expect(answer(list, text(rows), null)).toEqual({ _tag: "done", file: list.file });
      expect(answer(list, null, null)).toEqual({ _tag: "done", file: list.file });
      expect(answer(list, text(rows), "{ not json")).toEqual({
        _tag: "stuck",
        file: list.file,
        reason: "not_a_list",
        rows: [],
      });
      expect(answer(list, text(rows), JSON.stringify({ entries: [{ file: 1 }] }))).toEqual({
        _tag: "stuck",
        file: list.file,
        reason: "not_a_list",
        rows: [],
      });
      // The base's own file does not read: main is broken, so the check fails closed.
      expect(Exit.isFailure(Effect.runSyncExit(judge(list, "{ not json", text(rows))))).toBe(true);
    }
  });
});

// 0536 renamed 130 test files, each with its rows in next-ledger.json. A row is its file, rule and
// code, so a rename alone would read as a new row; the ratchet reads the base's rows under git's
// renames, so the same break under a new name is the same row, and one more row still is not.
// Plants, each run once on ratchet.ts and restored: `renames` ignored (red: every renamed row
// added); renames read from the head's side (red: the extra row in a renamed file passed).
describe("a renamed file keeps its rows (L5)", () => {
  it("L5: rows whose file was renamed are not added; a further row, in any file, still is", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(lintRow, { minLength: 1, maxLength: 6, selector: (r) => r.file }).chain((rows) =>
          fc.record({
            rows: fc.constant(rows),
            renamed: fc.subarray(rows.map((r) => r.file)),
            extra: lintRow,
            list: fc.constantFrom(NEXT, AGENTS),
          }),
        ),
        ({ rows, renamed, extra, list }) => {
          const renames = new Map(renamed.map((file) => [file, `${file}.integration`]));
          const head = rows.map((r) => ({ ...r, file: renames.get(r.file) ?? r.file }));
          expect(Effect.runSync(judge(list, text(rows), text(head), renames))).toEqual({
            _tag: "done",
            file: list.file,
          });
          const grown = [...head, { ...extra, file: `${extra.file}.new` }];
          expect(Effect.runSync(judge(list, text(rows), text(grown), renames))).toEqual({
            _tag: "stuck",
            file: list.file,
            reason: "row_added",
            rows: [lintKey({ ...extra, file: `${extra.file}.new` })],
          });
          // Without the renames the same head is every renamed row added: the map is what admits them.
          const unmapped = Effect.runSync(judge(list, text(rows), text(head)));
          expect(unmapped._tag === "stuck" ? unmapped.rows.length : 0).toBe(renamed.length);
        },
      ),
      runs,
    );
  });
});
