// `fabrika/one-page-runtime`, the lint rule that took over `next/apps/fabrika/src/build.test.ts`'s
// format law (0591). Generated entries run in process through oxlint's RuleTester at the entry's path;
// one oxlint run per kind then proves the repo's own .oxlintrc.json turns the rule on for the page
// entry and nowhere else. The real entry itself is held by `pnpm lint`, which lints it.
//
// Plant, run once when the rule was written: count a `runMain` inside a function as the module's
// start (read every statement, not only the module's own), and the component case below passes: red.
// Plant, run once in the review's fix round: the rule as it stood before the fix, which skipped every
// import specifier and read identifiers only, and the three cases after "another run" pass: red.
// Plant, run once in the second fix round: the rule as it stood at e6432cb, which read a string only
// as the key inside a computed member, and the two cases after "a run read by a string key" pass: red.
// Plant, run once in the third fix round: the rule as it stood at 4269851, which read a string only when
// its whole value was a run name and skipped every template with an expression, and the two cases after
// "a run named by a string passed to Reflect.get" pass: red.
import { join } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { onePageRuntime } from "./one-page-runtime.ts";

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
// From the top of the repo, so the rule reads each path as oxlint gives it there.
const tester = new RuleTester({ cwd: join(import.meta.dirname, "..") });

const ENTRY = "next/apps/fabrika/src/entry/browser.tsx";
const CODE = "fabrika(one-page-runtime)";

const IMPORT = /Import `runMain` from `@kampus\/tuval\/browser` once/;
const START = /Start the page's one Effect program at module scope/;
const SECOND = /A second page runtime/;
const OTHER = /runs an Effect the page does not own/;

/** The real entry as it stood when the rule took over, with its program named `name` and started by `start`. */
const entry = (name: string, start: string, extra = "") =>
  [
    'import { Id } from "@kampus/libfabrika";',
    'import { start } from "@kampus/libfabrika/client/WindowStart";',
    'import { mount } from "@kampus/tuval";',
    'import { browserKey, browserRows, runMain } from "@kampus/tuval/browser";',
    'import { Effect, Layer } from "effect";',
    'import { Socket } from "effect/socket";',
    'import { keys, tezgah, window, windowFor } from "./views.ts";',
    "",
    `const ${name} = Effect.scoped(`,
    "  Effect.gen(function* () {",
    "    const origin = globalThis.location.origin;",
    '    const element = document.getElementById("root");',
    "    if (element === null) {",
    "      return;",
    "    }",
    '    const client = { platform: "browser", os: "unknown", has: [], label: "Browser" } as const;',
    '    const booting = yield* start({ tiles: [], tezgah, window, origin, build: "unknown", client });',
    "    const run = yield* booting.ready;",
    "    yield* mount(element, { run, machine: window, origin, windowFor, keys });",
    "    return yield* Effect.never;",
    "  }),",
    ").pipe(",
    "  Effect.provide(Layer.mergeAll(browserKey, browserRows, Socket.layerWebSocketConstructorGlobal, Id.Generator.layer)),",
    ");",
    "",
    extra,
    start,
    "",
  ].join("\n");

/** The three ways the entry may start its program. */
const starts = {
  piped: (name: string) => `${name}.pipe(runMain);`,
  direct: (name: string) => `runMain(${name});`,
  curried: (name: string) => `runMain({ disableErrorReporting: true })(${name});`,
} as const;

type Spelling = keyof typeof starts;

const spelling = fc.constantFrom<Spelling>("piped", "direct", "curried");
// A program name that is no keyword and no run function: lower-case letters, then `Page`.
const name = fc.stringMatching(/^[a-z]{1,8}$/).map((letters) => `${letters}Page`);

/** A run function read through a string key, and the report it must get. */
type Key = { readonly read: string; readonly error: RegExp };

/** A run function's name spelled as a string, and the report it must get. */
type Held = { readonly spelled: string; readonly error: RegExp };

