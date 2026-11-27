// H6, the types of `Hidden.Cause` and `Hidden.placeholder`: a hidden cause is a `Redacted`, so a raw error, a text or a missing cause is no cause, and the
// placeholder is the one literal text. They are checked by the compiler (`tsc`, and the root `typecheck`), not by a test run: each `@ts-expect-error` below is
// a mistake the plan names, and it must stay a compile error. The helper holds the law's lines, and its `it` only names it, so the file also runs under
// vitest by path.
import { expectTypeOf, it } from "@effect/vitest";
import { Redacted, Schema } from "effect";
import * as Hidden from "./Hidden.ts";

class Held extends Schema.TaggedError<Held, { readonly brand: unique symbol }>()("Held", {
  cause: Hidden.Cause,
}) {}

class Maybe extends Schema.TaggedError<Maybe, { readonly brand: unique symbol }>()("Maybe", {
  cause: Schema.optional(Hidden.Cause),
}) {}

// H6. Plant: declare `Cause` as `Schema.declare((u: unknown): u is unknown => true, ...)`, and the raw lines compile, so their `@ts-expect-error` is unused; export
// `placeholder` as `string`, and the literal check fails.
const hiddenTypes = (raw: Error) => {
  expectTypeOf<typeof Hidden.Cause.Type>().toEqualTypeOf<Redacted.Redacted<unknown>>();
  expectTypeOf<typeof Hidden.placeholder>().toEqualTypeOf<"<redacted>">();

  const held = new Held({ cause: Redacted.make(raw) });

  // @ts-expect-error a raw error is no cause: a cause is made hidden first
  const rawHeld = new Held({ cause: raw });
  // @ts-expect-error a text is no cause either
  const textHeld = new Held({ cause: "bad value" });
  // @ts-expect-error a cause is held: an error made with none is refused
  const noneHeld = new Held({});

  expectTypeOf(held.cause).toEqualTypeOf<Redacted.Redacted<unknown>>();

  // An optional cause is left out, or `undefined`, or hidden.
  const left = new Maybe({});
  const undef = new Maybe({ cause: undefined });
  const hidden = new Maybe({ cause: Redacted.make(raw) });
  // @ts-expect-error a raw error is no optional cause either
  const rawMaybe = new Maybe({ cause: raw });

  expectTypeOf(left.cause).toEqualTypeOf<Redacted.Redacted<unknown> | undefined>();
  expectTypeOf([rawHeld, textHeld, noneHeld, undef, hidden, rawMaybe]).toBeArray();
};

it("H6 type: a hidden cause is a Redacted, so a raw error, a text or no cause is no cause, and the placeholder is one literal text", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(hiddenTypes).toBeFunction();
});
