// Today's CI and the laptop, both versions: the changed files Vitest's `--changed` starts from.
//
// Vitest selects every test when a changed file matches a rerun trigger (vitest.config.ts), and the
// lockfile, each `tsconfig*.json` and each `package.json` are triggers. So a pull request that only
// deletes one package, and so edits the lockfile, ran every test. This provider gives Vitest git's
// changed files, as its own does, with each of those files swapped for the test files it reaches:
//
//   changed file                  reaches
//   pnpm-lock.yaml                the packages whose entry or resolved packages changed
//   a package's tsconfig*.json    that package
//   a package's package.json      that package; a changed install-time or pre/post script, all
//   the root package.json         a changed script's tests; other keys and those scripts, all
//
// A package reached also reaches every package that depends on it and every package inside its
// folder, and a test that names the changed file by its path reads it as text. Unknown means all, never none: when a
// file cannot be read, parsed or tied to a package, it stays in the list, and its trigger selects
// every test as before. This is how Nx's `projectsAffectedByDependencyUpdates: "auto"` and
// Turborepo's lockfile diff read a lockfile change.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import type { InlineConfig } from "vitest/node";
import { parseAllDocuments } from "yaml";

/**
 * What the narrowing reads: a file's text where the change starts (`before`) and now, `undefined`
 * when the file is absent or cannot be read, and every file there is now, from the repo's top.
 */
export type Repository = {
  readonly before: (path: string) => string | undefined;
  readonly now: (path: string) => string | undefined;
  readonly files: readonly string[];
};

/** What one changed file reaches: every test, or the tests of some packages and of the readers. */
type Reach =
  | { readonly _tag: "all" }
  | { readonly _tag: "some"; readonly packages: readonly string[]; readonly readers: readonly RegExp[] };

const ALL: Reach = { _tag: "all" };
const NONE: Reach = { _tag: "some", packages: [], readers: [] };

/** A test file, by Vitest's default name, outside the folders vitest.config.ts excludes (toy repos, builds). */
const test = (path: string) =>
  /\.test\.[cm]?[jt]sx?$/.test(path) && !/(?:^|\/)(?:fixtures|node_modules|dist)\//.test(path);

const LOCKFILE = "pnpm-lock.yaml";
const TSCONFIG = /^tsconfig.*\.json$/;

/**
 * Tests that name a file by its path from the top read it as text, as vitest.config.ts's
 * `githubReads` takes them. A name in a comment counts. A reader on a rerun trigger's path, such as
 * oxlint-plugins/, makes Vitest select all, so it is never missed. next/'s tests that read every
 * manifest or tsconfig are changes.mjs's `readers`, which a sized run always adds.
 */
const names = (file: string) => new RegExp(file.replaceAll(".", "\\."));

/** Tests that name a script, as `pnpm lint:twin` or `"lint:twin"` does, may run it. */
const script = (name: string) =>
  new RegExp(`(?<![\\w:/.-])${name.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w:/.-])`);

/** The changed files this narrows. Every other file stays as it is. */
const narrowed = (path: string) =>
  path === LOCKFILE || posix.basename(path) === "package.json" || TSCONFIG.test(posix.basename(path));

