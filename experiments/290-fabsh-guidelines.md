---
date: "2026-11-14"
scripts: "none kept: the mockup page and its shoot stayed under runs/ on the study's own machine"
summary: "What should fabsh, the shell in next/, look like, so it reads as a shell and not a form, and as more than a terminal? Reading about 15 makers (POSIX, xterm, zsh, mosh, Warp, fish, Nushell, tmux, Linear, WCAG, ARIA, a Bloomberg Terminal and an airliner's flight computer), plus four designs drawn on the real tokens and shot at five layouts. The makers agree: one prompt, one scrollback, the line where you type, echo at once, and each answer told apart. PR 1232 keeps the echo and the word roles, and breaks the rest: a boxed field, mono for its own words, a scrollback capped at 24rem, and a start that opens no tile. Eight principles, F1 to F8, two of them decided already. Four designs: A a terminal, B blocks, C shell and tiles, D a command menu; the lean is B, 60%, the owner picks. $0."
---

# What should fabsh look like, so it reads as a shell and as more than a terminal?

Read 2026-11-14. **This is reading, plus a look step on mockups.** No model ran and no money was
spent: $0. It feeds the proposed page [fabsh guidelines](../docs/guidelines/fabsh/README.md) and the
private Design canvas "fabsh guidelines".

Which version: all of this is `next/`. Today's version has `tsh`, which this study does not touch
([0432](../.decisions/0432-next-has-fabsh-rethought-from-tsh.md)). "Today" below means fabsh's first
working build, on the open [PR 1232](https://github.com/kamp-us/tea-fabrika/pull/1232), branch
`fabrikalfa/cloud-fabsh` at `cf1a9f0e8`. It is not on main yet, so its `file:line`s are that branch's.

**The scope:** fabsh's own view, the part inside its tile. The chassis (the top bar, each tile's
title bar, the desk, the bottom line) stays as it is. One thing the study seems to want there is a
question for the owner, not a change: whether fabsh's count of jobs running behind you may take the
tile's state slot (smaller call 5).

**How the look step ran.** The designs were not built in the real app. The brief ruled out an
Electron run, and PR 1232's code was not to change, so each design is a mockup page under the
study's own `runs/`: the real `tokens.css` from PR 1232's branch, Manti 0.13.0's stylesheet, tuval's
chassis classes and stylesheet, and a small fake fabsh that answers with PR 1232's own words, plus
the made-up lines listed below. One headless Chromium shot each design at the five layouts, ten key
states at one tile, and 25 presses, each saved with its words on screen and the press that led
there. Today's shots are PR 1232's real ones: two real layouts, three with the desk forced by CSS.
So the designs' shots are mockups, not builds, and the page's "do" shots are owed by the build.

**The answer.** The makers agree on the core of a shell: one prompt, a scrollback that keeps what
ran, and one line where you type, echoed at once. Where they differ is what an answer is. A
classical terminal prints bytes and leaves the reading to you. Warp makes a line and its output one
block. fish reads each word as you type. Nushell makes output typed data, a table you can pipe.
Linear's command menu shows what you can do next, by kind. fabrika is already past a terminal in
five ways, all decided or leaned: output is typed, a pipe is saved program mail, a started program
gets a tile, agents have names you talk to, and each word has a role.

PR 1232 keeps two of these well: letters echo at once with the process confirming them, and every
word of the line being typed shows its role, with a refused word underlined and said in words. It
reads as a form for four reasons: the line is a boxed field below the log, the live line has no
prompt, all its text is mono, and the scrollback stops at 24rem in a tile of any height. A started
program opens no tile, and past lines lose their role marks.

