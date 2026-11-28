// Law O8 of .kalfa/quests/kalfa-quality-oxlint-PLAN.md: `no-promises` refuses every Promise shape (`async`, `await`,
// `for await`, `new Promise`, `Promise.x(...)`, `.then`, `import()`, a `.catch` off a name not from Effect) and every Promise
// call the installed Effect exports, in each of the four spellings the rule sees, and passes a look-alike. The calls are read
// from the installed `effect` at test time: `Effect.promise`, `Effect.tryPromise`, each `*Promise` export of `Schema` and each
// `*AsyncIterable*` export of `Stream`. The four spellings are (h1) the module name as written, (h2) a renamed named import,
// (h3) a module namespace and (h4) the member imported by its own name. A call two names deep (`X.Effect.promise()`) is the
// README's known miss, so it is never drawn. Each generated file holds every call once, each under a drawn spelling, and
// imports from `effect` only the module names it draws, so a module name written without its import (h1) is drawn too.
//
// Plants, each run once on no-promises.ts and undone:
// - drop `toAsyncIterableEffect` from the list: its line stops firing;
// - read only the names in `MODULES`, not the file's Effect imports: the (h2) and (h3) spellings stop firing;
// - refuse every `.catch`: `Effect.catch(...)` fires;
// - empty `MODULES`: the module name written in a file that does not import it stops firing.
import { it } from "@effect/vitest";
import { Array as Arr } from "effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as fc from "fast-check";
import { noPromises } from "./no-promises.ts";
import { check, type Line } from "./Tester.test-support.ts";

type Part = "Effect" | "Schema" | "Stream";

/** Every Promise call of the installed Effect, by the module it lives in and its name. */
const CALLS: ReadonlyArray<readonly [Part, string]> = [
  ["Effect", "promise"],
  ["Effect", "tryPromise"],
  ...Arr.map(
    Arr.filter(Object.keys(Schema), (name) => name.endsWith("Promise")),
    (name): readonly [Part, string] => ["Schema", name],
  ),
  ...Arr.map(
    Arr.filter(Object.keys(Stream), (name) => name.includes("AsyncIterable")),
    (name): readonly [Part, string] => ["Stream", name],
  ),
];

/** One spelling of an import and of the call: the import line (none for the module name as written) and the written callee. */
type Spelling = readonly [header: string | null, callee: string];

/** The four spellings of one call, `alias` being the name a spelling that renames takes. */
const spellings = (part: Part, name: string, alias: string): ReadonlyArray<Spelling> => [
  [null, `${part}.${name}`],
  [`import { ${part} as ${alias} } from "effect";`, `${alias}.${name}`],
  [`import * as ${alias} from "effect/${part}";`, `${alias}.${name}`],
  [`import { ${name} } from "effect/${part}";`, name],
];

/** Every shape that makes or waits on a Promise, with the reports a line makes. */
const SHAPES: ReadonlyArray<Line> = [
  ["export const a = async () => 1;", 1],
  ["export async function b() { return 1; }", 1],
  ["export const d = async function () { await p; };", 2],
  ["export const e = new Promise<number>(() => undefined);", 1],
  ["export const f = Promise.resolve(1);", 1],
  ["export const g = Promise.all([p]);", 1],
  ["export const h = p.then((x) => x);", 1],
  ["export const i = p.catch(() => 0);", 1],
  ['export const k = import("./passes.ts");', 1],
  ["export const l = async () => { for await (const x of [p]) void x; };", 2],
  ["export const m = await p;", 1],
];

/** Lines that look like a Promise's and are not, or are Effect's own. None is reported. */
const PASSES: ReadonlyArray<Line> = [
  ['import { Effect as Eff, Option } from "effect";', 0],
  ['import * as Str from "effect/Stream";', 0],
  ["declare const thing: Eff.Effect<number, Error>;", 0],
  ["export const q1 = Eff.catch(thing, () => Eff.succeed(0));", 0],
  ["export const q2 = thing.pipe(Eff.catch(() => Eff.succeed(0)));", 0],
  ["export const q3 = Str.catch(Str.make(1), () => Str.make(2));", 0],
  ["export const q4 = Option.some(1);", 0],
  ["export const q5 = Eff.gen(function* () { return yield* thing; });", 0],
  ["export const q6 = function* () { return 1; };", 0],
  ["declare const other: { promise: () => number; tryPromise: () => number };", 0],
  ["export const q7 = other.promise() + other.tryPromise();", 0],
];

const generated = fc.record({
  // The module names the file imports from `effect`: none, some or all. A name left out is written with no import.
  imported: fc.subarray<Part>(["Effect", "Schema", "Stream"]),
  forms: fc.array(fc.nat({ max: 3 }), { minLength: CALLS.length, maxLength: CALLS.length }),
  alias: fc.stringMatching(/^[a-z]{2,6}$/).map((word) => `K${word}`),
});

it("O8 no-promises: refuses every Promise shape and each Promise call of the installed Effect in its four spellings", () => {
  fc.assert(
    fc.property(generated, ({ imported, forms, alias }) => {
      const calls = Arr.map(CALLS, ([part, name], i) => {
        const [header, callee] = spellings(part, name, `${alias}${i}`)[forms[i]!]!;
        const text = `export const c${i} = ${callee}(p);`;

        return { header, text };
      });

      const lines: ReadonlyArray<Line> = [
        ...(imported.length === 0 ? [] : [[`import { ${Arr.join(imported, ", ")} } from "effect";`, 0] satisfies Line]),
        ["declare const p: Promise<number>;", 0],
        ...Arr.flatMap(calls, ({ header }): ReadonlyArray<Line> => (header === null ? [] : [[header, 0]])),
        ...SHAPES,
        ...Arr.map(calls, ({ text }): Line => [text, 1]),
        ...PASSES,
      ];

      check("no-promises", noPromises, lines);
    }),
    { seed: 119120, numRuns: 100 },
  );
});
