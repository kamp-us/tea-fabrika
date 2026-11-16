// Shelf: a service made up for the Recorder's own laws, and used nowhere else (ticket 1067's plan).
// The package imports no service of ours (0538), so its laws need one of their own. It has one of
// each member the Recorder meets: an Effect method that can fail (`put`), one that cannot (`count`),
// an Effect member (`size`), a Stream method (`watch`), and three it leaves alone: plain data
// (`label`), a Sink method (`drain`) and a symbol key. Its implementation is in Recorder.test.ts.
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Sink from "effect/Sink";
import type * as Stream from "effect/Stream";

/** The shelf has no room: what `put`, `size` and `watch` fail with. */
export class Full extends Schema.TaggedError<Full, { readonly brand: unique symbol }>()("Full", {
  item: Schema.String,
}) {}

/** The shelf's own symbol key, a member the Recorder passes through. */
export const ShelfId: unique symbol = Symbol.for("@kampus/vitest/Shelf");

export class Shelf extends Context.Service<
  Shelf,
  {
    readonly [ShelfId]: typeof ShelfId;
    /** Plain data. */
    readonly label: string;
    /** Puts `count` of `name` on the shelf, and answers twice the count; a count under zero is `Full`. */
    readonly put: (name: string, count: number) => Effect.Effect<number, Full>;
    /** How many of `name` there are, which is the length of the name. It cannot fail. */
    readonly count: (name: string) => Effect.Effect<number>;
    /** How many things fit on the shelf. */
    readonly size: Effect.Effect<number, Full>;
    /** The counts of `name` as they change: its length, then zero. An empty name is `Full`. */
    readonly watch: (name: string) => Stream.Stream<number, Full>;
    /** A Sink method, which the Recorder does not watch. */
    readonly drain: (name: string) => Sink.Sink<void, number>;
  }
>()("@kampus/vitest/Shelf") {}
