import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Array as Arr, String as Str, pipe, Option } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { inScope, pick, PRODUCT, related } from "./scope.ts";

// Where the last dot sits, or -1 with none, as the native lastIndexOf answered.
const dot = (path: string) => Option.getOrElse(pipe(path, Str.lastIndexOf(".")), () => -1);

const options = { seed: 119120, numRuns: 200 };

// Script paths are built from their stems, so the script-reads lint does not take this file for a
// reader of the scripts it names: they are data here, never read.
const skill = (name: string, stem: string, end = ".ts") => `.agents/skills/${name}/scripts/${stem}${end}`;

const lead = (stem: string, end = ".ts") => skill("lead", stem, end);

const QUEST = Arr.flatMap(["chain", "drive"], (stem) => [lead(stem), lead(stem, ".test.ts")]);

const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/);

const ending = fc.constantFrom(
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".test.ts",
  ".test.tsx",
  ".d.ts",
  ".md",
  ".sh",
  ".py",
  ".json",
);

const file = fc.tuple(segment, ending).map(([name, end]) => `${name}${end}`);

/** Code outside `.agents/`: the folders that hold code today, any depth, any file. */
const product = fc
  .tuple(
    fc.constantFrom("apps", "packages", "programs", "next", "scripts", "oxlint-plugins", ".github", "fixtures", "docs"),
    fc.array(segment, { maxLength: 3 }),
    file,
  )
  .map(([top, folders, name]) => Arr.join([top, ...folders, name], "/"));

/** Lead tooling that is not quest code: any skill's files, and the lead's other scripts. */
const otherLead = fc.oneof(
  fc.tuple(segment, file).map(([name, file]) => `.agents/skills/${name === "lead" ? "leads" : name}/scripts/${file}`),
  file.map((name) => lead("", name)).filter((path) => !QUEST.includes(path)),
  fc.constantFrom(
    ".agents/skills/lead/SKILL.md",
    lead("mutbox"),
    lead("gc"),
    lead("quest"),
    lead("agents"),
    skill("mutation", "sample"),
    lead("flow"),
    lead("flowers/a"),
    lead("chain", ".tsx"),
    lead("chain", ".cleanup.test.ts"),
    ".agents/tsconfig.json",
  ),
);

/** Quest code: the chain and drive scripts and the flow runner's folder, with their tests. */
const quest = fc.oneof(
  fc.constantFrom(...QUEST),
  fc
    .tuple(fc.array(segment, { maxLength: 2 }), file)
    .map(([folders, name]) => Arr.join([".agents/skills/lead/scripts/flow", ...folders, name], "/")),
);

const leadCode = fc.oneof(quest, otherLead);

const anyPath = fc.oneof(product, quest, otherLead);

// The `range` step before 0089, read as git reads its pathspecs: `*` crosses `/`. For each changed
// product file its two test names, and each changed test, sorted and unique.
const before = (changed: ReadonlyArray<string>) => {
  const code = (path: string) =>
    /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path) &&
    !pipe(path, Str.includes(".test.")) &&
    !/\.d\.[mc]?ts$/.test(path);

  const tests = Arr.flatMap(changed, (path) =>
    code(path)
      ? Arr.map([".test.ts", ".test.tsx"], (end) => `${pipe(path, Str.slice(0, dot(path)))}${end}`)
      : /\.test\.tsx?$/.test(path)
        ? [path]
        : [],
  );

  return [...new Set(tests)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
};

