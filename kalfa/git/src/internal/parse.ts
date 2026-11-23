// Reads what git prints: `cat-file --batch` and `--batch-check`, `for-each-ref`, `rev-list`, `merge-base` and `version`. Each reader is
// a pure function of the text or the bytes git printed and answers a Result, so the adapter decides what a failure means.
import { Result, Schema } from "effect";
import * as Commit from "../Commit.ts";
import { CommitId } from "../CommitId.ts";
import { PatchId } from "../Diff.ts";
import * as Ref from "../Ref.ts";
import * as Repository from "../Repository.ts";
import { Path, TreeId } from "../Tree.ts";
import { byBytes, OBJECT_ID } from "./object.ts";

const NEWLINE = 0x0a;

const SPACE = 0x20;

// Git's text is UTF-8 or it is not text: a byte that is not valid is a failure, never a replacement character. A leading BOM is kept.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const text = (bytes: Uint8Array): Result.Result<string, unknown> => Result.try(() => utf8.decode(bytes));

const unreadable = (problem: string): Repository.GitUnavailable =>
  new Repository.GitUnavailable({ reason: new Repository.Unreadable({ cause: new Error(problem) }) });

const commitId = (value: string, owner: string): Result.Result<CommitId, Repository.GitUnavailable> =>
  Result.mapError(Schema.decodeUnknownResult(CommitId)(value), () => unreadable(`${owner} is not a commit id`));

/**
 * What `cat-file --batch-check` says about one object that exists.
 *
 * @internal
 */
export interface Checked {
  readonly type: string;
  readonly size: number;
}

/**
 * Reads `cat-file --batch-check`: each object that exists, by id. An id git calls missing is left out.
 *
 * **Details**
 *
 * The id is any object's: a commit's, a tree's or a blob's.
 *
 * @internal
 */
export const checks = (output: string): Result.Result<ReadonlyMap<string, Checked>, Repository.GitUnavailable> =>
  Result.gen(function* () {
    const found = new Map<string, Checked>();

    for (const line of output.split("\n").filter((each) => each !== "")) {
      const [id, type, size, ...rest] = line.split(" ");

      if (type !== "missing") {
        const count = Number(size);

        if (id === undefined || type === undefined || rest.length > 0 || !Number.isSafeInteger(count)) {
          return yield* Result.fail(unreadable("a batch-check line has an unexpected form"));
        }

        found.set(yield* commitId(id, "a batch-check line"), { type, size: count });
      }
    }

    return found;
  });

/**
 * Reads a list of commit ids, one per line, as `rev-list` and `merge-base` print them.
 *
 * @internal
 */
export const ids = (output: string): Result.Result<ReadonlyArray<CommitId>, Repository.GitUnavailable> =>
  Result.all(
    output
      .split("\n")
      .filter((each) => each !== "")
      .map((line) => commitId(line, "a listed line")),
  );

const refName = (name: string): Result.Result<Ref.RefName, Repository.GitUnavailable> =>
  Result.mapError(Schema.decodeUnknownResult(Ref.RefName)(name), () =>
    unreadable("a for-each-ref line names a ref that is not a ref name"),
  );

/**
 * Reads `for-each-ref` printed as `%(objectname) %(refname)`: each ref with the id it points at, whatever the id is.
 *
 * **Details**
 *
 * It does not look at what a ref points at, so a symbolic ref or a ref at a tag is read like any other.
 *
 * @internal
 */
export const refIds = (
  output: string,
): Result.Result<ReadonlyArray<{ readonly id: string; readonly name: Ref.RefName }>, Repository.GitUnavailable> =>
  Result.all(
    output
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [id, name, ...rest] = line.split(" ");

        return id === undefined || name === undefined || rest.length > 0
          ? Result.fail(unreadable("a for-each-ref line has an unexpected form"))
          : Result.map(refName(name), (named) => ({ id, name: named }));
      }),
  );

/**
 * Reads `for-each-ref` printed as `%(objectname) %(objecttype) %(symref) %(refname)`.
 *
 * **Details**
 *
 * A ref that is symbolic or that points at a tag, a tree or a blob fails the whole read with `RefNotCommit`.
 *
 * @internal
 */
