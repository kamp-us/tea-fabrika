// p32 and p65, strict layers (docs/plan/tier-1-detail.md, "Strict layers"). The checks are `pnpm
// lint` (AGENTS.md, "Checks": a check on the shape of code is a lint rule, never a test):
//   - `pnpm lint:layers` runs the patched code-graph on `layer-rules.json`. A row's `layer` ranks it
//     (demlik issue 913), its `imports` list names the rows it may reach (issue 763), `roots` fails a
//     library or tuval file that no row claims (issue 947), and `testFiles` keeps a test to the
//     upward and sideways rules only (issue 948).
//   - `fabrika/package-imports` (oxlint, `.oxlintrc.json`) holds the names of our own packages each
//     part may import, as written. Its laws are `oxlint-plugins/package-imports.test.ts`.
// These laws run the real tool on planted trees, with the real rule file where the rule data is the
// subject, so each wall is seen to fire before it is trusted on `next/` (ticket 987). Written by the
// exam (Tier 1, P1).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import type { Row } from "./rows.ts";

const NEXT = resolve(import.meta.dirname, "../../../..");
const bin = resolve(NEXT, "..", "node_modules", ".bin", "code-graph");

// A planter owns every tree its test plants. The test's scope removes them when the test ends (0061).
const planter = Effect.acquireRelease(
  Effect.sync(() => {
    const roots: Array<string> = [];
    const plant = (files: Readonly<Record<string, string | object>>): string => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "next-exam-")));
      roots.push(root);

      for (const [path, body] of Object.entries({ "package.json": { name: "plant", private: true }, ...files })) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), typeof body === "string" ? body : JSON.stringify(body));
      }

      return root;
    };
    return { plant, roots };
  }),
  ({ roots }) =>
    Effect.sync(() => {
      for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
      }
    }),
);

const lines = (...each: ReadonlyArray<string>): string => `${each.join("\n")}\n`;

const RuleRow = Schema.Struct({
  name: Schema.String,
  paths: Schema.Array(Schema.String),
  layer: Schema.optionalKey(Schema.Number),
  imports: Schema.optionalKey(Schema.Array(Schema.String)),
});

const RuleFile = Schema.Struct({
  layers: Schema.Array(RuleRow),
  roots: Schema.optionalKey(Schema.Array(Schema.String)),
  testFiles: Schema.optionalKey(Schema.Array(Schema.String)),
});

type Rules = typeof RuleFile.Type;

/** Each row that has a layer, by its name. */
const layersByName = (rows: Rules["layers"]): ReadonlyMap<string, number> =>
  new Map(rows.flatMap((row) => (row.layer === undefined ? [] : [[row.name, row.layer] as const])));

/** The rule file `pnpm lint:layers` reads. Its paths start at the top of the repo. */
const REAL: Rules = Schema.decodeUnknownSync(RuleFile)(
  JSON.parse(readFileSync(resolve(NEXT, "../layer-rules.json"), "utf8")),
);

const Report = Schema.Struct({
  violations: Schema.Array(
    Schema.Struct({
      from: Schema.String,
      fromLayer: Schema.String,
      toLayer: Schema.String,
      rule: Schema.optionalKey(Schema.String),
    }),
  ),
  unclaimed: Schema.Array(Schema.Struct({ file: Schema.String })),
});

const readReport = Schema.decodeUnknownSync(Schema.fromJsonString(Report));

type Edge = `${string} -> ${string} [${string}]`;

/** The tool's `--layers --json` on a planted root, with these rules. Exit 2 has no report. */
const runJson = (root: string, rules: Rules) => {
  writeFileSync(join(root, "rules.json"), JSON.stringify(rules));
  const run = spawnSync(bin, [".", "--layers", "--json", "--layer-rules", "rules.json"], {
    cwd: root,
    encoding: "utf8",
  });
  // A rule file with no `layer` and no `imports` names no rule, since every break it has is upward.
  const report =
    run.status === 2
      ? { violations: [], unclaimed: [] }
      : (({ violations, unclaimed }: typeof Report.Type) => ({
          violations: violations.map((v) => ({ ...v, rule: v.rule ?? "upward" })),
          unclaimed,
        }))(readReport(run.stdout));
  return { ...report, status: run.status, stderr: run.stderr };
};

/** Each import that breaks a rule as `from-file -> to-row [rule]`, each unclaimed file, the status. */
const runTool = (root: string, rules: Rules) => {
  const run = runJson(root, rules);
  return {
    edges: [...new Set(run.violations.map((v): Edge => `${v.from} -> ${v.toLayer} [${v.rule}]`))].sort(),
    unclaimed: run.unclaimed.map((u) => u.file).sort(),
    status: run.status,
    stderr: run.stderr,
  };
};