```text
how each tool read does it, one line each
POSIX     ECHO: "input characters shall be echoed back"; canonical mode reads "in units of lines"
xterm     lines "scrolled off the top of the screen" are saved: the scrollback
zsh       the prompt is its own small language: "Prompt sequences undergo a special form of expansion"
mosh      echo before the server answers; "outstanding predictions are underlined"
Warp      "A Block groups commands and outputs into one atomic unit"; the running command stays pinned
fish      reads the line "as it is typed"; errors red; a gray suggestion that Right takes
Nushell   "simple, structured data types"; "The table is a core data structure"
tmux      a status line at the bottom: the session's name and the window list
Linear    a command menu that runs "any command with just a few keystrokes", grouped by what you look at
Bloomberg a typed mnemonic and GO opens a function on a panel, with suggestions as you type
FMS CDU   a scratchpad line; a bad entry stays there with "FORMAT ERROR" until fixed
WCAG      status said "without receiving focus" (4.1.3); color never alone (1.4.1)
```

## What was read

About 15 public pages and PR 1232's code. Quotes are short and checked against the page as fetched
on 2026-11-14. A claim from a training page or a guide that is not the maker's own is marked
**secondary**. One found nowhere is marked **guess**.

### The classical terminal

- **POSIX** defines the two things every terminal shell stands on. "If ECHO is set, input
  characters shall be echoed back to the terminal." And "In canonical mode input processing,
  terminal input is processed in units of lines." [x1] So echo is per letter, and what the program
  gets is a line. 0275 is the same split: keys are drawn at once, a submitted line is a Msg.
- **xterm** keeps "the number of lines to save that have been scrolled off the top of the screen",
  and a scrollbar "so that those lines can be viewed." [x2] The scrollback is the history you read.
- **zsh**: "Prompt sequences undergo a special form of expansion." [z1] The prompt is its own small
  language, and zsh also has a right-hand prompt (`RPROMPT`), named on the same page.
- **mosh** "provides intelligent local echo": "On a bad connection, outstanding predictions are
  underlined so you won't be misled." [m1] This is 0275's speculative echo, and mosh marks what the
  far side has not confirmed yet.

### Past bytes

- **Warp**: "A Block groups commands and outputs into one atomic unit." [w1] A sticky header pins
  "the running command at the top of the screen when scrolling through large Block outputs." [w2]
- **fish**: it "interprets the command line as it is typed and uses syntax highlighting to provide
  feedback." "By default, errors are marked red", such as "Non-existing commands." Autosuggestions
  sit "after the cursor, in a muted gray color", and "it won't execute unless you accept it": Right
  or Ctrl-F takes it. [f1]
- **Nushell**: "Nu models data using a set of simple, structured data types", and "The table is a
  core data structure in Nushell." [n1] It wants "to take the Unix philosophy of shells, where pipes
  connect simple commands together, and bring it to the modern style of development." [n2]

### A pointer and a status line

- **Linear's command menu** "lets you execute any command with just a few keystrokes", and "Groups
  are prioritized based on what you are focusing on" [l1]. Its guide: "Press `Cmd + K` on Mac or
  `Ctrl + K` on Windows, then type the page or action you need." [l2] Its search page types `@ma`
  into the box and shows people as rows, with the typed word as a chip [l3]. Linear Agent's chat is
  one box, "Ask Linear anything...", with suggested asks under it [l4].
- **tmux**: "tmux includes an optional status line which is displayed in the bottom line of each
  terminal." By default it shows "the name of the current session in square brackets; the window
  list". [t1]

### Accessibility

- **WCAG 4.1.3**: status messages "can be programmatically determined through role or properties
  such that they can be presented to the user by assistive technologies without receiving focus."
  [a1] A refusal is said this way, never by moving focus.
- **ARIA's `log` role** marks "a live region where new information is added in a meaningful order",
  and "Elements with the role `log` have an implicit `aria-live` value of `polite`." [a2] That is the
  scrollback.
- **WCAG 1.4.1**: color is never the only way to tell a fact [a3]. A refused word is red and
  underlined and said; a running job is amber and says "running".

### Outside software

- **A Bloomberg Terminal** (finance). You type a function's short name and press the green GO key;
  "pressing the GO button will execute the command", and the terminal opens it on a panel. As you
  type, it "will autosuggest words with the corresponding mnemonic". [o1] **Secondary**: a library's
  guide, not Bloomberg's own. It teaches what fabsh's start is: a typed word opens a working panel
  beside the line, and the line stays a line. What does not carry over: GO is a special key, and
  fabsh keeps Enter.
