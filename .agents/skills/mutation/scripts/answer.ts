/**
 * What makes one `Survivor: <file>:<line> <reason> -- <evidence>` line an answer, and which rows of a text are not one.
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

/** The nonblank rows of a text that answer nothing: a commit that only carries answers (stepcommit.sh --empty) holds none. Pure. */
export const notAnswers = (text: string): ReadonlyArray<string> =>
  text.split("\n").filter((row) => row.trim() !== "" && !ANSWER.test(row));
