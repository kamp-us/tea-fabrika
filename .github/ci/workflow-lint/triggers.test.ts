import { spawnSync } from "node:child_process";
import { pipe, String as Str } from "effect";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { ignored, jobs } from "../changes.mjs";
import { isFieldPath } from "../field-check.ts";
import { options, type Plant, rejects, type Workflow } from "./wiring.test-support.ts";

// Today's CI, serving both versions. Covers triggers.ts: the events, ignored paths, cancels and
// draft names. Each plant is given to every generated valid workflow alone (wiring.test-support.ts),
// so an unrelated error cannot mask it.

// Ticket 988. A pull request whose every path matches check.yaml's `paths-ignore` starts no run, so
// each such path must be one changes.mjs already runs no heavy job for: every job changes.mjs
// names stays off, on a draft and on a ready pull request. Only the field flag
// may be on, for a row, and `pnpm lint` checks rows (field-check.ts --local). The paths are made
// from each pattern, each `*` any name without a `/` as in GitHub's filters (the lint allows no
// other wildcard), with the repo's own tracked files that match. Plants, each run once on
// changes.mjs and restored: `plan` as a folder a program reads (red); `docs/` as a read tree (red).
const globOf = (glob: string) =>
  new RegExp(
    `^${pipe(glob, Str.split("*"))
      .map((part) => pipe(part, Str.replace(/[.^$+?()[\]{}|\\]/g, String.raw`\$&`)))
      .join("[^/]*")}$`,
  );

const ignoredBy = (path: string) => ignored.some((glob) => globOf(glob).test(path));

const fill = fc
  .string({ maxLength: 12 })
  .filter((text) => !pipe(text, Str.includes("/")) && !pipe(text, Str.includes("\0")));

const fromGlob = fc.constantFrom(...ignored).chain((glob) => {
  const [first = "", ...rest] = pipe(glob, Str.split("*"));
  return fc
    .array(fill, { minLength: rest.length, maxLength: rest.length })
    .map((fills) => rest.reduce((path, part, i) => `${path}${fills[i]}${part}`, first));
});

const tracked = pipe(spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" }).stdout, Str.split("\0")).filter(
  (path) => path !== "" && ignoredBy(path),
);

it("ticket 988: every path a pull request ignores runs no heavy job in changes.mjs, on a draft and a ready one", () => {
  expect(tracked.length).toBeGreaterThan(0);
  fc.assert(
    fc.property(
      fc.array(fc.oneof(fromGlob, fc.constantFrom(...tracked)), { minLength: 1, maxLength: 4 }),
      fc.boolean(),
      (paths, draft) => {
        expect(paths.every(ignoredBy)).toBe(true);
        // Every job but the field rows' is off, whatever jobs changes.mjs grows or drops.
        const { field, ...heavy } = jobs(paths, "pull_request", draft);
        expect(Object.keys(heavy).length).toBeGreaterThan(0);
        expect(Object.entries(heavy).filter(([, on]) => on)).toEqual([]);
        expect(field).toBe(paths.some(isFieldPath));
      },
    ),
    {
      ...options,
      examples: [
        // Pull request 1248, the waste ticket 988 names: one plan from before the rename (0546),
        // in the old folder, and two finding rows.
        [
          [
            "docs/plan/lanes/t290-s2-PLAN.md",
            "field/findings/2026-11-14-a-row.json",
            "field/findings/2026-11-14-another-row.json",
          ],
          true,
        ],
        [["docs/plan/quests/t290-s2-PLAN.md", "field/findings/2026-11-14-a-row.json"], true],
        [["docs/plan/.md", "field/runs/.json"], false],
      ],
    },
  );
});

it("0546: a quest plan is ignored in docs/plan/quests/ and, for a pull request still open, in the old docs/plan/lanes/", () => {
  for (const folder of ["quests", "lanes"]) {
    const plan = `docs/plan/${folder}/t290-s2-PLAN.md`;
    expect(ignoredBy(plan), plan).toBe(true);

    for (const draft of [true, false]) {
      const { field, ...heavy } = jobs([plan], "pull_request", draft);
      expect(Object.entries(heavy).filter(([, on]) => on)).toEqual([]);
      expect(field).toBe(false);
    }
  }
});

