// Pipe slice 1 (docs/plan/quests/pipe-PLAN.md), next/: laws T1 and T2, the shapes, written before the
// build. A program names only the pipe's two ends; the runner binds who asks (T1). A program sees
// only the shape it declares, never the wrapping: no chunk, no part, no items (0553, T2). The lead
// and CI run the compiler; Vitest does not typecheck, so each body holds type assertions only (0527).
//
// The contract these laws pin, from the plan's "The pipe Cmd and its answers" and "What a program
// declares":
//   runtime/Pipe.ts: `PipeInput`, `{from: {name, program, output}, to: {name, program, input}}`;
//     `pipe`, `Cmd.make("pipe", ...)`, whose answers are `pipe_ok` and `pipe_err`.
//   runtime/Piped.ts: `input(type, shape)`, the Msg case `{type, value}`; `ports(type, shape,
//     description)`, the reader's two input ports, keyed `type` and `DOWN`.
//   runtime/Program.ts: `Output.make(schema, select)`, whose selector returns the schema's type or null.
// Plants, each run once after the build: add `requester` to `PipeInput`, or return a number from a
// list output's selector (T1); add a `part` field to `Piped.input`, or make `Output.make` take a list
// of `S` (T2): tsc red.
import { expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import type { From } from "../processes/Mailbox.ts";
import type { ProcessCalls } from "../processes/ProcessManager.ts";
import type * as Pipe from "./Pipe.ts";
import type * as Piped from "./Piped.ts";
import type { Output } from "./Program.ts";

const TicketNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const Row = Schema.Struct({ id: Schema.String, title: Schema.String });
const Rows = Schema.Array(Row);

it("type: T1 pipe takes only its two ends, an output's selector returns its schema's type or null, and ProcessCalls.monitor takes no trusted watcher", () => {
  // The operands a program writes: the two ends, and nothing past these keys.
  expectTypeOf<keyof typeof Pipe.PipeInput.Type>().toEqualTypeOf<"from" | "to">();
  expectTypeOf<keyof (typeof Pipe.PipeInput.Type)["from"]>().toEqualTypeOf<"name" | "program" | "output">();
  expectTypeOf<keyof (typeof Pipe.PipeInput.Type)["to"]>().toEqualTypeOf<"name" | "program" | "input">();
  expectTypeOf<Parameters<typeof Pipe.pipe>[0]>().toEqualTypeOf<typeof Pipe.PipeInput.Type>();
  // Its name, so its answers arrive as pipe_ok and pipe_err.
  expectTypeOf<typeof Pipe.pipe.cmdType>().toEqualTypeOf<"pipe">();
  expectTypeOf<typeof Pipe.pipe.okType>().toEqualTypeOf<"pipe_ok">();
  expectTypeOf<typeof Pipe.pipe.errType>().toEqualTypeOf<"pipe_err">();
  // A list output's selector returns the list or null, never one row.
  type ListSelect = Parameters<typeof Output.make<typeof Rows>>[1];
  expectTypeOf<ReturnType<ListSelect>>().toEqualTypeOf<(typeof Rows)["Type"] | null>();
  // Across an RPC, a watch keeps the three-argument form: the brain-written watch adds no `as`.
  expectTypeOf<Parameters<ProcessCalls["monitor"]>>().toEqualTypeOf<[ref: string, process: string, from: From]>();
});

it("type: T2 a program sees only its declared shape: Piped.input is {type, value}, Piped.ports is keyed by its type and DOWN, and Output.make's selector is of the schema's own type", () => {
  // The Msg a reader's update is handed: the value in the shape it declared, and no part or items.
  type Handed = ReturnType<typeof Piped.input<"ticket", typeof TicketNumber>>["Type"];
  expectTypeOf<Handed>().toEqualTypeOf<{ readonly type: "ticket"; readonly value: number }>();
  type HandedRows = ReturnType<typeof Piped.input<"rows", typeof Rows>>["Type"];
  expectTypeOf<HandedRows>().toEqualTypeOf<{ readonly type: "rows"; readonly value: (typeof Rows)["Type"] }>();
  // The ports one pipe needs: its value input and its DOWN input, and nothing else.
  expectTypeOf<keyof ReturnType<typeof Piped.ports<"ticket", typeof TicketNumber>>>().toEqualTypeOf<
    "ticket" | "DOWN"
  >();
  // A single value's selector returns the value or null, never a list of it.
  type OneSelect = Parameters<typeof Output.make<typeof TicketNumber>>[1];
  expectTypeOf<ReturnType<OneSelect>>().toEqualTypeOf<number | null>();
  expectTypeOf<Parameters<typeof Output.make<typeof TicketNumber>>[0]>().toEqualTypeOf<typeof TicketNumber>();
});
