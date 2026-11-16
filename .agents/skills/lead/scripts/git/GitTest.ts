// GitTest.layer: the Git service in memory, answering from one model of a repository: its commits,
// each a map from path to text, and its refs. `workTree` gives the files HEAD checks out, as a
// FileSystem, so a port that reads both git and the work tree runs with no process and no disk.
//
// The model answers only the calls it can answer the way git does; any other call fails with
// GitError, never with an empty answer. git.integration.test.ts holds it to real git on small real
// repositories, so the model stays honest as later slices add calls.
import { Effect, FileSystem, Layer } from "effect";
import { Git, GitError } from "./Git.ts";

/** One commit's files: each path from the top, and its text. */
export type Tree = Readonly<Record<string, string>>;

/** One commit: its parents, by sha, and its files. */
export type Commit = { readonly parents: ReadonlyArray<string>; readonly tree: Tree };

export type Model = {
  /** What `rev-parse --show-toplevel` prints: the repository's top folder. */
  readonly top: string;
  /** Every commit, by sha. */
  readonly commits: Readonly<Record<string, Commit>>;
  /** Each ref, `HEAD` included, and the sha it names. */
  readonly refs: Readonly<Record<string, string>>;
};

/** The sha a ref or a sha names, or `undefined` when the model has neither. */
const resolve = (model: Model, name: string): string | undefined =>
  model.refs[name] ?? (model.commits[name] === undefined ? undefined : name);

/** Every commit `sha` reaches, itself first, nearest first. */
const ancestry = (model: Model, sha: string): ReadonlyArray<string> => {
  const seen: Array<string> = [];
  const queue = [sha];

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (!seen.includes(next)) {
      seen.push(next);
      queue.push(...(model.commits[next]?.parents ?? []));
    }
  }

  return seen;
};

/** The nearest commit both reach, found from `b`'s side, as `a...b` takes it. */
const mergeBase = (model: Model, a: string, b: string): string | undefined => {
  const fromA = new Set(ancestry(model, a));
  return ancestry(model, b).find((sha) => fromA.has(sha));
};

/** A file's lines, without the empty one after its last newline. */
const splitLines = (text: string): ReadonlyArray<string> => {
  const lines = text.split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
};

/**
 * One file's change as `git diff --unified=0` writes its header and its changed lines. The model
 * trims the lines both sides share at the start and at the end, and calls the rest removed and added.
 * That is git's answer whenever a change appends lines or swaps every line; the hunk header carries
 * no positions, so a reader of positions is not served by this model.
 */
const fileDiff = (path: string, was: string | undefined, now: string | undefined): ReadonlyArray<string> => {
  const old = was === undefined ? [] : splitLines(was);
  const fresh = now === undefined ? [] : splitLines(now);
  let start = 0;

  while (start < old.length && start < fresh.length && old[start] === fresh[start]) {
    start += 1;
  }

  let end = 0;

  while (
    end < old.length - start &&
    end < fresh.length - start &&
    old[old.length - 1 - end] === fresh[fresh.length - 1 - end]
  ) {
    end += 1;
  }

  const removed = old.slice(start, old.length - end).map((line) => `-${line}`);
  const added = fresh.slice(start, fresh.length - end).map((line) => `+${line}`);
  return [
    `diff --git a/${path} b/${path}`,
    ...(was === undefined ? ["new file mode 100644"] : now === undefined ? ["deleted file mode 100644"] : []),
    was === undefined ? "--- /dev/null" : `--- a/${path}`,
    now === undefined ? "+++ /dev/null" : `+++ b/${path}`,
    "@@ @@",
    ...removed,
    ...added,
  ];
};

/** The diff from one tree to another, its files in path order. */
const treeDiff = (from: Tree, to: Tree): string => {
  const paths = [...new Set([...Object.keys(from), ...Object.keys(to)])].toSorted();
  const lines = paths.flatMap((path) => (from[path] === to[path] ? [] : fileDiff(path, from[path], to[path])));
  return lines.map((line) => `${line}\n`).join("");
};

/** The range a `diff` call names, `a...b` or `a..b`, and the options the model answers. */
const RANGE = /^([^.\s]+)(\.\.\.?)([^.\s]+)$/;
const OPTIONS = new Set(["--unified=0"]);

const answerDiff = (model: Model, args: ReadonlyArray<string>): Effect.Effect<string, GitError> => {
  const ranges = args.filter((arg) => !OPTIONS.has(arg));
  const range = ranges.length === 1 ? RANGE.exec(ranges[0] ?? "") : null;

  if (range === null) {
    return Effect.fail(new GitError({ command: "diff", reason: `the model does not answer diff ${args.join(" ")}` }));
  }

  const [, left = "", dots, right = ""] = range;
  const a = resolve(model, left);
  const b = resolve(model, right);

  if (a === undefined || b === undefined) {
    return Effect.fail(new GitError({ command: "diff", reason: `unknown revision ${a === undefined ? left : right}` }));
  }

  const from = dots === "..." ? mergeBase(model, a, b) : a;

  if (from === undefined) {
    return Effect.fail(new GitError({ command: "diff", reason: `no merge base for ${left} and ${right}` }));
  }

  return Effect.succeed(treeDiff(model.commits[from]?.tree ?? {}, model.commits[b]?.tree ?? {}));
};

export const layer = (model: Model): Layer.Layer<Git> =>
  Layer.succeed(
    Git,
    Git.of({
      top: Effect.succeed(model.top),
      diff: (args) => answerDiff(model, args),
    }),
  );

/** What a read outside the work tree answers: the no-op FileSystem's own NotFound. */
const nothing = FileSystem.makeNoop({});

/** The files HEAD checks out under `model.top`, as a FileSystem that reads them and writes nothing. */
export const workTree = (model: Model): Layer.Layer<FileSystem.FileSystem> => {
  const head = resolve(model, "HEAD");
  const tree = (head === undefined ? undefined : model.commits[head]?.tree) ?? {};
  const files = new Map(Object.entries(tree).map(([path, text]) => [`${model.top}/${path}`, text]));
  const clean = (path: string) => path.replace(/\/+$/, "");
  const children = (path: string) => {
    const folder = `${clean(path)}/`;
    return [
      ...new Set(
        [...files.keys()]
          .filter((file) => file.startsWith(folder))
          .map((file) => file.slice(folder.length).split("/")[0] ?? ""),
      ),
    ];
  };
  const isFolder = (path: string) => children(path).length > 0;
  const read = (path: string) => {
    const text = files.get(clean(path));
    return text === undefined ? nothing.readFileString(path) : Effect.succeed(text);
  };

  return FileSystem.layerNoop({
    exists: (path) => Effect.succeed(files.has(clean(path)) || isFolder(path)),
    readDirectory: (path) => (isFolder(path) ? Effect.succeed(children(path)) : nothing.readDirectory(path)),
    readFileString: read,
    readFile: (path) => Effect.map(read(path), (text) => new TextEncoder().encode(text)),
  });
};
