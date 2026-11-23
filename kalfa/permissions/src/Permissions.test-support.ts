// What the laws of `@kalfa/permissions` share: the generators of a made-up model, the mistakes a declaration can hold, and the loose calls that let a
// declaration the types refuse reach the run-time checks. The package names no app's words, so every name here is drawn.
//
// A declaration made of drawn data cannot be typed by literals, so it is made through `Reflect.apply`, which takes any function and any arguments:
// that is the way a value "past the types" reaches the code in a test, with no cast. Each law applies, to the one value it draws, every class the
// plan names, so every class is reached in every run and no run can pass on less.
import { Arbitrary, Array as Arr, Schema } from "effect";
import { expect } from "vitest";
import { Model, Relation } from "./index.ts";

/** The shared seed: a fixed seed makes a red run repeat. */
export const SEED = 209201;

// ---- the small tools the generators are built from

/** A whole number from `minimum` to `maximum`. */
const between = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

/** One of the choices. */
const pick = <const A>(choices: ReadonlyArray<A>): Arbitrary.Arbitrary<A> =>
  between(0, choices.length - 1).pipe(Arbitrary.map((index) => Arr.getUnsafe(choices, index)));

const LOWER = [..."abcdefghijklmnopqrstuvwxyz"];

const INSIDE = [...LOWER, ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];

/** A word a name is made from: a lowercase letter, then up to six letters and digits, and no `_`, which the names made from it keep for themselves. */
const word: Arbitrary.Arbitrary<string> = Arbitrary.all({
  head: pick(LOWER),
  rest: Arbitrary.array(pick(INSIDE), { maxLength: 6 }),
}).pipe(Arbitrary.map(({ head, rest }) => `${head}${rest.join("")}`));

// ---- the model: what a draw says, and the data it makes

/** What a relation's draw says: a whole number picks each part, and the data below says which one it picked. */
interface RelationDraw {
  readonly holds: number;
  readonly subjects: ReadonlyArray<number>;
  readonly change: number;
}

interface TypeDraw {
  readonly word: string;
  readonly relations: ReadonlyArray<RelationDraw>;
  readonly permissions: ReadonlyArray<ReadonlyArray<number>>;
}

/** One drawn value, from which a valid model and every mistake a declaration can hold are made. */
interface Texture {
  /** The model's own name. */
  readonly model: string;
  /** The word the mistaken declaration is made from. */
  readonly word: string;
  /** The word of the first type, which always holds every shape of the plan. */
  readonly first: string;
  readonly extras: ReadonlyArray<TypeDraw>;
  readonly pick: number;
}

interface RelationSpec {
  readonly name: string;
  readonly holds: "one" | "many";
  readonly subjects: ReadonlyArray<string>;
  readonly change: string | undefined;
}

interface PermissionSpec {
  readonly name: string;
  readonly names: ReadonlyArray<string>;
}

/** One `.type` call, as plain data: the same data holds a valid declaration and one with a mistake in it. */
interface Declaration {
  readonly name: string;
  readonly relations: ReadonlyArray<RelationSpec>;
  readonly permissions: ReadonlyArray<PermissionSpec>;
}

interface ModelSpec {
  readonly name: string;
  /** The first type, the one that holds every shape. */
  readonly first: Declaration;
  readonly types: ReadonlyArray<Declaration>;
}

const relationDraw: Arbitrary.Arbitrary<RelationDraw> = Arbitrary.all({
  holds: between(0, 1),
  subjects: Arbitrary.array(between(0, 50), { minLength: 1, maxLength: 3 }),
  change: between(0, 50),
});

const typeDraw: Arbitrary.Arbitrary<TypeDraw> = Arbitrary.all({
  word,
  relations: Arbitrary.array(relationDraw, { maxLength: 3 }),
  permissions: Arbitrary.array(Arbitrary.array(between(0, 50), { minLength: 1, maxLength: 3 }), { maxLength: 3 }),
});

/** Models of two to four types: the first holds every shape the plan names, and the others are drawn, each naming the types before it. */
export const textures: Arbitrary.Arbitrary<Texture> = Arbitrary.all({
  model: word,
  word,
  first: word,
  extras: Arbitrary.array(typeDraw, { minLength: 1, maxLength: 3 }),
  pick: between(0, 50),
});

const at = <A>(items: ReadonlyArray<A>, index: number): A => Arr.getUnsafe(items, index % items.length);

/**
 * The first type: a relation one holder holds, one many hold, and one with no `change`; a type that names itself as a subject; a permission of
 * relations, one that names another permission, and one that loops on itself.
 */
