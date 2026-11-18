// Today's tooling, serving both versions. What a test file's name says of its kind (0536, 0584): a
// test that reaches a real thing, a process, a file, a socket or a server, is named
// `*.integration.test.ts`, in next/ and in tooling alike, and runs only on main's full run (0602).
// The one copy of that name's pattern: test-kind.ts reads it for the lint, and CI's selectors,
// .github/ci/related.ts and .github/ci/proof.ts, drop such a file from a pull request, a queue group
// and a branch's proof run. vitest.config.ts writes the same names as globs, which Vitest's
// projects need.

const INTEGRATION = /\.integration\.test\.tsx?$/;

/** Whether `path` names a test that reaches a real thing: `*.integration.test.ts` or `.tsx`. */
export const isIntegration = (path: string): boolean => INTEGRATION.test(path);
