# Telemetry

Showing what every step of every kalfa package did: traces made of spans, kept where a person or an outside viewer can
read them. Every package traces every step; Telemetry only keeps and shows what they made.

## Language

**Trace**:
Everything that happened because of one thing, such as one message or one build, as a tree of spans. A trace has one
trace id.
_Avoid_: request, session, flow

**Span**:
One step inside a trace: a name, a start and an end, attributes, and the span it belongs to. A span's name is
`<package>.<call>`.
_Avoid_: event, operation, segment

**Attribute**:
One named value on a span. Its name is OpenTelemetry's standard name when one exists, and `kalfa.<package>.*` when none
does.
_Avoid_: tag, label, field, property

**Parent**:
The span a span runs inside. A span has at most one parent, and the first span of a trace has none.
_Avoid_: caller, owner, container

**Link**:
A pointer from one span to another span, in this trace or another, without making it a child. A reader of an entry
links to the writer's span by default.
_Avoid_: reference, relation, follows-from

**Sampling**:
Choosing which traces are kept. Every trace is kept by default; a setting lowers the share.
_Avoid_: filtering, dropping, rate limiting

### Stamps on the Ledger

**Trace stamp**:
The stamp (Ledger) that fills the trace slot (Ledger) of an entry: the trace id, the writer's span id and whether the
trace is sampled. Nothing else rides in it.
_Avoid_: trace context, trace header, correlation id

**Build stamp**:
The stamp (Ledger) that fills the build slot (Ledger) of an entry: the writer's commit id and package version. It is
the same for every entry one process writes.
_Avoid_: version stamp, release tag

### Keeping spans

**Store**:
A place finished spans, logs and metrics are kept, picked by a setting. The default is the span log; another sends them
to an outside viewer, and others are for tests.
_Avoid_: backend, sink, exporter, database

**Span log**:
A separate log (Ledger) that holds each finished span as one entry. It is never the app's own log, because spans far
outnumber events, and a ledger never forgets.
_Avoid_: trace table, span store, trace database

**Content record**:
A record an app keeps of message or prompt text so a span can point at it. The app can delete it; the span never holds
the text.
_Avoid_: payload, transcript, body
