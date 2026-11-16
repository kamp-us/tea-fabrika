// Ticket 1101, the box-memory ticket: our patched @demlik/code-graph reports the real error when its
// TypeScript API child dies mid-run (finding 2026-11-16-ts-api-epipe-hides-the-oom-kill). The box's
// memory cgroup kills the child; the next request fails with the child's EOF, and code-graph's close
// then disposed its live snapshots on the dead pipe (0.15.0 dist/chunk-3EVT6XKY.js:84, the close
// `pnpm lint:dead` reaches through dist/index.js:9314), so their EPIPE replaced the EOF and the
// server was never killed. A test, not lint or type: what is held is an order of failures at run
// time in a dependency's code, which no shape check or type of ours can see.
//
// The laws run code-graph's own public entries, `./resolve` and `./api`, on a stand-in for the
// sync TypeScript API it imports (`@typescript/native-preview/unstable/sync`), put in its place for
// code-graph's files only by a Node module hook. No API child starts and no signal is sent. The
// stand-in answers the requests code-graph makes before its kill point; at the kill point, and at
// any request it has no answer for, the child dies with the EOF. After that, every request fails
// with EPIPE, as a write to the dead child's stdin does
// (@typescript/native-preview 7.0.0-dev.20260707.2 dist/api/syncChannel.js:495).
//
// `./api` emits declarations with the real tsgo binary into code-graph's own temp folder, so that
// law spawns one compiler per run, on a one-file package planted in a temp folder: its runs are few.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { afterAll, expect, it } from "vitest";

/** One run's stand-in child: where it dies, the errors it dies with, and what it was asked. */
type Script = {
  readonly killAt: number;
  readonly kill: Error;
  readonly pipe: (request: string) => Error;
  readonly closeFails: boolean;
  readonly answered: Array<string>;
  killedAt: string | null;
  kills: number;
};

let script: Script | null = null;

const current = (): Script => {
  if (script === null) {
    throw new Error("the stand-in TypeScript API was used outside a law");
  }

  return script;
};

/** The requests the stand-in can answer before its kill point, with a plausible answer each. */
const ANSWERS: Readonly<Record<string, () => unknown>> = {
  parseConfigFile: () => ({ fileNames: [] }),
  "program.getCompilerOptions": () => ({}),
  "program.getSourceFileNames": () => [],
  release: () => undefined,
};

/** One request to the stand-in child: answered, the kill, or EPIPE once the child is dead. */
const request = (name: string, answer: (() => unknown) | undefined): unknown => {
  const s = current();

  if (s.killedAt !== null) {
    throw s.pipe(name);
  }

  if (answer === undefined || s.answered.length === s.killAt) {
    s.killedAt = name;
    throw s.kill;
  }

  s.answered.push(name);
  return answer();
};

/** A checker or program handle: each method is one request, named `<handle>.<method>`. */
const handle = (of: string) =>
  new Proxy(
    {},
    {
      get: (_, key) =>
        typeof key === "string"
          ? (..._args: ReadonlyArray<unknown>) => request(`${of}.${key}`, ANSWERS[`${of}.${key}`])
          : undefined,
    },
  );

class StandInSnapshot {
  disposed = false;
  constructor(private readonly active: Set<StandInSnapshot>) {}

  getProject() {
    return { checker: handle("checker"), program: handle("program") };
  }

  getProjects() {
    return [this.getProject()];
  }

  // As the real Snapshot.dispose (typescript 7.0.2 dist/api/sync/api.js:186-196): marked first, then
  // the `release` request.
  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.active.delete(this);
    request("release", ANSWERS["release"]);
  }
}

class StandInAPI {
  readonly active = new Set<StandInSnapshot>();
  readonly client = { channel: { child: { kill: () => void current().kills++ } } };

  parseConfigFile() {
    return request("parseConfigFile", ANSWERS["parseConfigFile"]);
  }

  updateSnapshot(params: { readonly openProjects?: ReadonlyArray<string> }) {
    const opens = params.openProjects !== undefined;
    request(opens ? "updateSnapshot" : "updateSnapshot.close", () => undefined);
    const snapshot = new StandInSnapshot(this.active);

    if (opens) {
      this.active.add(snapshot);
    }

    return snapshot;
  }

  // As the real API.close: every active snapshot is disposed, then the channel closes.
  close() {
    for (const snapshot of [...this.active]) {
      snapshot.dispose();
    }

    const s = current();

    if (s.closeFails && s.killedAt !== null) {
      throw s.pipe("close");
    }
  }
}

const SLOT = Symbol.for("tea-fabrika/code-graph-close/stand-in");
Object.defineProperty(globalThis, SLOT, { value: { API: StandInAPI, SymbolFlags: {} } });