const skeleton = (first: string): Declaration => {
  const name = `${first}_0`;
  const [r0, r1, r2] = [`${first}_r0`, `${first}_r1`, `${first}_r2`];
  const [p0, p1, p2] = [`${first}_p0`, `${first}_p1`, `${first}_p2`];

  return {
    name,
    relations: [
      { name: r0, holds: "one", subjects: [name], change: p0 },
      { name: r1, holds: "many", subjects: [name], change: p1 },
      { name: r2, holds: "one", subjects: [name], change: undefined },
    ],
    permissions: [
      { name: p0, names: [r0, r1] },
      { name: p1, names: [p0, r2] },
      { name: p2, names: [p2, p1] },
    ],
  };
};

const drawn = (draw: TypeDraw, index: number, before: ReadonlyArray<string>): Declaration => {
  const name = `${draw.word}_${index}`;
  const subjects = [...before, name];
  const permissions = draw.permissions.map((_, each) => `${draw.word}_p${each}`);
  const relations = draw.relations.map((_, each) => `${draw.word}_r${each}`);

  return {
    name,
    relations: draw.relations.map((each, index) => ({
      name: `${draw.word}_r${index}`,
      holds: each.holds === 0 ? "one" : "many",
      subjects: Arr.dedupe(each.subjects.map((choice) => at(subjects, choice))),
      change:
        permissions.length === 0 || each.change % (permissions.length + 1) === 0
          ? undefined
          : at(permissions, each.change - 1),
    })),
    permissions: draw.permissions.map((picks, index) => ({
      name: `${draw.word}_p${index}`,
      names: Arr.dedupe(picks.map((choice) => at([...relations, ...permissions], choice))),
    })),
  };
};

/** The valid model a texture makes. */
export const modelFrom = (texture: Texture): ModelSpec => {
  const first = skeleton(texture.first);
  const types = [first];

  for (const [index, draw] of texture.extras.entries()) {
    types.push(
      drawn(
        draw,
        index + 1,
        types.map((each) => each.name),
      ),
    );
  }

  return { name: texture.model, first, types };
};

// ---- a declaration through the loose door

/** What a rule's body is handed: the name `union` only, taking names as plain texts. */
interface Rules {
  readonly union: (...names: ReadonlyArray<string>) => object;
}

/** A model, as the root makes it with nothing declared. */
type Loose = ReturnType<typeof Model.make>;

const relationFrom = (relation: RelationSpec): ReturnType<typeof Relation.one> =>
  Reflect.apply(relation.holds === "one" ? Relation.one : Relation.many, undefined, [
    relation.subjects,
    relation.change === undefined ? undefined : { change: relation.change },
  ]);

/** A new model, with nothing declared. */
export const start = (name: string): Loose => Model.make(name);

/** `model` with the declaration made, as the types would let a value past them through: a new model, or a throw at the first mistake. */
export const declare = (model: Loose, declaration: Declaration): Loose => {
  const relations = Object.fromEntries(declaration.relations.map((each) => [each.name, relationFrom(each)]));

  const permissions = Object.fromEntries(
    declaration.permissions.map((each) => [each.name, (rules: Rules) => rules.union(...each.names)]),
  );

  return Reflect.apply(model.type, model, [declaration.name, { relations, permissions }]);
};

/** The model a list of declarations makes, in order. */
export const declareAll = (model: Loose, declarations: ReadonlyArray<Declaration>): Loose =>
  declarations.reduce(declare, model);

/** What a throw must be: its message is this text, whatever kind of throw it is. */
export const refusal = (message: string) => expect.objectContaining({ message });

// ---- the mistakes a declaration can hold

const NAME_RULE = "a name starts with a lowercase letter and holds only letters, digits and _";

const BAD_CHARACTERS = ["#", ":", " ", "-", ".", "é"];

/** Texts that are no name, each made from one word. */
const badNames = (text: string): ReadonlyArray<{ readonly id: string; readonly text: string }> => [
  { id: "empty", text: "" },
  ...BAD_CHARACTERS.flatMap((character) => [
    { id: `${character} inside`, text: `${text}${character}${text}` },
    { id: `${character} first`, text: `${character}${text}` },
    { id: `${character} last`, text: `${text}${character}` },
  ]),
  { id: "uppercase first", text: `${text.slice(0, 1).toUpperCase()}${text.slice(1)}` },
  { id: "digit first", text: `7${text}` },
  { id: "underscore first", text: `_${text}` },
];

interface Mistake {
  readonly id: string;
  /** The model's declarations before the mistaken one, which are valid. */
  readonly declaration: Declaration;
  /** What `.type` throws, after `model <name>: `. */
  readonly message: string;
}

/** The ids of the name mistakes, in the order they are made. */
const NAME_IDS: ReadonlyArray<string> = badNames("a").map((each) => each.id);

const POSITIONS = ["type", "relation", "permission"] as const;

