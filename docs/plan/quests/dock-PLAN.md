Approved by the lead agent, builds 0061, 0178, 0069, 0533; body 04a1130dfd55
Plancheck-Version: 3

# Plan: an agent's helper processes run as Node, never as an app in the Dock, and each one ends when its agent does, in today's version

Ticket: to be filed by the lead (title: "Summoning an agent puts Electron icons in the Dock, and a
helper can outlive its agent"). This plan is about today's version only: `packages/fabrika` and
`apps/fabrika`, never `next/`. Code read on main at `c1263d3b9`. Versions read in the lockfiles:
`electron@45.2.1` (`pnpm-lock.yaml`, line 5052), `effect@4.1.2` with our patch,
`@agentclientprotocol/claude-agent-acp@0.99.1`, `@agentclientprotocol/codex-acp@2.5.0` and
`@openai/codex@0.165.0` (`adapters/package.json`, `adapters/pnpm-lock.yaml`).

```ts
// The whole idea, a sketch. One function says how a Node helper starts on this binary.
// On Electron (the host is Electron run as Node), it carries Electron's own switch.
const runAsNode = (electron: boolean = process.versions.electron !== undefined) =>
  electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};

// harness.ts: every adapter starts through it, so the adapter and its own Node children are Node.
const node = (script: string, env: Env): Pick<Spawnable, "command" | "args" | "env"> => ({
  command: process.execPath,
  args: ["--disable-warning=ExperimentalWarning", script],
  env: { ...env, ...runAsNode() },
});

// manager.ts: a helper lives while its name is summoned and up. Down, cut off or dismissed: closed.
```

## Doubts first

- **The brief asks that no helper is left after the app quits. The settled design says the
  opposite, on purpose (95%).** The host outlives the app, as a tmux server outlives its client:
  "Cmd-Q: the window goes, the host goes on" (`docs/direction/the-gui-is-electron-first.md`, line
  513; `apps/fabrika/src/host/main.ts`, lines 12 to 15; `apps/fabrika/src/start-host.ts`, lines 8
  to 10). And a summoned agent "keeps running between turns" until `dismiss` (T1, decided:
  `docs/direction/summon-guidelines.md`, lines 394 to 400). So this plan ends a helper when its
  host stops, never when the app quits or a turn ends. The law is "none left after the host
  stops", and "one is left after a turn ends" is a law too.
- **Most of what the owner saw 40 minutes later was T1 working (80%).** Two agents summoned and
  not dismissed keep their two adapters by design. The third icon is Codex's own child. The fault
  a person sees is the icons. The lifetime gaps are real but narrower: they are listed under
  "The lifetime" below.
- **Whether an orphaned Codex adapter exits by itself once it runs as Node (70%).** Read, not run:
  codex-acp ends its Codex child on stdin close and then leaves its event loop to drain. Under
  Electron's app mode the process never ends by itself, which is a guess from how Electron apps
  behave, not a source. L8 settles it on a real run.

## The cause, read in the code

The process tree today, for one Claude and one Codex summon:

```text
Electron.app/Contents/MacOS/Electron  (the app, Electron's main process: one Dock icon, the app's)
└─ Electron dist/host.mjs              ELECTRON_RUN_AS_NODE=1, FABRIKA_HOME   -> Node: no Dock icon
   ├─ Electron codex-acp/dist/index.js  no ELECTRON_RUN_AS_NODE               -> an app: Dock icon 1
   │  ├─ Electron Helper --type=...     Chromium's own helpers (GPU, network), proof it booted as an app
   │  └─ Electron codex.js app-server   no ELECTRON_RUN_AS_NODE               -> an app: Dock icon 2
   │     └─ codex (native)              not Electron: no icon
   └─ Electron claude-agent-acp/dist/index.js  no ELECTRON_RUN_AS_NODE        -> an app: Dock icon 3
      ├─ Electron Helper --type=...
      └─ claude (native, the Agent SDK's binary)   not Electron: no icon
```

Each step, with where it is:

- **The app starts the host** on its own binary, `binary: process.execPath`
  (`apps/fabrika/src/main.ts`, line 522), with `ELECTRON_RUN_AS_NODE: "1"` added to the app's
  whole environment (`apps/fabrika/src/start-host.ts`, lines 52 to 60), detached and let go (lines
  80 to 89). The host's environment was read on this machine with `ps` on 2026-11-15: it holds
  `ELECTRON_RUN_AS_NODE` and `FABRIKA_HOME`.
- **The host starts each adapter on the same binary:** `command: process.execPath`
  (`packages/fabrika/src/agents/acp/harness.ts`, lines 850 to 853), spawned with
  `extendEnv: false` and only the harness's own environment (`packages/fabrika/src/agents/acp/client.ts`,
  lines 152 to 162).
