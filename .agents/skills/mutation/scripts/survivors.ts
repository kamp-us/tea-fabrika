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
// - `--answered` takes each `Survivor: <file>:<line> <reason>` line of the commit bodies from `--base` to
//   `--head` (HEAD when none) as the answer to the mutant on that line; `<file>:*` answers a file no law loads
//   or every mutant of a file. A line has its evidence after ` -- `: `Survivor: <file>:<line> <reason> -- <the
//   input or plant tried and why it cannot reach the line, or why the mutant is equivalent>`. A line with no
//   evidence, or one bare word of it ("unreachable"), answers nothing. `--answers` names a file of such lines too, such as the commit body about to be
//   written. An answered mutant is counted and no longer listed, so exit 0 says every survivor is killed or
//   answered. Without either flag no line is read and a mutant that lived is always listed.
// - `--out` is your scratch folder; mutbox's whole answer is `<out>/mutbox.json`.
//
// Settings, each from the environment with its default, as the lead's other settings are read:
//
//   MUTATE_SECONDS  300  how long Stryker may test mutants: run.sh's cap, in whole seconds
//   MUTATE_FILES    8    the most product files one run takes; more is refused, naming the count
//   BOXES           the boxes folder beside the main checkout, as env.sh finds it; the one Docker
//                   box's lock is `<BOXES>/state/docker.lock`
//
// Exit 0: no mutant lived, or each one that did is answered. 1: a mutant lived, or a file in scope has no
// law that loads it, and no `Survivor:` line answers it; each is one line. 2: refused before the run (too wide, a bad `--files`), or the box is stuck.
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
import { Command, Flag } from "effect/cli";
import { bounded, DOCKER_SECONDS, loads, secondsFor, Summary } from "../../lead/scripts/mutbox.ts";
import { inScope, product } from "./scope.ts";

// ---------------------------------------------------------------- the settings

const AtLeastOne = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** How long Stryker may test mutants, in seconds: run.sh's cap inside the box. */
const SECONDS = Config.schema(AtLeastOne, "MUTATE_SECONDS").pipe(Config.withDefault(300));

/** The most product files one run takes. */
const FILES = Config.schema(AtLeastOne, "MUTATE_FILES").pipe(Config.withDefault(8));

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
 * shows why. `line` is null for `<file>:*`.
 */
export type Answer = { readonly file: string; readonly line: number | null };

const ANSWER = /^Survivor:[ \t]+(\S+):(\d+|\*)[ \t]+\S.*?[ \t]+--[ \t]+\S+[ \t]+\S/;

/** The `Survivor:` lines of a text; a line with no reason, or with no evidence of at least two words, is no answer. Pure. */
export const answersIn = (text: string): ReadonlyArray<Answer> =>
  Arr.flatMap(Str.split(text, "\n"), (row) => {
    const found = ANSWER.exec(row);

    return found === null ? [] : [{ file: found[1] ?? "", line: found[2] === "*" ? null : Number(found[2]) }];
  });

/** Whether a mutant on a line, or a file no law loads (`line` null), has an answer. Pure. */
export const isAnswered = (answers: ReadonlyArray<Answer>, file: string, line: number | null): boolean =>
  Arr.some(answers, (answer) => answer.file === file && (answer.line === null || answer.line === line));