/** Every class of mistake, in order, by id. A law checks the list it was handed against this one, so a class that was never made fails it. */
export const MISTAKE_IDS: ReadonlyArray<string> = [
  ...NAME_IDS.flatMap((id) => POSITIONS.map((position) => `name: ${position}, ${id}`)),
  "twice: as first declared",
  "twice: with another body",
  "change: a permission no type has",
  "change: a relation of the type",
  "change: a permission of another type",
  "shared: a relation and a permission",
  "empty: a subject list",
  "empty: a union",
  "subject: a type declared nowhere",
  "subject: first of two",
  "subject: last of two",
  "subject: a relation spelled type#relation",
  "subject: a permission spelled type#permission",
  "subject: a permission name",
];

/**
 * Every mistake `.type` must refuse, made from one valid model. Each is one declaration after the model's own, so the last call is the only one that
 * throws, and each carries the exact message its throw must have.
 */
export const mistakes = (spec: ModelSpec, texture: Texture): ReadonlyArray<Mistake> => {
  const fresh = `${texture.word}_final`;
  const [rel, other] = [`${fresh}_r0`, `${fresh}_r1`];
  const permission = `${fresh}_p0`;
  const ghost = `${texture.word}_ghost`;
  const firstType = spec.first;
  const firstRelation = at(firstType.relations, 0);
  const base = firstType.name;

  const valid: Declaration = {
    name: fresh,
    relations: [{ name: rel, holds: "one", subjects: [base], change: undefined }],
    permissions: [{ name: permission, names: [rel] }],
  };

  const made = (id: string, declaration: Declaration, message: string): Mistake => ({ id, declaration, message });
  const refused = (text: string) => `"${text}" is no name: ${NAME_RULE}`;

  const names = badNames(texture.word).flatMap((each) => [
    made(`name: type, ${each.id}`, { ...valid, name: each.text }, refused(each.text)),
    made(
      `name: relation, ${each.id}`,
      {
        ...valid,
        relations: [{ name: each.text, holds: "many", subjects: [base], change: undefined }],
        permissions: [],
      },
      refused(each.text),
    ),
    made(
      `name: permission, ${each.id}`,
      { ...valid, permissions: [{ name: each.text, names: [rel] }] },
      refused(each.text),
    ),
  ]);

  const repeated = at(spec.types, texture.pick);

  const subject = (id: string, subjects: ReadonlyArray<string>, bad: string): Mistake =>
    made(
      id,
      { ...valid, relations: [{ name: rel, holds: "many", subjects, change: undefined }], permissions: [] },
      `${fresh}.${rel} names ${bad}, which is no declared type`,
    );

  const change = (id: string, name: string): Mistake =>
    made(
      id,
      { ...valid, relations: [{ name: rel, holds: "one", subjects: [base], change: name }] },
      `${fresh}.${rel} changes by ${name}, which is no permission of ${fresh}`,
    );

  const setSpelling = `${firstType.name}#${firstRelation.name}`;
  const permissionSpelling = `${firstType.name}#${at(firstType.permissions, 0).name}`;

  return [
    ...names,
    made("twice: as first declared", repeated, `type ${repeated.name} is declared twice`),
    made("twice: with another body", { ...valid, name: repeated.name }, `type ${repeated.name} is declared twice`),
    change("change: a permission no type has", `${texture.word}_nope`),
    change("change: a relation of the type", rel),
    change("change: a permission of another type", at(firstType.permissions, 0).name),
    made(
      "shared: a relation and a permission",
      {
        ...valid,
        relations: [
          { name: rel, holds: "one", subjects: [base], change: undefined },
          { name: other, holds: "many", subjects: [base], change: undefined },
        ],
        permissions: [{ name: texture.pick % 2 === 0 ? rel : other, names: [rel] }],
      },
      `${fresh}.${texture.pick % 2 === 0 ? rel : other} is both a relation and a permission`,
    ),
    made(
      "empty: a subject list",
      { ...valid, relations: [{ name: rel, holds: "one", subjects: [], change: undefined }], permissions: [] },
      `${fresh}.${rel} names nothing`,
    ),
    made(
      "empty: a union",
      { ...valid, permissions: [{ name: permission, names: [] }] },
      `${fresh}.${permission} names nothing`,
    ),
    subject("subject: a type declared nowhere", [ghost], ghost),
    subject("subject: first of two", [ghost, base], ghost),
    subject("subject: last of two", [base, ghost], ghost),
    subject("subject: a relation spelled type#relation", [base, setSpelling], setSpelling),
    subject("subject: a permission spelled type#permission", [permissionSpelling], permissionSpelling),
    subject("subject: a permission name", [at(firstType.permissions, 0).name], at(firstType.permissions, 0).name),
  ];
};
