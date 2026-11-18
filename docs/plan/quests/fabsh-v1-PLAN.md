Approved by the lead agent, builds 0586, 0275, 0069, 0579, 0587 and 0594; body acef6be246c0
Plancheck-Version: 3

# Plan: fabsh v1, today's terminal in a tile of next/, with its line editor, tsh's grammar, syntax highlighting and [terminal] settings in Ghostty's key names (ticket 1078)

Tracker ticket 1078. Version: `next/` only. Today's version is read as the spec and is not touched.
It builds accepted decision 0586 (https://github.com/kamp-us/tea-fabrika/pull/1429),
which amends 0432 and sets aside 0217's lesson rule for this one case. Read on main at `a1df7569d`.

**The doubt, at the top (75%).** `next/` has no ephemeral frame on main. Today's terminal sends raw
keys to the process that holds the line editor and gets bytes back, and 0275 says the same of
`fabsh`. So v1 adds the ephemeral lane's first two frames, `process.keys` (keys in) and
`process.screen` (bytes out). Parked PR 1232 added a different frame, `process.draft`, which carries
the typed line as text. This plan builds its own frames from 0275 and today's port messages and
takes nothing from that branch. If the lead reads `process.keys` as the parked idea under another
name, the other way is to run the editor in the window. That loses one thing today's terminal has:
a second window on the same tile would not see a line until Enter.

```text
A sketch, next/: what works at the end of this quest, in a browser tab and the Electron app.
fabsh$ cou<Tab>                       counter       Tab puts in the one program that starts with "cou"
fabsh$ countr --to 3                  countr in the error color, underlined: no program is named countr
fabsh$ seq --to 3 | dbl &             program, flag, argument, pipe, program, separator: each in its role's color
[1] seq --to 3 | dbl                  a job; the prompt is back at once
(reverse-i-search)`seq': seq --to 3 | dbl    Ctrl-R, as bash's
fabsh$ counter                        the counter covers the tile; Ctrl-C stops it and the prompt comes back
~/.fabrika/fabrika.toml   [terminal] font-size = 15   theme = "light:fabrika-light,dark:fabrika"
```

## What it builds

- Decision 0586's first part, "fabsh v1 is today's terminal rebuilt on `next/`'s runtime", and its
  syntax highlighting and `[terminal]` settings.
- Step 1 of 0586's order for the four primitives, and with it
  [Tier 1, piece 3](../tier-1.md) ("`fabsh`, a program in a tile").
- 0275 as decided: a regular program, keys to the process, a submitted line is a Msg, keys typed
  mid-line never saved, and speculative echo.

Out of it, each to its own plan (0586's order): running a pipe (pipe slice 1,
https://github.com/kamp-us/tea-fabrika/pull/1344), `summon`, `dismiss`, `agents` and `@name`
(the summon plan), and `join`, `leave`, `names`, `topic` and `#room` lines (the join plan). v1
reads and colors all of those lines, so the roles are right from the first day. Until each quest
lands, Enter on such a line answers a refusal in words that names the quest. This follows the
owner's order; it is not a stub of `fabsh` itself (80%).

## What the owner sees, slice by slice

1. **S1, nothing on screen.** The reader and the line editor as pure code with their laws: words,
   grammar, the check, roles, completion, keys, the kill ring, history, Ctrl-R, the screen bytes.
2. **S2, fabsh in a tile.** A tile runs `fabsh`. You type, each letter shows at once, words take
   their colors, Tab completes, Ctrl-R searches, and history survives a restart and is shared by
   tiles. `help`, `programs` and `exit` answer. `[terminal]` settings change the look. This is the
   first thing the owner sees, in a browser tab.
3. **S3, starting programs and jobs.** `counter` covers the tile and Ctrl-C stops it; `counter &`,
   `jobs`, `ps`, `attach %n`, `stop %n`, `tell`, `close`, `;`, `&&`, `||` and `$( )` work.
4. **S4, the Electron app and the shots.** The same suite in the app, and shots at five layouts.

## Today's terminal, feature by feature: the parity bar

Read in today's code: `apps/fabrika/src/window/terminal.ts`, `apps/fabrika/src/editor/`
(`keys.ts`, `editor.ts`, `screen.ts`, `cells.ts`, `history.ts`), `apps/fabrika/src/tsh.ts`, and
`packages/fabrika/src/shell/` (`words.ts`, `grammar.ts`, `check.ts`, `complete.ts`, `search.ts`,
`builtins.ts`, `execute.ts`, `said.ts`, `table.ts`, `help.ts`, `did-you-mean.ts`).

**The terminal (`window/terminal.ts`).**

- ghostty-web 0.4.0 on a canvas, its wasm built from bytes in the page, one Ghostty shared by every
  tile.
- Fit to the tile, follow its size, send `size` in cells (2 to 1000).
- The theme follows the system's look. ghostty-web 0.4 cannot change a theme after `open`, so the
  terminal is made again and the kept bytes (1 MiB, from the last full reset) are written again.
- A full reset after the fit, so a freed terminal's rows never show in a new one.
- The cursor does not blink. Scrollback is 1,000 lines. The font is the system's monospace at 13.
- Focus kept right across a remake.
- For a screen reader: the screen as text in a named region (200 rows, once a frame at most), a
  job's status in a `status` region (at most once every 3 s), and replies in a `log` region (50
  lines).

**The line editor (`editor/`).**

- Readline's emacs keys by readline's own command names: `beginning-of-line`, `end-of-line`,
  `backward-char`, `forward-char`, `backward-word`, `forward-word` (Alt and Ctrl arrows too),
  `backward-delete-char`, `delete-char`, `kill-line`, `unix-line-discard`, `unix-word-rubout`,
  `kill-word`, `backward-kill-word`, `yank`, `transpose-chars`, `clear-screen`, `accept-line`,
  `previous-history`, `next-history`, `reverse-search-history`, `complete`, `interrupt` (Ctrl-C),
  `end-of-file` (Ctrl-D).
- A kill ring of one: kills in a row join, Ctrl-Y puts them back.
- The bell on a move with nowhere to go. A key with no command does nothing.
- Tab: one candidate goes in with a space; many put in their common start, and a second Tab lists
  them. Completion knows programs and built-ins, a program's flags, a flag's values, inputs (`pr=`),
  `--help` parts, what fits after `|`, `%n` jobs, a job's inputs, `summon`'s harnesses and their
  offered settings, and `@` names.