- **That environment is a keep-list, and `ELECTRON_RUN_AS_NODE` is not on it.** The Claude row's
  is `fencedEnv(agentEnv(parent))` (`harness.ts`, line 878); `agentEnv` keeps `PATH`, `HOME`,
  `TMPDIR`, the locale, `TZ` and the login names (`packages/fabrika/src/agents/claude/env.ts`,
  lines 14, 22 and 53 to 59), and `fencedEnv` only adds git, npm and config keys
  (`packages/fabrika/src/agents/claude/sandbox.ts`, lines 212 to 227). The Codex row's is
  `codexEnv`, `runEnv` plus Codex's own keys (`harness.ts`, lines 681 to 702), rebuilt the same way
  for a turn's system prompt (`harness.ts`, line 791). The fake's is `runEnv` (line 886). So the
  adapter starts on the Electron binary with no switch, and Electron boots its whole app.
- **Electron decides at its first line.** `main` runs Node only when the `runAsNode` fuse is on and
  `ELECTRON_RUN_AS_NODE` is set and not empty; else it runs `ElectronMain`, the browser process
  (`shell/app/electron_main_mac.cc` at tag v45.2.1, lines 37 to 40 and 70 to 73, read with
  `gh api`). The browser process is an `NSApplication`, and `Electron.app`'s `Info.plist` has no
  `LSUIElement` or `LSBackgroundOnly` (read with `plutil` in `node_modules`), so macOS gives it a
  regular Dock icon. The host has none because it never reaches that code.
- **Codex's child is the grandchild icon.** codex-acp starts Codex with `CODEX_PATH` unset, so it
  runs `spawn(process.execPath, [codex.js, "app-server"], { env: process.env })`
  (`adapters/node_modules/@agentclientprotocol/codex-acp/dist/index.js`, lines 28097 to 28105 and
  54223 to 54242). Its `process.env` is the adapter's, so it has no switch either, and its
  `process.execPath` is the Electron binary. codex.js then starts the native binary
  (`@openai/codex/bin/codex.js`, line 241), which is no Electron.
- **The Claude adapter's child is native.** The Agent SDK starts its own `claude` binary, and the
  adapter hands it `{...process.env, ...options.env}`
  (`adapters/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js`, lines 9010 to
  9019 and 9089).
- **Seen live, read only.** On this machine at about 12:44 Pacific on 2026-11-15, `ps` showed both
  adapters on the Electron binary as children of the host, each with two `Electron Helper --type=`
  children, which only Electron's app mode starts, and the Claude adapter's native `claude` child.
  By the time the environment was read, those processes had ended.

**The sandbox wrappers change nothing for the summon.** `agents/claude/sandbox.ts` is no wrapper:
`fencedEnv` keeps what it is given and adds three keys, and `toolchain` adds the folder holding
`process.execPath` to what a command may read (lines 104 to 124). `sandbox/os.ts` wraps a job in
sandbox-runtime, started as `command: process.execPath` with `fencedEnv(launch.env, tools)` (lines
76 to 101). That env has no switch either, so it has the same fault. But only the pipeline's
`stages/pipeline/tools.ts` uses it, never the app's summon. It goes to the findings, below.

**What does reach every descendant, once it is set.** codex-acp hands Codex its whole
`process.env`, and codex.js hands the native binary its own (lines 28098 and 241). So a switch set
on the adapter reaches codex.js with no change to the adapter. Codex's commands never get it:
their environment is `inherit: "core"` plus a fenced set (`harness.ts`, line 538). The Claude CLI
does get it, and its Bash commands inherit the CLI's environment.

## How others do it

- **Electron's own `child_process.fork`.** In a process run as Node, Electron replaces `fork` so the
  child "runs like upstream Node.js": it sets `options.env.ELECTRON_RUN_AS_NODE = '1'`, and on a Mac
  it starts the child on `process.helperExecPath`, the helper binary
  (`lib/node/init.ts` at v45.2.1, lines 6 to 41). The helper's `Info.plist` has `LSUIElement = 1`
  (read with `plutil`), so it never gets a Dock icon even as an app. Electron's docs:
  `ELECTRON_RUN_AS_NODE` "Starts the process as a normal Node.js process" and is ignored when the
  `runAsNode` fuse is off (`docs/api/environment-variables.md` at v45.2.1, lines 91 to 107;
  `docs/tutorial/fuses.md`, lines 26 to 36).
- **`utilityProcess`.** Electron's recommended way for a Node child, but its docs say "Process:
  Main" (`docs/api/utility-process.md` at v45.2.1). Our host is not Electron's main process, and it
  outlives the app, so it cannot call it.
- **`app.dock.hide()`.** A main-process API that an app calls on itself (`docs/api/dock.md` at
  v45.2.1). We do not own the adapters' code, and once they run as Node there is no app to hide.
- **`LSUIElement` or `LSBackgroundOnly`.** Keys in a bundle's `Info.plist`. Setting one on
  `Electron.app` would hide the app's own Dock icon too. The helper bundle already has one.
