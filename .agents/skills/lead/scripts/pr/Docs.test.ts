// Today's lead tooling. The admin merge's answer for every row of the fixed table (@kalfa/ci/DocsOnly.test-support):
// a row's files are docs only for the admin merge exactly when the row's adminDocs says so (0183, 0180).
import { expect, it } from "@effect/vitest";
import { TABLE } from "@kalfa/ci/DocsOnly.test-support";
import * as Merge from "./Merge.ts";

// Plant: isDocsFile takes instruction text as docs, so a row with AGENTS.md or a skill's prose is admin-merged.
it("vector: for every row of the fixed table, the admin merge takes the row's files as docs only exactly when adminDocs says so", () => {
  for (const row of TABLE) {
    expect(row.paths.every(Merge.isDocsFile), row.pr).toBe(row.adminDocs);
  }
});
