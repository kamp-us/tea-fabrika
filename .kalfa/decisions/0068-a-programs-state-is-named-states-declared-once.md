# A program's state is named states, each declared once

A program in `@kalfa/program` keeps what it remembers in named states. Each is declared once with
`State.make(name, { schema, defaultValue })`, read inside a step with `yield* Seen` and written with `Seen.set` or
`Seen.update`. This replaces the shape of decision 0005, where `init` made one state value and every step returned the
next one: a program is now `Program.make(name, { args })` with optional `Program.init`, `Program.inputs` and
`Program.outputs` pipes, and a step is a generator, as in `Effect.fn`. We chose this because the one state value was
the only saved thing with no schema, so a ledger journal could not write it down, and because an author had to say up
front what the program keeps. The rest of decision 0005 holds: tea runs underneath and no tea word shows.

## Considered Options

- Keep decision 0005 and add a state schema to `Program.make`, the Elm shape: rejected, because every program then
  declares its whole state up front, a stateless one too, and a field added later changes the saved shape of all of it.
- States found by call order, as in React's `useState`: rejected, because a saved value must survive two lines being
  swapped.
- A state stays in the final stream's requirements and the app provides each one: rejected, because the process is what
  holds a state, so the process provides it, and the app would have to write the list the program no longer writes.

## Consequences

A step is no longer a plain function from state and message to state, so a test either runs the whole program as a
stream or runs one step from states it names. A step's writes land together when it ends well: a typed error drops
them, and a step cut by a crash runs again from the saved values. A state shows in each step's requirements and on the
program's type, and the program provides it, so two declarations with one name in one program do not compile. A program
lists no states, so a saved value that no longer fits its schema is found at the first read and not at start, as a
defect. Values that must change together are one state with a union schema. A state has no reset and no delete. Nothing
here was type-checked when it was decided.