type Json = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : isRecord(value)
      ? Object.fromEntries(
          Object.keys(value)
            .toSorted()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;

const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const entries = (value: unknown): [string, unknown][] => (isRecord(value) ? Object.entries(value) : []);

/** Vitest's `--changed` provider, as its config types it: Vitest 5.0.5 does not export the type itself. */
type VCSProvider = Exclude<NonNullable<NonNullable<InlineConfig["experimental"]>["vcsProvider"]>, string>;

/** One pnpm lockfile, format 9.0: the earlier YAML documents (pnpm's own), and the main one's parts. */
type Lock = {
  readonly earlier: readonly unknown[];
  readonly rest: Json;
  readonly importers: Json;
  readonly packages: Json;
  readonly snapshots: Json;
};

/** `undefined` for text that is no lockfile of format 9.0, the one this reads. */
const parseLock = (text: string | undefined): Lock | undefined => {
  if (text === undefined) {
    return undefined;
  }

  const documents = parseAllDocuments(text);

  if (!Array.isArray(documents) || documents.length === 0 || documents.some((doc) => doc.errors.length > 0)) {
    return undefined;
  }

  const values: unknown[] = documents.map((doc) => doc.toJS());
  const main = values.at(-1);

  if (!isRecord(main) || main["lockfileVersion"] !== "9.0") {
    return undefined;
  }

  const { importers = {}, packages = {}, snapshots = {}, ...rest } = main;

  if (!isRecord(importers) || !isRecord(packages) || !isRecord(snapshots)) {
    return undefined;
  }

  return { earlier: values.slice(0, -1), rest, importers, packages, snapshots };
};

/** A dependency's snapshot key, as pnpm's `refToRelative` makes it; `undefined` for a workspace link. */
const keyOf = (name: string, ref: string): string | undefined => {
  if (ref.startsWith("link:")) {
    return undefined;
  }

  if (ref.startsWith("@")) {
    return ref;
  }

  const at = ref.indexOf("@");
  const colon = ref.indexOf(":");
  const bracket = ref.indexOf("(");
  return at !== -1 && (colon === -1 || at < colon) && (bracket === -1 || at < bracket) ? ref : `${name}@${ref}`;
};

/** A snapshot key's `packages:` key: the key without its peer and patch suffix. */
const packageOf = (key: string) => (key.includes("(") ? key.slice(0, key.indexOf("(")) : key);

const DEPENDENCIES = ["dependencies", "devDependencies", "optionalDependencies"];

/** An importer's dependencies, each `[name, version]`, as its entry lists them. */
const direct = (importer: unknown): [string, string][] =>
  DEPENDENCIES.flatMap((field) =>
    entries(isRecord(importer) ? importer[field] : undefined).flatMap(([name, dependency]): [string, string][] =>
      isRecord(dependency) && typeof dependency["version"] === "string" ? [[name, dependency["version"]]] : [],
    ),
  );

/** Every snapshot key an importer resolves, transitive ones included. */
const closure = (lock: Lock, importer: unknown): Set<string> => {
  const seen = new Set<string>();
  const todo = direct(importer);

  for (let next = todo.pop(); next !== undefined; next = todo.pop()) {
    const key = keyOf(...next);

    if (key !== undefined && !seen.has(key)) {
      seen.add(key);
      const snapshot = lock.snapshots[key];

      for (const field of ["dependencies", "optionalDependencies"]) {
        for (const [name, ref] of entries(isRecord(snapshot) ? snapshot[field] : undefined)) {
          todo.push([name, String(ref)]);
        }
      }
    }
  }

  return seen;
};

/** The folders an importer links to, from the repo's top. */
const links = (dir: string, importer: unknown): string[] =>
  direct(importer).flatMap(([, version]) =>
    version.startsWith("link:") ? [posix.normalize(posix.join(dir, version.slice("link:".length)))] : [],
  );

/** An importer's entry less its links to `gone` folders: a removed package's edges leave with it. */
const without = (dir: string, importer: unknown, gone: ReadonlySet<string>): unknown =>
  isRecord(importer)
    ? Object.fromEntries(
        Object.entries(importer).map(([field, value]) => [
          field,
          DEPENDENCIES.includes(field)
            ? Object.fromEntries(
                entries(value).filter(([, dependency]) => {
                  const version = isRecord(dependency) ? dependency["version"] : undefined;
                  return !(
                    typeof version === "string" &&
                    version.startsWith("link:") &&
                    gone.has(posix.normalize(posix.join(dir, version.slice("link:".length))))
                  );
                }),
              )
            : value,
        ]),
      )
    : importer;

/** The workspace's packages: every folder an importer names in either lockfile, and who links to whom. */
type Workspace = {
  readonly now: ReadonlySet<string>;
  readonly before: ReadonlySet<string>;
  readonly links: ReadonlyMap<string, readonly string[]>;
};

const workspaceOf = (before: Lock | undefined, now: Lock): Workspace => {
  const edges = new Map<string, string[]>();

  for (const lock of before === undefined ? [now] : [before, now]) {
    for (const [dir, importer] of Object.entries(lock.importers)) {
      edges.set(dir, [...new Set([...(edges.get(dir) ?? []), ...links(dir, importer)])]);
    }
  }

  return {
    now: new Set(Object.keys(now.importers)),
    before: new Set(Object.keys(before?.importers ?? {})),
    links: edges,
  };
};

/** The deepest package folder that holds `path`, or the root, `.`. */
const ownerOf = (workspace: Workspace, path: string): string =>
  [...workspace.now, ...workspace.before]
    .filter((dir) => dir !== "." && path.startsWith(`${dir}/`))
    .reduce((deepest, dir) => (dir.length > deepest.length ? dir : deepest), ".");

/**
 * What a lockfile change reaches: the importers whose entry changed, less links to removed ones,
 * or whose resolved packages changed, and the importers that are new. A removed importer reaches
 * nothing. Everything else that changed must be one of those packages, or the change reaches all:
 * pnpm's own document, `settings`, `catalogs`, `overrides`, `patchedDependencies`, a package no
 * importer resolves, and the root's own entry, which every folder's imports can resolve through.
 */
const lockReach = (before: Lock | undefined, now: Lock | undefined): Reach => {
  if (before === undefined || now === undefined || !same(before.earlier, now.earlier) || !same(before.rest, now.rest)) {
    return ALL;
  }

  const gone = new Set(Object.keys(before.importers).filter((dir) => !Object.hasOwn(now.importers, dir)));
  const value = (lock: Lock, key: string) => [lock.snapshots[key], lock.packages[packageOf(key)]];
  const closures = (lock: Lock) =>
    new Map(Object.entries(lock.importers).map(([dir, importer]) => [dir, closure(lock, importer)]));
  const earlier = closures(before);
  const later = closures(now);
  const reached = new Set([...earlier.values(), ...later.values()].flatMap((keys) => [...keys]));
  const packages = [...later].flatMap(([dir, after]) => {
    const start = earlier.get(dir);
    return start === undefined ||
      !same(without(dir, before.importers[dir], gone), without(dir, now.importers[dir], gone)) ||
      !same([...start].toSorted(), [...after].toSorted()) ||
      [...after].some((key) => !same(value(before, key), value(now, key)))
      ? [dir]
      : [];
  });

  const resolved = new Set([...reached].map(packageOf));
  const changed = (field: "packages" | "snapshots", known: ReadonlySet<string>) =>
    [...new Set([...Object.keys(before[field]), ...Object.keys(now[field])])].some(
      (key) => !same(before[field][key], now[field][key]) && !known.has(key),
    );

  if (packages.includes(".") || changed("snapshots", reached) || changed("packages", resolved)) {
    return ALL;
  }

  return { _tag: "some", packages, readers: [names(LOCKFILE)] };
};

/** Quoted strings in a tsconfig: its `extends` among them. JSON with comments needs no parser for that. */
const strings = (text: string) => [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1] ?? "");

