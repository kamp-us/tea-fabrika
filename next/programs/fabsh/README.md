# fabsh, next/

`@kampus/fabsh` contains S1 of [fabsh v1](../../../docs/plan/quests/fabsh-v1-PLAN.md),
under [0586](../../../.decisions/0586-fabsh-v1-is-todays-terminal.md).
It is pure code for a parent program to step. S1 opens no terminal or tile and starts no process.

| Entry | Contract |
| --- | --- |
| `./words` | `words(line)` reads quotes, escapes, operators and comments, keeping source offsets. |
| `./grammar` | `parse(line)` reads statements, pipes, flags, named inputs, substitutions and agent or room prose. A syntax refusal is a value. |
| `./check` | `check(parsed, programs)` checks the entire line before any program can start. The catalog maps shell names to flag and port declarations with Effect Schemas; `table` records whether a program prints a table. Missing programs return status 127; other refusals return 2, with a source position and a reason. |
| `./roles` | `roles(line, programs, cursor)` assigns each word its role. The cursor defaults to the line end. Its current word is left unjudged. Finished unknown programs and incompatible pipes get an error role. |
| `./complete` | `complete(line, programs, jobs, talk)` returns the replaced word and unique candidates. It reads the same declarations and pipe-fit check. Jobs may include stages with process IDs and their input declarations. |
| `.` or `./editor` | `editor` is a tea machine. Init receives programs, history and historyLimit. Keys produce write, submit, keep, interrupt, close and answer commands. `flush` declares a pending Esc standalone; a transport frame boundary alone does not. |
| `./keys` | `keys` is the editor's child tea machine. It reads one key at a time and keeps the exact untouched suffix, including incomplete escape and bracketed-paste marks, across input frames. |
| `./screen` | Role colors use the terminal's palette. Errors are also underlined. Program text is made safe before printing. Tables and completion lists are laid out at the viewer's width. |
| `./cells` | `spot(text, cols)` measures Ghostty wrapping and graphemes. `facts(cp)` reads the generated code-point table. |

Pipes use the reader's needed fields. Extra writer fields are accepted. Multiple matching ports
require `>output` or `<input`. An unsupported shape comparison is refused. This S1 check does not
run a pipe or change the runtime's program declarations.

The editor uses readline's emacs bindings, a ten-entry kill ring, yank-pop, undo, word case changes,
yank-last-arg, history recall with a saved draft, reverse and forward search, and bracketed paste.
Paste line breaks become spaces. History keeps each nonblank line once, newest last, up to the
configured limit. Busy type-ahead waits in order, including standalone-Esc boundaries. A question retains it; answering, withdrawal or completion releases the question without dropping queued keys. Ctrl-C interrupts immediately and drops queued
keys; Ctrl-D typed ahead is dropped.

Input messages may split anywhere inside an escape or paste mark. The caller sends `flush` when
it knows a pending Esc is a complete standalone key. A transport chunk ending alone is not that
signal. The editor reads no timer. `asked {job, text: null}` withdraws a question; `ready` also
releases one and restores the queued prompt.

Ctrl-B belongs to the window prefix when the editor is attached to a tile. Left still moves back.
In a browser on Linux, Ctrl-W, Ctrl-T and Ctrl-N can be handled by the browser before reaching the
editor. S1 itself has no window key routing.

`table.ts` generates `src/editor/cells.table.ts` from ghostty-web 0.4.0's installed wasm.
The table contains every Unicode code point. It is not taken from today's terminal's table.
Correctness is checked separately by the S1 laws in automatic CI.

S2 adds the program, the tile, shared saved history, settings and local echo. S3 adds process and
job control. S4 adds the real Electron checks. A partial line stays in memory; a later runner sleep
may lose it. A submitted line is the boundary for saved history.
