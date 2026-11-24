import { join } from "node:path";
import { it } from "@effect/vitest";
// Ticket 1310, kalfa/. `fabrika/hidden-cause` keeps `Schema.Redacted` out of a kalfa error class's fields, and holds each `cause` to `Schema.Defect()` or
// `Hidden.Cause`. L1 runs generated files in process through oxlint's RuleTester: an import spelling of Effect's `Schema`, one of `Hidden`, and some
// pieces that fire and some that must pass, one per line. L2 is one real oxlint run with the repo's config, since only the config says which paths
// the rule reads.
import { Array as Arr, Effect, pipe, Record as Rec, Schema } from "effect";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect } from "vitest";
import { hiddenCause } from "./hidden-cause.ts";
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

const CODE = "fabrika(hidden-cause)";

const REDACTED = /writes its value in full through `Schema.toCodecJson`/;

const CAUSE = /An error's `cause` is `Schema.Defect\(\)` or `Hidden.Cause`/;

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

/** How a file reaches the hidden cause: the import line, how a cause is written, the file it sits in, and whether it is the hidden cause of Diagnostics. */
type Hiding = {
  readonly header: string;
  readonly cause: string;
  readonly filename: string;
  readonly valid: boolean;
};

const SECRETS = "kalfa/secrets/src/Case.ts";

const OWN = "kalfa/diagnostics/src/Case.ts";

const HIDINGS: ReadonlyArray<(alias: string) => Hiding> = [
  () => ({
    header: 'import * as Hidden from "@kalfa/diagnostics/Hidden";',
    cause: "Hidden.Cause",
    filename: SECRETS,
    valid: true,
  }),
  (alias) => ({
    header: `import * as ${alias} from "@kalfa/diagnostics/Hidden";`,
    cause: `${alias}.Cause`,
    filename: SECRETS,
    valid: true,
  }),
  (alias) => ({
    header: `import * as ${alias} from "@kalfa/diagnostics/Hidden";`,
    cause: `${alias}["Cause"]`,
    filename: SECRETS,
    valid: true,
  }),
  () => ({
    header: 'import { Cause } from "@kalfa/diagnostics/Hidden";',
    cause: "Cause",
    filename: SECRETS,
    valid: true,
  }),
  (alias) => ({
    header: `import { Cause as ${alias} } from "@kalfa/diagnostics/Hidden";`,
    cause: alias,
    filename: SECRETS,
    valid: true,
  }),
  // `./Hidden.ts` is the hidden cause from inside the package's own folder of sources, and anything else from anywhere else.
  () => ({ header: 'import * as Hidden from "./Hidden.ts";', cause: "Hidden.Cause", filename: OWN, valid: true }),
  () => ({ header: 'import { Cause } from "./Hidden.ts";', cause: "Cause", filename: OWN, valid: true }),
  () => ({ header: 'import * as Hidden from "./Hidden.ts";', cause: "Hidden.Cause", filename: SECRETS, valid: false }),
  () => ({
    header: 'import * as Hidden from "./Hidden.ts";',
    cause: "Hidden.Cause",
    filename: "kalfa/diagnostics/other/Case.ts",
    valid: false,
  }),
  () => ({ header: 'import { Cause } from "./Hidden.ts";', cause: "Cause", filename: SECRETS, valid: false }),
  // Another member of the module, a name that is not `Cause` imported under that name, and a module that only looks like it.
  () => ({
    header: 'import * as Hidden from "@kalfa/diagnostics/Hidden";',
    cause: "Hidden.placeholder",
    filename: SECRETS,
    valid: false,
  }),
  () => ({
    header: 'import { placeholder as Cause } from "@kalfa/diagnostics/Hidden";',
    cause: "Cause",
    filename: SECRETS,
    valid: false,
  }),
  () => ({
    header: 'import * as Hidden from "@kalfa/ledger/Hidden";',
    cause: "Hidden.Cause",
    filename: SECRETS,
    valid: false,
  }),
  () => ({
    header: 'import { Cause } from "effect";',
    cause: "Cause",
    filename: SECRETS,
    valid: false,
  }),
  // A default import binds no name of the module, and a cause that is no import at all.
  () => ({
    header: 'import Hidden from "@kalfa/diagnostics/Hidden";',
    cause: "Hidden.Cause",
    filename: SECRETS,
    valid: false,
  }),
  () => ({ header: "const Hidden = { Cause: 1 };", cause: "Hidden.Cause", filename: SECRETS, valid: false }),
  () => ({ header: "", cause: "Hidden.Cause", filename: SECRETS, valid: false }),
];

