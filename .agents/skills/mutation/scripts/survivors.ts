// survivors.ts: the guard check. It runs StrykerJS on the product files a change touches, against
// only the laws that load them, and lists every mutant that lived. Today's lead tooling, run by the
// builder once its laws are green, and by the reviewer on the branch.
//
//   node .agents/skills/mutation/scripts/survivors.ts --out <folder> [--base <commit>] [--head <commit>] [--files <a.ts,b.ts>] [--answered] [--answers <file>]
//
// - `--base` is where the change starts; none is `git merge-base origin/main HEAD`.
// - `--head` is the commit to check; none is the working tree as it is now, uncommitted and
//   untracked files included (what `git add -A` would take), so the builder runs it before its
//   commit. Neither the branch, the index nor any ref changes: the trees and commits it makes are
//   loose objects that nothing points at.
// - `--files` names the product files to mutate, such as the files that hold the guarding checks. A file the change touches
//   is mutated on its changed lines; a file it does not touch is mutated whole. None: every product
//   file the change touches, by the hourly run's own file rule (`scope.ts`).
// - `--answered` takes each `Survivor: <file>:<line> <reason> -- <evidence>` line of the commit bodies from `--base` to
//   `--head` (HEAD when none) as the answer to the mutant on that line; `<file>:*` answers a file no law loads
//   or every mutant of a file. The evidence names its proof, one of `plant: <command> => <result>` (a command
//   run, with what it printed), `rg: <search> => <result>` (a search that shows no reader) or `law: <id>` (a law that
//   already catches it, as the plan's laws table names it). A line whose evidence names none answers nothing, and the
//   check prints it as `refused` with the line and exits 1. The check reads one line, so the
//   reason and the evidence stay on it. `--answers` names a file of such lines too, such as the commit body about to be
//   written. An answered mutant is counted and no longer listed, so exit 0 says every survivor is killed or
//   answered. Without either flag no line is read and a mutant that lived is always listed.
// - `--out` is your scratch folder; mutbox's whole answer is `<out>/mutbox.json`.
//
// The vitest runner strips types, so a mutant that `tsc` refuses would run and live. After the run, the box type-checks each mutant that
// lived, in its own package (recheck.ts, ticket 1309): one that does not compile counts as a kill (`CompileError`), is not listed and is
// not run again at full depth. The last line says how many. A package that fails `tsc` as it is, or a file in no package, is not judged.
//
// Settings, each from the environment with its default, as the lead's other settings are read:
//
//   MUTATE_SECONDS       300   how long Stryker may test mutants: run.sh's cap, in whole seconds
//   MUTATE_FILES         8     the most product files one run takes; more is refused, naming the count
//   MUTATE_RUNS          25    the most cases a property law draws in the box, or `full` for each law's own count
//                              (ticket 1306: the laws run three times over, and at full depth they alone cost more
//                              than the 300 s; depth.ts says how the cap reaches a law, and what it cannot reach). A
//                              mutant that lives at the cap is run again at full depth, in the laws that cover it, and
//                              is listed only if it lives there too (recheck.ts); that run has its own MUTATE_SECONDS
//   MUTATE_WAIT_SECONDS  7200  the longest a run waits in line for the box; then it gives up its place (exit 2)
//   MUTATE_KEEP_DAYS     7     how long a saved run is kept: each save drops the ones older than this
//   BOXES                the boxes folder beside the main checkout, as env.sh finds it; the one Docker
//                        box's lock is `<BOXES>/state/docker.lock`
//
// A second call on the same commit and files is instant. The box's answer is saved in
// `<BOXES>/state/gate/` under a key of the base, the head's tree, the files, the scripts' text and
// MUTATE_SECONDS (`gatecache.ts`), and a call with the same key reads it and starts no box. The
// `Survivor:` lines are not in the key: they are read again on every call and applied to the saved
// answer, so a line added since counts. A call that must start the box takes a place in line first,
// and says its place and the run ahead every minute (`gatequeue.ts`); the box is taken in arrival
// order, one at a time, and a run that waits leaves the line as soon as the run ahead saves its answer.
//
// Exit 0: no mutant lived, or each one that did is answered. 1: a mutant lived, or a file in scope has no
// law that loads it, and no `Survivor:` line answers it; each is one line. 2: refused before the run (too wide, a bad `--files`), the box is stuck, or the wait for the box passed its limit.
//
// How it runs, with no second Stryker config: it makes a commit whose parent holds the base's
// version of each file in scope (or no file, for one mutated whole) and the head everywhere else, so
// the hourly run's sampler (`sample.ts`, the build commit against its parent) draws its fixed-seed
// sample of at most 150 mutants from exactly those lines. mutbox.ts then runs run.sh on that commit
// in the mutation container, under `nice -n 15`, with no network, against the laws found here.
//
// The laws: each `*.test.ts(x)` in the file's own package (the nearest folder with a package.json;
// the file's own folder when that is the repo root) whose imports reach the file, followed through
// relative imports and the package's own name and exports. Read from their parsed syntax, so a
// type-only import loads nothing. A test of kind `integration`, `types` or `visual` is left out and
// named: the container refuses the first, and the others kill no mutant. Hand-written, since Vitest's
// own `related` walks every test file of the repo through Vite, and the laptop refuses a run that
// names no test file (`vitest.hostrun.ts`).
//
// A second way to a law, by name (ticket 1314): for a file `oxlint-plugins/<rule>.ts`, the test `oxlint-plugins/<rule>.test.ts` beside it
// is a law too. Its cases lint through `plant.ts`, which runs oxlint in another process, so no import reaches the rule. The output
// says which laws were found by import and which by name (outside.ts). In the box, `outside.setup.ts` hands that process the
// mutant and covers the rule's mutants for the test, since Stryker sees only the test's own process.
//
// What it cannot see: a law in another package that loads the file through a workspace link, and a
// fault no Stryker mutator makes (code moved or unwrapped, a race between two calls).
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Array as Arr,
  pipe,
  String as Str,
  Clock,
  Config,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  Predicate,
  Record as Rec,
  Result,
  Schema,
} from "effect";
import type { PlatformError } from "effect";
import { Command, Flag } from "effect/cli";
import { alive, bounded, DOCKER_SECONDS, heldBy, loads, secondsFor, Summary } from "../../lead/scripts/mutbox.ts";
import * as Saved from "./gatecache.ts";
import { inLine, noteLine } from "./gatequeue.ts";
import type { Line } from "./gatequeue.ts";
import { lawNamedFor } from "./outside.ts";
import { inScope, product } from "./scope.ts";