- **This repo already said it.** "Inside Electron's main process, `process.execPath` is Electron,
  not Node. ... that child needs `ELECTRON_RUN_AS_NODE=1`, or Electron's `utilityProcess`"
  (`docs/direction/the-gui-is-electron-first.md`, lines 123 to 126). The host's start follows it;
  the adapters' start does not.
- **The commands a person or agent runs get no `ELECTRON_*`.** VS Code strips `/^ELECTRON_.+$/`
  from a terminal's environment (`sanitizeProcessEnvironment` in
  `src/vs/base/common/processes.ts`, microsoft/vscode main, read with `gh api` on 2026-11-15). Our
  own keep-list says the same: "a variable that is not named is not handed on" (`env.ts`, lines 1
  to 5).
- **Who ends a child: Erlang/OTP.** A supervisor's child lives in its tree and ends when the
  supervisor ends it or when the supervisor itself ends; a linked process that loses its parent
  exits. A shutdown is `exit(Child, shutdown)`, then `kill` after the child spec's timeout
  (https://www.erlang.org/doc/apps/stdlib/supervisor.html, as the memory-restart plan read it on
  2026-11-15; not fetched again here). In our code the tree is Effect's scopes (0061), the link is
  the stdin pipe, and the shutdown is Effect's spawner: SIGTERM to the child's process group, then
  SIGKILL after `forceKillAfter`
  (`node_modules/@effect/platform-node-shared/dist/NodeChildProcessSpawner.js` at 4.1.2, lines 418
  to 434 and 487 to 506; detached by default off Windows,
  `dist/internal/nodeChildProcessSpawner.js`, line 2).

The options, and what each loses:

| Option | What it loses |
|---|---|
| A. Set `ELECTRON_RUN_AS_NODE=1` on every helper the host starts on its own binary (the lean) | Nothing it needs: the host already runs this way, with no Dock icon. The variable also reaches the Claude CLI, so its commands need it cleared (below) |
| B. Run the helpers on a real Node, not Electron's | No Node ships: there is no packaged app (`apps/fabrika/README.md`, line 816), and on a person's Mac the only Node we know is the app's own. A found Node differs from the one tested (`host/main.ts`, lines 19 to 22) |
| C. A and Electron's helper binary, as `fork` does | A second binary in the launch, and in the toolchain the Claude sandbox opens. `process.helperExecPath` is set in a process run as Node too (`node_main.cc`, line 357, runs `OnNodePreload`, which sets it: `node_bindings.cc`, lines 1215 to 1241). It adds a second guard where the host shows one is enough |
| D. `utilityProcess`, `dock.hide`, `LSUIElement` on `Electron.app` | Main-process only, not ours to call, or hides the app itself |

**The lean: A (85%).** It is what Electron's own `fork` does, what this repo's direction note says,
and what the host already proves on a real Mac. The doubt: Electron's `fork` adds the helper binary
on a Mac, and the plan does not know why it wants both. If L7 shows a Dock entry with A alone, C
is the fix, in this same pull request.

**Clearing it for the Claude CLI's commands (80%).** The adapter spreads `options.env` over its own
environment before it starts the CLI (`acp-agent.js`, lines 9010 to 9012), so a key cannot be
removed there, only set. Electron treats an empty value as unset (`electron_main_mac.cc`, lines 37
to 40). So `claudeOptions` sets `env: { ELECTRON_RUN_AS_NODE: "" }` when on Electron. The doubt: a
reader other than Electron could treat an empty value as set. None is known.

## The shape

### One way to start a Node helper (`packages/fabrika/src/agents/claude/env.ts`)

`env.ts` is already "the environment a process this repo starts may have", so the switch lives
there, beside the keep-lists.

```ts
/**
 * What a Node helper started on this process's own binary needs to run as Node. Electron's binary
 * boots its whole app, with a Dock icon on a Mac, unless this is set and not empty
 * (electron_main_mac.cc). On plain Node it is nothing. `electron` is read once, at the edge.
 */
export const runAsNode = (electron: boolean = process.versions.electron !== undefined) =>
  electron ? ({ ELECTRON_RUN_AS_NODE: "1" } as const) : ({} as const);

/** The same switch, cleared, for the commands an agent runs: they never inherit it (VS Code's way). */
export const notAsNode = (electron: boolean = process.versions.electron !== undefined) =>
  electron ? ({ ELECTRON_RUN_AS_NODE: "" } as const) : ({} as const);
```

`process.versions.electron` is set in Electron's processes, run as Node or not
(`shell/common/node_bindings.cc` at v45.2.1, lines 1242 to 1245, inside `OnNodePreload`, which
`shell/app/node_main.cc`, line 357, runs in a process run as Node). It is not read from the parent's
`ELECTRON_RUN_AS_NODE`, because an adapter started from Electron's main process would have none and
still need it.

