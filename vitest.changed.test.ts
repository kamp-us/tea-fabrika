import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { createVitest } from "vitest/node";
import { parseAllDocuments, stringify } from "yaml";
import { changedFiles, narrow, type Repository } from "./vitest.changed.ts";

// Today's CI and the laptop, both versions. Covers vitest.changed.ts, which hands Vitest's
// `--changed` git's changed files with each lockfile, tsconfig and package.json it can tie to
// packages swapped for those packages' tests. "Selects all" means the list comes back as it went
// in, so its rerun trigger fires (vitest.config.ts). Workspaces are generated: packages that link
// to earlier ones, outside packages that depend on earlier ones, and one test file per package.
// Each plant was run once on vitest.changed.ts and restored; each turned its law red.
const ROOT = fileURLToPath(new URL("./", import.meta.url));
const options = { seed: 119120, numRuns: 100 };

/** A generated workspace: each package's links and outside dependencies, and each outside one's own. */
type Shape = {
  readonly links: readonly (readonly number[])[];
  readonly direct: readonly (readonly number[])[];
  readonly nested: readonly number[];
  readonly root: readonly number[];
};

const below = (i: number) => (i === 0 ? fc.constant([]) : fc.uniqueArray(fc.nat({ max: i - 1 }), { maxLength: i }));

const shapes = fc
  .record({ packages: fc.integer({ min: 1, max: 6 }), outside: fc.integer({ min: 1, max: 6 }) })
  .chain(({ packages, outside }) =>
    fc.record({
      links: fc.tuple(...Array.from({ length: packages }, (_, i) => below(i))),
      direct: fc.tuple(...Array.from({ length: packages }, () => fc.uniqueArray(fc.nat({ max: outside - 1 })))),
      nested: fc.tuple(...Array.from({ length: outside }, (_, k) => below(k))),
      root: fc.uniqueArray(fc.nat({ max: packages - 1 })),
    }),
  );

const dirOf = (i: number) => `packages/p${i}`;
const testOf = (dir: string) => (dir === "." ? "scripts/root.test.ts" : `${dir}/src/a.test.ts`);

/** Mutable copies of a lockfile's two documents, pnpm's own first, as pnpm 12 writes them. */
type Docs = { env: Record<string, any>; main: Record<string, any> };

const lockOf = (shape: Shape): Docs => {
  const importers: Record<string, any> = {
    ".": {
      devDependencies: Object.fromEntries(
        shape.root.map((j) => [`@w/p${j}`, { specifier: "workspace:*", version: `link:${dirOf(j)}` }]),
      ),
    },
  };
  // A package nothing links to, which holds the tests that read files as text.
  importers["tools"] = {};
  shape.links.forEach((links, i) => {
    importers[dirOf(i)] = {
      dependencies: Object.fromEntries([
        ...links.map((j) => [`@w/p${j}`, { specifier: "workspace:*", version: `link:../p${j}` }]),
        ...(shape.direct[i] ?? []).map((k) => [`e${k}`, { specifier: "catalog:", version: "1.0.0" }]),
      ]),
    };
  });
  const packages: Record<string, any> = {};
  const snapshots: Record<string, any> = {};
  shape.nested.forEach((deps, k) => {
    packages[`e${k}@1.0.0`] = { resolution: { integrity: `sha512-${k}` } };
    snapshots[`e${k}@1.0.0`] =
      deps.length === 0 ? {} : { dependencies: Object.fromEntries(deps.map((j) => [`e${j}`, "1.0.0"])) };
  });
  return {
    env: {
      lockfileVersion: "9.0",
      importers: { ".": { packageManagerDependencies: { pnpm: { specifier: "12.16.1", version: "12.16.1" } } } },
    },
    main: {
      lockfileVersion: "9.0",
      settings: { autoInstallPeers: true, excludeLinksFromLockfile: false },
      catalogs: {
        default: Object.fromEntries(shape.nested.map((_, k) => [`e${k}`, { specifier: "1.0.0", version: "1.0.0" }])),
      },
      overrides: {},
      patchedDependencies: {},
      importers,
      packages,
      snapshots,
    },
  };
};

