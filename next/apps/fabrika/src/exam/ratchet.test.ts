// The ratchet on the list files (no check reads a list that lets broken code pass, ticket 933): a list only shrinks until it is deleted. The core
// is judged on generated rows here; ratchet.integration.test.ts runs the script on a planted git
// repository, as CI runs it, so it runs on the schedule (a test that needs a real resource runs only in main's full run).
import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Effect, Exit } from "effect";
import * as fc from "fast-check";
import { excludeKey, leadConfig, ROWS, text, tsconfigText } from "./ratchet.test-support.ts";

import { added, judge, LISTS } from "./ratchet.ts";

/** A lint row's key, as the ratchet reads it. */
const lintKey = (r: { file: string; rule: string; code: string }) => JSON.stringify([r.file, r.rule, r.code]);

const runs = { seed: 119120, numRuns: 100 };

// SAFETY: LISTS names the four lists in this order: next, agents, dead and the lead's tsconfig.
const [NEXT, AGENTS, DEAD, TSCONFIG] = LISTS as [
  (typeof LISTS)[0],
  (typeof LISTS)[0],
  (typeof LISTS)[0],
  (typeof LISTS)[0],
];

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
          const moved = Arr.map(rows, (r, j) => (j === i ? { ...r, [name]: r[name] + suffix } : r));
          expect(answer(list, text(rows), text(moved))).toEqual({
            _tag: "stuck",
            file: list.file,
            reason: "row_added",
            rows: [lintKey(moved[i]!)],
          });
          const extra = Arr.map(order, (r) => ({ ...r, note: suffix }));
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
          const moved = Arr.map(rows, (r, j) => (j === i ? { ...r, [name]: r[name] + suffix } : r));
          expect(answer(DEAD, text(rows), text(moved))).toEqual({
            _tag: "stuck",
            file: DEAD.file,
            reason: "row_added",
            rows: [deadKey(moved[i]!)],
          });
          const reworded = Arr.map(order, (r) => ({ ...r, reason: r.reason + suffix }));
          expect(answer(DEAD, text(rows), text(reworded))).toEqual({ _tag: "done", file: DEAD.file });
        },
      ),
      runs,
    );
  });
});

