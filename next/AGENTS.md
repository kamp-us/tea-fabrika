# next/

The new version of fabrika, built on [the four bottom layers](../.kalfa/decisions/0003-four-bottom-layers.md).
The [root map](../AGENTS.md) holds for all of it; this page adds the rules that hold only here. It is
the lab until a person opens it for real work, so it may be rough. "No rough first versions" in the
root map applies from then on.

`@kampus/fabrika` (`next/apps/fabrika`) is the app and `@kampus/libfabrika`
(`next/packages/libfabrika`) is the library. Anyone can take libfabrika alone and build a client
that works exactly like fabrika; fabrika is one libfabrika client. So for any file in
`next/apps/fabrika`, ask: would a from-scratch client have to write it again? If yes, it belongs in
libfabrika.

## Rethink, do not port

- Follow the decisions, not today's code. Read today's code and its tests to
  learn which jobs exist and what was learned, then rethink. Never import it and never copy it
  across. The pull request that switches a job to `next/` deletes the old part
  ([0002](../.kalfa/decisions/0002-next-grows-beside-today.md)).
- The shell is `fabsh`. `tsh` stays in today's version.
- Hands, a window and an agent dial the brain, and `client` means any of them at the door.
- In the planner step here, the lead's check of a plan's open questions becomes code.

## What lint holds

`pnpm lint` refuses these in `next/**`, and each message says what to do. The rules are set in
[`.oxlintrc.json`](../.oxlintrc.json) and explained in
[`oxlint-plugins/README.md`](../oxlint-plugins/README.md). Two rules of `pnpm lint:layers` do not
say the fix. A module imports only from lower layers: it prints `[upward]`, and the fix is in
.
A part imports only the parts its row in `layer-rules.json` lists, and every library and tuval file
has a row (a row's `imports`, and `roots`).
`eslint/no-console`, on for `next/packages/libfabrika/src` but its `*.test.ts` files, does not say
the fix either: libfabrika writes output only through Effect's `Console`, and a real exception takes
a disable line with its reason.

A Promise edge the platform demands is one line, marked
`// oxlint-disable-next-line fabrika/no-promises -- edge: <why>`, and the lead reads each one at
merge. A `node:` import stays only where Effect
has nothing, marked as an edge with its reason.

## What lint does not hold yet

- **Use the platform through Alchemy, never directly,** in the cloud and on the laptop alike
  ([0018](../.kalfa/decisions/0018-cloudflare-only-through-alchemy.md)).
- **A resource is acquired in a scope,** never with `try/finally` or an `afterEach`.
- **A service file holds only its contract**.
- **An object class stays thin.** It holds what the platform gives it and a one-line handoff. The
  logic is plain code that also runs on Node in tests.
- **A folder of libfabrika is a module, and its rank is a layer**.
- **Test files keep the layers too,** with no exemption.
- **A window reads state through tea's own React hook,** `useRuntime`, and state lives in a tea
  machine, never `useState`.
- **Every state machine is explicit**.
- **Every state machine is a tea machine**.
- **A tagged value is matched, never compared by hand,** in an `update` handler too
  ([the pattern](../.kalfa/patterns/effect-tagged-value-is-matched.md)).

## Words

- A word means one thing. "Run" means an agent
  run only; one start of a program is a process, and a restart is a new process, as in OTP. A place,
  a path, a ref, a state, a reason or a total gets its own word (`location`, `path`, `ref`, `state`,
  `reason`, `total`). `rg` the word under `next/` before you use it.
- An entry's two clocks are `arrivedAt`, the referee's, and `sentAt`, the writer's own. A ledger
  entry keeps `sentAt` from day one, but leases and limits use only `arrivedAt`.
- `kind` on ledger entries is `_tag` here too. Today's code keeps `kind` and `why`
  until that code goes.
