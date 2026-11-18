// Laws Q9 and Q10 of docs/plan/quests/kalfa-quality-stryker-PLAN.md: a plant runs only once its target is
// certain, and `inPlace` follows the package edge. Run on the in-memory stand-ins: `MutantsMemory`
// for Stryker (it counts the calls it is asked for) and a file system held in a record.
//
// fast-check: the input is a catalog with files built to a plan, a scripted report, and a tree of
// package folders; Schema's Arbitrary builds none of those to order.
import { Effect, Layer, Option, Path } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assemble, coverage, madeFor, SHAPES } from "./Built.test-support.ts";
import type { Node, Placed } from "./Built.test-support.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";
import * as MutantsMemory from "./MutantsMemory.ts";
import { plant } from "./Plant.ts";
import type { Plant } from "./Plant.ts";
import * as Run from "./Run.ts";

const options = { seed: 600, numRuns: 100 };

const ROOT = "/repo";

const settings = (inPlace: boolean) => ({
  catalog: `${ROOT}/plants.ts`,
  concurrency: 1,
  timeout: 60_000,
  inPlace,
  ignore: [".claude", "runs"],
  vitest: Option.none<string>(),
  nice: 0,
});

type Kind = "killed" | "elsewhere" | "survived" | "no_coverage" | "timeout";

/** A report with the target's mutant in it as the kind says. The report counts lines and columns from 1. */
const reportOf = (placed: Placed, plant: Plant, kind: Kind) => ({
  schemaVersion: "1.0",
  thresholds: { high: 80, low: 60 },
  files: {
    [plant.file]: {
      language: "typescript",
      source: "",
      mutants: [
        {
          id: "0",
          mutatorName: plant.mutator,
          replacement: plant.replacement,
          status:
            kind === "killed" || kind === "elsewhere"
              ? "Killed"
              : kind === "survived"
                ? "Survived"
                : kind === "no_coverage"
                  ? "NoCoverage"
                  : "Timeout",
          static: false,
          testsCompleted: 2,
          ...(kind === "killed" ? { killedBy: ["0"] } : kind === "elsewhere" ? { killedBy: ["1"] } : {}),
          coveredBy: ["0"],
          location: {
            start: { line: placed.start.line + 1, column: placed.start.column + 1 },
            end: { line: placed.end.line + 1, column: placed.end.column + 1 },
          },
        },
      ],
    },
  },
  testFiles: {
    [plant.law.file]: { tests: [{ id: "0", name: plant.law.name }] },
    "src/other.test.ts": { tests: [{ id: "1", name: "other > title" }] },
  },
});

/** A plant's file, as `k` lines each holding the node, under a header no other plant's file has. */
const fileOf = (index: number, node: Node, k: number) =>
  assemble([
    `// plant ${index}\n`,
    ...Array.from({ length: k }, (_, i) => [`const t${i} = `, node, ";\n"] as const).flat(),
  ]);

/** One run of `Run.plant(name)` over the files, with the stand-in answering as `script` says. */
const ran = async (
  catalog: ReadonlyArray<Plant>,
  name: string,
  files: Record<string, string>,
  inPlace: boolean,
  script: Parameters<typeof MutantsMemory.make>[0],
) => {
  const memory = MutantsMemory.make(script);
  const layers = Layer.mergeAll(
    MemoryFiles.layer({ ...files, [`${ROOT}/package.json`]: "{}" }),
    Path.layer,
    memory.layer,
  );

  const got = await Effect.runPromise(
    Run.plant({ catalog, name, settings: settings(inPlace), root: ROOT }).pipe(
      Effect.scoped,
      Effect.provide(layers),
      Effect.result,
    ),
  );

  return { got, calls: memory.calls };
};

const OKAY = ["killed", "elsewhere", "survived", "no_coverage", "timeout"] as const;

const MODES = [...OKAY, "unknown_plant", "not_found", "ambiguous", "within_not_once", "needs_in_place"] as const;

