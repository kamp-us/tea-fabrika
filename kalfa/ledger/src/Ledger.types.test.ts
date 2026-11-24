// D1 and D2, the Ledger's calls: what `append` and `read` take and answer, and how their options may be written. They are checked by the compiler
// (`tsc`, and the root `typecheck`), not by a test run: each `@ts-expect-error` below is a mistake the plan names, and it must stay a compile error.
// The helpers hold the laws' lines and take their values as parameters, so no value is declared out of thin air, and each `it` only names its helper,
// so the file also runs under vitest by path.
import { expectTypeOf, it } from "@effect/vitest";
import type { Array as Arr, Effect, Stream } from "effect";
import type { Entry, NewEntry, Placed, Revision } from "./Entry.ts";
import type { EntryId } from "./EntryId.ts";
import type { EmptyTypes, Failure, Refusal } from "./Errors.ts";
import type * as Ledger from "./Ledger.ts";

type Service = Ledger.Ledger["Service"];

// D1. Plant: add an overload of `append` with no id (the no-id line compiles); type the id as `string` (the plain-string line compiles); widen `read`'s error to
// `Refusal | Failure`; leave `EmptyTypes` out of `read`'s error (the exact-type line fails); put `EmptyTypes` in `append`'s error; give `append` an error of `unknown`; add a third call to the service; type `after` as `number` (the plain-number line compiles).
const callTypes = (
  ledger: Service,
  stream: string,
  id: EntryId,
  entry: NewEntry,
  after: Revision,
  plain: string,
  count: number,
) => {
  // An append answers a `Placed`, or a refusal or a failure.
  expectTypeOf(ledger.append(stream, id, entry)).toEqualTypeOf<Effect.Effect<Placed, Refusal | Failure>>();
  // A read gives entries and fails as a failure, or as the one error of its own, an empty list of types: a refusal is an answer to an append.
  expectTypeOf(ledger.read(stream, after)).toEqualTypeOf<Stream.Stream<Entry, EmptyTypes | Failure>>();

  // There is no append without an id, and the id is an `EntryId`, never plain text.
  // @ts-expect-error an append names its id
  const noId = ledger.append(stream, entry);
  // @ts-expect-error a plain string is no id
  const textId = ledger.append(stream, plain, entry);
  // @ts-expect-error an entry comes third, after the id
  const swapped = ledger.append(stream, entry, id);
  // @ts-expect-error a revision to read after is a `Revision`, never a plain number
  const numberAfter = ledger.read(stream, count);
  // @ts-expect-error a stream is named by its text
  const noStream = ledger.read(after);

  // The service has exactly the two calls of this slice.
  expectTypeOf<keyof Service>().toEqualTypeOf<"append" | "read">();
  expectTypeOf<Parameters<Service["append"]>>().toEqualTypeOf<
    [stream: string, id: EntryId, entry: NewEntry, options?: Ledger.AppendOptions | undefined]
  >();
  expectTypeOf<Parameters<Service["read"]>>().toEqualTypeOf<
    [stream: string, after: Revision, options?: Ledger.ReadOptions | undefined]
  >();

  return [noId, textId, swapped, numberAfter, noStream];
};

it("D1 type: append takes a stream, an id and an entry and answers a Placed or a refusal or a failure, read answers entries or an empty-types error or a failure, and a call with no id or a plain-text id is no call", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(callTypes).toBeFunction();
});

// D2. Plant: type `expectedRevision` as `number` (the plain-number line compiles); type `types` as `ReadonlyArray<string>` (the empty-list line compiles); add
// `| undefined` to `expectedRevision`; make `expectedRevision` required (the left-out lines fail); make `types` required; type `types` as `Array<string>`; name the option `tags`.
const optionTypes = (
  ledger: Service,
  stream: string,
  id: EntryId,
  entry: NewEntry,
  after: Revision,
  head: Revision,
  maybe: Revision | undefined,
  options: Ledger.AppendOptions,
  maybeOptions: Ledger.AppendOptions | undefined,
  types: Arr.NonEmptyReadonlyArray<string>,
  names: Array<string>,
  readOptions: Ledger.ReadOptions,
) => {
  // Every way the append's options can be written and be right: left out, empty, with the revision a read gave, a variable, and a variable that may be none.
  const ok = [
    ledger.append(stream, id, entry),
    ledger.append(stream, id, entry, {}),
    ledger.append(stream, id, entry, { expectedRevision: head }),
    ledger.append(stream, id, entry, options),
    ledger.append(stream, id, entry, maybeOptions),
  ];

  // Every way it can be written and be wrong.
  // @ts-expect-error a plain number is no revision
  const plainNumber = ledger.append(stream, id, entry, { expectedRevision: 0 });
  // @ts-expect-error `undefined` is "no check", and "no check" is the key left out
  const undefinedRevision = ledger.append(stream, id, entry, { expectedRevision: undefined });
  // @ts-expect-error a revision that may be none is not a revision
  const maybeRevision = ledger.append(stream, id, entry, { expectedRevision: maybe });
  // @ts-expect-error the option is named `expectedRevision`
  const otherName = ledger.append(stream, id, entry, { revision: head });

  // Every way the read's options can be written and be right: left out, empty, one type, a non-empty list in a variable, and a variable of the options.
  const reads = [
    ledger.read(stream, after),
    ledger.read(stream, after, {}),
    ledger.read(stream, after, { types: ["A"] }),
    ledger.read(stream, after, { types }),
    ledger.read(stream, after, readOptions),
  ];

  // Every way it can be written and be wrong.
  // @ts-expect-error a list of no types is a type hole: a read asks for types, or for no types by leaving them out
  const emptyTypes = ledger.read(stream, after, { types: [] });
  // @ts-expect-error a list of text that may be empty is not a non-empty list
  const mayBeEmpty = ledger.read(stream, after, { types: names });
  // @ts-expect-error `undefined` is "every type", and "every type" is the key left out
  const undefinedTypes = ledger.read(stream, after, { types: undefined });

  expectTypeOf<Ledger.AppendOptions>().toEqualTypeOf<{ readonly expectedRevision?: Revision }>();
  expectTypeOf<Ledger.ReadOptions>().toEqualTypeOf<{ readonly types?: Arr.NonEmptyReadonlyArray<string> }>();

  return [ok, plainNumber, undefinedRevision, maybeRevision, otherName, reads, emptyTypes, mayBeEmpty, undefinedTypes];
};

it("D2 type: expectedRevision is a Revision left out when there is no check, and types a non-empty list left out when there is no filter, written every way they can be", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(optionTypes).toBeFunction();
});
