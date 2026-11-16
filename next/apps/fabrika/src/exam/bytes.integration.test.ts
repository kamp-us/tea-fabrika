// P8, next/. p61/p64/p65. Observe every Rolldown call of the real one-file build (P16, PR 687): the
// brain, each program and each window script the brain carries as a text module.
// Source: next/apps/fabrika/src/build.test.ts at 9b48d622b5d4. Existing p65 laws stay intact.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { build as buildOne, type Built } from "@kampus/libfabrika/build";
import { bundle } from "@kampus/libfabrika/node/build";
import { runsFor } from "@kampus/vitest";
import { String as Str, pipe, Array as Arr, Record as Rec } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Formatter from "effect/Formatter";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as fc from "fast-check";
import type { Plugin, RolldownPluginOption } from "rolldown";
import { vi } from "vitest";
import { build } from "../build.ts";

type Module = {
  readonly id: string;
  readonly imports: ReadonlyArray<string>;
  readonly dynamic: ReadonlyArray<string>;
  readonly external: boolean;
  readonly code: string;
};

type Chunk = {
  readonly file: string;
  readonly code: string;
  readonly imports: ReadonlyArray<string>;
  readonly dynamic: ReadonlyArray<string>;
  readonly modules: ReadonlyArray<string>;
};

type Observed = {
  readonly input: unknown;
  readonly modules: ReadonlyArray<Module>;
  readonly chunks: ReadonlyArray<Chunk>;
  /** Emitted assets' text, such as a window's stylesheet, which the brain also carries. */
  readonly assets: ReadonlyArray<string>;
};

const observations = vi.hoisted(() => ({ builds: [] as Observed[] }));

const moduleReport = (modules: ReadonlyArray<string>): string =>
  pipe(
    modules,
    Arr.map((id) => `P8 module: ${JSON.stringify(id)}\n`),
    Arr.join(""),
  );

it("L7: module reports keep every id on its own line below 4096 characters", () => {
  // fast-check stresses list size and control characters beyond Effect's default string generator.
  fc.assert(
    fc.property(fc.array(fc.string({ maxLength: 300 }), { maxLength: 2000 }), (modules) => {
      const report = moduleReport(modules);
      const lines = report === "" ? [] : Str.split(Str.trimEnd(report), "\n");
      expect(lines).toHaveLength(modules.length);
      expect(Arr.every(lines, (line) => line.length <= 4096)).toBe(true);
      expect(Arr.map(lines, (line) => JSON.parse(pipe(line, Str.slice("P8 module: ".length))))).toEqual(modules);
    }),
    {
      seed: 119120,
      numRuns: 100,
      // Pinned bug: the old P8 brain log exceeded gh's line reader with its whole module list.
      examples: [[Array.from({ length: 2000 }, () => pipe("m", Str.repeat(300)))]],
    },
  );
});

// This wrapper calls the actual Rolldown API. The only clean-build option change is the observer.
vi.mock("rolldown", async (original) => {
  const real = await original<typeof import("rolldown")>();

  return {
    ...real,
    rolldown: (options: Parameters<typeof real.rolldown>[0]) => {
      const observer: Plugin = {
        name: "p8-passive-observer",
        generateBundle(_options, output) {
          const ids = new Set(this.getModuleIds());
          const modules = Arr.map([...ids], (id) => {
            const info = this.getModuleInfo(id);

            if (info === null) {
              throw new Error(`Rolldown omitted module info: ${id}`);
            }

            return {
              id,
              imports: [...info.importedIds],
              dynamic: [...info.dynamicallyImportedIds],
              external: false,
              code: info.code ?? "",
            };
          });
          const chunks = Arr.flatMap(Rec.values(output), (o) =>
            o.type === "chunk"
              ? [
                  {
                    file: o.fileName,
                    code: o.code,
                    imports: [...o.imports],
                    dynamic: [...o.dynamicImports],
                    modules: Rec.keys(o.modules),
                  },
                ]
              : [],
          );

          // Rolldown 1.2.13 has no Rollup isExternal field. Its external edges have no
          // parsed module; retain those resolved IDs alongside emitted imports.
          for (const id of new Set([
            ...Arr.flatMap(modules, (m) => [...m.imports, ...m.dynamic]),
            ...Arr.flatMap(chunks, (c) => [...c.imports, ...c.dynamic]),
          ])) {
            if (!ids.has(id)) {
              modules.push({ id, imports: [], dynamic: [], external: true, code: "" });
            }
          }

          const assets = Arr.flatMap(Rec.values(output), (o) =>
            o.type === "asset" ? [typeof o.source === "string" ? o.source : new TextDecoder().decode(o.source)] : [],
          );

          observations.builds.push({ input: options.input, modules, chunks, assets });
        },
      };
      const plugins: Array<RolldownPluginOption> = Arr.isArray(options.plugins) ? options.plugins : [options.plugins];
      return real.rolldown({ ...options, plugins: [...plugins, observer] });
    },
  };
});

