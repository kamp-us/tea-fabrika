// `pnpm lint:manifests`: p65, `next/` stands alone (docs/plan/tier-1-detail.md, "Packages" and p65).
// Each package's `package.json` is private at 0.0.0, has no side effects and a typecheck script, and
// depends on nothing of today's: no `-old` package, and no workspace package outside `next/` but the
// design package, which only the window and the app may take. This was the manifest half of the
// exam's `deps.integration.test.ts` until 0591 made it a lint command; the import half is the rule
// `fabrika/package-deps`, and the bundle laws stay in that test. Its laws are in
// `next-manifests.test.ts`.
//
//   node oxlint-plugins/next-manifests.ts            # this repo
//   node oxlint-plugins/next-manifests.ts <folder>   # another tree, as the test does
//
// A package is a child folder of `next/packages`, `next/programs` or `next/apps` (pnpm-workspace.yaml's
// next/ globs) that holds a `package.json`. Exit 0 when every manifest passes, 1 on a fault.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";

const GROUPS = ["packages", "programs", "apps"] as const;

const Names = Schema.optional(Schema.Record(Schema.String, Schema.String));

const Manifest = Schema.Struct({
  name: Schema.String,
  version: Schema.optional(Schema.String),
  private: Schema.optional(Schema.Boolean),
  sideEffects: Schema.optional(Schema.Unknown),
  scripts: Names,
  dependencies: Names,
  devDependencies: Names,
  peerDependencies: Names,
  optionalDependencies: Names,
});

const readManifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest));

/** p65's one outside package (docs/direction/fabrika-design-package.md): the design package, shared by
 *  both versions, which the window (`@kampus/tuval`) and the app import. No other `next/` package may. */
const DESIGN = "@kampus/fabrika-design";

const DESIGN_TAKERS: ReadonlySet<string> = new Set(["@kampus/tuval", "@kampus/fabrika"]);

/** What is wrong with a manifest, as the command prints it. */
const REASONS = {
  public: "not private",
  version: "version is not 0.0.0",
  sideEffects: "sideEffects is not false",
  typecheck: "no typecheck script",
  today: "depends on today's version",
  outside: "depends on a workspace package outside next/",
} as const;

/** One manifest fault: the manifest, from the top of the tree, which fault, and the dependency it names. */
interface ManifestFault {
  readonly file: string;
  readonly reason: keyof typeof REASONS;
  readonly dependency?: string;
}

/** Every manifest fault of the `next/` packages under `root`. */
export const manifestFaults = (root: string): ReadonlyArray<ManifestFault> => {
  const packages = GROUPS.flatMap((group) => {
    const folder = join(root, "next", group);

    return existsSync(folder)
      ? readdirSync(folder, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && existsSync(join(folder, entry.name, "package.json")))
          .map((entry) => {
            const file = `next/${group}/${entry.name}/package.json`;

            return { file, manifest: readManifest(readFileSync(join(root, file), "utf8")) };
          })
      : [];
  });

  const ours = new Set(packages.map((pkg) => pkg.manifest.name));

  return packages.flatMap(({ file, manifest: m }): ReadonlyArray<ManifestFault> => {
    const listed = [m.dependencies, m.devDependencies, m.peerDependencies, m.optionalDependencies].flatMap((names) =>
      Object.entries(names ?? {}),
    );

    return [
      ...(m.private === true ? [] : [{ file, reason: "public" as const }]),
      ...(m.version === "0.0.0" ? [] : [{ file, reason: "version" as const }]),
      ...(m.sideEffects === false ? [] : [{ file, reason: "sideEffects" as const }]),
      ...(m.scripts?.["typecheck"] === undefined ? [{ file, reason: "typecheck" as const }] : []),
      ...listed.flatMap(([dependency, range]) => [
        ...(dependency.endsWith("-old") ? [{ file, reason: "today" as const, dependency }] : []),
        ...(range.startsWith("workspace:") &&
        !ours.has(dependency) &&
        !(dependency === DESIGN && DESIGN_TAKERS.has(m.name))
          ? [{ file, reason: "outside" as const, dependency }]
          : []),
      ]),
    ];
  });
};

if (import.meta.main) {
  const found = manifestFaults(process.argv[2] ?? join(import.meta.dirname, ".."));

  for (const fault of found) {
    console.error(
      `${fault.file}: ${REASONS[fault.reason]}${fault.dependency === undefined ? "" : `: ${fault.dependency}`}`,
    );
  }

  console.info(`lint:manifests: ${found.length} findings`);
  process.exitCode = found.length === 0 ? 0 : 1;
}