/** One error class on one line, over the fields given. */
const klass = (s: Spelling, i: number, fields: string): string =>
  `class K${i} extends ${s.module}.TaggedError<K${i}>()("K${i}", ${fields}) {}`;

/** Lines that fire as refusal one: a `Redacted` call in an error class's fields, at any depth, directly or through a same-file `const`. */
const REDACTED_LINES: ReadonlyArray<(s: Spelling, i: number) => string> = [
  // (a) as a field of an error class, and as its cause.
  (s, i) => klass(s, i, `{ x: ${s.module}.Redacted(${s.module}.String) }`),
  (s, i) => klass(s, i, `{ cause: ${s.module}.Redacted(${s.module}.Defect()) }`),
  // (b) the call nested.
  (s, i) => klass(s, i, `{ x: ${s.module}.optional(${s.module}.Redacted(${s.module}.String)) }`),
  (s, i) => klass(s, i, `{ x: ${s.module}.Union([${s.module}.Redacted(${s.module}.String), ${s.module}.String]) }`),
  (s, i) => klass(s, i, `{ x: ${s.module}.Struct({ y: ${s.module}.Redacted(${s.module}.String) }) }`),
  // (c) through a same-file `const`: the whole fields object, a spread of it, one field, and one field inside a call.
  (s, i) => `const F${i} = { x: ${s.module}.Redacted(${s.module}.String) }; ${klass(s, i, `F${i}`)}`,
  (s, i) => `const F${i} = { x: ${s.module}.Redacted(${s.module}.String) }; ${klass(s, i, `{ ...F${i} }`)}`,
  (s, i) => `const C${i} = ${s.module}.Redacted(${s.module}.String); ${klass(s, i, `{ cause: C${i} }`)}`,
  (s, i) =>
    `const C${i} = ${s.module}.Redacted(${s.module}.String); ${klass(s, i, `{ x: ${s.module}.optional(C${i}) }`)}`,
  // (f) the other Redacted.
  (s, i) => klass(s, i, `{ x: ${s.module}.RedactedFromValue(${s.module}.String) }`),
  // (h) the class written as `Schema.Error`.
  (s, i) => `class K${i} extends ${s.module}.Error<K${i}>("K${i}")({ x: ${s.module}.Redacted(${s.module}.String) }) {}`,
  // The member written as a string, a class expression, a `const` in an array, a `const` behind a spread behind a `const`, and a `Struct` in a `const`.
  (s, i) => klass(s, i, `{ x: ${s.module}["Redacted"](${s.module}.String) }`),
  (s, i) =>
    `const E${i} = class extends ${s.module}.TaggedError<K${i}>()("K${i}", { x: ${s.module}.Redacted(${s.module}.String) }) {};`,
  (s, i) =>
    `const C${i} = ${s.module}.Redacted(${s.module}.String); ${klass(s, i, `{ x: ${s.module}.Union([C${i}, ${s.module}.String]) }`)}`,
  (s, i) =>
    `const A${i} = { x: ${s.module}.Redacted(${s.module}.String) }; const B${i} = { ...A${i} }; ${klass(s, i, `B${i}`)}`,
  (s, i) =>
    `const S${i} = ${s.module}.Struct({ y: ${s.module}.Redacted(${s.module}.String) }); ${klass(s, i, `{ x: S${i} }`)}`,
  (s, i) =>
    klass(s, i, `{ x: ${s.module}.String, cause: ${s.module}.optional(${s.module}.Redacted(${s.module}.Defect())) }`),
];

