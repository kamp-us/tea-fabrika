// p65, `next/` stands alone (docs/plan/tier-1-detail.md, "Packages" and p65). `package.json` alone
// stops no Node import at a top level, so this test bundles the top levels for a browser. Item 9 of
// the detail's exam; written by the exam (Tier 1, P1). Its manifest and import halves were lint
// all along, so 0591 made them `pnpm lint:manifests` (oxlint-plugins/next-manifests.ts) and the rule
// `fabrika/package-deps` (oxlint-plugins/package-deps.ts), with this file's planted trees as their
// laws; what stays here is bundle output, which no lint rule sees. With `pnpm lint:layers` and
// `fabrika/package-imports`.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { String as Str, pipe, Array as Arr, Record as Rec, Effect, Formatter, Option, Predicate, Schema } from "effect";
import { rolldown, type Plugin, type RolldownBuild } from "rolldown";

const NEXT = resolve(import.meta.dirname, "../../../..");

const GROUPS = ["packages", "programs", "apps"] as const; // pnpm-workspace.yaml's next/ globs

const Manifest = Schema.Struct({ name: Schema.String, exports: Schema.optional(Schema.Unknown) });

type Package = {
  readonly dir: string;
  readonly group: (typeof GROUPS)[number];
  readonly manifest: typeof Manifest.Type;
};

const readManifest = Schema.decodeUnknownSync(Manifest);

/** Every package under `next`: a child folder of a group that holds a `package.json`. */
const packagesIn = (next: string): ReadonlyArray<Package> =>
  Arr.flatMap(GROUPS, (group) => {
    const folder = join(next, group);

    if (!existsSync(folder)) {
      return [];
    }

    return pipe(
      readdirSync(folder, { withFileTypes: true }),
      Arr.filter((entry) => entry.isDirectory() && existsSync(join(folder, entry.name, "package.json"))),
      Arr.map((entry) => ({
        dir: join(folder, entry.name),
        group,
        manifest: readManifest(JSON.parse(readFileSync(join(folder, entry.name, "package.json"), "utf8"))),
      })),
    );
  });

/** A package's `exports` map, each key with the file it points at. */
const exportMap = (pkg: Package): ReadonlyMap<string, string | undefined> => {
  const target = (value: unknown): string | undefined => {
    if (Predicate.isString(value)) {
      return join(pkg.dir, value);
    }

    if (!Predicate.isObjectOrArray(value)) {
      return undefined;
    }

    const conditions = new Map(Object.entries(value));

    return target(conditions.get("import") ?? conditions.get("default"));
  };

  const exports = pkg.manifest.exports;

  if (!Predicate.isObjectOrArray(exports)) {
    return exports === undefined ? new Map() : new Map([[".", target(exports)]]);
  }

  const entries = Object.entries(exports);

  if (!Arr.every(entries, ([key]) => pipe(key, Str.startsWith(".")))) {
    return new Map([[".", target(exports)]]);
  }

  return new Map(Arr.map(entries, ([key, value]) => [key, target(value)]));
};

/** What an import of a subpath reaches through an `exports` map. */
type Reached =
  | { readonly kind: "file"; readonly file: string }
  | { readonly kind: "refused" }
  | { readonly kind: "missing" };

/**
 * Node's rule for a subpath (ticket 477, PR 9): an exact key without a `*` first; else, among the keys
 * with one `*` that the subpath fits, the one whose part before the `*` is longest, then the longer
 * key. A `null` target refuses the subpath, so `"./ledger/internal/*": null` beats `"./ledger/*"`. The
 * `*` of the target takes what the `*` of the key matched. `fabrika/package-deps` reads a map the same
 * way, and its laws hold the rule; here it only finds the files to bundle.
 */
