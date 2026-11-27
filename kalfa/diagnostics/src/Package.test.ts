// D10 to D12 and D24: what the package
// exports, what its manifest says, that none of its files names this repo, and that its README shows each kind of
// place and its examples compile. They read the package's own module and files, so they run in memory on every pull request. The words D12 looks for are spelled in
// pieces below, so this file is not itself a hit.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import * as TestDiagnostics from "./TestDiagnostics.ts";

const Manifest = Schema.Struct({
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  peerDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  optionalDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  exports: Schema.Record(Schema.String, Schema.String),
  publishConfig: Schema.Struct({
    exports: Schema.Record(
      Schema.String,
      Schema.Union([Schema.String, Schema.Struct({ types: Schema.String, default: Schema.String })]),
    ),
  }),
});

const packageDir = Effect.gen(function* () {
  const path = yield* Path.Path;

  return path.resolve(import.meta.dirname, "..");
});

const manifest = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const text = yield* fs.readFileString(path.join(yield* packageDir, "package.json"));

  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))(text);
});

const MODULES = ["Diagnostic", "Diagnostics", "Hidden", "TestDiagnostics"];

// D10. Plant: export an `expectMessage` helper from TestDiagnostics.ts, and its exports are four.
it("D10 scenario: TestDiagnostics exports the service, its Layer and the read, and no wording helper", () => {
  // scenario: the module's own exports at head; no generated input says what a module exports.
  expect(Object.keys(TestDiagnostics).toSorted()).toEqual(["TestDiagnostics", "layer", "reported"]);
});

/** The module could not be loaded: it is read here, inside the law that names it, so one missing file fails one law. */
class ModuleMissing extends Schema.TaggedError<ModuleMissing, { readonly brand: unique symbol }>()("ModuleMissing", {
  cause: Schema.Defect(),
}) {}

// D10, widened. Plant: export a third name from Hidden.ts, and it is in the failure.
it.effect("D10 scenario: Hidden exports the cause schema and the placeholder text, and nothing else", () =>
  Effect.gen(function* () {
    // scenario: the module's own exports at head; no generated input says what a module exports.
    const Hidden = yield* Effect.tryPromise({
      try: () => import("./Hidden.ts"),
      catch: (cause) => new ModuleMissing({ cause }),
    });

    expect(Object.keys(Hidden).toSorted()).toEqual(["Cause", "placeholder"]);
  }),
);

// D11. Plant: add a repo package to the dev dependencies, and the check on package names fails; drop `./Hidden` from the exports, and it is missing from the failure.
it.effect(
  "D11 scenario: the manifest names no repo package, has no dependencies, one peer, and the exports listed",
  () =>
    Effect.gen(function* () {
      // scenario: the package's own manifest at head; no generated input says what a manifest holds.
      const found = yield* manifest;

      const named = [
        ...Object.keys(found.dependencies ?? {}),
        ...Object.keys(found.devDependencies ?? {}),
        ...Object.keys(found.peerDependencies ?? {}),
        ...Object.keys(found.optionalDependencies ?? {}),
      ];

      const repoScopes = [["@kal", "fa/"].join(""), ["@kam", "pus/"].join("")];

      expect(named.filter((name) => repoScopes.some((scope) => name.startsWith(scope)))).toEqual([]);
      expect(found.dependencies).toBeUndefined();
      expect(Object.keys(found.peerDependencies ?? {})).toEqual(["effect"]);
      expect(Object.keys(found.exports).toSorted()).toEqual(
        [...MODULES.map((name) => `./${name}`), "./package.json"].toSorted(),
      );

      for (const name of MODULES) {
        expect(found.publishConfig.exports[`./${name}`]).toEqual({
          types: `./dist/${name}.d.ts`,
          default: `./dist/${name}.js`,
        });
      }
    }).pipe(Effect.provide(NodeServices.layer)),
);

// What the package must not name: it holds nothing specific to the repo it sits in. In pieces, so this file
// does not hold them whole.
const FORBIDDEN = [
  ["fab", "rika"],
  ["kam", "pus"],
  ["kamp", "-us"],
  [".kal", "fa/"],
].map((pieces) => pieces.join(""));

