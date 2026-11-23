// P1 and E1: what the package's own files say. P1 reads the manifest at head, E1 the root entry point. They run in memory on every pull request.
// The package stands alone: it names no other package of this repository and no `@demlik/` package, and its one dependency is held at an exact version.
// The words P1 looks for are written in pieces, so this file does not hold them whole.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Entry from "./Entry.ts";
import * as EntryId from "./EntryId.ts";
import * as Errors from "./Errors.ts";
import * as Root from "./index.ts";
import * as Ledger from "./Ledger.ts";
import * as Settings from "./Settings.ts";

const root = join(import.meta.dirname, "..");

const Manifest = Schema.Struct({
  name: Schema.String,
  private: Schema.Boolean,
  dependencies: Schema.Record(Schema.String, Schema.String),
  devDependencies: Schema.Record(Schema.String, Schema.String),
  peerDependencies: Schema.Record(Schema.String, Schema.String),
  peerDependenciesMeta: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Struct({ optional: Schema.optionalKey(Schema.Boolean) })),
  ),
  optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  exports: Schema.Record(Schema.String, Schema.String),
});

const manifest = () =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(readFileSync(join(root, "package.json"), "utf8"));

const part = (...pieces: ReadonlyArray<string>): string => pieces.join("");

/** A version that names one release and no range: three numbers with dots, nothing before them and nothing after. */
const EXACT = /^\d+\.\d+\.\d+$/u;

// P1. Plant: add `@kalfa/config` to the dependencies; make `fast-sha256` a range (`^1.3.0`); make the package public; add a second peer; mark `effect` an
// optional peer; point `.` at another file; name a `@demlik/` package in the dev dependencies.
it("P1 scenario: the manifest is a private package with one dependency held at an exact version, one peer, effect, and the root and manifest exports, each to a file that exists, and no package of this repository", () => {
  // scenario: the package's own manifest at head; no generated input says what a manifest holds.
  const found = manifest();

  // Everything the manifest says, but its own name: a package of this repository or of demlik named in a key, a version, a script or a note is a dependency it should not have.
  const { name: _, ...rest } = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)),
  )(readFileSync(join(root, "package.json"), "utf8"));

  const named = JSON.stringify(rest);

  expect(found.name).toBe(part("@kal", "fa/ledger"));
  expect(found.private, "private").toBe(true);
  expect(
    [part("@kal", "fa/"), part("@kam", "pus/"), part("@tea-", "fabrika/"), part("@dem", "lik/")].filter((scope) =>
      named.includes(scope),
    ),
    "no other package of this repository, and no demlik package, named anywhere",
  ).toEqual([]);
  expect(Object.keys(found.dependencies), "one dependency: the hash").toEqual(["fast-sha256"]);
  expect(found.dependencies["fast-sha256"], "held at an exact version").toMatch(EXACT);
  expect(Object.keys(found.peerDependencies), "effect is the one peer").toEqual(["effect"]);
  expect(found.peerDependenciesMeta?.["effect"]?.optional, "and it is not optional").not.toBe(true);
  expect(Object.keys(found.optionalDependencies ?? {}), "no optional dependency").toEqual([]);
  expect(found.exports, "the entry points, each to its source file").toEqual({
    ".": "./src/index.ts",
    "./package.json": "./package.json",
  });

  for (const target of Object.values(found.exports)) {
    expect(existsSync(join(root, target)), `${target} is a file`).toBe(true);
  }
});

/** The names that end in the word a package above uses for "I could not answer": each package above wraps the Ledger's failures under its own name, so the root has none. */
const unavailable = (names: ReadonlyArray<string>): ReadonlyArray<string> =>
  names.filter((name) => name.endsWith(part("Un", "available")));

// E1. Plant: leave `RevisionConflict` or `EmptyTags` out of `Refusal`; export a copy of `EntryId` (the same schema made again); export a copy of `child`; drop `Placed` from
// the root; export `Failure` with two members; name an export `ChatUnavailable`; export a second `Settings` made again.
it("E1 scenario: the root entry point gives the Ledger, the ids, the entries, the settings and the nine errors with the two unions, the very ones their files make", () => {
  // scenario: the root entry point at head; no generated input says what a module re-exports.
  expect(Root.Ledger, "the service").toBe(Ledger.Ledger);
  expect(Root.EntryId, "the entry id").toBe(EntryId.EntryId);
  expect(Root.child, "child").toBe(EntryId.child);
  expect(Root.Settings, "the settings").toBe(Settings.Settings);
  expect(Root.EntryName, "the entry name").toBe(EntryId.EntryName);
  expect(Root.Revision, "the revision").toBe(Entry.Revision);
  expect(Root.Position, "the position").toBe(Entry.Position);
  expect(Root.NewEntry, "the new entry").toBe(Entry.NewEntry);
  expect(Root.Entry, "the entry").toBe(Entry.Entry);
  expect(Root.Placed, "the answer to an append").toBe(Entry.Placed);

  expect(Root.BadEntry, "BadEntry").toBe(Errors.BadEntry);
  expect(Root.IdReused, "IdReused").toBe(Errors.IdReused);
  expect(Root.TooBig, "TooBig").toBe(Errors.TooBig);
  expect(Root.AdmissionRefused, "AdmissionRefused").toBe(Errors.AdmissionRefused);
  expect(Root.RevisionConflict, "RevisionConflict").toBe(Errors.RevisionConflict);
  expect(Root.EmptyTags, "EmptyTags").toBe(Errors.EmptyTags);
  expect(Root.Unreachable, "Unreachable").toBe(Errors.Unreachable);
  expect(Root.BadRow, "BadRow").toBe(Errors.BadRow);
  expect(Root.StorageFailed, "StorageFailed").toBe(Errors.StorageFailed);
  expect(Root.Refusal, "the refusals").toBe(Errors.Refusal);
  expect(Root.Failure, "the failures").toBe(Errors.Failure);

  expect(new Set(Errors.Refusal.members), "a refusal is exactly one of the six").toEqual(
    new Set([
      Errors.BadEntry,
      Errors.IdReused,
      Errors.TooBig,
      Errors.AdmissionRefused,
      Errors.RevisionConflict,
      Errors.EmptyTags,
    ]),
  );
  expect(new Set(Errors.Failure.members), "a failure is exactly one of the three").toEqual(
    new Set([Errors.Unreachable, Errors.BadRow, Errors.StorageFailed]),
  );

  expect(unavailable(Object.keys(Root)), "only a package above says Unavailable").toEqual([]);
});
