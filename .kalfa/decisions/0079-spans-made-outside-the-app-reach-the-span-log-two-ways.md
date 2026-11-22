# Spans made outside the app reach the span log two ways

Decision 0063 says every step is traced, but three places that make spans are not the app: the `kalfa` command, a test run, and a CI build's tests. No design said where their spans go. We decided that the `kalfa` command appends its spans to the app's span log over its signed-in connection, and that a CI job saves its test spans as a build file the app fetches when the build ends. We chose this because a command is already a signed-in client, so it needs no new way in, and because a CI job runs code from any pushed branch, so it stays without a write (decision 0077). The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1867.

A sketch, not type-checked:

```ts
// @kalfa/ledger/transport: the command's half names its log when it connects
export const layer: (log: "app" | "spans") => Layer<RemoteLedger, Unreachable, Socket>

// @kalfa/ci: the file a build's job saved, as the code host keeps it
Ci.spanFile(build)
  // Stream<Uint8Array, NoSuchFile | Unreachable, CodeHost>

// @kalfa/telemetry: OTLP JSON in, spans kept in the store the setting picked
Telemetry.ingest(otlp)
  // Effect<void, Malformed | Failure, Store>
```

How each place runs:

1. **The span log's own write** runs with the tracer off, so saving a span never makes a span.
2. **The `kalfa` command.** The place that puts the `kalfa` program together hands it the `/ledger` store over a connection that named `spans`. Any signed-in client except `hands` may append there. With no key, or with the app out of reach, the spans are dropped and the command still runs.
3. **A test run.** Vitest's `sdkPath` module is `@kalfa/telemetry/vitest`. `@kalfa/quality/vitest` names it as a string and imports no kalfa package. With no `TRACEPARENT` set and no `/otlp` setting, test spans are off, which is the case on a laptop.
4. **A CI build.** `kalfa ci` sets `TRACEPARENT` (decision 0077). The vitest module sees it and writes the spans to one OTLP JSON file, which the workflow saves as a build file. When the build ends, `@kalfa/telemetry/ci` reads the file through `Ci.spanFile` and hands it to `Telemetry.ingest`.
5. **A build the host started by itself** gets a new trace and no stored link. Its first span and Delivery's land span both carry the commit id as `vcs.ref.head.revision`, and a trace reader joins the two on it.

What Telemetry imports, each in the one entry point that needs it:

- the core: no kalfa package
- `/ledger` (the stamps and the span log store): `@kalfa/ledger`
- `/otlp`, `/memory`, `/test`, `/vitest`: no kalfa package
- `/cli` (`kalfa trace`): `@kalfa/ledger` and `@kalfa/cli`
- `/ci`: `@kalfa/ci`
- the `[telemetry]` setting: `@kalfa/config`

This replaces the line of decision 0063 that has `@kalfa/quality/vitest` set up vitest's tracing, and fills the lines decisions 0076 and 0077 left open about the span log's name and a job's spans.

## Considered Options

- A ledger file on the device for the command's spans: rejected, because decision 0075 said no Ledger on the device, and nobody reads a file kept there.
- The job token lets a job append spans for its own trace: rejected, because the workflow file comes from the pushed branch, so that opens a write to code nobody reviewed.
- CI writes the spans itself: rejected, because a core imports no Telemetry (decision 0063).
- A stored link from a self-started build to the land span: rejected, because CI ranks below Delivery and cannot look the land span up, and Delivery never hears of a build it did not ask for.

## Consequences

- A command that fails before it signs in leaves no span, only its printed error.
- A signed-in client can append junk to the span log. A project is one trust zone (decision 0076), so nothing checks it.
- A CI build's test spans show up only after the build ends, and a build that is cut off before the file is saved leaves none.
- `@kalfa/telemetry/ci` ranks above `@kalfa/ci`. An app that wants CI's test spans switches that entry point on.
- An outside viewer shows a self-started build and its land as two traces with nothing drawn between them.
- A pull request from an outside copy of the repository gets no job token (decision 0077), so `kalfa ci` sets no `TRACEPARENT` and its test spans are off.
- Not tested: how large the file gets on a big test run, and vitest's `sdkPath` with this module. Vitest's option is still marked experimental. Nothing here was typed or run.
