# Every kalfa package traces every step, and spans live on their own ledger log

Telemetry is its own package, `@kalfa/telemetry`, and tracing is a rule for the whole suite: every kalfa package traces
every step. A core makes spans only with Effect's own `Effect.withSpan` and `Effect.fn("<package>.<call>")(...)`, and
imports no Telemetry. Telemetry fills the trace slot and the build slot on ledger entries, and each finished span is an
entry on a separate ledger log, with an OTLP store beside it for outside viewers. We chose this because spans then cost
a core nothing, outside viewers still work, and the record of what happened is kept the way every other fact is.
Decided in https://github.com/kamp-us/tea-fabrika/issues/1775.

## Considered Options

- A separate span store, like today's record parts in `next/packages/libfabrika/src/telemetry/`: rejected. It is
  rethought as the ledger store, not copied.
- Spans as entries on the app's own log: rejected. Spans outnumber events by far, and a ledger never forgets, so they
  would bury the facts the app cares about.

## Consequences

- A span's name is `<package>.<call>`, and its attributes use OpenTelemetry's standard names first, with
  `kalfa.<package>.*` only where none exists. Protocols settled before this get their spans added, not redone.
- The trace stamp (`@kalfa/telemetry/ledger`) carries trace id, span id and the sampled flag, with no `tracestate` and
  no baggage. The build stamp carries the writer's commit id and package version, once per process.
- A reader of an entry links to the writer's span by default, and becomes its child only on request, for one message to
  one consumer (https://github.com/kamp-us/tea-fabrika/issues/1774).
- Stores are entry points picked by a `[telemetry]` setting: `/ledger` (the default), `/otlp`, and `/memory` and `/test`
  for tests. Logs and metrics ride the same stores. Every trace is kept by default, and a setting lowers the share.
- A secret's value never goes in a span, and message and prompt text stays out by default; an app that keeps that text
  puts it in a content record it can delete.
- A build CI starts gets its trace from a new `kalfa ci` command, and a build GitHub starts itself gets a new trace,
  linked to Delivery's land span through the commit id. Tests are spans through vitest's `experimental.openTelemetry`,
  set up by `@kalfa/quality/vitest`.
- Using `@kalfa/quality/vitest` as vitest's `sdkPath` is untested, and vitest's option is marked experimental.