// ---------------------------------------------------------------- the run

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
  const { laws, bare } = coverage(files, reach(tests, step));

  // A test left out is named only when it loads a file in scope: those are the laws that did not run.
  const missed = coverage(
    files,
    reach(
      Arr.map(left, (test) => test.path),
      step,
    ),
  ).laws;

  return { laws, bare, left: Arr.filter(left, (test) => Arr.contains(missed, test.path)), show };
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

  const { seconds, cap } = yield* Effect.mapError(
    Effect.gen(function* () {
      return { seconds: yield* SECONDS, cap: yield* FILES };
    }),
    () => Refused.make({ detail: "MUTATE_SECONDS and MUTATE_FILES are whole numbers, 1 or more, when set" }),
  );

  const root = Str.trim(yield* ok(".", ["rev-parse", "--show-toplevel"]));
  const out = path.resolve(ask.out);
  yield* fs.makeDirectory(out, { recursive: true });

  const base = Str.trim(
    ask.base === undefined
      ? yield* ok(root, ["merge-base", "origin/main", "HEAD"])
      : yield* ok(root, ["rev-parse", "--verify", `${ask.base}^{commit}`]),
  );

  const tree =
    ask.head === undefined
      ? yield* workingTree(root, path.join(out, "index"))
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

  const files = yield* Effect.fromResult(pick({ changed: touched, named, tree: new Set(list), cap }));

  const answers = [
    ...(ask.answered ? answersIn(yield* ok(root, ["log", "--format=%B", `${base}..${ask.head ?? "HEAD"}`])) : []),
    ...(ask.answers === undefined
      ? []
      : answersIn(
          yield* fs
            .readFileString(path.resolve(ask.answers))
            .pipe(Effect.mapError(() => Refused.make({ detail: `--answers names no readable file: ${ask.answers}` }))),
        )),
  ];

  if (files.length === 0) {
    return yield* Console.log("survivors: no product file changed between base and head, so nothing to mutate");
  }

  yield* Console.log(`survivors: ${files.length} files in scope: ${Arr.join(files, ", ")}`);
  const { laws, bare, left, show } = yield* lawsFor(root, tree, list, files);

  for (const test of left) {
    yield* Console.log(`left out  ${test.path}: ${test.reason}`);
  }

  const unloaded = Arr.filter(bare, (file) => !isAnswered(answers, file, null));

  if (laws.length === 0) {
    for (const file of unloaded) {
      yield* Console.log(`no law loads  ${file}: every mutant there lives`);
    }

    return yield* Effect.sync(() => {
      process.exitCode = unloaded.length > 0 ? 1 : 0;
    });
  }

  yield* Console.log(`survivors: ${laws.length} laws: ${Arr.join(laws, ", ")}`);

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

  // mutbox bounds its own Docker calls; this bound is a backstop past its image build and its run.
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
    ],
    secondsFor(false, seconds) + DOCKER_SECONDS.build + 6 * DOCKER_SECONDS.call,
  );

  const summary = yield* Schema.decodeEffect(Schema.fromJsonString(Summary))(
    Str.trim((yield* fs.readFileString(path.join(out, "mutbox.json")).pipe(Effect.orElseSucceed(() => ""))) || ran.out),
  ).pipe(
    Effect.mapError(() =>
      Refused.make({ detail: `mutbox left no answer (exit ${ran.code}): ${Str.trim(ran.err).slice(-400)}` }),
    ),
  );

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

  const lived = [...summary.b.survivors, ...summary.b.uncovered];
  const open = Arr.filter(lived, (row) => !isAnswered(answers, row.file, row.line));
  const explained = lived.length - open.length + bare.length - unloaded.length;

  const lines = [
    ...Arr.map(unloaded, (file) => `no law loads  ${file}: every mutant there lives`),
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
        explained > 0 ? `; ${explained} answered by a Survivor: line` : "",
        summary.sample === null ? "" : `; ${summary.sample.selected} of ${summary.sample.total} mutants sampled`,
        summary.reach === null ? "" : `; ${summary.reach}`,
        summary.b.unreached > 0
          ? `; the ${seconds} s budget (MUTATE_SECONDS) ran out with ${summary.b.unreached} sampled mutants not reached`
          : "",
        `; ${took} s`,
      ],
      "",
    ),
  );

  if (lines.length > 0) {
    yield* Effect.sync(() => {
      process.exitCode = 1;
    });
  }
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
    }),
  ),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(survivors, { version: "0.0.0" })(process.argv.slice(2)).pipe(Effect.provide(NodeServices.layer)),
  );
}
