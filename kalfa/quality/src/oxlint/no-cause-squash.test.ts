// Law O2 of .kalfa/quests/kalfa-quality-oxlint-PLAN.md, the copied law 2: `no-cause-squash` reports exactly Effect's
// `squash`, through every import spelling and use form, and never a look-alike, a comment, a string or a type position.
// Each case is one generated file in process through oxlint's RuleTester: an import spelling, some uses and some
// neighbors that must pass, one per line.
//
// Plants, each run once on no-cause-squash.ts and undone:
// - resolve `Cause` by its written name and not through the file's scope: a parameter or a local named `Cause` fires;
// - drop the `ImportDeclaration` visitor: `import { squash } from "effect/Cause"` stops firing.
import { it } from "@effect/vitest";
import { Array as Arr } from "effect";
import * as fc from "fast-check";
import { noCauseSquash } from "./no-cause-squash.ts";
import { check, type Line } from "./Tester.test-support.ts";

/**
 * How a file reaches Effect's `squash`: the import line, the module as the file writes it (`null`
 * when `squash` itself is imported by name), and the name a shadowing parameter takes.
 */
interface Spelling {
  readonly header: string;
  readonly module: string | null;
  readonly local: string;
}

const SPELLINGS: ReadonlyArray<(alias: string) => Spelling> = [
  // The named import from the barrel.
  () => ({ header: 'import { Cause } from "effect";', module: "Cause", local: "Cause" }),
  // The module as a namespace, under its own name and under another.
  () => ({ header: 'import * as Cause from "effect/Cause";', module: "Cause", local: "Cause" }),
  (alias) => ({ header: `import * as ${alias} from "effect/Cause";`, module: alias, local: alias }),
  // A renamed import.
  (alias) => ({ header: `import { Cause as ${alias} } from "effect";`, module: alias, local: alias }),
  // The barrel as a namespace.
  (alias) => ({ header: `import * as ${alias} from "effect";`, module: `${alias}.Cause`, local: alias }),
  // `squash` by name, under its own name and under another. It fires once, at the import.
  () => ({ header: 'import { squash } from "effect/Cause";', module: null, local: "squash" }),
  (alias) => ({ header: `import { squash as ${alias} } from "effect/Cause";`, module: null, local: alias }),
];

/** A use of `squash` on the module, numbered so two on one file declare two names. All fire. */
const USES: ReadonlyArray<(module: string, i: number) => string> = [
  (m, i) => `const u${i} = ${m}.squash(x);`,
  (m, i) => `const u${i} = ${m}.squash;`,
  // A reference with no call.
  (m, i) => `const u${i} = xs.map(${m}.squash);`,
  // The member as a string.
  (m, i) => `const u${i} = ${m}["squash"](x);`,
  (m, i) => `const u${i} = ${m}?.squash(x);`,
  (m, i) => `const { squash: u${i} } = ${m};`,
  (m, i) => `export const u${i} = (cause: unknown) => f(${m}.squash(cause));`,
];

/** Lines that name `squash` or `Cause` and use nothing of Effect's. None fires, in any file. */
const NEIGHBORS: ReadonlyArray<(spelling: Spelling, i: number) => string> = [
  // Another object's `squash`, and a `Cause` that is not Effect's.
  (_, i) => `const n${i} = git.squash(x);`,
  (_, i) => `const n${i} = Mine.squash(x);`,
  (_, i) => `const n${i} = mine(x);`,
  // The object of the member is a call, or a member of something that is not `Cause`.
  (_, i) => `const n${i} = make().squash(x);`,
  (_, i) => `const n${i} = Mine.Other.squash(x);`,
  (s, i) => `const n${i} = (${s.local}: { squash: (u: unknown) => unknown }) => ${s.local}.squash(x);`,
  (s, i) => `function n${i}(${s.local}: (u: unknown) => unknown) { return ${s.local}(x); }`,
  (s, i) => `const n${i} = () => { const ${s.local} = { squash: (u: unknown) => u }; return ${s.local}.squash(x); };`,
  // A comment, a string and a type position.
  (s) => `// ${s.module ?? "Cause"}.squash(x) is what the rule refuses`,
  (s, i) => `const n${i} = "${s.module ?? "Cause"}.squash(x)";`,
  (s, i) => `type N${i} = typeof ${s.module === null ? s.local : `${s.module}.squash`};`,
  // The module's other members.
  (s, i) => `const n${i} = ${s.module === null ? "0" : `${s.module}.findErrorOption`};`,
  (s, i) => `const n${i} = ${s.module === null ? "0" : `${s.module}.squashed`};`,
];

/** Imports that look like Effect's and are not, on every file. None fires. */
const OTHERS = [
  'import { Cause as Mine, squash as mine } from "./mine.ts";',
  'import type { squash as Squash } from "effect/Cause";',
];

const piece = fc.oneof(
  fc.record({ fires: fc.constant(true), form: fc.nat({ max: USES.length - 1 }) }),
  fc.record({ fires: fc.constant(false), form: fc.nat({ max: NEIGHBORS.length - 1 }) }),
);

const generated = fc.record({
  spelling: fc.constantFrom(...SPELLINGS),
  alias: fc.stringMatching(/^[a-z]{2,6}$/).map((word) => `K${word}`),
  pieces: fc.array(piece, { minLength: 1, maxLength: 6 }),
});

it("O2 no-cause-squash: reports exactly the uses of Effect's squash, through every import spelling and use form", () => {
  fc.assert(
    fc.property(generated, ({ spelling, alias, pieces }) => {
      const at = spelling(alias);
      const { module } = at;

      // With `squash` imported by name, the import is the one use, and a call of it adds no report.
      const lines: ReadonlyArray<Line> = [
        [at.header, module === null ? 1 : 0],
        ...Arr.map(OTHERS, (line): Line => [line, 0]),
        ...Arr.map(pieces, ({ fires, form }, i): Line => {
          if (!fires) {
            return [NEIGHBORS[form]!(at, i), 0];
          }

          return module === null ? [`const u${i} = ${at.local}(x);`, 0] : [USES[form]!(module, i), 1];
        }),
      ];

      check("no-cause-squash", noCauseSquash, lines);
    }),
    { seed: 119120, numRuns: 100 },
  );
});
