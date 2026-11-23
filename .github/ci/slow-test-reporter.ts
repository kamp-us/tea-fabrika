// Today's CI. At full depth, one test that took more than a share of its time limit fails the run, so a
// slow law is seen on the pull request, before it grows into a timeout (two property laws passed every
// local run at fast depth and timed out only at full depth in CI). The limit is the project's own
// `testTimeout`, read from the resolved config (vitest.config.ts holds the number), and the share is
// `FABRIKA_SLOW_TEST_SHARE`, read here and nowhere else.
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

/** One finished test, with the limit its project gave it. */
export interface Timed {
  readonly file: string;
  readonly name: string;
  readonly ms: number;
  readonly limit: number;
}

/** The tests that used more than `share` of their limit. A limit of 0 means no limit, so it never flags. */
export const slow = (tests: readonly Timed[], share: number): readonly Timed[] =>
  tests.filter((test) => test.limit > 0 && test.ms > share * test.limit);

const seconds = (ms: number) => (ms / 1000).toFixed(1);

/** The line that names one slow test, what to do, and the setting that moves the bar. */
export const line = (test: Timed, share: number): string =>
  `slow law: ${test.file} > ${test.name} took ${seconds(test.ms)} s, over ${Math.round(share * 100)}% of its ${seconds(test.limit)} s limit. ` +
  "Bound its generated inputs (size and runs), then run the file again at FABRIKA_TEST_DEPTH=full. " +
  "The share is FABRIKA_SLOW_TEST_SHARE.";

interface Case {
  readonly fullName: string;
  readonly module: { readonly moduleId: string };
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
  private readonly out: (text: string) => void;
  private readonly fail: () => void;

  constructor(_options?: unknown, dependencies: Dependencies = {}) {
    this.depth = dependencies.depth ?? depth;
    this.share = decodeShare((dependencies.env ?? process.env).FABRIKA_SLOW_TEST_SHARE);
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
                limit: test.project.config.testTimeout,
              },
            ];
      }),
    );

    const found = slow(timed, this.share);

    for (const test of found) {
      this.out(line(test, this.share));
    }

    if (found.length > 0) {
      this.fail();
    }
  }
}
