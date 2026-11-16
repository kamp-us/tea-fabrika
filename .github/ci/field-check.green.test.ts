// Decision 0178 at review time: a merge-ready review row of a diff that adds or changes an
// `.integration.` law cites where those laws ran green, as `green`, a CI full run by its id or a
// box run by its command and head. Covers field-check.ts's `greenFinding`, the `green` shape in
// field-schema.ts, and the two readers of what a change adds or edits. No network: each git case
// runs in its own temp repo. Plants, each run once on field-check.ts and field-schema.ts and
// restored, are in this PR's lead row (field/runs/2026-11-15-review-integration-run-lead.json).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import * as checker from "./field-check.ts";

const options = { seed: 119120, numRuns: 100 };
const file = "field/runs/2026-11-16-a-review.json";

const dir = fc.constantFrom("next/apps/fabrika/src", "next/packages/tea-host/src", "packages/pipeline/src", "src");
const word = fc.stringMatching(/^[a-z][a-z-]{0,10}$/);

/** A law that needs a real resource, as vitest.config.ts names one. */
const law = fc
  .tuple(dir, word, fc.constantFrom("ts", "tsx"))
  .map(([d, name, ext]) => `${d}/${name}.integration.test.${ext}`);

/** A path that is no `.integration.` law, some of them close to one. */
const other = fc
  .tuple(
    dir,
    word,
    fc.constantFrom(".test.ts", ".visual.test.ts", ".ts", ".md", ".integration.md", "-integration.test.ts", ".json"),
  )
  .map(([d, name, end]) => `${d}/${name}${end}`);

const MERGE_READY = ["done", "pass"] as const;
const SENT_BACK = ["fail", "send", "parked", "stopped", "skip", null] as const;

/** A review's run row, valid in every core field, as a reviewer or drive.ts writes it. */
const review = (outcome: fc.Arbitrary<string | null>) =>
  fc.record({
    date: fc.constant("2026-11-16"),
    run: fc.constant("2026-11-16-a-review"),
    ticket: fc.constant(null),
    pr: fc.constant("kamp-us/tea-fabrika#1"),
    started: fc.constant("2026-11-16T10:00:00-08:00"),
    ended: fc.constant("2026-11-16T10:05:00-08:00"),
    parent: fc.constant(null),
    active: fc.constant(null),
    role: fc.constantFrom("review", "hand", "step"),
    model: fc.constantFrom("claude-opus-5-5", "gpt-5.5"),
    effort: fc.constant(null),
    outcome,
    why: fc.string({ maxLength: 40 }),
    tokens: fc.constant(null),
    tools: fc.constant(null),
    minutes: fc.integer({ min: 0, max: 90 }),
    note: fc.constant(null),
    driver_caused: fc.constant(false),
    costUsd: fc.constant(null),
    billed: fc.constant(null),
    step: fc.constant("review"),
  });

const sha = fc.stringMatching(/^[0-9a-f]{40}$/);

/** Each way a row cites the green run: a CI full run's id, or a box run's command and head. */
const green = fc.oneof(
  fc.record({ _tag: fc.constant("ci"), run: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }) }),
  fc.record({
    _tag: fc.constant("box"),
    command: fc.stringMatching(/^[a-z][ -~]{0,40}$/),
    head: sha,
  }),
);

/** A diff's changed paths, in any order, holding at least one `.integration.` law. */
const withLaws = fc
  .tuple(fc.array(law, { minLength: 1, maxLength: 6 }), fc.array(other, { maxLength: 6 }))
  .chain(([laws, rest]) => fc.shuffledSubarray([...laws, ...rest], { minLength: laws.length + rest.length }))
  .map((paths) => [...new Set(paths)]);

const check = (row: object, changed: ReadonlyArray<string>) =>
  checker.checkFile(file, "", `${JSON.stringify(row)}\n`, changed);

