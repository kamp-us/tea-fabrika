---
id: 0215
title: In next/, make and decodeSync take trusted input only, and saved state, the wire and disk go through makeEffect or decodeUnknownEffect, never the throwing one
status: amended-in-part by [0575](0575-schema-sync-error-result-in-plain-code.md)
date: 2026-11-08
tags: [schema, effect-schema, errors, decode, saved-state, next]
---

# 0215: In next/, make and decodeSync take trusted input only, and saved state, the wire and disk go through makeEffect or decodeUnknownEffect, never the throwing one

**What this decides:** which Schema call `next/` code picks, by where its input came from.

```ts
// From the note.
// Trusted input, built by our own code: the throwing one. A throw here is a bug.
const n = Note.make({ id, title: "Groceries" });
// Untrusted input (saved state, the wire, disk): the typed error.
const saved = yield* Schema.decodeUnknownEffect(Saved)(row); // Effect<Saved, SchemaError>
const made = yield* Note.makeEffect(fields); // Effect<Note, SchemaIssue.Issue>
// Plain code that needs the details, not an Effect: the Result.
const r = Schema.decodeUnknownResult(Row)(raw); // Result<Row, SchemaError>
```

## Context

Decided by the owner on 2026-11-08, following the pair Effect's own Schema API offers. Effect's
docs on `make`: "Use when constructor input is trusted or when validation failure should abort with
a thrown `Error`." See [schema classes, not Of helpers](../docs/direction/schema-classes-not-of-helpers.md),
"Which one throws".

## Decision

**In `next/`, a Schema class or a parser picks by where its input came from: the throwing call for
trusted input, the typed error for untrusted input.**

- `make` and `decodeSync` throw, and take trusted input only.
- `makeEffect`, `decodeEffect` and `decodeUnknownEffect` keep the failure in the error channel.
- `decodeResult` and `decodeUnknownResult` are used only where plain code needs the failure's
  details.
- Saved state, anything off the wire and anything read from disk never take the throwing one.

## Consequences

- `runtime/State.ts` still throws `ProgramDown` when a saved row does not fit. Making it a typed
  error is its own ticket.

## Amendments

- 2026-11-15: [0575](0575-schema-sync-error-result-in-plain-code.md) makes the Effect checker's `schemaSync` an error in `next/` and our tooling, so `decodeSync`, `decodeUnknownSync`, `encodeSync` and `encodeUnknownSync` no longer pass, even for trusted input. A plain function uses `decodeResult`, `decodeUnknownResult` or `encodeResult` and handles the failure; Effect code uses the Effect form. The rest holds.
