// Leaks: the leak gate every merge path runs before it asks GitHub anything (0048, 0183). It runs
// leakgrep.sh, through the Pushes service, on what a merge makes public on main: the net change, each
// commit since main, and the title and description a squash writes. Any refusal, and a grep that
// could not run, fails the gate; nothing here reads an exit code loosely. On 2026-11-15 a merge ran
// after a grep had printed a leak, because the shell line never checked its exit code
// (field/notes/2026-11-15-admin-merge-ran-past-a-leak-grep-hit.json). Today's lead tooling, run on
// our own laptop; it is not product. Read through its module: `Leaks.gate(...)`.
import { Effect } from "effect";
import type { Detail } from "./PullRequests.ts";
import { Pushes } from "./Pushes.ts";

/** The words a squash puts on main: the pull request's title, then its description. */
export const words = (found: Pick<Detail, "title" | "body">): string => `${found.title}\n\n${found.body}\n`;

/** Fails unless the leak grep passed on the change, each commit and the words of pull request `found`. */
export const gate = Effect.fn("Leaks.gate")(function* (dir: string, found: Pick<Detail, "oid" | "title" | "body">) {
  const pushes = yield* Pushes;
  yield* pushes.leakChange(dir, found.oid);
  yield* pushes.leakGrep(dir, found.oid);
  yield* pushes.leakText(dir, words(found));
});
