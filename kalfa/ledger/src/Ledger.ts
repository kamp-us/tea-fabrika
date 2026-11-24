/**
 * The Ledger service: append an entry, and read a stream back.
 *
 * **Details**
 *
 * There is no append without an id: the writer makes it, so a writer that lost its answer sends the same entry again and gets the first answer. The memory
 * ledger and the laws every provider passes come in the next slice.
 */
import { type Array as Arr, Context, type Effect, type Stream } from "effect";
import type { Entry, NewEntry, Placed, Revision } from "./Entry.ts";
import type { EntryId } from "./EntryId.ts";
import type { Failure, Refusal } from "./Errors.ts";

/**
 * What an append may be told: the revision of the stream's head the writer read. The entry is kept only while the head is still there. Left out, there is no check.
 *
 * @category models
 */
export interface AppendOptions {
  readonly expectedRevision?: Revision;
}

/**
 * What a read may be told: the tags to keep. Left out, every entry; given, at least one.
 *
 * @category models
 */
export interface ReadOptions {
  readonly tags?: Arr.NonEmptyReadonlyArray<string>;
}

/**
 * The Ledger.
 *
 * @category services
 */
export class Ledger extends Context.Service<
  Ledger,
  {
    readonly append: (
      stream: string,
      id: EntryId,
      entry: NewEntry,
      options?: AppendOptions,
    ) => Effect.Effect<Placed, Refusal | Failure>;
    readonly read: (stream: string, after: Revision, options?: ReadOptions) => Stream.Stream<Entry, Failure>;
  }
>()("@kalfa/ledger/Ledger") {}
