# @kalfa/secrets

Secrets by name: a value few may read, known to everyone else only by its name. This is the package's base: the words a secret
store is built from, and the laws every store passes. Declaring, routing, fetching and signing come in later slices of the same
ticket (https://github.com/kamp-us/tea-fabrika/issues/2053). The words are in [`GLOSSARY.md`](./GLOSSARY.md).

It imports `@kalfa/config` and no other package of this repository, no Node module and no telemetry. It never logs and never prints:
a console line is a place a value could land.

## Names

`SecretName` is a name such as `transport/turn-key`: lowercase segments of letters and digits with single hyphens, joined by `/`,
a part at most 64 characters and the whole name at most 256. `StoreId` is a store's id in a route, such as `memory` or `env`. `Version` is a store's own label for one
value, or one signing key, that a name has held: not empty, at most 128 characters. Each is a branded text, so a plain text is no
name, and a refusal's message holds no part of the text.

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

- **`holds`** reads an item. It answers `Found`, with the value as a `Redacted` and a `Version`, or `Missing`, with a reason:
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
