// E3 of docs/plan/quests/tea-msg-tag-PLAN.md, slice 1: Effect's checker may let `@demlik/tea` appear
// twice in one program (`duplicatePackage`, TS377051) only in the lead tooling, where tea 0.27.0 and
// today's agent runner on tea 0.25.0 meet (0217, ticket 1065). The allowance sits in one override of
// `tsconfig.base.json` whose `include` is `.agents/**` globs alone, names only `@demlik/tea`, and no
// other tsconfig of the repo holds one. Read the way `namespace-imports.test.ts` reads the same file:
// `tsconfig.base.json` has comments, so it is parsed as a JS expression.
// Plants: (a) the allowance set in the checker's top-level options; (b) `next/**/*.ts` added to the
// override's `include`; (c) a second package name. Each turns E3 red.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Array as Arr, pipe, Option, Record as Rec } from "effect";
import { type Expression, parseSync } from "oxc-parser";
import { expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

const KEY = "allowedDuplicatedPackages";

/** A JSON value from the parsed config, comments dropped. */
const value = (node: Expression): unknown => {
  switch (node.type) {
    case "ParenthesizedExpression":
      return value(node.expression);
    case "Literal":
      return node.value;
    case "ArrayExpression":
      return Arr.map(node.elements, (element) =>
        element === null || element.type === "SpreadElement" ? null : value(element),
      );
    case "ObjectExpression":
      return Rec.fromEntries(
        Arr.flatMap(node.properties, (property) =>
          property.type === "Property" && property.key.type === "Literal"
            ? [[String(property.key.value), value(property.value)]]
            : [],
        ),
      );
    default:
      throw new Error(`tsconfig.base.json holds a ${node.type}, which is not JSON`);
  }
};

const record = (x: unknown): Record<string, unknown> =>
  typeof x === "object" && x !== null && !Arr.isArray(x) ? Rec.fromEntries(Rec.toEntries(x)) : {};

const list = (x: unknown): ReadonlyArray<unknown> => (Arr.isArray(x) ? x : []);

/** Effect's checker entry in `tsconfig.base.json`'s plugins. */
const checker = (text: string): Record<string, unknown> => {
  const parsed = parseSync("tsconfig.base.ts", `(${text})`);
  expect(parsed.errors).toEqual([]);
  const statement = parsed.program.body[0];

  if (statement?.type !== "ExpressionStatement") {
    throw new Error("tsconfig.base.json did not parse as one expression");
  }

  const plugins = list(record(record(value(statement.expression)).compilerOptions).plugins);

  return pipe(
    Arr.map(plugins, record),
    Arr.findFirst((plugin) => plugin.name === "@effect/language-service"),
    Option.getOrElse((): Record<string, unknown> => ({})),
  );
};

it("format: E3, `@demlik/tea` may appear twice only in one checker override scoped to `.agents/**`, and nowhere else", () => {
  // format: the checker reads this setting by its exact key and place in tsconfig.base.json.
  const effect = checker(readFileSync(join(ROOT, "tsconfig.base.json"), "utf8"));

  const holders = pipe(
    list(effect.overrides),
    Arr.map(record),
    Arr.filter((override) => KEY in record(override.options)),
    Arr.map((override) => ({ include: override.include, names: record(override.options)[KEY] })),
  );

  expect(KEY in effect).toBe(false);
  expect(holders).toEqual([{ include: expect.any(Array), names: ["@demlik/tea"] }]);

  const include = list(holders[0]?.include);
  expect(include.length).toBeGreaterThan(0);
  expect(Arr.filter(include, (glob) => typeof glob !== "string" || !glob.startsWith(".agents/"))).toEqual([]);

  const tracked = spawnSync("git", ["ls-files", "-z", "--", "tsconfig*.json", "**/tsconfig*.json"], {
    cwd: ROOT,
    encoding: "utf8",
  });

  const others = Arr.filter(tracked.stdout.split("\0"), (file) => file !== "" && file !== "tsconfig.base.json");
  expect(tracked.status).toBe(0);
  expect(others.length).toBeGreaterThan(0);
  expect(Arr.filter(others, (file) => readFileSync(join(ROOT, file), "utf8").includes(KEY))).toEqual([]);
});
