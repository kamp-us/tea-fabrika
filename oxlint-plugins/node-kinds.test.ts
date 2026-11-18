// M3 (0591): `pnpm lint:node-kinds` (`node-kinds.ts`) refuses a name in `node-kinds.json` that no
// file its glob matches exports, or that no string binds elsewhere in `next/`, and passes the real
// list. This was the exam's `next/apps/fabrika/src/exam/node-kinds.test.ts` (L6) until 0591 moved
// it here as a lint command; its real-list law is the command's run in `pnpm lint`, kept here too.
// Each planted tree is a temp folder of its own; nothing is written inside the repo.
// Plant: skip the binding check, and the exported-but-unbound name passes.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { nodeKindProblems } from "./node-kinds.ts";

const ROOT = join(import.meta.dirname, "..");

const KIND = "alchemy-durable-object-export";

const HOME = "next/apps/fabrika/src/brain.ts";

/** Plants `files` in a fresh folder, answers the command's problems there, and removes the folder. */
const problemsIn = (files: Readonly<Record<string, string>>): ReadonlyArray<string> => {
  const root = mkdtempSync(join(tmpdir(), "node-kinds-"));

  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }

    return nodeKindProblems(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const kinds = (files: string, exports: ReadonlyArray<string>) =>
  JSON.stringify({ entryExportConventions: { [KIND]: { files, exports } } });

/** How the made-up name stands in the planted tree. */
const SHAPES = ["neither", "exported only", "bound only", "bound in a comment", "both"] as const;

describe("node-kinds.json (L6)", () => {
  it("scenario: every name in the real list is exported by a file its glob matches and bound by that string elsewhere in next/", () => {
    // The real file and the checkout: on main, RecordPart and IsolateTail among them, from src/brain.ts.
    const text = readFileSync(join(ROOT, "node-kinds.json"), "utf8");
    expect(Object.keys(JSON.parse(text).entryExportConventions)).not.toEqual([]);
    expect(nodeKindProblems(ROOT)).toEqual([]);
  });

  it("refuses a made-up name no matching file exports or no string binds, and passes one that is real", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z][a-zA-Z]{2,12}$/).filter((name) => name !== "RecordPart"),
        fc.constantFrom(...SHAPES),
        (name, shape) => {
          seen.add(shape);
          const exported = shape === "exported only" || shape === "both";
          const bound = shape === "bound only" || shape === "both";

          const found = problemsIn({
            "package.json": "{}",
            "node-kinds.json": kinds("src/brain.ts", ["RecordPart", name]),
            "next/apps/fabrika/package.json": "{}",
            [HOME]: `export class RecordPart {}\n${exported ? `export class ${name} {}\n` : ""}`,
            "next/apps/fabrika/alchemy.run.ts": [
              'bind("RecordPart");',
              ...(bound ? [`bind("${name}");`] : []),
              ...(shape === "bound in a comment" ? [`// bind("${name}");`] : []),
            ].join("\n"),
            // A test file's string binds nothing, as code-graph classes tests.
            "next/apps/fabrika/src/brain.test.ts": `bind("${name}");`,
          });

          expect(found).toEqual([
            ...(exported ? [] : [`${KIND}: ${name} is not exported by ${HOME}`]),
            ...(bound ? [] : [`${KIND}: ${name} is bound by no string in next/ outside ${HOME}`]),
          ]);
        },
      ),
      { seed: 119120, numRuns: 20 },
    );
    // Coverage: every shape of the name was drawn, the unbound ones included.
    expect([...seen].sort()).toEqual([...SHAPES].sort());
  });

  it("refuses a glob that matches no file", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{3,10}$/), (stem) => {
        expect(
          problemsIn({
            "package.json": "{}",
            "node-kinds.json": kinds(`src/${stem}.mts`, ["RecordPart"]),
            "next/apps/fabrika/package.json": "{}",
            [HOME]: "export class RecordPart {}\n",
          }),
        ).toEqual([`${KIND}: its glob src/${stem}.mts matches no file`]);
      }),
      { seed: 119120, numRuns: 20 },
    );
  });
});
