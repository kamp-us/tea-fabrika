// A slow law fails the full-depth run before it times out. Plants (each run once, restored):
// `>` to `>=` in `slow` (red: a test exactly at its bar is flagged); the `depth` check dropped from
// `onTestRunEnd` (red: a fast run fails); the `limit > 0` check dropped (red: a test with no limit is
// flagged); the default `fail` made a no-op (red: the exit code stays 0); the share ignored for
// `DEFAULT_SHARE` (red: a set share changes nothing); the mode ignored (red: report mode fails the run).
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import * as fc from "fast-check";
import SlowTestReporter, {
  DEFAULT_SHARE,
  decodeMode,
  decodeShare,
  LISTED,
  line,
  slow,
  type Timed,
} from "./slow-test-reporter.ts";

const options = { numRuns: runsFor({ fast: 100, full: 100 }) };

/** A whole-percent share and a limit in whole seconds keep every product exact, so no test sits on the bar by rounding. */
const Percent = fc.integer({ min: 1, max: 100 });

const Limit = fc.integer({ min: 1, max: 120 }).map((s) => s * 1000);

/** A path under the project root, so a relative name reads back as it was written. */
const File = fc
  .tuple(fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/u), fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/u))
  .map(([folder, name]) => `${folder}/${name}.test.ts`);

const Name = fc.string({ minLength: 1, maxLength: 20 });

/** A test that used `percent` of its limit. */
const timed = (file: string, name: string, limit: number, percent: number): Timed => ({
  file,
  name,
  limit,
  ms: (limit * percent) / 100,
});

/** A test clearly over a share of `percent`, or clearly under it (at least a percent away, never on the bar). */
const placedAt = (percent: number) =>
  fc
    .record({
      away: fc.integer({ min: 1, max: 100 }),
      over: fc.boolean(),
      limit: Limit,
      file: File,
      name: Name,
    })
    .filter(({ away, over }) => over || percent - away >= 0)
    .map(({ away, over, limit, file, name }) => ({
      over,
      test: timed(file, name, limit, over ? percent + away : percent - away),
    }));

/** A share, with a test placed against it. */
const Placed = Percent.chain((percent) => placedAt(percent).map((placed) => ({ share: percent / 100, ...placed })));

const fakeModule = (tests: readonly Timed[]) => ({
  children: {
    allTests: () =>
      tests.map((test) => ({
        fullName: test.name,
        module: { moduleId: `/repo/${test.file}` },
        project: { config: { root: "/repo", testTimeout: test.limit } },
        diagnostic: () => ({ duration: test.ms }),
      })),
  },
});

const run = (depth: "fast" | "full", tests: readonly Timed[], env: Record<string, string> = {}) => {
  const said: string[] = [];
  let failed = 0;

  new SlowTestReporter(undefined, {
    depth,
    env,
    out: (text) => said.push(text),
    fail: () => {
      failed += 1;
    },
  }).onTestRunEnd([fakeModule(tests.slice(0, 1)), fakeModule(tests.slice(1))]);

  return { said, failed };
};

it("slow flags a test exactly when it used more of its limit than the share", () => {
  fc.assert(
    fc.property(Placed, ({ share, over, test }) => {
      expect(slow([test], share)).toEqual(over ? [test] : []);
    }),
    options,
  );
});

it("pinned: a test exactly at its bar is not slow, and one with no limit never is", () => {
  expect(slow([{ file: "a.test.ts", name: "a", ms: 30_000, limit: 60_000 }], 0.5)).toEqual([]);
  expect(slow([{ file: "a.test.ts", name: "a", ms: 1_000_000, limit: 0 }], 0.5)).toEqual([]);
});

it("a full-depth run names each slow test once and fails once, and a run with none does not fail", () => {
  fc.assert(
    fc.property(fc.array(placedAt(50), { maxLength: 12 }), (placed) => {
      const result = run(
        "full",
        placed.map((one) => one.test),
        { FABRIKA_SLOW_TEST_SHARE: "0.5" },
      );

      const over = placed.filter((one) => one.over).map((one) => one.test);

      const named = result.said.filter((text) => text.startsWith("slow law:"));

      expect(named).toEqual(over.map((test) => line(test, 0.5)));
      expect(result.failed).toBe(over.length > 0 ? 1 : 0);

      for (const [index, test] of over.entries()) {
        expect(named[index]).toContain(test.file);
        expect(named[index]).toContain(test.name);
      }
    }),
    options,
  );
});

