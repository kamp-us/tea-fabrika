// D6 and D7, the store side's types: what a store is made of and what it needs, what a read answers, and what a name is. They are checked by the
// compiler (`tsc`, and the root `typecheck`), not by a test run: each `@ts-expect-error` below is a mistake the plan names, and it must stay a
// compile error. The helper holds the law's lines, and its `it` only names it, so the file also runs under vitest by path and holds no value
// the types alone could give.
import { expectTypeOf, it } from "@effect/vitest";
import { Context, Effect, Match, type Redacted, Schema } from "effect";
import type * as Errors from "./Errors.ts";
import type * as MemoryStore from "./MemoryStore.ts";
import * as Name from "./Name.ts";
import * as Store from "./Store.ts";

class Dep extends Context.Service<Dep, { readonly count: number }>()("@kalfa/secrets/test/Dep") {}

class Other extends Context.Service<Other, { readonly label: string }>()("@kalfa/secrets/test/Other") {}

// D6. Plant: take only the item in a read's parameters, and the parameters line fails; type `Store.Needs` as `never`, and the union line fails; type `Missing`'s reason as `string`, and the refused-reason line compiles;
// type `Found`'s value as a plain text, and the plain-text line compiles; let `Store.make` keep only `string` as an id, and the literal lines fail;
// widen `Place` by a word, and the place lines fail; type the read's error as `unknown`, and the read line fails.
const storeTypes = (absent: Store.Missing) => {
  const needsDep = Store.make({
    id: "env",
    item: Schema.String,
    place: "store",
    holds: { read: (_item: string) => Effect.as(Dep, absent) },
  });

  const needsOther = Store.make({
    id: "file",
    item: Schema.NonEmptyString,
    place: "runtime",
    holds: { read: (_item: string) => Effect.as(Other, absent) },
  });

  const needsNothing = Store.make({
    id: "memory",
    item: Schema.String,
    place: "memory",
    holds: { read: (_item: string) => Effect.succeed(absent) },
  });

  // The id and the needs are the types of the value that made them.
  expectTypeOf(needsDep).toEqualTypeOf<Store.Store<"env", string, Dep>>();
  expectTypeOf(needsOther.id).toEqualTypeOf<"file">();
  expectTypeOf(needsNothing).toEqualTypeOf<Store.Store<"memory", string, never>>();

  // An id typed as a union stays that union.
  const eitherId = (id: "keychain" | "cloudflare") =>
    Store.make({ id, item: Schema.String, place: "store", holds: { read: (_item: string) => Effect.succeed(absent) } });

  expectTypeOf<ReturnType<typeof eitherId>["id"]>().toEqualTypeOf<"keychain" | "cloudflare">();

  // An id typed as plain text, a place typed as the union, and an item the route's text decodes to a number are all stores, each with its own types.
  const anyId = (id: string) =>
    Store.make({ id, item: Schema.String, place: "store", holds: { read: (_item: string) => Effect.succeed(absent) } });

  const anyPlace = (place: Store.Place) =>
    Store.make({ id: "x", item: Schema.String, place, holds: { read: (_item: string) => Effect.succeed(absent) } });

  const numbered = Store.make({
    id: "x",
    item: Schema.FiniteFromString,
    place: "store",
    holds: { read: (_item: number) => Effect.succeed(absent) },
  });

  expectTypeOf<ReturnType<typeof anyId>["id"]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<typeof anyPlace>["place"]>().toEqualTypeOf<Store.Place>();
  expectTypeOf(numbered).toEqualTypeOf<Store.Store<"x", number, never>>();

  // A port takes the item as the route's text decodes it, so a read of text for a store whose items are numbers is no store.
  const textRead = Store.make({
    id: "x",
    // @ts-expect-error the item is a number once decoded, and the read takes it as one
    item: Schema.FiniteFromString,
    place: "store",
    holds: { read: (_item: string) => Effect.succeed(absent) },
  });

  // A list of stores needs what each of them needs.
  expectTypeOf<Store.Needs<typeof needsDep | typeof needsOther>>().toEqualTypeOf<Dep | Other>();
  expectTypeOf<Store.Needs<typeof needsDep | typeof needsNothing>>().toEqualTypeOf<Dep>();
  expectTypeOf<Store.Needs<typeof needsNothing>>().toEqualTypeOf<never>();
  expectTypeOf<Store.Needs<typeof MemoryStore.store>>().toEqualTypeOf<MemoryStore.Contents>();

  // Any store is a `Store.Any`, whatever it needs.
  expectTypeOf(needsDep).toExtend<Store.Any>();
  expectTypeOf(needsNothing).toExtend<Store.Any>();
  expectTypeOf<typeof MemoryStore.store>().toExtend<Store.Any>();

  // A read takes the item and the name it is asked for, so a store labels the value it hands out with that name.
  expectTypeOf<Parameters<Store.Holds<string, Dep>["read"]>>().toEqualTypeOf<
    [item: string, name: typeof Name.SecretName.Type]
  >();

  // A read answers with a Held, fails with StoreFailed, and needs what the store needs.
  expectTypeOf<ReturnType<Store.Holds<string, Dep>["read"]>>().toEqualTypeOf<
    Effect.Effect<Store.Held, Errors.StoreFailed, Dep>
  >();

  // A Held is Found or Missing, a Found holds a hidden value and a version, and a Missing says why.
  expectTypeOf<Store.Held>().toEqualTypeOf<
    | Store.Found<{ readonly value: Redacted.Redacted<string>; readonly version: typeof Name.Version.Type }>
    | Store.Missing
  >();
  expectTypeOf<Store.Missing["reason"]>().toEqualTypeOf<"absent" | "kind" | "algorithm">();
  expectTypeOf<Store.Place>().toEqualTypeOf<"store" | "runtime" | "memory">();

  // @ts-expect-error a reason of its own is no reason a store may give
  const strayReason: Store.Missing["reason"] = "other";

  // A Found's value is a Redacted, so it is no plain text.
  const hiddenOnly = (held: Store.Held) =>
    Match.value(held).pipe(
      Match.tag("Found", (each) => {
        // @ts-expect-error a plain text is no hidden value: a store hands a value out only as a Redacted
        const plainValue: string = each.value.value;

        return plainValue;
      }),
      Match.tag("Missing", (each) => each.reason),
      Match.exhaustive,
    );

  // @ts-expect-error a place is one of the three the glossary names
  const strayPlace = Store.make({ id: "x", item: Schema.String, place: "disk" });

  const bareAnswer = Store.make({
    id: "x",
    item: Schema.String,
    place: "memory",
    // @ts-expect-error a read answers a Held and no bare text
    holds: { read: (_item: string) => Effect.succeed("x") },
  });

  expectTypeOf([strayReason, hiddenOnly, strayPlace, bareAnswer, textRead]).toBeArray();
};

