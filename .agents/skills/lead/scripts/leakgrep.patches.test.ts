import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runsFor } from "@kampus/vitest";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Today's tooling. A `pnpm patch` file under patches/ quotes upstream's removed and context lines
// byte for byte, so nobody can reword them. Inside a patch's hunk those quoted lines skip the
// style shapes (the em dash), and keep every secret, path, name and private-word shape. Since the
// owner's ruling of 2026-11-16 the patch's own added lines inside a hunk skip the style shapes too:
// a patch built from an upstream pull request carries upstream's doc text there, which must stay
// upstream's exact output. A patch's headers outside a hunk and every other file keep every check.
// Each case runs as a diff git wrote, as a pushed commit and as a whole draft. The private word is
// made up.
const script = process.env.TEST_LEAKGREP ?? join(import.meta.dirname, "leakgrep.sh");

const word = "private_zzqxjv";

const dash = String.fromCodePoint(0x2014);

// One pnpm patch file, with `line` put in at one place.
const patch = (part: "removed" | "context" | "added" | "header", line: string) => [
  "diff --git a/dist/index.js b/dist/index.js",
  "index 1111111..2222222 100644",
  "--- a/dist/index.js",
  "+++ b/dist/index.js",
  ...(part === "header" ? [` ${line}`] : []),
  "@@ -1,3 +1,3 @@",
  ` const a = 1;${part === "context" ? ` ${line}` : ""}`,
  `-const b = 2;${part === "removed" ? ` ${line}` : ""}`,
  `+const b = 3;${part === "added" ? ` ${line}` : ""}`,
  " const c = 4;",
];

type Read = { readonly status: number | null; readonly stderr: string };

