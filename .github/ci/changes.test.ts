import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { checkTracked } from "../../oxlint-plugins/gitignore.mjs";
import * as ci from "./changes.mjs";

// Today's CI, both versions. Covers changes.mjs and the shared gitignore.mjs.
// Red baseline adapters are preserved in the first T342 tests commit. These laws
// now import the implementation directly, so deleting it cannot bypass a check.
// T342 source plants, all caught: PR skips on main, all Markdown safe, broad
// packages prefix, any-match skips, every next path skips test, newline splitting,
// and ignored diff failure. The broad-prefix plant first survived mixed lists;
// checking each shared path alone closed that gap. Shared-check plants accepting
// hidden tracked files or failed Git output both failed the tracked-file law.
const options = { seed: 119120, numRuns: 100 };
// T375 plants caught: skill readTrees and shared scripts at the red baseline;
// script Markdown counted as prose, scripts skipping test, all Markdown safe,
// prose masking shared paths, and every skill-tree path counted as prose.
const heavy = { check: true, typecheck: true, next: true };
type Runner = (args: string[]) => { status: number | null; stdout: string };
const word = fc.stringMatching(/^[a-z][a-z0-9_-]{0,12}$/);

// Decision 0090: a new row is its own file in a log's folder, as safe as a line in the old file.
const logs = fc.constantFrom("notes", "runs", "findings");

const safe = fc.oneof(
  word.map((s) => `field/${s}.jsonl`),
  fc.tuple(logs, word).map(([log, s]) => `field/${log}/2026-11-11-${s}.json`),
  word.map((s) => `docs/${s}.md`),
  word.map((s) => `field/${s}.md`),
);

const today = fc
  .tuple(fc.constantFrom("apps", "programs", "packs", "wip", "legacy", "packages/fabrika"), word)
  .map(([dir, s]) => `${dir}/${s}.ts`);

const next = word.map((s) => `next/packages/libfabrika/src/${s}.ts`);

const shared = fc.oneof(
  word.map((s) => `unknown/${s}`),
  fc.constantFrom(
    "packages/fabrika-design/src/colors.ts",
    "packages-other/file.ts",
    "nextish/file.ts",
    ".claude/skills/tests/SKILL.md",
    "pnpm-lock.yaml",
    "field/nested/a.jsonl",
    "tools/field/a.jsonl",
    "field/a.jsonl.ts",
    "field/other/2026-11-11-a.json",
    "tools/field/runs/2026-11-11-a.json",
  ),
);

const skillName = fc
  .stringMatching(/^[a-z]{1,12}$/)
  // Brief/prompt folders belong to readMarkdown's heavy-path family below.
  .filter((s) => !["brief", "briefs", "prompt", "prompts", "scripts"].includes(s));

const prose = fc.oneof(
  fc
    .tuple(skillName, fc.array(skillName, { maxLength: 2 }), skillName)
    .map(([skill, dirs, name]) => [".agents/skills", skill, ...dirs, `${name}.md`].join("/")),
  skillName.map((skill) => `.claude/skills/${skill}`),
);

const script = fc
  .tuple(
    fc.constantFrom("lead", "mutation", "plan", "step-commit"),
    skillName,
    fc.constantFrom("sh", "py", "mjs", "ts", "json"),
  )
  .map(([skill, name, ext]) => `.agents/skills/${skill}/scripts/${name}.${ext}`);

// The two arms of a skill-tree path that is no script and no prose. The plan for CI paths
// (slice 1, case 4) splits them: a file under .agents/skills/ no longer starts next, and one under
// .claude/skills/<name>/ still runs everything.
const agentsSkill = fc
  .tuple(skillName, fc.array(skillName, { maxLength: 2 }), skillName, fc.constantFrom("json", "ts", "txt"))
  .map(([skill, dirs, name, ext]) => [".agents/skills", skill, ...dirs, `${name}.${ext}`].join("/"));

const claudeSkill = fc
  .tuple(skillName, skillName, fc.constantFrom("md", "json", "ts"))
  .map(([skill, name, ext]) => `.claude/skills/${skill}/${name}.${ext}`);

const otherSkill = fc.oneof(agentsSkill, claudeSkill);

const path = fc.oneof(
  safe,
  today,
  next,
  shared,
  prose,
  script,
  otherSkill,
  fc.string({ minLength: 1 }).map((s) => `unusual/${s}`),
);

const list = fc.array(path, { maxLength: 12 });

// 0175: a file of today's version, written apart from changes.mjs. Only these start today's build,
// on every event; its tests and e2e start on none (0525, 0533). No generator above makes a quiet path,
// plain Markdown or a field row, under these trees; the scenario near the end pins that case.
const todays = (p: string) => /^(?:apps|programs|packs|wip|legacy|packages|fixtures)\//.test(p);
const touched = (paths: readonly string[]) => paths.some(todays);

// 0174 narrowed this law: a merge queue's group left it, and follows its paths (below).
// 0175 narrowed it again: a push to main left it too. What stays is every event that has no
// changed paths of its own to read.
it("every event that is no pull request, merge queue's group or push enables every job for every path list", () => {
  fc.assert(
    fc.property(list, fc.constantFrom("workflow_dispatch", "schedule", ""), (paths, event) => {
      expect(ci.classify(paths, event)).toEqual({ ...heavy, field: true, build: true });
    }),
    options,
  );
});

// 0174: a merge queue's run starts only the checks its changed files need. 0175: so does a push.
it("property: a merge queue's group and a push get the flags a pull request gets for the same paths", () => {
  fc.assert(
    fc.property(fc.option(list, { nil: null }), fc.constantFrom("merge_group", "push"), (paths, event) => {
      expect(ci.classify(paths, event)).toEqual(ci.classify(paths, "pull_request"));
    }),
    {
      ...options,
      examples: [
        // pinned: Markdown alone, the one-file decision that started 18 of 18 jobs in the queue.
        [[".decisions/0174-a-queue-run-follows-its-paths.md"], "merge_group"],
        // pinned: the same decision file as a push to main, which started every job after its merge.
        [[".decisions/0174-a-queue-run-follows-its-paths.md"], "push"],
        // pinned: next/ alone, where a pull request skips the build.
        [["next/packages/libfabrika/src/a.ts"], "push"],
      ],
    },
  );
});

it("scenario: a merge queue's group of Markdown skips the heavy jobs, and one of next/ files runs check and next", () => {
  // scenario: the two cases named in 0174, written out so the flags are read here and not only
  // compared with a pull request's.
  const quiet = { check: false, typecheck: false, next: false, field: false, build: false };
  expect(ci.jobs(["docs/a.md"], "merge_group", false)).toEqual(quiet);
  // 0175: the build is today's library, so a group of next/ files alone no longer builds.
  expect(ci.jobs(["next/packages/libfabrika/src/a.ts"], "merge_group", false)).toEqual({
    ...heavy,
    field: false,
    build: false,
  });
});