it("D6 type: Store.make takes its id and needs from what it is given, a list of stores needs what each needs, and a read answers Found with a hidden value or Missing for one of three reasons", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(storeTypes).toBeFunction();
});

// D7. Plant: make `SecretName` a plain `string` (the plain-text line compiles); give a `Version` and a `StoreId` one brand (the cross lines compile);
// brand nothing in `StoreId`.
const nameTypes = () => {
  const name = Schema.decodeUnknownSync(Name.SecretName)("transport/turn-key");
  const store = Schema.decodeUnknownSync(Name.StoreId)("memory");
  const version = Schema.decodeUnknownSync(Name.Version)("1");

  expectTypeOf(name).toEqualTypeOf<typeof Name.SecretName.Type>();
  expectTypeOf(name).toExtend<string>();

  // @ts-expect-error a plain text is no secret name
  const plainName: typeof Name.SecretName.Type = "transport/turn-key";
  // @ts-expect-error a plain text is no store id
  const plainStore: typeof Name.StoreId.Type = "memory";
  // @ts-expect-error a plain text is no version
  const plainVersion: typeof Name.Version.Type = "1";
  // @ts-expect-error a store id is no secret name
  const storeAsName: typeof Name.SecretName.Type = store;
  // @ts-expect-error a version is no store id
  const versionAsStore: typeof Name.StoreId.Type = version;
  // @ts-expect-error a secret name is no version
  const nameAsVersion: typeof Name.Version.Type = name;

  expectTypeOf([plainName, plainStore, plainVersion, storeAsName, versionAsStore, nameAsVersion]).toBeArray();
};

it("D7 type: a secret name, a store id and a version are each their own brand of text, so a plain text and the others are no name", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(nameTypes).toBeFunction();
});
