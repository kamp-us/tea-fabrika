// K14 to K16, slice 1: what the package's manifest says, that none of its files names this repo, and what its README
// tells a package that wants a subcommand. They read the package's own files, so they run in memory on every pull
// request. The words K15 looks for are spelled in pieces below, so this file is not itself a hit.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";

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

// K14. Plant: add `./internal/run` to the exports, and the exports check fails; add `@kalfa/config` to the
// dependencies, and the kalfa package check fails; take `effect` out of the peers, and the peers check fails.
it.effect(
  "K14 scenario: the manifest exports ./Subcommand and the manifest, names no other kalfa package than Diagnostics, and has its two peers",
  () =>
    Effect.gen(function* () {
      // scenario: the package's own manifest at head; no generated input says what a manifest holds.
      const found = yield* manifest;

      expect(Object.keys(found.exports).toSorted()).toEqual(["./Subcommand", "./package.json"]);
      expect(found.publishConfig.exports["./Subcommand"]).toEqual({
        types: "./dist/Subcommand.d.ts",
        default: "./dist/Subcommand.js",
      });
      expect(found.publishConfig.exports["./package.json"]).toBe("./package.json");
      expect(Object.keys(found.publishConfig.exports).toSorted()).toEqual(Object.keys(found.exports).toSorted());

      const named = [
        ...Object.keys(found.dependencies ?? {}),
        ...Object.keys(found.devDependencies ?? {}),
        ...Object.keys(found.peerDependencies ?? {}),
        ...Object.keys(found.optionalDependencies ?? {}),
      ];

      // The one package of this repo's scope it names is Diagnostics, as a dependency and nowhere else.
      expect(named.filter((name) => name.startsWith("@kalfa/"))).toEqual(["@kalfa/diagnostics"]);
      expect(Object.keys(found.dependencies ?? {})).toEqual(["@kalfa/diagnostics"]);
      expect(Object.keys(found.peerDependencies ?? {}).toSorted()).toEqual(["@effect/platform-node", "effect"]);
    }).pipe(Effect.provide(NodeServices.layer)),
);

// What the package must not name: it holds nothing specific to the repo it sits in. In pieces, so this file does not
// hold them whole.
const FORBIDDEN = [
  ["fab", "rika"],
  ["kam", "pus"],
  ["kamp", "-us"],
  [".kal", "fa/"],
].map((pieces) => pieces.join(""));

// K15. Plant: write the repo's own name into the README, and that file is named in the failure.
it.effect("K15 scenario: no file of the package names this repo", () =>
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
    expect(files).toContain(path.join("src", "Subcommand.ts"));
    expect(texts.filter(({ text }) => FORBIDDEN.some((word) => text.includes(word))).map(({ file }) => file)).toEqual(
      [],
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

// K16, slice 1. Plant: delete the README's line that links Diagnostics' README, and the link check fails; delete the
// sentence that says a reporting package imports `@kalfa/diagnostics`, and the import check fails; delete the sentence
// that limits `@kalfa/cli` to `Subcommand`, and the last check fails.
it.effect("K16 scenario: the README links Diagnostics' README in one line and says what a package imports", () =>
  Effect.gen(function* () {
    // scenario: the package's own README at head; no generated input says what a README says.
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const lines = (yield* fs.readFileString(path.join(yield* packageDir, "README.md"))).split("\n");

    // One line holds the link to Diagnostics' README and says what it is for: a message and a hint.
    const linked = lines.filter(
      (line) =>
        /\]\((?:\.\.\/)+diagnostics\/README\.md[^)]*\)/.test(line) && /message/i.test(line) && /hint/i.test(line),
    );

    // A package that reports imports Diagnostics, and one that only gives a subcommand imports `Subcommand` and
    // nothing else of this package.
    const reports = lines.filter((line) => line.includes("@kalfa/diagnostics") && /report/i.test(line));

    const only = lines.filter(
      (line) => line.includes("@kalfa/cli") && line.includes("Subcommand") && /only/i.test(line),
    );

    expect(linked.length, "one line links Diagnostics' README for a message and a hint").toBeGreaterThan(0);
    expect(reports.length, "a sentence says a package that reports imports @kalfa/diagnostics").toBeGreaterThan(0);
    expect(only.length, "a sentence says a package imports @kalfa/cli only for Subcommand").toBeGreaterThan(0);
  }).pipe(Effect.provide(NodeServices.layer)),
);
