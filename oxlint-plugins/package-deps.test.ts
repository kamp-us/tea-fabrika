// M4 (0591): `fabrika/package-deps` fires on each import break of the exam's planted trees and on
// nothing else, through the repo's own `.oxlintrc.json`, and reads an `exports` map by Node's
// longest-pattern rule. These laws were the import half of the exam's
// next/apps/fabrika/src/exam/deps.integration.test.ts until 0591 made it this rule; its real-tree law
// is the rule's run in `pnpm lint`. Each planted tree keeps the exam's files, at `next/` paths.
// Plant: pick the first exports key that fits, not the longest, and the internal files go through.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exportAt, MESSAGES } from "./package-deps.ts";
import { plant } from "./plant.ts";

const CODE = "fabrika(package-deps)";
const LIBRARY = "@kampus/libfabrika";

const lines = (...each: ReadonlyArray<string>): string => `${each.join("\n")}\n`;

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

/** Lints the planted tree and answers each file's fires of this rule as `line message`. */
const fires = async (files: Readonly<Record<string, string>>) => {
  const found = await plant(files, (fire) => `${fire.line} ${fire.message}`);
  return (file: string) => found(CODE, file);
};

describe("reading imports", () => {
  it("finds static, type, re-export, bare, multi-line and dynamic imports, and skips comments", async () => {
    // built from two strings, so no scan reads it as this file's own import
    const dynamic = `const m = ${"import"}("@pierre/highlights");`;
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("packages", "programs", "apps"),
        fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
        async (group, name) => {
          const file = `next/${group}/${name}/src/reader.ts`;
          const found = await fires({
            [`next/${group}/${name}/package.json`]: manifest(`@kampus/${name}`),
            [`next/${group}/${name}/src/wire.ts`]: "export type Wire = 1;\n",
            [`next/${group}/${name}/src/fold.ts`]: "export const fold = 1;\n",
            [file]: lines(
              'import {Effect} from "effect";',
              'import type {Wire} from "./wire.ts";',
              'export {fold} from "./fold.ts";',
              'import "./style.css";',
              "import {",
              "\ta,",
              "\tb,",
              '} from "@kampus/libfabrika";',
              dynamic,
              '// import {x} from "not-this";',
              // The exam's text reader saw this line alone; oxlint reads a file that parses.
              "/*",
              ' * import {y} from "nor-this";',
              " */",
            ),
          });
          expect(found(file)).toEqual([
            `1 ${MESSAGES.unlisted("effect", "effect")}`,
            `8 ${MESSAGES.unlisted(LIBRARY, LIBRARY)}`,
            `9 ${MESSAGES.unlisted("@pierre/highlights", "@pierre/highlights")}`,
          ]);
        },
      ),
      { seed: 119120, numRuns: 6 },
    );
  });
});

/** The exam's planted tree: the packages every break leans on. */
const BASE: Readonly<Record<string, string>> = {
  "next/packages/libfabrika/package.json": manifest(LIBRARY, {
    exports: { ".": "./src/index.ts", "./transport/*": "./src/transport/*.ts", "./transport/internal/*": null },
    dependencies: { effect: "catalog:" },
  }),
  "next/packages/libfabrika/src/index.ts": lines(
    'import {Effect} from "effect";',
    'import {readFileSync} from "node:fs";',
  ),
  "next/packages/libfabrika/src/transport/Wire.ts": lines("export const wire = 1;"),
  "next/packages/libfabrika/src/transport/internal/binary.ts": lines("export const binary = 1;"),
  "next/packages/tuval/package.json": manifest("@kampus/tuval", {
    dependencies: {
      [LIBRARY]: "workspace:*",
      "@kampus/fabrika-old": "workspace:*",
      "@kampus/fabrika-design": "workspace:*",
    },
  }),
  "next/programs/counter/package.json": JSON.stringify({
    name: "@kampus/counter",
    version: "1.0.0",
    exports: { ".": "./src/index.ts" },
  }),
  // p65: the design package is the window's and the app's only, so the library may not name it.
  "next/packages/design-taker/package.json": manifest("@kampus/design-taker", {
    dependencies: { "@kampus/fabrika-design": "workspace:*" },
  }),
  "next/apps/fabrika/package.json": manifest("@kampus/fabrika", { dependencies: { electron: "catalog:" } }),
  "next/apps/fabrika/src/entry/electron-main.ts": lines('import {app} from "electron";'),
};

