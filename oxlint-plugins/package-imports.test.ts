// p32 and p65, strict layers: the law of `fabrika/package-imports`, the names of our own packages
// each part of next/ may import (ticket 987, moved from the exam's `layers.test.ts`). Each generated
// file sits at a path in one part, or in no part, and imports names drawn from every part's list and
// from names no list holds. Each case runs in process through oxlint's RuleTester with the plan's
// table; one oxlint run over every case's file then proves the repo's own `.oxlintrc.json` holds the
// same table at the same paths.
import { join } from "node:path";
import { Array as Arr, pipe } from "effect";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { packageImports } from "./package-imports.ts";

const CODE = "fabrika(package-imports)";
const LIBRARY = "@kampus/libfabrika";
const VITEST = "@kampus/vitest";

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
// From the top of the repo, so the rule reads each path as oxlint gives it there.
const tester = new RuleTester({ cwd: join(import.meta.dirname, "..") });

const TRANSPORT = [
  `${LIBRARY}/transport`,
  ...Arr.map(
    ["Answer", "ClientKey", "ClientRows", "Hello", "Link", "Sshsig", "Webauthn", "Wire"],
    (front) => `${LIBRARY}/transport/${front}`,
  ),
];

/** One part of the table: a type, not an interface, and mutable, as RuleTester takes JSON values. */
type Part = { name: string; files: string[]; may: string[]; tests?: string[] };

/**
 * The plan's table ("Strict layers"), written out here so a change to the config's copy shows: each
 * part, its globs, the exact names its files may import, and for the library the packages its tests
 * may import.
 */
const TABLE: { scope: string; parts: Part[] } = {
  scope: "@kampus/",
  parts: [
    { name: "test primitives", files: ["next/packages/vitest/**"], may: [], tests: [VITEST] },
    {
      name: "library suites",
      files: ["next/packages/libfabrika/**/*Test.ts", "next/packages/libfabrika/**/*.test-support.ts"],
      may: [VITEST],
      tests: [LIBRARY, VITEST],
    },
    { name: "library", files: ["next/packages/libfabrika/**"], may: [], tests: [LIBRARY, VITEST] },
    { name: "desktop", files: ["next/packages/tuval/src/desktop/**"], may: [LIBRARY] },
    {
      name: "window",
      files: ["next/packages/tuval/src/window/**"],
      may: [
        LIBRARY,
        ...TRANSPORT,
        `${LIBRARY}/client/WindowMachine`,
        `${LIBRARY}/client/WindowStart`,
        `${LIBRARY}/client/Headless`,
        // Desk S2a, S2b and S4: the key table, the window's side of tezgah, and tezgah's wire shapes
        // and drawn geometry.
        `${LIBRARY}/client/Keys`,
        `${LIBRARY}/client/Tezgah`,
        `${LIBRARY}/tezgah/Layout`,
        `${LIBRARY}/tezgah/Workspace`,
        `${LIBRARY}/tezgah/Fold`,
        "@kampus/fabrika-design",
        "@kampus/fabrika-design/tokens.css",
      ],
    },
    { name: "dom", files: ["next/packages/tuval/src/dom/**"], may: [] },
    { name: "browser", files: ["next/packages/tuval/src/browser/**"], may: TRANSPORT },
    {
      name: "electron",
      files: ["next/packages/tuval/src/electron/**"],
      may: [...TRANSPORT, `${LIBRARY}/coordination`],
    },
    { name: "headless", files: ["next/packages/tuval/src/headless/**"], may: [] },
    { name: "program window", files: ["next/programs/*/src/**/*.tsx"], may: [LIBRARY, "@kampus/tuval"] },
    {
      name: "program suites",
      files: ["next/programs/*/src/**/*Test.ts", "next/programs/*/src/**/*.test-support.ts"],
      may: [LIBRARY, VITEST],
    },
    { name: "program", files: ["next/programs/**"], may: [LIBRARY] },
  ],
};

/** The name is one of these packages, root or subpath. */
const within =
  (...packages: ReadonlyArray<string>) =>
  (name: string) =>
    Arr.some(packages, (pkg) => name === pkg || name.startsWith(`${pkg}/`));

/** What a file at each place may import by a name under the scope; `null` where nothing is judged. */
const ALLOWS: Readonly<Record<string, ((name: string) => boolean) | null>> = {
  ...Object.fromEntries(Arr.map(TABLE.parts, (part) => [part.name, (name: string) => part.may.includes(name)])),
  // A library test names the library itself and the test primitives, root or subpath, and nothing
  // else of ours. A test of the test primitives names only that package.
  "library test": within(LIBRARY, VITEST),
  "test primitives test": within(VITEST),
  "tuval test": null,
  "tuval, no part": null,
  "program test": null,
  apps: null,
};

