// D5, the ids' types: what `child` takes and gives, and that a plain text is neither an id nor a name. They are checked by the compiler (`tsc`, and the root
// `typecheck`), not by a test run: each `@ts-expect-error` below is a mistake the plan names, and it must stay a compile error. The helper holds the law's
// lines and takes its values as parameters, and its `it` only names it, so the file also runs under vitest by path.
import { expectTypeOf, it } from "@effect/vitest";
import type { Effect, Option, Result } from "effect";
import type { NewEntry } from "./Entry.ts";
import * as EntryId from "./EntryId.ts";
import type * as Ledger from "./Ledger.ts";

/** What a package above says: its own id is the Ledger's, under its own name. */
type ReplyId = EntryId.EntryId;

// A place that asks for an id, and one that asks for a name.
const askedId = (id: EntryId.EntryId): EntryId.EntryId => id;

const askedName = (name: EntryId.EntryName): EntryId.EntryName => name;

// D5. Plant: make `child` give `Effect<EntryId>` (the exact-type line fails); make it give `Result` or `Option`; type `child`'s name as `string` (the plain-string
// line compiles); type its parent as `string`; give `EntryName` and `EntryId` one brand (the name-as-id line compiles); make `ReplyId`'s append need a mapping.
const idTypes = (
  plain: string,
  id: EntryId.EntryId,
  name: EntryId.EntryName,
  reply: ReplyId,
  ledger: Ledger.Ledger["Service"],
  stream: string,
  entry: NewEntry,
) => {
  // `child` takes a name and a parent and gives an id: not an Effect, a Result or an Option, since it cannot fail.
  expectTypeOf(EntryId.child).toEqualTypeOf<(name: EntryId.EntryName, parent: EntryId.EntryId) => EntryId.EntryId>();
  expectTypeOf(EntryId.child(name, id)).not.toExtend<Effect.Effect<unknown, unknown, unknown>>();
  expectTypeOf(EntryId.child(name, id)).not.toExtend<Result.Result<unknown, unknown>>();
  expectTypeOf(EntryId.child(name, id)).not.toExtend<Option.Option<unknown>>();
  expectTypeOf(EntryId.child(name, id)).toExtend<string>();

  // A plain text is neither an id nor a name, and the two are not each other.
  // @ts-expect-error a plain string is no id
  const textId = askedId(plain);
  // @ts-expect-error a plain string is no name
  const textName = askedName(plain);
  // @ts-expect-error a name is no id: it lacks the parent
  const nameAsId = askedId(name);
  // @ts-expect-error an id is no name
  const idAsName = askedName(id);
  // @ts-expect-error a name comes first, and the parent second
  const swapped = EntryId.child(id, name);
  // @ts-expect-error a plain string is no name to build from
  const textFirst = EntryId.child(plain, id);
  // @ts-expect-error a plain string is no parent to build from
  const textParent = EntryId.child(name, plain);

  // A package's own id is the Ledger's id under its own name, so a decoded reply id goes to append as it is.
  const appended = ledger.append(stream, reply, entry);
  expectTypeOf<ReplyId>().toEqualTypeOf<EntryId.EntryId>();

  return [textId, textName, nameAsId, idAsName, swapped, textFirst, textParent, appended];
};

it("D5 type: child takes an entry name and an entry id and gives an entry id, a plain text is neither, and a package's own id is the Ledger's with no mapping", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(idTypes).toBeFunction();
});
