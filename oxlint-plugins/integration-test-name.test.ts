// 0584, next/. A plain test file whose own code starts a real thing fails, and the same file named
// `.integration.` or `.visual.` passes. Each generated case runs in process through oxlint's
// RuleTester; one oxlint run over planted files proves the repo's own .oxlintrc.json wires the rule,
// and one over the real tree that it is at zero there. Plants, each run once on starters.ts and
// restored: drop `process.kill` from the openers (red: K1's planted kill passed); keep `rolldown` as
// an opener (red: K2's in-memory Rolldown fired); drop `launchServer`, `createSocket` or the service's
// `spawn` (red: K1, "Should have 1 error but had 0"); ignore the `fetch` stub, or count every
// `yield*` binding as a spawner (red: K2's stubbed fetch and fake spawn fired). On the rule's message:
// drop `{{drives}}` or write a fixed name for `{{name}}` (red: K1's message did not match). Older
// plants on the rule: drop the `:memory:` check (red: the memory cases fired); match the method
// name without its import (red: the fake FileSystem's and the local `spawn`'s cases fired); skip
// `.visual.` in NAMED (red: the visual files fired). Ticket 1029 adds the test database's `make` and
// `open` from `@kampus/vitest/TestDatabase` to starters.ts; its plant, run once and restored: drop
// that module's entry (red: K1's test database starters passed).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { integrationTestName } from "./integration-test-name.ts";
import { DRIVES, type Tag } from "./starters.ts";

const root = join(import.meta.dirname, "..");

RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
const tester = new RuleTester({ cwd: root });

/** How a file names what it imports: `{ x }`, `{ x as y }`, or `* as ns`. */
type Spelling = "named" | "renamed" | "namespace";

/** One import in a spelling: its line, and how the code writes the dotted `name` after it. */
const from = (module: string, name: string, spelling: Spelling, alias: string) => {
  const [head = name, ...rest] = name.split(".");
  const tail = rest.map((part) => `.${part}`).join("");

  switch (spelling) {
    case "named":
      return { line: `import { ${head} } from "${module}";`, ref: name };
    case "renamed":
      return { line: `import { ${head} as ${alias} } from "${module}";`, ref: `${alias}${tail}` };
    case "namespace":
      return { line: `import * as ${alias} from "${module}";`, ref: `${alias}.${name}` };
  }
};

/** A file that starts a real thing: its imports, and the one line that starts it. */
type Real = { readonly imports: ReadonlyArray<string>; readonly line: string };

const one = (module: string, name: string, alias: string, line: (ref: string) => string) => (s: Spelling) => {
  const got = from(module, name, s, alias);
  return { imports: [got.line], line: line(got.ref) };
};