it("skill prose and safe paths skip heavy jobs; field follows rows", () => {
  fc.assert(
    fc.property(fc.array(fc.oneof(safe, prose), { minLength: 1, maxLength: 12 }), (paths) => {
      expect(ci.classify(paths, "pull_request")).toEqual({
        check: false,
        typecheck: false,
        next: false,
        field: paths.some((p) => /^field\/[^/]+\.jsonl$/.test(p) || /^field\/(?:notes|runs|findings)\//.test(p)),
        build: false,
      });
    }),
    options,
  );
});

it("skill scripts run check and typecheck; other version flags follow their readers", () => {
  fc.assert(
    fc.property(
      fc.array(script, { minLength: 1, maxLength: 12 }),
      fc.array(fc.oneof(today, next), { maxLength: 12 }),
      (scripts, others) => {
        expect(ci.classify(scripts, "pull_request")).toEqual({
          ...heavy,
          next: false,
          field: false,
          build: false,
        });
        // A Markdown file beside a script is still script input, even though prose is quiet.
        expect(
          ci.classify(
            scripts.map((path) => path.replace(/\.[^.]+$/, ".md")),
            "pull_request",
          ),
        ).toEqual({ ...heavy, next: false, field: false, build: false });
        const flags = ci.classify([...scripts, ...others], "pull_request");
        expect(flags).toEqual({
          check: true,
          typecheck: true,
          next: others.some((p) => p.startsWith("next/")),
          field: false,
          build: others.some((p) => !p.startsWith("next/")),
        });
      },
    ),
    options,
  );
});

// 0175 narrowed this law: the build is today's library, so a skill-tree path no longer starts it.
// The plan for CI paths narrowed it again, with the owner's yes (its answered question 2): a file
// under .agents/skills/ no longer starts next, since no next/ test reads one, so this law says
// nothing of next for a list of those alone (the case 4 law below does). Next still starts when a
// .claude/skills/<name>/ file is in the list.
it("other skill-tree paths still run check and typecheck, next only for .claude/skills/, and none of today's checks", () => {
  fc.assert(
    fc.property(fc.array(otherSkill, { minLength: 1, maxLength: 12 }), (paths) => {
      expect(ci.classify(paths, "pull_request")).toMatchObject({
        check: true,
        typecheck: true,
        ...(paths.some((p) => p.startsWith(".claude/skills/")) ? { next: true } : {}),
        build: false,
      });
    }),
    options,
  );
});

// Plan change, 2026-11-09: only paths no check reads are safe. Markdown under these trees, or
// in any brief or prompt folder, is read by a program (a brief is an agent's input; a fixture is
// a test's input), so it runs every check. Plant caught: the old "every .md outside the skill
// trees is safe" rule, which skipped programs/pipeline/briefs/x.md and fixtures/a/b.md.
const folder = fc.constantFrom("brief", "briefs", "prompt", "prompts");

const readMarkdown = fc.oneof(
  fc
    .tuple(fc.constantFrom("programs", "fixtures", "packages", "next"), fc.array(word, { maxLength: 3 }), word)
    .map(([root, dirs, name]) => [root, ...dirs, `${name}.md`].join("/")),
  fc
    .tuple(fc.array(word, { maxLength: 3 }), folder, fc.array(word, { maxLength: 2 }), word)
    .map(([above, dir, below, name]) => [...above, dir, ...below, `${name}.md`].join("/")),
);

// 0175 narrowed this law: today's build starts only when the Markdown is under today's trees.
it("Markdown a check reads runs check, typecheck and next, alone or beside safe paths, and today's build by its tree", () => {
  fc.assert(
    fc.property(readMarkdown, fc.array(safe, { maxLength: 6 }), (read, paths) => {
      const expected = { ...heavy, build: todays(read) };
      expect(ci.classify([read], "pull_request")).toMatchObject(expected);
      expect(ci.classify([...paths, read], "pull_request")).toMatchObject(expected);
    }),
    {
      ...options,
      examples: [
        // pinned: review of PR 578, a brief-only PR skipped every check.
        ["programs/pipeline/briefs/x.md", []],
        // pinned: review of PR 578, a fixture-only PR skipped every check.
        ["fixtures/a/b.md", []],
      ],
    },
  );
});

// 0175 narrowed this law: a shared path that is no file of today's version, the lockfile among
// them, no longer starts today's build.
// The plan for CI paths narrowed it again, with the owner's yes (its answered question 2): lint rule
// files (`.oxlintrc.json`, `oxlint-plugins/`) are no longer shared paths. They give scope readers,
// so next runs only the next/ tests that lint, read or bundle source, and the lint rule files law
// below says so. This law keeps its generators, which hold no lint rule file; its `next` means
// every next/ test only for the paths those generators make.
it("shared paths run check, typecheck and next, and today's build by the paths; adding paths never disables a job", () => {
  fc.assert(
    fc.property(fc.array(path, { minLength: 1, maxLength: 10 }), list, shared, (paths, more, unknown) => {
      expect(ci.classify([unknown], "pull_request")).toMatchObject({ ...heavy, build: todays(unknown) });
      const on = touched([...paths, unknown]);
      expect(ci.classify([...paths, unknown], "pull_request")).toMatchObject({ ...heavy, build: on });
      const before = ci.classify(paths, "pull_request");
      const after = ci.classify([...paths, ...more], "pull_request");

      for (const key of ["check", "typecheck", "next", "field", "build"] as const) {
        expect(!before[key] || after[key]).toBe(true);
      }

      expect(ci.classify([], "pull_request")).toMatchObject(heavy);
      expect(ci.classify(null, "pull_request")).toMatchObject(heavy);
    }),
    options,
  );
});

// 0539: the exam's plant helper and signer, which started the tooling tests, are next/ paths like
// any other now that no event runs a tooling test.
it("today, next and mixed paths have separate version flags", () => {
  fc.assert(
    fc.property(
      fc.array(today, { minLength: 1, maxLength: 12 }),
      fc.array(next, { minLength: 1, maxLength: 12 }),
      (old, fresh) => {
        expect(ci.classify(old, "pull_request")).toMatchObject({ ...heavy, next: false, build: true });
        expect(ci.classify(fresh, "pull_request")).toMatchObject({ ...heavy, build: false });
        expect(ci.classify([...old, ...fresh], "pull_request")).toMatchObject({ ...heavy, build: true });

        for (const exam of ["next/apps/fabrika/src/exam/plant.ts", "next/apps/fabrika/src/exam/commits.ts"]) {
          expect(ci.classify([...fresh, exam], "pull_request")).toEqual(ci.classify(fresh, "pull_request"));
        }
      },
    ),
    options,
  );
});

it("NUL diff keeps both move names and unusual paths; failed reads cannot skip", () => {
  fc.assert(
    fc.property(
      word,
      word,
      fc.constantFrom(" ", "\t", "\n"),
      fc.constantFrom(1, 128, null),
      (old, fresh, space, status) => {
        const paths = [`apps/${old}${space}old.ts`, `next/${fresh}${space}new.ts`];
        const calls: string[][] = [];
        const run: Runner = (args) => {
          calls.push(args);
          return {
            status: 0,
            stdout: args[0] === "merge-base" ? `${"a".repeat(40)}\n` : `${paths.join("\0")}\0`,
          };
        };
        expect(ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", run)).toEqual(paths);
        expect(calls[0]).toEqual(["merge-base", "b".repeat(40), "c".repeat(40)]);
        expect(calls[1]).toEqual(["diff", "--no-renames", "--name-only", "-z", "a".repeat(40), "c".repeat(40), "--"]);
        expect(
          ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", () => ({
            status,
            stdout: "",
          })),
        ).toBeNull();
        expect(
          ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", (args) =>
            args[0] === "merge-base" ? { status: 0, stdout: "a".repeat(40) } : { status, stdout: "" },
          ),
        ).toBeNull();
        expect(ci.readPaths("b".repeat(40), "c".repeat(40), "push", run)).toEqual(paths);
        expect(calls.at(-1)).toEqual([
          "diff",
          "--no-renames",
          "--name-only",
          "-z",
          "b".repeat(40),
          "c".repeat(40),
          "--",
        ]);
        expect(ci.readPaths("--bad", "c".repeat(40), "pull_request", run)).toBeNull();
        // A platform refusal has null stdout at runtime, despite Node's generic string type.
        expect(
          ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", () =>
            spawnSync("git", ["status"], {
              cwd: join(tmpdir(), "t342-no-such-folder", old),
              encoding: "utf8",
            }),
          ),
        ).toBeNull();
        expect(ci.readPaths("0".repeat(40), "c".repeat(40), "push", run)).toBeNull();
        // Zeros at either end are legal; only the all-zero SHA means no history.
        const zeros = `0${"a".repeat(38)}0`;
        expect(ci.readPaths(zeros, zeros, "push", run)).toEqual(paths);
        // A merge base Git prints that is not a SHA cannot reach the diff.
        expect(
          ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", (args) =>
            args[0] === "merge-base" ? { status: 0, stdout: "\n" } : run(args),
          ),
        ).toBeNull();
        // Empty output is no paths; output cut before its last NUL cannot skip.
        const answer = (stdout: string) =>
          ci.readPaths("b".repeat(40), "c".repeat(40), "push", () => ({ status: 0, stdout }));
        expect(answer("")).toEqual([]);
        expect(answer(paths.join("\0"))).toBeNull();
      },
    ),
    options,
  );
});

