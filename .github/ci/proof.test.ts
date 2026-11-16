import { readFileSync } from "node:fs";
import { Match } from "effect";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { rowsAt } from "../../vitest.shards.ts";
import { E2E_SETUP, room } from "./legs.ts";
import {
  choose,
  isTrigger,
  legsOf,
  outputs,
  PROJECTS,
  type Proof,
  type Seen,
  type Sizing,
  summary,
  triggered,
  whole,
} from "./proof.ts";

// Today's CI, serving both versions. Covers proof.ts, which picks what a branch's proof run tests
// (0590): the full set when the change touches a rerun trigger, else the tests Vitest's `--changed`
// lists, split into as many legs as they need. The triggers and their match are vitest.config.ts's
// own; seconds come from scratch tables, so a law holds for any table, not only today's. Each plant
// was run once on proof.ts and restored; each turned its law red.
const options = { seed: 119120, numRuns: 100 };

const sha = (c: string) => c.repeat(40);

const seen = (changed: readonly string[]): Seen => ({
  base: sha("b"),
  head: sha("h"),
  at: "2026-11-15T20:00:00.000Z",
  vitest: "5.0.5",
  changed,
});

const workflow = parse(readFileSync(new URL("../workflows/scheduled.yaml", import.meta.url), "utf8")) as {
  jobs: Record<string, { steps: Record<string, unknown>[]; strategy?: Record<string, unknown> }>;
};

const setStep = workflow.jobs["select"]!.steps.find((s) => s["id"] === "set")! as { env: Record<string, number> };

// The real sizing, as the select step's env gives it: MOST and the legs' test step limit.
const real: Sizing = {
  most: setStep.env["MOST"]!,
  limit: room(setStep.env["LIMIT"]!, E2E_SETUP),
  table: rowsAt("full"),
};

// The files 0590 names, and others under each trigger glob: a config, the lint config, a tsconfig,
// the lockfile and any package.json, at the top or in a package.
const TRIGGERS = [
  "vitest.config.ts",
  ".oxlintrc.json",
  "tsconfig.base.json",
  "next/packages/libfabrika/tsconfig.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package.json",
  "next/packages/libfabrika/package.json",
  "oxlint-plugins/script-reads.mjs",
  ".agents/skills/lead/scripts/fixtures/repo/a.txt",
];

// Files that reach tests only through the import graph or a watched file, never every test.
const PLAIN = [
  "next/packages/libfabrika/src/node/Watchers.ts",
  ".github/ci/gate.mjs",
  ".github/workflows/scheduled.yaml",
  "vitest.shards.json",
  "vitest.shards.ts",
  "docs/plan/README.md",
  ".decisions/0590-a-branch-proof-run-runs-only-what-its-change-reaches.md",
];

it("pinned: a change to any rerun trigger 0590 names runs the full set, whatever Vitest would list", () => {
  // Plants, each run once on proof.ts and restored: `choose` ignores its triggers (red: every case
  // splits a list); `isTrigger` drops `dot: true` (red: .oxlintrc.json reads as plain).
  for (const path of TRIGGERS) {
    expect(isTrigger(path), path).toBe(true);

    const proof = choose(
      seen(["next/a.ts", path]),
      triggered(["next/a.ts", path], isTrigger),
      ["next/a.test.ts"],
      real,
    );

    const { base, head, at, vitest } = seen([]);
    expect(proof, path).toStrictEqual({ _tag: "full", base, head, at, vitest, triggers: [path] });
    expect(outputs(proof), path).toEqual(["scope=full", "legs=[]", "files={}"]);
  }

  for (const path of PLAIN) {
    expect(isTrigger(path), path).toBe(false);
  }
});

it("property: the full set's triggers are exactly the changed files that match, in git's order", () => {
  fc.assert(
    fc.property(fc.subarray([...TRIGGERS, ...PLAIN]), (changed) => {
      const found = triggered(changed, isTrigger);
      expect(found).toEqual(changed.filter((path) => TRIGGERS.includes(path)));
      expect(choose(seen(changed), found, [], real)._tag).toBe(found.length > 0 ? "full" : "changed");
    }),
    options,
  );
});

it("pinned: a changed set of zero files is a green run with no leg, and its record and summary say so", () => {
  // Plant, run once on proof.ts and restored: `outputs` gives one empty leg (red: `legs=["1"]`).
  const proof = choose(seen(["docs/plan/README.md"]), [], [], real);
  expect(proof).toEqual({ ...seen(["docs/plan/README.md"]), _tag: "changed", legs: {}, seconds: {} });
  expect(outputs(proof)).toEqual(["scope=changed", "legs=[]", "files={}"]);
  expect(summary(proof)).toContain("no leg starts and the run is green");
});

