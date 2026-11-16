// L1 of the anti-slop install (0563): the vendored folder is the pinned commit's code. Each case
// builds a small git tree of its own, as exact-versions.test.ts does: a made-up `src/` under
// vendor/anti-slop/, and a pin.json that names the tree git gives it, all committed. Then one
// generated edit, committed or not, must be refused, and an untouched copy passes. The check on this
// repository's own folder runs in every whole `pnpm lint` (lint.ts).
//
// Plant, run once: `verify` returns no line once it has read pin.json, so it reads pin.json only.
// Every edit then passes, and this law is red.
//
// L6: nothing of this repo's runs their files. Their `src/` holds their own tests, one of which
// starts oxlint as a child process and writes temp files (rules/require-readable-spacing-cli.test.ts),
// and it comes in whole (0563). So no vitest project and no tsconfig of the repo includes a path under
// vendor/. Plants, each run once: `vendor/**` added to the tooling project's include, and
// `../vendor/**/*.ts` added to oxlint-plugins/tsconfig.json's include. Each turns L6 red.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import fc from "fast-check";
import { parseSync } from "oxc-parser";
import { afterAll, describe, expect, it } from "vitest";
import { projects } from "../vitest.config.ts";
import { verify } from "./vendored.ts";

const ROOT = join(import.meta.dirname, "..");

const home = mkdtempSync(join(tmpdir(), "vendored-"));

afterAll(() => rmSync(home, { recursive: true, force: true }));

const runs = { seed: 119120, numRuns: 20 };

/** Git with this law's own author and no signing or hooks, so a commit here is the same on any machine. */
const git = (cwd: string, args: ReadonlyArray<string>): string => {
  const ran = spawnSync(
    "git",
    [
      "-c",
      "user.name=law",
      "-c",
      "user.email=law@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.autocrlf=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );

  expect(ran.status, ran.stderr).toBe(0);

  return ran.stdout.trim();
};

let trees = 0;

/** A new git tree holding these files under vendor/anti-slop/src, and a pin.json naming their tree, committed. */
const pinned = (files: Readonly<Record<string, string>>): { readonly root: string; readonly tree: string } => {
  trees += 1;
  const root = join(home, String(trees));
  const src = join(root, "vendor", "anti-slop", "src");

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(src, path)), { recursive: true });
    writeFileSync(join(src, path), text);
  }

  git(home, ["init", "-q", root]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "their src"]);
  const tree = git(root, ["rev-parse", "HEAD:vendor/anti-slop/src"]);
  const pin = { repository: "https://example.invalid/fork", commit: "0".repeat(40), tree };
  writeFileSync(join(root, "vendor", "anti-slop", "pin.json"), `${JSON.stringify(pin, null, 2)}\n`);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "the pin"]);

  return { root, tree };
};

const KINDS = ["none", "byte", "add", "remove", "tree"] as const;

type Kind = (typeof KINDS)[number];

/** One edit of the copy: which kind, whether it is committed, and the numbers that place it. */
interface Edit {
  readonly kind: Kind;
  readonly committed: boolean;
  readonly at: number;
  readonly tree: string;
}

/** Makes one edit in the copy at `root`, and commits it when the edit says so. */
const apply = (root: string, files: ReadonlyArray<string>, edit: Edit): void => {
  const src = join(root, "vendor", "anti-slop", "src");
  const file = join(src, files[edit.at % files.length] ?? "");

  if (edit.kind === "byte") {
    const text = readFileSync(file, "utf8");
    const i = edit.at % text.length;
    writeFileSync(file, `${text.slice(0, i)}${String.fromCharCode(text.charCodeAt(i) ^ 1)}${text.slice(i + 1)}`);
  }

  if (edit.kind === "add") {
    writeFileSync(join(src, "added-by-hand.ts"), "export const added = 1;\n");
  }

  if (edit.kind === "remove") {
    unlinkSync(file);
  }

  if (edit.kind === "tree") {
    const pin = { repository: "https://example.invalid/fork", commit: "0".repeat(40), tree: edit.tree };
    writeFileSync(join(root, "vendor", "anti-slop", "pin.json"), `${JSON.stringify(pin, null, 2)}\n`);
  }

  if (edit.committed && edit.kind !== "none") {
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", `edit: ${edit.kind}`]);
  }
};