/** Every starter of 0584's list, in any import spelling; the calls on globals ignore the spelling. */
const REAL: ReadonlyArray<{ readonly tag: Tag; readonly build: (spelling: Spelling) => Real }> = [
  ...["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"].map((name) => ({
    tag: "process" as const,
    build: one("node:child_process", name, "cp", (ref) => `${ref}("git", ["init"]);`),
  })),
  // Each port starter, called with options and no literal URL, so it opens a socket on this machine.
  ...Object.entries({
    "node:net": ["createServer", "createConnection", "connect"],
    "node:http": ["createServer", "request", "get"],
    https: ["createServer", "request", "get"],
    "node:http2": ["createServer", "createSecureServer", "connect"],
    "node:tls": ["createServer", "connect"],
    "node:dgram": ["createSocket"],
  }).flatMap(([module, names]) =>
    names.map((name) => ({
      tag: "port" as const,
      build: one(module, name, "net", (ref) => `const socket = ${ref}(options);`),
    })),
  ),
  { tag: "port", build: one("node:net", "Server", "net", (ref) => `new ${ref}().listen(0);`) },
  // A client call to a literal URL on another machine reaches the network.
  {
    tag: "network",
    build: one("node:https", "get", "https", (ref) => `${ref}("https://api.example.com/v1", (res) => res);`),
  },
  ...["chromium", "firefox", "webkit", "_electron"].flatMap((browser) =>
    ["launch", "launchPersistentContext", "launchServer"].map((method) => ({
      tag: "browser" as const,
      build: one("playwright", `${browser}.${method}`, "pw", (ref) => `await ${ref}({});`),
    })),
  ),
  { tag: "instance", build: one("./local-instance.ts", "localInstance", "local", (ref) => `${ref}(home);`) },
  {
    tag: "instance",
    build: one("./workerd.test-support.ts", "killWorkerd", "workerd", (ref) => `yield* ${ref}(pid);`),
  },
  { tag: "signal", build: () => ({ imports: [], line: 'process.kill(pid, "SIGTERM");' }) },
  { tag: "network", build: () => ({ imports: [], line: 'await fetch("https://api.example.com/v1");' }) },
  { tag: "network", build: () => ({ imports: [], line: 'const ws = new WebSocket("wss://relay.example.com/feed");' }) },
  {
    tag: "process",
    build: (s) => {
      const command = from("effect/process", "ChildProcess.make", s, "P");
      const layer = from("@effect/platform-node", "NodeServices.layer", s, "PN");
      return {
        imports: [command.line, layer.line],
        line: `const run = ${command.ref}("git", ["init"]).pipe(Effect.provide(${layer.ref}));`,
      };
    },
  },
  // A spawner's `spawn`, on the service bound by name or written in place, on Node's layer.
  ...[
    (service: string) => `const spawner = yield* ${service}; const child = yield* spawner.spawn(command)`,
    (service: string) => `const child = yield* (yield* ${service}).spawn(command)`,
  ].map((body) => ({
    tag: "process" as const,
    build: (s: Spelling) => {
      const service = from("effect/process", "ChildProcessSpawner.ChildProcessSpawner", s, "P");
      const layer = from("@effect/platform-node", "NodeServices.layer", s, "PN");
      return {
        imports: [service.line, layer.line],
        line: `const run = Effect.gen(function* () { ${body(service.ref)}; }).pipe(Effect.provide(${layer.ref}));`,
      };
    },
  })),
  {
    tag: "disk",
    build: one("node:sqlite", "DatabaseSync", "sqlite", (ref) => `const db = new ${ref}(join(home, "ledger.db"));`),
  },
  // The test database's two openers on a file, as `new DatabaseSync(file)` (ticket 1029).
  ...["make", "open"].map((name) => ({
    tag: "disk" as const,
    build: one("@kampus/vitest/TestDatabase", name, "TestDatabase", (ref) => `const db = yield* ${ref}(file);`),
  })),
  ...[
    ["node:fs", "mkdtempSync"],
    ["node:fs", "mkdtemp"],
    ["node:fs", "promises.mkdtemp"],
    ["node:fs/promises", "mkdtemp"],
  ].map(([module = "", name = ""]) => ({
    tag: "disk" as const,
    build: one(module, name, "fs", (ref) => `const home = ${ref}("t1073-");`),
  })),
  // `fs.promises` through a default import, the one spelling `from` does not write.
  {
    tag: "disk",
    build: () => ({
      imports: ['import fs from "node:fs";'],
      line: 'const home = await fs.promises.mkdtemp("t1073-");',
    }),
  },
  // Each temp method on a FileSystem service, on each layer that writes disk.
  ...["makeTempDirectory", "makeTempDirectoryScoped", "makeTempFile", "makeTempFileScoped"].flatMap((method) =>
    ["NodeServices.layer", "NodeFileSystem.layer"].map((layer) => ({
      tag: "disk" as const,
      build: (s: Spelling) => {
        const service = from("effect", "FileSystem.FileSystem", s, "E");
        const given = from("@effect/platform-node", layer, s, "PN");
        return {
          imports: [service.line, given.line],
          line: `const home = Effect.gen(function* () { const fs = yield* ${service.ref}; return yield* fs.${method}(); }).pipe(Effect.provide(${given.ref}));`,
        };
      },
    })),
  ),
  {
    tag: "disk",
    build: () => ({
      imports: [
        'import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";',
        'import * as FileSystem from "effect/FileSystem";',
      ],
      line: "const home = Effect.gen(function* () { return yield* (yield* FileSystem.FileSystem).makeTempDirectory(); }).pipe(Effect.provide(NodeFileSystem.layer));",
    }),
  },
];

const where = fc.constantFrom("next/apps/fabrika/src", "next/packages/libfabrika/src/node", "next/programs/inbox/src");
const stem = fc.stringMatching(/^[a-z][A-Za-z]{0,7}(?:\.laws)?$/);
const end = fc.constantFrom(".ts", ".tsx");
const spelling = fc.constantFrom<Spelling>("named", "renamed", "namespace");

