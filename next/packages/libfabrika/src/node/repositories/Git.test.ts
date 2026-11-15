// 0535, next/. The contract that holds memory git to real git: one generated session of git
// commands runs on each, and every answer must match. It needs real git, so it runs at depth `full`
// only, on the 3-hour schedule; the repository laws run on memory git on every pull request.
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as fc from "fast-check";
import * as RepositoryOpenTest from "../settings/RepositoryOpenTest.ts";
import * as GitLaws from "./GitLaws.test-support.ts";

const files = ["a.txt", "dir/b.txt", "dir/sub/c.txt", "space name.txt", "link"] as const;
const targets = ["a.txt", "dir", "../outside", "/absent/target"] as const;
// Ops 17 to 20 write, add and commit in one cell, so most sessions hold a chain of commits.
const cell = fc.record({ op: fc.nat({ max: 20 }), pick: fc.nat(), flag: fc.boolean() });
const tape = fc.array(cell, { minLength: 1, maxLength: 24 });
const decoder = new TextDecoder();

/** Runs one session on `services` and answers its transcript: each command's exit code, and its
 *  output where git's output is data rather than prose. Commit ids differ between the two (their
 *  clocks differ), so each is named in the order it is made, read with `rev-parse HEAD` after every
 *  commit; blob and tree ids must match as they are. */
