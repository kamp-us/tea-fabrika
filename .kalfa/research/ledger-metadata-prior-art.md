# Per-entry metadata in append-only logs: prior art

Question: how do logs and event stores treat the metadata a writer attaches to an entry (who wrote it, trace or correlation ids, causation, "what I had read")? For each system: where it lives, whether the store reads it, how a resend is detected, and what optimistic concurrency is called.

Method: official docs, plus the source code of each project, cloned and read at a pinned commit (the commit is in each section). Where a claim comes from code, I cite the file at that commit. Where I infer from code and did not run it, I say so.

Systems: KurrentDB (EventStoreDB), Kafka, NATS JetStream, Marten, Message DB, Axon Server. Added: the DCB spec (Dynamic Consistency Boundary), because it is the one design that models "what I had read" as a first-class append condition.

---

## 1. KurrentDB / EventStoreDB

Source pinned: https://github.com/EventStore/EventStore/tree/655e7b54dad4a524007d75d12c08ee456f32795b

**(1) Where metadata lives.**
- Today's gRPC API (v1): each proposed event has an `id`, a small `metadata` string map, `custom_metadata` bytes, and `data` bytes. The string map only carries `type` and `content-type`. Writer metadata goes in `custom_metadata`. https://github.com/EventStore/EventStore/blob/655e7b54dad4a524007d75d12c08ee456f32795b/src/Protos/Grpc/streams.proto (lines 201-206)
- The newer v2 API (marked "UNSTABLE" in its own header) has one `properties` map (string to protobuf Value) per record. Its comment says system keys start with `$` and user keys "MUST NOT start with `$`". Examples in the comment: `$trace-id`, `$span-id`, `$timestamp`. https://github.com/EventStore/EventStore/blob/655e7b54dad4a524007d75d12c08ee456f32795b/proto/kurrentdb/protocol/v2/streams/streams.proto (AppendRecord, lines 95-125)
- Stream metadata is a different thing: a JSON document on a separate `$$stream` stream. Do not mix it up with event metadata. https://docs.kurrent.io/server/v24.10/features/streams.html

**(2) Does the store read it?**
- v1 append: the server copies `custom_metadata` into the record as opaque bytes. It only counts its size for the max event size. It reads `type` and `content-type` from the string map and rejects the append if either is missing. https://github.com/EventStore/EventStore/blob/655e7b54dad4a524007d75d12c08ee456f32795b/src/KurrentDB.Core/Services/Transport/Grpc/Streams.Append.cs (lines 55-80) and https://github.com/EventStore/EventStore/blob/655e7b54dad4a524007d75d12c08ee456f32795b/src/KurrentDB.Core/Services/Transport/Grpc/MetadataHelpers.cs
- Reserved event-metadata keys, per the docs: "All names starting with `$` are reserved for internal use." Two are listed: `$correlationId` and `$causationId`. https://docs.kurrent.io/server/v24.10/features/streams.html (section "Event metadata")
- Who reads those keys: the projections subsystem, not the append path. The built-in `$by_correlation_id` projection links events by `$correlationId`. Projection code writes `$correlationId` and `$causedBy` into events it emits. https://github.com/EventStore/EventStore/blob/655e7b54dad4a524007d75d12c08ee456f32795b/src/KurrentDB.Projections.V1/Services/Processing/Emitting/EmittedStream.cs (lines 505-518) and https://github.com/EventStore/EventStore/blob/655e7b54dad4a524007d75d12c08ee456f32795b/src/KurrentDB.Projections.Management/ProjectionsSubsystem.cs (line 98)
- v2 append: the validator checks only that each property key is non-empty and each value has a type set. The server itself adds `$schema.format` and `$schema.id` keys. The "user keys must not start with `$`" rule is in the proto comment. I did not find code that enforces it in the validator. https://github.com/EventStore/EventStore/blob/655e7b54dad4a524007d75d12c08ee456f32795b/src/KurrentDB.Api.V2/Modules/Streams/Validators/AppendRecordValidator.cs and https://github.com/EventStore/EventStore/blob/655e7b54dad4a524007d75d12c08ee456f32795b/src/KurrentDB.Api.V2/Modules/Constants.cs
- Stream metadata keys (`$maxAge`, `$maxCount`, `$tb`, `$cacheControl`, `$acl`) are read by the server for retention and access. That is stream-level, not per-entry. https://docs.kurrent.io/server/v24.10/features/streams.html

