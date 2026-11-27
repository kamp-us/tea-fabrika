// outside.ts: a lint rule's laws reach the rule from another process (ticket 1314). Today's lead tooling, not product.
//
// A rule's own test (`oxlint-plugins/no-hand-tag.test.ts`) lints planted files through `plant.ts`, which runs oxlint in
// a separate process, so the test never imports the rule and no import walk finds it. Three things follow, and this
// file holds the pure part of each:
//
// 1. The gate picks the test by name: `lawNamedFor` and `ruleBehind` pair `oxlint-plugins/<rule>.ts` with
//    `oxlint-plugins/<rule>.test.ts`.
// 2. Stryker switches a mutant on through `globalThis.__stryker__.activeMutant` in the test's own process, and an
//    instrumented file loaded by a child process reads the one environment variable `__STRYKER_ACTIVE_MUTANT__` instead, so
//    the setup holds the active mutant's id in it, and the child, which inherits the environment, runs the same mutant.
// 3. Stryker learns which tests cover a mutant from the test's own process, and the child's hits are lost. A mutant of
//    the rule that no test hit in process is `NoCoverage` and never runs, whenever some other file's laws did hit
//    theirs. `coverRule` makes the rule's own test cover every mutant the rule file holds, read from the
//    instrumented text (`mutantIds`).
//
// `outside.setup.ts` is the one place these touch vitest; `run.sh` adds it to the config Stryker reads.

/** The variable an instrumented file reads its active mutant from when its process has none of its own. */
export const ACTIVE_ENV = "__STRYKER_ACTIVE_MUTANT__";

const RULE = /^oxlint-plugins\/([^/]+)\.ts$/;

const LAW = /^oxlint-plugins\/([^/]+)\.test\.ts$/;

/** Test code and support beside the rules: no rule, so no test is named after them. */
const NOT_RULE = /\.(?:test|test-support)$/;

/** The test named after a lint rule's file, `oxlint-plugins/<rule>.test.ts`, or `null` for any other file. Pure. */
export const lawNamedFor = (file: string): string | null => {
  const name = RULE.exec(file)?.[1];

  return name === undefined || NOT_RULE.test(name) ? null : `oxlint-plugins/${name}.test.ts`;
};

/** The rule file a test is named after, `oxlint-plugins/<rule>.ts`, or `null` for any other test. Pure. */
export const ruleBehind = (test: string): string | null => {
  const name = LAW.exec(test)?.[1];

  return name === undefined ? null : `oxlint-plugins/${name}.ts`;
};

/** The ids of the mutants an instrumented file holds, each once, in order. Pure. */
export const mutantIds = (instrumented: string): ReadonlyArray<string> => [
  ...new Set(Array.from(instrumented.matchAll(/stryMutAct_\w+\("(\d+)"\)/g), (found) => found[1] ?? "")),
];

/** Stryker's coverage: the mutants hit as a file loads, and the ones each test hit. */
export interface Coverage {
  readonly static: Record<string, number>;
  readonly perTest: Record<string, Record<string, number>>;
}

/**
 * Makes `test` cover each of `ids` once more, in place: an instrumented file keeps the object it first found, so a
 * new one would lose every hit it records after this.
 */
export const coverRule = (coverage: Coverage, test: string, ids: ReadonlyArray<string>): void => {
  const own = (coverage.perTest[test] ??= {});

  for (const id of ids) {
    own[id] = (own[id] ?? 0) + 1;
  }
};
