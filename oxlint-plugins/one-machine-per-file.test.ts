// Decision 0046's syntax laws. Generated code is tested through oxlint's public RuleTester;
// config and real-file copies go through the same lint command as the exam.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { oneMachinePerFile } from "./one-machine-per-file.ts";

RuleTester.describe = (_name, fn) => fn();

RuleTester.it = (_name, fn) => fn();

const tester = new RuleTester({ cwd: import.meta.dirname });

const RUNS = { seed: 119120, numRuns: 100 };

const CODE = "fabrika(one-machine-per-file)";

const TEA = 'import { Machine } from "@demlik/tea/effect";';

const COUNT = /at most one tea machine/;

const OWN = /must be defined in this file/;

const IO = /no input or output imports/;

type ErrorAt = { readonly line: number; readonly message: RegExp };

const check = (code: string, errors: readonly ErrorAt[]) => {
  tester.run("one-machine-per-file", oneMachinePerFile, {
    valid: errors.length === 0 ? [{ code, filename: "case.ts" }] : [],
    invalid: errors.length === 0 ? [] : [{ code, filename: "case.ts", errors: [...errors] }],
  });
};

type Piece = { readonly text: (i: number) => string; readonly calls: number };

// The expected call count belongs to the case table, independent of the rule's traversal.
const PIECES: readonly Piece[] = [
  { text: (i) => `export const m${i} = Machine.make({});`, calls: 1 },
  { text: (i) => `export let m${i} = Machine.make({});`, calls: 1 },
  { text: (i) => `export const m${i} = (c) => Machine.make({});`, calls: 1 },
  { text: (i) => `export function m${i}(c) { return Machine.make({}); }`, calls: 1 },
  { text: (i) => `export const m${i} = () => [Machine.make({}), Machine.make({})];`, calls: 2 },
  { text: (i) => `export const m${i} = { machine: Machine.make({}) };`, calls: 1 },
  { text: (i) => `export const m${i} = Program.make({ machine: Machine.make({}) });`, calls: 1 },
  { text: (i) => `const m${i} = Machine.make({}); export { m${i} };`, calls: 1 },
  { text: (i) => `const m${i} = () => Machine.make({}); export { m${i} as x${i} };`, calls: 1 },
  { text: (i) => `const m${i} = Machine.make({});`, calls: 0 },
  { text: (i) => `const m${i} = Machine.make({}); export const p${i} = Program.make({machine: m${i}});`, calls: 1 },
  { text: (i) => `const c${i} = Machine.make({}); export const m${i} = Machine.make({init: c${i}.init});`, calls: 1 },
  { text: (i) => `import {Machine as M${i}} from "@demlik/tea"; export const m${i} = M${i}.make({});`, calls: 1 },
  {
    text: (i) => `import * as T${i} from "@demlik/tea/effect"; export const m${i} = T${i}.Machine["make"]({});`,
    calls: 1,
  },
  { text: (i) => `export const m${i} = Machine["make"]({});`, calls: 1 },
  { text: (i) => `import {Machine as M${i}} from "other"; export const m${i} = M${i}.make({});`, calls: 0 },
  { text: (i) => `import type {Machine as M${i}} from "@demlik/tea"; export const m${i} = M${i}.make({});`, calls: 0 },
  { text: (i) => `export function m${i}(Machine) { return Machine.make({}); }`, calls: 0 },
  { text: (i) => `const m${i} = Machine.make({}); export type {m${i}};`, calls: 0 },
  { text: (i) => `const m${i} = Machine.make({}); export const p${i} = { m${i}: 0 };`, calls: 0 },
];

it("L1: exactly the reached calls after the first fire, in source order", () => {
  fc.assert(
    fc.property(fc.array(fc.constantFrom(...PIECES), { minLength: 1, maxLength: 6 }), (pieces) => {
      let seen = 0;

      const errors = pieces.flatMap((p, i) => {
        const at: ErrorAt[] = [];

        for (let n = 0; n < p.calls; n++) {
          if (seen++ > 0) {
            at.push({ line: i + 2, message: COUNT });
          }
        }

        return at;
      });

      check([TEA, ...pieces.map((p, i) => p.text(i))].join("\n"), errors);
    }),
    { ...RUNS, numRuns: 200 },
  );
});

