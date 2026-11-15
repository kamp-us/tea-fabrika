
Plancheck-Version: 3

# Plan: a person types `a | b` in fabsh, and each program's output value reaches the next program's input, in next/

This is `next/`. It builds the first pipe slice of Tier 1's step 4, on the proposed note
[how a pipe carries output](https://github.com/kamp-us/tea-fabrika/pull/1322) and the decisions
0548, 0549, 0550 and 0551. A line of two or more programs joined by `|` becomes one job. fabsh asks
the brain for each pipe first, then starts each reader before its writer. The writer's runner sends
its whole output value in chunks each time it changes, newest wins. The reader folds the chunks
into a pending value and swaps it in at the last chunk. The reader watches the writer with the watch
slice's monitor, one `DOWN` per life. Ctrl-C in any tile of the line stops the whole job. Two pull
requests, about 1,240 and 560 product lines.

```ts
// The whole idea, a sketch in a program's own terms. tracker and outline are made up (see the list at the end).
// fabsh$ tracker | outline                            fabsh's job 3: one pipe, two starts
pipe({ job: 3, from: { name: "tracker:1", program: "fabrika/tracker", output: "rows" },
               to: { name: "outline:1", program: "fabrika/outline", input: "rows" } });
// pipe_ok { _tag: "piped", pipe: "process_F/41/0" }   or { _tag: "unfit", fit: { _tag: "does_not_fit", ... } }
startChild({ program: "fabrika/outline", name: "outline:1", job: 3 });  // the reader first
startChild({ program: "fabrika/tracker", name: "tracker:1", job: 3 });  // then the writer
// tracker's runner, never tracker's code: its `rows` output changed, so it owes one whole send.
// outline's inbox: { type: "rows", items: [...], part: { id, seq: 0, last: false } } ... { ..., last: true }
// When that life of tracker ends: { type: "DOWN", ref: "process_F/41/0/process_T", name: "tracker:1", reason }
// Ctrl-C in any tile of the line: fabsh returns stopJob({ job: 3 }), and the reader stops first.
```

## What changes, in one paragraph

A program declares an output as a selector of its model (0260, `Output.make`), and a reader declares
a chunk input and a `DOWN` input with one helper, `Piped.ports`. The loader puts each output's and
each chunk input's shape into the program's declaration, as Effect's own `SchemaRepresentation`
JSON, so the brain can read them without running the code. A new built-in Cmd, `pipe`, goes from
the runner to a new brain-side service, `Pipes`, which checks the member behind the line (0551),
checks the fit on the two declared shapes (0550), and in one ledger turn writes the `piped` row, the
mail right as a relation row (0526) and the Cmd's answer. `start_child` takes an optional `job`, and
the `started` row keeps it. In the turn that starts or restarts either end of a live pipe, the brain
writes the watch for the reader's live life on the writer's live life, so a watch binds one life and
the pipe follows the registered name. The writer's runner owes one `send_chunks` of the whole value
each time an output with a live pipe changes; a newer value replaces one not yet started (0549).
`exit` waits behind an owed send to a piped name. A new built-in Cmd, `stop_job`, closes a job: one
Effect `Scope` per close, one guarded stop finalizer per process the job started, closed so the
reader stops first (0548). fabsh reads `|`, makes the job and shows a refused line's reason. tezgah
gives every tile of one job the same mark, and Ctrl-C in any of them reaches fabsh.

## Starts from

- **Pull request 1** starts from main after the watch slice merges
  ([pull request 1341](https://github.com/kamp-us/tea-fabrika/pull/1341), branch
  `fabrikalfa/program-watch`, plan `docs/plan/lanes/watch-PLAN.md` there). It uses that slice's
  trusted `as` argument to `ProcessManager.monitor`, its `Down` with `name`, its `monitored` row with
  `name` and `member`, its `Monitor.down` port, and the member pick it moved to
  `processes/internal/member.ts`.
- **Pull request 2** starts from main after pull request 1, after fabsh's first pull request
  ([pull request 1232](https://github.com/kamp-us/tea-fabrika/pull/1232)), after tezgah's
  `tezgah.new` ([pull request 1312](https://github.com/kamp-us/tea-fabrika/pull/1312)), and after
  fabsh's slice 2b, which mails tezgah a `show` message so a program fabsh starts shows in a tile
  (fabsh's plan, `docs/plan/lanes/fabsh-PLAN.md` on `fabrikalfa/cloud-fabsh`, "Slice 2b waits for the
  desk lane's tile pieces"). Every program in a line has a tile (0491, the glossary's `line`), and
  slice 2b is what puts it there. This plan adds only the job and the mark to that `show` message.

## Searched first

Searched on 2026-11-15 in `.decisions/`, `docs/direction/`, `.glossary/TERMS.md`, `experiments/`,
`docs/plan/`, the open pull requests and the branches named above, for "pipe", "job", "fit",
"chunk", "monitor", "Ctrl-C", "interrupt", "output", "mark", "wash" and "letter" (the old word).

- **The note,** proposed, on `fabrikalfa/pipe-carry`, and its six plumbing calls (the lead's, the
  owner handed them over): chunks fold into a pending value swapped in at the last chunk; a writer
  that crashes mid-send leaves the reader on its previous whole value; one `DOWN` per writer life
  after its last data; a watch binds one life and the pipe points at a registered name; a reader
  that ends makes fabsh stop only the writers its line started; built-in Cmds first.
- **Decisions this builds:** 0548 (Ctrl-C stops the whole line, reader first), 0549 (whole value,
  newest wins), 0550 (fit on needed fields, refused before any start), 0551 (the brain checks the
  member and records the pipe), 0109 (a pipe is saved program mail, in chunks, with a cap), 0260
  (an output is a model value, `null` is nothing to send), 0170 and 0531 (a start is checked against
  its member and carries it down), 0526 (one ReBAC model, relation rows), 0214 (`_tag`), 0209
  (Effect Schema), 0547 (message, never letter), 0545 (job keeps its one meaning), 0546 (quest),
  0061 (resources in a scope), 0491 (a line's programs show in tiles), 0477 and 0478 (a pipe's wash
  and letter, six hues counted per workspace), 0536 and 0178 (where real-resource laws run).
- **Built on main:** `send_chunks`, `Chunk.cut`, `Chunk.join`, `Chunk.input`, `Part`, the inbox cap
  `mail.unread` and chunk size `mail.chunk`, `full`, the ack after each checkpoint save, and `behind`,
  which keeps mail to one name in Cmd order (`runtime/Send.ts`, `runtime/Chunk.ts`,
  `runtime/Runner.ts`, `processes/ProgramMailLedger.ts`, from
  [pull request 1310](https://github.com/kamp-us/tea-fabrika/pull/1310)). `start_child` and
  `stop_child` (`runtime/StartChild.ts`), `ChildrenLedger`, `ProcessManager`, the loader's
  `Declaration` (`runtime/Execution.ts`), and `outputs` as bare schemas that nothing reads
  (`runtime/Program.ts`).
- **What tezgah has today for a line's mark:** nothing. `Workspace.Tile` is `{id, n, shows,
  program, child, keep, cursor}` (`tezgah/Workspace.ts`), and tuval's title bar draws a fixed dot in
  its `tile-mark` slot (`next/packages/tuval/src/window/Layout.tsx`). Today's version gives each line
  the first free letter in its workspace and one of six hues in a fixed order
  (`apps/fabrika/src/desk/desk.ts`, `freeLetter`, and `[data-pipe]` in
  `apps/fabrika/src/window/window.css`). The six hues are not in the shared design package yet.
- **What fabsh reads today,** on its branch: `program [as name]` and four built-ins, no `|`
  (`next/programs/fabsh/src/read.ts`). Its roles are `verb`, `keyword`, `name-new`, `word` and
  `unknown`.
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
  the note and the OTP table). A supervisor stops its children in reverse start order
  ([supervisor docs](https://www.erlang.org/doc/apps/stdlib/supervisor.html), not fetched for this
  plan, from memory: a guess until read). Effect's `Scope` does the same: it runs its finalizers
  last in, first out (`node_modules/effect/dist/Scope.d.ts`, read).
- **POSIX job control:** the terminal's interrupt goes to every process in the foreground process
  group, so Ctrl-C ends the whole job (cited in 0548).
- **Unix pipes:** a full pipe makes its writer wait; a writer that closes flushes first
  ([pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html), cited in the note).
- **Nushell and PowerShell:** typed values between commands, and a declared input type the shell
  checks ([Nushell pipelines](https://www.nushell.sh/book/pipelines.html), cited in the note).
- **Structural subtyping:** a value with extra fields is a value of the narrower record type, as
  TypeScript's assignability and Effect Schema's `Struct` (which drops extra keys on decode) both
  say. The fit check is that rule, run on the two shapes.

The plain reading: OTP gives the order and the end, Unix the back pressure and the flush, Elm the
typed value and the child stepped by hand, POSIX the job, and structural subtyping the fit. Effect
gives both the schema form the brain reads and the scope a job closes with.

## The shape

### The pipe Cmd and its answers

```ts
// next/packages/libfabrika/src/runtime/Pipe.ts (new). The runner performs both Cmds itself.
import { Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Unfit } from "../processes/Fit.ts";

/** One end of a pipe, as the line names it: the registered name fabsh will start it under, its
 *  program, and the port. Nothing runs yet when the brain checks it. */
const Writer = Schema.Struct({ name: Schema.String, program: Schema.String, output: Schema.NonEmptyString });
const Reader = Schema.Struct({ name: Schema.String, program: Schema.String, input: Schema.NonEmptyString });

/** pipe's operands: the job the line is (fabsh's own count, as a shell's %3), and its two ends. */
export const PipeInput = Schema.Struct({ job: Schema.Int.check(Schema.isGreaterThan(0)), from: Writer, to: Reader });

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
  "forbidden",    // the member behind the line may not pipe these two programs, or there is no member
  "no_output",    // the writer declares no such output
  "no_input",     // the reader declares no such chunk input, or no DOWN input
  "name_taken",   // a name already has a live process: every process of a job is the line's own
  "taken",        // that input already has a live pipe: a pipe never fans in (G6)
]);

export const pipe = Cmd.make("pipe", { input: Asked, ok: Piped, err: PipeRefusal.literals });

/** stop_job's operands: a job this life made. The runner binds the requester. */
export const StopJobInput = Schema.Struct({ job: Schema.Int });
export const stopJob = Cmd.make("stop_job", { input: AskedJob, ok: Schema.Null, err: ["no_job"] });
```

`Asked` and `AskedJob` are the loose declarations `StartChild.ts` uses, so a malformed Cmd is
answered `bad_cmd` by the host and never fails the step that asked. `start_child`'s operands gain
`job: Schema.optionalKey(Schema.Int)`, and nothing else in `StartChild.ts` changes.

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
const Job = Schema.Struct({ by: ProcessName, n: Schema.Int });  // the requester's registered name and its count

export const PipeEvent = Schema.TaggedUnion({
  piped: {
    pipe: Text,                                   // the pipe Cmd's id
    job: Job,
    from: Schema.Struct({ name: ProcessName, program: ProgramName, output: Text, hash: Hash, shape: Hash }),
    to: Schema.Struct({ name: ProcessName, program: ProgramName, input: Text, hash: Hash, shape: Hash }),
    rule: Schema.Literal(RULE),                   // the fit rule that judged it
    requester: Schema.Struct({ name: ProcessName, process: ProcessId }),
    member: Sender,                               // the member behind the line, checked (0170, 0551)
  },
  unpiped: { pipe: Text, reason: Schema.Literals(["stopped"]) },
});

export class PipesError extends Schema.TaggedError<PipesError>()("PipesError", {
  reason: Schema.Literals([...PipeRefusal.literals, "storage"]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class Pipes extends Context.Service<Pipes, {
  readonly pipe: (ask: Ask, from: From) => Effect.Effect<typeof Piped.Type, PipesError>;
}>()("@kampus/libfabrika/processes/Pipes") {}
// Ask = { id, job, from: Writer & { hash, shape: Json }, to: Reader & { hash, shape: Json }, requester }
// The runner fills `hash` and `shape` from the loader, as it fills a start's hash today; a program never does.
```

`hash` is each program's code hash, and `shape` is the SHA-256 of the port's shape JSON. Each row is
a ledger line, so it also keeps `by` (the brain's key), `sentAt` on the writer's clock, `arrivedAt` on
the ledger's, `parent` (the fabsh step whose message held the line, which leads to the person's own
`submitted` message and its clock) and `traceId`. In the same turn, the mail right goes on the
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
   `forbidden`: 0551 checks the member behind the line, and a pipe has no related-pair exception.
5. `no_output`, then `no_input`: the writer's declaration has no such output, or the reader's has no
   such chunk input or no `DOWN` input.
6. `name_taken`: either name has a live process.
7. `taken`: the reader's name and input already have a live pipe.
8. `Fit.fits` on the two shapes. Anything but `fits` answers `unfit` with the verdict and writes
   nothing on the pipe stream.
9. In one turn: `piped` on `pipes`, the `related` row, the answer message `<cmd id>/answer` in the
   requester's inbox, and, if both names already have live lives, the reader's watch.

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
// next/packages/libfabrika/src/runtime/Runner.ts, a sketch. Host Cmds gain PIPE and STOP_JOB.
const HOST = new Set([SEND, SEND_CHUNKS, START_CHILD, STOP_CHILD, EXIT, HANDS, MONITOR, DEMONITOR, PIPE, STOP_JOB]);

/** After a step: each changed output with a live pipe owes one whole send to that pipe's reader. */
const owe = (cmds: ReadonlyArray<Dispatched>, out: Out): ReadonlyArray<Dispatched> => [
  // Newest wins (0549): an owed send to this pipe that has not saved its seq 0 yet is dropped.
  ...cmds.filter((c) => !(c.out?.pipe === out.pipe && !started(c))),
  dispatched({ id: `${process.id}/${out.pos}/out/${out.output}`, cmd: { type: SEND_CHUNKS, to: out.to, as: out.input, items: out.value },
    out: { pipe: out.pipe } }),
];
```

- The runner reads its live pipes, as a writer, from `Pipes` at load, and again after a `piped` or
  `unpiped` row names it. A value of `null` owes nothing (0260).
- A send has started once its seq 0 message is saved. A started send always finishes, so the reader
  never gets two values mixed. `behind` already keeps sends to one name in order.
- A life's first load sends each piped output that is not `null`, so a restarted writer's first
  whole value reaches the reader. A wake of the same life sends nothing new.
- `exit` waits behind an owed send to a name with a live pipe, as a Unix `close` flushes. `kill` and
  supervision's stops do not wait.
- `pipe` loads both programs by name, as `startChild` loads one today, answers `no_program` itself,
  and hands `Pipes.pipe` the hashes and shapes.
- `stop_job` calls `Children.stopJob({job, requester})`.

### The job and its stop

```ts
// next/packages/libfabrika/src/processes/ChildrenLedger.ts, a sketch of stopJob.
const stopJob = Effect.fn("children.stop_job")(function* (ask: { job: number; requester: Requester }, from: From) {
  const job = yield* jobOf(ask);                       // the `started` rows with this job, by this requester's name
  if (job.lives.length === 0) return yield* refuse("no_job");
  // Effect closes a scope last in, first out. The line started right to left (each reader before its
  // writer), so adding the stops from the line's left end makes the close stop the rightmost reader
  // first (0548). A stop that fails does not skip the rest: Scope runs every finalizer.
  const scope = yield* Scope.make("sequential");
  yield* Scope.addFinalizer(scope, unpipeAll(job, from));                 // added first, so it runs last
  for (const life of [...job.lives].reverse()) yield* Scope.addFinalizer(scope, stopIfLive(life, from));
  yield* Scope.close(scope, Exit.void);                                   // the reader, the writer, then unpipe
});
```

`job.lives` is in start order, reader first, so adding them reversed makes the close stop them in
start order. The law J1 plants both wrong orders. Each `stopIfLive` is guarded: it stops only a life whose `started` row carries this job and this
requester's name, and that is still live, with `shutdown`, in `ProcessManager.exit`'s own turn, as
`stop_child` does. A start that answered `already_present` never joined the job. A `stop_job` that
storage fails stays dispatched, and its retry stops only what is still live.

### fabsh

```ts
// next/programs/fabsh/src/read.ts: the grammar gains `|`.
//   line   blank | builtin | job
//   job    start ('|' start)*           a start is today's: program ['as' name]
// `|` reads as `keyword`; a built-in inside a job is refused `builtin` on its span.
export type Job = { readonly starts: NonEmptyReadonlyArray<Start> }; // left to right; names numbered per program

// next/programs/fabsh/src/program.ts: a job's control state, a private helper machine in the file (0046).
const JobState = Schema.TaggedUnion({
  checking: { n: Schema.Int, line: Line, starts: Schema.Array(StartShape), piped: Schema.Int },   // pipes asked, left to right
  starting: { n: Schema.Int, line: Line, starts: Schema.Array(StartShape), next: Schema.Int },    // starts, right to left
  running: { n: Schema.Int, line: Line, names: Schema.Array(Schema.String) },
  stopping: { n: Schema.Int, line: Line },
  stopped: { n: Schema.Int, line: Line },
  refused: { n: Schema.Int, line: Line, start: Schema.Int, end: Schema.Int, reason: Schema.String },
  failed: { n: Schema.Int, line: Line, reason: Schema.String },
});
```

- `submitted` with a job line: a new job `n` (one more than the last), `checking`, and one `pipe` for
  its first pair. Each `pipe_ok` `piped` asks the next pair's; the last one moves to `starting` and
  returns the rightmost program's `start_child` with `job: n`. Each `start_child_ok` starts the next
  one to its left. The last one moves to `running` and mails tezgah one `show` per process, as slice
  2b does, with `job: n`.
- `pipe_ok` `unfit` or `pipe_err`: `refused`, its span on the reader's word (for `unfit`) or the
  writer's, its words from the answer: "outline needs rows[].column, and tracker's rows has none".
  Pipes already made for an earlier pair of that line close with `stop_job`, which writes their
  `unpiped`; nothing was started.
- A `start_child_err`, or `already_present`: `failed`, and `stop_job` stops what the line started.
- `interrupt {job}` from tezgah: `stopping`, and one `stop_job`. `stop_job_ok` is `stopped`.
- Default names follow today's `<last part>:1`; a program named twice in one line takes `:2` for its
  second place, and so on, so a line never asks one name twice.

### tezgah and the window

```ts
// next/packages/libfabrika/src/tezgah/Workspace.ts: a tile of a job carries the job's one mark.
export const PipeHue = Schema.Literals(["sky", "pink", "teal", "violet", "lime", "plum"]);  // 0478's order
export const Mark = Schema.Struct({ job: Schema.Int, letter: Schema.String.check(Schema.isPattern(/^[A-Z]$/)), hue: PipeHue });
export const Tile = Schema.Struct({ /* today's keys */ mark: Schema.NullOr(Mark) });   // v3 of the saved model: null for every v2 tile

// next/programs/tezgah/src/program.ts
// show {.., job}: the first show of a job in a workspace takes the first letter no job there holds,
// and the hue at the count of jobs that workspace marked, mod 6 (0478); every later show of that job
// copies the mark. A show with no job is a tile with no mark, as today.
// did tezgah.interrupt {from}: a tile with a mark sends its job's fabsh { type: "interrupt", job }.
```

The window: Ctrl-C in a tile with a mark sends `did tezgah.interrupt`, never the tile's program, as
POSIX sends the interrupt to the foreground job's process group. Ctrl-C in a tile with no mark is
the program's, as today. tuval's title bar draws the mark's letter in the `tile-mark` slot where it
draws the dot today, and the title wash and focus edge in the mark's hue (0477). The six hues come
from the shared design package (0456), as new tokens.

## One value traced: `tracker | outline`, then Ctrl-C

The person, member `M`, types in the fabsh tile `t2`, whose process is `fabsh:t2` (life `process_F`).
tracker has 1,200 rows of about 180 bytes, about 216 KB.

1. `fabsh:t2/inbox` pos 41: `{type: "submitted", line: "tracker | outline"}`, sent by `M`.
2. fabsh reads two starts, `tracker:1` and `outline:1`. Job 3 is `checking`. It returns `pipe({job: 3,
   from: {name: "tracker:1", program: "fabrika/tracker", output: "rows"}, to: {name: "outline:1",
   program: "fabrika/outline", input: "rows"}})`, Cmd `process_F/41/0`.
3. The runner loads both programs, finds `rows` in tracker's outputs and in outline's chunk inputs,
   and calls `Pipes.pipe` with both hashes and shapes.
4. `PipesLedger`: the names are process names, no pipe is saved under the id, `process_F` is live,
   `M` is the sender of pos 41 and `PipePrograms` passes, both ports exist, neither name is live,
   outline's `rows` has no pipe, and `fits` answers `fits` (outline needs `id` and `title`; tracker
   also has `state`). One turn writes:
   - `pipes`: `piped {pipe: "process_F/41/0", job: {by: "fabsh:t2", n: 3}, from: {..., hash: "9c1e…",
     shape: "47aa…"}, to: {..., hash: "d03b…", shape: "e1f0…"}, rule: "fit/v1", requester: {name:
     "fabsh:t2", process: "process_F"}, member: M}`, with `parent` = fabsh's step at pos 41;
   - `permissions/relations`: `related {subject: "name:tracker:1", relation: "pipes_to", object:
     "name:outline:1"}`;
   - `fabsh:t2/inbox` pos 42: `process_F/41/0/answer`, `pipe_ok {_tag: "piped", pipe:
     "process_F/41/0"}`.
5. fabsh folds pos 42: job 3 is `starting`, and it returns `start_child({program: "fabrika/outline",
   name: "outline:1", job: 3})`, Cmd `process_F/42/0`.
6. `ChildrenLedger` checks `StartProgram` for `M` and writes `registered`, `started {process:
   "process_O", name: "outline:1", job: {by: "fabsh:t2", n: 3}, member: M}` and the first message.
   In that turn the pipe's writer has no life, so no watch is written.
7. pos 43, `start_child_ok`: fabsh returns `start_child` for `tracker:1`, job 3, Cmd `process_F/43/0`.
8. `started {process: "process_T", name: "tracker:1", job: {...}}`. In the same turn, the pipe's
   reader `outline:1` is live, so the brain writes `monitored {ref: "process_F/41/0/process_T",
   process: "process_T", to: process_O, name: "tracker:1", member: M}`.
9. pos 44: job 3 is `running`. fabsh mails tezgah two `show` messages with `job: 3`. tezgah's
   workspace has no job marked yet, so both tiles get `{job: 3, letter: "A", hue: "sky"}`.
10. tracker's runner: life `process_T`'s first load, and `rows` is not `null`, so it owes
    `send_chunks({to: "outline:1", as: "rows", items})` as `process_T/0/out/rows`. The cut gives four
    messages under 64 KiB. Each passes the mail check through the `pipes_to` row and is saved at
    `outline:1/inbox` pos 2 to 5 (pos 1 is the start's first message).
11. outline folds pos 2, 3 and 4 into `pending` (seq 0 to 2), saving and acking each; its view still
    draws `current`, `null`, as its empty state. At pos 5, `last`, `current` becomes all 1,200 rows.
12. A ticket changes: tracker's step at its pos 9 changes `rows`, and the runner owes
    `process_T/9/out/rows`. outline is busy, the inbox is full at 256, and that send waits before its
    seq 0. Another change at pos 10 owes `process_T/10/out/rows`, which drops the one from pos 9
    (newest wins). outline later swaps in the pos 10 value whole.
13. The person presses Ctrl-C in outline's tile. The window sends tezgah `did tezgah.interrupt
    {from: <outline's tile>}`, and tezgah mails `fabsh:t2` `{type: "interrupt", job: 3}` at pos 51.
14. fabsh returns `stop_job({job: 3})`. `stopJob` finds `process_O` and `process_T`, started in that
    order. It adds the unpipe finalizer, then `tracker:1`'s stop, then `outline:1`'s, and closes:
    `outline:1` exits `shutdown` first (its watch on `process_T` ends with it, `watcher_exited`), then
    `tracker:1` exits `shutdown`, then `unpiped {pipe: "process_F/41/0", reason: "stopped"}` and the
    `unrelated` row. fabsh folds `stop_job_ok`: job 3 is `stopped`. Each tile stays and says its word
    (the tile guideline), as slice 2b shows it.

Had tracker crashed between seq 1 and seq 3, its `exited {crashed}` turn would have written the one
`DOWN` for `process_T` into outline's inbox after the saved seq 1. outline drops `pending` and keeps
its previous `current`. Supervision restarts `tracker:1` as `process_T2`; that turn writes the watch
`process_F/41/0/process_T2`, and the new life's first load sends its whole value from seq 0.

## One refused line: `tracker | board`

1. pos 61: `{type: "submitted", line: "tracker | board"}`. Job 4, `checking`, Cmd `process_F/61/0`.
2. `PipesLedger` passes steps 1 to 7, and `fits` answers `{_tag: "does_not_fit", path: ["[]",
   "column"], need: "String", has: "missing"}`: board's row needs `column`, and tracker's has none.
3. One turn writes only `fabsh:t2/inbox` pos 62, `pipe_ok {_tag: "unfit", fit: {...}}`. Nothing goes
   on the pipe stream or the relation stream, and no start is asked.
4. fabsh folds pos 62: job 4 is `refused`, its span on `board`, and the scrollback says "board needs
   rows[].column, and tracker's rows has none." No process starts and no tile opens (0550).

## Elm and OTP, piece by piece

| Piece | Elm's answer | OTP's answer | Where we leave them |
|---|---|---|---|
| The output | a port: a whole typed value out, as a Cmd | a message sent to a pid | an output is model state picked by a selector (0260), and the runner, never the program, sends it |
| The reader's fold | a child's model stepped by its parent's `update` | a `receive` loop that keeps state | we take Elm's: `Piped` is a child machine the reader steps by hand |
| The order and the end | none: no processes | per-pair order, one `DOWN` after the last message | we take OTP's; a watch is written for each life by the brain, since OTP's monitor never follows a name and the pipe must |
| Back pressure | none | none: an unbounded mailbox | we leave both for Unix: a capped inbox and a writer that waits (0109) |
| The fit | the compiler checks a port's type | none: messages are untyped | a structural check on declared shapes, since two packs are built apart |
| The job | none | a supervisor stops its children in reverse start order | we take POSIX's job and 0548's reader first, closed with an Effect `Scope` whose finalizers are added so last-in first-out stops the reader first |
| The mark | none | none | today's version's lesson (0477, 0478), rethought onto tezgah's tile |

## Every line that ends, stops or signals a process

- **`stop_job`.** Guard: only lives whose `started` row carries this job and this requester's
  registered name, and only while live; the requester's life must be live. Order: the line's right
  end first. A failed stop skips nothing, and a retry stops only what is still live.
- **`unpiped stopped`,** inside `stop_job`, after every stop. Guard: only pipes whose `job` is this
  job and that are still live. It removes the `pipes_to` row and the pipe's live watches with
  `demonitored canceled`.
- **fabsh's rollback,** a `stop_job` after a refused pipe or a failed start in the same line. Guard:
  the same as `stop_job`.
- **The pipe's watch** writes the `DOWN` a writer life gives. Guard: written only when both ends have
  live lives, with a ref that names the writer life, so it fires once for that life.
- **`exit` waits** behind an owed send to a piped name. Guard: only sends with a live pipe; `kill`
  and supervision do not wait.
- **tezgah's interrupt forward.** Guard: only a tile with a mark, only to the fabsh that made that
  job; fabsh refuses `no_job` for a job it does not hold or that is already `stopped`.
- **Ctrl-C in a tile with no mark** is unchanged: the tile's program gets it.
- **Not touched:** a process the line did not start, a tile tezgah closes (tezgah stops only its own
  child), and fabsh's own process, whose children keep running if it ends, as the note's table says.

## What fact is lost today

Nothing pipes yet, so nothing is lost yet. These exist only at the moment of the pipe or the start,
and go in now, even with nothing reading them:

- **Who made the pipe:** the member checked, and the requester's name and life.
- **What they saw:** each program's code hash and the hash of each port's shape, so a later reader
  knows exactly which two shapes the fit judged.
- **Which rule judged it:** `rule: "fit/v1"`. The rule will grow (unions, refinements); an old pipe
  must still say which rule let it through.
- **The cause:** `parent`, the fabsh step whose message held the line, which leads to the person's own
  `submitted` message, its text and its clock. `sentAt` and `arrivedAt` on every row.
- **Which line started a process:** `job` on the `started` row. Without it, a later reader cannot tell
  a line's process from one started alone, which is what 0548 rests on.
- **Why a pipe was refused:** the `unfit` answer message, saved in fabsh's inbox, keeps the verdict
  and its path.

What can wait, since it rebuilds from the log: how many values newest wins dropped (a dispatched send
with no seq 0 saved), how long a writer waited on `full`, a pipe's throughput, a job's length.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where | Runs |
|---|---|---|---|---|---|
| F1, a fit is sound: for generated writer and reader shapes from v1's grammar where `fits` answers `fits`, every value Effect Arbitrary makes from the writer schema, encoded, decodes with the reader schema. 200 runs | test | fc.letrec: v1 shape pairs, structs, lists, literals, literal sets, primitives, optional fields | (a) let an extra reader field through as fine; (b) treat a literal set as fitting a smaller set: F1 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F2, a missing need: removing any one required field the reader needs from a fitting writer answers `does_not_fit` with that field's path and `has: "missing"`; making it optional answers `has: "optional"`. 200 runs | test | fc.letrec: v1 shape pairs and a field to drop | (a) skip nested structs; (b) report the parent's path: F2 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F3, what v1 cannot tell: each reader shape outside v1 (`Declaration`, `Suspend`, tuple, `Record`, `NullOr`, a non-literal union, `TemplateLiteral`, `Enum`, a custom filter) answers `cannot_tell` at its path, even when the writer's shape is the same | test | scenario: one pair per shape, the note's six examples | answer `fits` for two equal shapes: F3 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F4, checks: a reader check the writer does not carry, same id and payload, answers `cannot_tell`; a writer with more checks than the reader fits. 100 runs | test | fc.constantFrom: isInt, isMinLength, isMaxLength, isPattern, isGreaterThanOrEqualTo | ignore checks: F4 red | next/packages/libfabrika/src/processes/Fit.test.ts | laptop |
| F5, the declared shapes: a loaded program's `outputs[k].shape` and a chunk input's `items` equal `toJson(toRepresentation(...))` of the port's encoded schema and survive `fromJson`; a write port that is not a chunk message has no `items` | test | scenario: a writer and a reader test program, and the checklist | read the type side, not the encoded side: F5 red on a `Schema.NumberFromString` field | next/packages/libfabrika/src/runtime/Program.test.ts | laptop |
| P1, a pipe is recorded: for generated members, programs and names that pass, `pipe` answers `piped` with its Cmd id and writes in one turn exactly one `piped` row with every fact (job, both hashes and shape hashes, `rule`, requester, member), one `related pipes_to` row and the answer message. 100 runs | test | fc.record: member, writer and reader programs, names, job | (a) drop `member` or `rule` from the row; (b) write the relation row in a second turn: P1 red | next/packages/libfabrika/src/processes/PipesTest.ts, run by next/packages/libfabrika/src/node/Pipes.integration.test.ts | laptop, narrow path; the schedule on pull requests (0536) |
| P2, the refusal order: a generated ask that fails more than one check gets the first of `bad_name`, `stale_sender`, `forbidden`, `no_output`, `no_input`, `name_taken`, `taken`, then `unfit`, and each writes nothing but its answer message. 100 runs | test | fc.record: bad name, stale requester, denied or missing member, missing ports, live name, piped input, unfit shapes | check the fit before the member: P2 red | next/packages/libfabrika/src/processes/PipesTest.ts, run by next/packages/libfabrika/src/node/Pipes.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| P3, a retry is one pipe: the same Cmd id asked again any number of times gives one `piped` row, one relation row and the same pipe id. 100 runs | test | fc.integer: retries 1 to 5 | mint a new id per try: P3 red | next/packages/libfabrika/src/processes/PipesTest.ts, run by next/packages/libfabrika/src/node/Pipes.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| P4, the mail right: the writer's name may mail the reader's name only while the pipe is live; before `piped`, after `unpiped`, and from reader to writer, a send is `forbidden`. 100 runs | test | fc.commands: pipe, send, reverse send, stop job | (a) keep the right after `unpiped`; (b) grant both ways: P4 red | next/packages/libfabrika/src/processes/ProgramMailTest.ts, run by next/packages/libfabrika/src/node/Pipes.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| W1, one DOWN per writer life: for a generated run of writer starts, crashes, restarts and chunked sends, the reader folds exactly one `DOWN` per writer life, with ref `<pipe>/<process>`, that life's reason and the writer's name, after that life's last saved chunk; a life that crashes in the turn after its start gives `crashed`, never `noproc`. 100 runs | test | Effect Arbitrary: ExitReason | (a) write the watch in a turn after `started`; (b) reuse the pipe id as the ref: W1 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| W2, a reader restart: a new reader life gets a watch on the writer's live life in its restart turn, and gets the next `DOWN` | test | scenario: crash the reader once, then the writer | write the watch only on writer starts: W2 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| O1, newest wins: for a generated run of writer model changes against a slow reader with a small cap, each `current` the reader swaps in equals one whole writer value, the swapped values keep the writer's order, and the last one is the writer's last value. 100 runs | test | fc.commands: change, read, ack | (a) append a newer value to an owed one; (b) drop a send that already saved seq 0: O1 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| O2, a life's first value: a life whose output is not `null` at its first load sends it once; a wake of the same life sends nothing; a restart sends again from seq 0; a `null` value sends nothing | test | scenario: start, sleep and wake, crash and restart, a null output | send on every load: O2 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| O3, exit flushes: a writer that exits with an owed send to a piped name gets its last value to the reader before its `DOWN normal`; one that is killed mid-send leaves the reader on its previous whole value | test | scenario: exit behind a full inbox, kill mid-send | let `exit` pass an owed send: O3 red | next/packages/libfabrika/src/runtime/PipeTest.ts, run by next/packages/libfabrika/src/node/Pipe.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| R1, the reader's swap: for generated streams of chunks (whole sends, cut sends, interleaved ids, repeats, a `down` anywhere), `current` is always `null` or one whole sent value, and `pending` is dropped on `down` and on a new seq 0. 500 runs | test | fc.commands: chunk of a send, cut, stray chunk, down | (a) fold a chunk whose seq skips one; (b) keep `pending` on `down`: R1 red | next/packages/libfabrika/src/runtime/Piped.test.ts | laptop |
| J1, a job stops whole: for a generated line of 2 to 4 programs, `stop_job` stops every process the job started, rightmost first, then writes `unpiped stopped` for each of its pipes; a process the line did not start, a process of another job and an ended one are untouched; a retry stops nothing twice. 100 runs | test | fc.integer: line length 2 to 4, and fc.boolean: one name already present | (a) add the stops in start order, so the writer stops first; (b) add the unpipe last, so it runs first; (c) stop by name, not by job: J1 red | next/packages/libfabrika/src/processes/ChildrenTest.ts, run by next/packages/libfabrika/src/node/StartChild.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| J2, one failed stop skips nothing: with a storage failure planted on one stop, every other process of the job is stopped, the Cmd stays dispatched, and its retry finishes the rest | test | scenario: fail the middle stop of three once | stop in a plain loop that ends at the first failure: J2 red | next/packages/libfabrika/src/processes/ChildrenTest.ts, run by next/packages/libfabrika/src/node/StartChild.integration.test.ts | laptop, narrow path; the schedule on pull requests |
| T1, the shapes: `pipe`'s input is only `{job, from, to}` with those keys, `stop_job`'s only `{job}`, an output's selector must return its schema's type or `null`, and `ProcessCalls.monitor` still takes no `as` | type | type | add `requester` to `PipeInput`, or return a number from a list output's selector: tsc red | next/packages/libfabrika/src/runtime/Pipe.types.test.ts | laptop |
| H1, across objects: on the real Worker runtime, a test program pipes a writer to a reader in two Process objects, the reader swaps in the whole value, the writer crashes once and the reader gets one `DOWN` and the restarted writer's value. Host-only (workerd): CI's scheduled full run only, before the first review, never on the owner's Mac | test | scenario: two test programs on one local instance on workerd | route `programPipe` to the object's own manager: no `piped` row, H1 red | next/apps/fabrika/src/worker-pipe.integration.test.ts | CI's full run only |
| S1, the line: `read` gives the pipe sign the `keyword` role, numbers a program named twice `:1`, `:2` by place, refuses a built-in inside a job with `builtin` on its span, and refuses a line that ends at the pipe sign only as "expects a verb". 200 runs | test | fc.array: segments of program words, `as` names, built-ins and pipes | (a) let `help` piped into `outline` read; (b) give both copies `:1`: S1 red | next/programs/fabsh/src/read.laws.test.ts | laptop |
| S2, the job's order: for generated lines and generated answers, fabsh asks every pipe left to right before any start, starts right to left, each after the one before answered, and on any refusal or failure starts nothing more and closes the job with `stop_job`. 200 runs | test | fc.commands: piped, unfit, a refusal, start ok, start err, already present | (a) start the writer first; (b) start before the last pipe answers: S2 red | next/programs/fabsh/src/program.laws.test.ts | laptop |
| S3, a refused line in words: each `unfit` and each refusal becomes one `refused` entry with its span on the right word and its words built from the answer, and no `start_child` | test | scenario: the refused example and one line per refusal | put the span on the writer for `unfit`: S3 red | next/programs/fabsh/src/program.laws.test.ts | laptop |
| S4, the mark: every tile of one job in a workspace carries one mark, a new job takes the first letter no job there holds and the next hue in 0478's order, mod 6; a show with no job has no mark; a v2 saved model climbs with `mark: null`. 200 runs | test | fc.commands: show with job, show without job, close | (a) count hues across workspaces; (b) give each tile its own letter: S4 red | next/programs/tezgah/src/program.laws.test.ts | laptop |
| S5, the interrupt: Ctrl-C in a marked tile reaches the job's fabsh as `interrupt {job}` and never the tile's program; in an unmarked tile it reaches the program; fabsh refuses `no_job` for a job it does not hold | test | scenario: marked and unmarked tiles, a stale job | forward Ctrl-C from every tile: S5 red | next/programs/tezgah/src/program.laws.test.ts | laptop |
| E1, the whole line on screen: in the real built app and in a browser tab, a person types the line `checklist`, pipe, `outline` (or the pair the first open question picks), both tiles open with mark A, a change in the writer's tile shows in the reader's, and Ctrl-C in the reader's tile stops both. Shots at the five layouts | test | scenario: one line, driven through the real window | send the interrupt to the tile's program: E1 red | next/apps/fabrika/src/pipe-line.visual.test.ts | the laptop, through `apps/fabrika/test-window.ts`; not CI |

**Lint, type or test?** F1 to F5, P1 to P4, W1, W2, O1 to O3, R1, J1, J2 and S1 to S5 are about
values, ledger rows and their order, which no type or lint rule sees: tests. T1 is a shape: type. E1
and H1 need the real window and the real Worker runtime: tests. No law is lint: the operands and the
trusted arguments are held by types, and no new rule on the shape of code is needed.

**Where they run.** The suites run through `node/*.integration.test.ts` on node:sqlite in a temp
folder, so under [0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md) a
pull request leaves them to the schedule; the tests and build steps run those paths narrowly on the
laptop, since they need no real machine, signal or socket. H1 is host-only (workerd): it runs in
CI's full run only, before the first review. E1 drives the real Electron app through
`apps/fabrika/test-window.ts` on the laptop, with its own `FABRIKA_HOME`, before the first review of
pull request 2; it kills nothing and touches no launchd, so it needs no owner yes under 0178, and the
lead reads its shots.

## Is this a setting?

Each new choice was asked (0069):

- **The fit rules,** "newest wins", one pipe per input, the job's stop order and the reader-first
  close: no. Each is what a pipe or a job is, decided in 0548 to 0550 or by the note's plumbing.
- **The fit rule version** is a constant, `RULE`, recorded on each row, never a knob.
- **The mark's letters and hues:** no. 0478 fixes the hues and their order.
- **Ctrl-C as the interrupt key:** no, for this slice. 0548 names Ctrl-C, and tezgah's key rows
  already say which keys are a person's to change; in today's version Ctrl-C in a tile cannot be bound either.
- **The chunk size and the inbox cap** already are settings, `mail.chunk` and `mail.unread`.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/processes/Fit.ts | build | 170 | new: `fits`, `Fit`, `Unfit`, `RULE`, the v1 rules |
| next/packages/libfabrika/src/processes/Pipes.ts | build | 90 | new: the `Pipes` contract, `PipeEvent`, `PipesError` |
| next/packages/libfabrika/src/processes/PipesLedger.ts | build | 200 | new: the checks in order, the one turn that writes |
| next/packages/libfabrika/src/processes/internal/pipeTable.ts | build | 70 | new: the pipe stream's fold, read in a turn |
| next/packages/libfabrika/src/processes/ProcessManager.ts | build | 45 | the pipe's watches in the start and restart turns |
| next/packages/libfabrika/src/processes/Process.ts | build | 8 | `job` on a start and on `started` |
| next/packages/libfabrika/src/processes/internal/processTable.ts | build | 6 | `started` keeps `job` |
| next/packages/libfabrika/src/processes/Children.ts | build | 20 | `stopJob` in the contract, `no_job` |
| next/packages/libfabrika/src/processes/ChildrenLedger.ts | build | 75 | `job` on the start, `stopJob` with its scope |
| next/packages/libfabrika/src/processes/ProgramMailLedger.ts | build | 20 | a send passes on a live `pipes_to` row |
| next/packages/libfabrika/src/permissions/Model.ts | build | 30 | the `name` type, `pipes_to`, `mail`, `pipe` and `PipePrograms` |
| next/packages/libfabrika/src/runtime/Pipe.ts | build | 90 | new: `pipe` and `stop_job`, their operands and answers |
| next/packages/libfabrika/src/runtime/Piped.ts | build | 80 | new: the reader's helper machine factory and its two ports |
| next/packages/libfabrika/src/runtime/Program.ts | build | 70 | `Output.make`, shapes at load, changed outputs per step |
| next/packages/libfabrika/src/runtime/Execution.ts | build | 25 | `Declaration` gains `items` and `outputs`; a step's answer gains `outputs` |
| next/packages/libfabrika/src/runtime/Entry.ts | build | 15 | the in-process loader fills the shapes |
| next/packages/libfabrika/src/runtime/StartChild.ts | build | 4 | `job` on `start_child` |
| next/packages/libfabrika/src/runtime/Runner.ts | build | 150 | `pipe` and `stop_job` performers, owed output sends, a life's first value, `exit` waits |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 45 | `programPipe` and `programStopJob`, the remote `Pipes`, `PipesLedger` in the Project |
| next/packages/libfabrika/src/cloudflare/bindings.ts | build | 6 | the two calls' types |
| next/packages/libfabrika/src/cloudflare/platform.ts | build | 8 | the two calls' Promise edges, each one marked line |
| next/apps/fabrika/src/brain.ts | build | 10 | the Project class forwards the two calls |
| next/packages/libfabrika/src/index.ts | build | 4 | exports `Fit`, `Pipe`, `Piped`, `Pipes` |
| next/programs/checklist/src/program.ts | build | 3 | `done` becomes `Output.make(Done, finished)` |
| next/packages/libfabrika/src/processes/Fit.test.ts | tests | tests | F1 to F4 |
| next/packages/libfabrika/src/runtime/Program.test.ts | tests | tests | F5 |
| next/packages/libfabrika/src/processes/PipesTest.ts | tests | tests | P1 to P3 |
| next/packages/libfabrika/src/processes/ProgramMailTest.ts | tests | tests | P4 |
| next/packages/libfabrika/src/node/Pipes.integration.test.ts | tests | tests | runs `PipesTest` and P4 on node:sqlite |
| next/packages/libfabrika/src/runtime/PipeTest.ts | tests | tests | W1, W2, O1 to O3, with a writer and a reader test program |
| next/packages/libfabrika/src/node/Pipe.integration.test.ts | tests | tests | runs `PipeTest` on node:sqlite |
| next/packages/libfabrika/src/runtime/Piped.test.ts | tests | tests | R1 |
| next/packages/libfabrika/src/processes/ChildrenTest.ts | tests | tests | J1, J2 |
| next/packages/libfabrika/src/node/StartChild.integration.test.ts | tests | tests | runs J1 and J2; today's laws stay green |
| next/packages/libfabrika/src/runtime/Pipe.types.test.ts | tests | tests | T1 |
| next/apps/fabrika/src/worker-pipe.integration.test.ts | tests | tests | H1, CI's full run only |
| next/packages/libfabrika/src/processes/ProcessMonitors.integration.test.ts | tests | tests | the watch slice's laws stay green with the optional `answer` |
| layer-rules.json | tests | tests | no change expected: every new file sits in a module that has a row |
| .glossary/TERMS.md | build | docs | rows `pipe (Cmd)`, `piped`, `fit`, `stop_job`, `mark`; `job` and `pipe` updated |
| docs/direction/follows/otp.md | build | docs | rows for a watch per life under a name, and a job's stop order |
| next/programs/fabsh/src/read.ts | build | 70 | pull request 2: the pipe sign, numbering by place, `builtin` |
| next/programs/fabsh/src/program.ts | build | 170 | pull request 2: the job machine, `pipe`, starts, `stop_job`, `interrupt`, refused words |
| next/programs/fabsh/src/window.tsx | build | 30 | pull request 2: a job's entries in the scrollback |
| next/programs/tezgah/src/program.ts | build | 80 | pull request 2: the mark on `show`, `tezgah.interrupt`, saved model v3 |
| next/packages/libfabrika/src/tezgah/Workspace.ts | build | 25 | pull request 2: `Mark`, `PipeHue`, `Tile.mark` |
| next/packages/tuval/src/window/main.tsx | build | 25 | pull request 2: Ctrl-C in a marked tile goes to tezgah |
| next/packages/tuval/src/window/Layout.tsx | build | 15 | pull request 2: the letter in the mark slot, `data-pipe` on the tile |
| next/packages/tuval/src/window/style.css | build | 40 | pull request 2: the wash and focus edge per hue |
| packages/fabrika-design/tokens/color/pipe-wash.toml | tests | 60 | pull request 2, an exam path, so the tests step writes it: the six hues' wash, focused wash and focus edge as shared tokens, with the generated token list |
| next/programs/fabsh/src/read.laws.test.ts | tests | tests | S1 |
| next/programs/fabsh/src/program.laws.test.ts | tests | tests | S2, S3 |
| next/programs/tezgah/src/program.laws.test.ts | tests | tests | S4, S5 |
| next/apps/fabrika/src/pipe-line.visual.test.ts | tests | tests | E1, on the laptop only |

The design package's exact token files follow its own build (one file per token, or one per scale);
the builder reads `packages/fabrika-design` first and keeps its shape. Today's app keeps its own hue
values in `apps/fabrika/src/window/window.css`; moving them onto the new tokens is a finding, below.

## Calls taken

Each is mine to decide by the open questions test: it picks how the code does what a note or a
decision already says.

- **The fit reads Effect's `SchemaRepresentation`,** not JSON Schema. It is Effect's own persisted
  form of a schema, it keeps each check's persistence id, and it needs no second converter. JSON
  Schema loses which Effect check made a constraint, which v1's check rule reads.
- **The encoded side is compared,** since a message carries encoded JSON and the reader decodes it.
- **An unfit pipe is an `ok` answer, not an error,** so its path and words ride the answer message.
  tea's Cmd errors carry a tag only. `start_child`'s `already_present` is the same pattern.
- **The pipe's id is its Cmd's id,** as the watch slice made a watch's ref its Cmd's id: stable on a
  retry, never reused.
- **A watch per writer life, written by the brain in the start and restart turns.** The note's
  plumbing call, and the watch slice's own lean for the pipe ("the pipe slice ... does that
  brain-side"). A reader's runner that monitored again after each `DOWN` would get `noproc` during a
  restart's backoff and lose the crash's reason.
- **The job is fabsh's count, kept with the requester's name.** A shell's job number, `%3`. It is
  stable across fabsh's restarts, since fabsh's model is saved.
- **The job's stop is a built-in Cmd, `stop_job`, closed with an Effect `Scope`** (0061, the brief's
  settled mechanism). OTP's supervisor and Effect's `Scope` both stop in reverse start order, which
  with readers started first would stop the writer first. The finalizers are added so the close
  stops the reader first, as 0548 says. The scope also gives what a loop would not: every stop runs
  even when one fails or the fiber is interrupted.
- **`|` reads as `keyword`,** a reserved word in its slot, as POSIX lists `|` among its operators.
  No new role and no new color; the fabsh guidelines (proposed, pull request 1254) may change it.
- **A built-in inside a job is refused `builtin` in this slice** (see the open questions).
- **A busy default name is refused `name_taken`,** as fabsh's single start already answers
  `already_present` for a busy name today. The words say to add `as <name>`.
- **No related-pair exception for a pipe.** 0551 checks the member behind the line; a pipe with no
  member is `forbidden`.
- **Ctrl-C in a marked tile is the job's, never the program's.** POSIX sends the interrupt to the
  foreground process group; 0548 says Ctrl-C in any tile stops the whole line.
- **The six hues become shared tokens** (0456: one design package for both versions), so tuval does
  not copy today's literal values.
- **Not in this slice, each named:** how a small program with no window shows on screen in a line
  (such as `seq` or `double`), and turning a step off so data skips it, both with the owner as a
  design talk; for this slice every program in a line has a tile (0491). Two brains talking (0551). A
  pipe across lines. Editing a pipe after the line runs. A crashed tile's look: it stays and says its
  word, as the tile guideline says, with no new screen rule, no "source ended" wording and no
  folding or closing by the pipe. **A reader that ends by itself** (the note's fifth plumbing call):
  in this slice every program has a window, so a reader ends only by Ctrl-C, which stops the whole
  job, or a crash, which supervision restarts; telling a final end from a restart needs the name's
  `down` state, which no watcher gets today. It is a ticket for the lead, not a gap in this slice.
- **Typed services only.** The runner reaches `Pipes` and `Children` as services; nothing calls a
  command-line tool (0231).
- **A browser is always a client.** Every piece is JSON messages, Cmds and the Project's RPC. A fabsh
  tile in a browser tab sends the same line, and a tab draws the same marks.

## Validation

- tests step, pull request 1: `nice -n 15 pnpm exec vitest run --maxWorkers=3` on
  `next/packages/libfabrika/src/processes/Fit.test.ts`, `next/packages/libfabrika/src/runtime/Piped.test.ts`,
  `next/packages/libfabrika/src/runtime/Program.test.ts`, `next/packages/libfabrika/src/node/Pipes.integration.test.ts`,
  `next/packages/libfabrika/src/node/Pipe.integration.test.ts` and
  `next/packages/libfabrika/src/node/StartChild.integration.test.ts` shows each law red on main.
- build step, pull request 1: the same paths green, and
  `next/packages/libfabrika/src/processes/ProcessMonitors.integration.test.ts` still green.
- tests and build steps, pull request 2: the same command on the three fabsh and tezgah law files;
  E1 through `apps/fabrika/test-window.ts`, with shots written under `runs/`, never committed.
- The lead runs `--changed origin/main` and one `pnpm typecheck`; H1 runs only in CI's full run.

## Size

1. **Pull request 1, the pipe in the library:** about 1,240 lines (PipesLedger 200, Fit 170, Runner
   150, Pipe 90, Pipes 90, Piped 80, ChildrenLedger 75, pipeTable 70, Program 70, the Project calls
   70, ProcessManager 45, the rest under 30 each), plus its suites. It lands whole and is useful
   alone: any program can pipe two programs it starts, with no shell (0109), and every law but E1
   and S1 to S5 is in it.
2. **Pull request 2, the line in fabsh and on screen:** about 560 lines (fabsh 270, tezgah 80, the
   design tokens 60, tuval 80, Workspace 25, plus the first real pair the first open question picks,
   about 45 to 200). It is what the owner sees: a typed line, two marked tiles, a value going across,
   a refused line in words, Ctrl-C stopping both. It cannot land before pull request 1, and it waits
   for fabsh's slice 2b.

About 9 agent hours across both quests, 65% sure. The doubt is the runner: owed output sends,
newest wins and the first value of a life sit in the hardest part of `Runner.ts`, beside `behind`,
and W1's same-turn watch touches `ProcessManager`'s start and restart turns. Budget basis: the watch
slice's plan (`docs/plan/lanes/watch-PLAN.md` on its branch), 540 lines at 6 steps and $40, and ticket
1041's (`docs/plan/lanes/t1041-PLAN.md`), a runner host Cmd at 6 steps and $43. Pull request 1 is
about twice the watch slice; pull request 2 adds a window and shots.

Estimate: 15 steps, $120

## Records

- `field/runs/` rows for each step, by the lead.
- Glossary rows in pull request 1: `pipe (Cmd)`, `piped`, `fit`, `stop_job`; `job` gains "a line's
  processes, started by one fabsh under one count"; `pipe` gains the fit rule's name. In pull
  request 2: `mark`.
- `docs/direction/follows/otp.md`: a watch per life under a name (where we leave OTP), and a job's
  stop order (where we leave OTP's supervisor).
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
- How the mark and a refused line read with a screen reader. That needs a real run.
- Whether "reader first" is ever wrong for a real line: a writer stopped second can still try to
  send to a stopped reader, which answers a refusal its runner drops.

Made up, for the examples: the programs `tracker`, `outline` and `board` in `next/`, their `rows`
output and input, `Row`, the `column` field, the process IDs `process_F`, `process_O`, `process_T`
and `process_T2`, the tile `t2`, the hashes, and job numbers 3 and 4. Real: `send_chunks`,
`Chunk.input`, `Part`, `full`, `mail.unread`, `mail.chunk`, `start_child`, `stop_child`, `exit`,
`DOWN`, `monitored`, `SchemaRepresentation`, `fabrika/checklist`, `fabrika/fabsh`, `fabrika/tezgah`.

## Open questions

1. **Which pair is the first one a person can type?** No reader program with a window exists in
   `next/programs` (chaos, checklist, counter, inbox, pipeline, tezgah). Lean: the checklist gets a
   second output, `items`, its view's rows, and a new small program, `fabrika/outline`, shows any
   list of rows that have a `name`, nothing of its own, as the program guidelines say a drawer
   has nothing of its own; `checklist | outline` is then E1's line. Why: both ends are real programs
   with tiles, the checklist already has rows a person edits, and outline is the reader the note and
   0549 already use in their examples. Cost: about 200 lines and one new view, with shots at five
   layouts. 60% sure. The doubt: a new view is a screen, which the owner may want to walk first (how
   Linear would build it); the cheaper branch is to give `fabrika/counter` a piped input that shows
   how many rows are not checked (about 45 lines, no new view), which reads oddly for the example
   program. A look at both on the five layouts settles it.
2. **Do pipes for fabsh's built-ins come in this slice, or right after?** 0159 orders pipes "working
   first for fabsh's built-ins". This slice pipes programs that have tiles, as the brief scopes it,
   and refuses a built-in inside a line. Lean: right after, as its own small slice: fabsh is the
   writer for `programs | outline`, declares an output per built-in, and still writes `piped`, as the
   note's lean says; it needs no brain piece beyond pull request 1. Why: a built-in writer still
   needs a reader program with a window, which question 1 picks, and it adds fabsh-as-writer cases
   (fabsh is not in the job, so Ctrl-C must not stop it) that are better proved alone. Cost: about
   150 lines in a third pull request, before `summon`. 70% sure. The doubt: the owner could read 0159
   as "built-ins before any program pipe", which this order walks back.

## Findings

```json
{"_tag": "finding", "id": "2026-11-15-pipe-hues-only-in-todays-app-css", "date": "2026-11-15", "by": "plan", "model": "claude-opus-5-5", "rule": "duplicate", "location": {"path": "apps/fabrika/src/window/window.css", "line": 333}, "says": "In today's version, the six pipe hues of 0478 are literal light-dark() values in the app's window.css and not tokens of the shared design package (0456), so next/'s tuval can only copy them; once pull request 2 of the pipe plan adds them as tokens, today's CSS keeps a second copy.", "proof": "apps/fabrika/src/window/window.css line 333 opens [data-pipe=\"sky\"] with literal values, and the other five hues follow; the design package's color tokens folder holds no pipe token, and rg -i pipe packages/fabrika-design finds only a comment in tile-edge.toml (2026-11-15).", "cost": "Two copies of one hue table drift apart the first time one version's colors change.", "head": "0e36734b7539657f64bc0466b36517bb66291b8b", "ticket": null, "pr": null}
```
