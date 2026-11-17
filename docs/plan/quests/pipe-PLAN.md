Approved by the lead agent, builds 0549, 0550, 0551, 0553, 0109, 0579, 0582, 0586, 0594; body c768265cd4b8
Plancheck-Version: 3

# Plan: a program can pipe one program's output to another program's input, and the reader gets the writer's whole current value, newest wins, in next/

This is `next/`. It is the first pipe slice of Tier 1's step 4, and the first of three: the pipe in
the library, with no shell. It builds the proposed note
[how a pipe carries output](https://github.com/kamp-us/tea-fabrika/pull/1322) and decisions 0549,
0550, 0551 and 0553. A program asks for a pipe with a new built-in Cmd, `pipe`. The brain checks the
member behind it, checks that the pipe fits on the two programs' declared shapes, and records it
with both shapes. Each program declares the shape it means: a ticket number is a ticket number, on
both ends. The writer's runner wraps the output value as items, a list as its items and anything
else as a list of one item, and sends them in chunk messages each time the value changes, newest
wins. The reader's runner folds the chunk messages, unwraps them by the writer's declared shape, and
hands the reader's program one message with the value in the shape the reader declares. No program
sees a chunk (0553). The reader watches each life of the writer with the watch slice's monitor. One
pull request, about 1,345 product lines.

```ts
// The whole idea, a sketch. A parent program (here a test program) pipes two programs it then starts.
// tracker and ticket in next/ are made up (see the list at the end).
pipe({ from: { name: "tracker:1", program: "fabrika/tracker", output: "ticket" },
       to: { name: "ticket:1", program: "fabrika/ticket", input: "ticket" } });
// pipe_ok { _tag: "piped", pipe: "process_P/41/0" }   or { _tag: "unfit", fit: { _tag: "does_not_fit", ... } }
startChild({ program: "fabrika/ticket", name: "ticket:1" });    // the reader first
startChild({ program: "fabrika/tracker", name: "tracker:1" });  // then the writer

// What the two programs declare: the real shape, the same words on both ends.
outputs: { ticket: Output.make(TicketNumber, (m: Model) => m.picked) },      // tracker: a number, null until a pick
inputs: { ...Piped.ports("ticket", TicketNumber, "The ticket to show.") },   // ticket: a number

// tracker's runner, never tracker's code: `ticket` changed to 1041, so it owes one send of the items [1041].
// In ticket:1's inbox, read only by ticket's runner: { type: "ticket", items: [1041], part: { id, seq: 0, last: true } }
// What ticket's own `update` is handed: { type: "ticket", value: 1041 }     a number, never [1041], never a part
// When that life of tracker ends: { type: "DOWN", ref: "process_P/41/0/process_T", name: "tracker:1", reason }
```

## What changes, in one paragraph

A program declares an output as a selector of its model (0260, `Output.make`), and a reader declares
a piped input and a `DOWN` input with one helper, `Piped.ports`. Both name the shape the program
means, list or not, and neither names a chunk (0553). The loader puts each output's and each piped
input's shape into the program's declaration, as Effect's own `SchemaRepresentation` JSON, so the
brain can read them without running the code. A new built-in Cmd, `pipe`, goes from the runner to a
new brain-side service, `Pipes`, which checks the member behind the Cmd (0551), checks that the pipe
fits on the two declared shapes (0550), and in one ledger turn writes the `piped` row with both
shapes, the right to send messages as a relation row (0526) and the Cmd's answer. In the turn that
starts or restarts either end of a live pipe, the brain writes the watch for the reader's live life on the
writer's live life, so a watch binds one life and the pipe follows the registered name. The writer's
runner owes one `send_chunks` of the whole value, wrapped as items, each time an output with a live
pipe changes; a newer value replaces one not yet started (0549). The reader's runner folds the chunk
messages in its own checkpoint, and at the last one unwraps the items by the writer's declared shape
and steps the reader's program once with the value. `exit` waits behind an owed send to a piped
name. When the program that made a pipe stops either end with `stop_child`, the same turn writes
`unpiped` and removes the right to send messages.

## Starts from

Main, after the watch slice merges ([pull request 1341](https://github.com/kamp-us/tea-fabrika/pull/1341),
branch `fabrikalfa/program-watch`, plan `docs/plan/quests/watch-PLAN.md` there). This plan uses that
slice's `monitor` and `demonitor` as that pull request has them: its trusted `as` argument to
`ProcessManager.monitor`, its `Down` with `name` (`processes/Process.ts` there), its `monitored` row
with `name` and `member`, a `DOWN` input declared as that slice's reader test program declares one
(`runtime/MonitorTest.ts` there), and the member pick it moved to `processes/internal/member.ts`.
The tests step for this plan starts once that pull request has merged. Nothing here waits on fabsh
or tezgah.

## Current names

Decision [0582](../../../.decisions/0582-mail-as-a-noun-goes-it-is-a-mailbox-and-messages.md)
names the settings `mailbox.chunk` and `mailbox.capacity`. This plan uses those names for the
implementation, with the same values, bounds and refusal rules. The dated source readings below
keep the keys they read then, `mail.chunk` and `mail.unread`. Source paths and type names such as
`ProgramMailLedger` stay as read; this plan does not rename those existing types.

## Searched first

Searched on 2026-11-15 in `.decisions/`, `docs/direction/`, `.glossary/TERMS.md`, `experiments/`,
`docs/plan/`, the open pull requests and the branches named above, for "pipe", "fit", "chunk",
"monitor", "output", "DOWN", "wrap", "too_big" and "letter" (the old word).

- **The note,** proposed, on `fabrikalfa/pipe-carry`, and its six plumbing calls (the lead's, the
  owner handed them over): chunks fold into a pending value swapped in at the last chunk; a writer
  that crashes mid-send leaves the reader on its previous whole value; one `DOWN` per writer life
  after its last data; a watch binds one life and the pipe points at a registered name; a reader
  that ends makes the shell stop only the writers its line started (not in this slice); built-in
  Cmds first. The note's sketch of a reader with a chunk input and a pending value in its own model
  is from before 0553: the fold stays, and moves into the reader's runner.
- **Decisions this builds:** 0549 (whole value, newest wins), 0550 (a pipe fits on needed fields, refused
  before any start), 0551 (the brain checks the member and records the pipe), 0553 (every value
  travels one way underneath, as items in chunk messages, and a program never sees the wrapping; it
  landed on main on 2026-11-15 as [pull request 1350](https://github.com/kamp-us/tea-fabrika/pull/1350)),
  0109 (a pipe is saved program mail, in chunks, with a cap, and a program can be piped with no
  shell present), 0260 (an output is a model value, `null` is nothing to send), 0170 and 0531 (a
  check is against the member behind the cause, carried down), 0526 (one ReBAC model, relation
  rows), 0214 (`_tag`), 0209 (Effect Schema), 0547 (message, never letter), 0546 (quest), 0536 and
  0178 (where real-resource laws run), 0046 and 0037 (a state machine is an explicit tea machine).
  0548 (Ctrl-C stops the whole line) is for the third slice.
- **Built on main:** `send_chunks`, `Chunk.cut`, `Chunk.join`, `Chunk.input`, `Part`, the inbox cap
  `mail.unread` and chunk size `mail.chunk`, `full`, the ack after each checkpoint save, and `behind`,
  which keeps mail to one name in Cmd order (`runtime/Send.ts`, `runtime/Chunk.ts`,
  `runtime/Runner.ts`, `processes/ProgramMailLedger.ts`, from
  [pull request 1310](https://github.com/kamp-us/tea-fabrika/pull/1310)). `start_child` and
  `stop_child` (`runtime/StartChild.ts`), `ChildrenLedger`, `ProcessManager`, the loader's
  `Declaration` (`runtime/Execution.ts`), the runner's `Checkpoint` (`runtime/ProcessStore.ts`), and
  `outputs` as bare schemas that nothing reads (`runtime/Program.ts`).
- **The limits on main that a piped value meets,** read in the code for this revision:
  - `Chunk.cut` fails with `TooBig` when one item's message alone is over the chunk size, and the
    runner answers that `send_chunks` `too_big` with nothing sent (`runtime/Runner.ts`, the `chunks`
    performer). Ticket 1041's laws L1 and L12 hold both
    (`next/packages/libfabrika/src/runtime/Chunk.test.ts`, `runtime/ProgramMailTest.ts`).
  - `mail.chunk` is 64 KiB by default and 1 KiB to 1 MiB (`settings/Declarations.ts`).
  - A `send_chunks` whose operands are over `INPUT_BYTES`, which is `ROW_BYTES`, 2,000,000 bytes
    (`processes/Children.ts`, `ledger/Log.ts`), is answered `too_big` at dispatch (`oversized` in
    `runtime/Runner.ts`). So a whole chunked send is at most that size today, list or not.
  - Delivery checks no message against the reader's schema (`processes/ProgramMailLedger.ts`), and
    a program stepped with a message it has no case for goes down (`runtime/Program.ts`, `ProgramDown`
    with reason `step`).
- **Effect's own schema form:** `SchemaRepresentation` in the installed effect 4.1.2
  (`node_modules/effect/dist/SchemaRepresentation.d.ts`, read in full for this plan):
  `toRepresentation(ast)` lowers a schema's encoded side to a `Document`, `toJson` and `fromJson`
  persist it, and each node carries its `checks` with a persistence id such as
  `effect/schema/isInt`. Tried on 2026-11-15: `Schema.Array(Row)` gives
  `{_tag: "Arrays", rest: [{_tag: "Objects", propertySignatures: [...]}]}`, `Schema.Literals` a
  `Union` of `Literal`s, `Schema.optionalKey` sets `isOptional`, and `Schema.Date` a `Declaration`.

## How others do it

- **Elm:** ports. A whole typed value leaves through an outgoing port and enters the other program's
  `update` as a Msg ([Elm guide, ports](https://guide.elm-lang.org/interop/ports.html), cited in the
  note). The program names the value's type and never how it crossed. That is what a reader's
  `update` gets here.
- **Erlang/OTP:** messages between one pair keep their order, and a monitor gives one
  `{'DOWN', Ref, process, Pid, Reason}` after the last message that process sent
  ([Erlang processes reference](https://www.erlang.org/doc/system/ref_man_processes.html), cited in
  the note and the OTP table). A monitor binds a pid and never follows a name.
- **Unix pipes:** a full pipe makes its writer wait; a writer that closes flushes first
  ([pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html), cited in the note). A program
  reads and writes its bytes and never sees how the kernel cut them into buffers.
- **gRPC over HTTP/2:** one transport for one value and for many. A call with one request message
  and a call with a stream of them both travel as length-prefixed messages in the same frames, and
  the generated code hands the program its declared type
  ([gRPC over HTTP/2](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md); not fetched
  for this revision, written from what the page is known to say). That is 0553's shape.
- **PowerShell's pipeline, as the trap to avoid:** it unrolls a collection into its items, and a
  function that returns a list of one hands the next command the item, so a reader cannot tell a
  list of one from a single value ([about_Pipelines](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_pipelines);
  not fetched for this revision). Here the unwrap follows the writer's declared shape, never the
  number of items, and law X1 plants that shortcut.
- **Nushell and PowerShell:** typed values between commands, and a declared input type the shell
  checks ([Nushell pipelines](https://www.nushell.sh/book/pipelines.html), cited in the note).
- **Structural subtyping:** a value with extra fields is a value of the narrower record type, as
  TypeScript's assignability and Effect Schema's `Struct` (which drops extra keys on decode) both
  say. The check that a pipe fits is that rule, run on the two shapes.

The plain reading: OTP gives the order and the end, Unix the back pressure and the flush, Elm the
typed value a program is handed, gRPC the one transport under one value and many, and structural
subtyping when a pipe fits. Effect gives the schema form the brain reads.

## Existing tools

For this documentation repair, searched the repo's runtime and processes modules, today's
`packages/fabrika/src/program/shape.ts`, the installed Effect `SchemaRepresentation` declaration,
and npm for "effect schema assignability". The npm results named no checker for the declared
Effect shapes this plan compares. The plan keeps its existing design and reuses the following
code. The transport and chunk cutter stay the same.

- `next/packages/libfabrika/src/processes/Fit.ts`: searched today's `shape.fit` and Effect's
  `SchemaRepresentation`; the former requires exact JSON Schema equality, while the latter
  persists shapes but provides no assignability check. `fits` implements 0550 on that persisted form.
- `next/packages/libfabrika/src/processes/Pipes.ts`: searched `Children.ts` and `ProcessManager.ts`;
  neither offers the pipe contract. This service declares `pipe` and `list`, not another transport.
- `next/packages/libfabrika/src/processes/PipesLedger.ts`: searched `ChildrenLedger.ts` and
  `ProcessManager.ts`; reuse their ledger-turn and member-check patterns for the pipe facts and
  rights 0551 requires. Neither existing service records a pipe.
- `next/packages/libfabrika/src/processes/internal/pipeTable.ts`: searched `internal/processTable.ts`;
  reuse its tea-machine fold pattern, with the pipe stream's own events instead of process events.
- `next/packages/libfabrika/src/runtime/Pipe.ts`: searched `StartChild.ts` and `Send.ts`; reuse
  tea's `Cmd.make` and the existing host-command handling. Neither Cmd creates a pipe.
- `next/packages/libfabrika/src/runtime/Piped.ts`: searched `Chunk.input` and the program's input
  declarations; `Chunk.input` exposes items and parts, so `input` and `ports` declare only the
  value Msg 0553 requires. Chunk delivery stays in the runner.
- `next/packages/libfabrika/src/runtime/internal/pipeItems.ts`: searched `Chunk.cut`, `Chunk.join`
  and Effect's schema representations; reuse the existing cutter and joiner. `listed`, `wrap`
  and `unwrap` only map a declared shape to those existing items and back.
- `next/packages/libfabrika/src/runtime/internal/pipeFold.ts`: searched `Chunk.join` and the
  process table's tea machine; `join` checks a collected sequence but holds no incremental state.
  This tea machine holds the reader runner's pending items and drops a cut send.

## The shape

### The pipe Cmd and its answers

```ts
// next/packages/libfabrika/src/runtime/Pipe.ts (new). The runner performs it itself.
import { Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Unfit } from "../processes/Fit.ts";

/** One end of a pipe: the registered name the asking program will start it under, its program, and
 *  the port. Nothing needs to run yet when the brain checks it. */
const Writer = Schema.Struct({ name: Schema.String, program: Schema.String, output: Schema.NonEmptyString });
const Reader = Schema.Struct({ name: Schema.String, program: Schema.String, input: Schema.NonEmptyString });

/** pipe's operands: its two ends. The runner binds who asks. */
export const PipeInput = Schema.Struct({ from: Writer, to: Reader });

/** The answer. `piped` made it; `unfit` made nothing, and says the first field that failed. */
export const Piped = Schema.TaggedUnion({
  piped: { pipe: Schema.NonEmptyString },   // the pipe's id: this Cmd's own id, stable on a retry
  unfit: { fit: Unfit },                     // does_not_fit or cannot_tell, with its path (0550)
});

/** Why a pipe is refused. Each is final, and a refusal writes nothing but its answer message. */
export const PipeRefusal = Schema.Literals([
  "bad_name",     // a name is not a process name, or both ends are one name
  "no_program",   // a program is not in the loaded builds
  "stale_sender", // the asking life ended, or the cause went to a life that ended
  "forbidden",    // the member behind the Cmd may not pipe these two programs, or there is no member
  "no_output",    // the writer declares no such output
  "no_input",     // the reader declares no such piped input, or no DOWN input
  "name_taken",   // a name already has a live process: a pipe is made before its ends start (0550)
  "taken",        // that input already has a live pipe: a pipe never fans in (G6)
]);

export const pipe = Cmd.make("pipe", { input: Asked, ok: Piped, err: PipeRefusal.literals });
```

`Asked` is the loose declaration `StartChild.ts` uses, so a malformed Cmd is answered `bad_cmd` by
the host and never fails the step that asked.

### The check that a pipe fits

```ts
// next/packages/libfabrika/src/processes/Fit.ts (new). Pure: no service, no clock. The brain runs
// it on a pipe; an editor can run it on two declarations, through @kampus/libfabrika.
import { Schema, SchemaRepresentation } from "effect";

/** The rule's own name, kept on every `piped` row, so a later rule never rewrites what this one judged. */
export const RULE = "fit/v1";

/** Where the check stopped: a field's name, or "[]" for a list's item. */
export const Path = Schema.Array(Schema.String);

export const Unfit = Schema.TaggedUnion({
  does_not_fit: { path: Path, need: Schema.String, has: Schema.String }, // has: a shape word, or "missing" / "optional"
  cannot_tell: { path: Path, shape: Schema.String },                       // the reader's shape v1 does not compare
});

export const Fit = Schema.Union([Schema.TaggedStruct("fits", {}), Unfit]);

/** Whether every encoded value of `writer` is an encoded value `reader` takes, by the v1 rules. */
export const fits: (writer: SchemaRepresentation.Document, reader: SchemaRepresentation.Document) => typeof Fit.Type;
```

Both shapes are the two programs' declared shapes, as each one wrote it: the writer's output and
the reader's input, list or not. The wrapping is never part of the check (0553). Both are the
encoded side, which is what a message carries. v1 compares, reading the reader's node first:

| The reader needs | It fits when the writer has | Else |
|---|---|---|
| `Unknown` or `Any` | anything | |
| `String`, `Number`, `Boolean`, `Null` | the same node | `does_not_fit` |
| a `Literal` | that literal, or a union of only that literal | `does_not_fit` |
| a union of only literals (`Schema.Literals`) | a literal of the set, or a union of only literals, each in the set | `does_not_fit` |
| a list (`Arrays` with only a `rest` node) | a list whose item fits the reader's item | `does_not_fit` |
| a struct (`Objects` with no index signature) | a struct with each field the reader requires, required, and each fitting; a field the reader makes optional may be missing; extra fields are fine (0550) | `does_not_fit`, `has: "missing"` or `"optional"` |
| a check on any node above | the same check, same persistence id and payload; the writer may carry more | `cannot_tell` |

Everything else on the reader's side is `cannot_tell`, and refused (the note's lean, which 0550's
"pipe stays typed" needs): a `Declaration` (`Schema.Date`, `Option`, a class), a `Suspend` or
`Reference` (a recursive schema), a tuple, a struct with an index signature (`Schema.Record`), any
union that is not only literals (so `Schema.NullOr(X)`), `Enum`, `TemplateLiteral`, `BigInt`,
`Symbol`, `Undefined`, `Void`, `Never`, `ObjectKeyword`, and a check with no persistence id (a
custom `Schema.makeFilter`).

```ts
// Examples, each a law vector. Shapes written as Effect Schema; the check reads their representations.
fits(Arr(Struct({ id: Str, title: Str, state: Str })), Arr(Struct({ id: Str, title: Str })));
// { _tag: "fits" }                                              extra `state` is fine
fits(Arr(Struct({ id: Str, title: Str })), Arr(Struct({ id: Str, column: Str })));
// { _tag: "does_not_fit", path: ["[]", "column"], need: "String", has: "missing" }
fits(Arr(Struct({ state: Literals(["open", "closed"]) })), Arr(Struct({ state: Literals(["open", "closed", "late"]) })));
// { _tag: "fits" }                                              a smaller literal set fits a larger one
fits(Arr(Struct({ n: Schema.Number })), Arr(Struct({ n: Schema.Int })));
// { _tag: "cannot_tell", path: ["[]", "n"], shape: "check effect/schema/isInt" }
fits(Arr(Struct({ note: NullOr(Str) })), Arr(Struct({ note: NullOr(Str) })));
// { _tag: "cannot_tell", path: ["[]", "note"], shape: "Union" }  v1 compares no general union
fits(Arr(Struct({ at: Schema.Date })), Arr(Struct({ at: Schema.Date })));
// { _tag: "cannot_tell", path: ["[]", "at"], shape: "Declaration effect/schema/Date" }
fits(TicketNumber, TicketNumber);
// { _tag: "fits" }                                              one value on both ends, no list anywhere
fits(TicketNumber, Arr(TicketNumber));
// { _tag: "does_not_fit", path: [], need: "Arrays", has: "Number" }   a number is no list
fits(Arr(Struct({ id: Str })), Schema.Unknown);
// { _tag: "fits" }                                              a reader of anything takes a list too
```

It lives in `processes/` because the brain's `Pipes` calls it in its turn, and `processes` is a
layer every caller above it may import: the runtime, the client and the entry. A future editor calls
`Fit.fits` on the two declarations it already holds. It needs no new line in `layer-rules.json`.

### What a program declares

```ts
// next/packages/libfabrika/src/runtime/Program.ts: an output is a schema and a selector (0260).
export const Output = { make: <S extends Declared>(schema: S, select: (model: never) => S["Type"] | null) => ({ schema, select }) };

// Two writers, a sketch. Each declares the shape it means.
outputs: { rows: Output.make(Schema.Array(Row), (m: Model) => (m.loaded ? m.rows : null)) },  // a list
outputs: { ticket: Output.make(TicketNumber, (m: Model) => m.picked) },                       // one number

// next/packages/libfabrika/src/runtime/Piped.ts (new): what a reader declares for one pipe.
// Nothing in this file names a chunk, a part or an item.
/** The Msg case a piped input folds: the value, in the shape the reader declares. */
export const input = <const T extends string, S extends Schema.Top>(type: T, shape: S) =>
  Schema.Struct({ type: Schema.Literal(type), value: shape });
/** The two inputs a reader declares for one pipe: the value input and the DOWN input. */
export const ports: <const T extends string, S extends Schema.Top>(type: T, shape: S, description: string) => Ports<T, S>;

// A reader, a sketch: its update is handed the value, as any Msg.
msg: Schema.Union([Piped.input("ticket", TicketNumber), Down /* its own DOWN case, as the watch slice's reader */]),
inputs: { ...Piped.ports("ticket", TicketNumber, "The ticket to show.") },
update: {
  ticket: (m, msg) => [{ ...m, ticket: msg.value }, []],   // msg.value is a number
  DOWN: (m, msg) => [{ ...m, writer: msg.reason }, []],    // that life of the writer ended
},

// next/packages/libfabrika/src/runtime/Execution.ts: what the brain knows without the code gains the shapes.
export const Declaration = Schema.Struct({
  // ...today's keys...
  inputs: Schema.Record(Schema.String, Schema.Struct({
    write: Schema.Boolean,
    personOnly: Schema.Boolean,
    shape: Schema.optionalKey(Schema.Json), // a piped input's declared shape, SchemaRepresentation.toJson
  })),
  outputs: Schema.Record(Schema.String, Schema.Struct({ shape: Schema.Json })),
});
```

- **A piped input is a plain write port.** `Piped.ports` makes it with `Input.cases.write.make` and
  sets one new optional field on the port, `value`, the schema the reader declared. The loader
  writes `shape` for a write port that has `value`, and for every output. Both come from
  `SchemaRepresentation.toJson(SchemaRepresentation.toRepresentation(ast))` of the program's own
  schema, computed once at load, with nothing added for the pipe.
- **A message that already has the shape works too.** A person or a client that sends
  `{type: "ticket", value: 1041}` to the port steps the program as any write port does. The pipe is
  one more way that Msg arrives.
- **A step's answer from the box** gains `outputs: Record<string, Schema.Json | null>`, holding only
  the outputs whose encoded value changed between the model before and after that step. The box runs
  the selector, since on workerd only the box holds the code. tsc checks each selector against its
  schema (law T1). Today's one output, the checklist's `done`, becomes `Output.make(Done, finished)`.
- **`null` is nothing to send (0260), at the top only.** A selector that returns `null` owes no
  send. So a top-level `null` is never a value a reader is handed, even when the output's schema
  allows it. A `null` inside a value is data: `{note: null}`, `[null]` and `[]` each travel and
  arrive as they are (law N1).

### The wrapping, which only the two runners see

```ts
// next/packages/libfabrika/src/runtime/internal/pipeItems.ts (new). Pure. `internal/`, so no other
// module and no program can import it, and index.ts does not export it.
import { Option, Schema } from "effect";
import type { Shape } from "../../processes/Fit.ts";

/** Whether a declared shape is a list: its top node is `Arrays` with only a `rest` node. */
export const listed: (shape: Shape) => boolean;

/** On the way out: a list goes as its items, anything else as a list of one item (0553). */
export const wrap = (writer: Shape, value: Schema.Json): ReadonlyArray<Schema.Json> =>
  listed(writer) ? (value as ReadonlyArray<Schema.Json>) : [value];

/** On the way in, by what the writer declared: a list comes back as the items, anything else as
 *  its one item. Items that cannot be a single value's (none, several, or one `null`) are no value. */
export const unwrap = (writer: Shape, items: ReadonlyArray<Schema.Json>): Option.Option<Schema.Json> =>
  listed(writer)
    ? Option.some(items)
    : items.length === 1 && items[0] !== null ? Option.some(items[0]) : Option.none();
```

Both ends read one fact, the writer's shape on the `piped` row, so they cannot disagree. A union
with a list in it, a tuple and `Schema.Unknown` are not lists by this test: such a value goes as one
item, whatever it holds at run time.

```ts
wrap(TicketNumber, 1041);            // [1041]
wrap(Rows, [a, b, c]);               // [a, b, c]
wrap(Rows, []);                      // []          one chunk message with no items
wrap(Schema.Unknown, [1, 2]);        // [[1, 2]]    not declared a list, so one item
unwrap(TicketNumber, [1041]);        // some(1041)
unwrap(Rows, [a]);                   // some([a])   a list of one stays a list
unwrap(Rows, []);                    // some([])    an empty list is a value
unwrap(TicketNumber, []);            // none        no single value has no item
```

```ts
// next/packages/libfabrika/src/runtime/internal/pipeFold.ts (new): one tea machine (0046), stepped
// only by the reader's runner, one per piped input. Its three states are the whole control state of
// a value on its way in (0037). A sketch: the cases are built with `.make`, never a hand-written tag.
export const machine = Machine.make({
  model: Schema.TaggedUnion({
    empty: {},                                                               // nothing is arriving
    arriving: { id: Schema.NonEmptyString, seq: Schema.Int, items: Schema.Array(Schema.Json) },
    whole: { items: Schema.Array(Schema.Json) },                             // one send, complete, not handed yet
  }),
  msg: Schema.Union([
    Schema.Struct({ type: Schema.Literal("chunk"), items: Schema.Array(Schema.Json), part: Part }),
    Schema.Struct({ type: Schema.Literal("down") }),    // the writer's life ended
    Schema.Struct({ type: Schema.Literal("handed") }),  // the runner gave the whole value to the program
  ]),
  cmds: [],
  init: (loaded) => [loaded ?? empty, []],
  update: {
    chunk: (m, msg) => {
      const { id, seq, last } = msg.part;
      // seq 0 starts a new value and drops any other; seq n adds only to n - 1 of the same id.
      const held = seq === 0 ? [] : m._tag === "arriving" && m.id === id && m.seq === seq - 1 ? m.items : null;
      if (held === null) return [empty, []];             // a cut or stray chunk: nothing to hand
      const items = [...held, ...msg.items];
      return [last ? whole({ items }) : arriving({ id, seq, items }), []];
    },
    down: () => [empty, []],     // a value still arriving is dropped; the program's own value is untouched
    handed: () => [empty, []],
  },
});
```

`whole` is never saved: in the turn a chunk makes it, the runner hands the value and sends `handed`.
The fold holds no value the program has seen, so a cut send or a crash cannot change what the
reader's program holds (law R1).

### What the brain records

```ts
// next/packages/libfabrika/src/processes/Pipes.ts (new, contract only, 0095).
export const PipeEvent = Schema.TaggedUnion({
  piped: {
    pipe: Text,                                   // the pipe Cmd's id
    // Both declared shapes, as the loader wrote them (0553): the writer's output and the reader's input.
    from: Schema.Struct({ name: ProcessName, program: ProgramName, output: Text, hash: Hash, shape: Schema.Json }),
    to: Schema.Struct({ name: ProcessName, program: ProgramName, input: Text, hash: Hash, shape: Schema.Json }),
    rule: Schema.Literal(RULE),                   // the rule that judged whether it fits
    requester: Schema.Struct({ name: ProcessName, process: ProcessId }),
    member: Sender,                               // the member behind the Cmd, checked (0170, 0551)
  },
  unpiped: { pipe: Text, reason: Schema.Literals(["stopped"]) },
});

export class PipesError extends Schema.TaggedError<PipesError>()("PipesError", {
  reason: Schema.Literals([...PipeRefusal.literals, "storage"]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class Pipes extends Context.Service<Pipes, {
  readonly pipe: (ask: Ask, from: From) => Effect.Effect<typeof Piped.Type, PipesError>;
  /** The pipes a name is an end of: each live one, and the last one made into each of its inputs. */
  readonly list: (name: string) => Effect.Effect<ReadonlyArray<Listed>, PipesError>;
}>()("@kampus/libfabrika/processes/Pipes") {}
// Ask = { id, from: Writer & { hash, shape: Json }, to: Reader & { hash, shape: Json }, requester }
// The runner fills `hash` and `shape` from the loader, as it fills a start's hash today; a program never does.
// Listed = { pipe, from, to, live: boolean }, with `from` and `to` as on the `piped` row.
```

`hash` is each program's code hash, and `shape` is the port's declared shape itself, the JSON the
loader wrote, so the row holds both declared shapes (0553) and the two runners wrap and unwrap by
the writer's. Neither shape holds anything of the wrapping. Each row is a ledger line, so it also keeps `by` (the brain's key), `sentAt` on the writer's clock, `arrivedAt` on
the ledger's, `parent` (the step whose message caused the Cmd, which leads to the member's own
message and its clock) and `traceId`. In the same turn, the right to send messages goes on the
relation stream, and `unpiped` removes it:

```ts
// permissions/relations, as 0526 shapes every permission fact.
{ _tag: "related", subject: "name:tracker:1", relation: "pipes_to", object: "name:outline:1" }
// permissions/Model.ts gains the `name` type, `pipes_to`, a `mail` permission, and the `pipe` right:
.type("name", { relations: { pipes_to: ["name"] }, permissions: { mail: (p) => p.union("pipes_to") } })
// on "fabrika": permissions: { start: ..., watch: ..., pipe: (p) => p.union("owner", "admin", "member") }
class PipePrograms extends Rebac.Permission<PipePrograms>()("@kampus/libfabrika/permissions/Model.PipePrograms",
  { model: Model, on: "fabrika", permission: "pipe" }) {}
```

`PipesLedger.layer({ fabrika })` decides in this order, as `ChildrenLedger` and `MonitorsLedger` do,
so a refused caller learns nothing it may not see:

1. `bad_name`: a name is not a `ProcessName`, or both ends name one name.
2. A saved `piped` under this id: answer it again, write nothing (a retry).
3. `stale_sender`: the requester's life is not live, or `Senders` says the cause went to a life that
   ended.
4. The member: the sender of `from.parent`, else the requester's recorded member (0531), through
   `processes/internal/member.ts`. `PipePrograms` on this fabrika, else `forbidden`. No member is
   `forbidden`: 0551 checks the member behind the pipe, and a pipe has no related-pair exception.
5. `no_output`, then `no_input`: the writer's declaration has no such output, or the reader's has no
   such piped input or no `DOWN` input.
6. `name_taken`: either name has a live process.
7. `taken`: the reader's name and input already have a live pipe.
8. `Fit.fits` on the two shapes. Anything but `fits` answers `unfit` with the verdict and writes
   nothing on the pipe stream.
9. In one turn: `piped` on `pipes`, the `related` row, the answer message `<cmd id>/answer` in the
   requester's inbox, and, if both names already have live lives, the reader's watch.

**The end of a pipe.** When the requester stops either end with `stop_child`, `ChildrenLedger.stop`'s
turn writes `unpiped {reason: "stopped"}`, the `unrelated` row, and `demonitored canceled` for the
pipe's live watch. A crash does not end a pipe: supervision restarts under the name, and the pipe
follows it.

### The watch, one life at a time

```ts
// next/packages/libfabrika/src/processes/ProcessManager.ts, a sketch: inside the start and restart turns.
// `pipes` folds the pipe stream in this turn (processes/internal/pipeTable.ts).
for (const p of pipes(turn).touching(name)) {
  const writer = table.live(p.from.name), reader = table.live(p.to.name);
  if (Option.isNone(writer) || Option.isNone(reader)) continue;      // the other end has no life yet
  monitorIn(turn, `${p.pipe}/${writer.value}`, writer.value, {       // a new ref per writer life
    to: Recipient.cases.process.make({ process: reader.value }), name: p.from.name, member: p.member,
  });
}
```

The ref is the pipe id and the writer's process ID, so a ref never binds a second process, and the
watch slice's `bad_ref` cannot happen. The watch is written in the very turn that writes `started` or
`restarted`, so a writer life that crashes at once still gives its own reason, never `noproc`. A
reader restart gets its watch the same way, since the watch slice ends a watch with its watcher's
life (its law M9). The watch slice's `Watcher.answer` becomes optional: a brain-written watch has no
Cmd to answer.


### The writer's runner wraps

```ts
// next/packages/libfabrika/src/runtime/Runner.ts, a sketch. Host Cmds gain PIPE.
const HOST = new Set([SEND, SEND_CHUNKS, START_CHILD, STOP_CHILD, EXIT, HANDS, MONITOR, DEMONITOR, PIPE]);

/** After a step: each changed output with a live pipe owes one whole send to that pipe's reader. */
const owe = (cmds: ReadonlyArray<Dispatched>, out: Out): ReadonlyArray<Dispatched> => [
  // Newest wins (0549): an owed send to this pipe that has not saved its seq 0 yet is dropped.
  ...cmds.filter((c) => !(c.out?.pipe === out.pipe && !started(c))),
  dispatched({ id: `${process.id}/${out.pos}/out/${out.output}`,
    cmd: { type: SEND_CHUNKS, to: out.to, as: out.input, items: PipeItems.wrap(out.shape, out.value) },
    out: { pipe: out.pipe } }),
];
```

- The runner reads the pipes its name is an end of from `Pipes.list` at load, and again after a
  `piped` or `unpiped` row names it. As a writer it uses the live ones. `out.shape` is the writer's
  shape on the `piped` row. A value of `null` owes nothing (0260).
- A send has started once its seq 0 message is saved. A started send always finishes, so the reader
  never gets two values mixed. `behind` already keeps sends to one name in order. A single value is
  one chunk message, seq 0 and last, so it is either saved whole or still replaceable.
- A life's first load sends each piped output that is not `null`, so a restarted writer's first
  whole value reaches the reader. A wake of the same life sends nothing new.
- `exit` waits behind an owed send to a name with a live pipe, as a Unix `close` flushes. `kill` and
  supervision's stops do not wait.
- `pipe` loads both programs by name, as `startChild` loads one today, answers `no_program` itself,
  and hands `Pipes.pipe` the hashes and shapes.
- **An owed send's answer is recorded, never folded.** An output is not a Cmd and has no answer
  (0260), and the writer's program has no case for one. The runner saves the answer with the
  runtime's own `cmd.answered` record in the writer life's stream, as it does today for a Cmd whose
  life ended, and drops the owed send.
- **A value with an item too big gets `too_big`.** `Chunk.cut` fails with `TooBig` when one item's
  message alone is over `mailbox.chunk`, and the runner answers the send `too_big`, the refusal word
  `send_chunks` already has (`runtime/Send.ts`). A value whose operands are over `INPUT_BYTES` gets
  the same word at dispatch. For a piped output that means: nothing is sent, the `cmd.answered`
  record says `send_chunks_err` with reason `too_big`, the reader keeps the value it had, and the
  writer's next change owes a new send. A single value is one item, so it is refused when its one
  message is over `mailbox.chunk`. See "The approved item-size call".

### The reader's runner unwraps

```ts
// next/packages/libfabrika/src/runtime/Runner.ts, a sketch: one inbox message for a piped input.
// `into` is the last pipe made into this input (Pipes.list); `arriving` is in the runner's checkpoint.
const fold = (state: Live, input: string, message: Chunk.Chunk) => {
  const next = step(PipeFold.machine, state.arriving[input], { type: "chunk", items: message.items, part: message.part });
  if (next._tag !== "whole") return save({ ...state, arriving: { ...state.arriving, [input]: next } });  // steps no program
  const value = PipeItems.unwrap(into.from.shape, next.items);
  const handed = step(PipeFold.machine, next, { type: "handed" });
  return Option.match(value, {
    onNone: () => save({ ...state, arriving: { ...state.arriving, [input]: handed } }),
    onSome: (v) => stepProgram({ type: input, value: v }, { ...state, arriving: { ...state.arriving, [input]: handed } }),
  });
};

// next/packages/libfabrika/src/runtime/ProcessStore.ts: the checkpoint gains the values still arriving.
export const Checkpoint = Schema.Struct({
  // ...today's keys...
  arriving: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),  // by input; pipeFold's model
});
```

- **Which messages.** A message is the pipe's when its `type` is a piped input of the program and
  it decodes as a chunk message (`type`, `items`, `part`). Any other message to that input is a
  plain Msg and steps the program as today.
- **One step per value.** A chunk message that is not the last is saved, folded into `arriving`,
  checkpointed and acked, and steps no program. The last one steps the program once, as that
  message's own step, with `{type, value}`; the Cmds that step makes get that position's ids. The
  program's `msg` schema decodes the value, as it decodes any Msg, so a reader that needs fewer
  fields gets its own shape.
- **By the writer's shape.** The runner unwraps by the shape on the last `piped` row made into that
  input, live or ended. A reader of anything gets a number as a number and a list as a list. A
  new pipe into an input can only be made while the reader's name has no live process
  (`name_taken`), so within one life that row never changes, and a replay unwraps the same way.
- **No pipe, no value.** A chunk message for a piped input that never had a pipe is saved, acked
  and handed to nobody.
- **`DOWN`.** A `DOWN` whose `ref` starts with that pipe's id steps the fold with `down`, which
  drops a value still arriving, and then steps the program with the `DOWN` as today. The value the
  program holds is its own and is not touched.
- **A replay is the same.** Every chunk message is a saved inbox message, and the fold is pure, so a
  process that rebuilds from its inputs hands its program the same values at the same positions.

## One value traced: `tracker` piped to `outline` by a parent program

A parent program, `lab:1` (life `process_P`), has a member `M` behind its input: a person's message
at its inbox pos 41 asks it to pipe and start two programs. This is the no-shell case 0109 names,
and the shape the law S1 runs with two test programs. tracker's `rows` output is a list of 1,200
rows of about 180 bytes, about 216 KB.

1. `lab:1`'s step at pos 41 returns `pipe({from: {name: "tracker:1", program: "fabrika/tracker",
   output: "rows"}, to: {name: "outline:1", program: "fabrika/outline", input: "rows"}})`, Cmd
   `process_P/41/0`.
2. The runner loads both programs, finds `rows` in tracker's outputs and in outline's piped inputs,
   and calls `Pipes.pipe` with both hashes and shapes.
3. `PipesLedger`: the names are process names, no pipe is saved under the id, `process_P` is live,
   `M` is the sender of pos 41 and `PipePrograms` passes, both ports exist, neither name is live,
   outline's `rows` has no pipe, and `fits` answers `fits` (outline needs a list of `id` and
   `title`; tracker's rows also have `state`). One turn writes:
   - `pipes`: `piped {pipe: "process_P/41/0", from: {..., hash: "9c1e…", shape: <tracker's list of
     rows>}, to: {..., hash: "d03b…", shape: <outline's list of rows>}, rule: "fit/v1", requester:
     {name: "lab:1", process: "process_P"}, member: M}`, with `parent` = `lab:1`'s step at pos 41;
   - `permissions/relations`: `related {subject: "name:tracker:1", relation: "pipes_to", object:
     "name:outline:1"}`;
   - `lab:1/inbox` pos 42: `process_P/41/0/answer`, `pipe_ok {_tag: "piped", pipe: "process_P/41/0"}`.
4. `lab:1` folds pos 42 and returns `start_child` for `outline:1`. `ChildrenLedger` writes
   `registered`, `started {process: "process_O", name: "outline:1", member: M}` and the first
   message. The pipe's writer has no life, so that turn writes no watch.
5. On `start_child_ok`, `lab:1` starts `tracker:1`. In the turn that writes `started {process:
   "process_T"}`, the reader is live, so the brain also writes `monitored {ref:
   "process_P/41/0/process_T", process: "process_T", to: process_O, name: "tracker:1", member: M}`.
6. tracker's runner: life `process_T`'s first load, and `rows` is not `null`. The writer's shape on
   the `piped` row is a list, so `wrap` gives the 1,200 rows as the items, and the runner owes
   `send_chunks({to: "outline:1", as: "rows", items})` as `process_T/0/out/rows`. The cut gives four
   messages under 64 KiB. Each passes the send permission check through the `pipes_to` row and is
   saved at `outline:1/inbox` pos 2 to 5.
7. outline's runner, never outline's code, folds pos 2, 3 and 4 into `arriving` in its checkpoint,
   saving and acking each. outline's program is not stepped, and its view still draws "no rows
   yet". At pos 5, `last`, the fold is `whole`. The writer declared a list, so `unwrap` gives the
   1,200 rows, and the runner steps outline once with `{type: "rows", value: [...1,200 rows]}`.
   outline's `update` keeps them, each decoded to the `id` and `title` it declared, and its view
   draws them.
8. A ticket changes three times while outline is busy and its inbox is full: tracker's steps at its
   pos 9, 10 and 11 each owe a send. The one from pos 9 had not saved its seq 0 when pos 10's came,
   so it is dropped, and pos 10's is dropped by pos 11's. outline is later handed pos 11's value
   whole.
9. tracker crashes between seq 1 and seq 3 of a later send. Its `exited {crashed}` turn writes the
   one `DOWN` for `process_T` into outline's inbox after the saved seq 1. outline's runner steps its
   fold with `down`, which drops what was arriving, then steps outline with the `DOWN`. outline
   still holds the rows it was last handed. Supervision restarts `tracker:1` as `process_T2`; that
   turn writes the watch `process_P/41/0/process_T2`, and the new life's first load sends its whole
   value from seq 0.
10. `lab:1` stops `outline:1` with `stop_child`. That turn exits it with `shutdown`, writes `unpiped
    {pipe: "process_P/41/0", reason: "stopped"}`, the `unrelated` row and `demonitored canceled`.
    tracker's runner reads the `unpiped` row and owes nothing more to `outline:1`.

## One single value traced: the ticket number from `tracker` to `ticket`

`lab:1` pipes `tracker:1`'s `ticket` output to `ticket:1`'s `ticket` input and starts both, as
above. The ticket number is `Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))` on both ends.

1. `PipesLedger` runs its checks in order. At step 8, both shapes are `Number` with the checks
   `effect/schema/isInt` and `effect/schema/isGreaterThanOrEqualTo {minimum: 1}`, and the check
   answers `{ _tag: "fits" }`. It compares the two declared shapes and nothing else: the wrapping
   is not in either. The same turn writes `piped` with both shapes, the `pipes_to` row and the
   answer.
2. tracker's first load: `picked` is `null`, so it owes nothing and no message is saved. ticket has
   been handed nothing, and its view draws "no ticket yet" from its own model.
3. A person picks ticket 1041. tracker's step at its pos 12 sets `picked: 1041`. The output changed.
   The writer's shape is not a list, so `wrap` gives `[1041]`, and the runner owes
   `send_chunks({to: "ticket:1", as: "ticket", items: [1041]})` as `process_T/12/out/ticket`. The
   cut gives one message, `{type: "ticket", items: [1041], part: {id: "process_T/12/out/ticket",
   seq: 0, last: true}}`, saved at `ticket:1/inbox` pos 3.
4. ticket's runner folds pos 3: seq 0 and `last`, so the fold is `whole` at once. The writer
   declared a number, so `unwrap` gives `1041`, and the runner steps ticket with
   `{type: "ticket", value: 1041}`. ticket's `update` reads `msg.value`, a number, and its view
   opens ticket 1041. ticket's code never sees `[1041]` or a `part`.
5. The person picks 9, then 12, while ticket's inbox is full. The send of 9 has not saved its
   message when 12's comes, so 9's is dropped. ticket is later handed 12.
6. tracker crashes. Its `exited {crashed}` turn writes one `DOWN` into ticket's inbox, after the
   saved 12. Nothing was arriving, and ticket still holds 12. Supervision restarts `tracker:1`; its
   first load finds `picked: 12` and sends it again, and ticket is handed 12 again, which changes
   nothing it shows.
7. The same output piped to a reader of anything, `trace:1`'s `any` input (`Schema.Unknown`), fits.
   trace is handed `{type: "any", value: 1041}`, a number. tracker's `rows` output piped to that
   same input is handed as the list of rows. The unwrap followed the writer both times.
8. A pipe from tracker's `ticket` to a reader that needs `Schema.Array(TicketNumber)` is refused
   before any start, by the shapes alone: `{ _tag: "does_not_fit", path: [], need: "Arrays", has:
   "Number" }`.
9. A writer whose single value encodes to about 90 KB, with `mailbox.chunk` at its default of 64 KiB:
   the cut fails with `TooBig`, the owed send is answered `too_big`, and the writer life's stream
   records it. No message is saved, the reader keeps the value it had, and the writer's program
   is not stepped. Its next, smaller value is sent as usual.

## One refused pipe: tracker to `board`

1. `lab:1`'s step at pos 61 returns `pipe` from `tracker:1`'s `rows` to `board:1`'s `rows`, Cmd
   `process_P/61/0`.
2. `PipesLedger` passes steps 1 to 7, and `fits` answers `{_tag: "does_not_fit", path: ["[]",
   "column"], need: "String", has: "missing"}`: board's row needs `column`, and tracker's has none.
3. One turn writes only `lab:1/inbox` pos 62, `pipe_ok {_tag: "unfit", fit: {...}}`. Nothing goes on
   the pipe stream or the relation stream, so no right exists, and `lab:1` starts nothing.

## Elm and OTP, piece by piece

| Piece | Elm's answer | OTP's answer | Where we leave them |
|---|---|---|---|
| The output | a port: a whole typed value out, as a Cmd | a message sent to a pid | an output is model state picked by a selector (0260), and the runner, never the program, sends it |
| The reader's fold | none in the program: a port hands `update` one whole typed value | a `receive` loop that keeps state | we take Elm's for the program, which is handed one Msg per value; the fold of chunk messages is the runner's, one tea machine it steps (0553) |
| The order and the end | none: no processes | per-pair order, one `DOWN` after the last message | we take OTP's; a watch is written for each life by the brain, since OTP's monitor never follows a name and the pipe must |
| Back pressure | none | none: an unbounded mailbox | we leave both for Unix: a capped inbox and a writer that waits (0109) |
| Whether a pipe fits | the compiler checks a port's type | none: messages are untyped | a structural check on declared shapes, since two packs are built apart |

## Every line that ends, stops or signals a process

- **The pipe's watch** writes the `DOWN` a writer life gives. Guard: written only when both ends have
  live lives, with a ref that names the writer life, so it fires once for that life.
- **`unpiped stopped`,** in `stop_child`'s turn. Guard: only when the stopping process is the pipe's
  requester, and only for a live pipe with that name as an end. It removes the `pipes_to` row and
  the pipe's live watch with `demonitored canceled`.
- **`exit` waits** behind an owed send to a piped name. Guard: only sends with a live pipe; `kill`
  and supervision do not wait.
- **Not touched:** a crash (supervision restarts and the pipe follows the name), a process that is no
  end of a pipe, and a pipe's requester ending, whose children keep running, as the note's table says.

## What fact is lost today

Nothing pipes yet, so nothing is lost yet. These exist only at the moment of the pipe, and go in
now, even with nothing reading them:

- **Who made the pipe:** the member checked, and the requester's name and life.
- **What they saw:** each program's code hash and both declared shapes, whole, so a later reader
  knows exactly which two shapes were checked, and how each value on that pipe was wrapped.
- **Which rule judged it:** `rule: "fit/v1"`. The rule will grow (unions, refinements); an old pipe
  must still say which rule let it through.
- **The cause:** `parent`, the step whose message caused the Cmd, which leads to the member's own
  message and its clock. `sentAt` and `arrivedAt` on every row.
- **Why a pipe was refused:** the `unfit` answer message, saved in the requester's inbox, keeps the
  verdict and its path.
- **That a value was not sent:** a value refused as `too_big` leaves a `cmd.answered` record in the
  writer life's stream, with the owed send's id, which names the step and the output. Without it
  the value is gone with no trace, since an output has no answer.

What can wait, since it rebuilds from the log: how many values newest wins dropped (a dispatched send
with no seq 0 saved), how long a writer waited on `full`, a pipe's throughput.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where | Runs |
|---|---|---|---|---|---|
| S1, the whole pipe with no shell: a parent test program pipes a writer and a reader test program and starts the reader, then the writer, once for a pair with a list output and once for a pair with a struct output whose reader needs part of it; the writer's value changes three times while the reader's inbox is full, and the reader's program is handed the newest whole value; the writer crashes mid-send and the reader keeps the value it had; supervision restarts the writer, and the reader is handed the new life's first whole value and exactly one `DOWN` per life; a pipe that does not fit and a pipe the member may not make are each refused, with nothing on the pipe or relation streams and no start | test | scenario: two pairs of test programs and a parent, the five moves in order | (a) send every value, not the newest; (b) hand the reader a value at the first chunk; (c) watch only the first writer life; (d) write the `piped` row before checking that the pipe fits; (e) hand the reader's program the items in place of the value: S1 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests (0536) |
| F1, a pipe that fits is sound: for generated writer and reader shapes from v1's grammar where `fits` answers `fits`, every value Effect Arbitrary makes from the writer schema, encoded, decodes with the reader schema. 200 runs | test | fc.letrec: v1 shape pairs, structs, lists, literals, literal sets, primitives, optional fields | (a) let an extra reader field through as fine; (b) treat a literal set as fitting a smaller set: F1 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F2, a missing need: removing any one required field the reader needs from a fitting writer answers `does_not_fit` with that field's path and `has: "missing"`; making it optional answers `has: "optional"`. 200 runs | test | fc.letrec: v1 shape pairs and a field to drop | (a) skip nested structs; (b) report the parent's path: F2 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F3, what v1 cannot tell: each reader shape outside v1 (`Declaration`, `Suspend`, tuple, `Record`, `NullOr`, a non-literal union, `TemplateLiteral`, `Enum`, a custom filter) answers `cannot_tell` at its path, even when the writer's shape is the same | test | scenario: one pair per shape, the plan's six examples | answer `fits` for two equal shapes: F3 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F4, checks: a reader check the writer does not carry, same id and payload, answers `cannot_tell`; a writer with more checks than the reader fits. 100 runs | test | fc.constantFrom: isInt, isMinLength, isMaxLength, isPattern, isGreaterThanOrEqualTo | ignore checks: F4 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F5, the declared shapes: a loaded program's `outputs[k].shape` and a piped input's `shape` equal `toJson(toRepresentation(...))` of the schema the program gave, list or not, with no list added for the pipe, and survive `fromJson`; a write port that `Piped.ports` did not make has no `shape` | test | scenario: a writer and a reader test program with a list port and a number port each, and the checklist | (a) read the type side, not the encoded side: F5 red on a `Schema.NumberFromString` field; (b) record a single value's shape as a list of it: F5 red | next/packages/libfabrika/src/runtime/Program.test.ts | laptop |
| P1, a pipe is recorded: for generated members, programs and names that pass, `pipe` answers `piped` with its Cmd id and writes in one turn exactly one `piped` row with every fact (both code hashes, both declared shapes as the loader wrote them, `rule`, requester, member), one `related pipes_to` row and the answer message. 100 runs | test | fc.record: member, writer and reader programs, names | (a) drop `member` or `rule` from the row; (b) write the relation row in a second turn; (c) keep only the writer's shape: P1 red | next/packages/libfabrika/src/processes/PipesTest.ts, run by next/packages/libfabrika/src/node/Pipes.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| P2, the refusal order: a generated ask that fails more than one check gets the first of `bad_name`, `stale_sender`, `forbidden`, `no_output`, `no_input`, `name_taken`, `taken`, then `unfit`, and each writes nothing but its answer message. 100 runs | test | fc.record: bad name, stale requester, denied or missing member, missing ports, live name, piped input, unfit shapes | check that the pipe fits before the member: P2 red | next/packages/libfabrika/src/processes/PipesTest.ts, run by next/packages/libfabrika/src/node/Pipes.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| P3, a retry is one pipe: the same Cmd id asked again any number of times gives one `piped` row, one relation row and the same pipe id. 100 runs | test | fc.integer: retries 1 to 5 | mint a new id per try: P3 red | next/packages/libfabrika/src/processes/PipesTest.ts, run by next/packages/libfabrika/src/node/Pipes.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| P4, the right to send messages and the end: the writer's name may mail the reader's name only while the pipe is live; before `piped`, after the requester's `stop_child` of either end, and from reader to writer, a send is `forbidden`; a `stop_child` by any other process writes no `unpiped`. 100 runs | test | fc.commands: pipe, send, reverse send, stop either end, stop by another | (a) keep the right after `unpiped`; (b) grant both ways; (c) end the pipe on a crash: P4 red | next/packages/libfabrika/src/processes/ProgramMailTest.ts, run by next/packages/libfabrika/src/node/Pipes.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| W1, one DOWN per writer life: for a generated run of writer starts, crashes, restarts and chunked sends, the reader's program is handed exactly one `DOWN` per writer life, with ref `<pipe>/<process>`, that life's reason and the writer's name, after that life's last saved message; a life that crashes in the turn after its start gives `crashed`, never `noproc`. 100 runs | test | Effect Arbitrary: ExitReason | (a) write the watch in a turn after `started`; (b) reuse the pipe id as the ref: W1 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| W2, a reader restart: a new reader life gets a watch on the writer's live life in its restart turn, and gets the next `DOWN` | test | scenario: crash the reader once, then the writer | write the watch only on writer starts: W2 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| O1, newest wins: for a generated run of writer model changes against a slow reader with a small cap, for a list output and for a single value, each value the reader's program is handed equals one whole writer value, the handed values keep the writer's order, and the last one is the writer's last value. 100 runs | test | fc.commands: change, read, ack | (a) append a newer value to an owed one; (b) drop a send that already saved seq 0: O1 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| O2, a life's first value: a life whose output is not `null` at its first load sends it once; a wake of the same life sends nothing; a restart sends again from seq 0; a `null` value sends nothing; each for a list output and for a single value | test | scenario: start, sleep and wake, crash and restart, a null output | send on every load: O2 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| O3, exit flushes: a writer that exits with an owed send to a piped name gets its last value to the reader's program before its `DOWN normal`; one that is killed between two chunks of a list leaves the reader's program on the value it had | test | scenario: exit behind a full inbox, kill mid-send | let `exit` pass an owed send: O3 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| R1, a cut send hands nothing: for generated streams of chunks (whole sends, cut sends, interleaved ids, repeats, a `down` anywhere), the runner's fold is `whole` only right after the last chunk of a send whose every chunk came in order, and then holds exactly that send's items; a cut send, a stray chunk, a `down` and a new seq 0 each drop what was arriving and hand nothing, so the value a reader's program holds changes only to one whole sent value. 500 runs | test | fc.commands: chunk of a send, cut, stray chunk, down | (a) fold a chunk whose seq skips one; (b) keep what was arriving on `down`; (c) reach `whole` from a send with no seq 0: R1 red | next/packages/libfabrika/src/runtime/internal/pipeFold.test.ts | laptop |
| X1, the wrapping round trip: for a generated declared shape, a generated value of it and a generated chunk size, `unwrap(shape, join(cut(wrap(shape, value))))` is that value, compared as JSON; a list goes as its items and anything else as one item. 500 runs | test | fc.letrec: declared shapes (a number, a string, a struct, a struct with a nullable field, a list, a list of lists, `Schema.Unknown`) with a value from Effect Arbitrary of each, and fc.constantFrom edges: an empty list, a list of one, a list of one `null`, a list that needs more than three chunks | (a) wrap by `Array.isArray` in place of the declared shape; (b) unwrap any list of one to its item; (c) join without the last chunk's items: X1 red | next/packages/libfabrika/src/runtime/internal/pipeItems.test.ts | laptop |
| X2, a value arrives as it was given: through real runners, a writer and a reader test program that declare the same generated shape, with `mailbox.chunk` at 1 KiB; for each generated value the writer's selector gives (a number, a string, a struct, a struct with a `null` field, an empty list, a list of one, a list of lists, a list that needs several chunks), the Msg the reader's `update` is handed holds that value, compared as JSON, once, and no other Msg is handed for it. 30 runs | test | fc.letrec: X1's shapes and values, one pair of test programs built from each shape | (a) hand the reader the items (`[1041]` for `1041`); (b) step the reader at every chunk; (c) send an empty list as no message: X2 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| N1, nothing to send stays apart, on both ends: for a generated run of writer values drawn from `null`, `[]`, `[null]`, `[null, null]` and `[7]` (an output declared a list of nullable integers), and from `null` and `{note: null}` (an output declared a struct), against a reader that reads each one: a selector's `null` saves no message and hands the reader nothing; `[]` is handed as `[]`, `[null]` as `[null]`, and `{note: null}` as itself; the reader's log holds exactly the writer's values that are not `null`, at each change, in order. 50 runs | test | fc.constantFrom: the seven values above, drawn as a run of 1 to 12 values | (a) send a selector's `null` as an empty send; (b) hand nothing when the items are empty; (c) drop an item that is `null`: N1 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| A1, a reader of anything: for generated writer shapes, list or not, piped to a reader whose input is `Schema.Unknown`, the pipe fits, and the reader's program is handed the writer's value as the writer declared it: a single value unwrapped, a list as a list. 30 runs | test | fc.letrec: X1's shapes and values | (a) unwrap by the reader's declared shape; (b) refuse a list writer into a reader of anything: A1 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| B1, an item too big: a writer whose value holds one item whose message alone is over `mailbox.chunk` (a single value, or one item of a list at a generated index) saves no message, the reader's program is handed nothing and keeps the value it had, the writer life's stream holds one `cmd.answered` with `send_chunks_err` and reason `too_big`, the writer's program is not stepped with it and stays up, and its next value under the size arrives whole. 30 runs | test | fc.record: a chunk size from fc.integer 1,024 to 4,096, an item size around it, a list or a single value, the item's index | (a) step the writer's program with the answer; (b) save the chunks before the item that is too big: B1 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| G1, a piped input is a plain input: a `{type, value}` message sent straight to a reader's piped input steps its program as any write port; a chunk message for a piped input that never had a pipe is acked and hands nothing | test | scenario: one reader test program, a direct message, then a chunk message with no pipe | unwrap a chunk message with no pipe as a list: G1 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| T1, the shapes: `pipe`'s input is only `{from, to}` with those keys, an output's selector must return its schema's type or `null`, and `ProcessCalls.monitor` still takes no `as` | type | type | add `requester` to `PipeInput`, or return a number from a list output's selector: tsc red | next/packages/libfabrika/src/runtime/Pipe.types.test.ts | laptop |
| T2, a program sees only its declared shape: `Piped.input(t, S)`'s type is exactly `{type: t, value: S["Type"]}`; the ports `Piped.ports(t, S, d)` gives are keyed `t` and `DOWN` only; neither type has an `items` or a `part` key or names `Chunk` or `Part`; and `Output.make(S, select)` takes a selector of `S["Type"]` or `null`, never a list of it | type | type | add a `part` field to `Piped.input`, or make `Output.make` take a list of `S`: tsc red | next/packages/libfabrika/src/runtime/Pipe.types.test.ts | laptop |
| H1, across objects: S1's first three moves on the real Worker runtime, with the writer and the reader in two Process objects: the reader's program is handed the whole value, the writer crashes once, and the reader gets one `DOWN` and the restarted writer's value. Host-only (workerd): CI's scheduled full run only, before the first review, never on the owner's Mac | test | scenario: the two test programs and the parent on one local instance on workerd | route `programPipe` to the object's own manager: no `piped` row, H1 red | next/apps/fabrika/src/worker-pipe.integration.test.ts | CI's full run only |

**Lint, type or test?** Each law was asked.

- **Tests:** S1, F1 to F5, P1 to P4, W1, W2, O1 to O3, R1, X1, X2, N1, A1, B1, G1 and H1 are about
  values, ledger rows and their order, which no type or lint rule sees.
- **Types:** T1 and T2 are shapes of code. T2 is 0553's "a program never sees the wrapping" for the
  two helpers a program calls.
- **Lint, with no new rule:** the wrapping's code sits in `runtime/internal/`, which
  `fabrika/modules` and `no-restricted-imports` already close to every other module, and
  `index.ts` exports neither file. So a program cannot import `wrap`, `unwrap` or the fold. The
  tests step confirms it once by hand: an import of `runtime/internal/pipeItems.ts` planted in
  `next/programs/checklist/src/program.ts` turns `pnpm lint` red.
- **Not checked by code:** 0553's rule that no program declares "a list that is there only for the
  pipe". Whether a declared list is the program's meaning is judgment, so it stays with review. A
  lint rule on it would have false alarms nobody can measure.

**Where they run.** S1 is the pull request's whole vehicle, end to end, with no shell. It and the
other suites run through `node/*.integration.test.ts` on node:sqlite in a temp folder, so under
[0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md) a pull request
leaves them to the schedule; the tests and build steps run those paths narrowly on the laptop, since
they need no real machine, signal or socket. F1 to F5, R1, X1, T1 and T2 are plain tests and type
checks that run on the laptop and in every CI run. H1 is the only host-only law (workerd): CI's full
run only, before the first review. Nothing here kills a real process or touches launchd, so nothing
waits on the owner's Mac under 0178.

## Is this a setting?

Each new choice was asked (0069):

- **The rules for when a pipe fits,** "newest wins", one pipe per input, and a pipe ending at its requester's
  `stop_child`: no. Each is what a pipe is, decided in 0549 and 0550 or by the note's plumbing.
- **The version of those rules** is a constant, `RULE`, recorded on each row, never a knob.
- **How a value is wrapped:** no. 0553 decides there is one way, and a knob would be a second.
- **The chunk size and the inbox cap** already are settings, `mailbox.chunk` and `mailbox.capacity`.
  `mailbox.chunk` is also the most one item may weigh today, so a person who pipes bigger single
  values raises it, up to its bound of 1 MiB. No new setting is added.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/processes/Fit.ts | build | 170 | new: `fits`, `Fit`, `Unfit`, `RULE`, the v1 rules |
| next/packages/libfabrika/src/processes/Pipes.ts | build | 90 | new: the `Pipes` contract, `PipeEvent` with both declared shapes, `PipesError` |
| next/packages/libfabrika/src/processes/PipesLedger.ts | build | 200 | new: the checks in order, the one turn that writes, `list` |
| next/packages/libfabrika/src/processes/internal/pipeTable.ts | build | 70 | new: the pipe stream's fold, read in a turn: the live pipes, and the last pipe into each input |
| next/packages/libfabrika/src/processes/ProcessManager.ts | build | 45 | the pipe's watches in the start and restart turns |
| next/packages/libfabrika/src/processes/ChildrenLedger.ts | build | 20 | `unpiped` in the requester's `stop_child` turn |
| next/packages/libfabrika/src/processes/ProgramMailLedger.ts | build | 20 | a send passes on a live `pipes_to` row |
| next/packages/libfabrika/src/permissions/Model.ts | build | 30 | the `name` type, `pipes_to`, `mail`, `pipe` and `PipePrograms` |
| next/packages/libfabrika/src/runtime/Pipe.ts | build | 60 | new: `pipe`, its operands and answers |
| next/packages/libfabrika/src/runtime/Piped.ts | build | 35 | new: what a reader declares, `input` and `ports`, in its declared shape |
| next/packages/libfabrika/src/runtime/internal/pipeItems.ts | build | 35 | new: `listed`, `wrap` and `unwrap`, by the writer's declared shape |
| next/packages/libfabrika/src/runtime/internal/pipeFold.ts | build | 60 | new: the tea machine that folds chunk messages in the reader's runner |
| next/packages/libfabrika/src/runtime/Program.ts | build | 70 | `Output.make`, a write port's `value`, shapes at load, changed outputs per step |
| next/packages/libfabrika/src/runtime/Execution.ts | build | 25 | `Declaration` gains a piped input's `shape` and `outputs`; a step's answer gains `outputs` |
| next/packages/libfabrika/src/runtime/Entry.ts | build | 15 | the in-process loader fills the shapes |
| next/packages/libfabrika/src/runtime/ProcessStore.ts | build | 8 | the checkpoint gains `arriving` |
| next/packages/libfabrika/src/runtime/Runner.ts | build | 220 | the `pipe` performer; the writer's side: owed sends wrapped, a life's first value, `exit` waits, an answer recorded and never folded; the reader's side: the fold, the unwrap and one step per value |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 40 | `programPipe` and `programPipesList`, the remote `Pipes`, `PipesLedger` in the Project |
| next/packages/libfabrika/src/cloudflare/bindings.ts | build | 5 | the two calls' types |
| next/packages/libfabrika/src/cloudflare/platform.ts | build | 6 | the two calls' Promise edges, each one marked line |
| next/apps/fabrika/src/brain.ts | build | 8 | the Project class forwards the two calls |
| next/packages/libfabrika/src/index.ts | build | 4 | exports `Fit`, `Pipe`, `Piped`, `Pipes`; nothing from `runtime/internal/` |
| next/programs/checklist/src/program.ts | build | 3 | `done` becomes `Output.make(Done, finished)` |
| next/packages/libfabrika/src/processes/Fit.test.ts | tests | tests | F1 to F4 |
| next/packages/libfabrika/src/runtime/Program.test.ts | tests | tests | F5 |
| next/packages/libfabrika/src/processes/PipesTest.ts | tests | tests | P1 to P3 |
| next/packages/libfabrika/src/processes/ProgramMailTest.ts | tests | tests | P4 |
| next/packages/libfabrika/src/node/Pipes.integration.test.ts | tests | tests | runs `PipesTest` and P4 on node:sqlite |
| next/packages/libfabrika/src/runtime/PipeTest.ts | tests | tests | S1, W1, W2, O1 to O3, X2, N1, A1, B1, G1, with a parent and writer and reader test programs |
| next/packages/libfabrika/src/node/Pipe.integration.test.ts | tests | tests | runs `PipeTest` on node:sqlite |
| next/packages/libfabrika/src/runtime/internal/pipeFold.test.ts | tests | tests | R1 |
| next/packages/libfabrika/src/runtime/internal/pipeItems.test.ts | tests | tests | X1 |
| next/packages/libfabrika/src/runtime/Pipe.types.test.ts | tests | tests | T1 and T2 |
| next/apps/fabrika/src/worker-pipe.integration.test.ts | tests | tests | H1, CI's full run only |
| next/packages/libfabrika/src/processes/ProcessMonitors.integration.test.ts | tests | tests | the watch slice's laws stay green with the optional `answer` |
| next/packages/libfabrika/src/node/StartChild.integration.test.ts | tests | tests | no change: must stay green with the new `stop_child` turn |
| next/packages/libfabrika/src/runtime/Chunk.test.ts | tests | tests | no change: ticket 1041's L1 and L2 stay as they are |
| next/packages/libfabrika/src/runtime/ProgramMailTest.ts | tests | tests | no change: ticket 1041's L12 stays as it is |
| layer-rules.json | tests | tests | no change expected: every new file sits in a module that has a row |
| .glossary/TERMS.md | build | docs | rows `pipe (Cmd)` and `piped`; `pipe` gains the name of the rules for when a pipe fits |
| docs/direction/follows/otp.md | build | docs | a row for a watch per life under a name, where we leave OTP's monitor |

## Calls taken

Each is mine to decide by the open questions test: it picks how the code does what a note or a
decision already says. The calls this revision added carry how sure I am.

- **The check that a pipe fits reads Effect's `SchemaRepresentation`,** not JSON Schema. It is Effect's own persisted
  form of a schema, it keeps each check's persistence id, and it needs no second converter. JSON
  Schema loses which Effect check made a constraint, which v1's check rule reads.
- **The encoded side is compared,** since a message carries encoded JSON and the reader decodes it.
- **An unfit pipe is an `ok` answer, not an error,** so its path rides the answer message. tea's Cmd
  errors carry a tag only. `start_child`'s `already_present` is the same pattern.
- **The pipe's id is its Cmd's id,** as the watch slice made a watch's ref its Cmd's id: stable on a
  retry, never reused.
- **A watch per writer life, written by the brain in the start and restart turns.** The note's
  plumbing call, and the watch slice's own lean for the pipe ("the pipe slice ... does that
  brain-side"). A reader's runner that monitored again after each `DOWN` would get `noproc` during a
  restart's backoff and lose the crash's reason.
- **A pipe ends when its requester stops either end with `stop_child`,** in that turn, as OTP's "only
  the starter stops a child". A crash never ends it, since the pipe follows the name. The later shell
  slices stop through this same path, so they get the end for free.
- **No related-pair exception for a pipe.** 0551 checks the member behind the pipe; a pipe with no
  member is `forbidden`.
- **The check that a pipe fits lives in `processes/`,** a layer the runtime, the client and the entry may all import, so
  it needs no new line in `layer-rules.json`.
- **Typed services only.** The runner reaches `Pipes` as a service; nothing calls a command-line tool
  (0231).
- **A browser is always a client.** Every piece is JSON messages, Cmds and the Project's RPC.
- **Both runners wrap and unwrap by the writer's shape on the `piped` row (90%).** 0553 says the
  unwrap follows what the writer declared. One recorded fact read by both ends cannot disagree with
  itself; a marker inside each chunk message would be a second kind of chunk message, which 0553's
  "one way" rules out. The cost: the reader's runner needs the pipe's row, which `Pipes.list` gives
  it at load.
- **A value still arriving lives in the reader's runner checkpoint, as a tea machine (85%).** 0553
  leaves open where it is kept. The other way was to keep nothing and read the earlier chunk
  messages back from the inbox at the last one. That holds no second copy, but it needs a range
  read of the inbox that `runtime/` does not have, and a law on what that read costs. What the
  picked way costs: each chunk's checkpoint save writes what has arrived so far again. The doubt is
  that cost on a long list; "What this cannot tell us" names it.
- **The reader's program is stepped once per value, at the last chunk message, with
  `{type, value}` (90%).** That is the Msg an Elm port would hand it. The chunk messages before it
  step nothing.
- **A top-level `null` is never a value (95%).** 0260 says `null` is nothing to send. A `null`
  inside a value is data.
- **An item whose message alone is over `mailbox.chunk` is refused `too_big`, as today (80%).** The
  lead approved this choice on 2026-11-15, in
  [the approval commit](https://github.com/kamp-us/tea-fabrika/commit/8c155da974d7e438b163fe4fa5276c65c49b414e).
  "The approved item-size call" below records the alternative and why it is a separate change.
  No item-size question remains for this slice.
- **A piped value is at most `INPUT_BYTES` in all, 2,000,000 bytes (80%).** The owed send is an
  ordinary `send_chunks`, so its operands meet the cap ticket 1041 gave every `send_chunks`
  (its call 15). Lifting it means a dispatched entry that holds no items, which is its own change.
- **An owed send's answer is recorded with `cmd.answered` and never steps the writer's program
  (90%).** 0260: an output has no answer. Stepping a program with a message it has no case for
  takes it down today.
- **The service's read is `Pipes.list`,** one read for both ends. The approved plan's `outOf` ends
  in `Of`, which the lint rule `fabrika/no-of` refuses.
- **The `piped` row holds the two shapes themselves, not their hashes (90%).** 0553 says the record
  holds both declared shapes, and the reader's runner reads the writer's from it. A hash rebuilds
  from the shape; the shape does not rebuild from a hash.
- **Not in this slice, each named:** a reader that ends by itself (the note's fifth plumbing call;
  telling a final end from a restart needs the name's `down` state, which no watcher gets today, so
  it is a ticket for the lead); how a small program with no window shows on screen in a line, and
  how a step is turned off so data skips it (both with the owner as a design talk); two brains
  talking (0551); a pipe across lines; editing a pipe after the line runs; a writer rebuilt with a
  changed output shape while its pipe is live; telling a writer's program that its value was
  refused as too big.

## The approved item-size call

0553 caps one item at the row size and says it does not decide whether `mailbox.chunk` goes on
refusing an item under that size. The lead gave a lean for this revision and asked that the code
and ticket 1041's laws be read first. On 2026-11-15, the lead approved keeping the existing
chunk-size refusal for this slice. The alternatives below record what was considered, not a
pending question.

- **The earlier alternative:** an item over `mailbox.chunk` and under the row size travels alone
  in its own chunk message, and only an item over the row size is refused.
- **What it breaks, read in the code:** two laws from ticket 1041 that are green on main.
  - L1 (`next/packages/libfabrika/src/runtime/Chunk.test.ts`): "every chunk's encoded JSON is at
    most `size` bytes", and "an item too big alone fails `TooBig`".
  - L12 (`next/packages/libfabrika/src/runtime/ProgramMailTest.ts`): "an item too big alone ...
    answer `too_big` with no part saved". Both are quoted from the laws table of
    `docs/plan/quests/t1041-PLAN.md`.
  - It also changes what the setting means. The doc read then named it `mail.chunk`: the most
    bytes in one message of a chunked send. Ticket 1041's call 12 took the refusal on purpose.
  - It leaves measured ground. The setting read then was `mail.chunk`, capped at 1 MiB in
    `settings/Declarations.ts`, and ticket 1041's read law L7 covers a newest message up to a 1 MiB chunk
    (`processes/ProgramMailReadsTest.ts`). An item alone could be about 2 MB, which no chunked send
    has carried.
- **Why it is not this plan's to take:** making L1 and L12 pass a message over the size loosens two
  laws, and a loosened law waits on the owner (`AGENTS.md`, "How a change lands"). A second cut
  used only by pipes would keep those laws green, but 0553 says the cutting from ticket 1041 is the
  only cutting.
- **What this plan builds in its place,** the smallest honest thing: nothing in `Chunk.cut`
  changes. An item whose message alone is over `mailbox.chunk` gets `too_big`, the word `send_chunks`
  already answers, and the value is not sent (law B1). That holds 0553 as written: its cap of the
  row size is an upper bound, and it leaves this point open.
- **What that costs:** a single value over 64 KiB by default is refused, where the plan before this
  revision would have sent one up to 2 MB as one plain message. A person can raise `mailbox.chunk` to
  1 MiB. No real single value is that big today: the pairs Amendment A-Fits lists carry a ticket
  number, a string or an integer.
- **A later change to take the alternative:** `Chunk.cut` lets an
  item that fits no chunk go alone when its message is at most `ROW_BYTES`; L1 and L12 are
  rewritten to say so; B1's bound moves from `mailbox.chunk` to the row size; and the read law L7 is
  run again at 2 MB. Nothing else in this plan moves.

## What comes after, not planned here

The order the decisions give. Each is its own plan, written when what it waits on lands. Nothing
below is decided by this plan.

1. **This plan:** the pipe in the library.
2. **Second: fabsh pipes its own built-ins,** with the last one's output printed in fabsh.
   [0159](../../../.decisions/0159-fabsh-pipes-summon-join-first.md) says pipes work first for
   fabsh's built-ins, and that plan follows it as written. It waits on this plan and on fabsh v1's
   reader and job-control slices in [the current plan](https://github.com/kamp-us/tea-fabrika/pull/1434).
   Decision 0586 keeps PRs 1232 and 1254 parked; this later slice builds neither branch.
   Following 0159 as written settles the question this plan's first draft asked about whether
   built-ins come first.
3. **Third: programs with tiles in one line.** The job's scope and a `stop_job` Cmd, Ctrl-C from any
   tile stopping the whole job reader first (0548), one mark per line in tezgah (0477, 0478), and the
   six pipe hues as design tokens, written by the tests step since the design package's tokens are an
   exam path. It waits on the second slice and fabsh v1's foreground-program support in S3 of
   its current plan. The owner still chooses the look before its S2 opens. A question for the later
   pipe plan: which reader program with a window comes
   first. It is a new screen, so it is the owner's.

## Validation

- tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3` on
  `next/packages/libfabrika/src/processes/Fit.test.ts`,
  `next/packages/libfabrika/src/runtime/internal/pipeFold.test.ts`,
  `next/packages/libfabrika/src/runtime/internal/pipeItems.test.ts`,
  `next/packages/libfabrika/src/runtime/Program.test.ts`, `next/packages/libfabrika/src/node/Pipes.integration.test.ts`
  and `next/packages/libfabrika/src/node/Pipe.integration.test.ts` shows each law red on main.
- build step: the same paths green, and
  `next/packages/libfabrika/src/processes/ProcessMonitors.integration.test.ts`,
  `next/packages/libfabrika/src/node/StartChild.integration.test.ts` and
  `next/packages/libfabrika/src/runtime/Chunk.test.ts` still green.
- The lead runs `--changed origin/main` and one `pnpm typecheck`; H1 runs only in CI's full run.

## Size

1. **One pull request, the pipe in the library:** about 1,345 lines. The Files section adds up to
   about 1,240 (Runner 220, PipesLedger 200, Fit 170, Pipes 90, pipeTable 70, Program 70, the
   Project calls 60, Pipe 60, pipeFold 60, ProcessManager 45, Piped 35, pipeItems 35, the rest under
   30 each), and Amendment A-Fits adds 105 (Fit 80, Program 20, Execution 5), plus the suites. It
   lands whole: S1 runs the whole vehicle with no shell, as 0109 says a program can be piped.

About 6 agent hours across the steps, 60% sure. The doubt is the runner, on both ends now: owed
output sends, newest wins and the first value of a life sit in the hardest part of `Runner.ts`,
beside `behind`; the reader's fold adds a kind of inbox message that steps no program; and W1's
same-turn watch touches `ProcessManager`'s start and restart turns. Budget basis: the watch slice's
plan (`docs/plan/quests/watch-PLAN.md` on its branch), 540 lines at 6 steps and $40, and ticket
1041's (`docs/plan/quests/t1041-PLAN.md`), a runner host Cmd at 6 steps and $43. This is about two
and a half times the watch slice, so one more likely send-back.

Estimate: 7 steps, $80

## Records

- Ticket 1081, in the app's tracker.
- `field/runs/` rows for each step, by the lead.
- Glossary rows in this pull request: `pipe (Cmd)` and `piped`; `pipe` gains the name of the rules
  for when a pipe fits. Decision 0553's own pull request already wrote that every value travels one
  way underneath, so this one adds no word for the wrapping.
- `docs/direction/follows/otp.md`: a watch per life under a name, where we leave OTP's monitor.
- No `.decisions/` file: every call here applies a decided note or decision. The note stays
  proposed; its reader sketch with a chunk input is older than 0553, and 0553 says so.

## What this cannot tell us

- How often a real pair of packs ends as `cannot_tell`. Amendment A-Fits says which shapes still
  do; the first real pairs show which rule to add next.
- What newest wins skips in a real line, and whether anyone misses it.
- What a long list costs the reader's runner. Each chunk message's checkpoint save writes what has
  arrived so far again, so a value of n chunks writes about n squared over two chunks of bytes. A
  216 KB list in four chunks is small; nothing here measures a 2 MB one.
- What a single value pays for its chunk message's wrapping. 0553 names the cost; nothing here
  measures it.
- How many real single values are over 64 KiB, the default `mailbox.chunk`. Every one is refused
  `too_big` as this plan stands, and its writer's program is not told.
- What happens to a live pipe when its writer is rebuilt with another output shape. Both runners
  go on reading the shape the `piped` row recorded. Not in this slice.
- Whether one watch per life holds when a writer restarts fast many times in a row. W1 runs it in
  the laptop's suite; nothing has run it on a Durable Object under load.
- Whether the ack after each save keeps up with 64 KiB messages on workerd. H1 runs one value, not a
  load.
- How any of it reads to a person. Nothing here draws.

Made up, for the examples: the programs `tracker`, `outline`, `board`, `ticket`, `trace` and `lab`
in `next/`, their `rows`, `ticket` and `any` outputs and inputs, `Row`, `Rows`, `TicketNumber`, the
`picked` and `column` fields, the process IDs `process_P`, `process_O`, `process_T` and
`process_T2`, and the hashes. Real: `send_chunks`, `Chunk.cut`, `Chunk.join`, `Chunk.input`, `Part`,
`TooBig`, `too_big`, `full`, `mail.unread`, `mail.chunk`, `INPUT_BYTES`, `ROW_BYTES`,
`cmd.answered`, `start_child`, `stop_child`, `exit`, `DOWN`, `monitored`, `SchemaRepresentation`,
`fabrika/checklist`.

## Open questions

None.

The lead's approval on 2026-11-15 kept the existing chunk-size refusal in this slice. Changing
that bound is separate work because it changes ticket 1041's laws L1 and L12. The first draft's
two screen and shell questions belong to the later plans named in "What comes after, not planned
here"; this plan settles neither.

## Findings

```json
{"_tag": "finding", "id": "2026-11-15-pipe-hues-only-in-todays-app-css", "date": "2026-11-15", "by": "plan", "model": "claude-opus-5-5", "rule": "duplicate", "location": {"path": "apps/fabrika/src/window/window.css", "line": 333}, "says": "In today's version, the six pipe hues of 0478 are literal light-dark() values in the app's window.css and not tokens of the shared design package (0456), so next/'s tuval can only copy them; once the third pipe slice adds them as tokens, today's CSS keeps a second copy.", "proof": "apps/fabrika/src/window/window.css line 333 opens [data-pipe=\"sky\"] with literal values, and the other five hues follow; the design package's color tokens folder holds no pipe token, and rg -i pipe packages/fabrika-design finds only a comment in tile-edge.toml (2026-11-15).", "cost": "Two copies of one hue table drift apart the first time one version's colors change.", "head": "0e36734b7539657f64bc0466b36517bb66291b8b", "ticket": null, "pr": null}
```

## Amendment A-Fits, 2026-11-15

Where this section and the sections above differ, this one wins. It changes only the check that a
pipe fits (`processes/Fit.ts`), what the loader writes for it, and their laws. `RULE` stays `"fit/v1"`: no
pipe was judged by the narrower rule, so the first rule that runs is this one.

**The answer first.** Of the pairs a person pipes in today's version, none is refused by v1 only
because it cannot tell: `tracker | ticket`, `ticket | trace`, `tracker | trace`, `pipeline | trace`
carry a ticket number, `experiment | markdown`, `experiments | markdown` and `compare | markdown` a
string, and `seq | tally`, `seq | double`, `counter | double` an integer. v1 compares all three. But
v1 cannot tell 18 of the 82 real ports even when one is piped into an equal shape, through a
nullable field (12 ports) or a union that is not only literals (6 ports, 4 of them holding a union
tagged with `_tag`), so the first reader
that needs `note: NullOr(String)` or a command struct is refused. The survey also found three places
where the plan as written is wrong, whatever the union rule:

- **The encoded side hides a transformation.** A reader field `Schema.DateTimeUtcFromString` shows as
  `String` on its encoded side, so v1 passes a writer's plain `String`, and the reader then refuses
  `"x"` (tried on effect 4.1.2). That breaks 0550's "pipe stays typed".
- **A custom filter makes `toJson` throw.** `SchemaRepresentation.toJson` fails with `Missing key
  at ["representation"]["checks"][0]["representation"]` on a `Schema.makeFilter` check with no
  persistence id (tried on effect 4.1.2). The loader would fail on today's shell's `table` output
  instead of answering cannot tell.
- **A check id is only safe when it is Effect's own.** A custom filter may carry an id of its own
  (`Schema.makeFilter(f, { representation: { id: "pack/isTicket", payload: null } })`, tried on
  effect 4.1.2), so two packs may give two different checks one id. The same id with the same
  payload means the same predicate only for the ids of the revivers the installed
  `SchemaRepresentation` exports (`effect/schema/isInt`, `effect/schema/isGreaterThanOrEqualTo`,
  ...). The rule trusts that a check under one of those ids is Effect's own; a pack that puts its
  own code under Effect's id is out of its reach.

### The survey

Read from the code on 2026-11-15, at this branch's head. A port's shape is counted once for each
construct it holds anywhere in it. "Real" is every declared input and output of today's programs and
of `next/`'s; `next/` declares only one output today, and no chunk input outside test fixtures.

| Construct | Real ports | v1 as planned | After this amendment |
|---|---|---|---|
| String, Number, Boolean, Null, Unknown | 78 | compares | compares |
| an Effect check (isInt in 43 ports, isGreaterThanOrEqualTo 25, isMaxLength 14, isPattern 9, ...) | 49 | compares: same id and payload | compares: same Effect id and payload, in any order |
| a literal set (`Schema.Literals`) | 15 | compares | compares, as a union |
| an optional field (`optionalKey`) | 9 | compares | compares |
| a list (`Schema.Array`) | 8 | compares | compares |
| `NullOr(X)` | 12 | cannot tell | compares |
| a union of structs tagged with `_tag` (`TaggedUnion`) | 4 | cannot tell | compares |
| a union with no tag (`Union([String, Struct])`, `Union([Struct, Struct])`) | 4 | cannot tell | compares |
| a single literal, sent into a reader that takes its primitive | 7 | does not fit | compares |
| `TemplateLiteral` (an experiment's run id and label) | 3 | cannot tell | cannot tell |
| a record (`Schema.Record`) | 2 | cannot tell | cannot tell |
| a tuple or `NonEmptyArray` | 1 | cannot tell | cannot tell |
| a custom filter (`Schema.makeFilter`, no id) | 1 | the loader throws | cannot tell |
| a date, `Option`, a class, a transformation | 0 | cannot tell, or passes wrongly | cannot tell on a reader |
| a branded id (`Schema.brand`) | 0 | compares as its base: a brand adds no check | the same |
| recursion (`Suspend`, `Reference`) | 0 | cannot tell | cannot tell |

Where each port is declared, by program:

- Today's `tracker`: inputs at `programs/tracker/src/index.ts` lines 207 to 247 (`file`,
  `comment`, `close`, `reopen`, `answer`, `rate_duplicate`, `make_area`, `rename_area`,
  `merge_area`, `skip_onboarding`, `query`, `quit`); output `ticket` at line 250, a ticket number
  (`Int` checked `>= 1`, `packages/pipeline/src/tickets/ticket.ts` line 22). `file` holds a tagged
  union (`from`, `ticket.ts` line 189), `make_area` another (`suggested`, `area.ts` line 29),
  `answer` is a union of two structs with no tag (`programs/tracker/src/ticket.ts` line 80), and
  `query` a union of two structs with no tag (`index.ts` line 135).
- Today's `ticket`: inputs at `programs/ticket/src/index.ts` lines 70 to 79, output `ticket` at
  line 85, a ticket number. `answer` is the tracker's union.
- Today's `trace`: inputs at `programs/trace/src/index.ts` lines 224 to 234. `choose` is
  `{row: NullOr(String, max 512)}` and `seek` is `{at: NullOr(Finite)}` (lines 60 and 62); `id` is a
  32-hex-character string (`packages/fabrika/src/host/traces.ts` line 30); `ticket` a ticket
  number; `any` takes anything. No outputs.
- Today's `pipeline`: outputs at `programs/pipeline/src/index.ts` lines 32 and 33, a ticket number
  and a string.
- Today's `compare`, `experiment`, `experiments`: outputs at `programs/compare/src/index.ts` lines
  36 and 40, `programs/experiment/src/index.ts` lines 27 and 31, `programs/experiments/src/index.ts`
  lines 48 and 69: a structure (`Comparison`, `ExperimentPage`, `Experiment` in
  `packages/pipeline/src/experiments/experiment.ts`, with nullable fields, records at lines 112 to
  116 and template literals at lines 46 and 52) and a markdown string each.
- Today's `counter`: input `press` (two literals) and output `n` (`Int`) at
  `programs/counter/src/index.ts` lines 32 and 33. `markdown`: inputs `text` (string) and `quit` at
  `programs/markdown/src/index.ts` lines 43 and 44. `map`: input `quit` at
  `programs/map/src/index.ts` line 22.
- Today's small shell programs, `packages/fabrika/src/shell/small.ts`: `say` line 29, `seq` line 38,
  `double` lines 50 and 51, `upper` lines 58 and 59, `tally` lines 131 to 134 (`refused` is
  `{n: Int, why: "out_of_range"}`). All strings and integers.
- Today's shell, `packages/fabrika/src/shell/shell.ts`: inputs lines 88 to 115 (`line` is
  `Union([String, Struct])`), outputs lines 122 to 147 (`status` and `asked` hold
  `text: NullOr(String)`; `table` holds `Table`, `packages/fabrika/src/shell/table.ts` line 57, a
  `NonEmptyArray` and a custom filter).
- Today's agent programs: `packages/fabrika/src/agents/summon/turn.ts` inputs lines 87 and 88,
  outputs lines 95 to 113 (`result` holds `turn: NullOr(Count)` and `cost: NullOr(Finite)`);
  `packages/fabrika/src/agents/acp/program.ts` inputs lines 228 to 233, outputs lines 236 to 244
  (`opened`, `settings` and `result` hold nullable fields).
- `next/`: the checklist's output `done` at `next/programs/checklist/src/program.ts` line 164, a
  struct `{items: Array(String, checked)}` (line 59). Every other `next/` program declares
  `outputs: {}`. Test fixtures, not counted above: the reader's chunk input in libfabrika's
  `src/runtime/internal/chunkPrograms.test-support.ts` line 160 (a list of
  `{s: Int, i: Int, pad: String}`) and `Chunk.input("rows", Row)` in
  libfabrika's `src/runtime/Send.types.test.ts` line 16 (`{path: String, line: Int}`);
  v1 compares both.
- Not a program: `runs` is a tool of today's MCP server (`packages/fabrika/src/mcp/tools.ts`), with
  no declared ports.

The pairs, judged on the two shapes (scratch script, never committed):

- **Connects in v1 and after:** `tracker | ticket`, `ticket | trace`, `tracker | trace` and
  `pipeline | trace` (ticket number into ticket number), `experiment | markdown`,
  `experiments | markdown`, `compare | markdown` (string into string, through each one's `markdown`
  output), `seq | tally`, `seq | double`, `counter | double` (`Int` into `Int`), `tally | trace`
  (into `any`).
- **Refused rightly in both:** `seq | upper` (number into string), `seq | counter` (number into two
  literals), `experiments`'s `row` into `markdown` (struct into string).
- **Refused only because v1 cannot tell, connects after:** `seq --to 1 | tracker <answer` becomes a
  right refusal (`does_not_fit`, a number is no struct) in place of `cannot_tell`; any reader of
  `{input: NullOr(Count)}` fed by the agent program's `result`; any reader of a tracker command
  (`file`, `answer`, `make_area`, `query`) fed by a writer of the same struct.
- **Still refused after, with no real reader that needs it:** a reader that needs an experiment's
  `run` id (a template literal) or a run's `metrics` (a record), and a reader of the shell's
  `table`. A reader that needs only other fields of those shapes fits, since the rest are extra.

**Ids across packs.** Ids are checked primitives, never brands: no real port uses `Schema.brand`,
and a brand adds no check to the representation, so a branded string compares as a string. Two packs
that each spell the ticket number as `Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))` fit, and
so does `Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))`, since checks
compare in any order. A pack that spells it `Schema.Int.check(Schema.isGreaterThan(0))`, as today's
area number does (`packages/pipeline/src/tickets/area.ts` line 22), gets `cannot_tell`: the two
accept the same integers, but the check compares by id and payload, never by meaning. That is the
price of the sound pick, and the next rule to add once a real pair needs it is a small table of
bounds Effect's ids imply.

**Found outside this amendment's question, not changed here.** As planned, a pipe carries only a
list: the reader's `items` is a list, and the runner sends `items: out.value`. Every pair above
carries one value, a ticket number, a string or an integer, and the checklist's own `done` is a
struct, so none of them could be piped as the plan stood; the check would answer `does_not_fit` at
the top. The owner has since ruled on it, in decision 0553: see "Decision 0553 in this plan" below.

### The added rules

The check reads the reader's node, then the writer's. Every rule keeps the property F1 states: a pipe
that passes never hands the reader a value its input schema refuses.

```ts
// next/packages/libfabrika/src/processes/Fit.ts, a sketch of the added rules, each read at one node.
// 1. A union on the writer: each case it can send must fit. A union on the reader: the writer fits one case.
//    Literal sets are the special case of both. A reader union in Effect's `oneOf` mode is cannot_tell.
// 2. The node's kind is compared before its checks, so a case of the wrong kind is does_not_fit.
// 3. A literal fits the reader's primitive of its type, when that primitive carries no check.
// 4. A reader check fits when the writer carries one with the same id and the same payload, in any
//    order, and only for an id Effect's own revivers know; any other id is cannot_tell.
// 5. A reader node that decodes through a transformation is cannot_tell, at its path.
// 6. A port with no persisted shape (a custom filter) is cannot_tell, at the top.
export const fits: (writer: Shape, reader: Shape) => typeof Fit.Type;
type Shape = { readonly doc: SchemaRepresentation.Document; readonly decodes: Path | null } | null;
```

Why each is sound: Effect decodes a union (its default mode) by trying its cases, and succeeds when
one decodes, so a writer value from any writer case lands on a reader case that takes it. Comparing
the kind first changes only which refusal is given, never a pass. A literal is a value of its
primitive. A check with Effect's id and the same payload is the same predicate on both ends, since
`SchemaRepresentation` revives it from that id to Effect's own code. A transformation's decode can
refuse what its encoded side shows, so the check never vouches for it. A writer's transformation is
fine: its encoded side is what it sends.

**Nullable and optional fields,** through rule 1 and v1's struct rule:

```ts
// Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), as the agent program declares it.
fits(Struct({ input: NullOr(Count) }), Struct({ input: NullOr(Count) }));
// { _tag: "fits" }                                                 the agent's `result` field, both ends
fits(Struct({ input: NullOr(Count) }), Struct({ input: Count }));
// { _tag: "does_not_fit", path: ["input"], need: "Number", has: "Null" }   the writer may send null
fits(Struct({ note: Schema.String }), Struct({ note: Schema.optionalKey(Schema.String) }));
// { _tag: "fits" }                                                 a reader's optional field may be present
fits(Struct({ note: Schema.optionalKey(Schema.String) }), Struct({ note: Schema.String }));
// { _tag: "does_not_fit", path: ["note"], need: "String", has: "optional" }   unchanged from v1
```

**A union of structs told apart by `_tag`,** through rule 1:

```ts
const From = Schema.TaggedUnion({ person: { name: Str }, agent: { lane: Str } });
const FromMore = Schema.TaggedUnion({ person: { name: Str }, agent: { lane: Str }, bot: {} });
fits(From, FromMore);
// { _tag: "fits" }                        every case the writer sends is a case the reader takes
fits(FromMore, From);
// { _tag: "does_not_fit", path: ["_tag"], need: "\"person\" | \"agent\"", has: "\"bot\"" }
```

**A literal into its primitive,** through rule 3:

```ts
fits(Struct({ why: Schema.Literal("out_of_range") }), Struct({ why: Schema.String }));      // fits
fits(Struct({ why: Schema.Literal("out_of_range") }), Struct({ why: Schema.NonEmptyString }));
// { _tag: "cannot_tell", path: ["why"], shape: "check effect/schema/isMinLength" }
```

**A checked id across packs,** through rule 4:

```ts
const TicketNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));          // pack A
fits(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)), TicketNumber);  // fits
fits(Schema.Int.check(Schema.isGreaterThan(0)), TicketNumber);
// { _tag: "cannot_tell", path: [], shape: "check effect/schema/isGreaterThanOrEqualTo" }
```

**A date or another transformation,** through rule 5. A plain `Schema.Date` encodes to a `Date`
object, which is no JSON and which `send_chunks` refuses (`Schema.Json`), so its `Declaration` node
stays `cannot_tell`. A string that decodes to a date shows as `String` on its encoded side, which is
why the loader records where a reader decodes:

```ts
fits(Struct({ at: Schema.String }), Struct({ at: Schema.DateTimeUtcFromString }));
// { _tag: "cannot_tell", path: ["at"], shape: "transformation" }    v1 said fits, and "x" fails the reader
fits(Struct({ at: Schema.DateTimeUtcFromString }), Struct({ at: Schema.String }));
// { _tag: "fits" }                                                 the writer sends a string
fits(Struct({ at: Schema.Finite }), Struct({ at: Schema.Finite }));
// { _tag: "fits" }                                                 a time as Unix ms, as today's ports carry it
```

**What the loader writes,** in `runtime/Program.ts` and `runtime/Execution.ts`:

```ts
// A port's shape: its encoded side, and the first path where the reader decodes through a
// transformation (an AST node with `encoding`), or null when the persisted form cannot be written.
const Shape = Schema.NullOr(Schema.Struct({ doc: Schema.Json, decodes: Schema.NullOr(Path) }));
// inputs[k].items: Schema.optionalKey(Shape)     outputs[k]: Schema.Struct({ shape: Shape })
const shapeOf = (schema: Schema.Top) =>
  Result.try(() => SchemaRepresentation.toJson(SchemaRepresentation.toRepresentation(schema.ast))).pipe(
    Result.map((doc) => ({ doc, decodes: decodesAt(schema.ast) })),
    Result.getOrNull,  // a custom filter: no persisted form, so the check answers cannot tell
  );
```

**What stays refused,** as `cannot_tell`: a record, a tuple or `NonEmptyArray`, a template literal,
recursion, a `Declaration` (a plain date, `Option`), `Enum`, `BigInt`, `Symbol`, a reader union in
`oneOf` mode, a reader transformation, a check whose id is not Effect's own, and a custom filter. The
real ports that hold one are writers whose readers need other fields: `compare`'s `comparison`,
`experiment`'s `page`, `experiments`'s `row` and the shell's `table`. No real reader needs one, so
no real pair loses today. The first reader that needs an experiment's `run` or `metrics` loses, and
the next rule then is that equal records, tuples and template literals fit, with the same soundness
law.

### The added laws

F1 gains the new grammar: its generator adds `NullOr`, tagged and untagged unions of structs, and
literals read as primitives, and its property sends each writer value through JSON text and draws
only values whose encoded form is `Schema.Json`, since a message never carries anything else. F3
loses `NullOr` and the non-literal union from its list, and gains a transformation, a custom filter
and a check id that is not Effect's. Each new law below states the soundness property: for generated
pairs where `fits` answers `fits`, every value Effect Arbitrary makes from the writer's schema,
encoded and sent through JSON text, decodes with the reader's schema.

| Law | Kind (lint, type or test?) | Generator | Plant | Where | Runs |
|---|---|---|---|---|---|
| F6, unions are sound: generated writer and reader pairs built from `NullOr`, `TaggedUnion`, untagged unions of structs and literal sets, where the reader may take more cases; a pass is sound as above; a writer case the reader takes nowhere answers `does_not_fit` at that case's path, and a `oneOf` reader union answers `cannot_tell`. 200 runs | test | fc.letrec: union shape pairs, with a case added to or dropped from either end | (a) pass a writer union when one case fits; (b) compare checks before the kind, so a null case answers `cannot_tell`: F6 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F7, a reader's transformation: a reader field from `DateTimeUtcFromString`, `NumberFromString`, `Trim` or a `decodeTo` whose decode can fail answers `cannot_tell` at its path, while the same schema on the writer compares on its encoded side; a pass is sound as above. 100 runs | test | fc.constantFrom: the four transformations, each at a generated depth in a struct | read only the encoded document, with no `decodes`: a writer `String` into a reader `DateTimeUtcFromString` passes, F7 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F8, checks across packs: Effect's own checks with equal payloads fit in any order; a payload that differs, or an id that is not Effect's (a check annotated with its own id), answers `cannot_tell`, even when both ends are equal; the ticket number spelled two ways fits; a pass is sound as above. 200 runs | test | fc.record: a base primitive, a subset and an order of Effect checks for each end, and an optional foreign id | (a) compare ids without payloads (`isMaxLength` 10 against 256); (b) trust any equal id: F8 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F9, a port with no persisted form: a program whose output or chunk input holds a `Schema.makeFilter` check loads, with that port's shape `null`, and a pipe from or to it answers `cannot_tell` at the top; every other port of the same program keeps its shape | test | scenario: a test writer whose output carries the shell's `Table` shape, and a test reader of it | let `toJson` throw at load: F9 red | next/packages/libfabrika/src/runtime/Program.test.ts | laptop |

F6 to F9 are about values, which no type or lint rule sees: tests.

### The change to the files table and the size

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/processes/Fit.ts | build | 80 | 80 more than in the Files section, 250 in all: unions on both ends, kind before checks, a literal as its primitive, Effect-only check ids, `decodes`, a `null` shape |
| next/packages/libfabrika/src/runtime/Program.ts | build | 20 | 20 more, 90 in all: `shapeOf` with `decodes` and the `null` shape for a custom filter |
| next/packages/libfabrika/src/runtime/Execution.ts | build | 5 | 5 more, 30 in all: `items` and `outputs[k].shape` become `Shape` |
| next/packages/libfabrika/src/processes/Fit.test.ts | tests | tests | F1 to F4, and F6 to F8 |
| next/packages/libfabrika/src/runtime/Program.test.ts | tests | tests | F5 and F9 |

The pull request grows from about 1,100 to about 1,205 product lines (Fit 250, Program 90,
Execution 30). The step count and the estimate in the Size section stay as they are, 65% sure: the
added rules are pure functions beside the ones v1 already has, and the four new laws sit in two test
files the tests step already writes.

## Decision 0553 in this plan, 2026-11-15

This section takes the place of "Amendment A-Value, 2026-11-15". That amendment was the lead's call
that a value that is not a list goes as one whole message. The owner then ruled, in
[0553](https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0553-a-pipe-sends-one-way.md), for one transport that stays out of
programs. The sections above Amendment A-Fits now build 0553 in their own words, so no part of the
plan says what A-Value said.

**What went out with A-Value:**

- The two forms, chunks for a list and one whole message for anything else.
- `Piped.whole`, and `Piped.list` beside it.
- `sent`, the test in `processes/Fit.ts` that picked a form from a shape's top node.
- The rule that both sides must pick the same form.
- The refusal of a list writer by a reader of anything.
- Its laws R2, V1 and V2, and S1's plant "wrap a single value in a list of one".

**What came in, and where it is above:**

- One transport: every value goes as items in chunk messages ("The wrapping, which only the two
  runners see").
- The runner wraps on the way out and unwraps on the way in, by the writer's declared shape ("The
  writer's runner wraps", "The reader's runner unwraps").
- The reader's helper hands the program its declared shape ("What a program declares").
- The brain's record holds both declared shapes ("What the brain records").
- The laws X1, X2, N1, A1, B1, G1 and T2, and R1 moved to the runner's fold ("Laws").

**Where Amendment A-Fits reads differently now.** A-Fits stays as it was written, and it still wins
over the sections above it on the check that a pipe fits. Decision 0553 is newer than both, so for
these words of A-Fits, read the sections above:

- A-Fits's loader block writes `inputs[k].items`. The key is `inputs[k].shape`, and it holds the
  reader's declared shape, list or not.
- Where A-Fits says "chunk input" (its survey, and law F9), read "piped input".
- A-Fits's size sentence starts from the first base of about 1,100 lines. Its 105 added lines
  stand, on the base the Files section has now.
- Its last survey paragraph said a pipe carried only a list. That is no longer so: the pairs it
  lists, a ticket number, a string or an integer, each pipe as declared.

Nothing in `processes/Fit.ts` changes for 0553. The check compares the two declared shapes, and the
wrapping is in neither.

**The size.** A-Value's plan stood at about 1,280 product lines. This one is about 1,345: the
Files section's 1,240 and A-Fits's 105. The 65 lines more are the reader's side of the runner (the
fold, the unwrap and the checkpoint field), less `Piped.whole` and `sent`.

## Current implementation rules, 2026-11-17

These instructions apply to all new laws above, including A-Fits, without changing any domain,
range, run count, assertion or once-only fault. The table's older fast-check names describe the
input domain, not permission for a hand-written runner.

- Use `it.prop` or `it.effect.prop` and Schema inputs through the shared test package (0579).
  Generate members, names, settings, values and shape descriptors from their domain Schemas.
  Build each actual Effect Schema from its generated descriptor, then use Effect Arbitrary
  for that schema's values. A recursive descriptor keeps every constructor listed by F1/F6/X1.
- P4, O1 and R1 keep their state-aware command walks. Their next legal command depends on the
  current model, which a Schema for one command cannot generate. Generate command data from its
  domain Schema and keep each original walk's ranges and count (0411, 0579).
- Fixed pure examples use `vector:` with their reason, not `scenario:`. S1, X2, H1 and the
  scripted real-runner cases retain `scenario:` because they drive those outside resources.
  No example replaces a generated law. Keep all original examples and counts.
- Set the shared seed once in package setup, and compare the first failing generated case when
  moving the older generator shape. No seed or hand `fc.assert` is added to a law.
- Read each selected law and its cleanup before local execution (0594). The older blanket
  statement that these files never signal is not execution clearance. Ordinary safe checks run
  directly; real process signals, launchd and real Electron run on eligible disposable CI.
  Keep real-resource isolation where needed and obtain required proof before first review.
- With other code agents active, use `nice -n 19` and one Vitest worker. The lead owns one global
  compiler and the final changed selection. Narrow any selection that reaches protected laws.
  CI proof follows actual changed paths under 0590; H1 still requires its real workerd result.

The later shell dependency is fabsh v1 under 0586, as corrected above. PRs 1232 and 1254 stay
parked. This library slice still builds no shell or screen and keeps the item-size refusal.
