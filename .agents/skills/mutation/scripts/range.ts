/**
 * The hourly mutation run's range: which commits it mutates, cut to what its container can finish.
 * Today's lead tooling. Mutbox stops the container at 900 s (`secondsFor` in `mutbox.ts`), so a range
 * with hundreds of related test files, such as the 13 days after the run died on 2026-11-13 (667
 * commits, 824 files), can never pass, and a failed range only grows with each merge. This script moves
 * the base forward along main's first-parent chain until the range holds at most `MUTATION_MAX_RELATED`
 * related test files (default 12), and says how many commits that left unmutated.
 *
 *   node .agents/skills/mutation/scripts/range.ts --base SHA --head SHA
 *   base=<the new base>
 *   related=<the related test files, comma-separated>
 *   wanted=<the related files of the whole range, before the cut>
 *   left=<the commits the cut left unmutated>
 *
 * The related files are exactly the workflow's pick: `scope.ts`'s tests for the changed files, kept
 * when they are plain paths that exist at the head. The search is a binary search over the chain
 * (about 10 `git diff` calls for 667 commits); related files only fall as the base moves forward,
 * except where a file changed twice, which the search does not assume away: it only trusts the answer
 * it measured, and the last commit alone is the smallest range, so a range of one commit may pass the
 * cap (a single large commit is mutated, never skipped forever).
 */
import { execFileSync } from "node:child_process"; // edge: range.ts is a CI program, and `git` is its input
import { related } from "./scope.ts";

/** The default cap on related test files, a setting (`MUTATION_MAX_RELATED`). */
export const MAX_RELATED = 12;

/** A path the run may pass to mutbox's `--related`: a plain test path (the workflow's old `grep`). */
export const PLAIN = /^[A-Za-z0-9_@.][A-Za-z0-9_@.+/ -]*\.test\.tsx?$/;

/** The usable related tests of a diff: scope's pick, plain, with no `/../`, and present at the head. Pure. */
export const usable = (changed: ReadonlyArray<string>, tracked: ReadonlyArray<string>): ReadonlyArray<string> => {
  const present = new Set(tracked);

  return related(changed, tracked).filter((t) => PLAIN.test(t) && !t.includes("/../") && present.has(t));
};

/**
 * The index in `chain` (the commits from the base, at 0, to the head, oldest first) of the new base:
 * the first whose range to the head holds at most `max` related files, found by binary search with
 * `count`. The last allowed index is the one before the head, so a range is never empty by the cap.
 * Pure but for `count`.
 */
export const narrow = (chain: ReadonlyArray<string>, count: (base: string) => number, max: number): number => {
  let low = 0;
  let high = Math.max(chain.length - 2, 0);

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if (count(chain[middle] ?? "") <= max) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return low;
};

/** One `git` call: its stdout, or a throw with its stderr. */
export type Git = (args: ReadonlyArray<string>) => string;

const realGit: Git = (args) => execFileSync("git", [...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

const lines = (text: string) => text.split("\n").filter((line) => line !== "");

/** What `plan` answers: the new base, the related tests (comma-separated), the files wanted before the cut, and the commits left out. */
export interface Plan {
  readonly base: string;
  readonly related: string;
  readonly wanted: number;
  readonly left: number;
}

/** The range from `base` to `head` cut to at most `max` related test files, reading the history through `git`. */
export const plan = (base: string, head: string, max: number, git: Git): Plan => {
  const tracked = lines(git(["ls-tree", "-r", "--name-only", head]));
  const tests = (from: string) => usable(lines(git(["diff", "--name-only", "--diff-filter=d", from, head])), tracked);

  // The chain: the base, then each first-parent commit up to the head.
  const chain = [base, ...lines(git(["rev-list", "--first-parent", "--reverse", `${base}..${head}`]))];
  const at = narrow(chain, (from) => tests(from).length, max);
  const start = chain[at] ?? base;

  return {
    base: start,
    related: tests(start).join(","),
    wanted: tests(base).length,
    left: at === 0 ? 0 : lines(git(["rev-list", `${base}..${start}`])).length,
  };
};

const flag = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);

  return at < 0 ? null : (process.argv[at + 1] ?? null);
};

if (import.meta.main) {
  const base = flag("base");
  const head = flag("head");
  const max = Number(process.env["MUTATION_MAX_RELATED"] || MAX_RELATED);

  if (base === null || head === null || !Number.isInteger(max) || max < 1) {
    throw new Error("range: --base and --head are required, and MUTATION_MAX_RELATED is a whole number, at least 1");
  }

  const answer = plan(base, head, max, realGit);

  console.log(`base=${answer.base}`);
  console.log(`related=${answer.related}`);
  console.log(`wanted=${answer.wanted}`);
  console.log(`left=${answer.left}`);
}