const FILES = fc.dictionary(
  fc.stringMatching(/^[a-z]{1,6}(?:\/[a-z]{1,6})?\.ts$/),
  fc.string({ minLength: 1, maxLength: 40 }),
  { minKeys: 1, maxKeys: 4 },
);

const EDIT = fc.record({
  kind: fc.constantFrom(...KINDS),
  committed: fc.boolean(),
  at: fc.nat({ max: 1000 }),
  tree: fc.stringMatching(/^[0-9a-f]{40}$/),
});

/** Each kind of edit, committed and not, so every case is reached whatever the random runs draw. */
const EXAMPLES: Array<[Readonly<Record<string, string>>, Edit]> = Arr.flatMap(KINDS, (kind) =>
  Arr.map([true, false], (committed): [Readonly<Record<string, string>>, Edit] => [
    { "rules/one.ts": "export const one = 1;\n", "two.ts": "export const two = 2;\n" },
    { kind, committed, at: 1, tree: "f".repeat(40) },
  ]),
);

describe("L1 the vendored folder is the pinned commit's code", () => {
  it("refuses a changed byte, an added file, a removed file and a changed tree id, committed or not, and passes an untouched copy", () => {
    const seen = new Set<string>();

    fc.assert(
      fc.property(FILES, EDIT, (files, edit) => {
        const { root, tree } = pinned(files);
        fc.pre(edit.kind !== "tree" || edit.tree !== tree);
        apply(root, Object.keys(files), edit);
        seen.add(`${edit.kind} ${edit.committed}`);
        // Refused exactly when the copy was edited: an untouched copy gets no line, every edit one at least.
        expect({ kind: edit.kind, refused: verify(root).length > 0 }).toEqual({
          kind: edit.kind,
          refused: edit.kind !== "none",
        });
      }),
      { ...runs, examples: EXAMPLES },
    );

    // Every kind, committed and not: ten cases in all.
    expect(seen.size).toBe(KINDS.length * 2);
  });

  it("scenario: a tree with no pin.json, or one that is not the pin's shape, is refused, never read as clean", () => {
    const { root } = pinned({ "one.ts": "export const one = 1;\n" });
    writeFileSync(join(root, "vendor", "anti-slop", "pin.json"), "{");
    expect(verify(root).length).toBeGreaterThan(0);
    rmSync(join(root, "vendor", "anti-slop", "pin.json"));
    expect(verify(root).length).toBeGreaterThan(0);
  });
});

/** Vitest's installed matcher, read as vitest.config.ts reads it, so a glob matches here as it does there. */
const picomatch: { isMatch: (path: string, globs: ReadonlyArray<string>, options: { dot: boolean }) => boolean } =
  createRequire(import.meta.resolve("vitest/package.json"))("picomatch");

/** The project, if any, whose include takes this path. */
const projectOf = (path: string): string | undefined =>
  pipe(
    Arr.findFirst(projects, (project) => picomatch.isMatch(path, project.test.include, { dot: true })),
    Option.map((project) => project.test.name),
    Option.getOrUndefined,
  );

/** Every file and folder under vendor/, from the top of the repo. */
const vendored = (): ReadonlyArray<string> =>
  Arr.map(readdirSync(join(ROOT, "vendor"), { recursive: true, encoding: "utf8" }), (path) => `vendor/${path}`);

/** What `tsc --showConfig` resolves a project's include to, its files from the project's folder. */
const Shown = Schema.fromJsonString(Schema.Struct({ files: Schema.optionalKey(Schema.Array(Schema.String)) }));

