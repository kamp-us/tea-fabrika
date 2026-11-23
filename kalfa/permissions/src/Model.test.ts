// M2 and M3: a declaration that got past the types is refused when the model is declared, and a model is plain data. They run in memory on every pull
// request. The declarations are made through `Permissions.test-support.ts`, which hands a value the types refuse to the code with no cast.
import { expect, it } from "@effect/vitest";
import {
  declare,
  declareAll,
  MISTAKE_IDS,
  mistakes,
  modelFrom,
  refusal,
  SEED,
  start,
  textures,
} from "./Permissions.test-support.ts";

const check = (runs: number) => ({ arbitrary: { runs, seed: SEED } });

// M2. Plant: delete the name rule, and every `name:` class is red; delete the twice check, and `twice:` is red; delete the `change` check, and
// `change:` is red; delete the shared-name check, and `shared:` is red; delete the empty-list check, and `empty: a subject list` is red, and the
// empty-union check, and `empty: a union`; accept a subject written `type#relation` as declared, and the two spelled classes are red; stop
// checking a subject against the declared types, and `subject:` is red.
it.prop(
  "M2 declaration: a declaration that gets past the types throws, at once, with its exact message, and a valid one throws nothing",
  { texture: textures },
  ({ texture }) => {
    const spec = modelFrom(texture);
    const made = mistakes(spec, texture);

    expect(
      made.map((each) => each.id),
      "the generator reaches every class of mistake",
    ).toEqual(MISTAKE_IDS);

    const model = declareAll(start(spec.name), spec.types);

    expect(model.name, "the declared model keeps its name").toBe(spec.name);

    for (const mistake of made) {
      const before = declareAll(start(spec.name), spec.types);

      expect(() => declare(before, mistake.declaration), mistake.id).toThrow(
        refusal(`model ${spec.name}: ${mistake.message}`),
      );
    }
  },
  check(200),
);

// M3. Plant: make `.type` add its declaration to the model it was called on and return that one, and a branch sees the other's type, a
// sibling's repeat is refused, and `declare` returns the same model.
it.prop(
  "M3 plain data: declaring a type makes a new model and leaves the earlier one as it was, and two models made from one start share nothing",
  { texture: textures },
  ({ texture }) => {
    const spec = modelFrom(texture);
    const [shared, onlyA, onlyB] = [`${texture.word}_shared`, `${texture.word}_a`, `${texture.word}_b`];
    const known = spec.first;

    const holding = (name: string, subject: string) => ({
      name,
      relations: [{ name: held, holds: "many" as const, subjects: [subject], change: undefined }],
      permissions: [],
    });

    const none = { relations: [], permissions: [] };
    const held = `${texture.word}_holds`;

    const earlier = declareAll(start(spec.name), spec.types);
    const left = declare(earlier, { name: onlyA, ...none });
    const right = declare(earlier, { name: onlyB, ...none });

    // The call gives a new model, and each branch is a model of its own name.
    expect(left, "a new model").not.toBe(earlier);
    expect(right, "and another new one").not.toBe(left);
    expect(left.name, "with the name it began with").toBe(spec.name);

    // A type one branch declared is no type of the other, and no type of the earlier model.
    expect(() => declare(left, holding(shared, onlyA)), "the branch sees what it declared").not.toThrow();
    expect(() => declare(right, holding(shared, onlyA)), "a sibling's type is not seen").toThrow(
      refusal(`model ${spec.name}: ${shared}.${held} names ${onlyA}, which is no declared type`),
    );
    expect(() => declare(earlier, holding(shared, onlyA)), "the earlier model did not gain it").toThrow(
      refusal(`model ${spec.name}: ${shared}.${held} names ${onlyA}, which is no declared type`),
    );

    // The same name may be declared in each branch, and in the earlier model, but never twice in one.
    expect(() => declare(right, { name: onlyA, ...none }), "a sibling declares the same name").not.toThrow();
    expect(() => declare(earlier, { name: onlyA, ...none }), "so does the earlier model").not.toThrow();
    expect(() => declare(left, { name: onlyA, ...none }), "the branch that has it does not").toThrow(
      refusal(`model ${spec.name}: type ${onlyA} is declared twice`),
    );
    expect(() => declare(earlier, known), "the earlier model still has its own").toThrow(
      refusal(`model ${spec.name}: type ${known.name} is declared twice`),
    );

    // Two models begun apart share nothing.
    const apart = declareAll(start(spec.name), spec.types);

    expect(() => declare(apart, { name: onlyA, ...none }), "a model begun apart has none of it").not.toThrow();
    expect(() => declare(start(spec.name), known), "an empty model has no type of the others").not.toThrow();
  },
  check(100),
);
