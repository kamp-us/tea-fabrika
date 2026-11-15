
Plancheck-Version: 3

# Plan: a program can pipe one program's output to another program's input, and the reader gets the writer's whole current value, newest wins, in next/

This is `next/`. It is the first pipe slice of Tier 1's step 4, and the first of three: the pipe in
the library, with no shell. It builds the proposed note
[how a pipe carries output](https://github.com/kamp-us/tea-fabrika/pull/1322) and decisions 0549,
0550 and 0551. A program asks for a pipe with a new built-in Cmd, `pipe`. The brain checks the
member behind it and the fit of the two programs' declared shapes, and records it. The writer's
runner sends its whole output value in chunks each time it changes, newest wins. The reader folds
the chunks into a pending value and swaps it in at the last chunk. The reader watches each life of
the writer with the watch slice's monitor. One pull request, about 1,100 product lines.

```ts
// The whole idea, a sketch. A parent program (here a test program) pipes two programs it then starts.
// tracker and outline are made up (see the list at the end).
pipe({ from: { name: "tracker:1", program: "fabrika/tracker", output: "rows" },
       to: { name: "outline:1", program: "fabrika/outline", input: "rows" } });
// pipe_ok { _tag: "piped", pipe: "process_P/41/0" }   or { _tag: "unfit", fit: { _tag: "does_not_fit", ... } }
startChild({ program: "fabrika/outline", name: "outline:1" });  // the reader first
startChild({ program: "fabrika/tracker", name: "tracker:1" });  // then the writer
// tracker's runner, never tracker's code: its `rows` output changed, so it owes one whole send.
// outline's inbox: { type: "rows", items: [...], part: { id, seq: 0, last: false } } ... { ..., last: true }
// When that life of tracker ends: { type: "DOWN", ref: "process_P/41/0/process_T", name: "tracker:1", reason }
```

## What changes, in one paragraph

A program declares an output as a selector of its model (0260, `Output.make`), and a reader declares
a chunk input and a `DOWN` input with one helper, `Piped.ports`. The loader puts each output's and
each chunk input's shape into the program's declaration, as Effect's own `SchemaRepresentation`
JSON, so the brain can read them without running the code. A new built-in Cmd, `pipe`, goes from
the runner to a new brain-side service, `Pipes`, which checks the member behind the Cmd (0551),
checks the fit on the two declared shapes (0550), and in one ledger turn writes the `piped` row, the
mail right as a relation row (0526) and the Cmd's answer. In the turn that starts or restarts either
end of a live pipe, the brain writes the watch for the reader's live life on the writer's live
life, so a watch binds one life and the pipe follows the registered name. The writer's runner owes
one `send_chunks` of the whole value each time an output with a live pipe changes; a newer value
replaces one not yet started (0549). `exit` waits behind an owed send to a piped name. When the
program that made a pipe stops either end with `stop_child`, the same turn writes `unpiped` and
removes the mail right.

## Starts from

Main, after the watch slice merges ([pull request 1341](https://github.com/kamp-us/tea-fabrika/pull/1341),
branch `fabrikalfa/program-watch`, plan `docs/plan/quests/watch-PLAN.md` there). This plan uses that
slice's trusted `as` argument to `ProcessManager.monitor`, its `Down` with `name`, its `monitored`
row with `name` and `member`, its `Monitor.down` port, and the member pick it moved to
`processes/internal/member.ts`. Nothing here waits on fabsh or tezgah.

## Searched first

Searched on 2026-11-15 in `.decisions/`, `docs/direction/`, `.glossary/TERMS.md`, `experiments/`,
`docs/plan/`, the open pull requests and the branches named above, for "pipe", "fit", "chunk",
"monitor", "output", "DOWN" and "letter" (the old word).

- **The note,** proposed, on `fabrikalfa/pipe-carry`, and its six plumbing calls (the lead's, the
  owner handed them over): chunks fold into a pending value swapped in at the last chunk; a writer
  that crashes mid-send leaves the reader on its previous whole value; one `DOWN` per writer life
  after its last data; a watch binds one life and the pipe points at a registered name; a reader
  that ends makes the shell stop only the writers its line started (not in this slice); built-in
  Cmds first.
- **Decisions this builds:** 0549 (whole value, newest wins), 0550 (fit on needed fields, refused
  before any start), 0551 (the brain checks the member and records the pipe), 0109 (a pipe is saved
  program mail, in chunks, with a cap, and a program can be piped with no shell present), 0260 (an
  output is a model value, `null` is nothing to send), 0170 and 0531 (a check is against the member
  behind the cause, carried down), 0526 (one ReBAC model, relation rows), 0214 (`_tag`), 0209
  (Effect Schema), 0547 (message, never letter), 0546 (quest), 0536 and 0178 (where real-resource
  laws run). 0548 (Ctrl-C stops the whole line) is for the third slice.
- **Built on main:** `send_chunks`, `Chunk.cut`, `Chunk.join`, `Chunk.input`, `Part`, the inbox cap
  `mail.unread` and chunk size `mail.chunk`, `full`, the ack after each checkpoint save, and `behind`,
  which keeps mail to one name in Cmd order (`runtime/Send.ts`, `runtime/Chunk.ts`,
  `runtime/Runner.ts`, `processes/ProgramMailLedger.ts`, from
  [pull request 1310](https://github.com/kamp-us/tea-fabrika/pull/1310)). `start_child` and
  `stop_child` (`runtime/StartChild.ts`), `ChildrenLedger`, `ProcessManager`, the loader's
  `Declaration` (`runtime/Execution.ts`), and `outputs` as bare schemas that nothing reads
  (`runtime/Program.ts`).
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
  note). A child's state is stepped by hand by its parent with the child's own `update`, which is how
  a reader holds the pipe's `current` and `pending` here (`Piped`).
- **Erlang/OTP:** messages between one pair keep their order, and a monitor gives one
  `{'DOWN', Ref, process, Pid, Reason}` after the last message that process sent
  ([Erlang processes reference](https://www.erlang.org/doc/system/ref_man_processes.html), cited in
  the note and the OTP table). A monitor binds a pid and never follows a name.
- **Unix pipes:** a full pipe makes its writer wait; a writer that closes flushes first
  ([pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html), cited in the note).
- **Nushell and PowerShell:** typed values between commands, and a declared input type the shell
  checks ([Nushell pipelines](https://www.nushell.sh/book/pipelines.html), cited in the note).
- **Structural subtyping:** a value with extra fields is a value of the narrower record type, as
  TypeScript's assignability and Effect Schema's `Struct` (which drops extra keys on decode) both
  say. The fit check is that rule, run on the two shapes.

The plain reading: OTP gives the order and the end, Unix the back pressure and the flush, Elm the
typed value and the child stepped by hand, and structural subtyping the fit. Effect gives the schema
form the brain reads.

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
  "no_input",     // the reader declares no such chunk input, or no DOWN input
  "name_taken",   // a name already has a live process: a pipe is made before its ends start (0550)
  "taken",        // that input already has a live pipe: a pipe never fans in (G6)
]);

export const pipe = Cmd.make("pipe", { input: Asked, ok: Piped, err: PipeRefusal.literals });
```

`Asked` is the loose declaration `StartChild.ts` uses, so a malformed Cmd is answered `bad_cmd` by
the host and never fails the step that asked.

### The fit check

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

Both shapes are the encoded side, which is what a message carries. v1 compares, reading the
reader's node first:

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
```

It lives in `processes/` because the brain's `Pipes` calls it in its turn, and `processes` is a
layer every caller above it may import: the runtime, the client and the entry. A future editor calls
`Fit.fits` on the two declarations it already holds. It needs no new line in `layer-rules.json`.

### What a program declares

```ts
// next/packages/libfabrika/src/runtime/Program.ts: an output is a schema and a selector (0260).
export const Output = { make: <S extends Declared>(schema: S, select: (model: never) => S["Type"] | null) => ({ schema, select }) };

// A writer, a sketch: `rows` is its whole current list, null while nothing is loaded.
outputs: { rows: Output.make(Schema.Array(Row), (m: Model) => (m.loaded ? m.rows : null)) },

// next/packages/libfabrika/src/runtime/Execution.ts: what the brain knows without the code gains the shapes.
export const Declaration = Schema.Struct({
  // ...today's keys...
  inputs: Schema.Record(Schema.String, Schema.Struct({
    write: Schema.Boolean,
    personOnly: Schema.Boolean,
    items: Schema.optionalKey(Schema.Json), // a chunk input's list shape, SchemaRepresentation.toJson
  })),
  outputs: Schema.Record(Schema.String, Schema.Struct({ shape: Schema.Json })),
});
```

The loader writes `items` for a write port whose Msg case is a chunk message (`type`, `items`,
`part`), read from that case's `items` field, and `shape` for every output. Both come from
`SchemaRepresentation.toJson(SchemaRepresentation.toRepresentation(ast))`, computed once at load. A
step's answer from the box gains `outputs: Record<string, Schema.Json | null>`, holding only the
outputs whose encoded value changed between the model before and after that step. The box runs the
selector, since on workerd only the box holds the code. tsc checks each selector against its schema
(law T1). Today's one output, the checklist's `done`, becomes `Output.make(Done, finished)`.

### The reader's side: one helper machine, stepped by its parent

```ts
// next/packages/libfabrika/src/runtime/Piped.ts (new): one machine factory (0046), Elm's child.
export const make = <S extends Schema.Top>(item: S) =>
  Machine.make({
    model: Schema.Struct({
      current: Schema.NullOr(Schema.Array(item)),  // the last whole value: the only one a view draws
      pending: Schema.NullOr(Schema.Struct({ id: Schema.NonEmptyString, seq: Schema.Int, items: Schema.Array(item) })),
    }),
    msg: Schema.Union([
      Schema.Struct({ type: Schema.Literal("chunk"), items: Schema.Array(item), part: Part }),
      Schema.Struct({ type: Schema.Literal("down") }),
    ]),
    cmds: [],
    init: (loaded) => [loaded ?? { current: null, pending: null }, []],
    update: {
      chunk: (m, msg) => {
        const { id, seq, last } = msg.part;
        // seq 0 starts a new value and drops any other; seq n adds only to n - 1 of the same id.
        const held = seq === 0 ? [] : m.pending?.id === id && m.pending.seq === seq - 1 ? m.pending.items : null;
        if (held === null) return [{ ...m, pending: null }, []];        // a cut or stray chunk: keep current
        const items = [...held, ...msg.items];
        return last ? [{ current: items, pending: null }, []] : [{ ...m, pending: { id, seq, items } }, []];
      },
      // The writer's life ended: a value still arriving is dropped, and the last whole one stays.
      down: (m) => [{ ...m, pending: null }, []],
    },
  });

/** The two inputs a reader declares for one pipe: the chunk input and the DOWN input. */
export const ports: <const T extends string, S extends Schema.Top>(type: T, item: S, description: string) => Ports<T, S>;
```

A reader's own `update` calls `Rows.update(m.rows, {type: "chunk", ...msg})` on its chunk input and
`Rows.update(m.rows, {type: "down"})` on a `DOWN` whose `name` is its writer, and its view reads
`m.rows.current`. Nothing in a reader looks at a partial value.


### What the brain records

```ts
// next/packages/libfabrika/src/processes/Pipes.ts (new, contract only, 0095).
export const PipeEvent = Schema.TaggedUnion({
  piped: {
    pipe: Text,                                   // the pipe Cmd's id
    from: Schema.Struct({ name: ProcessName, program: ProgramName, output: Text, hash: Hash, shape: Hash }),
    to: Schema.Struct({ name: ProcessName, program: ProgramName, input: Text, hash: Hash, shape: Hash }),
    rule: Schema.Literal(RULE),                   // the fit rule that judged it
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
  readonly outOf: (name: string) => Effect.Effect<ReadonlyArray<Live>, PipesError>;   // a writer's live pipes
}>()("@kampus/libfabrika/processes/Pipes") {}
// Ask = { id, from: Writer & { hash, shape: Json }, to: Reader & { hash, shape: Json }, requester }
// The runner fills `hash` and `shape` from the loader, as it fills a start's hash today; a program never does.
```

`hash` is each program's code hash, and `shape` is the SHA-256 of the port's shape JSON. Each row is
a ledger line, so it also keeps `by` (the brain's key), `sentAt` on the writer's clock, `arrivedAt` on
the ledger's, `parent` (the step whose message caused the Cmd, which leads to the member's own
message and its clock) and `traceId`. In the same turn, the mail right goes on the relation stream,
and `unpiped` removes it:

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
   such chunk input or no `DOWN` input.
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


### The writer's runner

```ts
// next/packages/libfabrika/src/runtime/Runner.ts, a sketch. Host Cmds gain PIPE.
const HOST = new Set([SEND, SEND_CHUNKS, START_CHILD, STOP_CHILD, EXIT, HANDS, MONITOR, DEMONITOR, PIPE]);

/** After a step: each changed output with a live pipe owes one whole send to that pipe's reader. */
const owe = (cmds: ReadonlyArray<Dispatched>, out: Out): ReadonlyArray<Dispatched> => [
  // Newest wins (0549): an owed send to this pipe that has not saved its seq 0 yet is dropped.
  ...cmds.filter((c) => !(c.out?.pipe === out.pipe && !started(c))),
  dispatched({ id: `${process.id}/${out.pos}/out/${out.output}`, cmd: { type: SEND_CHUNKS, to: out.to, as: out.input, items: out.value },
    out: { pipe: out.pipe } }),
];
```

- The runner reads its live pipes, as a writer, from `Pipes.outOf` at load, and again after a
  `piped` or `unpiped` row names it. A value of `null` owes nothing (0260).
- A send has started once its seq 0 message is saved. A started send always finishes, so the reader
  never gets two values mixed. `behind` already keeps sends to one name in order.
- A life's first load sends each piped output that is not `null`, so a restarted writer's first
  whole value reaches the reader. A wake of the same life sends nothing new.
- `exit` waits behind an owed send to a name with a live pipe, as a Unix `close` flushes. `kill` and
  supervision's stops do not wait.
- `pipe` loads both programs by name, as `startChild` loads one today, answers `no_program` itself,
  and hands `Pipes.pipe` the hashes and shapes.

## One value traced: `tracker` piped to `outline` by a parent program

A parent program, `lab:1` (life `process_P`), has a member `M` behind its input: a person's message
at its inbox pos 41 asks it to pipe and start two programs. This is the no-shell case 0109 names,
and the shape the law S1 runs with two test programs. tracker has 1,200 rows of about 180 bytes,
about 216 KB.

1. `lab:1`'s step at pos 41 returns `pipe({from: {name: "tracker:1", program: "fabrika/tracker",
   output: "rows"}, to: {name: "outline:1", program: "fabrika/outline", input: "rows"}})`, Cmd
   `process_P/41/0`.
2. The runner loads both programs, finds `rows` in tracker's outputs and in outline's chunk inputs,
   and calls `Pipes.pipe` with both hashes and shapes.
3. `PipesLedger`: the names are process names, no pipe is saved under the id, `process_P` is live,
   `M` is the sender of pos 41 and `PipePrograms` passes, both ports exist, neither name is live,
   outline's `rows` has no pipe, and `fits` answers `fits` (outline needs `id` and `title`; tracker
   also has `state`). One turn writes:
   - `pipes`: `piped {pipe: "process_P/41/0", from: {..., hash: "9c1e…", shape: "47aa…"}, to: {...,
     hash: "d03b…", shape: "e1f0…"}, rule: "fit/v1", requester: {name: "lab:1", process:
     "process_P"}, member: M}`, with `parent` = `lab:1`'s step at pos 41;
   - `permissions/relations`: `related {subject: "name:tracker:1", relation: "pipes_to", object:
     "name:outline:1"}`;
   - `lab:1/inbox` pos 42: `process_P/41/0/answer`, `pipe_ok {_tag: "piped", pipe: "process_P/41/0"}`.
4. `lab:1` folds pos 42 and returns `start_child` for `outline:1`. `ChildrenLedger` writes
   `registered`, `started {process: "process_O", name: "outline:1", member: M}` and the first
   message. The pipe's writer has no life, so that turn writes no watch.
5. On `start_child_ok`, `lab:1` starts `tracker:1`. In the turn that writes `started {process:
   "process_T"}`, the reader is live, so the brain also writes `monitored {ref:
   "process_P/41/0/process_T", process: "process_T", to: process_O, name: "tracker:1", member: M}`.
6. tracker's runner: life `process_T`'s first load, and `rows` is not `null`, so it owes
   `send_chunks({to: "outline:1", as: "rows", items})` as `process_T/0/out/rows`. The cut gives four
   messages under 64 KiB. Each passes the mail check through the `pipes_to` row and is saved at
   `outline:1/inbox` pos 2 to 5.
7. outline folds pos 2, 3 and 4 into `pending`, saving and acking each; its view still draws
   `current`, `null`. At pos 5, `last`, `current` becomes all 1,200 rows.
8. A ticket changes three times while outline is busy and its inbox is full: tracker's steps at its
   pos 9, 10 and 11 each owe a send. The one from pos 9 had not saved its seq 0 when pos 10's came,
   so it is dropped, and pos 10's is dropped by pos 11's. outline later swaps in pos 11's value whole.
9. tracker crashes between seq 1 and seq 3 of a later send. Its `exited {crashed}` turn writes the
   one `DOWN` for `process_T` into outline's inbox after the saved seq 1. outline drops `pending` and
   keeps its previous `current`. Supervision restarts `tracker:1` as `process_T2`; that turn writes
   the watch `process_P/41/0/process_T2`, and the new life's first load sends its whole value from
   seq 0.
10. `lab:1` stops `outline:1` with `stop_child`. That turn exits it with `shutdown`, writes `unpiped
    {pipe: "process_P/41/0", reason: "stopped"}`, the `unrelated` row and `demonitored canceled`.
    tracker's runner reads the `unpiped` row and owes nothing more to `outline:1`.

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
| The reader's fold | a child's model stepped by its parent's `update` | a `receive` loop that keeps state | we take Elm's: `Piped` is a child machine the reader steps by hand |
| The order and the end | none: no processes | per-pair order, one `DOWN` after the last message | we take OTP's; a watch is written for each life by the brain, since OTP's monitor never follows a name and the pipe must |
| Back pressure | none | none: an unbounded mailbox | we leave both for Unix: a capped inbox and a writer that waits (0109) |
| The fit | the compiler checks a port's type | none: messages are untyped | a structural check on declared shapes, since two packs are built apart |

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
- **What they saw:** each program's code hash and the hash of each port's shape, so a later reader
  knows exactly which two shapes the fit judged.
- **Which rule judged it:** `rule: "fit/v1"`. The rule will grow (unions, refinements); an old pipe
  must still say which rule let it through.
- **The cause:** `parent`, the step whose message caused the Cmd, which leads to the member's own
  message and its clock. `sentAt` and `arrivedAt` on every row.
- **Why a pipe was refused:** the `unfit` answer message, saved in the requester's inbox, keeps the
  verdict and its path.

What can wait, since it rebuilds from the log: how many values newest wins dropped (a dispatched send
with no seq 0 saved), how long a writer waited on `full`, a pipe's throughput.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where | Runs |
|---|---|---|---|---|---|
| S1, the whole pipe with no shell: a parent test program pipes a writer and a reader test program and starts the reader, then the writer; the writer's value changes three times while the reader's inbox is full, and the reader ends on the newest whole value; the writer crashes mid-send and the reader keeps its previous whole value; supervision restarts the writer, and the reader gets the new life's first whole value and exactly one `DOWN` per life; a pipe that does not fit and a pipe the member may not make are each refused, with nothing on the pipe or relation streams and no start | test | scenario: two test programs and a parent, the five moves in order | (a) send every value, not the newest; (b) swap in at the first chunk; (c) watch only the first writer life; (d) write the `piped` row before the fit check: S1 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests (0536) |
| F1, a fit is sound: for generated writer and reader shapes from v1's grammar where `fits` answers `fits`, every value Effect Arbitrary makes from the writer schema, encoded, decodes with the reader schema. 200 runs | test | fc.letrec: v1 shape pairs, structs, lists, literals, literal sets, primitives, optional fields | (a) let an extra reader field through as fine; (b) treat a literal set as fitting a smaller set: F1 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F2, a missing need: removing any one required field the reader needs from a fitting writer answers `does_not_fit` with that field's path and `has: "missing"`; making it optional answers `has: "optional"`. 200 runs | test | fc.letrec: v1 shape pairs and a field to drop | (a) skip nested structs; (b) report the parent's path: F2 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F3, what v1 cannot tell: each reader shape outside v1 (`Declaration`, `Suspend`, tuple, `Record`, `NullOr`, a non-literal union, `TemplateLiteral`, `Enum`, a custom filter) answers `cannot_tell` at its path, even when the writer's shape is the same | test | scenario: one pair per shape, the plan's six examples | answer `fits` for two equal shapes: F3 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F4, checks: a reader check the writer does not carry, same id and payload, answers `cannot_tell`; a writer with more checks than the reader fits. 100 runs | test | fc.constantFrom: isInt, isMinLength, isMaxLength, isPattern, isGreaterThanOrEqualTo | ignore checks: F4 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F5, the declared shapes: a loaded program's `outputs[k].shape` and a chunk input's `items` equal `toJson(toRepresentation(...))` of the port's encoded schema and survive `fromJson`; a write port that is not a chunk message has no `items` | test | scenario: a writer and a reader test program, and the checklist | read the type side, not the encoded side: F5 red on a `Schema.NumberFromString` field | next/packages/libfabrika/src/runtime/Program.test.ts | laptop |
| P1, a pipe is recorded: for generated members, programs and names that pass, `pipe` answers `piped` with its Cmd id and writes in one turn exactly one `piped` row with every fact (both hashes and shape hashes, `rule`, requester, member), one `related pipes_to` row and the answer message. 100 runs | test | fc.record: member, writer and reader programs, names | (a) drop `member` or `rule` from the row; (b) write the relation row in a second turn: P1 red | next/packages/libfabrika/src/processes/PipesTest.ts, run by next/packages/libfabrika/src/node/Pipes.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| P2, the refusal order: a generated ask that fails more than one check gets the first of `bad_name`, `stale_sender`, `forbidden`, `no_output`, `no_input`, `name_taken`, `taken`, then `unfit`, and each writes nothing but its answer message. 100 runs | test | fc.record: bad name, stale requester, denied or missing member, missing ports, live name, piped input, unfit shapes | check the fit before the member: P2 red | next/packages/libfabrika/src/processes/PipesTest.ts, run by next/packages/libfabrika/src/node/Pipes.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| P3, a retry is one pipe: the same Cmd id asked again any number of times gives one `piped` row, one relation row and the same pipe id. 100 runs | test | fc.integer: retries 1 to 5 | mint a new id per try: P3 red | next/packages/libfabrika/src/processes/PipesTest.ts, run by next/packages/libfabrika/src/node/Pipes.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| P4, the mail right and the end: the writer's name may mail the reader's name only while the pipe is live; before `piped`, after the requester's `stop_child` of either end, and from reader to writer, a send is `forbidden`; a `stop_child` by any other process writes no `unpiped`. 100 runs | test | fc.commands: pipe, send, reverse send, stop either end, stop by another | (a) keep the right after `unpiped`; (b) grant both ways; (c) end the pipe on a crash: P4 red | next/packages/libfabrika/src/processes/ProgramMailTest.ts, run by next/packages/libfabrika/src/node/Pipes.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| W1, one DOWN per writer life: for a generated run of writer starts, crashes, restarts and chunked sends, the reader folds exactly one `DOWN` per writer life, with ref `<pipe>/<process>`, that life's reason and the writer's name, after that life's last saved chunk; a life that crashes in the turn after its start gives `crashed`, never `noproc`. 100 runs | test | Effect Arbitrary: ExitReason | (a) write the watch in a turn after `started`; (b) reuse the pipe id as the ref: W1 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| W2, a reader restart: a new reader life gets a watch on the writer's live life in its restart turn, and gets the next `DOWN` | test | scenario: crash the reader once, then the writer | write the watch only on writer starts: W2 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| O1, newest wins: for a generated run of writer model changes against a slow reader with a small cap, each `current` the reader swaps in equals one whole writer value, the swapped values keep the writer's order, and the last one is the writer's last value. 100 runs | test | fc.commands: change, read, ack | (a) append a newer value to an owed one; (b) drop a send that already saved seq 0: O1 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| O2, a life's first value: a life whose output is not `null` at its first load sends it once; a wake of the same life sends nothing; a restart sends again from seq 0; a `null` value sends nothing | test | scenario: start, sleep and wake, crash and restart, a null output | send on every load: O2 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| O3, exit flushes: a writer that exits with an owed send to a piped name gets its last value to the reader before its `DOWN normal`; one that is killed mid-send leaves the reader on its previous whole value | test | scenario: exit behind a full inbox, kill mid-send | let `exit` pass an owed send: O3 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| R1, the reader's swap: for generated streams of chunks (whole sends, cut sends, interleaved ids, repeats, a `down` anywhere), `current` is always `null` or one whole sent value, and `pending` is dropped on `down` and on a new seq 0. 500 runs | test | fc.commands: chunk of a send, cut, stray chunk, down | (a) fold a chunk whose seq skips one; (b) keep `pending` on `down`: R1 red | next/packages/libfabrika/src/runtime/Piped.test.ts | laptop |
| T1, the shapes: `pipe`'s input is only `{from, to}` with those keys, an output's selector must return its schema's type or `null`, and `ProcessCalls.monitor` still takes no `as` | type | type | add `requester` to `PipeInput`, or return a number from a list output's selector: tsc red | next/packages/libfabrika/src/runtime/Pipe.types.test.ts | laptop |
| H1, across objects: S1's first three moves on the real Worker runtime, with the writer and the reader in two Process objects: the reader swaps in the whole value, the writer crashes once, and the reader gets one `DOWN` and the restarted writer's value. Host-only (workerd): CI's scheduled full run only, before the first review, never on the owner's Mac | test | scenario: the two test programs and the parent on one local instance on workerd | route `programPipe` to the object's own manager: no `piped` row, H1 red | next/apps/fabrika/src/worker-pipe.integration.test.ts | CI's full run only |

**Lint, type or test?** S1, F1 to F5, P1 to P4, W1, W2, O1 to O3, R1 and H1 are about values, ledger
rows and their order, which no type or lint rule sees: tests. T1 is a shape: type. No law is lint:
the operands and the trusted arguments are held by types, and no new rule on the shape of code is
needed.

**Where they run.** S1 is the pull request's whole vehicle, end to end, with no shell. It and the
other suites run through `node/*.integration.test.ts` on node:sqlite in a temp folder, so under
[0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md) a pull request
leaves them to the schedule; the tests and build steps run those paths narrowly on the laptop, since
they need no real machine, signal or socket. F1 to F5, R1 and T1 are plain tests and type checks that
run on the laptop and in every CI run. H1 is the only host-only law (workerd): CI's full run only,
before the first review. Nothing here kills a real process or touches launchd, so nothing waits on
the owner's Mac under 0178.

## Is this a setting?

Each new choice was asked (0069):

- **The fit rules,** "newest wins", one pipe per input, and a pipe ending at its requester's
  `stop_child`: no. Each is what a pipe is, decided in 0549 and 0550 or by the note's plumbing.
- **The fit rule version** is a constant, `RULE`, recorded on each row, never a knob.
- **The chunk size and the inbox cap** already are settings, `mail.chunk` and `mail.unread`.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/processes/Fit.ts | build | 170 | new: `fits`, `Fit`, `Unfit`, `RULE`, the v1 rules |
| next/packages/libfabrika/src/processes/Pipes.ts | build | 90 | new: the `Pipes` contract, `PipeEvent`, `PipesError` |
| next/packages/libfabrika/src/processes/PipesLedger.ts | build | 200 | new: the checks in order, the one turn that writes, `outOf` |
| next/packages/libfabrika/src/processes/internal/pipeTable.ts | build | 70 | new: the pipe stream's fold, read in a turn |
| next/packages/libfabrika/src/processes/ProcessManager.ts | build | 45 | the pipe's watches in the start and restart turns |
| next/packages/libfabrika/src/processes/ChildrenLedger.ts | build | 20 | `unpiped` in the requester's `stop_child` turn |
| next/packages/libfabrika/src/processes/ProgramMailLedger.ts | build | 20 | a send passes on a live `pipes_to` row |
| next/packages/libfabrika/src/permissions/Model.ts | build | 30 | the `name` type, `pipes_to`, `mail`, `pipe` and `PipePrograms` |
| next/packages/libfabrika/src/runtime/Pipe.ts | build | 60 | new: `pipe`, its operands and answers |
| next/packages/libfabrika/src/runtime/Piped.ts | build | 80 | new: the reader's helper machine factory and its two ports |
| next/packages/libfabrika/src/runtime/Program.ts | build | 70 | `Output.make`, shapes at load, changed outputs per step |
| next/packages/libfabrika/src/runtime/Execution.ts | build | 25 | `Declaration` gains `items` and `outputs`; a step's answer gains `outputs` |
| next/packages/libfabrika/src/runtime/Entry.ts | build | 15 | the in-process loader fills the shapes |
| next/packages/libfabrika/src/runtime/Runner.ts | build | 140 | the `pipe` performer, owed output sends, a life's first value, `exit` waits |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 40 | `programPipe` and `programPipesOut`, the remote `Pipes`, `PipesLedger` in the Project |
| next/packages/libfabrika/src/cloudflare/bindings.ts | build | 5 | the two calls' types |
| next/packages/libfabrika/src/cloudflare/platform.ts | build | 6 | the two calls' Promise edges, each one marked line |
| next/apps/fabrika/src/brain.ts | build | 8 | the Project class forwards the two calls |
| next/packages/libfabrika/src/index.ts | build | 4 | exports `Fit`, `Pipe`, `Piped`, `Pipes` |
| next/programs/checklist/src/program.ts | build | 3 | `done` becomes `Output.make(Done, finished)` |
| next/packages/libfabrika/src/processes/Fit.test.ts | tests | tests | F1 to F4 |
| next/packages/libfabrika/src/runtime/Program.test.ts | tests | tests | F5 |
| next/packages/libfabrika/src/processes/PipesTest.ts | tests | tests | P1 to P3 |
| next/packages/libfabrika/src/processes/ProgramMailTest.ts | tests | tests | P4 |
| next/packages/libfabrika/src/node/Pipes.integration.test.ts | tests | tests | runs `PipesTest` and P4 on node:sqlite |
| next/packages/libfabrika/src/runtime/PipeTest.ts | tests | tests | S1, W1, W2, O1 to O3, with a parent, a writer and a reader test program |
| next/packages/libfabrika/src/node/Pipe.integration.test.ts | tests | tests | runs `PipeTest` on node:sqlite |
| next/packages/libfabrika/src/runtime/Piped.test.ts | tests | tests | R1 |
| next/packages/libfabrika/src/runtime/Pipe.types.test.ts | tests | tests | T1 |
| next/apps/fabrika/src/worker-pipe.integration.test.ts | tests | tests | H1, CI's full run only |
| next/packages/libfabrika/src/processes/ProcessMonitors.integration.test.ts | tests | tests | the watch slice's laws stay green with the optional `answer` |
| next/packages/libfabrika/src/node/StartChild.integration.test.ts | tests | tests | no change: must stay green with the new `stop_child` turn |
| layer-rules.json | tests | tests | no change expected: every new file sits in a module that has a row |
| .glossary/TERMS.md | build | docs | rows `pipe (Cmd)`, `piped`, `fit`; `pipe` gains the fit rule's name |
| docs/direction/follows/otp.md | build | docs | a row for a watch per life under a name, where we leave OTP's monitor |

## Calls taken

Each is mine to decide by the open questions test: it picks how the code does what a note or a
decision already says.

- **The fit reads Effect's `SchemaRepresentation`,** not JSON Schema. It is Effect's own persisted
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
- **The fit lives in `processes/`,** a layer the runtime, the client and the entry may all import, so
  it needs no new line in `layer-rules.json`.
- **Typed services only.** The runner reaches `Pipes` as a service; nothing calls a command-line tool
  (0231).
- **A browser is always a client.** Every piece is JSON messages, Cmds and the Project's RPC.
- **Not in this slice, each named:** a reader that ends by itself (the note's fifth plumbing call;
  telling a final end from a restart needs the name's `down` state, which no watcher gets today, so
  it is a ticket for the lead); how a small program with no window shows on screen in a line, and
  how a step is turned off so data skips it (both with the owner as a design talk); two brains
  talking (0551); a pipe across lines; editing a pipe after the line runs.

## What comes after, not planned here

The order the decisions give. Each is its own plan, written when what it waits on lands. Nothing
below is decided by this plan.

1. **This plan:** the pipe in the library.
2. **Second: fabsh pipes its own built-ins,** with the last one's output printed in fabsh.
   [0159](../../../.decisions/0159-fabsh-pipes-summon-join-first.md) says pipes work first for
   fabsh's built-ins, and that plan follows it as written. It waits on this plan and on fabsh's pull
   requests [1232](https://github.com/kamp-us/tea-fabrika/pull/1232) and
   [1312](https://github.com/kamp-us/tea-fabrika/pull/1312), which are with the owner for his look.
   Following 0159 as written settles the question this plan's first draft asked about whether
   built-ins come first.
3. **Third: programs with tiles in one line.** The job's scope and a `stop_job` Cmd, Ctrl-C from any
   tile stopping the whole job reader first (0548), one mark per line in tezgah (0477, 0478), and the
   six pipe hues as design tokens, written by the tests step since the design package's tokens are an
   exam path. It waits on the second slice, on 1232 and 1312, and on fabsh's slice 2b, which puts a
   program fabsh starts in a tile. A question for that plan: which reader program with a window comes
   first. It is a new screen, so it is the owner's.

## Validation

- tests step: `nice -n 15 pnpm exec vitest run --maxWorkers=3` on
  `next/packages/libfabrika/src/processes/Fit.test.ts`, `next/packages/libfabrika/src/runtime/Piped.test.ts`,
  `next/packages/libfabrika/src/runtime/Program.test.ts`, `next/packages/libfabrika/src/node/Pipes.integration.test.ts`
  and `next/packages/libfabrika/src/node/Pipe.integration.test.ts` shows each law red on main.
- build step: the same paths green, and
  `next/packages/libfabrika/src/processes/ProcessMonitors.integration.test.ts` and
  `next/packages/libfabrika/src/node/StartChild.integration.test.ts` still green.
- The lead runs `--changed origin/main` and one `pnpm typecheck`; H1 runs only in CI's full run.

## Size

1. **One pull request, the pipe in the library:** about 1,100 lines (PipesLedger 200, Fit 170,
   Runner 140, Pipes 90, Piped 80, pipeTable 70, Program 70, the Project calls 60, Pipe 60,
   ProcessManager 45, the rest under 30 each), plus its suites. It lands whole: S1 runs the whole
   vehicle with no shell, as 0109 says a program can be piped.

About 5 agent hours across the steps, 65% sure. The doubt is the runner: owed output sends, newest
wins and the first value of a life sit in the hardest part of `Runner.ts`, beside `behind`, and W1's
same-turn watch touches `ProcessManager`'s start and restart turns. Budget basis: the watch slice's
plan (`docs/plan/quests/watch-PLAN.md` on its branch), 540 lines at 6 steps and $40, and ticket
1041's (`docs/plan/quests/t1041-PLAN.md`), a runner host Cmd at 6 steps and $43. This is about twice
the watch slice, so one more likely send-back.

Estimate: 7 steps, $70

## Records

- `field/runs/` rows for each step, by the lead.
- Glossary rows in this pull request: `pipe (Cmd)`, `piped`, `fit`; `pipe` gains the fit rule's name.
- `docs/direction/follows/otp.md`: a watch per life under a name, where we leave OTP's monitor.
- No `.decisions/` file: every call here applies a decided note or decision. The note stays proposed.

## What this cannot tell us

- How often a real pair of packs ends as `cannot_tell`. v1 refuses every general union, so a field
  such as `note: NullOr(String)` in a reader's need is refused. The first real pairs show whether
  unions are the next rule to add.
- What newest wins skips in a real line, and whether anyone misses it.
- What a big value costs a reader that holds `current` and `pending` at once while it arrives.
- Whether one watch per life holds when a writer restarts fast many times in a row. W1 runs it in
  the laptop's suite; nothing has run it on a Durable Object under load.
- Whether the ack after each save keeps up with 64 KiB messages on workerd. H1 runs one value, not a
  load.
- How any of it reads to a person. Nothing here draws.

Made up, for the examples: the programs `tracker`, `outline`, `board` and `lab` in `next/`, their
`rows` output and input, `Row`, the `column` field, the process IDs `process_P`, `process_O`,
`process_T` and `process_T2`, and the hashes. Real: `send_chunks`, `Chunk.input`, `Part`, `full`,
`mail.unread`, `mail.chunk`, `start_child`, `stop_child`, `exit`, `DOWN`, `monitored`,
`SchemaRepresentation`, `fabrika/checklist`.

## Open questions

None.

Every call here builds a decided note or decision, or picks how the code does it. The
first draft's two questions belong to the later plans named in "What comes after, not planned
here".

## Findings

```json
{"_tag": "finding", "id": "2026-11-15-pipe-hues-only-in-todays-app-css", "date": "2026-11-15", "by": "plan", "model": "claude-opus-5-5", "rule": "duplicate", "location": {"path": "apps/fabrika/src/window/window.css", "line": 333}, "says": "In today's version, the six pipe hues of 0478 are literal light-dark() values in the app's window.css and not tokens of the shared design package (0456), so next/'s tuval can only copy them; once the third pipe slice adds them as tokens, today's CSS keeps a second copy.", "proof": "apps/fabrika/src/window/window.css line 333 opens [data-pipe=\"sky\"] with literal values, and the other five hues follow; the design package's color tokens folder holds no pipe token, and rg -i pipe packages/fabrika-design finds only a comment in tile-edge.toml (2026-11-15).", "cost": "Two copies of one hue table drift apart the first time one version's colors change.", "head": "0e36734b7539657f64bc0466b36517bb66291b8b", "ticket": null, "pr": null}
```
