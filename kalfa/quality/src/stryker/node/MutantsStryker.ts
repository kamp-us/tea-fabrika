// `Mutants` on StrykerJS 10.1.1: its instrumenter for the mutants of a file, and its own bin, run
// in the repo's folder, for a run. Stryker is loaded here and nowhere else, so importing
// `@kalfa/quality/stryker` loads none of it (law Q15).
//
// Stryker's own TypeScript checker reads TypeScript's JavaScript API, which TypeScript 7 does not
// have, so `Options.ts` points its tsconfig at a file that is not there. The run is `nice -n <nice>`
// when a nice is set, a child process in the layer's scope, so the scope ends it and what it started.
import { Console, Effect, FileSystem, Layer, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Mutants } from "../Mutants.ts";
import { Refused, Report } from "../Report.ts";

const stuck = () => new Refused({ reason: "could_not_run", at: [] });

const quiet = () => {};

/** The instrumenter's logger: it says nothing. */
const logger = {
  trace: quiet,
  debug: quiet,
  info: quiet,
  warn: quiet,
  error: quiet,
  fatal: quiet,
  isTraceEnabled: () => false,
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => false,
  isErrorEnabled: () => false,
  isFatalEnabled: () => false,
};

// Edge (a Promise API, marked as `next/` marks one): the instrumenter loads on first use, so importing the package loads no Stryker
const load = () => import("@stryker-mutator/instrumenter");

/** Every mutant the instrumenter makes on `text`, none left out by a range, an ignorer or an exclusion. */
const instrument = (file: string, text: string) =>
  // Edge (a Promise API, marked as `next/` marks one): the instrumenter's own call returns a Promise
  Effect.tryPromise({
    try: () =>
      load().then(({ Instrumenter }) =>
        new Instrumenter(logger).instrument([{ name: file, content: text, mutate: true }], {
          plugins: null,
          excludedMutations: [],
          ignorers: [],
        }),
      ),
    catch: stuck,
  }).pipe(Effect.map(({ mutants }) => mutants));

/** The real `Mutants`, running Stryker with `root` as its working folder. */
export const layer = (where: { readonly root: string; readonly nice: number }) =>
  Layer.effect(
    Mutants,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const from = (specifier: string) => path.fromFileUrl(new URL(import.meta.resolve(specifier)));
      const plugin = yield* from("@stryker-mutator/vitest-runner").pipe(Effect.orDie);
      // The bin is not among the package's exports; its package.json is.
      const core = yield* from("@stryker-mutator/core/package.json").pipe(Effect.orDie);
      const bin = path.join(path.dirname(core), "bin", "stryker.js");

      const command = (config: string) =>
        ChildProcess.make(
          ...(where.nice === 0
            ? (["node", [bin, "run", config]] as const)
            : (["nice", ["-n", String(where.nice), "node", bin, "run", config]] as const)),
          { cwd: where.root, extendEnv: true, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
        );

      return {
        plugin,
        make: (file, text) =>
          instrument(file, text).pipe(
            Effect.map((mutants) =>
              mutants.map(({ mutatorName, replacement, location }) => ({ mutatorName, replacement, location })),
            ),
          ),
        run: (options) =>
          Effect.gen(function* () {
            const config = path.join(path.dirname(options.jsonReporter.fileName), "stryker.json");

            yield* fs.writeFileString(config, JSON.stringify(options));

            const handle = yield* spawner.spawn(command(config));

            // Stryker's own words go to stderr, so a run that fails says why and stdout keeps the record line.
            yield* handle.all.pipe(
              Stream.decodeText(),
              Stream.splitLines,
              Stream.runForEach((line) => Console.error(line)),
            );
            yield* handle.exitCode;

            const text = yield* fs.readFileString(options.jsonReporter.fileName);

            return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Report))(text);
          }).pipe(Effect.scoped, Effect.mapError(stuck)),
      };
    }),
  );
