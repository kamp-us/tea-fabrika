# Each protocol lives once, and each provider is one package

Each outside system we speak (code host, CI, chat, and our own ledger, program and transport) has one protocol package holding Effect services and a test Layer, and no vendor code. Each provider is one package, `@kalfa/provider-<name>`, holding every Layer it gives, as `@effect/platform` and `@effect/platform-node` split. Every user is a client of the protocol, nothing calls `gh` or a vendor API directly, and the record (tickets, verdicts) never goes through the code host protocol.

## Considered Options

A provider's Layer as a subpath of each protocol (`@kalfa/ci/github`): rejected, because it spreads one vendor across every protocol package.

## Consequences

CI admission (which run may start or displace another, in priority classes like Kubernetes PriorityClass) is our own pure code beside the CI protocol, not the provider's.