// ---------------------------------------------------------------- the settings

const AtLeastOne = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** How long Stryker may test mutants, in seconds: run.sh's cap inside the box. */
const SECONDS = Config.schema(AtLeastOne, "MUTATE_SECONDS").pipe(Config.withDefault(300));

/** The most product files one run takes. */
const FILES = Config.schema(AtLeastOne, "MUTATE_FILES").pipe(Config.withDefault(8));

/** The most cases a property law draws in the box, or `full`: no cap, each law's own count. */
const RUNS = Config.schema(Schema.Union([AtLeastOne, Schema.Literal("full")]), "MUTATE_RUNS").pipe(
  Config.withDefault(25),
);

/** How many days a saved run is kept: a save drops the older ones. */
const KEEP = Config.schema(AtLeastOne, "MUTATE_KEEP_DAYS").pipe(Config.withDefault(7));

/** The longest a run waits in line for the box, in seconds. */
const WAIT = Config.schema(AtLeastOne, "MUTATE_WAIT_SECONDS").pipe(Config.withDefault(7200));

const BOXES = Config.option(Config.NonEmptyString("BOXES"));

// ---------------------------------------------------------------- the pure parts

/** A refusal before the run, in plain words. */
class Refused extends Schema.TaggedError<Refused, { readonly brand: unique symbol }>()("Refused", {
  detail: Schema.String,
}) {}

/** Test code with a product file's name: a laws kit (`*Test.ts`, the laws a package exports) and test support. */
const TEST_CODE = /(?:Test|\.test-support)\.[cm]?[jt]sx?$/;

/**
 * A file this check mutates: a product file the hourly run may mutate (`scope.ts`), less test code
 * with a product file's name, where a mutant changes a law's label or input, never a guard.
 */
export const mutable = (path: string) => product(path) && inScope(path) && !TEST_CODE.test(path);

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const unique = (paths: ReadonlyArray<string>) => [...new Set(paths)].sort(compare);

/**
 * The files to mutate: those named, else the changed files the hourly run may mutate; sorted and
 * unique. A named file that is no such file of the head, or more files than the cap, is refused. Pure.
 */
export const pick = (ask: {
  readonly changed: ReadonlyArray<string>;
  readonly named: ReadonlyArray<string> | null;
  readonly tree: ReadonlySet<string>;
  readonly cap: number;
}): Result.Result<ReadonlyArray<string>, Refused> => {
  const bad = Arr.filter(ask.named ?? [], (file) => !mutable(file) || !ask.tree.has(file));

  if (bad.length > 0) {
    return Result.fail(
      Refused.make({
        detail: `--files takes product files of the head that the mutation run may mutate (no test, no type file, no lead tooling but quest code); these are not: ${Arr.join(bad, ", ")}`,
      }),
    );
  }

  const files = unique(ask.named ?? Arr.filter(ask.changed, mutable));

  return files.length > ask.cap
    ? Result.fail(
        Refused.make({
          detail: `${files.length} product files are in scope and the cap is ${ask.cap} (MUTATE_FILES): name the files that hold the guarding checks with --files, at most ${ask.cap}`,
        }),
      )
    : Result.succeed(files);
};

/** One file's entry in a tree, as `git ls-tree` gives it. */
type Blob = { readonly mode: string; readonly id: string };

/**
 * What the sample's parent holds at each file in scope: the base's blob where it differs from the
 * head's, so only the changed lines are new; else nothing, so every line is new and the file is
 * mutated whole. Pure.
 */
export const parentEntries = (
  files: ReadonlyArray<string>,
  base: Readonly<Record<string, Blob>>,
  head: Readonly<Record<string, Blob>>,
): ReadonlyArray<{ readonly path: string; readonly blob: Blob | null }> =>
  Arr.map(files, (path) => {
    const before = base[path];

    return { path, blob: before !== undefined && before.id !== head[path]?.id ? before : null };
  });

