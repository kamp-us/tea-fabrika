Approved by the lead agent, builds 0069, 0083, 0137, 0159, 0274, 0275, 0276, 0543; body ef3eb5af2b83
Plancheck-Version: 3

# Plan: a new tile opens the shell, through the core pack's setting `tezgah.new`, in next/ (ticket 1042)

```ts
// The whole idea, next/ only. A sketch.
// 1. One setting, declared once, in the core pack's table (0083): what a new tile starts.
[pack.fabrika.settings.tezgah]
new = "fabrika/fabsh"                      // the default; any program of the build but tezgah itself

// 2. The start checks it against the build's programs, in words, before anything starts.
refuseNew(values, table) // null, or "pack.fabrika.settings.tezgah.new is fabrika/notes (~/.fabrika/fabrika.toml),
                         //  but this build has no such program. It has fabrika/checklist, fabrika/counter, fabrika/fabsh."

// 3. The runner hands each program its pack's settings at init, as Elm's flags and OTP's init/1 args.
tezgahMachine.init(loaded, { tezgah: { new: "fabrika/fabsh" } }) // model.new = "fabrika/fabsh"

// 4. A split starts model.new; the tab finds the tile's window by its program and draws the shell.
startChild({ program: "fabrika/fabsh", name: "fabsh:01jq3m..." }) // then region "fabsh, t2" in the tab
```

All of this is about `next/` only. Today's version is not touched.

