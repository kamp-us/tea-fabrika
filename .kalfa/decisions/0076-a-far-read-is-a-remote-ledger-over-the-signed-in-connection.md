# A far read is a remote ledger over the signed-in connection

`kalfa trace`, `kalfa incidents list` and the other reading commands read a Ledger the device does not hold, and decision 0075's `--direct` write appends to it. No design said how either reaches it; decision 0072 said a command that only reads "stays local and sends nothing", which cannot be true for them. We decided that a command signs in with its client key, as a write does, and gets a `RemoteLedger`: the Ledger's `append`, `read`, `wait` and `streams` carried over the signed-in connection, with no `transaction`. It is written once, in `@kalfa/ledger/transport`. We chose this because each package's read code then runs the same on the device as in the app, with no read message per package, and because a read that goes through a program stops when that program does, which is when a person most needs `kalfa incidents list`. The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1862.

This replaces the line of decision 0072 that says a command that only reads stays local and sends nothing.

A sketch, not type-checked:

```ts
// @kalfa/ledger: the full Ledger gives this too
interface RemoteLedger {
  append(stream, id, entry): Effect<Placed, Refusal | Failure>
  read(stream, after, options): Stream<Entry, Failure>
  wait(stream, after): Effect<Revision, Failure>
  streams(prefix): Stream<string, Failure>
}

// @kalfa/ledger/transport
// the command's half
export const layer: Layer<RemoteLedger, Unreachable, Socket>
// the app's half: the gateway hands it a signed-in connection
export const serve: (connection) => Effect<void, never, Ledger>
```

How it runs:

1. The command connects and signs in at the app's gateway with its client key. With no key it refuses with a diagnostic and exit code 1.
2. The gateway stamps the sender, refuses a `hands` client, and hands the connection to `serve`.
3. A read needs nothing more. Every signed-in client that is not `hands` may read every stream; the Ledger has no read check.
4. A far `append` passes the app's Ledger admission like any other append. The admission lets a signed direct entry in (decision 0075) and refuses the rest.
5. Program's send helper uses this entry point for `--direct`. A direct write that must read first reads and then appends, with no transaction around the two.

## Considered Options

- Each package's program answers a read message: rejected, because every package would write its own, and the read stops when the program does.
- One `Ledger` type whose `transaction` fails when the Ledger is far: rejected, because a function cannot cross a connection and the compiler should say so, not a failure at run time.
- A read check through Permissions: rejected for now, because a project is one trust zone and its state page already shows the same entries.
- A Ledger on the device: rejected in decision 0075.

## Consequences

- Each package's read functions ask for `RemoteLedger`, not `Ledger`.
- On Cloudflare the Ledger and the gateway's half sit in a Durable Object class of their own, sharing no start-up code with a program. Then a read and a `--direct` write still work when a program throws, hangs, spins or its timer keeps failing. They do not work when the whole app fails to start, a deploy of everything is bad, the platform is out or a spending cap is reached. A Ledger in its own Worker also outlives a bad program deploy; that is each app's choice. The research is `.kalfa/research/store-up-app-down.md` on the branch `research/store-up-app-down`, from https://github.com/kamp-us/tea-fabrika/issues/1871. It read documents only and ran nothing.
- The app's admission code runs inside the Ledger's object, so a fault there still takes both down.
- No stream can be hidden from one member. Anything with a shell on a person's device can read the whole Ledger through `kalfa`. The line in https://github.com/kamp-us/tea-fabrika/issues/1817 that says who may read is Permissions' call now means Permissions has no read rule.
- Two direct writes of the same act at the same time can both be kept. The entry id rule covers only a resend of one entry.
- A fresh machine and a CI job have no client key, so neither gets a `RemoteLedger`. What a CI job may read is its own decision.
- Not decided: how one connection names the span log apart from the app's log. Nothing here was typed or run.
