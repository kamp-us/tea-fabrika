// D8, the types of a store side's two failures: each is made with its cause held as a `Redacted`, so a raw cause is no cause and a leak cannot be
// written. They are checked by the compiler (`tsc`, and the root `typecheck`), not by a test run: each `@ts-expect-error` below is a mistake the
// plan names, and it must stay a compile error. The helper holds the law's lines, and its `it` only names it, so the file also runs under vitest
// by path.
import { expectTypeOf, it } from "@effect/vitest";
import type { Redacted } from "effect";
import * as Errors from "./Errors.ts";

// D8. Plant: type the cause field as `Schema.Defect()`, and every raw-cause line compiles; type it as `Schema.Unknown`, and the same; type it as
// `Schema.Redacted(Schema.Unknown)` with a constructor that takes a raw cause (the shape before the rewrite), and the raw lines compile; drop the
// cause field from one error, and the hidden-cause line fails.
const failureTypes = (raw: Error, hidden: Redacted.Redacted<Error>) => {
  // @ts-expect-error a raw error is no cause: a cause is made hidden first
  const rawStore = new Errors.StoreFailed({ cause: raw });
  // @ts-expect-error a raw error is no cause: a cause is made hidden first
  const rawRecord = new Errors.RecordFailed({ cause: raw });
  // @ts-expect-error a text is no cause either
  const textStore = new Errors.StoreFailed({ cause: "bad value" });
  // @ts-expect-error a failure is made with a cause
  const noneStore = new Errors.StoreFailed({});

  const store = new Errors.StoreFailed({ cause: hidden });
  const record = new Errors.RecordFailed({ cause: hidden });

  // The cause is kept hidden, and is read on purpose with `Redacted.value`.
  expectTypeOf(store.cause).toExtend<Redacted.Redacted<unknown>>();
  expectTypeOf(record.cause).toExtend<Redacted.Redacted<unknown>>();
  expectTypeOf(store.cause).not.toExtend<Error>();
  expectTypeOf(store._tag).toEqualTypeOf<"StoreFailed">();
  expectTypeOf(record._tag).toEqualTypeOf<"RecordFailed">();
  expectTypeOf([rawStore, rawRecord, textStore, noneStore]).toBeArray();
};

it("D8 type: StoreFailed and RecordFailed are made with a cause held as a Redacted, so a raw error, a text or no cause is no cause", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(failureTypes).toBeFunction();
});
