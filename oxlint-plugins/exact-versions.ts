// `pnpm lint:versions`: no ranged npm version, in any package.json or pnpm-workspace.yaml git tracks
// (docs/direction/pin-exact-versions.md). It lists what passes, so a range, a tag, a `git:` or a
// `file:` all fail without being named here.
//
//   node oxlint-plugins/exact-versions.ts            # this repo
//   node oxlint-plugins/exact-versions.ts <folder>   # another git tree, as the test does
//
// Exit 0 when clean, 1 on a version it refuses, 2 when it could not read something.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { parse } from "yaml";

/** `catalog:` holds its version in pnpm-workspace.yaml, which is checked too. `workspace:*` is the
 * sibling in this repo, written as its exact version in a pack. `workspace:^` would be a range. */
const POINTERS = new Set(["catalog:", "workspace:*"]);
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
// A package.json can name a version in these too, and pnpm reads `pnpm.overrides` there as well.
const OVERRIDES = ["overrides", "resolutions"];

const passes = (version: unknown): boolean =>
  typeof version === "string" && (POINTERS.has(version) || EXACT.test(version));

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One line per name in `map` whose version does not pass. */
const refused = (file: string, field: string, map: unknown): readonly string[] =>
  isMap(map)
    ? Object.entries(map)
        .filter(([, version]) => !passes(version))
        .map(([name, version]) => `${file}: ${field}: ${name}: ${JSON.stringify(version)}`)
    : [];

const inPackage = (file: string, text: string): readonly string[] => {
  const manifest: unknown = JSON.parse(text);

  if (!isMap(manifest)) {
    throw new Error("not an object");
  }

  const { pnpm } = manifest;
  return [
    ...[...FIELDS, ...OVERRIDES].flatMap((field) => refused(file, field, manifest[field])),
    ...(isMap(pnpm) ? refused(file, "pnpm.overrides", pnpm["overrides"]) : []),
  ];
};

const inWorkspace = (file: string, text: string): readonly string[] => {
  const workspace: unknown = parse(text);

  if (!isMap(workspace)) {
    return [];
  }

  const { catalog, catalogs, overrides } = workspace;
  return [
    ...refused(file, "catalog", catalog),
    ...(isMap(catalogs)
      ? Object.entries(catalogs).flatMap(([name, map]) => refused(file, `catalogs.${name}`, map))
      : []),
    ...refused(file, "overrides", overrides),
  ];
};

const READERS: Readonly<Record<string, (file: string, text: string) => readonly string[]>> = {
  "package.json": inPackage,
  "pnpm-workspace.yaml": inWorkspace,
};

const root = process.argv[2] ?? join(import.meta.dirname, "..");

const tracked = spawnSync(
  "git",
  ["ls-files", "-z", "--", ...Object.keys(READERS).flatMap((name) => [name, `**/${name}`])],
  {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 ** 30,
  },
);

const files = tracked.stdout.split("\0").filter((file) => file !== "");

const check = (file: string): readonly string[] => {
  const read = READERS[basename(file)];

  if (read === undefined) {
    throw new Error("no reader");
  }

  return read(file, readFileSync(join(root, file), "utf8"));
};

/** What one file refuses, or the line saying it could not be read. */
const attempt = (file: string) =>
  Effect.try({
    try: (): { readonly lines: readonly string[]; readonly broken: boolean } => ({ lines: check(file), broken: false }),
    catch: (error) => `${file}: could not read: ${String(error)}`,
  }).pipe(Effect.catch((line) => Effect.succeed({ lines: [line], broken: true })));

/** The run, from what git listed: it prints what it refuses and answers the exit code. */
const main = Effect.gen(function* () {
  // No file read must never read as clean.
  if (tracked.status !== 0 || files.length === 0) {
    yield* Console.error(`exact-versions: git found no files to check.\n${tracked.stderr}`);
    return 2;
  }

  // One file at a time, as git listed them: the lines print in that order.
  const results = yield* Effect.forEach(files, attempt, { concurrency: 1 });
  const lines = results.flatMap((result) => result.lines);

  for (const line of lines) {
    yield* Console.error(line);
  }

  if (results.some((result) => result.broken)) {
    return 2;
  }

  if (lines.length > 0) {
    yield* Console.error(
      `exact-versions: ${lines.length} not exact. Write the version itself, or \`catalog:\` with the exact version in the catalog. See docs/direction/pin-exact-versions.md.`,
    );
    return 1;
  }

  yield* Console.log(`exact-versions: ${files.length} files, every version exact`);
  return 0;
});

process.exitCode = Effect.runSync(main);