### The harness (`packages/fabrika/src/agents/acp/harness.ts`)

Today and after:

```ts
// Today, harness.ts:850. The env is added by each row on its own, and none adds the switch.
const node = (script: string): Pick<Spawnable, "command" | "args"> => ({
  command: process.execPath,
  args: ["--disable-warning=ExperimentalWarning", script],
});
// ...node(CODEX), env: codexEnv(parent, folder, row.access),

// After. The only way a row gets its command is with its env, and the switch with both.
const node = (script: string, env: Env, electron?: boolean): Pick<Spawnable, "command" | "args" | "env"> => ({
  command: process.execPath,
  args: ["--disable-warning=ExperimentalWarning", script],
  env: { ...env, ...runAsNode(electron) },
});
// codex:  ...node(CODEX, codexEnv(parent, folder, row.access)),
// claude: ...node(CLAUDE, fencedEnv(agentEnv(parent))),
// fake:   ...node(FAKE, runEnv(parent)),
// withSystem, codex: ...node(harness.script, codexEnv(parent, folder, harness.access, toolchain(parent), config)),
```

`Env` values are `string | undefined`; `node` drops undefined values as `kept` does, so `Spawnable`
keeps `Record<string, string>`. `claudeOptions` gains `env: notAsNode()`, so `claudeRepoOptions` and
the pipeline's `builderHarness` both carry it. `underGuard` in
`packages/pipeline/src/stages/build/builder-acp.ts` (line 476) needs no change: it passes
`harness.env` on, which now has the switch. L1 holds it.

### The lifetime (`packages/fabrika/src/agents/summon/manager.ts`)

What ends a helper, by point, today and after:

| Point | Today | After |
|---|---|---|
| A turn ends | Nothing ends; the agent waits for its next turn (T1, `manager.ts`, lines 53 to 55) | The same. L5 holds it |
| `dismiss`, from tsh or the top bar | `cancelTurn`, then `close`: `Scope.close(l.scope)` ends the acp run, whose scope ends the adapter's process group (`manager.ts`, lines 405 to 415 and 662 to 676; `client.ts`, line 158) | The same, plus a `helper ended` log line |
| The acp run ends by itself | The name is `down`; the run's scope already closed, so its process is gone (`manager.ts`, lines 383 to 400) | The same |
| A kept name reopens at host start, but its settings are refused | The name is `down`, yet its acp run and adapter keep running in `agent.scope`, which nothing closes until a `dismiss` (`manager.ts`, lines 553 to 567 and 496 to 507) | The run's scope closes when it goes down; the name stays listed down with its why, and its record is kept for the next host |
| A summon cut off between its start and its keep (an interrupt) | A failure closes it (`gone`, line 613); an interrupt does not, so the adapter runs, unlisted, until the host stops | One `Effect.onError` closes it on a failure and on an interrupt alike; `gone` only refuses |
| A tile closes | Nothing: a name belongs to the host, not to a tile (`manager.ts`, lines 38 to 55) | The same |
| The app quits | Nothing: the host outlives the app (decided, above) | The same |
| The host stops (SIGTERM, a restart, `fabrika connect`) | The manager's layer scope closes, so every name's scope does (`manager.ts`, lines 270 and 310; `host/main.ts`, lines 36 to 40) | The same. L6 holds it |
| The host dies hard (SIGKILL, a crash) | No signal reaches the helpers. The Claude adapter exits on stdin close (`claude-agent-acp/dist/index.js`, lines 83 to 95). codex-acp stops Codex on stdin close (`codex-acp/dist/index.js`, lines 54251 to 54253) and then waits for its loop to drain, which Electron's app mode never lets end (guess) | Both run as Node, so both end on stdin close. L8 proves it on the real adapters |

A session a person may want to continue keeps its record: a name that goes down at reopen keeps
its kept name and its acp session in storage (`downOf`, lines 510 to 529, and no
`storage.remove`), so the next host start opens it again with `session/load`. Only `dismiss`
removes the record, as today.

The scope that owns a helper, after:

```ts
// manager.ts, a sketch. A Live's scope owns its acp run, and so its adapter's process group.
const own = yield* Scope.fork(scope); // the manager's scope: closes when the host stops
// ...start(acpInRepo, ...).pipe(Scope.provide(own)) as today

// The reopen path. Down means no process: close the run's scope, keep the name listed down.
yield* opening(agent).pipe(
  Effect.flatMap((o) => settle(agent, o, { model: name.model.resolved, effort: name.effort.set })),
  Effect.exit,
  Effect.flatMap((done) =>
    Exit.isFailure(done)
      ? ended(agent, "down").pipe(Effect.andThen(readied(agent, Exit.asVoid(done))))
      : readied(agent, Exit.void),
  ),
  Effect.forkIn(scope), // forked in the manager's scope: closing `agent.scope` must not cut it
);

// The summon path. Every exit that does not keep the name closes it.
const l = yield* open(first);
return yield* keepOrRefuse(l, first, settings).pipe(
  Effect.onError(() => close(l, "refused").pipe(Effect.ignore)),
);

// One place that ends a name's run, with why, logged.
const ended = (l: Live, reason: "dismissed" | "down" | "refused") =>
  Scope.close(l.scope, Exit.void).pipe(
    Effect.andThen(Effect.logInfo("helper ended")),
    Effect.annotateLogs({ name: l.name.name, run: l.name.run, agent: l.name.agent, reason }),
  );
```

