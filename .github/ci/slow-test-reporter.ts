// Today's CI. At full depth, one test that took more than a share of its time limit fails the run, so a
// slow law is seen on the pull request, before it grows into a timeout (two property laws passed every
// local run at fast depth and timed out only at full depth in CI). The limit is the timeout the test
// really runs under: Vitest resolves it when it collects the test (the test's own `timeout`, else its
// describe's, else the project's `testTimeout`) and shows it as `TestCase.options.timeout`
// (`vitest/dist/chunks/plugin.d.C8mmycim.d.ts`, `TaskOptions`; set in `vitest/dist/chunks/run.BPv-BBRv.js`,
// `options.timeout ?? runner.config.testTimeout`). The project's `testTimeout` is the fallback if it is
// unset. The share is `FABRIKA_SLOW_TEST_SHARE`, read here and nowhere else. `FABRIKA_SLOW_TEST_MODE=report` prints the slow laws and fails nothing, to list every
// slow law of one run at a lower share; `fail` is the default.
import { relative } from "node:path";
import { depth } from "@kampus/vitest";
import { Schema } from "effect";
import type { Reporter } from "vitest/node";

/** The share of a test's limit it may use, when `FABRIKA_SLOW_TEST_SHARE` is unset. */
export const DEFAULT_SHARE = 0.5;

const Share = Schema.FiniteFromString.check(Schema.isBetween({ minimum: 0, maximum: 1, exclusiveMinimum: true }));

/**
 * The share a value of `FABRIKA_SLOW_TEST_SHARE` names: unset is `DEFAULT_SHARE`, and any other value
 * that is not a number above 0 and up to 1 fails the run.
 */
export const decodeShare = (value: string | undefined): number =>
  value === undefined ? DEFAULT_SHARE : Schema.decodeUnknownSync(Share)(value);

/** What a run does with the slow laws it found: `fail` fails the run, `report` only prints them. */
const Mode = Schema.Literals(["fail", "report"]);

type Mode = typeof Mode.Type;

/** The mode a value of `FABRIKA_SLOW_TEST_MODE` names: unset is `fail`, and any other word fails the run. */
export const decodeMode = (value: string | undefined): Mode => Schema.decodeUnknownSync(Mode)(value ?? "fail");

/** One finished test, with the timeout it ran under. */
export interface Timed {
  readonly file: string;
  readonly name: string;
  readonly ms: number;
  readonly limit: number;
}

/** The tests that used more than `share` of their limit. A limit of 0 means no limit, so it never flags. */
export const slow = (tests: readonly Timed[], share: number): readonly Timed[] =>
  tests.filter((test) => test.limit > 0 && test.ms > share * test.limit);

/** How many of the slowest tests a full-depth run lists, whether or not any is over the bar. */
export const LISTED = 6;

/** The `LISTED` slowest tests, slowest first. */
export const slowest = (tests: readonly Timed[]): readonly Timed[] =>
  [...tests].sort((left, right) => right.ms - left.ms).slice(0, LISTED);

const seconds = (ms: number) => (ms / 1000).toFixed(1);

/** The line that names one slow test, what to do, and the setting that moves the bar. */
export const line = (test: Timed, share: number): string =>
  `slow law: ${test.file} > ${test.name} took ${seconds(test.ms)} s, over ${Math.round(share * 100)}% of its ${seconds(test.limit)} s limit. ` +
  "Bound its generated inputs (size and runs), then run the file again at FABRIKA_TEST_DEPTH=full. " +
  "The share is FABRIKA_SLOW_TEST_SHARE.";

interface Case {
  readonly fullName: string;
  readonly module: { readonly moduleId: string };
  readonly options: { readonly timeout: number | undefined };
  readonly project: { readonly config: { readonly root: string; readonly testTimeout: number } };
  diagnostic(): { readonly duration: number } | undefined;
}

interface Module {
  readonly children: { allTests(): Iterable<Case> };
}

interface Dependencies {
  readonly depth?: typeof depth;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly out?: (text: string) => void;
  readonly fail?: () => void;
}

export default class SlowTestReporter implements Reporter {
  private readonly depth: typeof depth;
  private readonly share: number;
  private readonly mode: Mode;
  private readonly out: (text: string) => void;
  private readonly fail: () => void;

  constructor(_options?: unknown, dependencies: Dependencies = {}) {
    this.depth = dependencies.depth ?? depth;

    const env = dependencies.env ?? {
      ...process.env,
      FABRIKA_SLOW_TEST_MODE: "report",
      FABRIKA_SLOW_TEST_SHARE: "0.1",
    };

    this.share = decodeShare(env.FABRIKA_SLOW_TEST_SHARE);
    this.mode = decodeMode(env.FABRIKA_SLOW_TEST_MODE);

    this.out = dependencies.out ?? ((text) => console.error(text));

    this.fail =
      dependencies.fail ??
      (() => {
        process.exitCode = 1;
      });
  }

  onTestRunEnd(modules: readonly Module[]) {
    if (this.depth !== "full") {
      return;
    }

    const timed = modules.flatMap((module) =>
      [...module.children.allTests()].flatMap((test) => {
        const diagnostic = test.diagnostic();

        return diagnostic === undefined
          ? []
          : [
              {
                file: relative(test.project.config.root, test.module.moduleId),
                name: test.fullName,
                ms: diagnostic.duration,
                limit: test.options.timeout ?? test.project.config.testTimeout,
              },
            ];
      }),
    );

    for (const test of slowest(timed)) {
      this.out(`slowest law: ${seconds(test.ms)} s of ${seconds(test.limit)} s, ${test.file} > ${test.name}`);
    }

    const found = slow(timed, this.share);

    for (const test of found) {
      this.out(line(test, this.share));
    }

    if (found.length > 0 && this.mode === "fail") {
      this.fail();
    }
  }
}
