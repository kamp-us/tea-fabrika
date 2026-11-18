// M4 (0591): `pnpm lint:manifests` (`next-manifests.ts`) fires on each manifest break of the exam's
// planted tree and on nothing else, and passes the real next/. These laws were the manifest half of
// the exam's next/apps/fabrika/src/exam/deps.integration.test.ts until 0591 made it this command; its
// real-tree law is the command's run in `pnpm lint`, kept here too. Each planted tree is a temp folder
// of its own; nothing is written inside the repo.
// Plant: let the design package go to any next/ package, and design-taker's fault goes unseen.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { manifestFaults } from "./next-manifests.ts";

/** Plants `files` in a fresh folder, answers the command's faults there as `file reason dependency`. */
const faultsIn = (files: Readonly<Record<string, string>>): ReadonlyArray<string> => {
  const root = mkdtempSync(join(tmpdir(), "next-manifests-"));

  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }

    return manifestFaults(root).map((f) =>
      [f.file, f.reason, ...(f.dependency === undefined ? [] : [f.dependency])].join(" "),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

/** A `package.json` the way p65 wants one; `extra` overrides or adds fields. */
const manifest = (name: string, extra: object = {}): string =>
  JSON.stringify({
    name,
    version: "0.0.0",
    private: true,
    sideEffects: false,
    scripts: { typecheck: "tsc --noEmit" },
    exports: { ".": "./src/index.ts" },
    ...extra,
  });

const LIBRARY = "next/packages/libfabrika/package.json";

/** The exam's planted packages beside the library: each manifest, and the faults it must give. */
const PLANTED: ReadonlyArray<{ readonly file: string; readonly text: string; readonly faults: ReadonlyArray<string> }> =
  [
    {
      file: "next/packages/tuval/package.json",
      text: manifest("@kampus/tuval", {
        dependencies: {
          "@kampus/libfabrika": "workspace:*",
          "@kampus/fabrika-old": "workspace:*",
          "@kampus/fabrika-design": "workspace:*",
        },
      }),
      faults: [
        "next/packages/tuval/package.json today @kampus/fabrika-old",
        "next/packages/tuval/package.json outside @kampus/fabrika-old",
      ],
    },
    {
      file: "next/programs/counter/package.json",
      text: JSON.stringify({ name: "@kampus/counter", version: "1.0.0", exports: { ".": "./src/index.ts" } }),
      faults: [
        "next/programs/counter/package.json public",
        "next/programs/counter/package.json version",
        "next/programs/counter/package.json sideEffects",
        "next/programs/counter/package.json typecheck",
      ],
    },
    {
      // p65: the design package is the window's and the app's only, so the library may not name it.
      file: "next/packages/design-taker/package.json",
      text: manifest("@kampus/design-taker", { dependencies: { "@kampus/fabrika-design": "workspace:*" } }),
      faults: ["next/packages/design-taker/package.json outside @kampus/fabrika-design"],
    },
    {
      file: "next/apps/fabrika/package.json",
      text: manifest("@kampus/fabrika", {
        dependencies: { electron: "catalog:", "@kampus/fabrika-design": "workspace:*" },
      }),
      faults: [],
    },
  ];

describe("next/ package manifests (p65)", () => {
  it("scenario: the real next/ has packages that are private at 0.0.0, with no side effects, a typecheck, and nothing of today's", () => {
    expect(manifestFaults(join(import.meta.dirname, ".."))).toEqual([]);
  });

  it("fires on each manifest break, and on nothing else", () => {
    let whole = false;
    fc.assert(
      fc.property(fc.subarray([...PLANTED]), (planted) => {
        whole ||= planted.length === PLANTED.length;

        const found = faultsIn({
          [LIBRARY]: manifest("@kampus/libfabrika", { dependencies: { effect: "catalog:" } }),
          ...Object.fromEntries(planted.map((p) => [p.file, p.text])),
          // A folder with no package.json is no package, and a file at a group's top is none either.
          "next/packages/loose/src/index.ts": "export {};\n",
          "next/programs/package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
        });

        expect([...found].sort()).toEqual(planted.flatMap((p) => p.faults).sort());
      }),
      // The whole tree first, as the exam planted it.
      { seed: 119120, numRuns: 20, examples: [[[...PLANTED]]] },
    );
    expect(whole).toBe(true);
  });
});
