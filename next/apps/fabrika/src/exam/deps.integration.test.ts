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
import { Effect, Schema } from "effect";
import { rolldown, type Plugin } from "rolldown";

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
  GROUPS.flatMap((group) => {
    const folder = join(next, group);

    if (!existsSync(folder)) {
      return [];
    }

    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(folder, entry.name, "package.json")))
      .map((entry) => ({
        dir: join(folder, entry.name),
        group,
        manifest: readManifest(JSON.parse(readFileSync(join(folder, entry.name, "package.json"), "utf8"))),
      }));
  });

/** A package's `exports` map, each key with the file it points at. */
const exportMap = (pkg: Package): ReadonlyMap<string, string | undefined> => {
  const target = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      return join(pkg.dir, value);
    }

    if (typeof value !== "object" || value === null) {
      return undefined;
    }

    const conditions = new Map(Object.entries(value));
    return target(conditions.get("import") ?? conditions.get("default"));
  };
  const exports = pkg.manifest.exports;

  if (typeof exports !== "object" || exports === null) {
    return exports === undefined ? new Map() : new Map([[".", target(exports)]]);
  }

  const entries = Object.entries(exports);

  if (!entries.every(([key]) => key.startsWith("."))) {
    return new Map([[".", target(exports)]]);
  }

  return new Map(entries.map(([key, value]) => [key, target(value)]));
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
  if (map.has(subpath) && !subpath.includes("*")) {
    const file = map.get(subpath);
    return file === undefined ? { kind: "refused" } : { kind: "file", file };
  }

  const [best] = [...map.keys()]
    .map((key) => ({ key, parts: key.split("*") }))
    .filter(
      ({ key, parts }) =>
        parts.length === 2 &&
        subpath.length >= key.length &&
        subpath.startsWith(parts[0] ?? "") &&
        subpath.endsWith(parts[1] ?? ""),
    )
    .sort((a, b) => (b.parts[0] ?? "").length - (a.parts[0] ?? "").length || b.key.length - a.key.length);

  if (best === undefined) {
    return { kind: "missing" };
  }

  const file = map.get(best.key);
  const matched = subpath.slice((best.parts[0] ?? "").length, subpath.length - (best.parts[1] ?? "").length);
  return file === undefined ? { kind: "refused" } : { kind: "file", file: file.split("*").join(matched) };
};

/** A path as the messages show it: relative to `from`, with `/`. */
const shown = (from: string, file: string): string => relative(from, file).split(sep).join("/");

// Planted trees: each scan is seen to fire on a planted break before it is trusted on `next/`.
// A tree is planted in the scope of the test that reads it, which removes it when the test ends (0061).
const plant = (files: Readonly<Record<string, string | object>>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "next-exam-")));

      for (const [path, body] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), typeof body === "string" ? body : JSON.stringify(body));
      }

      return root;
    }),
    (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
  );

const lines = (...each: ReadonlyArray<string>): string => `${each.join("\n")}\n`;

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
    test: (spec) => spec.startsWith("node:") || builtinModules.includes(spec.split("/")[0] ?? ""),
  },
  { name: "electron", test: (spec) => spec === "electron" || spec.startsWith("electron/") },
  { name: "cloudflare:*", test: (spec) => spec.startsWith("cloudflare:") },
  { name: "@modelcontextprotocol/*", test: (spec) => spec.startsWith("@modelcontextprotocol/") },
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
  "@kampus/libfabrika": [".", ...FRONTS.map((front) => `./${front}`)],
  "@kampus/tuval": ["."],
  "@kampus/notes": ["."],
};

const browserEntries = (
  packages: ReadonlyArray<Package>,
): ReadonlyArray<{ readonly label: string; readonly file: string }> =>
  packages.flatMap((pkg) => {
    const name = pkg.manifest.name;
    const keys = [...(BROWSER[name] ?? []), ...(pkg.group === "programs" ? ["./window"] : [])];
    return keys.flatMap((key) => {
      const reached = exportAt(exportMap(pkg), key);
      return reached.kind === "file" && existsSync(reached.file)
        ? [{ label: key === "." ? name : `${name}${key.slice(1)}`, file: reached.file }]
        : [];
    });
  });

/** Bundles `file` for a browser with no Node shims and lists each forbidden module it reaches. */
const reach = async (next: string, label: string, file: string): Promise<ReadonlyArray<string>> => {
  const hits: Array<string> = [];
  const watch: Plugin = {
    name: "forbidden",
    resolveId(source, importer) {
      const rule = FORBIDDEN.find((f) => f.test(source));

      if (rule === undefined) {
        return undefined;
      }

      hits.push(`${label} reaches ${rule.name}: "${source}" from ${shown(next, importer ?? file)}`);
      return { id: source, external: true };
    },
  };
  let bundle: Awaited<ReturnType<typeof rolldown>> | undefined;

  try {
    bundle = await rolldown({
      input: file,
      platform: "browser",
      logLevel: "silent",
      plugins: [watch],
    });
    await bundle.generate({ format: "esm" });
    return hits;
  } catch (error) {
    return [...hits, `${label} does not bundle: ${String(error)}`];
  } finally {
    await bundle?.close();
  }
};

const bundleFaults = async (next: string): Promise<ReadonlyArray<string>> => {
  const all = await Promise.all(browserEntries(packagesIn(next)).map(({ label, file }) => reach(next, label, file)));
  return all.flat();
};

