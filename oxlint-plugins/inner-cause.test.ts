import { join } from "node:path";
import { it } from "@effect/vitest";
// Ticket 2018, kalfa/. `fabrika/inner-cause` holds a kalfa error class that carries an inner failure in a field to setting it as its `cause`. L1 runs generated
// files in process through oxlint's RuleTester: one import spelling of Effect's `Schema` and one to six pieces that fire or must pass, one per line, so each
// line's own fire is told apart. L2 is one real oxlint run with the repo's config, since only the config says which paths the rule reads.
import { Array as Arr, Effect, pipe, Record as Rec, Schema } from "effect";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect } from "vitest";
import { innerCause } from "./inner-cause.ts";
import { plant } from "./plant.ts";

/** A promise the test waits on rejected: the test's own failure, with the rejection as its cause. */
class TestFailure extends Schema.TaggedError<TestFailure, { readonly brand: unique symbol }>()("TestFailure", {
  cause: Schema.Unknown,
}) {}

/** Waits on a promise inside the test's Effect, as `Effect.tryPromise` in its object form. */
const promised = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => TestFailure.make({ cause }) });

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();

RuleTester.it = (_name, fn) => fn();

// From the top of the repo, so the rule reads each path as oxlint gives it there.
const tester = new RuleTester({ cwd: join(import.meta.dirname, "..") });

const CODE = "fabrika(inner-cause)";

/** What every fire says: the key that holds the failure, and what to write. */
const FIRES = /This error holds a failure in `\w+` and has no cause/;

/** A product file of kalfa, where the rule reads. */
const CASE = "kalfa/git/src/Case.ts";

/** How a file reaches Effect's `Schema`: the import line, the module as the file writes it, and the name a shadowing parameter takes. */
type Spelling = {
  readonly header: string;
  readonly module: string;
  readonly root: string;
};

const SPELLINGS: ReadonlyArray<(alias: string) => Spelling> = [
  // The named import from the barrel.
  () => ({ header: 'import { Schema } from "effect";', module: "Schema", root: "Schema" }),
  // A renamed import.
  (alias) => ({ header: `import { Schema as ${alias} } from "effect";`, module: alias, root: alias }),
  // The module as a namespace.
  (alias) => ({ header: `import * as ${alias} from "effect/Schema";`, module: alias, root: alias }),
  // The barrel as a namespace.
  (alias) => ({ header: `import * as ${alias} from "effect";`, module: `${alias}.Schema`, root: alias }),
  // The name written as a string.
  (alias) => ({ header: `import { "Schema" as ${alias} } from "effect";`, module: alias, root: alias }),
  // The barrel's member read as a string.
  (alias) => ({ header: `import * as ${alias} from "effect";`, module: `${alias}["Schema"]`, root: alias }),
];

/** One error class on one line, over the fields given, with a body after them. */
const klass = (s: Spelling, i: number, fields: string, body = ""): string =>
  `class K${i} extends ${s.module}.TaggedError<K${i}>()("K${i}", ${fields}) {${body}}`;

/** The same-file error class a field holds: it holds no failure itself, so it passes. */
const inner = (s: Spelling, i: number): string =>
  `class In${i} extends ${s.module}.TaggedError<In${i}>()("In${i}", {}) {}`;