describe("Run.plant, a plant runs only once its target is certain", () => {
  // Plant: ask the stand-in to run before the target is found.
  it("Q9: the answer is the report's, and every refusal comes before Stryker is asked to run", async () => {
    expect.hasAssertions();
    const seen = coverage(MODES);

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.nat({ max: 4 }),
        fc.array(fc.constantFrom(...SHAPES), { minLength: 5, maxLength: 5 }),
        fc.constantFrom(...MODES),
        async (count, pick, shapes, mode) => {
          const picked = pick % count;
          const catalog: Array<Plant> = [];
          const files: Record<string, string> = {};
          const placedBy = new Map<string, Placed>();
          const madeBy = new Map<string, ReturnType<typeof madeFor>>();

          for (let i = 0; i < count; i++) {
            const tokens = shapes[i]!;
            const node: Node = {
              tokens,
              gaps: tokens.slice(1).map(() => " "),
              mutator: "ConditionalExpression",
              replacement: "true",
            };
            const k = i !== picked ? 1 : mode === "not_found" ? 0 : mode === "ambiguous" ? 2 : 1;
            const built = fileOf(i, node, k);
            const lawFolder = i === picked && mode === "needs_in_place" ? "test" : "src";

            const ask = plant({
              name: `plant-${i}`,
              file: `src/p${i}.ts`,
              mutator: node.mutator,
              original: tokens.join(" "),
              replacement: node.replacement,
              ...(i === picked && mode === "within_not_once" ? { within: "function nowhere() { return false; }" } : {}),
              law: { file: `${lawFolder}/p${i}.test.ts`, name: `suite ${i} > title` },
            });

            catalog.push(ask);
            files[`${ROOT}/${ask.file}`] = built.text;
            files[`${ROOT}/${ask.law.file}`] = "// the law's file\n";
            madeBy.set(built.text, madeFor(ask.file, built.placed));

            if (built.placed[0] !== undefined) {
              placedBy.set(ask.name, built.placed[0]);
            }
          }

          // A folder of its own makes the law's file a different package from the product's.
          files[`${ROOT}/test/package.json`] = "{}";

          const name = mode === "unknown_plant" ? "no-such-plant" : `plant-${picked}`;
          const chosen = catalog[picked]!;
          const kind: Kind =
            mode === "elsewhere" || mode === "survived" || mode === "no_coverage" || mode === "timeout"
              ? mode
              : "killed";

          const { got, calls } = await ran(catalog, name, files, false, {
            made: (_, text) => madeBy.get(text) ?? [],
            report: () => reportOf(placedBy.get(chosen.name)!, chosen, kind),
          });

          seen.hit(mode);

          const done = got._tag === "Success" ? got.success : undefined;
          const refusal = got._tag === "Failure" ? got.failure : undefined;
          const where = placedBy.get(chosen.name);

          // Each mode's one outcome, said whole so no branch can leave a property asserting nothing.
          expect({
            done: done !== undefined,
            ran: calls.ran.length,
            reason: refusal?.reason,
            plant: done?.plant,
            target: done === undefined ? undefined : { line: done.target.line, column: done.target.column },
            answer: done?.answer._tag,
            by: done?.answer._tag === "killed" ? done.answer.by : undefined,
          }).toEqual(
            OKAY.some((okay) => okay === mode)
              ? {
                  done: true,
                  ran: 1,
                  reason: undefined,
                  plant: chosen.name,
                  target: { line: where!.start.line + 1, column: where!.start.column },
                  answer: mode,
                  by: mode === "killed" ? [chosen.law] : undefined,
                }
              : {
                  done: false,
                  ran: 0,
                  reason: mode,
                  plant: undefined,
                  target: undefined,
                  answer: undefined,
                  by: undefined,
                },
          );
        },
      ),
      options,
    );
    seen.check();
  });

  // Plant: compare the target's and the law's folders instead of their packages.
  it("Q10: a plant whose target and law sit in different packages is refused unless inPlace is on", async () => {
    expect.hasAssertions();
    const DIRS = ["", "a", "a/b", "a/b/c", "d"] as const;
    const seen = coverage(["same_folder", "same_package", "other_package_refused", "other_package_runs"] as const);

    await fc.assert(
      fc.asyncProperty(
        fc.subarray(["a", "a/b", "a/b/c", "d"]),
        fc.constantFrom(...DIRS),
        fc.constantFrom(...DIRS),
        fc.boolean(),
        async (packages, targetDir, lawDir, inPlace) => {
          // The package a folder belongs to: the nearest folder at or above it with a package.json.
          const nearest = (dir: string): string => {
            for (let at = dir; ; at = at.slice(0, Math.max(at.lastIndexOf("/"), 0))) {
              if (at === "" || packages.includes(at)) {
                return at;
              }
            }
          };

          const under = (dir: string, file: string) => (dir === "" ? file : `${dir}/${file}`);
          const node: Node = {
            tokens: ["a", "===", "b"],
            gaps: [" ", " "],
            mutator: "ConditionalExpression",
            replacement: "true",
          };
          const built = fileOf(0, node, 1);

          const ask = plant({
            name: "subject",
            file: under(targetDir, "t.ts"),
            mutator: node.mutator,
            original: "a === b",
            replacement: "true",
            law: { file: under(lawDir, "t.test.ts"), name: "suite > title" },
          });

          const files: Record<string, string> = {
            [`${ROOT}/${ask.file}`]: built.text,
            [`${ROOT}/${ask.law.file}`]: "// the law's file\n",
            ...Object.fromEntries(packages.map((dir) => [`${ROOT}/${dir}/package.json`, "{}"])),
          };

          const { got, calls } = await ran([ask], "subject", files, inPlace, {
            made: () => madeFor(ask.file, built.placed),
            report: () => reportOf(built.placed[0]!, ask, "killed"),
          });

          const split = nearest(targetDir) !== nearest(lawDir);

          if (!split) {
            seen.hit(targetDir === lawDir ? "same_folder" : "same_package");
          } else {
            seen.hit(inPlace ? "other_package_runs" : "other_package_refused");
          }

          // Refused before a run, or run once with the option as set.
          expect({
            tag: got._tag,
            reason: got._tag === "Failure" ? got.failure.reason : undefined,
            ran: calls.ran.length,
            inPlace: calls.ran[0]?.inPlace,
          }).toEqual(
            split && !inPlace
              ? { tag: "Failure", reason: "needs_in_place", ran: 0, inPlace: undefined }
              : { tag: "Success", reason: undefined, ran: 1, inPlace },
          );
        },
      ),
      options,
    );
    seen.check();
  });
});
