# The ledger is the one storage primitive

All stored state is a ledger: an append-only log of entries with `append`, `read`, `wait`, `transact` and `streams`, deduped by id, with state folded from it. A process's tea journal is a ledger stream (one writer), and its inbox is another (many writers); `@kalfa/ledger` provides the journal driver, which must pass tea's journal tests. Who may write what is a `WritePolicy` service, not code spread across callers.