const greenErrors = (report: ReturnType<typeof checker.checkFile>) =>
  report.findings.filter((f) => f._tag === "error" && f.field === "green");

it("a merge-ready review of a diff that adds or changes an .integration. law, citing no run, is refused with what to add", () => {
  fc.assert(
    fc.property(review(fc.constantFrom(...MERGE_READY)), withLaws, (row, changed) => {
      const report = check(row, changed);
      const [found, ...rest] = greenErrors(report);
      const first = changed.find(checker.isIntegrationLaw)!;
      expect(report.exitCode).toBe(1);
      expect(rest).toEqual([]);
      expect(found?.reason).toContain(first);
      expect(found?.reason).toContain('"green": {"_tag": "ci", "run": ');
      expect(found?.reason).toContain('"green": {"_tag": "box", "command": ');
      expect(found?.reason).toContain('"head": ');
      expect(found?.reason).toContain("0178");
    }),
    options,
  );
});

it("a merge-ready review that cites a CI full run or a box run with its command and head passes", () => {
  fc.assert(
    fc.property(review(fc.constantFrom(...MERGE_READY)), green, withLaws, (row, cited, changed) => {
      const report = check({ ...row, green: cited }, changed);
      expect(greenErrors(report)).toEqual([]);
      expect(report.exitCode).toBe(0);
    }),
    options,
  );
});

it("a `green` that names no run, a short head, an empty command or another kind blocks as a bad field", () => {
  const bad = fc.oneof(
    fc.record({ _tag: fc.constant("ci"), run: fc.oneof(fc.integer({ max: 0 }), fc.double({ noInteger: true })) }),
    fc.record({ _tag: fc.constant("ci"), run: fc.stringMatching(/^[1-9][0-9]{0,11}$/) }),
    fc.record({ _tag: fc.constant("box"), command: fc.stringMatching(/^[ \t]*$/), head: sha }),
    fc.record({
      _tag: fc.constant("box"),
      command: fc.constant("pnpm test"),
      head: fc.oneof(
        fc.stringMatching(/^[0-9a-f]{7,39}$/),
        sha.map((s) => s.toUpperCase().replace(/^[0-9]/, "A")),
      ),
    }),
    fc.record({ _tag: fc.constant("box"), head: sha }),
    fc.record({ _tag: fc.constantFrom("local", "ci-run", ""), run: fc.integer({ min: 1 }) }),
  );
  fc.assert(
    fc.property(review(fc.constantFrom(...MERGE_READY, ...SENT_BACK)), bad, withLaws, (row, cited, changed) => {
      const report = check({ ...row, green: cited }, changed);
      expect(report.exitCode).toBe(1);
      expect(greenErrors(report).length).toBeGreaterThan(0);
    }),
    options,
  );
});

it("a diff with no .integration. law leaves a merge-ready review row as it was", () => {
  fc.assert(
    fc.property(
      review(fc.constantFrom(...MERGE_READY)),
      fc.array(other, { maxLength: 8 }),
      fc.option(green, { nil: undefined }),
      (row, changed, cited) => {
        const text = cited === undefined ? row : { ...row, green: cited };
        expect(check(text, changed)).toEqual(check(text, []));
        expect(greenErrors(check(text, changed))).toEqual([]);
      },
    ),
    options,
  );
});

it("a send-back review, or a row of another step, is unaffected by the diff's .integration. laws", () => {
  const notReview = review(fc.constantFrom(...MERGE_READY)).chain((row) =>
    fc.constantFrom("tests", "build", "plan", "lead").map((step) => ({ ...row, role: "hand", step })),
  );
  fc.assert(
    fc.property(fc.oneof(review(fc.constantFrom(...SENT_BACK)), notReview), withLaws, (row, changed) => {
      expect(check(row, changed)).toEqual(check(row, []));
    }),
    options,
  );
});

// The readers: what a change adds or edits, from its merge base, never what it deletes, and never
// what main added after the fork. Each file's change is drawn; the local reader matches the CI one
// once the writer commits.
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