`keepOrRefuse` is the body of today's summon after `open`, unchanged but for `gone`, which now only
refuses. `close` keeps its storage removal and calls `ended`. The host stopping needs no new code:
its scope closes every name's.

## One value traced

A Codex summon on the app's host, after the fix. The host runs on Electron, run as Node.

1. tsh's `summon codex as scout` reaches `manager.summon`. `open` forks `own` from the manager's
   scope and starts `acpInRepo` in it.
2. `program.ts`, line 293: `harnessOf({ name: "codex", access: "read" }, repo, null)`. `node(CODEX,
   codexEnv(...))` answers `{ command: <Electron binary>, args: ["--disable-warning=...",
   <codex-acp index.js>], env: { PATH, HOME: <codex home>, CODEX_HOME, CODEX_CONFIG, ...,
   ELECTRON_RUN_AS_NODE: "1" } }`.
3. `connect` spawns it detached, so it leads its own process group G. Electron's `main` sees the
   switch and runs Node. No `NSApplication`, no Dock icon, no `Electron Helper` children.
4. codex-acp starts `<Electron binary> codex.js app-server` with its own `process.env`, which has the
   switch: Node again, in group G. codex.js starts the native `codex`, in group G. A command Codex
   runs gets `inherit: "core"` and the fenced set: no `ELECTRON_*`.
5. A turn runs and ends. `result` sets scout `idle`. Every process in G stays (T1).
6. The person presses Dismiss. `cancelTurn` has nothing to cancel; `close` runs `ended(l,
   "dismissed")`: the acp run's scope closes, Effect's spawner sends SIGTERM to `-G`, codex.js
   forwards it to the native binary, and anything left after 3 s gets SIGKILL. The log says
   `helper ended {name: scout, run: acp:scout-..., agent: codex, reason: dismissed}`. Storage
   removes the run.
7. Had the host been SIGKILLed at step 5 instead, codex-acp's stdin would close, it would stop its
   Codex child, and, running as Node, exit when its loop is empty (L8).

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1, every Spawnable that starts on `process.execPath` (each row of `harnessOf`, each through `withSystem`, and `underGuard` over each) carries `ELECTRON_RUN_AS_NODE: "1"` when on Electron and no `ELECTRON_*` key at all on plain Node, and passes no other `ELECTRON_*` key from the parent, 200 runs | test | fc.record: a row (claude, fake, codex read or write), a system prompt or none, guarded or not, on Electron or not, and a parent env with random keys and random `ELECTRON_*` keys | build `withSystem`'s codex env without `node`: the switch is lost on Codex with a system prompt and L1 fails; or add the switch to `runEnv`'s keep-list from the parent: plain Node with a parent switch fails | packages/fabrika/src/agents/acp/harness.run-as-node.laws.test.ts |
| L2, the commands an agent runs never inherit the switch: on Electron the Claude row's `_meta.claudeCode.options.env.ELECTRON_RUN_AS_NODE` is `""`, and Codex's `shell_environment_policy` is `inherit: "core"` with no `ELECTRON_*` key in its `set`; on plain Node the Claude options have no `env` key, 200 runs | test | fc.record: the same rows and parents, and a budget | drop `env: notAsNode()` from `claudeOptions`: the Claude case fails; or spread the adapter's env into Codex's `set`: the Codex case fails | packages/fabrika/src/agents/acp/harness.run-as-node.laws.test.ts |
| L3, `runAsNode` and `notAsNode` answer only the one key, and only on Electron, 50 runs | test | fc.boolean: on Electron or not | answer `{}` on Electron: L3 fails | packages/fabrika/src/agents/claude/env.test.ts |
| L4, a name that reopens down holds no process: a kept fake name whose kept model the fake no longer offers is listed down with its why, its adapter's process group is gone within 4 s, its kept name and session stay in storage, and a `dismiss` of it still works, 20 runs | test | fc.record: which setting is refused (model or effort), when the next host starts, whether a turn is tried while down | main's `manager.ts`: the fake's pid still answers signal 0 after 4 s and L4 fails | packages/fabrika/src/agents/summon/manager.lifetime.laws.test.ts |
| L5, a turn's end ends nothing: after each of one to four turns the same fake pid answers, and the next turn uses it, 20 runs | test | fc.integer: one to four turns | close the run's scope on `result`: the second turn's pid differs and L5 fails | packages/fabrika/src/agents/summon/manager.lifetime.laws.test.ts |
| L6, every exit ends the helper and leaves none: a summon interrupted or refused at any point between its start and its keep, a dismiss in any state (opening, idle, turn, asking), and the manager's scope closing with one to three names up, each leave no fake process alive within 4 s and no unlisted run in storage, 30 runs | test | fc.record: the cut point (after open, after opening, after settle), interrupt or refusal, the state at dismiss, the number of names up when the scope closes | drop the `Effect.onError` close: an interrupted summon's fake pid stays alive and L6 fails | packages/fabrika/src/agents/summon/manager.lifetime.laws.test.ts |
| L7, on a real Mac, the real adapters on the real Electron binary, started through `connect`'s spawn with `harnessOf`'s env and a temp Codex home with no login, with no model called: every process in each adapter's process group that runs the Electron binary has `ELECTRON_RUN_AS_NODE=1` in its environment (`ps -E`), none is an `Electron Helper --type=` process, and `lsappinfo list` shows no app whose pid is in the group, while the group has its second process (codex.js) | test, host-only | scenario: the real Electron 45.2.1 binary from `node_modules`, the real `adapters/` install, a real macOS session on GitHub's runner | run on main's `harness.ts`: `lsappinfo` lists `Electron` for the adapter's pid and two `--type=` helpers appear, the shape seen on 2026-11-15 | packages/fabrika/src/agents/acp/helpers.host.test.ts |
| L8, on the same run, a host that dies hard leaves none: with the scope's kill turned off for this one case (the handle unreferenced), closing only the adapter's stdin ends every process of its group within 15 s, for each adapter; and closing the scope as `dismiss` does ends every process of the group within 4 s | test, host-only | scenario: the same real binary and adapters, stdin closed with no signal sent | run on main's `harness.ts`: codex-acp, booted as an app, is still alive after 15 s and L8 fails (the guess this law settles) | packages/fabrika/src/agents/acp/helpers.host.test.ts |

