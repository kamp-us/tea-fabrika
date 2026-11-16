// Ticket 1067, the mock sweep's app-e2e slice, next/. Law L1: `bundle` prints Rolldown's warnings
// through Effect's `Console` service, so a law reads them with `TestConsole` and no spy (0555, 0579).
// Builder contract: `bundle.ts`'s `onLog` prints each kept log itself, with `Console.warn` for a
// warning, in Rolldown's own format: `(<plugin> plugin) `, then `<file> (<line>:<column>) `, then
// the message, every file name relative to `cwd`. A `MODULE_LEVEL_DIRECTIVE` log prints nothing.
// It runs the real Rolldown in this process, the one place 0555 lets a law reach it. Its files come
// from a plugin, so it writes no disk and starts nothing, and it runs on every pull request (0584).
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as TestConsole from "effect/testing/TestConsole";
import type { LogLevel, Plugin, RolldownLog } from "rolldown";
import { bundle } from "./bundle.ts";

/** L17's own shapes, as Schemas: a project folder name and a missing package's name. */
const WarningCase = {
  folder: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9 -]{1,24}$/)),
  missing: Schema.String.check(Schema.isPattern(/^[a-z]{4,16}$/)),
  // Which of the two files says "use client"; the other does not, so every case drops one.
  directive: Schema.Literals(["entry", "imported"]),
  // Blank lines above each file's code and spaces before each import, so the line and the column of
  // every warning move from case to case. A line is at most 5 and a column at least 8, so the two
  // never match and a printer that swaps them shows.
  pad: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
  indent: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 6 })),
};

const PLUGIN = "l1-files";

/** Every spelling of an absolute path a printed line could leak. */
const forms = (absolute: string) => [absolute, JSON.stringify(absolute).slice(1, -1), encodeURIComponent(absolute)];

describe("T1067 L1: bundle prints Rolldown's warnings through Console", () => {
  // Plant 1: print `log.message` before the relative replacement: L1 red, a line holds the home.
  // Plant 2: print through the global `console.warn`: L1 red, no line is seen.
  // Plant 3: keep `MODULE_LEVEL_DIRECTIVE`: red. Plant 4: print every level through `info`: red.
  // Plant 5: drop the `(<plugin> plugin) ` prefix: red. Plant 6: print the place as
  // `(<column>:<line>)`: red, the line no longer starts with Rolldown's own place.
  it.effect.prop(
    "L1 each warning is printed once through Console.warn, in Rolldown's format, with files relative to cwd",
    WarningCase,
    ({ folder, missing, directive, pad, indent }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        // A root that exists nowhere: the plugin serves every file, and an absolute path is easy to see.
        const home = `/fabrika-l1-${missing}`;
        const root = path.join(home, folder);
        const entry = path.join(root, "brain.ts");
        const imported = path.join(home, "dependency", "imported.ts");
        const entrySpecifier = `l1-missing-${missing}`;
        const importedSpecifier = `l1-dependency-${missing}`;
        const use = (file: "entry" | "imported") => (directive === file ? '"use client";\n' : "");
        const top = "\n".repeat(pad);
        const space = " ".repeat(indent);
        const files: Readonly<Record<string, string>> = {
          [entry]: `${top}${use("entry")}${space}import ${JSON.stringify(entrySpecifier)};\nimport "../dependency/imported.ts";\nexport const a = 1;\n`,
          [imported]: `${top}${use("imported")}${space}import ${JSON.stringify(importedSpecifier)};\nexport const b = 2;\n`,
        };
        // Where the plugin's own warning points: the imported file's missing specifier.
        const position = { line: 1 + pad + (directive === "imported" ? 1 : 0), column: indent + 7 };
        // What Rolldown logged before bundle's onLog saw it: the law's own record, never the product's.
        const raw: Array<{
          readonly level: LogLevel;
          readonly code: string | undefined;
          readonly message: string;
          readonly plugin: string | undefined;
          readonly loc: RolldownLog["loc"];
        }> = [];
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
              this.warn(`served ${id}`, position);
            }

            return null;
          },
          onLog: (level: LogLevel, log: RolldownLog) => {
            raw.push({ level, code: log.code, message: log.message, plugin: log.plugin, loc: log.loc });
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

        // format: Rolldown's printed shape, which a person reads in the terminal and must not change:
        // `(<plugin> plugin) `, where the log has a plugin, then `<file> (<line>:<column>) `, with
        // that log's own numbers and its file relative to cwd, then the message.
        const place = (log: (typeof raw)[number], importer: string) => {
          expect(log.loc, `Rolldown gave the ${log.code} log a place`).toBeDefined();
          expect(log.loc?.file, `the ${log.code} log's place names its importer`).toBe(importer);
          // Coverage, loud: a case whose line equals its column could not catch a swap.
          expect(log.loc?.line, `the ${log.code} log's line differs from its column`).not.toBe(log.loc?.column);
          const plugin = log.plugin === undefined ? "" : `(${log.plugin} plugin) `;
          return `${plugin}${path.relative(root, importer)} (${log.loc?.line}:${log.loc?.column}) `;
        };

        for (const [specifier, importer] of [
          [entrySpecifier, entry],
          [importedSpecifier, imported],
        ] as const) {
          const named = lines.filter((line) => line.includes(specifier));
          expect(named, `one line names ${specifier}`).toHaveLength(1);
          const logs = raw.filter((log) => log.code === "UNRESOLVED_IMPORT" && log.message.includes(specifier));
          expect(logs, `Rolldown logged ${specifier} once`).toHaveLength(1);
          const [log] = logs;

          if (log !== undefined) {
            expect(named[0]?.startsWith(place(log, importer)), "the line starts with Rolldown's own place").toBe(true);
          }
        }

        const [warning] = raw.filter((log) => log.code === "PLUGIN_WARNING");

        if (warning !== undefined) {
          expect(warning.plugin, "the plugin's warning names its plugin").toBe(PLUGIN);
          expect(
            lines.filter(
              (line) =>
                line.startsWith(place(warning, imported)) && line.includes(`served ${path.relative(root, imported)}`),
            ),
            "a plugin's warning starts with its name, then Rolldown's own place",
          ).toHaveLength(1);
        }
      }).pipe(Effect.provide(Layer.mergeAll(TestConsole.layer, Path.layer))),
    { arbitrary: { seed: 119120, runs: runsFor({ fast: 20, full: 100 }) } },
  );
});
