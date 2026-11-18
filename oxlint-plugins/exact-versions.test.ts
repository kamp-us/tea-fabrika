// The check is the only thing holding the rule, so each bad value is planted and seen to fail. Each
// runs the real script on a small git tree of its own, and its exit code is what is read.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Array as Arr, pipe, Record as Rec, Schema } from "effect";
import * as fc from "fast-check";

const SCRIPT = join(import.meta.dirname, "exact-versions.ts");

const home = mkdtempSync(join(tmpdir(), "exact-versions-"));

afterAll(() => rmSync(home, { recursive: true, force: true }));

let trees = 0;

/** Runs the check on a new git tree holding these files, each staged unless listed in `untracked`. */
const run = (files: Readonly<Record<string, string>>, untracked: readonly string[] = []) => {
  trees += 1;
  const tree = join(home, String(trees));
  mkdirSync(tree);
  spawnSync("git", ["init", "-q"], { cwd: tree });

  for (const [path, text] of Rec.toEntries(files)) {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), text);

    if (!untracked.includes(path)) {
      spawnSync("git", ["add", path], { cwd: tree });
    }
  }

  const ran = spawnSync("node", [SCRIPT, tree], { encoding: "utf8" });

  return { status: ran.status, said: ran.stdout + ran.stderr };
};

const WORKSPACE = "catalog:\n  a: 1.2.3\n";

const inPackage = (field: string, version: string) =>
  run({
    "pnpm-workspace.yaml": WORKSPACE,
    "packages/one/package.json": JSON.stringify({ [field]: { thing: version } }),
  });

const BAD = [
  "^1.2.3",
  "~1.2.3",
  ">1.2.3",
  ">=1.2.3",
  "<2.0.0",
  "<=2.0.0",
  "*",
  "x",
  "1.x",
  "1.2.x",
  "1.2",
  "1",
  "",
  "latest",
  "next",
  "1.2.3 || 2.0.0",
  "1.2.3 - 2.0.0",
  "=1.2.3",
  "v1.2.3",
  "workspace:^",
  "workspace:~",
  "workspace:1.2.3",
  "git+https://example.com/a.git",
  "github:a/b",
  "file:../a",
  "link:../a",
  "https://example.com/a.tgz",
  "npm:other@1.2.3",
];

describe("a package.json", () => {
  it.each(BAD)("refuses %j, naming the file and the name", (version) => {
    const { status, said } = inPackage("dependencies", version);
    expect(status).toBe(1);
    expect(said).toContain(`packages/one/package.json: dependencies: thing: ${JSON.stringify(version)}`);
  });

  it.each(["devDependencies", "peerDependencies", "optionalDependencies", "overrides", "resolutions"])(
    "%s is read too",
    (field) => {
      const { status, said } = inPackage(field, "^1.2.3");
      expect(status).toBe(1);
      expect(said).toContain(`packages/one/package.json: ${field}: thing: "^1.2.3"`);
    },
  );

  it("pnpm.overrides refuses a range", () => {
    const { status, said } = run({
      "package.json": JSON.stringify({ pnpm: { overrides: { thing: "^1.2.3" } } }),
    });

    expect(status).toBe(1);
    expect(said).toContain('package.json: pnpm.overrides: thing: "^1.2.3"');
  });

  it("a nested override is refused, not skipped", () => {
    const { status, said } = run({
      "package.json": JSON.stringify({ overrides: { thing: { other: "^1.2.3" } } }),
    });

    expect(status).toBe(1);
    expect(said).toContain("package.json: overrides: thing:");
  });

  it.each(["1.2.3", "2.0.0-beta.84", "4.20260730.0", "1.2.3+build.1", "catalog:", "workspace:*"])(
    "passes %j",
    (version) => {
      expect(inPackage("dependencies", version).status).toBe(0);
    },
  );

  it("a toy project's package.json counts the same", () => {
    const { status, said } = run({
      "fixtures/toy/repo/package.json": JSON.stringify({ devDependencies: { thing: "^1.0.0" } }),
    });

    expect(status).toBe(1);
    expect(said).toContain("fixtures/toy/repo/package.json: devDependencies: thing:");
  });

  it("a file git does not track is left alone", () => {
    const { status } = run(
      {
        "package.json": "{}",
        "scratch/package.json": JSON.stringify({ dependencies: { thing: "^1.0.0" } }),
      },
      ["scratch/package.json"],
    );

    expect(status).toBe(0);
  });

  it("a file named like one is not one", () => {
    const { status } = run({
      "package.json": "{}",
      "results/98-package.json": JSON.stringify({ dependencies: { thing: "^1.0.0" } }),
    });

    expect(status).toBe(0);
  });
});

