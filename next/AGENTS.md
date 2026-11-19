# next/

The new version of fabrika, built on [the five layers](../docs/direction/a-local-first-sync-engine.md).
The [root map](../AGENTS.md) holds for all of it; this page adds the rules that hold only here. It is
the lab until a person opens it for real work, so it may be rough. "No rough first versions" in the
root map applies from then on.

`@kampus/fabrika` (`next/apps/fabrika`) is the app and `@kampus/libfabrika`
(`next/packages/libfabrika`) is the library. Anyone can take libfabrika alone and build a client
that works exactly like fabrika; fabrika is one libfabrika client. So for any file in
`next/apps/fabrika`, ask: would a from-scratch client have to write it again? If yes, it belongs in
libfabrika
([why libfabrika exists](../docs/direction/where-each-piece-lives.md#why-libfabrika-exists-decided-2026-11-08)).

## Rethink, do not port

- Follow the decisions and `docs/direction`, not today's code. Read today's code and its tests to
  learn which jobs exist and what was learned, then rethink. Never import it and never copy it
  across. The pull request that switches a job to `next/` deletes the old part
  ([0217](../.decisions/0217-next-grows-beside-today.md),
  [rethink, do not port](../docs/direction/rethink-do-not-port.md)).
- The shell is `fabsh`. `tsh` stays in today's version
  ([0432](../.decisions/0432-next-has-fabsh-rethought-from-tsh.md)).
- Hands, a window and an agent dial the brain, and `client` means any of them at the door
  ([brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md)).
- In the planner step here, the lead's check of a plan's open questions becomes code. No merged
  pull request has been built this way yet
  ([where we are](../docs/plan/README.md#where-we-are-now)).

## What lint holds

`pnpm lint` refuses these in `next/**`, and each message says what to do. The rules are set in
[`.oxlintrc.json`](../.oxlintrc.json) and explained in
[`oxlint-plugins/README.md`](../oxlint-plugins/README.md). Two rules of `pnpm lint:layers` do not
say the fix. A module imports only from lower layers: it prints `[upward]`, and the fix is in
[0043](../.decisions/0043-rooms-on-floors.md) and [0091](../.decisions/0091-modules-and-layers.md).
A part imports only the parts its row in `layer-rules.json` lists, and every library and tuval file
has a row (a row's `imports`, and `roots`).
`eslint/no-console`, on for `next/packages/libfabrika/src` but its `*.test.ts` files, does not say
the fix either: libfabrika writes output only through Effect's `Console`, and a real exception takes
a disable line with its reason ([0592](../.decisions/0592-libfabrika-writes-output-only-through-effects-console.md)).

A Promise edge the platform demands is one line, marked
`// oxlint-disable-next-line fabrika/no-promises -- edge: <why>`, and the lead reads each one at
merge ([no Promises](../docs/direction/no-promises.md)). A `node:` import stays only where Effect
has nothing, marked as an edge with its reason
([0250](../.decisions/0250-effect-modules-first-node-at-an-edge.md)).

## What lint does not hold yet

- **Use the platform through Alchemy, never directly,** in the cloud and on the laptop alike
  ([0042](../.decisions/0042-platform-pieces-go-through-alchemy.md)).
- **A resource is acquired in a scope,** never with `try/finally` or an `afterEach`
  ([0061](../.decisions/0061-resources-are-acquired-in-a-scope.md)).
- **A service file holds only its contract**
  ([0095](../.decisions/0095-a-service-file-holds-only-its-contract.md)).
- **An object class stays thin.** It holds what the platform gives it and a one-line handoff. The
  logic is plain code that also runs on Node in tests
  ([an object class stays thin](../docs/direction/object-classes-stay-thin.md),
  [0041](../.decisions/0041-object-classes-are-effect-objects.md)).
- **A folder of libfabrika is a module, and its rank is a layer**
  ([0091](../.decisions/0091-modules-and-layers.md),
  [0043](../.decisions/0043-rooms-on-floors.md)).
- **Test files keep the layers too,** with no exemption
  ([0062](../.decisions/0062-test-files-keep-the-floors.md)).
- **A window reads state through tea's own React hook,** `useRuntime`, and state lives in a tea
  machine, never `useState` ([Elm first](../docs/direction/elm-first.md),
  [0466](../.decisions/0466-one-store-hook-no-hand-memo.md)).
- **Every state machine is explicit**
  ([0037](../.decisions/0037-implicit-state-machines-made-explicit.md)).
- **Every state machine is a tea machine**
  ([0046](../.decisions/0046-one-tea-machine-per-file.md)).
- **A tagged value is matched, never compared by hand,** in an `update` handler too
  ([0567](../.decisions/0567-a-tagged-value-is-matched.md),
  [the pattern](../.patterns/effect-tagged-value-is-matched.md)).

## Words

- A word means one thing ([0212](../.decisions/0212-one-meaning-one-way.md)). "Run" means an agent
  run only; one start of a program is a process, and a restart is a new process, as in OTP. A place,
  a path, a ref, a state, a reason or a total gets its own word (`location`, `path`, `ref`, `state`,
  `reason`, `total`). `rg` the word under `docs/direction/` and `next/` before you use it.
- An entry's two clocks are `arrivedAt`, the referee's, and `sentAt`, the writer's own. A ledger
  entry keeps `sentAt` from day one, but leases and limits use only `arrivedAt`.
- `kind` on ledger entries is `_tag` here too
  ([0214](../.decisions/0214-unions-are-tagged-with-tag.md)). Today's code keeps `kind` and `why`
  until that code goes.
