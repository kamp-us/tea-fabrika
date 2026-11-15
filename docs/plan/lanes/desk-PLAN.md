Approved by the lead agent, builds 0159, 0274, 0277, 0167, 0278, 0272, 0165, 0276, 0170, 0526, 0531; body bd7fc90ffecb
Plancheck-Version: 3

# Plan: The desk program fabrika/tezgah: split, close, move between tiles with the prefix key, in next/

Tracker ticket: "The desk program fabrika/tezgah: split, close, move between tiles with the prefix key, in next/". Its number could not be reached from here. Version: `next/` only. The plan builds on branch `fabrikalfa/cloud-desk-tezgah`, which equals P18 slice 1 (pull request 1208), read at `d25a796`.

```text
A sketch, next/: the lines that work at the end of this lane, in a browser tab and the Electron app.
C-b %      t1 checklist:1  ->  t1 | t2 side by side; t2 runs a new checklist, focus on t2
C-b "      t2 splits down  ->  t2 over t3, focus on t3
C-b o      focus t1 at once (optimistic, 0167); the brain confirms; your place in t1 comes back (0165)
C-b ;      focus back to t3, the tile focused before
C-b x      "close t3? (y/n)"  y  ->  t3 gone, its checklist stopped (shutdown), focus to the next tile in reading order
a small second window on the same workspace   same layout and focus; tiles under 220x120 draw as strips
```

## What it builds

This builds two things from [Tier 1, the four primitives first](docs/plan/tier-1.md):

- The done line "split a second tile, close it and move between tiles with the prefix key, from the desk program `fabrika/tezgah`, never a fixed layout first".
- Piece 2, "A person starts a program, and the desk".

## What the owner sees, slice by slice

