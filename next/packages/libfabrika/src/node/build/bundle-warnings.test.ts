// Ticket 1067, the mock sweep's app-e2e slice, next/. Law L1: `bundle` prints Rolldown's warnings
// through Effect's `Console` service, so a law reads them with `TestConsole` and no spy (0555, 0579).
// Builder contract: `bundle.ts`'s `onLog` prints each kept log itself, with `Console.warn` for a
// warning, in Rolldown's own format: `(<plugin> plugin) `, then `<file> (<line>:<column>) `, then
// the message, every file name relative to `cwd`. A `MODULE_LEVEL_DIRECTIVE` log prints nothing.
// It runs the real Rolldown in this process, the one place 0555 lets a law reach it. Its files come
// from a plugin, so it writes no disk and starts nothing, and it runs on every pull request (0584).
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Layer, Path, Schema } from "effect";
import { TestConsole } from "effect/testing";
import type { LogLevel, Plugin, RolldownLog } from "rolldown";
import { bundle } from "./bundle.ts";

/** L17's own shapes, as Schemas: a project folder name and a missing package's name. */
const WarningCase = {
  folder: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9 -]{1,24}$/)),
  missing: Schema.String.check(Schema.isPattern(/^[a-z]{4,16}$/)),
  // Which of the two files says "use client"; the other does not, so every case drops one.
  directive: Schema.Literals(["entry", "imported"]),
};

const PLUGIN = "l1-files";

/** Every spelling of an absolute path a printed line could leak. */
const forms = (absolute: string) => [absolute, JSON.stringify(absolute).slice(1, -1), encodeURIComponent(absolute)];

describe("T1067 L1: bundle prints Rolldown's warnings through Console", () => {
  // Plant 1: print `log.message` before the relative replacement: L1 red, a line holds the home.
  // Plant 2: print through the global `console.warn`: L1 red, no line is seen.
  it.effect.prop(
    "L1 each warning is printed once through Console.warn, in Rolldown's format, with files relative to cwd",
    WarningCase,
    ({ folder, missing, directive }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        // A root that exists nowhere: the plugin serves every file, and an absolute path is easy to see.
        const home = `/fabrika-l1-${missing}`;
        const root = path.join(home, folder);
        const entry = path.join(root, "brain.ts");
        const imported = path.join(home, "dependency", "imported.ts");
        const specifiers = [`l1-missing-${missing}`, `l1-dependency-${missing}`];
        const use = (file: "entry" | "imported") => (directive === file ? '"use client";\n' : "");
        const files: Readonly<Record<string, string>> = {
          [entry]: `${use("entry")}import ${JSON.stringify(specifiers[0])};\nimport "../dependency/imported.ts";\nexport const a = 1;\n`,
          [imported]: `${use("imported")}import ${JSON.stringify(specifiers[1])};\nexport const b = 2;\n`,
        };
        // What Rolldown logged before bundle's onLog saw it: the law's own count, never the product's.
        const raw: Array<{ readonly level: LogLevel; readonly code: string | undefined }> = [];
        const served: Plugin = {
          name: PLUGIN,
          resolveId: (id, importer) =>
            id in files
              ? id
              : id.startsWith(".") && importer !== undefined
                ? path.resolve(path.dirname(importer), id)
                : null,
          load: (id) => files[id] ?? null,
          transform(_code, id) {
            if (id === imported) {
              // A plugin's own warning, naming the module by its absolute id, as a plugin may. Rolldown
              // tags it with that id and prints it with the plugin's name first; it does not make the
              // message relative, so only bundle's own replacement keeps the home out.
              this.warn(`served ${id}`);
            }

            return null;
          },
          onLog: (level: LogLevel, log: RolldownLog) => {
            raw.push({ level, code: log.code });
          },
        };

        yield* bundle(entry, [served], { cwd: root });
        const warned = yield* TestConsole.warnLines;
        const logged = yield* TestConsole.logLines;
        const errored = yield* TestConsole.errorLines;

        // Coverage, loud: this case really reached a dropped directive, both unresolved imports and
        // the plugin's own warning, which a plugin's onLog hook sees too.
        expect(raw.filter((log) => log.code === "MODULE_LEVEL_DIRECTIVE")).toHaveLength(1);
        expect(raw.filter((log) => log.code === "UNRESOLVED_IMPORT")).toHaveLength(2);
        expect(raw.filter((log) => log.code === "PLUGIN_WARNING")).toHaveLength(1);

        // Once each: every warning Rolldown logged, less the directive, is one Console.warn call.
        const kept = raw.filter((log) => log.level === "warn" && log.code !== "MODULE_LEVEL_DIRECTIVE").length;
        expect(warned, "one Console.warn line per kept warning").toHaveLength(kept);
        expect(logged, "nothing goes to Console.log").toEqual([]);
        expect(errored, "nothing goes to Console.error").toEqual([]);
        const lines = warned.map(String);

        for (const form of forms(home)) {
          expect(
            lines.some((line) => line.includes(form)),
            "a printed warning holds an absolute path",
          ).toBe(false);
        }

        // format: Rolldown's printed shape, which a person reads in the terminal and must not change.
        for (const [specifier, importer] of [
          [specifiers[0], entry],
          [specifiers[1], imported],
        ] as const) {
          const named = lines.filter((line) => line.includes(specifier));
          expect(named, `one line names ${specifier}`).toHaveLength(1);
          const relative = path.relative(root, importer);
          expect(named[0]?.startsWith(`${relative} (`), "the line starts with its importer, relative to cwd").toBe(
            true,
          );
          expect(named[0]?.includes(relative), "the warning names its importer relative to cwd").toBe(true);
        }

        expect(
          lines.filter(
            (line) =>
              line.startsWith(`(${PLUGIN} plugin) `) && line.includes(`served ${path.relative(root, imported)}`),
          ),
          "a plugin's warning starts with its name",
        ).toHaveLength(1);
      }).pipe(Effect.provide(Layer.mergeAll(TestConsole.layer, Path.layer))),
    { arbitrary: { seed: 119120, runs: runsFor({ fast: 20, full: 100 }) } },
  );
});
