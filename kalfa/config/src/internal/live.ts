import * as Effect from "effect/Effect";
import * as Effectable from "effect/Effectable";
import * as SubscriptionRef from "effect/SubscriptionRef";

const TypeId = "~@kalfa/config/SettingGroup/Live";

/**
 * The value of a live setting, an Effect to yield for the value now.
 *
 * **Details**
 *
 * It is a different type from the plain value of a restart setting, so the two cannot be mixed up. Nothing a caller holds can set it.
 *
 * @category models
 */
export interface Live<A> extends Effect.Effect<A> {
  readonly [TypeId]: typeof TypeId;
}

class Reading<A> extends Effectable.Class<A> implements Live<A> {
  readonly [TypeId] = TypeId;
  readonly #ref: SubscriptionRef.SubscriptionRef<A>;

  constructor(ref: SubscriptionRef.SubscriptionRef<A>) {
    super();
    this.#ref = ref;
  }

  asEffect() {
    return SubscriptionRef.get(this.#ref);
  }
}

/** A live value that starts at `value`, over a reference only the layer holds. It is frozen, so no caller swaps how it reads. */
export const reading = <A>(value: A): Effect.Effect<Live<A>> =>
  Effect.map(SubscriptionRef.make(value), (ref) => Object.freeze(new Reading(ref)));
