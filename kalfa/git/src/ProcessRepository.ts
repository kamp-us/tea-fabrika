/**
 * The git-binary adapter of `Repository`: it runs `git` on a bare repository through Effect's `ChildProcessSpawner`.
 *
 * **Details**
 *
 * No file of this package imports a Node module, this one included. The app provides the Node spawner at the top. Every command runs with an environment of `PATH` and a pinned set, so no repository config, hook or inherited `GIT_` variable steers a call. No call reads the text git says on stderr for its meaning: a missing commit is asked first with `cat-file --batch-check`, and a ref that could not be moved is read again with `for-each-ref`. It writes with `hash-object` and `update-ref` and runs no command that reaches a remote.
 */
import { Array as Arr, Config, Duration, Effect, Fiber, Layer, Option, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Commit from "./Commit.ts";
import type { CommitId } from "./CommitId.ts";
import { joined } from "./internal/bytes.ts";
import * as Lookup from "./internal/lookup.ts";
import { bytes } from "./internal/object.ts";
import * as Parse from "./internal/parse.ts";
import type * as Ref from "./Ref.ts";
import * as Repository from "./Repository.ts";
import * as Settings from "./Settings.ts";

// What git's merge reads from a repository's own config, written out at git's defaults, so no config steers a merge.
const MERGE_PINS = ["merge.renames=true", "merge.directoryRenames=conflict", "merge.renormalize=false"];

// What every command starts with: no replacement objects, the path as the git directory (git never looks for a repository
// around it), no hook, no automatic gc or maintenance, and the merge settings at git's defaults.
const start = (path: string): ReadonlyArray<string> => [
  "--no-replace-objects",
  `--git-dir=${path}`,
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "gc.auto=0",
  "-c",
  "maintenance.auto=false",
  ...MERGE_PINS.flatMap((pin) => ["-c", pin]),
];

// Beside PATH, the only variables a command sees: no user or system config, no prompt, no lock taken to refresh, one language.
const PINNED = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_ATTR_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
  LC_ALL: "C",
};

// How long a child that ignores the first signal has to end before it is killed outright. A time limit ends a call, so
// the child must end with it: without this, a git that ignores SIGTERM would hold the call open past its limit. It is
// short and fixed, and no caller has a reason to change it.
const KILL_AFTER = Duration.seconds(5);

const encoder = new TextEncoder();

const unavailable = (reason: Repository.GitUnavailable["reason"]): Repository.GitUnavailable =>
  new Repository.GitUnavailable({ reason });

interface Output {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

type Run = (args: ReadonlyArray<string>, input?: Uint8Array) => Effect.Effect<Output, Repository.GitUnavailable>;

// A command whose stdout is read only until it holds `entries` entries of `diff-tree -z`, and then it is let go: the answer is
// then the files limit and no more of the list is read. A list that holds no more entries than that is read whole.
type Listed = (
  args: ReadonlyArray<string>,
  entries: number,
) => Effect.Effect<Output, Repository.GitUnavailable | Repository.TooMany>;

// The first `most` bytes of what a stream says, the rest read and left out so a full pipe never stalls git.
const firstBytes = (most: number) => (kept: Uint8Array, chunk: Uint8Array) => {
  if (kept.length >= most) {
    return kept;
  }

  const added = chunk.subarray(0, most - kept.length);
  const together = new Uint8Array(kept.length + added.length);
  together.set(kept);
  together.set(added, kept.length);

  return together;
};

// A child in the caller's scope: it never outlives the call, and a time limit that interrupts the call ends it.
const child = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  path: string,
  env: Record<string, string>,
  args: ReadonlyArray<string>,
  input: Uint8Array | undefined,
) =>
  spawner
    .spawn(
      ChildProcess.make("git", [...start(path), ...args], {
        extendEnv: false,
        env,
        forceKillAfter: KILL_AFTER,
        stdin: input === undefined ? "ignore" : Stream.make(input),
      }),
    )
    .pipe(Effect.mapError((cause) => unavailable(new Repository.NotStarted({ cause }))));

const unreadable = (cause: unknown): Repository.GitUnavailable => unavailable(new Repository.Unreadable({ cause }));

