// P1 and P2: what the package's own files say. P1 reads the manifest at head, P2 the source and the root entry point. They run in memory on every pull
// request. The package stands alone in this slice (decision 0047): it names no other package of this repository in its dependencies. The words P2
// looks for are written in pieces, so this file does not hold them whole.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Permissions from "./index.ts";

const root = join(import.meta.dirname, "..");

const Manifest = Schema.Struct({
  name: Schema.String,
  private: Schema.Boolean,
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.Record(Schema.String, Schema.String),
  peerDependencies: Schema.Record(Schema.String, Schema.String),
  peerDependenciesMeta: Schema.optionalKey(Schema.Record(Schema.String, Schema.Struct({ optional: Schema.Boolean }))),
  optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  exports: Schema.Record(Schema.String, Schema.String),
});

const manifest = () =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(readFileSync(join(root, "package.json"), "utf8"));

const part = (...pieces: ReadonlyArray<string>): string => pieces.join("");

// P1. Plant: add `@kalfa/config` to the dependencies; add `@kalfa/git` to the peers; add a `./memory` export; point the root at another file; make
// `vitest` a peer; make the package public.
it("P1 scenario: the manifest is a private package with no dependency, effect its one peer and no package of this repository in any list, and the root and manifest exports, each to a file that exists", () => {
  // scenario: the package's own manifest at head; no generated input says what a manifest holds.
  const found = manifest();

  const named = [
    ...Object.keys(found.dependencies ?? {}),
    ...Object.keys(found.devDependencies),
    ...Object.keys(found.peerDependencies),
    ...Object.keys(found.optionalDependencies ?? {}),
  ];

  expect(found.name).toBe(part("@kal", "fa/permissions"));
  expect(found.private, "private").toBe(true);
  expect(
    named.filter((name) => [part("@kal", "fa/"), part("@kam", "pus/")].some((scope) => name.startsWith(scope))),
    "no other package of this repository, in any list",
  ).toEqual([]);
  expect(found.dependencies ?? {}, "no dependency of its own in this slice").toEqual({});
  expect(Object.keys(found.peerDependencies), "effect is the one peer").toEqual(["effect"]);
  expect(found.peerDependenciesMeta, "and it is not optional").toBeUndefined();
  expect(found.exports, "the entry points, each to its source file").toEqual({
    ".": "./src/index.ts",
    "./package.json": "./package.json",
  });

  for (const target of Object.values(found.exports)) {
    expect(existsSync(join(root, target)), `${target} is a file`).toBe(true);
  }
});

/** The package's source files that are not tests or test support, as paths from the source folder. */
const sources = (): ReadonlyArray<string> =>
  readdirSync(join(root, "src"), { recursive: true, encoding: "utf8" }).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".test-support.ts"),
  );

const APP_WORDS = [
  part("hum", "an"),
  part("ag", "ent"),
  part("proj", "ect"),
  part("own", "er"),
  part("adm", "in"),
  part("mem", "ber"),
  part("free", "zer"),
];

// P2. Plant: write a `project` type in a doc example in `Model.ts`; write `RelationshipsUnreachable` in a comment of `index.ts`; export a name
// beside `Model` and `Relation` from the root; leave `Relation` out of the root.
it("P2 scenario: the package names no app's words and no forbidden error name, and its root exports exactly the names slice 1 builds", () => {
  // scenario: the package's source files at head; no generated input says what a file says.
  const files = sources();
  const words = new RegExp(`\\b(${APP_WORDS.join("|")})s?\\b`, "i");
  const forbidden = part("Relationships", "Unreachable");

  expect(files, "the source files the plan names").toEqual(expect.arrayContaining(["index.ts", "Model.ts"]));

  for (const file of files) {
    const text = readFileSync(join(root, "src", file), "utf8");

    expect(text.match(words)?.[0], `${file} names no app's word`).toBeUndefined();
    expect(text.includes(forbidden), `${file} has no ${forbidden}`).toBe(false);
  }

  expect(Object.keys(Permissions).toSorted(), "the root exports its two names and no other").toEqual([
    "Model",
    "Relation",
  ]);
});
