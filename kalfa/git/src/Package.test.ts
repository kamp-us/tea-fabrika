import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
// K1 to K4: what the package's own files say. It stands alone (decision on small libraries usable alone):
// it names no other package of this repository, it has no dependencies, and no file in it names the repository.
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import manifest from "../package.json" with { type: "json" };
import * as HistoryTest from "./HistoryTest.ts";
import * as RepositoryTest from "./RepositoryTest.ts";

const Manifest = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.Record(Schema.String, Schema.String),
  peerDependencies: Schema.Record(Schema.String, Schema.String),
  peerDependenciesMeta: Schema.Record(Schema.String, Schema.Struct({ optional: Schema.Boolean })),
  exports: Schema.Record(Schema.String, Schema.String),
});

// The names are written in two halves so this file does not hold them whole.
const OTHERS = [`@kal${"fa"}/`, `@kam${"pus"}/`, `@tea-fab${"rika"}/`];

const EXPORTS = [
  "./CommitId",
  "./Ref",
  "./Commit",
  "./Tree",
  "./Diff",
  "./Settings",
  "./Repository",
  "./memory",
  "./process",
  "./test",
  "./test/History",
  "./package.json",
];

// Plant: add a package of the repository (the shared test package) to the dev dependencies; add the npm package `diff` to
// `dependencies`; leave `./Diff` out of the exports.
it("K1 scenario: the manifest names no workspace package, has no dependencies, and exports exactly the plan's list", () => {
  const parsed = Schema.decodeUnknownSync(Manifest)(manifest);

  const names = [
    ...Object.keys(parsed.devDependencies),
    ...Object.keys(parsed.peerDependencies),
    ...Object.keys(parsed.dependencies ?? {}),
  ];

  expect(
    names.filter((name) => OTHERS.some((other) => name.startsWith(other))),
    "no package of this repository",
  ).toEqual([]);
  expect(parsed.dependencies, "no dependencies").toBeUndefined();

  const optional = Object.entries(parsed.peerDependenciesMeta)
    .filter(([, meta]) => meta.optional)
    .map(([name]) => name);

  expect(
    Object.keys(parsed.peerDependencies).filter((name) => !optional.includes(name)),
    "effect is the one required peer",
  ).toEqual(["effect"]);
  expect([...optional].sort(), "the test tools are optional peers").toEqual(["@effect/vitest", "vitest"]);
  expect(Object.keys(parsed.exports).sort()).toEqual([...EXPORTS].sort());
});

const WORDS = [`fab${"rika"}`, `kam${"pus"}`, `kamp-${"us"}`, `.kal${"fa/"}`];

const filesUnder = (root: URL): ReadonlyArray<string> =>
  readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((path) => !path.split("/").includes("node_modules"))
    .map((path) => fileURLToPath(new URL(path, root)))
    .filter((path) => statSync(path).isFile());

// Plant: write the repository's own name in the README.
it("K2 scenario: no file of the package names this repository or its records, in any letter case", () => {
  const files = filesUnder(new URL("../", import.meta.url));
  expect(files.length, "the package has files").toBeGreaterThan(5);

  for (const file of files) {
    const text = readFileSync(file, "utf8").toLowerCase();

    for (const word of WORDS) {
      expect(text.includes(word), `${file} names ${word}`).toBe(false);
    }
  }
});

// The word for a human being, written in two halves so this file does not hold it whole.
const NOT_A_SIGNATURE = `Per${"son"}`;

// Plant: name a test type for a human being again.
it("K3 scenario: no file of the package names a signature for a human being; the glossary's word is Signature", () => {
  const files = filesUnder(new URL("../", import.meta.url));

  for (const file of files) {
    expect(readFileSync(file, "utf8").includes(NOT_A_SIGNATURE), `${file} holds the word`).toBe(false);
  }
});

// Plant: export one more helper from either entry.
it("K4 scenario: the public test entries export only what a caller needs", () => {
  expect(Object.keys(RepositoryTest).sort(), "/test").toEqual(["settings", "suite"]);
  expect(Object.keys(HistoryTest).sort(), "/test/History").toEqual(["shapes", "textureArb"]);
});