Notes on the laws:

- **Lint, type or test.** L1 to L3 are tests of values, not of code's shape, so they are not lint.
  A lint rule for "no `process.execPath` spawn outside `node`" was weighed and left out (75%):
  `packages/fabrika/src/host/local.ts`, line 183, spawns it rightly with `extendEnv: true`, and
  dozens of tests spawn it as their real Node, so a rule would need its false alarms measured
  before it could block. L1 covers every launch this change makes.
- **The fake shows its pid.** L4 to L6 need the fake's pid. The fake already notes each prompt in
  `<folder>/.fake-acp/log`; the tests step adds a `pid <n>` line at its start
  (`packages/fabrika/src/agents/acp/fake-agent.ts`), so no environment key is added to its keep-list.
- **Where each runs.** L1 to L3 are in memory and run on every pull request in the `today`
  project. L4 to L6 start real Node processes (the fake), as `manager.dismiss.laws.test.ts` does
  today, so they run in the `today` project too and on a laptop under the caps. L7 and L8 are
  host-only (0178): they need a real macOS session and the real Electron binary, which today's CI
  never downloads. The file skips itself unless `FABRIKA_HOST_LAWS=1`, as P19's law does with
  its own key.
- **Every plant is run once** by the tests step and recorded in its report and run row, never
  committed.

**Host-only laws: L7 and L8.** They run before the first review (0178), on GitHub's macOS runner, in
a new manual job in `.github/workflows/host.yaml` (`workflow_dispatch`, plus its own paths: the
host test file and `harness.ts`), shaped like its `launchd` job, with `pnpm --dir adapters install
--ignore-workspace --frozen-lockfile` and an Electron restore. The runner is thrown away after the
job, so a wrong signal there hits nothing anyone uses. On the owner's Mac they run only after the
lead's read of the lines below and the owner's yes.

**What only a person's look at the Dock confirms.** That no icon appears when a Claude and a Codex
agent are summoned in the real app, and that none comes back after a dismiss. `lsappinfo` is what
the Dock reads its list of apps from, so L7 is close, but the Dock itself is not read by any law.

## Every line that ends, stops or signals a process

The owner reads these before any run on his Mac.

