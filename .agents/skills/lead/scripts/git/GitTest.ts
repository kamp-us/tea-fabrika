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

/** Every commit `sha` reaches, itself included. */
const ancestry = (model: Model, sha: string): ReadonlySet<string> => {
  const seen = new Set<string>();
  const queue = [sha];

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (!seen.has(next)) {
      seen.add(next);
      queue.push(...(model.commits[next]?.parents ?? []));
    }
  }

  return seen;
};

/**
 * The best common ancestors of `a` and `b`, as `git merge-base --all` names them: the commits both
 * reach that no other commit both reach has as an ancestor. `a...b` diffs from the one there is;
 * with none or with several, the model does not answer.
 */
const mergeBases = (model: Model, a: string, b: string): ReadonlyArray<string> => {
  const fromA = ancestry(model, a);
  const common = [...ancestry(model, b)].filter((sha) => fromA.has(sha));

  return common.filter((sha) => !common.some((other) => other !== sha && ancestry(model, other).has(sha)));
};

/** A file's lines, when the model knows its shape: not empty, and ending in a newline. */
const splitLines = (text: string | undefined): ReadonlyArray<string> | undefined =>
  text === undefined ? [] : text === "" || !text.endsWith("\n") ? undefined : text.slice(0, -1).split("\n");

/** How many lines the two lists share, each line counted as often as both hold it. */
const shared = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): number => {
  const left = new Map<string, number>();

  for (const line of a) {
    left.set(line, (left.get(line) ?? 0) + 1);
  }

  let count = 0;

  for (const line of b) {
    const n = left.get(line) ?? 0;

    if (n > 0) {
      left.set(line, n - 1);
      count += 1;
    }
  }

  return count;
};

/**
 * One file's change as `git diff --unified=0` writes its header and its changed lines, or
 * `undefined` for a shape the model does not know. The model trims the lines both sides share at the
 * start and at the end, and calls the rest removed and added. It answers only when no other line is
 * shared: then every smallest diff, git's included, changes exactly those lines, as when a change
 * appends, inserts or removes lines in one place, or swaps every line. A moved or swapped line, an
 * empty file and a file without its last newline are not answered. The hunk header carries no
 * positions, so a reader of positions is not served by this model.
 */
const fileDiff = (
  path: string,
  was: string | undefined,
  now: string | undefined,
): ReadonlyArray<string> | undefined => {
  const old = splitLines(was);
  const fresh = splitLines(now);

  if (old === undefined || fresh === undefined) {
    return undefined;
  }

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

  if (shared(old, fresh) !== start + end) {
    return undefined;
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

/** The diff from one tree to another, its files in path order, or the first file it cannot answer. */
const treeDiff = (from: Tree, to: Tree): Effect.Effect<string, GitError> => {
  const paths = [...new Set([...Object.keys(from), ...Object.keys(to)])].toSorted();
  const lines: Array<string> = [];

  for (const path of paths) {
    const change = from[path] === to[path] ? [] : fileDiff(path, from[path], to[path]);

    if (change === undefined) {
      return Effect.fail(
        GitError.make({
          command: "diff",
          reason: `the model does not answer the change to ${path}: a shape it does not know`,
        }),
      );
    }

    lines.push(...change);
  }

  return Effect.succeed(lines.map((line) => `${line}\n`).join(""));
};

/** The range a `diff` call names, `a...b` or `a..b`, and the options the model answers. */
const RANGE = /^([^.\s]+)(\.\.\.?)([^.\s]+)$/;

const OPTIONS = new Set(["--unified=0"]);

const answerDiff = (model: Model, args: ReadonlyArray<string>): Effect.Effect<string, GitError> => {
  const ranges = args.filter((arg) => !OPTIONS.has(arg));
  const range = ranges.length === 1 ? RANGE.exec(ranges[0] ?? "") : null;

  if (range === null) {
    return Effect.fail(GitError.make({ command: "diff", reason: `the model does not answer diff ${args.join(" ")}` }));
  }

  const [, left = "", dots, right = ""] = range;
  const a = resolve(model, left);
  const b = resolve(model, right);

  if (a === undefined || b === undefined) {
    return Effect.fail(
      GitError.make({ command: "diff", reason: `unknown revision ${a === undefined ? left : right}` }),
    );
  }

  const bases = dots === "..." ? mergeBases(model, a, b) : [a];
  const [from] = bases;

  if (from === undefined || bases.length !== 1) {
    return Effect.fail(
      GitError.make({
        command: "diff",
        reason: `the model does not answer ${bases.length} merge bases for ${left} and ${right}`,
      }),
    );
  }

  return treeDiff(model.commits[from]?.tree ?? {}, model.commits[b]?.tree ?? {});
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
