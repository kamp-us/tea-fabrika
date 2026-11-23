/**
 * The rule both followers share, the one that reads files and the one that reads snapshots: what one taken list does to a running process, setting by setting. A live value that differs is set, a restart value that differs is logged and waits for a restart, and the origins follow the live settings only.
 */
import { Effect, Equal, Option, Ref, Schema, SubscriptionRef } from "effect";
import * as Rec from "effect/Record";
import type { Origin } from "../Sources.ts";
import type { Settled } from "./read.ts";

/** What a running process publishes to: the reference of each live setting by name, and the origins as they are now. */
export interface Sinks {
  readonly lives: ReadonlyMap<string, SubscriptionRef.SubscriptionRef<unknown>>;
  readonly origins: Ref.Ref<Readonly<Record<string, Origin>>>;
  /** What each setting's origin was at the start: a restart setting keeps it. */
  readonly started: ReadonlyMap<string, Origin>;
  /** Every resolved list as taken: the one now, then each one a change takes. */
  readonly taken: SubscriptionRef.SubscriptionRef<ReadonlyArray<Settled>>;
}

/** What one taken list does to a running process, per setting whose value differs. A restart update holds no value. */
export const Update = Schema.TaggedUnion({
  live: { name: Schema.String, value: Schema.Unknown },
  restart: { name: Schema.String },
});

export type Update = typeof Update.Type;

/** The updates from `before` to `after`, in `after`'s order. `before` is found by name, never by place, and a setting it does not hold gives none. */
export const updates = (before: ReadonlyArray<Settled>, after: ReadonlyArray<Settled>): ReadonlyArray<Update> => {
  const held = new Map(before.map(({ setting, value }) => [setting.name, value]));

  return after.flatMap(({ setting, value }) =>
    held.has(setting.name) && !Equal.equals(held.get(setting.name), value)
      ? [
          setting.live
            ? Update.cases.live.make({ name: setting.name, value })
            : Update.cases.restart.make({ name: setting.name }),
        ]
      : [],
  );
};

/** The origins a running process reports after `after`: a live setting's follows its value, a restart setting keeps its start one. */
export const reported = (
  started: ReadonlyMap<string, Origin>,
  after: ReadonlyArray<Settled>,
): Readonly<Record<string, Origin>> =>
  Rec.fromEntries(
    after.map(({ setting, origin }) => [
      setting.name,
      Object.freeze(setting.live ? origin : (started.get(setting.name) ?? origin)),
    ]),
  );

/** Sets each live update, logs each restart one, and stores the reported origins. `file` opens the restart line: the file that changed, or none. */
export const apply = Effect.fnUntraced(function* (
  sinks: Sinks,
  app: string,
  before: ReadonlyArray<Settled>,
  after: ReadonlyArray<Settled>,
  file: string | undefined,
) {
  for (const update of updates(before, after)) {
    yield* Update.match(update, {
      // A live setting always has its reference: the start made one for each.
      live: ({ name, value }) =>
        Effect.flatMap(Effect.orDie(Effect.fromNullishOr(sinks.lives.get(name))), (ref) =>
          SubscriptionRef.set(ref, value),
        ),
      restart: ({ name }) =>
        Effect.logInfo(
          `${Option.match(Option.fromNullishOr(file), { onNone: () => "", onSome: (name) => `${name}: ` })}${name} changed. It applies when ${app} starts again.`,
        ),
    });
  }

  yield* Ref.set(sinks.origins, Object.freeze(reported(sinks.started, after)));
});