**(3) Resend detection.**
- By event id, and event position when the caller gives an explicit expected revision. Content and metadata are never compared. The code compares event id, stream id and event number only. https://github.com/EventStore/EventStore/blob/655e7b54dad4a524007d75d12c08ee456f32795b/src/KurrentDB.Core/Services/Storage/ReaderIndex/IndexWriter.cs (lines 198-300)
- "Strong" check: the caller gave an exact expected revision. The server checks that each event id sits at the expected event number in that stream. All match: returns success without writing again. First event new, later ones already there (or the reverse): `CorruptedIdempotency` or a consistency failure.
- "Weak" check: expected revision is `Any`, `StreamExists` or soft-deleted. The server looks the ids up in a cache of recently committed events (the code comment says "check recently written events only"). So the guarantee is time-limited.
- The docs for the Python client say the same: retrying a successful append returns success "when optimistic concurrency control is active", and "KurrentDB does not enforce unique event IDs". https://docs.kurrent.io/clients/python/v1.2/appending-events
- Not found in primary sources: a current server-docs page for the gRPC append that states these rules. I took them from the code and the client doc.

**(4) Optimistic concurrency.** Called "expected revision" (v1 server code: `ExpectedStreamRevision`; older docs say "expected version"). Values: an exact revision number, `NoStream`, `Any`, `StreamExists`. Mismatch returns `WrongExpectedVersion` carrying the current revision. https://github.com/EventStore/EventStore/blob/655e7b54dad4a524007d75d12c08ee456f32795b/src/KurrentDB.Core/Services/Transport/Grpc/Streams.Append.cs (lines 25-32, 120-160)
- v2 adds `AppendRecords` with separate `ConsistencyCheck`s. A check can name any stream, including one the request does not write to. The proto says this is for Dynamic Consistency Boundary patterns, and that all failing checks are reported together. A query-predicate check is a commented-out placeholder. https://github.com/EventStore/EventStore/blob/655e7b54dad4a524007d75d12c08ee456f32795b/proto/kurrentdb/protocol/v2/streams/streams.proto (lines 36-47, 205-240)

---

## 2. Apache Kafka

Source pinned: https://github.com/apache/kafka/tree/dc9f1f42828f2f301b77926b22b59fbbdfc0e4a9

**(1) Where metadata lives.** Record headers: a list of key (String) and value (byte array, may be null) pairs on each record. https://github.com/apache/kafka/blob/dc9f1f42828f2f301b77926b22b59fbbdfc0e4a9/clients/src/main/java/org/apache/kafka/common/header/Header.java . The design note (KIP-82) says headers are for "transport routing, filtering etc.", allows duplicate keys, keeps order, and lists no reserved keys. https://cwiki.apache.org/confluence/display/KAFKA/KIP-82+-+Add+Record+Headers

**(2) Does the store read it?** No, as far as I can find. KIP-82 puts broker-side use of headers out of scope. In the broker's append validator, the in-place path uses `skipKeyValueIterator`, whose comment says key, value and headers "would not be used at all". A search of `storage/src/main` for `headers()` finds no use in the log code. This is a search result at one commit, not a proof. https://github.com/apache/kafka/blob/dc9f1f42828f2f301b77926b22b59fbbdfc0e4a9/storage/src/main/java/org/apache/kafka/storage/internals/log/LogValidator.java (lines 340-346). What the broker does read: record key (log compaction) and batch-level producer id, epoch, sequence. https://github.com/apache/kafka/blob/dc9f1f42828f2f301b77926b22b59fbbdfc0e4a9/docs/design/design.md (Log Compaction section)

