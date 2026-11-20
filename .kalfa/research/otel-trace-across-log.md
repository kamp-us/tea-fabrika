---
summary: How OpenTelemetry and W3C Trace Context carry one request's trace across an append-only message log (what a producer stores, whether a consumer continues the trace or links to it), how Effect's spans and tracer carry that context, and what `next/`'s telemetry and ledger do today; every claim cited
---

# How OpenTelemetry carries a trace across a message log

Question (ticket https://github.com/kamp-us/tea-fabrika/issues/1774): when the hop between two processes is an
append-only log, a write now and a read by another process later, how does the trace follow the request? What does a
producer store on the message, and does the consumer continue the trace or link to it? What does Effect offer? What
does `next/` do today?

This feeds the trace slot in Ledger's metadata (https://github.com/kamp-us/tea-fabrika/issues/1764).

Read on 2026-11-20, from the pages and files linked on each line. A line marked "my reading" is mine, not a source's
claim. Only primary sources: specs, official docs, source code. Source code was read at the commit or tag named in the
Sources list. All paths below are repo-relative and about `next/` unless they say otherwise.

## The short answer

1. **Link by default. Continue (parent) only as an opt-in for one message handled by one consumer.** OpenTelemetry's
   messaging conventions say they "use spans links as the default mechanism to correlate producers and consumer(s)".
   A consumer's process span MAY use the message's creation context as its parent, "exclusively for single messages
   scenarios", and that is "NOT RECOMMENDED" by default when processing happens inside another span
   ([messaging spans](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)). Real instrumentation
   splits the same way: the Kafka JS instrumentation parents a single-message handler on the extracted context but
   links in batch mode, and KurrentDB's .NET client parents.
2. **A log entry should store one span context: trace id, span id of the writing span, and the sampled flag.** That is
   the content of a W3C `traceparent` (`00-<32 hex>-<16 hex>-<2 hex>`). A trace id alone is not enough, because an
   OpenTelemetry span link and a parent both need a trace id and a span id
   ([Trace API, SpanContext](https://opentelemetry.io/docs/specs/otel/trace/api/#spancontext)).
3. **`tracestate` and `baggage` are optional.** Neither is needed to link or parent. Baggage can carry personal data
   and "MUST" have its risk assessed, so keep it off a durable log unless a feature needs it
   ([Baggage, privacy](https://www.w3.org/TR/baggage/#privacy-considerations)).
4. **Effect has the pieces, but no messaging helper.** It can build a parent or link from a bare
   `{ traceId, spanId }` (`Tracer.externalSpan`), set the parent (`Effect.withParentSpan`), and attach links
   (`links` option, `Effect.linkSpans`). Its HTTP helper writes and reads `traceparent`, but not `tracestate` or
   `baggage`. The OpenTelemetry bridge adds trace flags and trace state.
5. **Today `next/` stores only `traceId` on a ledger line.** Its own RPC hops already pass `{ traceId, spanId }` and
   use `externalSpan`, so the span id is lost only at the log hop.

My confidence in "link by default, parent opt-in": about 75%. The doubt: the conventions are marked Development
(unstable), and our log is also a work queue where one entry starts one process step, the case the spec allows a
parent for. A ticket-sized prototype of both shapes on one real hop would settle it.

## 1. What the W3C specs say a producer stores

**`traceparent`.** Four dash-separated fields: `version`, `trace-id`, `parent-id`, `trace-flags`. For version `00`
they are 2, 32, 16 and 2 hex characters, lowercase. An all-zero trace id or parent id is invalid, and `ff` is not a
valid version ([Trace Context section 3.2](https://www.w3.org/TR/trace-context/#traceparent-header),
[version format](https://www.w3.org/TR/trace-context/#version-format)). My reading: the `parent-id` is the id of the caller's own
span, which a receiver records as its parent.

**Trace flags.** The least significant bit is `sampled`: the caller "may have recorded trace data". Other flag bits
must be zero. The sampled bit is a recommendation, not a rule
([section 3.2.2.5](https://www.w3.org/TR/trace-context/#trace-flags),
[sampled flag](https://www.w3.org/TR/trace-context/#sampled-flag)).

**`tracestate`.** A list of vendor key-value pairs that rides beside `traceparent`. At most 32 members. Vendors
should propagate at least 512 characters, and truncation drops whole entries, never part of one. If `traceparent`
cannot be parsed, `tracestate` MUST NOT be parsed either, and a `tracestate` with no `traceparent` is discarded
([section 3.3](https://www.w3.org/TR/trace-context/#tracestate-header),
[limits](https://www.w3.org/TR/trace-context/#tracestate-limits),
[processing model](https://www.w3.org/TR/trace-context/#processing-model)).

**Restarting a trace.** A receiver that finds the header invalid creates a new `traceparent` and drops `tracestate`.
A vendor may also restart a trace on purpose, and then SHOULD clean up `tracestate`
([section 3.4](https://www.w3.org/TR/trace-context/#mutating-the-traceparent-field),
[section 4.3](https://www.w3.org/TR/trace-context/#a-traceparent-is-received)).

**Messaging.** The spec defines HTTP only. Other protocols are left to extensions and a registry. Messaging appears
once, in passing: proxies or messaging middleware MAY skip changing `traceparent`
([section 5](https://www.w3.org/TR/trace-context/#other-communication-protocols),
[section 4.4](https://www.w3.org/TR/trace-context/#alternative-processing)).

**Baggage.** A separate `baggage` header holds "user-defined properties associated with a distributed request". It is
independent of Trace Context. Minimum limits: 64 members and 8192 bytes, and a platform that cannot keep all of it
"MUST NOT" send a partial member. It "can carry user-identifiable data", systems "MUST assess the risk of header
abuse", and owners should keep confidential data out of it or stop it at trust boundaries
([Baggage section 3.3.2](https://www.w3.org/TR/baggage/#limits),
[section 4](https://www.w3.org/TR/baggage/#security-considerations),
[section 5](https://www.w3.org/TR/baggage/#privacy-considerations)).

**Privacy of `traceparent`.** Vendors MUST NOT use `traceparent` or `tracestate` for personal data, and trace ids must
not come from identifiable input
([section 6](https://www.w3.org/TR/trace-context/#privacy-considerations)).

**How OpenTelemetry uses them.** A propagator injects into and extracts from a "carrier" of string key-value pairs
(HTTP headers, Kafka headers, message metadata). Extract MUST NOT throw on bad input. The API uses no-op propagators
unless configured, and platforms SHOULD default to a composite of W3C Trace Context and Baggage
([Propagators API](https://opentelemetry.io/docs/specs/otel/context/api-propagators/#global-propagators)).

## 2. What OpenTelemetry's messaging conventions say

These are Semantic Conventions 1.45.0, page status "Development" (unstable)
([messaging spans](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)).

**Operations and span kinds** (section "Span kind"):

| Operation type | Meaning | Span kind |
|---|---|---|
| `create` | a message is created | `PRODUCER` |
| `send` | one or more messages are sent | `PRODUCER` if its context is used as the creation context, else `CLIENT` |
| `receive` | a consumer pulls messages | `CLIENT` |
| `process` | a consumer processes messages | `CONSUMER` |
| `settle` | a message is acknowledged or rejected | `CLIENT` |

**Creation context.** "A producer SHOULD attach a message creation context to each message", attached so
intermediaries cannot change it if possible. The spec "does not specify the exact mechanisms" for attaching it, and
says future versions will follow industry standards such as Trace Context
([section "Context propagation"](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/#context-propagation)).
If a "Create" span exists, its context is injected. If not, the "Send" span's context is injected. A custom creation
context SHOULD NOT be modified. The "Send" span "SHOULD always link to the creation context that was injected into a
message".

**Consumer: link by default.** "For each message it accounts for, the 'Process' or 'Receive' span SHOULD link to the
message's creation context." The reasons the spec gives: links are the only trace structure that holds across all
messaging models, the only option for batches because "a span can only have a single parent", and the only option
when consumption happens inside another ambient context
([section "Consumer spans"](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/#consumer-spans)).

**Consumer: parent as an exception.** "Exclusively for single messages scenarios, the 'Process' span MAY use the
message's creation context as its parent." Instrumentation SHOULD document which it does and MAY make it a setting.
Using the creation context as parent is "NOT RECOMMENDED" by default when processing happens inside another span, and
if it is used there, the ambient context SHOULD be added as a link
([parent of process span](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/#message-creation-context-as-parent-of-process-span)).

**Prefetch.** Receive or process spans MUST NOT be created for messages a library has prefetched or cached until they
are handed to the caller.

**Attributes** (names and levels as the page lists them):

| Attribute | Level |
|---|---|
| `messaging.system.name` (not `messaging.system`) | Required |
| `messaging.operation.name` | Required |
| `messaging.operation.type` | Conditionally required |
| `messaging.destination.name` | Conditionally required (single message, or equal for all in a batch) |
| `messaging.message.id` | Recommended, when the span covers one message |
| `messaging.batch.message_count` | Conditionally required on batch operations |
| `messaging.client.id` | Recommended |
| `messaging.message.conversation_id` | Recommended |
| `error.type` | Conditionally required, when the operation failed |
| `messaging.message.body.size` | Opt-in |

If an attribute differs per message in a batch, put it "on links describing individual messages". The span name
SHOULD be `{messaging.operation.name} {destination}`, for example `send shop.orders`.

**Span links in the Trace API.** A link is a `SpanContext` (trace id, span id, trace flags, trace state, `IsRemote`)
plus attributes. It may point into the same trace or another. "Adding links at span creation is preferred to calling
`AddLink` later", because head samplers see only what exists at creation
([Trace API, Link](https://opentelemetry.io/docs/specs/otel/trace/api/#link)).

## 3. How real instrumentation carries the context

**Kafka (JS instrumentation).** Producer: a `PRODUCER` span named `send <topic>` with
`messaging.operation.type = send`, then `propagation.inject(...)` writes the active propagator's keys into
`message.headers` (`packages/instrumentation-kafkajs/src/instrumentation.ts`, lines 875-898 in
[the file](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/9782c55641709c326a7e892b366e6d830c64dcb7/packages/instrumentation-kafkajs/src/instrumentation.ts#L875-L898)).
Consumer, one message: `propagation.extract(ROOT_CONTEXT, message.headers, ...)`, and that extracted context becomes the
span's parent, so the trace continues (lines 405-426). Consumer, batch: each message's extracted span context becomes
a link and no parent is set (lines 507-534, and `links: link ? [link] : []` at line 849). Consumer spans are
`CONSUMER` for process and `CLIENT` for receive (lines 826-832). So one library does both, split on single message
versus batch, which matches the spec.

**KurrentDB (an append-only event log).** The .NET client does not use `traceparent` at all. It writes two keys into
the event's JSON metadata, `$traceId` and `$spanId`, only if the event does not already carry them
([`TracingConstants.cs`](https://github.com/kurrent-io/KurrentDB-Client-Dotnet/blob/bb00b9cfc0a6e5b289fc923801466dd9335b5468/src/KurrentDB.Client/Core/Common/Diagnostics/Core/Tracing/TracingConstants.cs),
[`EventMetadataExtensions.cs` lines 10-18](https://github.com/kurrent-io/KurrentDB-Client-Dotnet/blob/bb00b9cfc0a6e5b289fc923801466dd9335b5468/src/KurrentDB.Client/Core/Common/Diagnostics/EventMetadataExtensions.cs#L10-L18)).
A reader rebuilds an `ActivityContext` from them with the flag always `Recorded` and `isRemote: true`
([`TracingMetadata.cs` lines 18-31](https://github.com/kurrent-io/KurrentDB-Client-Dotnet/blob/bb00b9cfc0a6e5b289fc923801466dd9335b5468/src/KurrentDB.Client/Core/Common/Diagnostics/Core/Tracing/TracingMetadata.cs#L18-L31)),
and starts a `Consumer` activity with that as its parent, then disposes it at once, so the span marks delivery and
does not wrap the handler
([`ActivitySourceExtensions.cs` lines 30-60](https://github.com/kurrent-io/KurrentDB-Client-Dotnet/blob/bb00b9cfc0a6e5b289fc923801466dd9335b5468/src/KurrentDB.Client/Core/Common/Diagnostics/ActivitySourceExtensions.cs#L30-L60)).
The Python client's docs say the same in words: producer spans "add span context information to event metadata" and
consumer spans "make each 'consumer' span a child of a 'producer' parent span", with `"links": []` in the example
([KurrentDB Python client, observability](https://docs.kurrent.io/clients/python/v1.3/observability)). Neither page
nor code uses `tracestate` or `baggage`. This is a log, so it is the closest match to ours, and it chose parent.

My reading: both examples show that "what to store" is small (trace id, span id, sometimes flags), and "parent or
link" is the reader's choice at read time, not something the stored bytes decide.

## 4. What Effect offers

Effect 4.1.3 is the version `next/` pins (`pnpm-workspace.yaml`, line 100, `effect: 4.1.3`). Source read at tag
[`effect@4.1.3`](https://github.com/Effect-TS/effect/tree/effect@4.1.3/packages/effect/src) in Effect-TS/effect. The
`effect-smol` repo's main (https://github.com/Effect-TS/effect-smol, commit
`3a1128c7684e04d34d9f541f77adaac38a513056`) has the same `ExternalSpan`, `SpanLink`, `externalSpan`,
`OtelTracer.makeExternalSpan` and `withSpanContext`; its docs text is older, and its HTTP helper sits under
`unstable/http/`.

**Spans.** A `Span` has `traceId`, `spanId`, `parent: Option<AnySpan>`, `links`, `sampled`, `kind` (internal, server,
client, producer, consumer), `annotations`, and methods `attribute`, `event`, `addLinks`
([`Tracer.ts` lines 394-410](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/effect/src/Tracer.ts#L394-L410)).
The built-in span takes its trace id from its parent, else a random 32 hex string
([lines 744-746](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/effect/src/Tracer.ts#L744-L746)).

**The current span.** `Effect.currentSpan` returns the local `Span` and fails with `NoSuchElementError` when none is
open. `Effect.currentParentSpan` returns the parent, a local or an external span
([`Effect.ts` lines 8463 and 8494](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/effect/src/Effect.ts#L8463),
internals in [`internal/effect.ts` lines 6380-6388](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/effect/src/internal/effect.ts#L6380-L6388)).

**A span from outside Effect.** `ExternalSpan` is `{ _tag, spanId, traceId, sampled, annotations }`, "carrying trace and
span identifiers, sampling state, and annotations so it can be used as a parent or link"
([lines 207-213](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/effect/src/Tracer.ts#L207-L213)).
`Tracer.externalSpan({ traceId, spanId, sampled?, annotations? })` builds one and defaults `sampled` to `true`
([lines 521-534](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/effect/src/Tracer.ts#L521-L534)).
It has no field for trace state or baggage; the `annotations` context is the place for them.

**Continue (parent).** `Effect.withParentSpan(span)` makes new spans in that effect children of `span`, local or
external ([`Effect.ts` lines 8800-8803](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/effect/src/Effect.ts#L8800-L8803)).
The span options also take `parent` and `root: true` to start a fresh trace
([`SpanOptionsNoTrace`, lines 266-275](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/effect/src/Tracer.ts#L266-L275)).
Which parent a new span gets: the explicit `parent` option, else none if `root`, else the fiber's current span
([`makeSpanUnsafe`, lines 6092-6096](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/effect/src/internal/effect.ts#L6092-L6096)).

**Link.** A `SpanLink` is `{ span: AnySpan, attributes }`
([lines 454-457](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/effect/src/Tracer.ts#L454-L457)).
Give links at creation with the `links` option of `Effect.withSpan`, `Effect.makeSpan` or `Effect.fn`, or add them to
every span made inside an effect with `Effect.linkSpans(span | spans, attributes)`; `Effect.spanLinks` reads them
([`Effect.ts` lines 8549 and 8599-8609](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/effect/src/Effect.ts#L8549),
merge of environment and option links at
[`internal/effect.ts` lines 6119-6124](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/effect/src/internal/effect.ts#L6119-L6124)).
`addLinks` on a started span exists too, but the Trace API prefers links at creation.

**Propagation helpers.**
- `effect/http/HttpTraceContext` (`unstable/http/` in effect-smol) has `toHeaders(span)`, which writes both a B3 `b3`
  header and a W3C `traceparent` (`00-<traceId padded to 32>-<spanId>-<01 or 00>`), and `fromHeaders(headers)`, which
  reads `traceparent` first, then B3, and returns `Option<ExternalSpan>`. It accepts only version `00`. It handles
  neither `tracestate` nor `baggage`
  ([file](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/effect/src/http/HttpTraceContext.ts)).
  It reads HTTP `Headers`, so for a log it is a model, or a string codec to reuse by hand.
- `@effect/opentelemetry` `OtelTracer.makeExternalSpan({ traceId, spanId, traceFlags?, traceState? })` keeps trace
  flags and trace state in the external span's annotations, and `OtelTracer.withSpanContext(spanContext)` sets the
  parent from an OpenTelemetry `SpanContext`. Its module doc says to preserve `traceFlags` and `traceState` when
  building external spans, "otherwise sampling defaults to sampled and trace state cannot be propagated". The module is
  marked `@stability unstable`
  ([`OtelTracer.ts` lines 1-20, 128-163, 365-390](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/opentelemetry/src/OtelTracer.ts#L128-L163)).
- `Tracer.DisablePropagation` is a context reference that makes new spans non-propagating no-ops
  ([lines 566-569](https://github.com/Effect-TS/effect/blob/effect@4.1.3/packages/effect/src/Tracer.ts#L566-L569)).

**Not in Effect.** No messaging-specific helper, no producer or consumer wrapper, no `baggage` propagator in the core
`effect` package (I listed the 4.1.3 file tree for names with `traceparent`, `propagat`, `TraceContext` and `b3`, and found only the HTTP file above; I did not grep file contents). The
messaging attribute names are plain strings you write yourself.

## 5. What `next/` does today

All paths below start at `next/packages/libfabrika/src/`.

**The ledger line keeps a trace id and nothing else.**
- `ledger/Log.ts:24-32`: `TraceId` is 32 lowercase hex characters, never all zeros. That is W3C's trace-id rule.
- `ledger/Log.ts:53-54`: the line's `traceId` field, "The request this write belongs to. Shown and checked for
  delivery, never decides."
- `ledger/Log.ts:70-89`: `fromHere` builds the sender fields from the caller. It reads `Effect.currentSpan`, takes
  `span.traceId` and drops the span id. It opens no span, so the write joins the caller's trace. It fails with
  `NoSuchElementError` when no span is open.
- `ledger/Log.ts:157-158`: the referee refuses a bad trace id with `bad_trace`; `ledger/internal/ledgerStore.ts:109-137`
  is the check.
- `ledger/internal/ledgerStore.ts:23-29` and `283-300`: the `entries` table has a `"traceId" TEXT NOT NULL` column and
  the insert writes `line.traceId`. There is no span id, flags, `tracestate` or `baggage` column.
- `ledger/internal/ledgerStore.ts:277`: an entry is made by spreading the line (`Entry.make({ id, stream, rev, pos, arrivedAt, ...line })`), so a
  read returns the same `traceId` string and nothing more.

**The ledger's own spans use OpenTelemetry's messaging names, but not its kinds or links.**
- `ledger/internal/ledgerTrace.ts:1-8`: `messaging.destination.name` is the stream key; other tags are `fab.ledger.*`.
- `ledger/internal/ledgerStore.ts:35-40, 338-342`: `ledger.append` tags `messaging.destination.name`,
  `messaging.message.id` and `messaging.operation.type = "send"`. `ledger.read` (`382-387`) tags
  `messaging.operation.type = "receive"`.
- No `kind: "producer"` or `kind: "consumer"` is set anywhere in `next/packages/libfabrika/src/`; the sink's row
  schema allows them (`telemetry/Trace.ts:106`), so those spans are `internal`. The `ledger.append` span does not link
  to the writer's span either (`ledger/internal/ledgerStore.ts` has no `links` option anywhere; `ledger.append` at lines 338-380 only tags).

**A reader gets the trace id and does not use it as a parent or link.** `processes/Mailbox.ts:52-62`,
`processes/Mailbox.ts:128-142` and `processes/internal/processMail.ts:36-49` copy `entry.traceId` into the `Letter` a
process reads. I found no place where a read of the ledger turns that into a parent or link. The ledger test
(`ledger/TraceId.test.ts:1-3`) says an entry "joins P37's ledger.call record by traceId", so today the join is by
trace id at query time (my reading: a trace backend shows all spans with that id, with no parent edge between the write
and the read).

**But the repo already carries a full span context across its other hops, and uses both shapes.**
- Parent over an RPC: `cloudflare/runtime.ts:2437-2440` defines `Delivered = { span: { traceId, spanId } }`. Lines
  `2646-2658` and `2041`, `2048` run the work under `Effect.withParentSpan(Tracer.externalSpan(...))`. The comment at
  line 2648: "The door's input span is in another object, so its trace crosses the call as data."
- The sender side: `cloudflare/mail.ts:35-46` and `68-77` pass `{ traceId: span.traceId, spanId: span.spanId }` from
  `Effect.currentSpan`. `runtime/Entry.ts:55-69` and `access/SessionManager.ts:50-63` keep `span: { traceId, spanId }`
  in stored shapes.
- Link: `runtime/Runner.ts:1967-1998` opens `runner.write` with `links: [{ span: Tracer.externalSpan(session.span),
  attributes: {} }]` for a caused write, and `gateway/Gateway.ts:1732-1734` opens `gateway.route` linked to the input's
  stored span.

**The span sink already stores links, parents and kinds in OTLP's field names.** `telemetry/Trace.ts:85-116` defines
`SpanRow` with `traceId`, `spanId`, `parentSpanId`, `kind` (internal, server, client, producer, consumer) and
`links: [{ traceId, spanId, attributes }]`. `telemetry/Sink.ts:297-317` fills it from the ended span, including
`links`. A trace shaped as "reader span links to the writer's span" would therefore already be stored and exported
without a change to the sink (my reading).

So the gap is narrow: the log hop keeps `traceId` where every other hop keeps `{ traceId, spanId }`.

## 6. What this suggests for Ledger's trace slot

My reading, for the 1764 design; none of this is decided.

- **Store the producer's span context, not a bare trace id.** Smallest form: `traceparent` text, 55 characters, parsed
  by the existing `TraceId` rule plus a 16-hex span id and 2-hex flags. Alternative: a `span: { traceId, spanId }` (as
  `Delivered` and `Session` already have) plus a `sampled` flag. The first is the standard string and lets outside
  tools read the column. The second matches the repo's shapes. Either way, the sampled flag matters: `externalSpan`
  defaults `sampled` to `true`, so dropping the flag turns every read into a sampled parent.
- **Which span id:** the writer's current span at `fromHere` (the creation context). `ledger.append` should then link
  to it, as the spec says the "Send" span links to a custom creation context. Using `ledger.append`'s own id as the
  stored context is the other spec-allowed choice, but it is created inside the ledger, after the line is built.
- **Reader:** make `ledger.read` and the process step that consumes an entry start with `links: [externalSpan(entry)]`
  by default. A step that handles exactly one entry for one reader and is meant to read as the same request (the
  mail-to-process step) can instead run `Effect.withParentSpan(externalSpan(entry))`, with the ambient span as a link
  if there is one. Set `kind` to `producer` on the write side and `consumer` on the process step.
- **Skip `tracestate` and `baggage` now.** Nothing in `next/` uses them. Adding either later is a new optional column.
  Row size is checked against `ROW_BYTES` (`ledger/Log.ts:212`), so a `baggage` field is a cost, not free.
- **Reject or ignore a bad stored context, never throw.** OpenTelemetry's Extract "MUST NOT" throw on bad input, and
  W3C says restart the trace on an invalid header. The ledger already refuses a bad trace id at write time
  (`bad_trace`), which is stricter and fine.

## 7. What this cannot tell us

- **How a stored context behaves in our backend.** I did not run anything. Whether our sink, an OTLP backend or the
  trace viewer draws a link from a reader span to a writer span as a useful path, and how it handles a link whose
  target span was not kept (sampled out, or older than retention), is untested.
- **Whether the conventions will change.** The messaging page is "Development" status in 1.45.0, and says its
  mechanism for attaching a creation context is not yet specified, so attribute names and rules can still change.
- **Which choice fits our reads.** I did not check how many readers one entry has in our design, or how long after a
  write a read happens. Both change whether a parent edge is useful or only misleading (a parent whose duration ends
  long before its child starts).
- **NATS.** I did not read NATS client or OpenTelemetry instrumentation for it. Kafka and KurrentDB are the two
  examples. Kafka's Java instrumentation has an experimental setting where consumers start a new trace and link to the
  producer; I saw that only in search results, not in its source, so it is not cited as a claim here.
- **KurrentDB beyond its clients.** I read the .NET client's source and the Python client's docs. I did not read the
  Node client (`@kurrent/opentelemetry`) or the server, and I could not open the gRPC observability page (it returned
  404), so I do not know if every client uses the same `$traceId` and `$spanId` keys.
- **Effect's tracer inside the Cloudflare runtime.** I read Effect's source, not the behavior of this repo's tracer
  setup (`gateway/Gateway.ts:91` builds a quiet tracer). Whether `Tracer.externalSpan` parents show up as one trace in
  the real export is unchecked.
- **Cost.** I did not measure what a 55-character field adds per entry, or what linking adds per read.

## Sources

Read on 2026-11-20. Code was read at the commit or tag named here.

- W3C Trace Context, Recommendation 23 Nov 2021: https://www.w3.org/TR/trace-context/
- W3C Baggage, Candidate Recommendation 30 May 2024: https://www.w3.org/TR/baggage/
- OpenTelemetry Semantic Conventions 1.45.0, messaging spans (status Development):
  https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/
- OpenTelemetry specification, Trace API (SpanContext, Link): https://opentelemetry.io/docs/specs/otel/trace/api/
- OpenTelemetry specification, Propagators API: https://opentelemetry.io/docs/specs/otel/context/api-propagators/
- Kafka JS instrumentation, `open-telemetry/opentelemetry-js-contrib` at commit
  `9782c55641709c326a7e892b366e6d830c64dcb7`, `packages/instrumentation-kafkajs/src/instrumentation.ts`:
  https://github.com/open-telemetry/opentelemetry-js-contrib/blob/9782c55641709c326a7e892b366e6d830c64dcb7/packages/instrumentation-kafkajs/src/instrumentation.ts
- KurrentDB .NET client, `kurrent-io/KurrentDB-Client-Dotnet` at commit `bb00b9cfc0a6e5b289fc923801466dd9335b5468`,
  `src/KurrentDB.Client/Core/Common/Diagnostics/`: https://github.com/kurrent-io/KurrentDB-Client-Dotnet/tree/bb00b9cfc0a6e5b289fc923801466dd9335b5468/src/KurrentDB.Client/Core/Common/Diagnostics
- KurrentDB Python client, observability: https://docs.kurrent.io/clients/python/v1.3/observability
- Effect 4.1.3, `Effect-TS/effect` at tag `effect@4.1.3`: `packages/effect/src/Tracer.ts`,
  `packages/effect/src/Effect.ts`, `packages/effect/src/internal/effect.ts`,
  `packages/effect/src/http/HttpTraceContext.ts`, `packages/opentelemetry/src/OtelTracer.ts`:
  https://github.com/Effect-TS/effect/tree/effect@4.1.3/packages
- Effect v4 pre-release repo, `Effect-TS/effect-smol` at commit `3a1128c7684e04d34d9f541f77adaac38a513056`:
  https://github.com/Effect-TS/effect-smol
- This repo, at `origin/main` commit `2f8cf0f30`: the `next/packages/libfabrika/src/` files named in section 5, and
  `pnpm-workspace.yaml`.
