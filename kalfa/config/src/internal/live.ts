import * as Effect from "effect/Effect";
import * as Effectable from "effect/Effectable";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

const TypeId = "~@kalfa/config/SettingGroup/Live";

/**
 * The value of a live setting, an Effect to yield for the value now.
 *
 * **Details**
 *
 * It is a different type from the plain value of a restart setting, so the two cannot be mixed up. `changes` is the value now and then each new value, only when it differs. Nothing a caller holds can set the value.
 *
 * @category models
 */
export interface Live<A> extends Effect.Effect<A> {
  readonly [TypeId]: typeof TypeId;
  /** The value now, then each new value, only when it differs. Each read of `changes` is a stream of its own, and nothing in it can set the value. */
  readonly changes: Stream.Stream<A>;
}

class Reading<A> extends Effectable.Class<A> implements Live<A> {
  readonly [TypeId] = TypeId;
  readonly #ref: SubscriptionRef.SubscriptionRef<A>;

  constructor(ref: SubscriptionRef.SubscriptionRef<A>) {
    super();
    this.#ref = ref;
  }

  // A new stream for each read, so a write to one reader's stream never reaches another's.
  get changes() {
    return SubscriptionRef.changes(this.#ref);
  }

  asEffect() {
    return SubscriptionRef.get(this.#ref);
  }
}

/** A live value that starts at `value`, and the reference that sets it. Only the layer holds the reference; the live value is frozen, so no caller swaps how it reads. */
export const reading = <A>(
  value: A,
): Effect.Effect<{ readonly live: Live<A>; readonly ref: SubscriptionRef.SubscriptionRef<A> }> =>
  Effect.map(SubscriptionRef.make(value), (ref) => ({ live: Object.freeze(new Reading(ref)), ref }));
