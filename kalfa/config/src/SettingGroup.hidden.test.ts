// Ticket 1310, slice 2: C1 to C3 of the approved plan (here HC1 to HC3, since Cli.test.ts holds the ids C1 to C3) (.kalfa/quests/kalfa-hidden-cause-PLAN.md), folded into the first slice's pull request because
// the new lint rule `fabrika/hidden-cause` refuses the bare `Schema.Redacted` cause that `SettingsError` holds (internal/error.ts). The laws are the codec
// legs of Configuration's two hidden causes: `SettingsError`'s, which `stop` and `unread` fill with the failure underneath, and `SnapshotError`'s, which the
// older strict read fills with the decoder's issue. A cause may quote a value, so no codec may write it: not the JSON codec, the string-tree codec or the
// Go-style JSON codec, alone or inside an `Exit` that fails or dies with the error. Each codec writes the placeholder in its place, and a read gives back an
// empty hidden cause. The type laws are in SettingGroup.hidden.types.test.ts.
//
// SN5 and the disk laws already search these codecs, but the causes they reach are hidden twice over (`Redacted.make` of an already hidden error), which the
// bare `Schema.Redacted(Schema.Defect())` writes as the placeholder; so none of them can see the leak. These laws draw the cause as the code of a caller
// that has not hidden it twice makes it: a raw failure, as `stop` takes it, and `stop` hides it once.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, PlatformError, Redacted, Result, Schema } from "effect";
import { SettingGroup } from "./index.ts";
import { stop, unread } from "./internal/error.ts";
import { forms, HiddenDraw, OldSnapshotError, Reach } from "./SettingGroup.snapshot.test-support.ts";

/** The two fields of an error that the laws read: its message and its cause, whatever it holds. */
const Parts = Schema.Struct({ message: Schema.String, cause: Schema.optional(Schema.Unknown) });

const parts = Schema.decodeUnknownSync(Parts);

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

/** What every codec that writes outward writes for a hidden cause. It is written out here, so this file stays true if the schema's text changes. */
const PLACEHOLDER = "<redacted>";

/** The classes of failure a cause may be, each quoting the drawn secret as that class does. */
const CLASSES = ["error", "platform", "text", "record"] as const;

type Class = (typeof CLASSES)[number];

const quoting = (id: Class, secret: string): unknown => {
  switch (id) {
    case "error":
      return new Error(secret, { cause: new Error(secret) });
    case "platform":
      // A system error prints its path and its description.
      return PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "FileSystem",
        method: "readFile",
        pathOrDescriptor: secret,
        description: secret,
      });
    case "text":
      return secret;
    case "record":
      return { token: secret, [secret]: secret };
  }
};

/** Every text a codec gives for an error: the JSON codec, the string-tree codec and the Go-style JSON codec, each alone, and the JSON codec over an `Exit` that fails with it and an `Exit` that dies of it. An encode that throws gives its message, so a refused encode is read too. */
const written = <S extends Schema.Top>(schema: S, error: unknown): string => {
  const exit = Schema.toCodecJson(Schema.Exit(Schema.Void, schema, Schema.Defect()));

  const attempts: ReadonlyArray<() => unknown> = [
    () => Schema.encodeUnknownSync(Schema.toCodecJson(schema))(error),
    () => Schema.encodeUnknownSync(Schema.toCodecStringTree(schema))(error),
    () => Schema.encodeUnknownSync(Schema.toCodecGoJson(schema))(error),
    () => Schema.encodeUnknownSync(exit)(Exit.fail(error)),
    () => Schema.encodeUnknownSync(exit)(Exit.die(error)),
  ];

  return attempts
    .map((attempt) =>
      Result.match(Result.try(attempt), {
        onSuccess: (value) => JSON.stringify(value) ?? "",
        onFailure: (refused) =>
          refused instanceof Error ? `${refused.message}\n${refused.stack ?? ""}` : String(refused),
      }),
    )
    .join("\n");
};

/** The error a class and a drawn app make for each of the two causes: `SettingsError` through `stop`, and `SnapshotError` as the older read builds it. */
const makers = (app: string, id: Class, secret: string) => {
  const cause = quoting(id, secret);

  return [
    {
      name: "SettingsError",
      schema: SettingGroup.SettingsError,
      error: stop(app, "snapshot", "this is not a snapshot.", undefined, cause),
    },
    {
      name: "SettingsError from a failed read",
      schema: SettingGroup.SettingsError,
      error: PlatformError.isPlatformError(cause)
        ? unread(app, cause, { position: { file: "demo.toml" } })
        : stop(app, "read", "demo.toml could not be read.", { file: "demo.toml" }, cause),
    },
    {
      name: "SnapshotError",
      schema: OldSnapshotError,
      error: new OldSnapshotError({ message: "The saved settings are invalid.", cause: Redacted.make(cause) }),
    },
  ] as const;
};

