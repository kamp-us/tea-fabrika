// 0536: pull requests and the merge queue test only against in-memory layers, and a test that
// drives a real resource runs on the schedule. Vitest picks the layer by the file's name
// (vitest.config.ts's projects), so a `next/` test file whose own code opens a real resource must
// be named `*.integration.test.ts`, or `*.visual.test.ts` for a browser or Electron.
//
// It reads calls, never words: experiment 292 found that matching words marked 182 of next/'s 280
// test files and matching calls 137, against 133 that drive a resource. A call counts only through
// the module it was imported from, so a fake with the same method names, or SQLite opened on
// `:memory:`, which stays in the process (0536's own line), does not fire. `TestDatabase.make(file)`
// and `TestDatabase.open(file)` from `@kampus/vitest/TestDatabase` open a SQLite file just as
// `new DatabaseSync(file)` does (ticket 1029), through the namespace or by name. It sees the file's own
// code, not the helpers it calls: a law that opens its resource only in a `*.test-support.ts` file
// is the reviewer's to name (oxlint-plugins/README.md gives the measured misses).
//
// A temp folder alone does not fire: the in-memory git laws stay on pull requests by the lead's
// call of 2026-11-14 and still make one through Effect's FileSystem. Whether a temp folder alone is
// a real resource under 0536 is the owner's to rule; until then this rule holds the other kinds.
import type { CreateRule } from "@oxlint/plugins";
import { dotted, pathIn, type Node } from "./match.ts";

/** What a call drives, by the module its name came from, and the names in that module that open it. */
const OPENERS: ReadonlyArray<{
  readonly module: RegExp;
  readonly names: ReadonlySet<string>;
  readonly drives: string;
}> = [
  {
    module: /^(?:node:)?child_process$/,
    names: new Set(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]),
    drives: "a spawned process",
  },
  {
    module: /^(?:node:)?(?:net|http|https|http2)$/,
    names: new Set(["createServer", "createSecureServer", "connect", "createConnection"]),
    drives: "a socket",
  },
  { module: /^rolldown$/, names: new Set(["rolldown", "build"]), drives: "a bundler" },
];

/** Playwright's launchers: `chromium.launch()` and the like drive a browser or Electron. */
const BROWSERS = /^(?:playwright|playwright-core|@playwright\/test)$/;
const LAUNCHERS = new Set(["chromium", "firefox", "webkit", "_electron"]);

/** The test primitives' SQLite module (ticket 1029): `make` and `open` open a file, as `new DatabaseSync` does. */
const TEST_DATABASE = "@kampus/vitest/TestDatabase";
const DATABASE_OPENERS = new Set(["make", "open"]);

/** The name of a test file that already says it drives a real resource. */
const NAMED = /\.(?:integration|visual)\.test\.tsx?$/;

const literal = (node: Node | undefined): string | null =>
  node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : node?.type === "TemplateLiteral" && node.expressions.length === 0
      ? (node.quasis[0]?.value.cooked ?? null)
      : null;

export const integrationTestName: CreateRule = {
  create(context) {
    const file = pathIn(context);

    if (!file.startsWith("next/") || !/\.test\.tsx?$/.test(file) || NAMED.test(file)) {
      return {};
    }

    // Each local name, and each namespace, by what it drives once called.
    const named = new Map<string, string>();
    const spaces = new Map<string, (typeof OPENERS)[number]>();
    const launchers = new Set<string>();
    const sqlite = new Set<string>();
    // `TestDatabase.make` and `open` through the module's namespace, or `make` and `open` by name.
    const databases = new Set<string>();
    const databaseOpeners = new Set<string>();
    const base = file.replace(/\.test\.(tsx?)$/, "");
    const report = (node: Node, call: string, drives: string) =>
      context.report({
        node,
        message: `\`${call}\` drives ${drives}, a real resource, so this file runs on the 3-hour schedule, never on a pull request (0536): name it \`${base.split("/").pop()}.integration.test.ts\`, or \`.visual.test.ts\` for a browser or Electron, beside the module it tests. Or run the law on the interface's in-memory layer.`,
      });

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        const opener = OPENERS.find((each) => each.module.test(source));

        for (const spec of node.specifiers) {
          const local = spec.local.name;
          const imported =
            spec.type === "ImportSpecifier"
              ? spec.imported.type === "Identifier"
                ? spec.imported.name
                : spec.imported.value
              : null;

          if (opener !== undefined) {
            if (imported === null) {
              spaces.set(local, opener);
            } else if (opener.names.has(imported)) {
              named.set(local, opener.drives);
            }
          }

          if (BROWSERS.test(source) && imported !== null && LAUNCHERS.has(imported)) {
            launchers.add(local);
          }

          if (/^(?:node:)?sqlite$/.test(source) && imported === "DatabaseSync") {
            sqlite.add(local);
          }

          if (source === TEST_DATABASE) {
            if (imported === null) {
              databases.add(local);
            } else if (DATABASE_OPENERS.has(imported)) {
              databaseOpeners.add(local);
            }
          }

          if (imported === "localInstance") {
            named.set(local, "the local instance (workerd)");
          }
        }
      },
      NewExpression(node) {
        if (node.callee.type === "Identifier" && sqlite.has(node.callee.name)) {
          const path = literal(node.arguments[0] as Node | undefined);

          if (path !== ":memory:") {
            report(node, `new ${node.callee.name}(…)`, "a SQLite file");
          }
        }
      },
      CallExpression(node) {
        const callee = node.callee as Node;
        const onFile = literal(node.arguments[0] as Node | undefined) !== ":memory:";

        if (callee.type === "Identifier") {
          const drives = named.get(callee.name);

          if (drives !== undefined) {
            report(node, `${callee.name}(…)`, drives);
          } else if (databaseOpeners.has(callee.name) && onFile) {
            report(node, `${callee.name}(…)`, "a SQLite file");
          }

          return;
        }

        if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") {
          return;
        }

        const method = callee.property.name;
        const object = dotted(callee.object as Node);
        const space = object === null ? undefined : spaces.get(object);

        if (space !== undefined && space.names.has(method)) {
          report(node, `${object}.${method}(…)`, space.drives);
        } else if (object !== null && databases.has(object) && DATABASE_OPENERS.has(method) && onFile) {
          report(node, `${object}.${method}(…)`, "a SQLite file");
        } else if (object !== null && launchers.has(object) && /^launch/.test(method)) {
          report(node, `${object}.${method}(…)`, "a browser or Electron");
        }
      },
    };
  },
};
