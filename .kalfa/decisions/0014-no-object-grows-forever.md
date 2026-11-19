# No object grows forever, and nothing is dropped to stay small

A Durable Object is capped at 10 GB, so every object that grows names its cap and what it does there: roll to a new part or seal an old stretch into a read-only object (the ledger). Dropping data is never the answer. The ledger is never sharded by stream, because that would lose its one global order, and its old stretches stay in Durable Objects, not files, because every rebuild replays the log from the start.
