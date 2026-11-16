# 0093: exam slice C does not carry the old history; the leak rule is out

**Exam slice C is clean.** `git rev-list --max-parents=0` gives one root, main's own `22ffc707c`,
on all three exam branches:

| Branch | Roots |
|---|---|
| `fabrikalfa/exam-to-lint-c` | `22ffc707c` only |
| `fabrikalfa/law-options-0580` | `22ffc707c` only |
| `fabrikalfa/exam-to-lint` (PR 1504) | `22ffc707c` only |

The 0591 sweep and 0580 do not touch PR 1301's old root, `6e9a51046`.

**The leak rule is in the step rules** at `fabrikalfa/twin-tools` `4572d3673`, under "Leak checks
on the stack". A branch built on `eeb8ecdbb` runs leakgrep in two parts:

- **The tree that lands:** `git diff origin/main...HEAD` is written to a scratch file, then scanned
  with `leakgrep.sh --text`.
- **Its own commits:** `leakgrep.sh --commits eeb8ecdbb..HEAD`.

Integrators also run `git rev-list --max-parents=0 HEAD` and name each root in their RESULT.

The rule is being sent to the 13 sessions built on `eeb8ecdbb`:

- layers 4, 6, 7 and 8;
- anti-slop tag-comparison 3 to 8;
- E91 to E97 with E77 and E78;
- E60;
- the E55, E93 and swap unit.

Each layer's mail from now on names the extra root, `6e9a51046`.
