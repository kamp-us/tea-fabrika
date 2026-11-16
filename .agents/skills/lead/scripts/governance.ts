// governance.ts: list the .decisions/ files a diff's words touch, so the review step and the lead
// read them. Advice only for now: it exits 0 whatever it finds; blocking comes once its false alarms
// are measured (0001). It exits 1 only when git fails, since then it cannot tell. Today's lead
// tooling, run on our own laptop; it is not product. The port of governance.sh (0113), with its
// command line, its rules and its lines kept.
//
//   node .agents/skills/lead/scripts/governance.ts [base]   default origin/main; the diff is base...HEAD
//
// A word is `[a-z][a-z0-9]+` of the lowercased text, four letters or more and not on the stop list.
// A diff's words are its changed lines and its file names; a decision's are its slug, its title and
// its tags. A decision is listed when the diff edits it or when the two share a word: edited ones
// first, then by how many words they share, then by name.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Exit, FileSystem, Path, Predicate } from "effect";
import { Argument, Command } from "effect/cli";
import { Git } from "./git/Git.ts";
import * as GitProcess from "./git/GitProcess.ts";

const STOP = new Set([
  "the",
  "and",
  "for",
  "not",
  "never",
  "every",
  "each",
  "one",
  "two",
  "its",
  "with",
  "from",
  "into",
  "when",
  "that",
  "this",
  "than",
  "only",
  "stays",
  "goes",
  "lands",
  "made",
  "make",
  "turn",
  "file",
  "files",
  "live",
  "lives",
  "decision",
  "decisions",
  "owner",
  "repo",
]);

const NO_MATCH = "governance: no decision file matched this diff. Search .decisions/ by hand too.";

/** A decision record's file name: four digits, a dash, anything, `.md`. */
const RECORD = /^[0-9]{4}-.*\.md$/s;
// Each reads the first line that starts with its key, as Python's `re.M` with `^` and `$` did.
const TITLE = /(?:^|\n)title:\s*([^\n]*)/;
const TAGS = /(?:^|\n)tags:\s*\[([^\n]*)\](?=\n|$)/;

/** The words of a text that count. */
const words = (text: string): ReadonlySet<string> =>
  new Set(
    [...text.toLowerCase().matchAll(/[a-z][a-z0-9]+/g)]
      .map((m) => m[0])
      .filter((word) => word.length >= 4 && !STOP.has(word)),
  );

/** What a diff says: the decision files it touches, by name, and its words. */
const readDiff = (diff: string) => {
  const touched = new Set<string>();
  const changed: Array<string> = [];

  // A diff line is read the way git writes it: up to the newline.
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/") || line.startsWith("--- a/")) {
      const path = line.slice(6);

      if (path.startsWith(".decisions/")) {
        touched.add(path.split("/").at(-1) ?? path);
      }

      changed.push(path);
    } else if ((line[0] === "+" || line[0] === "-") && !line.startsWith("+++") && !line.startsWith("---")) {
      changed.push(line.slice(1));
    }
  }

  return { touched, seen: words(changed.join("\n")) };
};

/** One listed decision: whether the diff edits it, and the words it shares with the diff, sorted. */
type Hit = { readonly name: string; readonly edited: boolean; readonly match: ReadonlyArray<string> };

/** A decision's words: its slug, after the number, and its title and tags. */
const keys = (name: string, text: string): ReadonlySet<string> =>
  new Set([
    ...words(name.slice(5, -3).replaceAll("-", " ")),
    ...words(TITLE.exec(text)?.[1] ?? ""),
    ...words(TAGS.exec(text)?.[1] ?? ""),
  ]);

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The lines to print: the listed decisions in order, or the no-match line. */
const lines = (hits: ReadonlyArray<Hit>): ReadonlyArray<string> =>
  hits.length === 0
    ? [NO_MATCH]
    : hits
        .toSorted(
          (a, b) => Number(b.edited) - Number(a.edited) || b.match.length - a.match.length || byName(a.name, b.name),
        )
        .map((hit) => `.decisions/${hit.name}: ${hit.edited ? "edited" : hit.match.join(", ")}`);

/** The decision records in `<top>/.decisions/`, each with its text; none when the folder is missing. */
const records = Effect.fn("governance.records")(function* (top: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = path.join(top, ".decisions");

  if (!(yield* fs.exists(folder))) {
    return [];
  }

  const names = (yield* fs.readDirectory(folder)).filter((name) => RECORD.test(name));
  return yield* Effect.forEach(
    names,
    (name) => Effect.map(fs.readFileString(path.join(folder, name)), (text) => ({ name, text })),
    { concurrency: 16 },
  );
});

export const governance = Command.make(
  "governance",
  { base: Argument.String("base").pipe(Argument.withDefault("origin/main")) },
  Effect.fn("governance")(function* ({ base }) {
    const git = yield* Git;
    const top = yield* git.top;
    const { touched, seen } = readDiff(yield* git.diff(["--unified=0", `${base}...HEAD`]));
    const hits = (yield* records(top)).flatMap(({ name, text }): ReadonlyArray<Hit> => {
      const match = [...keys(name, text)].filter((key) => seen.has(key)).toSorted(byName);
      const edited = touched.has(name);
      return edited || match.length > 0 ? [{ name, edited, match }] : [];
    });

    yield* Effect.forEach(lines(hits), (line) => Console.log(line), { concurrency: 1, discard: true });
  }),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.run({ version: "0.0.0" })(governance).pipe(
      Effect.as(0),
      Effect.catchTag("GitError", (e) => Console.error(`governance: git ${e.command}: ${e.reason}`).pipe(Effect.as(1))),
      // `--help` alone is a clean exit; an argument the command line got wrong is printed by effect/cli.
      Effect.catchTag("ShowHelp", (help) => Effect.succeed(help.errors.length === 0 ? 0 : 2)),
      Effect.catch((e) => Console.error(`governance: ${String(e)}`).pipe(Effect.as(1))),
      Effect.provide(GitProcess.layer(process.cwd())),
      Effect.provide(NodeServices.layer),
    ),
    {
      disableErrorReporting: true,
      teardown: (exit, onExit) => onExit(Exit.isSuccess(exit) && Predicate.isNumber(exit.value) ? exit.value : 1),
    },
  );
}
