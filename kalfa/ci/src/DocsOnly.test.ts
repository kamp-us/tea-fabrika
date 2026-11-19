// The laws of the docs-only classifier (DocsOnly.ts). The table (DocsOnly.test-support.ts) holds the
// answers every tool reads, and the properties hold for every path the generators make: Markdown that
// a program reads is code, instruction text is never docs, and a list is docs only when no path is code.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import * as fc from "fast-check";
import { TABLE } from "./DocsOnly.test-support.ts";
import { docsOnly, isAdminDocs, kind } from "./DocsOnly.ts";

const options = { seed: 119120, numRuns: runsFor({ fast: 50, full: 200 }) };

// Lowercase words only, so a generated name is never AGENTS.md or CLAUDE.md, which are capitalized.
const word = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/);

const folders = fc.array(word, { maxLength: 3 });

const ext = fc.constantFrom("md", "ts", "sh", "py", "mjs", "json");

// Markdown under a tree a program or a test reads: code.
const readMarkdown = fc
  .tuple(fc.constantFrom("next", "kalfa", "programs", "packages", "fixtures", "vendor"), folders, word)
  .map(([tree, dirs, name]) => [tree, ...dirs, `${name}.md`].join("/"));

// A skill's script, with any extension, Markdown included: code.
const skillScript = fc.tuple(word, word, ext).map(([skill, name, e]) => `.agents/skills/${skill}/scripts/${name}.${e}`);

// AGENTS.md and CLAUDE.md, capitalized, which the lowercase generators above never draw.
const instructionMapName = fc.constantFrom("AGENTS.md", "CLAUDE.md");

// An AGENTS.md or CLAUDE.md under today's packages/ or programs/, at any depth: a program or a test reads it.
const todayMap = fc
  .tuple(fc.constantFrom("packages", "programs"), folders, instructionMapName)
  .map(([tree, dirs, name]) => [tree, ...dirs, name].join("/"));

// An AGENTS.md or CLAUDE.md with a fixtures folder above it, at any depth under a read tree: code.
const fixturesMap = fc
  .tuple(
    fc.constantFrom("next", "kalfa", "programs", "packages", "fixtures", "vendor"),
    folders,
    folders,
    instructionMapName,
  )
  .map(([tree, above, below, name]) => [tree, ...above, "fixtures", ...below, name].join("/"));

// An AGENTS.md or CLAUDE.md in a skill's scripts folder, at any depth: code, since a script folder is code.
const scriptsMap = fc
  .tuple(word, folders, instructionMapName)
  .map(([skill, dirs, name]) => [".agents/skills", skill, "scripts", ...dirs, name].join("/"));

// Paths of every kind, so one list can mix code, instruction text and docs.
const anyPath = fc.oneof(
  readMarkdown,
  skillScript,
  fc.constantFrom(
    "README.md",
    "AGENTS.md",
    "next/AGENTS.md",
    ".claude/agents/step-build.md",
    ".agents/skills/lead/SKILL.md",
  ),
  fc.tuple(folders, word).map(([dirs, name]) => ["docs", ...dirs, `${name}.md`].join("/")),
  fc.tuple(word, fc.constantFrom("json", "jsonl")).map(([name, e]) => `field/notes/${name}.${e}`),
  word.map((name) => `apps/${name}.ts`),
);

// vector: the fixed table's answers, for CI and for the lead's tools, row by row.
// Plant: `isRow` answers false for a field row, so the 1641 row's files count as code.
it("vector: every row of the fixed table gets its docsOnly answer, and its adminDocs answer from isAdminDocs", () => {
  for (const row of TABLE) {
    expect(docsOnly(row.paths), row.pr).toBe(row.docsOnly);
    expect(row.paths.every(isAdminDocs), row.pr).toBe(row.adminDocs);
  }
});

