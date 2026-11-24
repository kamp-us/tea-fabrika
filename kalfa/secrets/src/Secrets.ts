/**
 * The `Secrets` service and the Layer that starts it: the one place a declared secret reaches a store.
 *
 * **Details**
 *
 * `layer` checks each declared secret against the app's routes and its stores when the app starts, so a wrong route stops the start and
 * never a fetch. Each use is checked against the declaration and the proof, asks its routed store, and is recorded before a value comes
 * back.
 */
import { Context, Effect, Layer, type Redacted } from "effect";
import type * as Errors from "./Errors.ts";
import { start } from "./internal/start.ts";
import { fetch } from "./internal/use.ts";
import type * as Name from "./Name.ts";
import * as Recorder from "./Recorder.ts";
import type * as Secret from "./Secret.ts";
import type * as SecretsSettings from "./Settings.ts";
import type * as Store from "./Store.ts";

/**
 * What the service does for a declared secret.
 *
 * @category models
 */
export interface Use {
  /** Fetches the value of a declared secret for a proof of the permission to fetch it. */
  readonly fetch: (
    secret: Secret.Any,
    proof: Name.Proof,
  ) => Effect.Effect<Redacted.Redacted<string>, Errors.SecretMissing | Errors.SecretsUnavailable>;
}

/**
 * The service a declared secret asks for its value. An app builds it once, with `layer`.
 *
 * @category services
 */
export class Secrets extends Context.Service<Secrets, Use>()("@kalfa/secrets/Secrets") {}

/**
 * Starts `Secrets` for the secrets an app declares, over its stores, with the routes its settings group gave.
 *
 * **Details**
 *
 * Fails with `RouteMissing` or `RouteRefused` on the first problem, in the order the secrets are declared. A list that names two
 * stores of one id, or two secrets of one name, dies: that is a fault in the code that lists them.
 *
 * @category layers
 */
export const layer = <const S extends ReadonlyArray<Store.Any>>(options: {
  readonly stores: S;
  readonly declared: ReadonlyArray<Secret.Any>;
  readonly settings: SecretsSettings.Values;
}): Layer.Layer<Secrets, Errors.RouteMissing | Errors.RouteRefused, Recorder.Recorder | Store.Needs<S[number]>> =>
  Layer.effect(
    Secrets,
    Effect.gen(function* () {
      const context = yield* Effect.context<Recorder.Recorder | Store.Needs<S[number]>>();
      const recorder = yield* Recorder.Recorder;
      const routed = yield* start({ ...options, routes: options.settings.routes });

      return Secrets.of({ fetch: fetch({ routed, recorder, context }) });
    }).pipe(Effect.withSpan("secrets.layer")),
  );
