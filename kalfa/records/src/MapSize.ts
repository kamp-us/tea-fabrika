/**
 * The map size check (advice, never a failure): an agent reads the root `AGENTS.md`, then the one of the
 * folder it works in, and follows a short file better than a long one. A finding comes for each of those
 * files that has more than `maxLines` lines: the root, and each tracked `AGENTS.md` one folder down.
 */
import { Effect } from "effect";
import { Finding } from "./Finding.ts";
import { read, Tracked } from "./Tracked.ts";

/**
 * The most lines an `AGENTS.md` should have: Claude Code's memory guide says to keep each file "under 200 lines per file" (https://code.claude.com/docs/en/memory). It is a constant, not a setting.
 *
 * @category constants
 */
export const maxLines = 200;

const MAP = /^([^/]+\/)?AGENTS\.md$/;

/** The lines of a text as `wc -l` counts them: its newlines, and one more for a last line with none. */
const linesOf = (text: string) => {
  const pieces = text.split("\n").length;

  return text.endsWith("\n") || text === "" ? pieces - 1 : pieces;
};

/**
 * The `map` findings: each tracked, regular `AGENTS.md` at the root or one folder down that has more than `maxLines` lines.
 *
 * @category constructors
 */
export const check = Effect.fnUntraced(function* (root: string) {
  const tracked = yield* Tracked;

  const paths = (yield* tracked.files)
    .filter((entry) => !entry.symlink && MAP.test(entry.path))
    .map((entry) => entry.path);

  const files = yield* read(root, paths);

  return files.flatMap(({ path, text }) => {
    const lines = linesOf(text);

    return lines > maxLines ? [Finding.cases.map.make({ path, lines, max: maxLines })] : [];
  });
});
