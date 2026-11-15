// P12, next/: the page entry's shape, read as source text. The real build's laws are in
// build.integration.test.ts, which runs Rolldown and so runs on the schedule (0536).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSync } from "oxc-parser";
import { expect, it } from "vitest";

// L11: production React does not repeat mounts. Check the real entry's module-level boot instead: the
// page hands its one program to Effect's browser runner, `runMain` from `@kampus/tuval/browser`, once.
it("format: the page entry starts its one Effect program through runMain, once, outside React at module scope, and calls no Effect.run*", () => {
  const file = join(import.meta.dirname, "entry/browser.tsx");
  const source = readFileSync(file, "utf8");
  const parsed = parseSync(file, source);
  expect(parsed.errors).toEqual([]);
  // Any oxc node: some carry a `name` that is itself a node (V8IntrinsicExpression), so it is read as unknown.
  const isRunMain = (node: { readonly type: string; readonly name?: unknown }) =>
    node.type === "Identifier" && node.name === "runMain";
  const imported = parsed.program.body.filter(
    (node) =>
      node.type === "ImportDeclaration" &&
      node.source.value === "@kampus/tuval/browser" &&
      node.specifiers.some((s) => s.type === "ImportSpecifier" && isRunMain(s.imported) && isRunMain(s.local)),
  );
  expect(imported, "runMain comes from @kampus/tuval/browser").toHaveLength(1);
  // A start is `program.pipe(runMain)`, `runMain(program)` or `runMain(options)(program)`, as a
  // statement of the module itself.
  const boots = parsed.program.body.filter((node) => {
    if (node.type !== "ExpressionStatement" || node.expression.type !== "CallExpression") {
      return false;
    }

    const { callee, arguments: args } = node.expression;
    const last = args.at(-1);
    const piped =
      callee.type === "MemberExpression" &&
      callee.property.type === "Identifier" &&
      callee.property.name === "pipe" &&
      last !== undefined &&
      isRunMain(last);
    const direct = isRunMain(callee) || (callee.type === "CallExpression" && isRunMain(callee.callee));
    return piped || direct;
  });
  expect(boots, "a React mount never owns the page's Effect run").toHaveLength(1);
  // The import and the one start: any other `runMain`, in a function or a component, is a second start.
  expect(source.match(/\brunMain\b/g), "there is only one page runtime").toHaveLength(2);
  expect(source.match(/\brun(?!Main\b)[A-Z]\w*/g), "the entry calls no Effect.run*").toBeNull();
});