/** The file's text: its imports, then a law body with one line of setup before the line that starts the thing. */
const fileOf = ({ imports, line }: Real) => ({
  code: `${[...imports, "async function* law() {", "  const setup = () => 1;", `  ${line}`, "}"].join("\n")}\n`,
  line: imports.length + 3,
});

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

it("K1: every starter fires in a plain next/ test file at its line, in any import spelling, naming what it drives and the integration name, and never under the integration or visual name", () => {
  // Each starter runs on its own, so every name in starters.ts's table is reached.
  for (const real of REAL) {
    fc.assert(
      fc.property(fc.record({ spelling, folder: where, name: stem, ext: end }), ({ spelling, folder, name, ext }) => {
        const { code, line } = fileOf(real.build(spelling));
        const message = new RegExp(`${escape(DRIVES[real.tag])}.*${escape(`\`${name}.integration.test.ts\``)}`);
        tester.run("integration-test-name", integrationTestName, {
          valid: [
            { code, filename: join(root, folder, `${name}.integration.test${ext}`) },
            { code, filename: join(root, folder, `${name}.visual.test${ext}`) },
            // Only next/'s test files: product code, today's tests and support files are not this rule's.
            { code, filename: join(root, folder, `${name}${ext}`) },
            { code, filename: join(root, folder, `${name}.test-support.ts`) },
            { code, filename: join(root, "apps/fabrika/src", `${name}.test${ext}`) },
          ],
          invalid: [{ code, filename: join(root, folder, `${name}.test${ext}`), errors: [{ line, message }] }],
        });
      }),
      { seed: 119120, numRuns: 4 },
    );
  }

  // Coverage: every kind 0584 names that a call shows is in the list.
  expect([...new Set(REAL.map((real) => real.tag))].sort()).toEqual([
    "browser",
    "disk",
    "instance",
    "network",
    "port",
    "process",
    "signal",
  ]);
});

/** Code that runs on a stand-in: it must never fire, whatever the plain file's name and folder. */
const STAND_INS = [
  // A spy on `spawn`, as alchemy-lifecycle.test.ts has it.
  'import childProcess from "node:child_process";\nimport { vi } from "vitest";\nconst mock = vi.spyOn(childProcess, "spawn").mockImplementation(() => child);',
  // A spawner made in memory.
  'import { ChildProcessSpawner } from "effect/process";\nconst fake = ChildProcessSpawner.make(() => Effect.succeed(handle));',
  // A fake object's `spawn`, even in a file that provides Node's layer: only the service's counts.
  'import { NodeServices } from "@effect/platform-node";\nconst fake = { spawn: (command) => Effect.succeed(handle) };\nfunction* law() {\n  const child = yield* fake.spawn(command).pipe(Effect.provide(NodeServices.layer));\n}',
  // A fake with a spawner's and a FileSystem's method names.
  "const fake = { makeTempDirectory: () => 0, spawnSync: () => 0 };\nfake.spawnSync();\nfake.makeTempDirectory();",
  // SQLite inside the process.
  'import { DatabaseSync } from "node:sqlite";\nconst db = new DatabaseSync(":memory:");',
  // The test database on `:memory:`, the package root's `runsFor`, and look-alikes of its openers.
  'import * as TestDatabase from "@kampus/vitest/TestDatabase";\nconst db = TestDatabase.make(":memory:");',
  'import { runsFor } from "@kampus/vitest";\nconst runs = runsFor({ fast: 5, full: 50 });',
  'import * as TestDatabase from "@kampus/vitest";\nTestDatabase.make(file);',
  "const TestDatabase = { make: (_: string) => 0 };\nTestDatabase.make(file);",
  'import { make } from "./TestDatabase.ts";\nmake(file);',
  // Rolldown bundles in memory: reading repo files in the process is plain (0584).
  'import { rolldown } from "rolldown";\nconst bundle = await rolldown({ input: "src/a.ts" });',
  // Reading a repository file is plain (0584).
  'import { readFileSync } from "node:fs";\nreadFileSync("a.txt", "utf8");',
  // A browser's name is not a launch.
  'import { chromium } from "playwright";\nconst kind = chromium.name();',
  // Effect's no-op FileSystem: its temp folder is not on disk.
  'import { Effect, FileSystem } from "effect";\nconst fs = FileSystem.layerNoop({});\nconst home = files.makeTempDirectory();',
  // A fake FileSystem whose temp folder is an object key, as Command.test.ts has it.
  "const fake = { makeTempDirectory: () => Effect.succeed('/x'), makeTempDirectoryScoped: wrote('t') };",
  // The in-memory file system.
  'import * as MemoryFiles from "./MemoryFiles.test-support.ts";\nconst d = MemoryFiles.disk(["/usr/bin"]);',
  // A fetch to this machine reaches a port the law's own server holds, never the network.
  // The second fetch's URL is a template with a placeholder, so this case is a template too.
  `const res = await fetch("http://127.0.0.1:8787/health");\nconst other = await fetch(\`http://localhost:\${port}/x\`);`,
  // A fetch the file stubs never leaves the process, wherever its URL points.
  'import { vi } from "vitest";\nvi.stubGlobal("fetch", vi.fn());\nconst res = await fetch("https://api.example.com/v1");',
  // `tmpdir()` only names a folder; nothing is written there.
  'import { tmpdir } from "node:os";\nimport { join } from "node:path";\nconst outside = join(tmpdir(), "never-made");',
  // A look-alike name with no import.
  "const spawn = () => 0;\nspawn();\nconst tmpdir = () => '/x';\ntmpdir();",
] as const;

it("K2: a stand-in never fires: a spy, a fake spawner or fake object, SQLite on :memory:, Rolldown in memory, a repository read, a browser's name, a no-op or fake FileSystem, MemoryFiles, a local or stubbed fetch, a tmpdir path", () => {
  // Each stand-in runs on its own, so every one is reached.
  for (const code of STAND_INS) {
    fc.assert(
      fc.property(where, stem, end, (folder, name, ext) => {
        tester.run("integration-test-name", integrationTestName, {
          valid: [{ code, filename: join(root, folder, `${name}.test${ext}`) }],
          invalid: [],
        });
      }),
      { seed: 119120, numRuns: 4 },
    );
  }
});

/**
 * next/'s committed source files, for a scan of the real tree. Other tooling laws plant files in
 * dot folders under next/ while this one runs, and oxlint walks those, so a scan of the folder read
 * their fires as the tree's (full run 43799861377). Git's list holds only what is committed.
 */
const committed = () =>
  spawnSync("git", ["ls-files", "-z", "--", "next"], { cwd: root, encoding: "utf8" })
    .stdout.split("\0")
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file));

/** The integration-test-name fires oxlint finds, by file from the repo's top, as lines. */
const fires = (paths: readonly string[]) => {
  const out = spawnSync(join(root, "node_modules/.bin/oxlint"), ["--format=json", ...paths], {
    cwd: root,
    encoding: "utf8",
    // Node's default cap is 1 MiB, and a cut report is not JSON: read all of it.
    maxBuffer: Infinity,
  });

  if (out.error !== undefined) {
    throw out.error;
  }

  const report = JSON.parse(out.stdout) as {
    diagnostics: Array<{ code: string; filename: string; labels: Array<{ span: { line: number } }> }>;
  };
  const found = new Map<string, number[]>();

  for (const d of report.diagnostics.filter((each) => each.code === "fabrika(integration-test-name)")) {
    found.set(d.filename, [...(found.get(d.filename) ?? []), d.labels[0]!.span.line]);
  }

  return found;
};

it("scenario: the repo's .oxlintrc.json wires the rule for next/'s test files", () => {
  const folder = mkdtempSync(join(root, "next/.p0536-names-"));

  try {
    const plain = join(folder, "src/opens.test.ts");
    const named = join(folder, "src/opens.integration.test.ts");
    const code = 'import { spawnSync } from "node:child_process";\nspawnSync("git", ["init"]);\n';

    for (const file of [plain, named]) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, code);
    }

    const found = fires([relative(root, folder)]);
    expect(Object.fromEntries(found)).toEqual({ [relative(root, plain)]: [2] });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

it("scenario: next/'s tree is at zero, so the rule blocks from the start (0523)", () => {
  // The real tree is the input. Measured on main before the renames (oxlint-plugins/README.md): 4
  // plain files fired, all 4 start git or write a temp folder, and each was renamed or given a
  // stand-in: 0 false alarms.
  expect(Object.fromEntries(fires(committed()))).toEqual({});
});