// D12. Plant: write the repo's own name into the README, and that file is named in the failure.
it.effect("D12 scenario: no file of the package names this repo", () =>
  Effect.gen(function* () {
    // scenario: the package's own files at head; no generated input says what a file holds.
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* packageDir;

    const files = (yield* fs.readDirectory(root, { recursive: true })).filter(
      (file) => !file.split(path.sep).some((part) => part === "node_modules" || part === "dist"),
    );

    const texts = yield* Effect.forEach(
      files,
      (file) =>
        fs.readFileString(path.join(root, file)).pipe(
          Effect.map((text) => ({ file, text: text.toLowerCase() })),
          Effect.orElseSucceed(() => ({ file, text: "" })),
        ),
      { concurrency: 4 },
    );

    expect(files).toContain("package.json");
    expect(files).toContain(path.join("src", "Diagnostic.ts"));
    expect(texts.filter(({ text }) => FORBIDDEN.some((word) => text.includes(word))).map(({ file }) => file)).toEqual(
      [],
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

// D24. Plant: delete the flag example from the README, and its tag is missing from the failure.
it.effect("D24 scenario: the README shows each kind of place with its text form", () =>
  Effect.gen(function* () {
    // scenario: the package's own README at head; no generated input says what a README shows.
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const readme = yield* fs.readFileString(path.join(yield* packageDir, "README.md"));

    const tags = ["repo", "home", "environment", "flag"].filter((tag) => !readme.includes(`_tag: "${tag}"`));

    expect(tags).toEqual([]);
    // A home place is shown both ways: starting with the home folder, and starting with a variable.
    expect(readme).toMatch(/_tag: "home",\s*path: "~\//);
    expect(readme).toMatch(/_tag: "home",\s*path: "\$[A-Z][A-Z0-9_]*\//);
    // The text form of each kind: a file with a line and column, an environment variable, and a flag.
    expect(readme).toMatch(/\S+:\d+:\d+/);
    expect(readme).toMatch(/environment variable [A-Z][A-Z0-9_]*/);
    expect(readme).toMatch(/flag --[a-z][a-z0-9.-]*/);
  }).pipe(Effect.provide(NodeServices.layer)),
);

// The README's code blocks, as written, without their import lines (the types file holds each import once, at its
// top), and with runs of whitespace made one space, so a formatter's line breaks do not matter.
const readmeBlocks = (readme: string): ReadonlyArray<string> =>
  [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map(([, code = ""]) =>
    code
      .split("\n")
      .filter((line) => !line.startsWith("import "))
      .join("\n")
      .replace(/\s+/g, " ")
      .trim(),
  );

// D24, the README's examples compile. They are kept word for word in README.types.test.ts, which the package's own
// compiler checks (`tsc`, and the root `typecheck`), as it checks the other type laws. This law runs in memory: it
// reads both files and checks that every code block of the README is in that file, so an example cannot change in the
// README without the compiler seeing it, and a block cannot leave the file.
// Plant: edit one README block so it no longer matches the types file, and that block is in the failure. And in the
// types file: drop `: Diagnostic.Place` from one example, and `tsc` refuses `formatPlace` on it.
it.effect("D24 scenario: every code block of the README is in the file the compiler checks, each place typed", () =>
  Effect.gen(function* () {
    // scenario: the package's own README and types file at head; no generated input says what a README example holds.
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* packageDir;

    const readme = yield* fs.readFileString(path.join(root, "README.md"));
    const checked = (yield* fs.readFileString(path.join(root, "src", "README.types.test.ts"))).replace(/\s+/g, " ");
    const blocks = readmeBlocks(readme);

    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.filter((block) => !checked.includes(block))).toEqual([]);
    // A place written as a bare object is not typed, so the compiler would see only a string for its tag.
    expect(checked).not.toMatch(/(?:const|let) \w+ = \{ _tag:/);
  }).pipe(Effect.provide(NodeServices.layer)),
);

// What the README shows of a carried diagnostic: the getter on an error, the maker, the reader, the one way in, the
// maker of a place for a package whose lint refuses a `_tag` written by hand, and that lint's name.
const CARRIED_SHAPE = [
  "get diagnostic(): Diagnostic.Carried",
  "Diagnostic.carry(",
  "Diagnostic.fromError(",
  "Diagnostics.report(carried.declared, carried.fields)",
  "Diagnostic.Place.cases.<kind>.make",
  "no-manual-tagged-construction",
];

// D24, widened. Plant: delete the README line that names the makers, and `no-manual-tagged-construction` and
// `Diagnostic.Place.cases.<kind>.make` are in the failure. And edit the carry example in the README only, and that block is in the failure above.
it.effect("D24 scenario: the README shows the carried shape and the maker of a place", () =>
  Effect.gen(function* () {
    // scenario: the package's own README at head; no generated input says what a README shows.
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const readme = yield* fs.readFileString(path.join(yield* packageDir, "README.md"));

    expect(CARRIED_SHAPE.filter((shown) => !readme.includes(shown))).toEqual([]);
  }).pipe(Effect.provide(NodeServices.layer)),
);