/** A path with its `.` and `..` parts worked out, from the repo's top; `null` when it climbs out. Pure. */
export const normal = (path: string): string | null => {
  const parts: Array<string> = [];

  for (const part of Str.split(path, "/")) {
    if (part === "..") {
      if (parts.length === 0) {
        return null;
      }

      parts.pop();
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }

  return Arr.join(parts, "/");
};

/** The folder that holds a path, `""` at the repo's top. */
const containing = (path: string) => {
  const slash = path.lastIndexOf("/");

  return slash < 0 ? "" : pipe(path, Str.slice(0, slash));
};

/** Whether a path is in a folder; the repo's top holds only its own files, so a top file's laws are top files too. */
const under = (folder: string, path: string) =>
  folder === "" ? !pipe(path, Str.includes("/")) : pipe(path, Str.startsWith(`${folder}/`));

/**
 * Where the laws of a file are looked for: its package, the nearest folder above it with a
 * package.json; the file's own folder when that is the repo's top, whose package is everything. Pure.
 */
export const lawFolder = (file: string, tree: ReadonlySet<string>): string => {
  for (let folder = containing(file); folder !== ""; folder = containing(folder)) {
    if (tree.has(`${folder}/package.json`)) {
      return folder;
    }
  }

  return containing(file);
};

const TEST = /\.test\.tsx?$/;

/** Why a test of this kind cannot judge a mutant here, or `null`. Pure. */
export const leftOut = (test: string): string | null => {
  const kinds = Str.split(pipe(test, Str.replace(/^.*\//, "")), ".");

  return Arr.contains(kinds, "integration")
    ? "an integration law, which the container refuses to start"
    : Arr.contains(kinds, "types")
      ? "a type law, which kills no mutant"
      : Arr.contains(kinds, "visual")
        ? "a visual law, which needs a window"
        : null;
};

/** The tests of the tree in these folders, with the ones left out and why. Pure. */
export const testsIn = (folders: ReadonlyArray<string>, tree: ReadonlyArray<string>) => {
  const found = Arr.filter(tree, (path) => TEST.test(path) && Arr.some(folders, (folder) => under(folder, path)));

  return {
    tests: Arr.filter(found, (test) => leftOut(test) === null),
    left: Arr.flatMap(found, (test) => {
      const reason = leftOut(test);

      return reason === null ? [] : [{ path: test, reason }];
    }),
  };
};

/** A package's name and its string exports, for an import of the package by its own name. */
type Own = {
  readonly folder: string;
  readonly name: string;
  readonly exports: Readonly<Record<string, string>>;
};

const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts"];

/**
 * The tree file an import names, or `null` for anything else (another package, a built-in): a
 * relative path, with or without its extension or a `.js` for `.ts`, or the package's own name. Pure.
 */
export const resolve = (from: string, specifier: string, tree: ReadonlySet<string>, own: Own | null): string | null => {
  const exported =
    own !== null && (specifier === own.name || pipe(specifier, Str.startsWith(`${own.name}/`)))
      ? own.exports[`.${pipe(specifier, Str.slice(own.name.length))}`]
      : undefined;

  const target =
    exported !== undefined
      ? normal(`${own?.folder ?? ""}/${exported}`)
      : pipe(specifier, Str.startsWith("./")) || pipe(specifier, Str.startsWith("../"))
        ? normal(`${containing(from)}/${specifier}`)
        : null;

  if (target === null) {
    return null;
  }

  const stems = pipe(target, Str.endsWith(".js")) ? [target, `${pipe(target, Str.slice(0, -3))}.ts`] : [target];

  return Arr.findFirst(
    Arr.flatMap(stems, (stem) => Arr.map(EXTENSIONS, (end) => `${stem}${end}`)),
    (path) => tree.has(path),
  ).pipe(Option.getOrNull);
};

/** For each test, every file of the tree it loads, following `edges` from it. Pure. */
export const reach = (
  tests: ReadonlyArray<string>,
  edges: (file: string) => ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlySet<string>> =>
  new Map(
    Arr.map(tests, (test) => {
      const seen = new Set<string>([test]);
      const queue = [test];

      for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
        for (const next of edges(file)) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }

      return [test, seen] as const;
    }),
  );

/** The laws that load each file, and the files no law loads. Pure. */
export const coverage = (files: ReadonlyArray<string>, reached: ReadonlyMap<string, ReadonlySet<string>>) => {
  const by = Rec.fromEntries(
    Arr.map(files, (file) => [file, Arr.filter([...reached.keys()], (test) => reached.get(test)?.has(file) === true)]),
  );

  return {
    laws: unique(Arr.flatMap(Rec.values(by), (tests) => tests)),
    bare: Arr.filter(files, (file) => (by[file] ?? []).length === 0),
  };
};

/**
 * The laws of the files, by how each was found, and the files no law loads. A law is picked by import, when it reaches a file
 * (`coverage`), or by name, when it is the test named after a lint rule's file (`outside.ts`): its cases lint through another
 * process, so no import reaches the rule. One found both ways counts as by import. Pure.
 */
export const picked = (
  files: ReadonlyArray<string>,
  reached: ReadonlyMap<string, ReadonlySet<string>>,
  tests: ReadonlyArray<string>,
) => {
  const imported = coverage(files, reached).laws;

  const named = unique(
    Arr.filter(
      Arr.flatMap(files, (file) => {
        const law = lawNamedFor(file);

        return law === null ? [] : [law];
      }),
      (law) => Arr.contains(tests, law) && !Arr.contains(imported, law),
    ),
  );

  return {
    imported,
    named,
    laws: unique([...imported, ...named]),
    bare: Arr.filter(files, (file) => {
      const law = lawNamedFor(file);

      return (
        !Arr.some(imported, (test) => reached.get(test)?.has(file) === true) &&
        (law === null || !Arr.contains(tests, law))
      );
    }),
  };
};

type Row = NonNullable<Summary["b"]>["survivors"][number];

const SHOWN = 72;

const fold = (text: string) => {
  const one = pipe(text, Str.replace(/\s+/g, " "), Str.trim);

  return one.length > SHOWN ? `${pipe(one, Str.slice(0, SHOWN - 3))}...` : one;
};

/**
 * What a mutant changed, from the file's text: the original span, then Stryker's replacement.
 * Stryker's report counts lines from 1 and columns from 1. Pure.
 */
export const changed = (source: string, row: Row): string => {
  const lines = Str.split(source, "\n");
  const start = row.line - 1;
  const end = row.endLine - 1;

  const span =
    start === end
      ? pipe(lines[start] ?? "", Str.slice(row.column - 1, row.endColumn - 1))
      : Arr.join(
          [
            pipe(lines[start] ?? "", Str.slice(row.column - 1)),
            ...lines.slice(start + 1, end),
            pipe(lines[end] ?? "", Str.slice(0, row.endColumn - 1)),
          ],
          "\n",
        );

  return `${fold(span)} -> ${fold(row.replacement)}`;
};

const byPlace = (a: Row, b: Row) => compare(a.file, b.file) || a.line - b.line || a.column - b.column;

/** One line per mutant that lived: how, where, which mutator, and what it changed. Pure. */
export const survivorLines = (rows: ReadonlyArray<Row>, source: (file: string) => string): ReadonlyArray<string> =>
  Arr.map(
    [...rows].sort(byPlace),
    (row) =>
      `${row.status === "NoCoverage" ? "no law ran" : "lived"}  ${row.file}:${row.line} ${row.mutator}: ${changed(source(row.file), row)}`,
  );

/**
 * One line per source line whose mutants Stryker ignored as static: code that runs once as the
 * module loads (a top-level pattern, schema or constant), which no law's run can judge. Pure.
 */
export const staticLines = (rows: ReadonlyArray<Row>): ReadonlyArray<string> => {
  const lines = new Map<string, Array<string>>();

  for (const row of [...rows].sort(byPlace)) {
    const key = `${row.file}:${row.line}`;
    lines.set(key, [...(lines.get(key) ?? []), row.mutator]);
  }

  return Arr.map([...lines], ([place, mutators]) => `static  ${place} ${Arr.join(mutators, ", ")}`);
};

/**
 * A `Survivor: <file>:<line> <reason> -- <evidence>` line: the build says the mutant there guards nothing, and
 * shows how it checked. `line` is null for `<file>:*`.
 *
 * The evidence names its proof, one of three (ticket 1309: four builders wrote "equivalent", "never" or "covered" with nothing behind it):
 * - `plant: <command> => <result>`: a command run that plants the mutant or the input, with what it printed;
 * - `rg: <search> => <result>`: a search that shows no reader, with what it found;
 * - `law: <id>`: the id of a law that already catches it, as the plan's laws table names it (`H1`, `RF2`).
 * Other words may come with it. Evidence with none of the three answers nothing.
 *
 * The newest row for a file and line wins: a commit can never be rewritten, so an older row with no proof stands down once a newer
 * row on the same place has one, and a newer row with none takes the answer away. Texts are read oldest first, and rows in order.
 */
export type Answer = { readonly file: string; readonly line: number | null };

// A command the arrow does not open with, so `plant: => y` has a result and no command.
const PROOF = String.raw`(?:\b(?:plant|rg):[ \t]*(?!=>)\S.*?=>[ \t]*\S|\blaw:[ \t]*[A-Z][A-Za-z]*\d+\b)`;

const ANSWER = new RegExp(String.raw`^Survivor:[ \t]+(\S+):(\d+|\*)[ \t]+\S.*?[ \t]+--[ \t]+(?:\S.*?)?${PROOF}`);

/** The place a `Survivor:` row answers, `file:line` or `file:*`; `null` for a row too broken to say. */
const PLACE = /^Survivor:[ \t]+(\S+:(?:\d+|\*))(?=[ \t])/;

type Said = { readonly text: string; readonly place: string | null; readonly answer: Answer | null };

/** The `Survivor:` rows of a text, oldest first, and of each place only the last: the rest stand down. Pure. */
const standing = (text: string): ReadonlyArray<Said> => {
  const rows = Arr.flatMap(Str.split(text, "\n"), (text): ReadonlyArray<Said> => {
    if (!text.startsWith("Survivor:")) {
      return [];
    }

    const found = ANSWER.exec(text);

    return [
      {
        text,
        place: PLACE.exec(text)?.[1] ?? null,
        answer: found === null ? null : { file: found[1] ?? "", line: found[2] === "*" ? null : Number(found[2]) },
      },
    ];
  });

  const last = new Map(Arr.map(rows, (row, i) => [row.place, i] as const));

  return Arr.filter(rows, (row, i) => row.place === null || last.get(row.place) === i);
};

/** The answers of the `Survivor:` rows that stand and carry a proof; a row with no reason, or evidence naming no plant, search or law, answers nothing. Pure. */
export const answersIn = (text: string): ReadonlyArray<Answer> =>
  Arr.flatMap(standing(text), (row) => (row.answer === null ? [] : [row.answer]));

/** The nonblank rows of a text that answer nothing: a commit that only carries answers (stepcommit.sh --empty) holds none. Pure. */
export const notAnswers = (text: string): ReadonlyArray<string> =>
  Arr.filter(Str.split(text, "\n"), (row) => Str.trim(row) !== "" && !ANSWER.test(row));

/** The `Survivor:` rows that stand and answer nothing, the ones the check refuses by name. A newer row on the same place with a proof clears an older one. Pure. */
export const refusedIn = (text: string): ReadonlyArray<string> =>
  Arr.flatMap(standing(text), (row) => (row.answer === null ? [row.text] : []));

/** The commit bodies `git log --format=%B%x00` gives, newest first, as one text with the oldest first, so a newer row wins. Pure. */
export const oldestFirst = (log: string): string =>
  Arr.join(Arr.reverse(Arr.filter(Str.split(log, "\0"), (body) => Str.trim(body) !== "")), "\n");

/** Whether a mutant on a line, or a file no law loads (`line` null), has an answer. Pure. */
export const isAnswered = (answers: ReadonlyArray<Answer>, file: string, line: number | null): boolean =>
  Arr.some(answers, (answer) => answer.file === file && (answer.line === null || answer.line === line));

/** The exit code: 1 while a mutant lived or a file has no law that loads it, and no `Survivor:` line answers it, or a `Survivor:` line was refused; else 0. Pure. */
export const exitCode = (open: number, unloaded: number, refused = 0): 0 | 1 => (open + unloaded + refused > 0 ? 1 : 0);

/** One answer of the box, and whether it was read from a saved run (and when that run was saved, in ms) or made now. */
export type Run = { readonly summary: Summary; readonly reused: boolean; readonly savedAt: number | null };

/** What `judge`'s line is given: where to look again for a run saved while it waited, and what to do once it is its turn. */
type Turn<E, R> = {
  readonly saved: Effect.Effect<Option.Option<Run>, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path>;
  readonly use: Effect.Effect<
    Option.Option<Run>,
    E | PlatformError.PlatformError | Schema.SchemaError,
    R | FileSystem.FileSystem | Path.Path
  >;
};

/**
 * The box's answer for a key and what it says of the answers, read now. A saved run is read first
 * and starts nothing. Else the run waits its turn in `line`, and at its turn `start` makes the answer
 * (none when the box was taken in that moment: the wait goes on), which is saved before the place in
 * line is given up, so a run waiting behind it for the same key finds it and starts no second box. The
 * `Survivor:` lines come after, on a saved run as on a new one, so a line written since the run counts.
 * Gives the mutants that lived and the ones still open.
 */
export const judge = <E, R, E2, R2>(ask: {
  readonly dir: string;
  readonly key: string;
  /** The days a saved run is kept. */
  readonly days: number;
  readonly answers: Effect.Effect<ReadonlyArray<Answer>, E, R>;
  readonly start: Effect.Effect<Option.Option<Summary>, E, R>;
  readonly line: (turn: Turn<E, R>) => Effect.Effect<Run, E2, R2>;
}) =>
  Effect.gen(function* () {
    const saved = Effect.map(
      Saved.find(ask.dir, ask.key),
      Option.map((entry): Run => ({ summary: entry.summary, reused: true, savedAt: entry.saved })),
    );

    const first = yield* saved;

    const use = Effect.flatMap(
      ask.start,
      Option.match({
        onNone: () => Effect.succeed(Option.none<Run>()),
        onSome: (summary) =>
          Effect.as(
            Saved.keep(ask.dir, ask.key, summary, ask.days),
            Option.some<Run>({ summary, reused: false, savedAt: null }),
          ),
      }),
    );

    const run = Option.isSome(first) ? first.value : yield* ask.line({ saved, use });
    const answers = yield* ask.answers;
    const lived = run.summary.b === null ? [] : [...run.summary.b.survivors, ...run.summary.b.uncovered];

    return {
      ...run,
      answers,
      lived,
      open: Arr.filter(lived, (row) => !isAnswered(answers, row.file, row.line)),
    };
  });

// ---------------------------------------------------------------- the run

/**
 * The recheck's part of the last line: the counts above are the capped run's, and this says how many of the mutants that lived there
 * died at full depth, so a reader sees both. Empty with no recheck. Pure.
 */
export const recheckText = (recheck: Summary["recheck"], runs: number | "full"): string =>
  recheck === null
    ? ""
    : `; rechecked at full depth: ${recheck.cleared.length} of the ${recheck.asked} that lived at ${runs} cases died there and are not listed, ${recheck.confirmed} lived there too${recheck.unreached > 0 ? ` (${recheck.unreached} not reached)` : ""}`;

/**
 * The type check's part of the last line (recheck.ts, ticket 1309): how many mutants the tests let live and `tsc` refused, which count as
 * kills and are not listed. Empty when none. Pure.
 */
export const typedText = (counts: Readonly<Record<string, number>>): string =>
  (counts["CompileError"] ?? 0) === 0
    ? ""
    : `; ${counts["CompileError"]} mutants do not type-check (CompileError) and count as kills, not listed`;

/** mutbox's flag for the run depth: the cap as `--runs <n>`, and none for `full`, which leaves each law its own count. Pure. */
export const runsFlag = (runs: number | "full"): ReadonlyArray<string> =>
  runs === "full" ? [] : ["--runs", String(runs)];

/** The scripts whose text is in a saved run's key, beside this one: what makes the box's answer. */
const SCRIPTS = [
  "survivors.ts",
  "scope.ts",
  "sample.ts",
  "limit.ts",
  "heartbeat.ts",
  "run.sh",
  "depth.ts",
  "depth.arbitrary.ts",
  "depth.config.ts",
  "../../lead/scripts/mutbox.ts",
  "../../lead/scripts/mutbox.Dockerfile",
  "../../lead/scripts/mutbox-entry.sh",
];

const git = (root: string, args: ReadonlyArray<string>, env: ReadonlyArray<string> = []) =>
  bounded("env", [...env, "git", "-C", root, ...args], DOCKER_SECONDS.call);

/** One git answer's text, or a refusal naming the command. */
const ok = Effect.fnUntraced(function* (root: string, args: ReadonlyArray<string>, env: ReadonlyArray<string> = []) {
  const got = yield* git(root, args, env);

  if (got.code !== 0) {
    return yield* Refused.make({ detail: `git ${Arr.join(args.slice(0, 2), " ")} failed: ${Str.trim(got.err)}` });
  }

  return got.out;
});

/** The text of the file `--answers` names; a file that cannot be read is a refusal naming it. */
const readAnswerText = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* fs
    .readFileString(path.resolve(file))
    .pipe(Effect.mapError(() => Refused.make({ detail: `--answers names no readable file: ${file}` })));
});

/** The `Survivor:` lines of the file `--answers` names; a file that cannot be read is a refusal naming it. */
export const readAnswers = (file: string) => Effect.map(readAnswerText(file), answersIn);

const z = (text: string) => Arr.filter(Str.split(text, "\0"), (s) => s !== "");

/** Fixed names and dates: the same trees give the same commits, and no person's name is written. */
const MAKER = [
  "GIT_AUTHOR_NAME=survivors",
  "GIT_AUTHOR_EMAIL=survivors@localhost",
  "GIT_AUTHOR_DATE=2000-01-01T00:00:00Z",
  "GIT_COMMITTER_NAME=survivors",
  "GIT_COMMITTER_EMAIL=survivors@localhost",
  "GIT_COMMITTER_DATE=2000-01-01T00:00:00Z",
];

/** Each file's blob in a tree, from `git ls-tree`. */
const blobs = Effect.fnUntraced(function* (root: string, tree: string, files: ReadonlyArray<string>) {
  const listed = yield* ok(root, ["ls-tree", "-z", tree, "--", ...files]);

  return Rec.fromEntries(
    Arr.flatMap(z(listed), (line) => {
      const found = /^(\d+) blob ([0-9a-f]+)\t(.*)$/s.exec(line);

      return found === null ? [] : [[found[3] ?? "", { mode: found[1] ?? "", id: found[2] ?? "" }] as const];
    }),
  );
});

const Manifest = Schema.Struct({
  name: Schema.optional(Schema.String),
  exports: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

/** The laws that load the files, the tests left out, and the files no law loads. */
const lawsFor = Effect.fnUntraced(function* (
  root: string,
  tree: string,
  list: ReadonlyArray<string>,
  files: ReadonlyArray<string>,
) {
  const set = new Set(list);
  const folders = unique(Arr.map(files, (file) => lawFolder(file, set)));
  const { tests, left } = testsIn(folders, list);
  const sources = new Map<string, string>();

  const show = Effect.fnUntraced(function* (file: string) {
    const known = sources.get(file);

    if (known !== undefined) {
      return known;
    }

    const got = yield* git(root, ["show", `${tree}:${file}`]);
    const text = got.code === 0 ? got.out : "";
    sources.set(file, text);

    return text;
  });

  const owns = new Map<string, Own>();

  for (const folder of folders) {
    const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(Manifest))(
      yield* show(`${folder}/package.json`),
    ).pipe(Effect.orElseSucceed(() => null));

    if (manifest?.name !== undefined) {
      owns.set(folder, {
        folder,
        name: manifest.name,
        exports: Rec.filter(manifest.exports ?? {}, Predicate.isString),
      });
    }
  }

  // Every edge the walk can take, read once per file: JavaScript and TypeScript only.
  const edges = new Map<string, ReadonlyArray<string>>();
  const queue = [...tests, ...Arr.map(left, (test) => test.path)];

  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (!edges.has(file)) {
      const source = yield* show(file);
      const own = Arr.findFirst([...owns.values()], (o) => under(o.folder, file)).pipe(Option.getOrNull);

      const named = yield* Effect.try({ try: () => [...loads(file, source)], catch: () => "unparsed" }).pipe(
        Effect.orElseSucceed((): ReadonlyArray<string> => []),
      );

      const next = Arr.filter(
        Arr.flatMap(named, (specifier) => {
          const path = resolve(file, specifier, set, own);

          return path === null ? [] : [path];
        }),
        (path) => /\.[cm]?[jt]sx?$/.test(path),
      );

      edges.set(file, next);
      queue.push(...next);
    }
  }

  const step = (file: string) => edges.get(file) ?? [];
  const { laws, imported, named, bare } = picked(files, reach(tests, step), tests);

  // A test left out is named only when it loads a file in scope: those are the laws that did not run.
  const missed = coverage(
    files,
    reach(
      Arr.map(left, (test) => test.path),
      step,
    ),
  ).laws;

  return { laws, imported, named, bare, left: Arr.filter(left, (test) => Arr.contains(missed, test.path)), show };
});

/** The tree of the working tree as `git add -A` would take it, through an index of our own. */
const workingTree = Effect.fnUntraced(function* (root: string, index: string) {
  const env = [`GIT_INDEX_FILE=${index}`];
  yield* ok(root, ["read-tree", "HEAD"], env);
  yield* ok(root, ["add", "-A"], env);

  return Str.trim(yield* ok(root, ["write-tree"], env));
});

const Ask = {
  out: Flag.String("out").pipe(Flag.withDescription("Your scratch folder; mutbox's answer lands here")),
  base: Flag.String("base").pipe(
    Flag.withDescription("Where the change starts; none is the merge base with origin/main"),
    Flag.withDefault(undefined),
  ),
  head: Flag.String("head").pipe(
    Flag.withDescription("The commit to check; none is the working tree"),
    Flag.withDefault(undefined),
  ),
  files: Flag.String("files").pipe(
    Flag.withDescription("Product files to mutate, separated by commas, as the plan names them"),
    Flag.withDefault(undefined),
  ),
  answered: Flag.Boolean("answered").pipe(
    Flag.withDescription("Count each mutant a Survivor: line of the commit bodies, base to head, answers"),
    Flag.withDefault(false),
  ),
  answers: Flag.String("answers").pipe(
    Flag.withDescription("A file of Survivor: lines that answer mutants too, such as the commit body to be written"),
    Flag.withDefault(undefined),
  ),
};

/**
 * What a call looks at, from git: the base commit, the head's whole tree (the working tree as `git add -A`
 * would take it when no head is named), the files to mutate, and the key of a saved run. The key holds the
 * whole tree, not only the files to mutate: a change to a law alone changes the answer, and a law is not a
 * product file.
 */
export const scope = Effect.fnUntraced(function* (
  root: string,
  ask: {
    readonly base: string | undefined;
    readonly head: string | undefined;
    readonly files: string | undefined;
    readonly index: string;
    readonly cap: number;
    readonly version: string;
    readonly seconds: number;
    readonly runs: number | "full";
  },
) {
  const base = Str.trim(
    ask.base === undefined
      ? yield* ok(root, ["merge-base", "origin/main", "HEAD"])
      : yield* ok(root, ["rev-parse", "--verify", `${ask.base}^{commit}`]),
  );

  const tree =
    ask.head === undefined
      ? yield* workingTree(root, ask.index)
      : Str.trim(yield* ok(root, ["rev-parse", "--verify", `${ask.head}^{tree}`]));

  const list = z(yield* ok(root, ["ls-tree", "-r", "-z", "--name-only", tree]));

  const touched = z(
    yield* ok(root, ["diff", "--name-only", "--no-renames", "--diff-filter=d", "-z", base, tree, "--"]),
  );

  const named =
    ask.files === undefined
      ? null
      : Arr.filter(
          Arr.map(Str.split(ask.files, ","), (file) => Str.trim(file)),
          (file) => file !== "",
        );

  const files = yield* Effect.fromResult(pick({ changed: touched, named, tree: new Set(list), cap: ask.cap }));

  return {
    base,
    tree,
    list,
    files,
    key: Saved.key({ base, tree, files, version: ask.version, seconds: ask.seconds, runs: ask.runs }),
  };
});

const check = Effect.fnUntraced(function* (ask: {
  readonly out: string;
  readonly base: string | undefined;
  readonly head: string | undefined;
  readonly files: string | undefined;
  readonly answered: boolean;
  readonly answers: string | undefined;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const started = yield* Clock.currentTimeMillis;

  const { seconds, cap, wait, days, runs } = yield* Effect.mapError(
    Effect.gen(function* () {
      return { seconds: yield* SECONDS, cap: yield* FILES, wait: yield* WAIT, days: yield* KEEP, runs: yield* RUNS };
    }),
    () =>
      Refused.make({
        detail:
          "MUTATE_SECONDS, MUTATE_FILES, MUTATE_WAIT_SECONDS, MUTATE_KEEP_DAYS and MUTATE_RUNS are whole numbers, 1 or more, when set (MUTATE_RUNS may be `full` too)",
      }),
  );

  const root = Str.trim(yield* ok(".", ["rev-parse", "--show-toplevel"]));
  const out = path.resolve(ask.out);
  yield* fs.makeDirectory(out, { recursive: true });

  // The key's scripts: what makes the box's answer.
  const version = Saved.version(
    yield* Effect.forEach(
      SCRIPTS,
      (name) => fs.readFileString(path.join(import.meta.dirname, name)).pipe(Effect.map((text) => ({ name, text }))),
      { concurrency: 1 },
    ),
  );

  const { base, tree, list, files, key } = yield* scope(root, {
    base: ask.base,
    head: ask.head,
    files: ask.files,
    index: path.join(out, "index"),
    cap,
    version,
    seconds,
    runs,
  });

  // Read again after the box answers, so a Survivor: line written while the run waited counts. Read once
  // now too: a --answers file that cannot be read is refused before any wait.
  const texts = Effect.gen(function* () {
    return [
      ...(ask.answered
        ? [oldestFirst(yield* ok(root, ["log", "--format=%B%x00", `${base}..${ask.head ?? "HEAD"}`]))]
        : []),
      ...(ask.answers === undefined ? [] : [yield* readAnswerText(ask.answers)]),
    ];
  });

  // One text, oldest first and the answers file last (the commit about to be written), so the newest row of a place wins.
  const current = Effect.map(texts, (all) => answersIn(Arr.join(all, "\n")));
  const answers = yield* current;

  // A `Survivor:` line with no plant, search or law in its evidence answers nothing, and is named: the build fixes the line.
  const refused = refusedIn(Arr.join(yield* texts, "\n"));

  for (const line of refused) {
    yield* Console.log(
      `refused  ${line}  (its evidence names no plant:, rg: or law:; re-answer it with proof in an empty commit: \`stepcommit.sh --empty <step> ...\`)`,
    );
  }

  if (files.length === 0) {
    yield* Console.log("survivors: no product file changed between base and head, so nothing to mutate");

    return yield* Effect.sync(() => {
      process.exitCode = exitCode(0, 0, refused.length);
    });
  }

  yield* Console.log(`survivors: ${files.length} files in scope: ${Arr.join(files, ", ")}`);
  const { laws, imported, named, bare, left, show } = yield* lawsFor(root, tree, list, files);

  for (const test of left) {
    yield* Console.log(`left out  ${test.path}: ${test.reason}`);
  }

  const unloaded = Arr.filter(bare, (file) => !isAnswered(answers, file, null));

  if (laws.length === 0) {
    for (const file of unloaded) {
      yield* Console.log(`no law loads  ${file}: every mutant there lives`);
    }

    return yield* Effect.sync(() => {
      process.exitCode = exitCode(0, unloaded.length, refused.length);
    });
  }

  yield* Console.log(`survivors: ${laws.length} laws: ${Arr.join(laws, ", ")}`);
  yield* Console.log(`  by import (${imported.length}): ${Arr.join(imported, ", ")}`);
  yield* Console.log(`  by name (${named.length}): ${Arr.join(named, ", ")}`);

  // The parent: the head's tree, with each file in scope at its base version, or gone.
  const index = path.join(out, "parent-index");
  const env = [`GIT_INDEX_FILE=${index}`];
  yield* ok(root, ["read-tree", tree], env);

  for (const entry of parentEntries(files, yield* blobs(root, base, files), yield* blobs(root, tree, files))) {
    yield* entry.blob === null
      ? ok(root, ["update-index", "--force-remove", "--", entry.path], env)
      : ok(root, ["update-index", "--cacheinfo", `${entry.blob.mode},${entry.blob.id},${entry.path}`], env);
  }

  const parentTree = Str.trim(yield* ok(root, ["write-tree"], env));

  const parent = Str.trim(
    yield* ok(root, ["commit-tree", parentTree, "-m", "survivors: the base of the files in scope"], MAKER),
  );

  const build = Str.trim(yield* ok(root, ["commit-tree", tree, "-p", parent, "-m", "survivors: the head"], MAKER));
  const common = Str.trim(yield* ok(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const boxes = Option.getOrElse(yield* BOXES, () => path.join(path.dirname(path.dirname(common)), "boxes"));
  const lock = path.join(boxes, "state", "docker.lock");
  yield* fs.makeDirectory(path.dirname(lock), { recursive: true });

  const mutbox = path.join(import.meta.dirname, "..", "..", "lead", "scripts", "mutbox.ts");

  const queue: Line = {
    dir: path.join(boxes, "state", "docker.queue"),
    pid: process.pid,
    label: `${path.basename(root)} ${pipe(tree, Str.slice(0, 7))}`,
    holder: heldBy(lock),
    alive,
    say: (note) => Console.log(`survivors: ${noteLine(note)}`),
    poll: 5,
    every: 60,
    limit: wait,
  };

  // mutbox bounds its own Docker calls; this bound is a backstop past its image build and its run.
  // A box taken in that moment by a run with no place in line is none: the wait goes on.
  const start = Effect.gen(function* () {
    const ran = yield* bounded(
      "nice",
      [
        "-n",
        "15",
        process.execPath,
        mutbox,
        "run",
        "--checkout",
        root,
        "--ticket",
        "0",
        "--build",
        build,
        "--related",
        Arr.join(laws, ","),
        "--out",
        out,
        "--lock",
        lock,
        "--cap",
        String(seconds),
        ...runsFlag(runs),
      ],
      secondsFor(false, seconds, runs !== "full") + DOCKER_SECONDS.build + 6 * DOCKER_SECONDS.call,
    );

    const answer = yield* Schema.decodeEffect(Schema.fromJsonString(Summary))(
      Str.trim(
        (yield* fs.readFileString(path.join(out, "mutbox.json")).pipe(Effect.orElseSucceed(() => ""))) || ran.out,
      ),
    ).pipe(
      Effect.mapError(() =>
        Refused.make({ detail: `mutbox left no answer (exit ${ran.code}): ${Str.trim(ran.err).slice(-400)}` }),
      ),
    );

    return answer.outcome === "stuck" && answer.reason === "docker_busy" ? Option.none() : Option.some(answer);
  });

  const judged = yield* judge({
    dir: path.join(boxes, "state", "gate"),
    key,
    days,
    answers: current,
    start,
    line: ({ saved, use }) => inLine(queue, saved, use),
  });

  const { summary } = judged;
  const took = Math.round(((yield* Clock.currentTimeMillis) - started) / 1000);

  if (summary.outcome === "stuck") {
    return yield* Refused.make({
      detail: `the mutation box is stuck, ${summary.reason}: ${summary.detail} (see ${path.join(out, "mutbox.json")})`,
    });
  }

  for (const test of summary.excluded) {
    yield* Console.log(`left out  ${test.path}: ${test.reason}`);
  }

  for (const test of summary.skipped) {
    yield* Console.log(`skipped itself  ${test}`);
  }

  if (summary.outcome === "skip" || summary.b === null) {
    return yield* Console.log(`survivors: nothing to judge, ${summary.reason}: ${summary.detail} (${took} s)`);
  }

  const sources = new Map<string, string>();

  for (const file of unique(Arr.map([...summary.b.survivors, ...summary.b.uncovered], (row) => row.file))) {
    sources.set(file, yield* show(file));
  }

  const { lived, open } = judged;
  const unanswered = Arr.filter(bare, (file) => !isAnswered(judged.answers, file, null));
  const explained = lived.length - open.length + bare.length - unanswered.length;

  const lines = [
    ...Arr.map(unanswered, (file) => `no law loads  ${file}: every mutant there lives`),
    ...survivorLines(open, (file) => sources.get(file) ?? ""),
  ];

  for (const line of [...lines, ...staticLines(summary.b.ignored)]) {
    yield* Console.log(line);
  }

  const counts = Arr.join(
    Arr.map(Rec.toEntries(summary.b.counts), ([status, n]) => `${status} ${n}`),
    ", ",
  );

  yield* Console.log(
    Arr.join(
      [
        `survivors: ${lines.length} to kill or explain; ${counts}`,
        typedText(summary.b.counts),
        recheckText(summary.recheck, runs),
        explained > 0 ? `; ${explained} answered by a Survivor: line` : "",
        summary.sample === null ? "" : `; ${summary.sample.selected} of ${summary.sample.total} mutants sampled`,
        runs === "full" ? "" : `; property laws drew at most ${runs} cases (MUTATE_RUNS)`,
        summary.reach === null ? "" : `; ${summary.reach}`,
        summary.b.unreached > 0
          ? `; the ${seconds} s budget (MUTATE_SECONDS) ran out with ${summary.b.unreached} sampled mutants not reached`
          : "",
        judged.savedAt === null
          ? ""
          : `; a run saved ${new Date(judged.savedAt).toISOString()} for the same base, tree and files was reused, and no box was started`,
        `; ${took} s`,
      ],
      "",
    ),
  );

  yield* Effect.sync(() => {
    process.exitCode = exitCode(open.length, unanswered.length, refused.length);
  });
});

/** A refusal's one line on stderr, and exit 2. */
const refuse = (line: string) =>
  Console.error(`survivors: ${line}`).pipe(
    Effect.andThen(
      Effect.sync(() => {
        process.exitCode = 2;
      }),
    ),
  );

const survivors = Command.make("survivors", Ask, (ask) =>
  check(ask).pipe(
    Effect.catchTags({
      Refused: (refused) => refuse(`refused: ${refused.detail}`),
      CallTimeout: (timeout) => refuse(`${timeout.command} passed its ${timeout.seconds} s bound and was stopped`),
      Waited: (waited) =>
        refuse(`waited ${waited.seconds} s in line for the mutation box (MUTATE_WAIT_SECONDS), and gave up its place`),
    }),
  ),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(survivors, { version: "0.0.0" })(process.argv.slice(2)).pipe(Effect.provide(NodeServices.layer)),
  );
}