const textOf = (docs: Docs) => `---\n${stringify(docs.env)}\n---\n${stringify(docs.main)}`;
const copy = (docs: Docs): Docs => structuredClone(docs);

/** Every package's and the root's test file and one source file, each test empty unless given text. */
const filesOf = (shape: Shape) => [
  "scripts/root.test.ts",
  ...shape.links.flatMap((_, i) => [testOf(dirOf(i)), `${dirOf(i)}/src/a.ts`]),
];

const repoOf = (
  before: Record<string, string | undefined>,
  now: Record<string, string | undefined>,
  files: readonly string[],
): Repository => ({
  before: (path) => before[path],
  now: (path) => (Object.hasOwn(now, path) ? now[path] : before[path]),
  files,
});

/** The model's answer: the packages that link, directly or not, to one of `start`, and `start`. */
const dependents = (shape: Shape, start: readonly string[]): Set<string> => {
  const reached = new Set(start);

  for (let grew = true; grew;) {
    grew = false;
    const links: [string, readonly number[]][] = [
      [".", shape.root],
      ...shape.links.map((l, i): [string, readonly number[]] => [dirOf(i), l]),
    ];

    for (const [dir, targets] of links) {
      if (!reached.has(dir) && targets.some((j) => reached.has(dirOf(j)))) {
        reached.add(dir);
        grew = true;
      }
    }
  }

  return reached;
};

/** The model's outside packages a package resolves, transitive ones included. */
const resolves = (shape: Shape, i: number): Set<number> => {
  const seen = new Set<number>();
  const todo = [...(shape.direct[i] ?? [])];

  for (let k = todo.pop(); k !== undefined; k = todo.pop()) {
    if (!seen.has(k)) {
      seen.add(k);
      todo.push(...(shape.nested[k] ?? []));
    }
  }

  return seen;
};

const selected = (dirs: Iterable<string>) => [...dirs].map(testOf).toSorted();

it("L1 a lockfile change to one package's dependency selects that package's tests and its dependents'", () => {
  // Plants, each run once: `closure` follows only direct dependencies (red on a transitive change);
  // `spread` adds no package that links to a reached one (red); `lockReach` also adds every
  // importer (red).
  fc.assert(
    fc.property(shapes, fc.boolean(), fc.nat(), fc.nat(), (shape, transitive, pickPackage, pickOutside) => {
      const before = lockOf(shape);
      const now = copy(before);
      let changed: string[];

      if (transitive) {
        // A resolved package changes under every package that reaches it: a new integrity.
        const used = shape.nested
          .map((_, k) => k)
          .filter((k) => shape.direct.some((_, i) => resolves(shape, i).has(k)));
        fc.pre(used.length > 0);
        const k = used[pickOutside % used.length]!;
        now.main["packages"][`e${k}@1.0.0`].resolution.integrity = "sha512-changed";
        changed = shape.direct.flatMap((_, i) => (resolves(shape, i).has(k) ? [dirOf(i)] : []));
      } else {
        // One package moves one direct dependency to a new version.
        const owners = shape.direct.flatMap((deps, i) => (deps.length > 0 ? [i] : []));
        fc.pre(owners.length > 0);
        const i = owners[pickPackage % owners.length]!;
        const k = shape.direct[i]![pickOutside % shape.direct[i]!.length]!;
        now.main["importers"][dirOf(i)].dependencies[`e${k}`].version = "1.0.1";
        now.main["packages"][`e${k}@1.0.1`] = { resolution: { integrity: "sha512-new" } };
        now.main["snapshots"][`e${k}@1.0.1`] = before.main["snapshots"][`e${k}@1.0.0`];
        changed = [dirOf(i)];
      }

      const repo = repoOf({ "pnpm-lock.yaml": textOf(before) }, { "pnpm-lock.yaml": textOf(now) }, filesOf(shape));
      const out = narrow(["pnpm-lock.yaml", "docs/x.md"], repo);
      expect(out.toSorted()).toEqual(["docs/x.md", ...selected(dependents(shape, changed))].toSorted());
    }),
    options,
  );
});

