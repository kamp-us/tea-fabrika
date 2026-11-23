// P1, P2 and R1's README half: what the package's own files say. It stands alone (decision on small libraries usable alone):
// it names no other package of this repository, it has no dependencies, it reads GitHub's types from one pinned package, and
// no file in it names the repository. They read the package's own files and the workspace file at head, so they run in memory
// on every pull request. The words P2 looks for are written in pieces, so this file does not hold them whole.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { RUN_TIME_ONLY } from "./Octokit.test-support.ts";

const root = join(import.meta.dirname, "..");

const workspaceFile = join(root, "..", "..", "pnpm-workspace.yaml");

const Manifest = Schema.Struct({
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.Record(Schema.String, Schema.String),
  peerDependencies: Schema.Record(Schema.String, Schema.String),
  optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  exports: Schema.Record(Schema.String, Schema.Unknown),
  publishConfig: Schema.Struct({ exports: Schema.Record(Schema.String, Schema.Unknown) }),
});

const read = (file: string): string => readFileSync(file, "utf8");

const manifest = () => Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(read(join(root, "package.json")));

/** The version the workspace's catalog holds for the types package, with no range mark. */
const catalogVersion = (): string | undefined =>
  /^\s*'@octokit\/openapi-types':\s*(\S+)\s*$/m.exec(read(workspaceFile))?.[1];

const part = (...pieces: ReadonlyArray<string>): string => pieces.join("");

// P1, slice 1. Plant: add the shared test package to the dev dependencies, and it is named in the failure; write a range
// mark before the catalog's version, and the exact-version line fails.
it("P1 scenario: the manifest has no dependencies and one peer, takes GitHub's types from the catalog, names no repo package, exports the root", () => {
  // scenario: the package's own manifest, the workspace file and the README at head; no generated input says what a manifest holds.
  const found = manifest();

  const named = [
    ...Object.keys(found.dependencies ?? {}),
    ...Object.keys(found.devDependencies),
    ...Object.keys(found.peerDependencies),
    ...Object.keys(found.optionalDependencies ?? {}),
  ];

  expect(
    named.filter((name) => [part("@kal", "fa/"), part("@kam", "pus/")].some((scope) => name.startsWith(scope))),
    "no package of this repository",
  ).toEqual([]);
  expect(found.dependencies, "no dependencies").toBeUndefined();
  expect(Object.keys(found.peerDependencies), "effect is the one peer").toEqual(["effect"]);
  expect(found.devDependencies["@octokit/openapi-types"], "the types come through the catalog").toBe("catalog:");
  expect(Object.keys(found.exports).toSorted()).toEqual([".", "./package.json"]);
  expect(found.publishConfig.exports["."]).toEqual({ types: "./dist/GitHub.d.ts", default: "./dist/GitHub.js" });

  const version = catalogVersion();

  expect(version, "the catalog names the types package").toBeDefined();
  expect(version, "an exact version, no range mark").toMatch(/^\d+\.\d+\.\d+$/);
  expect(read(join(root, "README.md")), "the README names the version the types come from").toContain(version ?? "");
});

/** The package's files, as the tree shows them, less what a build or an install makes. */
const files = (): ReadonlyArray<string> =>
  readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((path) => !/(^|\/)(node_modules|dist)(\/|$)/u.test(path))
    .filter((path) => statSync(join(root, path)).isFile())
    .toSorted();

// What the package must not name, so it holds nothing specific to the repo it sits in.
const WORDS = [part("fab", "rika"), part("kam", "pus"), part("kamp", "-us"), part(".kal", "fa/")];

// P2. Plant: write the repo's own name into the README, and that file is named in the failure.
it("P2 scenario: no file of the package names this repo or its records, in any letter case", () => {
  // scenario: the package's own files at head; no generated input says what a file holds.
  const found = files();

  expect(found, "the package has its manifest").toContain("package.json");
  expect(found, "and its entry point").toContain(join("src", "GitHub.ts"));

  const hits = found.flatMap((file) =>
    WORDS.filter((word) => read(join(root, file)).toLowerCase().includes(word)).map(
      (word) => `${relative(root, join(root, file))}: ${word}`,
    ),
  );

  expect(hits).toEqual([]);
});

// R1, the README's half. Plant: leave one route out of the README's list, and that route is named in the failure.
it("R1 scenario: the README carries each route that is checked only at run time", () => {
  // scenario: the package's own README at head, and the list R1 pins in Octokit.types.test.ts; no generated input says what a README holds.
  const readme = read(join(root, "README.md"));

  expect(RUN_TIME_ONLY.filter((route) => !readme.includes(route))).toEqual([]);
});
