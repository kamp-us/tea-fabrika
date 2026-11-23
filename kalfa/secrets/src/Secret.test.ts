// N1 for a declaration: `Secret.make` checks the name when the module that declares it loads, so a wrong name stops the app at once and no use
// ever meets it. They run in memory on every pull request.
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { declare, proofFor } from "./Fetch.test-support.ts";
import * as Name from "./Name.ts";
import {
  ACCEPTED_NAME_CLASSES,
  acceptedNames,
  nameTexture,
  REFUSED_NAME_CLASSES,
  refusedNames,
  SEED,
} from "./Secrets.test-support.ts";

// N1. Plant: check the name only at the first fetch (the refused classes make a secret); check nothing; take an uppercase letter; leave the name
// out of the message of the refusal; spell the object `secrets:<name>`; spell it `<name>` alone; give two secrets of one name two objects.
it.effect.prop(
  "N1 names of a declaration: Secret.make makes a secret of every accepted name class, whose name is the text and whose object is secret:<name>, and throws when called for a refused one, naming the name",
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

      for (const each of accepted) {
        const secret = declare(each.text);

        expect(secret.name, `${each.id}: the name is the text`).toBe(each.text);
        expect(secret.object, `${each.id}: the object`).toBe(`secret:${each.text}`);
        expect(secret.object, `${each.id}: the object is the proof's`).toBe(proofFor(each.text));
        expect(Name.object(each.text), `${each.id}: the object function agrees`).toBe(`secret:${each.text}`);
        expect(declare(each.text).object, `${each.id}: one name, one object`).toBe(secret.object);
      }

      for (const each of refused) {
        expect(() => declare(each.text), `${each.id}: no declaration`).toThrow(
          each.text === "" ? undefined : each.text.slice(0, 200),
        );
      }
    }),
  { arbitrary: { runs: 200, seed: SEED } },
);