const gitIn =
  (at: string) =>
  (args: string[]): { status: number | null; stdout: string } =>
    spawnSync(
      "git",
      ["-C", at, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
      { encoding: "utf8", env: gitEnv },
    );

it("the readers give each path a change adds or edits, laws included, and none it deletes or main added", () => {
  const paths = [
    "next/a/src/one.integration.test.ts",
    "next/a/src/two.integration.test.tsx",
    "next/a/src/three.test.ts",
    "docs/a.md",
  ];
  const how = fc.constantFrom("keep", "edit", "delete");
  fc.assert(
    fc.property(
      fc.array(how, { minLength: paths.length, maxLength: paths.length }),
      fc.constantFrom("keep", "stage", "untracked"),
      fc.boolean(),
      (changes, newLaw, mainMoves) => {
        const at = mkdtempSync(join(tmpdir(), "ci-field-green-"));

        try {
          const git = gitIn(at);
          const write = (path: string, body: string) => {
            mkdirSync(dirname(join(at, path)), { recursive: true });
            writeFileSync(join(at, path), body);
          };
          const commit = (message: string) => {
            expect(git(["add", "-A"]).status).toBe(0);
            expect(git(["commit", "-q", "--allow-empty", "-m", message]).status).toBe(0);
            return git(["rev-parse", "HEAD"]).stdout.trim();
          };
          expect(git(["init", "-q", "-b", "main"]).status).toBe(0);

          for (const path of paths) {
            write(path, "a\n");
          }

          commit("fork");
          expect(git(["checkout", "-q", "-b", "pr"]).status).toBe(0);

          if (mainMoves) {
            expect(git(["checkout", "-q", "main"]).status).toBe(0);
            write("next/a/src/later.integration.test.ts", "main\n");
            write(paths[0]!, "main edits\n");
            commit("main moves ahead");
            expect(git(["checkout", "-q", "pr"]).status).toBe(0);
          }

          const plan = [...changes.map((c, i) => [paths[i]!, c] as const), ["next/b/new.integration.test.ts", newLaw]];
          const expected: string[] = [];

          for (const [path, c] of plan) {
            if (c === "edit") {
              write(path, "edited\n");
              expected.push(path);
            } else if (c === "delete") {
              rmSync(join(at, path));
            } else if (c === "stage" || c === "untracked") {
              write(path, `new ${path}\n`);
              expected.push(path);

              if (c === "stage") {
                expect(git(["add", "--", path]).status).toBe(0);
              }
            }
          }

          const local = checker.readLocalChanged("main", git);
          const base = git(["rev-parse", "main"]).stdout.trim();
          const head = commit("the writer commits");
          const ci = checker.readChanged(base, head, "pull_request", git);
          expect(ci.toSorted()).toEqual(expected.toSorted());
          expect(local).toEqual(ci.toSorted());
        } finally {
          rmSync(at, { recursive: true, force: true });
        }
      },
    ),
    { ...options, numRuns: 25 },
  );
});

it("the readers refuse history they cannot read, never an empty list", () => {
  // readChanged reads twice (merge-base, diff) and readLocalChanged three times (merge-base, diff,
  // ls-files): a failure at any one of them throws.
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 2 }), sha, sha, (fail, base, head) => {
      const failingAt = (at: number) => {
        let i = 0;
        return (args: string[]) =>
          i++ === at
            ? { status: 128, stdout: "" }
            : { status: 0, stdout: args[0] === "merge-base" ? `${base}\n` : "a.integration.test.ts\0" };
      };
      expect(() => checker.readLocalChanged("origin/main", failingAt(fail))).toThrow("field: Git could not read");
      expect(() => checker.readChanged(base, head, "pull_request", failingAt(fail % 2))).toThrow(
        "field: Git could not read",
      );
    }),
    options,
  );
});
