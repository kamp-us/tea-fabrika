// D10 to D12 of the approved plan for ticket 1917: what the package
// exports, what its manifest says, and that none of its files names this repo. They read the package's own
// module and files, so they run in memory on every pull request. The words D12 looks for are spelled in
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

const MODULES = ["Diagnostic", "Diagnostics", "TestDiagnostics"];

// D10. Plant: export an `expectMessage` helper from TestDiagnostics.ts, and its exports are four.
it("D10 scenario: TestDiagnostics exports the service, its Layer and the read, and no wording helper", () => {
  // scenario: the module's own exports at head; no generated input says what a module exports.
  expect(Object.keys(TestDiagnostics).toSorted()).toEqual(["TestDiagnostics", "layer", "reported"]);
});

// D11. Plant: add a repo package to the dev dependencies, and the check on package names fails.
it.effect(
  "D11 scenario: the manifest names no repo package, has no dependencies, one peer, and the exports the plan lists",
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

// What the package must not name (decision 0047: it holds nothing specific to this repo), in pieces so this
// file does not hold them whole.
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
