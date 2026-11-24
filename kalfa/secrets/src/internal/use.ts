/**
 * What `Secrets` does with a declared secret: the checks that come before any store is asked, and the fetch.
 */
import { type Context, Effect } from "effect";
import * as Errors from "../Errors.ts";
import * as Name from "../Name.ts";
import * as Recorder from "../Recorder.ts";
import type * as Secret from "../Secret.ts";
import * as Store from "../Store.ts";
import type { Routed } from "./start.ts";

/** What a use reads: where each declared secret is held, the recorder, and what the stores' ports need. */
export interface World {
  readonly routed: ReadonlyMap<Secret.Any, Routed>;
  readonly recorder: Context.Service.Shape<typeof Recorder.Recorder>;
  readonly context: Context.Context<never>;
}

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

    // SAFETY: a store's ports need what `Store.Needs` names, and `Secrets.layer` took that from its own context, which `world` holds. A
    // store is any store, so its needs are `any`, which no provided context can take away in the types.
    const read = routed.holds.read(routed.item, name).pipe(Effect.provideContext(world.context)) as Effect.Effect<
      Store.Held,
      Errors.StoreFailed
    >;

    const held = yield* read.pipe(Effect.mapError(unavailable));

    if (held instanceof Store.Missing) {
      return yield* new Errors.SecretMissing({ secret: name, store, item: routed.text, reason: held.reason });
    }

    const { value, version } = held.value;

    yield* Effect.annotateCurrentSpan("kalfa.secrets.version", version);
    yield* world.recorder.record(new Recorder.Fetched({ name, store, version })).pipe(Effect.mapError(unavailable));

    return value;
  });