// One command, in a scope that ends with it.
const runner = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  path: string,
  env: Record<string, string>,
  settings: Settings.Settings,
): Run =>
  Effect.fnUntraced(function* (args, input) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* child(spawner, path, env, args, input);

        const [stdout, stderr, code] = yield* Effect.all(
          [
            Stream.mkUint8Array(handle.stdout),
            Stream.runFold(handle.stderr, () => new Uint8Array(), firstBytes(settings.limits.bytes)),
            handle.exitCode,
          ],
          { concurrency: 3 },
        ).pipe(Effect.mapError(unreadable));

        return { code, stdout, stderr: new TextDecoder().decode(stderr) };
      }),
    );
  });

// What `diff-tree -z` has read so far: its chunks, and how many NUL bytes they hold. An entry ends with its second NUL.
interface Read {
  readonly chunks: ReadonlyArray<Uint8Array>;
  readonly nuls: number;
}

const nulsIn = (chunk: Uint8Array): number => {
  let count = 0;

  for (let at = chunk.indexOf(0); at !== -1; at = chunk.indexOf(0, at + 1)) {
    count += 1;
  }

  return count;
};

// Like `runner`, for a list whose length the caller limits: stdout is read until it holds one entry more than `entries`, then
// the child is let go with the call's scope, with no exit code asked of it. stderr is read beside, so a full pipe never stalls git.
const lister = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  path: string,
  env: Record<string, string>,
  settings: Settings.Settings,
): Listed =>
  Effect.fnUntraced(function* (args, entries) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* child(spawner, path, env, args, undefined);

        const errors = yield* Effect.forkScoped(
          Stream.runFold(handle.stderr, () => new Uint8Array(), firstBytes(settings.limits.bytes)),
        );

        const nothing: Read = { chunks: [], nuls: 0 };

        const read = yield* handle.stdout.pipe(
          Stream.scan(
            () => nothing,
            (so, chunk: Uint8Array) => ({ chunks: [...so.chunks, chunk], nuls: so.nuls + nulsIn(chunk) }),
          ),
          Stream.takeUntil((so) => so.nuls >= 2 * (entries + 1)),
          Stream.runLast,
          Effect.mapError(unreadable),
        );

        const seen = Option.getOrElse(read, () => nothing);

        if (seen.nuls >= 2 * (entries + 1)) {
          return yield* new Repository.TooMany({ limit: "files", most: entries });
        }

        const [stderr, code] = yield* Effect.all([Fiber.join(errors), handle.exitCode], { concurrency: 2 }).pipe(
          Effect.mapError(unreadable),
        );

        return { code, stdout: joined(seen.chunks), stderr: new TextDecoder().decode(stderr) };
      }),
    );
  });

const exited = (output: Output): Repository.GitUnavailable =>
  unavailable(new Repository.Exited({ code: output.code, stderr: output.stderr }));

// A command whose only good ending is exit code 0.
const succeeded = (output: Output): Effect.Effect<Output, Repository.GitUnavailable> =>
  output.code === 0 ? Effect.succeed(output) : Effect.fail(exited(output));

const stdoutText = (output: Output): Effect.Effect<string, Repository.GitUnavailable> =>
  Effect.fromResult(Parse.lossless(output.stdout));

const lines = (ids: ReadonlyArray<string>): Uint8Array => encoder.encode(ids.map((id) => `${id}\n`).join(""));

// What the repository holds under each id, from one `cat-file --batch-check`: its type, and nothing for an id it lacks.
const held = Effect.fnUntraced(function* (
  run: Run,
  ids: ReadonlyArray<string>,
): Effect.fn.Return<ReadonlyMap<string, Parse.Checked>, Repository.GitUnavailable> {
  const output = yield* Effect.flatMap(run(["cat-file", "--batch-check"], lines(ids)), succeeded);

  return yield* Effect.fromResult(Parse.checks(yield* stdoutText(output)));
});

// Every id is a commit the repository holds, asked before any call that names commits, so an exit code of 128 later
// is never a missing commit. A tree, a blob or a tag with that id is not a commit either.
const known = Effect.fnUntraced(function* (run: Run, ids: ReadonlyArray<CommitId>) {
  const checked = yield* held(run, ids);

  for (const id of ids) {
    if (checked.get(id)?.type !== "commit") {
      return yield* new Repository.NoSuchCommit({ id });
    }
  }

  return checked;
});

