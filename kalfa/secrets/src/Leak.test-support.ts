// The flow every leak law watches: a person puts a value in the memory store, the store is read, and the read is recorded as a fact.
import { Effect, Layer, Predicate, Schema } from "effect";
import * as MemoryStore from "./MemoryStore.ts";
import * as Name from "./Name.ts";
import * as Recorder from "./Recorder.ts";
import { holder } from "./Secrets.test-support.ts";

/** The route's name, the store's id and its first item: the words a fact holds. */
export const NAME = Schema.decodeUnknownSync(Name.SecretName)("transport/turn-key");

export const STORE_ID = Schema.decodeUnknownSync(Name.StoreId)("memory");

/** What a person's put and a read of it leave behind: the answer, the service that holds the value, and the facts the read was recorded as. */
export const flow = Effect.fn("secrets.flow")(
  function* (item: string, text: string) {
    const contents = yield* MemoryStore.Contents;
    const recorder = yield* Recorder.Recorder;
    const recorded = yield* MemoryStore.Recorded;

    yield* contents.put(item, text);

    const held = yield* holder(MemoryStore.store).read(item, NAME);

    if (Predicate.isTagged(held, "Found")) {
      yield* recorder.record(new Recorder.Fetched({ name: NAME, store: STORE_ID, version: held.value.version }));
    }

    return { contents, held, facts: yield* recorded.facts };
  },
  Effect.provide(Layer.merge(MemoryStore.layer(), MemoryStore.recorder)),
);
