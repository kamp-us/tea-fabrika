// LockTest.layer: the Lock service in memory, a `Ref` of the names held now. A hold waits, giving
// way to the other fibers, while its name is in the set, then adds it; closing the scope takes it
// out. It touches no file and reads no pid, so a law can run many holders at once in one process.
// Today's lead tooling.
import { Effect, HashSet, Layer, Ref } from "effect";
import { Lock } from "./Lock.ts";

/** Takes `name` once it is free, giving way to the other fibers while it is held. */
const take = (held: Ref.Ref<HashSet.HashSet<string>>, name: string): Effect.Effect<void> =>
  Ref.modify(held, (names) => (HashSet.has(names, name) ? [false, names] : [true, HashSet.add(names, name)])).pipe(
    Effect.flatMap((taken) =>
      taken
        ? Effect.void
        : Effect.andThen(
            Effect.yieldNow,
            Effect.suspend(() => take(held, name)),
          ),
    ),
  );

/** `held` is the set of names held now; a law reads it to see that every hold was given back. */
export const layer = (held: Ref.Ref<HashSet.HashSet<string>>): Layer.Layer<Lock> =>
  Layer.succeed(
    Lock,
    Lock.of({
      hold: (name) => Effect.acquireRelease(take(held, name), () => Ref.update(held, HashSet.remove(name))),
    }),
  );