1. **S1, nothing on screen yet.** In the brain, a start is checked against the member who caused it (0170), and a program may stop its own child. Every later slice needs both.
2. **S2a, a headless client.** `fabrika/tezgah` runs in the brain, one process per person. A headless window follows its layout instead of a fixed tile list, and a real-instance test splits and closes.
3. **S2b, the browser tab.** The tab draws the workspace from tezgah. `C-b %`, `C-b "` and `C-b x` work, the close asks y/n, and a split with no room is refused in words. This is the first thing the owner sees.
4. **S3, moving between tiles.** `C-b o`, `C-b ;`, the arrows, `h j k l`, F6 where the backend has it, and a click all move focus at once. The brain confirms each move, and a tile keeps its cursor.
5. **S4, a smaller window.** A smaller second window folds tiles under 220x120 into strips (0277).
6. **S5, the Electron app.** The same e2e suite and shots run in Electron, once P19 slice 3 (the Electron client) lands. The row counts as done only after S5 (0159's third amendment).

## How others do it

- **tmux** (man page, read from memory, not fetched):
  - One server per user holds sessions, and each client runs its own key table. `prefix` is an option, `C-b` by default.
  - `%` and `"` split, `x` asks `kill-pane? (y/n)`, `o` goes to the next pane, `;` to the last pane, arrows select a pane, and `send-prefix` passes a literal `C-b` on.
  - A split with no room fails ("create pane failed: pane too small").
  - tmux is the default for tiling, as AGENTS.md says.
- **i3 and AeroSpace:** a container runs in one of two directions, and nested containers alternate. Today's version took this from AeroSpace in 0505.
- **Erlang/OTP:**
  - `supervisor:start_child` is `whereis` and then a start, so a second start of the same name answers `already_started` with the pid. This is already built in `next/packages/libfabrika/src/processes/ChildrenLedger.ts`.
  - `supervisor:terminate_child` lets a parent end its own child with `shutdown`. That is the model for `stop_child` here.
- **Elm:** the window is a parent that steps its children by hand: the prefix machine and the tezgah client. The layout geometry is pure functions. No Cmd runs without a Msg behind it (G4).
- **Optimistic UI with an authoritative server:** Replicache's and Linear's sync engines keep server state and pending mutations apart, and replay the pending ones on each new server state. 0167 names this shape and its words. Neither engine was fetched for this plan.
- **Linear:** it does not tile. Its two-key "G then I" style sequences show a hint after the first key, and Cmd-K lists every command with its key. See "Linear, per screen".
- **Electron on Linux CI:** Electron's docs ("Testing on Headless CI Systems") say to run it under Xvfb. Not fetched; this is from memory.

## What it builds on

Each of these was read whole:

- 0159 and its amendments: the desk comes now.
- 0279's amendment: the fixed layout ends.
- 0274: tezgah's state is a process in the brain.
- 0277: the layout is in percent, one per workspace; focus is mirrored; the viewer folds.
- 0167: focus and cursor move optimistically; layout changes wait for the server.
- 0165: each tile keeps a cursor.
- 0278: each window runs the prefix itself, and a binding on a key the backend cannot have fails at load.
- 0272: the router's six steps.
- 0267: one `commands` field, names that carry their program's name, and a mode read from state.
- 0276: a tile shows one process and follows its `keep`.
- 0170: a start is checked against its member.
- 0211: ids.
- 0491: the word is tezgah, never desk.
- 0217: rethink, do not port.
- Also read: the glossary rows; program guidelines G3 to G5 and "What the ledger records"; the tile guidelines; fold, not tabs; and the desktop layer, W1 to W5.

0503, 0505 and 0506 are written for today's version. Read as lessons for `next/` per 0217, the desk takes these rules and leaves these:

- **From 0503, it takes:**
  - One named region per open tile inside one `main`. Each region is named by one function, `tileName`, program first: `checklist, t2`.
  - `aria-current` on the focused tile.
  - `C-b o`, `C-b ;` and F6 / Shift-F6 mean what they mean in tmux.
  - Desk focus follows DOM focus.
  - After a close, focus goes to the next open tile in reading order. The tile guidelines decided this, and program guidelines stand on it.
  - No motion on a tile.
  - Why: these are accessibility and keyboard rules that do not depend on today's code.
- **From 0503, it leaves:** resize keys, `C-b [` and the covered terminal going inert. This lane has no terminal and no resize mode (0492).
- **From 0505, it takes:**
  - Two directions only, named `dir: "row" | "column"` (0277). Never tabs.
  - A split in the container's own direction adds a sibling; a split the other way nests a new container.
  - Nested containers alternate direction.
  - A settle after every change.
  - A check that refuses a broken tree (law L5).
- **From 0505, it leaves:** `sizes` keyed by node id. In `next/`, `percent` sits on each part (0277).
- **From 0506, it takes:**
  - The last tile of a workspace never closes.
  - Focus is always on an open tile.
  - Programs know nothing about folds.
  - A strip is a real button named by its program.
- **From 0506, it leaves:**
  - A fold stored on the tile. In `next/`, a fold is the viewer's, worked out from the window's size and never stored (0277).
  - `C-b f` and `C-b Space`. This lane is not asked for them.

## The shape

The types are sketches. Effect Schema writes every `_tag`.

```ts
// next/packages/libfabrika/src/tezgah/Workspace.ts: the wire contract any client reads (a new module).
export const TileId = Id.make("tile");             // 0211; a tile is counted too: tezgah prints t<n>
export const WorkspaceId = Id.make("workspace");
export const CursorKey = Schema.String.check(Schema.isMaxLength(80)); // a stable key a view gives (0165)
export const Tile = Schema.Struct({
  id: TileId,
  n: Schema.Int,                       // printed as t<n> by tezgah only; nobody parses it
  shows: ProcessName,                  // the registered name, "checklist:1" or "checklist:tile_01j..."
  program: Schema.String,              // "fabrika/checklist": which window draws it
  child: Schema.Boolean,               // tezgah started it, so a close stops it
  keep: Schema.Literals(["never", "failed", "always"]), // 0276, written now; P18 slice 4 acts on it
  cursor: Schema.NullOr(CursorKey),    // S3; null: never focused, so land at the top
});
type Layout = TileId | { readonly dir: "row" | "column"; readonly parts: ReadonlyArray<{ percent: number; inner: Layout }> };
export const Workspace = Schema.Struct({
  id: WorkspaceId, n: Schema.Int, layout: LayoutSchema, focus: TileId,
  recent: Schema.Array(TileId),        // newest first; C-b ; reads recent[1] (program guidelines G5)
});
export const TezgahView = Schema.Struct({ workspaces: Schema.Array(Workspace), tiles: Schema.Array(Tile) });
```

```ts
// next/packages/libfabrika/src/tezgah/Layout.ts: pure, used by the brain program and by every window.
export const split: (w: Workspace, at: TileId, dir: "row" | "column", tile: TileId) => Workspace; // half of at's share, after it
export const remove: (w: Workspace, tile: TileId) => Workspace;   // share to the part before, then settle
export const order: (layout: Layout) => ReadonlyArray<TileId>;     // reading order
export const neighbor: (layout: Layout, from: TileId, to: "left" | "right" | "up" | "down") => TileId | null; // S3
export const rects: (layout: Layout, size: { width: number; height: number }) => ReadonlyMap<TileId, Rect>;
export const check: (w: Workspace) => ReadonlyArray<Violation>;    // 0505's tidiness, percents sum to 100
// S4, Fold.ts: which tiles draw as strips in this window; the focused tile never does.
export const fold: (w: Workspace, size: Size) => ReadonlySet<TileId>;
```

```ts
// next/programs/tezgah/src/program.ts: fabrika/tezgah, one process per person, "tezgah:<person id>".
const Via = Schema.TaggedUnion({ key: { keys: Schema.String }, click: {}, word: {}, palette: {} }); // the keybindings note's Via
const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("attach"), workspace: Schema.Int, tile: TileId }), // a window's first look: makes workspace n if missing
  Schema.Struct({ type: Schema.Literal("did"), does: Command, from: TileId, via: Via,
    tile: Schema.optionalKey(TileId),                     // split: the new tile's id, minted by the window
    to: Schema.optionalKey(TileId), cursor: Schema.optionalKey(Schema.NullOr(CursorKey)) }), // S3: focus
  // plus the runner's start_child and stop_child answers
]);
const Model = Schema.Struct({
  workspaces: Schema.Array(Workspace), tiles: Schema.Array(Tile), next: Schema.Int,
  starting: Schema.Array(Schema.Struct({ tile: TileId, workspace: Schema.Int, at: TileId, dir: Dir, from: TileId })), // a split waits for its start
});
// refuse: "last_tile", "missing" (from or to is not on the workspace), "id_reused", "no_workspace".
// cmds: [startChild, stopChild]; a split's tile enters the layout on start_child_ok, never before.
```

```ts
// next/packages/libfabrika/src/runtime/StartChild.ts gains OTP's terminate_child (S1).
export const stopChild = Cmd.make("stop_child", { input: Schema.Struct({ name: ProcessName }), ok: Schema.Null, err: ["not_child", "noproc"] });
// The start check is main's, not the desk's (amendment 15): processes/ChildrenLedger.ts's `judge`
// checks the sender of `from.parent` with `StartProgram` on the fabrika (permissions/Model.ts).
```

```ts
// next/packages/libfabrika/src/client/Prefix.ts: one tea machine, the window's key state (0278; 0270: no timer).
const Prefix = Schema.TaggedUnion({ idle: {}, armed: { since: Ms }, asking: { tile: TileId, since: Ms } });
// next/packages/libfabrika/src/client/Tezgah.ts: the window's side, 0167's Model.
const TezgahClient = Schema.Struct({
  workspace: Schema.Int,
  serverState: Schema.NullOr(TezgahView), rev: Schema.Int,
  pendingMutations: Schema.Array(Schema.Struct({ letter: Schema.String, to: TileId, cursor: Schema.NullOr(CursorKey) })), // S3
});
export const optimisticState = (m: TezgahClient) => m.pendingMutations.reduce(applyFocus, m.serverState); // derived, never stored
// next/packages/libfabrika/src/client/Keys.ts: the table is a value the window is handed (keybindings note).
type Binding = { does: Command; keys: ReadonlyArray<Key>; word: string; label: string };
export const load: (bindings: ReadonlyArray<Binding>, backend: Backend) => Result<Table, LoadError>; // a person's row on a `cannot` key fails here
export const route: (table: Table, prefix: Prefix, mode: null, key: KeyEvent) => Routed;             // 0272's steps, in order
```

```text
next/programs/tezgah/src/commands.ts: the defaults (tmux's keys, plus the keybindings note's pipe key and -)
tezgah.split_right      <prefix>%  <prefix>(pipe)   word "split right"    label "Split right"
tezgah.split_down       <prefix>"  <prefix>-        word "split down"     label "Split down"
tezgah.close            <prefix>x                   word "close"          label "Close tile"
tezgah.focus_next       <prefix>o  f6               word "focus next"     (S3)
tezgah.focus_previous   shift+f6                    word "focus previous" (S3)
tezgah.focus_last       <prefix>;                   word "focus last"     (S3)
tezgah.focus_left ...   <prefix>h j k l, arrows     word "focus left" ... (S3)
<prefix> <prefix>       passes the prefix key to the tile's content, as tmux's send-prefix
```

**States** (0037):

- The prefix is `idle`, `armed` or `asking`.
- A split waits in `starting` until `start_child` answers. Then the tile enters the layout; a refusal drops it.
- The window's link to tezgah reuses the window parent's `Reach`, from `unresolved` to `open`.
- The window's focus is the server state plus the pending mutations. The optimistic state is only derived, never stored.

**Placement:**

- `next/packages/libfabrika/src/tezgah/` is a new module at layer 5 (amendment 15). It imports `Id.ts`, and `processes/` for `ProcessName`. `client/`, at layer 7, imports it. A from-scratch client needs these shapes and this geometry, so they go in libfabrika (`next/AGENTS.md`).
- The brain program is `next/programs/tezgah`.
- Tuval only draws, in its `window/` and `dom/` folders.

## One value traced through

`C-b %` in a browser tab at 1440x900. Workspace 1 holds one tile, t1, showing `checklist:1`, and t1 has focus.

1. **Ctrl+B arms the prefix.** Tuval's `dom/keys.ts` sees the keydown and sends `{type: "key", key: "ctrl+b", at}` to the window parent. `Prefix` goes from `idle` to `armed`. The status line shows the prefix line, and the polite region says "prefix". Nothing crosses the wire.
2. **"%" resolves to a command.** `Keys.route` matches step 2 of 0272, the prefix, and gives `tezgah.split_right`. `Prefix` goes back to `idle`. `Layout.rects` says each half of t1 would be 720x868, so the 220x120 floor holds. The window mints `tile_01j...` with `Id.Generator`, the same way it mints letter ids.
3. **The press goes out.** This is the press path built in P18 slice 1. `now` stamps the letter `letter_01j...` and its `sentAt`. Then `process.send` carries `{type: "did", does: "tezgah.split_right", from: <t1 id>, tile: <new id>, via: {_tag: "key", keys: "ctrl+b %"}}` to tezgah's pid. The tab writes client rows `press {command: "tezgah.split_right", via: "key", letter}` and `prefix {does, ms}`.
4. **tezgah takes the letter.** The door stamps the sender. `refuse` sees a fresh id on a known workspace and answers null. The update adds the split to `starting` and returns `start_child {program: "fabrika/checklist", name: "checklist:tile_01j..."}`.
5. **The runner asks, and main's core checks.** The runner calls `Children.start` with `from.parent`, the window letter's id. `ChildrenLedger`'s `judge` asks `Senders` who sent that letter: the founder. `StartProgram` finds the founder's `owner` row on the fabrika, which the boot writes, and lets it through (0170, 0526). `Children.start` writes `started` with `member` set to the founder, and tezgah gets `start_child_ok {started}`.
6. **tezgah changes the layout.** `start_child_ok` runs `Layout.split`: a row with t1 at 50 and t2 at 50, where t2 is `{n: 2, child: true, keep: "failed", cursor: null}`. Focus moves to t2, and `recent` is `[t2, t1]`. A view patch goes to every window on workspace 1.
7. **The window follows.** The window's `Tezgah` child takes the new server state, and the window works out its tiles from it. t2 is new, so the window reads `processes/checklist:tile_01j...` and opens that pid's view.
8. **Tuval draws.** Two regions, `checklist, t1` and `checklist, t2, focused`, with the 4px divider between them. DOM focus goes to t2's body, since its cursor is null. The tab writes the reply row `reply {letter, result: "accepted"}`.

What this records:

- tezgah's inbox letter, with `by`, `sentAt`, `via` and `from`.
- The `started` line. Its `parent` leads back to the member.
- tezgah's view revision.
- The tab's `press`, `prefix` and `reply` rows, which join the tab to the letter.

## The lead's lean, for the owner to read

The settled notes were checked first for each item. The lane goes on with each lean.

**Where tezgah runs: one process per person, `tezgah:<person id>`, started by the brain at boot for the founder (65%).**
- Why: tmux runs one server per user, and i3 and GNOME keep one session per user. Two people should not mirror each other's focus. 0277's mirroring is about one person's windows.
- How the window finds it: the door already decodes `identity.person` on admit (`next/packages/libfabrika/src/transport/Handshake.ts:131`), but the `admitted` state drops it. S2a keeps it. The window then reads `processes/tezgah:<person>` and opens its view.
- The doubt: two people might want to share one desk, as tmux attach does. Invites, in Tier 3, settle it. Switching later loses no fact.

**What a new tile shows while there is no `fabsh`: a new `fabrika/checklist`, named `checklist:<tile id>` (60%).**
- Why: W3 says the shell is "only the default process for a new tile". Until piece 3, the default is the one finished program. A fresh checklist works in full, so it is not a stub.
- It is a constant beside the program, `NEW_TILE`, as the checklist's `LATE` is. It becomes the pack setting `tezgah.new` with P38 slice 5, and `fabsh` becomes its default.
- Workspace 1's first tile shows `checklist:1`, the one the instance boots with. A start of that name answers `already_started`, as OTP's `whereis` does.
- The doubt: an empty checklist per split may read as clutter.

**A close asks y/n, and stops the tile's process when tezgah started it (70%).**
- Why: this is tmux's `kill-pane? (y/n)`, and today's lesson in 0446. The words are the tile guidelines' assertive "close t2? (y/n)".
- The stop is a new built-in, `stop_child`. It is OTP's `terminate_child` with `shutdown`, and it answers `not_child` for a name the requester did not start.
- A tile showing a process tezgah did not start, such as `checklist:1`, closes at once and stops nothing.
- The doubt: a durable program might be meant to outlive its tile. Its ledger keeps every letter either way.

**A split with no room is refused in the window that asked, as tmux refuses it (75%).**
- The window says "No room to split t1" in the polite region and sends nothing.
- A smaller second window folds instead (S4, 0277).

**Focus moves are optimistic now. 0167 and 0159 decide that.** The open parts of 0167 get these leans:
- **Matching an answer to a move (75%):** a pending mutation is one letter, matched by its letter id. It is dropped once its reply has come and a view at or past the reply's revision has arrived.
- **Offline (70%):** an offline window keeps its pending mutations. Its letters are already resent on redial.
- **A jump back (70%):** it is not announced, since the tile guidelines say focus moves say nothing. The window records it as the client row `focus {letter, result: "overridden"}`.

**How a focus move fits 0278 (80%).** The window works out the direction on its own optimistic layout and sends an absolute `to`. Focus is drawn on the key press, and the server applies moves in arrival order.

**The cursor (65%).** tezgah keeps it per tile. It is sent with the focus move that leaves the tile, as the `data-cursor` key of the element that had DOM focus. The checklist gives `item:<name>`.

**The prefix key and bindings.**
- The prefix is `ctrl+b`, from the glossary's `prefix` row.
- The defaults are the table in "The shape" (80% on tmux's letters).
- An unknown key after the prefix disarms the prefix silently and goes nowhere (75%).
- F6 is dropped from a browser tab's defaults where Chrome owns it, on Windows and Linux (65%). It stays in Electron.

**Commands (70%).** One `commands` table sits beside the program, in 0267's shape, and the window is handed it as a value. Moving `commands` into `Program.make` for every program stays ticket 302's job.

**The palette entry (60%).** Each command declares its `label` for the Tier 6 palette and its `word` for `fabsh`. Neither is drawn yet. Open question 1 covers the later file-reading slice.

**Shell words (60%).** `split right`, `split down`, `close`, and `focus next`, `previous`, `last`, `left`, `right`, `up` and `down`.

**Tile ids (70%).** The window mints a new tile's id and sends it in the split letter, the same way it mints letter ids. tezgah refuses a reused id with `id_reused`.

**The look (S2b): B, 70%.** The S2b build builds design B only:
- What B is: the tile guidelines' title bar with its wash, 0492's 4px divider, and the slate focus edge.
- A and C stay as words in the S2b pull request, for the owner's pick:
  - A is tmux-plain: a 1px line and a lit edge.
  - C is Linear-dense: no title bar, and the name in a corner.
- Why B: its tokens and contrast are already measured.
- If the owner picks A or C, it becomes its own change to `style.css` and `Layout.tsx`.

**The Electron half waits on P19 slice 3 (70%).**
- No Electron window client exists in `next/` today. The only Electron use is P19's launchd host check.
- The desk's code is the shared window code: `client/`, and Tuval's `window/` and `dom/`. Nothing is built for the tab alone.
- S5 runs the same suite in Electron.

## Decided in one line

- The word is tezgah in every name, file and command, never desk (0491, the glossary).
- After a close, focus goes to the next open tile in reading order (tile guidelines, decided). The saved model holds the focus that resulted (amendment 3).
- A split's new tile takes half the focused tile's share, after it, and takes focus (program guidelines G3 R3 and G4).
- The last tile of a workspace never closes: `last_tile` (0506's rule, read through 0277).
- Layout changes wait for the server; focus and cursor do not (0167).
- A start from a tezgah letter is checked by main's permission core: the window letter's sender, with `StartProgram` on the fabrika. tezgah holds no start permission of its own (0170, 0526). A start with no person's letter behind it acts as the member its requester was checked against (0531), and only a start with no member at all falls back to `StartGrant` (amendment 15).
- The prefix arms only the window it was pressed in, and only the finished command travels (0278).
- A default on a key the backend cannot have is never shipped to that backend. A person's binding on such a key fails at load (0278).
- The router follows 0272's order for steps 1, 2 and 6. No program has a mode yet.
- A fixed `tiles` list stays only for a headless client started with no desk. Every window with a desk takes its tiles from tezgah (0279's amendment).
- A tile's `keep` is written from its first letter, and P18 slice 4 acts on it (0276).

## Linear, per screen

- **The tiled frame (S2b).** Linear would make it a piece every program gets for free: keyboard first, little chrome, and each action's key shown where the action is. We differ in tiling and the prefix, which are tmux's (W5: where they clash, the prefix wins). We match Linear in having one table: the status line hint, the tooltips and the later palette all read it.
- **The prefix line.** Linear's two-key sequences show what the next key does. Ours shows the same after `C-b`, from the same table.
- **The close ask.** Linear confirms in a small dialog. Ours is one line in the status line, because nothing covers the focused tile and only one modal is open at a time (0265). This is tmux's answer.
- **No room to split.** Linear lays panels out to fit. Ours says it in words, as tmux refuses, and a smaller window folds (S4).
- **Strips (S4).** Linear folds its sidebar to icons. Ours folds a tile to a strip named by its program, never an icon alone (WCAG 1.4.1).

## Show it running

**What this container can run:**
- It is Linux with no display server (`DISPLAY` is unset).
- Playwright's Chromium is installed (`PLAYWRIGHT_BROWSERS_PATH` is set), so headless browser-tab shots and the e2e laws run here.
- Electron 45.2.1 is in the lockfile and in the app's dependencies, but its binary was never downloaded: `node_modules/electron` has no `dist/` and no `path.txt`.
- `xvfb-run` and `Xvfb` are on the PATH. So Electron could run here only after its binary is fetched (its `install.js`, through the agent proxy) and run under `xvfb-run`. Neither was tried.
- macOS window rules cannot be checked on Linux.
- CI runs the visual tests (`*.visual.test.ts`, the `next-visual` Vitest project) on the 3-hour full run, and on a pull request only when it carries the `visual` label. Integration tests (`*.integration.test.ts`, the `next-integration` project) run only on the 3-hour full run (0536, amendment 15).

**How the shots are taken.** Browser shots come from the visual tests, run from the repo root as `SHOTS=<a temp folder under runs/> nice -n 15 pnpm exec vitest run --project next-visual <file>`, on the real `dev.ts` with its own temp `FABRIKA_HOME`. The app's old e2e runner script is gone on main; the `next-visual` project picks up every visual file (amendment 15). Shots come from `page.screenshot`, are attached and are never committed (0160). Each one covers the five layouts, plus 0471's eight in both looks (200% zoom on the 2x2, the smallest tile, 400% reflow).

**Shots per slice:**
- **S2b** (`next/apps/fabrika/e2e/tezgah-frame.visual.test.ts`): one tile; after `C-b %`; after `C-b "`; the 2x2; 1024x700; the close ask; the refused split; the prefix line armed.
- **S3** (`next/apps/fabrika/e2e/tezgah-focus.visual.test.ts`): focus on each tile of the 2x2; back on t1 with its cursor on a row; a second tab mirroring focus.
- **S4** (`next/apps/fabrika/e2e/tezgah-fold.visual.test.ts`): the 2x2 in a second, smaller window at 1024x700 with strips; a strip reached by Tab, with its ring.
- **S5** (`next/apps/fabrika/e2e/tezgah-electron.visual.test.ts`): every state above, in Electron.

Each shot is looked at, and the pull request says what squeezes, breaks or looks empty.

## Files

| File | Owner | Slice | Product lines expected |
|---|---|---|---|
| next/packages/libfabrika/src/access/StartRule.ts | build | S1 (deleted by amendment 15) | deleted |
| next/packages/libfabrika/src/access/StartRule.laws.test.ts | tests | S1 (deleted by amendment 15) | tests |
| next/packages/libfabrika/src/runtime/StartChild.ts | build | S1 | 35 |
| next/packages/libfabrika/src/runtime/Runner.ts | build | S1 | 90 |
| next/packages/libfabrika/src/runtime/StartChildTest.ts | tests | S1 | tests |
| next/packages/libfabrika/src/node/StartChild.integration.test.ts | tests | S1 (amendment 15) | tests |
| next/packages/libfabrika/src/processes/Children.ts | build | S1 | 20 |
| next/packages/libfabrika/src/processes/ChildrenLedger.ts | build | S1 | 40 |
| next/packages/libfabrika/src/processes/ChildrenTest.ts | tests | S1 | tests |
| next/apps/fabrika/src/start-child.laws.integration.test.ts | tests | S1 | tests |
| docs/plan/tier-1.md | build | S1, S2a, S2b, S3, S4, S5 | docs |
| layer-rules.json | tests | S2a | tests |
| boundary-rules.json | tests | S2a | tests |
| pnpm-lock.yaml | tests | S2a | tests |
| next/programs/tezgah/package.json | tests | S2a | tests |
| next/programs/tezgah/tsconfig.json | tests | S2a | tests |
| next/apps/fabrika/package.json | tests | S2a | tests |
| next/programs/tezgah/README.md | build | S2a | docs |
| .oxlintrc.json | tests | S2a | tests |
| next/packages/libfabrika/package.json | tests | S2a | tests |
| next/packages/libfabrika/src/tezgah/Workspace.ts | build | S2a | 130 |
| next/packages/libfabrika/src/tezgah/Layout.ts | build | S2a, S3 | 320 |
| next/packages/libfabrika/src/tezgah/Layout.laws.test.ts | tests | S2a, S3 | tests |
| next/programs/tezgah/src/program.ts | build | S2a, S3 | 340 |
| next/programs/tezgah/src/program.laws.test.ts | tests | S2a, S3 | tests |
| next/programs/tezgah/src/RunnerTest.ts | tests | S2a | tests |
| next/packages/libfabrika/src/client/Tezgah.ts | build | S2a, S3 | 190 |
| next/packages/libfabrika/src/client/Tezgah.laws.test.ts | tests | S2a, S3 | tests |
| next/packages/libfabrika/src/client/WindowMachine.ts | build | S2a, S3 | 230 |
| next/packages/libfabrika/src/client/WindowMachine.laws.test.ts | tests | S2a, S3 | tests |
| next/packages/libfabrika/src/client/WindowStart.ts | build | S2a | 50 |
| next/packages/libfabrika/src/client/WindowStart.laws.test.ts | tests | S2a | tests |
| next/packages/libfabrika/src/client/Headless.ts | build | S2a | 10 |
| next/packages/libfabrika/src/transport/Handshake.ts | build | S2a | 10 |
| next/packages/libfabrika/src/transport/Handshake.laws.test.ts | tests | S2a | tests |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | S2a | 25 |
| next/packages/libfabrika/src/cloudflare/bindings.ts | build | S2a | 10 |
| next/packages/libfabrika/src/cloudflare/platform.ts | build | S2a | 15 |
| next/apps/fabrika/src/brain.ts | build | S2a | 15 |
| next/apps/fabrika/src/runtime.ts | build | S2a | 15 |
| next/apps/fabrika/src/table.ts | build | S2a | 2 |
| next/apps/fabrika/src/tezgah-runner.laws.integration.test.ts | tests | S2a | tests |
| next/packages/libfabrika/src/client/Start.types.test.ts | tests | S2a | tests |
| next/apps/fabrika/src/instance-one-file.integration.test.ts | tests | S2a | tests |
| next/apps/fabrika/src/runtime.laws.integration.test.ts | tests | S2a | tests |
| next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts | tests | S2a | tests |
| next/apps/fabrika/src/checklist-instance.laws.integration.test.ts | tests | S2a | tests |
| next/apps/fabrika/src/start-child.laws.integration.test.ts | tests | S2a | tests |
| .glossary/TERMS.md | build | S2a, S3 | docs |
| next/programs/tezgah/src/commands.ts | build | S2b, S3 | 80 |
| next/programs/tezgah/src/commands.types.test.ts | tests | S2b | tests |
| next/packages/libfabrika/src/client/Keys.ts | build | S2b, S3, S5 | 175 |
| next/packages/libfabrika/src/client/Keys.laws.test.ts | tests | S2b, S5 | tests |
| next/packages/libfabrika/src/client/Prefix.ts | build | S2b | 120 |
| next/packages/libfabrika/src/client/Prefix.laws.test.ts | tests | S2b | tests |
| next/packages/libfabrika/src/transport/ClientRows.ts | build | S2b, S3, S4 | 50 |
| next/packages/tuval/src/window/main.tsx | build | S2b | 110 |
| next/packages/tuval/src/window/Layout.tsx | build | S2b, S3, S4 | 300 |
| next/packages/tuval/src/window/Layout.laws.test.ts | tests | S2b, S4 | tests |
| next/packages/tuval/src/window/style.css | build | S2b, S4 | 100 |
| next/packages/tuval/src/dom/keys.ts | build | S2b | 60 |
| next/apps/fabrika/src/entry/browser.tsx | build | S2b | 15 |
| next/apps/fabrika/src/entry/views.ts | build | S2b | 25 |
| next/apps/fabrika/e2e/tezgah.test-support.ts | tests | S2b | tests |
| next/apps/fabrika/e2e/tezgah-frame.visual.test.ts | tests | S2b | tests |
| next/apps/fabrika/e2e/first-window.visual.test.ts | tests | S2b | tests |
| .oxlintrc.json | tests | S2b | tests |
| next/programs/tezgah/package.json | tests | S2b | tests |
| next/apps/fabrika/e2e/client-protocol.test-support.ts | tests | S2b | tests |
| next/programs/checklist/src/window.tsx | build | S3 | 6 |
| next/apps/fabrika/e2e/tezgah-focus.visual.test.ts | tests | S3 | tests |
| next/packages/libfabrika/src/tezgah/Fold.ts | build | S4 | 140 |
| next/packages/libfabrika/src/tezgah/Fold.laws.test.ts | tests | S4 | tests |
| next/apps/fabrika/e2e/tezgah-fold.visual.test.ts | tests | S4 | tests |
| next/apps/fabrika/e2e/tezgah-electron.visual.test.ts | tests | S5 | tests |

`next/apps/fabrika/e2e/first-window.visual.test.ts` changes only where its tile's name moves from the bare registered name to `tileName`'s words. Its promises stay the same, and the test writer keeps each of its laws as strong as it is now.

## Laws

| # | Law | Kind | Generator | Plant | Slice |
|---|---|---|---|---|---|
| L1 | (amendment 15) On real runners, a start a letter caused is started for any program when the letter's sender holds `owner`, `admin` or `member` on the fabrika, and refused `forbidden` with nothing written when it holds no row; no `StartGrant` is read either way, the answer keeps `Started`'s shape, and the `started` line names the sender as `member` | test | fc.commands: senders with a role drawn from owner, admin, member or none, any program, 200 runs | `Model`'s `start` drops `member`; `judge` lets a `Denied` through | S1 |
| L2 | (amendment 15) The member checked is the sender of the start's `parent`, never the program that asked and never the requester's own recorded member: a sender with no row, or whose key was removed, is `forbidden` even for a program the requester's grant names, or when the requester's member holds `start` | test | fc.commands: letters from related, unrelated and removed senders, to boot requesters and to children a related sender started, 200 runs | `judge` reads the requester's member before the sender; `judge` reads `StartGrant` when the sender holds no row | S1 |
| L3 | `stop_child` ends only the requester's own child, with `shutdown`, and writes `DOWN` to its watchers; another's name is `not_child`, an ended one `noproc` | test | fc.commands: starts and stops by three programs, 100 runs | skip the parent check | S1 |
| L4 | `stop_child`'s refusals and `StartRefusal` decode by name in any client | type | type | widen a refusal to `string` | S1 |
| L5 | After any sequence of splits and closes, `Layout.check` finds nothing: each tile once, parts sum to 100, no one-part split, directions alternate, focus and `recent` name only live tiles | test | fc.commands: split_right, split_down and close on random tiles, 300 runs | drop the settle after `remove` | S2a |
| L6 | A split puts the new tile after the focused one with half its share, and focus moves to it, only after `start_child_ok` | test | fc.commands: splits with start answers in random order, 200 runs | add the tile before the start answers | S2a |
| L7 | Closing the last tile is refused `last_tile` and changes nothing; a close sends focus to the next open tile in reading order | test | fc.commands: closes on layouts of 1 to 8 tiles, 200 runs | focus the first tile in place of the next | S2a |
| L8 | A close of a tile tezgah started stops that process; a close of any other tile stops nothing | test | fc.commands: tiles started by tezgah or by the boot list, 100 runs | stop every closed tile's process | S2a |
| L9 | A reused tile id, an unknown `from` or a missing workspace is refused with its reason and writes nothing | test | @demlik/tea/pbt.arbMsgSequence | accept a reused id | S2a |
| L10 | A window started with a desk takes its tiles only from tezgah's view: a view change adds and removes tiles and opens each new one's process view; with no desk the given tiles stay | test | @demlik/tea/pbt.arbMsgSequence | keep a removed tile | S2a |
| L11 | tezgah's view round-trips through `TezgahView` in the window | test | Effect Arbitrary: TezgahView | drop `child` from the encoder | S2a |
| L12 | On the real local instance, a headless client admitted as the founder reads `tezgah:<person>`, attaches, splits twice, closes once, and sees each layout | test | scenario: real dev.ts and headless client, one founder | send the split to `tezgah:1` | S2a |
| L13 | The prefix arms only the window it was pressed in; the next key resolves to one command; no Cmd but a record leaves before the command is known | test | fc.array: key events across two windows, 300 runs | send the prefix key to the brain | S2b |
| L14 | `<prefix> <prefix>` passes the prefix key to the tile's content; an unknown key after the prefix disarms and goes nowhere; Escape disarms | test | fc.array: keys after the prefix, 200 runs | pass the unknown key to the tile | S2b |
| L15 | A person's binding on a key the backend cannot have fails at load with its words; a default on one is never shipped to that backend | test | fc.constantFrom: each backend's cannot keys, default runs | warn in place of fail | S2b |
| L16 | The router matches 0272's steps 1, 2 and 6 in order: platform keys are never taken, the prefix wins over a tile, the rest reaches the tile | test | scenario: one press per router step | try the tile before the prefix | S2b |
| L17 | A close of a tezgah child asks `close t<n>? (y/n)`; n or Escape sends nothing; y sends one close | test | fc.array: key sequences after the close, 200 runs | close on any key | S2b |
| L18 | A split that would leave a tile under 220x120 at this window's size is refused in the window, said politely, and nothing is sent | test | fc.record: window sizes and layouts, 300 runs | send the split anyway | S2b |
| L19 | Every tezgah command is named `tezgah.<word>` and carries a word and a label | type | type | add a command with no word | S2b |
| L20 | The markup has one `main`, one region per open tile named by `tileName` (program first, then t<n>), and `aria-current` only on the focused tile | test | fc.commands: layouts from splits and closes, 100 runs | name a region by its registered name | S2b |
| L21 | In headless Chromium on the real brain: split right, split down, the close ask and close work by keys, and the layout matches tezgah's view | test | scenario: real dev.ts, one tab, one founder | draw from a fixed tile list | S2b |
| L22 | The `tezgah` module imports only lower layers, and Tuval imports no brain module | lint | lint | import `client/` from `tezgah/` | S2b |
| L23 | The window's model has no optimistic field: the drawn focus is always `optimisticState` of server state and pending mutations | type | type | store the focus beside the server state | S3 |
| L24 | For any order of two windows' moves and server answers, each window's drawn focus is the server's once its mutations are answered, and a window whose move lost follows the server | test | @demlik/tea/pbt.arbMsgSequence | keep a mutation after its answer | S3 |
| L25 | A focus key is drawn on the same step that reads it, before any frame from the brain | test | fc.array: focus keys with the link slow or down, 200 runs | wait for the view to move focus | S3 |
| L26 | `neighbor` picks the tile with the most overlap on that side; `focus_next` follows reading order; `focus_last` goes to `recent[1]` | test | fc.commands: layouts and directions, 300 runs | pick by tile order in place of geometry | S3 |
| L27 | tezgah applies moves in arrival order and never reads `sentAt` | test | fc.array: moves with shuffled sentAt, 200 runs | sort by sentAt | S3 |
| L28 | Returning to a tile lands on its cursor key when the element is there, else at the top; a tile never focused lands at the top | test | scenario: real dev.ts, checklist rows as cursor keys | focus the tile's body every time | S3 |
| L29 | A move the server overrode writes one client row `focus {result: "overridden"}`; a kept move writes `kept` | test | @demlik/tea/pbt.arbMsgSequence | write no row on a jump back | S3 |
| L30 | Desk focus follows DOM focus by click and Tab, and DOM focus follows desk focus, in Chromium on the real brain | test | scenario: real dev.ts, two tabs on workspace 1 | move desk focus only on keys | S3 |
| L31 | At any size and layout, the focused tile is never a strip, every open tile is at least 220x120, and strips are buttons named `open <program>, t<n>` | test | fc.record: sizes from 320x240 to 2560x1600 and layouts, 300 runs | fold the focused tile | S4 |
| L32 | A fold is never sent to tezgah and never stored in the window's model | type | type | add folded tiles to the model | S4 |
| L33 | Tab onto a strip shows its ring and moves no desk focus; Enter or a click focuses it, and it opens | test | scenario: real dev.ts, a 1024x700 tab beside a 1440x900 tab | move desk focus on Tab | S4 |
| L34 | The Electron backend refuses a binding on Cmd-Q or Cmd-H at load and keeps F6 | test | fc.constantFrom: Electron's cannot keys, default runs | drop Electron's cannot list | S5 |
| L35 | The S2b, S3 and S4 e2e laws pass in the Electron app on the real brain | test | scenario: real Electron app and dev.ts, one founder | run them in Chromium only | S5 |

## Host-only laws

- **L12, L21, L28, L30 and L33** start a real `dev.ts` brain (workerd through Alchemy), real sockets and Chromium. A step's container can run them, and they run before the first review of their slice. In CI, L12 (an integration test) runs only on the 3-hour full run; L21, L28, L30 and L33 (visual tests) run there too, and on a pull request only with the `visual` label (0536, amendment 15).
- **L35** needs the real Electron app.
  - On the owner's Mac, it waits for the lead's read of its signal and the owner's yes (0178).
  - In this container, it could run only once Electron's binary is fetched and run under `xvfb-run`, which is untried. A skipped run is not evidence.
- **The cursor needs a real screen reader run before it counts as done** (0165). That is VoiceOver on the Mac, by a person. It is owed after S3 and named in that pull request.

## What it records, and what is lost if not

**tezgah's letters.**
- Each `did` is recorded with `via`, `from` and the new tile id, plus the letter's own `by`, `sentAt` and `parent`.
- Each refusal is recorded with its reason.
- `start_child` and `stop_child` are recorded with their answers.
- What is lost if this is not recorded now: `via` and `from` at the moment of the press. Program guidelines say these settle call 1 by data, and none of them can be worked out later.

**The tab's client rows.**
- `press` is already built.
- New: `prefix {does, ms}`, `focus {letter, result, ms}` (S3) and `fold {strips, width, height}` on change (S4).
- What is lost if these are not recorded now: whether a move was overridden, which only the window sees, and the prefix latency, which settles 0278's 70%.

**The start's member.** Main's core reads it from `parent` through `Senders` and writes it on the child's `started` line as `member` (0531). The desk adds no field (amendment 15).

**A stop.** It ends with `shutdown`, never `normal` or `crashed`. Without that, a closed tile could not be told from a crash.

**Each tile's `keep`.** It is written from the first tile on. Tiles written before P18 slice 4 would otherwise never have it.

**Derived, so it can wait:** time spent in a tile, how often a split is undone, and fold geometry beyond the `fold` row.

## Is this a setting?

- **The prefix and the bindings:** these belong to the keybindings file (K2, K5), not `fabrika.toml`. Reading that file is P14's owed slice (see open question 1).
- **The new tile's program:** it becomes the pack setting `tezgah.new` once programs read pack settings (P38 slice 5). Until then it is a constant, as the checklist's `LATE` is.
- **The 220x120 floor:** not a setting. It is the readability floor from fold, not tabs.
- **The y/n ask:** not a setting. It is tmux's rule and today's lesson.

## Amendments

- 2026-11-14 (lead, after S1's build): S1 left `stop_child` unwired on the Worker's process side, since the files that wire it were in no S1 row: `next/packages/libfabrika/src/cloudflare/runtime.ts` gives `Children` only `start`, so a Worker program's `stop_child` answers `bad_cmd`. S2a wires it, since tezgah's close (L8) needs it on the real instance: a `processStop` call to the Project in `cloudflare/runtime.ts`, `cloudflare/bindings.ts`, `cloudflare/platform.ts` and `next/apps/fabrika/src/brain.ts`, and `Children.stop` becomes required. L8 and L12 run on the real instance, so they reach it.

- 2026-11-14 (lead, after S2a's tests step), five points the tests step found, each settled here:
  1. `tezgah` is a new libfabrika module, so `.oxlintrc.json` lists it in `fabrika/modules` for `next/packages/libfabrika/src`, and `next/packages/libfabrika/package.json` exports `./tezgah/*` with `./tezgah/internal/*` closed, as every other module does. Both rows go to the tests step, as `layer-rules.json` does. This registers a module; it turns no rule down.
  2. Process names. `ProcessName` allows no `_` (`next/packages/libfabrika/src/processes/Process.ts:95`), so an id cannot sit in a name whole. The name carries the id's body after its fixed prefix: `tezgah:<person id without "person_">` and `checklist:<tile id without "tile_">`. The prefix is fixed per kind, so nothing is lost, and `ProcessName` is not widened. One pure function per name, in `tezgah/Workspace.ts`, writes it, and laws never parse it. The lead's lean, for the owner to read (75%): widening `ProcessName` is the other branch, and it would change every process name's rule for one program.
  3. `why: "order"` leaves the plan. The focus after a close follows one decided rule (tile guidelines: next open tile in reading order), and tezgah's saved model holds the focus that resulted, so the reason can be rebuilt and is not a fact lost. L7 keeps its focus half and drops the `why` half. A second rule later records its `reason` (next/'s word) when it lands.
  4. `no_workspace` means tezgah has no workspace with the `from` tile yet; an unknown `from` on a known workspace is `missing`, as the tests pinned.
  5. Two cases, the lead's lean for the owner to read: (a) a close of the tile a waiting split is placed at, before `start_child` answers: when the start answers, the new tile is placed after the workspace's focused tile instead (65%); a split never loses its started process. (b) An `attach` of a workspace that already exists changes nothing and answers the current view (80%, idempotent as OTP's `whereis` then start). The tests step adds laws for both, in `next/programs/tezgah/src/program.laws.test.ts`, under L6 and L9.

- 2026-11-14 (lead, after S2a's build): two test files the slice must change were in no row, and go to the tests step. `next/packages/libfabrika/src/client/Start.types.test.ts` pins the start's option keys exactly, and the `desk` option the S2a laws pass must join that list. `next/apps/fabrika/src/instance-one-file.integration.test.ts` ("p33 real isolation") treats every program in the built table but the counter and the checklist as a planted sealed program; `fabrika/tezgah` joins the known built-ins the way P14 slice 2 added the checklist, and the check on sealed programs keeps its strength.

- 2026-11-14 (lead, after S2a's first review): (1) the window's tie to its person's tezgah is named `tezgah`, never `desk`: the start option is `tezgah?: {workspace}` and the window model's field and type follow it (0491: the window manager is tezgah and never desk; this plan's own one-line rule). The plan's earlier words "a window started with a desk" mean a window started with the `tezgah` option. (2) The founder's tezgah boots from the boot list like every other entry, with no condition on the table: a build without `fabrika/tezgah` fails the boot loudly, as P14 slice 2's boot law says. The tests that mock a program table add `fabrika/tezgah` the way P14 slice 2 added the checklist, in the four app test files now listed as S2a tests rows.

- 2026-11-14 (lead, after S2b's tests step): (1) a tile's region is named by `tileName` alone, `checklist, t2`, with no focus word; `aria-current` marks the focused tile (0503's lesson), so a focus move never renames a region. The trace's "checklist, t2, focused" is read that way. (2) L22's Tuval half gets its rule: a `no-restricted-imports` override in `.oxlintrc.json` for `next/packages/tuval/**` refuses libfabrika's brain-side modules (`cloudflare/*`, `node/*` and any other the layers put on the brain's side), a tests row; this adds a check and turns none down. (3) `next/programs/tezgah/package.json` exports `./commands`, a tests row, so the app reads the one commands table. (4) In S2b a 2x2 is reached by a second granted client's letters, since focus keys come in S3. (5) The app finds a tile's window by its program, never by the name `checklist:1`.

- 2026-11-14 (lead, after S2b's build): (1) `next/packages/tuval/src/dom/keys.ts` is not made: `layer-rules.json` puts Tuval's `dom/` above `window/`, so `window/` may not import it. A key press is spelled by a pure `Keys.spell` in libfabrika's `client/Keys.ts`, which any client reuses, and Tuval's `window/main.tsx` holds the one document listener. (2) `next/apps/fabrika/e2e/client-protocol.test-support.ts` is a tests row: its browser half finds a tile's region by `tileName`'s words, as `first-window.test.ts` does.

- 2026-11-14 (lead, after S2b's first review): the room check measures drawn tiles, never bare percent shares. `Layout.rects` takes the gap the frame draws between parts (`rects(layout, size, {gap})`): each container gives each part its percent of what is left after its own `parts - 1` gaps, so nested containers lose their own gaps too. The window's `size` Msg is the area the parts are laid out in, inside the frame's outer padding. The gap is one number in libfabrika (4px, 0492's divider), and Tuval's frame draws its divider and padding from that same number, so the drawing and the check can never drift apart. L18 measures drawn tiles; S4's fold (L31) reuses it.

- 2026-11-14 (lead, after S3's tests step): (1) a pending move is matched by its letter and dropped once its reply has come and a view whose `rev` is at or past the reply's inbox position (`accepted.pos`) has arrived; a view's `rev` counts inbox positions, never ledger revisions. (2) A click or a Tab into another tile is the command `tezgah.focus` with `via {_tag: "click"}` and no key row; the window's Msg for it is `focus {tile, cursor}`. (3) Every letter that moves focus off a tile carries that tile's cursor, a split included, and tezgah stores it on `from`, since 0165 says returning to a tile never resets it to the top; a close carries none, its tile is gone. (4) Next and previous wrap, as tmux does; a direction with no neighbor does nothing; a tie for the most overlap goes to the tile first in reading order (the lead's lean, 70%). (5) A refused move is dropped when its refusal arrives, since tezgah's state did not change; it writes `focus {letter, result: "overridden"}` (the lead's lean, 75%). (6) The focus rows of the commands table are checked in `next/programs/tezgah/src/program.laws.test.ts`. (7) The real screen reader run of the cursor (0165) is owed after S3, by a person, on the Mac.

- 2026-11-14 (lead, after S3's first review): (1) a dropped move's row says what the person saw: `overridden` when tezgah refused it, or when dropping it moves the drawn focus (a jump back); `kept` otherwise, so a window's own earlier move that its next move superseded is `kept`. Every dropped move gets its row, as before. (2) `CursorKey` holds any key a view gives: at most 256 characters, so the checklist's `item:<name>` (up to 85) always fits; tezgah and the window read the same schema, and a longer key a future view gives is its own bug, refused at that view. (3) A pending move's states are one tagged union, `waiting {n}`, `sent {letter}` and `answered {letter, pos, ms}`, never two nullable fields (0037).

- 2026-11-14 (lead, round R, after the project lead's review of the pull request and its nine finding rows): (1) this plan lives in the repo at `docs/plan/lanes/desk-PLAN.md`, so a law's "the approved plan" and "amendment N" resolve. (2) A window whose person has no tezgah process (the boot starts only the founder's) says so: its tezgah link reaches a `missing` state, the page says "tezgah is not running for you yet" in the status bar and the polite region, never "Opening", and the window reads `processes/tezgah:<person>` again on each redial (the lead's lean, 70%; who starts a later member's tezgah stays with invites, Tier 3). (3) Inside tezgah, `workspace` always means a workspace's number, as on the wire and in the window's `tezgah: {workspace}` option; a workspace's id is never keyed `workspace` (in `Starting` it is `space`). (4) A fixed example keeps the `pinned:` label only for a named past bug (the tests skill); a plan lean or a boundary of a rule is labeled `scenario:` with its reason, or becomes part of a property. (5) The Tier 1 rows and the glossary rows the lane touched are brought up to date in the same change (0013).

- 2026-11-14 (lead, after S4's tests step): (1) the focused tile is never a strip, even when the window is too small for it (0506's lesson: focus is always on an open tile); the 220x120 floor holds for every other open tile. (2) Which tiles fold is decided on the drawn geometry of full percent shares (`rects` with `GAP`); a strip is then drawn 22px across in a row and 20px tall in a column (the fold-not-tabs note), and the open tiles of its container share the space it leaves, so an open tile only grows past what the fold measured and the floor still holds (the lead's lean, 75%). (3) Each folded tile is its own strip, a button named `open <program>, t<n>`, as L31 says; a container whose tiles all fold is not merged into one strip (today's 0506 merges it; the lead's lean, 65%: one button per tile keeps each reachable and named). (4) The `fold` row's `strips` is the count of strips; which tiles folded rebuilds from tezgah's view, the window's size and its focus. (5) L32's "never sent" half also walks the split path, where splits are walked (`next/packages/libfabrika/src/client/Prefix.laws.test.ts`, a tests row).

- 2026-11-14 (lead, after S4's first review, which sent the plan back; this replaces amendment 12's points 1 to 3): amendment 12 measured folds on full shares while the frame draws strips at a fixed size, so an open tile could be drawn under the floor and a narrow focused tile lost its title (the tile guidelines: a title's id and state are never cut). Now: (1) **one geometry, in libfabrika.** `Fold.ts` owns a pure `drawn(w, size, strips)` that gives each tile's drawn box, and `STRIP = {row: 22, column: 20}` moves there beside `GAP` (as amendment 7 moved the gap): a strip takes its fixed size along its container's axis; every container on the focused tile's path holds the part that leads to it at `min(220 or 120, what the container has)` along its own axis; the other open parts share what is left by percent. (2) **`fold` is a fixpoint on that geometry:** start with no strips and add every open tile but the focused one drawn under 220x120, again and again, until nothing changes (strips only grow, so it ends within the tile count). (3) **A container whose tiles all fold** takes one strip's size along its parent's axis, and its strips lie along that band, one button per tile, each named as before. (4) **The window's split room check measures with the same `drawn`**, so a split it allows does not fold a tile at once. (5) **Tuval draws from the same numbers** (each part's size from `drawn`, or the same rule in flex terms), so drawing and check cannot drift. (6) L31 becomes: every open tile but the focused one, as drawn, is at least 220x120; the focused tile is drawn at least `min(220x120, the area)`; no extra folds (each strip was under the floor in the geometry it folded in); and the e2e compares the tab's boxes with `drawn` within 1px. (7) A pixel size in a Msg or a row is typed by its own schema, never `Ms` (0212). The lead's lean, from the reviewer's, 80%.

- 2026-11-14 (lead, after S4's tests to amendment 13): (1) "what the container has" is its length minus its own gaps and strips, so the focused tile is held at `min(floor, that)`. (2) When a container's strips alone are longer than the container, its strips share its length equally; that window is too small for the layout, and nothing else is promised there (the lead's lean, 70%). (3) A band's strips share the band's length equally, and each strip's text runs along it, drawn whole where the band allows.

- 2026-11-14 (plan, after main's permission core, ticket 953, [pull request 1239](https://github.com/kamp-us/tea-fabrika/pull/1239), was merged into the lane at `90409b69a`): S1's start check moves off its stand-in and onto main's core. Main now checks every start a letter caused with `StartProgram` on the fabrika, against that letter's sender, in `next/packages/libfabrika/src/processes/ChildrenLedger.ts`'s `judge`, and carries the member down the chain of starts (0170, 0526, 0531). Nothing reads the stand-in's verdict since the merge, and two of its laws went red, because they say any admitted key may start any program and main refuses a sender with no relation row.

  (1) **The stand-in goes.** Each piece, and the step that deletes it:
  - Build: `next/packages/libfabrika/src/access/StartRule.ts`, the whole file (`mayStart`, always true).
  - Build: in `next/packages/libfabrika/src/runtime/Runner.ts`, the `mayStart` import (line 27), the `permission` step and its doc comment (lines 1618 to 1648), which signs a receipt of kind `start_child:<id>`, and in `startChild` the `permitted` value and its spread into `children.value.start` (lines 1691 and 1700). The runner signs no start receipt after this. The `SigningRefused`, `NotGranted` and `SignRequest` imports stay, since the write path uses them.
  - Build: in `next/packages/libfabrika/src/processes/Children.ts`, the `permitted` field of `Child` and its doc comment (line 57). `Child` is then main's shape again.
  - Tests: `next/packages/libfabrika/src/access/StartRule.laws.test.ts`, the whole file.
  - Tests: in `next/packages/libfabrika/src/runtime/StartChildTest.ts`, the moves `member_start` and `outsider_start`, the props "Desk S1 L1" and "Desk S1 L2", and the header lines that describe `mayStart`. The writers `memberWriter` and `outsider` and the door's `SessionManager` stay: the new moves in (2) use them.
  - Tests: in `next/apps/fabrika/src/start-child.laws.integration.test.ts`, the scenario "Desk S1 L1, L2" and its comment; (2) restates it.
  - The stand-in also checked an agent as its own key. Main's `Senders` checks an agent as `person:<for>`, capped by its person (0526), so that rule leaves with the stand-in, and no desk law asserted it.
  - Nothing else in the lane reads `mayStart` or `permitted` (searched under `next/`).

  (2) **L1 and L2, in the real check's terms** (the Laws table rows above are rewritten to match). They still run on real runners, the real ledger and the door's real `SessionManager`, through the runner's `start_child` Cmd. That is what main's own laws in the processes module's `ChildrenMemberTest` suite do not cover: they call `Children.start` directly, so only the desk's laws prove that the runner hands main's core the letter's id as `from.parent`.
  - **The test world.** `next/packages/libfabrika/src/node/StartChild.integration.test.ts` gives `ChildrenLedger.layer` the world's relation rows through `RelationsMemory.layer`, and a `Senders` made with `SessionSenders.make` from the door's own `SessionManager.sender`, the same way `cloudflare/runtime.ts` makes the real one. Today that driver gives every start "no sender", which is why the stand-in's laws went red. So `StartChildTest.Store["shared"]` takes the rows and the `Senders`, and the host builds the door's `SessionManager` before `shared`.
  - **What the generator plants.** Each run draws three people, each with a role from `owner`, `admin`, `member` or none, and one `related` row per role on `fabrika:p42`. A fourth sender's key is removed (the existing outsider, whose key the `SessionManager` refuses). The moves are `related_start`, `unrelated_start` and `removed_start`, a letter from one of those senders to a starter that asks for any program in `ANY_PROGRAM`. L2 also sends letters to a child that a related sender's start made, so the requester has a member of its own (0531). Seed 119120, 200 runs each.
  - **L1 asserts:** a sender with any of the three roles gets `start_child_ok` with a fresh `started`, decoded by `Started`, for a program no `StartGrant` names (`plain`, `starter`) as well as for one it does (`merger`). The child runs the program asked for, and its `started` line carries `member: {_tag: "person", key, for: <the sender>}`. A sender with no role gets `{type: "start_child_err", outcome: "forbidden"}`, writes no process row and registers no name. The plants: `permissions/Model.ts`'s `start` drops `member` (`p.union("owner", "admin")`), and the member draws go red; `judge` lets a `Denied` through, and the no-role draws go red.
  - **L2 asserts:** the member checked is the letter's sender, never the program that asked and never the requester's own member. A sender with no row, or with a removed key, is `forbidden` even for `merger`, which the starter's own grant names, and even when the requester is a child whose member holds `start`. Each refusal writes nothing. The plants: `judge` reads the requester's member before the sender (the child draws go red); `judge` falls back to `StartGrant` when the sender holds no row (the `merger` draws go red).
  - **The real door's scenario** in `next/apps/fabrika/src/start-child.laws.integration.test.ts` keeps its two programs, with no start grant on the instance. It now asserts that each start is allowed because the boot's `owner` row names the founder, and that each `started` line names the founder as `member`. Its plant: `cloudflare/runtime.ts` writes no owner row, and both starts answer `forbidden`. Only the founder can be admitted on a real instance today, so its refusal half stays with L1 and L2 here and with main's L18, the app's start-member scenario, which this lane does not change.
  - **Strength.** No assertion is dropped without a stronger one in its place. The old L1 said "any admitted key may start any program". That is replaced because 0170 says the desk holds no start permission of its own, and 0526 makes membership a relation row: a key with no row is no member. The new L1 keeps "any program, with no grant, in `Started`'s shape" for every member, and adds the `member` on the `started` line and the refusal half. The old L2's outsider case stays as `removed_start`, and the new L2 adds the case of a requester that has its own member. The old `StartRule.laws.test.ts` law tested one constant; 0170's first rule now lives in `Model`, and main's "L10 and L13" pins it.

  ```ts
  // A sketch, next/: the test world after amendment 15, in StartChildTest.ts and its Node driver.
  const FABRIKA = Model.ref("fabrika", "p42");
  const rows = (people: ReadonlyArray<{ person: string; role: "owner" | "admin" | "member" | null }>) =>
    people.flatMap(({ person, role }, n): ReadonlyArray<Relation.Change> =>
      role === null
        ? []
        : [{ id: `role-${n}`, row: Relation.Row.cases.related.make({ subject: `person:${person}`, relation: role, object: FABRIKA }) }],
    );

  ChildrenLedger.layer({ grants: StartChildTest.STARTS, fabrika: FABRIKA }).pipe(
    Layer.provide(RelationsMemory.layer(rows(world.people))),
    Layer.provide(Layer.succeed(Senders, SessionSenders.make(sessions.sender))), // the door's own record
  );

  // One related_start: a member's letter asks a starter for `plain`, which no StartGrant names.
  yield* door(name, { type: "start", ask: { program: "plain", name: target } }, memberWriter(person));
  // role "member": { type: "start_child_ok", outcome: { _tag: "started", ... } }, and the started line
  //   carries member: { _tag: "person", key: `SHA256:${person}`, for: person }
  // role null:     { type: "start_child_err", outcome: "forbidden" }, no process row, no name
  ```

  | Removed | Replacement |
  |---|---|
  | Desk S1 L1: a start caused by any member's letter is allowed for any program, with no grant, and answers in Started's shape | Desk S1 L1: a start a letter caused is started for any program when its sender holds owner, admin or member on the fabrika, and refused forbidden with nothing written when it holds none; no start grant is read, and the started line names the sender as member |
  | Desk S1 L2: the member checked is the sender of the start's parent, never the program that asked | Desk S1 L2: the member checked is the sender of the start's parent, never the program that asked nor the requester's own member; a sender with no row or a removed key is forbidden even where the requester's grant or member would allow it |
  | L1: any member may start any program (0170's first rule) | L10 and L13: a member's start is started exactly when the member holds start, whatever StartGrant says |
  | scenario: Desk S1 L1, L2: the founder's letter starts any program with no start grant at all | scenario: Desk S1 L1, L2: the founder's letter starts two programs with no start grant, as the fabrika's owner, and each started line names the founder as member |

  (3) **Lint, type or test.** L1, L2 and the scenario are tests, since each needs real runners or a real instance; they are integration tests, run on the 3-hour full run. The deletion needs no law of its own: the type check fails on a leftover import of `StartRule.ts` or a leftover `permitted`, and `pnpm lint:dead` fails on a leftover export (0006).

  (4) **Stale text, brought up to date.** In this plan: the "Decided in one line" start line, the shape's `StartRule` sketch, step 5 of the trace, "What it records" on the start's member, the Laws table's L1 and L2, the Files table (the deleted stand-in files and the Node driver, each with its owner), Validation's commands, and where each test runs (integration tests on the 3-hour full run only; visual tests there too, and on a pull request only with the `visual` label; 0536). The test files already carry main's names (`tezgah-runner.laws.integration.test.ts`, and `tezgah-frame`, `tezgah-focus` and `tezgah-fold` as `*.visual.test.ts`), and the app's old e2e runner script is gone, so "Show it running" and Validation now use the `next-visual` project. In `docs/plan/tier-1.md` (a build row, 0013), the build step: rewrites piece 2's S1 bullet to say the start check is main's `StartProgram` check against the window letter's sender, with no "ticket 953 moves the check" left; moves the "Not built" line about 0531 ("Ticket 953 builds it") into what is built, since main records and checks the requester's member; and marks the "Decide first" item on how `fabsh` may start any program when a start right names one exact pair as settled by 0170 and 0526, since a member is checked and no program holds a start right.

  (5) **`next-tezgah` is on layer 5,** with imports `next-processes` and `next-shared`, in `layer-rules.json` (the merge commit set it). The permission core put `next-permissions` on layer 3, under `next-processes`, so every module from `next-processes` up moved up one: processes 3 to 4, tezgah 4 to 5, runtime 5 to 6, client 6 to 7. tezgah keeps its place one above `next-processes`, whose `ProcessName` it takes, and it imports nothing new. The scenario "Desk S2a tezgah takes processes and Id; only the client, the entry and the window reach it" in the app's exam layer law keeps its edges, and that file does not change.

  (6) **Two old asks are closed.** May tezgah hold a start grant until the core lands: no. 0170 says the desk and `fabsh` hold no start permission of their own, and the ask is moot now, since the check reads the window letter's sender. Where focus lands after a close: the next open tile in reading order, on that tile's cursor, and at the top only for a tile that never had focus (`docs/direction/tile-guidelines.md`, "Where focus lands"; 0165).

  (7) **No new open question.** Searched `.decisions/` (0170, 0172, 0526, 0531, 0536, 0165), `.glossary/TERMS.md` (`permission`, `grant`, `tezgah`), `docs/direction/` (`tile-guidelines.md`, `the-desktop-layer.md`) and the plan docs (`docs/plan/tier-1.md`, `docs/plan/lanes/t953-PLAN.md`) for the start check, the test world's rows and the layer move. Each choice here builds a decided note. Open question 1 stands as it was.

- 2026-11-15 (fix round, after ticket 1042's review): ticket 1042 built `tezgah.new` without P38 slice 5. The core pack's setting `pack.fabrika.settings.tezgah.new`, `fabrika/fabsh` by default, is handed to tezgah at init, a split's new tile starts that program, and `NEW_TILE` is gone ([its plan](./t1042-PLAN.md)). The words above that say the setting waits on P38 slice 5 (the lean on what a new tile shows, and "Is this a setting?") were written before ticket 1042 and stay as written.

## Open questions

1. **The person's `keybindings.toml`.** Once that file is read, unbinding a tezgah command clashes with 0278, which says "every command also has a shell word and a palette entry, so losing a key never loses a command". K1 of the keybindings note lets a person unbind any key, and today `next/` has no `fabsh` and no palette. This binds the later slice that reads the person's file, which is P14's owed keys slice, not this lane: here every command keeps its default key, and no slice reads a person's file. The three ways out are (a) the palette before Tier 6, (b) the load refuses an unbind that leaves a command with no other way in, or (c) a short gap until `fabsh`'s words land in piece 3. The lean is (b), 60%: it keeps 0278's promise at the one place it can break, and it narrows K1 only until piece 3 ships the words. The doubt is that it is still a narrowing of K1, so the owner picks. Each command already declares its word and its label now, so whichever the owner picks, nothing is undone.

## Validation

- Each step runs only its slice's narrow files from the repo root, with `nice -n 15 pnpm exec vitest run --maxWorkers=3 <files>` for memory tests, the same with `--project next-integration` for an `*.integration.test.ts` file, and `nice -n 15 pnpm exec vitest run --project next-visual <file>` for a `*.visual.test.ts` file (one file at a time, as that project runs). In CI, integration tests run only on the 3-hour full run, and visual tests run there and on a pull request with the `visual` label (0536, amendment 15).
  - **S1:** `next/packages/libfabrika/src/node/StartChild.integration.test.ts` and `next/apps/fabrika/src/start-child.laws.integration.test.ts`, both integration.
  - **S2a:** `next/packages/libfabrika/src/tezgah/Layout.laws.test.ts`, `next/programs/tezgah/src/program.laws.test.ts`, `next/packages/libfabrika/src/client/Tezgah.laws.test.ts`, `next/packages/libfabrika/src/client/WindowMachine.laws.test.ts`, `next/packages/libfabrika/src/transport/Handshake.laws.test.ts`, then `next/apps/fabrika/src/tezgah-runner.laws.integration.test.ts` as integration.
  - **S2b:** `next/packages/libfabrika/src/client/Keys.laws.test.ts`, `next/packages/libfabrika/src/client/Prefix.laws.test.ts` and `next/packages/tuval/src/window/Layout.laws.test.ts`. Then, as visual, `next/apps/fabrika/e2e/tezgah-frame.visual.test.ts` and `next/apps/fabrika/e2e/first-window.visual.test.ts`.
  - **S3:** `next/packages/libfabrika/src/client/Tezgah.laws.test.ts`, `next/packages/libfabrika/src/tezgah/Layout.laws.test.ts` and `next/programs/tezgah/src/program.laws.test.ts`. Then, as visual, `next/apps/fabrika/e2e/tezgah-focus.visual.test.ts`.
  - **S4:** `next/packages/libfabrika/src/tezgah/Fold.laws.test.ts` and `next/packages/tuval/src/window/Layout.laws.test.ts`. Then, as visual, `next/apps/fabrika/e2e/tezgah-fold.visual.test.ts`.
  - **S5:** `next/packages/libfabrika/src/client/Keys.laws.test.ts`. Then, as visual, `next/apps/fabrika/e2e/tezgah-electron.visual.test.ts`, on the host.
- The lead, not a boxed step, runs the type check and the changed-tests run once per slice, and reads CI. S2a changes the lockfile, so the lead lists narrow paths only.
- Commits are plain `git commit`, with the subject `Desk <slice> <step>: <what>`. For example: `Desk S2a tests: tezgah's layout stays tidy after any split and close`. Each slice runs as tests, build, and one review, each by its own agent. `pnpm format` comes first, and `pnpm lint` runs before each commit.

## Risks and what this plan cannot tell us

- **No line here ran.** Every claim about `next/` is read from the code at `d25a796`. Every claim about Electron in this container is read, not run.
- **Pull request 1204 also changes Tuval's page start and `next/apps/fabrika/src/entry/browser.tsx`.** Whichever lands second merges by hand.
- **Pull request 1104 adds shard rows for new test files.** Until it lands, each new file counts as 1 s in CI's split.
- **S2a is the largest slice, about 1,100 lines.** It lands whole because a headless client drives it end to end. No number caps it (0099).
- **How two windows on one workspace feel day to day** (W4's fast follow) is not settled by any law here.
- **Whether an empty checklist per split reads as clutter** is only answered by use.

## Size

1. S1, a start checked against its member, and `stop_child`: 210 lines.
2. S2a, tezgah in the brain, and a headless client splits and closes: 1100 lines.
3. S2b, the tab draws the workspace, with the prefix, the close ask and the refused split: 730 lines.
4. S3, optimistic focus moves and each tile's cursor: 520 lines.
5. S4, a smaller window folds what does not fit: 280 lines.
6. S5, the same suite and shots in the Electron app, after P19 slice 3: 40 lines.
7. S1 moved onto main's permission core (amendment 15): 5 lines added, and about 60 product lines of the stand-in deleted.

**Steps:** 21, plus about 4 likely send-backs. Amendment 15 adds its own tests, build and review steps.

**Price:** the `field/runs.jsonl` medians are about $1.1 for tests, $1.2 for build and $1.2 for review. The large slices are priced at about 2 to 3 times those medians.

**How sure:** about 55%. The doubt is S2a's size and S2b's look, which are the likeliest send-backs. S5's cost also depends on P19 slice 3.

Estimate: 25 steps, $60

## Findings

```json
{"_tag":"finding","id":"2026-11-14-desktop-note-names-desk-program","date":"2026-11-14","by":"plan","model":"claude-opus-5-5","rule":"doc_drift","location":{"path":"docs/direction/the-desktop-layer.md","line":14},"says":"In next/, the desktop layer note still says the desk is `next/programs/desk`, built in as `fabrika/desk`, while 0491 and the glossary's tezgah row say the program is `fabrika/tezgah` and never desk.","proof":"docs/direction/the-desktop-layer.md:14 reads 'a program, `next/programs/desk`, built in as `fabrika/desk`'; .glossary/TERMS.md:69 reads 'Its program is `fabrika/tezgah` ... Not `desk`'; .decisions/0491-window-view-tile-and-tezgah.md says 'Tuval's window manager is tezgah and never desk'.","cost":"A builder who reads the note names the package or the commands `desk`, and a review has to send it back.","head":"d25a7962556e5e400d3b95dec0eee17a5fae30d5","ticket":null,"pr":null}
```

```json
{"_tag":"finding","id":"2026-11-14-keybindings-note-commands-say-desk","date":"2026-11-14","by":"plan","model":"claude-opus-5-5","rule":"doc_drift","location":{"path":"docs/direction/keybindings-are-configurable.md","line":22},"says":"In next/, the keybindings note's examples name the window manager's commands `desk.split`, `desk.close` and `desk.zoom`, while 0491 makes the word tezgah and 0267 says every command name carries its program's name, which is `fabrika/tezgah`.","proof":"docs/direction/keybindings-are-configurable.md:22 reads 'desk.split   = \"<prefix>|\"' and line 262 says '`desk` owns split, close, zoom, fold and detach'; .glossary/TERMS.md:69 says the program is `fabrika/tezgah`, 'Not `desk`'.","cost":"The default key file and the keys program would ship `desk.*` rows that no program owns, and a person's file written from the note would bind nothing.","head":"d25a7962556e5e400d3b95dec0eee17a5fae30d5","ticket":null,"pr":null}
```

### Critical Files for Implementation
- next/packages/libfabrika/src/client/WindowMachine.ts
- next/packages/libfabrika/src/tezgah/Layout.ts
- next/programs/tezgah/src/program.ts
- next/packages/libfabrika/src/runtime/Runner.ts
- next/packages/tuval/src/window/main.tsx

