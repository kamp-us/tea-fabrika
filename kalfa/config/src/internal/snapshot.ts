/**
 * The snapshot of a running group: every loaded value of one app, where each came from, and a hash of the values alone, as plain JSON an app can carry to a process that cannot read files. Made from a resolved list, and read back strictly.
 */
import { Effect, Equal, Option, Predicate, Redacted, Schema } from "effect";
import * as Digest from "effect/crypto/Digest";
import * as Rec from "effect/Record";
import type * as Setting from "../Declaration.ts";
import { Origin } from "../Sources.ts";
import type { Group } from "./check.ts";
import { stop } from "./error.ts";
import { frozen } from "./frozen.ts";
import { variable } from "./names.ts";
import { fileNames } from "./place.ts";
import type { Settled } from "./read.ts";
import { toml } from "./toml.ts";

/** Every loaded value of one app, its origin, and a hash of the values alone. Plain JSON, so an app can carry it. */
export const Snapshot = Schema.Struct({
  app: Schema.String,
  values: Schema.Record(Schema.String, Schema.Json),
  origins: Schema.Record(Schema.String, Origin),
  hash: Schema.String,
});

export type Snapshot = typeof Snapshot.Type;

const byKey = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]) => (a < b ? -1 : 1);

/** The SHA-256 of the values, keys sorted at every depth. Needs the `Digest` service. */
export const hash = Effect.fnUntraced(function* (values: Snapshot["values"]) {
  // The values are encoded JSON already, so a failure here is a bug, as in `make`'s own encode.
  const text = yield* Schema.encodeUnknownEffect(
    Schema.fromJsonString(Schema.Unknown, {
      replacer: (_key, value: Schema.Json) =>
        Predicate.isObject(value) ? Rec.fromEntries(Rec.toEntries(value).sort(byKey)) : value,
    }),
  )(Rec.toEntries(values).sort(byKey)).pipe(Effect.orDie);

  const digest = yield* Digest.Digest;

  return yield* digest.digestHex(Digest.sha256, new TextEncoder().encode(text));
});

/** The codec a setting's value crosses the snapshot by. */
const codec = (setting: Setting.Any) => Schema.toCodecJson(setting.schema);

/** The snapshot of one resolved list: the group's settings, the window included, in the group's order. */
export const make = Effect.fnUntraced(function* (app: string, taken: ReadonlyArray<Settled>) {
  const values = Rec.fromEntries(
    yield* Effect.forEach(
      taken,
      ({ setting, value }) =>
        Effect.map(
          Effect.orDie(Schema.encodeUnknownEffect(codec(setting))(value)),
          (encoded) => [setting.name, encoded] as const,
        ),
      { concurrency: 1 },
    ),
  );

  return {
    app,
    values,
    origins: Rec.fromEntries(taken.map(({ setting, origin }) => [setting.name, origin])),
    hash: yield* hash(values),
  } satisfies Snapshot;
});

/** Whether two snapshots say the same thing: one hash and equal origins. */
export const same = (a: Snapshot, b: Snapshot): boolean => a.hash === b.hash && Equal.equals(a.origins, b.origins);

/** Whether a start of `app` could give `setting` this origin. */
export const fits = (app: string, setting: Setting.Any, origin: Origin): boolean =>
  Origin.match(origin, {
    default: () => Option.isSome(setting.default),
    flag: ({ name }) => !setting.fileOnly && name === `--${setting.name}`,
    env: ({ name }) => !setting.fileOnly && name === variable(app, setting.name),
    file: ({ file }) => setting.files.some((at) => fileNames(app, toml)[at].includes(file)),
  });

/** Reads a snapshot strictly and stops at the first fault, with one `SettingsError` of reason `snapshot`. No message holds a value or a key of the input: a decoder's issue can repeat it, so it goes in `cause` as `Redacted`. */
export const read = Effect.fnUntraced(function* (group: Group, input: unknown, closing: string) {
  const { app, settings } = group;
  const strict = { onExcessProperty: "error" } as const;
  const refuse = (text: string, cause?: unknown) => stop(app, "snapshot", text, undefined, cause, closing);

  const found = yield* Schema.decodeUnknownEffect(Snapshot)(input, strict).pipe(
    Effect.mapError((error) => refuse("this is not a snapshot.", Redacted.make(error))),
  );

  if (found.app !== app) {
    return yield* refuse("the snapshot is another app's.");
  }

  const names = settings.map((setting) => setting.name);

  const holds = (record: object) =>
    Object.keys(record).length === names.length && names.every((name) => Object.hasOwn(record, name));

  if (!holds(found.values) || !holds(found.origins)) {
    return yield* refuse(`the snapshot does not hold ${app}'s settings.`);
  }

  for (const setting of settings) {
    if (!fits(app, setting, Option.getOrThrow(Rec.get(found.origins, setting.name)))) {
      return yield* refuse(`${setting.name}: the snapshot gives it an origin ${app} cannot give.`);
    }
  }

  const settled = yield* Effect.forEach(
    settings,
    (setting) =>
      Effect.gen(function* () {
        const origin = Option.getOrThrow(Rec.get(found.origins, setting.name));
        const given = Option.getOrThrow(Rec.get(found.values, setting.name));

        const decoded = yield* Schema.decodeUnknownEffect(codec(setting))(given, strict).pipe(
          Effect.mapError((error) =>
            refuse(`${setting.name}: the snapshot's value is refused by its schema.`, Redacted.make(error)),
          ),
        );

        const value = frozen(decoded);

        // Only a schema cast to lie about its type decodes anything but plain data: the program's author made that.
        if (Option.isNone(value)) {
          return yield* Effect.die(
            new Error(`Settings cannot be declared: ${setting.name}'s schema gives a value that is not plain data.`),
          );
        }

        return { setting, value: value.value, origin } satisfies Settled;
      }),
    { concurrency: 1 },
  );

  // The values as their schemas encode them again, so a hash made over another spelling does not pass.
  const encoded = Rec.fromEntries(
    yield* Effect.forEach(
      settled,
      ({ setting, value }) =>
        Effect.map(
          Schema.encodeUnknownEffect(codec(setting))(value).pipe(
            Effect.mapError((error) =>
              refuse(`${setting.name}: the snapshot's value is refused by its schema.`, Redacted.make(error)),
            ),
          ),
          (text) => [setting.name, text] as const,
        ),
      { concurrency: 1 },
    ),
  );

  if ((yield* hash(encoded)) !== found.hash) {
    return yield* refuse("the snapshot's hash does not match its values.");
  }

  return settled;
});
