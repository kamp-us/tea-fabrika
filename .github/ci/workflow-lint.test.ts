import { readFileSync } from "node:fs";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { lintWorkflow as lint } from "./workflow-lint.ts";
import { options, wiring } from "./workflow-lint/wiring.test-support.ts";

// Today's CI for both versions. Covers workflow-lint.ts, the entry that runs every family of laws.
// Each family's plants live in its own test file under workflow-lint/, beside its module.
it("accepts generated valid wiring", () => {
  fc.assert(
    fc.property(wiring, (clean) => {
      expect(lint(JSON.stringify(clean))).toEqual([]);
    }),
    options,
  );
});

it("format: the checked-in workflow passes the same wiring lint", () => {
  // A fixed file read is a format check. Structural decisions live in the linter.
  expect(lint(readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8"))).toEqual([]);
});