it("L1: default exports and local default bindings count with every generated neighbor", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(
        "export default Machine.make({});",
        "const main = Machine.make({}); export default main;",
        "export default function main() { return Machine.make({}); }",
        "const main = () => Machine.make({}); export default main;",
      ),
      fc.constantFrom(...PIECES),
      (main, p) => {
        const errors: ErrorAt[] = Array.from({ length: p.calls }, () => ({ line: 3, message: COUNT }));
        check([TEA, main, p.text(0)].join("\n"), errors);
      },
    ),
    RUNS,
  );
});

const PARTS = [
  "local",
  "{}",
  "Schema.Struct({ f: Imported })",
  "Imported",
  "Remote.Model",
  "Remote.Never",
  'Remote["Model"]',
  "Schema.Never",
  "Schema.String",
  'Schema["Never"]',
] as const;

it("L2: only a part whose value is an import or imported member fires", () => {
  fc.assert(
    fc.property(
      fc.record({
        model: fc.constantFrom(...PARTS),
        msg: fc.constantFrom(...PARTS),
        update: fc.constantFrom(...PARTS),
      }),
      (parts) => {
        const lines = Object.entries(parts).map(([key, value]) => `${key}: ${value},`);

        const errors = Object.entries(parts).flatMap(([key, value], i) =>
          [
            "Imported",
            "Remote.Model",
            "Remote.Never",
            'Remote["Model"]',
            "Schema.Never",
            "Schema.String",
            'Schema["Never"]',
          ].includes(value) && !(key === "msg" && (value === "Schema.Never" || value === 'Schema["Never"]'))
            ? [{ line: i + 5, message: OWN }]
            : [],
        );

        check(
          [
            TEA,
            'import {Imported, Remote} from "./parts.ts";',
            'import {Schema} from "effect"; const local = {};',
            "export const m = Machine.make({",
            ...lines,
            "});",
          ].join("\n"),
          errors,
        );
      },
    ),
    {
      ...RUNS,
      // pinned: A1, the lead flow machine has no Msg and uses Effect's Schema.Never directly.
      examples: [[{ model: "local", msg: "Schema.Never", update: "local" }]],
    },
  );
});

const IO_IMPORTS = [
  ...[
    "Effect",
    "Layer",
    "Context",
    "ManagedRuntime",
    "Fiber",
    "Scope",
    "Clock",
    "Random",
    "Schedule",
    "FileSystem",
    "Path",
    "Config",
    "ConfigProvider",
    "Console",
    "Stream",
    "Queue",
    "PubSub",
    "Ref",
    "Deferred",
    "Semaphore",
    "Sink",
  ].map((n) => `import {${n} as Value} from "effect";`),
  ...["run", "runIn", "spawn", "stop", "tell", "EffectRun", "EffectInterpret", "EffectSubscribe"].map(
    (n) => `import {${n} as Value} from "@demlik/tea/effect";`,
  ),
  ...[
    "node:fs",
    "effect/process",
    "effect/http",
    "effect/cli",
    "effect/unstable/sql",
    "@effect/platform-node",
    "cloudflare:workers",
    "miniflare",
    "workerd",
    "wrangler",
    "@cloudflare/workers-types",
  ].map((n) => `import * as Value from "${n}";`),
];

const PURE_IMPORTS = [
  'import {Schema, Array, Result, Equal, Option} from "effect";',
  'import {Cmd} from "@demlik/tea/effect";',
  'import * as Value from "effect/encoding";',
  'import * as Value from "effect/crypto";',
  'import { Effect as Value } from "./helpers.ts";',
];

