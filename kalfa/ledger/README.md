# @kalfa/ledger

The Ledger: an append-only log of entries kept in named streams. This is the package's first slice: the shapes every user of the Ledger types
against, and the errors it answers with. The memory ledger and the laws every provider passes come in the next slice of the same ticket
(https://github.com/kamp-us/tea-fabrika/issues/2082). The words are in [`GLOSSARY.md`](./GLOSSARY.md).

It imports no other package of this repository, no Node module and no telemetry. Its one dependency is a hash, `fast-sha256`, used in one file.

## The calls

```ts
import { Effect } from "effect";
import { EntryId, EntryName, Ledger, Revision, child } from "@kalfa/ledger";

const request = EntryId.make("req-7f3a"); // the writer makes the id, always

const program = Effect.gen(function* () {
  const ledger = yield* Ledger;

  const placed = yield* ledger.append(
    "ci/requests",
    request,
    { _tag: "Requested", body: { commit: "abc123" } },
    { expectedRevision: Revision.make(0) }, // kept only while the stream is empty
  );

  const owed = child(EntryName.make("owed"), request); // "owed:req-7f3a", pure, never fails

  return { placed, owed, read: ledger.read("ci/requests", Revision.make(0), { tags: ["Requested"] }) };
});
// Effect<..., Refusal | Failure>, with the Ledger in its requirements
```

- **`append(stream, id, entry, options?)`** answers a `Placed`, the revision and position the entry was given. There is no append without an id:
  a writer that lost its answer sends the same entry again and gets the first answer. `options.expectedRevision` is the revision of the head the writer
  read, `0` for an empty stream. Left out, there is no check.
- **`read(stream, after, options?)`** is a stream of the entries with a revision above `after`, oldest first, once. `options.tags` keeps the entries whose
  `_tag` is one of them. It is a non-empty list, or it is left out: a read that asks for tags and names none is refused as `EmptyTags`.

A body and every slot of metadata are JSON (`Schema.Json`), so a body typed as a TypeScript `interface` does not compile, since an interface has no index
signature. A caller encodes its value with its own schema first, such as `Schema.toCodecJson`.

## Entry ids

An `EntryId` is 1 to 255 characters of letters, digits, `-`, `_`, `.` and `:`. Another package's own id is this type under its own name, with no mapping:
`export type ReplyId = EntryId`. An `EntryName` is a fixed word, 1 to 209 characters of letters, digits, `-` and `_`.

`child(name, parent)` builds one id from another, so one act can append several entries. It never fails. It gives `<name>:<parent>` when that is 255
characters or fewer, and `<name>.h:` and the parent's SHA-256 in base64url (43 characters, no padding) when it is not. A plain id's text before its first `:`
is its name and a hashed one's is `<name>.h`; no name holds `.`, so the two never meet.

## Errors

A refusal says the Ledger will not keep this entry, and a failure says it could not answer. Each is a `Schema.TaggedError`, so it crosses a wire as data.

- **Refusals**, as `Refusal`: `BadEntry` (says which part was bad, never its content), `IdReused`, `TooBig` (the bytes and the limit), `AdmissionRefused`,
  `RevisionConflict` (the revision expected and the head's now) and `EmptyTags`.
- **Failures**, as `Failure`: `Unreachable`, `BadRow` and `StorageFailed`. Each holds its cause as a `Redacted`, since a driver's own error can quote a row:
  make it with `Redacted.make(cause)`, read it on purpose with `Redacted.value(error.cause)`. A failure is never written as JSON with its cause: the JSON
  form refuses it, so a wire carries the tag and never the value.

No error carries a body or metadata. A package above wraps the unions as its own errors, `class ChatUnavailable { reason: Failure }` with
`override readonly cause = this.reason`, and `class ChatRefused { reason: Refusal }`, so it needs no list of its own. Only the Ledger says `Unreachable`.

## Settings

`Settings` is `{ limits: { bytes } }`, the most bytes one entry counts, and `defaults` holds 2,000,000, a Cloudflare object's row limit. The package imports no
settings engine, so the app that puts the Ledger together reads the value through its own settings and hands it to a provider's layer.
