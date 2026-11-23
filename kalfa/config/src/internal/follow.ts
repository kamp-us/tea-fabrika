/**
 * A running group's follower: it takes each change to a configuration file, in one fiber, as the start takes the files, and publishes what moved. A change that is refused is logged, and the last good values hold.
 */
import { Deferred, Effect, Equal, type Duration, Ref, Stream, SubscriptionRef } from "effect";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import type * as Setting from "../Declaration.ts";
import type { Origin } from "../Sources.ts";
import { type Held, readRepo, readUser, type Setup, settle } from "./read.ts";
import { ticks } from "./watch.ts";

/** What the follower publishes to: the reference of each live setting by name, and the origins as they are now. */
interface Sinks {
  readonly lives: ReadonlyMap<string, SubscriptionRef.SubscriptionRef<unknown>>;
  readonly origins: Ref.Ref<Readonly<Record<string, Origin>>>;
  /** What each setting's origin was at the start: a restart setting keeps it. */
  readonly started: ReadonlyMap<string, Origin>;
}

/** Publishes what one taken change moved: each live value that differs, and one line for each restart value that differs. The origins follow the live settings. */
const publish = Effect.fnUntraced(function* (setup: Setup, sinks: Sinks, held: Held, next: Held, file: Setting.File) {
  for (const [before, after] of Arr.zip(held.settled, next.settled)) {
    const { name } = after.setting;
    const ref = sinks.lives.get(name);

    if (Equal.equals(before.value, after.value)) {
      continue;
    }

    if (ref === undefined) {
      yield* Effect.logInfo(`${setup.names[file]}: ${name} changed. It applies when ${setup.group.app} starts again.`);
    } else {
      yield* SubscriptionRef.set(ref, after.value);
    }
  }

  yield* Ref.set(
    sinks.origins,
    Object.freeze(
      Rec.fromEntries(
        next.settled.map(({ setting, origin }) => [
          setting.name,
          Object.freeze(sinks.lives.has(setting.name) ? origin : (sinks.started.get(setting.name) ?? origin)),
        ]),
      ),
    ),
  );
});

/** Takes one file's new text: read again, checked whole as the start does it, every setting resolved again, and what moved published. Fails with the first fault, and then nothing is published. */
const take = Effect.fnUntraced(function* (setup: Setup, sinks: Sinks, held: Held, file: Setting.File) {
  const taking: Setup = { ...setup, closing: `${setup.group.app} keeps the last good values.` };
  const repo = file === "repo" ? yield* readRepo(taking) : held.repo;
  const user = file === "user" ? yield* readUser(taking) : held.user;
  const next: Held = { repo, user, settled: yield* settle(taking, repo, user) };

  yield* publish(setup, sinks, held, next, file);

  return next;
});

/** One file's change, in a root span of its own: taken, or refused with a warning that names the file and the line, and then the last good values hold. */
const update = Effect.fnUntraced(function* (setup: Setup, sinks: Sinks, held: Held, file: Setting.File) {
  return yield* take(setup, sinks, held, file).pipe(
    Effect.tap(() => Effect.annotateCurrentSpan("kalfa.config.refused", false)),
    Effect.catchTag("SettingsError", (error) =>
      Effect.logWarning(error.message).pipe(
        Effect.annotateLogs({
          "kalfa.config.file": setup.names[file],
          ...(error.line === undefined ? {} : { "kalfa.config.line": error.line }),
        }),
        Effect.andThen(
          Effect.annotateCurrentSpan({ "kalfa.config.refused": true, "kalfa.config.reason": error.reason }),
        ),
        Effect.as(held),
      ),
    ),
    Effect.withSpan("config.update", {
      root: true,
      attributes: { "kalfa.config.app": setup.group.app, "kalfa.config.file": file },
    }),
  );
});

/** Follows a group's files for as long as the layer lives: a change to one, after its window, is taken in one fiber, so no two overlap. The start waits until every watch is installed, or given up. */
export const follow = Effect.fnUntraced(function* (setup: Setup, sinks: Sinks, held: Held, window: Duration.Duration) {
  const { repo, user } = setup.places;

  const watches = yield* Effect.forEach(
    [
      { file: "repo" as const, place: repo },
      ...(user.path === undefined ? [] : [{ file: "user" as const, place: { path: user.path, name: user.name } }]),
    ],
    ({ file, place }) =>
      Effect.map(Deferred.make<void>(), (ready) => ({
        ready,
        ticks: Stream.map(ticks(setup.group.app, place, window, ready), () => file),
      })),
    { concurrency: "unbounded" },
  );

  yield* Stream.mergeAll(
    watches.map((watch) => watch.ticks),
    { concurrency: "unbounded" },
  ).pipe(
    Stream.runFoldEffect(
      () => held,
      (taken, file) => update(setup, sinks, taken, file),
    ),
    Effect.forkScoped,
  );

  yield* Effect.forEach(watches, (watch) => Deferred.await(watch.ready), { concurrency: "unbounded", discard: true });
});