const options = { arbitrary: { seed: 119120, runs: runsFor({ fast: 3, full: 20 }), size: 128, concurrency: 1 } };

const names = (graph: Observed) => [
  ...Arr.flatMap(graph.modules, (m) => [m.id, ...m.imports, ...m.dynamic]),
  ...Arr.flatMap(graph.chunks, (c) => [...c.imports, ...c.dynamic, ...c.modules]),
];

const mcp = (id: string) =>
  /(?:^|[/\\])(?:@modelcontextprotocol(?:[/\\+]|$)|@kampus[/\\]libfabrika[/\\]mcp(?:[/\\]|$))|[/\\]libfabrika[/\\]src[/\\]mcp(?:[/.]|$)/i.test(
    id,
  );

const drawing = (id: string) =>
  /(?:^|[/\\])(?:micromark(?:[-/\\@]|$)|mdast(?:[-/\\@]|$)|@pierre(?:[/\\+]|$)|react(?:[-/\\@]|$)|(?:@kampus[/\\+])?tuval(?:[/\\@]|$))/i.test(
    id,
  );

const clean = (graph: Observed, forbidden: (id: string) => boolean) => {
  expect(graph.modules.length).toBeGreaterThan(0);
  expect(graph.chunks.length).toBeGreaterThan(0);
  expect(Arr.filter(names(graph), forbidden)).toEqual([]);
};

// libfabrika's one-file build: the brain imports its tables from this module, and each carried body
// is one text module. Rolldown keeps a text module's code as the JSON string of its text.
const TABLES = "\0virtual:fabrika-built";

const TEXT = "\0fabrika-text:";

const joined = (graph: Observed) =>
  pipe(
    graph.chunks,
    Arr.map((c) => c.code),
    Arr.join("\n"),
  );

const realBrain = (all: ReadonlyArray<Observed>) => {
  const found = Option.getOrThrowWith(
    Arr.findFirst(all, (b) => typeof b.input === "string" && pipe(b.input, Str.endsWith("/src/brain.ts"))),
    () => new Error("no actual P12 brain build observed"),
  );

  expect(Arr.some(found.modules, (m) => pipe(m.id, Str.endsWith("/src/brain.ts")))).toBe(true);
  expect(Arr.some(found.modules, (m) => m.id === TABLES)).toBe(true);

  return found;
};

const carried = (brain: Observed) =>
  pipe(
    brain.modules,
    Arr.filter((m) => pipe(m.id, Str.startsWith(TEXT))),
    Arr.map((m) => Schema.decodeSync(Schema.fromJsonString(Schema.String))(m.code)),
  );

// What one call emitted: a program's whole bundle, each window chunk and each window asset.
const emitted = (graph: Observed) => [joined(graph), ...Arr.map(graph.chunks, (c) => c.code), ...graph.assets];
const isProgram = (graph: Observed) => graph.input === "fabrika:program";

// P14 slice 1: a tab's own call, the one whose input is exactly the tab entry the build was given.
const tabCall = (entry: string | undefined) => (graph: Observed) => entry !== undefined && graph.input === entry;

// P14 slice 2: the entry the app's own build.ts passes as its tab.
const APP_TAB = new URL("../entry/browser.tsx", import.meta.url).pathname;

