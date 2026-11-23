import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { folder, gitSteps, installStep, words } from "./worktree.ts";

// Today's lead tooling. The git steps run for real on a disposable repo with a disposable origin; the install is not run.
describe("worktree.ts's words", () => {
  // Plant: accept a branch that names a parent folder, a name with a slash, or a wrong count.
  it("vector: a name of dashes and one plain branch are words; anything else is none", () => {
    expect(words(["retro-land", "fabrikalfa/retro-land"])).toEqual({
      name: "retro-land",
      branch: "fabrikalfa/retro-land",
    });

    for (const args of [
      [],
      ["a"],
      ["a", "b", "c"],
      ["A", "b"],
      ["a/b", "b"],
      ["a", "-b"],
      ["a", "x..y"],
      ["a", "x/"],
      ["a", "x.lock"],
      ["", "b"],
    ]) {
      expect(words(args), args.join(" ")).toBeNull();
    }
  });

  it("vector: the folder is beside the main checkout, as tf-<name>", () => {
    expect(folder("/work/tea-fabrika", "retro-land")).toBe("/work/tf-retro-land");
    expect(folder("/work/tea-fabrika/", "x")).toBe("/work/tf-x");
  });

  it("vector: the install is the frozen one, nice'd, in the new folder", () => {
    expect(installStep("/w/tf-x")).toEqual({
      cmd: "nice",
      args: ["-n", "15", "pnpm", "install", "--frozen-lockfile", "--prefer-offline"],
      cwd: "/w/tf-x",
    });
  });
});

describe("worktree.ts's git steps", () => {
  const git = (at: string, ...args: string[]) => {
    const got = spawnSync("/usr/bin/git", ["-C", at, "-c", "user.name=F", "-c", "user.email=f@example.test", ...args], {
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });

    expect(got.status, got.stderr).toBe(0);

    return got.stdout.trim();
  };

  // Plants: leave the branch tracking origin/main (a `git pull` then pulls main), or set the upstream to a wrong branch.
  it("scenario: the branch starts at origin/main, tracks origin/<branch> and not origin/main, and a pull after the first push brings only its own work", () => {
    const dir = mkdtempSync(join(tmpdir(), "worktree-"));

    try {
      const origin = join(dir, "origin");
      const main = join(dir, "tea-fabrika");
      mkdirSync(origin);
      git(origin, "init", "-q", "--initial-branch=main");
      writeFileSync(join(origin, "a.txt"), "base\n");
      git(origin, "add", ".");
      git(origin, "commit", "-qm", "base");
      git(dir, "clone", "-q", origin, main);
      const baseSha = git(main, "rev-parse", "HEAD");

      // Main moves on after the clone: the fetch step must bring it in.
      writeFileSync(join(origin, "b.txt"), "later\n");
      git(origin, "add", ".");
      git(origin, "commit", "-qm", "later");

      const made = join(dir, "tf-x");
      const w = { name: "x", branch: "fabrikalfa/x" };

      for (const step of gitSteps(main, made, w)) {
        expect(step.cmd).toBe("git");
        git(step.cwd, ...step.args);
      }

      expect(folder(main, "x")).toBe(made);
      expect(existsSync(join(made, "b.txt"))).toBe(true);
      expect(git(made, "rev-parse", "HEAD")).not.toBe(baseSha);
      expect(git(made, "config", "branch.fabrikalfa/x.remote")).toBe("origin");
      expect(git(made, "config", "branch.fabrikalfa/x.merge")).toBe("refs/heads/fabrikalfa/x");

      // The first push makes origin/<branch>; main then moves; a pull brings nothing of main.
      writeFileSync(join(made, "x.txt"), "x\n");
      git(made, "add", ".");
      git(made, "commit", "-qm", "x");
      git(made, "push", "-q", "origin", "fabrikalfa/x");
      expect(git(made, "rev-parse", "--abbrev-ref", "fabrikalfa/x@{upstream}")).toBe("origin/fabrikalfa/x");
      writeFileSync(join(origin, "c.txt"), "c\n");
      git(origin, "add", ".");
      git(origin, "commit", "-qm", "c");
      git(made, "pull", "--ff-only");
      expect(existsSync(join(made, "c.txt"))).toBe(false);
      expect(readFileSync(join(made, "x.txt"), "utf8")).toBe("x\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Plant: reuse a branch name that exists, or a folder that exists.
  it("scenario: a branch or folder that already exists is refused by git, so nothing is overwritten", () => {
    const dir = mkdtempSync(join(tmpdir(), "worktree-"));

    try {
      const origin = join(dir, "origin");
      const main = join(dir, "tea-fabrika");
      mkdirSync(origin);
      git(origin, "init", "-q", "--initial-branch=main");
      writeFileSync(join(origin, "a.txt"), "base\n");
      git(origin, "add", ".");
      git(origin, "commit", "-qm", "base");
      git(dir, "clone", "-q", origin, main);
      const w = { name: "x", branch: "fabrikalfa/x" };

      for (const step of gitSteps(main, join(dir, "tf-x"), w)) {
        git(step.cwd, ...step.args);
      }

      const [, add] = gitSteps(main, join(dir, "tf-y"), w);
      const again = spawnSync("/usr/bin/git", ["-C", main, ...(add?.args ?? [])], { encoding: "utf8" });
      expect(again.status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