describe("a file that comes, goes or does not read (L3)", () => {
  it("L3 scenario: per list, a new file is all added, a deleted file is done, an unreadable head is not a list", () => {
    // The three ledgers: the tsconfig is no `entries` file, and L6 holds it.
    for (const list of [NEXT, AGENTS, DEAD]) {
      // SAFETY: ROWS in ratchet.test-support.ts is written with one key for each ledger `file` that LISTS in ratchet.ts names.
      const rows = ROWS[list.file as keyof typeof ROWS];
      const keys = Arr.map(rows, (r) => ("scope" in r ? deadKey(r) : lintKey(r)));
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

// The real-resource rule renamed 130 test files, each with its rows in next-ledger.json. A row is its file, rule and
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
            renamed: fc.subarray(Arr.map(rows, (r) => r.file)),
            extra: lintRow,
            list: fc.constantFrom(NEXT, AGENTS),
          }),
        ),
        ({ rows, renamed, extra, list }) => {
          const renames = new Map(Arr.map(renamed, (file) => [file, `${file}.integration`]));
          const head = Arr.map(rows, (r) => ({ ...r, file: renames.get(r.file) ?? r.file }));
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

// Ticket 2358: `.agents/tsconfig.json` checks every lead file by glob and keeps the files that do not pass yet in `exclude`.
// That list is a list file like the ledgers, so it only shrinks. Its text is JSON with `//` comment lines, and a path in
// it is read from `.agents/`. Plants, each run once on ratchet.ts and restored: renames not read (red: the rename law);
// comments not dropped (red: all three laws); the `.agents/` folder left off a path (red: all three laws); a base with
// no `exclude` key read as the start, in place of one with no glob (red: the first scenario law); a head's `include`
// glob or `extends` not required (red: the second scenario law, once for each).
describe("the lead's tsconfig exclude list only shrinks (L6)", () => {
  const path = fc.stringMatching(/^[a-z]{1,6}(\/[a-z]{1,6}){0,2}\.ts$/);

  it("L6: a path added to exclude is added; fewer paths, a new order and a new comment are not", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(path, { minLength: 1, maxLength: 6 }).chain((paths) =>
          fc.record({
            paths: fc.constant(paths),
            order: fc.shuffledSubarray(paths, { minLength: paths.length }),
            fewer: fc.subarray(paths),
            extra: path.filter((p) => !paths.includes(p)),
            note: fc.constantFrom("fixed soon", "a, b", "x"),
          }),
        ),
        ({ paths, order, fewer, extra, note }) => {
          const base = tsconfigText(paths);
          expect(answer(TSCONFIG, base, tsconfigText(order, note))).toEqual({ _tag: "done", file: TSCONFIG.file });
          expect(answer(TSCONFIG, base, tsconfigText(fewer))).toEqual({ _tag: "done", file: TSCONFIG.file });
          expect(answer(TSCONFIG, base, tsconfigText([...paths, extra]))).toEqual({
            _tag: "stuck",
            file: TSCONFIG.file,
            reason: "row_added",
            rows: [excludeKey(extra)],
          });
        },
      ),
      runs,
    );
  });

  it("L6: a path whose file git renamed is the same row; a further path still is added", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(path, { minLength: 1, maxLength: 6 }).chain((paths) =>
          fc.record({
            paths: fc.constant(paths),
            renamed: fc.subarray(paths),
            extra: path.filter((p) => !paths.includes(p)),
          }),
        ),
        ({ paths, renamed, extra }) => {
          const renames = new Map(Arr.map(renamed, (file) => [`.agents/${file}`, `.agents/moved/${file}`]));
          const head = Arr.map(paths, (file) => (renamed.includes(file) ? `moved/${file}` : file));
          expect(Effect.runSync(judge(TSCONFIG, tsconfigText(paths), tsconfigText(head), renames))).toEqual({
            _tag: "done",
            file: TSCONFIG.file,
          });
          // Without the renames each moved path is a row added: the map is what admits them.
          const unmapped = Effect.runSync(judge(TSCONFIG, tsconfigText(paths), tsconfigText(head)));
          expect(unmapped._tag === "stuck" ? unmapped.rows.length : 0).toBe(renamed.length);
          expect(Effect.runSync(judge(TSCONFIG, tsconfigText(paths), tsconfigText([...head, extra]), renames))).toEqual(
            { _tag: "stuck", file: TSCONFIG.file, reason: "row_added", rows: [excludeKey(extra)] },
          );
        },
      ),
      runs,
    );
  });

  it("L6 scenario: no exclude key is an empty list, and a base from before the glob starts the list; a base with the glob does not", () => {
    const base = tsconfigText(["a.ts"]);
    const done = { _tag: "done", file: TSCONFIG.file };
    expect(answer(TSCONFIG, base, leadConfig())).toEqual(done);
    expect(answer(TSCONFIG, base, null)).toEqual(done);
    expect(answer(TSCONFIG, null, base)).toEqual({
      _tag: "stuck",
      file: TSCONFIG.file,
      reason: "row_added",
      rows: [excludeKey("a.ts")],
    });
    // Before the glob there is no list to hold: the change that adds the glob and the first rows sets the start.
    expect(answer(TSCONFIG, leadConfig({ include: ["raw.d.ts", "skills/lead/a.ts"] }), base)).toEqual(done);
    // After it, a base with no `exclude` key is an empty list, so rows added later are added.
    expect(answer(TSCONFIG, leadConfig(), base)).toEqual({
      _tag: "stuck",
      file: TSCONFIG.file,
      reason: "row_added",
      rows: [excludeKey("a.ts")],
    });
  });

  it("L6 scenario: a head with no glob in include, or another extends, is not a list, whatever its base", () => {
    const base = tsconfigText(["a.ts"]);
    const refused = { _tag: "stuck", file: TSCONFIG.file, reason: "not_a_list", rows: [] };

    for (const head of [
      leadConfig({ include: ["raw.d.ts", "skills/lead/**/*.ts"] }),
      leadConfig({ include: [] }),
      JSON.stringify({ extends: "../tsconfig.base.json", exclude: [] }),
      leadConfig({ extends: "./tsconfig.lead.json" }),
      JSON.stringify({ include: ["skills/**/*.ts"] }),
    ]) {
      expect(answer(TSCONFIG, base, head)).toEqual(refused);
      expect(answer(TSCONFIG, leadConfig({ include: ["raw.d.ts"] }), head)).toEqual(refused);
    }
  });

  it("L6 scenario: a file that is not JSON, has a comment after a value or lists a number is not a list; a base that does not read fails", () => {
    const base = tsconfigText(["a.ts"]);

    for (const head of ["{ not json", `${leadConfig()} // after a value`, leadConfig({ exclude: [1] })]) {
      expect(answer(TSCONFIG, base, head)).toEqual({
        _tag: "stuck",
        file: TSCONFIG.file,
        reason: "not_a_list",
        rows: [],
      });
    }

    // The base's own file does not read: main is broken, so the check fails closed.
    expect(Exit.isFailure(Effect.runSyncExit(judge(TSCONFIG, "{ not json", base)))).toBe(true);
  });
});