const base = fc.oneof(fc.constantFrom("Log", "Link", "Main", "View"), fc.stringMatching(/^[A-Z][a-z]{1,6}$/));

/**
 * A production file's name: never one a suite's glob takes, `Test` or `Latest`, since macOS matches
 * the globs without case.
 */
const production = base.filter((name) => !/test$/i.test(name));

const below = fc.array(fc.constantFrom("internal", "build", "node", "a"), { maxLength: 2 }).map((folders) =>
  pipe(
    folders,
    Arr.map((folder) => `${folder}/`),
    Arr.join(""),
  ),
);

const program = fc.constantFrom("notes", "counter", "map");
const ext = fc.constantFrom("ts", "tsx");

/** Each place a file can sit, by its key in `ALLOWS`, and the paths there. */
const PLACES: ReadonlyArray<readonly [string, fc.Arbitrary<string>]> = [
  [
    "test primitives",
    fc.oneof(
      fc.tuple(below, base).map(([at, name]) => `next/packages/vitest/src/${at}${name}.ts`),
      fc.tuple(below, base).map(([at, name]) => `next/packages/vitest/${at}${name}.ts`),
    ),
  ],
  [
    "test primitives test",
    fc.tuple(below, base, ext).map(([at, name, end]) => `next/packages/vitest/src/${at}${name}.test.${end}`),
  ],
  [
    "library suites",
    fc.oneof(
      fc.tuple(below, base).map(([at, name]) => `next/packages/libfabrika/src/${at}${name}Test.ts`),
      fc.tuple(below, base).map(([at, name]) => `next/packages/libfabrika/src/${at}${name}.test-support.ts`),
    ),
  ],
  [
    "library",
    fc.oneof(
      fc.tuple(below, production).map(([at, name]) => `next/packages/libfabrika/src/${at}${name}.ts`),
      // Outside `src/`: none exists today, and the wall holds there too.
      fc
        .tuple(fc.constantFrom("scripts", "bench", "e2e"), below, production)
        .map(([top, at, name]) => `next/packages/libfabrika/${top}/${at}${name}.ts`),
    ),
  ],
  [
    "library test",
    fc
      .tuple(fc.constantFrom("src/", "src/coordination/", "src/node/build/", "scripts/"), below, base, ext)
      .map(([top, at, name, end]) => `next/packages/libfabrika/${top}${at}${name}.test.${end}`),
  ],
  ...Arr.map(
    ["desktop", "window", "dom", "browser", "electron", "headless"],
    (folder) =>
      [
        folder,
        fc.tuple(below, base, ext).map(([at, name, end]) => `next/packages/tuval/src/${folder}/${at}${name}.${end}`),
      ] as const,
  ),
  [
    "tuval test",
    fc
      .tuple(fc.constantFrom("desktop", "window", "browser"), base)
      .map(([folder, name]) => `next/packages/tuval/src/${folder}/${name}.test.ts`),
  ],
  [
    "tuval, no part",
    fc.tuple(fc.constantFrom("", "sync/"), base).map(([at, name]) => `next/packages/tuval/src/${at}${name}.ts`),
  ],
  [
    "program window",
    fc.tuple(program, below, base).map(([pkg, at, name]) => `next/programs/${pkg}/src/${at}${name}.tsx`),
  ],
  [
    "program suites",
    fc.oneof(
      fc.tuple(program, below, base).map(([pkg, at, name]) => `next/programs/${pkg}/src/${at}${name}Test.ts`),
      fc.tuple(program, below, base).map(([pkg, at, name]) => `next/programs/${pkg}/src/${at}${name}.test-support.ts`),
    ),
  ],
  [
    "program",
    fc.oneof(
      fc.tuple(program, below, production).map(([pkg, at, name]) => `next/programs/${pkg}/src/${at}${name}.ts`),
      fc.tuple(program, production).map(([pkg, name]) => `next/programs/${pkg}/${name}.ts`),
      // A suite's name outside `src/` is a program's code like any other.
      fc.tuple(program, base).map(([pkg, name]) => `next/programs/${pkg}/${name}Test.ts`),
    ),
  ],
  [
    "program test",
    fc.tuple(program, base, ext).map(([pkg, name, end]) => `next/programs/${pkg}/src/${name}.test.${end}`),
  ],
  ["apps", fc.tuple(below, base).map(([at, name]) => `next/apps/fabrika/src/${at}${name}.ts`)],
];