it("L3: each closed-list value import fires only when a machine call exists, including a private call", () => {
  fc.assert(
    fc.property(
      fc.boolean(),
      fc.boolean(),
      fc.subarray(IO_IMPORTS),
      fc.constantFrom(...PURE_IMPORTS),
      (hasCall, exported, imports, pure) => {
        // Every line binds a unique name; the generated set may contain different spellings of Value.
        const lines = [...imports, pure].map((s, i) => s.replaceAll("Value", `Value${i}`));
        const errors = hasCall ? imports.map((_, i) => ({ line: i + 2, message: IO })) : [];
        check(
          [TEA, ...lines, hasCall ? `${exported ? "export " : ""}const m = Machine.make({});` : ""].join("\n"),
          errors,
        );
        check(
          [TEA, ...lines.map((s) => s.replace("import ", "import type ")), "export const m = Machine.make({});"].join(
            "\n",
          ),
          [],
        );
        check(
          [
            TEA,
            ...lines.map((s) =>
              s.startsWith("import {")
                ? s.replace("import {", "import {type ").replaceAll(", ", ", type ")
                : s.replace("import ", "import type "),
            ),
            "const m = Machine.make({});",
          ].join("\n"),
          [],
        );
      },
    ),
    RUNS,
  );
});

const file = (...lines: readonly string[]) => [TEA, ...lines].join("\n");

it("vector: an inline type import or type export is not a value, so it makes no machine, part or I/O hit", () => {
  // vector: `import {type Machine}` has no runtime value, so its two calls are not tea machines.
  check(
    file(
      'import {type Machine as M} from "@demlik/tea";',
      "export const a = M.make({});",
      "export const b = M.make({});",
    ),
    [],
  );
  // vector: a part read from an inline type import is not an imported value.
  check(file('import {type Imported} from "./parts.ts";', "export const m = Machine.make({ model: Imported });"), []);
  // vector: `export {type a}` exports no value, so the private machine `a` is not reached.
  check(file("const a = Machine.make({});", "export const b = Machine.make({});", "export { type a };"), []);
  // vector: the same file with a value export reaches both, which shows the line above is the type's doing.
  check(file("const a = Machine.make({});", "export const b = Machine.make({});", "export { a };"), [
    { line: 3, message: COUNT },
  ]);
  // vector: one value name beside a type name decides the hit, for the closed list of names.
  check(file('import {type Effect, Schema} from "effect";', "const m = Machine.make({});"), []);
  check(file('import {type Schema, Effect} from "effect";', "const m = Machine.make({});"), [{ line: 2, message: IO }]);
  // vector: an I/O module whose every name is an inline type brings no code in; one value name does.
  check(file('import {type Stats} from "node:fs";', "const m = Machine.make({});"), []);
  check(file('import {type Stats, readFileSync} from "node:fs";', "const m = Machine.make({});"), [
    { line: 2, message: IO },
  ]);
});

it("vector: a bare import of an I/O module fires, and a bare import of any other module does not", () => {
  // vector: `import "node:fs"` runs the module for its side effects, which is input or output.
  check(file('import "node:fs";', "const m = Machine.make({});"), [{ line: 2, message: IO }]);
  check(file('import "@effect/platform-node";', "export const m = Machine.make({});"), [{ line: 2, message: IO }]);
  // vector: `effect` and a relative file are not on the module list, so their bare imports pass.
  check(file('import "effect";', 'import "./setup.ts";', "const m = Machine.make({});"), []);
  // vector: without a machine call the file is not a machine file, so the bare import passes.
  check(file('import "node:fs";', "export const m = 1;"), []);
});

it("vector: a name is read where it is bound, so a shadowing parameter hides the import or the machine", () => {
  // vector: the parameter `m` shadows the private machine `m`, so the export does not reach it.
  check(file("const m = Machine.make({});", "export const f = (m) => m;", "export const g = Machine.make({});"), []);
  // vector: the same file without the shadow reaches it, which shows the line above is the shadow's doing.
  check(file("const m = Machine.make({});", "export const f = () => m;", "export const g = Machine.make({});"), [
    { line: 4, message: COUNT },
  ]);
  // vector: a parameter that shadows an imported part makes the part local to the factory.
  check(
    file(
      'import {Imported} from "./parts.ts";',
      "export const m = (Imported) => Machine.make({ model: Imported, update: Imported.update });",
    ),
    [],
  );
  // vector: a shadowed `Schema` is not Effect's, and it is not an import either.
  check(
    file('import {Schema} from "effect";', "export const m = (Schema) => Machine.make({ model: Schema.Never });"),
    [],
  );
});