const TSC = join(ROOT, "node_modules", ".bin", "tsc");

/**
 * What a tsconfig's own top-level `extends` names, as a path from the top of the repo. Read from its
 * text with oxc-parser, as namespace-imports.test.ts reads tsconfig.base.json: a tsconfig has comments.
 */
const extended = (config: string): ReadonlyArray<string> => {
  const text = readFileSync(join(ROOT, config), "utf8");
  const [statement] = parseSync("tsconfig.ts", `(${text})`).program.body;
  const top = statement?.type === "ExpressionStatement" ? statement.expression : undefined;
  const object = top?.type === "ParenthesizedExpression" ? top.expression : top;
  const properties = object?.type === "ObjectExpression" ? object.properties : [];
  const named = Arr.findFirst(
    properties,
    (property) => property.type === "Property" && property.key.type === "Literal" && property.key.value === "extends",
  );
  const value = Option.isSome(named) && named.value.type === "Property" ? named.value.value : undefined;
  const items = value?.type === "ArrayExpression" ? value.elements : [value];
  return Arr.flatMap(items, (item) =>
    item?.type === "Literal" && Predicate.isString(item.value)
      ? [relative(ROOT, join(ROOT, dirname(config), item.value))]
      : [],
  );
};

describe("L6 nothing of this repo's runs or checks the vendored files", () => {
  it("no vitest project includes a generated path under vendor/", () => {
    const kinds = [
      ".ts",
      ".tsx",
      ".mjs",
      ".test.ts",
      ".test.tsx",
      "Test.ts",
      ".integration.test.ts",
      ".visual.test.ts",
    ];

    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z][a-z0-9.-]{0,7}$/), { maxLength: 4 }),
        fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/),
        fc.constantFrom(...kinds),
        (folders, name, kind) => {
          expect(projectOf(Arr.join(["vendor", ...folders, `${name}${kind}`], "/"))).toBeUndefined();
        },
      ),
      { seed: 119120, numRuns: 100 },
    );
  });

  it("scenario: no vitest project includes any file of vendor/, their spawning test among them", () => {
    const files = vendored();
    expect(files).toContain("vendor/anti-slop/src/rules/require-readable-spacing-cli.test.ts");
    expect(Arr.filter(files, (path) => projectOf(path) !== undefined)).toEqual([]);
  });

  it("scenario: no tsconfig project of the repo includes a path under vendor/, as tsc --showConfig resolves it", () => {
    const listed = spawnSync("git", ["ls-files", "-z", "--", "*tsconfig*.json"], { cwd: ROOT, encoding: "utf8" });
    const all = Arr.filter(listed.stdout.split("\0"), (path) => /^tsconfig(?:\.[\w-]+)?\.json$/.test(basename(path)));
    // A base another tsconfig extends is never a compilation of its own: its include is not
    // inherited when it has none, and each project that extends it is read here as it resolves.
    const bases = new Set(Arr.flatMap(all, extended));
    const configs = Arr.filter(all, (config) => !bases.has(config));
    expect(bases).toContain("tsconfig.base.json");
    // Many projects, each with files: none read means nothing was checked, never that it is clean.
    expect(configs.length).toBeGreaterThan(10);

    const reached = Arr.flatMap(configs, (config) => {
      const shown = spawnSync(TSC, ["--showConfig", "-p", config], { cwd: ROOT, encoding: "utf8" });
      expect(shown.status, `${config}: ${shown.stderr}`).toBe(0);
      const files = Schema.decodeUnknownSync(Shown)(shown.stdout).files ?? [];
      return pipe(
        files,
        Arr.map((file) => relative(ROOT, join(ROOT, dirname(config), file))),
        Arr.filter((file) => file === "vendor" || file.startsWith("vendor/")),
        Arr.map((file) => `${config}: ${file}`),
      );
    });

    expect(reached).toEqual([]);
  });
});
