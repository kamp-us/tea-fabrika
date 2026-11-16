// 0584: a test's kind follows what it uses. A plain test reads repository files or runs on
// stand-ins; a test that starts or reaches a real thing (an instance, workerd, Electron, a process,
// a signal, a port, the network, or local disk) is `.integration.`. This decides what in one
// module's own code starts a real thing, so the per-file rule (integration-test-name.ts) and the
// whole-tree check (test-kind.ts) hold one definition.
//
// It reads calls, never words, and a call counts only through the module its name came from, in
// any spelling: `{ spawn }`, `{ spawn as run }`, `* as cp` or a default import. So a fake with the
// same method names, a spy, or SQLite on `:memory:` never counts. Two calls start a real thing only
// on Node's own platform layer: `ChildProcess.make` or a spawner's `spawn` runs a process on
// `NodeServices` (or `NodeChildProcessSpawner`), and `makeTempDirectory` or `makeTempFile` writes
// disk on `NodeServices` (or `NodeFileSystem`). In a module's own code they count when that module
// imports the layer's module itself; across modules, wherever the layer comes from.
//
// `reader` takes facts, not syntax: oxlint's tree and oxc-parser's have the same shape but types
// that do not assign to each other, so each has a small adapter that reads the facts out. This file
// holds oxlint's (`visitor`); test-kind.ts holds oxc-parser's.
import type { ESTree, Visitor } from "@oxlint/plugins";
import { dotted } from "./match.ts";

/** The real things 0584 names, by what a call opens. */
export type Tag = "process" | "port" | "browser" | "instance" | "signal" | "network" | "disk";

/** The Node layers a call may need: one that spawns, one that writes disk. */
type Layer = "process" | "disk";

/** One call in a module's own code that opens a real thing, at its node in the adapter's tree. */
export type Open<N> = {
  readonly _tag: Tag;
  /** The call as written, for a message: `spawnSync(…)`. */
  readonly call: string;
  readonly node: N;
  /** The Node layer this call needs to be real, or `null` when it is real alone. */
  readonly needs: Layer | null;
};

/** What each tag drives, in a message's words. */
export const DRIVES: Readonly<Record<Tag, string>> = {
  process: "a spawned process",
  port: "a socket",
  browser: "a browser or Electron",
  instance: "the local instance (workerd)",
  signal: "a signal to a process",
  network: "the network",
  disk: "local disk",
};

/** What a name from a module is: a call that opens, SQLite's constructor, or a Node layer. */
type Role =
  | { readonly _tag: "call"; readonly tag: Tag; readonly needs: Layer | null }
  | { readonly _tag: "sqlite" }
  | { readonly _tag: "layer"; readonly gives: ReadonlyArray<Layer> };

const call = (tag: Tag, needs: Layer | null = null): Role => ({ _tag: "call", tag, needs });
const each = (names: ReadonlyArray<string>, role: Role) => Object.fromEntries(names.map((name) => [name, role]));

const launchers = (browser: string) =>
  each(
    ["launch", "launchPersistentContext", "launchServer"].map((method) => `${browser}.${method}`),
    call("browser"),
  );

const services: Role = { _tag: "layer", gives: ["process", "disk"] };
const files: Role = { _tag: "layer", gives: ["disk"] };
const spawner: Role = { _tag: "layer", gives: ["process"] };

