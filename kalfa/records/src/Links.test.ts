// L5 of docs/plan/quests/rules-and-records-build-PLAN.md (slice 8, 0607): every link lands on a live record.
// A Markdown link, or a `.decisions/NNNN-slug.md` path in a code comment, in a file under the scope, to a
// superseded record is one `link` finding that names the successor. A link to an accepted record, a link in
// fenced code, a bare number, a code string that is not a comment, a symlinked file, and anything in the
// history folders (`.decisions/`, `experiments/`, `field/`, `docs/direction/`) are none.
//
// Assumed export, `Links.ts`: `check(root: string)`: `Effect<ReadonlyArray<Finding>, E, Tracked |
// FileSystem | Path>`; a finding is `{ _tag: "link", path, line, target, live }`, `target` the four-digit
// number linked, `live` the successor named by the superseded record's `successor`, and `line` counted from 1,
// the line that holds the target: for a reference-style link, its `[ref]: path` definition. It reads the
// records' frontmatter itself, through `Tracked` and `FileSystem`, and skips a tracked entry whose `symlink`
// is true.
//
// Each run puts one link in every file of the scope, drawing its form, so every form and every folder of the
// scope is reached in every run.
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
  "docs/plan/quests/a-PLAN.md",
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
const HISTORY = ["experiments/01-a-run.md", "field/notes/a-note.md", "docs/direction/a-note.md"] as const;

const FORMS = ["inline", "anchor", "angle", "reference", "dot-slash"] as const;

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
  }
};

/** A comment in a file of the type, that cites the record by its path from the repo root. */
const codeLink = (file: string, target: string, style: number) => {
  const path = `.decisions/${target}`;

  if (file.endsWith(".sh") || file.endsWith(".yaml")) {
    return { lines: [`# See ${path} for why.`], at: 0, head: file.endsWith(".sh") ? "echo ok" : "name: ci" };
  }

  return style % 3 === 0
    ? { lines: [`// See ${path} for why.`], at: 0, head: "const a = 1;" }
    : style % 3 === 1
      ? { lines: ["/*", ` * See ${path} for why.`, " */"], at: 1, head: "const a = 1;" }
      : { lines: [`/** The rule: ${path}. */`], at: 0, head: "const a = 1;" };
};

// Plant: read `docs/direction/` as in scope, so the history links are findings.
it.effect.prop(
  "L5 a link or a code-comment path to a superseded record is a link finding naming its successor; accepted targets, fenced code, bare numbers, code strings, symlinks and the history folders are none",
  {
    numbers: Schema.Array(Number4).check(Schema.isBetweenLength(5, 5)),
    names: Schema.Array(Words).check(Schema.isBetweenLength(6, 6)),
    picks: Schema.Array(Schema.Boolean).check(Schema.isBetweenLength(20, 20)),
    before: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 }))).check(
      Schema.isBetweenLength(20, 20),
    ),
    shift: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
    words: Words,
  },
  ({ numbers, names, picks, before, shift, words }) =>
    Effect.gen(function* () {
      const ids = distinct(numbers).map(pad);
      const text = sentence(words);
      const oldA = ids[0]!;
      const liveA = ids[1]!;
      const oldB = ids[2]!;
      const liveB = ids[3]!;
      const accepted = ids[4]!;
      const recordFile = (id: string, i: number) => `${id}-${slugOf(names[i]!)}.md`;
      const targets = [recordFile(oldA, 0), recordFile(oldB, 2)] as const;
      const fileA = recordFile(oldA, 0);
      const fileB = recordFile(oldB, 2);

      const files: Record<string, string | { text: string; symlink: true }> = {
        [`.decisions/${fileA}`]: record({ id: oldA, status: "superseded", successor: liveA }),
        [`.decisions/${recordFile(liveA, 1)}`]: record({ id: liveA }),
        [`.decisions/${fileB}`]: record({ id: oldB, status: "superseded", successor: liveB }),
        [`.decisions/${recordFile(liveB, 3)}`]: record({ id: liveB }),
        [`.decisions/${recordFile(accepted, 4)}`]: record({
          id: accepted,
          // History: a record may link whatever it likes.
          body: [`Was [the old rule](${fileA}).`],
        }),
      };

      const expected: Array<{ _tag: "link"; path: string; line: number; target: string; live: string }> = [];

      const page = (index: number, head: string, hit: { lines: ReadonlyArray<string>; at: number }) => {
        const gap = before[index]!;
        const lines = [head, ...Array.from({ length: gap }, () => text), ...hit.lines, text];

        // The head is line 1, the gap lines follow, and the hit's target is `at` lines into the link's lines.
        return { text: `${lines.join("\n")}\n`, line: 1 + gap + hit.at + 1 };
      };

      const point = (index: number) => {
        const pick = picks[index]!;

        return {
          target: targets[pick ? 0 : 1],
          id: pick ? oldA : oldB,
          live: pick ? liveA : liveB,
        };
      };

      SCOPE.forEach((file, i) => {
        const { target, id, live } = point(i);
        const form = FORMS[(i + shift) % FORMS.length]!;
        const made = page(i, "# A page", markdownLink(form, file, target, text, i));

        files[file] = made.text;
        expected.push({ _tag: "link", path: file, line: made.line, target: id, live });
      });

      CODE.forEach((file, i) => {
        const { target, id, live } = point(SCOPE.length + i);
        const code = codeLink(file, target, i + shift);
        const made = page(SCOPE.length + i, code.head, code);

        files[file] = made.text;
        expected.push({ _tag: "link", path: file, line: made.line, target: id, live });
      });

      // None of these is a finding.
      files["docs/guidelines/to-a-live-record.md"] = `See [live](../../.decisions/${recordFile(liveA, 1)}).\n`;
      files["docs/guidelines/to-an-accepted-record.md"] = `See [it](../../.decisions/${recordFile(accepted, 4)}).\n`;

      files[".patterns/in-a-fence.md"] = [
        "```md",
        `See [old](../.decisions/${fileA}).`,
        "```",
        "~~~",
        `See [old](../.decisions/${fileB}).`,
        "~~~",
        "",
      ].join("\n");

      files[".runbooks/bare-number.md"] = `Decision ${oldA} and ${oldB} are old, and so is ${oldA}.\n`;
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

      const order = (a: { path: string; line: number }, b: { path: string; line: number }) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line;

      expect([...found].sort(order)).toEqual(expected.sort(order));
    }),
  check,
);
