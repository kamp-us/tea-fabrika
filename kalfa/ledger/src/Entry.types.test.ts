// D4, the entries' types: the eight keys of an entry as read, what a writer hands to append, and what a revision and a position are. They are checked by the
// compiler (`tsc`, and the root `typecheck`), not by a test run: each `@ts-expect-error` below is a mistake the plan names, and it must stay a compile error.
// The helper holds the law's lines and takes its values as parameters, and its `it` only names it, so the file also runs under vitest by path.
import { expectTypeOf, it } from "@effect/vitest";
import type { Schema } from "effect";
import type * as Entry from "./Entry.ts";

/** A body written as a type alias: an object of JSON. */
type Doc = { readonly kind: string; readonly items: ReadonlyArray<number> };

/** A body written as an interface: the same fields, and no index signature, which `Schema.Json` asks for. */
interface Shaped {
  readonly kind: string;
}

/** A value of no known type: what a body typed as `unknown` is. */
type Opaque = Schema.Unknown["Type"];

/** A new entry with its body and its metadata taken out: what is left holds the type. */
type Typed = Omit<Entry.NewEntry, "body" | "metadata">;

/** An entry as a writer may have it in hand: a type and a body, and no metadata. */
type Bare = Typed & { readonly body: null };

// A place that asks for a new entry, the way a call to append does.
const handed = (entry: Entry.NewEntry): Entry.NewEntry => entry;

// D4. Plant: add `sentAt` to `Entry` (the key lines fail); name the writer's field `_tag` (the key lines fail); type it as a closed set (the `string` line fails); type `body` as `unknown` (the `unknown` line compiles); make `metadata` `Schema.optional` (the
// `undefined` line compiles); make `metadata` required on `NewEntry` (the left-out line fails); give `Revision` and `Position` one brand (the position line compiles);
// let a plain number be a `Revision`.
const entryTypes = (
  bare: Bare,
  aliased: Typed & { readonly body: Doc },
  slotted: Typed & { readonly body: Doc; readonly metadata: Entry.Metadata },
  typeless: Omit<Bare, keyof Typed>,
  bodiless: Typed,
  shaped: Shaped,
  anything: Opaque,
  revision: Entry.Revision,
  position: Entry.Position,
  count: number,
) => {
  // An entry as read has exactly these eight keys, and none of today's sender fields.
  expectTypeOf<keyof Entry.Entry>().toEqualTypeOf<
    "id" | "stream" | "revision" | "position" | "arrivedAt" | "type" | "body" | "metadata"
  >();
  expectTypeOf<Entry.Entry>().not.toHaveProperty("by");
  expectTypeOf<Entry.Entry>().not.toHaveProperty("for");
  expectTypeOf<Entry.Entry>().not.toHaveProperty("sentAt");
  expectTypeOf<Entry.Entry>().not.toHaveProperty("seen");
  expectTypeOf<Entry.Entry>().not.toHaveProperty("parent");
  expectTypeOf<Entry.Entry>().not.toHaveProperty("traceId");
  expectTypeOf<Entry.Entry>().not.toHaveProperty("build");
  expectTypeOf<Entry.Entry["metadata"]>().toEqualTypeOf<Entry.Metadata>();
  // The writer's own field is `type`, open text it picks; `_tag` is for a closed set Effect writes, so neither an entry nor a new entry has it.
  expectTypeOf<Entry.Entry["type"]>().toEqualTypeOf<string>();
  expectTypeOf<Entry.NewEntry["type"]>().toEqualTypeOf<string>();
  expectTypeOf<Entry.Entry>().not.toHaveProperty("_tag");
  expectTypeOf<Entry.NewEntry>().not.toHaveProperty("_tag");

  // Every way a new entry can be written and be right: metadata left out, with metadata, and a body that is a type alias of JSON.
  const ok = [handed(bare), handed(slotted), handed(aliased)];

  // Every way it can be written and be wrong.
  // @ts-expect-error metadata is a record or it is left out, never `undefined`
  const undefinedMetadata = handed({ ...bare, metadata: undefined });
  // @ts-expect-error a body is JSON: a value of an unknown type is not
  const unknownBody = handed({ ...bare, body: anything });
  // @ts-expect-error a body typed as an interface has no index signature, so a caller encodes it with its own schema first
  const interfaceBody = handed({ ...bare, body: shaped });
  // @ts-expect-error an entry has its type
  const noType = handed(typeless);
  // @ts-expect-error an entry has its body
  const noBody = handed(bodiless);
  // @ts-expect-error an entry the writer hands in names nothing a sender field would
  const sender = handed({ ...bare, sentAt: count });

  // A revision and a position are numbers no plain number is.
  // @ts-expect-error a plain number is no revision
  const plainRevision: Entry.Revision = count;
  // @ts-expect-error a plain number is no position
  const plainPosition: Entry.Position = count;
  // @ts-expect-error a position is no revision
  const positionAsRevision: Entry.Revision = position;
  // @ts-expect-error a revision is no position
  const revisionAsPosition: Entry.Position = revision;
  expectTypeOf<Entry.Revision>().toExtend<number>();
  expectTypeOf<Entry.Position>().toExtend<number>();

  return [
    ok,
    undefinedMetadata,
    unknownBody,
    interfaceBody,
    noType,
    noBody,
    sender,
    plainRevision,
    plainPosition,
    positionAsRevision,
    revisionAsPosition,
  ];
};

it("D4 type: an entry as read has eight keys and none of a sender's, a new entry takes JSON and optional metadata, and a revision and a position are branded numbers of their own", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(entryTypes).toBeFunction();
});