export const refs = (
  output: string,
): Result.Result<ReadonlyArray<Ref.Ref>, Repository.RefNotCommit | Repository.GitUnavailable> =>
  Result.gen(function* () {
    const read: Array<Ref.Ref> = [];

    for (const line of output.split("\n").filter((each) => each !== "")) {
      const parts = line.split(" ");
      const [id, type, symref, name] = parts;

      if (parts.length !== 4 || id === undefined || symref === undefined || name === undefined) {
        return yield* Result.fail(unreadable("a for-each-ref line has an unexpected form"));
      }

      const named = yield* refName(name);

      if (symref !== "") {
        return yield* Result.fail(new Repository.RefNotCommit({ ref: named, points: "symbolic" }));
      }

      if (type === "tag" || type === "tree" || type === "blob") {
        return yield* Result.fail(new Repository.RefNotCommit({ ref: named, points: type }));
      }

      if (type !== "commit") {
        return yield* Result.fail(unreadable("a for-each-ref line names an object of an unknown type"));
      }

      const ref = yield* Result.mapError(Schema.decodeUnknownResult(Ref.Ref)({ name, commit: id }), () =>
        unreadable("a for-each-ref line is not a commit's ref"),
      );

      read.push(ref);
    }

    return read;
  });

/**
 * What `merge-tree --write-tree --no-messages --name-only -z` printed: the merged tree, and each conflicting path once, sorted by UTF-8 bytes.
 *
 * @internal
 */
export interface MergeTree {
  readonly tree: TreeId;
  readonly paths: ReadonlyArray<Path>;
}

/**
 * Reads the output of `merge-tree -z`: the tree's id and then each conflicting path, every one ended by a NUL byte.
 *
 * **Details**
 *
 * The text is split on NUL and never on line breaks, since a path may hold one. Output that holds no tree, or that does not end in a NUL, is unreadable.
 *
 * @internal
 */
export const mergeTree = (output: string): Result.Result<MergeTree, Repository.GitUnavailable> =>
  Result.gen(function* () {
    if (!output.endsWith("\0")) {
      return yield* Result.fail(unreadable("merge-tree printed no tree"));
    }

    const [first, ...rest] = output.slice(0, -1).split("\0");

    const tree = yield* Result.mapError(Schema.decodeUnknownResult(TreeId)(first), () =>
      unreadable("merge-tree printed a tree that is no tree id"),
    );

    const paths = yield* Result.all(
      rest.map((path) =>
        Result.mapError(Schema.decodeUnknownResult(Path)(path), () =>
          unreadable("merge-tree named a path that is no path of a tree"),
        ),
      ),
    );

    return { tree, paths: [...new Set(paths)].sort(byBytes) };
  });

/**
 * A git version, as the numbers it prints.
 *
 * @internal
 */
export interface Version {
  readonly found: string;
  readonly major: number;
  readonly minor: number;
}

const VERSION = /^git version (\d+)\.(\d+)((?:\.\d+)*)/;

/**
 * Reads `git version`. Apple's `2.39.3 (Apple Git-145)` and Windows' `2.41.0.windows.1` read as their numbers.
 *
 * @internal
 */
export const version = (output: string): Result.Result<Version, Repository.GitUnavailable> => {
  const match = VERSION.exec(output);
  const [, major, minor, rest] = match ?? [];

  return major === undefined || minor === undefined
    ? Result.fail(unreadable("git printed no version"))
    : Result.succeed({ found: `${major}.${minor}${rest ?? ""}`, major: Number(major), minor: Number(minor) });
};

// The bytes of each line of a part of an object, without the line's own end.
const lines = (bytes: Uint8Array): ReadonlyArray<Uint8Array> => {
  const found: Array<Uint8Array> = [];
  let start = 0;

  for (let end = bytes.indexOf(NEWLINE); end !== -1; end = bytes.indexOf(NEWLINE, start)) {
    found.push(bytes.subarray(start, end));
    start = end + 1;
  }

  found.push(bytes.subarray(start));

  return found;
};

const IDENT = /^([^<>\n]*) <([^>\n]*)> ([0-9]+) ([+-][0-9]{4})$/;

const signature = (value: Uint8Array): Result.Result<Commit.Signature, unknown> =>
  Result.flatMap(text(value), (line) => {
    const [, name, email, seconds, offset] = IDENT.exec(line) ?? [];

    return Schema.decodeUnknownResult(Commit.Signature)({ name, email, at: { seconds: Number(seconds), offset } });
  });