- History: `terminal.history-limit` lines, 1,000 by default, each once (readline's `erasedups`), kept in a file, shared by every tile
  (fish's way), with Up and Down that keep what was typed.
- Ctrl-R: bash's reverse-i-search; Ctrl-R again for older; Backspace; Enter runs; Esc, Ctrl-G and
  Ctrl-C leave; any other key takes the line and goes on.
- Busy: keys typed while a line runs wait and go to the next prompt; Ctrl-C goes through at once
  and drops them; Ctrl-D typed ahead is dropped.
- A job's status row drawn in place under its output, cut to the width with `…`; a job's yes or
  no (`asked`) takes the next key.
- Printed text and tables go above the prompt, which is drawn again under them. Tables are laid out
  at the width, in the 16-color palette.
- Cells counted as Ghostty counts them (wide characters, graphemes, U+FE0E and U+FE0F), from a table
  made from ghostty-web's wasm. A whole-line redraw, one row only when the line fits one row.
- A program's text cannot move the cursor or retitle the window (`shown`).

**tsh (`packages/fabrika/src/shell/`, `apps/fabrika/src/tsh.ts`).**

- Words: spaces, `'…'`, `"…"` with `\"` and `\\`, `\`, the operators `|`, `&`, `;`, `$(`, `)`,
  `&&`, `||`, and `#` comments. No `$name`, no globbing, no `~`, no file redirection.
- The grammar: statements joined by `;`, `&`, `&&`, `||`; pipelines; `--flag value`,
  `--flag=value`, `input=value`, `>output`, `<input`, `--all`, `--help` or `-h [name]`; `$( )`; a
  said line `@name …` whose rest is the agent's, as typed.
- The check, before anything runs: the program exists, each flag and input is declared, each value
  fits its shape, required flags are there, each pipe and `$( )` fits. A refusal names where and
  why, with "did you mean", and exits 127 for a missing program and 2 for the rest.
- 12 built-ins: `jobs`, `ps`, `tell`, `close`, `stop`, `attach`, `programs`, `help`, `exit`,
  `summon`, `dismiss`, `agents`.
- Jobs: `&` runs in the background, `%n` is one table every tile shares, `attach %n` brings a job
  forward (bash's `fg`), and a job from an earlier start can be started again.
- A program with a view run in the foreground covers the tile; Ctrl-C stops it; closing its view
  closes its inputs.
- An agent's own `tsh` in a tile, whose lines come from the agent: part of the agent plumbing, so it
  goes to the summon plan (0586's owed list).

**Against the real-terminal bar, what today's terminal lacks.** Each is in scope (0586):

| Gap | What a real terminal does | In v1 |
|---|---|---|
| Syntax highlighting | fish and zsh-syntax-highlighting color each word as you type | yes, S1 and S2 |
| Ctrl-S, forward search | bash and fish step to newer matches | yes, S1 |
| Undo, `C-_` and `C-x C-u` | readline's `undo` | yes, S1 |
| Alt-., `yank-last-arg` | the last word of the previous line | yes, S1 |
| Alt-Y, `yank-pop` | walk the kill ring | yes, S1, with a ring of 10 |
| Alt-U, Alt-L, Alt-C | readline's case words | yes, S1 |
| `M-<`, `M->` | first and last history line | yes, S1 |
| Bracketed paste (mode 2004) | a pasted newline never runs a line (bash 5.1's default) | yes, S1 and S2 |
| Font zoom | Ghostty's `increase_font_size`, `decrease_font_size`, `reset_font_size` | yes, S2, as `[terminal] keybind` actions |
| Copy and paste keys | Ghostty's `copy_to_clipboard` and `paste_from_clipboard` | yes, S2; the builder checks what ghostty-web 0.4.0's selection gives first |
| Settings | Ghostty reads a config file | yes, S2, `[terminal]` |
| Ctrl-Z | bash suspends the foreground job | no: today's tsh does nothing on it, and the summon plan settles it (0586) |
| fish's gray suggestion | fish's autosuggestion | no: bash has none, so a real terminal does not need it, and it was a parked PR 1254 idea |

## How others do it

- **GNU Readline** (its manual, "Bindable Readline Commands", read from memory, not fetched): the
  command names and emacs keys above, the kill ring, `undo`, `yank-last-arg`, `yank-pop`,
  `reverse-search-history`, `forward-search-history`, and `enable-bracketed-paste`, on by default
  since readline 8.1.
- **fish** ([interactive docs](https://fishshell.com/docs/current/interactive.html#syntax-highlighting),
  fetched): it colors the line as you type by role, `fish_color_command`, `fish_color_param`,
  `fish_color_option`, `fish_color_quote`, `fish_color_end`, `fish_color_comment`,
  `fish_color_error`, and marks a command that does not exist in the error color. Its history is
  shared by every running shell.
- **zsh-syntax-highlighting**
  ([main highlighter](https://github.com/zsh-users/zsh-syntax-highlighting/blob/master/docs/highlighters/main.md),
  fetched): a style per token kind (`command`, `builtin`, `unknown-token`, `single-hyphen-option`,
  `double-hyphen-option`, `single-quoted-argument`, `double-quoted-argument`, `commandseparator`,
  `comment`), set as `fg=` color names, so the terminal's palette draws them.
- **Ghostty** ([config reference](https://ghostty.org/docs/config/reference), fetched): the key
  names and value forms below, `theme = light:X,dark:Y` to follow the system's look, and `keybind =
  trigger=action`.
- **mosh** (its paper, from memory): predict only what is safe (typing, Backspace, arrows), draw it
  at once, and let the server's screen overwrite it. 0275 names it.
- **Elm:** the editor is a machine a parent steps by hand: the fabsh program steps the editor, and
  the window steps the echo machine. **OTP:** the history is one process per person that keeps a
  list of subscribers, as a `gen_event` or `pg` group does, and each `fabsh` process is one.
- **tmux:** a pane shows the same screen in every attached client; a new client gets the screen
  first, then each change. That is how a second window joins a tile here.

## What it builds on

Each read whole: 0586 and 0159; 0275 (the shell is a regular program); 0276 (a tile shows one
process); 0278 (each window runs its own prefix); 0170 (a start is checked against its sender);
0256 (a program is one `Program.make`); 0069 (choices are settings) and
[settings](../../direction/settings.md); 0109, 0549, 0550 and 0553 (pipes, for the fit check only);
0583 (rooms, for the `#room` role only); 0460 (mono only for typed words: a terminal is typed text,
so all mono is right here); 0456 (the design package is shared); 0579 (property laws with
`it.prop` and Schemas); 0536 and 0581 (where real-resource tests run); the
[desktop layer](../../direction/the-desktop-layer.md), W2; the
[sync engine note](../../direction/a-local-first-sync-engine.md), its one ephemeral lane (show it,
never save it, never decide with it); `next/programs/tezgah/README.md`.

## The shape

All sketches, `next/`. The package is `@kampus/fabsh` in `next/programs/fabsh`.

```ts
// next/programs/fabsh/src/roles.ts: every word of a line gets exactly one role.
export const Role = Schema.Union([
  Schema.TaggedStruct("program", {}),   Schema.TaggedStruct("builtin", {}),
  Schema.TaggedStruct("flag", {}),      Schema.TaggedStruct("argument", {}),
  Schema.TaggedStruct("input", {}),     Schema.TaggedStruct("pipe", {}),
  Schema.TaggedStruct("separator", {}), Schema.TaggedStruct("mention", {}),
  Schema.TaggedStruct("room", {}),      Schema.TaggedStruct("string", {}),
  Schema.TaggedStruct("substitution", {}), Schema.TaggedStruct("comment", {}),
  Schema.TaggedStruct("error", { reason: Schema.String }),
]);
export const Span = Schema.Struct({ start: Schema.Int, end: Schema.Int, role: Role });
// roles(line, programs) -> ReadonlyArray<Span>: in order, never overlapping, and every character
// that is not a space is inside exactly one span.
```

```ts
// next/programs/fabsh/src/editor/screen.ts: a role is a palette index, never a color.
// SGR 30-37 and 90-97 name the theme's 16 colors, so the theme draws them (zsh-syntax-highlighting's fg=).
const ANSI: Record<Role["_tag"], { readonly color: number; readonly underline: boolean }> = {
  program: { color: 32, underline: false }, // a sketch: the look step picks the map
  error: { color: 31, underline: true },    // never color alone (WCAG 1.4.1)
  // ...
};
```

```ts
// The editor machine, rebuilt from today's: keys in, bytes out. One Machine.make, stepped by the program.
type Mode =
  | { _tag: "prompt"; line: Line; recall: Recall | null; undo: ReadonlyArray<Line> }
  | { _tag: "search"; search: Search; typed: Line; way: "back" | "forward" }
  | { _tag: "busy"; ahead: ReadonlyArray<string> }
  | { _tag: "asking"; job: number }
  | { _tag: "ended" };
// Cmds it asks for: write {bytes}, submit {line}, interrupt, close, keep {line}, answer {job, allow}
```

```ts
// The two ephemeral frames (libfabrika, gateway and client). Never saved, never decide.
{ method: "process.keys", process: "fabsh:tile_01k", data: "cou\t" }   // window -> process, own budget
{ method: "process.screen", process: "fabsh:tile_01k", seq: 41, data: "\r\x1b[Kfabsh$ counter " } // process -> watchers
// A submitted line is a saved letter, as any input: process.send {type: "submitted", line: "counter"}
```

```ts
// The runner keeps a terminal program's editor and screen in memory, beside its saved model (0275).
// A program says it has one; nothing of it is in the saved fold (0229).
export const fabsh = Program.make({
  name: "fabsh",
  machine: fabshMachine,          // saved: jobs, the history it was last told, the last status
  terminal: { editor: editorMachine, kept: 1024 * 1024 }, // in memory: the line, the screen's last bytes
  // inputs: submitted, history (from the history process), size, ...
});
```

```ts
// next/programs/fabsh/src/history.ts: one history process per person, `fabsh-history:<person id body>`,
// as tezgah is `tezgah:<person id body>`. A submitted line is mailed to it; it mails the whole list
// back to each fabsh process that subscribed, so every tile's Up and Ctrl-R see it (fish).
type HistoryModel = { lines: ReadonlyArray<string>; subscribers: ReadonlyArray<ProcessId> }; // capped by terminal.history-limit
```

```ts
// next/packages/libfabrika/src/settings/Declarations.ts: Ghostty's names under [terminal], each once.
export const fontFamily = Setting.make("terminal.font-family", {
  schema: Schema.String, default: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  doc: "The font the terminal draws with, as Ghostty's font-family.", scope: ["person"], reload: "live", since: "0.0.0",
});
// The keys, each as Ghostty spells it:
//   font-family, font-size (13), theme ("light:fabrika-light,dark:fabrika"), cursor-style ("block"),
//   cursor-style-blink (false), cursor-color, background, foreground, selection-background,
//   selection-foreground, palette ("N=COLOR", N from 0 to 15), scrollback-limit, keybind ("trigger=action")
//   history-limit (1,000): no Ghostty command-history key; this follows its *-limit spelling (0586).
```

Where each file goes, by `next/AGENTS.md`'s libfabrika test:

- The two frames, their budget, the runner's in-memory terminal, the window machine's routing and
  the `[terminal]` settings go in libfabrika: any client that draws a `fabsh` tile needs them.
- The reader, the editor, the history program, the echo machine and the terminal window go in
  `next/programs/fabsh`: they are this program's, as the counter's window is the counter's.
- tezgah's change (a new tile runs `fabsh`; a foreground child shows in the tile) stays in
  `next/programs/tezgah`.

## One value traced through

A person in a browser tab types `countr` and Tab in tile `tile_01k`, which runs `fabsh:tile_01k`.

1. ghostty-web's `onData` gives `"c"`. The window's echo machine predicts it: it writes
   `fabsh$ c` at once (prediction, 0275) and sends `process.keys {data: "c"}`.
2. The gateway checks the session and the key, spends one unit of `gateway.keys-limit`, never
   `gateway.limit`, and hands the frame to the runner. Nothing is written.
3. The runner steps the editor in memory: the line is `{left: "c", right: ""}`. It reads the line's
   roles: `c` names no program yet, but it is the word under the cursor, so it is not the error
   role until a space or Enter ends it (80%, as fish waits for the word's end). The
   editor answers `write {bytes: "\r\x1b[Kfabsh$ c "}`.
4. The runner sends `process.screen {seq: 1, data}` to the tile's watchers. The window's echo
   machine sees the confirmed line equal its prediction and drops the pending key.
5. `ountr`, then Space. The reader now has a finished first word with no program of that name: the
   span is `{start: 0, end: 6, role: error {reason: "no program is named countr"}}`, drawn as
   `\x1b[4;31mcountr\x1b[0m`, red by the theme's palette index 1 and underlined.
6. Enter. The editor asks `submit {line: "countr"}`. The runner sends it as one saved letter, as
   any input is sent. The program's check refuses it: `fabsh: no program named countr. Did you mean
   counter?`, printed above a new prompt. The line is mailed to `fabsh-history:<person>`, which
   mails the list back, and Up in another tile now shows `countr`.

## Decided in one line

- The ephemeral frames are `process.keys` and `process.screen`, raw bytes as today's port messages
  are, on the sync note's one lane (0275, the sync note; 75%, the doubt at the top).
- Echo predicts printable text at the cursor, Backspace and Left and Right only, as mosh does;
  everything else waits for the process (0275; 85%).
- History is one process per person that mails its list to its `fabsh` subscribers (today's shared
  history, OTP's `pg`; 70%. The doubt: a second shape, each `fabsh` process reading the history
  process's view, may fit better once a process can watch a view. That would not change a law).
- A line that starts with `#` is a room line, so join's `#bug-17 <text>` reads; a `#` later in a line
  is still a comment, as in tsh (0159's lines, 0586's join section; 85%).
- A word still being typed is never the error role; it is judged once a space, an operator or Enter
  ends it (fish's behavior; 80%).
- `cursor-style-blink` defaults to `false`, today's choice, where Ghostty blinks (today's
  `terminal.ts` keeps the cursor still on purpose; 85%).
- `cursor-style = "block_hollow"` and a `palette` index past 15 are refused at load with the reason
  "ghostty-web 0.4.0 does not draw it", as 0278 refuses a key a backend cannot have (85%).
- `scrollback-limit` keeps Ghostty's unit, bytes. The builder reads ghostty-web 0.4.0's
  `scrollback` option first; if it counts lines, the key is left out of v1 and the README says why,
  rather than a Ghostty name with another unit (80%).
- `[terminal] keybind` takes only terminal actions (copy, paste, the three font sizes,
  `clear_screen`); a window command stays in fabrika's key table (0278), so the two never bind one
  key twice. A clash between them fails at load (80%).
- A new tile runs `fabrika/fabsh`, tezgah's `NEW_TILE` named in its README as waiting for the shell
  (85%).
- `$( )`, `&&`, `||` and `;` come in S3 with job control, since each needs a finished process's
  status or output (90%).
- Ctrl-B is the window's prefix (0278), so readline's `backward-char` on Ctrl-B never reaches
  `fabsh`; Left does it. The prefix pressed twice sends one Ctrl-B on, as tmux's `send-prefix`
  does (90%).

## Linear, per screen

- **The terminal tile.** Linear has no terminal. Built by Linear's team as a fabrika program, it
  would be one quiet surface: no box around the line, the theme's own colors, the type crisp at
  every size, and the same speed as a native terminal. We follow that: a canvas, no extra frame,
  colors from the one theme.
- **Where Linear would do more.** Every command would also be in Cmd-K, and a refusal would offer
  its fix as a button. In v1, every built-in is also a palette entry (0278); a "did you mean" stays
  text, as in bash.
- **What today's terminal does that Linear's would not.** It rings a bell; it prints `^C`; it speaks
  in `%1` job numbers; a refusal is a line of text, not a hint under the word; settings are a text
  file with Ghostty's names, not a settings page. Each stays in v1, because 0586 makes today's
  terminal the bar; the later program may change them.

## Show it running

- **The look step runs before S2's pull request opens**
  ([guidelines skill, step 5](../../../.claude/skills/guidelines/SKILL.md#5-build-3-or-4-designs-and-look-at-them-next-to-linear)).
  Since 0586 fixes what the terminal is, the 3 or 4 designs vary only what it leaves open: the
  role-to-palette map, the prompt (`fabsh$ ` plain or with the program's color), the padding
  inside the tile, and the error mark (underline, or underline and bold). Each is shot beside
  Linear at the five layouts, and the owner picks one. The plan's map above is a sketch until then.
- **Shots,** from the real built app with its own `FABRIKA_HOME` in a temp folder, attached and
  never committed (0160), for each state: an empty prompt, a highlighted line with an error, Tab's
  list, Ctrl-R, a running foreground program, a job's status row. Each at one tile filling the
  window, two side by side, two stacked, a 2x2 grid, and a 1024x700 window. The pull request says
  what squeezes or breaks in each.

## Existing tools

Searched GitHub code for this repo's `readline` and `ghostty` names, then searched its local
shell, editor, runtime, client, settings and tezgah files. Read the matching contracts and relevant code paths.
Also searched npm for shell parsing, terminal rendering, ANSI matching and cell widths. The
lockfile pins ghostty-web 0.4.0, Effect 4.1.3 and fast-check 4.10.2. This search adds no package.
Today's files below are the behavior to rebuild under 0586, never imports into `next/`.

- `next/programs/fabsh/src/words.ts`: searched today's `shell/words.ts` and npm's [shell-quote](https://www.npmjs.com/package/shell-quote). shell-quote reads shell quoting; tsh also needs source positions and its own operators. Rebuild today's word reader.
- `next/programs/fabsh/src/grammar.ts`: searched today's `shell/grammar.ts` and shell-quote. The existing tsh grammar has named inputs, outputs, substitutions and agent prose; retain that grammar rather than replace it with a general shell parser.
- `next/programs/fabsh/src/check.ts`: searched today's `shell/check.ts` and libfabrika's program declarations. Reuse those declarations for checks; the tsh-specific line check is rebuilt here.
- `next/programs/fabsh/src/roles.ts`: searched today's word positions and check results, plus [fish's highlighting](https://fishshell.com/docs/current/interactive.html#syntax-highlighting). Derive roles from this one reader; no second parser or new highlighting package.
- `next/programs/fabsh/src/complete.ts`: searched today's `shell/complete.ts` and [Node readline's completer](https://nodejs.org/api/readline.html#use-of-the-completer-function). Today's completion already reads program declarations, jobs and agent names; rebuild it over `next/`'s declarations.
- `next/programs/fabsh/src/editor/keys.ts`: searched today's `editor/keys.ts` and Node readline's key support. Node readline requires Node streams; the byte-to-command reader must also run in the brain without Node streams.
- `next/programs/fabsh/src/editor/editor.ts`: searched today's editor and Node readline. Rebuild the existing pure editor as a tea machine; a Node readline interface cannot be stepped by a browser-compatible parent.
- `next/programs/fabsh/src/editor/search.ts`: searched today's `shell/search.ts` and readline's history support. Rebuild the pure search over the editor's history; no second history or Node interface.
- `next/programs/fabsh/src/editor/screen.ts`: searched today's `editor/screen.ts` and npm's [ansi-regex](https://github.com/chalk/ansi-regex). ansi-regex matches escapes; it does not draw this editor's prompt and cursor. Rebuild today's screen functions and keep program text unable to control the terminal.
- `next/programs/fabsh/src/editor/cells.ts`: searched today's `editor/cells.ts` and npm's [string-width](https://www.npmjs.com/package/string-width). string-width measures columns; this editor needs Ghostty's exact wrapping, grapheme and variation-selector behavior. Rebuild against the installed Ghostty wasm.
- `next/programs/fabsh/src/editor/cells.table.ts`: searched today's generated table and ghostty-web 0.4.0's wasm. Generate this data from that wasm, not from another Unicode-width table or today's generated file.
- `next/programs/fabsh/table.ts`: searched today's `apps/fabrika/table.ts` and `editor/cells.probe.ts`, plus string-width. Use today's probing method against the installed wasm; no generic width package supplies its exact cell facts.
- `next/packages/libfabrika/src/runtime/Terminal.ts`: searched `runtime/Runner.ts`, `runtime/Program.ts` and [ghostty-web](https://github.com/coder/ghostty-web). Ghostty renders bytes; the runner still needs the in-memory editor and screen beside its saved model. Keep that runner-specific work here.
- `next/programs/fabsh/src/program.ts`: searched `runtime/Program.ts` and tezgah's `program.ts`. Use the existing `Program.make`, machine and runner contracts; this file supplies only fabsh's behavior.
- `next/programs/fabsh/src/history.ts`: searched today's `editor/history.ts`, the process mail API and Node readline's history. Preserve today's shared history through one regular process and saved mail, with the declared limit; no separate storage service.
- `next/programs/fabsh/src/echo.ts`: searched today's terminal and 0275's local-echo rule. Ghostty supplies the terminal renderer, not this protocol's prediction and confirmation machine; keep those transitions in one tea machine.
- `next/programs/fabsh/src/window.ts`: searched today's `window/terminal.ts` and ghostty-web's browser renderer. Use ghostty-web for the terminal; this adapter connects the existing window protocol, settings and screen-reader regions.
- `next/programs/fabsh/src/builtins.ts`: searched today's `shell/builtins.ts`, `shell/help.ts` and `shell/table.ts`, plus the program loader. Rebuild the declared built-ins on existing runtime calls rather than add a shell execution library.
- `next/programs/fabsh/src/jobs.ts`: searched today's shared job table and libfabrika's process and mail APIs. Rebuild the `%n` table with those APIs; a Node shell's child-process table is not the brain's processes.
- `next/programs/fabsh/src/run.ts`: searched today's `shell/execute.ts`, the grammar and libfabrika's start and mail calls. Rebuild statement ordering over those existing calls; this does not add a second execution engine.
- `next/packages/libfabrika/src/runtime/Program.ts`: searched its constructor and declarations. Extend the existing program contract for a terminal editor; no parallel constructor.
- `next/packages/libfabrika/src/runtime/Runner.ts`: searched its existing step, save and watcher paths. Route ephemeral keys to the in-memory terminal and retain saved input handling for submissions; no second runner.
- `next/packages/libfabrika/src/gateway/Gateway.ts`: searched its existing session, access and budget checks. Add the two frame cases there, retaining those checks rather than create another gateway.
- `next/packages/libfabrika/src/client/WindowMachine.ts`: searched its routing and watch states. Add terminal frames to that parent, using the same connection and watch lifecycle.
- `next/packages/libfabrika/src/client/Prefix.ts`: searched its existing prefix machine. Extend its double-prefix result; do not make another prefix handler in fabsh.
- `next/packages/libfabrika/src/settings/Declarations.ts`: searched its existing `Setting.make` declarations and the settings note. Declare terminal choices once there, including `history-limit`; no hand-written config reader.
- `next/programs/tezgah/src/program.ts`: searched its `NEW_TILE` and child lifecycle handling. Use its existing tile and monitor behavior to show fabsh and foreground children.

## Files

| File | Owner | Slice | Product lines expected |
|---|---|---|---|
| next/programs/fabsh/package.json | tests | S1 | tests |
| next/programs/fabsh/tsconfig.json | tests | S1 | tests |
| next/programs/fabsh/README.md | build | S1, S2, S3 | docs |
| next/programs/fabsh/src/words.ts | build | S1 | 160 |
| next/programs/fabsh/src/grammar.ts | build | S1 | 450 |
| next/programs/fabsh/src/check.ts | build | S1 | 400 |
| next/programs/fabsh/src/roles.ts | build | S1 | 150 |
| next/programs/fabsh/src/complete.ts | build | S1 | 280 |
| next/programs/fabsh/src/reader.laws.test.ts | tests | S1 | tests |
| next/programs/fabsh/src/complete.laws.test.ts | tests | S1 | tests |
| next/programs/fabsh/src/editor/keys.ts | build | S1 | 200 |
| next/programs/fabsh/src/editor/editor.ts | build | S1 | 820 |
| next/programs/fabsh/src/editor/search.ts | build | S1 | 160 |
| next/programs/fabsh/src/editor/screen.ts | build | S1 | 240 |
| next/programs/fabsh/src/editor/cells.ts | build | S1 | 370 |
| next/programs/fabsh/src/editor/cells.table.ts | build | S1 | 85 |
| next/programs/fabsh/table.ts | build | S1 | 60 |
| next/programs/fabsh/src/editor/editor.laws.test.ts | tests | S1 | tests |
| next/programs/fabsh/src/editor/keys.laws.test.ts | tests | S1 | tests |
| next/programs/fabsh/src/editor/cells.laws.test.ts | tests | S1 | tests |
| next/programs/fabsh/src/editor/screen.laws.test.ts | tests | S1 | tests |
| next/packages/libfabrika/src/runtime/Program.ts | build | S2 | 60 |
| next/packages/libfabrika/src/runtime/Runner.ts | build | S2 | 180 |
| next/packages/libfabrika/src/runtime/Terminal.ts | build | S2 | 120 |
| next/packages/libfabrika/src/runtime/Terminal.laws.test.ts | tests | S2 | tests |
| next/packages/libfabrika/src/gateway/Gateway.ts | build | S2 | 90 |
| next/packages/libfabrika/src/gateway/Keys.laws.test.ts | tests | S2 | tests |
| next/packages/libfabrika/src/client/WindowMachine.ts | build | S2 | 100 |
| next/packages/libfabrika/src/client/WindowMachine.laws.test.ts | tests | S2 | tests |
| next/packages/libfabrika/src/client/Prefix.ts | build | S2 | 20 |
| next/packages/libfabrika/src/client/Prefix.laws.test.ts | tests | S2 | tests |
| next/packages/libfabrika/src/settings/Declarations.ts | build | S2 | 200 |
| next/packages/libfabrika/src/settings/Terminal.test.ts | tests | S2 | tests |
| next/programs/fabsh/src/program.ts | build | S2, S3 | 500 |
| next/programs/fabsh/src/program.laws.test.ts | tests | S2, S3 | tests |
| next/programs/fabsh/src/history.ts | build | S2 | 130 |
| next/programs/fabsh/src/history.laws.test.ts | tests | S2 | tests |
| next/programs/fabsh/src/echo.ts | build | S2 | 160 |
| next/programs/fabsh/src/echo.laws.test.ts | tests | S2 | tests |
| next/programs/fabsh/src/window.ts | build | S2 | 400 |
| next/programs/fabsh/src/window.laws.visual.test.ts | tests | S2, S3 | tests |
| next/programs/tezgah/src/program.ts | build | S2, S3 | 140 |
| next/programs/tezgah/src/program.laws.test.ts | tests | S2, S3 | tests |
| next/programs/tezgah/README.md | build | S2, S3 | docs |
| next/programs/fabsh/src/builtins.ts | build | S2, S3 | 380 |
| next/programs/fabsh/src/jobs.ts | build | S3 | 320 |
| next/programs/fabsh/src/run.ts | build | S3 | 300 |
| next/programs/fabsh/src/builtins.laws.test.ts | tests | S2, S3 | tests |
| next/programs/fabsh/src/jobs.laws.test.ts | tests | S3 | tests |
| next/apps/fabrika/src/fabsh-runner.laws.integration.test.ts | tests | S3 | tests |
| next/apps/fabrika/e2e/fabsh.visual.test.ts | tests | S4 | tests |
| next/apps/fabrika/package.json | tests | S2 | tests |
| layer-rules.json | tests | S1 | tests |
| boundary-rules.json | tests | S1 | tests |
| .oxlintrc.json | tests | S1 | tests |
| pnpm-lock.yaml | tests | S1 | tests |
| .glossary/TERMS.md | build | S1, S2 | docs |
| docs/direction/follows/README.md | build | S2 | docs |
| docs/plan/tier-1.md | build | S1, S2, S3, S4 | docs |

`cells.table.ts` is written by running `table.ts` against ghostty-web 0.4.0's own wasm, as today's
table is made, never copied from today's file.

## Laws

| # | Law | Kind | Generator | Inputs and runs | Plant | Slice |
|---|---|---|---|---|---|---|
| L1 | Every word of a parsed line gets exactly one role: the spans are in order, never overlap, and cover every character that is not a space | test | Effect Arbitrary: Schema.String | lines over tsh's characters, words, quotes and operators, 500 runs | drop the span of a closing quote | S1 |
| L2 | A finished first word that names no program and no built-in is the error role, and a name in the list never is | test | Effect Arbitrary: Schema.Struct | a program list and a word drawn in or out of it, 300 runs | give an unknown first word the program role | S1 |
| L3 | A theme change changes the drawn colors and never the roles: a line's bytes are the same under any two themes, and the color drawn for a role is that theme's palette at the role's index | test | Effect Arbitrary: Schema.Tuple | two themes from the design package's palettes and a line, 200 runs | write a theme's 24-bit color into the bytes | S2 |
| L4 | A pipe whose writer's output fits no reader input, by 0550's needed-fields rule, is the error role on its `\|`, and one that fits never is | test | Effect Arbitrary: Schema.Struct | two declared shapes with fields added or removed, 300 runs | fit on an exact match, as today's tsh does | S1 |
| L5 | The error role is underlined as well as colored, so color is never its only mark (WCAG 1.4.1) | test | Effect Arbitrary: Schema.String | unknown program words and lines, default runs; inspect their error SGR bytes | drop SGR 4 | S1 |
| L6 | Each token's text comes from its own place on the line, and a word still being typed at the cursor is never the error role | test | Effect Arbitrary: Schema.String | lines cut at a random cursor, 300 runs | judge the word under the cursor | S1 |
| L7 | Each Tab candidate starts with the word typed, and a line with one candidate put in reads that word in a role that is not error | test | Effect Arbitrary: Schema.Struct | program lists, jobs and a cut line, 300 runs | offer every program after a pipe | S1 |
| L8 | After any keys at the prompt, the grid shows the prompt, then the line, and the cursor sits at the cell `spot` gives the left part | test | fc.commands | every bound key and text runs, at widths 10 to 200, 300 runs | count a wide character as one cell | S1 |
| L9 | Kill then yank puts back what was killed; kills in a row join; Alt-Y walks the ring; undo returns each earlier line in order | test | fc.commands | kill, yank, yank-pop and undo keys on random lines, 300 runs | let a move between kills join them | S1 |
| L10 | History keeps each line once, newest last, at most `terminal.history-limit`; Up then Down to the bottom gives back what was typed | test | fc.commands | configured limits including 1,000; submits and Up and Down keys, 300 runs | keep a repeated line twice | S1 |
| L11 | Ctrl-R shows the newest line that holds the query, Ctrl-S the next newer one, and Esc, Ctrl-G or Ctrl-C give back the line typed before | test | fc.commands | queries and search keys over a random history, 300 runs | start the search from the oldest line | S1 |
| L12 | Keys typed while a line runs go to the next prompt in order, and Ctrl-C drops them and reaches the process at once | test | @demlik/tea/pbt.arbMsgSequence | machine message walks, default runs | send Ctrl-C after what waits | S1 |
| L13 | A paste inside bracketed-paste marks goes in as text, and none of its newlines submits a line | test | Effect Arbitrary: Schema.String | pasted texts with newlines, 300 runs | read a newline inside the marks as Enter | S1 |
| L14 | `spot` counts cells as ghostty-web 0.4.0's wasm does, and the table matches the wasm code point by code point | test | vector: ghostty-web 0.4.0's wasm, read by `table.ts` | the wasm vectors, every code point | count U+FE0F as a cell after any character | S1 |
| L15 | A program's text cannot move the cursor or retitle the window | test | Effect Arbitrary: Schema.String | texts with escape sequences, 300 runs | let OSC through | S1 |
| L16 | No key frame is saved: after any keys and submits, the ledger and the process store hold each submitted line once and no key bytes and no partial line | test | fc.commands | keys, submits and restarts on the runner's stand-in, 200 runs | save the line in the saved model | S2 |
| L17 | A submitted line reaches the process as one saved letter, as typed | test | Effect Arbitrary: Schema.String | lines, 300 runs | trim the line | S2 |
| L18 | The gateway answers `process.keys` only for a live session on its own budget `gateway.keys-limit`, never spending `gateway.limit`, and records nothing | test | fc.commands | keys from live, ended and other sessions, 200 runs | spend `gateway.limit` | S2 |
| L19 | Once the last key is confirmed, the line the window draws equals the process's line, whatever the order the screen frames arrive in | test | fc.commands | keys with confirms delayed, reordered and dropped, 300 runs | predict Tab | S2 |
| L20 | A window that starts to watch a tile gets its screen first, then each frame after it in order, so two windows show the same screen | test | fc.commands | two windows attaching at random times, 200 runs | send frames before the screen | S2 |
| L21 | A line submitted in one tile is in every tile's Up and Ctrl-R, and stays after a restart of the brain | test | fc.commands | submits in three tiles and restarts, on the runner's stand-in, 100 runs | keep the history in each fabsh process only | S2 |
| L22 | All `[terminal]` keys round-trip through TOML; Ghostty-named keys read Ghostty's value forms, `history-limit` reads a positive integer, and unsupported terminal values are refused at their file, line and key with the reason | test | Effect Arbitrary: TerminalSettings | TerminalSettings values, default runs | accept `block_hollow` | S2 |
| L23 | A tile opens ghostty-web with the settings' values, and a `live` change redraws the tile in the new look with what it showed | test | Effect Arbitrary: Schema.Struct | settings values, 100 runs | read font-size once at open | S2 |
| L24 | Every role has one palette index and an underline choice | type | type | all role tags, compiler only | drop `room` from the map | S1 |
| L25 | Nothing in `next/programs/fabsh` imports today's version | lint | lint | package imports, lint only | import `@kampus/fabrika-old` | S1 |
| L26 | `help`, `programs` and `exit` answer as today's do; `programs` is the runner's loader table, sorted | test | Effect Arbitrary: Schema.Struct | loader tables, 100 runs | list only started programs | S2 |
| L27 | A pipe, `summon`, `@name` or `#room` line is read and colored, and Enter refuses it in words that name the quest that builds it | test | Effect Arbitrary: Schema.Union | one line of each kind with random words, 100 runs | run the first program of a pipe | S2 |
| L28 | The prefix pressed twice sends one Ctrl-B on to the tile, and the prefix alone never reaches it | test | @demlik/tea/pbt.arbMsgSequence | prefix message walks, default runs | pass the first Ctrl-B on | S2 |
| L29 | A program with a view run in the foreground shows in the tile and the tile goes back to fabsh when it ends; Ctrl-C stops it; `&` gives the prompt back at once; `attach %n` brings it forward | test | fc.commands | starts, ends, Ctrl-C and attach on tezgah's stepper, 200 runs | leave the tile on the ended process | S3 |
| L30 | A start from a line is checked against the member who typed it, and fabsh holds no start grant (0170) | test | fc.commands | lines from members with and without a role, 100 runs | judge the start by fabsh's own grant | S3 |
| L31 | `;` runs each statement, `&&` only after status 0, `\|\|` only after another, and `$( )` puts a finished process's output into the line by its shape | test | fc.commands | chains of statements with random statuses, 200 runs | run `&&`'s right side on any status | S3 |
| L32 | `jobs`, `ps`, `stop %n`, `tell %n` and `close %n` act on the job table every tile shares, and a job's `%n` is the same in each tile | test | fc.commands | jobs begun and ended across two tiles, 200 runs | number jobs per tile | S3 |
| L33 | The screen's text region, the status region and the replies region hold the grid's text, at most once a frame, every 3 s and 50 lines | test | scenario: a long print, a status that changes each second, 60 replies | long print, status each second, 60 replies | write the status on each change | S2 |
| L34 | The whole suite on a real local instance, in a browser tab | test | scenario: the suite's lines typed into a real tab | real-browser run of L19, L20 and L29 | none: it runs L19, L20, L29 against the real runner | S3 |
| L35 | The same suite in the real built Electron app | test | scenario: the suite's lines typed into the real app | the L34 suite in the real app | none: it runs L34's steps there | S4 |

All property laws use `it.prop` or `it.effect.prop` through the shared test package (0579).
The Schema constructors in the table describe the inputs, not a second set of production types:
use the existing domain Schema where there is one, with its Arbitrary constraints covering the
listed characters, lists, cursor positions, widths and boundary cases. Keep every listed run count.

**State-aware generator exceptions (0411, 0579).** L8-L11, L16, L18-L21 and L29-L32 keep
`fc.commands`: the next command is drawn from the model's legal moves as the walk proceeds.
A Schema for one command cannot by itself generate that state-dependent walk. Generate each
command's data from its domain Schema, preserve the table's run counts and boundaries, and use the
property runner rather than a hand-written `fc.assert`. L10 also generates the configured history
limit and checks retention against that value, with 1,000 included. L12 and L28 keep tea's own
machine-law generators. L14 keeps its exact wasm vector. L33-L35 remain scripted browser or Electron checks.

**Lint, type or test.** L24 is a type law (a `Record` over the role's tags); L25 is the
package-imports lint that holds today; the rest are tests, because each checks behavior.

**Which laws need a browser or Electron.** L33 and L34 live in `window.laws.visual.test.ts` (a
browser, through Playwright). L35 lives in `next/apps/fabrika/e2e/fabsh.visual.test.ts`. Every
other law is plain and runs on each pull request: the reader, the editor and the echo machine are
pure; the runner's laws use the runner's stand-in layers; tezgah's use its stepper.

**Why one law is `.integration.`** `fabsh-runner.laws.integration.test.ts` holds L34's run against
a real local instance, because only a real runner shows the gateway, the frames and the ledger
together. Every law it reaches also has a plain version on the stand-in (L16 to L21, L29), so a
pull request still checks the behavior (0581).

## Host-only laws

L35 runs in the real built Electron app on eligible disposable macOS CI, before the first
implementation review (0178, amended by 0594). It never runs on the owner's laptop. The lead reads
the test's launch, signal and cleanup paths before selecting its CI route. A workflow proves only
the laws it actually runs; missing remote proof remains missing proof. The app's test-window rules
still apply: its own `FABRIKA_HOME` in a temp folder, never in the foreground.

## What it records, and what is lost if not

- **Each submitted line,** as a saved letter, with its sender and `sentAt`: the history and an
  audit of what a person ran. Lost for good if not saved at Enter.
- **A refusal's reason and place,** in the process's log with the line, so a later look can count
  what people mistype.
- **One client row per submitted line, with counts and no text:** how many keys, how many were
  predicted, how many predictions the process overwrote, and the longest wait for a confirm. Wide
  events; nothing reads them yet, and they are the only record of how echo feels.
- **Not recorded, on purpose:** key bytes and the line before Enter (0275), and the screen's bytes.

## Is this a setting?

| Choice | A setting? | Why |
|---|---|---|
| Font, size, theme, cursor, colors, scrollback, terminal keys | yes, `[terminal]` | 0586 |
| History length | yes, `terminal.history-limit` | positive integer, default 1,000 from today's editor; declared once, person scope, read through the settings system (0069). Ghostty has no command-history key; `history-limit` follows its `*-limit` spelling (0586) |
| The role-to-palette map | no | the theme's 16 colors already are settings (`palette`); a second map would be two places to set one color |
| `gateway.keys-limit` | yes | a budget per key, as `gateway.limit` is |
| The prompt `fabsh$ ` | no | the summon guidelines' R5 fixes the word |

## Clashes with the parked pull requests

Both stay open and unmerged, and no v1 commit builds on their branches (0586).

- **PR 1232** (https://github.com/kamp-us/tea-fabrika/pull/1232):
  - It adds `process.draft` (the line as text) and `gateway.draft-limit`. v1 adds `process.keys`
    and `process.screen` and `gateway.keys-limit`. If 1232 ever merged, the runner would have two
    ways to reach a typed line.
  - It draws the line as role-colored spans in a Manti view. v1 draws roles as ANSI codes inside
    Ghostty. Both read roles from one reader, but they are two readers with two role lists
    (1232's verb, keyword, name-new, word, unknown; v1's thirteen).
  - It adds `next/programs/fabsh` and `@kampus/fabsh`, the same folder and name as v1. 1232 stays
    parked as 0586 requires. Its overlapping paths are a future conflict to resolve if its later
    program resumes; this plan does not authorize renaming or closing it.
  - It adds a built-in `programs` Cmd in `runtime/Programs.ts`. v1 builds its own; the name may
    collide.
- **PR 1254** (https://github.com/kamp-us/tea-fabrika/pull/1254):
  - F2 (sans for what fabsh says) clashes with v1, where everything in the terminal is mono, as
    today's is.
  - F3 (a role shown by weight and a word, never by hue) clashes with v1's colors by role, which
    0586 decides.
  - F4 (one state word per line) and design B (blocks) have no place in v1.
  - It names readline keys such as Ctrl-W against 0278 as a clash. v1 has every readline key; only
    Ctrl-B is the prefix's, and Ctrl-W, Ctrl-T and Ctrl-N in a browser on Linux go to the browser,
    said in the README.

## Validation

The test writer and the builder run, under the machine caps: `pnpm format`, `pnpm lint`, the
verified-safe narrow vitest paths of the files in their slice, under the current worker caps.
The lead runs the changed checks and one `pnpm typecheck` at the end. Real Electron, launchd and
real process-signal laws run only on eligible disposable CI away from the owner's laptop (0594),
with required proof before the first implementation review. Other real-resource and visual laws
follow 0536 as amended by 0581, 0584 and 0590; L35 follows the host-only section above.

## Risks and what this plan cannot tell us

- How echo feels at real network delay on the cloud instance. The client row's counts are the only
  measure, and they come after S2.
- Whether ghostty-web 0.4.0 gives selection and clipboard well enough for copy and paste. The
  builder reads it first; if it does not, that gap is a ticket and a patch (pnpm patch).
- Whether a runner process that sleeps keeps its in-memory line. A line being typed may be lost
  when the process's object sleeps; history and jobs are saved. The plan accepts that and says it
  in the README.
- The history shape is 70%, as above.
- The settings engine is moving to `@kalfa/config` (ticket 1076,
  https://github.com/kamp-us/tea-fabrika/pull/1427). If it lands first, the `[terminal]`
  declarations move with it; the keys do not change.

## Open questions

None.

No new owner decision is needed to approve this plan's implementation choices: they build 0586,
0275 or a settled note. The lead should read the frame call at the top first. The later look step
still waits for the owner's choice before S2's pull request opens, as Show it running requires;
this plan does not choose its palette map, prompt treatment, padding or error mark.

## Size

1. S1, the reader and the line editor, pure, with their laws: 3,375 lines.
2. S2, fabsh in a tile: the two frames, the runner's terminal, the window, echo, history, settings,
   `help`, `programs`, `exit`: 1,960 lines.
3. S3, starting programs and job control: 1,140 lines.
4. S4, the Electron app's suite and the shots: 40 lines.

**Steps:** 4 slices, each tests, build and review: 12, plus about 4 likely send-backs (S1's size,
S2's frames).

**Price:** `field/runs/` and the older rows of `field/runs.jsonl` put a tests, build or review step
at about $1.1 to $1.2. S1 and S2 are priced at about 3 times that, S3 at 2 times, S4 at 1.

**How sure:** about 55%. S1 is large, and S2's frames are new to `next/`.

Estimate: 16 steps, $50

## Findings

None.