describe("a pnpm-workspace.yaml", () => {
  it.each([
    ["catalog", "catalog:\n  # a comment\n  '@a/b': ^1.2.3\n", 'catalog: @a/b: "^1.2.3"'],
    ["overrides", "overrides:\n  'a@1>b': ~1.2.3\n", 'overrides: a@1>b: "~1.2.3"'],
    ["catalogs", "catalogs:\n  old:\n    a: latest\n", 'catalogs.old: a: "latest"'],
    ["a number", "catalog:\n  a: 1.2\n", "catalog: a: 1.2"],
    ["an empty value", "catalog:\n  a:\n", "catalog: a: null"],
  ])("%s is refused", (_name, text, line) => {
    const { status, said } = run({ "pnpm-workspace.yaml": text });
    expect(status).toBe(1);
    expect(said).toContain(`pnpm-workspace.yaml: ${line}`);
  });

  it("reads a nested one too, as `video/` has", () => {
    const { status, said } = run({ "video/pnpm-workspace.yaml": "overrides:\n  a: '*'\n" });
    expect(status).toBe(1);
    expect(said).toContain('video/pnpm-workspace.yaml: overrides: a: "*"');
  });

  it("passes exact versions, and settings it does not read", () => {
    const text = "packages:\n  - a\nsavePrefix: ''\ncatalog:\n  a: 1.2.3\noverrides:\n  b: 2.0.0\n";
    expect(run({ "pnpm-workspace.yaml": text }).status).toBe(0);
  });
});

// E1 (docs/plan/quests/tea-msg-tag-PLAN.md): a named catalog's pointer is exact too, since its entry
// is checked exact in pnpm-workspace.yaml's `catalogs.<name>`. Today's version sits on `catalog:old`.
// Plant (a): `POINTERS` left as it was, so `catalog:old` is refused. Plant (b): a pointer pattern that
// takes any text after `catalog:`, so `catalog:^1` passes. Each run holds every case below at once,
// so 10 runs reach them all.
describe("a named catalog's pointer", () => {
  const runs = { seed: 119120, numRuns: 10 };

  // A plain name, one with a digit and one with a dash, so each is reached in every run.
  const names = fc
    .tuple(
      fc.stringMatching(/^[a-z]{1,8}$/),
      fc.stringMatching(/^[a-z][a-z]{0,3}[0-9][a-z0-9]{0,3}$/),
      fc.stringMatching(/^[a-z][a-z0-9]{0,3}-[a-z0-9]{1,4}$/),
    )
    .map((drawn) => [...new Set(drawn)]);

  /** Each name a catalog holding `thing` at `version`, and one package naming each by its pointer. */
  const tree = (all: readonly string[], version: string) => ({
    "pnpm-workspace.yaml": `catalogs:\n${pipe(
      all,
      Arr.map((name) => `  ${name}:\n    thing: ${version}\n`),
      Arr.join(""),
    )}`,
    "packages/one/package.json": JSON.stringify({
      dependencies: Rec.fromEntries(Arr.map(all, (name, i) => [`thing${i}`, `catalog:${name}`])),
    }),
  });

  it("passes `catalog:<name>` for any lower-case name whose catalog is exact", () => {
    fc.assert(
      fc.property(names, (all) => {
        expect(run(tree(all, "1.2.3"))).toEqual({ status: 0, said: expect.stringContaining("every version exact") });
      }),
      runs,
    );
  });

  it("refuses a range inside that named catalog, naming it", () => {
    fc.assert(
      fc.property(names, (all) => {
        const { status, said } = run(tree(all, "^1.2.3"));
        expect(status).toBe(1);

        for (const name of all) {
          expect(said).toContain(`pnpm-workspace.yaml: catalogs.${name}: thing: "^1.2.3"`);
        }
      }),
      runs,
    );
  });

  // Everything after `catalog:` that is not one lower-case name, and the name alone as a bare tag.
  const notNames = (name: string): readonly string[] => [
    "catalog:^1",
    `catalog:^${name}`,
    `catalog:~${name}`,
    `catalog: ${name}`,
    `catalog:${name} `,
    `catalog:${name.toUpperCase()}`,
    `catalog:1${name}`,
    `catalog:-${name}`,
    `catalog:${name}/x`,
    `catalog:${name}@1.2.3`,
    `catalog:${name}:${name}`,
    `catalog:${name}.x`,
    `catalog:${name}_x`,
    "catalog:*",
    name,
  ];

  it("still refuses `catalog:^1`, `catalog: <name>`, any other text after `catalog:`, and a bare tag", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/), (name) => {
        const bad = notNames(name);

        const { status, said } = run({
          "pnpm-workspace.yaml": `catalogs:\n  ${name}:\n    thing: 1.2.3\n`,
          "packages/one/package.json": JSON.stringify({
            dependencies: Rec.fromEntries(Arr.map(bad, (version, i) => [`thing${i}`, version])),
          }),
        });

        expect(status).toBe(1);

        for (const [i, version] of bad.entries()) {
          expect(said).toContain(`packages/one/package.json: dependencies: thing${i}: ${JSON.stringify(version)}`);
        }
      }),
      runs,
    );
  });
});

