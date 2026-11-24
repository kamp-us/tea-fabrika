/**
 * The checks a declaration passes when it is made, and the declared data a model keeps.
 *
 * **Details**
 *
 * The types refuse every mistake a written declaration can hold. A value that got past them with a cast is refused here, at the call that
 * declares it, with a message that names the model and the place.
 */
import { Schema } from "effect";
import type { Holds, Relation } from "../Relation.ts";

/** The value a rule's body makes: the names it holds together. Only a union exists so far. */
export interface Rule {
  readonly kind: "union";
  readonly names: ReadonlyArray<string>;
}

/** What a rule's body is handed to build its rule from. */
export interface Rules<Names extends string> {
  readonly union: (first: Names, ...rest: ReadonlyArray<Names>) => Rule;
}

/** One declared relation, as the walk reads it. */
interface RelationData {
  readonly holds: Holds;
  readonly subjects: ReadonlyArray<string>;
  readonly change: string | undefined;
}

/** One declared type: its relations and its permissions, each by name. */
interface TypeData {
  readonly relations: ReadonlyMap<string, RelationData>;
  readonly permissions: ReadonlyMap<string, Rule>;
}

/** Every declared type of a model, by name. */
export type Declared = ReadonlyMap<string, TypeData>;

/** The helper a rule's body gets. It takes any text, since a value past the types is refused below with its place. */
const rules: Rules<string> = { union: (...names) => ({ kind: "union", names }) };

const NAME_RULE = "a name starts with a lowercase letter and holds only letters, digits and _";

const isName = Schema.is(Schema.String.check(Schema.isPattern(/^[a-z][A-Za-z0-9_]*$/u)));

const refusal = (model: string, text: string): Error => new Error(`model ${model}: ${text}`);

/**
 * Adds one type to a model's declared types and gives the result, or throws at the first mistake.
 *
 * **Details**
 *
 * The earlier map is left as it was. The order of the checks is the order of the messages: names, a repeat, a name that is both a relation
 * and a permission, each relation, each permission read in full, the names each union takes, then each `change`.
 */
export const declareType = (
  model: string,
  declared: Declared,
  name: string,
  relations: Readonly<Record<string, Relation<string, Holds, string>>>,
  permissions: Readonly<Record<string, (rules: Rules<string>) => Rule>>,
): Declared => {
  const relationNames = Object.keys(relations);
  const permissionNames = Object.keys(permissions);

  for (const each of [name, ...relationNames, ...permissionNames]) {
    if (!isName(each)) {
      throw refusal(model, `"${each}" is no name: ${NAME_RULE}`);
    }
  }

  if (declared.has(name)) {
    throw refusal(model, `type ${name} is declared twice`);
  }

  for (const each of permissionNames) {
    if (relationNames.includes(each)) {
      throw refusal(model, `${name}.${each} is both a relation and a permission`);
    }
  }

  const kept = new Map<string, RelationData>();

  for (const [each, relation] of Object.entries(relations)) {
    if (relation.subjects.length === 0) {
      throw refusal(model, `${name}.${each} names nothing`);
    }

    const missing = relation.subjects.find((subject) => subject !== name && !declared.has(subject));

    if (missing !== undefined) {
      throw refusal(model, `${name}.${each} names ${missing}, which is no declared type`);
    }

    kept.set(each, { holds: relation.holds, subjects: relation.subjects, change: relation.change });
  }

  const unions = new Map<string, Rule>();

  for (const [each, body] of Object.entries(permissions)) {
    const rule = body(rules);

    if (rule.names.length === 0) {
      throw refusal(model, `${name}.${each} names nothing`);
    }

    unions.set(each, rule);
  }

  for (const [each, rule] of unions) {
    const missing = rule.names.find((union) => !kept.has(union) && !unions.has(union));

    if (missing !== undefined) {
      throw refusal(model, `${name}.${each} names ${missing}, which is no relation or permission of ${name}`);
    }
  }

  for (const [each, relation] of kept) {
    if (relation.change !== undefined && !unions.has(relation.change)) {
      throw refusal(model, `${name}.${each} changes by ${relation.change}, which is no permission of ${name}`);
    }
  }

  return new Map([...declared, [name, { relations: kept, permissions: unions }]]);
};