describe("the mutation run's file pick (0089)", () => {
  it("property: product code is picked as before 0089, whatever lead tooling sits beside it", () => {
    fc.assert(
      fc.property(fc.array(product, { maxLength: 12 }), fc.array(otherLead, { maxLength: 6 }), (code, lead) => {
        expect(pick(code)).toEqual(code);
        expect(related(code)).toEqual(before(code));
        expect(related([...lead, ...code, ...lead])).toEqual(before(code));
      }),
      options,
    );
  });

  it("property: quest code is in, and its tests are picked as product code's are", () => {
    fc.assert(
      fc.property(
        fc.array(quest, { minLength: 1, maxLength: 8 }),
        fc.array(fc.oneof(product, otherLead), { maxLength: 8 }),
        (ours, rest) => {
          const changed = [...rest, ...ours];
          expect(Arr.filter(pick(changed), (path) => pipe(path, Str.startsWith(".agents/")))).toEqual(
            Arr.filter(changed, (path) => pipe(path, Str.startsWith(".agents/")) && ours.includes(path)),
          );

          for (const test of before(ours)) {
            expect(related(changed)).toContain(test);
          }
        },
      ),
      options,
    );
  });

  it("property: every other lead script, shell helper and skill text is out, and so are its tests", () => {
    fc.assert(
      fc.property(fc.array(otherLead, { maxLength: 12 }), (lead) => {
        expect(pick(lead)).toEqual([]);
        expect(related(lead)).toEqual([]);
      }),
      options,
    );
  });

  it("property: a lead `.ts` file's `name.test.ts` is in exactly when the file is", () => {
    fc.assert(
      fc.property(
        leadCode.filter((path) => pipe(path, Str.endsWith(".ts"))),
        (path) => {
          const code = Arr.filter(before([path]), (test) => pipe(test, Str.endsWith(".test.ts")) && test !== path);

          for (const test of code) {
            expect(inScope(test), test).toBe(inScope(path));
          }
        },
      ),
      options,
    );
  });

  it("property: the pick keeps order and never adds a path", () => {
    fc.assert(
      fc.property(fc.array(anyPath, { maxLength: 16 }), (changed) => {
        const kept = pick(changed);
        expect(kept).toEqual(Arr.filter(changed, (path) => kept.includes(path)));
        expect(related(changed)).toEqual(related(kept));
      }),
      options,
    );
  });

  it.each([
    // vector: `.agents/` counts only at the top of the repo.
    [`apps/x/${lead("gc")}`, true],
    // vector: the flow runner is a folder; files named like it beside it are out.
    [lead("flow/machine"), true],
    [lead("flow/flows/land-decision"), true],
    [lead("flow"), false],
    [lead("flowers/a"), false],
    // vector: the chain and drive scripts only in the lead skill, by their exact names.
    [skill("mutation", "chain"), false],
    [lead("chain", ".cleanup.test.ts"), false],
    [lead("drive", ".tsx"), false],
    // vector: 0089's out list by name.
    [lead("mutbox"), false],
    [lead("gc"), false],
    [lead("quest"), false],
    [lead("agents"), false],
    [skill("mutation", "sample"), false],
    [lead("box", ".sh"), false],
    [".agents/skills/lead/SKILL.md", false],
  ])("%s in scope: %s", (path, expected) => {
    expect(inScope(path)).toBe(expected);
  });

  it("pinned: the sample script's pathspec is the list it held before 0089 moved it here", () => {
    expect(PRODUCT).toEqual([
      "*.ts",
      "*.tsx",
      "*.mts",
      "*.cts",
      "*.js",
      "*.jsx",
      "*.mjs",
      "*.cjs",
      ":!*.test.*",
      ":!*.d.ts",
      ":!*.d.mts",
      ":!*.d.cts",
    ]);
  });
});

// Slice 2 of docs/plan/quests/kalfa-quality-stryker-PLAN.md (decision 0600): the hourly run reaches libfabrika's
// laws. A changed product file `d/s.ts` also picks each tracked `d/s.<kind>.test.ts(x)`, its kind
// siblings, since 61 of libfabrika's product files have only those. The run hands `related` the head's
// file list as `tracked`; with none, the pick is exactly today's.

/** A word of a kind sibling's name: letters, digits and dashes. */
const kindWord = fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/);

/** The kinds that name a test no hourly run can use: a type law kills no mutant, a window needs a display. */
const OUT = ["types", "visual"] as const;

const kinds = fc.array(
  fc.oneof({ weight: 4, arbitrary: kindWord }, { weight: 1, arbitrary: fc.constantFrom(...OUT) }),
  {
    minLength: 1,
    maxLength: 3,
  },
);

const code = fc.constantFrom(".ts", ".tsx", ".mjs", ".cjs");

const testEnd = fc.constantFrom(".test.ts", ".test.tsx");

/** Whether a path is a product file by the pick's own rule (a code extension, no `.test.`, no declaration). */
const isProduct = (path: string) =>
  /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path) && !path.includes(".test.") && !/\.d\.[mc]?ts$/.test(path);

/** A changed product file: a code folder, any depth, and a plain name with a code extension. */
const productFile = fc
  .tuple(
    fc.constantFrom("apps", "packages", "programs", "next", "scripts", "oxlint-plugins", ".github"),
    fc.array(segment, { maxLength: 3 }),
    segment,
    code,
  )
  .map(([top, folders, name, ext]) => [top, ...folders, `${name}${ext}`].join("/"));

/** The sibling rule, said again from the plan: the stem, a dot, one or more kind words with dots, then `.test.ts(x)`. */
const isSibling = (changed: string, tracked: string) => {
  const stem = changed.slice(0, changed.lastIndexOf("."));
  const rest = tracked.startsWith(`${stem}.`) ? tracked.slice(stem.length + 1) : "";
  const match = /^((?:[A-Za-z0-9-]+\.)+)test\.tsx?$/.exec(rest);

  return (
    match !== null &&
    !(match[1] ?? "")
      .slice(0, -1)
      .split(".")
      .some((word) => OUT.some((out) => out === word))
  );
};

