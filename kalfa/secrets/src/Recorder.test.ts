// R5, the fact a fetch is recorded as: `Fetched` holds the name, the store and the version of one use, and nothing else. It is a Schema, so a ledger
// that saves it saves exactly those, and a name, a store id or a version that is no name, no id or no version is refused when it is read back.
import { expect, it } from "@effect/vitest";
import { Array as Arr, Effect, Option, Schema } from "effect";
import * as Name from "./Name.ts";
import * as Recorder from "./Recorder.ts";
import {
  acceptedNames,
  acceptedStoreIds,
  acceptedVersions,
  nameTexture,
  refusedNames,
  refusedStoreIds,
  refusedVersions,
  SEED,
} from "./Secrets.test-support.ts";

/** A fact another recorder's slot could hold: the same fields under another tag. */
const Other = Schema.TaggedStruct("Signed", {
  name: Name.SecretName,
  store: Name.StoreId,
  version: Name.Version,
});

const reads = (wire: object): boolean => Option.isSome(Schema.decodeUnknownOption(Recorder.Fetched)(wire));

// R5. Plant: add a `value` field to `Fetched`; leave the version out of it; tag it `Fetch`; take the name as plain text; take any text as a store id;
// take the empty text as a version.
it.effect.prop(
  "R5 fetched: Fetched holds a name, a store and a version, encodes as exactly those with its tag, reads back equal, and refuses a name, a store id or a version that is none",
  { texture: nameTexture },
  ({ texture }) =>
    Effect.sync(() => {
      const names = acceptedNames(texture).map((each) => Schema.decodeUnknownSync(Name.SecretName)(each.text));
      const stores = acceptedStoreIds(texture).map((each) => Schema.decodeUnknownSync(Name.StoreId)(each));
      const versions = acceptedVersions(texture).map((each) => Schema.decodeUnknownSync(Name.Version)(each));

      const wires = names.map((name, index) =>
        Schema.encodeSync(Recorder.Fetched)(
          new Recorder.Fetched({
            name,
            store: Arr.getUnsafe(stores, index % stores.length),
            version: Arr.getUnsafe(versions, index % versions.length),
          }),
        ),
      );

      expect(wires.length, "a fact for each accepted name class").toBe(names.length);

      for (const wire of wires) {
        const fact = Schema.decodeUnknownSync(Recorder.Fetched)(wire);

        expect(fact._tag, "its tag").toBe("Fetched");
        expect(Schema.encodeSync(Recorder.Fetched)(fact), "written as it was read").toEqual(wire);
        expect(Object.keys(wire).toSorted(), "its fields").toEqual(["_tag", "name", "store", "version"]);
      }

      const wire = Arr.getUnsafe(wires, 0);

      for (const each of refusedNames(texture)) {
        expect(reads({ ...wire, name: each.text }), `name, ${each.id}`).toBe(false);
      }

      for (const each of refusedStoreIds(texture)) {
        expect(reads({ ...wire, store: each.text }), `store, ${each.id}`).toBe(false);
      }

      for (const each of refusedVersions) {
        expect(reads({ ...wire, version: each.text }), `version, ${each.id}`).toBe(false);
      }

      const signed = Other.make({
        name: Arr.getUnsafe(names, 0),
        store: Arr.getUnsafe(stores, 0),
        version: Arr.getUnsafe(versions, 0),
      });

      expect(reads(wire), "the wire itself is read").toBe(true);
      expect(reads(signed), "another fact's tag is not").toBe(false);
    }),
  { arbitrary: { runs: 200, seed: SEED } },
);
