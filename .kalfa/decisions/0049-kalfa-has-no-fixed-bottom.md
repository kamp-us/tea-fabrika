# Kalfa has no fixed bottom; the import order is its only shape

Kalfa names no tier of packages that everything else sits on. The one structure is the ranked import order: a package imports only packages ranked below it, so no cycle can form. We dropped the fixed list because every kalfa package must be usable alone anyway, so a named tier only adds a rule to keep true, and the word "layer" clashes with Effect's `Layer`. Where each package ranks is settled when its interface is sketched.

## Considered Options

- Keep a named tier of standalone packages, those that import no other kalfa package: rejected, because which packages import which changes as they grow, and the list would go stale.

## Consequences

This replaces the four-bottom-layers decision, and keeps its other rules. Program holds long work: an answer still owed, timed by the place's own alarm. Each place's runner (a Durable Object, Node, a browser tab, a test) is an adapter. Deletable content and blobs get no package of their own: Effect's `KeyValueStore` covers them. Each finished span is an entry on its own ledger log (decision 0063).

A client key's private half is kept by Secrets, which signs with it; Identity names the key and who it belongs to.
