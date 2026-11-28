// Seeds real bare repositories for the git-binary adapter's laws: `git fast-import` once with the whole
// history, the marks read back for the ids, git's own `shallow` file for a shallow history. Real git runs in
// temp folders, so only an integration law imports this file.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, Context, Effect, Layer, Option, Predicate, Ref as Cell, Schema, type Scope, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as CommitId from "./CommitId.ts";
import { holdGate, type FetchSeeded, type FetchSubject, type Hold } from "./Fetch.test-support.ts";
import type { FileSpec, FlatSignature, History } from "./History.test-support.ts";
import * as ProcessRepository from "./ProcessRepository.ts";
import * as Remote from "./Remote.ts";
import * as Repository from "./Repository.ts";
import type { Seeded, Subject } from "./RepositoryTest.ts";
import type { Settings } from "./Settings.ts";
import * as Tree from "./Tree.ts";

type Needs = ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path;

const encoder = new TextEncoder();

/** git with a pinned environment: no user or system config, no prompt, no lock taken to refresh. */
export const git = (
  dir: string,
  args: ReadonlyArray<string>,
  input: Uint8Array | undefined = undefined,
): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const path = yield* Config.String("PATH");

      const handle = yield* spawner.spawn(
        ChildProcess.make("git", ["--no-replace-objects", `--git-dir=${dir}`, ...args], {
          extendEnv: false,
          env: {
            PATH: path,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_SYSTEM: "/dev/null",
            GIT_TERMINAL_PROMPT: "0",
            GIT_OPTIONAL_LOCKS: "0",
            LC_ALL: "C",
          },
          stdin: input === undefined ? "ignore" : Stream.make(input),
        }),
      );

      const [stdout, stderr, code] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
          handle.exitCode,
        ],
        { concurrency: 3 },
      );

      if (code !== 0) {
        return yield* Effect.die(new Error(`git ${args.join(" ")} exited ${code}: ${stderr}`));
      }

      return stdout;
    }),
  ).pipe(Effect.orDie);

/** An empty bare repository in a temp folder that goes away with the scope. */
export const bareRepository: Effect.Effect<string, never, Needs | Scope.Scope> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped();
  yield* git(dir, ["init", "--bare", "--quiet", dir]);

  return dir;
}).pipe(Effect.orDie);

const bytes = (...parts: ReadonlyArray<string | Uint8Array>): Uint8Array => {
  const chunks = parts.map((part) => (Predicate.isString(part) ? encoder.encode(part) : part));
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;

  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }

  return out;
};

const identLine = (flat: FlatSignature): string =>
  `${flat.name}${flat.name === "" ? "" : " "}<${flat.email}> ${flat.seconds} ${flat.offset}`;

// fast-import reads a path to the end of its line, unless it starts with a quote: then it is in C style, with `\\`, `"` and a
// line break written out. A path that holds a line break must be quoted.
const quoted = (path: string): string =>
  path.startsWith('"') || path.includes("\n")
    ? `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`
    : path;

/** A commit's whole tree: `deleteall`, then one `M` line and the file's bytes for each file. */
const fileChanges = (files: ReadonlyArray<FileSpec>): ReadonlyArray<string | Uint8Array> => [
  "deleteall\n",
  ...files.flatMap((file): ReadonlyArray<string | Uint8Array> => [
    `M ${file.mode} inline ${quoted(file.path)}\ndata ${file.content.length}\n`,
    file.content,
    "\n",
  ]),
];

/** The fast-import stream of a history: a root starts after `reset`, a merge names its parents in order, each commit holds its files. */
const importStream = (history: History): Uint8Array =>
  bytes(
    ...history.nodes.flatMap((node, i): ReadonlyArray<string | Uint8Array> => {
      const message = encoder.encode(node.message);

      return [
        node.parents.length === 0 ? "reset refs/seed/tmp\n" : "",
        `commit refs/seed/tmp\nmark :${i + 1}\nauthor ${identLine(node.author)}\ncommitter ${identLine(node.committer)}\ndata ${message.length}\n`,
        message,
        "\n",
        ...node.parents.map((parent, k) => `${k === 0 ? "from" : "merge"} :${parent + 1}\n`),
        ...fileChanges(node.files),
        "\n",
      ];
    }),
    ...history.refs.map((ref) => `reset ${ref.name}\nfrom :${ref.commit + 1}\n\n`),
    "reset refs/seed/tmp\n\n",
  );

