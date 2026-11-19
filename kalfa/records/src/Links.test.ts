// L5 of docs/plan/quests/rules-and-records-build-PLAN.md (slice 8, 0607): every link lands on a live record.
// A Markdown link, or a `.decisions/NNNN-slug.md` path in a code comment, in a file under the scope, to a
// superseded record is one `link` finding that names the successor. A link to an accepted record, a link in
// fenced code, a bare number, a code string that is not a comment, a symlinked file, and anything in the
// history folders (`.decisions/`, `experiments/`, `field/`, `docs/direction/`, `docs/plan/quests/`) are none.
//
// Assumed export, `Links.ts`: `check(root: string)`: `Effect<ReadonlyArray<Finding>, E, Tracked |
// FileSystem | Path>`; a finding is `{ _tag: "link", path, line, target, live }`, `target` the four-digit
// number linked, `live` the record at the end of the chain of `successor`s from it (a record superseded by a
// record that is superseded too gives the last one; a chain that loops stops before it follows a record twice),
// and `line` counted from 1, the line that holds the target: for a reference-style link, its `[ref]: path`
// definition; for a link whose text wraps onto the next line, the line of its `)`. It reads the records'
// frontmatter itself, through `Tracked` and `FileSystem`, and skips a tracked entry whose `symlink` is true.
//
// Markdown is read as Markdown, so a link's text may wrap and sit in a table cell, and code is read as code, so
// a comment follows a regex literal with a backtick, and a string that holds `//` or `#` is not a comment.
//
// Each run puts one link in every file of the scope, drawing its form, so every form and every folder of the
// scope is reached in every run. Each run draws two chains of one to three superseded records, and links every
// member of the chains in turn, and a pair of records that supersede each other.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Schema } from "effect";
import { Finding } from "./Finding.ts";
import * as Links from "./Links.ts";
import { distinct, Number4, pad, record, ROOT, sentence, slugOf, Words, world } from "./Records.test-support.ts";

const check = { arbitrary: { seed: 119120, runs: runsFor({ fast: 50, full: 200 }) } };

// One file of each folder the plan names, and the instruction files at the root and in a folder.
const SCOPE = [
  "AGENTS.md",
  "next/AGENTS.md",
  "CLAUDE.md",
  "kalfa/records/AGENTS.md",
  ".agents/skills/adr/SKILL.md",
  ".agents/skills/lead/scripts/README.md",
  "docs/guidelines/rules-and-records.md",
  ".runbooks/sev.md",
  "docs/plan/README.md",
  ".patterns/settings.md",
  ".glossary/TERMS.md",
] as const;

// Files of the tracked code types in the scope, with a comment that cites a record.
const CODE = [
  "scripts/a.mjs",
  "oxlint-plugins/b.ts",
  "apps/c.tsx",
  "packages/d.js",
  ".github/ci/e.yaml",
  "scripts/f.sh",
] as const;

// Folders and files that are history, or not code: a link there is no finding.
const HISTORY = [
  "experiments/01-a-run.md",
  "field/notes/a-note.md",
  "docs/direction/a-note.md",
  "docs/plan/quests/a-PLAN.md",
] as const;

const FORMS = ["inline", "anchor", "angle", "reference", "dot-slash", "wrapped", "table"] as const;

const up = (path: string) => "../".repeat(path.split("/").length - 1);

/** The lines that link `file` to a decision, and which of them holds the target, counted from 0. */
const markdownLink = (form: (typeof FORMS)[number], file: string, target: string, text: string, n: number) => {
  const path = `${up(file)}.decisions/${target}`;

  switch (form) {
    case "inline":
      return { lines: [`See [${text}](${path}).`], at: 0 };
    case "anchor":
      return { lines: [`See [${text}](${path}#why).`], at: 0 };
    case "angle":
      return { lines: [`See [${text}](<${path}>).`], at: 0 };
    case "dot-slash":
      return { lines: [`See [${text}](./${path}).`], at: 0 };
    case "reference":
      return { lines: [`See [${text}][r${n}].`, "", `[r${n}]: ${path} "the record"`], at: 2 };
    case "wrapped":
      // The link's text wraps onto the next line, where its target is.
      return { lines: [`See [${text} about`, `${text}](${path}).`], at: 1 };
    case "table":
      // After a blank line: a table starts a block of its own.
      return { lines: ["", "| rule | link |", "| --- | --- |", `| ${text} | [${text}](${path}) |`], at: 3 };
  }
};