/** The plan's four planted entries and the reviews' seven, each with the reports it must get, in order. */
const breaks = (
  program: string,
  start: string,
  from: string,
  run: string,
  inside: string,
  alias: string,
  key: Key,
  held: Held,
  templated: Held,
  worded: Held,
) => ({
  // No `runMain` from `@kampus/tuval/browser`: the import names another module.
  "no import": {
    code: entry(program, start).replace('from "@kampus/tuval/browser"', `from "${from}"`),
    errors: [IMPORT],
  },
  // `runMain` only inside a component: no start at module scope, and a read that is a second runtime.
  "inside a component": {
    code: entry(program, "", inside.replace("START", start)),
    errors: [START, SECOND],
  },
  // A second start at module scope.
  "a second start": {
    code: entry(program, `${start}\n${start}`),
    errors: [SECOND],
  },
  // A run function beside the start.
  "another run": {
    code: entry(program, start, `${run}(${program});`),
    errors: [OTHER],
  },
  // A second, renamed `runMain` from `@kampus/tuval/browser`, started beside the one start.
  "a renamed second import": {
    code: entry(program, start, `${alias}(${program});`).replace(
      "browserRows, runMain }",
      `browserRows, runMain, runMain as ${alias} }`,
    ),
    errors: [IMPORT],
  },
  // `runMain` renamed from another module, and started under that name.
  "a renamed import from another module": {
    code: entry(program, start, `import { runMain as ${alias} } from "${from}";\n${alias}(${program});`),
    errors: [IMPORT],
  },
  // A run function read through a string key.
  "a run read by a string key": {
    code: entry(program, start, `${key.read}(${program});`),
    errors: [key.error],
  },
  // A run function's name held in a variable, then read through it as a key.
  "a run named by a string in a variable": {
    code: entry(program, start, `const held = ${held.spelled};\nEffect[held](${program});`),
    errors: [held.error],
  },
  // A run function's name passed to `Reflect.get`.
  "a run named by a string passed to Reflect.get": {
    code: entry(program, start, `Reflect.get(Effect, ${held.spelled})(${program});`),
    errors: [held.error],
  },
  // A run function's name in a piece of a template that holds an expression, read as a key.
  "a run named in a template with an expression": {
    code: entry(program, start, `const tail = "";\nEffect[${templated.spelled}](${program});`),
    errors: [templated.error],
  },
  // A run function's name as one word inside a longer string, cut out and read as a key.
  "a run named inside a longer string": {
    code: entry(program, start, `Effect[${worded.spelled}](${program});`),
    errors: [worded.error],
  },
});

const from = fc.constantFrom("@kampus/tuval", "effect", "@effect/platform-browser", "@kampus/tuval/electron");
const run = fc.constantFrom("Effect.runPromise", "Effect.runFork", "Effect.runSync", "runtime.runPromise");

// A local name that is no keyword, no `runMain` and no run function: lower-case letters, then `Boot`.
const alias = fc.stringMatching(/^[a-z]{1,8}$/).map((letters) => `${letters}Boot`);

// Each spelling of a string key: double and single quotes, a template with no expressions, and `runMain`.
const keys: ReadonlyArray<Key> = [
  { read: 'Effect["runPromise"]', error: OTHER },
  { read: "Effect['runFork']", error: OTHER },
  { read: "runtime[`runSync`]", error: OTHER },
  { read: 'browser["runMain"]', error: SECOND },
];

const key = fc.constantFrom(...keys);

// A run function's name as a string anywhere: each run name, `runMain` among them, in each quote.
const runNames = ["runPromise", "runFork", "runSync", "runMain"] as const;
const quotes = ['"', "'", "`"] as const;
const held = fc.record({ name: fc.constantFrom(...runNames), quote: fc.constantFrom(...quotes) });

// A run function's name in a template piece beside an expression, `tail`, which is the empty string.
const pieces = {
  after: (run: string) => `\`${run}\${tail}\``,
  before: (run: string) => `\`\${tail}${run}\``,
  between: (run: string) => `\`\${tail}${run}\${tail}\``,
} as const;

const templated = fc.record({
  name: fc.constantFrom(...runNames),
  piece: fc.constantFrom<keyof typeof pieces>("after", "before", "between"),
});

// A run function's name as one word of a longer string, in each quote, cut out by `split`.
const wordings = {
  dotted: (run: string, quote: string) => `${quote}Effect.${run}${quote}.split(".")[1]`,
  spaced: (run: string, quote: string) => `${quote}${run} now${quote}.split(" ")[0]`,
} as const;