const commit = (id: CommitId, body: Uint8Array): Result.Result<Commit.Commit, Repository.UnreadableCommit> => {
  const bad = (reason: Repository.UnreadableCommit["reason"]) => new Repository.UnreadableCommit({ id, reason });
  const blank = body.findIndex((byte, at) => byte === NEWLINE && body[at + 1] === NEWLINE);

  if (blank === -1) {
    return Result.fail(bad("header"));
  }

  const parents: Array<string> = [];
  const idents = new Map<string, Uint8Array>();
  let tree: string | undefined;

  for (const [index, line] of lines(body.subarray(0, blank)).entries()) {
    const space = line.indexOf(SPACE);
    const key = space === -1 ? line : line.subarray(0, space);
    const value = space === -1 ? new Uint8Array() : line.subarray(space + 1);

    // A header that continues on the next line (a signature) starts that line with a space, and is not read.
    if (key.length > 0) {
      const name = String.fromCharCode(...key);

      if (name === "tree") {
        // Git writes one `tree` line, and writes it first.
        if (index !== 0) {
          return Result.fail(bad("header"));
        }

        tree = String.fromCharCode(...value);
      } else if (name === "parent") {
        parents.push(String.fromCharCode(...value));
      } else if (name === "author" || name === "committer") {
        if (idents.has(name)) {
          return Result.fail(bad("header"));
        }

        idents.set(name, value);
      }
    }
  }

  const author = idents.get("author");
  const committer = idents.get("committer");

  if (author === undefined || committer === undefined) {
    return Result.fail(bad("header"));
  }

  const treeId = Schema.decodeUnknownResult(TreeId)(tree);
  const parentIds = Result.all(parents.map((parent) => Schema.decodeUnknownResult(CommitId)(parent)));
  const authored = signature(author);
  const committed = signature(committer);
  const message = text(body.subarray(blank + 2));

  if (Result.isFailure(treeId) || Result.isFailure(parentIds)) {
    return Result.fail(bad("header"));
  }

  if (Result.isFailure(authored)) {
    return Result.fail(bad("author"));
  }

  if (Result.isFailure(committed)) {
    return Result.fail(bad("committer"));
  }

  if (Result.isFailure(message)) {
    return Result.fail(bad("message"));
  }

  return Result.succeed(
    new Commit.Commit({
      id,
      tree: treeId.success,
      parents: parentIds.success,
      author: authored.success,
      committer: committed.success,
      message: message.success,
    }),
  );
};

const OBJECT = /^([0-9a-f]+) (missing|[a-z]+ [0-9]+)$/;

/**
 * Reads the output of `cat-file --batch`: each object, as `<id> <type> <size>`, its bytes and a line end.
 *
 * **Details**
 *
 * An id that is missing, or that is not a commit, fails with `NoSuchCommit`. A commit whose text is not UTF-8 fails with `UnreadableCommit`, naming the part.
 *
 * @internal
 */
export const commits = (
  output: Uint8Array,
): Result.Result<
  ReadonlyArray<Commit.Commit>,
  Repository.NoSuchCommit | Repository.UnreadableCommit | Repository.GitUnavailable
> =>
  Result.gen(function* () {
    const read: Array<Commit.Commit> = [];

    for (let start = 0; start < output.length;) {
      const end = output.indexOf(NEWLINE, start);
      const match = end === -1 ? null : OBJECT.exec(String.fromCharCode(...output.subarray(start, end)));
      const [, name, detail] = match ?? [];

      if (name === undefined || detail === undefined) {
        return yield* Result.fail(unreadable("a batch object has no header line"));
      }

      const id = yield* commitId(name, "a batch object");
      const [type, size] = detail.split(" ");

      if (type !== "commit") {
        return yield* Result.fail(new Repository.NoSuchCommit({ id }));
      }

      const after = end + 1 + Number(size);

      if (output[after] !== NEWLINE) {
        return yield* Result.fail(unreadable("a batch object is shorter than its header says"));
      }

      read.push(yield* commit(id, output.subarray(end + 1, after)));
      start = after + 1;
    }

    return read;
  });

/**
 * Reads the text of a part of git's output that must be UTF-8, such as `for-each-ref`.
 *
 * @internal
 */
