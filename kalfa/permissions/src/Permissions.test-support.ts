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

/** A word: a lowercase letter, then up to six letters and digits, and no `_`. The model's own name and the texts a bad name is made from are words. */
const word: Arbitrary.Arbitrary<string> = Arbitrary.all({
  head: pick(LOWER),
  rest: Arbitrary.array(pick(INSIDE), { maxLength: 6 }),
}).pipe(Arbitrary.map(({ head, rest }) => `${head}${rest.join("")}`));

/** A name from the whole name rule: a lowercase letter, then any number of letters, digits and `_`, so it may be one letter and may hold no `_`. */
const name: Arbitrary.Arbitrary<string> = Arbitrary.all({
  head: pick(LOWER),
  rest: Arbitrary.array(pick([...INSIDE, "_"]), { maxLength: 7 }),
}).pipe(Arbitrary.map(({ head, rest }) => `${head}${rest.join("")}`));

/** How many names the pool holds, drawn and made up, however the draws repeat: a model of four types and a mistake's own names are far under it. */
const POOL = 60;

// ---- the model: what a draw says, and the data it makes

/** What a relation's draw says: a whole number picks each part, and the data below says which one it picked. */
interface RelationDraw {
  readonly holds: number;
  readonly subjects: ReadonlyArray<number>;
  readonly change: number;
}

interface TypeDraw {
  readonly relations: ReadonlyArray<RelationDraw>;
  readonly permissions: ReadonlyArray<ReadonlyArray<number>>;
}

/** One drawn value, from which a valid model and every mistake a declaration can hold are made. */
interface Texture {
  /** The model's own name. */
  readonly model: string;
  /** The word the mistaken declaration is made from. */
  readonly word: string;
  /** Where the one-letter names start in the alphabet. */
  readonly letter: number;
  /** Names drawn from the whole name rule, from which the types, relations and permissions take theirs. */
  readonly pool: ReadonlyArray<string>;
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
  /** Names no declaration of the model uses, for the mistakes and the branches to make their own from. */
  readonly spare: ReadonlyArray<string>;
}

const relationDraw: Arbitrary.Arbitrary<RelationDraw> = Arbitrary.all({
  holds: between(0, 1),
  subjects: Arbitrary.array(between(0, 50), { minLength: 1, maxLength: 3 }),
  change: between(0, 50),
});

const typeDraw: Arbitrary.Arbitrary<TypeDraw> = Arbitrary.all({
  relations: Arbitrary.array(relationDraw, { maxLength: 3 }),
  permissions: Arbitrary.array(Arbitrary.array(between(0, 50), { minLength: 1, maxLength: 3 }), { maxLength: 3 }),
});

/** Models of two to four types: the first holds every shape the plan names, and the others are drawn, each naming the types before it. */
export const textures: Arbitrary.Arbitrary<Texture> = Arbitrary.all({
  model: word,
  word,
  letter: between(0, 25),
  pool: Arbitrary.array(name, { minLength: POOL, maxLength: POOL }),
  extras: Arbitrary.array(typeDraw, { minLength: 1, maxLength: 3 }),
  pick: between(0, 50),
});

const at = <A>(items: ReadonlyArray<A>, index: number): A => Arr.getUnsafe(items, index % items.length);

/** The names a model takes its types, relations and permissions from, each used once: the forced shapes first, then the draws, then made-up fillers. */
const namePool = (texture: Texture): ReadonlyArray<string> => {
  const letters = [0, 1, 2, 3, 4, 5].map((each) => at(LOWER, texture.letter + each));
  const forced = [`${texture.word}Z9`, `${texture.word}__`, `${texture.word}_${texture.word}`, `${texture.word}_`];
  const all = Arr.dedupe([...letters, ...forced, ...texture.pool]);
  const filler = Array.from({ length: Math.max(0, POOL - all.length) }, (_, each) => `fill${each}`);

  return Arr.dedupe([...all, ...filler]);
};

/**
 * The first type: a relation one holder holds, one many hold, and one with no `change`; a type that names itself as a subject; a permission of
 * relations, one that names another permission, one that names a permission written after it, and one that loops on itself. Its names are the
 * ones the plan's name rule allows at its edges: a one-letter type, relation and permission, a name with no `_`, one with `_` inside and one
 * ending in it, and one with a capital and a digit.
 */
const skeleton = (names: ReadonlyArray<string>, word: string): Declaration => {
  const [name, r0, p0] = [at(names, 0), at(names, 1), at(names, 2)];
  const [r1, r2, p1, p2] = [`${word}Z9`, `${word}__`, `${word}_${word}`, `${word}_`];

  return {
    name,
    relations: [
      { name: r0, holds: "one", subjects: [name], change: p0 },
      { name: r1, holds: "many", subjects: [name], change: p1 },
      { name: r2, holds: "one", subjects: [name], change: undefined },
    ],
    permissions: [
      { name: p0, names: [r0, r1, p2] },
      { name: p1, names: [p0, r2] },
      { name: p2, names: [p2, p1] },
    ],
  };
};