// The size of each blob, asked of git before any of them is read. A blob that git cannot find is no answer.
const blobSizes = Effect.fnUntraced(function* (run: Run, ids: ReadonlyArray<string>) {
  const checked = yield* held(run, ids);

  for (const id of ids) {
    if (checked.get(id)?.type !== "blob") {
      return yield* unreadable(new Error("git has no blob that a raw entry names"));
    }
  }

  return checked;
});

// A call that reads history fails on a shallow repository, before any answer could be a guess.
const whole = Effect.fnUntraced(function* (run: Run) {
  const output = yield* Effect.flatMap(run(["rev-parse", "--is-shallow-repository"]), succeeded);
  const answer = (yield* stdoutText(output)).trim();

  if (answer === "true") {
    return yield* new Repository.HistoryTooShort();
  }

  if (answer !== "false") {
    return yield* unreadable(new Error("git said neither true nor false"));
  }
});

// Every folder a ref would sit in, shortest first: `refs/heads/a/b` has `refs/heads` and `refs/heads/a`.
const folders = (ref: Ref.RefName): ReadonlyArray<string> => {
  const parts = ref.split("/");

  return parts.slice(1, -1).map((_, at) => parts.slice(0, at + 2).join("/"));
};

// Up to `count` refs at or below `under`, sorted by name: the ref itself first when it exists.
const refsUnder = Effect.fnUntraced(function* (run: Run, under: string, count: number) {
  const output = yield* Effect.flatMap(
    run(["for-each-ref", `--count=${count}`, "--format=%(objectname) %(refname)", under]),
    succeeded,
  );

  return yield* Effect.fromResult(Parse.refIds(yield* stdoutText(output)));
});

// Why `update-ref` failed, read from the repository and never from what git said: the ref is not where the caller said
// it was (`RefMoved`), or another ref is in its way (`RefInTheWay`), else git ended with a code no call reads as an answer.
const failed = Effect.fnUntraced(function* (
  run: Run,
  move: { readonly ref: Ref.RefName; readonly from: Option.Option<CommitId> },
  output: Output,
) {
  // The ref sorts first, then what is below it, so two refs show both.
  const [first, second] = yield* refsUnder(run, move.ref, 2);
  const at = first?.name === move.ref ? first.id : undefined;

  if (at !== Option.getOrUndefined(move.from)) {
    return yield* new Repository.RefMoved({ ref: move.ref });
  }

  const below = at === undefined ? first : second;

  if (below !== undefined) {
    return yield* new Repository.RefInTheWay({ ref: move.ref, other: below.name });
  }

  for (const folder of folders(move.ref)) {
    const [other] = yield* refsUnder(run, folder, 1);

    if (other?.name === folder) {
      return yield* new Repository.RefInTheWay({ ref: move.ref, other: other.name });
    }
  }

  return yield* exited(output);
});

// The sides of a changed file that hold a blob: a side the file lacks and a submodule's side hold none.
const blobSides = (change: Parse.Change): ReadonlyArray<Parse.Side> =>
  [change.before, change.after].flatMap((side) => (side === undefined || Parse.isGitlink(side) ? [] : [side]));