| Line | Where | What it signals | The guard |
|---|---|---|---|
| `Scope.close(l.scope, Exit.void)` in the new `ended` | `packages/fabrika/src/agents/summon/manager.ts` | Through Effect's spawner, SIGTERM then, after 3 s, SIGKILL to `-pid` of the adapter it spawned | `l.scope` is forked from the manager's scope for this one name (line 310). The spawner signals only the group of a child it spawned detached, whose pid it holds (`NodeChildProcessSpawner.js`, lines 358 to 386 and 418 to 434); it never reads a pid from the process table |
| `Effect.onError(() => close(l, "refused"))` in `summon` | the same file | The same, through `ended` | Only the `Live` this call opened, and only on an exit that did not keep it |
| `ended(agent, "down")` on the reopen path | the same file | The same, through `ended` | Only when that name's reopen failed, and only for the `Live` the reopen made |
| No new `process.kill`, `kill` or `launchctl` in product code | | | |
| `process.kill(pid, 0)` in L4 to L6 | `packages/fabrika/src/agents/summon/manager.lifetime.laws.test.ts` | Signal 0: a check only, nothing is sent | The pid is the fake's own `pid` line in its temp folder's log, and must be over 1 |
| The scope close in L7 and L8 | `packages/fabrika/src/agents/acp/helpers.host.test.ts` | Effect's spawner, as above, to the group of the adapter the test started | The same spawner guard. The test reads `ps -E -o pid,pgid,command` and `lsappinfo list` and signals nothing itself. A process it finds left at the end fails the law; the test does not kill it, and the runner is thrown away |

## Is this a setting?

0069 asks it of each new choice:

- **The switch on a helper: no.** No person would choose a Dock icon per helper. It is what the
  binary needs to be Node, and the direction note already says so.
- **Clearing it for the agent's commands: no.** It follows the keep-list rule in `env.ts`, which
  is not a setting either.
- **When a helper ends: no.** T1 decided it: a name runs until it is dismissed, down, or its host
  stops. An idle timeout would be a new design call against T1, not a knob.
- **The 3 s before SIGKILL: not new.** `client.ts`, line 158, unchanged.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| `packages/fabrika/src/agents/claude/env.ts` | build | 14 | `runAsNode` and `notAsNode`, with their comment |
| `packages/fabrika/src/agents/acp/harness.ts` | build | 14 | `node` takes the env and adds the switch; the three rows and `withSystem` use it; `claudeOptions` gains `env: notAsNode()`; the comment at `node` says why |
| `packages/fabrika/src/agents/summon/manager.ts` | build | 26 | `ended` with its log line; `close` calls it; the reopen path closes a down name's run; `summon`'s body moves under one `Effect.onError`; the head comment says when a helper ends |
| `apps/fabrika/README.md` | build | docs | the host bullet (line 110) says every helper it starts on its binary runs as Node too |
| `packages/fabrika/src/agents/acp/harness.run-as-node.laws.test.ts` | tests | tests | L1 and L2, new |
| `packages/fabrika/src/agents/claude/env.test.ts` | tests | tests | L3, new (no test file holds `env.ts` today beside it; the tests step checks for one first) |
| `packages/fabrika/src/agents/summon/manager.lifetime.laws.test.ts` | tests | tests | L4 to L6, new |
| `packages/fabrika/src/agents/acp/fake-agent.ts` | tests | tests | a `pid <n>` line in its log at start |
| `packages/fabrika/src/agents/acp/helpers.host.test.ts` | tests | tests | L7 and L8, new, skipped unless `FABRIKA_HOST_LAWS=1` |
| `.github/workflows/host.yaml` | tests | tests | the manual `helpers` job for L7 and L8 on `macos-15` |
| `packages/fabrika/src/agents/acp/harness.test.ts` | tests | tests | expected `env` values gain the switch where a case runs on Electron, if any does |
| `packages/fabrika/src/agents/acp/client.ts` | build | none | not changed: cited for the spawn and `forceKillAfter` |
| `packages/fabrika/src/agents/claude/sandbox.ts` | build | none | not changed: `fencedEnv` keeps what it is given |
| `packages/fabrika/src/sandbox/os.ts` | build | none | not changed: the same fault, outside the summon; see Findings |
| `packages/pipeline/src/stages/build/builder-acp.ts` | build | none | not changed: `underGuard` passes the harness's env on, held by L1 |
| `apps/fabrika/src/start-host.ts` | build | none | not changed: already the shape this follows |
| `patches/` | tests | none | not changed: no patch to Electron or the adapters, since nothing upstream is wrong |
| `pnpm-lock.yaml` | tests | none | not changed: read for the versions |

## Validation

- The tests step: `pnpm format`, then `nice -n 15 pnpm exec vitest run --maxWorkers=3` on
  `harness.run-as-node.laws.test.ts`, `env.test.ts` and `manager.lifetime.laws.test.ts`, each plant
  once, and `pnpm lint`. It does not run L7 or L8 on a laptop; it reports their signal lines.
- The build step: the same narrow paths, and `pnpm lint`.
- The lead: one `pnpm typecheck`, then `gh workflow run host.yaml --ref fabrikalfa/agent-helpers-dock`
  for L7 and L8 before the first review, and reads the job's output: each group's processes with
  their switch, the `lsappinfo` lines, the times to exit. Then the leak grep.
- After merge, a person summons a Claude and a Codex agent in the real app and looks at the Dock.

