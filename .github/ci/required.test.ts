import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { it as property } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { jobs } from "./changes.mjs";
import { gated, gates, judge } from "./required.mjs";

// Today's CI for both versions. Covers required.mjs, the `ci-required` job's verdict. Each law
// names the edge case it holds from the list at the top of required.mjs.
const options = { seed: 119120, numRuns: 100 };

property.prop(
  "an empty related selection permits a skip only after successful explicit selection",
  { run: Schema.Literals(["false", "true", "", "unknown"]) },
  ({ run }) => {
    const needs = {
      changes: { result: "success", outputs: { related: "true" } },
      check: { result: "success" },
      typecheck: { result: "success" },
      next: { result: "success" },
      select: { result: "success", outputs: { run } },
      related: { result: "skipped" },
    };
    expect(judge(needs).pass).toBe(run === "false");
    expect(judge({ ...needs, select: { result: "failure", outputs: { run } } }).pass).toBe(false);
    expect(judge({ ...needs, select: { result: "success", outputs: {} } }).pass).toBe(false);
  },
  { arbitrary: { seed: 119120, numRuns: 100 } },
);

type Job = { result?: unknown; outputs?: Record<string, unknown> };

const ungated = fc.constantFrom("changes", "field", "legs", "lint", "extra-job");

const bad = fc.constantFrom("failure", "cancelled", "", "neutral", undefined, 1);

const flag = fc.constantFrom("true", "false", "", undefined);

const result = fc.constantFrom("success", "skipped", "failure", "cancelled", "");

// A workflow's needs where every job passed; gated jobs skip when their flag is "false".
const green = fc.tuple(...gated.map(() => fc.constantFrom("true", "false"))).map((flags) => {
  const outputs: Record<string, string | undefined> = Object.fromEntries(
    gated.flatMap((name, i) => gates[name].map((flag) => [flag, flags[i]])),
  );

  const needs: Record<string, Job> = { changes: { result: "success", outputs } };

  for (const name of gated) {
    needs[name] = {
      result: gates[name].every((flag) => outputs[flag] === "false") ? "skipped" : "success",
      outputs: {},
    };
  }

  return needs;
});

it("1, 9: every job success passes, whatever changes said, and each needs entry gets one line", () => {
  fc.assert(
    fc.property(green, (needs) => {
      for (const job of Object.values(needs)) {
        job.result = "success";
      }

      const verdict = judge(needs);
      expect(verdict.pass).toBe(true);
      expect(verdict.lines).toHaveLength(Object.keys(needs).length);
    }),
    options,
  );
});

it("2, 3, 4: a gated skip passes only when changes succeeded and said exactly false", () => {
  fc.assert(
    fc.property(
      green,
      fc.constantFrom(...gated),
      flag,
      fc.constantFrom("success", "failure", "cancelled", "skipped"),
      (needs, name, said, changes) => {
        needs["changes"]!.result = changes;

        for (const own of gates[name]) {
          needs["changes"]!.outputs![own] = said;
        }

        needs[name]!.result = "skipped";
        const others = gated.filter((other) => other !== name && needs[other]!.result === "skipped");

        const meant = (job: (typeof gated)[number]) =>
          changes === "success" && gates[job].every((own) => needs["changes"]!.outputs![own] === "false");

        const expected = changes === "success" && meant(name) && others.every(meant);
        expect(judge(needs).pass).toBe(expected);
      },
    ),
    options,
  );
});

it("10: check, which also holds the field row check, skips only when check and field both said exactly false", () => {
  // Field rows alone start check for its row step. Plant, run once on required.mjs and restored:
  // gates.check as ["check"] alone (red: a skip with field "true" passed).
  fc.assert(
    fc.property(green, flag, flag, (needs, check, rows) => {
      needs["changes"]!.outputs!["check"] = check;
      needs["changes"]!.outputs!["field"] = rows;
      needs["check"] = { result: "skipped", outputs: {} };
      const others = gated.filter((other) => other !== "check" && needs[other]!.result === "skipped");
      const meant = check === "false" && rows === "false";
      expect(judge(needs).pass).toBe(
        meant && others.every((job) => gates[job].every((flag) => needs["changes"]!.outputs![flag] === "false")),
      );
      expect(judge(needs).lines).toContain(
        meant ? "check: skipped, as changes said, pass" : "check: skipped, but it should have run, fail",
      );
    }),
    options,
  );
});

it("scenario: the gates are the jobs check.yaml gates, with check on its own flag and field", () => {
  expect(gates).toEqual({
    check: ["check", "field"],
    typecheck: ["typecheck"],
    next: ["next"],
    select: ["related"],
    related: ["related"],
  });
});

it("5: an ungated job that skipped fails, even when changes has an output of its name", () => {
  fc.assert(
    fc.property(green, ungated, (needs, name) => {
      needs["changes"]!.outputs![name] = "false";
      needs[name] = { result: "skipped", outputs: {} };
      const verdict = judge(needs);
      expect(verdict.pass).toBe(false);
      expect(verdict.lines).toContain(`${name}: skipped, but it should have run, fail`);
    }),
    options,
  );
});

