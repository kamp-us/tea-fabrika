# CI keeps its builds on the Ledger and chooses with a pure value

A build host such as GitHub Actions keeps no priority class, no line of waiting builds and no word on who canceled a
build, so `@kalfa/ci` keeps its own record. Each thing that happens (a build request came, a build was admitted, a
cancel was sent, the host said a build ended, the floor was set) is one entry on a Ledger stream, and one pure value
reads those entries and says what to start and what to cancel on the host. We chose this because a restart replays
the entries, every build stays on record with its ending, and the Ledger's revision check stops two copies of CI from
both starting builds.

## Considered Options

- Effect's `KeyValueStore`: rejected. It costs no kalfa import, but it is marked unstable, keeps no history, and
  cannot stop two writers.
- No record, the host is the only truth: rejected, because the host keeps none of the facts admission needs.
- The choosing written inside the service, over a fake host in tests: rejected, because the rules that broke in our
  incidents are the ones that most need a test with no host at all.

## Consequences

`@kalfa/ci` imports `@kalfa/ledger`, so using CI alone also means providing a Ledger, such as the in-memory or SQLite
one. The pure value is exported, so its shape and the shape of its entries are a promise. One repository has one CI.