// Test files, distinct, some with a row in a scratch table and some with none.
const set = fc
  .uniqueArray(fc.stringMatching(/^next\/[a-z]{1,8}\/[a-z]{1,8}\.test\.ts$/), { maxLength: 40 })
  .chain((files) =>
    fc
      .tuple(
        fc.array(fc.option(fc.integer({ min: 0, max: 600 }), { nil: undefined }), {
          minLength: files.length,
          maxLength: files.length,
        }),
        fc.integer({ min: 1, max: 9 }),
        fc.integer({ min: 60, max: 900 }),
      )
      .map(([rows, most, limit]) => ({
        files,
        sizing: {
          most,
          limit,
          table: Object.fromEntries(
            files.flatMap((path, i) => (rows[i] === undefined ? [] : [[path, rows[i]]])),
          ) as Record<string, number>,
        },
      })),
  );

it("property: the legs hold every file of the set once, numbered from 1, at most MOST, and one leg when it fits one", () => {
  // Plants, each run once on proof.ts and restored: `legsOf` takes `most` legs always (red: a small
  // set gets several legs); it drops the last leg (red: a file is missing).
  fc.assert(
    fc.property(set, ({ files, sizing }) => {
      const legs = legsOf(files, sizing);
      const names = Object.keys(legs);
      expect(names).toEqual(names.map((_, i) => `${i + 1}`));
      expect(names.length).toBeLessThanOrEqual(sizing.most);
      expect(Object.values(legs).flat().toSorted()).toEqual([...files].toSorted());
      expect(names.length === 0).toBe(files.length === 0);
      const values = Object.values(sizing.table);
      const unmeasured = values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) / 2)] ?? 1;
      const total = files.reduce((sum, path) => sum + (sizing.table[path] ?? unmeasured), 0);

      if (files.length > 0 && total <= sizing.limit) {
        expect(names).toEqual(["1"]);
      }
    }),
    options,
  );
});

it("property: the outputs give the changed job its legs and each leg its files as one line of words", () => {
  fc.assert(
    fc.property(set, ({ files, sizing }) => {
      const proof = choose(seen(["next/a/b.ts"]), [], files, sizing);
      const [scope, legs, lists] = outputs(proof);
      expect(scope).toBe("scope=changed");
      const parsed: string[] = JSON.parse(legs!.slice("legs=".length));
      const words: Record<string, string> = JSON.parse(lists!.slice("files=".length));
      expect(parsed).toEqual(Object.keys(words));
      expect(parsed.flatMap((leg) => words[leg]!.split(" ")).toSorted()).toEqual([...files].toSorted());
      expect(Match.valueTags(proof, { changed: (changed) => Object.keys(changed.seconds), full: () => false })).toEqual(
        parsed,
      );
    }),
    options,
  );
});

it("pinned: a test file whose path holds a space throws, so the step prints nothing and the run is red", () => {
  expect(() => choose(seen(["a.ts"]), [], ["next/a b.test.ts"], real)).toThrow(/space/);
});

it("pinned: MOST and LIMIT must be positive whole numbers", () => {
  expect(whole("MOST", "9")).toBe(9);

  for (const value of [undefined, "", " ", "0", "-1", "1.5", "nine"]) {
    expect(() => whole("MOST", value), String(value)).toThrow(/MOST/);
  }
});

it("pinned: the changed legs run every project proof.ts lists, and no other, and the record keeps what a run tested", () => {
  // Plant, run once on proof.ts and restored: `PROJECTS` drops next-visual (red: the workflow's list
  // differs).
  const command = String(workflow.jobs["changed"]!.steps.find((s) => s["name"] === "vitest")!["run"]);
  const projects = [...command.matchAll(/--project (\S+)/g)].map((found) => found[1]);
  expect(projects).toEqual([...PROJECTS]);
  expect(workflow.jobs["changed"]!.strategy!["max-parallel"]).toBe(real.most);

  const proof: Proof = choose(seen(["next/a/b.ts"]), [], ["next/a/b.test.ts"], real);
  expect(Object.keys(proof).toSorted()).toEqual(
    ["_tag", "at", "base", "changed", "head", "legs", "seconds", "vitest"].toSorted(),
  );
});