/** Names from every part's list, and names no list holds: other front files, other packages, not ours. */
const target = fc.oneof(
  { arbitrary: fc.constantFrom(...new Set(Arr.flatMap(TABLE.parts, (part) => part.may))), weight: 2 },
  // Next to a listed name, so a list that grew by one is seen.
  {
    arbitrary: fc.constantFrom(
      `${LIBRARY}/transport/Connection`,
      `${LIBRARY}/transport/Dial`,
      `${LIBRARY}/client`,
      `${LIBRARY}/client/WindowStart.test-support`,
      `${LIBRARY}/client/Prefix`,
      `${LIBRARY}/tezgah/internal/tree`,
      `${LIBRARY}/coordination/index`,
      `${LIBRARY}/ledger/Log`,
      `${LIBRARY}/processes/Process`,
      `${LIBRARY}/data`,
      `${LIBRARY}/box`,
    ),
    weight: 2,
  },
  fc
    .tuple(
      fc.constantFrom("transport", "client", "coordination", "ledger", "processes", "desktop", "data", "box"),
      fc.option(
        fc.oneof(
          fc.constantFrom("Connection", "Link", "Wire", "Dial", "WindowStart", "WindowStart.test-support", "Headless"),
          fc.stringMatching(/^[A-Z][a-z]{1,6}$/),
        ),
        { nil: undefined },
      ),
    )
    .map(([folder, front]) => `${LIBRARY}/${folder}${front === undefined ? "" : `/${front}`}`),
  fc.constantFrom(
    LIBRARY,
    VITEST,
    // Next to the test primitives' one name: a subpath no part's `may` holds, and a longer name.
    `${VITEST}/Depth`,
    "@kampus/vitest-x",
    "@kampus/libfabrika-x",
    "@kampus/tuval",
    "@kampus/tuval/browser",
    "@kampus/tuval/style.css",
    "@kampus/counter",
    "@kampus/notes/window",
    "@kampus/fabrika",
    "@kampus/fabrika-design",
    "@kampus/fabrika-design/tokens.css",
    "@kampus/fabrika-design/fonts.css",
  ),
  // Not under the scope, so never judged.
  fc.constantFrom("effect", "@effect/platform-node", "@kampusx/tuval", "kampus/tuval", "./Link.ts", "../ledger/Log.ts"),
);

/** Every way an import names its module, each on one line, with local names made unique by `n`. */
const FORMS: ReadonlyArray<(from: string, n: number) => string> = [
  (from, n) => `import * as a${n} from ${JSON.stringify(from)};`,
  (from, n) => `import type {X${n}} from ${JSON.stringify(from)};`,
  (from, n) => `export {x${n}} from ${JSON.stringify(from)};`,
  (from) => `export * from ${JSON.stringify(from)};`,
  (from) => `import ${JSON.stringify(from)};`,
  (from, n) => `export const a${n} = () => import(${JSON.stringify(from)});`,
  (from, n) => `export const b${n} = () => import(\`${from}\`);`,
  (from, n) => `export type A${n} = import(${JSON.stringify(from)}).X;`,
  (from, n) => `import c${n} = require(${JSON.stringify(from)});`,
];

const imports = fc.array(fc.tuple(target, fc.nat({ max: FORMS.length - 1 })), { minLength: 1, maxLength: 8 });

/** One case: a file's text and the lines the rule fires on. */
type Case = { readonly text: string; readonly lines: ReadonlyArray<number> };

const caseFor = (place: string, names: ReadonlyArray<readonly [string, number]>): Case => {
  const allows = ALLOWS[place] ?? null;
  return {
    text: `${pipe(
      names,
      Arr.map(([from, form], n) => FORMS[form]?.(from, n) ?? ""),
      Arr.join("\n"),
    )}\n`,
    lines: Arr.flatMap(names, ([from], n) =>
      allows !== null && from.startsWith(TABLE.scope) && !allows(from) ? [n + 1] : [],
    ),
  };
};

/** In process, RuleTester with the plan's table: the file fires on exactly these lines, or on none. */
const check = (filename: string, { text: code, lines }: Case) => {
  const options = [TABLE];
  tester.run("package-imports", packageImports, {
    valid: lines.length === 0 ? [{ code, filename, options }] : [],
    invalid:
      lines.length === 0
        ? []
        : [{ code, filename, options, errors: Arr.map(lines, (line) => ({ line, message: /may not import/ })) }],
  });
};

