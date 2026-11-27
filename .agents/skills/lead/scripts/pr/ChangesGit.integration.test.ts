// Today's lead tooling. I1 of .kalfa/quests/review-record-PLAN.md: the Changes service on the real `git`, in a temp repository. The one thing only real
// git can show is what `git diff --name-only -z --no-renames` prints for a move out of a reviewed folder: both halves, and a name with a space or
// a line break whole. ChangesGit.test.ts proves the arguments on a stand-in. A real git and a temp folder make this an integration law: the
// laptop refuses it by its name, and CI runs it in the full run.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { Changes } from "./Changes.ts";
import * as ChangesGit from "./ChangesGit.ts";

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

const git = (dir: string, ...args: ReadonlyArray<string>): string => {
  const got = spawnSync(
    "/usr/bin/git",
    ["-C", dir, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args],
    { encoding: "utf8", env, timeout: 10_000 },
  );

  expect(got.status, got.stderr).toBe(0);

  return got.stdout.trim();
};

/** Names a line-based reader or a quoting one gets wrong, and the plain one. */
const MOVED = [
  ["next/old name.ts", "docs/new name.md"],
  ["next/line\nbreak.ts", "docs/line.md"],
  ["kalfa/é.ts", "docs/e.md"],
  ["next/plain.ts", "docs/plain.md"],
] as const;

describe("I1: the changed paths on real git (slice 2)", () => {
  // Plants, each run once and restored: drop `--no-renames`, so a move lists only its new path; split the answer on newlines.
  it.effect(
    "scenario: a file moved out of a reviewed folder lists both its old and its new path, and a name with a space, a line break or an accent comes back whole",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "changes-" });

        git(dir, "init", "-q", "--initial-branch=main");

        for (const [from] of MOVED) {
          mkdirSync(dirname(join(dir, from)), { recursive: true });
          // The same text in each, long enough that git sees a move and not a delete and an add.
          writeFileSync(join(dir, from), `the same lines, moved\n${"a line of the file\n".repeat(20)}`);
        }

        git(dir, "add", ".");
        git(dir, "commit", "-qm", "base");
        // The remote-tracking ref a clone of the repository holds, since the layer asks for `origin/main`.
        git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
        git(dir, "checkout", "-q", "-b", "topic");

        for (const [from, to] of MOVED) {
          mkdirSync(dirname(join(dir, to)), { recursive: true });
          git(dir, "mv", from, to);
        }

        git(dir, "commit", "-qm", "move them out");

        const paths = yield* (yield* Changes).paths(dir, git(dir, "rev-parse", "HEAD"));

        expect([...paths].toSorted()).toEqual(MOVED.flat().toSorted());
      }).pipe(Effect.scoped, Effect.provide(ChangesGit.layer), Effect.provide(NodeServices.layer)),
    30_000,
  );
});