// HC1, the codecs write the placeholder. Plant: put the bare `Schema.optional(Schema.Redacted(Schema.Defect()))` back on `SettingsError`'s `cause`
// (internal/error.ts): the JSON codec writes the failure in full, so its text holds the secret and its `cause` is no placeholder, red; the same on
// `SnapshotError` (Snapshot.ts): red; write the cause with `Redacted.value`: red; write an `Error` cause's message as the placeholder's text: red; keep
// `Schema.optional(Schema.Defect())` on `SnapshotError`: the read gives the text back, and its read-back law (HC2) is red.
it.effect.prop(
  "HC1 [secrets] hidden cause: every codec writes the placeholder for the cause of a SettingsError and of a SnapshotError, and no text of any codec, alone or inside an Exit, holds the secret the cause quotes",
  { input: HiddenDraw },
  ({ input: { draw, secret } }) =>
    Effect.sync(() => {
      const reach = new Reach<string>(CLASSES);

      for (const id of CLASSES) {
        // The control: the cause as a plain `Defect` shows the secret for each class, so the search below can find it.
        const plain = JSON.stringify(
          Schema.encodeUnknownSync(Schema.toCodecJson(Schema.Defect()))(quoting(id, secret)),
        );

        expect(
          forms(secret).some((form) => plain.includes(form)),
          `${id}: the control shows the secret`,
        ).toBe(true);

        for (const { name, schema, error } of makers(draw.app, id, secret)) {
          const named = `${name} over a ${id}`;
          const text = written(schema, error);

          for (const form of forms(secret)) {
            expect(text, `${named}: no codec writes ${form}`).not.toContain(form);
          }

          const wire = parts(Schema.encodeUnknownSync(Schema.toCodecJson(schema))(error));

          expect(wire.cause, `${named}: the JSON codec writes the placeholder`).toBe(PLACEHOLDER);
        }

        reach.mark(id);
      }

      reach.done();
    }),
  check,
);

// HC2, a read gives back an empty hidden cause. Plant: keep `Schema.optional(Schema.Defect())` on `SnapshotError`, or the bare `Schema.Redacted(Schema.Defect())`
// on either: the cause read back holds the text `<redacted>`, not nothing, red; read back `Redacted.make(placeholder)`: red.
it.effect.prop(
  "HC2 hidden cause: the JSON a SettingsError and a SnapshotError were written as reads back with their message and a hidden cause that holds nothing, and a SnapshotError with no cause writes none",
  { input: HiddenDraw },
  ({ input: { draw, secret } }) =>
    Effect.sync(() => {
      const reach = new Reach<string>(CLASSES);

      for (const id of CLASSES) {
        for (const { name, schema, error } of makers(draw.app, id, secret)) {
          const named = `${name} over a ${id}`;
          const wire = Schema.encodeUnknownSync(Schema.toCodecJson(schema))(error);

          const back = parts(Schema.decodeUnknownSync(Schema.toCodecJson(schema))(wire));

          expect(back.message, `${named}: the message`).toBe(error.message);
          expect(Redacted.isRedacted(back.cause), `${named}: the cause read back is hidden`).toBe(true);
          expect(
            Redacted.isRedacted(back.cause) ? Redacted.value(back.cause) : "not hidden",
            `${named}: it holds nothing`,
          ).toBeUndefined();
        }

        reach.mark(id);
      }

      // The case that carries none: the saved hash does not match. It writes no `cause` key, and reads back with none.
      const none = new OldSnapshotError({ message: "The saved settings hash does not match their values." });
      const wire = Schema.encodeUnknownSync(Schema.toCodecJson(OldSnapshotError))(none);
      const back = Schema.decodeUnknownSync(Schema.toCodecJson(OldSnapshotError))(wire);

      expect(Object.keys(wire).toSorted(), "no cause key is written").toEqual(["_tag", "message"]);
      expect(back.cause, "none is read back").toBeUndefined();

      reach.done();
    }),
  check,
);
