// P1 and E1: what the package's own files say. P1 reads the manifest at head, E1 the root entry point. They run in memory on every pull request.
// The package stands alone (decision on small libraries usable alone): it names two other packages of this repository, the settings engine and the
// diagnostics package that holds the hidden cause, and no other. The words P1 looks for are written in pieces, so this file does not hold them whole.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Errors from "./Errors.ts";
import * as Secrets from "./index.ts";
import * as Recorder from "./Recorder.ts";
import * as Store from "./Store.ts";

const root = join(import.meta.dirname, "..");

const Manifest = Schema.Struct({
  name: Schema.String,
  private: Schema.Boolean,
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.Record(Schema.String, Schema.String),
  peerDependencies: Schema.Record(Schema.String, Schema.String),
  peerDependenciesMeta: Schema.Record(Schema.String, Schema.Struct({ optional: Schema.optionalKey(Schema.Boolean) })),
  optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  exports: Schema.Record(Schema.String, Schema.String),
});

const manifest = () =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(readFileSync(join(root, "package.json"), "utf8"));

const part = (...pieces: ReadonlyArray<string>): string => pieces.join("");

// P1. Plant: add `@kalfa/github` to the dependencies; drop `./test` from the exports; make `vitest` a required peer; point `./memory` at another
// file; move `@kalfa/config` to the dev dependencies; make the package public; drop `@kalfa/diagnostics` from the dependencies.
it("P1 scenario: the manifest is a private package with two dependencies, the settings engine and the diagnostics package, three peers of which the test tools are optional, and the root, memory, test and manifest exports, each to a file that exists", () => {
  // scenario: the package's own manifest at head; no generated input says what a manifest holds.
  const found = manifest();

  const named = [
    ...Object.keys(found.dependencies ?? {}),
    ...Object.keys(found.devDependencies),
    ...Object.keys(found.peerDependencies),
    ...Object.keys(found.optionalDependencies ?? {}),
  ];

  expect(found.name).toBe(part("@kal", "fa/secrets"));
  expect(found.private, "private").toBe(true);
  expect(
    named.filter(
      (name) =>
        name !== part("@kal", "fa/config") &&
        name !== part("@kal", "fa/diagnostics") &&
        [part("@kal", "fa/"), part("@kam", "pus/")].some((scope) => name.startsWith(scope)),
    ),
    "no other package of this repository",
  ).toEqual([]);
  expect(found.dependencies, "the settings engine and the diagnostics package are the dependencies").toEqual({
    [part("@kal", "fa/config")]: "workspace:*",
    [part("@kal", "fa/diagnostics")]: "workspace:*",
  });
  expect(
    [found.devDependencies, found.peerDependencies, found.optionalDependencies ?? {}].flatMap((each) =>
      Object.keys(each).filter((name) => name === part("@kal", "fa/config") || name === part("@kal", "fa/diagnostics")),
    ),
    "and only a dependency",
  ).toEqual([]);
  expect(Object.keys(found.peerDependencies).toSorted(), "effect and the two test tools are the peers").toEqual([
    "@effect/vitest",
    "effect",
    "vitest",
  ]);
  expect(found.peerDependenciesMeta["@effect/vitest"], "the test runner is optional").toEqual({ optional: true });
  expect(found.peerDependenciesMeta["vitest"], "and so is vitest").toEqual({ optional: true });
  expect(found.peerDependenciesMeta["effect"]?.optional, "effect is not").not.toBe(true);
  expect(found.exports, "the entry points, each to its source file").toEqual({
    ".": "./src/index.ts",
    "./memory": "./src/MemoryStore.ts",
    "./test": "./src/StoreTest.ts",
    "./package.json": "./package.json",
  });

  for (const target of Object.values(found.exports)) {
    expect(existsSync(join(root, target)), `${target} is a file`).toBe(true);
  }
});

// E1. Plant: leave `Recorder` out of the root; export the stores' failure and not the recorder's; export a copy of `Store` and not the module itself.
it("E1 scenario: the root entry point gives the Store and Recorder modules and the two failures, the very ones their files make", () => {
  // scenario: the root entry point at head; no generated input says what a module re-exports.
  expect(Secrets.Store, "the store's ports").toBe(Store);
  expect(Secrets.Recorder, "the recorder").toBe(Recorder);
  expect(Secrets.StoreFailed, "a store that cannot answer").toBe(Errors.StoreFailed);
  expect(Secrets.RecordFailed, "a recorder that cannot write").toBe(Errors.RecordFailed);
});
