// p32 and p65, strict layers: the law of `fabrika/package-imports`, the names of our own packages
// each part of next/ may import (ticket 987, moved from the exam's `layers.test.ts`). Each generated
// file sits at a path in one part, or in no part, and imports names drawn from every part's list and
// from names no list holds. Each case runs in process through oxlint's RuleTester with the plan's
// table; one oxlint run over every case's file then proves the repo's own `.oxlintrc.json` holds the
// same table at the same paths.
import { join } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { packageImports } from "./package-imports.ts";

const CODE = "fabrika(package-imports)";
const LIBRARY = "@kampus/libfabrika";

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
// From the top of the repo, so the rule reads each path as oxlint gives it there.
const tester = new RuleTester({ cwd: join(import.meta.dirname, "..") });

const TRANSPORT = [
  `${LIBRARY}/transport`,
  ...["Answer", "ClientKey", "ClientRows", "Hello", "Link", "Sshsig", "Webauthn", "Wire"].map(
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
    { name: "library", files: ["next/packages/libfabrika/**"], may: [], tests: [LIBRARY] },
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
    { name: "program", files: ["next/programs/**"], may: [LIBRARY] },
  ],
};

/** What a file at each place may import by a name under the scope; `null` where nothing is judged. */
const ALLOWS: Readonly<Record<string, ((name: string) => boolean) | null>> = {
  ...Object.fromEntries(TABLE.parts.map((part) => [part.name, (name: string) => part.may.includes(name)])),
  // A library test names the library itself, root or subpath, and nothing else of ours.
  "library test": (name) => name === LIBRARY || name.startsWith(`${LIBRARY}/`),
  "tuval test": null,
  "tuval, no part": null,
  "program test": null,
  apps: null,
};

const base = fc.oneof(fc.constantFrom("Log", "Link", "Main", "View"), fc.stringMatching(/^[A-Z][a-z]{1,6}$/));

const below = fc
  .array(fc.constantFrom("internal", "build", "node", "a"), { maxLength: 2 })
  .map((folders) => folders.map((folder) => `${folder}/`).join(""));

const program = fc.constantFrom("notes", "counter", "map");
const ext = fc.constantFrom("ts", "tsx");

/** Each place a file can sit, by its key in `ALLOWS`, and the paths there. */
const PLACES: ReadonlyArray<readonly [string, fc.Arbitrary<string>]> = [
  [
    "library",
    fc.oneof(
      fc.tuple(below, base).map(([at, name]) => `next/packages/libfabrika/src/${at}${name}.ts`),
      fc.tuple(below, base).map(([at, name]) => `next/packages/libfabrika/src/${at}${name}.test-support.ts`),
      // Outside `src/`: none exists today, and the wall holds there too.
      fc
        .tuple(fc.constantFrom("scripts", "bench", "e2e"), below, base)
        .map(([top, at, name]) => `next/packages/libfabrika/${top}/${at}${name}.ts`),
    ),
  ],
  [
    "library test",
    fc
      .tuple(fc.constantFrom("src/", "src/coordination/", "src/node/build/", "scripts/"), below, base, ext)
      .map(([top, at, name, end]) => `next/packages/libfabrika/${top}${at}${name}.test.${end}`),
  ],
  ...["desktop", "window", "dom", "browser", "electron", "headless"].map(
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
    "program",
    fc.oneof(
      fc.tuple(program, below, base).map(([pkg, at, name]) => `next/programs/${pkg}/src/${at}${name}.ts`),
      fc.tuple(program, base).map(([pkg, name]) => `next/programs/${pkg}/${name}.ts`),
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
  { arbitrary: fc.constantFrom(...new Set(TABLE.parts.flatMap((part) => part.may))), weight: 2 },
  // Next to a listed name, so a list that grew by one is seen.
  {
    arbitrary: fc.constantFrom(
      `${LIBRARY}/transport/Connection`,
      `${LIBRARY}/transport/Dial`,
      `${LIBRARY}/client`,
      `${LIBRARY}/client/WindowStart.test-support`,
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
    text: `${names.map(([from, form], n) => FORMS[form]?.(from, n) ?? "").join("\n")}\n`,
    lines: names.flatMap(([from], n) =>
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
        : [{ code, filename, options, errors: lines.map((line) => ({ line, message: /may not import/ })) }],
  });
};

/** The path the one oxlint run reads case `n`'s file at: its name gets the number, its folder stays. */
const numbered = (path: string, n: number) => path.replace(/\/([^/.]+)([^/]*)$/, `/$1N${n}$2`);

// Plants, each run once and recorded in PR 1251: give the window part's `may` in `.oxlintrc.json`
// `transport/Connection`; drop the library part's `tests` there; put the library part's glob back
// to `src/**`; make the rule skip every test again. Each turns this law red.
it("each part fires on exactly the names of ours its table refuses, wherever its file sits", async () => {
  let n = 0;
  const cases = new Map<string, Case>();
  const places = new Set<string>();
  fc.assert(
    fc.property(
      fc.oneof(...PLACES.map(([place, path]) => fc.tuple(fc.constant(place), path, imports))),
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
  expect([...places].sort()).toEqual(PLACES.map(([place]) => place).sort());
  expect([...cases.values()].some((one) => one.lines.length > 0)).toBe(true);
  expect([...cases.values()].some((one) => one.lines.length === 0)).toBe(true);

  const result = await plant(Object.fromEntries([...cases].map(([path, { text }]) => [path, text])));
  expect(Object.fromEntries([...cases.keys()].map((path) => [path, result(CODE, path)]))).toEqual(
    Object.fromEntries([...cases].map(([path, { lines }]) => [path, lines])),
  );
});
