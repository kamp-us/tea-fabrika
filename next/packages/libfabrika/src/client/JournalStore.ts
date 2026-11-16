/**
 * The hands client's journal on Effect's own `KeyValueStore`, one key per task id. Memory, a file and
 * a browser's `localStorage` are each one existing store layer, so a browser tab can keep it too.
 *
 * @stability unstable
 */
import { Effect, Layer, Option, Schema } from "effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { Entry, Journal, JournalError } from "./Journal.ts";

/** A store failure as the journal's own: a value that does not decode is a bad entry. */
const translated = (cause: KeyValueStore.KeyValueStoreError | Schema.SchemaError) =>
  new JournalError({ reason: Schema.isSchemaError(cause) ? "bad_entry" : "storage", cause });

/**
 * Layer that supplies `Journal` from the `KeyValueStore` in context.
 *
 * **Details**
 *
 * Each entry is its schema's JSON under the task's id. A store error becomes `storage` and a value
 * that is no entry becomes `bad_entry`, each keeping its cause.
 *
 * @stability unstable
 * @category layers
 */
export const layer = Layer.effect(
  Journal,
  Effect.gen(function* () {
    const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Entry);

    return {
      read: (task: string) => store.get(task).pipe(Effect.map(Option.getOrNull), Effect.mapError(translated)),
      write: (task: string, entry: Entry) => store.set(task, entry).pipe(Effect.mapError(translated)),
    };
  }),
);