it("shared tracked-file check agrees with Git, including command errors", () => {
  fc.assert(
    fc.property(word, fc.boolean(), (name, ignored) => {
      const root = mkdtempSync(join(tmpdir(), "ci-ignore-"));

      try {
        const data = join(root, "data");
        // These disposable Git fixtures never touch this checkout's index or history.
        expect(spawnSync("git", ["init", "-q", "--separate-git-dir", data, join(root, "tree")]).status).toBe(0);
        const tree = join(root, "tree");
        writeFileSync(join(tree, name), "test");
        expect(spawnSync("git", ["add", "--", name], { cwd: tree }).status).toBe(0);
        writeFileSync(join(tree, ".gitignore"), ignored ? `${name}\n` : "other\n");
        expect(checkTracked(tree).ok).toBe(!ignored);
        expect(checkTracked(join(root, "missing")).ok).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
    options,
  );
});

// T375 mutation: unanchored skill paths. A skill-shaped path below another folder is no skill.
it("skill script and prose rules apply only at the repo root", () => {
  fc.assert(
    fc.property(fc.array(skillName, { maxLength: 2 }), script, skillName, (dirs, script, skill) => {
      const prefix = ["next", ...dirs].join("/");
      expect(ci.classify([`${prefix}/${script}`], "pull_request")).toEqual({
        ...heavy,
        field: false,
        build: false,
      });

      for (const root of ["next", "docs"]) {
        expect(ci.classify([[root, ...dirs, ".claude/skills", skill].join("/")], "pull_request")).toEqual({
          ...heavy,
          field: false,
          // 0175: neither root is today's version, so the build stays off for both.
          build: false,
        });
      }
    }),
    options,
  );
});

// 0134's amendment (2026-11-11): a draft pull request runs only the fast jobs; marking it ready
// runs the rest on the same head. Plants caught: a draft that still runs test, main honoring the
// draft flag, a draft that skips typecheck, and a ready docs-only PR that builds (that one survived
// until the pinned example below).
const events = fc.constantFrom("pull_request", "push", "merge_group", "workflow_dispatch", "");
const paths = fc.option(list, { nil: null });

// 0175 narrowed this law: the build is today's library, so it follows today's files, no longer
// `check`. Since 0533 that rule is classify's own `build` flag. 0534 kept the test job to a pull
// request alone, and 0539 took it off every event, so the law is classify's flags again.
it("property: a ready pull request and every other event run what classify says", () => {
  fc.assert(
    fc.property(paths, events, fc.boolean(), (paths, event, draft) => {
      const flags = ci.classify(paths, event);
      const ready = event !== "pull_request" || !draft;
      fc.pre(ready);
      expect(ci.jobs(paths, event, draft)).toEqual(flags);
    }),
    // Lists where check is off are rare in `list`, so one is pinned: a docs-only ready PR builds nothing.
    { ...options, examples: [[["docs/a.md"], "pull_request", false]] },
  );
});

it("property: a draft keeps lint, typecheck and field as ready, and skips build and next", () => {
  fc.assert(
    fc.property(paths, (paths) => {
      const ready = ci.jobs(paths, "pull_request", false);
      expect(ci.jobs(paths, "pull_request", true)).toEqual({
        check: ready.check,
        typecheck: ready.typecheck,
        field: ready.field,
        build: false,
        next: false,
      });
    }),
    options,
  );
});

// 0175 narrowed this law: main no longer runs every job. A push is still never a draft. 0534
// narrowed it again, to less the test job, and 0539 took that job off every event.
it("property: a push runs what a ready pull request runs for the same paths, and ignores the draft flag", () => {
  fc.assert(
    fc.property(paths, fc.boolean(), (paths, draft) => {
      expect(ci.jobs(paths, "push", draft)).toEqual(ci.jobs(paths, "pull_request", false));
    }),
    {
      ...options,
      // pinned: a push of today's code with the draft flag set, where a draft would skip the build.
      examples: [[["apps/fabrika/src/a.ts"], true]],
    },
  );
});

// 0175: the fallbacks. A run that cannot say what changed runs everything. Since 0539 that holds
// no tooling test: no job of the merge line runs one.
it("property: unreadable history, no path at all, or an event with no paths of its own runs every job", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("pull_request", "merge_group", "push"),
      fc.constantFrom(null, []),
      list,
      fc.constantFrom("workflow_dispatch", "schedule", ""),
      fc.boolean(),
      (event, none, paths, other, draft) => {
        expect(Object.values(ci.jobs(none, event, false)).every(Boolean)).toBe(true);
        expect(Object.values(ci.jobs(paths, other, draft)).every(Boolean)).toBe(true);
      },
    ),
    options,
  );
});