it("pinned: ticket 988's list leaves out what changes.mjs or a reader still checks", () => {
  // A folder a program reads, skill prose, the old logs, a row of the wrong kind and a nested plan
  // folder all start the run: each is outside the list.
  for (const path of [
    "docs/plan/brief/x.md",
    "docs/plan/quests/prompts/x.md",
    "docs/plan/lanes/prompts/x.md",
    ".agents/skills/lead/SKILL.md",
    "field/runs.jsonl",
    "field/findings/x.md",
    "field/findings/a/b.json",
    "docs/plan/x.ts",
    "AGENTS.md",
  ]) {
    expect(ignoredBy(path), path).toBe(false);
  }
});

const plants: Plant[] = [
  // 0134's amendment (2026-11-11): a draft runs the fast jobs, and marking it ready runs the rest.
  // 0536: `labeled` is how the `visual` label starts the visual legs.
  ...["opened", "synchronize", "reopened", "ready_for_review", "labeled"].map(
    (type): [string, (w: Workflow) => void] => [
      `pull requests lose the ${type} trigger`,
      (w) => {
        w.on.pull_request.types = w.on.pull_request.types.filter((t) => t !== type);
      },
    ],
  ),
  // Ticket 988: a pull request ignores exactly changes.mjs's `ignored`, and no other trigger ignores
  // a path.
  [
    "pull requests ignore one more path",
    (w) => {
      w.on.pull_request["paths-ignore"] = [...ignored, "apps/**"];
    },
  ],
  [
    "pull requests ignore one path fewer",
    (w) => {
      w.on.pull_request["paths-ignore"] = ignored.slice(1);
    },
  ],
  [
    "pull requests lose the ignore list",
    (w) => {
      // JSON.stringify leaves an undefined key out, as a deleted one.
      w.on.pull_request["paths-ignore"] = undefined;
    },
  ],
  [
    "pull requests ignore every plan file, a brief folder's included",
    (w) => {
      w.on.pull_request["paths-ignore"] = [
        "docs/plan/**",
        ...ignored.filter((glob) => !pipe(glob, Str.startsWith("docs/plan/"))),
      ];
    },
  ],
  [
    "a push to main ignores the same paths",
    (w) => {
      Object.assign(w.on.push, { "paths-ignore": [...ignored] });
    },
  ],
  [
    "the merge queue's group ignores the same paths",
    (w) => {
      Object.assign(w.on.merge_group, { "paths-ignore": [...ignored] });
    },
  ],
  [
    "the merge queue's group stops running the checks",
    (w) => {
      delete (w.on as Record<string, unknown>)["merge_group"];
    },
  ],
  [
    "every pull request event cancels the run before it",
    (w) => {
      w.concurrency["cancel-in-progress"] = `\${{ github.event_name == 'pull_request' }}`;
    },
  ],
  [
    "a draft's check keeps the name check",
    (w) => {
      w.jobs.check.name = "check";
    },
  ],
  [
    "a draft's ci-required keeps the name ci-required",
    (w) => {
      w.jobs["ci-required"].name = "ci-required";
    },
  ],
  [
    "the visual label's run no longer cancels the run it repeats",
    (w) => {
      w.concurrency["cancel-in-progress"] =
        `\${{ github.event_name == 'pull_request' && github.event.action == 'synchronize' }}`;
    },
  ],
  [
    "every label's run cancels the run before it",
    (w) => {
      w.concurrency["cancel-in-progress"] =
        `\${{ github.event_name == 'pull_request' && (github.event.action == 'synchronize' || github.event.action == 'labeled') }}`;
    },
  ],
  [
    "workflow path filter",
    (w) => {
      Object.assign(w.on, { pull_request: { paths: ["next/**"] } });
    },
  ],
  [
    "main filter",
    (w) => {
      w.on.push.branches = ["other"];
    },
  ],
];

rejects(plants);
