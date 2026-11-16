// Today's CSS check always uses the root config and tracked files, ignoring nested settings.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { devNull } from "node:os";
import { join, relative } from "node:path";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import stylelint from "stylelint";
import type { CssResult } from "./css-support.ts";

const ROOT = process.cwd();
const configFile = join(ROOT, "stylelint.config.ts");

const tracked = spawnSync("git", ["ls-files", "-z", "--", "apps", "packages", "programs", "next"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 2 ** 30,
});

/** Stylelint threw, or answered in a shape this check does not read: the run did not finish. */
class Unfinished extends Schema.TaggedError<Unfinished>()("Unfinished", { cause: Schema.Defect() }) {}

/** Stylelint's own call, with what it rejects with kept as the cause. */
const attempt = <A>(call: () => Promise<A>) =>
  Effect.tryPromise({ try: call, catch: (cause) => new Unfinished({ cause }) });

/** Lints every tracked CSS file and answers the exit code; a run that did not finish says why. */
const check = (files: readonly string[]) =>
  Effect.gen(function* () {
    // `code` avoids glob expansion; the empty ignore file prevents .stylelintignore taking effect.
    const config = yield* attempt(() => stylelint.resolveConfig(join(ROOT, files[0] ?? ""), { configFile }));

    if (config === undefined) {
      return yield* new Unfinished({ cause: new Error("No stylelint config") });
    }

    const counts = new Map<string, { fires: number; known: Set<string> }>();

    for (const rule of Object.keys(config.rules ?? {})) {
      if (rule.startsWith("fabrika/")) {
        counts.set(rule, { fires: 0, known: new Set() });
      }
    }

    let blocks = 0;

    for (const file of files) {
      const code = yield* attempt(() => readFile(join(ROOT, file), "utf8"));
      const report = yield* attempt(() =>
        stylelint.lint({
          code,
          codeFilename: join(ROOT, file),
          configFile,
          ignorePath: devNull,
          ignoreDisables: false,
        }),
      );

      if (report.results.length !== 1) {
        return yield* new Unfinished({ cause: new Error(`No stylelint result for ${file}`) });
      }

      for (const result of report.results) {
        for (const warning of [...result.warnings, ...result.parseErrors, ...result.invalidOptionWarnings]) {
          const line = "line" in warning ? warning.line : 1;
          const column = "column" in warning ? warning.column : 1;
          const rule = "rule" in warning ? warning.rule : "stylelint";
          yield* Console.error(`${file}:${line}:${column} ${rule} ${warning.text}`);
          blocks++;
        }

        const postcss: CssResult | undefined = result._postcssResult;

        for (const [rule, hits] of postcss?.fabrika ?? []) {
          const total = counts.get(rule);

          if (total === undefined) {
            return yield* new Unfinished({ cause: new Error(`Unconfigured CSS rule ${rule}`) });
          }

          total.fires += hits.fires;

          for (const entry of hits.known) {
            total.known.add(entry);
          }
        }
      }

      if (
        report.errored &&
        report.results.every(
          (result) =>
            result.warnings.length === 0 &&
            result.parseErrors.length === 0 &&
            result.invalidOptionWarnings.length === 0,
        )
      ) {
        yield* Console.error(`${file}: stylelint failed without a diagnostic`);
        blocks++;
      }
    }

    for (const [rule, hits] of counts) {
      const setting = config.rules?.[rule];
      const known: unknown = Array.isArray(setting) ? setting[1]?.known : undefined;

      if (!Array.isArray(known)) {
        return yield* new Unfinished({ cause: new Error(`${rule} needs its known list`) });
      }

      for (const entry of known) {
        if (!hits.known.has(entry)) {
          yield* Console.error(`${rule}: stale known entry ${entry}`);
          blocks++;
        }
      }

      yield* Console.log(`${rule}: ${hits.fires} fires, ${hits.known.size} known entries`);
    }

    yield* Console.log(`stylelint: ${files.length} files, ${blocks} blocking`);
    return blocks === 0 ? 0 : 1;
  }).pipe(
    Effect.catch((error) =>
      Console.error(`stylelint did not finish in ${relative(ROOT, configFile)}: ${String(error.cause)}`).pipe(
        Effect.as(2),
      ),
    ),
  );

/** The run: git's list of tracked CSS, then the check over it. */
const main = Effect.gen(function* () {
  if (tracked.status !== 0) {
    yield* Console.error(`stylelint could not list tracked CSS: ${tracked.stderr}`);
    return 2;
  }

  const files = tracked.stdout.split("\0").filter((path) => path.endsWith(".css"));

  if (files.length === 0) {
    yield* Console.error("stylelint: no tracked CSS files");
    return 2;
  }

  return yield* check(files);
});

process.exitCode = await Effect.runPromise(main);
