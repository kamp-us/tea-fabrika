// Today's CI: the clones a pull request adds, as advice (0587). jscpd, the copy-paste detector
// (0040), scans the tree with .jscpd.json's settings and builds a baseline from the pull request's
// base commit (`--baseline-from-ref`), so a clone it marks `isNew` is one this change made. Each new
// clone is printed as a GitHub warning on the lines of one side. Nothing here fails the run:
// a red check waits until jscpd's false alarms are measured at the blocking bar (0523), and a jscpd
// that cannot run says so in one line and exits 0.
//
//   node .github/ci/copies.ts --base <sha>
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const Side = Schema.Struct({
  name: Schema.String,
  startLoc: Schema.Struct({ line: Schema.Number }),
  endLoc: Schema.Struct({ line: Schema.Number }),
});

/** One clone as jscpd's json reporter writes it: its two sides, its size, and whether the base had it. */
const Clone = Schema.Struct({
  firstFile: Side,
  secondFile: Side,
  lines: Schema.Number,
  tokens: Schema.Number,
  isNew: Schema.optionalKey(Schema.Boolean),
});
export type Clone = typeof Clone.Type;

const Report = Schema.Struct({ duplicates: Schema.Array(Clone) });

/** jscpd's json report, read; none when it is not that shape. */
export const decodeReport = Schema.decodeUnknownOption(Schema.fromJsonString(Report));

/** A workflow command's property value, escaped as GitHub's toolkit escapes one. */
const property = (text: string) =>
  text
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");

/**
 * One warning line per clone the base did not have, on its second side and naming the first. GitHub
 * shows it on the diff when that side is in the change, and in the run's summary either way. A clone
 * with no `isNew` came from a run with no baseline: it is not new to anyone, so it is not printed.
 */
export const advice = (clones: ReadonlyArray<Clone>): ReadonlyArray<string> =>
  clones
    .filter((clone) => clone.isNew === true)
    .map(({ firstFile, secondFile, lines, tokens }) => {
      const at = `${firstFile.name}:${firstFile.startLoc.line}-${firstFile.endLoc.line}`;
      const where = `file=${property(secondFile.name)},line=${secondFile.startLoc.line},endLine=${secondFile.endLoc.line}`;
      return `::warning ${where},title=${property("copied code (advice)")}::${lines} lines, ${tokens} tokens, the same as ${at}. Reuse it or say why not in ## Existing tools (0587).`;
    });

/** The whole run: it prints its lines and answers the exit code. */
const main = Effect.fnUntraced(function* (argv: ReadonlyArray<string>) {
  const base = argv[argv.indexOf("--base") + 1] ?? "";

  if (!argv.includes("--base") || !/^[0-9a-f]{40}$/.test(base)) {
    yield* Console.log("copies: no base commit, so no clone can be told new; nothing checked");
    return 0;
  }

  const out = mkdtempSync(join(tmpdir(), "copies-"));
  const bin = join(import.meta.dirname, "../../node_modules/.bin/jscpd");
  const ran = spawnSync(
    bin,
    ["--config", ".jscpd.json", "--baseline-from-ref", base, "--reporters", "json", "--output", out, "--silent", "."],
    {
      encoding: "utf8",
    },
  );

  if (ran.error !== undefined || ran.status !== 0) {
    yield* Console.log(`copies: jscpd did not run (${ran.error?.message ?? `exit ${ran.status}`}); nothing checked`);
    return 0;
  }

  const report = decodeReport(readFileSync(join(out, "jscpd-report.json"), "utf8"));

  if (Option.isNone(report)) {
    yield* Console.log("copies: jscpd's report is not the shape this reads; nothing checked");
    return 0;
  }

  const lines = advice(report.value.duplicates);

  for (const line of lines) {
    yield* Console.log(line);
  }

  yield* Console.log(`copies: ${lines.length} new clones, advice only`);
  return 0;
});

if (import.meta.main) {
  process.exitCode = Effect.runSync(main(process.argv.slice(2)));
}