/** Each break of the exam's tree: its file, its text, and the fires it must give, as `line message`. */
const BREAKS: ReadonlyArray<{ readonly file: string; readonly text: string; readonly fires: ReadonlyArray<string> }> = [
  {
    file: "next/packages/tuval/src/index.ts",
    text: lines(
      'import {wire} from "@kampus/libfabrika/transport/Wire";',
      'import {binary} from "@kampus/libfabrika/transport/internal/binary";',
      'import {nope} from "@kampus/libfabrika/transport/Nope";',
      'import {log} from "@kampus/libfabrika/src/ledger/Log.ts";',
      'import {lane} from "@kampus/pipeline";',
    ),
    fires: [
      `2 ${MESSAGES.refused("@kampus/libfabrika/transport/internal/binary", "./transport/internal/binary", LIBRARY)}`,
      `3 ${MESSAGES.nofile("@kampus/libfabrika/transport/Nope", "./transport/Nope", LIBRARY)}`,
      `4 ${MESSAGES.missing("@kampus/libfabrika/src/ledger/Log.ts", "./src/ledger/Log.ts", LIBRARY)}`,
      `5 ${MESSAGES.unlisted("@kampus/pipeline", "@kampus/pipeline")}`,
    ],
  },
  {
    file: "next/programs/counter/src/index.ts",
    text: lines('import {run} from "../../../packages/libfabrika/src/index.ts";'),
    fires: [`1 ${MESSAGES.relative("../../../packages/libfabrika/src/index.ts")}`],
  },
  {
    file: "next/apps/fabrika/src/brain.ts",
    text: lines('import {app} from "electron";'),
    fires: [`1 ${MESSAGES.electron("electron")}`],
  },
  { file: "next/src/stray.ts", text: lines("export const stray = 1;"), fires: [`1 ${MESSAGES.stray()}`] },
];

describe("planted breaks", () => {
  it("fires on each import break, and on nothing else", async () => {
    let whole = false;
    await fc.assert(
      fc.asyncProperty(fc.subarray([...BREAKS], { minLength: 1 }), async (breaks) => {
        whole ||= breaks.length === BREAKS.length;
        const found = await fires({ ...BASE, ...Object.fromEntries(breaks.map((b) => [b.file, b.text])) });

        for (const each of breaks) {
          expect(found(each.file), each.file).toEqual(each.fires);
        }

        for (const clean of Object.keys(BASE)) {
          expect(found(clean), clean).toEqual([]);
        }
      }),
      // The whole tree first, as the exam planted it.
      { seed: 119120, numRuns: 6, examples: [[[...BREAKS]]] },
    );
    expect(whole).toBe(true);
  });

  it("lets the exam's own files sit outside a package until the app has one", async () => {
    const early = {
      "next/apps/fabrika/e2e.ts": lines('import {Effect} from "effect";'),
      "next/apps/fabrika/e2e/door.test.ts": lines('import {it} from "vitest";'),
      "next/apps/fabrika/src/exam/deps.test.ts": lines('import {it} from "vitest";'),
      "next/apps/fabrika/src/brain.ts": lines('import {Effect} from "effect";'),
    };
    const found = await fires(early);
    expect(Object.keys(early).map((file) => [file, found(file)])).toEqual([
      ["next/apps/fabrika/e2e.ts", []],
      ["next/apps/fabrika/e2e/door.test.ts", []],
      ["next/apps/fabrika/src/exam/deps.test.ts", []],
      ["next/apps/fabrika/src/brain.ts", [`1 ${MESSAGES.stray()}`]],
    ]);
  });

  it("judges next/ files only, so its .agents/ twin in the config says nothing", async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/), async (name) => {
        const file = `.agents/skills/${name}/scripts/tool.ts`;
        const found = await fires({ [file]: lines('import {Effect} from "effect";', 'import "../../../../x.ts";') });
        expect(found(file)).toEqual([]);
      }),
      { seed: 119120, numRuns: 6 },
    );
  });
});