/**
 * The line before a comment, in code, for each of the ways that code can hide or fake one. `string` is the
 * record the string names: it is never a finding, since a string is not a comment.
 */
const HEADS = ["plain", "regex", "double", "single", "template"] as const;

const slashHead = (head: (typeof HEADS)[number], string: string) => {
  switch (head) {
    case "plain":
      return "const a = 1;";
    case "regex":
      // An unpaired backtick, in a regex literal: not the start of a template string.
      return "const FENCE = /^`{3,}/;";
    case "double":
      return `const u = "https://x.test // .decisions/${string}";`;
    case "single":
      return `const u = 'a \\' // .decisions/${string}';`;
    case "template":
      return `const u = \`// \${1} .decisions/${string}\`;`;
  }
};

/** A comment in a file of the type, that cites the record by its path from the repo root. */
const codeLink = (file: string, target: string, style: number, head: (typeof HEADS)[number], string: string) => {
  const path = `.decisions/${target}`;

  if (file.endsWith(".sh") || file.endsWith(".yaml")) {
    // A `#` inside quotes is not a comment, in shell or in YAML.
    const quoted = head === "plain" || head === "regex";

    return {
      lines: [`# See ${path} for why.`],
      at: 0,
      head: file.endsWith(".sh")
        ? quoted
          ? "echo ok"
          : `echo "a # .decisions/${string}"`
        : quoted
          ? "name: ci"
          : `name: "a # .decisions/${string}"`,
    };
  }

  const first = slashHead(head, string);

  return style % 3 === 0
    ? { lines: [`// See ${path} for why.`], at: 0, head: first }
    : style % 3 === 1
      ? { lines: ["/*", ` * See ${path} for why.`, " */"], at: 1, head: first }
      : { lines: [`/** The rule: ${path}. */`], at: 0, head: first };
};