const exportAt = (map: ReadonlyMap<string, string | undefined>, subpath: string): Reached => {
  if (map.has(subpath) && !pipe(subpath, Str.includes("*"))) {
    const file = map.get(subpath);

    return file === undefined ? { kind: "refused" } : { kind: "file", file };
  }

  const [best] = pipe(
    [...map.keys()],
    Arr.map((key) => ({ key, parts: Str.split(key, "*") })),
    Arr.filter(
      ({ key, parts }) =>
        parts.length === 2 &&
        subpath.length >= key.length &&
        pipe(subpath, Str.startsWith(parts[0] ?? "")) &&
        pipe(subpath, Str.endsWith(parts[1] ?? "")),
    ),
  ).sort((a, b) => (b.parts[0] ?? "").length - (a.parts[0] ?? "").length || b.key.length - a.key.length);

  if (best === undefined) {
    return { kind: "missing" };
  }

  const file = map.get(best.key);
  const matched = pipe(subpath, Str.slice((best.parts[0] ?? "").length, subpath.length - (best.parts[1] ?? "").length));

  return file === undefined ? { kind: "refused" } : { kind: "file", file: Arr.join(Str.split(file, "*"), matched) };
};

/** A path as the messages show it: relative to `from`, with `/`. */
const shown = (from: string, file: string): string => Arr.join(Str.split(relative(from, file), sep), "/");

// Planted trees: each scan is seen to fire on a planted break before it is trusted on `next/`.
// A tree is planted in the scope of the test that reads it, which removes it when the test ends (0061).
const plant = (files: Readonly<Record<string, string | object>>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "next-exam-")));

      for (const [path, body] of Rec.toEntries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), Predicate.isString(body) ? body : Formatter.formatJson(body));
      }

      return root;
    }),
    (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
  );

const lines = (...each: ReadonlyArray<string>): string => `${Arr.join(each, "\n")}\n`;

/** A `package.json` the way p65 wants one; `extra` overrides or adds fields. */
const manifest = (name: string, extra: object = {}): object => ({
  name,
  version: "0.0.0",
  private: true,
  sideEffects: false,
  scripts: { typecheck: "tsc --noEmit" },
  exports: { ".": "./src/index.ts" },
  ...extra,
});

/** What a top level bundled for a browser must not reach. */
const FORBIDDEN: ReadonlyArray<{ readonly name: string; readonly test: (spec: string) => boolean }> = [
  {
    name: "node:*",
    test: (spec) => pipe(spec, Str.startsWith("node:")) || builtinModules.includes(Str.split(spec, "/")[0] ?? ""),
  },
  { name: "electron", test: (spec) => spec === "electron" || pipe(spec, Str.startsWith("electron/")) },
  { name: "cloudflare:*", test: (spec) => pipe(spec, Str.startsWith("cloudflare:")) },
  { name: "@modelcontextprotocol/*", test: (spec) => pipe(spec, Str.startsWith("@modelcontextprotocol/")) },
];

/** The front files the library's old barrels (`/transport`, `/data`, `/coordination`, `/door`) reached.
 *  A tab runs the transport's (Tier 1, P7), holds a read copy of the data's later (P6), and the menu
 *  bar and the gateway share the coordination's (P9). The platform variants, `NodeSqlite` and
 *  `CloudflareSql`, were never in a barrel. */
const FRONTS: ReadonlyArray<string> = [
  "telemetry/Archive",
  "telemetry/RecordPart",
  "telemetry/Records",
  "telemetry/Sink",
  "telemetry/Trace",
  "ledger/Ledger",
  "ledger/LedgerTransaction",
  "ledger/Log",
  "ledger/Referee",
  "transport/Answer",
  "transport/Handshake",
  "transport/Hello",
  "transport/Sshsig",
  "transport/Webauthn",
  "transport/Wire",
  "access/Access",
  "access/Authorization",
  "access/ClientManager",
  "access/SessionManager",
  "access/Text",
  "presence/Connections",
  "processes/Mailbox",
  "processes/Process",
  "processes/ProcessIdGenerator",
  "processes/ProcessManager",
  "runtime/ProcessStore",
  "runtime/RecoveryStore",
  "gateway/Gateway",
  "gateway/GatewayNonce",
  "gateway/GatewayStore",
  "desktop/BrainService",
  "desktop/BrainControl",
  "desktop/BrainProbe",
  "desktop/BrainSpec",
  // P18 L8: the one window client bundles for a browser with no Node or DOM shim.
  "client/WindowMachine",
  "client/WindowStart",
  "client/Headless",
];

