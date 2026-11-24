// D6, the errors' types: the five refusals, the three failures, the refusal of an empty list of types that is no refusal, the cause a failure holds hidden, and how a package above wraps and catches them. They are
// checked by the compiler (`tsc`, and the root `typecheck`), not by a test run: each `@ts-expect-error` below is a mistake the plan names, and it must stay a
// compile error. The helper holds the law's lines and takes its values as parameters, and its `it` only names it, so the file also runs under vitest by path.
import { expectTypeOf, it } from "@effect/vitest";
import { Effect, type Redacted } from "effect";
import * as Errors from "./Errors.ts";
import { ChatRefused, ChatUnavailable } from "./Ledger.test-support.ts";

// D6. Plant: put `EmptyTypes` in `Refusal`; type a failure's cause as `Schema.Defect()` (the raw-cause lines compile); drop `AdmissionRefused` from `Refusal` (the exact-union line fails); put
// `BadRow` in `Refusal`; type a failure's cause as `Schema.Unknown`; make a failure's cause optional (the left-out line compiles); give `Failure` a fourth member;
// drop the `reason` from the wrapper.
/** The keys of each member of a union, not only the keys they share. */
type MemberKeys<T> = T extends unknown ? keyof T : never;

const errorTypes = (raw: Error, hidden: Redacted.Redacted<Error>, plain: string, refusal: Errors.Refusal) => {
  // The two unions are exactly their members.
  expectTypeOf<Errors.Refusal>().toEqualTypeOf<
    Errors.BadEntry | Errors.IdReused | Errors.TooBig | Errors.AdmissionRefused | Errors.RevisionConflict
  >();
  // An empty list of types is a read's own error: it is neither a refusal nor a failure.
  expectTypeOf<Errors.EmptyTypes>().not.toExtend<Errors.Refusal>();
  expectTypeOf<Errors.EmptyTypes>().not.toExtend<Errors.Failure>();
  expectTypeOf<Errors.Refusal>().not.toExtend<Errors.EmptyTypes>();
  expectTypeOf<Errors.Failure>().toEqualTypeOf<Errors.Unreachable | Errors.BadRow | Errors.StorageFailed>();

  // A failure is made with a cause that is held hidden: a raw error, a text or no cause is no cause.
  // @ts-expect-error a raw error is no cause: a cause is made hidden first
  const rawUnreachable = new Errors.Unreachable({ cause: raw });
  // @ts-expect-error a raw error is no cause: a cause is made hidden first
  const rawBadRow = new Errors.BadRow({ cause: raw });
  // @ts-expect-error a raw error is no cause: a cause is made hidden first
  const rawStorage = new Errors.StorageFailed({ cause: raw });
  // @ts-expect-error a text is no cause either
  const textUnreachable = new Errors.Unreachable({ cause: plain });
  // @ts-expect-error a failure is made with a cause
  const noneBadRow = new Errors.BadRow({});

  // Each failure is buildable from its fields, and keeps its cause hidden.
  const unreachable = new Errors.Unreachable({ cause: hidden });
  const badRow = new Errors.BadRow({ cause: hidden });
  const storage = new Errors.StorageFailed({ cause: hidden });

  expectTypeOf(unreachable.cause).toEqualTypeOf<Redacted.Redacted<unknown>>();
  expectTypeOf(badRow.cause).toEqualTypeOf<Redacted.Redacted<unknown>>();
  expectTypeOf(storage.cause).toEqualTypeOf<Redacted.Redacted<unknown>>();
  expectTypeOf(unreachable.cause).not.toExtend<Error>();
  expectTypeOf(unreachable._tag).toEqualTypeOf<"Unreachable">();
  expectTypeOf(badRow._tag).toEqualTypeOf<"BadRow">();
  expectTypeOf(storage._tag).toEqualTypeOf<"StorageFailed">();

  // A refusal says which part was bad and carries no cause.
  expectTypeOf<Errors.BadEntry["part"]>().toEqualTypeOf<
    "stream" | "id" | "entry" | "type" | "body" | "metadata" | "expectedRevision"
  >();
  // No error carries a body or metadata: an entry's content never rides in an error.
  expectTypeOf<
    Extract<
      MemberKeys<Errors.Refusal | Errors.EmptyTypes | Errors.Failure>,
      "body" | "metadata" | "entry" | "stream" | "id"
    >
  >().toEqualTypeOf<never>();

  // A package above holds a failure as its reason and as its cause, and a refusal as its reason.
  const wrapper = new ChatUnavailable({ reason: unreachable });
  const refused = new ChatRefused({ reason: refusal });
  expectTypeOf(wrapper.reason).toEqualTypeOf<Errors.Failure>();
  expectTypeOf(wrapper.cause).toEqualTypeOf<Errors.Failure>();
  expectTypeOf(refused.reason).toEqualTypeOf<Errors.Refusal>();
  // @ts-expect-error a text is no failure: the reason is one of the three
  const textReason = new ChatUnavailable({ reason: plain });
  // A refusal is no failure, so a package above wraps each under its own name.
  expectTypeOf<Errors.Refusal>().not.toExtend<Errors.Failure>();
  expectTypeOf<Errors.Failure>().not.toExtend<Errors.Refusal>();

  // A handler catches each of the nine by its tag, and what it leaves is the rest.
  const handled = (effect: Effect.Effect<never, Errors.Refusal | Errors.EmptyTypes | Errors.Failure>) =>
    effect.pipe(
      Effect.catchTags({
        BadEntry: () => Effect.succeed("bad"),
        IdReused: () => Effect.succeed("reused"),
        TooBig: () => Effect.succeed("big"),
        AdmissionRefused: () => Effect.succeed("refused"),
        RevisionConflict: () => Effect.succeed("conflict"),
        EmptyTypes: () => Effect.succeed("no types"),
        Unreachable: () => Effect.succeed("unreachable"),
        BadRow: () => Effect.succeed("row"),
      }),
    );

  expectTypeOf(handled).returns.toEqualTypeOf<Effect.Effect<string, Errors.StorageFailed>>();

  return [rawUnreachable, rawBadRow, rawStorage, textUnreachable, noneBadRow, wrapper, refused, textReason];
};

it("D6 type: Refusal is the five refusals and Failure the three failures, a failure holds its cause hidden, and a package above wraps them and catches each by its tag", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(errorTypes).toBeFunction();
});