/**
 * What a `tsconfig*.json` change reaches: its package. The root's, any outside a package, and any
 * that another package's tsconfig may extend reach all. A tsconfig of a removed package reaches
 * nothing.
 */
const tsconfigReach = (path: string, workspace: Workspace, repo: Repository): Reach => {
  const owner = ownerOf(workspace, path);

  if (owner === ".") {
    return ALL;
  }

  if (!workspace.now.has(owner)) {
    return NONE;
  }

  // A relative string names the file when it resolves to it, with or without `.json`, as `extends`
  // does. A package name (`@scope/tsconfig/base.json`) is matched by its file name alone.
  const points = (file: string, value: string) =>
    value.startsWith(".")
      ? [value, `${value}.json`].some((target) => posix.join(posix.dirname(file), target) === path)
      : (value.endsWith(".json") || value.includes("tsconfig")) &&
        [value, `${value}.json`].some((target) => posix.basename(target) === posix.basename(path));
  const extended = repo.files
    .filter((file) => file !== path && TSCONFIG.test(posix.basename(file)) && ownerOf(workspace, file) !== owner)
    .some((file) => strings(repo.now(file) ?? "").some((value) => points(file, value)));

  return extended ? ALL : { _tag: "some", packages: [owner], readers: [names(path)] };
};

/** The root `package.json`'s keys that narrow: scripts, and dependencies the lockfile then decides. */
const ROOT_KEYS = new Set(["scripts", ...DEPENDENCIES]);

const parseJson = (text: string | undefined): Json | undefined => {
  try {
    const value: unknown = text === undefined ? undefined : JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The scripts pnpm runs with no one naming them: those `pnpm install` runs in every workspace
 * project (pnpm 12's docs, "Lifecycle scripts": `preinstall`, `install`, `postinstall`,
 * `preprepare`, `prepare`, `postprepare`), `pnpm:devPreinstall`, the pack and publish ones, and
 * every `pre`/`post` hook, which `enablePrePostScripts`, true by default and not set here, runs
 * around its script. A test that runs `pnpm lint` never names `prelint`.
 */
const UNNAMED = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "pnpm:devPreinstall",
  "prepublish",
  "prepublishOnly",
  "publish",
  "prepack",
  "pack",
  "postpack",
]);