/** The detail's list, the top level of the library, of tuval and of notes, plus the library's front
 *  files above. Every program's `/window` comes on top. */
const BROWSER: Readonly<Record<string, ReadonlyArray<string>>> = {
  "@kampus/libfabrika": [".", ...Arr.map(FRONTS, (front) => `./${front}`)],
  "@kampus/tuval": ["."],
  "@kampus/notes": ["."],
};

const browserEntries = (
  packages: ReadonlyArray<Package>,
): ReadonlyArray<{ readonly label: string; readonly file: string }> =>
  Arr.flatMap(packages, (pkg) => {
    const name = pkg.manifest.name;
    const keys = [...(BROWSER[name] ?? []), ...(pkg.group === "programs" ? ["./window"] : [])];

    return Arr.flatMap(keys, (key) => {
      const reached = exportAt(exportMap(pkg), key);

      return reached.kind === "file" && existsSync(reached.file)
        ? [{ label: key === "." ? name : `${name}${pipe(key, Str.slice(1))}`, file: reached.file }]
        : [];
    });
  });

/** Rolldown refused or failed: the bundle's own failure, with Rolldown's error as its cause. */
class BundleFailure extends Schema.TaggedError<BundleFailure, { readonly brand: unique symbol }>()("BundleFailure", {
  cause: Schema.Unknown,
}) {}

/** One call of Rolldown's Promise API, as `Effect.tryPromise` in its object form. */
const bundling = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => BundleFailure.make({ cause }) });

/** A Rolldown bundle of `file` for a browser, closed when `use` ends, however it ends. */
const bundled = <A, E>(file: string, plugin: Plugin, use: (bundle: RolldownBuild) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    bundling(() => rolldown({ input: file, platform: "browser", logLevel: "silent", plugins: [plugin] })),
    use,
    (bundle) => bundling(() => bundle.close()).pipe(Effect.orDie),
  );

/** Bundles `file` for a browser with no Node shims and lists each forbidden module it reaches. */
const reach = Effect.fnUntraced(function* (next: string, label: string, file: string) {
  const hits: Array<string> = [];

  const watch: Plugin = {
    name: "forbidden",
    resolveId(source, importer) {
      const rule = Arr.findFirst(FORBIDDEN, (f) => f.test(source));

      if (Option.isNone(rule)) {
        return undefined;
      }

      hits.push(`${label} reaches ${rule.value.name}: "${source}" from ${shown(next, importer ?? file)}`);

      return { id: source, external: true };
    },
  };

  return yield* bundled(file, watch, (bundle) => bundling(() => bundle.generate({ format: "esm" }))).pipe(
    Effect.as<ReadonlyArray<string>>(hits),
    Effect.catchTag("BundleFailure", (error) =>
      Effect.succeed([...hits, `${label} does not bundle: ${String(error.cause)}`]),
    ),
  );
});

const bundleFaults = Effect.fnUntraced(function* (next: string) {
  const all = yield* Effect.forEach(browserEntries(packagesIn(next)), ({ label, file }) => reach(next, label, file), {
    concurrency: "unbounded",
  });

  return all.flat();
});

/** What a browser bundle of `file` loads, and what its output keeps, each relative to `next`. Tree
 *  shaking drops a module from the output, never from the loaded list. A bundle that fails fails. */
const bundleContents = Effect.fnUntraced(function* (next: string, file: string) {
  const loaded: Array<string> = [];

  const watch: Plugin = {
    name: "loaded",
    load(id) {
      loaded.push(shown(next, id));

      return null;
    },
  };

  const { output } = yield* bundled(file, watch, (bundle) => bundling(() => bundle.generate({ format: "esm" })));
  const kept = Arr.flatMap(output, (chunk) => (chunk.type === "chunk" ? chunk.moduleIds : []));

  return { loaded, output: Arr.map(kept, (id) => shown(next, id)) };
});

/** The Ledger contract's implementation: its two layers, their helpers, the referee and its store
 *  (ticket 702's plan: `Ledger.ts` imports neither implementation, nor either helper, nor `Referee`). */