it("L2 a lockfile change outside the importers and their packages selects all", () => {
  // `catalogs`, `overrides`, `patchedDependencies`, `settings`, pnpm's own document, and a package
  // no importer resolves. Plants, each run once: drop the `rest` comparison (red on catalogs);
  // drop the `earlier` comparison (red on pnpm's document); drop the unreached-package check (red).
  fc.assert(
    fc.property(
      shapes,
      fc.constantFrom("catalogs", "overrides", "patchedDependencies", "settings", "pnpm", "unreached"),
      (shape, part) => {
        const before = lockOf(shape);
        const now = copy(before);

        if (part === "catalogs") {
          now.main["catalogs"].default.e0 = { specifier: "2.0.0", version: "2.0.0" };
        } else if (part === "overrides") {
          now.main["overrides"] = { e0: "2.0.0" };
        } else if (part === "patchedDependencies") {
          now.main["patchedDependencies"] = { "e0@1.0.0": "patches/e0@1.0.0.patch" };
        } else if (part === "settings") {
          now.main["settings"].autoInstallPeers = false;
        } else if (part === "pnpm") {
          now.env["importers"]["."].packageManagerDependencies.pnpm = { specifier: "12.17.0", version: "12.17.0" };
        } else {
          now.main["packages"]["stray@1.0.0"] = { resolution: { integrity: "sha512-stray" } };
          now.main["snapshots"]["stray@1.0.0"] = {};
        }

        const repo = repoOf({ "pnpm-lock.yaml": textOf(before) }, { "pnpm-lock.yaml": textOf(now) }, filesOf(shape));
        expect(narrow(["pnpm-lock.yaml", "docs/x.md"], repo)).toEqual(["pnpm-lock.yaml", "docs/x.md"]);
      },
    ),
    options,
  );
});

it("L3 a lockfile change whose start cannot be read or parsed selects all", () => {
  // Plant, run once: `lockReach` returns no package when the start is missing (red).
  fc.assert(
    fc.property(
      shapes,
      fc.constantFrom<string | undefined>(
        undefined,
        "",
        "importers: [\n",
        "lockfileVersion: '6.0'\nimporters: {}\n",
        "- a\n- b\n",
      ),
      fc.boolean(),
      (shape, start, rootChange) => {
        const now = lockOf(shape);
        const repo = repoOf({ "pnpm-lock.yaml": start }, { "pnpm-lock.yaml": textOf(now) }, filesOf(shape));
        const changed = rootChange ? ["pnpm-lock.yaml"] : ["pnpm-lock.yaml", `${dirOf(0)}/tsconfig.json`];
        expect(narrow(changed, repo)).toEqual(changed);
      },
    ),
    options,
  );
});

it("L4 the root's tsconfig, and one another package extends, select all; a package's own selects it and its dependents", () => {
  // Plants, each run once: treat a tsconfig outside every package as its own package (red on the
  // root's); skip the extends check (red on an extended one); `spread` adds no dependent (red);
  // the readers are the tests that name "tsconfig" (red on generic.test.ts).
  fc.assert(
    fc.property(
      shapes,
      fc.nat(),
      fc.constantFrom("root", "base", "outside", "extended", "own"),
      (shape, pick, kind) => {
        const i = pick % shape.links.length;
        const lock = textOf(lockOf(shape));
        const own = `${dirOf(i)}/tsconfig.json`;
        const other = shape.links.length > 1 ? dirOf((i + 1) % shape.links.length) : undefined;
        fc.pre(kind !== "extended" || other !== undefined);
        const path = {
          root: "tsconfig.json",
          base: "tsconfig.base.json",
          outside: "docs/tsconfig.json",
          extended: own,
          own,
        }[kind];
        const files = [
          ...filesOf(shape),
          "tsconfig.json",
          "tsconfig.base.json",
          own,
          ...(other === undefined ? [] : [`${other}/tsconfig.json`]),
          "tools/reads.test.ts",
          "tools/generic.test.ts",
        ];
        const extendsText = (target: string) =>
          `{\n  // the shared one\n  "extends": "${target}",\n  "include": ["src"]\n}\n`;
        const now: Record<string, string> = {
          "pnpm-lock.yaml": lock,
          "tsconfig.json": extendsText("./tsconfig.base.json"),
          [own]: extendsText("../../tsconfig.base.json"),
          // A test that names the changed file by its path reads it; one that names any tsconfig does not count.
          "tools/reads.test.ts": `readFileSync(join(ROOT, "${own}"))`,
          "tools/generic.test.ts": `readFileSync("tsconfig.json")`,
        };

        if (other !== undefined) {
          now[`${other}/tsconfig.json`] = extendsText(
            kind === "extended" ? `../p${i}/tsconfig` : "../../tsconfig.base.json",
          );
        }

        const out = narrow([path, "docs/x.md"], repoOf(now, {}, files));

        const expected =
          kind === "own"
            ? ["docs/x.md", "tools/reads.test.ts", ...selected(dependents(shape, [dirOf(i)]))].toSorted()
            : [path, "docs/x.md"].toSorted();
        expect(out.toSorted()).toEqual(expected);
      },
    ),
    options,
  );
});

