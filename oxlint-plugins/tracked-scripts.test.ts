// S1 of docs/plan/quests/port-scripts-0113-PLAN.md: the lint hold on 0113. The check is the only
// thing holding the rule, so each law runs `check` on generated tracked paths and file heads in
// memory: no git, no process, no temp folder. `pnpm lint` runs the same function over this repo's
// real `git ls-files`, so the repo's own state is held there.
//
// Each law was planted once (the check changed to break it, the law seen red) and restored by copy;
// the plant is named beside it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { check, line, NOT_YET_PORTED } from "./tracked-scripts.ts";

const ROOT = join(import.meta.dirname, "..");
const runs = { seed: 119120, numRuns: 50 };

/** Every listed script, tracked, so the list itself adds no finding. */
const LISTED = [...NOT_YET_PORTED];

/** Heads keyed by path; a path with no head reads as an empty file. */
const reader =
  (heads: Readonly<Record<string, string>>) =>
  (path: string): string =>
    heads[path] ?? "";

/** A folder and a file name under it, never one of the listed paths. */
const base = fc
  .tuple(fc.array(fc.stringMatching(/^[a-z0-9_-]{1,8}$/), { maxLength: 3 }), fc.stringMatching(/^[a-z0-9_-]{1,10}$/))
  .map(([folders, name]) => [...folders, name].join("/"));

/** Lines a script may start with that never mean to be an edge line: `:` is never drawn. */
const plainHead = fc
  .array(fc.stringMatching(/^[a-z #!/=.-]{0,24}$/), { maxLength: 8 })
  .map((lines) => ["#!/bin/sh", ...lines].join("\n"));

describe("a tracked shell or Python file", () => {
  // Plant, run once: `SCRIPT` became /\.sh$/, so the check skips `.py`. Red: a `.py` path gave no
  // finding.
  it("that is not listed and has no edge line fails lint, and names the file", () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(
        base,
        fc.constantFrom(".sh", ".py"),
        fc.constantFrom(".ts", ".md", ".shx", ".pyc", ".sh.txt", ""),
        plainHead,
        (path, extension, other, text) => {
          const script = `${path}${extension}`;
          const sibling = `${path}${other}`;
          fc.pre(!LISTED.includes(script));
          reached.add(extension);
          const findings = check([...LISTED, script, sibling], reader({ [script]: text, [sibling]: text }));
          expect(findings).toEqual([{ _tag: "new_script", path: script }]);
          expect(findings.map(line).join("\n")).toContain(script);
        },
      ),
      runs,
    );
    expect([...reached].toSorted()).toEqual([".py", ".sh"]);
  });
});

describe("the NOT_YET_PORTED list", () => {
  // Plant, run once: the stale entries dropped from `check`'s result. Red: a listed path git no
  // longer tracks gave no finding.
  it("a listed file that git does not track fails lint as a stale entry", () => {
    let stale = 0;
    fc.assert(
      fc.property(fc.subarray(LISTED), (kept) => {
        const gone = LISTED.filter((path) => !kept.includes(path));
        stale += gone.length;
        const findings = check([...kept, "README.md"], reader({}));
        expect(findings).toEqual(gone.map((path) => ({ _tag: "stale_entry", path })));
        expect(findings.map(line).join("\n")).toEqual(expect.stringContaining(gone[0] ?? ""));
      }),
      runs,
    );
    expect(stale).toBeGreaterThan(0);
  });

  // The 16 scripts the plan names (its "What is there today" table and scripts/typecheck.sh): the
  // list may lose lines as ports land, never gain one (0113's binding constraint).
  const PLANNED = [
    ".agents/skills/lead/scripts/box.sh",
    ".agents/skills/lead/scripts/env.sh",
    ".agents/skills/lead/scripts/fieldrow.py",
    ".agents/skills/lead/scripts/governance.sh",
    ".agents/skills/lead/scripts/keepruns.sh",
    ".agents/skills/lead/scripts/leakgrep.sh",
    ".agents/skills/lead/scripts/loosening.sh",
    ".agents/skills/lead/scripts/mutbox-entry.sh",
    ".agents/skills/lead/scripts/redact.sh",
    ".agents/skills/lead/scripts/runplan.sh",
    ".agents/skills/lead/scripts/skillscheck.sh",
    ".agents/skills/mutation/scripts/run.sh",
    ".agents/skills/plan/scripts/plancheck.sh",
    ".agents/skills/step-commit/scripts/exam.py",
    ".agents/skills/step-commit/scripts/stepcommit.sh",
    "scripts/typecheck.sh",
  ];

  // Plant, run once: a 17th entry, `.agents/skills/lead/scripts/catchup.sh`, added to the list. Red:
  // the entry is not one of the 16.
  it("pinned: the list only shrinks, so every entry is one of the 16 scripts the plan names, once", () => {
    expect(PLANNED).toEqual(expect.arrayContaining(LISTED));
    expect(new Set(LISTED).size).toBe(LISTED.length);
  });
});

describe("an edge line", () => {
  const APT = ".github/ci/apt.sh";
  const apt = readFileSync(join(ROOT, APT), "utf8");

  // .github/ci/apt.sh is 0113's one lasting edge: it is on no list, so its edge line alone passes it,
  // and the same file without that line fails.
  it("scenario: apt.sh passes by its edge line alone", () => {
    expect(LISTED).not.toContain(APT);
    expect(check([...LISTED, APT], reader({ [APT]: apt }))).toEqual([]);
    const bare = apt
      .split("\n")
      .filter((text) => !/^#\s*edge:/.test(text))
      .join("\n");
    expect(check([...LISTED, APT], reader({ [APT]: bare }))).toEqual([{ _tag: "new_script", path: APT }]);
  });

  // Plant, run once: `check` read a line as an edge on `# edge:` alone, with no reason. Red: an empty
  // or blank reason passed.
  it("passes with a reason and `(0113)` in the first five lines, and fails without either", () => {
    let blank = 0;
    let said = 0;
    const reason = fc.oneof(fc.constantFrom("", " ", "\t", "  "), fc.string({ maxLength: 40 }));
    fc.assert(
      fc.property(
        base,
        reason.filter((text) => !text.includes("\n")),
        fc.integer({ min: 0, max: 3 }),
        (path, why, at) => {
          const script = `${path}.sh`;
          fc.pre(!LISTED.includes(script));
          const above = Array.from({ length: at }, (_, i) => `# line ${i}`);
          const head = (edge: string) => reader({ [script]: ["#!/bin/sh", ...above, edge, "echo hi"].join("\n") });
          const result = (edge: string) => check([...LISTED, script], head(edge)).map((found) => found.path);
          const gives = /\S/.test(why);
          blank += gives ? 0 : 1;
          said += gives ? 1 : 0;
          expect(result(`# edge: ${why} (0113)`)).toEqual(gives ? [] : [script]);

          if (!why.trimEnd().endsWith("(0113)")) {
            expect(result(`# edge: ${why}`)).toEqual([script]);
          }

          // Past the first five lines it is not seen.
          const late = reader({
            [script]: ["#!/bin/sh", "#", "#", "#", "#", `# edge: reason${why} (0113)`].join("\n"),
          });
          expect(check([...LISTED, script], late).map((found) => found.path)).toEqual([script]);
        },
      ),
      runs,
    );
    expect(blank).toBeGreaterThan(0);
    expect(said).toBeGreaterThan(0);
  });
});
