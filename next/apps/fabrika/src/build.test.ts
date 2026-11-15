// P12, next/: the page entry's shape, read as source text. The real build's laws are in
// build.integration.test.ts, which runs Rolldown and so runs on the schedule (0536).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSync } from "oxc-parser";
import { expect, it } from "vitest";

// L11: production React does not repeat mounts. Check the real entry's module-level boot instead.
it("format: the page entry starts its sole Effect run outside React at module scope", () => {
  const file = join(import.meta.dirname, "entry/browser.tsx");
  const source = readFileSync(file, "utf8");
  const parsed = parseSync(file, source);
  expect(parsed.errors).toEqual([]);
  const boots = parsed.program.body.filter((node) => {
    if (node.type !== "ExpressionStatement" || node.expression.type !== "CallExpression") {
      return false;
    }

    const call = node.expression.callee;
    return (
      call.type === "MemberExpression" &&
      call.object.type === "Identifier" &&
      call.object.name === "Effect" &&
      call.property.type === "Identifier" &&
      call.property.name === "runFork"
    );
  });
  expect(boots, "a React mount never owns the page's Effect run").toHaveLength(1);
  expect(source.match(/\brunFork\b/g), "there is only one page runtime").toHaveLength(1);
});
