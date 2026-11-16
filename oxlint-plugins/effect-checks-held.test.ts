// L3 of the trusted-rules swap (decision 0573): the Effect checker's `preferSchemaTaggedError` holds
// every type-checked class beside `fabrika/no-data-taggederror`, so the checker's level is a law.
// `tsconfig.base.json` names it `error`, and no tsconfig the repo tracks turns it down for any path:
// no override sets it lower, and no tsconfig sets its own `plugins`, which replaces the base's list,
// without the checker at `error`. A tsconfig has comments, so each is read as a JS expression, as
// namespace-imports.test.ts reads the base.
// Nor does any checker block set `"diagnostics": false` or `"ignoreEffectErrorsInTscExitCode": true`,
// either of which lets the check's errors pass `tsc` at any level.
// Plant: set `"preferSchemaTaggedError": "warning"` in `tsconfig.base.json`, or add an override
// `{ "include": ["next/**/*.ts"], "options": { "diagnosticSeverity": { "preferSchemaTaggedError": "off" } } }`,
// or set `"diagnostics": false`, or `"ignoreEffectErrorsInTscExitCode": true`, in its checker block.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Expression, parseSync } from "oxc-parser";
import { expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const CHECK = "preferSchemaTaggedError";
const SERVICE = "@effect/language-service";

/** A JSON value from a parsed config, comments dropped. */
const value = (node: Expression): unknown => {
  switch (node.type) {
    case "ParenthesizedExpression":
      return value(node.expression);
    case "Literal":
      return node.value;
    case "ArrayExpression":
      return node.elements.map((element) =>
        element === null || element.type === "SpreadElement" ? null : value(element),
      );
    case "ObjectExpression":
      return Object.fromEntries(
        node.properties.flatMap((property) =>
          property.type === "Property" && property.key.type === "Literal"
            ? [[String(property.key.value), value(property.value)]]
            : [],
        ),
      );
    default:
      throw new Error(`a tsconfig holds a ${node.type}, which is not JSON`);
  }
};

const record = (x: unknown): Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? Object.fromEntries(Object.entries(x)) : {};

const list = (x: unknown): ReadonlyArray<unknown> => (Array.isArray(x) ? x : []);

/** One tsconfig, read as JSON with comments. */
const read = (file: string): Record<string, unknown> => {
  const parsed = parseSync("tsconfig.ts", `(${readFileSync(join(ROOT, file), "utf8")})`);
  expect(parsed.errors, file).toEqual([]);
  const statement = parsed.program.body[0];

  if (statement?.type !== "ExpressionStatement") {
    throw new Error(`${file} did not parse as one expression`);
  }

  return record(value(statement.expression));
};

/** Each place in one tsconfig that sets the check below `error` or drops the checker, said in words. */
const lowered = (file: string, config: Record<string, unknown>): ReadonlyArray<string> => {
  const options = record(config.compilerOptions);

  if (!("plugins" in options)) {
    return [];
  }

  const service = list(options.plugins)
    .map(record)
    .find((plugin) => plugin.name === SERVICE);

  if (service === undefined) {
    return [`${file}: its plugins have no ${SERVICE}, so the checker does not run`];
  }

  const top = record(service.diagnosticSeverity)[CHECK];
  const overrides = list(service.overrides)
    .map(record)
    .flatMap((override, i) => {
      const severity = record(record(override.options).diagnosticSeverity);
      return CHECK in severity && severity[CHECK] !== "error"
        ? [`${file}: override ${i} sets ${CHECK} to ${String(severity[CHECK])}`]
        : [];
    });
  // Either switch lets an error of the check pass `tsc` with no level changed.
  const off = [
    ...(service.diagnostics === false ? [`${file}: ${SERVICE} sets diagnostics to false`] : []),
    ...(service.ignoreEffectErrorsInTscExitCode === true
      ? [`${file}: ${SERVICE} sets ignoreEffectErrorsInTscExitCode to true`]
      : []),
  ];
  return [...(top === "error" ? [] : [`${file}: ${CHECK} is ${String(top)}`]), ...overrides, ...off];
};

it("L3 scenario: preferSchemaTaggedError stays at error in every tracked tsconfig, for every path", () => {
  const files = execFileSync("git", ["ls-files", "*tsconfig*.json"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((file) => file !== "" && !file.startsWith("fixtures/"));
  // Coverage: the base and the projects that extend it, `next/` and the tooling among them.
  expect(files).toEqual(
    expect.arrayContaining([
      "tsconfig.base.json",
      "next/packages/libfabrika/tsconfig.json",
      ".agents/tsconfig.json",
      "oxlint-plugins/tsconfig.json",
    ]),
  );
  const configs = files.map((file) => [file, read(file)] as const);
  const base = configs.find(([file]) => file === "tsconfig.base.json")?.[1] ?? {};
  // The base itself sets the checker, so a base that dropped its plugins fails here too.
  expect("plugins" in record(base.compilerOptions), "tsconfig.base.json sets the checker").toBe(true);
  expect(configs.flatMap(([file, config]) => lowered(file, config))).toEqual([]);
});
