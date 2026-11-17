// Today's CI for both versions. The `ci-required` job's verdict: did every job in check.yaml pass,
// or skip only where changes.mjs said it may? GitHub's ruleset for main requires this one check.
// No installed dependencies and no type stripping, like changes.mjs, so the job
// runs on the runner's own Node with no setup or install.
//
// The same shape as phoenix's ci-required (packages/fabrika-cli/src/ci/required.ts there): a pure
// judge, a thin main, and a skip that passes only when the job was not required. Here the
// required-ness is the job's own changes outputs, the ones its `if:` reads, so the two cannot drift.
//
// Edge cases, each a law in required.test.ts:
// 1. Every job `success`: passes.
// 2. A gated job `skipped`, changes `success` and each of its outputs exactly "false": passes.
// 3. A gated job `skipped` with any of its outputs "true", empty or missing: fails.
// 4. changes not `success`: fails, as changes is judged like any job, so no output of a failed
//    changes can pass a skip.
// 5. An ungated job (changes, or one added later) `skipped`: fails.
// 6. `failure`, `cancelled`, an empty or unknown result: fails, whatever the output says.
// 7. A gated job, or changes, absent from `needs`: fails.
// 8. `needs` that is not an object, or JSON that does not parse: fails.
// 9. A matrix job (next) is one `needs` entry; GitHub folds its shards into one result.
// 10. A job with two outputs (check, which also holds the field row check) skips only when both
//     are exactly "false": field rows alone start it.
import { fileURLToPath } from "node:url";

/** The jobs that may skip, each a key of `gates`. */
export const gated = /** @type {const} */ (["check", "typecheck", "next", "select", "related"]);

/**
 * Each job that may skip, and the changes outputs it runs on: its `if:` starts it when any of them
 * is not "false", so its skip passes only when every one is. check also holds the field row check.
 * next's `next` already holds the sizing: changes prints it false when no next/ test file is picked.
 * workflow-lint.ts reads this map, and `gated` lists its jobs.
 * @type {Readonly<Record<(typeof gated)[number], readonly string[]>>}
 */
export const gates = {
  check: ["check", "field"],
  typecheck: ["typecheck"],
  next: ["next"],
  select: ["related"],
  related: ["related"],
};

/** @typedef {{ pass: boolean, lines: string[] }} Verdict */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isMap = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {unknown} job @param {string} key */
const field = (job, key) => (isMap(job) ? job[key] : undefined);

/**
 * One line per job and a verdict, from `toJSON(needs)` already parsed.
 * @param {unknown} needs
 * @returns {Verdict}
 */
export const judge = (needs) => {
  if (!isMap(needs) || Object.keys(needs).length === 0) {
    return { pass: false, lines: ["needs: unreadable, so nothing can pass"] };
  }

  const outputs = field(needs["changes"], "outputs");
  const absent = ["changes", ...gated].filter((name) => !(name in needs));
  const lines = absent.map((name) => `${name}: not in needs, fail`);
  let pass = absent.length === 0;

  for (const [name, job] of Object.entries(needs)) {
    const result = field(job, "result");
    const flags = Object.entries(gates).find(([gate]) => gate === name)?.[1] ?? [];

    const empty =
      name === "related" &&
      field(needs["select"], "result") === "success" &&
      field(field(needs["select"], "outputs"), "run") === "false";

    const meant = empty || (flags.length > 0 && flags.every((flag) => field(outputs, flag) === "false"));
    const ok = result === "success" || (result === "skipped" && meant);
    const shown = typeof result === "string" && result !== "" ? result : "no result";
    const note = result !== "skipped" ? "" : meant ? ", as changes said" : ", but it should have run";
    lines.push(`${name}: ${shown}${note}, ${ok ? "pass" : "fail"}`);
    pass &&= ok;
  }

  return { pass, lines };
};

/** @param {string | undefined} text */
const parse = (text) => {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return null;
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const verdict = judge(parse(process.env["NEEDS"]));

  for (const line of verdict.lines) {
    console.log(line);
  }

  console.log(verdict.pass ? "ci-required: pass" : "ci-required: fail");
  process.exitCode = verdict.pass ? 0 : 1;
}