/** Lines that fire: an error class that holds a failure in a field and has no cause of the right form. */
const FIRING_LINES: ReadonlyArray<(s: Spelling, i: number) => string> = [
  // (a) a field that names a same-file error class, under `reason` and under another key.
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: In${i} }`)}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ inner: In${i} }`)}`,
  // (b) a union of same-file error classes, and a union of one and a schema that is no failure.
  (s, i) =>
    `${inner(s, i)} class Two${i} extends ${s.module}.TaggedError<Two${i}>()("Two${i}", {}) {} ${klass(s, i, `{ reason: ${s.module}.Union([In${i}, Two${i}]) }`)}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: ${s.module}.Union([${s.module}.String, In${i}]) }`)}`,
  // (c) inside each combinator that holds what its argument holds.
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: ${s.module}.optional(In${i}) }`)}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: ${s.module}.optionalKey(In${i}) }`)}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: ${s.module}.NullOr(In${i}) }`)}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: ${s.module}.UndefinedOr(In${i}) }`)}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: ${s.module}.NullishOr(In${i}) }`)}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reasons: ${s.module}.Array(In${i}) }`)}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reasons: ${s.module}.NonEmptyArray(In${i}) }`)}`,
  (s, i) =>
    `${inner(s, i)} ${klass(s, i, `{ reason: ${s.module}.optional(${s.module}.NullOr(${s.module}.Union([In${i}, ${s.module}.String]))) }`)}`,
  // (d) behind a same-file `const`: the field's schema, the whole fields object, a spread of it, and a name two steps deep.
  (s, i) => `${inner(s, i)} const R${i} = ${s.module}.Union([In${i}]); ${klass(s, i, `{ reason: R${i} }`)}`,
  (s, i) => `${inner(s, i)} const F${i} = { reason: In${i} }; ${klass(s, i, `F${i}`)}`,
  (s, i) => `${inner(s, i)} const F${i} = { reason: In${i} }; ${klass(s, i, `{ x: ${s.module}.String, ...F${i} }`)}`,
  (s, i) => `${inner(s, i)} const A${i} = In${i}; const B${i} = A${i}; ${klass(s, i, `{ reason: B${i} }`)}`,
  // (e) under `reason`, a name imported from a module that is not Effect's: a namespace member and a named import, renamed or not.
  (s, i) => `import * as Errors${i} from "./Errors.ts"; ${klass(s, i, `{ reason: Errors${i}.Failure }`)}`,
  (s, i) => `import { Failure${i} } from "./Errors.ts"; ${klass(s, i, `{ reason: Failure${i} }`)}`,
  (s, i) => `import { Failure as Held${i} } from "./Errors.ts"; ${klass(s, i, `{ reason: Held${i} }`)}`,
  (s, i) =>
    `import { Failure as Held${i} } from "./Errors.ts"; ${klass(s, i, `{ reason: ${s.module}.optional(Held${i}) }`)}`,
  // (f) `Schema.Defect()` under a key that is not `cause`, alone and inside a combinator.
  (s, i) => klass(s, i, `{ error: ${s.module}.Defect() }`),
  (s, i) => klass(s, i, `{ error: ${s.module}.optional(${s.module}.Defect()) }`),
  (s, i) => `const D${i} = ${s.module}.Defect(); ${klass(s, i, `{ error: D${i} }`)}`,
  // (h) a class that extends a same-file `const` that holds the call, and the class written as `Schema.Error`.
  (s, i) =>
    `${inner(s, i)} const Base${i} = ${s.module}.TaggedError<K${i}>()("K${i}", { reason: In${i} }); class K${i} extends Base${i} {}`,
  (s, i) => `${inner(s, i)} class K${i} extends ${s.module}.Error<K${i}>("K${i}")({ reason: In${i} }) {}`,
  // A class expression, and one fire however many fields hold a failure.
  (s, i) =>
    `${inner(s, i)} const E${i} = class extends ${s.module}.TaggedError<K${i}>()("K${i}", { reason: In${i} }) {};`,
  (s, i) =>
    `${inner(s, i)} ${klass(s, i, `{ reason: In${i}, other: ${s.module}.Defect(), more: ${s.module}.optional(In${i}) }`)}`,
  // (m) a `cause` member of the wrong form: undefined, another field, a part of the reason, a name, a getter, a static one, a method.
  (s, i) =>
    `${inner(s, i)} ${klass(s, i, `{ reason: In${i}, other: ${s.module}.String }`, "override readonly cause = undefined;")}`,
  (s, i) =>
    `${inner(s, i)} ${klass(s, i, `{ reason: In${i}, other: ${s.module}.String }`, "override readonly cause = this.other;")}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: In${i} }`, "override readonly cause = this.reason.cause;")}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: In${i} }`, "override readonly cause = reason;")}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: In${i} }`, "get cause() { return this.reason; }")}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: In${i} }`, "static cause = this.reason;")}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: In${i} }`, "cause() { return this.reason; }")}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: In${i} }`, "other = this.reason;")}`,
];