## Size

One pull request that lands whole.

1. Helpers run as Node and end with their agent: about 54 product lines in three files, one
   README bullet, about 400 test lines in five files and one CI job.

Priced from the memory-restart plan's figures for similar lanes in `field/runs/` (ticket 955's
tests $1.60, build $0.68, review $1.75; ticket 502's slice 2 tests $1.51, fix round $6.47, review
$5.09). This one has fewer product lines than either, but two real-process law files and one
host-only file on a CI job nobody has run for today's version. Expected: tests about $5, build
about $2, review about $3, one fix round about $4. Confidence 70%: the doubt is L7 and L8, the
first host-only laws for today's version on GitHub's macOS runner.

Estimate: 4 steps, $14

## Records

- **What is lost if not written now:** when each helper ended and why. Today only `dismissed` is
  logged; a down name's run, an interrupted summon and a host stop leave no line, so a pile of
  helpers cannot be explained afterward. The new `helper ended` line records name, run, agent and
  reason at the moment. A helper's pid is not recorded: the acp run does not expose it, and it
  rebuilds from nothing later, so that is lost; the plan accepts it, since the reason is the fact a
  person asks for.
- No `.decisions/` file: the calls here build the direction note (`the-gui-is-electron-first.md`,
  lines 123 to 126), T1, 0061 and 0178, and pick how the code does it.
- No glossary row: `ELECTRON_RUN_AS_NODE` is Electron's own name.
- `field/runs/` rows for each step, written by the lead.

## What this cannot tell us

- Why Electron's `fork` adds the helper binary on a Mac when the switch alone keeps a process out
  of the app's code. Read, not explained by any comment there; L7 shows whether it matters for us.
- Whether the Dock itself ever shows a helper. `lsappinfo` is LaunchServices' list, not the Dock.
- Whether codex-acp has a timer or handle that keeps it alive after stdin closes even as Node. L8
  says yes or no; if yes, that is an upstream bug report with L8's run as its repro (0054).
- Whether a signed, packaged app will keep the `runAsNode` fuse on. There is none yet; the
  direction note names the same doubt for the host (line 605).
- What an agent's command does with an empty `ELECTRON_RUN_AS_NODE` in a tool other than Electron.
  None is known to read it.

## Open questions

None.

Every call above builds a settled note: the switch (the GUI direction note), when a helper ends
(T1 and the host outliving the app), the scope (0061) and where the host-only laws run (0178).

## Amendment, 2026-11-15

Made by the lead after the build and the review, on decision
[0533](../../../.decisions/0533-today-keeps-its-tests-off-ci.md): CI runs none of today's tests.

- **No `helpers` job.** `.github/workflows/host.yaml` is not changed, and its row in the files
  table is void. Where this plan says L7 and L8 run on GitHub's macOS runner, read: they run by
  hand on the owner's Mac, with the one command in the head comment of
  `packages/fabrika/src/agents/acp/helpers.host.test.ts`, only after the lead's read of every
  line that inspects or ends a process and the owner's yes (0178).
- **What that changes for L8.** No runner is thrown away. If L8 fails, the adapter and its
  children stay running on that Mac, the failure message lists their pids, and a person ends
  them by hand. The test itself sends no signal.
- **The order 0178 asks for was not met.** The first review ran before L7 and L8. Its verdict
  for "no Dock icon" and "an orphaned adapter exits" rests on reading until they run.
- **`Effect.acquireUseRelease` in place of `Effect.onError`** in `summon`: the run's scope exists
  before `open` starts anything, so an interrupt inside `open` closes it too. The review read
  it and found it better than the plan's shape.
- **The plan file moved** from `docs/plan/lanes/` to `docs/plan/quests/` when main renamed the
  folder (0546).

## Findings

```json
{"id": "2026-11-15-pipeline-node-helpers-boot-electron", "what": "Three pipeline spawns start process.execPath with an environment that has no ELECTRON_RUN_AS_NODE, so run inside the app's host each would boot Electron as an app with a Dock icon: the os sandbox's sandbox-runtime launch, the builder's PreToolUse hook command line, and the SDK builder's guard. Today they run from a plain Node, so nothing shows. The os sandbox case also passes its whole env to the program it fences, so adding the switch there would hand it to the agent's work too; it needs its own plan.", "where": ["packages/fabrika/src/sandbox/os.ts:94", "packages/pipeline/src/stages/build/builder-acp.ts:423", "packages/pipeline/src/stages/build/guarded.ts:42"], "proof": "os.ts:98 sets env to fencedEnv(launch.env, tools), which keeps only what it is given plus three keys (agents/claude/sandbox.ts:212-227); builder-acp.ts:423 builds a shell command from process.execPath with no env prefix; electron_main_mac.cc at v45.2.1, lines 70-73, boots the app when the variable is unset.", "version": "today"}
```
