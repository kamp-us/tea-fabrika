// K17 (kalfa/cli's plan, slice 1): the kalfa packages' manifests, read as they stand at head. The `kalfa` command finds
// a subcommand through a package's `kalfa.cli` field, so a package that has the field must export one it would accept,
// and only the command's own package may have a `bin`. Each reads the tracked manifests, as `law-ids.ts` lists files,
// and runs on every pull request.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Array as Arr, Predicate, Record as Rec, Schema } from "effect";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

const Manifest = Schema.Struct({
  name: Schema.String,
  bin: Schema.optional(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)])),
  kalfa: Schema.optional(Schema.Struct({ cli: Schema.optional(Schema.String) })),
  exports: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

interface Package {
  readonly folder: string;
  readonly manifest: typeof Manifest.Type;
}

/** The tracked `kalfa/<package>/package.json` files, read and decoded. */
const packages = (): ReadonlyArray<Package> => {
  const listed = spawnSync("git", ["ls-files", "-z", "--", "kalfa/*/package.json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 2 ** 30,
  });

  expect(listed.status, `git ls-files: ${listed.stderr}`).toBe(0);

  const files = listed.stdout.split("\0").filter((file) => file !== "");

  expect(files.length, "git listed the kalfa packages").toBeGreaterThan(0);

  return Arr.map(files, (file) => ({
    folder: dirname(file),
    manifest: Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(readFileSync(join(ROOT, file), "utf8")),
  }));
};

/** The file an entry point of a package's `exports` names, when it is written as one plain path. */
const target = (found: Package, entry: string): string | undefined => {
  const written = found.manifest.exports?.[entry];

  return Predicate.isString(written) ? join(ROOT, found.folder, written) : undefined;
};

describe("K17, the kalfa packages' manifests", () => {
  // Plant: add `"bin": { "kalfa-records": "./src/bin.ts" }` to kalfa/records/package.json, and that package is named in
  // the failure; name the command's own bin anything but `kalfa`, and its keys are named.
  it("K17 scenario: only @kalfa/cli has a bin, and it is named kalfa", () => {
    // scenario: the tracked manifests at head; no generated input says what a manifest holds.
    const withBin = packages().filter((found) => found.manifest.bin !== undefined);

    expect(withBin.map((found) => found.manifest.name).filter((name) => name !== "@kalfa/cli")).toEqual([]);

    for (const found of withBin) {
      const bin = found.manifest.bin;

      expect(Predicate.isString(bin) ? [found.manifest.name] : Rec.keys(bin ?? {}), found.folder).toEqual(["kalfa"]);
    }
  });

  // Plant: leave `kalfa.cli` on kalfa/records, whose `./cli` exports `records` and no `subcommand`, and the failure
  // names kalfa/records; the same on kalfa/quality.
  it("K17 scenario: every package with a kalfa.cli field has an entry whose subcommand export passes isSubcommand", async () => {
    // scenario: the tracked manifests at head; no generated input says what a manifest holds.
    const named = packages().filter((found) => found.manifest.kalfa?.cli !== undefined);
    const problems: Array<string> = [];

    for (const found of named) {
      const entry = found.manifest.kalfa?.cli ?? "";
      const file = target(found, entry);

      if (file === undefined) {
        problems.push(`${found.folder}: kalfa.cli names ${entry}, which exports does not give as one path`);
        continue;
      }

      const loaded: unknown = await import(pathToFileURL(file).href);

      if (!Predicate.hasProperty(loaded, "subcommand") || !Object.hasOwn(loaded, "subcommand")) {
        problems.push(`${found.folder}: ${entry} exports no subcommand`);
        continue;
      }

      // The command's own check is read only here, so a missing module is no reason a package with no subcommand fails.
      const { isSubcommand } = await import("@kalfa/cli/Subcommand");

      if (!isSubcommand(loaded.subcommand)) {
        problems.push(`${found.folder}: the subcommand ${entry} exports is not one \`make\` built`);
      }
    }

    expect(problems).toEqual([]);
  });
});