// The two routes a tab's call makes: its script, and the page it emits as an asset.
const TAB_ROUTES: ReadonlyArray<string> = ["/window.js", "/index.html"];

const isWindow = (graph: Observed) =>
  typeof graph.input === "object" &&
  graph.input !== null &&
  Arr.every(Object.values(graph.input), (v) => typeof v === "string" && pipe(v, Str.startsWith("fabrika:window:")));

// The whole build's check: every Rolldown call is clean, and every text the brain carries is the
// output of an observed program, window or tab call, so no carried script escapes its own graph's check.
const checkBuild = (all: ReadonlyArray<Observed>, built: Built, tab?: string) => {
  const brain = realBrain(all);
  const isTab = tabCall(tab);

  for (const graph of all) {
    clean(graph, mcp);
  }

  const texts = carried(brain),
    others = Arr.filter(all, (g) => g !== brain);
  expect(texts).toHaveLength(Rec.keys(built.programs).length + Rec.keys(built.assets).length);

  for (const text of texts) {
    expect(Arr.some(others, (g) => (isProgram(g) || isWindow(g) || isTab(g)) && emitted(g).includes(text))).toBe(true);
  }

  for (const program of Rec.values(built.programs)) {
    expect(texts).toContain(program.source);
    expect(Arr.some(others, (g) => isProgram(g) && joined(g) === program.source)).toBe(true);
  }

  for (const [route, asset] of Rec.toEntries(built.assets)) {
    expect(texts).toContain(asset.body);

    if (tab !== undefined && TAB_ROUTES.includes(route)) {
      // The tab's script and page come from the tab's own call and from no other.
      expect(Arr.some(others, (g) => isTab(g) && emitted(g).includes(asset.body))).toBe(true);
      expect(Arr.filter(others, (g) => !isTab(g) && emitted(g).includes(asset.body))).toEqual([]);
    } else {
      expect(Arr.some(others, (g) => isWindow(g) && emitted(g).includes(asset.body))).toBe(true);
    }
  }

  if (tab !== undefined) {
    expect(Arr.filter(all, isTab), "one observed call built the tab").toHaveLength(1);
    expect(Rec.keys(built.assets)).toEqual(expect.arrayContaining([...TAB_ROUTES]));
  }

  return brain;
};

it.effect(
  "scenario: the real one-file build's brain, programs and carried texts contain no MCP",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path;

      const folder = yield* fs.makeTempDirectoryScoped({ prefix: "p8-bytes-" });
      const start = observations.builds.length;
      const built = yield* build({ out: path.join(folder, "out") });

      // P14 slice 2 (ticket 828): the app's build selects its tab, `src/entry/browser.tsx`, so its build
      // carries the page and the tab's script, each from the tab's own observed call.
      const observed = observations.builds.slice(start),
        brain = checkBuild(observed, built, APP_TAB);
      expect(Rec.keys(built.assets)).toContain("/index.html");
      expect(Rec.keys(built.assets)).toContain("/window.js");
      process.stdout.write(
        `P14 tab: page ${new TextEncoder().encode(built.assets["/index.html"]?.body ?? "").byteLength} bytes; script ${new TextEncoder().encode(built.assets["/window.js"]?.body ?? "").byteLength} bytes\n`,
      );
      expect(Arr.filter(observed, isProgram)).toHaveLength(Rec.keys(built.programs).length);
      const bytes = yield* fs.readFileString(built.brain);
      expect(bytes).toBe(joined(brain));

      for (const [name, program] of Rec.toEntries(built.programs)) {
        process.stdout.write(`P8 program ${name}: ${new TextEncoder().encode(program.source).byteLength} bytes\n`);
      }

      const root = path.resolve(import.meta.dirname, "../../../../..");
      process.stdout.write(`P8 brain: ${new TextEncoder().encode(bytes).byteLength} bytes\n`);
      process.stdout.write(
        moduleReport(
          Arr.flatMap(observed, (g) =>
            Arr.map(g.modules, (m) => (path.isAbsolute(m.id) ? path.relative(root, m.id) : m.id)),
          ),
        ),
      );

      // Plant against the graph of this actual build, never against a substitute entry.
      const planted: Observed = {
        ...brain,
        modules: [
          ...brain.modules,
          {
            id: "@modelcontextprotocol/client/stdio",
            imports: [],
            dynamic: [],
            external: true,
            code: "",
          },
        ],
      };
      expect(() => checkBuild([...Arr.filter(observed, (g) => g !== brain), planted], built)).toThrow();
      expect(() => realBrain(Arr.filter(observed, (g) => g !== brain))).toThrow("no actual P12 brain");
      // A carried program whose own call went unobserved fails: its graph was never checked.
      expect(() =>
        checkBuild(
          Arr.filter(observed, (g) => !isProgram(g)),
          built,
        ),
      ).toThrow();
    }).pipe(Effect.provide(NodeServices.layer)),
  60_000,
);