const unnamed = (name: string) => UNNAMED.has(name) || name.startsWith("pre") || name.startsWith("post");

/** The names of the scripts that differ between two manifests. */
const changedScripts = (
  before: Json,
  now: Json,
): { readonly names: Set<string>; readonly bodies: [string, unknown][] } => {
  const earlier = isRecord(before["scripts"]) ? before["scripts"] : {};
  const later = isRecord(now["scripts"]) ? now["scripts"] : {};
  return {
    names: new Set(
      [...new Set([...Object.keys(earlier), ...Object.keys(later)])].filter(
        (name) => !same(earlier[name], later[name]),
      ),
    ),
    bodies: [...Object.entries(earlier), ...Object.entries(later)],
  };
};

/**
 * What the root `package.json` reaches. A change to its scripts reaches the tests that name a
 * changed script, or a script that runs one: a test reads a script by its name, or runs it. A change to its
 * dependencies is the lockfile's to decide, so it narrows only beside a lockfile change. A change
 * to any other key (`engines`, `type`, `packageManager`, `volta`) reaches all, and so does a
 * change to a script pnpm runs unnamed (`UNNAMED`).
 */
const rootReach = (changed: readonly string[], repo: Repository): Reach => {
  const before = parseJson(repo.before("package.json"));
  const now = parseJson(repo.now("package.json"));

  if (before === undefined || now === undefined) {
    return ALL;
  }

  const keys = [...new Set([...Object.keys(before), ...Object.keys(now)])].filter(
    (key) => !same(before[key], now[key]),
  );

  if (
    keys.some((key) => !ROOT_KEYS.has(key)) ||
    (keys.some((key) => DEPENDENCIES.includes(key)) && !changed.includes(LOCKFILE))
  ) {
    return ALL;
  }

  const { names: scripts, bodies } = changedScripts(before, now);

  if ([...scripts].some(unnamed)) {
    return ALL;
  }

  for (let grew = true; grew;) {
    grew = false;

    for (const [name, body] of bodies) {
      if (!scripts.has(name) && [...scripts].some((other) => script(other).test(String(body)))) {
        scripts.add(name);
        grew = true;
      }
    }
  }

  return { _tag: "some", packages: [], readers: [...scripts].map(script) };
};

/**
 * What a package's own `package.json` reaches: that package. One outside every package reaches all,
 * and so does a change to a script pnpm runs unnamed, since `pnpm install` runs those in every
 * workspace project.
 */
const manifestReach = (path: string, changed: readonly string[], workspace: Workspace, repo: Repository): Reach => {
  if (path === "package.json") {
    return rootReach(changed, repo);
  }

  const dir = posix.dirname(path);

  if (workspace.now.has(dir)) {
    const before = parseJson(repo.before(path)) ?? {};
    const now = parseJson(repo.now(path));
    return now === undefined || [...changedScripts(before, now).names].some(unnamed)
      ? ALL
      : { _tag: "some", packages: [dir], readers: [names(path)] };
  }

  return workspace.before.has(dir) ? NONE : ALL;
};

/** The packages `packages` reach: each package that links to one, and each inside one's folder, until none is added. */
const spread = (packages: readonly string[], workspace: Workspace): Set<string> => {
  const reached = new Set(packages);

  for (let grew = true; grew;) {
    grew = false;

    for (const dir of [...workspace.now, ...workspace.before]) {
      const links = workspace.links.get(dir) ?? [];

      if (
        !reached.has(dir) &&
        (links.some((target) => reached.has(target)) ||
          [...reached].some((parent) => parent !== "." && dir.startsWith(`${parent}/`)))
      ) {
        reached.add(dir);
        grew = true;
      }
    }
  }

  return reached;
};

/**
 * The changed files for Vitest's graph walk: `changed`, with each lockfile, `tsconfig*.json` and
 * `package.json` swapped for the test files it reaches. When any one of them reaches all, or
 * anything goes wrong reading them, `changed` comes back as it is, and its triggers select all.
 */
