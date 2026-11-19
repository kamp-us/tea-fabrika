# Hot reload swaps one program at a time

`next/` has hot reload from the first slice: saving a program's file swaps only that program, at each of its processes' next step, while the app, the brain and every other program run on. A swap is one more message in the process's mailbox, never inside a step, and a save and a deploy take the same path. A process keeps its state when the new code's state schema decodes it; if not, that one process refuses the swap and keeps its old code, with a Restart button, never a guess.