**(3) Resend detection.** Idempotent producer. The broker assigns a producer id, and the producer sends a sequence number with each batch (https://github.com/apache/kafka/blob/dc9f1f42828f2f301b77926b22b59fbbdfc0e4a9/docs/design/design.md, line 193). Per partition the broker keeps the last 5 batches per producer (`NUM_BATCHES_TO_RETAIN = 5`). A new batch is a duplicate if the epoch matches and the first and last sequence match a kept batch. Then the broker returns the original append metadata and does not write. https://github.com/apache/kafka/blob/dc9f1f42828f2f301b77926b22b59fbbdfc0e4a9/storage/src/main/java/org/apache/kafka/storage/internals/log/ProducerStateEntry.java (lines 35, 128-137) and https://github.com/apache/kafka/blob/dc9f1f42828f2f301b77926b22b59fbbdfc0e4a9/storage/src/main/java/org/apache/kafka/storage/internals/log/UnifiedLog.java (lines 1412-1423). A sequence gap throws `OutOfOrderSequenceException`. https://github.com/apache/kafka/blob/dc9f1f42828f2f301b77926b22b59fbbdfc0e4a9/storage/src/main/java/org/apache/kafka/storage/internals/log/ProducerAppendInfo.java (lines 162-205)
- Id by position only. The match is on (producer, epoch, sequence range). No content or header compare. Inference from the code, not a run: a retry with the same sequence but different bytes would be acknowledged as a duplicate.
- The identity is the producer session, not a message id the app picks. A new producer instance gets a new id, so app-level retries across restarts are not caught.
- It is on by default (`enable.idempotence`). https://github.com/apache/kafka/blob/dc9f1f42828f2f301b77926b22b59fbbdfc0e4a9/clients/src/main/java/org/apache/kafka/clients/producer/ProducerConfig.java (lines 372-380)

**(4) Optimistic concurrency.** None. The produce request has no expected-offset field: its fields are transactional id, acks, timeout, and per partition the index and records. https://github.com/apache/kafka/blob/dc9f1f42828f2f301b77926b22b59fbbdfc0e4a9/clients/src/main/resources/common/message/ProduceRequest.json . Closest thing: transactions, which give atomic multi-partition writes, not a "stream is at N" check.

---

## 3. NATS JetStream

Source pinned: https://github.com/nats-io/nats-server/tree/a0385c9af342ffae6df28999b77a85de5423d3d6

**(1) Where metadata lives.** Message headers (HTTP-style key and value). The server's own control keys share the same header block as the writer's keys.

**(2) Does the store read it? Yes, a fixed list of `Nats-` keys on publish.** From the server constants: `Nats-Msg-Id`, `Nats-Expected-Stream`, `Nats-Expected-Last-Sequence`, `Nats-Expected-Last-Subject-Sequence`, `Nats-Expected-Last-Subject-Sequence-Subject`, `Nats-Expected-Last-Msg-Id`, `Nats-Rollup`, `Nats-TTL`, `Nats-Incr`, `Nats-Batch-Id`, `Nats-Batch-Sequence`, `Nats-Batch-Commit`, and `Nats-Schedule*`. https://github.com/nats-io/nats-server/blob/a0385c9af342ffae6df28999b77a85de5423d3d6/server/stream.go (lines 748-775)
- Uses: dedup (`Nats-Msg-Id`), concurrency (the `Expected` keys), retention and purge (`Nats-Rollup`, `Nats-TTL`), counters, batching, scheduling.
- Other headers (trace ids, writer ids) are stored and returned without interpretation. I did not find code that reads them.
- Mirrors and sources strip `Nats-Expected-` and `Nats-Batch-` headers before they re-store, so the checks run once at the origin. https://github.com/nats-io/nats-server/blob/a0385c9af342ffae6df28999b77a85de5423d3d6/server/stream.go (lines 4157-4160, 5019-5024)

**(3) Resend detection.** By `Nats-Msg-Id` only, inside a time window. The server keeps a map of id to sequence and time, and a timer purges entries older than the stream's `duplicate_window` (default 2 minutes). A repeat gets a PubAck with `"duplicate": true` and the original sequence, and is not stored. No body or header compare. https://github.com/nats-io/nats-server/blob/a0385c9af342ffae6df28999b77a85de5423d3d6/server/stream.go (lines 819-823, 1940-1941, 5693-5766, 7095-7118). Docs: "The server refuses to store the same ID twice within the stream's duplicate-tracking window", default two minutes, "a stream setting, not a header". https://docs.nats.io/learn/jetstream/publishing . After the window, a retry stores a second copy.

**(4) Optimistic concurrency.** Done with headers on the publish, no special call. Header reference: `Nats-Expected-Last-Sequence` "Message will only be stored if the stream's last sequence matches this value"; `Nats-Expected-Last-Subject-Sequence` does the same per subject; `Nats-Expected-Last-Msg-Id` checks the last message id; `Nats-Expected-Stream` checks the stream name. https://docs.nats.io/reference/jetstream/api/headers . On mismatch the server answers with a "wrong last sequence" error and the current value (code lines 6859-6900, 7120-7133). The publish docs describe the expected headers as failing "a publish unless the stream is in a specific state, for optimistic concurrency". https://docs.nats.io/learn/jetstream/publishing . A fast-batch design (ADR-50) allows `Nats-Expected-Last-Sequence` only on the first message of a batch. https://github.com/nats-io/nats-architecture-and-design/blob/4bcd3eb840d036053f822b6ed3b32b96c92f8ed2/adr/ADR-50.md (line 85)

---

## 4. Marten (PostgreSQL)

Source pinned: https://github.com/JasperFx/marten/tree/98094039588c013f9e8dabdc320e76d99028f31c

**(1) Where metadata lives.** Optional columns on `mt_events`: `correlation_id`, `causation_id`, `headers` (JSON), `user_name`. Off by default ("lean"). Each is turned on one by one in `opts.Events.MetadataConfig`, and the columns are only created if you opt in. https://martendb.io/events/metadata.html . Table definition: https://github.com/JasperFx/marten/blob/98094039588c013f9e8dabdc320e76d99028f31c/src/Marten/Events/Schema/EventsTable.cs (lines 66-69)

**(2) Does the store read it?** No, for correctness. Marten fills the values on write: correlation and causation ids are taken from the active OpenTelemetry span, or from the session or the event if you set them. Headers can be set per session or per event; a session header overwrites an event header with the same key. https://martendb.io/events/metadata.html . I found no code or doc where append, dedup or concurrency branches on these columns. They are for queries and projections.

**(3) Resend detection.** None by default. The event `id` (a Guid) has no unique index unless you turn on `EnableUniqueIndexOnEventId`. Without it, writing the same id twice just stores two rows. https://github.com/JasperFx/marten/blob/98094039588c013f9e8dabdc320e76d99028f31c/src/Marten/Events/EventGraph.cs (line 436) and https://github.com/JasperFx/marten/blob/98094039588c013f9e8dabdc320e76d99028f31c/docs/events/storage.md (lines 170-185). With the index, a duplicate is a database unique violation, not a quiet success. The docs advise making "create commands idempotent on the stream id". https://martendb.io/events/appending.html

**(4) Optimistic concurrency.** Several forms:
- `FetchForWriting` (recommended; the guard comes free), `AppendOptimistic()`, `AppendExclusive()` (database lock), and `Append(streamId, expectedVersion, events)` (Rich mode only). https://martendb.io/events/appending.html
- Unique index on `(stream_id, version)` backs the stream version check. https://github.com/JasperFx/marten/blob/98094039588c013f9e8dabdc320e76d99028f31c/src/Marten/Events/Schema/EventsTable.cs (lines 168-190)
- DCB: `FetchForWritingByTags` records what the session read. At `SaveChangesAsync`, Marten checks whether new events matching the query were appended since the read. It throws `DcbConcurrencyException`. It keeps the read state in a side table `mt_dcb_tag_version`, one row per tag value. https://github.com/JasperFx/marten/blob/98094039588c013f9e8dabdc320e76d99028f31c/docs/events/dcb.md (lines 339-400)

---

## 5. Message DB (Postgres)

Source pinned: https://github.com/message-db/message-db/tree/25da82b044f94416202ac3daa1866791b385badc

**(1) Where metadata lives.** A `metadata jsonb` column next to `data jsonb`. The write function takes both. https://github.com/message-db/message-db/blob/25da82b044f94416202ac3daa1866791b385badc/README.md (lines 129-160) and https://github.com/message-db/message-db/blob/25da82b044f94416202ac3daa1866791b385badc/database/tables/messages.sql

**(2) Does the store read it? Yes, one key, on read.** `get_category_messages(..., correlation => ...)` filters on `category(metadata->>'correlationStreamName')`. There is an index that includes that expression. The README: "Category or stream name recorded in message metadata's `correlationStreamName` attribute to filter the batch by". `write_message` itself never looks inside `metadata`. https://github.com/message-db/message-db/blob/25da82b044f94416202ac3daa1866791b385badc/database/functions/get-category-messages.sql (lines 40-50), https://github.com/message-db/message-db/blob/25da82b044f94416202ac3daa1866791b385badc/database/indexes/messages-category.sql , README line 244. The reads also take a free-form SQL `condition`, which could reference any metadata key.

**(3) Resend detection.** No quiet idempotency. There is a unique index on `id`, so a repeated id makes the insert fail with a unique violation. There is also a unique index on `(stream_name, position)`. No content or metadata compare. https://github.com/message-db/message-db/blob/25da82b044f94416202ac3daa1866791b385badc/database/indexes/messages-id.sql . (The failure on duplicate id is my reading of the unique index plus the plain `INSERT` in `write-message.sql`; I did not run it.)

**(4) Optimistic concurrency.** The `expected_version` argument of `write_message` (the README: "Version that the stream is expected to be when the message is written"). The function takes an advisory lock on the stream, reads the stream version (-1 if empty), and raises `Wrong expected version: ...` on mismatch. https://github.com/message-db/message-db/blob/25da82b044f94416202ac3daa1866791b385badc/database/functions/write-message.sql (lines 15-32)

---

## 6. Axon Server

Source pinned: https://github.com/AxonIQ/axon-server-api/tree/f8cc9441469aeeea5dbd90a80cdf9ee5dd819099 (the API only; the server source was not reachable, so server behavior below comes from the proto comments and docs).

**(1) Where metadata lives.** A `meta_data` map on each event, separate from the payload. Classic API: `map<string, MetaDataValue>` (text, number, boolean, double). https://github.com/AxonIQ/axon-server-api/blob/f8cc9441469aeeea5dbd90a80cdf9ee5dd819099/src/main/proto/event.proto (lines 437-462). DCB API: `map<string, string> metadata`, next to separate `name`, `version` and `identifier` fields and a separate list of `Tag`s on the `TaggedEvent`. https://github.com/AxonIQ/axon-server-api/blob/f8cc9441469aeeea5dbd90a80cdf9ee5dd819099/src/main/proto/dcb.proto (lines 155-194)

**(2) Does the store read it?** Not metadata, by what I found. The DCB append condition is written in terms of event name and tags (`TagsAndNamesCriterion`), not metadata keys. The Axon Framework docs say tags come from payloads via `@EventTag` or a `TagResolver`, and do not mention metadata. https://docs.axoniq.io/axon-framework-reference/5.3/events/event-store-internals/ . Not found in primary sources: any statement on whether the server reads or validates metadata keys.

**(3) Resend detection.** Not found in primary sources. The event has a unique `message_identifier` / `identifier`, but I found no doc or proto comment that says the server rejects or collapses a repeated id. The error code table has duplicate errors for commands and queries (AXONIQ-4005, AXONIQ-5007), not events. https://docs.axoniq.io/axon-server-reference/v2024.1/axon-server/administration/error-codes/

**(4) Optimistic concurrency.** Two models.
- Classic: each event carries `aggregate_identifier` and `aggregate_sequence_number`. A wrong sequence is rejected with error AXONIQ-2000 (INVALID_SEQUENCE). The error doc describes it as a gap between the client's sequence number and the store's for that aggregate. Note: that page's wording is thin. https://docs.axoniq.io/axon-server-reference/v2024.1/axon-server/administration/error-codes/
- DCB: `ConsistencyCondition` = a `consistency_marker` plus criteria. Proto comment: "If there are events with a sequence greater or equal than the consistency marker and those are matching the given criteria, the condition is not met and the transaction is rejected." The marker comes back from a read (`Source`) and from each successful append. If the condition is omitted, the append is unconditional. https://github.com/AxonIQ/axon-server-api/blob/f8cc9441469aeeea5dbd90a80cdf9ee5dd819099/src/main/proto/dcb.proto (lines 207-232, 385-420). The framework calls it `AppendCondition` = `EventCriteria` + `ConsistencyMarker`. https://docs.axoniq.io/axon-framework-reference/5.3/events/event-store-internals/

---

## 7. Added: the DCB specification

Source: https://dcb.events/specification/

- Event shape: type, data, tags. It "MAY contain further fields, like metadata defined by the client." Metadata is optional and client-defined; a store is not required to return it.
- "What I had read" is a first-class field: the append condition has a required `failIfEventsMatch` query and an optional `after` sequence position. With `after` omitted, any matching event fails the append.
- Resend detection: the spec says nothing. The condition guards against conflicting writes, not against the same event sent twice.

---

## Closing table

| System | Store reads metadata? | Keys the store reads | Resend check | Concurrency name |
|---|---|---|---|---|
| KurrentDB v1 | Only in projections, not on append | `$correlationId`, `$causationId` (projections); `type` and `content-type` in the string map on append | event id (+ event number when revision is exact); recent-writes cache for `Any` | expected revision |
| KurrentDB v2 (unstable) | Validates shape only | adds `$schema.*` itself; `$` prefix reserved by comment | same engine | expected revision, plus `ConsistencyCheck` |
| Kafka | No (not found) | none (broker reads key and batch producer fields) | producer id + epoch + sequence range, last 5 batches | none |
| NATS JetStream | Yes, `Nats-` keys on publish | `Nats-Msg-Id`, `Nats-Expected-Stream`, `Nats-Expected-Last-Sequence`, `Nats-Expected-Last-Subject-Sequence`, `Nats-Expected-Last-Msg-Id`, `Nats-Rollup`, `Nats-TTL`, `Nats-Incr`, `Nats-Batch-*`, `Nats-Schedule*` | `Nats-Msg-Id` only, inside `duplicate_window` | expected-last-sequence headers |
| Marten | No (writes columns, never branches on them) | none | none by default; opt-in unique index on id errors | expected version, `AppendOptimistic`, DCB `DcbConcurrencyException` |
| Message DB | Yes, on read only | `correlationStreamName` (category filter) | unique index on id errors | `expected_version` |
| Axon Server | Not found | none found (DCB reads name and tags) | not found | sequence number (AXONIQ-2000); DCB consistency marker |
| DCB spec | Optional, client-defined | none | none | append condition (`failIfEventsMatch`, `after`) |

## Patterns

- Almost nobody lets a general metadata map drive store behavior. Where the server acts on a key, it is a reserved or fixed name: `$`-prefixed in Kurrent, `Nats-` in NATS. Free-form writer keys are stored and returned untouched.
- The things that drive the store (event id, expected position, tags, producer sequence) sit in their own fields or in a reserved key namespace. Metadata (who, trace, causation) is write-and-forget.
- Resend detection never compares content. It is by id (Kurrent, NATS, Message DB, Marten opt-in) or by producer session and sequence (Kafka). Kurrent and NATS bound it in time or to a recent-writes cache.
- "What I had read" is modeled as a position, never as metadata: expected revision or sequence, or in the DCB designs a marker plus a query (Axon, Marten, Kurrent v2, DCB spec).

## What this cannot tell us

I did not run any of these systems, so every behavior comes from docs and code at the pinned commits (Kafka's "never reads headers" is a code search, not a proof). Axon Server's own source was not available, so its dedup and metadata handling are "not found in primary sources". The KurrentDB v2 protocol is marked unstable. Kurrent's current server docs for gRPC append idempotency were not reachable, so those rules rest on the server code and one client doc.