it("L5 a package's own package.json selects it and its dependents; a root package.json change beyond scripts and dependencies selects all", () => {
  // A test that names the changed manifest by its path is selected, one that names package.json
  // only is not. Plants, each run once: `manifestReach` gives no package (red on a package's
  // own); `ROOT_KEYS` also holds `engines` (red on that key).
  fc.assert(
    fc.property(
      shapes,
      fc.nat(),
      fc.constantFrom("own", "engines", "type", "packageManager", "dependencies-alone"),
      (shape, pick, kind) => {
        const i = pick % shape.links.length;
        const lock = textOf(lockOf(shape));
        const manifest = {
          name: "root",
          type: "module",
          scripts: { lint: "oxlint" },
          engines: { node: "26.13.0" },
          packageManager: "pnpm@12.16.1",
          dependencies: { effect: "catalog:" },
        };
        const changedRoot = {
          engines: { ...manifest, engines: { node: "26.14.0" } },
          type: { ...manifest, type: "commonjs" },
          packageManager: { ...manifest, packageManager: "pnpm@12.17.0" },
          "dependencies-alone": { ...manifest, dependencies: { effect: "catalog:", yaml: "catalog:" } },
          own: manifest,
        }[kind];
        const path = kind === "own" ? `${dirOf(i)}/package.json` : "package.json";
        const repo = repoOf(
          { "pnpm-lock.yaml": lock, "package.json": JSON.stringify(manifest), [`${dirOf(i)}/package.json`]: "{}" },
          {
            "package.json": JSON.stringify(changedRoot),
            [`${dirOf(i)}/package.json`]: '{"exports":"./src/a.ts"}',
            "tools/reads.test.ts": `readFileSync("${dirOf(i)}/package.json")`,
            "tools/generic.test.ts": `writeFileSync("package.json", "{}")`,
          },
          [...filesOf(shape), "tools/reads.test.ts", "tools/generic.test.ts"],
        );
        const out = narrow([path], repo);

        expect(out.toSorted()).toEqual(
          kind === "own" ? ["tools/reads.test.ts", ...selected(dependents(shape, [dirOf(i)]))].toSorted() : [path],
        );
      },
    ),
    options,
  );
});

it("L6 a root package.json change to its scripts selects the tests that name a changed script or a script running one", () => {
  // A test that only names package.json, or names a script inside a longer word, is not selected.
  // Plants, each run once: skip the scripts that run a changed one (red); drop the check before a
  // script name (red on near.test.ts), or the one after it (red); add the tests that name package.json (red).
  fc.assert(
    fc.property(fc.constantFrom("drop", "edit", "add"), (change) => {
      const shape: Shape = { links: [[]], direct: [[]], nested: [[]], root: [] };
      const scripts = { lint: "pnpm -s lint:twin && oxlint", "lint:twin": "node twin.ts", other: "node other.ts" };
      const after =
        change === "drop"
          ? { lint: scripts.lint, other: scripts.other }
          : change === "edit"
            ? { ...scripts, "lint:twin": "node twin.ts --strict" }
            : { ...scripts, extra: "node extra.ts" };
      const files = [
        ...filesOf(shape),
        "a/twin.test.ts",
        "a/lint.test.ts",
        "a/manifest.test.ts",
        "a/other.test.ts",
        "a/near.test.ts",
        "a/extra.test.ts",
      ];
      const repo = repoOf(
        {
          "pnpm-lock.yaml": textOf(lockOf(shape)),
          "package.json": JSON.stringify({ scripts }),
          "a/twin.test.ts": 'spawnSync("pnpm", ["-s", "lint:twin"])',
          "a/lint.test.ts": "// `pnpm lint` refuses these lines",
          "a/manifest.test.ts": 'readFileSync("../package.json")',
          "a/other.test.ts": 'spawnSync("pnpm", ["other"])',
          "a/near.test.ts": "import { x } from 'node:fs/lint:twin'; prelint done; lint:twins",
          "a/extra.test.ts": "pnpm extra",
        },
        { "package.json": JSON.stringify({ scripts: after }) },
        files,
      );
      const expected = change === "add" ? ["a/extra.test.ts"] : ["a/lint.test.ts", "a/twin.test.ts"];
      expect(narrow(["package.json"], repo).toSorted()).toEqual(expected);
    }),
  );
});

