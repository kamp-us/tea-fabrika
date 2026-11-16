import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { createVitest } from "vitest/node";
import { lawReads, readsOf } from "./vitest.reads.ts";

// Both versions' tooling: a law's declared text reads (vitest.reads.ts, 0591 point 2). R1 reads the
// declarations from generated test files; R2 runs real Vitest's `--changed` with the real plugin on
// planted git repositories. Each plant was run once on vitest.reads.ts and restored; each turned its
// law red (field/runs/, this sweep's tests row).
const SEED = 119120;

/** A glob as a law writes one, from the top of the repo: path segments, stars and an extension. */
const glob = fc.stringMatching(/^(?:[a-z]{1,6}|\*|\*\*)(?:\/(?:[a-z]{1,6}|\*|\*\*|[a-z]{1,4}\.[a-z]{1,4})){0,3}$/);

/** The key `reads` in each spelling an object literal allows. */
const key = fc.constantFrom("reads", '"reads"', "'reads'", '["reads"]', "[`reads`]");

/** A string literal in either quote. */
const quoted = (text: string, quote: string) => `${quote}${text}${quote}`;

/** One law call, by its member: each takes its options last, after the body or the inputs and the body. */
const callOf = (member: string, options: string) =>
  member.endsWith("prop")
    ? `${member}("a property", { reads: fc.string() }, ({ reads }) => {}, ${options});`
    : `${member}("a law", () => {}, ${options});`;

const member = fc.constantFrom(
  "it",
  "test",
  "it.effect",
  "it.live",
  "it.prop",
  "it.effect.prop",
  "it.live.prop",
  "it.each([1, 2])",
  "it.skipIf(false)",
);

/** One generated law: its member, its declared globs or none, and how the declaration is spelled. */
const law = fc.record({
  member,
  reads: fc.option(fc.array(glob, { maxLength: 4 }), { nil: null }),
  key,
  quote: fc.constantFrom('"', "'"),
  wrap: fc.constantFrom("", " as const", " satisfies ReadonlyArray<string>"),
  before: fc.constantFrom("", 'plant: "drop the read", ', 'scenario: "one tree", timeout: 10, '),
});

/** A law's source line and the globs it declares. */
const written = (one: typeof law extends fc.Arbitrary<infer L> ? L : never) => {
  const reads =
    one.reads === null ? "" : `${one.key}: [${one.reads.map((each) => quoted(each, one.quote)).join(", ")}]${one.wrap}`;
  return { line: callOf(one.member, `{ ${one.before}${reads} }`), globs: one.reads ?? [] };
};

/** What is not a law's options, and so never read: a helper's call, a property's inputs, two arguments. */
const noise = [
  'helper("not a law", () => {}, { reads: ["not/a/law"] });',
  'it.prop("inputs only", { reads: fc.array(fc.string()) }, ({ reads }) => {});',
  'it("two arguments", { reads: ["vitest/style"] });',
  'const options = { reads: ["by/name"] };',
];

/** A `reads` value that is not an array of string literals written at the call. */
const refused = fc.constantFrom(
  "reads: GLOBS",
  "reads",
  'reads: [...GLOBS, "a/b"]',
  'reads: ["a", other]',
  // A template with a placeholder, spelled in two parts so this file holds no `${` in a string.
  "reads: [`a/$" + "{b}`]",
  "reads: [`a/b`]",
  'reads: ["a"].concat(b)',
  "reads: null",
  'reads: ["a", , "b"]',
  "reads: [1]",
  '"reads": "a/b"',
);

// Plant: read only the first `reads` in a file (return from the visitor after one declaration). Red.
it("R1 readsOf answers exactly the literal globs of every reads key in a law's options, in any spelling of the declaration, and throws on any other value", () => {
  // What the runs reached: files with two declarations or more, and each member and key spelling.
  let many = 0;
  const members = new Set<string>();
  const keys = new Set<string>();
  fc.assert(
    fc.property(fc.array(law, { maxLength: 6 }), fc.subarray(noise), fc.nat(), (laws, extra, slot) => {
      many += laws.filter((each) => each.reads !== null).length > 1 ? 1 : 0;

      for (const each of laws) {
        members.add(each.member);
        keys.add(each.key);
      }

      const lines = laws.map(written);
      const at = lines.length === 0 ? 0 : slot % (lines.length + 1);
      const source = [
        'import * as fc from "fast-check";',
        ...lines.slice(0, at).map((each) => each.line),
        ...extra,
        ...lines.slice(at).map((each) => each.line),
      ].join("\n");
      expect(readsOf("next/a.test.ts", source)).toEqual(lines.flatMap((each) => each.globs));
    }),
    { seed: SEED, numRuns: 100 },
  );
  expect(many).toBeGreaterThan(10);
  expect(members.size).toBe(9);
  expect(keys.size).toBe(5);
  fc.assert(
    fc.property(member, refused, fc.array(law, { maxLength: 3 }), (one, bad, before) => {
      const source = [...before.map((each) => written(each).line), callOf(one, `{ ${bad} }`)].join("\n");
      expect(() => readsOf("next/a.test.ts", source)).toThrow(/array of string literals/);
    }),
    { seed: SEED, numRuns: 100 },
  );
  expect(() => readsOf("next/a.test.ts", 'it("a law", () => {}, { reads: ["a"] }')).toThrow(/does not parse/);
});