// One selected program with a window, in a scoped folder: the real libfabrika build on the real app
// brain, with workspace packages linked in as libfabrika's own one-file test does.
const windowBuild = Effect.fnUntraced(function* (window: string, tab?: string) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;

  const home = yield* fs.makeTempDirectoryScoped({ prefix: "p8-win-" });
  const app = path.resolve(import.meta.dirname, "../..");

  const pkg = path.join(home, "programs/win"),
    sdk = path.join(home, "node_modules/@modelcontextprotocol/sdk");

  yield* fs.writeFileString(path.join(home, "package.json"), '{"type":"module"}');
  yield* fs.makeDirectory(path.join(home, "node_modules/@p8"), { recursive: true });
  yield* fs.makeDirectory(pkg, { recursive: true });
  yield* fs.makeDirectory(sdk, { recursive: true });

  for (const name of ["effect", "@demlik", "@kampus", "@alchemy.run", "alchemy"]) {
    yield* fs.symlink(path.join(app, "node_modules", name), path.join(home, "node_modules", name));
  }

  yield* fs.symlink(pkg, path.join(home, "node_modules/@p8/win"));
  yield* fs.writeFileString(
    path.join(pkg, "package.json"),
    Formatter.formatJson({
      name: "@p8/win",
      type: "module",
      exports: { ".": "./program.ts", "./window": "./window.ts" },
    }),
  );
  yield* fs.writeFileString(
    path.join(pkg, "program.ts"),
    `import {counter} from "@kampus/counter"; export const program = {...counter, name: "p8/win"};`,
  );
  yield* fs.writeFileString(path.join(pkg, "window.ts"), window);
  // A synthetic stand-in for the MCP SDK: only its package path matters to the check.
  yield* fs.writeFileString(
    path.join(sdk, "package.json"),
    Formatter.formatJson({ name: "@modelcontextprotocol/sdk", type: "module", exports: { "./client": "./client.js" } }),
  );
  yield* fs.writeFileString(path.join(sdk, "client.js"), `export const client = "p8-mcp-marker";`);
  yield* fs.copy(path.join(app, "src"), path.join(home, "src"));

  // P14 slice 1: an optional tab, its entry and one stylesheet, built by the same call.
  const entry = path.join(home, "tab/entry.ts"),
    style = path.join(home, "tab/tab.css");

  if (tab !== undefined) {
    yield* fs.makeDirectory(path.join(home, "tab"));
    yield* fs.writeFileString(entry, tab);
    yield* fs.writeFileString(style, "output { color: rgb(12, 34, 56); }");
  }

  const start = observations.builds.length;

  const built = yield* buildOne({
    out: path.join(home, "dist"),
    root: home,
    entry: path.join(home, "src/brain.ts"),
    programs: [{ name: "p8/win", package: "@p8/win", export: "program" }],
    files: [],
    ledger: [],
    chaos: false,
    ...(tab === undefined ? {} : { tab: { entry, styles: [style] } }),
  });

  return { built, observed: observations.builds.slice(start), entry };
});

