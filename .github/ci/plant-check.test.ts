// The plant check (0093, 0580): every law a pull request adds or changes, in a file on the package's
// `it`, names its plant, and a run row the pull request adds records it red. Each law below names
// the plant run once on plant-check.ts and restored; the records are in the tests step's run row.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { check, type LawFile, lawsOf, readInputs, type Recorded, type Refusal, report } from "./plant-check.ts";

const options = { seed: 119120 };

const LABELS = ["vector", "format", "pinned", "scenario", "type"] as const;

const PLANTS = ["drop the press row", "skip the last append", "answer the old value"] as const;

/** What one law does between the base and the head of a pull request. */
type Move = "untouched" | "moved" | "new" | "edited" | "deleted";

/** What the added run rows say of a law's plant: nothing, red, green, or a record of a longer plant. */
type Record = "none" | "red" | "green" | "longer";

interface Spec {
  readonly move: Move;
  readonly label: (typeof LABELS)[number] | null;
  readonly plant: (typeof PLANTS)[number] | null;
  readonly record: Record;
  readonly n: number;
}

const spec: fc.Arbitrary<Spec> = fc.record({
  move: fc.constantFrom<Move>("untouched", "moved", "new", "edited", "deleted"),
  label: fc.option(fc.constantFrom(...LABELS), { nil: null }),
  plant: fc.option(fc.constantFrom(...PLANTS), { nil: null }),
  record: fc.constantFrom<Record>("none", "red", "green", "longer"),
  n: fc.integer({ min: 0, max: 9 }),
});

const files = fc.uniqueArray(
  fc.record({
    name: fc.constantFrom("Ledger", "Mail", "Relations", "Hands", "Starts"),
    ours: fc.boolean(),
    laws: fc.array(spec, { minLength: 1, maxLength: 4 }),
  }),
  { minLength: 1, maxLength: 3, selector: (f) => f.name },
);

/** A file outside the diff that a row's record names: none, one on the package's `it`, or one on another. */
const outsides = fc.constantFrom<"none" | "ours" | "other">("none", "ours", "other");

const importOf = (ours: boolean) =>
  ours ? 'import { it } from "@kampus/vitest";' : 'import { it } from "@effect/vitest";';

const titleOf = (i: number) => `law ${i} keeps its claim`;

const prefix = (s: Spec) => (s.label === null ? "" : `${s.label}: `);

const bodyOf = (n: number) => `() => { expect(read(${n})).toBe(${n}); }`;

/** The options a head law writes: its plant and its label, moved out of the comment and the title. */
const optionsOf = (s: Spec) => {
  const keys = [
    ...(s.plant === null ? [] : [`plant: "${s.plant}"`]),
    ...(s.label === null ? [] : [`${s.label}: ${s.label === "pinned" ? "1497" : '"why"'}`]),
  ];

  return keys.length === 0 ? "" : `, { ${keys.join(", ")} }`;
};

/** The base and head source of one file, as an author on @effect/vitest writes before and after 0580. */
const sources = (ours: boolean, laws: readonly Spec[]) => {
  const base = laws.flatMap((s, i) =>
    s.move === "new" ? [] : [`// Plant: ${s.plant ?? "none"}`, `it("${prefix(s)}${titleOf(i)}", ${bodyOf(s.n)});`],
  );

  const head = laws.flatMap((s, i) =>
    s.move === "deleted"
      ? []
      : s.move === "untouched"
        ? [`// Plant: ${s.plant ?? "none"}`, `it("${prefix(s)}${titleOf(i)}", ${bodyOf(s.n)});`]
        : [`it("${titleOf(i)}", ${bodyOf(s.move === "edited" ? s.n + 10 : s.n)}${optionsOf(s)});`],
  );

  return { base: [importOf(ours), ...base].join("\n"), head: [importOf(ours), ...head].join("\n") };
};

/** A refusal as the model and the check both name it. */
const named = (r: Refusal) =>
  r._tag === "unclaimed" ? `${r._tag} ${r.plant.file} ${r.plant.law}` : `${r._tag} ${r.law.file} ${r.law.title}`;