/** Lines that fire as refusal two: a `cause` that is none of the four forms. */
const CAUSE_LINES: ReadonlyArray<(s: Spelling, i: number) => string> = [
  // (g) a cause that is no Defect and no hidden cause.
  (s, i) => klass(s, i, `{ cause: ${s.module}.Unknown }`),
  (s, i) => klass(s, i, `{ cause: ${s.module}.Any }`),
  (s, i) => klass(s, i, `{ cause: ${s.module}.String }`),
  (s, i) => klass(s, i, `{ cause: ${s.module}.declare((u: unknown): u is string => true) }`),
  (s, i) => klass(s, i, `{ cause: ${s.module}.optional(${s.module}.String) }`),
  (s, i) => klass(s, i, `{ cause: ${s.module}.optionalKey(${s.module}.Defect()) }`),
  (s, i) => `const C${i} = ${s.module}.Unknown; ${klass(s, i, `{ cause: C${i} }`)}`,
  // (j) `Hidden.Cause` with `Hidden` from another module, and a local object named `Hidden`.
  (s, i) => `import * as Alien${i} from "@kalfa/ledger/Hidden"; ${klass(s, i, `{ cause: Alien${i}.Cause }`)}`,
  (s, i) =>
    `const make${i} = () => { const Hidden = { Cause: ${s.module}.String }; return ${klass(s, i, "{ cause: Hidden.Cause }")}; };`,
  // The key written as a string, and as a computed string.
  (s, i) => klass(s, i, `{ "cause": ${s.module}.String }`),
  (s, i) => klass(s, i, `{ ["cause"]: ${s.module}.String }`),
  // A form that is not quite one: `optional` with two arguments, with none, twice, and `Defect` or `optional` not called.
  (s, i) => klass(s, i, `{ cause: ${s.module}.optional(${s.module}.Defect(), ${s.module}.String) }`),
  (s, i) => klass(s, i, `{ cause: ${s.module}.optional() }`),
  (s, i) => klass(s, i, `{ cause: ${s.module}.optional(${s.module}.optional(${s.module}.Defect())) }`),
  (s, i) => klass(s, i, `{ cause: ${s.module}.Defect }`),
  (s, i) => klass(s, i, `{ cause: ${s.module}.optional(${s.module}.Defect) }`),
  (s, i) => klass(s, i, `{ cause: ${s.module}.Defect?.() }`),
  (s, i) => klass(s, i, `{ cause: ${s.module}.optional?.(${s.module}.Defect()) }`),
  // A cause named by a `let`, a pattern and a call: no same-file `const` holds it.
  (s, i) => `let C${i} = ${s.module}.Defect(); ${klass(s, i, `{ cause: C${i} }`)}`,
  (s, i) => `const { C${i} } = make(); ${klass(s, i, `{ cause: C${i} }`)}`,
  (s, i) => `const C${i} = make(); ${klass(s, i, `{ cause: C${i} }`)}`,
  // A cause inside a `const` fields object, whole and spread, and through a `const` that is spread twice.
  (s, i) => `const F${i} = { cause: ${s.module}.String }; ${klass(s, i, `F${i}`)}`,
  (s, i) => `const F${i} = { cause: ${s.module}.String }; ${klass(s, i, `{ ...F${i} }`)}`,
  (s, i) =>
    `const F${i} = { cause: ${s.module}.String }; const G${i} = { ...F${i} }; ${klass(s, i, `{ x: ${s.module}.String, ...G${i} }`)}`,
  // One `cause` is one fire, however many classes spread the `const` that holds it, and a name nothing binds is no form of a cause.
  (s, i) =>
    `const F${i} = { cause: ${s.module}.String }; ${klass(s, i, `F${i}`)} ${klass(s, i + 1000, `{ ...F${i} }`)}`,
  (s, i) => klass(s, i, `{ cause: missing${i} }`),
  (s, i) => klass(s, i, `{ cause: ${s.module}.optional(missing${i}) }`),
  // A cause that is a literal, an arrow, an array or a text: no form either.
  (s, i) => klass(s, i, "{ cause: 1 }"),
  (s, i) => klass(s, i, "{ cause: () => 1 }"),
  (s, i) => klass(s, i, "{ cause: [] }"),
  // The class written as `Schema.Error`, and as an expression.
  (s, i) => `class K${i} extends ${s.module}.Error<K${i}>("K${i}")({ cause: ${s.module}.String }) {}`,
  (s, i) => `const E${i} = class extends ${s.module}.TaggedError<K${i}>()("K${i}", { cause: ${s.module}.String }) {};`,
];

