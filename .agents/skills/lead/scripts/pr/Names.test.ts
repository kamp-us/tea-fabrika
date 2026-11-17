// Today's lead tooling. Names' laws (0587): a pull request's new exported names, read from GitHub's
// patches, and the `## New names` lines its description must hold for each. Pure; nothing here asks
// GitHub.
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Names from "./Names.ts";
import type { Patch } from "./PullRequests.ts";

const Ident = Schema.String.check(Schema.isPattern(/^[A-Za-z_$][A-Za-z0-9_$]{0,11}$/));

const Kind = Schema.Literals([
  "const",
  "let",
  "function",
  "function*",
  "async function",
  "class",
  "interface",
  "type",
  "enum",
]);

const Code = Schema.Literals(["src/a.ts", "next/x/Thing.tsx", ".github/ci/b.mjs", "tools/c.js"]);

const line = (kind: string, name: string) =>
  `export ${kind} ${name}${kind.includes("function") ? "() {}" : ["class", "interface", "enum"].includes(kind) ? " {}" : " = 1"}`;

const hunk = (rows: ReadonlyArray<string>) => `@@ -1,1 +1,${rows.length} @@\n${rows.join("\n")}`;

const body = (lines: ReadonlyArray<string>) =>
  ["## What this does", "", "- A thing.", "", "## New names", "", ...lines, "", "## Laws and checks", "", "Ran."].join(
    "\n",
  );

describe("Names: each new exported name has a line under ## New names (0587)", () => {
  // Plants: read no `+` lines, forget a declaration kind, let a name in another part of the body
  // count, or count a name that is only a part of a longer word.
  it.prop(
    "property: a new export on a + line of a code file is refused until a ## New names line names it as a whole word",
    { kind: Kind, name: Ident, path: Code },
    ({ kind, name, path }) => {
      const patches: ReadonlyArray<Patch> = [{ path, patch: hunk([" const keep = 1;", `+${line(kind, name)}`]) }];
      expect(Names.added(patches)).toEqual([name]);
      const named = body([`- \`${name}\`: the industry's word, from https://example.org/source.`]);
      expect(Names.refusal(named, patches)).toBeNull();
      expect(Names.refusal(`${name} is in the summary\n\n${body([])}`, patches)).toContain(name);
      expect(Names.refusal(body([`- \`${name}x\``, `- \`x${name}\``]), patches)).toContain(name);
      expect(Names.refusal("## What this does\n\n- A thing.", patches)).toContain(name);
    },
  );

  // Plants: count a name a `-` line also exports, or read a test, a fixture or a Markdown file.
  it.prop(
    "property: a moved or reformatted export, and an export in a test, a fixture or a doc, asks for no line",
    { kind: Kind, name: Ident, path: Code },
    ({ kind, name, path }) => {
      const moved: ReadonlyArray<Patch> = [
        { path, patch: hunk([`+${line(kind, name)}`]) },
        { path: "src/old.ts", patch: hunk([`-${line(kind, name)}`]) },
      ];

      expect(Names.added(moved)).toEqual([]);

      for (const other of [
        "src/a.test.ts",
        "next/x/b.integration.test.tsx",
        "fixtures/toy/src/c.ts",
        "docs/plan/p.md",
      ]) {
        expect(Names.refusal("", [{ path: other, patch: hunk([`+${line(kind, name)}`]) }])).toBeNull();
      }
    },
  );

  // vector: export lines as this repo writes them, from Queue.ts, Arm.ts and PullRequests.ts.
  it("vector: a declaration gives its name, an export list gives each name or alias, and the rest give none", () => {
    expect(Names.exported('export const REQUIRED = "ci-required";')).toEqual(["REQUIRED"]);
    expect(Names.exported("export class NotQueued extends Schema.TaggedError<NotQueued>()(")).toEqual(["NotQueued"]);
    expect(Names.exported("export type Ask = {")).toEqual(["Ask"]);
    expect(Names.exported('export const add = Effect.fn("Queue.add")(function* (a: Ask) {')).toEqual(["add"]);
    expect(Names.exported("export function* walk(tree: Tree) {")).toEqual(["walk"]);
    expect(Names.exported("export default async function main() {")).toEqual(["main"]);
    expect(Names.exported("export declare abstract class Base {}")).toEqual(["Base"]);
    expect(Names.exported('export { a, b as c, type D, x as default } from "./x.ts";')).toEqual(["a", "c", "D"]);
    expect(Names.exported('export type { Patch } from "./PullRequests.ts";')).toEqual(["Patch"]);
    expect(Names.exported('export * from "./x.ts";')).toEqual([]);
    expect(Names.exported("export default {")).toEqual([]);
    expect(Names.exported("const local = 1;")).toEqual([]);
  });

  // scenario: GitHub leaves out a big file's patch, so its names cannot be read.
  it("scenario: a code file with no patch asks for the section, and a section with lines answers it", () => {
    const hidden: ReadonlyArray<Patch> = [{ path: "src/big.ts", patch: null }];
    expect(Names.refusal("## What this does\n\n- A thing.", hidden)).toContain("src/big.ts");
    expect(Names.refusal(body(["- None: the file only moves code."]), hidden)).toBeNull();
    expect(Names.refusal("", [{ path: "assets/logo.png", patch: null }])).toBeNull();
  });
});
