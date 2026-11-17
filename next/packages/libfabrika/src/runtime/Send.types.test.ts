// Ticket 1041, next/: L5 of the pipe plumbing plan (docs/plan/quests/t1041-PLAN.md), written before
// the build. A program learns a full inbox from `send`'s own answer, and a chunked send's reader
// types its items. tsc checks this file (the lead's typecheck); vitest only loads it.
//
// The contract this law pins:
//   runtime/Send.ts: `send`'s `err` tags hold `full` beside `MailRefusal`'s; `sendChunks` is
//     `Cmd.make("send_chunks", ...)` whose tags hold `too_big` and no `full`, since it waits.
//   runtime/Chunk.ts: `input(type, item)` is the reader's typed input for one chunked port.
import { describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as Chunk from "./Chunk.ts";
import type { send, sendChunks } from "./Send.ts";

const Row = Schema.Struct({ path: Schema.String, line: Schema.Int });

const rows = Chunk.input("rows", Row);

type SendTag = Parameters<typeof send.err>[1]["_tag"];

type ChunksTag = Parameters<typeof sendChunks.err>[1]["_tag"];

describe("T1041: what a program sees of a full inbox and a chunked send", () => {
  it("type: L5 send_err carries full, send_chunks_err carries too_big and never full, and a chunked port's items are the reader's item type", () => {
    expectTypeOf<"full">().toExtend<SendTag>();
    expectTypeOf<"forbidden" | "no_name" | "stale_sender" | "bad_message" | "id_reused">().toExtend<SendTag>();
    expectTypeOf<"too_big">().toExtend<ChunksTag>();
    expectTypeOf<"forbidden" | "no_name" | "stale_sender" | "bad_message" | "id_reused">().toExtend<ChunksTag>();
    expectTypeOf<Extract<ChunksTag, "full">>().toBeNever();
    expectTypeOf<(typeof rows.Type)["type"]>().toEqualTypeOf<"rows">();
    expectTypeOf<(typeof rows.Type)["items"]>().toEqualTypeOf<ReadonlyArray<typeof Row.Type>>();
    expectTypeOf<(typeof rows.Type)["part"]>().toEqualTypeOf<typeof Chunk.Part.Type>();
  });
});
