import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Order from "effect/Order";
import * as fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createVitest, type Vitest, type TestSpecification } from "vitest/node";
import { parse } from "yaml";
import { measured } from "../../vitest.shards.ts";
import { vitestLegs } from "./workflow-lint.ts";

// Today's CI for both versions. Vitest 5.0.5's public node API, read in
// dist/chunks/plugin.d.C8mmycim.d.ts and cli-api.De07GUeT.js: `related` takes absolute
// paths; getRelevantTestSpecifications runs its own affected resolver without executing tests.
// Keep the real config and every test in the walk, including tests outside the skills folders.
// T375 plants caught: restoring skill force triggers selects every test; deleting box.test.ts's
// box.sh declaration omits that test. The latter first survived mixed subsets; singletons catch it.
// Since the reads are derived (oxlint-plugins/script-reads.mjs), the same plant is dropping the
// vitest.config.ts plugin that hands them to Vitest: every script alone then selects no test.
const root = join(import.meta.dirname, "../..");

const files = pipe(
  readdirSync(join(root, ".agents/skills"), { recursive: true, withFileTypes: true }),
  Arr.filter((entry) => entry.isFile()),
  Arr.map((entry) => relative(root, join(entry.parentPath, entry.name))),
);

// A `fixtures/` folder under a skill's scripts holds data, not scripts. vitest.config.ts leaves it
// out of the tests (`EXCLUDE`) and makes any change to it select every test (`**/fixtures/**` in
// `forceRerunTriggers`), so its files are never held to "exactly their declaring tests". The
// fixture law below holds them to that rule instead.
const FIXTURE = /\/scripts\/(?:.+\/)?fixtures\//;
const fixtures = Arr.filter(files, (path) => FIXTURE.test(path));

// Any depth under `scripts/`, as vitest.config.ts includes tests there (the flow runner's `flow/`).
const tree = new Map(
  pipe(
    files,
    Arr.filter((path) => /\/scripts\/.+$/.test(path) && !FIXTURE.test(path)),
    Arr.map((path) => [path, readFileSync(join(root, path), "utf8")]),
  ),
);

const scripts = Arr.filter([...tree.keys()], (path) => !path.endsWith(".test.ts"));
const tests = Arr.filter([...tree.keys()], (path) => path.endsWith(".test.ts"));

// Independent expected readers: follow source names, not the derivation under test.
// This intentionally shares its over-match of names in comments and fixture strings. A name may
// hold a dot, as `catchup.test-support.ts` does.
const readers = new Map(
  Arr.map(tests, (test) => {
    const reached = new Set<string>();
    const queue = [test];

    for (const path of queue) {
      const names = new Set((tree.get(path) ?? "").match(/[\w.-]+\.(?:sh|py|mjs|ts|json)\b/g));

      for (const script of scripts) {
        if (names.has(basename(script)) && !reached.has(script)) {
          reached.add(script);
          queue.push(script);
        }
      }
    }

    return [test, reached] as const;
  }),
);

// Unreferenced scripts have no reader, as the plan's final limits section says.
const readScripts = Arr.filter(scripts, (script) => Arr.some([...readers.values()], (paths) => paths.has(script)));

const markdown = Arr.filter(files, (path) => path.endsWith(".md") && !path.includes("/scripts/"));
const options = { seed: 119120, numRuns: 20 };
let vitest: Vitest;

beforeAll(async () => {
  vitest = await createVitest("test", { root, watch: false, maxWorkers: 1 });
});

afterAll(async () => {
  await vitest?.close();
});

const affected = async (paths: string[]) => {
  vitest.config.related = Arr.map(paths, (path) => join(root, path));
  return Arr.map(await vitest.getRelevantTestSpecifications(), (spec) => relative(root, spec.moduleId)).sort();
};

const declaring = (changed: ReadonlyArray<string>) =>
  Arr.filter(tests, (test) => Arr.some(changed, (path) => readers.get(test)!.has(path))).sort();

it("real script subsets select exactly their declaring tests, never an empty set", async () => {
  await fc.assert(
    fc.asyncProperty(fc.subarray(readScripts, { minLength: 1, maxLength: 12 }), async (paths) => {
      const expected = declaring(paths);
      expect(expected.length).toBeGreaterThan(0);
      expect(await affected(paths)).toEqual(expected);
    }),
    options,
  );
});

// scenario: every real script alone, each in its own test, so another declared script in a subset
// cannot hide a missing import. The subset property once re-checked only its sampled members
// alone, inside its own run: about 150 graph walks in one test, 12.7 s in the mutation
// container's plain run and over the mutation run's 10 s limit (CI runs 42988915529 and
// 42989306764). This walks every script, not a sample, at one walk per test.
it.each(readScripts)("the real script %s alone selects exactly its declaring tests, never none", async (path) => {
  const expected = declaring([path]);
  expect(expected.length).toBeGreaterThan(0);
  expect(await affected([path])).toEqual(expected);
});

// scenario: the rule that takes fixtures out of the script laws. A fixture alone selects what a
// lockfile change selects, every test, so a change to a fixture never runs too few.
it.each(fixtures)("scenario: the fixture %s alone selects every test, as a lockfile change does", async (path) => {
  const every = await affected(["pnpm-lock.yaml"]);
  expect(every.length).toBeGreaterThan(tests.length);
  expect(await affected([path])).toEqual(every);
});