/** The breaks of the rank rules only, as `from-row -> to-row [rule]`, for the layer laws. */
const RANKS = ["upward", "sideways"];

const rowEdges = (root: string, rules: Rules): ReadonlyArray<Edge> =>
  [
    ...new Set(
      runJson(root, rules)
        .violations.filter((v) => RANKS.includes(v.rule))
        .map((v): Edge => `${v.fromLayer} -> ${v.toLayer} [${v.rule}]`),
    ),
  ].sort();

const LIB = "next/packages/libfabrika/src";
const TUVAL = "next/packages/tuval/src";

describe("the real rule file on planted trees", () => {
  // scenario: each line is one named wall of the table, met in a module folder: the ledger may not
  // import processes, transport may not import the ledger, processes and access may not import the
  // gateway or the runtime, and the runtime may not import the ledger or transport. The runtime's
  // stores and `coordination/index.ts` are coordination until old PR 13, so their ledger imports pass.
  // Plant: put `runtime/ProcessStore.ts` back in the runtime's row. Its ledger import then fires.
  it.effect("scenario: every wall between the library's modules fires, and nothing else", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const tree = plant({
        [`${LIB}/Id.ts`]: lines("export const id = 1;"),
        [`${LIB}/telemetry/Sink.ts`]: lines('import {id} from "../Id.ts";'),
        [`${LIB}/ledger/Log.ts`]: lines('import {sink} from "../telemetry/Sink.ts";'),
        [`${LIB}/ledger/Ledger.ts`]: lines('import {mailbox} from "../processes/Mailbox.ts";'),
        [`${LIB}/transport/Wire.ts`]: lines('import {log} from "../ledger/Log.ts";'),
        [`${LIB}/processes/Mailbox.ts`]: lines(
          'import {log} from "../ledger/Log.ts";',
          'import {Gateway} from "../gateway/Gateway.ts";',
        ),
        [`${LIB}/access/Access.ts`]: lines(
          'import {mailbox} from "../processes/Mailbox.ts";',
          'import {run} from "../runtime/Runner.ts";',
        ),
        [`${LIB}/runtime/Runner.ts`]: lines(
          'import {mailbox} from "../processes/Mailbox.ts";',
          'import {store} from "./ProcessStore.ts";',
          'import {log} from "../ledger/Log.ts";',
          'import {wire} from "../transport/Wire.ts";',
        ),
        [`${LIB}/runtime/ProcessStore.ts`]: lines('import {log} from "../ledger/Log.ts";'),
        [`${LIB}/runtime/RecoveryStore.ts`]: lines('import {log} from "../ledger/Log.ts";'),
        [`${LIB}/runtime/internal/recovery.ts`]: lines('import {log} from "../../ledger/Log.ts";'),
        [`${LIB}/runtime/internal/supervisor.ts`]: lines('import {log} from "../../ledger/Log.ts";'),
        [`${LIB}/coordination/index.ts`]: lines('export {log} from "../ledger/Log.ts";'),
        [`${LIB}/gateway/Gateway.ts`]: lines(
          'import {run} from "../runtime/Runner.ts";',
          'import {members} from "../access/Access.ts";',
          'import {log} from "../ledger/Log.ts";',
          'import {wire} from "../transport/Wire.ts";',
        ),
        [`${LIB}/gateway/internal/waiting.ts`]: lines('import {wire} from "../../transport/Wire.ts";'),
      });
      const walls = [
        `${LIB}/access/Access.ts -> next-runtime [upward]`,
        `${LIB}/ledger/Ledger.ts -> next-processes [upward]`,
        `${LIB}/processes/Mailbox.ts -> next-door [upward]`,
        `${LIB}/runtime/Runner.ts -> next-ledger [outside-imports]`,
        `${LIB}/runtime/Runner.ts -> next-transport [outside-imports]`,
        `${LIB}/runtime/internal/supervisor.ts -> next-ledger [outside-imports]`,
        `${LIB}/transport/Wire.ts -> next-ledger [sideways]`,
      ];
      expect(runTool(tree, REAL)).toMatchObject({ edges: walls, unclaimed: [], status: 1 });

      const store = `${LIB}/runtime/ProcessStore.ts`;
      const moved = REAL.layers.map((row) =>
        row.name === "next-runtime-coordination" ? { ...row, paths: row.paths.filter((p) => p !== store) } : row,
      );
      expect(runTool(tree, { ...REAL, layers: moved }).edges).toEqual(
        [...walls, `${store} -> next-ledger [outside-imports]`].sort(),
      );
    }),
  );

  // scenario: P17a, the gateway composes the lower modules, and none of them imports it.
  it.effect("scenario: the gateway composes lower modules; lower modules cannot import it", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const lower = ["ledger", "processes", "runtime", "transport"];
      const tree = plant({
        [`${LIB}/gateway/Gateway.ts`]: lines(
          'import {run} from "../runtime/Runner.ts";',
          'import {member} from "../processes/Process.ts";',
          'import {log} from "../ledger/Log.ts";',
          'import {wire} from "../transport/Wire.ts";',
        ),
        [`${LIB}/runtime/Runner.ts`]: lines("export const run = 1;"),
        [`${LIB}/processes/Process.ts`]: lines("export const member = 1;"),
        [`${LIB}/ledger/Log.ts`]: lines("export const log = 1;"),
        [`${LIB}/transport/Wire.ts`]: lines("export const wire = 1;"),
        ...Object.fromEntries(
          lower.map((module) => [`${LIB}/${module}/Up.ts`, lines('import {Gateway} from "../gateway/Gateway.ts";')]),
        ),
      });
      expect(runTool(tree, REAL).edges).toEqual(lower.map((module) => `${LIB}/${module}/Up.ts -> next-door [upward]`));
    }),
  );

  // scenario: P18 L8, the window client takes the runtime, transport and Id, and transport may not
  // import it. P18 slice 2 (ticket 979, its plan's "Where each file lives"): the client also takes
  // the processes, for `Down`, `inSignalSpace`, `clientInbox` and `ExitReason`. A lower module its
  // row does not list, such as access, stays refused.
  it.effect(
    "scenario: the client takes runtime, processes, transport and Id, refuses a lower module its row does not list, and transport may not import it",
    () =>
      Effect.gen(function* () {
        const { plant } = yield* planter;
        const tree = plant({
          [`${LIB}/client/WindowStart.ts`]: lines(
            'import {Client} from "../runtime/Client.ts";',
            'import {Down} from "../processes/Process.ts";',
            'import {Link} from "../transport/Link.ts";',
            'import {Generator} from "../Id.ts";',
          ),
          [`${LIB}/client/Grant.ts`]: lines('import {members} from "../access/Access.ts";'),
          [`${LIB}/transport/Dial.ts`]: lines('import {start} from "../client/WindowStart.ts";'),
          [`${LIB}/runtime/Client.ts`]: lines("export const Client = 1;"),
          [`${LIB}/processes/Process.ts`]: lines("export const Down = 1;"),
          [`${LIB}/access/Access.ts`]: lines("export const members = 1;"),
          [`${LIB}/transport/Link.ts`]: lines("export const Link = 1;"),
          [`${LIB}/Id.ts`]: lines("export const Generator = 1;"),
        });
        expect(runTool(tree, REAL).edges).toEqual([
          `${LIB}/client/Grant.ts -> next-access [outside-imports]`,
          `${LIB}/transport/Dial.ts -> next-client [upward]`,
        ]);
      }),
  );

  // format: P21 L12, the desktop module takes access and refuses the gateway and the platform
  // folders; a folder no row claims is refused as unclaimed.
  it.effect("format: P21 L12 desktop rules accept access and refuse gateway and platform modules", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const tree = plant({
        [`${LIB}/desktop/Menu.ts`]: lines(
          'import { Grant } from "../access/Access.ts";',
          'import { Gateway } from "../gateway/Gateway.ts";',
          'import { load } from "../node/settings/Load.ts";',
          'import { object } from "../cloudflare/objects.ts";',
          'import { TouchId } from "../electron/TouchId.ts";',
        ),
        [`${LIB}/access/Access.ts`]: lines("export const Grant = 1;"),
        [`${LIB}/gateway/Gateway.ts`]: lines("export const Gateway = 1;"),
        [`${LIB}/node/settings/Load.ts`]: lines("export const load = 1;"),
        [`${LIB}/cloudflare/objects.ts`]: lines("export const object = 1;"),
        [`${LIB}/electron/TouchId.ts`]: lines("export const TouchId = 1;"),
      });
      expect(runTool(tree, REAL)).toMatchObject({
        edges: [
          `${LIB}/desktop/Menu.ts -> next-door [sideways]`,
          `${LIB}/desktop/Menu.ts -> next-node [upward]`,
          `${LIB}/desktop/Menu.ts -> next-workers [upward]`,
        ],
        unclaimed: [`${LIB}/electron/TouchId.ts`],
      });
    }),
  );

  // scenario: tuval's folders and a program's box and window, and the library under all of them,
  // since the parts above the library may import it and it imports none of them, tests included.
  // This holds a file a row claims. A library file no row claims, a test or a file outside `src/`,
  // is held by name in `fabrika/package-imports`, whose library part covers the whole package.
  // Plant: put the tuval and program rows below `next-node` again, as they were. The node test's
  // tuval import then reads as downward and passes.
  it.effect("scenario: tuval's folders, a program's box and window, and nothing above the library", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const tree = plant({
        "pnpm-workspace.yaml": 'packages:\n  - "next/packages/*"\n  - "next/programs/*"\n',
        "next/packages/tuval/package.json": { name: "@kampus/tuval", exports: { ".": "./src/index.ts" } },
        "next/packages/libfabrika/package.json": { name: "@kampus/libfabrika", exports: { ".": "./src/index.ts" } },
        "next/programs/notes/package.json": {
          name: "@kampus/notes",
          exports: { ".": "./src/program.ts", "./window": "./src/view.tsx" },
        },
        [`${TUVAL}/index.ts`]: lines('export {fold} from "./desktop/fold.ts";'),
        [`${TUVAL}/desktop/fold.ts`]: lines("export const fold = 1;"),
        [`${TUVAL}/desktop/layout.ts`]: lines("export const layout = 1;"),
        [`${TUVAL}/window/main.ts`]: lines('import {layout} from "../desktop/layout.ts";'),
        [`${TUVAL}/window/machine.ts`]: lines('import {key} from "../browser/key.ts";'),
        [`${TUVAL}/dom/root.ts`]: lines('import {layout} from "../desktop/layout.ts";'),
        [`${TUVAL}/dom/drawn.ts`]: lines('import {main} from "../window/main.ts";'),
        [`${TUVAL}/browser/key.ts`]: lines('import {root} from "../dom/root.ts";'),
        [`${TUVAL}/electron/menu.ts`]: lines('import {root} from "../dom/root.ts";'),
        [`${TUVAL}/headless/run.ts`]: lines('import {main} from "../window/main.ts";'),
        "next/programs/notes/src/program.ts": lines('import {root} from "./root.ts";'),
        "next/programs/notes/src/root.ts": lines("export const root = 1;"),
        "next/programs/notes/src/box.ts": lines('import {View} from "./view.tsx";'),
        "next/programs/notes/src/view.tsx": lines('import {notes} from "./program.ts";'),
        [`${LIB}/index.ts`]: lines("export const run = 1;"),
        [`${LIB}/ledger/Log.ts`]: lines('import {fold} from "@kampus/tuval";'),
        [`${LIB}/ledger/Log.test.ts`]: lines('import {notes} from "@kampus/notes";'),
        [`${LIB}/node/Up.test.ts`]: lines('import {fold} from "@kampus/tuval";'),
      });
      const parts = [
        `${LIB}/ledger/Log.test.ts -> next-programs [upward]`,
        `${LIB}/ledger/Log.ts -> next-tuval-entry [upward]`,
        `${LIB}/node/Up.test.ts -> next-tuval-entry [upward]`,
        `${TUVAL}/dom/drawn.ts -> next-window [outside-imports]`,
        `${TUVAL}/headless/run.ts -> next-window [outside-imports]`,
        `${TUVAL}/window/machine.ts -> next-browser [upward]`,
        "next/programs/notes/src/box.ts -> next-program-windows [upward]",
      ];
      expect(runTool(tree, REAL)).toMatchObject({ edges: parts, unclaimed: [], status: 1 });

      const node = REAL.layers.findIndex((row) => row.name === "next-node");
      const below = [
        ...REAL.layers.slice(0, 1),
        ...REAL.layers.slice(node, node + 2),
        ...REAL.layers.slice(1, node),
        ...REAL.layers.slice(node + 2),
      ];
      expect(below.map((row) => row.name).slice(0, 4)).toEqual([
        "next-apps",
        "next-node",
        "next-workers",
        "next-program-windows",
      ]);
      expect(runTool(tree, { ...REAL, layers: below }).edges).not.toContain(
        `${LIB}/node/Up.test.ts -> next-tuval-entry [upward]`,
      );
    }),
  );

  // scenario: the plan's plant (ticket 477), a new folder with no row and a new top file, in the
  // library and in tuval, beside a file in every folder or file the real rows claim there, since a
  // move must not land ahead of its rule file change. Tests there are not judged.
  // Plant: drop `roots`. Then nothing is unclaimed and the tool exits 0.
  it.effect("scenario: a library or tuval file no row claims fails, and a test there does not", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const claimed = REAL.layers
        .flatMap((row) => row.paths)
        .filter((path) => (path.startsWith(`${LIB}/`) || path.startsWith(`${TUVAL}/`)) && !path.includes("*"))
        .map((path) => (/\.tsx?$/.test(path) ? path : `${path}/Probe.ts`));
      const tree = plant({
        ...Object.fromEntries(claimed.map((path) => [path, lines("export const probe = 1;")])),
        [`${LIB}/sync/Merge.ts`]: lines("export const merge = 1;"),
        [`${LIB}/sync/Merge.test.ts`]: lines("export const merge = 1;"),
        [`${LIB}/Loose.ts`]: lines("export const loose = 1;"),
        [`${LIB}/Loose.test.ts`]: lines("export const loose = 1;"),
        [`${TUVAL}/sync/view.ts`]: lines("export const view = 1;"),
        [`${TUVAL}/Loose.tsx`]: lines("export const loose = 1;"),
      });
      const stray = [`${LIB}/Loose.ts`, `${LIB}/sync/Merge.ts`, `${TUVAL}/Loose.tsx`, `${TUVAL}/sync/view.ts`];
      expect(claimed.length).toBeGreaterThan(30);
      expect(runTool(tree, REAL)).toMatchObject({ edges: [], unclaimed: stray, status: 1 });
      const { roots: _roots, ...rootless } = REAL;
      expect(runTool(tree, rootless)).toMatchObject({ unclaimed: [], status: 0 });
    }),
  );

  // scenario: two rows that claim one file equally, since code-graph stops on that file and names
  // no row, and must not pick one for it.
  it.effect("scenario: a file two rows claim equally stops the tool", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const tree = plant({ [`${LIB}/ledger/Log.ts`]: lines("export const a = 1;") });
      expect(runTool(tree, REAL).status).toBe(0);
      const twice = [
        ...REAL.layers.map((row) =>
          row.name === "next-ledger" ? { ...row, paths: [...row.paths, `${LIB}/ledger/*`] } : row,
        ),
        { name: "plant-twin", paths: [`${LIB}/*/Log.ts`] },
      ];
      const run = runTool(tree, { ...REAL, layers: twice });
      expect(run.status).toBe(2);
      expect(run.stderr).toContain(`${LIB}/ledger/Log.ts`);
    }),
  );

  // scenario: L12 uses the actual repository row and real tool to refuse peers and platform code.
  it.effect("scenario: T878 L12 repositories cannot import a peer, packs or Node wiring", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const tree = plant({
        [`${LIB}/repositories/Repositories.ts`]: lines(
          'import {setting} from "../settings/Setting.ts";',
          'import {open} from "../packs/Open.ts";',
          'import {git} from "../node/repositories/RepositoriesGit.ts";',
          'import {id} from "../Id.ts";',
          "export {setting, open, git, id};",
        ),
        [`${LIB}/settings/Setting.ts`]: lines("export const setting = 1;"),
        [`${LIB}/packs/Open.ts`]: lines("export const open = 1;"),
        [`${LIB}/node/repositories/RepositoriesGit.ts`]: lines("export const git = 1;"),
        [`${LIB}/Id.ts`]: lines("export const id = 1;"),
      });
      expect(runTool(tree, REAL)).toMatchObject({
        edges: [
          `${LIB}/repositories/Repositories.ts -> next-node [upward]`,
          `${LIB}/repositories/Repositories.ts -> next-packs [upward]`,
          `${LIB}/repositories/Repositories.ts -> next-settings [sideways]`,
        ],
        status: 1,
      });
    }),
  );

  // The rule file's modules: one probe file per row that has a layer, each importing the probe of
  // every other row. The tool breaks exactly the imports that do not go down a layer.
  const SRC_ROWS = REAL.layers.filter((row) => row.layer !== undefined && row.paths.every((p) => p.startsWith(LIB)));
  const probe = (row: Row): string => {
    const first = row.paths[0] ?? "";
    return /\.tsx?$/.test(first) ? first : `${first}/Probe.ts`;
  };
  const expectedEdges = (rows: ReadonlyArray<Row>): ReadonlyArray<Edge> => {
    const ranks = new Map(rows.flatMap((row) => (row.layer === undefined ? [] : [[row.name, row.layer] as const])));
    return SRC_ROWS.flatMap((from) =>
      SRC_ROWS.flatMap((to): ReadonlyArray<Edge> => {
        const [a, b] = [ranks.get(from.name), ranks.get(to.name)];
        return from.name === to.name || a === undefined || b === undefined || a > b
          ? []
          : [`${from.name} -> ${to.name} [${a === b ? "sideways" : "upward"}]`];
      }),
    ).sort();
  };
  const plantedReal = planter.pipe(
    Effect.map(({ plant }) =>
      plant(
        Object.fromEntries(
          SRC_ROWS.map((row) => [
            probe(row),
            lines(
              ...SRC_ROWS.filter((other) => other.name !== row.name).map((other, n) => {
                const spec = relative(dirname(probe(row)), probe(other));
                return `import * as m${n} from "${spec.startsWith(".") ? spec : `./${spec}`}";`;
              }),
              "export const p = 1;",
            ),
          ]),
        ),
      ),
    ),
  );

  // scenario: the real rule file, since "no module imports a higher layer or its own layer" is only
  // true of the rows as written. Every ordered pair of modules is one planted import.
  it.effect("scenario: on the real rule file only downward imports between modules pass", () =>
    Effect.gen(function* () {
      const realTree = yield* plantedReal;
      const edges = rowEdges(realTree, REAL);
      expect(edges).toEqual(expectedEdges(REAL.layers));
      expect(edges).not.toContain("next-node -> next-workers [sideways]");
      expect(edges).toContain("next-processes -> next-presence [sideways]");
      expect(edges).toContain("next-transport -> next-ledger [sideways]");
      expect(edges).not.toContain("next-runtime -> next-ledger [upward]");
    }),
  );

  // scenario: the plan's plant for "no module imports another module on its own layer". `next-access`
  // is put on the runtime's layer (6 since T953): an import from the runtime to access, which went
  // down, must now fail, and no other pair changes.
  it.effect("scenario: a module put beside the runtime refuses an import from the runtime", () =>
    Effect.gen(function* () {
      const realTree = yield* plantedReal;
      const runtime =
        REAL.layers.find((row) => row.name === "next-runtime")?.layer ?? expect.fail("the runtime has a layer");
      const beside = REAL.layers.map((row) => (row.name === "next-access" ? { ...row, layer: runtime } : row));
      const before = rowEdges(realTree, REAL);
      const after = rowEdges(realTree, { ...REAL, layers: beside });
      expect(after).toEqual(expectedEdges(beside));
      expect(after.filter((edge) => !before.includes(edge))).toEqual([
        "next-access -> next-runtime [sideways]",
        "next-runtime -> next-access [sideways]",
      ]);
      expect(before.filter((edge) => !after.includes(edge))).toEqual(["next-access -> next-runtime [upward]"]);
    }),
  );

  // pinned: the plan's layer table (ticket 477, 0043), since the rows are written by hand and the
  // rank laws above read their expected edges from this same file: a changed `layer` that makes no
  // break passes them, and only this says which module is on which layer.
  // Plant: put `next-node` on layer 11. `pnpm lint:layers` and every other law here stay green, and
  // this one goes red.
  // T953 moved every row from the processes up by one, to put the permission core on layer 3 between
  // the ledger and the processes.
  it("pinned: the modules are on the layers the plan gives them", () => {
    expect(Object.fromEntries(layersByName(REAL.layers))).toEqual({
      "next-node": 10,
      "next-workers": 9,
      "next-libfabrika-entry": 8,
      "next-desktop-core": 7,
      "next-schedules": 7,
      "next-client": 7, // P18: the window client, beside the door
      "next-door": 7,
      "next-runtime": 6,
      "next-access": 5,
      "next-processes": 4,
      "next-presence": 4,
      "next-jobs": 4,
      "next-packs": 4,
      "next-permissions": 3,
      "next-ledger": 2,
      "next-codehost": 2,
      "next-ci": 2,
      "next-transport": 2,
      "next-repositories": 2,
      "next-settings": 2, // T664's approved plan: settings sits on layer 2, above telemetry
      "next-telemetry": 1,
      "next-shared": 0,
      "next-vitest": 0, // 0538: the test primitives, a package of their own below everything else of ours
    });
  });

  // pinned: T953 L19, main's layer table at 85cb7c224, the last commit before the permission core took
  // layer 3, with the `next-client` row main added after it (P18). Moving every row from the processes
  // up by one may change numbers only: for each two rows that had a layer then, one is below the other
  // now exactly when it was below then, so no import that was refused becomes allowed and none that
  // was allowed becomes refused.
  it("pinned: T953 L19 the renumbered layers keep the order of every pair of rows main had", () => {
    const main: Readonly<Record<string, number>> = {
      "next-node": 9,
      "next-workers": 8,
      "next-libfabrika-entry": 7,
      "next-client": 6, // P18: the window client, beside the door
      "next-door": 6,
      "next-desktop-core": 6,
      "next-schedules": 6,
      "next-runtime": 5,
      "next-access": 4,
      "next-processes": 3,
      "next-presence": 3,
      "next-jobs": 3,
      "next-packs": 3,
      "next-ci": 2,
      "next-codehost": 2,
      "next-repositories": 2,
      "next-ledger": 2,
      "next-transport": 2,
      "next-settings": 2,
      "next-telemetry": 1,
      "next-shared": 0,
    };
    const now = layersByName(REAL.layers);
    const changed = Object.entries(main).flatMap(([a, before]) =>
      Object.entries(main).flatMap(([b, other]) => {
        const [after, then] = [now.get(a), now.get(b)];
        return after === undefined || then === undefined
          ? [`${a} or ${b} lost its layer`]
          : before < other === after < then
            ? []
            : [`${a} (${before} -> ${after}) and ${b} (${other} -> ${then})`];
      }),
    );
    expect(changed).toEqual([]);
  });

  // pinned: the review of PR 1251, since a row with no `imports` list lets its files import every
  // lower row, and code-graph refuses no such row: the old exam refused a library row its table did
  // not map. Every library row names what it may import. In next/, only the app, a program's window,
  // a program's box and tuval's entry file have no list, on purpose.
  // Plant: drop `next-mcp`'s `imports`. Its row then shows here.
  it("pinned: every library row names the rows it may import", () => {
    const open = REAL.layers.filter((row) => row.imports === undefined && row.paths.some((p) => p.startsWith("next/")));
    expect(open.filter((row) => row.paths.some((p) => p.startsWith("next/packages/libfabrika")))).toEqual([]);
    expect(open.map((row) => row.name)).toEqual([
      "next-apps",
      "next-program-windows",
      "next-programs",
      "next-tuval-entry",
    ]);
  });
});