it("6: a failed, cancelled, empty or unknown result fails, whatever the output says", () => {
  fc.assert(
    fc.property(green, fc.constantFrom("changes", ...gated), bad, flag, (needs, name, value, said) => {
      needs["changes"]!.outputs![name] = said;
      needs[name] = { result: value };
      expect(judge(needs).pass).toBe(false);
    }),
    options,
  );
});

it("7: changes or a gated job missing from needs fails, and is named", () => {
  fc.assert(
    fc.property(green, fc.constantFrom("changes", ...gated), (needs, name) => {
      delete needs[name];
      const verdict = judge(needs);
      expect(verdict.pass).toBe(false);
      expect(verdict.lines).toContain(`${name}: not in needs, fail`);
    }),
    options,
  );
});

it("the verdict passes exactly when every job passes on its own", () => {
  // An oracle written apart from the judge: random results and flags for every job.
  fc.assert(
    fc.property(
      fc.record({ changes: result, field: flag }),
      fc.tuple(...gated.map(() => fc.tuple(result, flag))),
      (top, rows) => {
        const outputs: Record<string, string | undefined> = {
          ...Object.fromEntries(gated.map((name, i) => [name, rows[i]![1]])),
          field: top.field,
        };

        const needs: Record<string, Job> = {
          changes: { result: top.changes, outputs },
          ...Object.fromEntries(gated.map((name, i) => [name, { result: rows[i]![0] }])),
        };

        const passes = (name: string) =>
          needs[name]!.result === "success" ||
          (needs[name]!.result === "skipped" &&
            (gated as readonly string[]).includes(name) &&
            top.changes === "success" &&
            (Object.entries(gates).find(([gate]) => gate === name)?.[1] ?? []).every(
              (flag) => outputs[flag] === "false",
            ) &&
            (name !== "check" || top.field === "false"));

        expect(judge(needs).pass).toBe(Object.keys(needs).every(passes));
      },
    ),
    options,
  );
});

it.each([null, undefined, [], {}, "success", 0, [{ result: "success" }]])("vector: needs %j cannot pass", (needs) => {
  expect(judge(needs).pass).toBe(false);
});

it("scenario: the main reads NEEDS from env, prints one line per job and exits 1 on a fail", () => {
  const script = fileURLToPath(new URL("./required.mjs", import.meta.url));

  const run = (needs: string | undefined) =>
    spawnSync(process.execPath, [script], { encoding: "utf8", env: needs === undefined ? {} : { NEEDS: needs } });

  const good = JSON.stringify({
    changes: {
      result: "success",
      outputs: { check: "false", field: "false", typecheck: "false", next: "true", related: "false" },
    },
    check: { result: "skipped", outputs: {} },
    typecheck: { result: "skipped", outputs: {} },
    next: { result: "success", outputs: {} },
    select: { result: "skipped", outputs: {} },
    related: { result: "skipped", outputs: {} },
  });

  const ok = run(good);
  expect(ok.status).toBe(0);
  expect(ok.stdout).toContain("check: skipped, as changes said, pass\n");
  expect(ok.stdout).toContain("typecheck: skipped, as changes said, pass\n");
  expect(ok.stdout.trim().split("\n")).toHaveLength(7);
  expect(run(good.replace('"next":{"result":"success"', '"next":{"result":"failure"')).status).toBe(1);
  expect(run("{not json").status).toBe(1);
  expect(run(undefined).status).toBe(1);
});

// 0134's amendment (2026-11-11): changes.mjs's `jobs` decides what a draft and a ready pull request
// run, and this judge reads the same outputs. A draft's skips pass; on a ready pull request, any
// job its flags said must run that skips or fails cannot pass, so the heavy jobs a draft skipped
// cannot be skipped again once it is ready.
const paths = fc.option(
  fc.array(
    fc.constantFrom("docs/a.md", "next/packages/libfabrika/src/a.ts", "apps/fabrika/src/a.ts", "pnpm-lock.yaml"),
    { maxLength: 4 },
  ),
  { nil: null },
);

/** The needs one run gives when every job its flags turned on passed, from changes.mjs's own flags. */
const ran = (flags: Record<string, boolean>): Record<string, Job> => {
  const outputs = {
    ...Object.fromEntries(Object.entries(flags).map(([name, on]) => [name, String(on)])),
    related: "false",
  };
  const needs: Record<string, Job> = { changes: { result: "success", outputs } };

  // A job runs when any of its flags is on: check for lint or for field rows.
  for (const name of gated) {
    needs[name] = { result: gates[name].some((flag) => flags[flag]) ? "success" : "skipped" };
  }

  return needs;
};

// 0174: a merge queue's group skips jobs by its paths, and the queue takes this one check from it.
it("property: a merge queue's group passes with the jobs its paths skip; it fails when a job it needs skips", () => {
  fc.assert(
    fc.property(
      paths,
      fc.constantFrom(...gated),
      fc.constantFrom("skipped", "failure", "cancelled"),
      (p, name, end) => {
        const group = jobs(p, "merge_group", false);
        expect(judge(ran(group)).pass).toBe(true);
        fc.pre(group[name]);
        const needs = ran(group);
        needs[name] = { result: end };
        expect(judge(needs).pass).toBe(false);
      },
    ),
    // pinned: Markdown alone, where every gated job skips.
    { ...options, examples: [[["docs/a.md"], "check", "skipped"]] },
  );
});

