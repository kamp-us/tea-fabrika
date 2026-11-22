# The ledger is the one storage primitive

All stored state is a ledger: an append-only log of entries with `append`, `read`, `wait`, `transaction` and `streams`, deduped by id, with state folded from it. A process's tea journal is a ledger stream (one writer), and its inbox is another (many writers); Program keeps its journal on a ledger through `@kalfa/program/ledger` (decision 0048), which must pass tea's journal tests. Who may write what is a `LedgerAdmission`, a rule that runs inside the append (decision 0078), not code spread across callers.
