// T878, next/. The git fixture and reader RepositoriesGit.test.ts and
// RepositoriesGit.identity.test.ts share, moved out of RepositoriesGit.test.ts unchanged so each
// file stays under about 60 s on a CI leg. Each runs on the git layers of GitLaws (0535).

import { runsFor } from "@kampus/vitest";
import { Effect, FileSystem, Path } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as RepositoryOpenTest from "../settings/RepositoryOpenTest.ts";
import * as RepositoriesGit from "./RepositoriesGit.ts";

export const runs = { seed: 119120, numRuns: runsFor({ fast: 20, full: 200 }) };
// CI exhausted 60 s for L5 and both L2 properties. Allow 10 ms per real Git command,
// including scoped setup/cleanup, and count the longest generated tape of four moves.
// A fixture runs six commands. A complete open runs twelve; L5 injects the URL lookup,
// leaving eleven real commands per open. Failed opens stop at or before that twelfth command.
export const gitCommandBudget = 10;

export const git = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return (yield* spawner.string(
    ChildProcess.make("git", [...args], {
      cwd,
      extendEnv: true,
      env: {
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
    }),
  )).trim();
});

export const fixture = Effect.fnUntraced(function* (format: "sha1" | "sha256", branch: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t878-git-" });
  yield* RepositoryOpenTest.isolateGit(root);
  const origin = path.join(root, "origin.git"),
    repo = path.join(root, "selected"),
    person = path.join(root, "person");
  yield* fs.makeDirectory(person);
  yield* git(root, ["init", "--bare", `--object-format=${format}`, `--initial-branch=${branch}`, origin]);
  yield* git(root, ["clone", origin, repo]);
  yield* fs.makeDirectory(path.join(repo, ".fabrika"));
  yield* fs.writeFileString(path.join(repo, ".fabrika/fabrika.toml"), 'fabrika-version = "0.0.0"\n');
  yield* fs.writeFileString(path.join(repo, "source.txt"), "committed source");
  yield* git(repo, ["add", "."]);
  yield* git(repo, ["commit", "-m", "fixture"]);
  yield* git(repo, ["push", "origin", branch]);
  const commit = yield* git(repo, ["rev-parse", "HEAD"]);
  return { fs, path, root, origin, repo, person, branch, commit };
});

export const withReader = <A, E, R>(person: string, body: Effect.Effect<A, E, R>) =>
  body.pipe(Effect.provide(RepositoriesGit.layer({ person })));
