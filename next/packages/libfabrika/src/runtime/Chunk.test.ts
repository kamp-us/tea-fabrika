// Ticket 1041, next/: L1 and L2 of the pipe plumbing plan (docs/plan/quests/t1041-PLAN.md), written
// before the build. A large output goes to its reader as letters of at most `mail.chunk` bytes.
//
// The contract these laws pin, from the plan's "The chunked send":
//   runtime/Chunk.ts: `cut(send, size)` answers the send's chunks in order, each
//     `{ type, items, part: { id, seq, last } }`, or `TooBig { index, bytes }` when one item cannot
//     fit alone; `join(chunks)` answers the whole list only for one send's seq 0 to n with `last`
//     on n.
// A chunk's size is the bytes of its encoded JSON, the letter the reader's inbox saves.
import { describe, expect, it } from "@effect/vitest";
import { Option, Result, Schema } from "effect";
import * as Arr from "effect/Array";
import * as Str from "effect/String";
import * as fc from "fast-check";
import * as Chunk from "./Chunk.ts";

const SEED = 119120;

const encoder = new TextEncoder();

const bytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).length;

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

/** A value as JSON text carries it, so -0 and other values JSON cannot keep are normalized. */
const copied = (value: unknown): Schema.Json => decodeJson(JSON.stringify(value));

/** The bytes one item takes alone in a chunk of this send at `seq`. */
const alone = (send: { readonly id: string; readonly type: string }, item: Schema.Json, seq: number, last: boolean) =>
  bytes({ type: send.type, items: [item], part: { id: send.id, seq, last } });

/** Items as programs send them: mostly small JSON, and some rows near a chunk's size. */
const Fits = fc.oneof(
  { weight: 2, arbitrary: fc.jsonValue({ maxDepth: 2 }).map(copied) },
  { weight: 1, arbitrary: fc.string({ minLength: 100, maxLength: 900 }).map((text) => copied({ row: text })) },
);

/** An item that may be past a chunk's size. */
const Blob = fc.string({ minLength: 1_000, maxLength: 9_000 }).map((text) => copied({ blob: text }));

const sendWith = (item: fc.Arbitrary<Schema.Json>) =>
  fc.record({
    id: fc.stringMatching(/^process_[0-9a-z]{8}\/[0-9]{1,4}\/[0-9]{1,2}$/),
    type: fc.constantFrom("rows", "lines", "diff"),
    items: fc.oneof(
      { weight: 1, arbitrary: fc.constant<ReadonlyArray<Schema.Json>>([]) },
      { weight: 9, arbitrary: fc.array(item, { maxLength: 40, size: "max" }) },
    ),
  });

/** L1's sends: about one in three holds an item that may not fit alone. */
const Send = fc.oneof(
  { weight: 2, arbitrary: sendWith(Fits) },
  { weight: 1, arbitrary: sendWith(fc.oneof({ weight: 9, arbitrary: Fits }, { weight: 1, arbitrary: Blob })) },
);

const Size = fc.integer({ min: 1_024, max: 8_192 });

type Cut = ReadonlyArray<typeof Chunk.Chunk.Type>;

/** Another send id of the same length: its last digit moved on by one. */
const otherId = (id: string): string =>
  `${Str.slice(0, -1)(id)}${(Number(Option.getOrUndefined(Str.at(id, -1))) + 1) % 10}`;

