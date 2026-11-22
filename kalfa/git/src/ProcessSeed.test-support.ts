// Seeds real bare repositories for the git-binary adapter's laws: `git fast-import` once with the whole
// history, the marks read back for the ids, git's own `shallow` file for a shallow history. Real git runs in
// temp folders, so only an integration law imports this file.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, Context, Effect, Layer, Predicate, Schema, type Scope, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as CommitId from "./CommitId.ts";
import type { History, Person } from "./HistoryTest.ts";
import * as ProcessRepository from "./ProcessRepository.ts";
import * as Repository from "./Repository.ts";
import type { Config as Settings, Seeded, Subject } from "./RepositoryTest.ts";

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

const identLine = (person: Person): string =>
  `${person.name}${person.name === "" ? "" : " "}<${person.email}> ${person.seconds} ${person.offset}`;

/** The fast-import stream of a history: a root starts after `reset`, a merge names its parents in order. */
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
        "\n",
      ];
    }),
    ...history.refs.map((ref) => `reset ${ref.name}\nfrom :${ref.commit + 1}\n\n`),
    "reset refs/seed/tmp\n\n",
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

/** The service on the repository at `dir`, built with the real spawner in the context. */
export const openRepository = (
  dir: string,
  settings: Settings,
): Effect.Effect<
  Repository.Repository["Service"],
  Repository.GitTooOld | Repository.NoRepository | Repository.GitUnavailable | Repository.TimedOut,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const context = yield* Layer.build(
      ProcessRepository.layer({ path: dir, settings }).pipe(
        Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(spawner)),
      ),
    );

    return Context.get(context, Repository.Repository);
  });

const seed = (history: History, settings: Settings): Effect.Effect<Seeded, never, Needs | Scope.Scope> =>
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
    const repository = yield* Effect.orDie(openRepository(dir, settings));

    const fingerprint = Effect.all(
      [git(dir, ["for-each-ref", "--format=%(objectname) %(refname)"]), git(dir, ["count-objects", "-v"])],
      { concurrency: 1 },
    ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

    return { repository, ids, fingerprint, hidden: [dir] };
  }).pipe(Effect.orDie);

/** A subject for the shared laws: each history becomes a real bare repository. */
export const processSubject: Subject = {
  seed: (history, settings) =>
    Effect.gen(function* () {
      const services = yield* Layer.build(NodeServices.layer);

      return yield* seed(history, settings).pipe(Effect.provide(services));
    }),
};