/** One entry of a tree a law writes with fast-import: a mode, a path as bytes (that need not be UTF-8) and a file's content or a gitlink's commit. */
interface RawEntry {
  readonly mode: "100644" | "100755" | "120000" | "160000";
  readonly path: Uint8Array;
  readonly content: Uint8Array | { readonly commit: string };
}

/**
 * The fast-import stream of one commit that holds exactly these entries, with no parent: a `Path` cannot hold a byte that is not UTF-8, so a
 * name made of such bytes is written here and nowhere else. A path that holds a line break or starts with a quote is not written.
 */
export const importCommit = (mark: number, ref: string, entries: ReadonlyArray<RawEntry>): Uint8Array =>
  bytes(
    `commit ${ref}\nmark :${mark}\nauthor Ada <ada@example.test> 1700000000 +0000\ncommitter Ada <ada@example.test> 1700000000 +0000\ndata 2\nc${mark}\ndeleteall\n`,
    ...entries.flatMap((entry): ReadonlyArray<string | Uint8Array> =>
      entry.content instanceof Uint8Array
        ? [`M ${entry.mode} inline `, entry.path, `\ndata ${entry.content.length}\n`, entry.content, "\n"]
        : [`M ${entry.mode} ${entry.content.commit} `, entry.path, "\n"],
    ),
    "\n",
  );

/** Runs fast-import on a stream and gives the id of each mark, in mark order. */
export const fastImport = (dir: string, stream: Uint8Array): Effect.Effect<ReadonlyArray<string>, never, Needs> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const marks = path.join(dir, "seed-marks");
    yield* git(dir, ["fast-import", "--date-format=raw", "--quiet", `--export-marks=${marks}`], stream);
    const text = (yield* fs.exists(marks)) ? yield* fs.readFileString(marks) : "";
    const ids: Array<string> = [];

    for (const line of text.split("\n")) {
      const [mark, id] = line.split(" ");

      if (mark !== undefined && id !== undefined) {
        ids[Number(mark.slice(1)) - 1] = id;
      }
    }

    yield* fs.remove(marks);

    return ids;
  }).pipe(Effect.orDie);

/** The service on the repository at `dir`, built with the real spawner and the real file system in the context, or with `fileSystem` in its place. */
export const openRepository = (
  dir: string,
  settings: Settings,
  fileSystem: FileSystem.FileSystem | undefined = undefined,
): Effect.Effect<
  Repository.Repository["Service"],
  Repository.GitTooOld | Repository.NoRepository | Repository.GitUnavailable | Repository.TimedOut,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Scope.Scope
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fs = fileSystem ?? (yield* FileSystem.FileSystem);

    const context = yield* Layer.build(
      ProcessRepository.layer({ path: dir, settings }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(spawner),
            Layer.succeed(FileSystem.FileSystem)(fs),
          ),
        ),
      ),
    );

    return Context.get(context, Repository.Repository);
  });

/** The tree id of each commit, read from git in one call. */
const treeIds = (
  dir: string,
  ids: ReadonlyArray<CommitId.CommitId>,
): Effect.Effect<ReadonlyArray<Tree.TreeId>, never, ChildProcessSpawner.ChildProcessSpawner> =>
  ids.length === 0
    ? Effect.succeed([])
    : Effect.map(git(dir, ["rev-parse", ...ids.map((id) => `${id}^{tree}`)]), (output) =>
        output
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => Schema.decodeUnknownSync(Tree.TreeId)(line)),
      );

const seed = (
  history: History,
  settings: Settings,
  wrap: (fs: FileSystem.FileSystem) => FileSystem.FileSystem = (fs) => fs,
): Effect.Effect<Seeded, never, Needs | Scope.Scope> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* bareRepository;

    const ids = (yield* fastImport(dir, importStream(history))).map((id) =>
      Schema.decodeUnknownSync(CommitId.CommitId)(id),
    );

    if (history.shallow.length > 0) {
      const cut = history.shallow.map((i) => ids[i] ?? "").join("\n");
      yield* fs.writeFileString(path.join(dir, "shallow"), `${cut}\n`);
    }

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const repository = yield* Effect.orDie(openRepository(dir, settings, wrap(fs)));

    const fingerprint = Effect.all(
      [git(dir, ["for-each-ref", "--format=%(objectname) %(refname)"]), git(dir, ["count-objects", "-v"])],
      { concurrency: 1 },
    ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

    const trees = yield* treeIds(dir, ids).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return { repository, ids, trees, fingerprint, hidden: [dir] };
  }).pipe(Effect.orDie);