const session = (
  services: (typeof GitLaws.gits)[number]["services"],
  format: "sha1" | "sha256",
  branch: string,
  cells: ReadonlyArray<typeof cell extends fc.Arbitrary<infer A> ? A : never>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "git-contract-" }));
      yield* RepositoryOpenTest.isolateGit(root);
      const origin = path.join(root, "origin.git"),
        repo = path.join(root, "repo");
      const commits = new Map<string, string>();
      const named = (text: string) =>
        text.replace(/\b(?:[0-9a-f]{64}|[0-9a-f]{40})\b/g, (id) => {
          const known = commits.get(id) ?? `C${commits.size + 1}`;
          commits.set(id, known);
          return known;
        });
      const transcript: Array<string> = [];
      const git = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const child = yield* spawner.spawn(
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
            );
            const [out, , code] = yield* Effect.all(
              [Stream.mkString(Stream.decodeText(child.stdout)), Stream.runDrain(child.stderr), child.exitCode],
              { concurrency: "unbounded" },
            );
            return { code, out: out.replaceAll(root, "<root>") };
          }),
        );
      });
      /** Records the exit code, and the output when `data` says how to read it. */
      const step = Effect.fnUntraced(function* (
        cwd: string,
        args: ReadonlyArray<string>,
        data?: "commits" | "objects",
      ) {
        const { code, out } = yield* git(cwd, args);
        transcript.push(
          `git ${args.join(" ").replaceAll(root, "<root>")} => ${code}${data === undefined ? "" : ` ${data === "commits" ? named(out) : out}`}`,
        );
        return out;
      });

      yield* step(root, ["init", "--bare", `--object-format=${format}`, `--initial-branch=${branch}`, origin]);
      yield* step(root, ["clone", origin, repo]);
      yield* fs.makeDirectory(path.join(root, "outside"));

      for (const [n, { op, pick, flag }] of cells.entries()) {
        const file = files[pick % files.length]!;
        const at = path.join(repo, file);

        if (op === 0 && file !== "link") {
          yield* fs.makeDirectory(path.dirname(at), { recursive: true });
          yield* fs.remove(at, { recursive: true, force: true });
          yield* fs.writeFileString(at, `text ${n}`);
        } else if (op === 1) {
          yield* fs.remove(path.join(repo, "link"), { recursive: true, force: true });
          yield* fs.symlink(targets[pick % targets.length]!, path.join(repo, "link"));
        } else if (op === 2 && (yield* fs.exists(at)) && file !== "link") {
          yield* fs.chmod(at, flag ? 0o755 : 0o644);
        } else if (op === 3) {
          yield* fs.remove(at, { recursive: true, force: true });
        } else if (op === 4) {
          yield* step(repo, ["add", ["-A", ".", "-u"][pick % 3]!]);
        } else if (op === 5) {
          yield* step(repo, flag ? ["commit", "-q", "-m", `c${n}`] : ["commit", "-q", "--allow-empty", "-m", `c${n}`]);
          yield* step(repo, ["rev-parse", "HEAD"], "commits");
        } else if (op >= 17 && file !== "link") {
          yield* fs.makeDirectory(path.dirname(at), { recursive: true });
          yield* fs.remove(at, { recursive: true, force: true });
          yield* fs.writeFileString(at, `text ${n}`);
          yield* fs.chmod(at, flag ? 0o755 : 0o644);
          yield* step(repo, ["add", "-A"]);
          yield* step(repo, ["commit", "-q", "-m", `c${n}`]);
          yield* step(repo, ["rev-parse", "HEAD"], "commits");
        } else if (op === 6) {
          yield* step(
            repo,
            pick % 2 === 0 ? ["push", "-q", "origin", branch] : ["push", "-q", "--force", "origin", branch],
          );
        } else if (op === 7) {
          yield* step(
            repo,
            [
              ["checkout", "-q", "--force", "--detach", "HEAD~1"],
              ["checkout", "-q", "--force", "-B", branch],
              ["checkout", "-q", "--force", "--detach", "HEAD"],
            ][pick % 3]!,
          );
        } else if (op === 8) {
          yield* step(repo, ["rm", "-q", file]);
        } else if (op === 9) {
          yield* step(repo, ["revert", "--no-edit", "HEAD"]);
          yield* step(repo, ["rev-parse", "HEAD"], "commits");
        } else if (op === 10) {
          yield* step(
            repo,
            ["rev-parse", ...[["HEAD"], ["HEAD^"], ["HEAD~2"], ["--verify", "HEAD^{commit}"]][pick % 4]!],
            "commits",
          );
        } else if (op === 11) {
          yield* step(
            repo,
            pick % 3 === 0 ? ["ls-tree", "HEAD"] : ["ls-tree", "-z", "HEAD", "--", pick % 3 === 1 ? file : "dir"],
            "objects",
          );
        } else if (op === 12) {
          yield* step(repo, ["ls-remote", "--symref", "--", "origin", "HEAD"], "commits");
        } else if (op === 13) {
          yield* step(repo, ["config", "--local", "--no-includes", "--get", "remote.origin.url"], "objects");
        } else if (op === 14) {
          yield* step(repo, pick % 4 === 0 ? ["remote", "remove", "origin"] : ["remote", "set-url", "origin", origin]);
        } else if (op === 15) {
          const linked = path.join(root, `linked-${n}`);
          yield* step(repo, ["worktree", "add", "--detach", linked, "HEAD"]);
          // An unborn HEAD makes no worktree, and a missing folder fails the spawn itself.
          yield* step(
            (yield* fs.exists(linked)) ? linked : repo,
            ["rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir"],
            "objects",
          );
        } else if (op === 16) {
          const listed = yield* step(repo, ["ls-tree", "-z", "HEAD", "--", file], "objects");
          const id = /^[0-7]+ blob ([0-9a-f]+)\t/.exec(listed)?.[1];

          if (id !== undefined) {
            yield* step(repo, ["cat-file", "blob", id], "objects");
          }
        }
      }

      // The end state: what each file is on disk and in HEAD, and what the origin advertises.
      for (const file of files) {
        const at = path.join(repo, file);
        const stat = yield* fs.lstat(at).pipe(Effect.option);
        transcript.push(
          `disk ${file}: ${
            stat._tag === "None"
              ? "absent"
              : stat.value.type === "SymbolicLink"
                ? `link ${yield* fs.readLink(at)}`
                : stat.value.type === "File"
                  ? `file ${(stat.value.mode & 0o100) === 0 ? "644" : "755"} ${decoder.decode(yield* fs.readFile(at))}`
                  : stat.value.type
          }`,
        );
        yield* step(repo, ["ls-tree", "-z", "HEAD", "--", file], "objects");
      }

      yield* step(repo, ["rev-parse", "HEAD"], "commits");
      yield* step(root, ["ls-remote", "--symref", "--", origin, "HEAD"], "commits");
      return transcript;
    }),
  ).pipe(Effect.provide(services));

describe("0535 memory git contract", () => {
  it.runIf(GitLaws.realOnly)(
    "every generated session answers alike on memory git and real git: codes, ids, trees and the files on disk",
    async () => {
      const [memory, real] = GitLaws.gits;
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom("sha1" as const, "sha256" as const),
          fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/),
          tape,
          async (format, branch, cells) => {
            const want = await Effect.runPromise(session(real!.services, format, branch, cells));
            const got = await Effect.runPromise(session(memory!.services, format, branch, cells));
            expect(got).toEqual(want);
          },
        ),
        { seed: 119120, numRuns: 100 },
      );
    },
    600_000,
  );
});
