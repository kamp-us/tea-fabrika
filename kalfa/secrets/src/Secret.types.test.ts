// D1 and D4, the types of a declared secret: what yielding it needs and fails with, what its name and object are, and which names and proof keys
// the compiler refuses. They are checked by the compiler (`tsc`, and the root `typecheck`), not by a test run: each `@ts-expect-error` below is a
// mistake the plan names, and it must stay a compile error. The helpers hold the laws' lines, and each `it` only names its helper, so the file
// also runs under vitest by path and holds no value the types alone could give.
import { expectTypeOf, it } from "@effect/vitest";
import { Context, Effect, type Redacted, Schema } from "effect";
import type * as Errors from "./Errors.ts";
import * as Secret from "./Secret.ts";
import type * as Secrets from "./Secrets.ts";

class MayFetch extends Context.Service<MayFetch, { readonly object: string }>()("@kalfa/secrets/types/MayFetch") {}

class MayList extends Context.Service<MayList, { readonly object: string; readonly extra: number }>()(
  "@kalfa/secrets/types/MayList",
) {}

class NoObject extends Context.Service<NoObject, { readonly label: string }>()("@kalfa/secrets/types/NoObject") {}

class Anything extends Context.Service<Anything, unknown>()("@kalfa/secrets/types/Anything") {}

class NumberObject extends Context.Service<NumberObject, { readonly object: number }>()(
  "@kalfa/secrets/types/NumberObject",
) {}

// D1. Plant: type the proof key as `Context.Key<I, unknown>`, and the no-object lines compile; type `object` as `string`, and the literal line fails;
// give the secret no `Secrets` in its needs, and the needs line fails; type the success as a plain `string`, and the hidden-value line fails; add
// `SecretMalformed` to the errors, and the errors line fails; drop `MayFetch` from the needs, and the guard line fails.
const secretTypes = () => {
  const TurnKey = Secret.make("transport/turn-key", { fetch: MayFetch });
  const Listed = Secret.make("transport/list-key", { fetch: MayList });

  // Yielding it is the fetch: a hidden value, two failures, and the proof key and the service as needs.
  expectTypeOf<Effect.Success<typeof TurnKey>>().toEqualTypeOf<Redacted.Redacted<string>>();
  expectTypeOf<Effect.Error<typeof TurnKey>>().toEqualTypeOf<Errors.SecretMissing | Errors.SecretsUnavailable>();
  expectTypeOf<Effect.Services<typeof TurnKey>>().toEqualTypeOf<MayFetch | Secrets.Secrets>();

  // A proof key with more than an object is a proof key too, and its own key is what the secret needs.
  expectTypeOf<Effect.Services<typeof Listed>>().toEqualTypeOf<MayList | Secrets.Secrets>();

  // A guard that provides the proof key leaves the service.
  const guarded = TurnKey.pipe(Effect.provideService(MayFetch, { object: TurnKey.object }));

  expectTypeOf<Effect.Services<typeof guarded>>().toEqualTypeOf<Secrets.Secrets>();
  expectTypeOf<Effect.Success<typeof guarded>>().toEqualTypeOf<Redacted.Redacted<string>>();

  // The name and the object are the literal types of the name that was written.
  expectTypeOf(TurnKey.name).toEqualTypeOf<"transport/turn-key">();
  expectTypeOf(TurnKey.object).toEqualTypeOf<"secret:transport/turn-key">();
  expectTypeOf(Listed.object).toEqualTypeOf<"secret:transport/list-key">();

  // A proof key whose value has no `object` text is no proof key.
  // @ts-expect-error a key whose value has no object says nothing for Secrets to compare
  const noObject = Secret.make("transport/no-object", { fetch: NoObject });
  // @ts-expect-error a key whose value is anything at all may have no object
  const anything = Secret.make("transport/anything", { fetch: Anything });
  // @ts-expect-error an object that is a number is no text
  const numbered = Secret.make("transport/numbered", { fetch: NumberObject });
  // @ts-expect-error a secret is declared with the key its fetch asks for
  const keyless = Secret.make("transport/keyless", {});

  expectTypeOf([noObject, anything, numbered, keyless]).toBeArray();
};

it("D1 type: a declared secret is an Effect of a hidden text that fails SecretMissing or SecretsUnavailable and needs its proof key and Secrets, a guard that provides the proof key leaves Secrets, its object is the literal secret:<name>, and a proof key whose value has no object text does not compile", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(secretTypes).toBeFunction();
});

// D4. Plant: drop the literal check from `make`, and the `string` line compiles; check only `string extends N`, and the union line compiles; check
// only that N is a union, and the `string` line compiles; take a template type with a `string` hole as a literal, and its line compiles; take
// `any`, and its line compiles.
const nameTypes = (
  text: string,
  either: "transport/turn-key" | "transport/other-key",
  holed: `transport/${string}`,
) => {
  const written = Secret.make("transport/turn-key", { fetch: MayFetch });

  const WRITTEN = "transport/turn-key";
  const kept = Secret.make(WRITTEN, { fetch: MayFetch });

  expectTypeOf(written.name).toEqualTypeOf<"transport/turn-key">();
  expectTypeOf(kept.name).toEqualTypeOf<"transport/turn-key">();

  // @ts-expect-error a name typed as plain text is not written in code
  const plain = Secret.make(text, { fetch: MayFetch });
  // @ts-expect-error a name typed as one of two names is not one name
  const union = Secret.make(either, { fetch: MayFetch });
  // @ts-expect-error a name with a hole of plain text in it is not written in code
  const holes = Secret.make(holed, { fetch: MayFetch });
  // @ts-expect-error a name typed as `any` is not written in code
  const wild = Secret.make(Schema.decodeUnknownSync(Schema.Any)(text), { fetch: MayFetch });

  expectTypeOf([plain, union, holes, wild]).toBeArray();
};

it("D4 type: Secret.make takes a name written as a literal, and a name typed as plain text, as a union of two names, as a template with a text hole, or as any does not compile", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(nameTypes).toBeFunction();
});