it("vector: a computed access with a string reads as its dotted form, and any other computed access does not", () => {
  // vector: `Schema["Struct"]` alone is an imported member; called, its result is built in this file.
  check(
    file(
      'import {Schema} from "effect";',
      "export const m = Machine.make({",
      'model: Schema["Struct"],',
      'msg: Schema["Struct"]({}),',
      "});",
    ),
    [{ line: 4, message: OWN }],
  );
  // vector: `Schema[Never]` reads a variable, not the name Never, so A1's pass does not apply.
  check(
    file(
      'import {Schema} from "effect";',
      'const Never = "String";',
      "export const m = Machine.make({",
      "msg: Schema[Never],",
      "});",
    ),
    [{ line: 5, message: OWN }],
  );
  // vector: `Machine[make]` reads a variable, so the rule cannot say it is `make`.
  check(file('const make = "make";', "export const a = Machine[make]({});", "export const b = Machine[make]({});"), []);
  // vector: a namespace's `["Machine"]` is the dotted `.Machine`.
  check(
    file(
      'import * as T from "@demlik/tea/effect";',
      'export const a = T["Machine"].make({});',
      'export const b = T["Machine"].make({});',
    ),
    [{ line: 4, message: COUNT }],
  );
  // vector: a quoted key is the same key; a computed key that reads a variable is unknown.
  check(
    file(
      'import {Imported} from "./parts.ts";',
      'const model = "other";',
      "export const m = Machine.make({",
      '"model": Imported,',
      '["update"]: Imported,',
      "[model]: Imported,",
      "});",
    ),
    [
      { line: 5, message: OWN },
      { line: 6, message: OWN },
    ],
  );
});

it("vector: a machine bound by destructuring is reached through its exported name", () => {
  // vector: object and array patterns bind `a` and `b` to machines, and both names are exported.
  check(file("const { a } = { a: Machine.make({}) };", "const [b] = [Machine.make({})];", "export { a, b };"), [
    { line: 3, message: COUNT },
  ]);
  // vector: one exported pattern holding two machines counts two.
  check(file("export const { a, b } = { a: Machine.make({}), b: Machine.make({}) };"), [{ line: 2, message: COUNT }]);
  // vector: a private destructured machine nothing exports is not counted.
  check(file("const { a } = { a: Machine.make({}) };", "export const b = Machine.make({});"), []);
  // pinned: the rule's header lists a destructured `make` as a miss that review keeps.
  check(file("const { make } = Machine;", "export const a = make({});", "export const b = make({});"), []);
});

const DOUBLE = `${TEA}\nexport const first = Machine.make({});\nexport const second = Machine.make({});\n`;

it("pinned: L4 the two product blocks enforce the rule; the five test globs leave fixture machines alone", async () => {
  // These paths exercise the exact globs in the approved scope, including RuntimeCauseTest's form.
  const paths = [
    "next/example.ts",
    ".agents/skills/example.ts",
    "next/example.test.ts",
    "next/example.test.tsx",
    "next/ExampleTest.ts",
    "next/example.test-support.ts",
    ".agents/example.test.ts",
  ];

  const result = await plant(Object.fromEntries(paths.map((p) => [p, DOUBLE])));
  paths.forEach((p, i) => {
    expect([p, result(CODE, p)]).toEqual([p, i < 2 ? [3] : []]);
  });
});

const REAL = [
  "next/packages/libfabrika/src/access/Access.ts",
  "next/packages/libfabrika/src/gateway/internal/waiting.ts",
  "next/packages/libfabrika/src/tasks/internal/task.ts",
  "next/packages/libfabrika/src/node/dev/DevLife.ts",
  "next/packages/libfabrika/src/processes/internal/processTable.ts",
  "next/packages/libfabrika/src/runtime/BrainLife.ts",
  "next/packages/libfabrika/src/runtime/internal/reply.ts",
  "next/packages/libfabrika/src/runtime/internal/supervisor.ts",
  "next/packages/libfabrika/src/telemetry/internal/sink.ts",
  "next/packages/libfabrika/src/transport/internal/connection.ts",
  "next/programs/checklist/src/program.ts",
  "next/programs/counter/src/program.ts",
  ".agents/skills/lead/scripts/flow/machine.ts",
];

