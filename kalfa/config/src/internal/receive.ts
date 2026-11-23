/**
 * The start of a group in a process that cannot read files: the first snapshot starts it, and each later one updates its live settings by the rule the file follower uses. A snapshot that does not fit the group is refused: the first fails the start, a later one is logged and the last good values hold.
 */
import { Effect, Option, Ref, Sink, Stream, SubscriptionRef } from "effect";
import { apply, reported, type Sinks } from "./apply.ts";
import type { Group } from "./check.ts";
import { stop } from "./error.ts";
import type { Settled } from "./read.ts";
import { read } from "./snapshot.ts";
import { type Resolved, running } from "./start.ts";

/** One later item, in a root span of its own: read with the closing of a change, then applied, or refused with one warning and the last good values hold. */
const update = Effect.fnUntraced(function* (group: Group, sinks: Sinks, held: ReadonlyArray<Settled>, input: unknown) {
  const { app } = group;

  return yield* read(group, input, `${app} keeps the last good values.`).pipe(
    Effect.tap((after) =>
      apply(sinks, app, held, after, undefined).pipe(Effect.andThen(SubscriptionRef.set(sinks.taken, after))),
    ),
    Effect.tap(() => Effect.annotateCurrentSpan("kalfa.config.refused", false)),
    Effect.catchTag("SettingsError", (error) =>
      Effect.logWarning(error.message).pipe(
        Effect.andThen(
          Effect.annotateCurrentSpan({ "kalfa.config.refused": true, "kalfa.config.reason": error.reason }),
        ),
        Effect.as(held),
      ),
    ),
    Effect.withSpan("config.update", { root: true, attributes: { "kalfa.config.app": app } }),
  );
});

/** Starts a group on the first item of `snapshots`, and follows the rest in the layer's scope. The stream is run once. */
export const receive = Effect.fnUntraced(function* <RS>(group: Group, snapshots: Stream.Stream<unknown, never, RS>) {
  const { app } = group;
  const [first, rest] = yield* Stream.peel(snapshots, Sink.head());

  if (Option.isNone(first)) {
    return yield* stop(app, "snapshot", "no snapshot came before the stream ended.");
  }

  const taken: ReadonlyArray<Settled> = yield* read(group, first.value, `${app} did not start.`);
  const { values, lives } = yield* running(taken);
  const started = new Map(taken.map(({ setting, origin }) => [setting.name, Object.freeze(origin)]));

  const sinks: Sinks = {
    lives,
    started,
    origins: yield* Ref.make(Object.freeze(reported(started, taken))),
    taken: yield* SubscriptionRef.make(taken),
  };

  yield* rest.pipe(
    Stream.runFoldEffect(
      () => taken,
      (held, input) => update(group, sinks, held, input),
    ),
    Effect.andThen(Effect.logInfo(`the snapshot stream ended. A change applies when ${app} starts again.`)),
    Effect.forkScoped,
  );

  const resolved: Resolved = { values, origins: Ref.get(sinks.origins), taken: SubscriptionRef.changes(sinks.taken) };

  return resolved;
});