it("real skill Markdown subsets select no test", async () => {
  await fc.assert(
    fc.asyncProperty(fc.subarray(markdown, { minLength: 1, maxLength: 12 }), async (paths) => {
      expect(await affected(paths)).toEqual([]);
    }),
    options,
  );
});

// Today's CI serves both versions. The baseline deliberately has no next/ CLI filter.
// The matrix also holds the legs `e2e-1` to `e2e-N`, which run no vitest step, so the law reads the
// numbered legs only, as the workflow lint does. Plant, run once on check.yaml and restored: drop
// leg "5" from the next matrix, so file indices 5 of 5 land on no leg (red, the sorted legs are not
// 1 to 5). The end-to-end step has a SHARD too, so the vitest step is found by its run command, which
// runs the `next` project (0536) and takes its path from `$FILTER` (the plan for CI paths, slice 2):
// all of next/ unless only the reader tests need to run.
describe("next workflow coverage", () => {
  const workflow = readFileSync(join(root, ".github/workflows/check.yaml"), "utf8");
  const nextWorkflow = parse(workflow).jobs.next;
  const indices = vitestLegs(workflow);
  const expression: string = nextWorkflow.steps.find((step: { run?: string }) =>
    step.run?.startsWith("pnpm exec vitest run --project next $FILTER "),
  )?.env.SHARD;
  // The full matrix's count, the fallback in `/${{ needs.changes.outputs.vitest-legs || N }}`; a sized pull
  // request's own count is legs.ts's, whose split legs.test.ts covers.
  const denominator = Number(/\|\|\s*([1-9]\d*)\s*\}\}$/.exec(expression)?.[1]);
  const contexts: Vitest[] = [];
  let nextSpecs: TestSpecification[];
  const repoPath = (spec: TestSpecification) => relative(root, spec.moduleId).replaceAll("\\", "/");
  const partition = async (specs: TestSpecification[]) => {
    const kept: string[][] = [];

    for (const context of contexts.slice(1)) {
      const Sequencer = context.config.sequence.sequencer;
      kept.push(Arr.map(await new Sequencer(context).shard(specs), repoPath));
    }

    return kept;
  };
  const complete = (kept: string[][], universe: string[]) => {
    expect(Arr.sort(kept.flat(), Order.String)).toEqual(Arr.sort(universe, Order.String));
    expect(new Set(kept.flat()).size).toBe(kept.flat().length);
  };
  beforeAll(async () => {
    const baseline = await createVitest("test", { root, watch: false, maxWorkers: 1 });
    contexts.push(baseline);
    nextSpecs = Arr.filter(await baseline.globTestSpecifications(), (spec) => repoPath(spec).startsWith("next/"));

    for (const index of indices) {
      contexts.push(
        await createVitest("test", {
          root,
          watch: false,
          maxWorkers: 1,
          shard: `${index}/${denominator}`,
        }),
      );
    }
  });
  afterAll(async () => {
    for (const context of contexts) {
      await context.close();
    }
  });

  it("scenario: workflow shards partition every config-discovered next file exactly once", async () => {
    // Real config discovery and each configured sequencer run without executing a test.
    expect(Number.isInteger(denominator)).toBe(true);
    expect(Arr.sort(indices, Order.mapInput(Order.Number, Number))).toEqual(
      Array.from({ length: denominator }, (_, i) => String(i + 1)),
    );
    const universe = Arr.map(nextSpecs, repoPath);
    expect(universe.length).toBeGreaterThan(0);
    expect(new Set(universe).size).toBe(universe.length);
    const kept: string[][] = [];

    for (const context of contexts.slice(1)) {
      const specs = await context.globTestSpecifications(["next/"]);
      const Sequencer = context.config.sequence.sequencer;
      kept.push(Arr.map(await new Sequencer(context).shard(specs), repoPath));
    }

    complete(kept, universe);
  });

  it("real configured shards preserve generated subsets, order and unmeasured files", async () => {
    // External test specifications have no domain Schema. Reuse real discovery, at most 12 files.
    await fc.assert(
      fc.asyncProperty(
        fc.subarray(nextSpecs, { maxLength: 10 }),
        fc.array(fc.nat(), { minLength: 12, maxLength: 12 }),
        fc.stringMatching(/^[a-z]{1,16}$/),
        async (subset, order, suffix) => {
          const project = nextSpecs[0]!.project;
          const unknown = Arr.map(["a", "b"], (letter) =>
            project.createSpecification(join(root, `next/apps/fabrika/src/unmeasured-${suffix}-${letter}.test.ts`)),
          );

          for (const spec of unknown) {
            expect(Object.hasOwn(measured, repoPath(spec))).toBe(false);
          }

          const files = [...subset, ...unknown];
          const shuffled = Arr.map(
            Arr.sort(
              Arr.map(files, (spec, i) => ({ spec, rank: order[i]! })),
              Order.mapInput(Order.Number, ({ rank }: { readonly rank: number }) => rank),
            ),
            ({ spec }) => spec,
          );
          const first = await partition(files);
          complete(first, Arr.map(files, repoPath));

          for (const permutation of [shuffled, Arr.reverse(files)]) {
            const kept = await partition(permutation);
            complete(kept, Arr.map(files, repoPath));
            expect(Arr.map(kept, (paths) => Arr.sort(paths, Order.String))).toEqual(
              Arr.map(first, (paths) => Arr.sort(paths, Order.String)),
            );
          }
        },
      ),
      options,
    );
  });
});
