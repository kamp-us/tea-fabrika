import { readFileSync } from "node:fs";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse, parseDocument } from "yaml";
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

// Plant: build the value with parseDocument(text).toJS() after checking only document.errors, as
// the first E47 fix did (ticket 1075); the alias count throws out of lintWorkflow and this goes red.
it("answers invalid YAML for a text whose aliases expand past the parser's limit", () => {
  // Each level lists the level below `width` times, so the value has width^depth leaves: past
  // yaml's default maxAliasCount of 100 for every generated pair.
  const bomb = fc.record({ width: fc.integer({ min: 2, max: 4 }), depth: fc.integer({ min: 7, max: 12 }) });

  fc.assert(
    fc.property(wiring, bomb, (clean, { width, depth }) => {
      const levels = Array.from(
        { length: depth },
        (_, at) => `a${at + 1}: &a${at + 1} [${Array.from({ length: width }, () => `*a${at}`).join(", ")}]`,
      );
      const text = ["a0: &a0 [x]", ...levels, `rest: ${JSON.stringify(clean)}`].join("\n");

      // Coverage: the text is free of syntax errors, and only building its value fails.
      expect(parseDocument(text).errors).toEqual([]);
      expect(() => parse(text)).toThrow(ReferenceError);
      expect(lint(text)).toEqual(["check.yaml: invalid YAML"]);
    }),
    options,
  );
});

it("format: the checked-in workflow passes the same wiring lint", () => {
  // A fixed file read is a format check. Structural decisions live in the linter.
  expect(lint(readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8"))).toEqual([]);
});