/** Lines that name the hidden cause as this file's `Hidden` does: they pass when it is the hidden cause of Diagnostics, and fire when it only looks like it. */
const HIDDEN_LINES: ReadonlyArray<(s: Spelling, h: Hiding, i: number) => string> = [
  (s, h, i) => klass(s, i, `{ cause: ${h.cause} }`),
  (s, h, i) => klass(s, i, `{ cause: ${s.module}.optional(${h.cause}) }`),
  (s, h, i) => `const H${i} = ${h.cause}; ${klass(s, i, `{ cause: H${i} }`)}`,
  (s, h, i) => `class K${i} extends ${s.module}.Error<K${i}>("K${i}")({ cause: ${h.cause} }) {}`,
];

/** Lines that name `Redacted` or a `cause` and must pass, in any file. */
const PASSING_LINES: ReadonlyArray<(s: Spelling, h: Hiding, i: number) => string> = [
  // (i) a `Redacted` outside an error class's fields.
  (s, _, i) => `const n${i} = ${s.module}.Struct({ x: ${s.module}.Redacted(${s.module}.String) });`,
  (s, _, i) => `const n${i} = ${s.module}.is(${s.module}.Redacted(${s.module}.String));`,
  (s, _, i) => `const n${i} = ${s.module}.RedactedFromValue(${s.module}.String);`,
  // A class whose `Schema` is not Effect's.
  (s, _, i) =>
    `const n${i} = (${s.root}: any) => class extends ${s.module}.TaggedError<N${i}>()("N${i}", { x: ${s.module}.Redacted(x) }) {};`,
  (s, _, i) => `const n${i} = (${s.root}: { Redacted: (x: unknown) => unknown }) => ${s.module}.Redacted(x);`,
  // The four forms of a cause, in this file's spelling of `Hidden`, and one through a same-file `const`.
  (s, _, i) => klass(s, i, `{ cause: ${s.module}.Defect() }`),
  (s, _, i) => klass(s, i, `{ cause: ${s.module}.optional(${s.module}.Defect()) }`),
  (s, _, i) => `const D${i} = ${s.module}.Defect(); ${klass(s, i, `{ cause: D${i} }`)}`,
  (s, _, i) => `const D${i} = ${s.module}.optional(${s.module}.Defect()); ${klass(s, i, `{ cause: D${i} }`)}`,
  // A class of other fields, and a `cause` that is not the error's own: nested in a `Struct`.
  (s, _, i) => klass(s, i, `{ x: ${s.module}.String, y: ${s.module}.Struct({ cause: ${s.module}.Unknown }) }`),
  // A class that is no error class: no `extends`, another base, `Class` and `TaggedClass`, a tag alone, a call that is no member, a struct.
  (_, __, i) => `class N${i} {}`,
  (_, __, i) => `class N${i} extends Base {}`,
  (s, _, i) =>
    `class N${i} extends ${s.module}.Class<N${i}>("N${i}")({ x: ${s.module}.Redacted(${s.module}.String), cause: ${s.module}.String }) {}`,
  (s, _, i) =>
    `class N${i} extends ${s.module}.TaggedClass<N${i}>()("N${i}", { x: ${s.module}.Redacted(${s.module}.String), cause: ${s.module}.String }) {}`,
  (s, _, i) => `class N${i} extends ${s.module}.TaggedError<N${i}>()("N${i}") {}`,
  (s, _, i) => `class N${i} extends make()("N${i}", { x: ${s.module}.Redacted(${s.module}.String) }) {}`,
  (s, _, i) => `class N${i} extends ${s.module}.Struct({ cause: ${s.module}.String }) {}`,
  // A call that is optional is no call of the member: the old text patterns did not match it either.
  (s, _, i) => klass(s, i, `{ x: ${s.module}.Redacted?.(${s.module}.String) }`),
  // A key that is computed from a name is no `cause`, and neither is the key of another field.
  (s, _, i) => `const cause${i} = "c"; ${klass(s, i, `{ [cause${i}]: ${s.module}.String }`)}`,
  (s, _, i) => klass(s, i, `{ causes: ${s.module}.String, because: ${s.module}.Unknown }`),
  // A `Schema` that is not Effect's: a file of the repo, a member of another module, a member two levels down, a default import, and a name nothing binds.
  (_, __, i) =>
    `import { Schema as Own${i} } from "./own.ts"; class N${i} extends Own${i}.TaggedError<N${i}>()("N${i}", { x: Own${i}.Redacted(1), cause: Own${i}.String }) {}`,
  (_, __, i) =>
    `import * as Own${i} from "./own.ts"; class N${i} extends Own${i}.Schema.TaggedError<N${i}>()("N${i}", { x: Own${i}.Schema.Redacted(1) }) {}`,
  (_, __, i) =>
    `import * as Own${i} from "effect/Cause"; class N${i} extends Own${i}.TaggedError<N${i}>()("N${i}", { x: Own${i}.Redacted(1) }) {}`,
  (_, __, i) =>
    `import * as Own${i} from "effect"; class N${i} extends Own${i}.Cause.TaggedError<N${i}>()("N${i}", { x: Own${i}.Cause.Redacted(1) }) {}`,
  (_, __, i) =>
    `import Own${i} from "effect"; class N${i} extends Own${i}.TaggedError<N${i}>()("N${i}", { x: Own${i}.Redacted(1) }) {}`,
  (_, __, i) =>
    `import { Cause as Own${i} } from "effect"; class N${i} extends Own${i}.TaggedError<N${i}>()("N${i}", { x: Own${i}.Redacted(1) }) {}`,
  (_, __, i) =>
    `class N${i} extends unbound${i}.TaggedError<N${i}>()("N${i}", { x: unbound${i}.Redacted(1), cause: unbound${i}.String }) {}`,
  (_, __, i) =>
    `class N${i} extends a${i}.b.Schema.TaggedError<N${i}>()("N${i}", { x: a${i}.b.Schema.Redacted(1) }) {}`,
  // Fields that loop back on themselves, through a value and through a spread, end the walk, and a `const` that holds no object holds no field.
  (s, _, i) => `const A${i} = { x: B${i} }; const B${i} = { x: A${i} }; ${klass(s, i, `A${i}`)}`,
  (s, _, i) => `const A${i} = { ...B${i} }; const B${i} = { ...A${i} }; ${klass(s, i, `A${i}`)}`,
  (s, _, i) => `const A${i} = { x: B${i} }; const B${i} = { x: A${i} }; ${klass(s, i, `{ x: A${i}, y: B${i} }`)}`,
  (s, _, i) => `const F${i} = make(); ${klass(s, i, `F${i}`)}`,
  (s, _, i) => `const F${i} = make(); ${klass(s, i, `{ ...F${i} }`)}`,
  // An array with a hole in it, and a name nothing binds, in a field.
  (s, _, i) => klass(s, i, `{ x: ${s.module}.Union([, ${s.module}.String]) }`),
  (s, _, i) => klass(s, i, `{ x: missing${i}, y: ${s.module}.optional(missing${i}) }`),
  // A comment and a string.
  (s) => `// ${s.module}.Redacted(x) in a comment`,
  (s, _, i) =>
    `const n${i} = 'class K extends ${s.module.replaceAll('"', "")}.TaggedError<K>()("K", { cause: ${s.module.replaceAll('"', "")}.Redacted(x) })';`,
];

