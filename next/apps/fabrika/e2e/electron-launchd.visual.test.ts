// P19 L13, next/. No native work occurs without explicit host opt-in.
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Arbitrary, Array as Arr, Config, Effect, FileSystem, Option, Path, Formatter, Schema } from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess } from "effect/process";

import { expect } from "vitest";
import * as Guard from "./node/P19Guard.test-support.ts";
import * as Host from "./node/P19Launchd.test-support.ts";

// The host's opt-in and CI's marker, read through Config: an empty CI reads as unset, as before.
const host = Effect.runSync(
  Config.all({
    optIn: Config.String("FABRIKA_P19_HOST").pipe(Config.withDefault("")),
    ci: Config.option(Config.String("CI")),
  }),
);

const enabled = process.platform === "darwin" && host.optIn === "1" && Option.isNone(host.ci);

it.live("pinned: L13 bundles keep native dependencies resolvable outside root node_modules", () =>
  // Review found that pnpm's transitive native dependencies were absent from the root link.
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path;

      const home = yield* fs.makeTempDirectoryScoped({ prefix: "p19-bundle-" });
      const root = path.resolve(import.meta.dirname, "../../../..");
      const importer = path.join(home, "importer.mjs");
      const dependency = path.join(home, "native.cjs");
      yield* fs.writeFileString(dependency, "module.exports = 19;");
      // A local require-only dependency exercises the same original-importer resolution as .node files.
      yield* fs.makeDirectory(path.join(home, "node_modules/workerd"), { recursive: true });
      yield* fs.writeFileString(
        path.join(home, "node_modules/workerd/package.json"),
        Formatter.formatJson({ main: "../../native.cjs" }),
      );
      yield* fs.writeFileString(importer, 'export { default } from "workerd";');
      const output = path.join(home, "bundle.mjs");
      const files = yield* Host.bundle(`export { default } from ${Formatter.formatJson(importer)};`, output, root);
      expect(files).toHaveLength(1);
      expect(yield* fs.realPath(files[0]!)).toBe(yield* fs.realPath(dependency));
      expect(yield* fs.readFileString(output)).toContain(files[0]);

      // Compile the host entries without executing launchd, Electron or the local runtime.
      for (const [entry, name, modes] of [
        [path.resolve(import.meta.dirname, "node/P19Launchd.test-support.ts"), "controller", ["p19:controller"]],
        [path.resolve(import.meta.dirname, "node/P19Guard.test-support.ts"), "guard", ["p19:guard"]],
        [path.resolve(import.meta.dirname, "node/P19Brain.test-support.ts"), "brain", ["p19:brain"]],
      ] as const) {
        const compiled = path.join(home, `${name}.mjs`);
        // Bundled as check bundles them, by a bare import: an `export *` entry keeps a main the
        // treeshake rule would drop.
        const linked = yield* Host.bundle(`import ${Formatter.formatJson(entry)};`, compiled, root);
        expect(yield* fs.exists(compiled)).toBe(true);
        // The app's "sideEffects": false once emptied the helper's bundle, and its mains with it.
        // Each main is known by its dispatch, since check's own body also names the modes as argv.
        const text = yield* fs.readFileString(compiled);

        for (const mode of modes) {
          expect(text).toContain(`process.argv[2] === "${mode}"`);
        }

        for (const file of linked) {
          expect(yield* fs.exists(file)).toBe(true);
        }

        // A linked file is a symlink named by its basename: the real path says which package it is.
        const real = yield* Effect.forEach(linked, (file) => fs.realPath(file), { concurrency: 1 });

        if (name === "brain") {
          // The brain Electron starts carries the local instance, never the host check's bundler.
          expect(text).toContain("brain.localInstance");
          expect(Arr.filter(real, (file) => /rolldown/.test(file))).toEqual([]);
        }

        if (name === "guard") {
          // The guard has to start inside the host's wait for guard.ready (ticket 1167): it links no
          // compiler, so it loads none of the build addons it never uses.
          expect(Arr.filter(real, (file) => /rolldown|lightningcss|oxc-/.test(file))).toEqual([]);
        }
      }
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

// Plant (G2, run once and undone): make `ready` ignore the guard's exit, so a dead guard is a timeout;
// the law fails with the wait still pending. A guard that cannot read its config fails before it
// loads launchd or sends a signal, so this runs here and needs no host.
it.live.prop(
  "G2 (crash half): a guard that cannot read its config exits before ready, and the wait names its exit code at once",
  { text: Schema.String },
  ({ text }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem,
          path = yield* Path.Path;

        const home = yield* fs.makeTempDirectoryScoped({ prefix: "p19-guard-" });
        const root = path.resolve(import.meta.dirname, "../../../..");
        const guardFile = path.join(home, "guard.mjs");
        const config = path.join(home, "guard.json");

        yield* Host.bundle(
          `import ${Formatter.formatJson(path.resolve(import.meta.dirname, "node/P19Guard.test-support.ts"))};`,
          guardFile,
          root,
        );

        // No config file, and a generated one that is no guard config: both reached on every case.
        for (const contents of [null, text]) {
          yield* contents === null ? fs.remove(config, { force: true }) : fs.writeFileString(config, contents);

          const child = yield* ChildProcess.make(process.execPath, [guardFile, "p19:guard", config], {
            cwd: home,
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
          });

          // A wait that is long next to the guard's start: only the exit can end it in time.
          const failure = yield* Guard.ready(path.join(home, "guard.ready"), child.exitCode, 30_000).pipe(Effect.flip);
          expect(failure).toMatchObject({
            _tag: "HostError",
            reason: expect.stringMatching(/^guard-exited-[1-9]\d*$/),
          });
          expect(yield* fs.exists(path.join(home, "guard.ready"))).toBe(false);
        }
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 3, full: 10 }) } },
);