const worded = fc.record({
  name: fc.constantFrom(...runNames),
  wording: fc.constantFrom<keyof typeof wordings>("dotted", "spaced"),
  quote: fc.constantFrom(...quotes),
});

/** The report a run function's name must get: `runMain` is a second runtime, any other a foreign run. */
const errorFor = (run: string) => (run === "runMain" ? SECOND : OTHER);

const inside = fc.constantFrom(
  "export const App = () => {\n  START\n  return null;\n};",
  "export function App() {\n  START\n  return null;\n}",
  "useEffect(() => {\n  START\n}, []);",
);

it("refuses each planted entry with its own reports and passes the entry in every start spelling", () => {
  const reached = new Set<string>();
  fc.assert(
    fc.property(
      name,
      spelling,
      from,
      run,
      inside,
      alias,
      key,
      held,
      templated,
      worded,
      (program, how, other, runner, place, local, read, hold, piece, word) => {
        const start = starts[how](program);
        reached.add(how);
        reached.add(read.read);
        reached.add(hold.name);
        reached.add(hold.quote);
        reached.add(`template ${piece.name}`);
        reached.add(`piece ${piece.piece}`);
        reached.add(`word ${word.name}`);
        reached.add(`wording ${word.wording}`);
        reached.add(`word quote ${word.quote}`);
        const spelled = { spelled: `${hold.quote}${hold.name}${hold.quote}`, error: errorFor(hold.name) };
        const inTemplate = { spelled: pieces[piece.piece](piece.name), error: errorFor(piece.name) };
        const inWords = { spelled: wordings[word.wording](word.name, word.quote), error: errorFor(word.name) };
        const planted = breaks(program, start, other, runner, place, local, read, spelled, inTemplate, inWords);
        tester.run("one-page-runtime", onePageRuntime, {
          valid: [{ code: entry(program, start), filename: ENTRY }],
          invalid: Object.values(planted).map(({ code, errors }) => ({
            code,
            filename: ENTRY,
            errors: errors.map((message) => ({ message })),
          })),
        });
      },
    ),
    { seed: 119120, numRuns: 30 },
  );
  // Coverage: each start spelling, string key, held run name and quote, each run name in each template
  // piece and each run name in each wording and quote was drawn, so each was planted against.
  expect([...reached].sort()).toEqual(
    [
      "curried",
      "direct",
      "piped",
      ...keys.map((k) => k.read),
      ...runNames,
      ...quotes,
      ...runNames.map((n) => `template ${n}`),
      ...Object.keys(pieces).map((p) => `piece ${p}`),
      ...runNames.map((n) => `word ${n}`),
      ...Object.keys(wordings).map((w) => `wording ${w}`),
      ...quotes.map((q) => `word quote ${q}`),
    ].sort(),
  );
});

it("scenario: the repo's config turns the rule on for the page entry and for no other file", async () => {
  // scenario: oxlint's own path matching is the subject, so each kind is one oxlint run on the
  // config as it is; the generated law above holds the rule's reach.
  const start = starts.piped("page");
  const planted = breaks(
    "page",
    start,
    "@kampus/tuval",
    "Effect.runPromise",
    "export const App = () => {\n  START\n  return null;\n};",
    "againBoot",
    { read: 'Effect["runPromise"]', error: OTHER },
    { spelled: '"runFork"', error: OTHER },
    { spelled: pieces.after("runPromise"), error: OTHER },
    { spelled: wordings.dotted("runPromise", '"'), error: OTHER },
  );
  const elsewhere = "next/apps/fabrika/src/entry/other.tsx";
  const clean = await plant({ [ENTRY]: entry("page", start), [elsewhere]: planted["a second start"].code });
  expect(clean(CODE, ENTRY)).toEqual([]);
  expect(clean(CODE, elsewhere)).toEqual([]);

  for (const [kind, { code, errors }] of Object.entries(planted)) {
    const linted = await plant({ [ENTRY]: code }, (fire) => fire.message);
    const fires = linted(CODE, ENTRY);
    expect(fires, kind).toHaveLength(errors.length);
    expect(
      fires.every((message, n) => errors[n]?.test(message) === true),
      `${kind}: ${fires.join(" | ")}`,
    ).toBe(true);
  }
}, 120_000);
