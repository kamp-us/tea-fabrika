// I1 and I2, the ids: what an entry id and an entry name are, and the one id `child` builds from a name and a parent. They run in memory on every
// pull request.
import { createHash } from "node:crypto";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import * as EntryId from "./EntryId.ts";
import {
  ACCEPTED_ID_CLASSES,
  ACCEPTED_NAME_CLASSES,
  acceptedIds,
  acceptedNames,
  childTexture,
  idTexture,
  isIdText,
  isNameText,
  NAME_LIMIT,
  PAIR_CLASSES,
  pairs,
  refusedIds,
  refusedNames,
  SEED,
} from "./Ledger.test-support.ts";

const takes = <A, I>(schema: Schema.Codec<A, I>, candidate: string): boolean =>
  Option.isSome(Schema.decodeUnknownOption(schema)(candidate));

// I1. Plant: allow `/` in `EntryId` (the refused class "a slash" passes); let `EntryId` take 256 characters; allow `.` in `EntryName` (the refused class
// "a dot" passes); let `EntryName` take 210 characters; drop the end anchor of either pattern (a bad character at the end passes); allow the empty text.
it.effect.prop(
  "I1 ids: an EntryId is 1 to 255 of A-Z a-z 0-9 - _ . : and an EntryName is 1 to 209 of A-Z a-z 0-9 - _, whatever text is drawn",
  { texture: idTexture },
  ({ texture }) =>
    Effect.sync(() => {
      const acceptedId = acceptedIds(texture);
      const acceptedName = acceptedNames(texture);

      expect(
        acceptedId.map((each) => each.id),
        "the generator reaches every accepted id class",
      ).toEqual(ACCEPTED_ID_CLASSES);
      expect(
        acceptedName.map((each) => each.id),
        "and every accepted name class",
      ).toEqual(ACCEPTED_NAME_CLASSES);
      expect(acceptedId.at(1)?.text.length, "the longest accepted id is 255 characters").toBe(255);
      expect(acceptedName.at(1)?.text.length, "the longest accepted name is 209 characters").toBe(NAME_LIMIT);

      for (const each of acceptedId) {
        expect(takes(EntryId.EntryId, each.text), `${each.id}: ${each.text.slice(0, 40)} is an id`).toBe(true);
        expect(Schema.decodeUnknownSync(EntryId.EntryId)(each.text), `${each.id}: the id is its text`).toBe(each.text);
      }

      for (const each of refusedIds(texture)) {
        expect(
          takes(EntryId.EntryId, each.text),
          `${each.id}: ${JSON.stringify(each.text.slice(0, 40))} is no id`,
        ).toBe(false);
      }

      for (const each of acceptedName) {
        expect(takes(EntryId.EntryName, each.text), `${each.id}: ${each.text.slice(0, 40)} is a name`).toBe(true);
        expect(Schema.decodeUnknownSync(EntryId.EntryName)(each.text), `${each.id}: the name is its text`).toBe(
          each.text,
        );
      }

      for (const each of refusedNames(texture)) {
        expect(
          takes(EntryId.EntryName, each.text),
          `${each.id}: ${JSON.stringify(each.text.slice(0, 40))} is no name`,
        ).toBe(false);
      }

      // Any text at all: the Schema takes it exactly when the rule does. The rule looks at each character, so no pattern of the Schema's can share a slip with it.
      for (const candidate of [texture.mixed, texture.id.slice(0, texture.length), `${texture.id}${texture.mixed}`]) {
        expect(takes(EntryId.EntryId, candidate), `an id, or not: ${JSON.stringify(candidate.slice(0, 40))}`).toBe(
          isIdText(candidate),
        );
        expect(takes(EntryId.EntryName, candidate), `a name, or not: ${JSON.stringify(candidate.slice(0, 40))}`).toBe(
          isNameText(candidate),
        );
      }
    }),
  { arbitrary: { runs: 300, seed: SEED } },
);

/** A text's SHA-256, in base64url with no padding: what a hashed id holds, written by Node's own crypto. */
const digest = (parent: string): string => createHash("sha256").update(parent, "utf8").digest("base64url");

/** The text before an id's first colon. */
const kind = (id: string): string => id.slice(0, id.indexOf(":"));

// I2. Plant: hash when the plain form is exactly 255 (joined 255 is hashed); write the hash in base64 with `=` padding (44 characters); leave the name out of
// the hashed form (two names give one id); take the kind at the last colon (a parent with a colon); hash the name and the parent together; keep only the
// first 200 characters of the parent before hashing (two parents that differ in the last character give one id); write the hash in hex; build the
// plain form as `<parent>:<name>`.
it.effect.prop(
  "I2 child: a name and a parent give a valid EntryId, `<name>:<parent>` when that is 255 characters or fewer and `<name>.h:<hash>` when it is not, and two different pairs never give one id",
  { texture: childTexture },
  ({ texture }) =>
    Effect.sync(() => {
      const drawn = pairs(texture);

      expect(
        drawn.map((each) => each.id),
        "the generator reaches every pair class",
      ).toEqual(PAIR_CLASSES);

      const seen = new Map<string, string>();
      const plainKinds = new Set<string>();
      const hashedKinds = new Set<string>();

      for (const { id, name, parent } of drawn) {
        const made = EntryId.child(name, parent);
        const joined = `${name}:${parent}`;
        const label = `${id} (${name.length} + ${parent.length})`;

        expect(Schema.is(EntryId.EntryId)(made), `${label}: a valid id`).toBe(true);
        expect(made.length <= 255, `${label}: at most 255 characters`).toBe(true);
        expect(EntryId.child(name, parent), `${label}: the same pair, the same id`).toBe(made);

        if (joined.length <= 255) {
          expect(made, `${label}: plain when it fits`).toBe(joined);
          expect(kind(made), `${label}: a plain id's kind is the name`).toBe(name);
          expect(made.slice(name.length + 1), `${label}: and the rest is the parent, colons and all`).toBe(parent);
          plainKinds.add(kind(made));
        } else {
          expect(made, `${label}: hashed when it does not fit`).toBe(`${name}.h:${digest(parent)}`);
          expect(made.length - name.length, `${label}: the hash is 43 characters`).toBe(".h:".length + 43);
          expect(kind(made), `${label}: a hashed id's kind is the name and .h`).toBe(`${name}.h`);
          hashedKinds.add(kind(made));
        }

        const key = `${name}\u0000${parent}`;
        const earlier = [...seen].find(([otherKey, otherId]) => otherId === made && otherKey !== key);

        expect(earlier?.[0], `${label}: no other pair gives ${made.slice(0, 40)}`).toBeUndefined();
        seen.set(key, made);
      }

      expect(
        [...plainKinds].filter((each) => each.includes(".")),
        "a plain kind holds no dot, since no name does",
      ).toEqual([]);
      expect(
        [...hashedKinds].filter((each) => !each.endsWith(".h")),
        "a hashed kind ends in .h",
      ).toEqual([]);
      expect(
        [...plainKinds].filter((each) => hashedKinds.has(each)),
        "so a plain kind and a hashed kind never meet",
      ).toEqual([]);
      expect(plainKinds.size > 0 && hashedKinds.size > 0, "both forms were reached").toBe(true);
    }),
  { arbitrary: { runs: 300, seed: SEED } },
);