const STAND_IN = `data:text/javascript,${encodeURIComponent(
  `const s = globalThis[Symbol.for(${JSON.stringify(SLOT.description)})]; export const API = s.API; export const SymbolFlags = s.SymbolFlags;`,
)}`;

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === "@typescript/native-preview/unstable/sync" && context.parentURL?.includes("/@demlik/code-graph/")
      ? { url: STAND_IN, shortCircuit: true }
      : next(specifier, context),
});

const { loadInProcessGraph } = await import("@demlik/code-graph/resolve");
const { readPublishedApi } = await import("@demlik/code-graph/api");

const home = mkdtempSync(join(tmpdir(), "code-graph-close-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

/** A one-file package code-graph can read the API of: its exports map names `src/index.ts`. */
const plant = () => {
  const root = mkdtempSync(join(home, "package-"));
  const files: Readonly<Record<string, string>> = {
    "package.json": JSON.stringify({ name: "plant", type: "module", exports: { ".": "./src/index.ts" } }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, module: "nodenext", target: "es2022", types: [] },
      include: ["src"],
    }),
    "src/index.ts": "export const x = 1;\n",
  };

  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }

  return root;
};

/** A generated case: a made-up word that marks each error, and whether the channel's close fails. */
const cases = fc.record({ token: fc.stringMatching(/^[a-z0-9]{1,12}$/), closeFails: fc.boolean() });

const scriptFor = (killAt: number, c: { readonly token: string; readonly closeFails: boolean }): Script => ({
  killAt,
  kill: new Error(`Unexpected EOF while reading from child process (killed by signal SIGKILL) ${c.token}`),
  pipe: (name) => Object.assign(new Error(`EPIPE: broken pipe, write (${name}) ${c.token}`), { code: "EPIPE" }),
  closeFails: c.closeFails,
  answered: [],
  killedAt: null,
  kills: 0,
});

/** What a call threw, or `null` when it returned. */
const thrown = (f: () => unknown): unknown => {
  try {
    f();
    return null;
  } catch (error) {
    return error;
  }
};

// Plant: in the patched dist/chunk-3EVT6XKY.js, put the old program close back (`snapshot.dispose()`
// with nothing around it), and the old session close (dispose every live snapshot, then kill).
it("a killed API child fails code-graph's ./resolve reads with the kill, and dispose still kills the server", () => {
  fc.assert(
    fc.property(cases, (c) => {
      const killedAt: Array<string> = [];

      // Every kill point the read reaches, in every case, so each is met whatever the run count.
      for (let killAt = 0; killAt < 4; killAt++) {
        script = scriptFor(killAt, c);
        const graph = loadInProcessGraph(import.meta.dirname);
        expect(graph).not.toBeNull();
        // The read reports the kill, never a release's EPIPE.
        expect(thrown(() => graph?.resolveModuleExport(import.meta.filename, "x"))).toBe(script.kill);
        // A release's own failure is logged or dropped; the server is still killed, once.
        expect(thrown(() => graph?.dispose())).toBeNull();
        expect(script.kills).toBe(1);
        killedAt.push(script.killedAt ?? "none");
      }

      // Coverage: the child died at four different requests, the last of them inside the read.
      expect(new Set(killedAt).size).toBe(4);
      expect(Object.keys(ANSWERS)).not.toContain(killedAt.at(-1));
    }),
    { seed: 119120, numRuns: 20 },
  );
  script = null;
});

// Plant: in the patched dist/chunk-3EVT6XKY.js, put the old session close back: `for (const snapshot
// of live) snapshot.dispose();` before `killServer(api)`, with nothing around it.
it("a killed API child fails code-graph's ./api read with the kill, and its close still kills the server", async () => {
  const root = plant();
  await fc.assert(
    fc.asyncProperty(cases, async (c) => {
      const killedAt: Array<string> = [];

      // Every kill point of the read, as above: the session close is the one `lint:dead` reaches.
      for (let killAt = 0; killAt < 5; killAt++) {
        script = scriptFor(killAt, c);
        const read = await readPublishedApi(
          root,
          { ".": { entry: "src/index.ts" } },
          { repoRoot: root, warn: () => {} },
        ).then(
          () => null,
          (error: unknown) => error,
        );
        expect(read).toBe(script.kill);
        expect(script.kills).toBe(1);
        killedAt.push(script.killedAt ?? "none");
      }

      expect(new Set(killedAt).size).toBe(5);
      expect(Object.keys(ANSWERS)).not.toContain(killedAt.at(-1));
    }),
    { seed: 119120, numRuns: 3 },
  );
  script = null;
});
