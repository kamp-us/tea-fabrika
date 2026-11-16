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
// imports the layer's module itself; across modules, wherever the layer comes from. A method counts
// only on the service itself: a name bound by `yield* ChildProcessSpawner.ChildProcessSpawner` or
// `yield* FileSystem.FileSystem`, or that `yield*` written in place, so a fake object's `spawn`
// does not, even in a file that provides the layer.
//
// Two globals: `fetch` and `new WebSocket` reach the network when their literal URL names another
// machine, unless the file stubs `fetch` with `vi.stubGlobal("fetch", …)`. `tmpdir()` is not a
// starter: it only names a folder, and the `mkdtemp` that writes there is.
//
// `reader` takes facts, not syntax: oxlint's tree and oxc-parser's have the same shape but types
// that do not assign to each other, so each has a small adapter that reads the facts out. This file
// holds oxlint's (`visitor`); test-kind.ts holds oxc-parser's.
import type { ESTree, Visitor } from "@oxlint/plugins";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Rec from "effect/Record";
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

/** What a name from a module is: a call that opens, a SQLite opener (its constructor, or the test database's `make` and `open`), a Node layer, or a service whose methods need one. */
type Role =
  | { readonly _tag: "call"; readonly tag: Tag; readonly needs: Layer | null }
  | { readonly _tag: "sqlite" }
  | { readonly _tag: "layer"; readonly gives: ReadonlyArray<Layer> }
  | { readonly _tag: "service"; readonly needs: Layer };

const call = (tag: Tag, needs: Layer | null = null): Role => ({ _tag: "call", tag, needs });

const each = (names: ReadonlyArray<string>, role: Role) => Rec.fromEntries(Arr.map(names, (name) => [name, role]));

const launchers = (browser: string) =>
  each(
    Arr.map(["launch", "launchPersistentContext", "launchServer"], (method) => `${browser}.${method}`),
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
  // A client call (`request`, `get`, `connect`) whose literal URL names another machine counts as the network.
  { module: /^(?:node:)?net$/, names: each(["createServer", "createConnection", "connect", "Server"], call("port")) },
  { module: /^(?:node:)?https?$/, names: each(["createServer", "request", "get"], call("port")) },
  { module: /^(?:node:)?http2$/, names: each(["createServer", "createSecureServer", "connect"], call("port")) },
  { module: /^(?:node:)?tls$/, names: each(["createServer", "connect"], call("port")) },
  { module: /^(?:node:)?dgram$/, names: { createSocket: call("port") } },
  { module: /^(?:node:)?fs$/, names: each(["mkdtemp", "mkdtempSync", "promises.mkdtemp"], call("disk")) },
  { module: /^(?:node:)?fs\/promises$/, names: { mkdtemp: call("disk") } },
  { module: /^(?:node:)?sqlite$/, names: { DatabaseSync: { _tag: "sqlite" } } },
  // The test primitives' SQLite module (ticket 1029): `make` and `open` open a file, as `new DatabaseSync` does.
  { module: /^@kampus\/vitest\/TestDatabase$/, names: { make: { _tag: "sqlite" }, open: { _tag: "sqlite" } } },
  {
    module: /^(?:playwright|playwright-core|@playwright\/test)$/,
    names: { ...launchers("chromium"), ...launchers("firefox"), ...launchers("webkit"), ...launchers("_electron") },
  },
  { module: /(?:^|\/)local-instance(?:\.ts)?$/, names: { localInstance: call("instance") } },
  { module: /(?:^|\/)workerd\.test-support(?:\.ts)?$/, names: { killWorkerd: call("instance") } },
  {
    module: /^effect\/(?:unstable\/)?process$/,
    names: {
      "ChildProcess.make": call("process", "process"),
      "ChildProcessSpawner.ChildProcessSpawner": { _tag: "service", needs: "process" },
    },
  },
  { module: /^effect$/, names: { "FileSystem.FileSystem": { _tag: "service", needs: "disk" } } },
  { module: /^effect\/FileSystem$/, names: { FileSystem: { _tag: "service", needs: "disk" } } },
  {
    module: /^@effect\/platform-node$/,
    names: { NodeServices: services, NodeFileSystem: files, NodeChildProcessSpawner: spawner },
  },
  { module: /^@effect\/platform-node\/NodeServices$/, names: { layer: services } },
  { module: /^@effect\/platform-node\/NodeFileSystem$/, names: { layer: files } },
  { module: /^@effect\/platform-node\/NodeChildProcessSpawner$/, names: { layer: spawner } },
];

/** The service methods that open a real thing on Node's layer: a spawner's `spawn`, a FileSystem's temp folder or file. */
const METHODS: Readonly<Record<Layer, ReadonlySet<string>>> = {
  process: new Set(["spawn"]),
  disk: new Set(["makeTempDirectory", "makeTempDirectoryScoped", "makeTempFile", "makeTempFileScoped"]),
};

/** What a method is called on: a name as written, or a service written in place, `(yield* S).spawn`. */
export type Receiver =
  | { readonly _tag: "name"; readonly written: string }
  | { readonly _tag: "yield"; readonly written: string };

/** A host a test may reach without the network. */
const LOCAL = /^(?:localhost|127(?:\.\d+){3}|\[::1\]|0\.0\.0\.0)$/;