/** What a browser bundle of `file` loads, and what its output keeps, each relative to `next`. Tree
 *  shaking drops a module from the output, never from the loaded list. A bundle that fails throws. */
const bundleContents = async (
  next: string,
  file: string,
): Promise<{ readonly loaded: ReadonlyArray<string>; readonly output: ReadonlyArray<string> }> => {
  const loaded: Array<string> = [];
  const watch: Plugin = {
    name: "loaded",
    load(id) {
      loaded.push(shown(next, id));
      return null;
    },
  };
  const bundle = await rolldown({ input: file, platform: "browser", logLevel: "silent", plugins: [watch] });

  try {
    const { output } = await bundle.generate({ format: "esm" });
    const kept = output.flatMap((chunk) => (chunk.type === "chunk" ? chunk.moduleIds : []));
    return { loaded, output: kept.map((id) => shown(next, id)) };
  } finally {
    await bundle.close();
  }
};

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
  it("P17a: the public door exists and bundles for a browser", async () => {
    const library = packagesIn(NEXT).find((pkg) => pkg.manifest.name === "@kampus/libfabrika");
    expect(library).toBeDefined();
    const entry = exportAt(exportMap(library!), "./gateway/Gateway");
    expect(entry.kind, "P17a exports the library gateway front").toBe("file");
    expect(await reach(NEXT, "@kampus/libfabrika/gateway/Gateway", entry.kind === "file" ? entry.file : "")).toEqual(
      [],
    );
  });
  it("P11: libfabrika exports its required browser entry instead of silently skipping it", async () => {
    const library = packagesIn(NEXT).find((pkg) => pkg.manifest.name === "@kampus/libfabrika");
    expect(library).toBeDefined();
    const entry = exportMap(library!).get(".");
    expect(entry, "P11 adds libfabrika's browser-safe app entry").toBeDefined();
    expect(await reach(NEXT, "@kampus/libfabrika", entry!)).toEqual([]);
  });
  it("P11: every front file the browser check lists is exported and exists, so none is silently skipped", () => {
    const library = packagesIn(NEXT).find((pkg) => pkg.manifest.name === "@kampus/libfabrika");
    expect(library).toBeDefined();
    const missing = (BROWSER["@kampus/libfabrika"] ?? []).filter((key) => {
      const reached = exportAt(exportMap(library!), key);
      return !(reached.kind === "file" && existsSync(reached.file));
    });
    expect(missing).toEqual([]);
  });
  // pinned: one named public contract (0095, ticket 702). Bundled alone for a browser, the Ledger
  // contract loads none of its implementation, so a tab that yields `Ledger` never carries SQL.
  // The entry must exist and the bundle must build: a missing entry or a failed bundle is red.
  it("pinned: contract only Ledger reaches no store", async () => {
    const library = packagesIn(NEXT).find((pkg) => pkg.manifest.name === "@kampus/libfabrika");
    expect(library).toBeDefined();
    const entry = exportAt(exportMap(library!), "./ledger/Ledger");
    expect(entry.kind, "libfabrika exports the Ledger contract").toBe("file");
    const file = entry.kind === "file" ? entry.file : "";
    expect(existsSync(file), "the Ledger contract file exists").toBe(true);
    const { loaded, output } = await bundleContents(NEXT, file);
    expect(loaded, "the bundle loaded its entry").toContain(shown(NEXT, file));
    expect(output, "the bundle kept its entry").toContain(shown(NEXT, file));
    expect(loaded.filter((id) => LEDGER_IMPLEMENTATION.includes(id))).toEqual([]);
    expect(output.filter((id) => LEDGER_IMPLEMENTATION.includes(id))).toEqual([]);
  });

  it("bundles each top level for a browser without node, electron, cloudflare or MCP", async () => {
    expect(await bundleFaults(NEXT)).toEqual([]);
  });
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
        (yield* Effect.promise(() => bundleFaults(tree))).some(
          (fault) => fault.includes("@kampus/libfabrika/gateway/Gateway") && fault.includes("node:fs"),
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
      expect([...(yield* Effect.promise(() => bundleFaults(bundles)))].sort()).toEqual(
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

it("format: L12 desktop contracts bundle for a browser without their implementations", async () => {
  // The three public contracts are a client import protocol. Loading one must not load its driver.
  // After build plant: route a contract through BrainServiceManaged; this must fail even if all
  // platform imports were tree-shaken from the emitted bytes.
  const library = packagesIn(NEXT).find((pkg) => pkg.manifest.name === "@kampus/libfabrika");
  expect(library).toBeDefined();
  const implementation =
    /packages\/libfabrika\/src\/(?:desktop\/(?:BrainServiceManaged|internal\/)|node\/launchd\/|cloudflare\/)/;

  for (const name of ["BrainService", "BrainControl", "BrainProbe"]) {
    const entry = exportAt(exportMap(library!), `./desktop/${name}`);
    expect(entry.kind).toBe("file");
    const file = entry.kind === "file" ? entry.file : "";
    expect(existsSync(file)).toBe(true);
    const { loaded, output } = await bundleContents(NEXT, file);
    expect(loaded).toContain(shown(NEXT, file));
    expect(loaded.filter((path) => implementation.test(path))).toEqual([]);
    expect(output.filter((path) => implementation.test(path))).toEqual([]);
  }
});