it("scenario: a push with no commit before it reads no paths, so it runs every job", () => {
  // scenario: a first push has an all-zero `before`, and a hand-started run has none. No git runs.
  const run: Runner = () => {
    throw new Error("git must not run");
  };

  for (const base of ["0".repeat(40), ""]) {
    const read = ci.readPaths(base, "c".repeat(40), "push", run);
    expect(read).toBeNull();
    expect(Object.values(ci.jobs(read, "push", false)).every(Boolean)).toBe(true);
  }
});

it("property: a push of Markdown no check reads, field rows or skill prose starts no heavy job", () => {
  fc.assert(
    fc.property(fc.array(fc.oneof(safe, prose), { minLength: 1, maxLength: 12 }), (paths) => {
      expect(ci.jobs(paths, "push", false)).toMatchObject(quietJobs);
    }),
    // pinned: one decision file, the push that started every job.
    { ...options, examples: [[[".decisions/0175-every-run-follows-its-paths.md"]]] },
  );
});

// 0175: today's build starts only when a file of today's version changed, on every event. A file
// that reruns every test is not one. Its tests and e2e, which 0175 started the same way, start on
// no event since 0533 (the law at the end).
const rerun = fc.constantFrom("pnpm-lock.yaml", "package.json", "tsconfig.json", "pnpm-workspace.yaml");

const tooling = fc.oneof(
  script,
  word.map((s) => `.github/ci/${s}.ts`),
  word.map((s) => `oxlint-plugins/${s}.mjs`),
  word.map((s) => `scripts/${s}.ts`),
  fc.constantFrom("vitest.shards.ts", "vitest.config.ts", ".github/workflows/check.yaml"),
);

const elsewhere = fc.oneof(safe, next, prose, tooling, otherSkill, rerun);
const todaysFile = fc.oneof(today, fc.constantFrom("packages/fabrika-design/src/colors.ts", "fixtures/toy/src/a.ts"));
const off = { build: false };
const scopedEvent = fc.constantFrom("pull_request", "merge_group", "push");
const quietJobs = { check: false, typecheck: false, next: false, build: false };

it("property: a run that touches no file of today's version does not build it, on a pull request, a merge queue's group and a push", () => {
  fc.assert(
    fc.property(fc.array(elsewhere, { minLength: 1, maxLength: 12 }), scopedEvent, (paths, event) => {
      expect(ci.jobs(paths, event, false)).toMatchObject(off);
    }),
    {
      ...options,
      examples: [
        // pinned: next/ alone.
        [["next/packages/libfabrika/src/a.ts"], "push"],
        // pinned: the lockfile reruns every test, and is still no file of today's version.
        [["pnpm-lock.yaml"], "push"],
      ],
    },
  );
});

it("property: a run that touches a file of today's version runs check, typecheck and its build, on a pull request, a merge queue's group and a push", () => {
  fc.assert(
    fc.property(fc.array(elsewhere, { maxLength: 12 }), todaysFile, scopedEvent, (paths, file, event) => {
      expect(ci.jobs([...paths, file], event, false)).toMatchObject({
        check: true,
        typecheck: true,
        build: true,
      });
    }),
    options,
  );
});

it("property: a pull request, a merge queue's group or a push of next/ files alone runs check, typecheck and next, and not today's build", () => {
  fc.assert(
    fc.property(fc.array(next, { minLength: 1, maxLength: 12 }), scopedEvent, (paths, event) => {
      expect(ci.jobs(paths, event, false)).toEqual({ ...heavy, field: false, ...off });
    }),
    options,
  );
});

// 0534 narrowed this law: the tooling tests left the merge queue and main. 0539 took them off pull
// requests too: no flag starts one, and the schedule runs them all. The flag law at the end holds
// that for every path; this one pins the tooling files themselves.
it("property: a tooling file starts no tooling test and not today's build, on a pull request, a merge queue's group and a push", () => {
  fc.assert(
    fc.property(fc.array(tooling, { minLength: 1, maxLength: 12 }), scopedEvent, (paths, event) => {
      const flags = ci.jobs(paths, event, false);
      expect(flags).toMatchObject(off);
      expect(flags).not.toHaveProperty("test");
    }),
    {
      ...options,
      // pinned: a change to check.yaml alone, whose tooling legs ran out of time on pull request 1276.
      examples: [[[".github/workflows/check.yaml"], "pull_request"]],
    },
  );
});

// 0534: no next/ test reads a file under .github/ (`rg '\.github' next --glob '*.test.ts'` finds
// only commits.test.ts, naming the glob as a string), so CI's own files need none of next/, on every
// event that follows its paths. Beside a next/ file, that file decides.
const ciFile = fc.oneof(
  word.map((s) => `.github/ci/${s}.ts`),
  word.map((s) => `.github/ci/${s}.test.ts`),
  word.map((s) => `.github/workflows/${s}.yaml`),
  fc.constantFrom(".github/actions/pnpm/action.yml", ".github/CODEOWNERS", ".github/ci/changes.mjs"),
);

it("property: CI's own files alone run check and typecheck, and none of next/", () => {
  fc.assert(
    fc.property(fc.array(ciFile, { minLength: 1, maxLength: 12 }), scopedEvent, (paths, event) => {
      expect(ci.scope(paths, event)).toBe("none");
      expect(ci.jobs(paths, event, false)).toEqual({
        ...heavy,
        next: false,
        field: false,
        ...off,
      });
    }),
    {
      ...options,
      // pinned: one workflow file, which ran all of next/ on every CI pull request (experiment 291).
      examples: [[[".github/workflows/check.yaml"], "pull_request"]],
    },
  );
});

it("property: a CI file beside other paths never changes what next/ they need", () => {
  fc.assert(
    fc.property(list, fc.array(ciFile, { minLength: 1, maxLength: 4 }), scopedEvent, (paths, extra, event) => {
      fc.pre(paths.length > 0);
      expect(ci.scope([...paths, ...extra], event)).toBe(ci.scope(paths, event));
    }),
    options,
  );
});

it("scenario: plain Markdown under today's trees is no file of today's version", () => {
  // scenario: an app's README is read by no check, so it starts no build, on any event.
  expect(ci.jobs(["apps/fabrika/README.md"], "pull_request", false)).toMatchObject(off);
  expect(ci.jobs(["apps/fabrika/README.md"], "push", false)).toMatchObject(off);
});

// 0174 narrowed this law: the group no longer runs every job, and it is still never a draft. 0534
// narrowed it again, to less the test job, and 0539 took that job off every event.
it("property: a merge queue's group runs what a ready pull request runs, and ignores the draft flag", () => {
  fc.assert(
    fc.property(paths, fc.boolean(), (paths, draft) => {
      expect(ci.jobs(paths, "merge_group", draft)).toEqual(ci.jobs(paths, "pull_request", false));
    }),
    {
      ...options,
      examples: [
        // pinned: a code group with the draft flag set, where a draft pull request would skip the build.
        [["apps/fabrika/src/a.ts"], true],
        // pinned: a group of Markdown alone builds nothing, as a ready docs-only pull request.
        [["docs/a.md"], true],
      ],
    },
  );
});