/** A drawn type: its names are the next ones unused, each taken once. */
const drawn = (draw: TypeDraw, free: Array<string>, before: ReadonlyArray<string>): Declaration => {
  const take = (): string => free.shift() ?? "";
  const name = take();
  const subjects = [...before, name];
  const relations = draw.relations.map(take);
  const permissions = draw.permissions.map(take);

  return {
    name,
    relations: draw.relations.map((each, index) => ({
      name: at(relations, index),
      holds: each.holds === 0 ? "one" : "many",
      subjects: Arr.dedupe(each.subjects.map((choice) => at(subjects, choice))),
      change:
        permissions.length === 0 || each.change % (permissions.length + 1) === 0
          ? undefined
          : at(permissions, each.change - 1),
    })),
    permissions: draw.permissions.map((picks, index) => ({
      name: at(permissions, index),
      names: Arr.dedupe(picks.map((choice) => at([...relations, ...permissions], choice))),
    })),
  };
};

/** The valid model a texture makes. */
export const modelFrom = (texture: Texture): ModelSpec => {
  const names = namePool(texture);
  const first = skeleton(names, texture.word);

  const taken = new Set([
    ...first.relations.map((each) => each.name),
    ...first.permissions.map((each) => each.name),
    first.name,
  ]);

  const free = names.filter((each) => !taken.has(each));
  const types = [first];

  for (const draw of texture.extras) {
    types.push(
      drawn(
        draw,
        free,
        types.map((each) => each.name),
      ),
    );
  }

  return { name: texture.model, first, types, spare: free };
};

/** A name of the spare ones: no declaration of the model uses it, and each index is another name. */
export const spare = (spec: ModelSpec, index: number): string => at(spec.spare, index);

/** The shapes of name the whole name rule allows, which the valid model of every draw holds at least once. */
export const NAME_CLASSES: ReadonlyArray<string> = [
  "type: one letter",
  "relation: one letter",
  "permission: one letter",
  "no underscore, more than a letter",
  "underscore inside",
  "underscore last",
  "capital and digit",
];

/** The classes of name a model's own names reach, in the order of `NAME_CLASSES`. */
export const nameClasses = (spec: ModelSpec): ReadonlyArray<string> => {
  const [types, relations, permissions] = [
    spec.types.map((each) => each.name),
    spec.types.flatMap((each) => each.relations.map((relation) => relation.name)),
    spec.types.flatMap((each) => each.permissions.map((permission) => permission.name)),
  ];

  const all = [...types, ...relations, ...permissions];
  const letter = (each: string) => /^[a-z]$/u.test(each);

  const reached = [
    types.some(letter),
    relations.some(letter),
    permissions.some(letter),
    all.some((each) => /^[a-z][A-Za-z0-9]+$/u.test(each)),
    all.some((each) => /_[A-Za-z0-9]/u.test(each)),
    all.some((each) => each.endsWith("_")),
    all.some((each) => /[A-Z]/u.test(each) && /[0-9]/u.test(each)),
  ];

  return NAME_CLASSES.filter((_, index) => reached[index]);
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
  "union: a name no type has",
  "union: first of two",
  "union: last of two",
  "union: two undeclared, the first is named",
  "union: a relation of another type",
  "union: a permission of another type",
  "union: a relation spelled type#relation",
  "union: a type name",
  "union: its own type's name",
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
  const [fresh, rel, other] = [spare(spec, 0), spare(spec, 1), spare(spec, 2)] as const;
  const [permission, ghost, nope] = [spare(spec, 3), spare(spec, 4), spare(spec, 5)] as const;
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

  const union = (id: string, names: ReadonlyArray<string>, bad: string): Mistake =>
    made(
      id,
      { ...valid, permissions: [{ name: permission, names }] },
      `${fresh}.${permission} names ${bad}, which is no relation or permission of ${fresh}`,
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
    change("change: a permission no type has", nope),
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
    union("union: a name no type has", [ghost], ghost),
    union("union: first of two", [ghost, rel], ghost),
    union("union: last of two", [rel, ghost], ghost),
    union("union: two undeclared, the first is named", [ghost, nope], ghost),
    union("union: a relation of another type", [rel, at(firstType.relations, 0).name], at(firstType.relations, 0).name),
    union(
      "union: a permission of another type",
      [at(firstType.permissions, 0).name],
      at(firstType.permissions, 0).name,
    ),
    union("union: a relation spelled type#relation", [rel, setSpelling], setSpelling),
    union("union: a type name", [base], base),
    union("union: its own type's name", [rel, fresh], fresh),
    subject("subject: a type declared nowhere", [ghost], ghost),
    subject("subject: first of two", [ghost, base], ghost),
    subject("subject: last of two", [base, ghost], ghost),
    subject("subject: a relation spelled type#relation", [base, setSpelling], setSpelling),
    subject("subject: a permission spelled type#permission", [permissionSpelling], permissionSpelling),
    subject("subject: a permission name", [at(firstType.permissions, 0).name], at(firstType.permissions, 0).name),
  ];
};