/**
 * The path the one oxlint run reads case `n`'s file at: its name starts with the number, so its folder
 * and its ending (`Test.ts`, `.test-support.ts`) stay.
 */
const numbered = (path: string, n: number) => path.replace(/\/([^/]+)$/, `/N${n}$1`);

// Plants, each run once and recorded in PR 1251: give the window part's `may` in `.oxlintrc.json`
// `transport/Connection`; drop the library part's `tests` there; put the library part's glob back
// to `src/**`; make the rule skip every test again. Each turns this law red.
it("each part fires on exactly the names of ours its table refuses, wherever its file sits", async () => {
  let n = 0;
  const cases = new Map<string, Case>();
  const places = new Set<string>();
  fc.assert(
    fc.property(
      fc.oneof(...Arr.map(PLACES, ([place, path]) => fc.tuple(fc.constant(place), path, imports))),
      ([place, path, names]) => {
        const one = caseFor(place, names);
        check(path, one);
        cases.set(numbered(path, n), one);
        places.add(place);
        n++;
      },
    ),
    {
      seed: 119120,
      numRuns: 1000,
      examples: [
        // pinned: the review of PR 1251 found three library files the wall missed: a top-level
        // test, a test in a folder whose row claims one file, and a file outside `src/`.
        [["library test", "next/packages/libfabrika/src/Id.test.ts", [["@kampus/counter", 0]]]],
        [["library test", "next/packages/libfabrika/src/coordination/Plant.test.ts", [["@kampus/tuval", 0]]]],
        [["library", "next/packages/libfabrika/scripts/Plant.ts", [["@kampus/tuval", 0]]]],
      ],
    },
  );
  // Every place was drawn, and both fires and passes.
  expect([...places].sort()).toEqual(Arr.map(PLACES, ([place]) => place).sort());
  expect(Arr.some([...cases.values()], (one) => one.lines.length > 0)).toBe(true);
  expect(Arr.some([...cases.values()], (one) => one.lines.length === 0)).toBe(true);

  const result = await plant(Object.fromEntries(Arr.map([...cases], ([path, { text }]) => [path, text])));
  expect(Object.fromEntries(Arr.map([...cases.keys()], (path) => [path, result(CODE, path)]))).toEqual(
    Object.fromEntries(Arr.map([...cases], ([path, { lines }]) => [path, lines])),
  );
});

/** Where production code of ours sits, and where the suites that read the test depth sit. */
const CODE_PLACES = ["library", "program"] as const;
const SUITE_PLACES = ["library suites", "program suites"] as const;
const pathAt = new Map(PLACES);

// Plant, run once and recorded in PR 1274: give the library and program parts' `may` in
// `.oxlintrc.json` `@kampus/vitest` again, as the PR first had it. This law turns red.
it("the library's and a program's code may not import the test primitives, and their shared suites may", async () => {
  let n = 0;
  const cases = new Map<string, Case>();
  const seen = new Set<string>();
  fc.assert(
    fc.property(
      fc.oneof(
        ...Arr.map([...CODE_PLACES, ...SUITE_PLACES], (place) =>
          fc.tuple(fc.constant(place), pathAt.get(place)!, fc.nat({ max: FORMS.length - 1 })),
        ),
      ),
      ([place, path, form]) => {
        const refused = (CODE_PLACES as ReadonlyArray<string>).includes(place);
        const one: Case = { text: `${FORMS[form]!(VITEST, 0)}\n`, lines: refused ? [1] : [] };
        check(path, one);
        cases.set(numbered(path, n), one);
        seen.add(place);
        n++;
      },
    ),
    {
      seed: 119120,
      numRuns: 200,
      examples: [
        // pinned: the review of PR 1274 named this file, which lint let import the test package.
        [["library", "next/packages/libfabrika/src/tasks/Task.ts", 0]],
        [["library suites", "next/packages/libfabrika/src/tasks/TasksTest.ts", 0]],
        [["program suites", "next/programs/pipeline/src/RunnerTest.ts", 0]],
      ],
    },
  );
  expect([...seen].sort()).toEqual([...CODE_PLACES, ...SUITE_PLACES].sort());

  const result = await plant(Object.fromEntries(Arr.map([...cases], ([path, { text }]) => [path, text])));
  expect(Object.fromEntries(Arr.map([...cases.keys()], (path) => [path, result(CODE, path)]))).toEqual(
    Object.fromEntries(Arr.map([...cases], ([path, { lines }]) => [path, lines])),
  );
});