export const lossless = (output: Uint8Array): Result.Result<string, Repository.GitUnavailable> =>
  Result.mapError(text(output), () => unreadable("git printed text that is not UTF-8"));

const NUL = 0x00;

const COLON = 0x3a;

// What `diff-tree -r -z` prints before an entry's path: two modes, two ids and one status letter.
const RAW_HEAD = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])$/;

// A file that is absent on one side of an entry has this mode.
const ABSENT = "000000";

// The mode of a submodule.
const GITLINK = "160000";

/**
 * One side of a changed file, as the raw list holds it: a mode and an object id. The object is a blob, or a commit when the mode is a submodule's.
 *
 * @internal
 */
export interface Side {
  readonly mode: string;
  readonly id: string;
}

/**
 * One entry of `diff-tree -r -z --no-renames`: a file that is new (A), gone (D), changed (M) or changed in kind (T). A side the file lacks is left out.
 *
 * @internal
 */
export interface Change {
  readonly status: "A" | "D" | "M" | "T";
  readonly path: string;
  readonly before?: Side;
  readonly after?: Side;
  /** Either side is a submodule, which holds a commit and no file. */
  readonly gitlink: boolean;
}

/**
 * Whether one side of an entry is a submodule, which holds a commit and no file. A file made a submodule has a file on one side and a submodule on the other.
 *
 * @internal
 */
export const isGitlink = (side: Side): boolean => side.mode === GITLINK;

const side = (mode: string, id: string): Result.Result<Side | undefined, Repository.GitUnavailable> =>
  mode === ABSENT
    ? Result.succeed(undefined)
    : OBJECT_ID.test(id)
      ? Result.succeed({ mode, id })
      : Result.fail(unreadable("a raw entry names an object that is not an id"));

const change = (head: string, path: string): Result.Result<Change, Repository.GitUnavailable> =>
  Result.gen(function* () {
    const [, from, to, was, now, status] = RAW_HEAD.exec(head) ?? [];

    if (from === undefined || to === undefined || was === undefined || now === undefined) {
      return yield* Result.fail(unreadable("a raw entry has an unexpected form"));
    }

    if (status !== "A" && status !== "D" && status !== "M" && status !== "T") {
      return yield* Result.fail(unreadable("a raw entry has a status no call reads"));
    }

    const before = yield* side(from, was);
    const after = yield* side(to, now);

    return {
      status,
      path,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      gitlink: from === GITLINK || to === GITLINK,
    };
  });

/**
 * Reads `diff-tree -r -z --no-renames`: each entry as `:<mode> <mode> <id> <id> <status>`, a NUL, the path and a NUL.
 *
 * **Details**
 *
 * The path is read as it is, with no quote, and must be UTF-8. A list that ends before an entry's last NUL fails: it is cut, which is no answer.
 *
 * @internal
 */
export const changes = (output: Uint8Array): Result.Result<ReadonlyArray<Change>, Repository.GitUnavailable> =>
  Result.gen(function* () {
    const read: Array<Change> = [];

    for (let start = 0; start < output.length;) {
      const middle = output.indexOf(NUL, start);
      const end = middle === -1 ? -1 : output.indexOf(NUL, middle + 1);

      if (output[start] !== COLON || end === -1) {
        return yield* Result.fail(unreadable("a raw entry is cut or has an unexpected form"));
      }

      const path = yield* Result.mapError(text(output.subarray(middle + 1, end)), () =>
        unreadable("git printed a path that is not UTF-8"),
      );

      read.push(yield* change(String.fromCharCode(...output.subarray(start, middle)), path));
      start = end + 1;
    }

    return read;
  });

/**
 * Reads what `patch-id` prints for one patch: the patch id, a space and the commit id the patch came from, which is all zeros for a patch with no commit.
 *
 * **Details**
 *
 * Nothing printed is no id: the call that asked had a patch, so its answer is never none.
 *
 * @internal
 */
export const patchId = (output: string): Result.Result<PatchId, Repository.GitUnavailable> => {
  const [first] = output.split("\n");
  const [id, ...rest] = (first ?? "").split(" ");

  return rest.length === 1
    ? Result.mapError(Schema.decodeUnknownResult(PatchId)(id), () => unreadable("patch-id printed no patch id"))
    : Result.fail(unreadable("patch-id printed no patch id"));
};