it.effect(
  "scenario: a window script carried into the brain as text is checked by its own Rolldown call",
  () =>
    Effect.gen(function* () {
      const control = yield* windowBuild(`export const view = () => "p8-clean-window";`);
      const brain = checkBuild(control.observed, control.built);
      expect(Arr.filter(control.observed, isWindow)).toHaveLength(1);
      expect(Arr.some(Rec.values(control.built.assets), (a) => pipe(a.body, Str.includes("p8-clean-window")))).toBe(
        true,
      );
      expect(Arr.some(carried(brain), (t) => pipe(t, Str.includes("p8-clean-window")))).toBe(true);

      // Plant: the window imports the MCP SDK. The brain's own graph names only text modules, so
      // a brain-only check passes; the whole build's check must fail on the window's call.
      const planted = yield* windowBuild(
        `import {client} from "@modelcontextprotocol/sdk/client"; export const view = () => client;`,
      );

      const plantedBrain = realBrain(planted.observed);
      expect(Arr.some(carried(plantedBrain), (t) => pipe(t, Str.includes("p8-mcp-marker")))).toBe(true);
      expect(() => clean(plantedBrain, mcp)).not.toThrow();
      expect(() => checkBuild(planted.observed, planted.built)).toThrow();
      // Without the window call observed, a clean carried text has no checked origin and fails too.
      expect(() =>
        checkBuild(
          Arr.filter(control.observed, (g) => !isWindow(g)),
          control.built,
        ),
      ).toThrow();
    }).pipe(Effect.provide(NodeServices.layer)),
  60_000,
);

// P14 slice 1: a tab's script and page are observed bytes too. The tab's one Rolldown call compiles
// its entry and emits its page, so each carried tab text has that call as its checked origin, and
// no other call or a page made after the call stands in. Each sample is a real build, so 3 runs.
it.effect.prop(
  "a tab's carried script and page come from the tab's own observed call, beside the window's",
  { label: Schema.String.check(Schema.isMaxLength(40)) },
  ({ label }) =>
    Effect.gen(function* () {
      const tab = yield* windowBuild(
        `export const view = () => "p8-tab-window";`,
        `import {Effect} from "effect"; export const tab = Effect.succeed(${Formatter.formatJson(label)});`,
      );

      checkBuild(tab.observed, tab.built, tab.entry);
      const page = tab.built.assets["/index.html"];
      expect(page?.type).toBe("text/html; charset=utf-8");
      const call = Option.getOrThrow(Arr.findFirst(tab.observed, tabCall(tab.entry)));
      expect(call.assets, "the page is one of the tab call's own emitted assets").toContain(page!.body);
      expect(Arr.filter(tab.observed, isWindow)).toHaveLength(1);
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { ...options.arbitrary, runs: runsFor({ fast: 3, full: 3 }) } },
);

const int = (min: number, max: number) => Schema.Int.check(Schema.isBetween({ minimum: min, maximum: max }));

const BundleGraphs = Arbitrary.schema(
  Schema.Struct({
    modules: int(1, 8),
    depth: int(0, 3),
    imports: int(0, 2),
    text: Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(128)),
  }),
);

type BundleGraph = typeof BundleGraphs extends Arbitrary.Arbitrary<infer G> ? G : never;

// A module tree that has exactly g.modules modules and up to 2 imports per module. Its depth is g.depth when that
// many modules can reach it, else the nearest depth they can: one module has depth 0, 8 need depth 3 at 2 imports.
const graphShape = (g: BundleGraph) => {
  const capacity = (depth: number, fan: number) => (fan === 0 ? 1 : fan === 1 ? depth + 1 : 2 ** (depth + 1) - 1);
  let least = 0;

  while (capacity(least, 2) < g.modules) {
    least++;
  }

  const depth = Math.max(least, Math.min(g.depth, g.modules - 1));
  const fan = Option.getOrElse(
    Arr.findFirst([g.imports, 1, 2], (f) => capacity(depth, f) >= g.modules),
    () => 2,
  );
  const level = [0],
    children: Array<Array<number>> = [[]];

  for (let i = 1; i < g.modules; i++) {
    const parent =
      i <= depth
        ? i - 1
        : Option.getOrThrowWith(
            Arr.findFirstIndex(level, (l, j) => l < depth && (children[j]?.length ?? 0) < fan),
            () => new Error("graph shape has no room"),
          );

    level.push((level[parent] ?? 0) + 1);
    children.push([]);
    children[parent]?.push(i);
  }

  return { depth, fan, children, level };
};