it("scenario: a merge queue's group reads its paths from its base, as a push does", () => {
  const calls: string[][] = [];
  const run: Runner = (args) => {
    calls.push(args);
    return { status: 0, stdout: "docs/a.md\0" };
  };
  expect(ci.readPaths("b".repeat(40), "c".repeat(40), "merge_group", run)).toEqual(["docs/a.md"]);
  expect(calls).toEqual([["diff", "--no-renames", "--name-only", "-z", "b".repeat(40), "c".repeat(40), "--"]]);
});

// The plan for CI paths, case 4: no next/ test reads a file under .agents/skills/. Today's only
// such file, the lead's gc.plist, is read by the lead's tooling tests, which the schedule runs.
it("property: a skill file under .agents/skills/ that is no script and no prose runs check and typecheck, and no next", () => {
  fc.assert(
    fc.property(
      fc.array(agentsSkill, { minLength: 1, maxLength: 12 }),
      claudeSkill,
      scopedEvent,
      (paths, claude, event) => {
        expect(ci.jobs(paths, event, false)).toEqual({ ...heavy, next: false, field: false, ...off });
        // A file under .claude/skills/<name>/ still runs everything, alone or beside them.
        expect(ci.jobs([claude], event, false)).toEqual({ ...heavy, field: false, ...off });
        expect(ci.jobs([...paths, claude], event, false)).toEqual({ ...heavy, field: false, ...off });
      },
    ),
    {
      ...options,
      // pinned: .agents/skills/lead/gc.plist, the one such file today, read by gcloop.test.ts.
      examples: [[[".agents/skills/lead/gc.plist"], ".claude/skills/guidelines/notes.md", "pull_request"]],
    },
  );
});

// The plan for CI paths, case 3: no next/ test and no tooling test reads a file under
// experiments/, and CI does not type-check them, so only lint reads them. Markdown there is
// already quiet. The same file under any other root is no experiments file.
const experimentFile = fc
  .tuple(
    fc.array(fc.oneof(word, fc.constant("177-themes")), { maxLength: 3 }),
    word,
    fc.constantFrom("ts", "mjs", "json", "txt", "tsx"),
  )
  .map(([dirs, name, ext]) => ["experiments", ...dirs, `${name}.${ext}`].join("/"))
  .filter((p) => !p.startsWith("experiments/177-themes/schemes/"));