describe("kind siblings join the hourly pick (decision 0600, slice 2)", () => {
  // Plant: match the stem as a prefix without its dot, so `runtime-recovery.laws.integration.test.ts` is picked for `runtime.ts`.
  it("property: Q16 a changed product file picks its tracked kind siblings, and nothing that only starts like it", () => {
    fc.assert(
      fc.property(
        fc.array(productFile, { minLength: 1, maxLength: 4 }),
        fc.array(fc.tuple(kinds, testEnd), { minLength: 1, maxLength: 4 }),
        fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }),
        fc.array(otherLead, { maxLength: 2 }),
        (files, endings, tracks, lead) => {
          const changed = [...files, ...lead];
          const candidates: Array<string> = [];

          for (const path of changed) {
            const stem = path.slice(0, path.lastIndexOf("."));
            const folder = stem.slice(0, stem.lastIndexOf("/") + 1);
            const name = stem.slice(stem.lastIndexOf("/") + 1);

            for (const [list, end] of endings) {
              candidates.push(
                // A sibling, in every kind.
                `${stem}.${list.join(".")}${end}`,
                // Decoys: the stem only as a prefix, another folder, no `.test`, another extension, a kind that is no word.
                `${stem}-x.${list.join(".")}${end}`,
                `${folder}${name}x.${list.join(".")}${end}`,
                `other/${stem}.${list.join(".")}${end}`,
                `${stem}.${list.join(".")}.ts`,
                `${stem}.${list.join(".")}${end.replace(".ts", ".js")}`,
                `${stem}.a b.laws${end}`,
              );
            }

            candidates.push(`${stem}.test.ts`, `${stem}.test.tsx`);
          }

          // Some are tracked and some are not; a changed test file stays itself.
          const tracked = candidates.filter((_, i) => tracks[i % tracks.length]);
          const picked = related(changed, tracked);

          const siblings = tracked.filter((t) =>
            // lead tooling out of scope has no siblings picked (0089: a test of an out-of-scope file is out).
            pick(changed).some((c) => isProduct(c) && isSibling(c, t)),
          );

          expect(picked).toEqual(
            [...new Set([...before(pick(changed)), ...siblings])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
          );
          // With no list, or an empty one, the pick is exactly what it was.
          expect(related(changed)).toEqual(before(pick(changed)));
          expect(related(changed, [])).toEqual(before(pick(changed)));
        },
      ),
      options,
    );
  });

  // vector: real names of libfabrika's tests (next/packages/libfabrika/src/cloudflare and runtime).
  it("vector: runtime.ts picks runtime.laws.test.ts and its integration sibling, not runtime-recovery's, a type law or a window", () => {
    const dir = "next/packages/libfabrika/src/cloudflare";

    const tracked = [
      `${dir}/runtime.test.ts`,
      `${dir}/runtime.laws.test.ts`,
      `${dir}/runtime.laws.integration.test.ts`,
      `${dir}/runtime.integration.test.ts`,
      `${dir}/runtime-recovery.laws.integration.test.ts`,
      `${dir}/runtime.types.test.ts`,
      `${dir}/runtime.visual.test.tsx`,
      `${dir}/runtimes.laws.test.ts`,
      `${dir}/runtime.ts`,
    ];

    expect(related([`${dir}/runtime.ts`], tracked)).toEqual([
      `${dir}/runtime.integration.test.ts`,
      `${dir}/runtime.laws.integration.test.ts`,
      `${dir}/runtime.laws.test.ts`,
      // Today's pick, tracked or not: whether each exists at head is the workflow's check.
      `${dir}/runtime.test.ts`,
      `${dir}/runtime.test.tsx`,
    ]);
  });

  // Plant: drop `--tracked` from the step, or write the list after the pick.
  it("scenario: Q17 the workflow's range step lists the head's files and hands them to the pick, before the existence check", () => {
    const workflow = parse(
      readFileSync(join(import.meta.dirname, "../../../../.github/workflows/mutation.yaml"), "utf8"),
    );

    const steps: ReadonlyArray<{ id?: string; run?: string }> = workflow.jobs.mutation.steps;
    const lines = (steps.find((step) => step.id === "range")?.run ?? "").split("\n");
    const at = (pattern: RegExp) => lines.findIndex((line) => pattern.test(line));

    const list = at(/^\s*git ls-tree -r --name-only "\$head" > (\S+)\s*$/);
    const scope = at(/^\s*node \.agents\/skills\/mutation\/scripts\/scope\.ts --tracked (\S+) </);
    const exists = at(/git cat-file -e/);

    expect([list >= 0, scope >= 0, exists >= 0]).toEqual([true, true, true]);
    expect(list).toBeLessThan(scope);
    expect(scope).toBeLessThan(exists);
    // The file the list is written to is the file the pick reads.
    expect(/> (\S+)\s*$/.exec(lines[list] ?? "")?.[1]).toBe(/--tracked (\S+)/.exec(lines[scope] ?? "")?.[1]);
  });
});
