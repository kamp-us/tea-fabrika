// Today's tooling: the fixture boxrm.test.ts, boxrm.storage.test.ts and boxrm.guards.test.ts share,
// so CI can run the three files on different machines. Each case builds its own MAIN and box with
// real git, then runs box.sh rm.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { expect } from "vitest";
import { boxTree, boxTrees, oldBoxTree } from "./quest.ts";

const script = join(import.meta.dirname, "box.sh");

export const storageFiles = (root: string) => {
  const files: Record<string, string> = {};

  const visit = (path: string, name: string) => {
    const info = lstatSync(path);
    files[name] = info.isSymbolicLink()
      ? `link:${readlinkSync(path)}`
      : info.isFile()
        ? `file:${readFileSync(path).toString("base64")}`
        : "directory";

    if (info.isDirectory()) {
      for (const child of readdirSync(path)) {
        visit(join(path, child), `${name}/${child}`);
      }
    }
  };

  visit(root, ".");

  return files;
};

export const input = fc.record({
  name: fc.stringMatching(/^[a-z]{2,8}$/),
  value: fc.stringMatching(/^[a-z]{1,12}$/),
  space: fc.boolean(),
  depth: fc.integer({ min: 1, max: 3 }),
  descendant: fc.boolean(),
  // Where the tree is: BOXES/box (quest.ts boxTree), or BOXES for a box made before that layout.
  old: fc.boolean(),
});

type Input = { name: string; value: string; space: boolean; depth: number; descendant: boolean; old: boolean };

type Remote = { branches: string[]; local: number };

export const fixture = (v: Input, body: (f: ReturnType<typeof setup>) => void, clone = false, remote?: Remote) => {
  const dir = mkdtempSync(join(tmpdir(), "box-law-"));

  try {
    body(setup(v, clone, dir, remote));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const setup = (v: Input, clone: boolean, dir: string, remote?: Remote) => {
  const main = join(dir, "main"),
    boxes = join(dir, "boxes");

  const name = `${v.name}${v.space ? " with space" : ""}`;

  const work = v.old ? oldBoxTree(boxes, name) : boxTree(boxes, name),
    data = join(boxes, `${name}-gitdata`),
    home = join(dir, "home");

  for (const path of [main, boxes, boxTrees(boxes), home]) {
    mkdirSync(path);
  }

  const env = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    MAIN: main,
    BOXES: boxes,
    REMOTE: "unused",
    GH_REPO: "fixture/repo",
    FABRIKA_COAUTHOR: "Fixture <fixture@example.test>",
    TYPESAFE_API_KEY: undefined,
  };

  const git = (at: string, ...args: string[]) => {
    const ran = spawnSync("/usr/bin/git", ["-C", at, ...args], {
      encoding: "utf8",
      env,
      timeout: 15_000,
    });

    expect(ran.error).toBeUndefined();
    expect(ran.status, ran.stderr).toBe(0);

    return ran.stdout.trim();
  };

  git(main, "init", "-q", "--initial-branch=main");
  git(main, "config", "user.name", "Fixture");
  git(main, "config", "user.email", "fixture@example.test");
  writeFileSync(join(main, "tracked"), `base ${v.value}\n`);
  writeFileSync(join(main, ".gitignore"), "node_modules/\n");
  git(main, "add", ".");
  git(main, "commit", "-qm", "base");

  if (remote) {
    const base = git(main, "rev-parse", "HEAD"),
      tree = git(main, "rev-parse", "HEAD^{tree}");

    for (const branch of remote.branches) {
      const tip = git(main, "commit-tree", tree, "-p", base, "-m", `${v.value} ${branch}`);
      git(main, "update-ref", `refs/heads/${branch}`, tip);
    }
  }

  const origin = join(dir, "origin.git");
  git(main, "clone", "-q", "--bare", "--no-hardlinks", main, origin);

  if (remote) {
    rmSync(main, { recursive: true });
    git(dir, "clone", "-q", "--no-hardlinks", origin, main);
    git(main, "config", "user.name", "Fixture");
    git(main, "config", "user.email", "fixture@example.test");

    for (const branch of remote.branches.slice(0, remote.local)) {
      git(main, "branch", branch, `origin/${branch}`);
    }
  }

  if (clone) {
    git(main, "clone", "-q", "--reference", main, `--separate-git-dir=${data}`, origin, work);
  } else {
    // Build metadata directly to test refusals independently of the symbolic-ref bug.
    // The real clone law below keeps the normal origin/HEAD, too.
    mkdirSync(work);
    git(work, "init", "-q", "--initial-branch=main", `--separate-git-dir=${data}`);
    git(work, "remote", "add", "origin", origin);
    git(work, "fetch", "-q", "origin", "main");
    git(work, "checkout", "-q", "-B", "main", "FETCH_HEAD");
  }

  git(work, "config", "user.name", "Fixture");
  git(work, "config", "user.email", "fixture@example.test");
  expect(git(main, "remote")).toBe(remote ? "origin" : "");
  expect(git(work, "remote")).toBe("origin");

  const run = (chosen = name, extra: Record<string, string> = {}, _entry: "direct" = "direct") => {
    const command = [script, "rm", chosen];

    const ran = spawnSync("sh", command, {
      cwd: main,
      encoding: "utf8",
      env: { ...env, ...extra },
      timeout: 15_000,
    });

    expect(ran.error).toBeUndefined();
    expect(ran.signal).toBeNull();

    return { code: ran.status, text: (ran.stdout + ran.stderr).trim() };
  };

  const commit = () => {
    git(work, "add", ".");
    git(work, "commit", "-qm", v.value);

    return git(work, "rev-parse", "HEAD");
  };

  const retained = (ref: string) => git(main, "fetch", "-q", data, `${ref}:refs/keep/${v.name}`);

  return { dir, main, boxes, name, work, data, git, run, commit, retained, env };
};

export const kept = (f: ReturnType<typeof setup>, code = 1) => {
  const got = f.run();
  expect(got.code, got.text).toBe(code);
  expect(got.text).toMatch(new RegExp(`^kept box ${f.name}: [^\\n]+$`));
  expect(existsSync(f.work)).toBe(true);
  expect(existsSync(f.data)).toBe(true);
};