export const narrow = (changed: readonly string[], repo: Repository): string[] => {
  const kept = changed.filter((path) => !narrowed(path));

  if (kept.length === changed.length) {
    return [...changed];
  }

  try {
    const now = parseLock(repo.now(LOCKFILE));

    if (now === undefined) {
      return [...changed];
    }

    const before = changed.includes(LOCKFILE) ? parseLock(repo.before(LOCKFILE)) : now;
    const workspace = workspaceOf(before, now);
    const reaches = changed
      .filter(narrowed)
      .map((path) =>
        path === LOCKFILE
          ? lockReach(before, now)
          : TSCONFIG.test(posix.basename(path))
            ? tsconfigReach(path, workspace, repo)
            : manifestReach(path, changed, workspace, repo),
      );
    const some = reaches.flatMap((reach) => (reach._tag === "some" ? [reach] : []));

    if (some.length < reaches.length) {
      return [...changed];
    }

    const packages = spread(
      some.flatMap((reach) => reach.packages),
      workspace,
    );
    const readers = some.flatMap((reach) => reach.readers);
    const tests = repo.files.filter(
      (file) =>
        test(file) &&
        (packages.has(ownerOf(workspace, file)) || readers.some((reader) => reader.test(repo.now(file) ?? ""))),
    );
    return [...new Set([...kept, ...tests])];
  } catch {
    return [...changed];
  }
};

/** git's answer, or `undefined` when it fails. */
const git = (top: string, args: readonly string[]): string | undefined => {
  const done = spawnSync("git", args, { cwd: top, encoding: "utf8", maxBuffer: 2 ** 28 });
  return done.status === 0 ? done.stdout : undefined;
};

/** git's paths, as Vitest's own provider lists them; a failed command throws, as there. */
const paths = (top: string, args: readonly string[]): string[] => {
  const out = git(top, args);

  if (out === undefined) {
    throw new Error(`vitest.changed: git ${args.join(" ")} failed`);
  }

  return out.split("\0").filter((path) => path !== "");
};

/**
 * Vitest's `--changed` provider (`experimental.vcsProvider`). It lists what Vitest 5.0.5's own git
 * provider lists: the commits since the merge base with `changedSince`, the staged files, and the
 * files changed or new in the tree; then narrows them. `before` reads the merge base, or `HEAD`
 * when no commit is given.
 *
 * Vitest calls it only for `--changed`, with `{ root, changedSince }`: `changedSince` is the
 * commit given, or `true` for none (Vitest 5.0.5's `filterTestsBySource`). `vcsProvider` is
 * experimental, so a later Vitest may call it otherwise; a call of any other shape throws, so the
 * run goes red, and never reads as "nothing changed" on a clean checkout, which would run no test.
 */
export const changedFiles: VCSProvider = {
  findChangedFiles: async (options) => {
    const { root, changedSince } = options;
    const known = new Set(["root", "changedSince"]);

    if (
      typeof root !== "string" ||
      !(changedSince === true || (typeof changedSince === "string" && changedSince !== "")) ||
      Object.keys(options).some((key) => !known.has(key))
    ) {
      throw new Error(
        `vitest.changed: Vitest called the --changed provider with ${JSON.stringify(options)}, a shape this provider does not know; read the new Vitest's provider call and update vitest.changed.ts`,
      );
    }

    const top = git(root, ["rev-parse", "--show-toplevel"])?.trim();

    if (top === undefined || top === "") {
      throw new Error("vitest.changed: not in a git repository");
    }

    const changed = [
      ...(typeof changedSince === "string" ? paths(top, ["diff", "--name-only", "-z", `${changedSince}...HEAD`]) : []),
      ...paths(top, ["diff", "--cached", "--name-only", "-z"]),
      ...paths(top, ["ls-files", "-z", "--other", "--modified", "--exclude-standard"]),
    ];
    const start = typeof changedSince === "string" ? git(top, ["merge-base", changedSince, "HEAD"])?.trim() : "HEAD";
    const repo: Repository = {
      before: (path) => (start === undefined || start === "" ? undefined : git(top, ["show", `${start}:${path}`])),
      now: (path) => {
        try {
          return readFileSync(resolve(top, path), "utf8");
        } catch {
          return undefined;
        }
      },
      files: [
        ...new Set([
          ...paths(top, ["ls-files", "-z"]),
          ...paths(top, ["ls-files", "-z", "--other", "--exclude-standard"]),
        ]),
      ],
    };
    return narrow([...new Set(changed)], repo).map((path) => resolve(top, path));
  },
};