/** Lines that name a failure and carry it as the cause, or hold none, and must pass. */
const PASSING_LINES: ReadonlyArray<(s: Spelling, i: number) => string> = [
  // (i) the line that carries it: over a class, a union, an optional, a `const`, a string key, the second of two failures and a field read twice.
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: In${i} }`, "override readonly cause = this.reason;")}`,
  (s, i) =>
    `${inner(s, i)} ${klass(s, i, `{ reason: ${s.module}.Union([In${i}, ${s.module}.String]) }`, "override readonly cause = this.reason;")}`,
  (s, i) =>
    `${inner(s, i)} ${klass(s, i, `{ reason: ${s.module}.optional(In${i}) }`, "readonly cause = this.reason;")}`,
  (s, i) =>
    `${inner(s, i)} const F${i} = { reason: In${i} }; ${klass(s, i, `F${i}`, "override readonly cause = this.reason;")}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: In${i} }`, 'override readonly cause = this["reason"];')}`,
  (s, i) =>
    `${inner(s, i)} ${klass(s, i, `{ first: ${s.module}.String, second: In${i} }`, "override readonly cause = this.second;")}`,
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ error: ${s.module}.Defect() }`, "override readonly cause = this.error;")}`,
  (s, i) =>
    `import * as Errors${i} from "./Errors.ts"; ${klass(s, i, `{ reason: Errors${i}.Failure }`, "override readonly cause = this.reason;")}`,
  (s, i) =>
    `${inner(s, i)} const Base${i} = ${s.module}.TaggedError<K${i}>()("K${i}", { reason: In${i} }); class K${i} extends Base${i} { override readonly cause = this.reason; }`,
  // (j) a `cause` field: the class holds the failure as its own field, whatever its form (hidden-cause holds that).
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: In${i}, cause: ${s.module}.Defect() }`)}`,
  (s, i) => klass(s, i, `{ error: ${s.module}.Defect(), cause: ${s.module}.optional(${s.module}.Defect()) }`),
  (s, i) => klass(s, i, `{ cause: ${s.module}.Defect() }`),
  (s, i) => `${inner(s, i)} ${klass(s, i, `{ reason: In${i}, "cause": ${s.module}.String }`)}`,
  (s, i) =>
    `${inner(s, i)} const F${i} = { cause: ${s.module}.String }; ${klass(s, i, `{ reason: In${i}, ...F${i} }`)}`,
  // (k) schemas that hold no failure: literals, text, a union of structs, an imported schema under a key that is not `reason`, one from Effect under `reason`.
  (s, i) => klass(s, i, `{ reason: ${s.module}.Literals(["a", "b"]) }`),
  (s, i) => klass(s, i, `{ reason: ${s.module}.String }`),
  (s, i) =>
    klass(
      s,
      i,
      `{ reason: ${s.module}.Union([${s.module}.TaggedStruct("A", {}), ${s.module}.TaggedStruct("B", {})]) }`,
    ),
  (s, i) => `import * as Remote${i} from "./Remote.ts"; ${klass(s, i, `{ url: Remote${i}.Url }`)}`,
  (s, i) =>
    `import { Url as Held${i} } from "./Remote.ts"; ${klass(s, i, `{ url: Held${i}, other: ${s.module}.optional(Held${i}) }`)}`,
  (s, i) => `import { Option as Opt${i} } from "effect"; ${klass(s, i, `{ reason: Opt${i}.Option }`)}`,
  (s, i) => `import { Failure as Held${i} } from "effect/Schema"; ${klass(s, i, `{ reason: Held${i} }`)}`,
  (s, i) => `import { Failure as Held${i} } from "@effect/platform"; ${klass(s, i, `{ reason: Held${i} }`)}`,
  (s, i) => klass(s, i, `{ reason: missing${i}, other: ${s.module}.optional(missing${i}) }`),
  (s, i) => `class Plain${i} {} ${klass(s, i, `{ reason: Plain${i} }`)}`,
  (s, i) => `class Plain${i} extends Base {} ${klass(s, i, `{ reason: Plain${i} }`)}`,
  (s, i) => klass(s, i, `{ reason: ${s.module}.Union([, ${s.module}.String]) }`),
  // A name that leads back to itself ends the walk.
  (s, i) => `const A${i} = B${i}; const B${i} = A${i}; ${klass(s, i, `{ reason: A${i} }`)}`,
  // (l) a class that is no error class: `Class` and `TaggedClass`, a tag alone, no `extends`, another base, a call that is no member, and a `Schema` that is not Effect's.
  (s, i) => `${inner(s, i)} class N${i} extends ${s.module}.Class<N${i}>("N${i}")({ reason: In${i} }) {}`,
  (s, i) =>
    `${inner(s, i)} class N${i} extends ${s.module}.TaggedClass<N${i}>()("N${i}", { reason: In${i}, error: ${s.module}.Defect() }) {}`,
  (s, i) => `class N${i} extends ${s.module}.TaggedError<N${i}>()("N${i}") {}`,
  (_, i) => `class N${i} {}`,
  (_, i) => `class N${i} extends Base {}`,
  (_, i) => `class N${i} extends make()("N${i}", { reason: Failure }) {}`,
  (s, i) =>
    `${inner(s, i)} const n${i} = (${s.root}: any) => class extends ${s.module}.TaggedError<N${i}>()("N${i}", { reason: In${i}, error: ${s.module}.Defect() }) {};`,
  (_, i) =>
    `import { Schema as Own${i} } from "./own.ts"; class In${i} extends Own${i}.TaggedError<In${i}>()("In${i}", {}) {} class N${i} extends Own${i}.TaggedError<N${i}>()("N${i}", { reason: In${i}, error: Own${i}.Defect() }) {}`,
  (_, i) =>
    `import * as Own${i} from "effect/Cause"; class N${i} extends Own${i}.TaggedError<N${i}>()("N${i}", { error: Own${i}.Defect() }) {}`,
  (_, i) => `class N${i} extends unbound${i}.TaggedError<N${i}>()("N${i}", { error: unbound${i}.Defect() }) {}`,
  // Known misses, listed in the rule's opening comment: a failure behind a helper call, and fields from another file.
  (s, i) => `${inner(s, i)} const hold${i} = () => In${i}; ${klass(s, i, `{ reason: hold${i}() }`)}`,
  (s, i) => `import { fields as Held${i} } from "./Fields.ts"; ${klass(s, i, `Held${i}`)}`,
  // A comment and a string.
  (s) => `// class K extends ${s.module}.TaggedError<K>()("K", { reason: In }) {}`,
  (s, i) =>
    `const n${i} = 'class K extends ${s.module.replaceAll('"', "")}.TaggedError<K>()("K", { error: ${s.module.replaceAll('"', "")}.Defect() }) {}';`,
];

