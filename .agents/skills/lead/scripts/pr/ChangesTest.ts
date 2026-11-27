// ChangesTest.layer: the Changes service in memory. It names the paths each head changes, as told, or cannot read, as git can fail. It asks
// git nothing. `calls` keeps every read, in order, so a law reads that the gate asked once and for which head.
import { Effect, Layer } from "effect";
import { Changes, ChangesError } from "./Changes.ts";

/** One read the layer took, as the caller made it. */
export type Call = { readonly dir: string; readonly head: string };

export type World = {
  /** The paths each head changes, by the full sha: none when a head is not named. */
  readonly paths: Map<string, ReadonlyArray<string>>;
  readonly calls: Array<Call>;
};

export const world = (paths: Readonly<Record<string, ReadonlyArray<string>>> = {}): World => ({
  paths: new Map(Object.entries(paths)),
  calls: [],
});

/** Why git cannot be read, when it cannot. */
export type Failing = { readonly paths?: string };

export const layer = (w: World, failing: Failing = {}): Layer.Layer<Changes> =>
  Layer.succeed(
    Changes,
    Changes.of({
      paths: (dir, head) =>
        Effect.sync(() => {
          w.calls.push({ dir, head });
        }).pipe(
          Effect.andThen(
            failing.paths === undefined
              ? Effect.succeed(w.paths.get(head) ?? [])
              : Effect.fail(ChangesError.make({ reason: failing.paths })),
          ),
        ),
    }),
  );