it("scenario: L7 pull request 1275's file list selects only the readers of the files it changed, no package's tests", () => {
  // Pull request https://github.com/kamp-us/tea-fabrika/pull/1275 deletes packages/promises: its
  // importer, the root's link to it, its tsconfig and package.json, and the root's `promises` and
  // `trace:*` scripts. Both ends are built from the real lockfile and root package.json, before
  // 1275 merges or after: the end with those taken out, the start with them put back as 1275's
  // diff shows them. The law is about this list alone: 1275 edits vitest.shards.ts, which stays in
  // it and which Vitest selects every test for, since vitest.config.ts imports it. The table now
  // lives in vitest.shards.json, which selects only its readers (vitest.shards.test.ts, L20). Plants, each run
  // once: compare importer entries with their links to removed packages kept (red: the root's
  // entry changed, so all); a removed package's tsconfig reaches its dependents (red: the root's
  // test).
  const documents = parseAllDocuments(readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8"));

  if (!Array.isArray(documents)) {
    throw new Error("pnpm-lock.yaml holds no YAML document");
  }

  const [env, main] = documents.map((doc) => doc.toJS());
  const SCRIPTS = ["promises", "trace:up", "trace:down", "trace:wipe"];
  const end = structuredClone(main);
  delete end.importers["packages/promises"];
  delete end.importers["."].dependencies["@kampus/promises"];
  const start = structuredClone(end);
  start.importers["."].dependencies["@kampus/promises"] = {
    specifier: "workspace:*",
    version: "link:packages/promises",
  };
  start.importers["packages/promises"] = {
    dependencies: {
      effect: start.importers["."].dependencies.effect,
      "@effect/platform-node": start.importers["."].dependencies["@effect/platform-node"],
    },
    devDependencies: { "@types/node": start.importers["."].devDependencies["@types/node"] },
  };
  const endManifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  for (const name of SCRIPTS) {
    delete endManifest.scripts[name];
  }

  delete endManifest.dependencies["@kampus/promises"];
  const startManifest = structuredClone(endManifest);
  startManifest.scripts = {
    ...startManifest.scripts,
    promises: "node packages/promises/src/main.ts",
    "trace:up": "docker run -d --rm --name tsh-jaeger jaegertracing/jaeger:2.21.0",
    "trace:down": "docker stop tsh-jaeger",
    "trace:wipe": "docker volume rm tsh-jaeger-data",
  };
  startManifest.dependencies = { ...startManifest.dependencies, "@kampus/promises": "workspace:*" };
  const lockText = (doc: unknown) => `---\n${stringify(env)}\n---\n${stringify(doc)}`;
  const changed = [
    "README.md",
    "docs/direction/a-job-record-holds-its-trace.md",
    "docs/direction/five-steps-for-every-check.md",
    "jaeger/config.yaml",
    "jaeger/ui.json",
    "package.json",
    "packages/fabrika/src/shell/README.md",
    "packages/fabrika/src/shell/launch.ts",
    "packages/fabrika/src/shell/trace/otel.ts",
    "packages/pipeline/src/laws/promise-check.ts",
    "packages/promises/README.md",
    "packages/promises/package.json",
    "packages/promises/src/blocks.test.ts",
    "packages/promises/src/blocks.ts",
    "packages/promises/src/judge.test.ts",
    "packages/promises/src/judge.ts",
    "packages/promises/src/main.ts",
    "packages/promises/src/node.ts",
    "packages/promises/src/record.ts",
    "packages/promises/src/show.ts",
    "packages/promises/tsconfig.json",
    "pnpm-lock.yaml",
    "promises/review-form-for-another-head-never-counts.json",
    "promises/ship-ended-run-sends-nothing.json",
    "vitest.shards.ts",
  ];
  // A test that names the lockfile reads it, and one that names a removed script may run it. One
  // that names package.json only, and writes its own, is not selected.
  const readers = {
    "scripts/caps.test.ts": "pnpm-lock.yaml",
    "packages/pipeline/src/machine-make.test.ts": "the promises it keeps",
  };
  const texts = { ...readers, "oxlint-plugins/exact-versions.test.ts": 'join(root, "package.json")' };
  const plain = [
    "vitest.shards.test.ts",
    "next/packages/tuval/src/a.test.ts",
    "packages/pipeline/src/verdict.test.ts",
    ".agents/skills/lead/scripts/gc.test.ts",
  ];
  const repo = repoOf(
    { "pnpm-lock.yaml": lockText(start), "package.json": JSON.stringify(startManifest) },
    { "pnpm-lock.yaml": lockText(end), "package.json": JSON.stringify(endManifest), ...texts },
    [...changed.filter((path) => !path.startsWith("packages/promises/")), ...Object.keys(texts), ...plain],
  );
  const out = narrow(changed, repo);
  const triggers = [
    "package.json",
    "pnpm-lock.yaml",
    "packages/promises/package.json",
    "packages/promises/tsconfig.json",
  ];
  expect(out.toSorted()).toEqual(
    [...changed.filter((path) => !triggers.includes(path)), ...Object.keys(readers)].toSorted(),
  );
});

it("L8 a change to a script pnpm runs unnamed selects all, in the root's manifest or a package's", () => {
  // `pnpm install` runs each workspace project's install-time scripts, and pnpm 12's
  // `enablePrePostScripts`, true by default, runs `pre<name>` and `post<name>` around a script, so
  // no test names them. Plants, each run once: drop the unnamed check from the root's manifest
  // (red); from a package's own (red); `unnamed` knows only the listed names, not pre/post hooks
  // (red on a generated hook).
  const hook = fc
    .tuple(fc.constantFrom("pre", "post"), fc.stringMatching(/^[a-z][a-z:-]{0,8}$/))
    .map(([prefix, rest]) => `${prefix}${rest}`);
  const name = fc.oneof(
    fc.constantFrom(
      "preinstall",
      "install",
      "postinstall",
      "prepare",
      "pnpm:devPreinstall",
      "prepublishOnly",
      "prepack",
    ),
    hook,
  );
  fc.assert(
    fc.property(
      shapes,
      fc.nat(),
      name,
      fc.constantFrom("add", "edit", "drop"),
      fc.boolean(),
      (shape, pick, script, change, root) => {
        const i = pick % shape.links.length;
        const path = root ? "package.json" : `${dirOf(i)}/package.json`;
        const scripts = (body: string | undefined) => ({
          scripts: { lint: "oxlint", ...(body === undefined ? {} : { [script]: body }) },
        });
        const [start, end] =
          change === "add"
            ? [undefined, "node a.ts"]
            : change === "edit"
              ? ["effect-tsgo patch --typescript", "node b.ts"]
              : ["node a.ts", undefined];
        const repo = repoOf(
          { "pnpm-lock.yaml": textOf(lockOf(shape)), [path]: JSON.stringify(scripts(start)) },
          { [path]: JSON.stringify(scripts(end)) },
          filesOf(shape),
        );
        expect(narrow([path], repo)).toEqual([path]);
      },
    ),
    options,
  );
});

it("L9 the --changed provider throws on a call shape it does not know, before it reads git", async () => {
  // Vitest 5.0.5 calls it as `{ root, changedSince }`, `changedSince` a commit or `true`. A renamed or
  // added field, or an empty or false `changedSince`, must fail the run: read as "no commit", a
  // clean checkout lists no file and Vitest runs no test. Plants, each run once: drop the shape
  // check (red: the call resolves); accept `changedSince: false` (red).
  const field = fc.stringMatching(/^[a-zA-Z]{1,12}$/).filter((key) => key !== "root" && key !== "changedSince");
  const shape = fc.oneof(
    fc.record({ root: fc.constant(ROOT), changedSince: fc.constantFrom<unknown>(undefined, false, "", 0, null) }),
    fc
      .tuple(field, fc.oneof(fc.string({ minLength: 1 }), fc.constant(true)))
      .map(([key, value]) => ({ root: ROOT, [key]: value })),
    fc
      .tuple(field, fc.string({ minLength: 1 }))
      .map(([key, value]) => ({ root: ROOT, changedSince: "HEAD", [key]: value })),
    fc.record({ root: fc.constantFrom<unknown>(undefined, 1, null), changedSince: fc.constant("HEAD") }),
  );
  await fc.assert(
    fc.asyncProperty(shape, async (call) => {
      await expect(changedFiles.findChangedFiles(call as never)).rejects.toThrow(/a shape this provider does not know/);
    }),
    options,
  );
});

/** A git repository with `files`, committed; its commit. */
const commit = (dir: string, files: Record<string, string>, message: string): string => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }

  const git = (...args: string[]) => {
    const done = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@invalid", ...args], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(done.status, done.stderr).toBe(0);
    return done.stdout.trim();
  };

  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", message);
  return git("rev-parse", "HEAD");
};