/** Imports that look like Effect's and are not, on every file. None fires. */
const OTHERS = ['import { Redacted as Mine } from "./mine.ts";', "const mine = Mine.make(1);"];

const piece = fc.oneof(
  fc.record({ kind: fc.constant("redacted" as const), form: fc.nat({ max: REDACTED_LINES.length - 1 }) }),
  fc.record({ kind: fc.constant("cause" as const), form: fc.nat({ max: CAUSE_LINES.length - 1 }) }),
  fc.record({ kind: fc.constant("hidden" as const), form: fc.nat({ max: HIDDEN_LINES.length - 1 }) }),
  fc.record({ kind: fc.constant("passes" as const), form: fc.nat({ max: PASSING_LINES.length - 1 }) }),
);

const generated = fc.record({
  spelling: fc.nat({ max: SPELLINGS.length - 1 }),
  hiding: fc.nat({ max: HIDINGS.length - 1 }),
  alias: fc.stringMatching(/^[a-z]{2,6}$/).map((w) => `K${w}`),
  pieces: fc.array(piece, { minLength: 1, maxLength: 6 }),
});

/** Every spelling, every hiding and every form of every kind of piece the run drew: the law fails when one was never reached. */
const reached = new Set<string>();

const everything = [
  ...SPELLINGS.map((_, form) => `spelling ${form}`),
  ...HIDINGS.map((_, form) => `hiding ${form}`),
  ...REDACTED_LINES.map((_, form) => `redacted ${form}`),
  ...CAUSE_LINES.map((_, form) => `cause ${form}`),
  ...HIDDEN_LINES.map((_, form) => `hidden ${form}`),
  ...PASSING_LINES.map((_, form) => `passes ${form}`),
];