it.prop(
  "checker controls: generated bundle graphs reach every module count 1 to 8 and depth 0 to 3",
  { g: BundleGraphs },
  ({ g }) => {
    const shape = graphShape(g);
    expect(shape.children).toHaveLength(g.modules);
    expect(Math.max(...shape.level)).toBe(shape.depth);
    expect(shape.depth).toBe(Math.max(Math.ceil(Math.log2(g.modules + 1)) - 1, Math.min(g.depth, g.modules - 1)));
    expect(Arr.every(shape.children, (c) => c.length <= Math.min(2, shape.fan))).toBe(true);
    expect(graphShape({ ...g, modules: 8, depth: 0 }).depth).toBe(3);
    expect(graphShape({ ...g, modules: 4, depth: 3 }).depth).toBe(3);
    expect(graphShape({ ...g, modules: 8, depth: 3 }).children).toHaveLength(8);
  },
  options,
);

// Finite styles all run on every generated graph, including wrapper and dynamic/external edges.
it.effect.prop(
  "checker controls: real Rolldown catches transitive, dynamic and external forbidden imports",
  { g: BundleGraphs },
  ({ g }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path;

      const folder = yield* fs.makeTempDirectoryScoped({ prefix: "p8-graph-" });

      for (const style of ["static", "dynamic", "external"] as const) {
        const start = observations.builds.length;

        const shape = graphShape(g),
          modules = g.modules;

        for (let i = 0; i < modules; i++) {
          const next = pipe(
            shape.children[i] ?? [],
            Arr.map((child) =>
              style === "dynamic"
                ? `export const next${child} = () => import("./m${child}.ts");`
                : `export {text as next${child}} from "./m${child}.ts";`,
            ),
            Arr.join("\n"),
          );
          yield* fs.writeFileString(
            path.join(folder, `m${i}.ts`),
            `export const text = ${Formatter.formatJson(g.text)}; ${next}`,
          );
        }

        yield* bundle(path.join(folder, "m0.ts"), []);
        const graph = observations.builds[start];

        if (graph === undefined) {
          return yield* Effect.die("observer did not see graph");
        }

        clean(graph, mcp);
        clean(graph, drawing);

        for (const forbidden of [
          "@modelcontextprotocol/client/stdio",
          "@kampus/libfabrika/mcp",
          "@kampus/libfabrika/mcp/client",
          `@kampus/libfabrika/mcp/${
            Arr.join(
              Array.from(g.text, (c) => pipe(c, Str.codePointAt(0), Option.getOrThrow).toString(16)),
              "-",
            ) || "serve"
          }/client`,
          "micromark/lib/parse",
          "mdast-util-from-markdown",
          "@pierre/highlights",
          "react/jsx-runtime",
          "@kampus/tuval",
        ]) {
          // The edge is deliberately external, so tree shaking cannot conceal its package name.
          const leaf = path.join(folder, `m${modules - 1}.ts`);
          yield* fs.writeFileString(
            leaf,
            `export const text = ${Formatter.formatJson(g.text)}; ${style === "dynamic" ? `export const bad = () => import(${Formatter.formatJson(forbidden)});` : `export * from ${Formatter.formatJson(forbidden)};`}`,
          );
          const n = observations.builds.length;
          yield* bundle(path.join(folder, "m0.ts"), [
            {
              name: "p8-forbidden-external",
              resolveId(id) {
                if (id === forbidden) {
                  return { id, external: true };
                }
              },
            },
          ]);
          const bad = observations.builds[n];

          if (bad === undefined) {
            return yield* Effect.die("no planted graph");
          }

          expect(() =>
            clean(
              bad,
              pipe(forbidden, Str.startsWith("@modelcontextprotocol")) ||
                pipe(forbidden, Str.startsWith("@kampus/libfabrika/mcp"))
                ? mcp
                : drawing,
            ),
          ).toThrow();
        }
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  options,
);