describe("T1041: a large output is cut into chunk letters", () => {
  it("L1: every chunk fits the size, carries the send's id and type, runs seq 0 to n-1 with last on the final one, and the items come back in order; an item too big alone fails and nothing is cut", () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(Send, Size, (send, size) => {
        const answer = Chunk.cut(send, size);
        // Too big even with the least a part can add: seq 0 and the shorter `last` word.
        const tooBig = Option.getOrElse(
          Arr.findFirstIndex(send.items, (item) => alone(send, item, 0, true) > size),
          () => -1,
        );

        if (Result.isFailure(answer)) {
          reached.add("too_big");
          const { index } = answer.failure;
          expect(answer.failure, "a refusal is TooBig").toBeInstanceOf(Chunk.TooBig);
          const item = send.items[index];
          expect(item, `TooBig names an item of the send: index ${index}`).toBeDefined();
          // The item's own seq is at most its index, so at that seq it takes no more than this.
          expect(
            alone(send, item ?? null, index, false),
            "the named item cannot fit alone in one chunk",
          ).toBeGreaterThan(size);
          expect(answer.failure.bytes, "TooBig's bytes hold at least the item's own").toBeGreaterThanOrEqual(
            bytes(item),
          );

          for (const before of send.items.slice(0, index)) {
            expect(alone(send, before, 0, true), "an item before the named one fits alone").toBeLessThanOrEqual(size);
          }

          return;
        }

        expect(tooBig, `an item that cannot fit alone at seq 0 (index ${tooBig}) fails the cut`).toBe(-1);
        const chunks = answer.success;
        reached.add(send.items.length === 0 ? "empty" : chunks.length === 1 ? "one" : "many");
        expect(chunks.length, "a cut is never empty").toBeGreaterThan(0);

        for (const [n, chunk] of chunks.entries()) {
          expect(bytes(chunk), `chunk ${n}'s encoded JSON is at most ${size} bytes`).toBeLessThanOrEqual(size);
          expect(chunk.type, "each chunk is the reader's input type").toBe(send.type);
          expect(chunk.part.id, "each chunk carries the send's id").toBe(send.id);
          expect(chunk.part.seq, "seqs run 0 to n-1").toBe(n);
          expect(chunk.part.last, "last is on the final chunk only").toBe(n === chunks.length - 1);

          if (send.items.length > 0) {
            expect(chunk.items.length, "a chunk of a non-empty send holds an item").toBeGreaterThan(0);
          }
        }

        expect(
          Arr.flatMap(chunks, (chunk) => chunk.items),
          "the chunks' items, in order, are the send's items",
        ).toEqual(send.items);

        if (send.items.length === 0) {
          expect(chunks, "an empty list is one chunk with no items").toEqual([
            { type: send.type, items: [], part: { id: send.id, seq: 0, last: true } },
          ]);
        }
      }),
      // Shrinking items of several KiB takes minutes, so the first failing case is reported as found.
      { seed: SEED, numRuns: 200, endOnFailure: true },
    );
    // An empty walk cannot pass: each kind of cut was reached.
    expect([...reached].sort()).toEqual(["empty", "many", "one", "too_big"]);
  });

  it("L2: join gives back the items of one whole cut, and none for a strict prefix, a gap, a repeat, a reorder or two sends mixed", () => {
    const reached = new Set<string>();
    const Tamper = fc.constantFrom("whole", "prefix", "gap", "repeat", "swap", "mix");
    // Every item fits alone, so each cut is whole and the tampers are what varies.
    const Whole = sendWith(Fits);
    fc.assert(
      fc.property(fc.tuple(Whole, Size), Tamper, fc.nat(), fc.nat(), ([send, size], tamper, a, b) => {
        const cut = Chunk.cut(send, size);
        expect(Result.isSuccess(cut), "items that fit alone always cut").toBe(true);

        if (Result.isFailure(cut)) {
          return;
        }

        const chunks: Cut = cut.success;
        const n = chunks.length;
        const at = (k: number) => k % n;
        let list: ReadonlyArray<(typeof chunks)[number]>;

        switch (tamper) {
          case "whole":
            list = chunks;
            break;
          case "prefix":
            list = chunks.slice(0, at(a));
            break;
          case "gap": {
            if (n < 2) {
              return;
            }

            // A gap leaves the last chunk in place: dropping the last is a prefix.
            const drop = a % (n - 1);
            list = Arr.filter(chunks, (_, k) => k !== drop);
            break;
          }

          case "repeat": {
            const k = at(a);
            // SAFETY: `at` takes k modulo n, the length of chunks, so chunks[k] is there.
            list = [...chunks.slice(0, k + 1), chunks[k] as (typeof chunks)[number], ...chunks.slice(k + 1)];
            break;
          }

          case "swap": {
            if (n < 2) {
              return;
            }

            const i = at(a);
            const j = (i + 1 + (b % (n - 1))) % n;
            const swapped = [...chunks];
            // SAFETY: i and j are both taken modulo n, the length of chunks.
            swapped[i] = chunks[j] as (typeof chunks)[number];
            // SAFETY: i and j are both taken modulo n, the length of chunks.
            swapped[j] = chunks[i] as (typeof chunks)[number];
            list = swapped;
            break;
          }

          case "mix": {
            // A second send of the same items under another id of the same length cuts the same
            // chunks. Its chunk k takes this send's chunk k: same seq, same last, same items, so
            // only the id tells the two sends apart. A one-chunk send swapped whole is the twin's own
            // whole send, not a mix, so a mix needs two chunks or more.
            const twin = Chunk.cut({ ...send, id: otherId(send.id) }, size);

            if (Result.isFailure(twin) || n < 2) {
              return;
            }

            const k = at(a);
            const stranger = twin.success[k];
            const own = chunks[k];
            expect(
              stranger !== undefined &&
                own !== undefined &&
                stranger.part.id !== own.part.id &&
                stranger.part.seq === own.part.seq &&
                stranger.part.last === own.part.last,
              "the twin's chunk differs from this send's in its id alone",
            ).toBe(true);
            list = Arr.map(chunks, (chunk, j) => (j === k ? (stranger ?? chunk) : chunk));
            break;
          }
        }

        // A tamper counts as reached only on a send of three chunks or more, where it lands inside.
        reached.add(n >= 3 ? tamper : `${tamper}_short`);
        const joined = Chunk.join(list);

        if (tamper === "whole") {
          expect(Option.getOrUndefined(joined), "a whole cut joins to its items").toEqual(send.items);
        } else {
          expect(Option.isNone(joined), `a ${tamper} of a ${n}-chunk send joins to none`).toBe(true);
        }
      }),
      { seed: SEED, numRuns: 200, endOnFailure: true },
    );
    expect([...reached]).toEqual(expect.arrayContaining(["gap", "mix", "prefix", "repeat", "swap", "whole"]));
  });
});