it("property: experiments files alone run check, and no typecheck or next", () => {
  fc.assert(
    fc.property(
      fc.array(experimentFile, { minLength: 1, maxLength: 12 }),
      fc.constantFrom("fixtures", "experimentsish", "docs/experiments", "next/experiments"),
      scopedEvent,
      (paths, root, event) => {
        expect(ci.jobs(paths, event, false)).toEqual({
          check: true,
          typecheck: false,
          next: false,
          field: false,
          ...off,
        });
        // The same files under another root still type-check and start next.
        const moved = paths.map((p) => p.replace(/^experiments\//, `${root}/`));
        expect(ci.jobs(moved, event, false)).toMatchObject({ check: true, typecheck: true, next: true });
      },
    ),
    options,
  );
});

it("pinned: the one experiments folder a test reads runs as an unknown path does", () => {
  // pinned: apps/fabrika/src/pipes.test.ts reads the color scheme file in this folder, so a
  // change there keeps today's behavior and is not an experiments file.
  const read = "experiments/177-themes/schemes/radix-colors-3.0.0.json";
  const unknown = ci.classify(["unknown/a"], "pull_request");
  expect(ci.classify([read], "pull_request")).toEqual(unknown);
  expect(ci.classify([read, "experiments/177-themes/notes.ts"], "pull_request")).toEqual(unknown);
});

// The plan for CI paths, slice 2, cases 1 and 2: the `next` job runs only the reader tests (the
// next/ tests that read source as text, lint it or bundle it) when every next/ path is proven the
// same program, and for lint rule files. `scope` is what of next/ a run needs: "none", "readers"
// or "all". `proven` holds the paths program.ts proved; on the first pass it is empty.
type Scope = "none" | "readers" | "all";
const rank: Record<Scope, number> = { none: 0, readers: 1, all: 2 };

// Lint rule files: the config and the plugin folder, which the exam's lint tests copy and run.
const lintFile = fc.oneof(
  fc.constant(".oxlintrc.json"),
  fc
    .tuple(fc.array(word, { maxLength: 2 }), word, fc.constantFrom("mjs", "ts", "json"))
    .map(([dirs, name, ext]) => ["oxlint-plugins", ...dirs, `${name}.${ext}`].join("/")),
);

// Paths nobody listed: today's shared generator and unusual names.
const unlisted = fc.oneof(
  shared,
  fc.string({ minLength: 1 }).map((s) => `unusual/${s}`),
);

// Any path the classifier knows, lint rule files and experiments included.
const known = fc.oneof(path, lintFile, experimentFile, agentsSkill);
const proven = fc.array(fc.oneof(next, known), { maxLength: 8 });

it("property: a path nobody listed gives scope all and every flag on, whatever proven holds", () => {
  fc.assert(
    fc.property(unlisted, fc.array(known, { maxLength: 8 }), proven, scopedEvent, (unknown, others, same, event) => {
      // The path itself counts as proven too: only a next/ path can be.
      const all = [...same, unknown];
      expect(ci.scope([unknown], event, all)).toBe("all");
      expect(ci.classify([unknown], event, all)).toMatchObject({ ...heavy, build: todays(unknown) });
      expect(ci.scope([...others, unknown], event, [...all, ...others])).toBe("all");
    }),
    options,
  );
});

it("property: adding paths never lowers the scope or turns a flag off, and adding to proven never raises the scope or changes a flag", () => {
  fc.assert(
    fc.property(
      fc.array(fc.oneof(known, next), { minLength: 1, maxLength: 10 }),
      fc.array(fc.oneof(known, next, unlisted), { maxLength: 6 }),
      proven,
      proven,
      scopedEvent,
      (paths, more, same, extra, event) => {
        const before = ci.scope(paths, event, same);
        const after = ci.scope([...paths, ...more], event, same);
        expect(rank[after as Scope]).toBeGreaterThanOrEqual(rank[before as Scope]);
        const flags = ci.classify(paths, event, same);
        const grown = ci.classify([...paths, ...more], event, same);

        for (const key of ["check", "typecheck", "next", "field", "build"] as const) {
          expect(!flags[key] || grown[key]).toBe(true);
        }

        // Proving more paths can only lower what next/ needs, and never moves a flag.
        expect(rank[ci.scope(paths, event, [...same, ...extra, ...paths]) as Scope]).toBeLessThanOrEqual(
          rank[before as Scope],
        );
        expect(ci.classify(paths, event, [...same, ...extra, ...paths])).toEqual(ci.classify(paths, event));
      },
    ),
    {
      ...options,
      examples: [
        // pinned: a lint file needs readers and a next/ file nobody proved needs all, whatever the order.
        [["next/packages/libfabrika/src/a.ts"], [".oxlintrc.json"], [], [], "pull_request"],
        [[".oxlintrc.json"], ["next/packages/libfabrika/src/a.ts"], [], [], "pull_request"],
      ],
    },
  );
});

it("property: proven counts only for a next/ path that is in paths", () => {
  fc.assert(
    fc.property(
      fc.array(fc.oneof(known, next, unlisted), { minLength: 1, maxLength: 10 }),
      proven,
      fc.array(fc.oneof(today, unlisted, lintFile, next), { maxLength: 6 }),
      scopedEvent,
      (paths, same, outside, event) => {
        // Every path of the run is offered as proven, with paths that are not in the run at all.
        const offered = [...same, ...outside, ...paths];
        const counted = offered.filter((p) => p.startsWith("next/") && paths.includes(p));
        expect(ci.scope(paths, event, offered)).toBe(ci.scope(paths, event, counted));
        // A non-next/ path that needs everything still needs everything when it is offered.
        const old = paths.filter((p) => !p.startsWith("next/"));
        expect(ci.scope(old, event, old)).toBe(ci.scope(old, event));
      },
    ),
    {
      ...options,
      examples: [
        // pinned: a file of today's version offered as proven still runs every next/ test.
        [["packages/fabrika-design/src/colors.ts"], [], [], "pull_request"],
      ],
    },
  );
});

it("property: next/ files all proven run check and typecheck, and scope readers; one not proven gives scope all", () => {
  fc.assert(
    fc.property(fc.uniqueArray(next, { minLength: 1, maxLength: 12 }), next, scopedEvent, (paths, other, event) => {
      expect(ci.scope(paths, event, paths)).toBe("readers");
      expect(ci.classify(paths, event, paths)).toMatchObject({ check: true, typecheck: true, next: true });
      fc.pre(!paths.includes(other));
      expect(ci.scope([...paths, other], event, paths)).toBe("all");
      expect(ci.scope(paths, event)).toBe("all");
    }),
    options,
  );
});

it("property: lint rule files alone run check and typecheck, with scope readers", () => {
  fc.assert(
    fc.property(fc.array(lintFile, { minLength: 1, maxLength: 8 }), proven, scopedEvent, (paths, same, event) => {
      expect(ci.scope(paths, event, same)).toBe("readers");
      expect(ci.classify(paths, event, same)).toMatchObject({ check: true, typecheck: true, next: true });
    }),
    {
      ...options,
      examples: [
        // pinned: the config alone, the commonest case 2 change.
        [[".oxlintrc.json"], [], "pull_request"],
      ],
    },
  );
});

it("format: each entry of readers is a tracked path that holds a test file", () => {
  // format: the next job's path argument is this list, so a renamed folder would leave the reader
  // run empty. The six entries the plan and experiment 288 found are all on it, and build.test.ts, the
  // format law split from build.integration.test.ts (0536).
  expect(Array.isArray(ci.readers)).toBe(true);
  expect(ci.readers).toEqual(
    expect.arrayContaining([
      "next/apps/fabrika/src/exam/",
      "next/apps/fabrika/src/settings-generated.test.ts",
      "next/apps/fabrika/src/build.test.ts",
      "next/apps/fabrika/src/build.integration.test.ts",
      "next/apps/fabrika/src/build-command.integration.test.ts",
      "next/apps/fabrika/src/instance-one-file.integration.test.ts",
      "next/packages/libfabrika/src/node/build/",
    ]),
  );

  for (const entry of ci.readers) {
    const listed = spawnSync("git", ["ls-files", "--", entry], { encoding: "utf8" });
    expect(listed.status, entry).toBe(0);
    const tracked = listed.stdout.split("\n").filter(Boolean);
    expect(entry.startsWith("next/"), entry).toBe(true);
    expect(
      entry.endsWith("/") ? tracked.some((file) => /\.test\.tsx?$/.test(file)) : tracked.includes(entry),
      entry,
    ).toBe(true);
    expect(entry.endsWith("/") || /\.test\.tsx?$/.test(entry), entry).toBe(true);
  }
});

// The first pass and the `--same` pass, through `outputs`, the function the script prints.
const sha = { base: "b".repeat(40), merged: "a".repeat(40), head: "c".repeat(40) };

/** A fake git: the merge base, the changed paths, and `diff` text for any other diff. */
const git =
  (paths: readonly string[], diff: string): Runner =>
  (args) => {
    if (args[0] === "merge-base") {
      return { status: 0, stdout: `${sha.merged}\n` };
    }

    if (args[0] === "diff" && args.includes("--name-only")) {
      return { status: 0, stdout: paths.length === 0 ? "" : `${paths.join("\0")}\0` };
    }

    return args[0] === "diff" ? { status: 0, stdout: diff } : { status: 128, stdout: "" };
  };

const envOf = (event: string, draft: boolean) => ({
  BASE: sha.base,
  HEAD: sha.head,
  EVENT: event,
  DRAFT: String(draft),
});

/** What a run prints for a scope: the reader paths, or all of next/. */
const filterOf = (scope: Scope) => (scope === "readers" ? ci.readers.join(" ") : "next/");

it("property: probe changes no flag: the first pass prints the same flags for any diff text", async () => {
  await fc.assert(
    fc.asyncProperty(
      // A NUL ends a path in git's output, so no path holds one.
      fc
        .array(fc.oneof(known, next), { minLength: 1, maxLength: 10 })
        .filter((list) => list.every((p) => !p.includes("\0"))),
      fc.oneof(
        fc.string(),
        fc
          .array(fc.constantFrom("+// a note", "-// old", "+ * @since 1.0", "+", "+const a = 1;", "@@ -1 +1 @@"), {
            maxLength: 6,
          })
          .map((lines) => lines.join("\n")),
      ),
      scopedEvent,
      fc.boolean(),
      async (paths, diff, event, draft) => {
        const printed = await ci.outputs({ same: false, env: envOf(event, draft), run: git(paths, diff) });
        const expected = ci.jobs(paths, event, draft);

        for (const [key, on] of Object.entries(expected)) {
          expect(printed[key], key).toBe(String(on));
        }

        expect(["true", "false"]).toContain(printed["probe"]);

        if (expected.next) {
          expect(printed["filter"]).toBe(filterOf(ci.scope(paths, event) as Scope));
        }
      },
    ),
    options,
  );
});

it("scenario: with no parser to import, --same prints what the first pass printed", async () => {
  // scenario: the import of program.ts rejects, as it does when the parser's install failed. Then
  // a parser that proves every path, and one that proves all but one, for the same runs.
  const rejects = () => Promise.reject(new Error("Cannot find package 'oxc-parser'"));
  const proves = (keep: (path: string) => boolean) => () =>
    Promise.resolve({ samePaths: (_base: string, _head: string, paths: readonly string[]) => paths.filter(keep) });
  const nextPaths = [
    "next/packages/libfabrika/src/transport/Hello.ts",
    "next/packages/libfabrika/src/transport/Wire.ts",
  ];
  const comments = "+/** A note. */\n+// more";

  for (const [paths, event] of [
    [nextPaths, "pull_request"],
    [nextPaths, "merge_group"],
    [[".oxlintrc.json"], "push"],
    [[...nextPaths, ".oxlintrc.json"], "pull_request"],
  ] as [readonly string[], string][]) {
    const run = git(paths, comments);
    const env = envOf(event, false);
    const first = await ci.outputs({ same: false, env, run });
    const again = await ci.outputs({ same: true, env, run, load: rejects });
    expect({ next: again["next"], filter: again["filter"] }).toEqual({ next: first["next"], filter: first["filter"] });
    expect(first["next"]).toBe("true");

    const proved = await ci.outputs({ same: true, env, run, load: proves(() => true) });
    expect(proved).toMatchObject({ next: "true", filter: filterOf("readers") });
    const one = await ci.outputs({ same: true, env, run, load: proves((p) => !p.endsWith("Wire.ts")) });
    expect(one).toMatchObject({
      next: "true",
      filter: paths.includes("next/packages/libfabrika/src/transport/Wire.ts") ? "next/" : filterOf("readers"),
    });
  }

  // History that cannot be read: both passes run everything, parser or none.
  const broken: Runner = () => ({ status: 128, stdout: "" });
  const env = envOf("pull_request", false);
  expect(await ci.outputs({ same: true, env, run: broken, load: rejects })).toMatchObject({
    next: "true",
    filter: "next/",
  });
  expect(await ci.outputs({ same: false, env, run: broken })).toMatchObject({ next: "true", filter: "next/" });
});

// A push to main that a merge queue run already tested (changes.mjs's `tested`). The queue moves
// main to the commit it tested, so a push and its queue run share their tree and their base tree;
// then next would repeat that run, and skips. Every other case runs what `jobs` says.
const tree = { base: "1".repeat(40), head: "2".repeat(40), other: "3".repeat(40) };
const queue = { head: "d".repeat(40), base: "e".repeat(40) };

/** The fake git above, plus the trees of the push's base and head. */
const pushGit =
  (paths: readonly string[]): Runner =>
  (args) => {
    if (args[0] === "rev-parse") {
      const target = args.at(-1);
      const found = target === `${sha.base}^{tree}` ? tree.base : target === `${sha.head}^{tree}` ? tree.head : null;
      return found === null ? { status: 128, stdout: "" } : { status: 0, stdout: `${found}\n` };
    }

    return git(paths, "")(args);
  };

type QueueRun = {
  id: number;
  status: string;
  conclusion: string | null;
  head_sha: string;
  head_commit: { tree_id: string } | null;
};

const passed: QueueRun = {
  id: 7,
  status: "completed",
  conclusion: "success",
  head_sha: queue.head,
  head_commit: { tree_id: tree.head },
};

type Fake = {
  runs?: readonly QueueRun[];
  baseTree?: string;
  fails?: "runs" | "commit";
};

/** A fake GitHub: the queue's runs, its head's tree and parent, and that parent's tree. */
const fakeApi = ({ runs = [passed], baseTree = tree.base, fails }: Fake) => {
  const calls: string[] = [];
  const reject = (what: string) => Promise.reject(new Error(`${what}: 502`));
  return {
    calls,
    api: {
      runs: () => {
        calls.push("runs");
        return fails === "runs" ? reject("runs") : Promise.resolve(runs);
      },
      commit: (commit: string) => {
        calls.push(`commit ${commit}`);

        if (fails === "commit") {
          return reject("commit");
        }

        return commit === queue.head
          ? Promise.resolve({ tree: tree.head, parents: [queue.base] })
          : commit === queue.base
            ? Promise.resolve({ tree: baseTree, parents: [] })
            : reject(`no commit ${commit}`);
      },
    },
  };
};

const pushEnv = envOf("push", false);

const changedPaths = fc
  .array(known, { minLength: 1, maxLength: 10 })
  .filter((list) => list.every((p) => !p.includes("\0")));

/** What a push prints, through `outputs`, with the fake git and a fake GitHub. */
const pushed = (paths: readonly string[], fake: Fake, env: Record<string, string> = pushEnv) => {
  const { api, calls } = fakeApi(fake);
  return ci.outputs({ same: false, env, run: pushGit(paths), api }).then((printed) => ({ printed, calls }));
};

/** Every flag `outputs` printed is the one `expected` holds. */
const prints = (printed: Record<string, string>, expected: Record<string, boolean>) => {
  for (const [key, on] of Object.entries(expected)) {
    expect(printed[key], key).toBe(String(on));
  }
};

// Plants in changes.mjs, each run once and each caught by a law below: any conclusion counts, a run
// not ended counts, any head tree counts, any base tree counts, an API error counts as tested, every
// event asks, a tested push skips check too, the reader ignores a refused answer, the reader asks
// with no token, and a tree git cannot read is ignored.
it("property: a push whose tree and base tree a passed queue run tested skips next, and nothing else", async () => {
  await fc.assert(
    fc.asyncProperty(changedPaths, async (paths) => {
      const { printed } = await pushed(paths, {});
      const expected = ci.jobs(paths, "push", false);
      prints(printed, { ...expected, next: false });
      expect(printed["tested"]).toBe("7");
      expect(printed["probe"]).toBe("false");
    }),
    options,
  );
});

it("scenario: a tested push of today's and next/ files keeps check, typecheck, build and field, and names the run", async () => {
  // scenario: the shape of most queue merges, written out so the flags are read and not compared.
  const { printed } = await pushed(["apps/fabrika/src/a.ts", "next/packages/libfabrika/src/b.ts"], {});
  expect(printed).toMatchObject({
    check: "true",
    typecheck: "true",
    next: "false",
    build: "true",
    tested: "7",
  });
});

it("property: a queue run that did not pass, or has not ended, tests nothing, so the push runs what jobs says", async () => {
  await fc.assert(
    fc.asyncProperty(
      changedPaths,
      fc.oneof(
        fc
          .constantFrom("failure", "cancelled", "timed_out", "skipped", "neutral", "action_required", "stale")
          .map((conclusion) => ({ ...passed, conclusion })),
        fc.constant({ ...passed, conclusion: null }),
        fc.constantFrom("in_progress", "queued", "waiting").map((status) => ({ ...passed, status })),
      ),
      async (paths, run) => {
        const { printed } = await pushed(paths, { runs: [run] });
        prints(printed, ci.jobs(paths, "push", false));
        expect(printed["tested"]).toBe("");
      },
    ),
    options,
  );
});

it("property: with no queue run at all, as after an admin merge or a direct push, the push runs what jobs says", async () => {
  await fc.assert(
    fc.asyncProperty(changedPaths, async (paths) => {
      const { printed } = await pushed(paths, { runs: [] });
      prints(printed, ci.jobs(paths, "push", false));
      expect(printed["tested"]).toBe("");
    }),
    options,
  );
});

it("property: a passed queue run of another tree, or of no readable tree, tests nothing", async () => {
  await fc.assert(
    fc.asyncProperty(
      changedPaths,
      fc.constantFrom<QueueRun["head_commit"]>({ tree_id: tree.other }, { tree_id: tree.base }, { tree_id: "" }, null),
      async (paths, head_commit) => {
        const { printed } = await pushed(paths, { runs: [{ ...passed, head_commit }] });
        prints(printed, ci.jobs(paths, "push", false));
        expect(printed["tested"]).toBe("");
      },
    ),
    options,
  );
});

it("property: a passed queue run of the same tree built on another base tree tests nothing", async () => {
  // A push of two queue entries at once: the last entry's run started from the first's head, so
  // its `--changed` tests missed what the first brought.
  await fc.assert(
    fc.asyncProperty(changedPaths, fc.constantFrom(tree.other, tree.head, ""), async (paths, baseTree) => {
      const { printed } = await pushed(paths, { baseTree });
      prints(printed, ci.jobs(paths, "push", false));
      expect(printed["tested"]).toBe("");
    }),
    options,
  );
});

it("property: an API error, a malformed answer or a tree git cannot read runs what jobs says", async () => {
  await fc.assert(
    fc.asyncProperty(
      changedPaths,
      fc.constantFrom("runs", "commit") satisfies fc.Arbitrary<Fake["fails"]>,
      async (paths, fails) => {
        const { printed } = await pushed(paths, { fails });
        prints(printed, ci.jobs(paths, "push", false));
        expect(printed["tested"]).toBe("");
      },
    ),
    options,
  );

  // Answers of the wrong shape, read through the real GitHub reader: each throws or matches nothing.
  const runEnv = {
    ...pushEnv,
    GITHUB_TOKEN: "token",
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/check.yaml@refs/heads/main",
  };
  await fc.assert(
    fc.asyncProperty(
      changedPaths,
      fc.constantFrom<[unknown, unknown]>(
        [{}, {}],
        [null, null],
        [{ workflow_runs: null }, {}],
        [{ workflow_runs: "runs" }, {}],
        [{ workflow_runs: [{}] }, {}],
        [{ workflow_runs: [passed] }, {}],
        [{ workflow_runs: [passed] }, { tree: { sha: tree.head }, parents: null }],
        [{ workflow_runs: [passed] }, { tree: null, parents: [{ sha: queue.base }] }],
      ),
      async (paths, [runs, commit]) => {
        const api = ci.github(runEnv, (url) =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(url.includes("/runs?") ? runs : commit),
          }),
        );
        const printed = await ci.outputs({ same: false, env: runEnv, run: pushGit(paths), api });
        prints(printed, ci.jobs(paths, "push", false));
        expect(printed["tested"]).toBe("");
      },
    ),
    options,
  );

  // git cannot read the push's trees: no question goes to GitHub, and every job the paths need runs.
  const paths = ["apps/fabrika/src/a.ts"];
  const { api, calls } = fakeApi({});
  const printed = await ci.outputs({ same: false, env: pushEnv, run: git(paths, ""), api });
  prints(printed, ci.jobs(paths, "push", false));
  expect(calls).toEqual([]);
});