const piece = fc.oneof(
  fc.record({ kind: fc.constant("fires" as const), form: fc.nat({ max: FIRING_LINES.length - 1 }) }),
  fc.record({ kind: fc.constant("passes" as const), form: fc.nat({ max: PASSING_LINES.length - 1 }) }),
);

const generated = fc.record({
  spelling: fc.nat({ max: SPELLINGS.length - 1 }),
  alias: fc.stringMatching(/^[a-z]{2,6}$/).map((w) => `K${w}`),
  pieces: fc.array(piece, { minLength: 1, maxLength: 6 }),
});

/** The cases L1 draws. The mutation box caps a property's count to `MUTATE_RUNS`, so the tally is read only after all of these. */
const L1_RUNS = 400;

/** Every spelling and every form of every kind of piece the run drew, and how many cases that was. */
const reached = new Set<string>();

let drawn = 0;

const everything = [
  ...SPELLINGS.map((_, form) => `spelling ${form}`),
  ...FIRING_LINES.map((_, form) => `fires ${form}`),
  ...PASSING_LINES.map((_, form) => `passes ${form}`),
];

// L1. Plant: read only `Union` members, never a field's own value (a); read only a field's own value, never inside `Union` (b); do not unwrap `optional` (c);
// read no same-file `const` (d); count only same-file classes (e); leave `Defect` out (f); match the text `Schema.` (g); read only a direct call (h); read only the
// fields for a cause (i); read only the body (j); count any `reason` as a failure (k); count any imported name under any key (k); fire on any class (l); accept any
// `cause` member (m).
it("L1: reports exactly the classes that hold a failure and carry no cause, through every import spelling of Schema, every nesting and every form of cause", () => {
  fc.assert(
    fc.property(generated, ({ spelling, alias, pieces }) => {
      const s = SPELLINGS[spelling]!(alias);

      drawn += 1;
      reached.add(`spelling ${spelling}`);

      for (const { kind, form } of pieces) {
        reached.add(`${kind} ${form}`);
      }

      /** A line, and whether it must be reported. */
      const lines: ReadonlyArray<readonly [string, boolean]> = [
        [s.header, false],
        ...Arr.map(pieces, ({ kind, form }, i): readonly [string, boolean] =>
          kind === "fires" ? [FIRING_LINES[form]!(s, i), true] : [PASSING_LINES[form]!(s, i), false],
        ),
      ];

      const errors = Arr.flatMap(lines, ([, fires], i) => (fires ? [{ line: i + 1, message: FIRES }] : []));

      // The same file with every firing line taken out.
      const valid = pipe(
        lines,
        Arr.flatMap(([line, fires]) => (fires ? [] : [line])),
        Arr.join("\n"),
      );

      tester.run("inner-cause", innerCause, {
        valid: [{ code: valid, filename: CASE }],
        invalid:
          errors.length === 0
            ? []
            : [
                {
                  code: pipe(
                    lines,
                    Arr.map(([line]) => line),
                    Arr.join("\n"),
                  ),
                  filename: CASE,
                  errors,
                },
              ],
      });
    }),
    { seed: 119120, numRuns: L1_RUNS },
  );

  // Each spelling and each line was drawn at least once, but only a full run can say so: a capped run draws too few cases to reach every kind, so it skips
  // that check. Both numbers are asserted, so a lost counter, a gate that moved or a count that changed fails here and never skips quietly.
  const cap = Number(process.env.MUTATE_RUNS) || L1_RUNS;

  expect(drawn, "L1 drew its cases").toBe(Math.min(L1_RUNS, cap));
  expect(drawn >= L1_RUNS, "L1's reach is read at full depth only").toBe(cap >= L1_RUNS);

  if (drawn >= L1_RUNS) {
    expect(
      everything.filter((each) => !reached.has(each)),
      "every spelling and line the law lists was drawn",
    ).toEqual([]);
  }
});

