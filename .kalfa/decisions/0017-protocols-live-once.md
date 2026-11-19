# Each protocol lives once, and every user is a client

The record (tickets, verdicts) goes through the `Ledger`, built with no GitHub in it, and the code side (pull requests, merges) through the code host protocol, held once in `@kalfa/codehost` with GitHub as one Layer; nothing calls `gh` directly. Every user of the code host is a client, never a second protocol. kalfa defines the program, the ledger and the transport the same way, as protocol packages that libfabrika implements.
