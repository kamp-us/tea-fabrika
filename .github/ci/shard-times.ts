// Today's CI. Advice only: measured seconds are not a reason to fail a test job.
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { measured } from "../../vitest.shards.ts";

export const LIMIT = 60;
export type Row = { readonly path: string; readonly seconds: number };

export const reportRows = (report: unknown, root: string): Row[] => {
  if (
    typeof report !== "object" ||
    report === null ||
    !("testResults" in report) ||
    !Array.isArray(report.testResults)
  ) {
    return [];
  }

  return report.testResults.flatMap((file: unknown) => {
    if (
      typeof file !== "object" ||
      file === null ||
      !("name" in file) ||
      typeof file.name !== "string" ||
      !("startTime" in file) ||
      typeof file.startTime !== "number" ||
      !("endTime" in file) ||
      typeof file.endTime !== "number"
    ) {
      return [];
    }

    const seconds = (file.endTime - file.startTime) / 1000;
    return Number.isFinite(seconds) && seconds >= 0 ? [{ path: relative(root, file.name), seconds }] : [];
  });
};

export const staleRows = (table: Readonly<Record<string, number>>, real: readonly Row[]): Row[] =>
  real
    .filter((row) => Math.abs(row.seconds - (table[row.path] ?? 1)) > LIMIT)
    .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

export const rowLine = (row: Row): string => `  ${JSON.stringify(row.path)}: ${row.seconds.toFixed(1)},`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  /** The advice for one report: each row that differs, or a line saying the report could not be read. */
  const advice = (path: string) =>
    Effect.try(() => staleRows(measured, reportRows(JSON.parse(readFileSync(path, "utf8")), process.cwd()))).pipe(
      Effect.map((rows) =>
        rows.flatMap((row) => [
          `::warning::shard table differs by more than ${LIMIT} s: ${row.path.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`,
          rowLine(row),
        ]),
      ),
      Effect.orElseSucceed(() => ["shard-times: report unavailable; no timing advice for this report"]),
      Effect.flatMap((lines) => Effect.forEach(lines, (line) => Console.log(line), { concurrency: 1, discard: true })),
    );
  Effect.runSync(Effect.forEach(process.argv.slice(2), advice, { concurrency: 1, discard: true }));
}