/** Each module whose names open a real thing, by the dotted path of the name inside the module. */
const MODULES: ReadonlyArray<{ readonly module: RegExp; readonly names: Readonly<Record<string, Role>> }> = [
  {
    module: /^(?:node:)?child_process$/,
    names: each(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"], call("process")),
  },
  {
    module: /^(?:node:)?(?:net|http|https|http2)$/,
    names: each(["createServer", "createSecureServer", "connect", "createConnection"], call("port")),
  },
  { module: /^(?:node:)?fs(?:\/promises)?$/, names: each(["mkdtemp", "mkdtempSync"], call("disk")) },
  { module: /^(?:node:)?os$/, names: { tmpdir: call("disk") } },
  { module: /^(?:node:)?sqlite$/, names: { DatabaseSync: { _tag: "sqlite" } } },
  {
    module: /^(?:playwright|playwright-core|@playwright\/test)$/,
    names: { ...launchers("chromium"), ...launchers("firefox"), ...launchers("webkit"), ...launchers("_electron") },
  },
  { module: /(?:^|\/)local-instance(?:\.ts)?$/, names: { localInstance: call("instance") } },
  { module: /(?:^|\/)workerd\.test-support(?:\.ts)?$/, names: { killWorkerd: call("instance") } },
  { module: /^effect\/(?:unstable\/)?process$/, names: { "ChildProcess.make": call("process", "process") } },
  {
    module: /^@effect\/platform-node$/,
    names: { NodeServices: services, NodeFileSystem: files, NodeChildProcessSpawner: spawner },
  },
  { module: /^@effect\/platform-node\/NodeServices$/, names: { layer: services } },
  { module: /^@effect\/platform-node\/NodeFileSystem$/, names: { layer: files } },
  { module: /^@effect\/platform-node\/NodeChildProcessSpawner$/, names: { layer: spawner } },
];

/** Effect's FileSystem methods that make a temp folder or file. */
const TEMP = new Set(["makeTempDirectory", "makeTempDirectoryScoped", "makeTempFile", "makeTempFileScoped"]);

/** A host a test may reach without the network. */
const LOCAL = /^(?:localhost|127(?:\.\d+){3}|\[::1\]|0\.0\.0\.0)$/;

/** A `fetch` target outside this machine, from the literal start of its first argument. */
const remote = (first: string | null): boolean => {
  const host = /^https?:\/\/([^/:?#]+|\[[^\]]+\])/.exec(first ?? "")?.[1];
  return host !== undefined && !LOCAL.test(host);
};

/** One name a value import binds: `imported` is `null` for `* as x` or a default import. */
type Bound = { readonly imported: string | null; readonly local: string };

/**
 * What one module's own code opens. Its adapter feeds it each value import, `new` and call, with
 * the callee as written (`cp.spawn`, or `null` for a shape like `f()()`), the method's own name, and
 * the literal start of the first argument. `opens("alone")` keeps only what is real in this module by
 * itself: a call that needs Node's layer counts when this module imports it.
 */
export const reader = <N>() => {
  // Each name this module can write, as written (`run`, `cp.spawn`, `PN.NodeServices`), by role.
  const bound = new Map<string, Role>();
  const provided = new Set<Layer>();
  const found: Array<Open<N>> = [];
  const open = (node: N, written: string, tag: Tag, needs: Layer | null = null) =>
    found.push({ _tag: tag, call: `${written}(…)`, node, needs });
  const bind = (written: string, role: Role) => {
    bound.set(written, role);

    if (role._tag === "layer") {
      for (const layer of role.gives) {
        provided.add(layer);
      }
    }
  };

  return {
    imports: (source: string, names: ReadonlyArray<Bound>) => {
      const paths = MODULES.filter((entry) => entry.module.test(source)).flatMap((entry) =>
        Object.entries(entry.names),
      );

      for (const { imported, local } of names) {
        // `localInstance` opens the instance from wherever it is imported, as the rule always read it.
        if (imported === "localInstance") {
          bind(local, call("instance"));
        }

        for (const [path, role] of paths) {
          if (imported === null) {
            bind(`${local}.${path}`, role);
          } else if (path === imported || path.startsWith(`${imported}.`)) {
            bind(`${local}${path.slice(imported.length)}`, role);
          }
        }
      }
    },
    constructs: (node: N, written: string | null, first: string | null) => {
      if (written !== null && bound.get(written)?._tag === "sqlite" && first !== ":memory:") {
        found.push({ _tag: "disk", call: `new ${written}(…)`, node, needs: null });
      }
    },
    // A method counts by its own name too, so `(yield* spawner).spawn(…)` is read like `real.spawn(…)`.
    calls: (node: N, written: string | null, method: string | null, first: string | null) => {
      const role = written === null ? undefined : bound.get(written);
      const shown = written ?? `….${method}`;

      if (role !== undefined) {
        if (role._tag === "call") {
          open(node, shown, role.tag, role.needs);
        }
      } else if (written === "process.kill") {
        open(node, shown, "signal");
      } else if (written === "fetch" && remote(first)) {
        open(node, shown, "network");
      } else if (method === "spawn") {
        open(node, shown, "process", "process");
      } else if (method !== null && TEMP.has(method)) {
        open(node, shown, "disk", "disk");
      }
    },
    opens: (scope: "alone" | "any"): ReadonlyArray<Open<N>> =>
      scope === "any" ? found : found.filter((one) => one.needs === null || provided.has(one.needs)),
  };
};

type Node = ESTree.Node;

/** A string literal, or a template's text before its first placeholder. */
const literal = (node: Node | undefined): string | null =>
  node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : node?.type === "TemplateLiteral"
      ? (node.quasis[0]?.value.cooked ?? null)
      : null;

/** The adapter for oxlint's tree: a visitor that feeds `read`. */
export const visitor = (read: ReturnType<typeof reader<Node>>): Visitor => ({
  ImportDeclaration(node) {
    if (node.importKind === "type") {
      return;
    }

    read.imports(
      node.source.value,
      node.specifiers.flatMap((spec) =>
        spec.type === "ImportSpecifier" && spec.importKind === "type"
          ? []
          : [
              {
                local: spec.local.name,
                imported:
                  spec.type !== "ImportSpecifier"
                    ? null
                    : spec.imported.type === "Identifier"
                      ? spec.imported.name
                      : spec.imported.value,
              },
            ],
      ),
    );
  },
  NewExpression(node) {
    read.constructs(node, dotted(node.callee), literal(node.arguments[0]));
  },
  CallExpression(node) {
    const { callee } = node;
    const method =
      callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier"
        ? callee.property.name
        : null;
    read.calls(node, dotted(callee), method, literal(node.arguments[0]));
  },
});
