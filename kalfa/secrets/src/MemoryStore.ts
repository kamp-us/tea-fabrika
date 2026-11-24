/**
 * The memory store, the `@kalfa/secrets/memory` entry point: a store that keeps what a person puts in it in the process, and a
 * recorder that keeps every fact.
 *
 * **Details**
 *
 * It imports no other kalfa package. It is the store `memory`, in the place `memory`, and it counts versions for each item from 1:
 * each put makes the next one. The empty text is nothing, so a put of it leaves the item without a value. A value is handed out as a
 * `Redacted` labeled with the name asked for, and kept behind a function, so nothing the store, its contents or its facts show holds one.
 */
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import * as Name from "./Name.ts";
import * as Recorder from "./Recorder.ts";
import * as Store from "./Store.ts";

/**
 * Where a person puts a value, and takes one out, in the memory store.
 *
 * @category services
 */
export class Contents extends Context.Service<
  Contents,
  {
    readonly put: (item: string, value: string) => Effect.Effect<void>;
    readonly remove: (item: string) => Effect.Effect<void>;
    readonly read: (item: string, name: typeof Name.SecretName.Type) => Effect.Effect<Store.Held>;
  }
>()("@kalfa/secrets/memory/Contents") {}

/** One item: how many puts it has had, and how to hand out the value the last one left, if any, hidden and labeled for a name. */
interface Shelf {
  readonly puts: number;
  readonly value: ((name: typeof Name.SecretName.Type) => Redacted.Redacted<string>) | undefined;
}

const contents = (seed: Readonly<Record<string, string>>): Context.Context<Contents> => {
  const shelves = new Map<string, Shelf>();

  const put = (item: string, text: string) => {
    shelves.set(item, {
      puts: (shelves.get(item)?.puts ?? 0) + 1,
      value: text === "" ? undefined : (label) => Redacted.make(text, { label }),
    });
  };

  for (const [item, text] of Object.entries(seed)) {
    put(item, text);
  }

  return Context.make(Contents, {
    put: (item, text) => Effect.sync(() => put(item, text)),
    remove: (item) =>
      Effect.sync(() => {
        const shelf = shelves.get(item);

        if (shelf !== undefined) {
          shelves.set(item, { puts: shelf.puts, value: undefined });
        }
      }),
    read: (item, name) =>
      Effect.sync(() => {
        const shelf = shelves.get(item);

        return shelf?.value === undefined
          ? new Store.Missing({ reason: "absent" })
          : new Store.Found({ value: { value: shelf.value(name), version: Name.Version.make(String(shelf.puts)) } });
      }),
  });
};

/**
 * A new, empty memory store's contents, or one seeded with what a person had already put (each as version 1). Each build starts
 * on its own.
 *
 * @category layers
 */
export const layer = (seed?: { readonly values?: Readonly<Record<string, string>> }): Layer.Layer<Contents> =>
  Layer.effectContext(Effect.sync(() => contents(seed?.values ?? {})));

/**
 * The memory store: the store `memory`, in the place `memory`, whose items are any text but the empty one.
 *
 * @category stores
 */
export const store = Store.make({
  id: "memory",
  item: Schema.NonEmptyString,
  place: "memory",
  holds: { read: (item: string, name) => Contents.use((held) => held.read(item, name)) },
});

/**
 * The facts the memory recorder was given, in order.
 *
 * @category services
 */
export class Recorded extends Context.Service<
  Recorded,
  { readonly facts: Effect.Effect<ReadonlyArray<Recorder.Fact>> }
>()("@kalfa/secrets/memory/Recorded") {}

/**
 * A recorder that keeps every fact it is given, in order, a repeated one too, and `Recorded` to read them. Each build starts empty.
 *
 * @category layers
 */
export const recorder: Layer.Layer<Recorder.Recorder | Recorded> = Layer.effectContext(
  Effect.sync(() => {
    const facts: Array<Recorder.Fact> = [];

    return Context.make(Recorder.Recorder, {
      record: (fact) => Effect.sync(() => void facts.push(fact)),
    }).pipe(Context.add(Recorded, { facts: Effect.sync(() => [...facts]) }));
  }),
);
