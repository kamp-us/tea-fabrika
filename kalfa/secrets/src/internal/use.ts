/**
 * What `Secrets` does with a declared secret: the checks that come before any store is asked, and the fetch.
 */
import { type Context, Effect, Redacted } from "effect";
import * as Errors from "../Errors.ts";
import * as Name from "../Name.ts";
import * as Recorder from "../Recorder.ts";
import type * as Secret from "../Secret.ts";
import * as Store from "../Store.ts";
import type { Routed } from "./start.ts";

/** What a use reads: where each declared secret is held, the recorder, and what the stores' ports need. */
interface World {
  readonly routed: ReadonlyMap<Secret.Any, Routed>;
  readonly recorder: Context.Service.Shape<typeof Recorder.Recorder>;
  readonly context: Context.Context<any>;
}

/** Reads an item of a store with what the store's port needs, which the layer took from its own context. A port that throws when called is a defect of the read. */
const read = <Item, R>(
  holds: Store.Holds<Item, R>,
  item: Item,
  name: typeof Name.SecretName.Type,
  context: Context.Context<R>,
): Effect.Effect<Store.Held, Errors.StoreFailed> =>
  Effect.suspend(() => holds.read(item, name)).pipe(Effect.provideContext(context));

/**
 * Fetches a declared secret for a proof. A secret that was not declared, and a proof made for another object, are faults in the
 * code, so they die before any store is asked. The use is recorded before the value comes back.
 */
export const fetch = (world: World) =>
  Effect.fn("secrets.fetch")(function* (secret: Secret.Any, proof: Name.Proof) {
    const routed = world.routed.get(secret);

    if (routed === undefined) {
      return yield* Effect.die(`${secret.name} is not declared`);
    }

    if (proof.object !== secret.object) {
      return yield* Effect.die(`the proof is for ${proof.object}, not for ${secret.object}`);
    }

    const name = Name.SecretName.make(secret.name);
    const store = routed.store;

    const unavailable = (reason: Errors.StoreFailed | Errors.RecordFailed) =>
      new Errors.SecretsUnavailable({ secret: name, store, reason });

    yield* Effect.annotateCurrentSpan({ "kalfa.secrets.name": name, "kalfa.secrets.store": store });

    const held = yield* read(routed.holds, routed.item, name, world.context).pipe(
      Effect.mapError(unavailable),
      Effect.catchDefect((defect) => Effect.die(new Errors.StoreFailed({ cause: Redacted.make(defect) }))),
    );

    if (held instanceof Store.Missing) {
      return yield* new Errors.SecretMissing({ secret: name, store, item: routed.text, reason: held.reason });
    }

    const { value, version } = held.value;

    yield* Effect.annotateCurrentSpan("kalfa.secrets.version", version);
    yield* world.recorder.record(new Recorder.Fetched({ name, store, version })).pipe(Effect.mapError(unavailable));

    return value;
  });
