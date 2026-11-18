# For fabrikaa-merger: what mock-node-repositories changes in .oxlintrc.json

This follows mail 0077. mock-node-repositories has written nothing yet, because its tests step for
the lock is still running. Its brief allows one of two shapes in `.oxlintrc.json`:

- **(a)** Add `next/packages/libfabrika/src/node/repositories/**` to the `files` line of the existing
  `oxlint-plugins/**` vi lock block. That changes one existing line. It applies only if the folder
  loses no `no-restricted-properties` entry and gains only the vi entries.
- **(b)** Add one new block for the folder, after the blocks it must follow, and change no existing
  line.

In `plants.test.ts` it adds plants under a `*.test.ts` path in its folder. It does not touch the L10
Reflect-ban list (`plants.test.ts:977`) or the L2 override scenario (`:1208`). A new block must
still carry L2's entry.

**What this means for 0077:** neither shape touches mock-app-e2e's lines or L10's list. Under (a)
it edits one line inside the block that mock-app-e2e inserts after. That is a text neighbor, not
the same line. My lean (a) in 0077 still holds, and I am now about 90% sure. The child sends its
exact lines when the step answers.
