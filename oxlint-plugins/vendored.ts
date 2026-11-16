// The anti-slop plugin's `src/` comes in whole and unchanged at one commit of the fork (0563,
// Amendments). Its rules are the exam, so an edit there would change the exam without anyone reading
// it as a change. vendor/anti-slop/pin.json names the fork, the commit and the git tree id of the
// fork's `src/` at that commit, which anyone can check against the fork with `git rev-parse
// <commit>:src`. A whole `pnpm lint` run fails unless the folder's `src/` at HEAD is that tree, and
// nothing in vendor/anti-slop/ is changed and not committed.
//
// An update is a newer commit brought in whole: replace `src/` and `LICENSE` from it, then `commit`
// and `tree` in pin.json. Nothing else (oxlint-plugins/README.md).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Exit, Schema } from "effect";

const FOLDER = "vendor/anti-slop";

/** Where the folder came from, and what its `src/` must hash to. */
const Pin = Schema.fromJsonString(
  Schema.Struct({ repository: Schema.String, commit: Schema.String, tree: Schema.String }),
);

const git = (root: string, args: ReadonlyArray<string>) => spawnSync("git", args, { cwd: root, encoding: "utf8" });

/** One line for each way vendor/anti-slop/ is not the pinned commit's code; none when it is. */
export const verify = (root: string): ReadonlyArray<string> => {
  const path = join(root, FOLDER, "pin.json");
  const pin = existsSync(path) ? Schema.decodeExit(Pin)(readFileSync(path, "utf8")) : undefined;

  if (pin === undefined || Exit.isFailure(pin)) {
    return [`${FOLDER}/pin.json: could not read its repository, commit and tree`];
  }

  const { repository, commit, tree } = pin.value;
  const head = git(root, ["rev-parse", "--verify", "--quiet", `HEAD:${FOLDER}/src`]);
  const found = head.status === 0 ? head.stdout.trim() : "missing";
  const status = git(root, ["status", "--porcelain", "--", FOLDER]);
  const changed = status.stdout.split("\n").filter((line) => line.trim() !== "");
  const lines: Array<string> = [];

  if (found !== tree) {
    lines.push(
      `${FOLDER}/src at HEAD is git tree ${found}, and pin.json says ${tree}: it must be the src/ of ${repository} at ${commit}, unchanged (0563)`,
    );
  }

  if (status.status !== 0) {
    lines.push(`${FOLDER}: git status failed, so nothing says the folder is unchanged: ${status.stderr.trim()}`);
  }

  if (changed.length > 0) {
    lines.push(`${FOLDER}: changed and not committed, and it is never edited (0563): ${changed.join(", ")}`);
  }

  return lines;
};