it("a full-depth run lists its slowest tests, slowest first, six at most, whether or not any is over the bar", () => {
  fc.assert(
    fc.property(fc.array(placedAt(50), { maxLength: 12 }), (placed) => {
      const tests = placed.map((one) => one.test);
      const listed = run("full", tests).said.filter((text) => text.startsWith("slowest law:"));

      const expected = tests
        .map((test) => test.ms)
        .sort((left, right) => right - left)
        .slice(0, LISTED);

      expect(listed).toHaveLength(Math.min(LISTED, tests.length));

      for (const [index, text] of listed.entries()) {
        expect(text).toContain(`${(expected[index]! / 1000).toFixed(1)} s of `);
      }
    }),
    options,
  );
});

it("a fast run never fails and never speaks, whatever its tests took", () => {
  fc.assert(
    fc.property(fc.array(Placed, { maxLength: 12 }), (placed) => {
      expect(
        run(
          "fast",
          placed.map((one) => one.test),
        ),
      ).toEqual({ said: [], failed: 0 });
    }),
    options,
  );
});

it("the share a run reads moves the bar", () => {
  fc.assert(
    fc.property(Placed, ({ share, over, test }) => {
      const result = run("full", [test], { FABRIKA_SLOW_TEST_SHARE: String(share) });

      expect(result.failed).toBe(over ? 1 : 0);
    }),
    options,
  );
});

it("an unset share is the default, a share above 0 and up to 1 is read whole, and any other value fails the run", () => {
  expect(decodeShare(undefined)).toBe(DEFAULT_SHARE);

  fc.assert(
    fc.property(fc.double({ min: 0.001, max: 1, noNaN: true }), (share) => {
      expect(decodeShare(String(share))).toBe(share);
    }),
    options,
  );

  fc.assert(
    fc.property(
      fc.oneof(
        fc.double({ min: -1000, max: 0, noNaN: true }).map(String),
        fc.double({ min: 1.001, max: 1000, noNaN: true }).map(String),
        fc.string().filter((value) => Number.isNaN(Number(value)) || value.trim() === ""),
      ),
      (value) => {
        expect(() => decodeShare(value)).toThrow();
        expect(() => new SlowTestReporter(undefined, { env: { FABRIKA_SLOW_TEST_SHARE: value } })).toThrow();
      },
    ),
    { ...options, examples: [["0"], [""], ["half"], ["1.5"], ["-0.5"]] },
  );
});

it("pinned: the default way to fail sets the process exit code, which is what fails the CI step", () => {
  const before = process.exitCode;

  try {
    process.exitCode = undefined;

    new SlowTestReporter(undefined, { depth: "full", env: {}, out: () => undefined }).onTestRunEnd([
      fakeModule([{ file: "a.test.ts", name: "a", ms: 59_000, limit: 60_000 }]),
    ]);

    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = before;
  }
});

it("report mode prints every slow test and fails nothing, and any mode but fail or report fails the run", () => {
  expect(decodeMode(undefined)).toBe("fail");
  expect(decodeMode("fail")).toBe("fail");
  expect(decodeMode("report")).toBe("report");

  fc.assert(
    fc.property(
      fc.string().filter((value) => value !== "fail" && value !== "report"),
      (value) => {
        expect(() => decodeMode(value)).toThrow();
      },
    ),
    { ...options, examples: [["Report"], [""], ["warn"]] },
  );

  fc.assert(
    fc.property(fc.array(placedAt(50), { maxLength: 12 }), (placed) => {
      const tests = placed.map((one) => one.test);
      const reported = run("full", tests, { FABRIKA_SLOW_TEST_SHARE: "0.5", FABRIKA_SLOW_TEST_MODE: "report" });
      const failing = run("full", tests, { FABRIKA_SLOW_TEST_SHARE: "0.5" });

      expect(reported.failed).toBe(0);
      expect(reported.said).toEqual(failing.said);
    }),
    options,
  );
});
