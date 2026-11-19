# A ledger step is a plain function, never an Effect

The work inside one storage transaction is a plain `(turn) => A`, run as `Effect.sync(step)`, never an Effect body. An Effect body can wait and hang the object: with six calls at once, one answered and five timed out. The function's shape is the guard, at about 95 microseconds more per turn.