- **An airliner's flight computer, the FMS CDU** (aviation). The pilot types into one scratchpad
  line, then presses a key beside the field the entry is for. A bad entry stays in the scratchpad
  with a message: "FORMAT ERROR" means "A data entry does not meet the specified entry format for
  a given field." [o2] **Secondary**: a simulator's documentation, not a maker's manual. It teaches
  F3's rule: the line you are typing is checked against what the field takes, and the reason is
  said in words where you are looking. What does not carry over: the CDU refuses only at the press;
  fish and fabsh mark a word as it is typed.

The plain way they agree on: a prompt, a scrollback, one line, echo at once, and each answer told
apart. Where it clashes with a goal of ours, see [the clashes](#the-clashes-with-settled-rules).

## What is settled

| Point | Source |
|---|---|
| fabsh is a regular program in the brain; the window draws typed letters at once and the process confirms them; a submitted line is a Msg; a real terminal is a pty on the hands, never saved | [0275](../.decisions/0275-the-shell-is-a-regular-program.md) |
| fabsh is rethought from tsh, never copied; a `next/` file names `fabsh`, never `tsh` | [0432](../.decisions/0432-next-has-fabsh-rethought-from-tsh.md) |
| each window runs the prefix itself; a key the backend cannot have fails at load; every command also has a shell word and a palette entry | [0278](../.decisions/0278-each-window-runs-its-own-prefix.md) |
| a line fabsh's parser accepts is a picker "Run" row, ranked like any row, run only on Enter; `@` lists people and summoned agents | [0514](../.decisions/0514-a-prefix-narrows-the-picker.md), picker Q6 |
| a pipe is shell syntax over saved program mail, one letter per chunk | [0109](../.decisions/0109-a-pipe-is-saved-program-mail.md) |
| `summon` is the one way to start an agent; `@name` only talks to a name that exists, refused with one guess; an `@` line runs in the background | [0157](../.decisions/0157-summon-starts-an-agent-and-at-talks-to-it.md) |
| the four primitives come first, for real; fabsh's view is in scope; done means the Electron app and a browser tab | [0159](../.decisions/0159-fabsh-pipes-summon-join-first.md) and its amendments |
| a tile shows one process, and follows its `keep` when it ends | [0276](../.decisions/0276-a-tile-shows-one-process.md) |
| a start is checked against the member whose line caused it | [0170](../.decisions/0170-a-start-is-checked-against-its-sender.md) |
| mono only for what a person types or reads as code; the frame's bars stay mono; the rest is sans | [0460](../.decisions/0460-mono-only-for-typed-words.md) |
| the prompt stays `fabsh$`; a plain line is a command; a line to a room starts with `#room` or `@name` | [summon guidelines, R5 as decided 2026-11-07](../docs/direction/summon-guidelines.md#r5-joining-a-room-never-moves-the-tile-a-line-to-a-room-starts-with-room) |
| eight color rules: a color means one thing, never alone, Radix steps for their jobs, two text steps, the accent only for your turn | [color principles](../docs/direction/color-principles.md), [themes](../docs/direction/themes.md) |
| a tile's state is a word; a tile's edge is one outline; no extra containers | [0502](../.decisions/0502-a-tiles-state-is-a-word.md), [0500](../.decisions/0500-a-tiles-edge-is-one-outline.md), AGENTS.md |
| glossary: `fabsh`, "the shell, a regular program with local echo"; `line (runtime)`, programs joined by pipes, each shown in a tile; `pipe`, saved program mail in `next/` | [`.glossary/TERMS.md`](../.glossary/TERMS.md) |

Leaned, not decided: S1, one grammar whose spans have roles that colors, Tab and refusals all read
([summon guidelines](../docs/direction/summon-guidelines.md#s1-one-grammar-typed-tokens-every-view-reads-it),
85%); [fabsh grows into a language](../docs/direction/fabsh-grows-into-a-language.md), a vision.
Nobody has touched: what an answer looks like, where the line sits, what a running job shows, and
how a start is shown in the shell.

The open pull request on the area is PR 1232 itself. It leans: a scrollback above a boxed line,
mono throughout, role marks on the line being typed only, and plain sentences for every answer.

## The clashes with settled rules

A classical terminal is the starting point, and four of its habits clash with a settled rule. The
lean in each is to keep the rule. Each is one line for the owner to pick.

1. **Mono everywhere, against 0460.** A terminal is mono through and through; 0460 makes fabsh's own
   words sans and keeps mono for what you typed. Lean: keep 0460, 80%.
2. **A hue per word, against color principles 2 and 7.** fish and zsh give each kind of word its
   own color; ours say a color means one thing, and the role tokens are the two text steps plus
   `stuck` for a refused word. Lean: keep the principles, and rank roles by weight, 85%.
3. **Readline keys, against 0278.** Ctrl-W deletes a word in bash, and a browser tab on Linux or
   Windows closes on it; 0278 makes a binding the backend cannot have fail at load. Lean: fabsh
   binds only keys every backend has, and every edit is also a word, 80%.
4. **A colored prompt, against the accent rule.** A zsh theme colors its prompt; ours keeps the
   accent for the one action waiting on you. Lean: the prompt is the low text step, 90%.

## Today's fabsh, PR 1232

| What | Today | Where |
|---|---|---|
| The line | Manti's `Input`, a boxed field below the log | `next/programs/fabsh/src/window.tsx:247` |
| The prompt | `›` on past lines, nothing on the live line | `next/packages/tuval/src/window/style.css:189` |
| The font | the whole view is mono, its own sentences too | `style.css:176` |
| The scrollback | a `log` region, capped at 24rem, 56rem wide | `window.tsx:226`, `style.css:180`, `style.css:175` |
| A past line | plain text, no role marks | `window.tsx:229` |
| The line being typed | each word in its role; a refused word red, wavy and said in a polite status | `window.tsx:244`, `window.tsx:274`, `style.css:266-270` |
| `help` | a description list | `window.tsx:126` |
| `history` | numbers padded with spaces into a string | `next/programs/fabsh/src/program.ts:95` |
| A start | "Started c1, a fabrika/counter process.", no tile opens | `window.tsx:161`, shot `4-started` |

Checked against each principle:

| Principle | Today | Why |
|---|---|---|
| F1 a prompt, a scrollback, a line | breaks | a boxed field, no live prompt, a capped log |
| F2 mono for typed, sans for fabsh | breaks | the whole view is mono |
| F3 words with roles | half | the live line follows; past lines lose it; a word being typed is refused before it is whole |
| F4 one line, one answer, one state | breaks | answers have no state word; a refusal is only red text |
| F5 typed answers | half | `help` is a list; `history` and `programs` are strings |
| F6 a start opens a tile | breaks | no tile opens; the receipt does not say where |
| F7 names behind you | not built | |
| F8 one grammar for shell and picker | not built | `next/` has no picker yet |

## What this tells us for fabsh

### F1: a prompt, a scrollback, the line where you type

**Lean, 85%.** Kind: taste.

- **What.** Every line in the scrollback starts with `fabsh$`, and so does the line you type. The
  scrollback fills the tile and keeps the newest in view. The line is a real text field, so IME,
  paste and screen reader editing work, drawn with no box: the tile's edge already draws one.
- **Linear as the builder.** Linear Agent's chat is one box with the answers above it [l4]; on our
  pieces that is the scrollback and the line inside fabsh's tile, with the tile's edge as the box.
- **Elm.** The scrollback is `view` of the saved entries; the line is the tile machine's draft
  (`next/programs/fabsh/src/tile.ts`), echoed at once.
- **Accessibility.** The scrollback is a `log` region, polite [a2]; the line has a label.
- **Doubt.** Whether a field with no box shows focus well enough: the caret and the tile's focus
  edge carry it (WCAG 2.4.7). A real screen reader run settles what is read.
- **Cost.** About 40 lines of CSS and markup.

### F2: mono for what you typed, sans for what fabsh says

**Lean, 80%.** Kind: lint, held by 0460 (its later lint on `var(--mono)` outside typed spans).

- **What.** Your line, a program's name, a path and a usage are mono. fabsh's sentences, a table's
  headers and a state word are sans.
- **Linear as the builder.** Linear's text is sans, with code in mono only where it is code.
- **Elm.** A `code` element in the view marks the typed word; nothing else is mono.
- **Accessibility.** No criterion; the reading rhythm of a sentence in sans is easier on long text.
- **Doubt.** The clash with a terminal's look (clash 1). The owner's eye on the shots settles it.
- **Cost.** Moving the `font-family` from `.fabsh` to the typed parts, about 10 lines.

### F3: every word shows its role, by weight and a word, never by hue

**Lean, 80%.** Kind: law, held by S1's law in `next/programs/fabsh/src/read.laws.test.ts` (every
character in at most one span; a refused line has one `unknown` span with its reason).

- **What.** A verb and a new name are weight 600, a keyword the low text step, a refused word
  `stuck` and underlined with its reason said. Past lines keep their marks. A word still being typed
  is not refused while it can still become a word (`cou` can become `counter`).
- **Linear as the builder.** Linear's search shows a typed `@ma` as a chip with people under it
  [l3]: the word's kind is shown, not only colored.
- **Elm.** One parse, `read`, is the model's; the view only draws its spans.
- **Accessibility.** WCAG 1.4.1 and 4.1.3: the reason is a status, never color alone.
- **Doubt.** Whether weight alone tells a verb from a name at a glance; the 2x2 shots show it.
- **Cost.** The pending-word rule is about 10 lines in `read`'s caller; past lines reuse `layered`.

### F4: one line, one answer, one state word

**Lean, 70%.** Kind: taste.

- **What.** A line and its answer are one unit, and its state is a word with a glyph: done ✓,
  refused ✕, running ●, started → tile. A refused unit says why under its line.
- **Linear as the builder.** An issue row in Linear has its status as a word and a shape; on our
  pieces each scrollback unit carries a state, as a tile's state is a word (0502).
- **Elm or OTP.** A unit's state is a fold of its entry's `_tag`; a background job is a process, and
  its state comes from its monitor, as OTP's `monitor` tells a parent.
- **Accessibility.** WCAG 1.4.1: the word carries the state, the color only repeats it.
- **Doubt.** This is the main fork between design A and B. Whether a state word on every unit is
  noise in a long scrollback; settled by the owner's look at the 2x2 and small shots.
- **Cost.** About 60 lines in the view.

### F5: answers are typed, and drawn by their type

**Lean, 80%.** Kind: law: the view picks a part by the answer's tag and never parses a string.

- **What.** Rows are a table, a usage is a description list, a refusal is a sentence that names
  the word, a start is a receipt. No answer is a string padded to look like columns.
- **Linear as the builder.** Linear draws an issue the same in every list, from one component; on
  our pieces a row type has one view, so `ps` and `programs` draw rows the same way.
- **Elm.** The `Said` union in `program.ts` already types answers; the view switches on its tag.
- **Accessibility.** WCAG 1.3.1: a table is a `table`, with header cells, so a screen reader reads
  its columns.
- **Doubt.** Where a long table goes: inline, or to `pick` in a tile (design C). The look settles it.
- **Cost.** `history` and `programs` become rows, about 30 lines and their laws.

### F6: a start opens a tile, a pipe is mail, and the shell keeps a receipt

**Lean, 85%.** Kind: law, held by [0276](../.decisions/0276-a-tile-shows-one-process.md) and
[0109](../.decisions/0109-a-pipe-is-saved-program-mail.md).

- **What.** `counter as c1` starts a process, and its tile opens beside the shell. The shell never
  draws another program's view; it keeps one receipt: "Started c1, a fabrika/counter process. It
  opened in tile_3." A pipe's receipt names its letter, as its tiles do (0477).
- **Linear as the builder.** Linear opens an issue in a peek beside the list; on our pieces the
  desk opens the tile and fabsh only says where.
- **OTP.** A start is `spawn`; fabsh's receipt is the reply, and the tile monitors the process
  (0276).
- **Accessibility.** WCAG 4.1.3: the receipt is said in the polite log; focus stays in the shell.
- **Doubt.** The desk program is not built, so where the tile lands is the desk's rule, not fabsh's.
- **Cost.** fabsh asks the desk to show the new process; the receipt names the tile, about 20 lines
  once the desk exists.

### F7: `summon` starts, `@name` talks, and the prompt stays yours

**Decided** by [0157](../.decisions/0157-summon-starts-an-agent-and-at-talks-to-it.md). Kind: law.

- **What.** An `@scout` line becomes a unit that says "running · scout" and gives the prompt back
  at once. The reply lands in that unit. `fg %scout` waits on it. A name nobody summoned is refused
  with one guess.
- **Linear as the builder.** Linear Agent's chat answers in place under the ask [l4]; on our pieces
  the answer lands in the unit that asked, never in a new window.
- **OTP.** A name is `register`; `@scout` is a send to that mailbox.
- **Accessibility.** A reply landing is said in the log, politely.
- **What the look adds.** Only the shape: a running unit, and a count of jobs running behind you
  (smaller call 5).

### F8: one grammar for the shell and the picker

**Decided** by [0278](../.decisions/0278-each-window-runs-its-own-prefix.md) and
[0514](../.decisions/0514-a-prefix-narrows-the-picker.md). Kind: law.

- **What.** Every line fabsh accepts is a picker Run row, and every command has a shell word. The
  shell's Tab and the picker's rows read the same `read`.
- **Linear as the builder.** Linear's command menu runs any command by keystroke [l1]; on our pieces
  the picker is that menu, and fabsh is one of its sources.
- **What the look adds.** Design D tests the other way round, a menu inside the shell, and loses
  (below).

## The four designs

Each is a different answer to "what is fabsh's screen?". Each wrote its pipe line first.

| Design | Pipe line | One line | Lean |
|---|---|---|---|
| A, a terminal | `fabsh` | the line flows right after the last answer; answers in sans; columns as aligned text | 40% |
| B, blocks | `fabsh` | each line and answer is a unit with a state word; tables are tables; the line docked at the bottom | **60%, the lean** |
| C, shell and tiles | `fabsh`, then `programs \| pick` | one line per answer; any rows open in `pick:1`, a tile of their own | lost |
| D, a command menu | `fabsh` | the line on top, what each word can be listed under it, answers newest first | lost |

- **B over A, 60%.** Both pass F1 to F3. B adds F4 for free: a running scout, a refused line and a
  start each say so on the right, so a long scrollback can be scanned. The doubt: in the small and
  2x2 shots, a hairline and a state word on every unit may read busier than a terminal. The owner's
  eye on those shots settles it.
- **C lost on G1 and the daily moment.** `help` costs a tile, and at one tile there is no room for
  it. A short answer belongs where you asked ([program guidelines](../docs/direction/program-guidelines.md), G1).
- **D lost on picker Q9 and on reading order.** A menu inside fabsh is a second list of what the
  picker already lists (G1 R4: "a second list of the same thing is a bug"), and newest-first breaks
  how a scrollback reads.

Linear's closest screens, from its public docs: the search box with `@ma` typed [l3], and Linear
Agent's chat box [l4]. Both put the box where you type and show kinds as words, which B and A share.

## The smaller calls

1. **Where the line sits.** A flows it right after the last answer, as xterm does; B docks it at the
   bottom, as Warp does. **Lean: docked, 60%.** The doubt: a docked line leaves a gap under a
   short scrollback.

   ```text
   flowing   fabsh$ help      docked    fabsh$ help
             ...                        ...
             fabsh$ _                   (empty)
                                        fabsh$ _
   ```
2. **fish's suggestion.** The newest history line that starts with what you typed shows after the
   caret in the low text step; Right takes it. **Lean: yes, 70%.** The doubt: a screen reader hears
   nothing of it until taken; that is fish's behavior too.
3. **A word still being typed.** **Lean: not refused while it can still become a word, 80%.** fish
   marks it red at once [f1]; the CDU waits for the press [o2]. Ours waits for the word.
4. **Past lines keep their marks.** **Lean: yes, 85%.** Today they are plain (`window.tsx:229`).
5. **Where "1 running behind you" shows.** Inside fabsh's view, above the line. **Lean: inside
   fabsh, 75%.** The tile's state slot is the chassis, so using it is the owner's call.
6. **Keys.** Up and Down recall, Tab completes, Right takes a suggestion, Enter runs, Escape does
   nothing (fabsh has no mode). **Lean: these only, 80%;** a readline key that a backend cannot have
   is not bound (clash 3).

What the ledger records: nothing new. A submitted line is already a Msg (0275), and every state
word is a fold of saved entries.

A tryout in today's version: none. tsh is today's shell, and today's version takes only fixes
(0217).

## What it cannot tell us

- **No design was built in the real app.** The shots are mockups on the real tokens and chassis
  classes, with a fake fabsh. The skill wants real builds; this one owes them, after the owner's
  pick. The counter's and checklist's tiles in the shots are drawn from their real words, not their
  real Manti parts.
- **The Design canvas "fabsh guidelines" is made but empty.** The design system is copied in; the
  slides, the prototypes and the shots are not, because the study's session could not attach files
  from its own worktree. The plain walk page holds the four designs, live, beside today's shots.
- **No screen reader ran.** What VoiceOver reads for a unit, a refusal and a reply landing is a
  guess from ARIA's rules.
- **Made up for the mockups:** `summon claude haiku as scout`, `@scout what changed in next/
  yesterday?` and its reply, "Summoned scout, a claude agent on haiku. Talk to it with @scout.",
  "[1] scout is on it. The prompt stays yours; fg %scout waits on it.", `ps` and its columns,
  `programs | pick` and `pick:1`, "1 running behind you", "It opened in tile_3", and `fabsh:2` in
  the 2x2 layout. Everything else on screen is PR 1232's words.
- **One person's eye.** The lean came from the agent that drew them; only the owner's look decides.

## Links

- [x1] POSIX, General Terminal Interface: https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap11.html
- [x2] xterm manual: https://invisible-island.net/xterm/manpage/xterm.html
- [z1] zsh, Prompt Expansion: https://zsh.sourceforge.io/Doc/Release/Prompt-Expansion.html
- [m1] mosh: https://mosh.org/
- [w1] Warp, Blocks: https://docs.warp.dev/terminal/blocks
- [w2] Warp, Sticky Command Header: https://docs.warp.dev/terminal/blocks/sticky-command-header
- [f1] fish, Interactive use: https://fishshell.com/docs/current/interactive.html
- [n1] Nushell, Types of Data: https://www.nushell.sh/book/types_of_data.html
- [n2] Nushell, Introduction: https://www.nushell.sh/book/
- [l1] Linear changelog, the new command menu: https://linear.app/changelog/2019-12-18-new-command-menu
- [l2] Linear, Navigating Linear: https://linear.app/enablement/guide/navigating-linear
- [l3] Linear docs, Search: https://linear.app/docs/search
- [l4] Linear docs, Linear Agent: https://linear.app/docs/linear-agent
- [t1] tmux manual, STATUS LINE: https://man7.org/linux/man-pages/man1/tmux.1.html
- [a1] WCAG 2.2, 4.1.3 Status Messages: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- [a2] MDN, ARIA log role: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/log_role
- [a3] WCAG 2.2, 1.4.1 Use of Color: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- [o1] NYPL, Bloomberg Terminal basics (secondary): https://libguides.nypl.org/BloombergTerminal/basics
- [o2] FlyByWire A32NX, MCDU messages (secondary): https://docs.flybywiresim.com/pilots-corner/a32nx/a32nx-briefing/mcdu/messages/
- PR 1232, fabsh's first build: https://github.com/kamp-us/tea-fabrika/pull/1232
