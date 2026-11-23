/**
 * The start of a setting group, in the order the protocol fixes: the repo configuration is read, its minimum version is checked, both files are checked whole, and only then is each value resolved by precedence with its origin kept. A group with a live setting then goes on following its files, in the layer's scope.
 */
import { ConfigProvider, Effect, Option, Ref, Schema, type Stream, SubscriptionRef } from "effect";
import * as Arr from "effect/Array";
import type { Origin } from "../Sources.ts";
import type { Group } from "./check.ts";
import { follow } from "./follow.ts";
import type { Format } from "./format.ts";
import { reading } from "./live.ts";
import { field } from "./names.ts";
import { repoPlace, userPlace } from "./place.ts";
import { type Held, readRepo, readUser, type Settled, type Setup, settle } from "./read.ts";
import { debounce } from "./window.ts";

/** What a start leaves: each value under its field, and the origins as they are now, each under its setting name. */
export interface Resolved {
  readonly values: Readonly<Record<string, unknown>>;
  readonly origins: Effect.Effect<Readonly<Record<string, Origin>>>;
  /** Every resolved list as taken: the one now, then one each time a change is taken. */
  readonly taken: Stream.Stream<ReadonlyArray<Settled>>;
}

/**
 * Starts a group: reads and checks both files, then resolves every setting, and fails with the first fault. A group with a live setting goes on watching its files, in the layer's scope.
 */
export const start = Effect.fnUntraced(function* (
  group: Group,
  format: Format,
  options: {
    readonly version: string;
    readonly repo?: string;
    readonly flags?: Readonly<Record<string, Option.Option<string> | undefined>>;
  },
) {
  const { app } = group;
  const provider = yield* ConfigProvider.ConfigProvider;
  const user = yield* userPlace(app, format, provider);
  const repo = yield* repoPlace(app, format, options.repo ?? ".");

  const setup: Setup = {
    group,
    format,
    provider,
    flags: options.flags ?? {},
    places: { repo, user },
    names: { repo: repo.name, user: user.name },
    version: options.version,
    closing: `${app} did not start.`,
  };

  const taken = { repo: yield* readRepo(setup), user: yield* readUser(setup) };
  const held: Held = { ...taken, settled: yield* settle(setup, taken.repo, taken.user) };

  const values: Record<string, unknown> = {};
  const lives = new Map<string, SubscriptionRef.SubscriptionRef<unknown>>();

  for (const { setting, value } of held.settled) {
    // The quiet window is the package's own setting, so the program's values hold only what the program declared.
    if (setting === debounce) {
      continue;
    }

    if (setting.live) {
      const made = yield* reading(value);
      values[field(setting.name)] = made.live;
      lives.set(setting.name, made.ref);
    } else {
      values[field(setting.name)] = value;
    }
  }

  const started = new Map(held.settled.map(({ setting, origin }) => [setting.name, Object.freeze(origin)]));
  const origins = yield* Ref.make(Object.freeze(Object.fromEntries(started)));
  const taking = yield* SubscriptionRef.make(held.settled);
  const window = Arr.findFirst(held.settled, ({ setting }) => setting === debounce);

  if (Option.isSome(window)) {
    // The window was checked when the file was read, so it decodes.
    const length = yield* Schema.decodeUnknownEffect(Schema.DurationFromString)(window.value.value).pipe(Effect.orDie);

    yield* follow(setup, { lives, origins, started, taken: taking }, held, length);
  }

  const resolved: Resolved = {
    values: Object.freeze(values),
    origins: Ref.get(origins),
    taken: SubscriptionRef.changes(taking),
  };

  return resolved;
});
