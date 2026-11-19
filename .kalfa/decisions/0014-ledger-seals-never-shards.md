# The ledger seals old stretches and is never sharded

Old ledger stretches are sealed into read-only Durable Objects, never R2 files, because every rebuild replays the log from the start, so old stretches are live data. The ledger is never sharded by stream, because that would lose its one global order, as Kafka's partitions do. What would change this: replays from a snapshot, or a sealed read too slow for a window.
