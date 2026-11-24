# @kalfa/secrets

Secrets by name: a value few may read, known to everyone else only by its name. The package so far holds the words a secret store is
built from, the laws every store passes, and declaring, routing and fetching a secret. Signing comes in later slices of the same
ticket (https://github.com/kamp-us/tea-fabrika/issues/2053). The words are in [`GLOSSARY.md`](./GLOSSARY.md).

It imports `@kalfa/config` and no other package of this repository, no Node module and no telemetry. It never logs and never prints:
a console line is a place a value could land.

## Names

`SecretName` is a name such as `transport/turn-key`: lowercase segments of letters and digits with single hyphens, joined by `/`,
a part at most 64 characters and the whole name at most 256. `StoreId` is a store's id in a route, such as `memory` or `env`. `Version` is a store's own label for one
value, or one signing key, that a name has held: not empty, at most 128 characters. Each is a branded text, so a plain text is no
name, and a refusal's message holds no part of the text.

## Declare, route and fetch

```ts
import { Secret, Secrets, SecretsSettings } from "@kalfa/secrets";
import * as SecretsMemory from "@kalfa/secrets/memory";
import { Effect } from "effect";

// Declared once, by the app. `MayFetchSecret` is the app's Permissions class: a Context key whose value, the proof, has an `object` text.
const TurnKey = Secret.make("transport/turn-key", { fetch: MayFetchSecret });

TurnKey.object; // "secret:transport/turn-key", the text the app's guard checks

// Fetched by yielding it, with the app's guard piped on.
const value = yield* TurnKey.pipe(MayFetchSecret.guard(subject, TurnKey.object));
// Redacted<string>; fails SecretMissing | SecretsUnavailable (and Denied from the guard)

// Wired once. `values` is what the app's own settings group gave for `SecretsSettings.all`.
Secrets.layer({ stores: [SecretsMemory.store], declared: [TurnKey], settings: values });
// Layer<Secrets, RouteMissing | RouteRefused, Recorder | SecretsMemory.Contents>
```

```toml
# A route, in the app's settings file: a name to a store and that store's item.
[[secrets.routes]]
name = "transport/turn-key"
store = "memory"
item = "turn-key"
```

- **A name is written in code.** `Secret.make` takes a literal name: a name typed as plain text, as a union, with a hole of plain text
  or as `any` does not compile, and a name `SecretName` refuses throws when the module that declares it loads.
- **The proof.** Secrets imports nothing of Permissions. It reads one thing from a proof, its `object`, and that must be
  `secret:<name>`, which `Name.object` writes. A proof made for another object makes the fetch die, naming both objects, before any
  store is asked. So does a secret that is not in `declared`: it is checked by reference, so a copy of the same name is refused.
- **The start check.** `Secrets.layer` checks every declared secret before the first use, in the order they are declared, and fails on
  the first problem: `RouteMissing` for a name with no route, and `RouteRefused` for a route to a store no one listed (`store`), an
  item the store does not read (`item`), or a store without the port the secret needs (`port`, naming `holds`). Two stores with one
  id, or two declarations of one name, are faults in code and die. A declaration listed twice is one. A route for a name nobody
  declared is left alone.
- **A fetch** reads the routed item, records `Fetched` with the name, the store and the store's version, and only then gives the
  value, hidden, labeled with the name. A store that cannot answer, or a recorder that cannot write, is `SecretsUnavailable` with that
  failure as its reason and gives no value. An item with nothing in it is `SecretMissing`, never an empty value. Nothing is kept
  between fetches. A store that throws instead of failing is a defect of the fetch, and it is re-raised as a `StoreFailed` that holds the thrown error as a hidden cause, so the text it quotes shows nowhere. A fetch is one span, `secrets.fetch`, with `kalfa.secrets.name`, `kalfa.secrets.store` and, on success,
  `kalfa.secrets.version`.
- **`secrets.routes`** is the one setting: the routes, at most one for each name.

## A store's side

```ts
import { Store } from "@kalfa/secrets";
import { Effect, Schema } from "effect";

const store = Store.make({
  id: "env",
  item: Schema.NonEmptyString,
  place: "store",
  holds: { read: (item: string) => Effect.succeed(new Store.Missing({ reason: "absent" })) },
});
```

`Store.make` gives a store its types from what it is given: its id, the type of its items (as a route's text decodes to them) and
what its ports need. `Store.Needs` of a store, or of a union of stores, is what they need.

- **`holds`** reads an item, for the secret `name` that was asked for. It answers `Found`, with the value as a `Redacted` that the store has already labeled with that name, and a `Version`, or `Missing`, with a reason:
  `absent` (nothing is there; an empty text is nothing), `kind` (the other kind of secret is) or `algorithm` (a key of another
  algorithm). It fails with `StoreFailed` when the store cannot answer. A store's own client may quote a value it read, so the
  failure holds its cause as a `Redacted`, which no rendering shows: make it with `Redacted.make(cause)`, and read it on purpose
  with `Redacted.value(error.cause)`. A cause that is not a `Redacted` does not compile.
- **`place`** is where a signing key's private key sits while it signs: `store`, `runtime` or `memory`, tight to loose.

## The Recorder

A use of a secret leaves a fact. `Fetched` holds the name, the store and the version of one fetch, and nothing else; it is a Schema,
so a ledger saves exactly those and refuses a name, a store id or a version that is none. The `Recorder` service takes a fact and
fails with `RecordFailed` when it cannot write, which holds its cause as a `Redacted`, as `StoreFailed` does.

## The memory store

`@kalfa/secrets/memory` is the store `memory`, in the place `memory`. A person puts a value in with `Contents`, and the store reads
it back.

```ts
import * as SecretsMemory from "@kalfa/secrets/memory";

const layer = SecretsMemory.layer({ values: { "app-key": "a value" } }); // Layer<Contents>
```

Each put makes the next version of its item, counted from 1. A seed is what a person had already put, as version 1. The empty text
is nothing. Two builds of one layer share nothing. `SecretsMemory.recorder` is a recorder that keeps every fact in order, and
`Recorded` reads them.

## The store laws

`@kalfa/secrets/test` gives `suite(name, subject, { runs, timeout })`: the laws every store passes. A runner says how to make an
empty store of its own kind and how a person puts a value into it. A store that passes them answers as every other one does: a
value is read back byte for byte and hidden, each put is a new version, an item never put is `Missing absent`, and no answer shows
a value.

## What never shows a value

A value is a `Redacted` from the moment a store hands it out. Nothing this package makes holds it as text: not an answer's display,
a fact, the contents of the memory store, a log line or a span. A failure's cause may quote a value, so it is a `Redacted`
and no rendering of the failure, its properties or the error under it shows it.
