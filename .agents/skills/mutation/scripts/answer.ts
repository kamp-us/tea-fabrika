/**
 * What makes one `Survivor: <file>:<line> <reason> -- <evidence>` line an answer, what makes one
 * `Survivor-withdrawn: <file>:<line> <reason>` line a withdrawal, and which rows of a text are neither.
 *
 * This file imports nothing on purpose. `stepcommit.sh` loads it once per empty commit, and `survivors.ts` (the gate's
 * whole Effect program) took about a second to load on CI for what is one regular expression. Everything else about a
 * `Survivor:` line (the newest row wins, the place a row names, the exit code) stays in `survivors.ts`, which reads this
 * pattern from here, so one pattern decides both.
 */

// A command the arrow does not open with, so `plant: => y` has a result and no command.
const PROOF = String.raw`(?:\b(?:plant|rg):[ \t]*(?!=>)\S.*?=>[ \t]*\S|\blaw:[ \t]*[A-Z][A-Za-z]*\d+\b)`;

/** A `Survivor:` line with a place, a reason and evidence that names a proof: plant, rg or law. Capture 1 is the file, 2 the line or `*`. */
export const ANSWER = new RegExp(String.raw`^Survivor:[ \t]+(\S+):(\d+|\*)[ \t]+\S.*?[ \t]+--[ \t]+(?:\S.*?)?${PROOF}`);

/**
 * A `Survivor-withdrawn:` line with a place and a reason: a later commit takes back an earlier `Survivor:` row of that place, so the gate
 * reads only live answers. Capture 1 is the file, 2 the line or `*`. The place must be the earlier row's own, `file:*` and `file:12` being two.
 */
export const WITHDRAWN = /^Survivor-withdrawn:[ \t]+(\S+):(\d+|\*)[ \t]+\S/;

/** The nonblank rows of a text that are neither an answer nor a withdrawal: a commit that only carries those (stepcommit.sh --empty) holds none. Pure. */
export const notAnswers = (text: string): ReadonlyArray<string> =>
  text.split("\n").filter((row) => row.trim() !== "" && !ANSWER.test(row) && !WITHDRAWN.test(row));
