// `fabrika/no-run-rerun`, R10 of the sev runbooks plan (0542, 0611). The config turns the rule on for
// `.agents/skills/**` alone, so both laws plant their files through `plant.ts` with the repo's own
// `.oxlintrc.json`, one oxlint run per law: the refused shapes at drawn paths under `.agents/skills/`
// (law 1, with the plan's fixture), and the same shapes outside that folder (law 2). `plant.ts` writes
// into a temp folder, so nothing is written inside the repo.
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { plant } from "./plant.ts";

const RUNS = { seed: 119120, numRuns: 100 };

const CODE = "fabrika(no-run-rerun)";

/** A line of a planted file, and whether the rule must fire on it. */
interface Line {
  readonly text: string;
  readonly refused: boolean;
}

/** A drawn file: its folder, a name and its lines in order. */
interface Sample {
  readonly folder: string;
  readonly name: string;
  readonly lines: ReadonlyArray<Line>;
}

const id = fc.integer({ min: 1, max: 999 });

const owner = fc.constantFrom("runs", "api", "client", "gh");

const word = fc.constantFrom("FailedJobs", "Job", "Workflow", "Run");

const segment = fc.constantFrom("runs", "jobs");

const tail = fc.constantFrom("rerun", "rerun-failed-jobs");

// Each refused shape, drawn as one line of code. A template line holds its drawn number in a `${}` of
// the planted text, so the planted file has a real template with an interpolation.
const REFUSED: ReadonlyArray<fc.Arbitrary<string>> = [
  // (a) a call of `rerun`, of a member named `rerun`, of `["rerun"]`, of `?.rerun`, and of a name that
  // starts `rerun` and then an upper-case letter.
  fc.tuple(id).map(([n]) => `rerun(${n});`),
  fc.tuple(owner, id).map(([o, n]) => `${o}.rerun(${n});`),
  fc.tuple(owner, id).map(([o, n]) => `${o}["rerun"](${n});`),
  fc.tuple(owner, id).map(([o, n]) => `${o}?.rerun(${n});`),
  fc.tuple(owner, word, id).map(([o, w, n]) => `${o}.rerun${w}(${n});`),
  fc.tuple(word, id).map(([w, n]) => `rerun${w}(${n});`),
  // (b) an API path with `/rerun` or `/rerun-failed-jobs`, as a string and as a template whose
  // numeric run id is one of its `${}` parts.
  fc.tuple(segment, id, tail).map(([s, n, t]) => `api("repos/o/r/actions/${s}/${n}/${t}");`),
  fc.tuple(segment, id, tail).map(([s, n, t]) => `api(\`repos/o/r/actions/${s}/\${${n}}/${t}\`);`),
  // (c) the gh words `run rerun`, as a string and as a template.
  fc.tuple(id).map(([n]) => `sh("gh run rerun ${n}");`),
  fc.tuple(id).map(([n]) => `sh(\`gh run rerun \${${n}}\`);`),
  // (d) argv split into strings, in an array and in a call's arguments.
  fc.tuple(id).map(([n]) => `["run", "rerun", ${n}];`),
  fc.tuple(id).map(([n]) => `Command.make("gh", "run", "rerun", ${n});`),
];

// Lines the rule must leave alone: prose, a test title, a note, a comment, an identifier that is not
// called, a name that only looks like the word, and argv that does not hold `run` then `rerun`.
const PASSING: ReadonlyArray<fc.Arbitrary<string>> = [
  fc.constant(`({ note: "rerun" });`),
  fc.constant(`({ note: "answer: send mutation rerun it" });`),
  fc.constant(`({ action: "run", note: "rerun" });`),
  fc.constant(`it("never reruns a run", () => {});`),
  fc.constant(`it("rerun it", () => {});`),
  fc.constant(`["rerun", 1];`),
  fc.constant(`["run", "list", "rerun"];`),
  fc.constant(`sh("gh run list");`),
  fc.constant(`api("gh run rerunning");`),
  fc.tuple(id).map(([n]) => `// gh run rerun ${n} is what the old sev ran`),
  fc.tuple(id).map(([n]) => `/* rerun(${n}); */`),
  fc.constant(`{ const rerun = 1; }`),
  fc.tuple(owner).map(([o]) => `${o}.rerun;`),
  fc.tuple(id).map(([n]) => `verifyDepsBeforeRun(${n});`),
  fc.tuple(id).map(([n]) => `verifyRerun(${n});`),
  fc.tuple(id).map(([n]) => `rerunner(${n});`),
  fc.tuple(segment, id).map(([s, n]) => `api("repos/o/r/actions/${s}/${n}/rerunning");`),
];

