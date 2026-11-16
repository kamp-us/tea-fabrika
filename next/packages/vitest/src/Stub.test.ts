// Decision 0554, L6 of the Reflect-ban plan: `Stub.make` is the one stand-in for a platform object
// (a Durable Object stub, its storage, a bucket). Members in `own` answer as given, any other method
// name answers `rest(name)` with that name, and `then` and symbol keys answer undefined so awaiting a
// stub never hangs.
// Plant: make the trap answer `then` with a function, and the "awaiting" law below goes red.
import { expect, it } from "@effect/vitest";
import * as fc from "fast-check";
import * as Stub from "./Stub.ts";

const SEED = 119120;

type Method = (...args: ReadonlyArray<unknown>) => unknown;

/** Every name Object.prototype holds. A stub with none of them in `own` answers `rest` for each. */
const PROTOTYPE_NAMES = [
  "toString",
  "constructor",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
] as const;

/** A method name the stub may be asked for, the prototype's own names included. `then` has its own law. */
const Name = fc.oneof(fc.constantFrom(...PROTOTYPE_NAMES), fc.string()).filter((name) => name !== "then");

/** Some own member names, none of them equal, and a name outside them. */
const Members = fc
  .uniqueArray(Name, { maxLength: 6 })
  .chain((keys) => fc.record({ keys: fc.constant(keys), other: Name.filter((name) => !keys.includes(name)) }));

const ownAnswer =
  (key: string): Method =>
  () =>
    `own:${key}`;

const ownMembers = (keys: ReadonlyArray<string>): Record<string, Method> =>
  Object.fromEntries(keys.map((key) => [key, ownAnswer(key)]));

it("a name outside own answers rest(name) with that name and the call's arguments", () => {
  fc.assert(
    fc.property(Members, fc.array(fc.jsonValue(), { maxLength: 3 }), ({ keys, other }, args) => {
      const asked: Array<string> = [];
      const stub = Stub.make<Record<string, Method>>(
        (name) =>
          (...given) => {
            asked.push(name);
            return { name, given };
          },
        ownMembers(keys),
      );
      expect(stub[other]?.(...args)).toEqual({ name: other, given: args });
      expect(asked).toEqual([other]);
    }),
    { seed: SEED, numRuns: 200 },
  );
});

it("an own member answers as given, and rest is not asked for it", () => {
  fc.assert(
    fc.property(
      Members.filter(({ keys }) => keys.length > 0),
      fc.nat(),
      ({ keys }, at) => {
        const key = keys[at % keys.length] ?? "";
        const asked: Array<string> = [];
        const stub = Stub.make<Record<string, Method>>((name) => {
          asked.push(name);
          return () => "rest";
        }, ownMembers(keys));
        expect(stub[key]?.()).toBe(`own:${key}`);
        expect(asked).toEqual([]);
      },
    ),
    { seed: SEED, numRuns: 200 },
  );
});

it("then and every symbol key answer undefined, so awaiting a stub gives the stub back", async () => {
  await fc.assert(
    fc.asyncProperty(Members, fc.string(), async ({ keys }, description) => {
      const stub = Stub.make<Record<string | symbol, unknown>>(() => () => "rest", ownMembers(keys));
      expect(stub["then"]).toBeUndefined();
      expect(stub[Symbol(description)]).toBeUndefined();
      expect(stub[Symbol.iterator]).toBeUndefined();
      expect(await stub).toBe(stub);
    }),
    { seed: SEED, numRuns: 200 },
  );
});
