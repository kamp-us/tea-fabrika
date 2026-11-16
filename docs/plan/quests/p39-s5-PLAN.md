Approved by the lead agent, builds 0102, 0185, 0280, 0026; body c411af97c963
Plancheck-Version: 3

```ts
// next/, sketch. Slice 4b: the hands client gets real parts on a laptop, and runs as its own process.
//   node hands.ts            -> key file  ~/.fabrika/hands/key.json   (0600; made once, then reused)
//                            -> journal   ~/.fabrika/hands/journal.sqlite
//                            -> HandsStart.start({ origin: "http://127.0.0.1:<instance.port>", os: "macos", ... })
//   jobs.take -> assigned git_version
//   CommandsNode.execute     -> spawn "git" ["--version"], env { PATH } only, output capped
//                            -> exited { code: 0, version: "git version 2.47.0" }
//   jobs.finish { result }   -> ok
```

# P39 slice 4b: the real command, the key file, the journal file and the hands launcher, in next/

ticket: to be filed

Writer: the plan step for P39's next slice. Version: `next/` only. Today's version is not touched.

Base read: branch `fabrikalfa/p39-s4` at `7dad34bb6` (slice 4a, draft pull request
https://github.com/kamp-us/tea-fabrika/pull/1315, not merged). This slice stacks on it. Every code
line cited here is read on that branch.

Builds [0102](../../../.decisions/0102-hands-is-a-grant-rank-and-work-is-taken.md),
[0061](../../../.decisions/0061-resources-are-acquired-in-a-scope.md),
[0095](../../../.decisions/0095-a-service-file-holds-only-its-contract.md),
[0280](../../../.decisions/0280-the-app-starts-a-launchd-brain.md),
[0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md),
[0178](../../../.decisions/0178-host-only-laws-run-first.md),
[0171](../../../.decisions/0171-make-it-work-then-better-then-secure.md) and
[brain, hands, window, agent](../../direction/brain-hands-window-agent.md). Row P39 of
[`docs/plan/tier-1.md`](../tier-1.md), build order step 5.

## The answer first

**No decided note cuts a slice that runs an agent turn, so this plan builds slice 4b, the next
slice on the way, and leaves the turn as the one open question.** After 4b, a hands process on a
laptop runs a real `git --version` for a real brain, with its own key file and a journal that
survives a crash. What is left before a turn is listed in [What waits](#what-waits-and-on-what).

What "run a turn" means, from the notes:

- [Talk where you work](../../direction/talk-where-you-work.md#in-next-summon-is-an-alias-with-a-session)
  (decided 2026-11-06): the brain keeps the alias and the session, and "the turn runs on hands".
  A turn needs files and agents, so a browser tab never takes one.
- [0026](../../../.decisions/0026-fabrika-never-owns-the-agent-loop.md): a turn is the maker's own
  harness, unchanged, on the person's own login. [0325](../../../.decisions/0325-agents-behind-one-service-of-ours.md):
  reached only through one agent service of ours.
- [0185](../../../.decisions/0185-tier-2-runs-agents-after-the-four-primitives.md): Tier 1 holds
  "hands far enough to run one turn", and Tier 2 builds hands for real.
- `docs/plan/tier-1.md`, piece 5: "no slice of P39 runs an agent turn yet. The five slices end at
  `git --version`, so 'far enough to run a turn' needs more than the five, and how much more is not
  planned." That line is marked open for the owner.

So the turn itself is a command the hands run that starts a harness. Its shape (what the command
carries, which harness, whose login, where it runs) is piece 6's: S2 to S7 of the
[summon guidelines](../../direction/summon-guidelines.md), the place a summoned agent runs, and the
0517 against 0157 clash, all walks the owner has not done (`docs/plan/tier-1.md`, "The owner's
walks and decisions, by step", row 6). This slice builds every hands part a turn will stand on and
that no walk decides: a real command layer, a key on disk, a crash-safe journal, and a launcher.

**Nobody sees or presses anything in this slice.** Two parts of 4b as slice 4a's plan listed them
are person-facing and stay out: approving the hands key in a window or the menu bar, and the app
starting the hands. See [What waits](#what-waits-and-on-what).

## What lands now, and what waits

**This pull request, slice 4b's non-visible part:**

- `CommandsNode`: the real `Commands` layer. It runs `git --version` through Effect's
  `ChildProcessSpawner`, with a pinned environment, an output cap and the `has` list read from the
  host.
- `KeyFile`: a `ClientKey` layer over one file in the fabrika home, made once with mode 0600 and
  reused, never quietly replaced.
- `JournalSqlite`: a `KeyValueStore` over one SQLite file, so the 4a journal survives a crash or
  a power cut without a torn entry.
- `HandsStart.start` takes the host's `os`, so the hello records it instead of `unknown`.
- `next/apps/fabrika/hands.ts`: the start file that wires those layers to `HandsStart.start`,
  reads `instance.port` the way `dev.ts` does, and prints one JSON line per state for a parent
  process. No person reads it.
- A public-key helper in `transport/`, so the key file does not copy the fingerprint math a fourth
  time.

### What waits, and on what

| Piece | Waits on | Why it is not here |
|---|---|---|
| A person approves the hands key | the thin menu bar (P21 in part) or the window's approve screen | A person presses it. 0280 says Approve asks for a finger; it is the same press as a new window's |
| The app starts the hands | P19 slice 3, the Electron client | `next/` has no app main yet (no file imports `electron` outside an exam). By 0280's principle the hands start as a second launchd service beside the brain, with its plist in the app's home; the launchd layer and `ProcessGroups` already exist in `node/launchd/` |
| A guard that ends the hands' child after a SIGKILL of the hands | the launchd start above | `git --version` ends in milliseconds. The guard outside the process (0061) is the launchd job's process group, built with the start |
| Slice 5: a real program asks for `git --version` end to end | P40's pack path | Slice 3's plan: "a real pack whose program returns `hands`" |
| An agent turn on hands | the owner's answer to [open question 1](#open-questions), then piece 6's walks | The turn's command shape is piece 6's design |

## How others do it

Not fetched this session; each is from the makers' public docs as known, marked so.

- **OpenSSH** refuses a private key file that others can read ("UNPROTECTED PRIVATE KEY FILE",
  `ssh` and `ssh-keygen`), and writes new keys with mode 0600. Kept: 0600, and a key file with
  group or other bits is refused, never used. Not fetched.
- **GitHub Actions self-hosted runner** keeps its identity in files in its own folder
  (`.runner`, `.credentials`, `.credentials_rsaparams`), made once by `config.sh` and reused on
  every start. Kept: one folder, made once, reused. Left: no registration token; the person grants
  the key on the ledger (0102). Not fetched.
- **kubelet** keeps its client key under `/var/lib/kubelet/pki/` and asks the API server to approve
  it (TLS bootstrapping, a CSR a person or a controller approves). Kept: the machine makes its own
  key and a person approves it at the brain. Not fetched.
- **SQLite** is crash-safe by design: a transaction commits whole or not at all, across a power
  cut ("atomic commit in SQLite", sqlite.org). Kept: the journal is one SQLite file. Not fetched.
- **Effect.** `KeyValueStore.layerFileSystem` in 4.1.2 writes each key with `fs.writeFileString` in
  place (`effect/dist/persistence/KeyValueStore.js:228`, read): no temporary file, no rename, no
  sync. A crash mid-write leaves a torn value, which 4a's machine reads as `bad_entry` and then
  skips that job forever (`client/HandsMachine.ts:721`). So the file layer is not used.
  `KeyValueStore.layerSql` needs Effect's `SqlClient`, and no Effect SQL client for Node's SQLite
  is in the lockfile (only `@effect/sql-d1`). The repo's own node:sqlite handle
  (`ledger/NodeSqlite.ts:37`) is the existing tool (0040).
- **Elm and OTP.** Nothing here changes the hands machine. The launcher is a start, the way
  `dev.ts` is: it wires layers and holds the scope. A restart is a new process (OTP), and the
  journal is what carries over.

## The shape

Installed versions read in the lockfile: Effect 4.1.2, `@effect/platform-node` 4.1.2,
`@demlik/tea` 0.25.0, fast-check 4.10.2, vitest 5.0.5, Node 26.13.0 (the root engines field).
Effect 4.1.2 has `process/ChildProcess` with `extendEnv`, `env`, `forceKillAfter`, and
`ChildProcessSpawner.make` for a fake spawner; `FileSystem` has `open` with `mode`, `File.sync`,
`rename`, `stat` and `layerNoop` (all read in their `.d.ts`).

### Where it lives

The libfabrika test (`next/AGENTS.md`): a from-scratch Node hands client would have to write the
real command, the key file and the journal file again, so they are libfabrika. Each names a
platform (a child process, POSIX modes, node:sqlite), so they live in `node/` (0095), in a new
folder `node/client/`, as `node/jobs/` sits beside `jobs/`. The start file is composition only,
like `dev.ts` and `grant.ts`, so it is the app's.

| Piece | Lives in | Layer |
|---|---|---|
| The real command layer | `node/client/CommandsNode.ts` | 10 |
| The capped child run it uses | `node/client/internal/capped.ts` | 10 |
| The key file | `node/client/KeyFile.ts` | 10 |
| The journal file's store | `node/client/JournalSqlite.ts` | 10 |
| Fingerprint and key line from raw bytes | `transport/PublicKey.ts` | 2 |
| The host's `os` in the hello | `client/HandsStart.ts` | 7 |
| The launcher | `next/apps/fabrika/hands.ts` | app |

The `next-node` row of `layer-rules.json` gains `next-client` and `next-transport`. Both are
downward imports. It is the only permission that widens.

### The command

```ts
// node/client/CommandsNode.ts, sketch.
/** The most bytes a command may print, stdout and stderr together, before it is stopped. */
const CAP: Record<Command["_tag"], number> = { git_version: 4096 };
const ARGV: Record<Command["_tag"], readonly [string, ReadonlyArray<string>]> = {
  git_version: ["git", ["--version"]],
};

export const layer = Layer.effect(Commands, Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Config.String("PATH");   // the one value the child gets
  const has = yield* onPath("git", path);       // FileSystem.stat: a file with an execute bit
  return Commands.of({
    has: has ? ["git"] : [],
    execute: (command) => capped(spawner, ARGV[command._tag], { PATH: path }, CAP[command._tag]),
  });
}));
```

```ts
// node/client/internal/capped.ts, sketch. One child, in its own scope (0061).
// spawn fails                      -> failed spawn_failed
// stdout + stderr pass the cap     -> close the scope (the child is killed), failed output_limit
// exits                            -> exited { code, version: stdout as UTF-8, one trailing "\n" dropped }
// stdout is not UTF-8              -> exited { code, version: "" }     (the bytes count is in the span)
```

- `extendEnv: false` and `env: { PATH }`: the child gets nothing else of the hands' environment, so
  no key in it can reach the child. `RepositoriesGit.ts:78` pins git's env the same way.
- `has` is `["git"]` only when an executable `git` is on that `PATH`. A missing git is then
  refused at take time by the gateway's `needs` check, never run and failed.
- Not a defect, never an error: every outcome is a `Result` (4a's contract,
  `client/Commands.ts`).
- The span `Commands.execute` gets `exit`, `stdout_bytes`, `stderr_bytes`, `capped` and
  `duration_ms`. stderr's text is not kept: see [Records](#records).

### The key

```ts
// node/client/KeyFile.ts, sketch.
const Stored = Schema.Struct({
  /** Ed25519 private key, as WebCrypto's JWK; `d` is the private half, `x` the public. */
  jwk: Schema.Struct({ kty: Schema.Literal("OKP"), crv: Schema.Literal("Ed25519"), d: Schema.String, x: Schema.String }),
});

export const layer = (options: { readonly file: string }) => Layer.effect(ClientKey, /* ... */);
// current(null)
//   no file        -> make a pair, write it to a temp name in the same folder with mode 0600,
//                     link it to `file` only if `file` is still absent              -> found "created"
//   file, 0600     -> import `d` non-extractable for signing, `x` as raw           -> found "reused"
//   file, wider    -> ClientKeyError { op: "read", error: "NotAllowedError" }      (never used)
//   file, damaged  -> ClientKeyError { op: "read", error: "DataError" }            (never replaced)
// current(fp), fp is the stored key's fingerprint (the door removed it)
//   -> make a pair, write to a temp name, rename over `file`                       -> found "replaced"
// claimPersist -> false; persist -> true   (a file is already persistent)
```

The browser key's rules, kept for the file: a failure to read, write or make the key is a typed
error, never a quiet new key, and only a key the door removed is replaced
(`tuval/src/browser/key.ts:1-10`). Two hands processes starting at once on one empty home agree on
one key: the first link wins, and the second reads it.

`transport/PublicKey.ts` gives `fingerprint(raw)` and `line(raw)`, the same math as
`transport/Hello.ts:159-167`. The key file uses it. The three older copies are a finding, not this
slice's change.

### The journal file

```ts
// node/client/JournalSqlite.ts, sketch. A KeyValueStore over one SQLite file, one row per key.
// oxlint-disable-next-line fabrika/no-node-imports -- edge: no Effect SQL client for Node SQLite is installed; the repo's node:sqlite handle
import { DatabaseSync } from "node:sqlite";
export const layer = (options: { readonly file: string }) =>
  Layer.effect(KeyValueStore.KeyValueStore, Effect.acquireRelease(open(options.file), close).pipe(
    Effect.map((db) => KeyValueStore.makeStringOnly({ get, set, remove, clear, size })), // over nodeSql(db)
  ));
// table: journal (key TEXT PRIMARY KEY, value TEXT NOT NULL); `set` is one INSERT OR REPLACE.
```

4a's `JournalStore.layer` is unchanged: it takes any `KeyValueStore`.

### The launcher

```ts
// next/apps/fabrika/hands.ts, sketch. A start file: it wires, holds the scope, and prints.
// home    = FABRIKA_HOME ?? ~/.fabrika            (as dev.ts:94)
// folder  = home/hands, made with mode 0700
// origin  = http://127.0.0.1:<instance.port>     (Load.load, as dev.ts reads it)
// os      = process.platform: darwin -> macos, linux -> linux, win32 -> windows, else unknown
// layers  = KeyFile(folder/key.json), JournalStore over JournalSqlite(folder/journal.sqlite),
//           CommandsNode, the global WebSocket, Id.Generator
// stdout  = one JSON line per change of what a parent needs:
const Line = Schema.TaggedUnion({
  waiting: { fingerprint: Fingerprint, code: Schema.String, until: Schema.Number }, // ungranted: the code to approve
  online: { fingerprint: Fingerprint },
  offline: { fingerprint: Fingerprint },
});
```

The lines are read from the run's state (`getState`, as `WindowStart.laws.test.ts:358` reads it,
and tea's own listener). They are for the app that will start the hands and for the laws here; no
person reads them. The launcher adds no setting and no flag beyond the existing settings flags.

## One value traced through

Made up for this example: home `~/.fabrika`, port 18787, process `P`, job `P/7/0`, git 2.47.0.

1. `node hands.ts` finds no `~/.fabrika/hands/key.json`. It makes a pair, writes
   `key.json.<random>` with mode 0600, links it to `key.json`, and gets fingerprint `SHA256:H`,
   found `created`.
2. It opens `journal.sqlite`, reads `instance.port = 18787`, and starts the hands client with
   `os: "macos"`, `has: ["git"]`.
3. The knock answers `not_granted` with code `4F2K`. stdout: `{"_tag":"waiting","fingerprint":"SHA256:H","code":"4F2K","until":...}`.
4. A person key grants `SHA256:H` as `hands` (in this slice, only a test does it). The client goes
   online. stdout: `{"_tag":"online","fingerprint":"SHA256:H"}`.
5. A job for `SHA256:H` is requested. 4a's machine lists, takes, saves `prepared` and `executing`
   in `journal.sqlite`, then calls `execute`.
6. `CommandsNode` spawns `git --version` with env `{ PATH }`. It prints 19 bytes and exits 0. The
   result is `exited { code: 0, version: "git version 2.47.0" }`.
7. The journal saves `result`, `jobs.finish` answers ok, and the journal saves `acknowledged`.
8. The person quits the hands with Ctrl-C and starts them again. The key is `reused` with the same
   `SHA256:H`, and the journal still holds `acknowledged` for `P/7/0`.

If the power goes out between steps 5 and 6, SQLite holds `executing` whole, and the next start
reports `unknown interrupted` (4a's table). It never reads a torn row.

## Laws

Seed **119120** for every generated law. A walk picks each move from what is possible in the state
it reached (0093). The oracle keeps its own count of spawns and results; it never calls the
product's code to decide what is right.

Plants run once each, are recorded and are undone; no plant is committed. "Merge line" means the
fast run on pull requests, over in-memory layers. "Schedule" means the 3-hour run (0536): the file
system, node:sqlite on a file, real processes, real sockets, workerd. **Host-only laws** are the
ones that send a real signal or start a real brain and a real hands process: they run only in
CI's full run on the schedule, in its container (0045), never on a laptop. None runs on the
owner's Mac, so none waits on 0178's yes; if the lead wants a Mac run, that waits for the lead's
read of every kill line and the owner's yes.

| Law | Kind | Generator | Plant that must fail | Law lives in | Runs |
|---|---|---|---|---|---|
| C1: `execute` answers exactly `exited { code, version }` for a child that exits, with `version` the stdout text less one trailing newline; `failed spawn_failed` when the spawn fails; `failed output_limit` once stdout and stderr together pass the cap, with the child's scope closed; never an error or a defect | test | fc.record: stdout and stderr split into generated chunks, a generated exit code, spawn failure or not, total sizes on both sides of the cap; over a fake `ChildProcessSpawner.make`; 100 runs | Count only stdout toward the cap | `node/client/CommandsNode.laws.test.ts` | merge line |
| C2: [secrets] the spawned command is `git` with argv `["--version"]`, `extendEnv` false and env holding only `PATH`; a planted secret in the hands' environment never reaches the child | test | fc.dictionary: generated environment names and values, one planted secret among them; read the command the fake spawner received; 100 runs | Spawn with `extendEnv: true` | `node/client/CommandsNode.laws.test.ts` | merge line |
| C3: `has` is `["git"]` exactly when a `PATH` folder holds a file named `git` with an execute bit, and `[]` otherwise | test | fc.array: generated `PATH` folders, each with no `git`, a `git` folder, a `git` without an execute bit, or an executable `git`; over `FileSystem.layerNoop`; 100 runs | Report `git` when the file exists without an execute bit | `node/client/CommandsNode.laws.test.ts` | merge line |
| C4: the real `git --version` on the runner answers `exited` with code 0 and a version that starts with `git version `; its line becomes a `vector:` file for C1 | test | scenario: real git on the CI runner, through the real spawner | Keep the trailing newline in `version` | `node/client/CommandsNode.integration.test.ts` | schedule |
| C5: a real child that prints past the cap is stopped: after `execute` answers `failed output_limit`, its pid is gone; host-only, since the scope's close sends it a real signal | test | scenario: a real Node child that prints without end, run through `internal/capped.ts` with the real spawner | Answer `output_limit` without closing the child's scope | `node/client/CommandsNode.integration.test.ts` | schedule, CI full run only |
| K1: on an empty folder the first `current(null)` answers `created`, every later one `reused` with the same fingerprint; `current(stored)` answers `replaced` with a new one; a damaged file is a `read` error and is left as it was; a file with group or other bits is a `read` error and is never used | test | fc.commands: open, open with the stored fingerprint, open with another fingerprint, damage the file, widen its mode, from the current state; over `FileSystem.layerNoop`; 100 runs | Make a new key when the file does not decode | `node/client/KeyFile.laws.test.ts` | merge line |
| K2: the key file's identity passes the door's own hello check: its `raw`, `fingerprint` and `line` agree, and a hello signed with its `sign` is admitted | test | fc.uint8Array: generated nonces and tabs, with keys the layer made; checked by `transport/Hello.ts`'s checker; 60 runs | Compute the fingerprint over the key line instead of the raw bytes | `node/client/KeyFile.laws.test.ts` | merge line |
| K3: on the real file system, the key file and its folder are made with modes 0600 and 0700, and two layers opening one empty folder at once end with one key | test | fc.integer: delay between the two opens, 0 to 20 ms; 20 runs | Write the file with the default mode | `node/client/KeyFile.integration.test.ts` | schedule |
| J1: the 4a journal over `JournalSqlite` on `:memory:` reads exactly what the same writes give over `KeyValueStore.layerMemory`, and a value that is no entry is `bad_entry` on both | test | fc.commands: write, read, overwrite and read a missing job, with generated entries; 100 runs | Leave out the `PRIMARY KEY`, so an overwrite adds a second row | `node/client/JournalSqlite.laws.test.ts` | merge line |
| J2: a hands-like child that writes journal entries in a loop and is killed with SIGKILL at a generated moment leaves every key holding one whole entry when the file is opened again; host-only, since it sends a real SIGKILL | test | fc.integer: the kill delay, 1 to 200 ms; 20 runs | Swap the store for `KeyValueStore.layerFileSystem` | `node/client/JournalSqlite.integration.test.ts` | schedule, CI full run only |
| O1: the hello carries the `os` the start was given, for every value the wire accepts | test | fc.constantFrom: `macos`, `windows`, `linux`, `android`, `ios`, `unknown`; 30 runs | Keep `os: "unknown"` | `client/HandsStart.laws.test.ts` | merge line |
| E2: the real launcher, as its own Node process with a fresh `FABRIKA_HOME`, against a real local instance on workerd, prints `waiting`, then `online` once a test person key grants it as `hands`; a requested `git_version` job ends `finished` with `exited` code 0; after a SIGTERM and a new start the fingerprint is the same and the job is not run again; host-only | test | scenario: one real instance, one real hands process, one real git, as `jobs-wire.integration.test.ts` starts its instance | Open a fresh key file on every start | `next/apps/fabrika/src/hands-launcher.integration.test.ts` | schedule, CI full run only |
| S2: [secrets] the private half (`jwk.d`) appears in no stdout line, no frame the client wrote, no journal row, no `job:` or `target:` row and no span of the E2 run | test | fc.constantFrom: the generated keys of E2's runs, each scanned in every named output, with base64 and base64url forms; 3 runs | Print the stored JWK in the `online` line | `next/apps/fabrika/src/hands-launcher.integration.test.ts` | schedule, CI full run only |
| B2: `node/client/` imports `node:` only on a marked edge line | lint | lint | Import `node:fs` in `node/client/KeyFile.ts` with no edge comment | existing `fabrika/no-node-imports` and `fabrika/edge-comment` | lint |
| K4: `node/client/` imports `client/`, `transport/`, `jobs/` and `ledger/`, never `gateway/` | lint | lint | Import `gateway/Jobs.ts` in `node/client/CommandsNode.ts` | existing `pnpm lint:layers` | lint |
| T2: the three node layers provide `Commands`, `ClientKey` and `KeyValueStore` with no `PlatformError` left in their error or requirement channels past the layer's own build | type | type | Let `KeyFile`'s `current` fail with `PlatformError` | `node/client/HandsNode.types.test.ts` | typecheck |
| W2: 4a's laws pass unchanged with the `os` field added | test | scenario: the existing `client/HandsStart.laws.test.ts`, `client/HandsMachine.laws.test.ts` and `hands-client.test.ts`, untouched but for O1's cases | Default `os` to a value other than the one given | the files named | merge line |

The existing job, gateway, window and 4a laws stay as they are; this slice adds cases and narrows
none.

## Files

Product lines count additions and deletions.

| File | Change | Product lines expected | Owner |
|---|---|---|---|
| `next/packages/libfabrika/src/node/client/CommandsNode.ts` | New: the real `Commands` layer | 70 | build |
| `next/packages/libfabrika/src/node/client/internal/capped.ts` | New: one child run with a cap, in its own scope | 70 | build |
| `next/packages/libfabrika/src/node/client/KeyFile.ts` | New: `ClientKey` over one file | 140 | build |
| `next/packages/libfabrika/src/node/client/JournalSqlite.ts` | New: `KeyValueStore` over one SQLite file | 60 | build |
| `next/packages/libfabrika/src/transport/PublicKey.ts` | New: fingerprint and key line from raw bytes | 30 | build |
| `next/packages/libfabrika/src/client/HandsStart.ts` | `os` in `StartOptions`, sent in the hello | 6 | build |
| `next/packages/libfabrika/package.json` | Exports for `node/client/*`, with `internal/*` closed, as `node/launchd/` has | 2 | build |
| `next/apps/fabrika/hands.ts` | New: the launcher | 120 | build |
| `next/apps/fabrika/package.json` | Script `hands` | 1 | build |
| `layer-rules.json` | `next-node` imports gain `next-client` and `next-transport` | tests | tests |
| `next/packages/libfabrika/src/node/client/CommandsNode.laws.test.ts` | New: C1, C2, C3 | tests | tests |
| `next/packages/libfabrika/src/node/client/CommandsNode.integration.test.ts` | New: C4, C5 | tests | tests |
| `next/packages/libfabrika/src/node/client/KeyFile.laws.test.ts` | New: K1, K2 | tests | tests |
| `next/packages/libfabrika/src/node/client/KeyFile.integration.test.ts` | New: K3 | tests | tests |
| `next/packages/libfabrika/src/node/client/JournalSqlite.laws.test.ts` | New: J1 | tests | tests |
| `next/packages/libfabrika/src/node/client/JournalSqlite.integration.test.ts` | New: J2 | tests | tests |
| `next/packages/libfabrika/src/node/client/JournalSqlite.child.test-support.ts` | New: the child J2 kills, a Node file | tests | tests |
| `next/packages/libfabrika/src/node/client/HandsNode.types.test.ts` | New: T2 | tests | tests |
| `next/packages/libfabrika/src/client/HandsStart.laws.test.ts` | Extend: O1 | tests | tests |
| `next/apps/fabrika/src/hands-launcher.integration.test.ts` | New: E2, S2 | tests | tests |
| `next/apps/fabrika/src/exam/layers.test.ts` | Read-only boundary check; no change unless the new row needs one | tests | tests |
| `.glossary/TERMS.md` | Rows: hands launcher, key file (hands), journal file | docs | lead |
| `docs/plan/tier-1.md` | P39: 4b's non-visible part landed; what waits, and on what | docs | lead |
| `docs/plan/README.md` | Where we are now | docs | lead |

### Its edges

- **Must not touch:** `client/HandsMachine.ts`, `client/Journal.ts`, `client/JournalStore.ts`,
  `client/Commands.ts`, `jobs/`, `gateway/`, `access/`, `transport/Hello.ts`,
  `tuval/src/browser/key.ts`, `node/launchd/`, today's version and any program under
  `next/programs/`.
- **What the app's start needs from this slice:** a launcher that takes its home from
  `FABRIKA_HOME` and speaks the `Line` schema on stdout, so a launchd job can run it unchanged.
- **What a turn needs from this slice:** a `Commands` layer that runs a closed command in its own
  scope with a pinned environment and a cap, which a harness command can follow.

## Is this a setting?

| Choice | Setting? | Answer and why |
|---|---|---|
| Where the key file and the journal live | No | Both go in the fabrika home's `hands/` folder. The home is already the person's choice (`FABRIKA_HOME`), as `fabrika.toml`, `instance.json` and, by 0280, `brain.plist` are. A second path setting would let the key and the home drift apart. This changes 4a's lean, which said yes |
| The output cap, 4096 bytes for `git_version` | No | It is part of the closed command, as `needs` is (`jobs/Job.ts:43`): every hands must mean the same `output_limit` for one command. The number is a guess, about 200 times git's one line; C4's vector records the real length, and the cap is set again from it if it is far off |
| What the child's environment holds | No | `PATH` only, a security fact of the command, not a behavior a person picks |
| The hands' `has` | No | Read from the host (C3), as 0102 says `has` is "can" |
| The brain's address | No new one | The existing `instance.port` |
| The launcher's stdout lines | No | A protocol between a parent and the launcher |
| The host's `os` | No | A fact the platform reports |

## Records

Facts that exist only when they happen, kept now:

| Row | Where | Keeps | Why |
|---|---|---|---|
| The hello's `os` (now real) | the door's connect rows, as today | `macos`, `linux` and so on, in place of `unknown` | Which kind of host ran each job; it is lost for every job run before it |
| The hello's `has` (now real) | the door's connect rows and the job's `taken` event, as today | What this host could do when it took the job | A take judged on `has`; a later look at why a job was refused needs it |
| `Commands.execute`'s span | the client's tracer | exit code, stdout and stderr byte counts, whether the cap stopped it, duration | The first real numbers for how long a command takes and how large its output is |
| The key file | `hands/key.json` | The key, and by its mtime when it was made | Which key this host is; the door's grant row keeps the public half |

**Lost, said plainly:** stderr's text of a failed `git --version` is not kept anywhere. `Result` is
a closed schema with no field for it, and the hands have no span sink at the brain yet (4a). When a
turn's output is built, it goes to deletable P37 content
([an agent run keeps its content](../../direction/an-agent-run-keeps-its-content.md)), never into a
lifecycle row. For `git --version` the loss is small: stderr is empty on a working git.

No secret is in any row. The private half stays in `key.json`, and S2 checks every named output.

## Validation

A boxed step runs its own narrow vitest paths under the repo's caps, its plants once each, and
`pnpm lint`. The lead runs the changed-tests run once, one type check, the leak check, ownership
and `loosening.sh`. The schedule laws (C4, C5, K3, J2, E2, S2) run in CI's full run; C5, J2, E2 and
S2 are host-only and run only there, in its container, never on a laptop. The lead asks CI for one
full run on the branch before the review, so their first signal comes before the first review
(0178).

This plan step ran no tests and changed no file but this plan.

## Size

One pull request: about 500 product lines, 1,100 test lines and 30 doc lines, about 1.5 to 2.5
agent hours. Confidence: 65%. The doubt: the key file's create-once rule on a real file system, and
how much of E2's setup `jobs-wire.test-support.ts` already gives.

1. **Slice 4b, the real command, the key file, the journal file and the launcher: 500 lines.** With
   laws C1 to C5, K1 to K4, J1, J2, O1, E2, S2, B2, T2 and W2.
2. **What waits: 0 lines here.** It is in [the table above](#what-waits-and-on-what); none of it is planned in this file.

Budget basis: slice 3's plan read `field/runs.jsonl` list-price medians of $1.14 for tests steps,
$1.24 for build steps and $1.17 for reviews, with maxima from $3.69 to $9.41. The 4a run rows in
`field/runs/` (2026-11-15) record no dollars, so they give a step count only: 4a took eight steps
(two tests rounds, a build, a review, two fix rounds, two rechecks). This slice is about half 4a's
product lines but adds the host-only CI run, so allow tests, build, review, one fix round, one
recheck and one more tests round, each well above the median.

Estimate: 6 steps, $16

## What this cannot tell us

- Whether the hands start on a Mac exactly as the brain does. That is the app's slice; this one
  runs the launcher by hand in tests only.
- Whether git's output on macOS (Apple's build prints `git version 2.x (Apple Git-n)`) fits the
  cap and the tests. C4 runs on the CI runner, which is Linux. The line is from memory, not a run.
- Whether `node:sqlite`'s default journal mode survives a power cut, not only a SIGKILL. J2 kills a
  process; a power cut also drops the OS's write cache. SQLite's docs say a commit survives both
  when the disk honors sync; nothing here tests it.
- Whether a person will find the `waiting` line's code useful without a screen. No person reads it
  in this slice.
- How a turn will use `Commands`: whether a harness run fits a closed command with a cap, or needs
  a streamed result. That is open question 1 and piece 6.

## Calls the lead should look at twice

1. **The journal file is SQLite through the repo's node:sqlite handle, with an edge comment.**
   The other ways: Effect's `layerFileSystem` (torn writes, read above), our own temp-file-and-rename
   store (the known POSIX way, but sync of the folder is easy to get wrong), or adding
   `@effect/sql-sqlite-node` for `KeyValueStore.layerSql` (a new dependency). Confidence: 70%.
2. **The key file is a WebCrypto JWK in a 0600 file, not an OpenSSH key file.** `grant.ts` signs
   with `ssh-keygen` and an OpenSSH file, but that would spawn a process for every hello.
   WebCrypto is what the browser key and the door already use. Confidence: 80%.
3. **0280's principle answers how the hands start on a Mac,** so 4a's open question is no longer
   open: a person only opens the app, which starts each service as a launchd job with its plist in
   the app's home. It is not built here. Confidence: 80%; the doubt is that 0280 names only the
   brain.
4. **No setting for the hands' paths,** which walks back 4a's lean. Confidence: 80%.
5. **`node/client/` is a new folder of `node/`,** mirroring `client/`, as `node/jobs/` mirrors
   `jobs/`. Confidence: 85%.
6. **The approval of the hands key is left to the menu bar or the window,** with no `grant.ts
   --as hands` either: a command line is also something a person types, and the brief keeps this
   slice free of that. Until then a person cannot run the hands for real. Confidence: 75%.

## Open questions

1. **What does "far enough to run a turn" owe past `git --version`?** `docs/plan/tier-1.md`, piece
   5, marks it open for the owner, and no decision answers it. Lean: P39 closes at slice 5, and
   the turn is a new closed command (an agent turn on the person's own harness and login, under 0026
   and 0325) built in piece 6 by the agent-link slice, after the walks of S2 to S7 and of where a
   summoned agent runs. That keeps the turn's shape with the design that owns it, and hands then
   need only a new `Commands` case. 65%. The doubt: piece 6 then carries both the harness link and
   the hands side of the turn, and its walks gate both. What settles it: the owner's pick, then
   piece 6's plan.

Searched first: `.decisions/` (0026, 0061, 0078, 0095, 0102, 0157, 0159, 0171, 0178, 0185, 0280,
0325, 0326, 0419, 0536), `docs/direction/talk-where-you-work.md`,
`docs/direction/summon-guidelines.md` (S5), `docs/direction/brain-hands-window-agent.md`,
`docs/direction/tea-is-the-engine.md`, `docs/plan/tiers.md` (the Tier 5 laws, Tier 4 and Tier 5),
`docs/plan/tier-1.md` (piece 5, the build order, the walks table, row P39), `.glossary/TERMS.md`
(hands, hands key, client), and the plans of slices 3 and 4a. No note cuts slices past 4b; the five
slices end at slice 5.

## Findings

```json
{"_tag": "finding", "id": "2026-11-15-key-fingerprint-math-three-copies", "date": "2026-11-15", "by": "plan", "model": "claude-opus-5-5", "rule": "duplicate", "location": {"path": "next/packages/libfabrika/src/transport/Hello.ts", "line": 159}, "says": "In next/, the OpenSSH SHA256 fingerprint and ssh-ed25519 key line of a raw Ed25519 key are computed by hand in three places that must agree byte for byte.", "proof": "transport/Hello.ts:159 builds `SHA256:${Base64.encode(hash).replace(/=+$/, \"\")}` and lines 165-168 the 51-byte ssh-ed25519 blob; gateway/Gateway.ts:2047 returns the same `SHA256:` string from its own digest; tuval/src/browser/key.ts makeKey and lineFor build both again from the same raw bytes.", "cost": "A change to one copy (a padding rule, a key type) leaves the door, the gateway and the browser key disagreeing on who a key is, and each new client (the hands key file) would add a fourth copy.", "head": "7dad34bb679ef26e74df03f00294c455674a3ae1", "ticket": null, "pr": "kamp-us/tea-fabrika#1315"}
```