const BODY = Arr.join(
  [
    'import { Schema } from "effect";',
    'class Inner extends Schema.TaggedError<Inner, { readonly brand: unique symbol }>()("Inner", {}) {}',
    'export class Bare extends Schema.TaggedError<Bare, { readonly brand: unique symbol }>()("Bare", { reason: Inner }) {}',
    'export class Held extends Schema.TaggedError<Held, { readonly brand: unique symbol }>()("Held", { reason: Inner }) {',
    "  override readonly cause = this.reason;",
    "}",
  ],
  "\n",
);

const HELD = [
  "kalfa/git/src/Case.ts",
  "kalfa/secrets/src/Case.ts",
  "kalfa/secrets/src/StoreTest.ts",
  "kalfa/ledger/src/internal/case.ts",
  "kalfa/github/src/Case.ts",
];

const LEFT_OUT = [
  "kalfa/git/src/Case.test.ts",
  "kalfa/secrets/src/case.test-support.ts",
  "kalfa/ledger/src/internal/case.test.ts",
  "next/packages/libfabrika/src/runtime/Case.ts",
  "packages/fabrika/src/case.ts",
];

it.live("L2: one real lint run per path kind, since only the real config holds which paths the rule reads", () =>
  Effect.gen(function* () {
    // scenario: the real config is the subject, one fixed body per path kind.
    const linted = yield* promised(() =>
      plant(Rec.fromEntries(Arr.map([...HELD, ...LEFT_OUT], (path) => [path, BODY]))),
    );

    // Product code: the bare wrapper fires once, at its line, and the one that carries its cause beside it passes.
    for (const path of HELD) {
      expect([path, linted(CODE, path)]).toEqual([path, [3]]);
    }

    // Tests, test support, libfabrika's runtime and today's version: nothing fires.
    for (const path of LEFT_OUT) {
      expect([path, linted(CODE, path)]).toEqual([path, []]);
    }
  }),
);