it("scenario: L5 the 13 measured machine file copies have zero hits", async () => {
  // These are the plan's measured inputs, including both factory forms.
  const originals = Object.fromEntries(REAL.map((p) => [p, readFileSync(new URL(`../${p}`, import.meta.url), "utf8")]));
  const clean = await plant(originals);

  for (const p of REAL) {
    expect([p, clean(CODE, p)]).toEqual([p, []]);
  }
});

it("scenario: L5 each real file copy refuses one added second export", async () => {
  // Compare with the unchanged copy, so an existing hit cannot hide the planted count failure.
  const originals = Object.fromEntries(REAL.map((p) => [p, readFileSync(new URL(`../${p}`, import.meta.url), "utf8")]));
  const clean = await plant(originals);

  const broken = await plant(
    Object.fromEntries(
      Object.entries(originals).map(([p, s]) => [p, `${s}\nexport const plantedSecond = Machine.make({});\n`]),
    ),
  );

  for (const [p, s] of Object.entries(originals)) {
    expect([p, broken(CODE, p)]).toEqual([p, [...clean(CODE, p), s.split("\n").length + 1]]);
  }
});

const lintFailure = (out: ReturnType<typeof spawnSync>): string => {
  // Only known error text and diagnostic fields leave the child. Source excerpts stay private.
  const text = (value: string) => {
    const sample = value.length > 4096 ? `${value.slice(0, 2048)}\n[omitted]\n${value.slice(-2048)}` : value;

    return {
      length: value.length,
      truncated: value.length > 4096,
      codes: [
        "ENOENT",
        "EACCES",
        "ENOTDIR",
        "EISDIR",
        "ENOBUFS",
        "ETIMEDOUT",
        "ERR_MODULE_NOT_FOUND",
        "ERR_PACKAGE_PATH_NOT_EXPORTED",
        "ERR_UNKNOWN_FILE_EXTENSION",
        "ERR_INVALID_MODULE_SPECIFIER",
      ].filter((code) => new RegExp(`\\b${code}\\b`).test(sample)),
      reasons: [
        "Failed to parse oxlint configuration file",
        "Failed to load JS plugin",
        "Cannot find package",
        "Cannot find module",
        "No such file or directory",
        "Permission denied",
        "Failed to open file",
        "Failed to read file",
        "Unexpected token",
        "Expected",
        "at most one tea machine",
        "must be defined in this file",
        "no input or output imports",
      ].filter((reason) => sample.includes(reason)),
      redacted: value.length > 0,
    };
  };

  const location = (file: string | undefined) =>
    typeof file === "string" &&
    /^(?:next|\.agents)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.[cm]?[jt]sx?$/.test(file) &&
    !/(?:^|\/)[^/]*(?:tmp|temp|plant|scratch)[^/]*(?:\/|$)/i.test(file)
      ? file.slice(0, 160)
      : "[redacted path]";

  const position = (n: number | undefined) => (Number.isSafeInteger(n) && n !== undefined && n >= 0 ? n : null);
  const stdout = out.stdout?.toString() ?? "";
  const stderr = out.stderr?.toString() ?? "";

  let json = null;

  try {
    const report: {
      number_of_files?: number;
      diagnostics?: Array<{
        code?: string;
        filename?: string;
        message?: string;
        severity?: string;
        labels?: Array<{ span?: { line?: number; column?: number } }>;
      }>;
    } | null = JSON.parse(stdout);

    if (Array.isArray(report?.diagnostics)) {
      json = {
        files: position(report.number_of_files),
        count: report.diagnostics.length,
        diagnostics: report.diagnostics.slice(0, 4).map((d) => ({
          code: d?.code === CODE || d?.code === "oxc" ? d.code : "[other diagnostic]",
          file: location(d?.filename),
          line: position(d?.labels?.[0]?.span?.line),
          column: position(d?.labels?.[0]?.span?.column),
          severity: d?.severity === "error" || d?.severity === "warning" ? d.severity : null,
          message: text(typeof d?.message === "string" ? d.message : ""),
        })),
      };
    }
  } catch {
    // A non-JSON child failure still keeps its recognized error codes and reasons below.
  }

  return JSON.stringify({
    status: out.status,
    signal: out.signal,
    error:
      out.error === undefined
        ? null
        : text(
            `${out.error.name} ${out.error.message} ${
              "code" in out.error && typeof out.error.code === "string" ? out.error.code : ""
            }`,
          ),
    json,
    stdout: text(stdout),
    stderr: text(stderr),
  });
};