// Plant: `docsOnly` with `some` in place of `every`, so one docs path beside one code path counts as docs only.
it("property: docsOnly of a non-empty list is true exactly when no path is code, and of an empty list it is false", () => {
  fc.assert(
    fc.property(fc.array(anyPath, { minLength: 1, maxLength: 6 }), (paths) => {
      expect(docsOnly(paths), paths.join(" ")).toBe(paths.every((path) => kind(path) !== "code"));
    }),
    options,
  );

  expect(docsOnly([])).toBe(false);
});

// Plant: `reads` answers false for Markdown under next/, so such a file is docs and not code.
it("property: Markdown under a read tree is code, and so is a skill's script with any extension, and so is an AGENTS.md or CLAUDE.md under packages/, programs/, a fixtures folder or a skill's scripts folder", () => {
  fc.assert(
    fc.property(fc.oneof(readMarkdown, skillScript, todayMap, fixturesMap, scriptsMap), (path) => {
      expect(kind(path), path).toBe("code");
    }),
    options,
  );
});

// Plant: `isInstructionMap` lets fixtures/ through, so a fixture's AGENTS.md reads as instruction text, not code.
it("property: an AGENTS.md or CLAUDE.md under the root, next/, kalfa/ or docs/ is instructions, and under a root fixtures/, a brief or prompt folder or a skill's folder it is code", () => {
  const plain = word.filter((dir) => !["fixtures", "brief", "briefs", "prompt", "prompts"].includes(dir));

  const name = fc.constantFrom("AGENTS.md", "CLAUDE.md");

  const outside = fc
    .tuple(
      fc.constantFrom<readonly string[]>([], ["next"], ["kalfa"], ["docs"]),
      fc.array(plain, { maxLength: 2 }),
      name,
    )
    .map(([root, dirs, file]) => [...root, ...dirs, file].join("/"));

  const within = fc.oneof(
    fc.tuple(fc.array(plain, { maxLength: 2 }), name).map(([dirs, file]) => ["fixtures", ...dirs, file].join("/")),
    fc
      .tuple(
        fc.array(plain, { maxLength: 2 }),
        fc.constantFrom("brief", "briefs", "prompt", "prompts"),
        fc.array(plain, { maxLength: 1 }),
        name,
      )
      .map(([above, folder, below, file]) => [...above, folder, ...below, file].join("/")),
    fc
      .tuple(word, fc.array(plain, { maxLength: 1 }), name)
      .map(([skill, dirs, file]) => [".claude/skills", skill, ...dirs, file].join("/")),
  );

  fc.assert(
    fc.property(outside, within, (out, inside) => {
      expect(kind(out), out).toBe("instructions");
      expect(kind(inside), inside).toBe("code");
    }),
    options,
  );
});

// Plant: `isAdminDocs` answers the docs kind alone, so a README or a `.patterns/` Markdown counts as admin docs.
it("property: isAdminDocs is the docs kind under the admin merge's six folders, and no path outside them is admin docs", () => {
  const adminFolder = fc.constantFrom(".decisions", "docs", "field", ".glossary", ".runbooks", "experiments");

  const otherFolder = fc.constantFrom(".patterns", "apps", "oxlint-plugins", "next", "vendor", ".github", ".claude");

  // Markdown under one of the admin merge's folders: admin docs exactly when its kind is docs.
  const inside = fc
    .tuple(adminFolder, folders, word)
    .map(([dir, below, name]) => [dir, ...below, `${name}.md`].join("/"));

  // Markdown outside them, a root README included: never admin docs.
  const outside = fc.oneof(
    fc.tuple(otherFolder, folders, word).map(([dir, below, name]) => [dir, ...below, `${name}.md`].join("/")),
    fc.constant("README.md"),
  );

  fc.assert(
    fc.property(inside, (path) => {
      expect(isAdminDocs(path), path).toBe(kind(path) === "docs");
    }),
    options,
  );

  fc.assert(
    fc.property(outside, (path) => {
      expect(isAdminDocs(path), path).toBe(false);
    }),
    options,
  );
});