// What a listed entry is, as a path's rule needs it: a link is a blob with mode 120000, a submodule a commit.
const entryKind = (entry: Parse.Listed): Lookup.Kind => {
  if (entry.type === "tree") {
    return "folder";
  }

  if (entry.type === "commit") {
    return "submodule";
  }

  return entry.mode === "120000" ? "link" : "file";
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((octet, at) => octet === b[at]);

const calls = (run: Run, list: Listed, settings: Settings.Settings, version: Parse.Version): Repository.Raw => {
  const { limits } = settings;

  // The objects of commits whose sizes are within `limits.bytes`, read with one `cat-file --batch`.
  const objects = Effect.fnUntraced(function* (ids: ReadonlyArray<CommitId>) {
    const checked = yield* known(run, ids);

    for (const id of ids) {
      if ((checked.get(id)?.size ?? 0) > limits.bytes) {
        return yield* new Repository.TooLarge({ id, most: limits.bytes });
      }
    }

    const output = yield* Effect.flatMap(run(["cat-file", "--batch"], lines(ids)), succeeded);

    return yield* Effect.fromResult(Parse.commits(output.stdout));
  });

  // The commits are known, and then the files they differ in, from the raw list of `diff-tree`, read only as far as the files limit.
  const entries = Effect.fnUntraced(function* (from: CommitId, to: CommitId) {
    yield* known(run, [from, to]);

    const raw = yield* Effect.flatMap(
      list(["diff-tree", "-r", "-z", "--no-renames", from, to], limits.files),
      succeeded,
    );

    return yield* Effect.fromResult(Parse.changes(raw.stdout));
  });

  // The size of each file's blobs, asked of git before any content is read. A submodule holds no blob, and a file made a
  // submodule still holds one on its file side.
  const withinSize = Effect.fnUntraced(function* (changed: ReadonlyArray<Parse.Change>) {
    const blobs = [...new Set(changed.flatMap(blobSides).map((side) => side.id))];
    const sizes = blobs.length === 0 ? new Map<string, Parse.Checked>() : yield* blobSizes(run, blobs);
    const bytes = changed.flatMap(blobSides).reduce((total, side) => total + (sizes.get(side.id)?.size ?? 0), 0);

    if (bytes > limits.diff) {
      return yield* new Repository.DiffTooLarge({ most: limits.diff });
    }
  });

  // The patch of the two commits, with no context lines. Its size is bounded by the limits, so it is read whole. Two settings
  // of a repository, or of the machine, make git print a text edit as `Binary files differ`, which would change the patch id and
  // the diff: a file over `core.bigFileThreshold`, and a file an attributes file marks binary. The threshold is set above the
  // content limit, which no changed file passes, and the attributes file is none.
  const patchBytes = (from: CommitId, to: CommitId) =>
    Effect.flatMap(
      run([
        "-c",
        `core.bigFileThreshold=${limits.diff + 1}`,
        "-c",
        "core.attributesFile=/dev/null",
        "diff-tree",
        "-r",
        "-p",
        "-U0",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "--full-index",
        from,
        to,
      ]),
      succeeded,
    );

  return {
    readCommit: Effect.fnUntraced(function* (id) {
      const [commit] = yield* objects([id]);

      return commit ?? (yield* new Repository.NoSuchCommit({ id }));
    }),
    readRefs: Effect.fnUntraced(function* (under: Ref.RefName) {
      const output = yield* Effect.flatMap(
        run([
          "for-each-ref",
          `--count=${limits.refs + 1}`,
          "--format=%(objectname) %(objecttype) %(symref) %(refname)",
          under,
        ]),
        succeeded,
      );

      const refs = yield* Effect.fromResult(Parse.refs(yield* stdoutText(output)));

      return refs.length > limits.refs ? yield* new Repository.TooMany({ limit: "refs", most: limits.refs }) : refs;
    }),
    walk: Effect.fnUntraced(function* ({ include, exclude }) {
      yield* known(run, [...include, ...exclude]);
      yield* whole(run);

      const output = yield* Effect.flatMap(
        run([
          "rev-list",
          "--topo-order",
          "--reverse",
          `--max-count=${limits.commits + 1}`,
          ...include,
          ...(exclude.length === 0 ? [] : ["--not", ...exclude]),
        ]),
        succeeded,
      );

      const listed = yield* Effect.fromResult(Parse.ids(yield* stdoutText(output)));

      if (listed.length > limits.commits) {
        return yield* new Repository.TooMany({ limit: "commits", most: limits.commits });
      }

      return listed.length === 0 ? [] : yield* objects(listed);
    }),
    mergeBases: Effect.fnUntraced(function* (a, b) {
      yield* known(run, [a, b]);
      yield* whole(run);
      const output = yield* run(["merge-base", "--all", a, b]);

      // Exit 1 with nothing printed is git's way to say the two share no history.
      if (output.code === 1 && output.stdout.length === 0) {
        return [];
      }

      const bases = yield* Effect.fromResult(Parse.ids(yield* stdoutText(yield* succeeded(output))));

      return bases.length > limits.commits
        ? yield* new Repository.TooMany({ limit: "commits", most: limits.commits })
        : bases.toSorted();
    }),
    isAncestor: Effect.fnUntraced(function* (ancestor, descendant) {
      yield* known(run, [ancestor, descendant]);
      yield* whole(run);
      const output = yield* run(["merge-base", "--is-ancestor", ancestor, descendant]);

      // Exit 0 is yes and exit 1 is no. Any other code is no answer, never a no.
      if (output.code === 1) {
        return false;
      }

      yield* succeeded(output);

      return true;
    }),
    patchId: Effect.fnUntraced(function* (from, to) {
      const changed = yield* entries(from, to);

      if (changed.length === 0) {
        return Option.none();
      }

      yield* withinSize(changed);

      // Two commands one after the other and never a pipe: a pipe's exit code is the last command's only, so a `diff-tree`
      // that failed would hand `patch-id` nothing, and nothing would read as no change.
      const patch = yield* patchBytes(from, to);
      const printed = yield* Effect.flatMap(run(["patch-id", "--verbatim"], patch.stdout), succeeded);

      return Option.some(yield* Effect.fromResult(Parse.patchId(yield* stdoutText(printed))));
    }),
    readFile: Effect.fnUntraced(function* (commit, path) {
      yield* known(run, [commit]);

      // One folder at a time, top down, from its own listing: no path ever reaches git, so no pathspec, quoting or path config acts.
      // The walk ends at the first part that is missing or is not a folder. A part is matched to a listed name by its bytes.
      const parts = path.split("/");
      const seen = new Map<string, Parse.Listed>();
      let folder: string = commit;

      for (const [at, part] of parts.entries()) {
        const printed = yield* Effect.flatMap(run(["ls-tree", "-z", folder]), succeeded);
        const wanted = encoder.encode(part);

        const entry = (yield* Effect.fromResult(Parse.listing(printed.stdout))).find((each) =>
          sameBytes(each.name, wanted),
        );

        if (entry === undefined) {
          break;
        }

        seen.set(parts.slice(0, at + 1).join("/"), entry);

        if (entryKind(entry) !== "folder") {
          break;
        }

        folder = entry.id;
      }

      yield* Effect.fromResult(
        Lookup.find(path, (so) => {
          const entry = seen.get(so);

          return entry === undefined ? undefined : entryKind(entry);
        }),
      );

      const file = seen.get(path);

      if (file === undefined) {
        return Option.none();
      }

      const size = (yield* blobSizes(run, [file.id])).get(file.id)?.size ?? 0;

      if (size > limits.blob) {
        return yield* new Repository.FileTooLarge({ path, most: limits.blob });
      }

      const content = (yield* Effect.flatMap(run(["cat-file", "blob", file.id]), succeeded)).stdout;

      // git says how many bytes the blob holds, and `cat-file blob` must print exactly that many, never fewer or more.
      if (content.length !== size) {
        return yield* unreadable(new Error("cat-file printed a blob of another size than it said"));
      }

      return Option.some(content);
    }),
    diff: Effect.fnUntraced(function* (from, to) {
      const changed = yield* entries(from, to);

      if (changed.length === 0) {
        return [];
      }

      // A submodule has a commit and no file, so it has no lines: the first one in the raw list is named before any size is asked.
      const submodule = changed.find((each) => each.gitlink);

      if (submodule !== undefined) {
        return yield* new Repository.NotAFile({ path: submodule.path, holds: "submodule" });
      }

      yield* withinSize(changed);

      const contents = yield* Effect.fromResult(Parse.patch(changed, (yield* patchBytes(from, to)).stdout));

      return yield* Effect.fromResult(Parse.files(Arr.zip(changed, contents)));
    }),
    writeCommit: Effect.fnUntraced(function* (commit) {
      const checked = yield* held(run, [commit.tree, ...commit.parents]);

      if (checked.get(commit.tree)?.type !== "tree") {
        return yield* new Repository.NoSuchTree({ id: commit.tree });
      }

      for (const parent of commit.parents) {
        if (checked.get(parent)?.type !== "commit") {
          return yield* new Repository.NoSuchCommit({ id: parent });
        }
      }

      // The same bytes the memory adapter hashes, so one commit has one id in both.
      const output = yield* Effect.flatMap(
        run(["hash-object", "-t", "commit", "-w", "--stdin"], bytes(commit)),
        succeeded,
      );

      const [id, ...more] = yield* Effect.fromResult(Parse.ids(yield* stdoutText(output)));

      if (id === undefined || more.length > 0) {
        return yield* unavailable(new Repository.Unreadable({ cause: new Error("git printed no single commit id") }));
      }

      return new Commit.Commit({ ...commit, id });
    }),
    mergeTrees: Effect.fnUntraced(function* ({ mergeBase, ours, theirs }) {
      // `--merge-base` came in git 2.40, so an older git refuses before any command runs.
      if (!canMerge(version)) {
        return yield* unavailable(new Repository.GitTooOld({ found: version.found, needs: MERGE_NEEDS }));
      }

      yield* known(run, [mergeBase, ours, theirs]);

      const output = yield* run([
        "merge-tree",
        "--write-tree",
        "--no-messages",
        "--name-only",
        "-z",
        `--merge-base=${mergeBase}`,
        ours,
        theirs,
      ]);

      // Exit 0 is a clean merge, which prints the tree alone. Exit 1 is a conflict, which prints the tree and then each path.
      if (output.code !== 0 && output.code !== 1) {
        return yield* exited(output);
      }

      const { tree, paths } = yield* Effect.fromResult(Parse.mergeTree(yield* stdoutText(output)));
      const [first, ...rest] = paths;

      if (output.code === 0) {
        return tree;
      }

      return first === undefined
        ? yield* unavailable(new Repository.Unreadable({ cause: new Error("a conflict named no path") }))
        : yield* new Repository.Conflict({ paths: [first, ...rest] });
    }),
    moveRef: Effect.fnUntraced(function* (move) {
      yield* known(run, [move.to]);

      // `--no-deref` replaces a symbolic ref with a plain one and never moves its target. An id of zeros means the ref must not exist.
      const output = yield* run([
        "update-ref",
        "--no-deref",
        move.ref,
        move.to,
        Option.getOrElse(move.from, () => "0".repeat(move.to.length)),
      ]);

      if (output.code !== 0) {
        return yield* failed(run, move, output);
      }
    }),
  };
};

// git 2.38 is the oldest the calls are held to, and the oldest a layer opens on.
const OPEN_NEEDS = "2.38";

const isNewEnough = ({ major, minor }: Parse.Version): boolean => major > 2 || (major === 2 && minor >= 38);

// `merge-tree --merge-base` needs git 2.40.
const MERGE_NEEDS = "2.40";

const canMerge = ({ major, minor }: Parse.Version): boolean => major > 2 || (major === 2 && minor >= 40);

/**
 * Layer that provides `Repository` over the bare repository at `path`, by running the `git` binary.
 *
 * **Details**
 *
 * Building it runs `git version` (2.38 or newer, else `GitTooOld`; `mergeTrees` needs 2.40 and fails with `GitTooOld` as a `GitUnavailable` reason on older git) and `git rev-parse --git-dir` with `--git-dir` (else `NoRepository`), in a span named `git.open` that records the version. `PATH` is read once through `Config`, as the one inherited variable. It needs a `ChildProcessSpawner`, which the app provides.
 *
 * @category layers
 */
export const layer = (options: {
  readonly path: string;
  readonly settings: Settings.Settings;
}): Layer.Layer<
  Repository.Repository,
  Repository.GitTooOld | Repository.NoRepository | Repository.GitUnavailable | Repository.TimedOut,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Layer.effect(
    Repository.Repository,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const path = yield* Config.String("PATH").pipe(
        Effect.mapError((cause) => unavailable(new Repository.NotStarted({ cause }))),
      );

      const env = { PATH: path, ...PINNED };
      const run = runner(spawner, options.path, env, options.settings);
      const list = lister(spawner, options.path, env, options.settings);
      const after = Settings.timeLimit(options.settings);

      const open = Effect.fn("git.open")(function* () {
        const printed = yield* Effect.fromResult(
          Parse.version(yield* stdoutText(yield* Effect.flatMap(run(["version"]), succeeded))),
        );

        yield* Effect.annotateCurrentSpan({ "kalfa.git.version": printed.found });

        if (!isNewEnough(printed)) {
          return yield* new Repository.GitTooOld({ found: printed.found, needs: OPEN_NEEDS });
        }

        if ((yield* run(["rev-parse", "--git-dir"])).code !== 0) {
          return yield* new Repository.NoRepository({ path: options.path });
        }

        return printed;
      });

      const version = yield* Effect.timeoutOrElse(open(), {
        duration: after,
        orElse: () => Effect.fail(new Repository.TimedOut({ after })),
      });

      return Repository.make(calls(run, list, options.settings, version), options.settings);
    }),
  );