/** A subject for the shared laws: each history becomes a real bare repository. */
export const processSubject: Subject = {
  seed: (history, settings) =>
    Effect.gen(function* () {
      const services = yield* Layer.build(NodeServices.layer);

      return yield* seed(history, settings).pipe(Effect.provide(services));
    }),
};

/**
 * Every key of the config that could change what a read or a write of a file prints (ticket 1935's table): how names print and
 * match, what a file's bytes are filtered through, and the size a file is called big at. The attributes file marks every file
 * `text eol=crlf` and runs it through a filter whose commands change the bytes, so a command that asked git to filter shows.
 */
export const setConfigTable = (dir: string): Effect.Effect<void, never, Needs> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.join(dir, "info"), { recursive: true });
    yield* fs.writeFileString(path.join(dir, "info", "attributes"), "* text eol=crlf filter=up\n");
    yield* fs.writeFileString(path.join(dir, "attributes"), "* text eol=crlf filter=up\n");

    for (const [key, value] of [
      ["core.quotePath", "false"],
      ["core.precomposeUnicode", "true"],
      ["core.ignoreCase", "true"],
      ["core.autocrlf", "true"],
      ["core.eol", "crlf"],
      ["core.safecrlf", "true"],
      ["core.attributesFile", path.join(dir, "attributes")],
      ["core.bigFileThreshold", "1"],
      ["filter.up.smudge", "tr a-z A-Z"],
      ["filter.up.clean", "tr A-Z a-z"],
      // Ticket 1935, slice 2: what `mktree`, `hash-object` and the commit a write makes could read, each found by hand on git 2.40.1 to leave
      // the ids of a tree and a commit as they are, except `i18n.commitEncoding`, which `commit-tree` writes as a header and `hash-object` does not.
      ["core.protectHFS", "true"],
      ["core.protectNTFS", "true"],
      ["core.fsync", "all"],
      ["core.fsyncObjectFiles", "true"],
      ["core.compression", "9"],
      ["core.looseCompression", "0"],
      ["core.checkRoundtripEncoding", "utf-16"],
      ["core.symlinks", "false"],
      ["core.fileMode", "false"],
      ["core.whitespace", "trailing-space"],
      ["core.hooksPath", "/nonexistent"],
      ["fsck.badTree", "ignore"],
      ["fsck.zeroPaddedFilemode", "error"],
      ["fsck.hasDotgit", "ignore"],
      ["transfer.fsckObjects", "true"],
      ["receive.fsckObjects", "true"],
      ["i18n.commitEncoding", "ISO-8859-1"],
      ["i18n.logOutputEncoding", "ISO-8859-1"],
      ["commit.gpgSign", "true"],
      ["gpg.program", "/bin/false"],
      ["user.name", "Zed"],
      ["user.email", "zed@example.test"],
      ["user.signingKey", "0"],
      ["author.name", "Zed"],
      ["committer.name", "Zed"],
    ] as const) {
      yield* git(dir, ["config", key, value]);
    }
  }).pipe(Effect.orDie);

const urlFrom = (text: string): Remote.Url => Schema.decodeUnknownSync(Remote.Url)(text);

/** The kind of pack file a rename moves in, by its new name. */
const packKind = (to: string): Hold | undefined => {
  const kind = to.slice(to.lastIndexOf(".") + 1);

  return kind === "pack" || kind === "rev" || kind === "idx" ? kind : undefined;
};

/**
 * A subject for the laws of fetch: the remote and the local repository are two real bare repositories, and the local one's config names the remote
 * `origin`, by its path. The remote is also reached by its path and by a `file://` URL, with no name. The local repository's file system is the real one,
 * wrapped so a fetch can be held once after a call it names: the alternates file written, the adopt's listing, and the rename of each pack file.
 */
