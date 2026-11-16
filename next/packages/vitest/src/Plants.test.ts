// Decision 0580 and 0093: a plant's record comes from the law's own options, never typed by hand.
// `Plants.records(files, root)` reads vitest's task trees after a run (`vitest.state.getFiles()`) and
// lists each law that ran as `{ file, law, plant, result }`: its file relative to `root`, its title,
// its `meta.plant`, and `red` when it failed, `green` when it passed. A law that ran with no plant
// is refused, so a record is never made up. Its input is the part of vitest's `RunnerTestFile` it
// reads, so a test builds one without a cast.
import { describe, expect, it } from "@effect/vitest";
import { Result } from "effect";
import * as fc from "fast-check";
import * as Plants from "./Plants.ts";

const SEED = 119120;
const ROOT = "/work/repo";

type State = "pass" | "fail" | "skip" | "todo" | "run" | "queued";

interface Test {
  readonly type: "test";
  readonly name: string;
  readonly mode: "run" | "skip" | "todo";
  readonly meta: { readonly plant?: string };
  readonly result?: { readonly state: State };
}

interface Suite {
  readonly type: "suite";
  readonly name: string;
  readonly mode: "run" | "skip";
  readonly meta: object;
  readonly tasks: ReadonlyArray<Test | Suite>;
}

const test: fc.Arbitrary<Test> = fc.record(
  {
    type: fc.constant("test" as const),
    name: fc.constantFrom("the log reads back", "a reply is dropped", "R5 the window keeps its row"),
    mode: fc.constantFrom("run" as const, "skip" as const, "todo" as const),
    meta: fc.record({ plant: fc.constantFrom("drop the press row", "skip the last append") }, { requiredKeys: [] }),
    result: fc.record({ state: fc.constantFrom<State>("pass", "fail", "skip", "todo", "run", "queued") }),
  },
  { requiredKeys: ["type", "name", "mode", "meta"] },
);

const { tree } = fc.letrec<{ tree: Test | Suite }>((tie) => ({
  tree: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    test,
    fc.record({
      type: fc.constant("suite" as const),
      name: fc.constantFrom("a describe", "the ledger"),
      mode: fc.constantFrom("run" as const, "skip" as const),
      meta: fc.constant({}),
      tasks: fc.array(tie("tree"), { maxLength: 3 }),
    }),
  ),
}));

const files = fc.array(
  fc.record({
    type: fc.constant("suite" as const),
    name: fc.constantFrom("a.test.ts", "b.test.ts"),
    mode: fc.constant("run" as const),
    meta: fc.constant({}),
    filepath: fc.constantFrom(`${ROOT}/next/a.test.ts`, `${ROOT}/.agents/skills/x/scripts/b.test.ts`),
    tasks: fc.array(tree, { maxLength: 4 }),
  }),
  { maxLength: 3 },
);

/** The tests under a tree, in source order. */
const flat = (task: Test | Suite): ReadonlyArray<Test> => (task.type === "test" ? [task] : task.tasks.flatMap(flat));

// Plant: write `green` for a failed law.
describe("Plants.records (0580)", () => {
  it("Plants.records lists exactly the laws that ran, each with its file, title, plant and red or green, and refuses a law that ran with no plant", () => {
    let refused = 0;
    let listed = 0;
    fc.assert(
      fc.property(files, (given) => {
        const ran = given.flatMap((file) =>
          file.tasks
            .flatMap(flat)
            .filter((t) => t.result?.state === "pass" || t.result?.state === "fail")
            .map((t) => ({ file: file.filepath.slice(ROOT.length + 1), test: t })),
        );
        const bare = ran.find(({ test: t }) => t.meta.plant === undefined);
        const answer = Plants.records(given, ROOT);

        if (bare !== undefined) {
          refused += 1;
          expect(Result.isFailure(answer)).toBe(true);
          expect(Result.isFailure(answer) ? answer.failure : null).toMatchObject({
            file: bare.file,
            law: bare.test.name,
          });
          return;
        }

        listed += ran.length;
        expect(answer).toEqual(
          Result.succeed(
            ran.map(({ file, test: t }) => ({
              file,
              law: t.name,
              plant: t.meta.plant,
              result: t.result?.state === "fail" ? "red" : "green",
            })),
          ),
        );
      }),
      { seed: SEED, numRuns: 100 },
    );
    // Coverage: both answers are reached, and some laws are listed.
    expect(refused).toBeGreaterThan(0);
    expect(listed).toBeGreaterThan(0);
  });
});
