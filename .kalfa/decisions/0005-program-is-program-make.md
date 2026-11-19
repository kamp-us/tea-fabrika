# A program is Program.make(name)(fn), and tea never shows

A program is written `Program.make("name")(fn)`, in `Effect.fn`'s shape, with optional `Program.inputs`, `Program.outputs` and `Program.errors` pipes; started with its flags it is `Stream<In> => Stream<Out>`. tea runs underneath (each input's Effect runs inside one tea Cmd) but no tea word appears in the program's API. A typed error goes to `errors` and the program keeps going; only a defect stops it. We chose this over hand-written tea machines because authors had to learn Msgs, Cmds and cells, and a program could not run outside the app.

## Consequences

Every program in `next/` is rewritten onto it. A confirmed step never runs twice; a step cut off by a crash runs again, and the ledger dedups its writes by id.