/** A git repository at `dir` with `files` written and committed; the commit. */
const commit = (dir: string, files: Record<string, string>, message: string): string => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }

  const run = (...args: string[]) => {
    const done = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@invalid", ...args], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(done.status, done.stderr).toBe(0);
    return done.stdout.trim();
  };

  run("add", "-A");
  run("commit", "-q", "--no-verify", "-m", message);
  return run("rev-parse", "HEAD");
};

/**
 * A declared glob, a tracked file it matches and one it does not, drawn by the glob's shape. Each
 * pair is built so the answer is known without a matcher: the second path leaves the glob's folder,
 * name or extension.
 */
const declared = fc
  .record({
    folder: fc.stringMatching(/^[a-z]{1,5}$/),
    name: fc.stringMatching(/^[a-z]{1,5}$/),
    ext: fc.constantFrom("json", "md", "ts", "patch"),
    deep: fc.stringMatching(/^[a-z]{1,5}$/),
    shape: fc.constantFrom("exact", "star", "globstar", "dotfile"),
    changes: fc.boolean(),
  })
  .map(({ folder, name, ext, deep, shape, changes }) => {
    const pair = {
      exact: { glob: `${folder}/${name}.${ext}`, hit: `${folder}/${name}.${ext}`, miss: `${folder}/${name}x.${ext}` },
      star: { glob: `${folder}/*.${ext}`, hit: `${folder}/${name}.${ext}`, miss: `${folder}/${name}.${ext}x` },
      globstar: { glob: `${folder}/**`, hit: `${folder}/${deep}/${name}.${ext}`, miss: `${folder}x/${name}.${ext}` },
      dotfile: { glob: `${folder}/**`, hit: `${folder}/.${name}`, miss: `.${folder}/${name}` },
    }[shape];
    return { ...pair, shape, changes };
  });

// Plant: drop the `addWatchFile` call from lawReads. Red: no case whose matched file changed selects
// its test.
it("R2 a test whose law declares a glob is in vitest's --changed when a tracked file it matches changes, and not when none does", async () => {
  // A temp repository per case, through `createVitest` with `changed`, as CI's legs run it. The test
  // file declares the glob and is untouched by the change; the change edits the matched file or the
  // other one, both tracked since the first commit. The real path: on macOS the temp folder is a link,
  // and Vitest names files by their real path.
  const seen = { hit: 0, miss: 0 };
  await fc.assert(
    fc.asyncProperty(declared, async ({ glob, hit, miss, changes }) => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "vitest-reads-")));

      try {
        spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
        const test = `it("reads its file", () => {}, { plant: "drop the read", reads: ["${glob}"] });\n`;
        const base = commit(
          dir,
          {
            "package.json": JSON.stringify({ name: "t", private: true }),
            "t/a.test.ts": test,
            [hit]: "1\n",
            [miss]: "1\n",
          },
          "base",
        );
        commit(dir, { [changes ? hit : miss]: "2\n" }, "change");
        const vitest = await createVitest(
          {
            root: dir,
            config: false,
            watch: false,
            changed: base,
            include: ["t/*.test.ts"],
          },
          { plugins: [lawReads(dir)] },
        );

        try {
          const picked = (await vitest.specifications.getRelevantTestSpecifications()).map((spec) =>
            relative(dir, spec.moduleId),
          );
          expect(picked).toEqual(changes ? ["t/a.test.ts"] : []);
          seen[changes ? "hit" : "miss"] += 1;
        } finally {
          await vitest.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }),
    { seed: SEED, numRuns: 50 },
  );
  // Both answers were reached, so neither side of the law held by default.
  expect(seen.hit).toBeGreaterThan(5);
  expect(seen.miss).toBeGreaterThan(5);
});
