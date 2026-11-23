// M1, a model's types: what a model accepts at compile time and what it refuses. They are checked by the compiler (`tsc`, and the root `typecheck`),
// and the file also runs under vitest by path: the lines that must compile run for real in the helper, and each line that must not compile sits in a
// thunk the helper never calls, with its `@ts-expect-error` above it, so a refusal that stops being a compile error fails `tsc` as an unused directive.
// Every refusal is one line, so the directive sits on the line the compiler blames. The model is made up: the package names no app's words.
import { expectTypeOf, it } from "@effect/vitest";
import { Model, Relation } from "./index.ts";

const library = () =>
  Model.make("library")
    .type("reader", {})
    .type("book", {
      relations: {
        author: Relation.one(["reader"], { change: "retitle" }),
        editor: Relation.many(["reader"], { change: "retitle" }),
      },
      permissions: {
        retitle: (r) => r.union("author"),
        edit: (r) => r.union("author", "editor"),
        read: (r) => r.union("edit"),
      },
    });

// M1. Plant: drop `NoInfer` from `change`, and the wrong-`change` lines compile; drop the `Extract<P, keyof R>` check from the name, and the
// shared-name line compiles; widen the subject list to `string`, and the `#` lines compile; let `Name` pass an empty text, and the empty-name line
// compiles; type the name as a plain `string`, and the string and union lines compile; stop `N extends keyof T` from refusing a repeat, and the
// twice line compiles; take the subject list as `ReadonlyArray<S>`, and the empty-list line compiles.
const modelTypes = (start: ReturnType<typeof library>) => {
  // The protocol-shaped model compiles with no annotation, and each step it takes is a model that takes the next one.
  const shelved = start
    .type("shelf", { relations: { holds: Relation.many(["book"]), keeper: Relation.one(["reader"]) } })
    .type("folder", { relations: { parent: Relation.one(["folder", "shelf"]) } })
    .type("room", { permissions: { enter: (r) => r.union("enter") } })
    .type("hall", { relations: { door: Relation.one(["room"]) } })
    .type("lock", {
      relations: { opener: Relation.many(["reader", "book"], { change: "turn" }) },
      permissions: { turn: (r) => r.union("opener"), other: (r) => r.union("turn", "other") },
    });

  expectTypeOf(shelved.name).toEqualTypeOf<string>();

  // A relation made on its own, with explicit type arguments or a `change` of its own, is the same relation.
  const named = Relation.one<"reader", "retitle">(["reader"], { change: "retitle" });
  const noChange = Relation.many<"reader">(["reader"]);
  const plain = shelved.type<"note">("note", {});

  const own = shelved.type("note", {
    relations: { writer: Relation.one(["reader"], { change: "edit" }) },
    permissions: { edit: (r) => r.union("writer") },
  });

  expectTypeOf(plain.name).toEqualTypeOf<string>();
  expectTypeOf(own.name).toEqualTypeOf<string>();
  expectTypeOf(named).not.toBeAny();
  expectTypeOf(noChange).not.toBeAny();

  // A relation made before the type that takes it is checked against that type when it is taken.
  const loose = Relation.one(["reader"], { change: "edit" });
  const taken = shelved.type("memo", { relations: { writer: loose }, permissions: { edit: (r) => r.union("writer") } });

  expectTypeOf(taken.name).toEqualTypeOf<string>();

  // An undeclared type, relation or permission in a subject list, a union or a `change` is no model.
  // @ts-expect-error a subject type that is declared nowhere
  const nobody = () => start.type("note", { relations: { writer: Relation.one(["nobody"]) } });
  // @ts-expect-error one undeclared subject type among declared ones
  const mixed = () => start.type("note", { relations: { writer: Relation.many(["reader", "nobody"]) } });
  // @ts-expect-error a union that names no relation or permission of its type
  const missing = () => start.type("note", { permissions: { edit: (r) => r.union("nothing") } });
  // @ts-expect-error a `change` that is no permission of its type
  const wrongChange = () => start.type("note", { relations: { w: Relation.one(["reader"], { change: "nope" }) } });
  // @ts-expect-error a `change` that is a permission of another type, not of this one
  const otherChange = () => start.type("note", { relations: { w: Relation.one(["reader"], { change: "retitle" }) } });
  // @ts-expect-error a `change` that names a relation of the type, and a relation is no permission
  const relationChange = () => start.type("note", { relations: { w: Relation.one(["reader"], { change: "w" }) } });
  // @ts-expect-error a relation made on its own with a `change` the type does not have
  const looseChange = () => start.type("note", { relations: { w: Relation.one(["reader"], { change: "zzz" }) } });
  // @ts-expect-error a relation made on its own with a subject type that is declared nowhere
  const looseSubject = () => start.type("note", { relations: { w: Relation.one(["nobody"]) } });

  // A subject list names types only, so a subject set is no subject yet.
  // @ts-expect-error the `type#relation` spelling in a subject list
  const subjectSet = () => start.type("note", { relations: { writer: Relation.one(["book#editor"]) } });
  // @ts-expect-error the `type#relation` spelling next to a declared type
  const mixedSet = () => start.type("note", { relations: { writer: Relation.many(["reader", "reader#editor"]) } });
  // @ts-expect-error an empty subject list
  const emptyList = () => start.type("note", { relations: { writer: Relation.one([]) } });
  // @ts-expect-error explicit type arguments do not let an undeclared subject type through
  const explicit = () => start.type("note", { relations: { w: Relation.one<"nobody">(["nobody"]) } });

  // A name is a literal word: not a plain text, not a union, not a repeat, not empty and not one that holds `#`, `:` or a space.
  // @ts-expect-error a name typed as a plain text
  const plainName = (name: string) => start.type(name, {});
  // @ts-expect-error a name typed as a union of two words
  const unionName = (name: "left" | "right") => start.type(name, {});
  // @ts-expect-error a type that is declared already
  const twice = () => start.type("book", {});
  // @ts-expect-error a type that is declared already, written as an explicit type argument
  const twiceExplicit = () => start.type<"book">("book", {});
  // @ts-expect-error a plain text as an explicit type argument
  const explicitText = () => start.type<string>("note", {});
  // @ts-expect-error an empty name
  const emptyName = () => start.type("", {});
  // @ts-expect-error a name that holds a space
  const spaced = () => start.type("two words", {});
  // @ts-expect-error a name that holds a hash
  const hashed = () => start.type("two#words", {});
  // @ts-expect-error a name that holds a colon
  const coloned = () => start.type("two:words", {});

  // A permission is no relation of its own type.
  const reader = Relation.one(["reader"]);
  // @ts-expect-error a permission that shares the name of a relation
  const shared = () => start.type("x", { relations: { w: reader }, permissions: { w: (r) => r.union("w") } });

  return [
    nobody,
    mixed,
    missing,
    wrongChange,
    otherChange,
    relationChange,
    looseChange,
    looseSubject,
    subjectSet,
    mixedSet,
    emptyList,
    explicit,
    plainName,
    unionName,
    twice,
    twiceExplicit,
    explicitText,
    emptyName,
    spaced,
    hashed,
    coloned,
    shared,
  ];
};

// The positive lines run once when the file loads, so vitest by path runs them for real; each refusal is a thunk, kept and never called, since its line
// is the compile error.
const refusals = modelTypes(library());

it("M1 type: a model's types take a declared subject, union and change and refuse an undeclared one, a `type#relation` subject, an empty list and a name that is no literal word", () => {
  expectTypeOf(refusals).toBeArray();
});