// Plant: compare a row's plant to the law's by prefix, so a record of a longer plant counts.
// Plant: refuse a record whose file is absent from head as unclaimed.
// Plant: skip a record whose file the pull request does not change.
it("property: the check's refusals equal a model's: no plant, not recorded, green and unclaimed, and an untouched or moved-only law gives none", () => {
  fc.assert(
    fc.property(files, fc.boolean(), fc.boolean(), outsides, (generated, ghost, gone, outside) => {
      const row = "field/runs/2026-11-16-a-row.json";
      const base: LawFile[] = [];
      const head: LawFile[] = [];
      const rows: Recorded[] = [];
      const expected: string[] = [];
      const notices: string[] = [];

      for (const { name, ours, laws } of generated) {
        const file = `next/packages/libfabrika/src/${name}.test.ts`;
        const text = sources(ours, laws);
        base.push(lawsOf(file, text.base));
        head.push(lawsOf(file, text.head));
        const changed = laws.filter((s) => s.move === "new" || s.move === "edited");

        if (!ours && changed.length > 0) {
          notices.push(file);
        }

        laws.forEach((s, i) => {
          const law = titleOf(i);
          const held = ours && (s.move === "new" || s.move === "edited");

          // A record only for a law the change touches, or a ghost below: a record of an untouched law is unclaimed.
          const records =
            s.plant === null || s.record === "none" || !(s.move === "new" || s.move === "edited")
              ? []
              : [
                  {
                    row,
                    file,
                    law,
                    plant: s.record === "longer" ? `${s.plant} and more` : s.plant,
                    result: s.record === "green" ? ("green" as const) : ("red" as const),
                  },
                ];

          rows.push(...records);

          if (held) {
            expected.push(
              s.plant === null
                ? `no_plant ${file} ${law}`
                : s.record === "green"
                  ? `green ${file} ${law}`
                  : s.record === "red"
                    ? ""
                    : `not_recorded ${file} ${law}`,
            );
          }

          if (ours && s.record === "longer" && records.length > 0) {
            expected.push(`unclaimed ${file} ${law}`);
          }
        });

        if (ghost && ours) {
          rows.push({ row, file, law: "a law nobody wrote", plant: PLANTS[0], result: "red" });
          expected.push(`unclaimed ${file} a law nobody wrote`);
        }
      }

      // A record with no file, as rows before 0580 write them, is never read.
      rows.push({ row, law: titleOf(0), plant: PLANTS[0], result: "green" });

      // A record of a file the head no longer has, as an older row of a since-renamed file, is never read.
      if (gone) {
        rows.push({
          row,
          file: "next/packages/libfabrika/src/Gone.test.ts",
          law: titleOf(0),
          plant: PLANTS[0],
          result: "red",
        });
      }

      // A record of a law in a file the pull request leaves alone, present at head: on the package's
      // `it` no changed law names it, so it is unclaimed; on another `it` it is not read.
      const untouched: LawFile[] = [];

      if (outside !== "none") {
        const file = "next/packages/libfabrika/src/Untouched.test.ts";

        const kept = sources(outside === "ours", [
          { move: "untouched", label: null, plant: null, record: "none", n: 0 },
        ]);

        untouched.push(lawsOf(file, kept.head));
        rows.push({ row, file, law: titleOf(0), plant: PLANTS[0], result: "red" });

        if (outside === "ours") {
          expected.push(`unclaimed ${file} ${titleOf(0)}`);
        }
      }

      const outcome = check({ base, head, untouched }, rows);
      expect(outcome.refusals.map(named).toSorted()).toEqual(expected.filter((e) => e !== "").toSorted());
      expect(outcome.notices).toEqual(notices);
    }),
    {
      ...options,
      numRuns: 200,
      examples: [
        // Every refusal at once, a moved-only law beside them, in a file on the package's it.
        [
          [
            {
              name: "Ledger",
              ours: true,
              laws: [
                { move: "new", label: null, plant: null, record: "none", n: 1 },
                { move: "edited", label: "scenario", plant: PLANTS[0], record: "green", n: 2 },
                { move: "new", label: null, plant: PLANTS[1], record: "longer", n: 3 },
                { move: "moved", label: "vector", plant: PLANTS[2], record: "none", n: 4 },
              ],
            },
          ],
          true,
          true,
          "ours",
        ],
      ],
    },
  );
  // Coverage: the model reaches every refusal and the empty answer in the runs above (the example
  // alone reaches all four); this pins the empty one.
  const quiet = sources(true, [{ move: "moved", label: "pinned", plant: PLANTS[0], record: "none", n: 1 }]);
  const file = "next/a.test.ts";
  expect(check({ base: [lawsOf(file, quiet.base)], head: [lawsOf(file, quiet.head)], untouched: [] }, [])).toEqual({
    refusals: [],
    notices: [],
  });
});