const LEDGER_IMPLEMENTATION: ReadonlyArray<string> = [
  "packages/libfabrika/src/ledger/LedgerSql.ts",
  "packages/libfabrika/src/ledger/LedgerRemote.ts",
  "packages/libfabrika/src/ledger/Referee.ts",
  "packages/libfabrika/src/ledger/internal/ledgerStore.ts",
  "packages/libfabrika/src/ledger/internal/ledgerPages.ts",
  "packages/libfabrika/src/ledger/internal/ledgerTrace.ts",
];

describe("the real next/", () => {
  it.live("P17a: the public door exists and bundles for a browser", () =>
    Effect.gen(function* () {
      const found = Arr.findFirst(packagesIn(NEXT), (pkg) => pkg.manifest.name === "@kampus/libfabrika");
      expect(Option.isSome(found)).toBe(true);
      const library = Option.getOrThrow(found);
      const entry = exportAt(exportMap(library), "./gateway/Gateway");
      expect(entry.kind, "P17a exports the library gateway front").toBe("file");
      expect(yield* reach(NEXT, "@kampus/libfabrika/gateway/Gateway", entry.kind === "file" ? entry.file : "")).toEqual(
        [],
      );
    }),
  );
  it.live("P11: libfabrika exports its required browser entry instead of silently skipping it", () =>
    Effect.gen(function* () {
      const found = Arr.findFirst(packagesIn(NEXT), (pkg) => pkg.manifest.name === "@kampus/libfabrika");
      expect(Option.isSome(found)).toBe(true);
      const library = Option.getOrThrow(found);
      const entry = exportMap(library).get(".");
      expect(entry, "P11 adds libfabrika's browser-safe app entry").toBeDefined();
      expect(yield* reach(NEXT, "@kampus/libfabrika", entry!)).toEqual([]);
    }),
  );
  it("P11: every front file the browser check lists is exported and exists, so none is silently skipped", () => {
    const found = Arr.findFirst(packagesIn(NEXT), (pkg) => pkg.manifest.name === "@kampus/libfabrika");
    expect(Option.isSome(found)).toBe(true);
    const library = Option.getOrThrow(found);

    const missing = Arr.filter(BROWSER["@kampus/libfabrika"] ?? [], (key) => {
      const reached = exportAt(exportMap(library), key);

      return !(reached.kind === "file" && existsSync(reached.file));
    });

    expect(missing).toEqual([]);
  });
  // pinned: one named public contract (0095, ticket 702). Bundled alone for a browser, the Ledger
  // contract loads none of its implementation, so a tab that yields `Ledger` never carries SQL.
  // The entry must exist and the bundle must build: a missing entry or a failed bundle is red.
  it.live("pinned: contract only Ledger reaches no store", () =>
    Effect.gen(function* () {
      const found = Arr.findFirst(packagesIn(NEXT), (pkg) => pkg.manifest.name === "@kampus/libfabrika");
      expect(Option.isSome(found)).toBe(true);
      const library = Option.getOrThrow(found);
      const entry = exportAt(exportMap(library), "./ledger/Ledger");
      expect(entry.kind, "libfabrika exports the Ledger contract").toBe("file");
      const file = entry.kind === "file" ? entry.file : "";
      expect(existsSync(file), "the Ledger contract file exists").toBe(true);
      const { loaded, output } = yield* bundleContents(NEXT, file);
      expect(loaded, "the bundle loaded its entry").toContain(shown(NEXT, file));
      expect(output, "the bundle kept its entry").toContain(shown(NEXT, file));
      expect(Arr.filter(loaded, (id) => LEDGER_IMPLEMENTATION.includes(id))).toEqual([]);
      expect(Arr.filter(output, (id) => LEDGER_IMPLEMENTATION.includes(id))).toEqual([]);
    }),
  );

  it.live("bundles each top level for a browser without node, electron, cloudflare or MCP", () =>
    Effect.gen(function* () {
      expect(yield* bundleFaults(NEXT)).toEqual([]);
    }),
  );
});

