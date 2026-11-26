// E2: the errors of the package in JSON. Transport's errors keep no cause, on purpose: a frame can hold the app's sign-in proof, and a
// cause could quote it. `Schema.Redacted` as Effect ships it writes its value through the JSON codec, so the rule is held by having no
// cause at all, and this law fails the day someone adds one.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Predicate, Schema } from "effect";
import * as Root from "./index.ts";
import { FormatError, NoSharedVersion } from "./index.ts";
import { between, helloDraw, SEED } from "./Transport.test-support.ts";

const lists = Arbitrary.array(between(-1000, 1000), { maxLength: 20 });

// E2. Plant: add `cause: Schema.Redacted(Schema.Defect())` to `NoSharedVersion` (a fourth key); add a `message` field.
it.effect.prop(
  "E2 the errors' JSON form: NoSharedVersion writes exactly _tag, client and gateway and reads back equal, FormatError writes exactly _tag and reason, and no error class the package exports has a cause among its fields",
  { client: lists, gateway: lists, draw: helloDraw },
  ({ client, gateway, draw }) =>
    Effect.sync(() => {
      const written = Schema.encodeUnknownSync(Schema.toCodecJson(NoSharedVersion));
      const read = Schema.decodeUnknownSync(Schema.toCodecJson(NoSharedVersion));

      // (x): lists that are empty, hold one number, and hold 1 to 20 numbers.
      for (const [each, others] of [
        [[], []],
        [[draw.ping], [draw.code]],
        [client, gateway],
        [draw.left, draw.right],
      ] as const) {
        const error = new NoSharedVersion({ client: each, gateway: others });
        const json = written(error);

        expect(Object.keys(Schema.is(Schema.Record(Schema.String, Schema.Unknown))(json) ? json : {}).sort()).toEqual([
          "_tag",
          "client",
          "gateway",
        ]);
        expect(Schema.toEquivalence(NoSharedVersion)(read(json), error), "it reads back equal").toBe(true);
      }

      for (const reason of ["text", "message", "method", "value"] as const) {
        const json = Schema.encodeUnknownSync(Schema.toCodecJson(FormatError))(new FormatError({ reason }));
        expect(Object.keys(Schema.is(Schema.Record(Schema.String, Schema.Unknown))(json) ? json : {}).sort()).toEqual([
          "_tag",
          "reason",
        ]);
      }

      const errors = Object.entries(Root).filter(
        ([, value]) => Predicate.isFunction(value) && value.prototype instanceof Error,
      );

      expect(errors.map(([name]) => name).sort(), "the error classes of the package").toEqual([
        "FormatError",
        "NoSharedVersion",
      ]);

      for (const [name, value] of errors) {
        const names =
          Predicate.hasProperty(value, "fields") && Predicate.isObject(value.fields) ? Object.keys(value.fields) : [];

        expect(names.length > 0, `${name}: its fields are read`).toBe(true);
        expect(names, `${name}: no cause among its fields`).not.toContain("cause");
      }
    }),
  { arbitrary: { seed: SEED, runs: 200 } },
);
