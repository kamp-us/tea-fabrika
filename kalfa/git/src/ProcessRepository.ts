/**
 * The git-binary adapter of `Repository`: it runs `git` on a bare repository through Effect's `ChildProcessSpawner`.
 *
 * **Details**
 *
 * No file of this package imports a Node module, this one included. The app provides the Node spawner at the top. Every command runs with an environment of `PATH` and a pinned set, so no repository config, hook or inherited `GIT_` variable steers a read. No call reads the text git says on stderr for its meaning: a missing commit is asked first with `cat-file --batch-check`.
 */
import { Config, Duration, Effect, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { CommitId } from "./CommitId.ts";
import * as Parse from "./internal/parse.ts";
import type * as Ref from "./Ref.ts";
import * as Repository from "./Repository.ts";
import * as Settings from "./Settings.ts";

// What every command starts with: no replacement objects, the path as the git directory (git never looks for a repository
// around it), and no hook, no automatic gc or maintenance.
const start = (path: string): ReadonlyArray<string> => [
  "--no-replace-objects",
  `--git-dir=${path}`,
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "gc.auto=0",
  "-c",
  "maintenance.auto=false",
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

type Run = (args: ReadonlyArray<string>, input?: string) => Effect.Effect<Output, Repository.GitUnavailable>;

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

// One command, in a scope that ends with it: the child never outlives the call, and a time limit that interrupts the call ends it.
const runner = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  path: string,
  env: Record<string, string>,
  settings: Settings.Settings,
): Run =>
  Effect.fnUntraced(function* (args, input) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner
          .spawn(
            ChildProcess.make("git", [...start(path), ...args], {
              extendEnv: false,
              env,
              forceKillAfter: KILL_AFTER,
              stdin: input === undefined ? "ignore" : Stream.make(encoder.encode(input)),
            }),
          )
          .pipe(Effect.mapError((cause) => unavailable(new Repository.NotStarted({ cause }))));

        const [stdout, stderr, code] = yield* Effect.all(
          [
            Stream.mkUint8Array(handle.stdout),
            Stream.runFold(handle.stderr, () => new Uint8Array(), firstBytes(settings.limits.bytes)),
            handle.exitCode,
          ],
          { concurrency: 3 },
        ).pipe(Effect.mapError((cause) => unavailable(new Repository.Unreadable({ cause }))));

        return { code, stdout, stderr: new TextDecoder().decode(stderr) };
      }),
    );
  });

// A command whose only good ending is exit code 0.
const succeeded = (output: Output): Effect.Effect<Output, Repository.GitUnavailable> =>
  output.code === 0
    ? Effect.succeed(output)
    : Effect.fail(unavailable(new Repository.Exited({ code: output.code, stderr: output.stderr })));

const stdoutText = (output: Output): Effect.Effect<string, Repository.GitUnavailable> =>
  Effect.fromResult(Parse.lossless(output.stdout));

const lines = (ids: ReadonlyArray<CommitId>): string => ids.map((id) => `${id}\n`).join("");

// Every id is a commit the repository holds, asked before any call that names commits, so an exit code of 128 later
// is never a missing commit. A tree, a blob or a tag with that id is not a commit either.
const known = Effect.fnUntraced(function* (run: Run, ids: ReadonlyArray<CommitId>) {
  const output = yield* Effect.flatMap(run(["cat-file", "--batch-check"], lines(ids)), succeeded);
  const checked = yield* Effect.fromResult(Parse.checks(yield* stdoutText(output)));

  for (const id of ids) {
    if (checked.get(id)?.type !== "commit") {
      return yield* new Repository.NoSuchCommit({ id });
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
    return yield* unavailable(new Repository.Unreadable({ cause: new Error("git said neither true nor false") }));
  }
});

const calls = (run: Run, settings: Settings.Settings): Repository.Repository["Service"] => {
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
  };
};

// git 2.38 is the oldest the calls are held to.
const isNewEnough = ({ major, minor }: Parse.Version): boolean => major > 2 || (major === 2 && minor >= 38);

/**
 * Layer that provides `Repository` over the bare repository at `path`, by running the `git` binary.
 *
 * **Details**
 *
 * Building it runs `git version` (2.38 or newer, else `GitTooOld`) and `git rev-parse --git-dir` with `--git-dir` (else `NoRepository`), in a span named `git.open` that records the version. `PATH` is read once through `Config`, as the one inherited variable. It needs a `ChildProcessSpawner`, which the app provides.
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

      const run = runner(spawner, options.path, { PATH: path, ...PINNED }, options.settings);
      const after = Settings.timeLimit(options.settings);

      const open = Effect.fn("git.open")(function* () {
        const printed = yield* Effect.fromResult(
          Parse.version(yield* stdoutText(yield* Effect.flatMap(run(["version"]), succeeded))),
        );

        yield* Effect.annotateCurrentSpan({ "kalfa.git.version": printed.found });

        if (!isNewEnough(printed)) {
          return yield* new Repository.GitTooOld({ found: printed.found });
        }

        if ((yield* run(["rev-parse", "--git-dir"])).code !== 0) {
          return yield* new Repository.NoRepository({ path: options.path });
        }
      });

      yield* Effect.timeoutOrElse(open(), {
        duration: after,
        orElse: () => Effect.fail(new Repository.TimedOut({ after })),
      });

      return Repository.make(calls(run, options.settings), options.settings);
    }),
  );