/** A URL outside this machine, from the literal start of a call's first argument. */
const remote = (first: string | null): boolean => {
  const host = /^(?:https?|wss?):\/\/([^/:?#]+|\[[^\]]+\])/.exec(first ?? "")?.[1];

  return host !== undefined && !LOCAL.test(host);
};

/** One name a value import binds: `imported` is `null` for `* as x` or a default import. */
type Bound = { readonly imported: string | null; readonly local: string };

/**
 * What one module's own code opens. Its adapter feeds it each value import, each `const x = yield* S`,
 * and each `new` and call, with the callee as written (`cp.spawn`, or `null` for a shape like `f()()`),
 * the method's own name and what it is called on, and the literal start of the first argument.
 * `opens("alone")` keeps only what is real in this module by itself: a call that needs Node's layer
 * counts when this module imports it.
 */
export const reader = <N>() => {
  // Each name this module can write, as written (`run`, `cp.spawn`, `PN.NodeServices`), by role.
  const bound = new Map<string, Role>();
  // Each local bound to a service, by the layer its methods need.
  const served = new Map<string, Layer>();
  const provided = new Set<Layer>();
  const found: Array<Open<N>> = [];
  // A global `fetch` to another machine, kept apart: a file that stubs `fetch` reaches nothing.
  const fetched: Array<Open<N>> = [];
  let stubbed = false;

  const open = (node: N, shown: string, tag: Tag, needs: Layer | null = null) =>
    found.push({ _tag: tag, call: shown, node, needs });

  const bind = (written: string, role: Role) => {
    bound.set(written, role);

    if (role._tag === "layer") {
      for (const layer of role.gives) {
        provided.add(layer);
      }
    }
  };

  const service = (written: string): Layer | null => {
    const role = bound.get(written);

    return role?._tag === "service" ? role.needs : null;
  };

  // A port's client call to a literal URL on another machine reaches the network.
  const opened = (tag: Tag, first: string | null): Tag => (tag === "port" && remote(first) ? "network" : tag);

  return {
    imports: (source: string, names: ReadonlyArray<Bound>) => {
      const paths = pipe(
        MODULES,
        Arr.filter((entry) => entry.module.test(source)),
        Arr.flatMap((entry) => Rec.toEntries(entry.names)),
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
    yields: (local: string, written: string | null) => {
      const needs = written === null ? null : service(written);

      if (needs !== null) {
        served.set(local, needs);
      }
    },
    constructs: (node: N, written: string | null, first: string | null) => {
      const role = written === null ? undefined : bound.get(written);
      const shown = `new ${written}(…)`;

      if (role?._tag === "sqlite" && first !== ":memory:") {
        open(node, shown, "disk");
      } else if (role?._tag === "call") {
        open(node, shown, opened(role.tag, first), role.needs);
      } else if (role === undefined && written === "WebSocket" && remote(first)) {
        open(node, shown, "network");
      }
    },
    calls: (node: N, written: string | null, method: string | null, on: Receiver | null, first: string | null) => {
      const role = written === null ? undefined : bound.get(written);
      const shown = `${written ?? `….${method}`}(…)`;
      const needs = on === null ? null : on._tag === "yield" ? service(on.written) : (served.get(on.written) ?? null);

      if (role !== undefined) {
        if (role._tag === "call") {
          open(node, shown, opened(role.tag, first), role.needs);
        } else if (role._tag === "sqlite" && first !== ":memory:") {
          open(node, shown, "disk");
        }
      } else if (written === "process.kill") {
        open(node, shown, "signal");
      } else if (written === "fetch" && remote(first)) {
        fetched.push({ _tag: "network", call: shown, node, needs: null });
      } else if (written === "vi.stubGlobal" && first === "fetch") {
        stubbed = true;
      } else if (needs !== null && method !== null && METHODS[needs].has(method)) {
        open(node, shown, needs, needs);
      }
    },
    opens: (scope: "alone" | "any"): ReadonlyArray<Open<N>> => {
      const all = stubbed ? found : [...found, ...fetched];

      return scope === "any" ? all : Arr.filter(all, (one) => one.needs === null || provided.has(one.needs));
    },
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

/** The service a `yield*` hands over, as written: `ChildProcessSpawner.ChildProcessSpawner`. */
const yielded = (node: Node | null | undefined): string | null =>
  node?.type === "YieldExpression" && node.delegate && node.argument !== null ? dotted(node.argument) : null;

/** What a method is called on, or `null` for a call that is not a method's. */
const receiver = (callee: Node): Receiver | null => {
  if (callee.type !== "MemberExpression") {
    return null;
  }

  const service = yielded(callee.object);
  const written = dotted(callee.object);

  return service !== null ? { _tag: "yield", written: service } : written === null ? null : { _tag: "name", written };
};

/** The adapter for oxlint's tree: a visitor that feeds `read`. */
export const visitor = (read: ReturnType<typeof reader<Node>>): Visitor => ({
  ImportDeclaration(node) {
    if (node.importKind === "type") {
      return;
    }

    read.imports(
      node.source.value,
      Arr.flatMap(node.specifiers, (spec) =>
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
  VariableDeclarator(node) {
    if (node.id.type === "Identifier") {
      read.yields(node.id.name, yielded(node.init));
    }
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

    read.calls(node, dotted(callee), method, receiver(callee), literal(node.arguments[0]));
  },
});