describe("planted breaks", () => {
  it.effect("P17a: the door browser check catches a Node import", () =>
    Effect.gen(function* () {
      const tree = yield* plant({
        "packages/libfabrika/package.json": manifest("@kampus/libfabrika", {
          exports: { "./gateway/*": "./src/gateway/*.ts", "./gateway/internal/*": null },
        }),
        "packages/libfabrika/src/gateway/Gateway.ts": lines('export {readFileSync} from "node:fs";'),
      });

      expect(
        Arr.some(
          yield* bundleFaults(tree),
          (fault) =>
            pipe(fault, Str.includes("@kampus/libfabrika/gateway/Gateway")) && pipe(fault, Str.includes("node:fs")),
        ),
      ).toBe(true);
    }),
  );

  it.effect("fires on a top level that reaches node, cloudflare, MCP or electron", () =>
    Effect.gen(function* () {
      const bundles = yield* plant({
        "packages/libfabrika/package.json": manifest("@kampus/libfabrika", {
          exports: { ".": "./src/index.ts", "./transport/*": "./src/transport/*.ts" },
        }),
        "packages/libfabrika/src/index.ts": lines(
          'import {readFileSync} from "node:fs";',
          "export const read = readFileSync;",
        ),
        "packages/libfabrika/src/transport/Wire.ts": lines(
          'import {createHash} from "node:crypto";',
          "export const hash = createHash;",
        ),
        "packages/tuval/package.json": manifest("@kampus/tuval"),
        "packages/tuval/src/index.ts": lines("export const clean = 1;"),
        "programs/notes/package.json": manifest("@kampus/notes", {
          exports: { ".": "./src/program.ts", "./window": "./src/view.ts" },
        }),
        "programs/notes/src/program.ts": lines(
          'import {serve} from "@modelcontextprotocol/server";',
          "export const s = serve;",
        ),
        "programs/notes/src/view.ts": lines('export {DurableObject} from "cloudflare:workers";'),
        "programs/chaos/package.json": manifest("@kampus/chaos", {
          exports: { ".": "./src/index.ts", "./window": "./src/window.ts" },
        }),
        "programs/chaos/src/index.ts": lines('import {app} from "electron";', "export const a = app;"),
        "programs/chaos/src/window.ts": lines('export {a} from "./index.ts";'),
      });

      expect([...(yield* bundleFaults(bundles))].sort()).toEqual(
        [
          '@kampus/libfabrika reaches node:*: "node:fs" from packages/libfabrika/src/index.ts',
          '@kampus/libfabrika/transport/Wire reaches node:*: "node:crypto" from packages/libfabrika/src/transport/Wire.ts',
          '@kampus/notes reaches @modelcontextprotocol/*: "@modelcontextprotocol/server" from programs/notes/src/program.ts',
          '@kampus/notes/window reaches cloudflare:*: "cloudflare:workers" from programs/notes/src/view.ts',
          '@kampus/chaos/window reaches electron: "electron" from programs/chaos/src/index.ts',
        ].sort(),
      );
    }),
  );
});

it.live("format: L12 desktop contracts bundle for a browser without their implementations", () =>
  Effect.gen(function* () {
    // The three public contracts are a client import protocol. Loading one must not load its driver.
    // After build plant: route a contract through BrainServiceManaged; this must fail even if all
    // platform imports were tree-shaken from the emitted bytes.
    const found = Arr.findFirst(packagesIn(NEXT), (pkg) => pkg.manifest.name === "@kampus/libfabrika");
    expect(Option.isSome(found)).toBe(true);
    const library = Option.getOrThrow(found);

    const implementation =
      /packages\/libfabrika\/src\/(?:desktop\/(?:BrainServiceManaged|internal\/)|node\/launchd\/|cloudflare\/)/;

    for (const name of ["BrainService", "BrainControl", "BrainProbe"]) {
      const entry = exportAt(exportMap(library), `./desktop/${name}`);
      expect(entry.kind).toBe("file");
      const file = entry.kind === "file" ? entry.file : "";
      expect(existsSync(file)).toBe(true);
      const { loaded, output } = yield* bundleContents(NEXT, file);
      expect(loaded).toContain(shown(NEXT, file));
      expect(Arr.filter(loaded, (path) => implementation.test(path))).toEqual([]);
      expect(Arr.filter(output, (path) => implementation.test(path))).toEqual([]);
    }
  }),
);
