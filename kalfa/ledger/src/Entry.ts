/**
 * What the Ledger keeps: a revision and a position, the entry a writer hands to append, the entry read back, and the answer to an append.
 *
 * **Details**
 *
 * A body and every slot of metadata are JSON, so the Ledger keeps them as text in any provider, SQLite included. An entry read back has exactly eight
 * keys and none of a sender's: who wrote it is a slot of its metadata.
 */
import { Schema } from "effect";
import { EntryId } from "./EntryId.ts";

/**
 * An entry's place in its own stream: a whole number from 0, and 0 is a stream with no entry.
 *
 * @category models
 */
export const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand("@kalfa/ledger/Revision"));

export type Revision = typeof Revision.Type;

/**
 * An entry's place in the whole log: a whole number from 0.
 *
 * @category models
 */
export const Position = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand("@kalfa/ledger/Position"));

export type Position = typeof Position.Type;

// The writer's own case name is open text, never a closed union's tag, so the key is a constant, not a `_tag` field of a tagged schema.
const TAG = "_tag";

/**
 * Named slots, one per package. The Ledger keeps them and never reads them.
 *
 * @category models
 */
export const Metadata = Schema.Record(Schema.String, Schema.Json);

export type Metadata = typeof Metadata.Type;

/**
 * An entry as its writer hands it to append, before the Ledger gives it a place. Its metadata is `{}` when left out.
 *
 * **Details**
 *
 * The body is JSON, so a body typed as a TypeScript `interface` does not compile (an interface has no index signature): a caller encodes its value with its
 * own schema first.
 *
 * @category models
 */
export const NewEntry = Schema.Struct({
  [TAG]: Schema.NonEmptyString,
  body: Schema.Json,
  metadata: Schema.optionalKey(Metadata),
});

export type NewEntry = typeof NewEntry.Type;

/**
 * An entry as read gives it back: exactly these eight keys. `arrivedAt` is the Ledger's own clock, in milliseconds since 1970.
 *
 * @category models
 */
export const Entry = Schema.Struct({
  id: EntryId,
  stream: Schema.NonEmptyString,
  revision: Revision,
  position: Position,
  arrivedAt: Schema.Int,
  [TAG]: Schema.NonEmptyString,
  body: Schema.Json,
  metadata: Metadata,
});

export type Entry = typeof Entry.Type;

/**
 * The answer to an append: the revision and the position the entry was given, or the first answer again when the same entry is sent twice.
 *
 * @category models
 */
export class Placed extends Schema.TaggedClass<Placed, { readonly brand: unique symbol }>()("Placed", {
  revision: Revision,
  position: Position,
}) {}