const line: fc.Arbitrary<Line> = fc.oneof(
  fc.oneof(...REFUSED).map((text): Line => ({ text, refused: true })),
  fc.oneof(...PASSING).map((text): Line => ({ text, refused: false })),
);

const sample = (folders: fc.Arbitrary<string>): fc.Arbitrary<Sample> =>
  fc.record({
    folder: folders,
    name: fc.stringMatching(/^[a-z]{3,8}$/),
    lines: fc.array(line, { minLength: 1, maxLength: 10 }),
  });

/**
 * Each drawn sample as two files, `.ts` and `.test.ts`, at paths that differ by the sample's index so
 * no two collide. `expected` holds the lines each path must fire on: the refused lines, by their number.
 */
const planted = (samples: ReadonlyArray<Sample>) => {
  const files: Record<string, string> = {};
  const expected: Array<readonly [string, ReadonlyArray<number>]> = [];

  samples.forEach(({ folder, name, lines }, i) => {
    const text = `${lines.map((l) => l.text).join("\n")}\n`;
    const fires = lines.flatMap((l, k) => (l.refused ? [k + 1] : []));

    for (const extension of ["ts", "test.ts"]) {
      const path = `${folder}/${name}-${i}.${extension}`;

      files[path] = text;
      expected.push([path, fires]);
    }
  });

  return { files, expected };
};

const SKILL_FOLDERS = fc
  .constantFrom("sev", "lead", "mutation", "pr")
  .map((skill) => `.agents/skills/${skill}/scripts`);

// A fixed example with its reason: the plan's R10 plant, a `gh run rerun` in a string in a sev test
// fixture. Line 1 is a comment, so the string is on line 2.
const FIXTURE = ".agents/skills/sev/scripts/fixture.test.ts";

const FIXTURE_TEXT = `// A sev test fixture: the gh call below is the one the rule refuses.\nconst cmd = "gh run rerun 123";\n`;

describe("law 1: under .agents/skills/, a refused line fires on its own line and a passing line never does", async () => {
  const { files, expected } = planted(fc.sample(sample(SKILL_FOLDERS), RUNS));
  const linted = await plant({ ...files, [FIXTURE]: FIXTURE_TEXT });

  it("property: each drawn file under .agents/skills/ fires on exactly its refused lines, at its .ts and .test.ts paths alike", () => {
    fc.assert(
      fc.property(fc.constantFrom(...expected), ([path, fires]) => {
        expect(linted(CODE, path), path).toEqual(fires);
      }),
      { ...RUNS, numRuns: expected.length, examples: expected.map((entry) => [entry]) },
    );
  });

  it("vector: a sev test fixture with `gh run rerun` in a string fires on its line 2, the plan's R10 plant", () => {
    expect(linted(CODE, FIXTURE)).toEqual([2]);
  });
});

// The config's block names `.agents/skills/**` alone, so the same shapes elsewhere must pass. Not
// `oxlint-plugins/`: `plant.ts` links that real folder into its temp home, so a file there would be
// written into the repo.
const OUTSIDE_FOLDERS = fc.constantFrom("next/packages/x/src", ".github/ci", "scripts", "docs/tutorials", ".agents");

describe("law 2: the same shapes outside .agents/skills/ fire on nothing, since the config's block is .agents/skills/** alone", async () => {
  const { files, expected } = planted(fc.sample(sample(OUTSIDE_FOLDERS), RUNS));
  const linted = await plant(files);

  it("property: each drawn file outside .agents/skills/ fires on none of its lines, the refused ones included", () => {
    fc.assert(
      fc.property(fc.constantFrom(...expected), ([path]) => {
        expect(linted(CODE, path), path).toEqual([]);
      }),
      { ...RUNS, numRuns: expected.length, examples: expected.map((entry) => [entry]) },
    );
  });
});