// Plant: refuse every changed law, whatever its import.
it("property: a file still on @effect/vitest or vitest gets one notice and no refusal, and a file on the package's it is held", () => {
  const imports = [
    ['import { it } from "@kampus/vitest";', true],
    ['import { describe, it } from "@kalfa/vitest";', true],
    ['import { it } from "@effect/vitest";', false],
    ['import { it } from "vitest";', false],
    ['import type { it } from "@kampus/vitest";', false],
    ['import { runsFor } from "@kampus/vitest";\nimport { it } from "@effect/vitest";', false],
  ] as const;

  fc.assert(
    fc.property(
      fc.uniqueArray(fc.integer({ min: 0, max: imports.length - 1 }), { minLength: 1, maxLength: imports.length }),
      fc.integer({ min: 1, max: 4 }),
      (picked, count) => {
        const head = picked.map((at) => {
          const [line] = imports[at] ?? imports[0];
          const laws = Array.from({ length: count }, (_, i) => `it("${titleOf(i)}", ${bodyOf(i)});`);

          return lawsOf(`next/a/F${at}.test.ts`, [line, ...laws].join("\n"));
        });

        const outcome = check({ base: [], head, untouched: [] }, []);
        const ours = picked.filter((at) => (imports[at] ?? imports[0])[1]);
        expect(outcome.notices).toEqual(
          picked.filter((at) => !(imports[at] ?? imports[0])[1]).map((at) => `next/a/F${at}.test.ts`),
        );
        expect(outcome.refusals.map(named).toSorted()).toEqual(
          ours
            .flatMap((at) => Array.from({ length: count }, (_, i) => `no_plant next/a/F${at}.test.ts ${titleOf(i)}`))
            .toSorted(),
        );
      },
    ),
    { ...options, numRuns: 100 },
  );
});

/** A statement as tokens, so a printer can lay them out and one edit can change one token. */
const tokens = (n: number, name: string) => ["const", name, "=", "read", "(", String(n), ",", '"k"', ")", ";"];

const gap = fc.constantFrom(" ", "  ", "\n", "\n    ", " /* note */ ", " // note\n", "\n\n");

// Plant: compare the bodies' source text, not their parsed trees.
it("property: a law whose body changes only in formatting or comments is no changed law, and a one-token change to its code is", () => {
  fc.assert(
    fc.property(
      fc.array(fc.tuple(fc.integer({ min: 0, max: 99 }), fc.constantFrom("a", "b", "c")), {
        minLength: 1,
        maxLength: 4,
      }),
      fc.array(gap, { minLength: 60, maxLength: 60 }),
      fc.boolean(),
      fc.option(fc.nat(), { nil: null }),
      (statements, gaps, single, edit) => {
        const all = statements.flatMap(([n, name]) => tokens(n, name));
        const at = edit === null ? -1 : (edit % statements.length) * 10 + 5;
        const changed = all.map((token, i) => (i === at ? String(Number(token) + 1) : token));

        const printed = changed
          .map((token) => (single && token === '"k"' ? "'k'" : token))
          .map((token, i) => `${token}${gaps[i % gaps.length] ?? " "}`)
          .join("");

        const plain = `it("a law", () => { ${all.join(" ")} });`;
        const laid = `it(\n  "a law",\n  () => {${gaps[0] ?? ""}${printed}\n  },\n);`;
        const before = lawsOf("next/a.test.ts", `import { it } from "@kampus/vitest";\n${plain}`);
        const after = lawsOf("next/a.test.ts", `import { it } from "@kampus/vitest";\n// moved\n\n${laid}`);
        expect(after.laws).toHaveLength(1);
        expect(after.laws[0]?.body === before.laws[0]?.body).toBe(edit === null);
        const outcome = check({ base: [before], head: [after], untouched: [] }, []);
        expect(outcome.refusals.map(named)).toEqual(edit === null ? [] : ["no_plant next/a.test.ts a law"]);
      },
    ),
    { ...options, numRuns: 100 },
  );
});

const law = fc.record({
  file: fc.constantFrom("next/a.test.ts", "oxlint-plugins/b,c.test.ts", ".agents/x:y.test.ts"),
  line: fc.integer({ min: 1, max: 500 }),
  title: fc.constantFrom("a law", "the log, read back"),
  body: fc.constant("[]"),
  plant: fc.option(fc.constantFrom(...PLANTS), { nil: null }),
});

const refusal: fc.Arbitrary<Refusal> = fc.oneof(
  law.map((l) => ({ _tag: "no_plant" as const, law: l })),
  law.map((l) => ({ _tag: "not_recorded" as const, law: l })),
  law.map((l) => ({ _tag: "green" as const, law: l })),
  fc.constantFrom(...PLANTS).map((plant) => ({
    _tag: "unclaimed" as const,
    row: "field/runs/2026-11-16-a.json",
    plant: { file: "next/a.test.ts", law: "a law", plant, result: "red" as const },
  })),
);

