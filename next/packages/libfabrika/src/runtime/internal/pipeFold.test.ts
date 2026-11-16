// Pipe slice 1 (docs/plan/quests/pipe-PLAN.md), next/: law R1, a cut send hands nothing, written before
// the build, on the reader's fold machine's real `init` and reducer (0046, 0093).
//
// The contract this law pins, from the plan's "The wrapping, which only the two runners see":
//   runtime/internal/pipeFold.ts: `machine`, one tea machine the reader's runner steps per piped
//     input. Its model is `empty`, `arriving {id, seq, items}` or `whole {items}`. Its Msgs, each with
//     tea's `type`: `chunk {items, part: {id, seq, last}}`, `down` (the writer's life ended) and
//     `handed` (the runner gave the whole value to the program). `init(null)` is `empty`.
// The walk is fast-check's command model folded by hand: each cell reads the writer's own send in
// progress and picks a move possible there, and the oracle is the walk's own record of which chunks
// it sent in order since a seq 0. It never reads how the fold decides.
//
// Plants, each run once after the build: (a) fold a chunk whose seq skips one; (b) keep what was
// arriving on `down`; (c) reach `whole` from a send with no seq 0: R1 red.
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import * as fc from "fast-check";
import * as PipeFold from "./pipeFold.ts";

const SEED = 119120;

type Model = ReturnType<typeof PipeFold.machine.init>[0];
type Part = { readonly id: string; readonly seq: number; readonly last: boolean };
/** The fold's Msgs, as its own schema declares them: `chunk`, `down` and `handed`. */
type Msg = typeof PipeFold.machine.msg.Type;

const step = (model: Model, msg: Msg): Model => applyCell(PipeFold.machine, model, msg)[0];

/** One send the writer cuts: its id and its chunks' items, in order. */
type Send = { readonly id: string; readonly chunks: ReadonlyArray<ReadonlyArray<number>> };

type Move = "next" | "new" | "skip" | "repeat" | "stray" | "headless" | "down";
const MOVES: ReadonlyArray<Move> = ["next", "next", "next", "new", "skip", "repeat", "stray", "headless", "down"];

const Cell = fc.record({
  move: fc.nat(),
  // A new send's chunk count and its items.
  size: fc.integer({ min: 1, max: 5 }),
  item: fc.integer({ min: 0, max: 999 }),
});

