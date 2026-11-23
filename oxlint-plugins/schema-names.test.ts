// A lint message that tells an agent to use `Schema.<name>` must name something the installed
// Effect exports. Seventeen messages said `Schema.TaggedErrorClass` while Effect 4.1.3, the
// lockfile's version, has `Schema.TaggedError` only, so an agent that followed the message wrote
// code that did not compile. The law reads every string in `.oxlintrc.json` and in each rule's own
// file (comments are not strings, so they are left out) and checks each `Schema.<name>` in them
// against what `effect` exports now, so a later Effect bump that renames one is red here.
// Plant: put `Schema.TaggedErrorClass` back in one message of `.oxlintrc.json` or one rule, red.
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { parseSync } from "oxc-parser";
import { expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

/** The text of every string and template literal under one parsed node. */
const strings = (node: unknown): readonly string[] => {
  if (Array.isArray(node)) {
    return node.flatMap(strings);
  }

  if (typeof node !== "object" || node === null) {
    return [];
  }

  const here = node as { readonly type?: unknown; readonly value?: unknown; readonly quasis?: unknown };

  if (here.type === "Literal" && typeof here.value === "string") {
    return [here.value];
  }

  if (here.type === "TemplateLiteral" && Array.isArray(here.quasis)) {
    return here.quasis.flatMap(
      (quasi: { readonly value: { readonly cooked?: string | null } }) => quasi.value.cooked ?? "",
    );
  }

  return Object.values(node).flatMap(strings);
};

/** The strings a file writes, `.oxlintrc.json` read as one JS expression since it has comments. */
const stringsOf = (path: string): readonly string[] => {
  const json = path.endsWith(".json");
  const text = readFileSync(join(ROOT, path), "utf8");
  const parsed = parseSync(json ? "oxlintrc.ts" : path, json ? `(${text})` : text);

  if (parsed.errors.length > 0) {
    throw new Error(`${path} did not parse: ${parsed.errors.map((error) => error.message).join("; ")}`);
  }

  return strings(parsed.program);
};

const FILES = [
  ".oxlintrc.json",
  ...globSync("oxlint-plugins/*.ts", { cwd: ROOT }).filter((file) => !file.endsWith(".test.ts")),
].sort();

/** Each `Schema.<name>` a string names, with the file it is in. */
const named = FILES.flatMap((file) =>
  stringsOf(file).flatMap((text) =>
    [...text.matchAll(/\bSchema\.([A-Za-z_]\w*)/g)].map((m) => ({ file, name: m[1] ?? "" })),
  ),
);

it("scenario: every Schema.<name> a lint message names is an export of the installed Effect", () => {
  const missing = named.filter(({ name }) => !(name in Schema)).map(({ file, name }) => `${file}: Schema.${name}`);

  expect([...new Set(missing)]).toEqual([]);
});

it("scenario: the read finds the names it checks, so the law above is not empty", () => {
  expect(named.some(({ file }) => file === ".oxlintrc.json")).toBe(true);
  expect(named.some(({ file }) => file.startsWith("oxlint-plugins/"))).toBe(true);
});