it("property: a pull request or a merge queue's group never asks GitHub, and runs what jobs says", async () => {
  await fc.assert(
    fc.asyncProperty(
      changedPaths,
      fc.constantFrom("pull_request", "merge_group"),
      fc.boolean(),
      async (paths, event, draft) => {
        const { api, calls } = fakeApi({});
        const printed = await ci.outputs({ same: false, env: envOf(event, draft), run: pushGit(paths), api });
        prints(printed, ci.jobs(paths, event, draft));
        expect(printed["tested"]).toBe("");
        expect(calls).toEqual([]);
      },
    ),
    options,
  );
});

it("scenario: the GitHub reader asks only with a token, a repository and a workflow file, and fails on a bad answer", async () => {
  const runEnv = {
    GITHUB_TOKEN: "token",
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/check.yaml@refs/heads/main",
    GITHUB_API_URL: "https://api.example",
  };

  for (const missing of ["GITHUB_TOKEN", "GITHUB_REPOSITORY", "GITHUB_WORKFLOW_REF"]) {
    expect(ci.github({ ...runEnv, [missing]: "" }), missing).toBeNull();
  }

  const asked: { url: string; auth: string | undefined }[] = [];
  const answers: Record<string, unknown> = {
    runs: { workflow_runs: [passed] },
    commits: { tree: { sha: tree.head }, parents: [{ sha: queue.base }] },
  };
  const api = ci.github(runEnv, (url, init) => {
    asked.push({ url, auth: init.headers["authorization"] });
    const kind = Object.keys(answers).find((key) => url.includes(`/${key}`));
    return Promise.resolve({
      ok: kind !== undefined,
      status: kind === undefined ? 404 : 200,
      json: () => Promise.resolve(answers[kind ?? ""]),
    });
  });

  expect(api).not.toBeNull();
  expect(await api?.runs()).toEqual([passed]);
  expect(await api?.commit(queue.head)).toEqual({ tree: tree.head, parents: [queue.base] });
  expect(asked.map((a) => a.url)).toEqual([
    "https://api.example/repos/owner/repo/actions/workflows/check.yaml/runs?event=merge_group&status=success&exclude_pull_requests=true&per_page=50",
    `https://api.example/repos/owner/repo/git/commits/${queue.head}`,
  ]);
  expect(asked.every((a) => a.auth === "Bearer token")).toBe(true);

  const refused = ci.github(runEnv, () => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) }));
  await expect(refused?.runs()).rejects.toThrow("403");
});