export const processFetchSubject: FetchSubject = {
  seed: (remote, local, settings) =>
    Effect.gen(function* () {
      const services = yield* Layer.build(NodeServices.layer);

      return yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        const armed = yield* Cell.make<Option.Option<{ readonly at: Hold; readonly hold: Effect.Effect<void> }>>(
          Option.none(),
        );

        // The call that matches the armed place runs, and then waits there, once.
        const reached = (at: Hold | undefined) =>
          Effect.gen(function* () {
            const now = yield* Cell.get(armed);

            if (at !== undefined && Option.isSome(now) && now.value.at === at) {
              yield* Cell.set(armed, Option.none());
              yield* now.value.hold;
            }
          });

        const gated = (real: FileSystem.FileSystem): FileSystem.FileSystem => ({
          ...real,
          writeFileString: (path, data, options) =>
            Effect.tap(real.writeFileString(path, data, options), () =>
              reached(path.endsWith("/objects/info/alternates") ? "alternates" : undefined),
            ),
          readDirectory: (path, options) =>
            Effect.tap(real.readDirectory(path, options), () =>
              reached(path.endsWith("/objects/pack") ? "listing" : undefined),
            ),
          rename: (from, to) => Effect.tap(real.rename(from, to), () => reached(packKind(to))),
        });

        const there = yield* seed(remote, settings);
        const here = yield* seed(local, settings, gated);
        const remoteDir = there.hidden[0] ?? "";
        const localDir = here.hidden[0] ?? "";
        yield* git(localDir, ["config", "remote.origin.url", remoteDir]);
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

        const seeded: FetchSeeded = {
          repository: here.repository,
          remote: there.repository,
          ids: here.ids,
          remoteIds: there.ids,
          named: Remote.named(Schema.decodeUnknownSync(Remote.Name)("origin")),
          configured: urlFrom(remoteDir),
          urls: [Remote.url(urlFrom(remoteDir)), Remote.url(urlFrom(`file://${remoteDir}`))],
          nowhere: urlFrom(`${remoteDir}-nowhere`),
          shallow: git(localDir, ["rev-parse", "--is-shallow-repository"]).pipe(
            Effect.map((printed) => printed.trim() === "true"),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          ),
          fingerprint: here.fingerprint,
          hidden: [localDir, remoteDir],
          moveRemoteRef: (ref, commit) =>
            git(remoteDir, ["update-ref", ref, there.ids[commit] ?? ""]).pipe(
              Effect.asVoid,
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            ),
          holds: ["alternates", "listing", "pack", "rev", "idx"],
          hold: (at) =>
            Effect.gen(function* () {
              const { gate, hold } = yield* holdGate;
              yield* Cell.set(armed, Option.some({ at, hold }));

              return gate;
            }),
          packs: Effect.orDie(fs.readDirectory(`${localDir}/objects/pack`)),
          garbage: git(localDir, ["count-objects", "-v"]).pipe(
            Effect.map((printed) => Number(/^garbage: (\d+)$/m.exec(printed)?.[1] ?? Number.NaN)),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          ),
        };

        return seeded;
      }).pipe(Effect.provide(services));
    }),
};

/** What `git` printed on stdout and the code it ended with, for a command that may fail. */
interface Ran {
  readonly code: number;
  readonly stdout: string;
}

/**
 * git in a working copy, with a pinned environment and the given variables beside it: no user or system config, no prompt, no editor.
 * It does not die on a code that is not 0, since `git rebase` ends 1 on a conflict.
 */
export const gitIn = (
  dir: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>> = {},
): Effect.Effect<Ran, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const path = yield* Config.String("PATH");

      const handle = yield* spawner.spawn(
        ChildProcess.make("git", args, {
          cwd: dir,
          extendEnv: false,
          env: {
            PATH: path,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_SYSTEM: "/dev/null",
            GIT_TERMINAL_PROMPT: "0",
            GIT_EDITOR: "true",
            LC_ALL: "C",
            ...env,
          },
          stdin: "ignore",
        }),
      );

      const [stdout, , code] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
          handle.exitCode,
        ],
        { concurrency: 3 },
      );

      return { code, stdout };
    }),
  ).pipe(Effect.orDie);

/**
 * The history in a temporary clone with a working copy, which goes away with the scope: every commit imported with the ids a bare
 * repository gives them, and nothing checked out. `git rebase` needs a working copy, and no call of the package ever has one.
 */
export const workingCopy: (
  history: History,
) => Effect.Effect<
  { readonly root: string; readonly ids: ReadonlyArray<CommitId.CommitId> },
  never,
  Needs | Scope.Scope
> = (history) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* gitIn(root, ["init", "--quiet", "-b", "scratch"]);

    const ids = (yield* fastImport(path.join(root, ".git"), importStream(history))).map((id) =>
      Schema.decodeUnknownSync(CommitId.CommitId)(id),
    );

    return { root, ids };
  }).pipe(Effect.orDie);