// Plants: read `docs/direction/` and `docs/plan/quests/` as in scope, so the history links are
// findings; match links line by line, so the wrapped one is missed; read comments with no regard for
// strings, so a string that holds `//` is a finding; open a template string at any backtick, so the
// comments after a regex literal are lost; name the next record and not the end of the chain.
it.effect.prop(
  "L5 a link or a code-comment path to a superseded record is a link finding naming the live record at the end of its chain; accepted targets, fenced code, bare numbers, strings, symlinks and the history folders are none",
  {
    numbers: Schema.Array(Number4).check(Schema.isBetweenLength(11, 11)),
    names: Schema.Array(Words).check(Schema.isBetweenLength(11, 11)),
    picks: Schema.Array(Schema.Boolean).check(Schema.isBetweenLength(20, 20)),
    before: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 }))).check(
      Schema.isBetweenLength(20, 20),
    ),
    shift: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
    // The superseded records in each of the two chains: one to three.
    long: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 })),
    words: Words,
  },
  ({ numbers, names, picks, before, shift, long, words }) =>
    Effect.gen(function* () {
      const ids = distinct(numbers).map(pad);
      const text = sentence(words);
      const recordFile = (id: string, i: number) => `${id}-${slugOf(names[i]!)}.md`;

      // Two chains of different length, the last of each live: A is long records superseded, B is the next length.
      const chains = [ids.slice(0, long + 1), ids.slice(4, 4 + (long % 3) + 2)] as const;
      const accepted = ids[8]!;
      const loopX = ids[9]!;
      const loopY = ids[10]!;

      const files: Record<string, string | { text: string; symlink: true }> = {
        [`.decisions/${recordFile(accepted, 8)}`]: record({
          id: accepted,
          // History: a record may link whatever it likes.
          body: [`Was [the old rule](${recordFile(ids[0]!, 0)}).`],
        }),
        // A pair that supersede each other: the walk must stop.
        [`.decisions/${recordFile(loopX, 9)}`]: record({ id: loopX, status: "superseded", successor: loopY }),
        [`.decisions/${recordFile(loopY, 10)}`]: record({ id: loopY, status: "superseded", successor: loopX }),
      };

      // Every record of the chains, with the file each has, and the live record at the end of its chain.
      const members: Array<{ id: string; file: string; live: string }> = [];

      chains.forEach((chain, c) => {
        chain.forEach((id, m) => {
          const at = c === 0 ? m : 4 + m;
          const file = recordFile(id, at);
          const last = m === chain.length - 1;

          files[`.decisions/${file}`] = last
            ? record({ id })
            : record({ id, status: "superseded", successor: chain[m + 1]! });

          if (!last) {
            members.push({ id, file, live: chain[chain.length - 1]! });
          }
        });
      });

      const expected: Array<{ _tag: "link"; path: string; line: number; target: string; live: string }> = [];

      const page = (
        index: number,
        head: string,
        hit: { lines: ReadonlyArray<string>; at: number },
        filler: string = text,
      ) => {
        const gap = before[index]!;
        const lines = [head, ...Array.from({ length: gap }, () => filler), ...hit.lines, filler];

        // The head is line 1, the gap lines follow, and the hit's target is `at` lines into the link's lines.
        return { text: `${lines.join("\n")}\n`, line: 1 + gap + hit.at + 1 };
      };

      // The file `index` links to: every member of a chain in turn, from either chain.
      const point = (index: number) => members[(index + (picks[index]! ? 0 : 1) + shift) % members.length]!;

      SCOPE.forEach((file, i) => {
        const { file: target, id, live } = point(i);
        const form = FORMS[(i + shift) % FORMS.length]!;
        const made = page(i, "# A page", markdownLink(form, file, target, text, i));

        files[file] = made.text;
        expected.push({ _tag: "link", path: file, line: made.line, target: id, live });
      });

      // Code strings that name a record: never a finding, since a string is not a comment.
      const named = point(0).file;

      CODE.forEach((file, i) => {
        const { file: target, id, live } = point(SCOPE.length + i);
        const code = codeLink(file, target, i + shift, HEADS[(i + shift) % HEADS.length]!, named);
        // Code around the comment is code, so a parser reads it to the end.
        const made = page(SCOPE.length + i, code.head, code, /\.(ts|tsx|js|mjs)$/.test(file) ? "const b = 2;" : text);

        files[file] = made.text;
        expected.push({ _tag: "link", path: file, line: made.line, target: id, live });
      });

      // A loop: the walk stops at the record before it would follow one twice.
      files["docs/plan/a-loop.md"] =
        `See [X](../../.decisions/${recordFile(loopX, 9)}) and [Y](../../.decisions/${recordFile(loopY, 10)}).\n`;
      expected.push(
        { _tag: "link", path: "docs/plan/a-loop.md", line: 1, target: loopX, live: loopY },
        { _tag: "link", path: "docs/plan/a-loop.md", line: 1, target: loopY, live: loopX },
      );

      const fileA = members[0]!.file;
      const fileB = members[members.length - 1]!.file;

      // None of these is a finding.
      files["docs/guidelines/to-a-live-record.md"] =
        `See [live](../../.decisions/${recordFile(chains[0][long]!, long)}).\n`;
      files["docs/guidelines/to-an-accepted-record.md"] = `See [it](../../.decisions/${recordFile(accepted, 8)}).\n`;

      files[".patterns/in-a-fence.md"] = [
        "```md",
        `See [old](../.decisions/${fileA}).`,
        "```",
        "~~~",
        `See [old](../.decisions/${fileB}).`,
        "~~~",
        "",
      ].join("\n");

      // Four spaces after a blank line are code, as Markdown reads it.
      files[".patterns/in-indented-code.md"] = `Text.\n\n    See [old](../.decisions/${fileA}).\n`;

      files[".runbooks/bare-number.md"] =
        `Decision ${members[0]!.id} and ${members[1]!.id} are old, and so is ${members[0]!.id}.\n`;
      files["scripts/a-string.ts"] = `const old = ".decisions/${fileA}";\n`;
      files["experiments/02-a-run.ts"] = `// See .decisions/${fileA} for why.\n`;
      files["field/a-run.ts"] = `// See .decisions/${fileB} for why.\n`;

      for (const file of HISTORY) {
        files[file] = `See [old](${up(file)}.decisions/${fileA}).\n`;
      }

      // A symlink is read once, where it points: here, `.agents/skills/` is that place.
      files[".claude/skills/adr/SKILL.md"] = { text: `See [old](../../../.decisions/${fileA}).\n`, symlink: true };

      const all = yield* Links.check(ROOT).pipe(Effect.provide(world(ROOT, files)));
      const found = all.filter(Finding.guards.link);

      expect(found, "only link findings").toHaveLength(all.length);

      const order = (
        a: { path: string; line: number; target: string },
        b: { path: string; line: number; target: string },
      ) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line || (a.target < b.target ? -1 : 1));

      expect([...found].sort(order)).toEqual(expected.sort(order));
    }),
  check,
);