it("L1: reports exactly the refusals it should, through every import spelling of Schema and of Hidden, every nesting and every form of cause", () => {
  fc.assert(
    fc.property(generated, ({ spelling, hiding, alias, pieces }) => {
      const s = SPELLINGS[spelling]!(alias);
      const h = HIDINGS[hiding]!(`H${alias}`);

      reached.add(`spelling ${spelling}`);
      reached.add(`hiding ${hiding}`);

      for (const { kind, form } of pieces) {
        reached.add(`${kind} ${form}`);
      }

      /** A line, and the message it must be reported with, if any. */
      const lines: ReadonlyArray<readonly [string, RegExp | null]> = [
        [s.header, null],
        [h.header, null],
        ...Arr.map(OTHERS, (line) => [line, null] as const),
        ...Arr.map(pieces, ({ kind, form }, i): readonly [string, RegExp | null] => {
          switch (kind) {
            case "redacted":
              return [REDACTED_LINES[form]!(s, i), REDACTED];
            case "cause":
              return [CAUSE_LINES[form]!(s, i), CAUSE];
            case "hidden":
              return [HIDDEN_LINES[form]!(s, h, i), h.valid ? null : CAUSE];
            case "passes":
              return [PASSING_LINES[form]!(s, h, i), null];
          }
        }),
      ];

      const errors = Arr.flatMap(lines, ([, message], i) => (message === null ? [] : [{ line: i + 1, message }]));

      // The same file with every firing line taken out.
      const valid = pipe(
        lines,
        Arr.flatMap(([line, message]) => (message === null ? [line] : [])),
        Arr.join("\n"),
      );

      tester.run("hidden-cause", hiddenCause, {
        valid: [{ code: valid, filename: h.filename }],
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
                  filename: h.filename,
                  errors,
                },
              ],
      });
    }),
    { seed: 119120, numRuns: 400 },
  );

  expect(
    everything.filter((each) => !reached.has(each)),
    "every spelling, hiding and line the law lists was drawn",
  ).toEqual([]);
});

const BODY = Arr.join(
  [
    'import { Schema } from "effect";',
    'import * as Hidden from "@kalfa/diagnostics/Hidden";',
    'export class Bare extends Schema.TaggedError<Bare, { readonly brand: unique symbol }>()("Bare", { cause: Schema.Redacted(Schema.Defect()) }) {}',
    'export class Held extends Schema.TaggedError<Held, { readonly brand: unique symbol }>()("Held", { cause: Hidden.Cause }) {}',
  ],
  "\n",
);

const HELD = [
  "kalfa/secrets/src/Plant.ts",
  "kalfa/secrets/src/StoreTest.ts",
  "kalfa/config/src/Plant.ts",
  "kalfa/config/src/internal/plant.ts",
  "kalfa/diagnostics/src/Plant.ts",
  "kalfa/ledger/src/Plant.ts",
];

const LEFT_OUT = [
  "kalfa/secrets/src/Plant.test.ts",
  "kalfa/secrets/src/plant.test-support.ts",
  "kalfa/config/src/internal/plant.test.ts",
  "next/packages/libfabrika/src/runtime/Plant.ts",
  "packages/fabrika/src/plant.ts",
];

it.live("L2: one real lint run per path kind, since only the real config holds which paths the rule reads", () =>
  Effect.gen(function* () {
    // scenario: the real config is the subject, one fixed body per path kind.
    const linted = yield* promised(() =>
      plant(Rec.fromEntries(Arr.map([...HELD, ...LEFT_OUT], (path) => [path, BODY]))),
    );

    // Product code: the bare cause fires once, at its line, and the hidden cause beside it passes.
    for (const path of HELD) {
      expect([path, linted(CODE, path)]).toEqual([path, [3]]);
    }

    // Tests, test support, libfabrika's runtime and today's version: nothing fires.
    for (const path of LEFT_OUT) {
      expect([path, linted(CODE, path)]).toEqual([path, []]);
    }
  }),
);