// 0175: a push to main skips the jobs its paths do not need.
it("property: a push passes with the jobs its paths skip; it fails when a job it needs skips", () => {
  fc.assert(
    fc.property(
      paths,
      fc.constantFrom(...gated),
      fc.constantFrom("skipped", "failure", "cancelled"),
      (p, name, end) => {
        const push = jobs(p, "push", false);
        expect(judge(ran(push)).pass).toBe(true);
        fc.pre(push[name]);
        const needs = ran(push);
        needs[name] = { result: end };
        expect(judge(needs).pass).toBe(false);
      },
    ),
    // pinned: next/ alone, where check runs on main.
    { ...options, examples: [[["next/packages/libfabrika/src/a.ts"], "check", "skipped"]] },
  );
});

// 0534: on the merge queue's group and a push to main, next runs the tests their change reaches, so
// it skips when the size step picked none (changes' `next`, which the size step prints first). That
// skip passes, as changes said. No run has a test job to skip since 0539.
it("property: on the merge line past the pull request a skipped next passes only when changes said so", () => {
  // Plant: let a skip pass on any flag but "true" (red: next skipped with the size step's output
  // empty passed).
  const line = fc.option(
    fc.array(
      fc.constantFrom(
        "docs/a.md",
        "next/packages/libfabrika/src/a.ts",
        ".github/workflows/check.yaml",
        ".github/ci/legs.ts",
        "oxlint-plugins/a.mjs",
        "pnpm-lock.yaml",
      ),
      { maxLength: 4 },
    ),
    { nil: null },
  );

  fc.assert(
    fc.property(
      line,
      fc.constantFrom("merge_group", "push"),
      fc.constantFrom("true", "false", ""),
      (p, event, said) => {
        const flags = jobs(p, event, false);
        expect(judge(ran(flags)).pass).toBe(true);
        // The size step's `next`: "false" when it picked no next/ test file; "true" or empty otherwise.
        fc.pre(flags.next);
        const sized = ran(flags);
        sized["changes"]!.outputs!["next"] = said;
        sized["next"] = { result: "skipped" };
        expect(judge(sized).pass).toBe(said === "false");
      },
    ),
    {
      ...options,
      // pinned: a CI change alone, which ran all of next/ and every tooling test in each queue group.
      examples: [[[".github/workflows/check.yaml"], "merge_group", "false"]],
    },
  );
});

it("property: a draft passes with its heavy jobs skipped; a ready PR fails when a job it needs skips", () => {
  fc.assert(
    fc.property(
      paths,
      fc.constantFrom(...gated),
      fc.constantFrom("skipped", "failure", "cancelled"),
      (p, name, end) => {
        expect(judge(ran(jobs(p, "pull_request", true))).pass).toBe(true);
        const ready = jobs(p, "pull_request", false);
        expect(judge(ran(ready)).pass).toBe(true);
        fc.pre(ready[name]);
        const needs = ran(ready);
        needs[name] = { result: end };
        expect(judge(needs).pass).toBe(false);
      },
    ),
    options,
  );
});

// Ticket 990, fail fast: on a pull request or a merge queue group, the first red job cancels its
// run. Its own result is `failure` (or `cancelled`, when the cancel reaches it before it ends); a job
// still running ends `cancelled` or, as a matrix, folds a canceled leg into its result; a job not yet
// started skips, since its `!cancelled()` is now false, while its flag still said it runs. Whatever
// the others ended as, such a run never passes: a leg canceled because a sibling failed is no pass.
it("property: a run stopped at its first red job never passes", () => {
  const succeeded = (needs: Record<string, Job>) =>
    Object.keys(needs).filter((name) => needs[name]!.result === "success");

  fc.assert(
    fc.property(
      paths,
      fc.constantFrom("pull_request", "merge_group"),
      fc.nat(),
      fc.constantFrom("failure", "cancelled"),
      fc.array(fc.constantFrom("success", "cancelled", "skipped"), { minLength: 7, maxLength: 7 }),
      (p, event, pick, own, ends) => {
        const needs = ran(jobs(p, event, false));
        const started = succeeded(needs);
        const red = started[pick % started.length]!;

        for (const [i, name] of started.filter((name) => name !== red).entries()) {
          needs[name]!.result = ends[i % ends.length];
        }

        needs[red]!.result = own;
        expect(judge(needs).pass).toBe(false);
      },
    ),
    // pinned: run 43633120187's shape, check (lint) red, typecheck and next stopped mid-run.
    {
      ...options,
      examples: [
        [
          ["next/packages/libfabrika/src/a.ts", "apps/fabrika/src/a.ts"],
          "merge_group",
          2,
          "failure",
          ["success", "success", "cancelled", "skipped", "cancelled", "cancelled", "cancelled"],
        ],
      ],
    },
  );
});