Tracker ticket 1042. The branch `fabrikalfa/tezgah-new` stacks on the shell's draft pull request,
[pull request 1232](https://github.com/kamp-us/tea-fabrika/pull/1232) (`fabrikalfa/cloud-fabsh`),
read at `ddcccc41f`, because the shell program is not on main yet.

## The answer first

- **What a person sees.** The tab still opens on `checklist, t1`. `C-b %` or `C-b "` now opens a
  shell in the new tile, `fabsh, t2`, with its line ready to type in. That is what tmux does with a
  new pane. Nothing else on screen changes: no new words beyond the shell's own, no new keys
  (0543, the tile guidelines as written).
- **The setting.** `tezgah.new` in `[pack.fabrika.settings]`, the core pack's own table (0083). Its
  default is `fabrika/fabsh`. It is set in a person's file and read at restart. The start refuses
  a value that names no program of the build, or names `fabrika/tezgah`, in words.
- **How tezgah reads it.** The runner hands a program its pack's settings at `init`, which tea's
  `init(loaded, ctx)` already takes and the library today fills with `{}`. tezgah keeps the value
  in its model as `new`, as an Elm program keeps its flags. A waiting start and a tile each keep the
  program they asked for.
- **How the tab draws it.** `views.ts` registers the shell's window, and the counter's, by program.
  The window machine finds a tile's machine and its view decoder by the tile's program from
  tezgah's view, never by the tile's process name or by the view's shape.
- **What changes in the laws.** The browser half of L17 in `next/apps/fabrika/e2e/fabsh.visual.test.ts`
  goes green: it is the one law that proves the app registers the shell. A new fast law holds the
  same in plain Node: every program a tile may show has a window registered. tezgah's laws that
  read the new tile's program from `NEW_TILE` read the setting now.
- **One place I plan against the brief's line.** The brief says the first tile of a person's first
  window shows the shell too. This plan keeps workspace 1's first tile on the boot list's
  `checklist:1`, until the shell can show a program it starts (fabsh slice 2b). Today nothing else
  in the tab reaches the checklist, which is Tier 1's program (0137). Lean 75%, open question 1.
  It is one constant to drop when 2b lands.

## How others do it

- **tmux** (man page, `default-command` and `default-shell`; read from memory, not fetched this
  session). `default-command` is "the command used for new windows", and empty by default, which
  means "a login shell using the value of the default-shell option". It applies to `split-window`,
  `new-window` and `new-session` alike when no command is given. One option, one value, used
  everywhere a pane is made.
- **i3** (the i3 user's guide and the default config; not fetched). `set $term` names the terminal
  once, and `bindsym $mod+Return exec $term` opens it. A new workspace starts empty; the person
  opens what they want.
- **Browsers** (Firefox's Settings, "Home" panel; Chrome's "On startup"; not fetched). Firefox keeps
  two settings: "Homepage and new windows" and "New tabs". A first window and a new tab may open on
  different pages. This is the model for open question 1.
- **Elm** (the guide's "Flags"; not fetched). `init : flags -> ( Model, Cmd Msg )`. Values from
  outside arrive once, at init, and the program keeps what it needs in its model. A later change is
  a `Sub`. The settings note already decides this for `next/` (S6, `docs/direction/settings.md:363-379`:
  "Elm takes flags at `init`, and a later change is a `Sub`").
- **Erlang/OTP** (`supervisor` child specs and `application:get_env`; from memory, not fetched). A
  child's start is `{M, F, Args}`, and `init(Args)` keeps what it needs in its state. An
  application's environment is set in `sys.config` and read by its own processes. That is a pack's
  settings, read by its own programs (0083).
- **tea, installed.** `@demlik/tea` 0.25.0 (with the local patch), `effect` 4.1.2. tea's machine
  type is `init: (loaded: S | null, ctx: Ctx) => readonly [S, readonly C[]]`
  (`dist/core-*.d.ts`, the `Machine` type), and "Recorded replay starts from captured post-init
  State without calling init". tea does not grow: the library only stops passing `{}`.
- **Effect.** A setting is an Effect `Config` with its schema (0069, 0086), read at the edge and
  handed in (settings note S6).

## What is decided, in one place

Each was read for this plan.

- [0275](../../../.decisions/0275-the-shell-is-a-regular-program.md) and the desktop layer's W3:
  "tsh is only the default process for a new tile" (`docs/direction/the-desktop-layer.md:118`).
  fabsh is that shell in `next/` (0432).
- [0069](../../../.decisions/0069-choices-are-settings.md),
  [0086](../../../.decisions/0086-settings-are-declared-once.md): a choice that fits a value is one,
  declared once with `Setting.make`.
- [0083](../../../.decisions/0083-every-program-in-a-pack.md): every program is in a pack, the core
  pack is `fabrika`, and a pack's settings sit in `[pack.<name>.settings]`, read by its own
  programs. So the key is `pack.fabrika.settings.tezgah.new`, and P38 slice 5's later reader of
  outside packs keeps it unchanged.
- [0274](../../../.decisions/0274-the-desktop-is-a-platform-free-core.md): tezgah's state is a
  process in the brain. [0276](../../../.decisions/0276-a-tile-shows-one-process.md): a tile shows
  one process. [0277](../../../.decisions/0277-size-belongs-to-the-viewer.md),
  [0278](../../../.decisions/0278-each-window-runs-its-own-prefix.md): layout and keys, unchanged
  here.
- [0170](../../../.decisions/0170-a-start-is-checked-against-its-sender.md),
  [0526](../../../.decisions/0526-one-rebac-permission-system.md),
  [0531](../../../.decisions/0531-a-start-carries-its-member-down.md): a split's start is checked
  against the window letter's sender, as today. The shell holds no start right. Nothing changes.
- [0159](../../../.decisions/0159-fabsh-pipes-summon-join-first.md): fabsh in a tile comes right
  after the window and the desk; no stub.
- [0137](../../../.decisions/0137-tier-1s-program-is-the-checklist.md): Tier 1's program is the
  checklist, and its test is a person and an agent on one checklist, seen on screen. **Does the
  default clash with it?** Not for a split: 0137 decides which program carries Tier 1's test, not
  what a new tile starts. It does clash with the first tile showing the shell while the shell cannot
  show a program it starts: the checklist would leave the tab. That is open question 1.
- [0543](../../../.decisions/0543-next-follows-approved-guidelines-as-written.md) and the tile
  guidelines (`docs/direction/tile-guidelines.md`): no look changes. The shell's tile is drawn by
  its own approved window and the tile frame as built.
- The desk plan's amendment of 2026-11-14 after S2b's tests step, point 5: "The app finds a tile's
  window by its program, never by the name `checklist:1`" (`docs/plan/lanes/desk-PLAN.md:497`). This
  plan finishes that rule in the window machine.
- The glossary rows read: `tezgah`, `pack`, `setting`, `tile id`, `child (tile)`, `attach`.

Decided in one line, because a note answers it ([the open questions test](../../../.agents/skills/plan/SKILL.md#the-open-questions-test)):

- **The key is `pack.fabrika.settings.tezgah.new`** (0083; the settings note's "core pack" word).
- **The default is `fabrika/fabsh`** (W3, 0275; tmux's `default-command` falling back to the shell).
- **The value is a `ProgramName`** (`next/packages/libfabrika/src/packs/ProgramName.ts`), `pack/program`.
- **It is handed in at init, never read from a file by the program** (settings note S6, Elm's flags).
- **Several shells, one name rule.** Each tile's process is `Workspace.childName(program, tile)`,
  the program's last part and the tile id's body: `fabsh:01jq3m...`, `fabsh:01jq3p...`. A tile id
  is a fresh UUIDv7, so names never collide, and never with the boot's `fabsh:1`. `ProcessName`
  allows no `_`, which is why the body drops `tile_` (desk plan amendment 2, point 2). No law parses
  a name.

## The lead's calls and my leans

**Default to the shell for a new tile: the lead's call, taken while the owner is away, 85%.**
Source: the brief, W3 and 0275. It is a setting, so it is one value to change.

**Workspace 1's first tile stays `checklist:1` until fabsh slice 2b: my lean, 75%.** See open
question 1. Every other first tile (workspace 2 and up, which no window asks for yet) reads `new`.

**Scope `["person"]`, reload `restart`: 70%.** What a new tile shows is a person's taste, as
`.tmux.conf` is per user and the settings note keeps a person's picks out of the repo's file. A repo
key outside the scope is refused now; widening the scope later loses nothing.

**tezgah keeps `new` in its saved model, set by `init` from the settings each load: 80%.** Elm and
OTP both keep start values in state. tea's `update` takes no context, so the model is the only
place. The saved model goes to `v: 2` with one named upgrade. The doubt: a saved field that `init`
overwrites reads oddly; the other branch is a tea change, which "tea stays small" rules out.

**The start check lives at the app's start, against the app's program table: 80%.** A schema cannot
know the build's table, so `refuseNew` is a pure function beside the app's settings, called in
`dev.ts` right after the settings load and before the build. It refuses `fabrika/tezgah` too: a
tile cannot show the window manager. The brain does not repeat it; a start of an unknown program
already answers a `StartRefusal`, and the split is dropped as today.

**Register the counter's window too: 75%.** With `tezgah.new` settable to any program but tezgah,
every such program can be on a tile, so every one needs a registered window. The counter has one
(`@kampus/counter/window`). The fast law below holds it.

**Keep the boot list's `fabsh:1`: 70%.** No tab tile shows it any more. But the headless half of
L17, the shell's start law in the app's integration tests and three
boot laws reach the shell by that name, as any client may reach a named process. Only its comment
in `runtime.ts` changes: it is no longer "the seam until tezgah starts fabsh". The other branch,
removing it, rewrites those laws to split first, for no gain a person sees.

**P38 slice 5 is not needed: 80%.** The existing path does the reading: a `Setting.make`
declaration in `Declarations.all` is read by `Load.load`, recorded in the snapshot with its hash
(`RecordedStart`), printed by `fabrika settings` and written into `person.json`. What is new is
handing the core pack's values to its programs at init. Slice 5 keeps its own job: reading outside
packs' `[pack.<name>]` tables and their declared schemas. The doubt: the core pack's declaration
sits in libfabrika's `Declarations.ts` beside fabrika's own, since no pack declares settings yet;
slice 5 may move it into the core pack's own group, with the same key.

## The shape

### The setting (`next/packages/libfabrika/src/settings/Declarations.ts`)

```ts
/** Setting for the program a new tile starts, from the core pack's settings (0083). */
export const tezgahNew = Setting.make("pack.fabrika.settings.tezgah.new", {
  schema: ProgramName.annotate({
    title: "a program",
    description: "A program is its pack and its name, as fabrika/fabsh.",
  }),
  default: "fabrika/fabsh",
  doc: "The program a new tile starts.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});
// joins `all`; env FABRIKA_PACK_FABRIKA_SETTINGS_TEZGAH_NEW, as Setting.make derives it.

/** The core pack's settings, as the runner hands them to the pack's programs. */
export const corePack = (values: Setting.Values<typeof all.settings>) => ({
  tezgah: { new: values.tezgahNew },
});
```

### The start check (`next/apps/fabrika/src/settings.ts`, called in `dev.ts`)

```ts
/** Null when the value names a program a tile may show; else the words the start stops with. */
export const refuseNew = (
  value: ProgramName,
  origin: string,                       // where the value came from, as `fabrika settings` prints it
  table: ReadonlyArray<{ readonly name: string }>,
): string | null => {
  const shown = table.map((p) => p.name).filter((n) => n !== "fabrika/tezgah").sort();
  return shown.includes(value)
    ? null
    : `pack.fabrika.settings.tezgah.new is ${value} (${origin}), but a tile cannot show it. ` +
        `A tile can show ${list(shown)}.`;
};
// dev.ts, right after Load.load: a refusal fails the start with InstanceError "settings" and these words.
```

### A program's settings, handed at init (library, `runtime/Program.ts`, `Execution.ts`, `Runner.ts`)

```ts
// runtime/Program.ts: a program may declare the part of its pack's settings it reads.
type Spec<...> = {
  // ...today's fields...
  readonly settings?: Schema.Codec<Ctx, Schema.Json>; // init's ctx; without it, init gets {}
};
// The stepper decodes what the runner hands with it. A refused value downs the load ("load"),
// never a silent default: the start already checked the file, so this is a broken handoff.
type Stepper = { readonly init: (saved: unknown, settings: Schema.Json) => Step /* ... */ };

// runtime/Execution.ts: both executions take it; the box one passes it across, call("init", [saved, settings]).
readonly init: (saved: unknown, settings: Schema.Json) => Effect.Effect<Step, ProgramDown>;

// runtime/Runner.ts: every init (fresh, wake, after an upgrade) hands the process's pack's settings.
// cloudflare/ProcessObject.ts builds them from RecordedStart: { fabrika: Declarations.corePack(values) },
// and the runner picks the pack of the program's name (0083's `pack/program`).
```

### tezgah (`next/programs/tezgah/src/program.ts`)

```ts
const Settings = Schema.Struct({ tezgah: Schema.Struct({ new: ProgramName }) });

/** Workspace 1's first tile shows the boot list's checklist until fabsh can show a program it
 *  starts (fabsh slice 2b); then this constant goes and the first tile reads `new` too. */
const FIRST = { program: "fabrika/checklist", name: "checklist:1" } as const;

const Starting = Schema.TaggedUnion({
  attach: { workspace: Schema.Int, tile: TileId, program: ProgramName, name: Schema.String },
  split: { space: WorkspaceId, at: TileId, dir: Dir, tile: TileId, program: ProgramName, name: Schema.String },
});

const Model = Schema.Struct({
  workspaces: ..., tiles: ..., next: Schema.Int, starting: Schema.Array(Starting),
  new: ProgramName, // the setting in force, set by init on every load
});

// state: { v: 2, upgrades: [{ name: "a start keeps its program", from: 1,
//   run: (m) => ({ ...m, new: "fabrika/checklist",
//                  starting: m.starting.map((s) => ({ ...s, program: "fabrika/checklist" })) }) }] }
// v1 only ever started the checklist, so the upgrade loses nothing.

init: (loaded, settings) => [
  { ...(loaded ?? { workspaces: [], tiles: [], next: 1, starting: [] }), new: settings.tezgah.new },
  [],
],
// attach: workspace 1 asks FIRST; any other asks m.new, named childName(m.new, tile).
// did (split): asks m.new, named childName(m.new, msg.tile), and the Starting keeps m.new.
// made(): tile.program = the Starting's program, never m.new, so a restart with another value
// never relabels a tile or a waiting start.
```

`NEW_TILE` goes. The README's paragraph on it says the setting instead.

### The window (`next/packages/libfabrika/src/client/WindowMachine.ts`, `next/apps/fabrika/src/entry/views.ts`)

```ts
// WindowMachine.ts: a tile row knows its program when tezgah's view names it.
type Shown = { readonly id: string; readonly name: string; readonly program: string | null };
// from tezgah's view: { id: t.id, name: t.shows, program: t.program }; a given tile: program null.
type WindowChecks<P> = {
  readonly decode?: (pid: string, program: string | null) => (view: unknown) => WindowData<P>;
  readonly tile?: (name: string, program: string | null) => ProgramTile<P> | undefined;
  readonly keys?: Keys.Table;
};

// views.ts: one registry, by program.
const WINDOWS = {
  [checklist.name]: checklistWindow,
  [counter.name]: counterWindow,
  [fabsh.name]: fabshWindow,
};
export const windowFor = (program: string) => WINDOWS[program] ?? null;
export const window = windowMachineFor({
  decode: (_pid, program) => Schema.decodeUnknownSync(windowFor(program ?? "")?.data ?? Schema.Never),
  tile: (_name, program) => windowFor(program ?? "")?.tile,
  keys,
});
```

The old branch's `views.ts` (`git log -p a633cc446..4190ff649 -- next/apps/fabrika/src/entry/views.ts`)
registered fabsh by the name `fabsh:1` and decoded by a union of view shapes. This plan does neither:
names change per tile, and a union decodes a view by the first shape that fits, which breaks the day
two programs' views overlap. By program is exact. The headless client's given tiles have no program,
so their `tile(name)` stays as each caller writes it today (`fabsh.test-support.ts`, the laws).

## One value traced through

A person's tab at 1440x900, workspace 1 holding one tile, t1, showing `checklist:1`, focused. The
person's file has no `pack.fabrika.settings.tezgah.new`.

1. **The start.** `dev.ts` loads the settings: `tezgahNew` is `fabrika/fabsh` from its default.
   `refuseNew("fabrika/fabsh", "default", table)` answers null. The snapshot records the value and
   its origin, and its hash goes beside `build` (as every setting's today).
2. **tezgah's load.** The Process object reads `RecordedStart` and hands the runner
   `{fabrika: {tezgah: {new: "fabrika/fabsh"}}}`. The runner wakes `tezgah:<person body>` with
   `execution.init(saved, {tezgah: {new: "fabrika/fabsh"}})`. The stepper decodes it with tezgah's
   `Settings`, climbs a v1 model to v2, and `init` sets `new`.
3. **`C-b %` in t1.** The window arms the prefix, resolves `tezgah.split_right`, mints
   `tile_01jq3m...`, checks the room (720x868 each half), and sends
   `{type: "did", does: "tezgah.split_right", from: <t1>, tile: <new>, via: {_tag: "key", keys: "ctrl+b %"}}`.
4. **tezgah's step.** `refuse` answers null. The update adds
   `Starting.split {program: "fabrika/fabsh", name: "fabsh:01jq3m..."}` and returns
   `start_child {program: "fabrika/fabsh", name: "fabsh:01jq3m..."}`.
5. **The start.** Main's core checks the founder's letter with `StartProgram` and starts the shell.
   The `started` line names the program and the founder as `member`. tezgah gets `start_child_ok`.
6. **The layout.** `placed` splits t1: t2 is `{n: 2, shows: "fabsh:01jq3m...", program: "fabrika/fabsh", child: true, keep: "failed", cursor: null}`,
   focused. A view patch goes to the window.
7. **The window.** The tezgah child takes the view. The new row is
   `{id: <t2>, name: "fabsh:01jq3m...", program: "fabrika/fabsh"}`. `tile(name, "fabrika/fabsh")` is
   fabsh's tile machine, and `decode(pid, "fabrika/fabsh")` is fabsh's view schema. It opens the
   shell's view.
8. **The draw.** Tuval draws `checklist, t1` and `fabsh, t2`, with `aria-current` on t2. The shell's
   line is a labeled textbox; a person types `help` and Enter, and the scrollback answers. This is
   the browser half of L17.

Had the person's file said `fabrika/notes`, step 1 stops the start with: "pack.fabrika.settings.tezgah.new
is fabrika/notes (~/.fabrika/fabrika.toml), but a tile cannot show it. A tile can show
fabrika/checklist, fabrika/counter and fabrika/fabsh." Nothing starts.

## Is this a setting?

- **The program a new tile starts:** yes, `tezgah.new`, as above (0069).
- **Workspace 1's first tile:** no. It is a stand-in with a named end, fabsh slice 2b. If the owner
  wants Firefox's two settings, a `tezgah.first` later loses nothing (open question 1).
- **Which programs have a window:** no. It is code: a program's package exports its window.
- **The refusal of `fabrika/tezgah` as a value:** no. A wall: the window manager is the frame.
- **Keeping `fabsh:1` in the boot list:** no. A boot list is code, as today.

## Linear, per screen

No new screen. The one change is what a new tile holds.

- **What Linear would build.** Linear's way into every action is one typed box, Cmd-K. Asked as
  fabrika's builder: the shell is the program that owns "type what you want next", so a fresh tile
  that offers it is the piece every workspace gets for free. A blank tile would be a dead end; a
  checklist per split is clutter the desk plan already doubted (`docs/plan/lanes/desk-PLAN.md:234`).
- **Where we differ.** Linear's menu is a modal that closes; the shell is a tile that keeps its
  scrollback, as the fabsh plan says. Tiling and the prefix stay tmux's (W5).

## Show it running

The pull request is seen by a person. It waits for the owner's look and is not merged on the lead's
lean.

- **Shots, headless, from the real built tab.** Playwright's Chromium on the real `dev.ts` with its
  own temp `FABRIKA_HOME`, from the visual suite in `next/apps/fabrika/e2e/fabsh.visual.test.ts`,
  using `shoot` from `next/apps/fabrika/e2e/tezgah.test-support.ts`. Written under `runs/` only when
  `SHOTS` names a folder, attached by the lead with alt text, never committed (0160).
- **Five layouts** (`AGENTS.md`, "Shoot more than one layout"), each named `fabsh-tile-<state>-<layout>.png`:
  - one tile filling the window: `checklist, t1`;
  - two side by side: after `C-b %`, `fabsh, t2` focused with `help` answered;
  - two stacked: after `C-b "` from t1;
  - a 2x2: t1 and three shells, focus on the bottom right;
  - a small window at 1024x700: the 2x2, with what folds.
- **Each shot is looked at.** The pull request says what squeezes, breaks or looks empty, above all
  the shell's line and scrollback in a quarter tile and in a strip.
- **Electron:** the same suite on the real app is L18, owed to P19 slice 3 as before. A skipped run
  is not evidence.

## Laws

"Plant" is the change that must turn the law red. New laws are N1 to N9. L17 and L12 are the
existing laws this plan changes.

| id | law | kind | generator | plant |
|---|---|---|---|---|
| N1 | For any `new` drawn from the table's programs but tezgah, every split and every first tile of a workspace other than 1 asks `start_child` for `new`, named `childName(new, tile)`; workspace 1's first tile asks for `checklist:1`; each tile made records the program its start asked for, 200 runs | test | fc.commands: attach, splits, closes and start answers, with `new` from fc.constantFrom over the table's programs | ask for `fabrika/checklist` whatever `new` says |
| N2 | A waiting start and every made tile keep the program they asked for when tezgah loads again with another `new`; only later starts use the new value, 200 runs | test | fc.commands: the N1 moves with reloads under a second value between them | `made` reads `m.new` in place of the Starting's program |
| N3 | A v1 saved tezgah model climbs to v2 with every waiting start's program `fabrika/checklist`, and `init` then sets `new` from the settings handed | test | Effect Arbitrary: TezgahModelV1 | the upgrade drops `program` from a waiting start |
| N4 | The runner hands each process its pack's settings at every init (fresh, wake, after an upgrade), and a value the program's `settings` refuses downs the load with `load`, never a default, 100 runs | test | fc.record: a program with or without `settings`, each init path, values its schema takes or refuses | hand `{}` on a wake |
| N5 | A program's `settings` types its `init`'s second argument, and a program that declares none gets `{}` | type | type | widen the declared settings to `unknown` |
| N6 | `refuseNew` answers null exactly for the table's programs other than `fabrika/tezgah`, and its words name the key, the value, its origin and every program a tile can show; the draws are mixed with the table's names and `fabrika/tezgah`, 300 runs | test | Effect Arbitrary: ProgramName | accept `fabrika/tezgah` |
| N7 | A start whose person's file sets `tezgah.new` to a program the build lacks stops before the build in `refuseNew`'s words, and no instance starts; a repo file that sets it is refused as outside its scope | test | scenario: dev.ts with a temp home, a person's file naming `fabrika/notes`, then a repo file setting the key | call `refuseNew` after the instance starts |
| N8 | Every program in the app's table but `fabrika/tezgah` has a window registered by program; the tab's decoder for that program takes any view of that window's data and refuses the other windows' views | test | fc.constantFrom: the app's table names, with Effect Arbitrary of each window's `data`, default runs | drop `fabshWindow` from the registry |
| N9 | The window machine finds a tezgah tile's machine and its view decoder by the program in tezgah's view, never by the process name; a given tile with no program keeps its name lookup | test | @demlik/tea/pbt.arbMsgSequence | look a tezgah tile up by its name |
| L17 | (changed) In the real tab, `C-b %` from `checklist, t1` opens `fabsh, t2`; typing `hlep` draws each letter before its echo, shows the reason, fix it, `help` answers, and a reload keeps history; the headless half keeps its fixed `fabsh:1` tile | test | scenario: one local instance, a Chromium tab, and Headless.start, as client-protocol's suite runs | leave `fabshWindow` out of `views.ts` |
| L12 | (changed) On the real local instance, a headless client admitted as the founder attaches, splits twice and closes once; workspace 1's first tile is `checklist:1`; each split's tile shows a fresh `fabsh:<tile body>` that tezgah started, and the close stops it | test | scenario: real dev.ts and headless client, one founder, the default setting | keep `NEW_TILE` as `fabrika/checklist` |

**Lint, type or test.** N5 is a type law, in `next/packages/libfabrika/src/runtime/Program.types.test.ts`.
Every other is a test: each needs a run of a program, the runner, the window machine or a real
instance. No new lint rule: nothing here is a shape of code.

**New and changed laws, for the reviewer.** L17's browser half keeps every assertion and adds the
split before it: the region it types into is found by `regionName` of the tile tezgah made, never by
the process name `fabsh:1`, which never matched a tezgah tile's region (`checklist, t1` style). L12
keeps every assertion and changes one word: a split's tile shows a shell, not a checklist. tezgah's
existing laws in `next/programs/tezgah/src/program.laws.test.ts` read the new tile's program from
the Cmd, as now; their walks now hand `init` a settings value drawn per run, so N1 runs inside the
same walk. The visual suites `tezgah-frame`, `tezgah-focus` and `tezgah-fold` change only where they
assume a split's tile is a checklist (typing into the new tile's field, the Tab count to a strip); a
shell's line is a labeled textbox too. Each keeps its strength; none is loosened.

## Host-only laws

- None new. L12, L17's browser half and the shots run a real `dev.ts` brain (workerd through
  Alchemy), real sockets and Chromium. A step's container runs them before the first review. In CI,
  L12 (integration) runs on the 3-hour full run, and the visual suites there and on a pull request
  with the `visual` label (0536).
- L18, the Electron run, stays owed to P19 slice 3. On the owner's Mac it waits for the lead's read
  of its signal and launchd lines and the owner's yes (0178).

## Files

Placement (`next/AGENTS.md`'s libfabrika test): handing a pack's settings to its programs is
something every host needs, so it is in libfabrika's runtime; finding a tile's window by program is
in the window machine every client uses; the registry and the start check against the table are the
app's own.

| file | owner | product lines expected | what changes |
|---|---|---|---|
| next/packages/libfabrika/src/settings/Declarations.ts | build | 25 | `tezgahNew` joins `all`; `corePack` |
| next/packages/libfabrika/src/runtime/Program.ts | build | 35 | the optional `settings` declaration; the stepper's `init(saved, settings)` decodes it |
| next/packages/libfabrika/src/runtime/Execution.ts | build | 15 | both executions' `init` take the settings; the box call carries them |
| next/packages/libfabrika/src/cloudflare/box.ts | build | 5 | the box side passes the second argument to the stepper |
| next/packages/libfabrika/src/runtime/Runner.ts | build | 25 | every init hands the process's pack's settings |
| next/packages/libfabrika/src/cloudflare/ProcessObject.ts | build | 10 | builds `{fabrika: corePack(values)}` from `RecordedStart` for the runner |
| next/packages/libfabrika/src/client/WindowMachine.ts | build | 25 | a tile row carries its program from tezgah's view; `tile` and `decode` take it |
| next/programs/tezgah/src/program.ts | build | 45 | `NEW_TILE` goes; `Settings`, `new` in the model, v2 with its upgrade, `FIRST` with its program, each start keeps its program |
| next/programs/tezgah/README.md | build | docs | the new tile's program is the setting |
| next/apps/fabrika/src/entry/views.ts | build | 20 | the registry by program: checklist, counter, fabsh; decode and tile by program |
| next/apps/fabrika/src/settings.ts | build | 25 | `refuseNew` |
| next/apps/fabrika/dev.ts | build | 8 | calls `refuseNew` after the settings load |
| next/apps/fabrika/src/runtime.ts | build | 2 | `fabsh:1`'s comment: reached by name, no longer the seam |
| next/apps/fabrika/person.json | build | 10 | generated by `settings-generate.ts` from the declarations |
| next/programs/tezgah/src/program.laws.test.ts | tests | tests | N1, N2, N3; the walks hand `init` a drawn value |
| next/programs/tezgah/src/RunnerTest.ts | tests | tests | L12's real half: a split's tile shows a shell |
| next/apps/fabrika/src/tezgah-runner.laws.integration.test.ts | tests | tests | L12 |
| next/packages/libfabrika/src/runtime/RunnerSettings.laws.test.ts | tests | tests | N4, new |
| next/packages/libfabrika/src/runtime/Program.types.test.ts | tests | tests | N5 |
| next/apps/fabrika/src/settings.test.ts | tests | tests | N6 |
| next/apps/fabrika/src/settings-start.integration.test.ts | tests | tests | N7 |
| next/apps/fabrika/src/settings-generated.test.ts | tests | tests | the generated `person.json` holds the new key, as for every declaration |
| next/packages/libfabrika/src/settings/StartsTest.ts | tests | tests | its list of every declaration's default and origin gains the key |
| next/apps/fabrika/src/entry/views.test.ts | tests | tests | N8, new |
| next/packages/libfabrika/src/client/WindowMachine.laws.test.ts | tests | tests | N9 |
| next/apps/fabrika/e2e/fabsh.test-support.ts | tests | tests | L17's browser backend splits first and finds the shell's region by `regionName` |
| next/apps/fabrika/e2e/fabsh.visual.test.ts | tests | tests | L17 and the five layouts' shots |
| next/apps/fabrika/e2e/tezgah.test-support.ts | tests | tests | only where it assumes a split's tile is a checklist |
| next/apps/fabrika/e2e/tezgah-frame.visual.test.ts | tests | tests | only where it assumes a split's tile is a checklist |
| next/apps/fabrika/e2e/tezgah-focus.visual.test.ts | tests | tests | the new tile's field is the shell's line |
| next/apps/fabrika/e2e/tezgah-fold.visual.test.ts | tests | tests | the Tab count to a strip, with shells in the tiles |
| .glossary/TERMS.md | build | docs | a row for `tezgah.new`; the `child (tile)` row's example |
| docs/plan/tier-1.md | build | docs | pieces 2 and 3: a new tile opens the shell (0013) |
| docs/plan/README.md | build | docs | where we are now |

If `next/apps/fabrika/package.json` lacks `@kampus/counter` for its window import, that row goes to
the tests step, as the desk lane's package rows did.

## Records

- **Already recorded, and enough:** the value in force and where it came from, in the start's
  settings snapshot and its hash beside `build`; each tile's `program` in tezgah's saved model; each
  `start_child` and its `started` line with the program and the member.
- **New, recorded now:** each waiting start's `program`. Without it, a restart with another value
  between a split and its answer would label the tile with the wrong program, and that fact could
  not be rebuilt.
- **What fact is lost if not recorded now:** which program a person's splits opened under which
  setting. The tile's `program` and the snapshot hash already hold it; nothing more is needed.
- **Derived, so it can wait:** how often a person sets `tezgah.new`, and how often a new shell tile
  is closed unused.

## Validation

- The tests and build steps run `pnpm format`, `pnpm lint`, and narrow paths with
  `nice -n 15 pnpm exec vitest run --maxWorkers=3 <files>`: tezgah's laws, `RunnerSettings`,
  `Program.types`, the app's `settings.test.ts`, `settings-generated.test.ts`, `views.test.ts` and
  `WindowMachine.laws.test.ts`.
- Integration files with `--project next-integration`, one at a time:
  `next/apps/fabrika/src/tezgah-runner.laws.integration.test.ts` and
  `next/apps/fabrika/src/settings-start.integration.test.ts`.
- Visual files with `nice -n 15 pnpm exec vitest run --project next-visual <file>`, one at a time,
  with `SHOTS` set under `runs/` for the fabsh suite.
- The lead, outside any box, runs the changed-tests set and one type check, and reads CI.

## Size

1. One pull request, the setting, tezgah reading it, and the tab drawing the shell: about 250
   product lines (library about 140, tezgah about 45, the app about 65). It lands whole: the setting is no use until the tab can draw what it starts.

How sure: 65%. The doubts are the box call's second argument through `call("init", ...)`, which I
read but did not run, and how many lines of the three tezgah visual suites assume a checklist in a
new tile. Agent hours, at 600 lines an hour: about 0.5, before steps.

Steps: tests, build, review, plus about two likely send-backs (the visual suites, and open question
1 if the owner picks the other branch). Priced from `field/runs.jsonl` medians, about $1.1 for tests,
$1.2 for build and $1.2 for review, at about twice those for the visual suites.

Estimate: 5 steps, $14

## What this cannot tell us

- **No line of this ran.** Every claim is read from the code at `ddcccc41f`.
- Whether a shell in every split feels right day to day, or whether people close it and reach for
  another program. Only use answers that.
- How the shell's tile reads in a quarter tile or a strip. The shots show it; the shell's guidelines
  walk ([pull request 1254](https://github.com/kamp-us/tea-fabrika/pull/1254)) may change its look,
  and this plan changes none.
- Whether the brain side should refuse an unknown `tezgah.new` again, for a start that does not go
  through `dev.ts`. Today every local start does; the cloud start reads the snapshot `dev.ts` made.
- Whether tests that mock a program table without `fabrika/fabsh` now see refused splits. The
  laws named above use the app's table; the build step greps for others.

## Open questions

1. **What workspace 1's first tile shows.** The brief says the shell. The lead's lean, for the owner
   to read: keep it on the boot list's `checklist:1` until fabsh slice 2b lets the shell show a
   program it starts, then drop the constant so the first tile reads `tezgah.new` too, 75%. Why:
   0137 makes the checklist Tier 1's program, and with the shell in the first tile nothing in the
   tab reaches the checklist today, since a split gives a shell and the shell cannot show what it
   starts. It also keeps the four checklist-first visual suites as they are. The doubt: tmux uses
   one `default-command` for every pane, the first included, and the brief asks for that. Firefox's
   two settings ("new windows" and "new tabs") are the other model, and a `tezgah.first` setting
   later would lose nothing. What settles it: the owner's pick, or fabsh slice 2b landing.

## Findings

None.