it("scenario: L10 real Vitest's --changed, given this provider, selects the lockfile's package and a changed source's test, never none", async () => {
  // A temp repository with three packages and a lockfile, through `createVitest` with `changed`, as
  // CI's legs and next steps run it. The second commit moves package a's dependency in the
  // lockfile and edits package c's source; b is untouched. The tree is clean, so the files come
  // from the commit given alone: a provider that lost `changedSince` would list none. Plants, each
  // run once: the provider reads `since` for `changedSince` (red: it throws); the same with the
  // shape check dropped (red: no test selected).
  // The real path: on macOS the temp folder is a link, and Vitest names files by their real path.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "vitest-changed-")));

  try {
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    const lock = (version: string) =>
      `---\n${stringify({
        lockfileVersion: "9.0",
        importers: {
          ".": {},
          "packages/a": { dependencies: { e: { specifier: version, version } } },
          "packages/b": { dependencies: { f: { specifier: "1.0.0", version: "1.0.0" } } },
          "packages/c": {},
        },
        packages: {
          [`e@${version}`]: { resolution: { integrity: `sha512-e${version}` } },
          "f@1.0.0": { resolution: { integrity: "sha512-f" } },
        },
        snapshots: { [`e@${version}`]: {}, "f@1.0.0": {} },
      })}`;
    const sources = Object.fromEntries(
      ["a", "b", "c"].flatMap((name) => [
        [`packages/${name}/package.json`, JSON.stringify({ name })],
        [`packages/${name}/src/${name}.ts`, `export const ${name} = 1;\n`],
        [`packages/${name}/src/${name}.test.ts`, `import { ${name} } from "./${name}.ts";\nvoid ${name};\n`],
      ]),
    );
    const base = commit(
      dir,
      { "package.json": JSON.stringify({ name: "t", private: true }), "pnpm-lock.yaml": lock("1.0.0"), ...sources },
      "base",
    );
    commit(dir, { "pnpm-lock.yaml": lock("1.0.1"), "packages/c/src/c.ts": "export const c = 2;\n" }, "change");
    const vitest = await createVitest("test", {
      root: dir,
      config: false,
      watch: false,
      changed: base,
      include: ["packages/*/src/*.test.ts"],
      forceRerunTriggers: ["**/pnpm-lock.yaml", "**/package.json"],
      experimental: { vcsProvider: changedFiles },
    });

    try {
      const picked = (await vitest.specifications.getRelevantTestSpecifications()).map((spec) =>
        relative(dir, spec.moduleId),
      );
      expect(picked.toSorted()).toEqual(["packages/a/src/a.test.ts", "packages/c/src/c.test.ts"]);
    } finally {
      await vitest.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