describe("Pipe slice 1: the reader's runner folds chunk messages, next/", () => {
  it("R1: the fold is whole only right after the last chunk of a send whose every chunk came in order from seq 0, and then holds exactly its items; anything cut hands nothing", () => {
    // Plants: (a) fold a chunk whose seq skips one; (b) keep what was arriving on down; (c) reach
    // whole from a send with no seq 0: R1 red.
    const reached = new Set<string>();
    fc.assert(
      fc.property(fc.array(Cell, { minLength: 1, maxLength: 60 }), (cells) => {
        let model: Model = PipeFold.machine.init(null, undefined)[0];
        let sends = 0;
        /** The writer's send in progress: what it cut, and the next chunk it sends. */
        let current: { send: Send; at: number } | null = null;
        /** The oracle: the send whose chunks have all come in order since its seq 0, and what came. */
        let track: { id: string; next: number; items: Array<number> } | null = null;
        let last: { part: Part; items: ReadonlyArray<number> } | null = null;

        const begin = (size: number, item: number): Send => ({
          id: `process_T/${++sends}/out/rows`,
          chunks: Array.from({ length: size }, (_, n) => [item + n, item + n + 1]),
        });
        /** Steps one chunk, checks the fold against the oracle, and hands a whole value on. */
        const chunk = (part: Part, items: ReadonlyArray<number>, label: string) => {
          if (part.seq === 0) {
            track = { id: part.id, next: 1, items: [...items] };
          } else if (track !== null && track.id === part.id && track.next === part.seq) {
            track.next++;
            track.items.push(...items);
          } else {
            track = null;
          }

          last = { part, items };
          model = step(model, { type: "chunk", items, part });
          const whole = part.last && track !== null;
          expect(model._tag === "whole", `R1: ${label} ${JSON.stringify(part)} is ${whole ? "" : "not "}whole`).toBe(
            whole,
          );

          if (whole && model._tag === "whole") {
            expect(model.items, "R1: a whole value holds exactly its send's items").toEqual(track?.items);
            reached.add(current?.send.chunks.length === 1 ? "whole:one" : "whole:many");
            // The runner hands the value in the same turn, and the fold holds nothing after.
            model = step(model, { type: "handed" });
            expect(model._tag, "R1: handed leaves nothing held").not.toBe("whole");
            track = null;
            current = null;
          } else if (part.last) {
            reached.add(`cut:${label}`);
          }
        };

        for (const cell of cells) {
          const move = MOVES[cell.move % MOVES.length] ?? "next";

          switch (move) {
            case "next":
            case "new": {
              if (current === null || move === "new") {
                if (current !== null) {
                  reached.add("abandoned");
                }

                current = { send: begin(cell.size, cell.item), at: 0 };
              }

              const send: Send = current.send;
              const at: number = current.at;
              chunk({ id: send.id, seq: at, last: at === send.chunks.length - 1 }, send.chunks[at] ?? [], "in order");
              current = current === null ? null : { send, at: at + 1 };

              if (current !== null && current.at >= send.chunks.length) {
                current = null;
              }

              break;
            }
            case "skip": {
              // The writer's next chunk never arrives; the one after it does.
              if (current === null || current.at + 1 >= current.send.chunks.length) {
                break;
              }

              const at: number = current.at + 1;
              const send: Send = current.send;
              chunk({ id: send.id, seq: at, last: at === send.chunks.length - 1 }, send.chunks[at] ?? [], "skipped");
              current = at + 1 < send.chunks.length ? { send, at: at + 1 } : null;
              reached.add("skip");
              break;
            }
            case "repeat": {
              if (last === null) {
                break;
              }

              const { part, items } = last;
              chunk(part, items, "repeated");
              reached.add("repeat");
              break;
            }
            case "stray": {
              chunk(
                { id: `stray/${cell.item}`, seq: 1 + (cell.item % 3), last: cell.item % 2 === 0 },
                [cell.item],
                "stray",
              );
              reached.add("stray");
              break;
            }
            case "headless": {
              // A send whose seq 0 never came: its later chunks, its last one included.
              const send = begin(Math.max(2, cell.size), cell.item);

              for (let at = 1; at < send.chunks.length; at++) {
                chunk({ id: send.id, seq: at, last: at === send.chunks.length - 1 }, send.chunks[at] ?? [], "headless");
              }

              reached.add("headless");
              break;
            }
            case "down": {
              if (track !== null) {
                reached.add("down:mid");
              }

              model = step(model, { type: "down" });
              expect(model._tag, "R1: a down holds no whole value").not.toBe("whole");
              track = null;

              // What was arriving is gone: the rest of that send hands nothing.
              if (current !== null) {
                const send: Send = current.send;
                const at: number = current.at;

                for (let k = at; k < send.chunks.length; k++) {
                  chunk(
                    { id: send.id, seq: k, last: k === send.chunks.length - 1 },
                    send.chunks[k] ?? [],
                    "after down",
                  );
                }

                current = null;
              }

              break;
            }
          }
        }
      }),
      { seed: SEED, numRuns: runsFor({ fast: 150, full: 500 }) },
    );

    for (const required of [
      "whole:one",
      "whole:many",
      "abandoned",
      "skip",
      "repeat",
      "stray",
      "headless",
      "down:mid",
      "cut:after down",
      "cut:headless",
      "cut:skipped",
    ]) {
      expect(reached, `R1 reached ${required}`).toContain(required);
    }
  });
});
