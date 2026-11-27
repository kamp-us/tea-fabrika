# @kalfa/permissions

What a subject may do on an object. This is the package's first slice: declaring a model. Checking a permission and guarding a
step come in the next slice of the same ticket (https://github.com/kamp-us/tea-fabrika/issues/2092). The words are in
[`GLOSSARY.md`](./GLOSSARY.md).

It imports no other package of this repository, no Node module and no telemetry, so anything can import it. The model in the
example is made up: the package names no app's type, relation or permission.

## Declare a model

```ts
import { Model, Relation } from "@kalfa/permissions";

const model = Model.make("library")
  .type("reader", {})
  .type("book", {
    relations: {
      author: Relation.one(["reader"], { change: "retitle" }), // one holder per book
      editor: Relation.many(["reader"], { change: "retitle" }),
    },
    permissions: {
      retitle: (r) => r.union("author"),
      edit: (r) => r.union("author", "editor"),
      read: (r) => r.union("edit"), // a permission may name another permission of the same type
    },
  });
```

- **`Model.make(name)`** starts a model with nothing declared. Each `.type(name, { relations, permissions })` gives a new model
  with that type added and leaves the one it was called on as it was.
- **`Relation.one` and `Relation.many`** say how many subjects may hold the relation on one object. They take the types of
  subject that may hold it, at least one, each a type declared before this one or this type itself (a folder in a folder). A
  subject list names types only: `type#relation` is not a subject.
- **`change`** is the permission a change to the relation must pass. It is optional: a relation with no `change` is one no write may
  touch, a fact another context owns that the app passes with each check.
- **`union`** holds when any one of its names holds. A name is a relation or a permission of the same type, and a permission may
  name itself or another that loops back: a loop alone holds nothing.

## What the compiler refuses

A subject type, a union name or a `change` that is declared nowhere, a `change` that is no permission of its type,
a type declared twice, a permission that shares a relation's name, an empty subject list and a name that is a plain `string`, a
union of words, empty, or holds `#`, `:` or a space do not compile.

## What throws when the model is declared

A value that got past the types with a cast throws at the `.type` call, so a bad model never loads. Each message names the model:

| Mistake | Message |
|---|---|
| a name that is empty or holds a character outside the rule | `model library: "<name>" is no name: a name starts with a lowercase letter and holds only letters, digits and _` |
| a type declared twice | `model library: type <type> is declared twice` |
| a permission named as a relation | `model library: <type>.<name> is both a relation and a permission` |
| an empty subject list or an empty union | `model library: <type>.<name> names nothing` |
| a subject type that is not declared yet | `model library: <type>.<relation> names <subject>, which is no declared type` |
| a `change` that is no permission of the type | `model library: <type>.<relation> changes by <change>, which is no permission of <type>` |

The name rule is `^[a-z][A-Za-z0-9_]*$`.