it("property: L5 child diagnostics redact hidden leaf names and retain ordinary source locations", () => {
  // Plant: letting the final path component start with a dot exposes the generated hidden name.
  fc.assert(
    fc.property(
      fc.record({
        root: fc.constantFrom("next", ".agents"),
        folders: fc.array(fc.nat({ max: 999 }), { maxLength: 3 }),
        name: fc.nat({ max: 999 }).map((n) => `probe${n}`),
        extension: fc.constantFrom("ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"),
      }),
      ({ root, folders, name, extension }) => {
        const folder = [root, ...folders.map((n) => `module${n}`)].join("/");
        const ordinary = `${folder}/${name}.${extension}`;
        const hidden = `${folder}/.${name}.${extension}`;

        const diagnostics = [hidden, ordinary].map((filename) => ({
          code: CODE,
          filename,
          severity: "error",
          labels: [{ span: { line: 7, column: 3 } }],
        }));

        const stdout = JSON.stringify({ number_of_files: 2, diagnostics });

        const message = lintFailure({
          pid: 0,
          output: [null, stdout, ""],
          stdout,
          stderr: "",
          status: 1,
          signal: null,
        });

        const report = JSON.parse(message);

        expect(message).not.toContain(hidden);
        expect(report).toMatchObject({
          status: 1,
          signal: null,
          error: null,
          json: {
            files: 2,
            count: 2,
            diagnostics: [
              { code: CODE, file: "[redacted path]", line: 7, column: 3, severity: "error" },
              { code: CODE, file: ordinary, line: 7, column: 3, severity: "error" },
            ],
          },
        });
      },
    ),
    { ...RUNS, examples: [[{ root: "next", folders: [], name: "probe", extension: "ts" }]] },
  );
});

it("scenario: L5 oxlint over next/ and .agents/ has zero hits for this rule", () => {
  // L4 checks the real config's scope. This count runs only this rule, with the same fixture exemptions.
  const root = join(import.meta.dirname, "..");
  const scratch = mkdtempSync(join(tmpdir(), "t509-machine-"));
  const config = join(scratch, ".oxlintrc.json");

  try {
    writeFileSync(
      config,
      JSON.stringify({
        jsPlugins: [join(root, "oxlint-plugins/index.ts")],
        categories: { correctness: "off" },
        rules: { "fabrika/one-machine-per-file": "error" },
        overrides: [
          {
            files: [
              "next/**/*.test.ts",
              "next/**/*.test.tsx",
              "next/**/*Test.ts",
              "next/**/*.test-support.ts",
              ".agents/**/*.test.ts",
            ].map((pattern) => join(root, pattern)),
            rules: { "fabrika/one-machine-per-file": "off" },
          },
        ],
      }),
    );

    const out = spawnSync(
      join(root, "node_modules/.bin/oxlint"),
      [
        `--config=${config}`,
        "--disable-nested-config",
        "--no-ignore",
        "--format=json",
        "--threads=1",
        "next/",
        ".agents/",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 2 ** 30, timeout: 120_000 },
    );

    const failure = out.error !== undefined || out.status !== 0 ? lintFailure(out) : undefined;
    expect(out.error === undefined, failure).toBe(true);
    expect(out.status, failure).toBe(0);

    const report: { number_of_files: number; diagnostics: Array<{ code?: string; filename: string }> } = JSON.parse(
      out.stdout,
    );

    expect(report.number_of_files).toBeGreaterThan(0);
    const hits = report.diagnostics.filter((d) => d.code === CODE);
    console.log(JSON.stringify({ rule: CODE, files: report.number_of_files, hits: hits.length }));
    expect(hits).toEqual([]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