// P3 (slice 1 of the kalfa program plan): a `patchedDependencies` row is keyed on one exact
// version, never a bare name or a range, which pnpm would apply to whatever version it installs, a
// later release included. A row at a version nothing installs is pnpm's own refusal, so this check
// passes it: the install fails with ERR_PNPM_UNUSED_PATCH, which is how the bump that takes demlik's
// next release finds tea's old 0.29.0 row (0569, and 0040: the existing tool wins). Plants, each run
// once: (a) `inWorkspace` reads no `patchedDependencies`; (b) `refusedPatches` takes any text after
// the `@` as a version; (c) a row at a version no catalog pins is refused, as pnpm already does.
describe("a patchedDependencies row", () => {
  const Lower = Schema.String.check(Schema.isPattern(/^[a-z]{1,6}$/));
  const Part = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 }));
  const Version = Schema.Struct({ major: Part, minor: Part, patch: Part });
  const Package = { name: Lower, scope: Lower, scoped: Schema.Boolean };

  /** Every range or tag form a row could be keyed on, each one checked in every run. */
  const RANGES = ["^", "~", ">=", "*", "latest", "1.x", " || 9.9.9", "workspace:*"];

  const exact = ({ major, minor, patch }: typeof Version.Type) => `${major}.${minor}.${patch}`;

  /** One package name per suffix, scoped or not, so the keys of one workspace never collide. */
  const named = ({ name, scope, scoped }: { name: string; scope: string; scoped: boolean }, suffix: string) =>
    scoped ? `@${scope}/${name}${suffix}` : `${name}${suffix}`;

  const workspace = (pins: readonly (readonly [string, string])[], keys: readonly string[]) =>
    [
      "catalog:",
      ...Arr.map(pins, ([key, version]) => `  '${key}': ${version}`),
      "patchedDependencies:",
      ...Arr.map(keys, (key, i) => `  '${key}': patches/${i}.patch`),
      "",
    ].join("\n");

  it.prop(
    "passes a row keyed on one exact version, the catalog's or one no catalog pins, which pnpm refuses at install",
    { ...Package, pinned: Version, patched: Version },
    (drawn) => {
      const [a, b] = [named(drawn, "a"), named(drawn, "b")];

      const pins = [
        [a, exact(drawn.pinned)],
        [b, exact(drawn.pinned)],
      ] as const;

      const keys = [`${a}@${exact(drawn.pinned)}`, `${b}@${exact(drawn.patched)}`];
      expect(run({ "pnpm-workspace.yaml": workspace(pins, keys) })).toEqual({
        status: 0,
        said: expect.stringContaining("every version exact"),
      });
    },
    { arbitrary: { runs: 10 } },
  );

  it.prop(
    "refuses a bare name, each range form and an empty version, naming each, and passes the exact row beside them",
    { ...Package, version: Version },
    (drawn) => {
      const good = `${named(drawn, "a")}@${exact(drawn.version)}`;

      const bad = [
        named(drawn, "b"),
        `${named(drawn, "c")}@`,
        ...Arr.map(RANGES, (range, i) => `${named(drawn, `r${i}`)}@${range}${exact(drawn.version)}`),
        ...Arr.map(RANGES, (range, i) => `${named(drawn, `t${i}`)}@${range}`),
      ];

      const { status, said } = run({ "pnpm-workspace.yaml": workspace([], [good, ...bad]) });
      expect(status).toBe(1);

      for (const key of bad) {
        expect(said).toContain(`pnpm-workspace.yaml: patchedDependencies: ${key}:`);
      }

      expect(said).not.toContain(`pnpm-workspace.yaml: patchedDependencies: ${good}:`);
    },
    { arbitrary: { runs: 10 } },
  );
});

describe("what must never read as clean", () => {
  it("a package.json that is not JSON exits 2, naming it", () => {
    const { status, said } = run({ "package.json": "{" });
    expect(status).toBe(2);
    expect(said).toContain("package.json: could not read");
  });

  it("a pnpm-workspace.yaml that is not YAML exits 2, naming it", () => {
    const { status, said } = run({ "pnpm-workspace.yaml": "catalog: [\n" });
    expect(status).toBe(2);
    expect(said).toContain("pnpm-workspace.yaml: could not read");
  });

  it("a tree with no file to check exits 2", () => {
    expect(run({ "README.md": "x" }).status).toBe(2);
  });

  it("a folder outside git exits 2", () => {
    const outside = mkdtempSync(join(home, "plain-"));
    expect(spawnSync("node", [SCRIPT, outside]).status).toBe(2);
  });
});