// Plant: print refusals as ::warning and exit 0.
it("property: the check prints one ::error per refusal at its file and line, one ::notice per notice, and exits 1 exactly when it refused", () => {
  fc.assert(
    fc.property(
      fc.array(refusal, { maxLength: 6 }),
      fc.uniqueArray(fc.constantFrom("next/a.test.ts", "next/b.test.ts", ".github/ci/c.test.ts")),
      (refusals, notices) => {
        const printed = report({ refusals, notices });
        const errors = printed.lines.filter((l) => l.startsWith("::error "));
        expect(errors).toHaveLength(refusals.length);
        expect(printed.lines.filter((l) => l.startsWith("::notice "))).toHaveLength(notices.length);
        expect(printed.lines).toHaveLength(refusals.length + notices.length);
        expect(printed.exitCode).toBe(refusals.length > 0 ? 1 : 0);
        refusals.forEach((r, i) => {
          const where = r._tag === "unclaimed" ? { file: r.row, line: 1 } : r.law;
          const escaped = where.file.replaceAll(":", "%3A").replaceAll(",", "%2C");
          expect(errors[i]?.startsWith(`::error file=${escaped},line=${where.line}::`)).toBe(true);
        });
      },
    ),
    { ...options, numRuns: 50, examples: [[[], ["next/a.test.ts"]]] },
  );
});

/** Runs git in `dir` and answers its output, failing the law on a refused command. */
const gitIn = (dir: string) => (args: string[]) => {
  const ran = spawnSync("git", ["-c", "user.name=law", "-c", "user.email=law@example.invalid", ...args], {
    cwd: dir,
    encoding: "utf8",
  });

  return { status: ran.status, stdout: ran.stdout };
};

// scenario: one rename through git, which a generator cannot make: git's own rename detection
// pairs the moved file with its old self, so its unchanged laws are no changed laws.
// Plant: read the pair as a delete and an add.
it("scenario: a law file moved with git mv keeps its laws, and its unchanged bodies give no refusal", () => {
  const dir = mkdtempSync(join(tmpdir(), "plant-check-"));

  try {
    const git = gitIn(dir);

    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };

    const old = "next/packages/libfabrika/src/ledger/LedgerTurnReads.test.ts";
    const moved = "next/packages/libfabrika/src/turns/TurnReads.test.ts";

    const text = [
      'import { it } from "@kampus/vitest";',
      ...[0, 1, 2].map((i) => `it("${titleOf(i)}", ${bodyOf(i)}, { plant: "${PLANTS[i] ?? ""}" });`),
    ].join("\n");

    git(["init", "-q", "-b", "main"]);
    write(old, `${text}\n`);
    git(["add", "."]);
    git(["commit", "-q", "-m", "base"]);
    const base = git(["rev-parse", "HEAD"]).stdout.trim();
    mkdirSync(dirname(join(dir, moved)), { recursive: true });
    expect(git(["mv", old, moved]).status).toBe(0);
    git(["commit", "-q", "-m", "move"]);
    const head = git(["rev-parse", "HEAD"]).stdout.trim();
    const inputs = readInputs(base, head, "push", git);
    expect(inputs.head.map((f) => [f.file, f.laws.length])).toEqual([[moved, 3]]);
    expect(check(inputs, inputs.rows)).toEqual({ refusals: [], notices: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// scenario: one history through git, since what is read at head outside the diff is git's answer: a
// row's record of a file the pull request leaves alone is read there, and its `it` decides it.
// Plant: read no record's file outside the diff (readInputs gives untouched: []).
it("scenario: a row's record of a law file the pull request does not change is read at head: on the package's it it is unclaimed, on another it or gone from head it is not read", () => {
  const dir = mkdtempSync(join(tmpdir(), "plant-check-"));

  try {
    const git = gitIn(dir);

    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };

    const law = (ours: boolean) => `${importOf(ours)}\nit("${titleOf(0)}", ${bodyOf(0)}, { plant: "${PLANTS[0]}" });\n`;
    git(["init", "-q", "-b", "main"]);
    write("next/a/Untouched.test.ts", law(true));
    write("next/a/Other.test.ts", law(false));
    git(["add", "."]);
    git(["commit", "-q", "-m", "base"]);
    const base = git(["rev-parse", "HEAD"]).stdout.trim();

    const plants = ["next/a/Untouched.test.ts", "next/a/Other.test.ts", "next/a/Gone.test.ts"].map((file) => ({
      file,
      law: titleOf(0),
      plant: PLANTS[0],
      result: "red",
    }));

    write("field/runs/2026-11-16-a-row.json", JSON.stringify({ plants }));
    git(["add", "."]);
    git(["commit", "-q", "-m", "row"]);
    const head = git(["rev-parse", "HEAD"]).stdout.trim();
    const inputs = readInputs(base, head, "push", git);
    expect(inputs.head).toEqual([]);
    expect(check(inputs, inputs.rows).refusals.map(named)).toEqual([
      `unclaimed next/a/Untouched.test.ts ${titleOf(0)}`,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