// Ticket 477, kind 2 (PR 9): each module has a pair of keys, `"./<module>/*": "./src/<module>/*.ts"` and
// `"./<module>/internal/*": null`. The rule reads an exports map the way Node does: a pattern key holds
// one `*`, and `"./ledger/internal/*": null` beats `"./ledger/*"` because its part before the `*` is
// longer.
describe("a module's front files and its internal/ in the exports map", () => {
  const MODULES = [
    "telemetry",
    "ledger",
    "transport",
    "processes",
    "presence",
    "access",
    "runtime",
    "gateway",
    "desktop",
    "client",
  ] as const;
  const module = fc.constantFrom(...MODULES);
  const name = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,8}$/);
  const real = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "next/packages/libfabrika/package.json"), "utf8"),
  ).exports;

  // pinned: the pair the plan writes (PR 9), since each module's two keys are written by hand.
  it("pinned: every module has the pair of keys the plan gives it", () => {
    for (const each of MODULES) {
      expect(real[`./${each}/*`], `./${each}/*`).toBe(`./src/${each}/*.ts`);
      expect(real[`./${each}/internal/*`], `./${each}/internal/*`).toBeNull();
    }
  });

  it("Node's rule: the longest pattern wins, and null refuses, whatever the order of the keys", () => {
    const sub = fc.tuple(
      module,
      fc.constantFrom("front", "internal"),
      name,
      fc.shuffledSubarray(["pattern", "null"], { minLength: 2 }),
    );
    fc.assert(
      fc.property(sub, ([each, kind, stem, order]) => {
        const entries = order.map((key): [string, string | undefined] =>
          key === "pattern" ? [`./${each}/*`, `/pkg/src/${each}/*.ts`] : [`./${each}/internal/*`, undefined],
        );
        const at = kind === "front" ? `./${each}/${stem}` : `./${each}/internal/${stem}`;
        expect(exportAt(new Map(entries), at)).toEqual(
          kind === "front" ? { _tag: "file", file: `/pkg/src/${each}/${stem}.ts` } : { _tag: "refused" },
        );
        expect(exportAt(new Map(entries), `./other/${stem}`)).toEqual({ _tag: "missing" });
      }),
      // The exam's full-run count: this folder's tests run only in the full run (0590).
      { seed: 119120, numRuns: 200 },
    );
  });

  // The app imports subpaths of the library whose real `exports` is read from the real package. A
  // front file is reached. An internal file is refused even though it exists, and a name no file has
  // reaches nothing. Each run plants up to ten imports at once, one file each, so the exam's 60 cases
  // cost six oxlint runs.
  type Case = readonly [(typeof MODULES)[number], "front" | "internal" | "missing", string];
  // pinned: the plan's plant (ticket 477), the ledger's store imported from the app, runs first.
  const pinned: Case = ["ledger", "internal", "ledgerStore"];
  it("each module's front files are reached and its internal/ is refused to other packages", async () => {
    const kinds = new Set<string>();
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.tuple(module, fc.constantFrom("front", "internal", "missing"), name), {
          minLength: 1,
          maxLength: 10,
          selector: ([each, , stem]) => `${each}/${stem.toLowerCase()}`,
        }),
        async (generated) => {
          const cases: ReadonlyArray<Case> = [
            pinned,
            ...generated.filter(([each, , stem]) => `${each}/${stem.toLowerCase()}` !== "ledger/ledgerstore"),
          ];
          const files: Record<string, string> = {
            "next/packages/libfabrika/package.json": manifest(LIBRARY, { exports: real }),
            "next/apps/fabrika/package.json": manifest("@kampus/fabrika", {
              dependencies: { [LIBRARY]: "workspace:*" },
            }),
          };

          cases.forEach(([each, kind, stem], i) => {
            const subpath = kind === "internal" ? `${each}/internal/${stem}` : `${each}/${stem}`;
            files[`next/packages/libfabrika/src/${each}/internal/${stem}.ts`] = lines("export const inside = 1;");

            if (kind !== "missing") {
              files[`next/packages/libfabrika/src/${subpath}.ts`] = lines("export const front = 1;");
            }

            files[`next/apps/fabrika/src/use${i}.ts`] = lines(`import {x} from "${LIBRARY}/${subpath}";`);
          });
          const found = await fires(files);

          cases.forEach(([each, kind, stem], i) => {
            kinds.add(kind);
            const subpath = kind === "internal" ? `${each}/internal/${stem}` : `${each}/${stem}`;
            const spec = `${LIBRARY}/${subpath}`;
            expect(found(`next/apps/fabrika/src/use${i}.ts`), spec).toEqual(
              kind === "front"
                ? []
                : kind === "internal"
                  ? [`1 ${MESSAGES.refused(spec, `./${subpath}`, LIBRARY)}`]
                  : [`1 ${MESSAGES.nofile(spec, `./${subpath}`, LIBRARY)}`],
            );
          });
        },
      ),
      { seed: 119120, numRuns: 6 },
    );
    // Coverage: a front file, an internal one and a missing one were each drawn.
    expect([...kinds].sort()).toEqual(["front", "internal", "missing"]);
  });
});
