// outside.setup.ts: vitest's setup file for the mutation box's Stryker run (ticket 1314), the edge of outside.ts. It does nothing outside a
// Stryker run. Before each test it hands the active mutant to the child processes the test starts, and in the dry run it
// makes a lint rule's own test cover the rule's mutants. outside.ts says why.
import { existsSync, readFileSync } from "node:fs"; // edge: the instrumented rule's text, read as the dry run starts a test
import { join, relative } from "node:path"; // edge: the test's place under the repo, to find its rule
import { beforeEach, inject } from "vitest";
import type { Task } from "vitest";
import { ACTIVE_ENV, coverRule, mutantIds, ruleBehind } from "./outside.ts";
import type { Coverage } from "./outside.ts";

declare module "vitest" {
  interface ProvidedContext {
    readonly globalNamespace?: string;
    readonly mode?: string;
    readonly activeMutant?: string;
    readonly testNameSeparator?: string;
  }
}

declare global {
  // Stryker's namespace on `globalThis`, the part this file reads and writes: set by its own setup file before this one runs.
  var __stryker__: { activeMutant?: string; mutantCoverage?: Coverage } | undefined;
}

/** How Stryker's own setup keys a test in its per-test coverage: its file, then its suites and its name, joined. */
const coverageKey = (task: Task, separator: string): string => {
  const parts = [task.name];

  for (let suite = task.suite; suite !== undefined; suite = suite.suite) {
    parts.unshift(suite.name);
  }

  return `${task.file.filepath}#${parts.join(separator)}`.trim();
};

/** The mutants an instrumented rule file holds; none when the test of this name has no rule beside it (`plants.test.ts`) or the rule is not instrumented. */
const mutantsIn = (file: string): ReadonlyArray<string> =>
  existsSync(file) ? mutantIds(readFileSync(file, "utf8")) : [];

/** Holds the active mutant's id for the processes started from now on, or none. */
const hand = (active: string | undefined) => {
  if (active === undefined) {
    delete process.env[ACTIVE_ENV];
  } else {
    process.env[ACTIVE_ENV] = active;
  }
};

if (inject("globalNamespace") === "__stryker__") {
  // A rule's cases are often linted once as the test file loads, before Stryker switches its mutant on in the test's own process
  // (`beforeAll`), so the variable is set here, as the file is set up, and again before each test.
  hand(inject("mode") === "mutant" ? inject("activeMutant") : undefined);

  beforeEach(({ task }) => {
    const ns = (globalThis.__stryker__ ??= {});
    hand(ns.activeMutant);

    const rule = ruleBehind(relative(process.cwd(), task.file.filepath));
    const ids = rule === null ? [] : mutantsIn(join(process.cwd(), rule));

    if (ns.activeMutant === undefined && ids.length > 0 && inject("mode") !== "mutant") {
      ns.mutantCoverage ??= { static: {}, perTest: {} };
      coverRule(ns.mutantCoverage, coverageKey(task, inject("testNameSeparator") ?? " "), ids);
    }
  });
}
