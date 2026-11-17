// `pnpm lint:reach`: every workspace package is reached, so a part nothing uses cannot stay in the
// repo (decision 0003). A package is reached when the root package.json or a reached package names
// it as a dependency. A start is a package nothing may depend on by its role: an app, a tutorial,
// this lint package, CI's own package. Today's version only: next/ is left out while it grows.
//
//   node oxlint-plugins/workspace-reach.ts            # this repo
//   node oxlint-plugins/workspace-reach.ts <folder>   # another git tree, as the test does
//
// Exit 0 when every package is reached, 1 on a package nothing reaches, 2 when it could not read.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Array as Arr, pipe, Record as Rec, Result } from "effect";
import { parse } from "yaml";

/** Folders whose packages are starts: nothing depends on an app, a tutorial or a tool. */
const STARTS = ["apps/*", "docs/tutorials/*", "oxlint-plugins", ".github/ci"];

/** next/ is left out while it grows: Tier 1 builds a piece before its app names it. */
const LEFT_OUT = /^next\//;

const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Arr.isArray(value);

/** A pnpm-workspace.yaml glob as a test on a folder: `*` is one path part, as pnpm reads it here. */
const matcher = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .replace(/\/$/, "")
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]+")}$`,
  );

const root = process.argv[2] ?? join(import.meta.dirname, "..");

type Manifest = { readonly name: string | null; readonly deps: readonly string[] };

const read = (file: string): Manifest => {
  const manifest: unknown = JSON.parse(readFileSync(join(root, file), "utf8"));

  if (!isMap(manifest)) {
    throw new Error(`${file}: not an object`);
  }

  const deps = Arr.flatMap(FIELDS, (field) => {
    const map = manifest[field];

    return isMap(map) ? Rec.keys(map) : [];
  });

  return { name: typeof manifest["name"] === "string" ? manifest["name"] : null, deps };
};

const tracked = spawnSync("git", ["ls-files", "-z", "--", "package.json", "**/package.json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 2 ** 30,
});

const fail = (why: string): never => {
  console.error(`workspace-reach: ${why}`);
  process.exit(2);
};

if (tracked.status !== 0) {
  fail(`git could not list files.\n${tracked.stderr}`);
}

const run = (): { readonly unreached: readonly string[]; readonly total: number } => {
  const workspace: unknown = parse(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"));
  const globs = isMap(workspace) && Arr.isArray(workspace["packages"]) ? workspace["packages"] : [];

  const members = pipe(
    globs,
    Arr.filter((g): g is string => typeof g === "string"),
    Arr.map(matcher),
  );

  const starts = Arr.map(STARTS, matcher);

  const folders = pipe(
    tracked.stdout.split("\0"),
    Arr.filter((file) => file !== "" && file !== "package.json"),
    Arr.map((file) => dirname(file)),
    Arr.filter((folder) => !LEFT_OUT.test(folder) && Arr.some(members, (m) => m.test(folder))),
  );

  const byName = new Map<string, { readonly folder: string; readonly manifest: Manifest }>();

  for (const folder of folders) {
    const manifest = read(join(folder, "package.json"));

    if (manifest.name !== null) {
      byName.set(manifest.name, { folder, manifest });
    }
  }

  const reached = new Set<string>();

  const queue = [
    ...read("package.json").deps,
    ...pipe(
      [...byName.values()],
      Arr.filter(({ folder }) => Arr.some(starts, (s) => s.test(folder))),
      Arr.flatMap(({ manifest }) => (manifest.name === null ? [] : [manifest.name])),
    ),
  ];

  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    const found = byName.get(name);

    if (found === undefined || reached.has(name)) {
      continue;
    }

    reached.add(name);
    queue.push(...found.manifest.deps);
  }

  const unreached = pipe(
    [...byName.entries()],
    Arr.filter(([name]) => !reached.has(name)),
    Arr.map(([name, { folder }]) => `${folder} (${name})`),
  ).sort();

  return { unreached, total: byName.size };
};

const result: ReturnType<typeof run> = Result.match(Result.try(run), {
  onSuccess: (ran) => ran,
  onFailure: (error) => fail(`could not read: ${String(error)}`),
});

if (result.unreached.length > 0) {
  for (const line of result.unreached) {
    console.error(`${line}: no app, tool or root reaches it`);
  }

  console.error(
    `workspace-reach: ${result.unreached.length} unreached. Delete the package, or name it as a dependency where it is used (decision 0003).`,
  );
  process.exit(1);
}

console.log(`workspace-reach: ${result.total} packages, every one reached`);