// 0533: CI runs none of the tests of today's version, and 0539: the merge line runs no tooling test.
// No event, path list or draft flag turns today's tests, its app end to end or the tooling tests
// back on: there is no flag for them, in the flags or in what the script prints for check.yaml.
// workflow-lint.ts holds the other half: no job runs them (T1).
// Plants, each run once on changes.mjs and restored, each red: `today: touched` back in classify's
// flags; `e2e: true` back in the fallback `all`; `e2e: false` back in a draft's override.
const flagNames = ["build", "check", "field", "next", "typecheck"];
const anyEvent = fc.constantFrom("pull_request", "merge_group", "push", "workflow_dispatch", "schedule", "");

it("property: on every event, for any paths and either draft flag, no flag and no printed output starts today's tests, e2e or a tooling test", async () => {
  await fc.assert(
    fc.asyncProperty(paths, anyEvent, fc.boolean(), async (paths, event, draft) => {
      expect(Object.keys(ci.classify(paths, event)).toSorted()).toEqual(flagNames);
      expect(Object.keys(ci.jobs(paths, event, draft)).toSorted()).toEqual(flagNames);
      // Unreadable history is the fallback that runs every job.
      const run: Runner = paths === null ? () => ({ status: 128, stdout: "" }) : git(paths, "");
      const printed = await ci.outputs({ same: false, env: envOf(event, draft), run });
      expect(Object.keys(printed).toSorted()).toEqual([...flagNames, "filter", "probe", "tested"].toSorted());
    }),
    {
      ...options,
      examples: [
        // pinned: a push of today's app, which ran its six test machines and its e2e before 0533.
        [["apps/fabrika/src/a.ts"], "push", false],
        // pinned: a hand-started run, which ran every job.
        [null, "workflow_dispatch", false],
      ],
    },
  );
});
