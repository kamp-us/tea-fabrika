// K24: the type of a refusal, checked by the compiler. A refusal that names where it was reading, with no field or no subpath,
// cannot be written: each reason has its own fields, so its message has nothing to fall back on. Each case is real values, never
// `declare const`. The file also runs under vitest: its `it` hands the function that holds the cases to `expectTypeOf`, so a
// missing module is red there too, and the compiler (`tsc`) reads every line, where an `@ts-expect-error` that is not needed
// is an error of its own.
import { expectTypeOf, it } from "@effect/vitest";
import { Refused } from "./failure.ts";

const refusalContract = () => {
  // Each reason, written with the fields it has.
  const given = [
    new Refused({ reason: "no-manifest", packages: [] }),
    new Refused({ reason: "bad-manifest", packages: ["pkg"] }),
    new Refused({ reason: "not-installed", packages: ["pkg"] }),
    new Refused({ reason: "bad-field", packages: ["pkg"], field: "cli" }),
    new Refused({ reason: "not-exported", packages: ["pkg"], field: "cli", subpath: "./cli" }),
    new Refused({ reason: "load", packages: ["pkg"], field: "cli", subpath: "./cli" }),
    new Refused({ reason: "no-subcommand", packages: ["pkg"], field: "cli", subpath: "./cli" }),
  ];

  expectTypeOf(given).toEqualTypeOf<Array<Refused>>();

  // K24 plant: make `field` and `subpath` optional again in `failure.ts`, and every `@ts-expect-error` below is unused.
  // @ts-expect-error an entry that cannot be loaded names its field and its subpath
  const loadNoFields = new Refused({ reason: "load", packages: ["pkg"] });

  // @ts-expect-error an entry that exports no subcommand names its field and its subpath
  const noSubcommandNoFields = new Refused({ reason: "no-subcommand", packages: ["pkg"] });

  // @ts-expect-error an entry with no `default` condition names its field and its subpath
  const notExportedNoFields = new Refused({ reason: "not-exported", packages: ["pkg"] });

  // @ts-expect-error a subpath with no field
  const loadNoField = new Refused({ reason: "load", packages: ["pkg"], subpath: "./cli" });

  // @ts-expect-error a field with no subpath
  const loadNoSubpath = new Refused({ reason: "load", packages: ["pkg"], field: "cli" });

  // @ts-expect-error a subpath with no field
  const noSubcommandNoField = new Refused({ reason: "no-subcommand", packages: ["pkg"], subpath: "./cli" });

  // @ts-expect-error a field with no subpath
  const noSubcommandNoSubpath = new Refused({ reason: "no-subcommand", packages: ["pkg"], field: "cli" });

  // @ts-expect-error a subpath with no field
  const notExportedNoField = new Refused({ reason: "not-exported", packages: ["pkg"], subpath: "./cli" });

  // @ts-expect-error a field with no subpath
  const notExportedNoSubpath = new Refused({ reason: "not-exported", packages: ["pkg"], field: "cli" });

  // A reason whose message names no field or subpath takes none.
  // @ts-expect-error no `package.json` is a refusal of the folder, which has no field
  const noManifestField = new Refused({ reason: "no-manifest", packages: [], field: "cli" });

  // @ts-expect-error a `package.json` that cannot be read has no field
  const badManifestField = new Refused({ reason: "bad-manifest", packages: ["pkg"], field: "cli" });

  // @ts-expect-error a package that is not installed was not read, so no subpath of it was
  const notInstalledSubpath = new Refused({ reason: "not-installed", packages: ["pkg"], subpath: "./cli" });

  expectTypeOf([
    loadNoFields,
    noSubcommandNoFields,
    notExportedNoFields,
    loadNoField,
    loadNoSubpath,
    noSubcommandNoField,
    noSubcommandNoSubpath,
    notExportedNoField,
    notExportedNoSubpath,
    noManifestField,
    badManifestField,
    notInstalledSubpath,
  ]).toBeArray();
};

it("K24 type: a refusal names the field and the subpath it was reading for each reason that reads one, and for no other", () => {
  expectTypeOf(refusalContract).toBeFunction();
});