// How the check reads one file holding these lines, in each of its three modes.
const read = (path: string, lines: ReadonlyArray<string>): Record<"diff" | "commits" | "text", Read> => {
  const dir = mkdtempSync(join(tmpdir(), "lg-patches-"));

  try {
    const repo = join(dir, "repo");
    const words = join(dir, "words");
    mkdirSync(repo);
    writeFileSync(words, `${word}\n`);

    const git = (...args: string[]) => {
      const ran = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
        cwd: repo,
        encoding: "utf8",
      });

      expect(ran.status, ran.stderr).toBe(0);

      return ran.stdout;
    };

    git("init", "-q");
    const file = join(repo, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, lines.map((line) => `${line}\n`).join(""));
    git("add", "-A");
    git("commit", "-q", "-m", "a patch");

    const run = (args: ReadonlyArray<string>, input?: string): Read => {
      const ran = spawnSync("sh", [script, ...args], {
        cwd: repo,
        input,
        encoding: "utf8",
        env: { ...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined },
      });

      expect(ran.stdout + ran.stderr).not.toContain(word);
      expect(ran.stdout + ran.stderr).not.toContain(dir);

      return { status: ran.status, stderr: ran.stderr };
    };

    return {
      diff: run([], git("show", "HEAD")),
      commits: run(["--commits", "HEAD"]),
      text: run(["--text", file]),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const options = { seed: 1616, numRuns: runsFor({ fast: 4, full: 40 }) };

// Text that holds no shape the check knows: letters, digits, spaces and code punctuation.
const filler = fc.array(fc.constantFrom(..."abcxyz019 =;(){}.,'"), { maxLength: 12 }).map((chars) => chars.join(""));

// One line inside a hunk: a context, removed or added line. An added line may carry a planted dash.
const hunkLine = fc.oneof(
  fc.tuple(fc.constantFrom(" ", "-"), filler).map(([mark, text]) => ({ text: mark + text, added: false })),
  fc
    .tuple(filler, fc.boolean(), filler)
    .map(([before, holds, after]) => ({ text: `+${before}${holds ? dash : ""}${after}`, added: true })),
);

// One hunk: its header, then lines, with at least one added line that carries a dash at its end.
const hunk = fc
  .tuple(fc.array(hunkLine, { maxLength: 5 }), filler)
  .map(([body, last]) => [
    { text: "@@ -1,3 +1,3 @@", added: false },
    ...body,
    { text: `+${last}${dash}`, added: true },
  ]);

// A whole pnpm patch: one or two files, each with git's four header lines and one to three hunks.
// `added` holds the index of every added line inside a hunk.
const patchFile = fc
  .array(fc.array(hunk, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 2 })
  .map((files) => {
    const all = files.flatMap((hunks, n) => [
      ...[
        `diff --git a/dist/f${n}.js b/dist/f${n}.js`,
        "index 1111111..2222222 100644",
        `--- a/dist/f${n}.js`,
        `+++ b/dist/f${n}.js`,
      ].map((text) => ({ text, added: false })),
      ...hunks.flat(),
    ]);

    return {
      lines: all.map(({ text }) => text),
      added: all.flatMap(({ added }, n) => (added ? [n] : [])),
      files: files.length,
      hunks: files.reduce((sum, hunks) => sum + hunks.length, 0),
    };
  });

// The places outside every hunk where a patch's own text can stand: a free line that looks like
// context or an added line before a file's first hunk, and git's own `diff` and `+++` lines. Each
// plants its dash in the patch's last file only, so a two-file patch shows that a file's header ends
// the hunk before it.
const lastFile = (lines: ReadonlyArray<string>) => lines.findLastIndex((line) => line.startsWith("diff --git "));

const headers: ReadonlyArray<readonly [string, (lines: ReadonlyArray<string>) => ReadonlyArray<string>]> = [
  ["context-before-hunk", (lines) => lines.toSpliced(lastFile(lines) + 4, 0, ` note ${dash}`)],
  ["added-before-hunk", (lines) => lines.toSpliced(lastFile(lines) + 4, 0, `+note ${dash}`)],
  ["diff-line", (lines) => lines.with(lastFile(lines), `${lines[lastFile(lines)]}${dash}`)],
  ["new-file-line", (lines) => lines.with(lastFile(lines) + 3, `${lines[lastFile(lines) + 3]}${dash}`)],
];

// Paths that are not a pnpm patch under the repo's patches/.
const elsewhere = ["docs/upstream@1.0.0.patch", "next/patches/upstream@1.0.0.patch", "notes/upstream.md"];

// One made-up leak of each shape that must still read a patch's added lines. The key is built here
// at run time, so this file never holds one.
const alnum = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");

const secrets = [
  ["key", fc.array(alnum, { minLength: 36, maxLength: 40 }).map((chars) => `gh${"p"}_${chars.join("")}`)],
  ["machine_path", filler.map((name) => "/" + `home/someone${name.replace(/[^a-z]/g, "")}/work`)],
  ["private_word", fc.constant(word)],
  ["canvas", filler.map((name) => "https://claude.ai/" + `design/${name.replace(/[^a-z]/g, "")}`)],
] as const;

describe("leakgrep reads upstream text a patch only quotes, today's tooling", () => {
  // Plant (red on the script before this change): any em dash in a patch file fails.
  for (const part of ["removed", "context"] as const) {
    it(`an em dash on an inner ${part} line of a patches/ file passes`, () => {
      for (const [mode, ran] of Object.entries(read("patches/upstream@1.0.0.patch", patch(part, dash)))) {
        expect(ran.status, `${mode}: ${ran.stderr}`).toBe(0);
      }
    });
  }

  // Plants: skip a whole patch file, or skip every line that starts with a space or a dash.
  for (const part of ["header"] as const) {
    it(`an em dash on an inner ${part} line of a patches/ file still fails`, () => {
      for (const [mode, ran] of Object.entries(read("patches/upstream@1.0.0.patch", patch(part, dash)))) {
        expect(ran.status, mode).toBe(1);
        expect(ran.stderr, mode).toContain("leak em_dash");
      }
    });
  }

  // Plant: skip every shape on a quoted line, not only the style ones.
  for (const [kind, leak] of [
    ["private_word", word],
    ["machine_path", "/" + "home/someone/work"],
    ["key", `npm_${"a".repeat(36)}`],
    ["canvas", "https://claude.ai/" + "design/private"],
  ] as const) {
    it(`a ${kind} on an inner removed line of a patches/ file still fails`, () => {
      for (const [mode, ran] of Object.entries(read("patches/upstream@1.0.0.patch", patch("removed", leak)))) {
        expect(ran.status, mode).toBe(1);
        expect(ran.stderr, mode).toContain(`leak ${kind}`);
      }
    });
  }

  // Plant: match patches/ anywhere in the path, or skip any file shaped like a patch.
  for (const path of ["docs/upstream@1.0.0.patch", "next/patches/upstream@1.0.0.patch"]) {
    it(`an em dash on a removed-looking line of ${path} still fails`, () => {
      for (const [mode, ran] of Object.entries(read(path, patch("removed", dash)))) {
        expect(ran.status, mode).toBe(1);
        expect(ran.stderr, mode).toContain("leak em_dash");
      }
    });
  }

  // Plant (red on the script before the owner's 2026-11-16 change): any em dash on a patch's added
  // line fails. This law replaces the old "an em dash on an inner added line of a patches/ file
  // still fails", whose rule that change turned around.
  it("an em dash on any added line inside a hunk of a patches/ file passes", () => {
    const seen = { files: false, hunks: false };
    fc.assert(
      fc.property(patchFile, (built) => {
        const dashes = built.lines.filter((line) => line.includes(dash)).length;
        // Every generated patch carries at least one planted dash, so the law never passes empty.
        expect(dashes).toBeGreaterThan(0);
        seen.files ||= built.files > 1;
        seen.hunks ||= built.hunks > built.files;

        for (const [mode, ran] of Object.entries(read("patches/upstream@1.0.0.patch", built.lines))) {
          expect(ran.status, `${mode}: ${ran.stderr}`).toBe(0);
        }
      }),
      options,
    );
    // Coverage: a dash after a second file's header and in a later hunk of one file were both read.
    expect(seen).toEqual({ files: true, hunks: true });
  });

  // Plants: skip every line of a patch that starts with a plus, inside a hunk or not; or skip the
  // headers too. Each place outside a hunk gets its own law, so every place is read.
  for (const [place, plant] of headers) {
    it(`an em dash on a patches/ file's ${place} line outside a hunk still fails`, () => {
      const files = new Set<number>();
      fc.assert(
        fc.property(patchFile, (clean) => {
          files.add(clean.files);
          const lines = plant(clean.lines.map((line) => line.replaceAll(dash, "")));
          // The plant is the patch's only dash, so a fail can come from nowhere else.
          expect(lines.filter((line) => line.includes(dash))).toHaveLength(1);

          for (const [mode, ran] of Object.entries(read("patches/upstream@1.0.0.patch", lines))) {
            expect(ran.status, `${mode}: ${ran.stderr}`).toBe(1);
            expect(ran.stderr, mode).toContain("leak em_dash");
          }
        }),
        options,
      );
      // Coverage: a one-file patch and a two-file patch were each read.
      expect([...files].sort()).toEqual([1, 2]);
    });
  }

  // Plant: skip any file shaped like a patch, wherever it lives.
  for (const path of elsewhere) {
    it(`an em dash on an added line inside a hunk of ${path} still fails`, () => {
      fc.assert(
        fc.property(patchFile, (built) => {
          for (const [mode, ran] of Object.entries(read(path, built.lines))) {
            expect(ran.status, `${mode}: ${ran.stderr}`).toBe(1);
            expect(ran.stderr, mode).toContain("leak em_dash");
          }
        }),
        options,
      );
    });
  }

  // Plant: skip every shape on a patch's added line, not only the style ones.
  for (const [kind, leak] of secrets) {
    it(`a ${kind} on an added line inside a hunk of a patches/ file still fails`, () => {
      fc.assert(
        fc.property(patchFile, leak, fc.nat(), (built, text, pick) => {
          const at = built.added[pick % built.added.length] ?? -1;
          const lines = built.lines.map((line, n) => (n === at ? `${line} ${text}` : line));

          for (const [mode, ran] of Object.entries(read("patches/upstream@1.0.0.patch", lines))) {
            expect(ran.status, mode).toBe(1);
            expect(ran.stderr, mode).toContain(`leak ${kind}`);
          }
        }),
        options,
      );
    });
  }
});
