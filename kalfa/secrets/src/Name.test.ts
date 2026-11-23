// N1, the three names of the package: a secret name, a store id and a version. Each is a branded text a Schema checks, so a name a person writes in
// a route or a declaration is refused before anything reads a store. They run in memory on every pull request.
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import * as Name from "./Name.ts";
import {
  ACCEPTED_NAME_CLASSES,
  acceptedNames,
  acceptedStoreIds,
  acceptedVersions,
  nameTexture,
  REFUSED_NAME_CLASSES,
  refusedNames,
  refusedStoreIds,
  refusedVersions,
  SEED,
} from "./Secrets.test-support.ts";

const takes = <A, I>(schema: Schema.Codec<A, I>, text: string): boolean =>
  Option.isSome(Schema.decodeUnknownOption(schema)(text));

// N1. Plant: accept an uppercase letter (the refused class "uppercase" passes); cap names at 64 characters (the accepted class "256
// characters" is refused); take a doubled hyphen; take a trailing slash; drop the length check (257 passes); accept an empty store id or a
// slash in one; take a version of 129 characters or the empty text.
it.effect.prop(
  "N1 names: SecretName takes every accepted class and refuses every refused one, StoreId takes a word and refuses what is no word, and Version takes one to 128 characters",
  { texture: nameTexture },
  ({ texture }) =>
    Effect.sync(() => {
      const accepted = acceptedNames(texture);
      const refused = refusedNames(texture);

      expect(
        accepted.map((each) => each.id),
        "the generator reaches every accepted name class",
      ).toEqual(ACCEPTED_NAME_CLASSES);
      expect(
        refused.map((each) => each.id),
        "and every refused one",
      ).toEqual(REFUSED_NAME_CLASSES);
      expect(accepted.at(-1)?.text.length, "the longest accepted name is 256 characters").toBe(256);
      expect(refused.at(-1)?.text.length, "the shortest name that is too long is 257").toBe(257);

      for (const each of accepted) {
        expect(takes(Name.SecretName, each.text), `${each.id}: ${each.text.slice(0, 40)} is a name`).toBe(true);
        expect(Schema.decodeUnknownSync(Name.SecretName)(each.text), `${each.id}: the name is its text`).toBe(
          each.text,
        );
      }

      for (const each of refused) {
        expect(takes(Name.SecretName, each.text), `${each.id}: ${each.text.slice(0, 40)} is no name`).toBe(false);
      }

      for (const id of acceptedStoreIds(texture)) {
        expect(takes(Name.StoreId, id), `${id} is a store id`).toBe(true);
      }

      for (const each of refusedStoreIds(texture)) {
        expect(takes(Name.StoreId, each.text), `${each.id}: ${each.text} is no store id`).toBe(false);
      }

      for (const version of acceptedVersions(texture)) {
        expect(takes(Name.Version, version), `${version.slice(0, 20)} is a version`).toBe(true);
      }

      for (const each of refusedVersions) {
        expect(takes(Name.Version, each.text), `${each.id}: no version`).toBe(false);
      }
    }),
  { arbitrary: { runs: 200, seed: SEED } },
);