const Ms = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 120_000 }));

const G4Case = Schema.Struct({
  guardMs: Ms,
  run: Schema.Array(Schema.Struct({ phase: Host.Phase, ms: Ms })),
  stalled: Schema.Boolean,
});

const G4Runs = runsFor({ fast: 100, full: 100 });

// scenario: G4's coverage, the cases its generator draws at its own seed and count. A property that never
// begins a stalled phase, or never ends a start, a stop and the replacement, would pass on what it drew.
it.effect("scenario: G4's generator reaches a stalled phase and the end of a start, a stop and the replacement", () =>
  Effect.gen(function* () {
    const cases = yield* Arbitrary.sampleEffect(Arbitrary.schema(G4Case), { count: G4Runs, seed: 119120 });
    const phases = Arr.flatMap(cases, ({ run }) => run.map(({ phase }) => phase));
    expect(cases.some(({ run, stalled }) => stalled && run.length > 0)).toBe(true);
    expect(phases.some((phase) => phase.startsWith("start"))).toBe(true);
    expect(phases.some((phase) => phase.startsWith("stop"))).toBe(true);
    expect(phases).toContain("replacement");
    expect(phases).toContain("fixture");
  }),
);

// Plant (G4, run once and undone): `begin` and `end` write nothing and `done` alone writes the file, so
// the record is there only at the end; the file after the first begin is missing and the law fails.
it.effect.prop(
  "G4: after every begin and end the host record names the phase in progress or none, holds each finished phase's time in order, and keeps guardMs",
  G4Case.fields,
  ({ guardMs, run, stalled }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path;

      const home = yield* fs.makeTempDirectoryScoped({ prefix: "p19-phases-" });
      const file = path.join(home, "runs/p19/host.json");
      const progress = yield* Host.phases(file, guardMs);

      const read = fs
        .readFileString(file)
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Host.Progress))));

      const model: { starts: Array<number>; stops: Array<number>; replacementMs: number } = {
        starts: [],
        stops: [],
        replacementMs: 0,
      };

      for (const [n, { phase, ms }] of run.entries()) {
        yield* progress.begin(phase);
        expect(yield* read).toEqual({ guardMs, phase, ...model });

        if (stalled && n === run.length - 1) {
          break;
        }

        yield* progress.end(ms);

        if (phase.startsWith("start")) {
          model.starts = [...model.starts, ms];
        } else if (phase.startsWith("stop")) {
          model.stops = [...model.stops, ms];
        } else if (phase === "replacement") {
          model.replacementMs = ms;
        }

        expect(yield* read).toEqual({ guardMs, phase: null, ...model });
      }

      if (!stalled) {
        // The final record names no phase and keeps the rest it is given.
        const final = yield* progress.done({ groups: [1] });
        expect(final).toEqual({ guardMs, phase: null, ...model });
        const written = yield* fs
          .readFileString(file)
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.fromJsonString(Schema.Struct({ groups: Schema.Array(Schema.Int), phase: Schema.Null })),
              ),
            ),
          );
        expect(written).toEqual({ groups: [1], phase: null });
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { seed: 119120, runs: G4Runs } },
);

it.live.skipIf(!enabled)(
  "scenario: L13 unsigned Electron's real brain survives controller death, restarts and fully stops",
  () =>
    Effect.gen(function* () {
      // launchd, Electron's bundled Node and detached process cleanup require a GUI-domain Mac.
      // A skipped run is not L13 evidence. The host lead records readings under runs/.
      const result = yield* Effect.scoped(Host.check()).pipe(
        Effect.provide([NodeServices.layer, Digest.layerWebCrypto]),
      );

      // G2, host half (lead runs it on host.yaml): the guard's start is recorded, ready or not. The
      // plant for the exit half is a guard that exits 3 before ready: the check then fails with
      // `guard-exited-3` in well under the stop timeout, and this law never reaches here.
      expect(Number.isInteger(result.guardMs) && result.guardMs >= 0).toBe(true);
      const recorded = yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem,
          path = yield* Path.Path;

        return yield* fs
          .readFileString(path.resolve(import.meta.dirname, "../../../../runs/p19/host.json"))
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Host.Progress))));
      }).pipe(Effect.provide(NodeServices.layer));

      expect(recorded.guardMs).toBe(result.guardMs);
      // G4's other half: a passing run's final record names no phase in progress, and holds its starts.
      expect(recorded.phase).toBeNull();
      expect(recorded.starts).toEqual(result.starts);
      expect(result.starts).toHaveLength(4);
      expect(result.replacement).toBe(true);
      expect(result.controllerDeath).toBe(true);
      expect(result.normalExit).toBe(true);
      expect(result.leftovers).toEqual([]);
    }),
);
