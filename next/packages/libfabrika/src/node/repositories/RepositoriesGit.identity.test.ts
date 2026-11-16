// T878, next/, L5. A clone's identity comes from git's own common directory, on the git layers of
// GitLaws: memory git at every depth, and real git too at depth `full` (0535). Split out of
// RepositoriesGit.test.ts unchanged, since L5 alone takes most of that file's time.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";
import * as fc from "fast-check";
import { Repositories } from "../../repositories/Repositories.ts";
import * as GitLaws from "./GitLaws.test-support.ts";
import { fixture, git, gitCommandBudget, runs, withReader } from "./RepositoriesGit.test-support.ts";

const identityRuns = { ...runs, numRuns: runsFor({ fast: 30, full: 300 }) };
// Fixture, clone, worktree, initial open, then four opens for each move.
const identityGitCommands = 6 + 1 + 1 + 11 + 4 * 4 * 11;

describe.each(GitLaws.gits)("T878 pinned repository reads, $name git", (layer) => {
  it(
    "L5: real clone/common-directory identity separates same basenames and destinations but keeps aliases and credential changes",
    () =>
      fc.assert(
        fc.asyncProperty(
          fc.stringMatching(/^[a-z][a-z0-9]{5,15}$/),
          fc.array(fc.nat(), { minLength: 1, maxLength: 4 }),
          async (credential, tape) =>
            Effect.runPromise(
              Effect.scoped(
                Effect.gen(function* () {
                  const f = yield* fixture("sha1", "release");
                  const otherRoot = f.path.join(f.root, "other");
                  yield* f.fs.makeDirectory(otherRoot);
                  const clone = f.path.join(otherRoot, "selected");
                  yield* git(otherRoot, ["clone", f.origin, clone]);
                  const alias = f.path.join(f.root, "alias");
                  yield* git(f.repo, ["worktree", "add", "--detach", alias, f.commit]);
                  const real = yield* ChildProcessSpawner.ChildProcessSpawner;
                  const key = (location: string, destination: string) => {
                    const spawner = ChildProcessSpawner.make((command) => {
                      if (command._tag !== "StandardCommand" || !command.args.includes("--get-url")) {
                        return real.spawn(command);
                      }

                      // Model a host URL rewrite while keeping every transport on the local bare origin.
                      const bytes = new TextEncoder().encode(destination);
                      return Effect.succeed(
                        ChildProcessSpawner.makeHandle({
                          pid: ChildProcessSpawner.ProcessId(1),
                          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
                          isRunning: Effect.succeed(false),
                          kill: () => Effect.void,
                          stdin: Sink.drain,
                          stdout: Stream.make(bytes),
                          stderr: Stream.empty,
                          all: Stream.make(bytes),
                          getInputFd: () => Sink.drain,
                          getOutputFd: () => Stream.empty,
                          unref: Effect.succeed(Effect.void),
                        }),
                      );
                    });
                    return withReader(
                      f.person,
                      Repositories.use((service) => service.open(location)),
                    ).pipe(
                      Effect.map((handle) => handle.snapshot.key),
                      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
                    );
                  };
                  const destination = "https://example.invalid/repo.git";
                  const initial = yield* key(f.repo, destination);

                  for (const cell of tape) {
                    const authorized = `https://fixture:${credential}${cell}@example.invalid/repo.git`;
                    expect(yield* key(f.repo, authorized)).toBe(initial);
                    expect(yield* key(alias, authorized)).toBe(initial);
                    expect(yield* key(clone, authorized)).not.toBe(initial);
                    expect(yield* key(f.repo, `${destination}-${cell}`)).not.toBe(initial);
                  }
                }),
              ).pipe(Effect.provide(layer.services)),
            ),
        ),
        identityRuns,
      ),
    identityRuns.numRuns * identityGitCommands * gitCommandBudget,
  );
});