describe("the patched code-graph", () => {
  // scenario: the patched code-graph reads a package import by its subpath (demlik issue 915), since
  // `--layers` once mapped every import of a workspace package to the alphabetically first `exports`
  // file. Package `a` exports `.` as `src/index.ts` and `./low` as `src/aaa-low.ts`, which sorts
  // first. `b` imports `"a"`, the root, and sits below `aaa-low.ts` and above `index.ts`. The
  // patched tool reads the import as `index.ts`, a downward edge, so no upward site shows.
  // Plant: drop the patch. `packageSourceEntry` then sorts `./src/aaa-low.ts` before
  // `./src/index.ts`, `b` reads as importing the high row, and the tool reports 1 UP and exits 1.
  it.effect("scenario: a root import of a package reads the root file, not its first-sorting subpath", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const root = plant({
        "package.json": { name: "plant", private: true, workspaces: ["pkgs/*"] },
        "pnpm-workspace.yaml": 'packages:\n  - "pkgs/*"\n',
        "pkgs/a/package.json": { name: "a", exports: { ".": "./src/index.ts", "./low": "./src/aaa-low.ts" } },
        "pkgs/a/src/aaa-low.ts": "export const low = 1;\n",
        "pkgs/a/src/index.ts": "export const root = 1;\n",
        "pkgs/b/package.json": { name: "b" },
        "pkgs/b/src/b.ts": 'import { root } from "a";\nexport const b = root;\n',
        "rules.json": {
          layers: [
            { name: "high", paths: ["pkgs/a/src/aaa-low.ts"] },
            { name: "mid", paths: ["pkgs/b"] },
            { name: "low", paths: ["pkgs/a/src/index.ts"] },
          ],
        },
      });
      const run = spawnSync(bin, [".", "--layers", "--layer-rules", "rules.json"], { cwd: root, encoding: "utf8" });
      expect(run.stdout).toContain("1 down, 0 sideways, 0 UP");
      expect(run.status).toBe(0);
    }),
  );

  // scenario: the patched code-graph reads a subpath the package's `exports` map lacks as unresolved
  // (demlik issue 915), since Node refuses such a subpath (`ERR_PACKAGE_PATH_NOT_EXPORTED`) and the
  // tool's own kind for an import it cannot place is `unresolved`. Package `a` exports `.` as
  // `src/index.ts` and `./low` as `src/low.ts`, and no `./missing`. `b` sits below `index.ts` and
  // imports `"a/missing"`; `c` sits above it and imports `"a"`, the bare name. The patched tool reads
  // the first as unresolved, no edge and no UP, and the second as `index.ts`, one downward edge.
  // Plant: drop the bare-name check, so every miss falls back to the package's entry. `a/missing`
  // then lands on `index.ts`, `b` reads as importing a higher row, and the tool reports 1 UP and
  // exits 1.
  it.effect("scenario: an unexported subpath of a package is unresolved, not the package's entry file", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const root = plant({
        "package.json": { name: "plant", private: true, workspaces: ["pkgs/*"] },
        "pnpm-workspace.yaml": 'packages:\n  - "pkgs/*"\n',
        "pkgs/a/package.json": { name: "a", exports: { ".": "./src/index.ts", "./low": "./src/low.ts" } },
        "pkgs/a/src/index.ts": "export const root = 1;\n",
        "pkgs/a/src/low.ts": "export const low = 1;\n",
        "pkgs/b/package.json": { name: "b" },
        "pkgs/b/src/b.ts": 'import { missing } from "a/missing";\nexport const b = missing;\n',
        "pkgs/c/package.json": { name: "c" },
        "pkgs/c/src/c.ts": 'import { root } from "a";\nexport const c = root;\n',
        "rules.json": {
          layers: [
            { name: "top", paths: ["pkgs/c"] },
            { name: "mid", paths: ["pkgs/a/src/index.ts"] },
            { name: "bottom", paths: ["pkgs/b"] },
          ],
        },
      });
      const run = spawnSync(bin, [".", "--layers", "--layer-rules", "rules.json"], { cwd: root, encoding: "utf8" });
      expect(run.stdout).toContain("1 down, 0 sideways, 0 UP");
      expect(run.stdout).toContain("1 unresolved");
      expect(run.stdout).toContain("pkgs/b/src/b.ts:1 a/missing");
      expect(run.status).toBe(0);
    }),
  );

  // scenario: a planted tree of four rows on three layers, with one upward, two sideways (one each
  // way) and two downward imports, since the law is about the tool's answer on a known tree. `mid1`
  // and `mid2` share layer 1 (demlik issue 913).
  // Plant: remove the layer code from the patch. The tool then ranks by place in the list, `mid1`
  // is above `mid2`, and the sideways imports pass: the second run below is that tool's answer.
  it.effect("scenario: two rows on one layer share a rank, and an import between them breaks in either direction", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const tree = plant({
        "p/top/t.ts": lines(
          'import {m} from "../mid1/m.ts";',
          'import {l} from "../low/l.ts";',
          "export const t = [m, l];",
        ),
        "p/mid1/m.ts": lines(
          'import {n} from "../mid2/n.ts";',
          'import {t} from "../top/t.ts";',
          "export const m = [n, t];",
        ),
        "p/mid2/n.ts": lines('import {m} from "../mid1/m.ts";', "export const n = m;"),
        "p/low/l.ts": lines("export const l = 1;"),
      });
      const ranked = [
        { name: "top", layer: 2, paths: ["p/top"] },
        { name: "mid1", layer: 1, paths: ["p/mid1"] },
        { name: "mid2", layer: 1, paths: ["p/mid2"] },
        { name: "low", layer: 0, paths: ["p/low"] },
      ];
      expect(rowEdges(tree, { layers: ranked })).toEqual([
        "mid1 -> mid2 [sideways]",
        "mid1 -> top [upward]",
        "mid2 -> mid1 [sideways]",
      ]);
      const listed = ranked.map(({ layer: _layer, ...row }) => row);
      expect(rowEdges(tree, { layers: listed })).toEqual(["mid1 -> top [upward]", "mid2 -> mid1 [upward]"]);
    }),
  );

  // scenario: `roots` and `testFiles` (demlik issues 947 and 948) on a known tree: `c` may import
  // only `b`, its product file and its test import `a`, a test imports a row above, and `src/sync/`
  // has no row.
  // Plant: drop `testFiles`. The test's import then fires, and the stray test is unclaimed. Drop
  // `roots`, and nothing is unclaimed.
  it.effect("scenario: a file under a root that no row claims fails, and a test keeps only the rank rules", () =>
    Effect.gen(function* () {
      const { plant } = yield* planter;
      const tree = plant({
        "src/a/a.ts": lines("export const a = 1;"),
        "src/b/b.ts": lines('import {a} from "../a/a.ts";', "export const b = a;"),
        "src/c/c.ts": lines('import {a} from "../a/a.ts";', "export const c = a;"),
        "src/c/c.test.ts": lines('import {a} from "../a/a.ts";', "export const t = a;"),
        "src/c/up.test.ts": lines('import {u} from "../../top/u.ts";', "export const t = u;"),
        "top/u.ts": lines("export const u = 1;"),
        "src/sync/Merge.ts": lines("export const m = 1;"),
        "src/sync/Merge.test.ts": lines("export const m = 1;"),
      });
      const rules: Rules = {
        layers: [
          { name: "top", paths: ["top"] },
          { name: "c", paths: ["src/c"], imports: ["b"] },
          { name: "b", paths: ["src/b"] },
          { name: "a", paths: ["src/a"] },
        ],
        roots: ["src"],
        testFiles: ["**/*.test.ts"],
      };
      expect(runTool(tree, rules)).toMatchObject({
        edges: ["src/c/c.ts -> a [outside-imports]", "src/c/up.test.ts -> top [upward]"],
        unclaimed: ["src/sync/Merge.ts"],
        status: 1,
      });
      const { testFiles: _tests, ...untested } = rules;
      expect(runTool(tree, untested)).toMatchObject({
        edges: [
          "src/c/c.test.ts -> a [outside-imports]",
          "src/c/c.ts -> a [outside-imports]",
          "src/c/up.test.ts -> top [upward]",
        ],
        unclaimed: ["src/sync/Merge.test.ts", "src/sync/Merge.ts"],
      });
      const { roots: _roots, ...rootless } = rules;
      expect(runTool(tree, rootless).unclaimed).toEqual([]);
    }),
  );
});
