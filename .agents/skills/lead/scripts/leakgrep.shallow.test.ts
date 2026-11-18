import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Field finding 2026-11-18, today's tooling: in a shallow clone, `git rev-list` stops at the commits
// on the clone's edge and lists them with no parents, so `leakgrep.sh --commits origin/main..HEAD`
// read old main history as the branch's own and each edge commit as a first commit, all it holds.
// The check now lists a range only once it reaches its merge base with origin/main with no edge
// commit between, deepens the clone a step at a time until then, and refuses when it cannot. Every
// repository here is a local one reached by a file:// URL, which is what makes git honor a depth.
const script = process.env.TEST_LEAKGREP ?? join(import.meta.dirname, "leakgrep.sh");

// A made-up private word.
const word = "private_zzqxjv";

const pushed = ["HEAD", "--not", "--remotes=origin"];

const topic = "leakgrep: cannot find the range's merge base with origin/main in this shallow clone";

type Ran = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

const git = (cwd: string, ...args: string[]): string => {
  const ran = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
    cwd,
    encoding: "utf8",
  });

  expect(ran.status, ran.stderr).toBe(0);

  return ran.stdout.trim();
};

// The check, run in one repository, with its word list in a file beside the repository.
const check = (cwd: string, words: string, env: Record<string, string>, ...revs: string[]): Ran => {
  const ran = spawnSync("sh", [script, "--commits", ...revs], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined, ...env },
  });

  // It never prints the text it matched.
  expect(ran.stdout + ran.stderr).not.toContain(word);

  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
};

const commitsRead = (ran: Ran) => /^leakgrep: (\d+) commits read, added text clean$/.exec(ran.stdout.trim())?.[1];

const leaks = (ran: Ran) =>
  ran.stderr.split("\n").filter((line) => /^leakgrep: leak \w+ at added line \d+ of commit [0-9a-f]{12}$/.test(line));

const mainLength = 1000;

describe("the leak check in a shallow clone, today's tooling", () => {
  let root = "";
  let server = "";
  let words = "";
  let count = 0;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "lg-shallow-"));
    words = join(root, "words");
    writeFileSync(words, `${word}\n`);

    // Main: a long history of one small file each. The word sits in an old commit, before the
    // branches start, and in a later commit between their start and main's tip.
    const work = join(root, "work");
    mkdirSync(work);
    git(work, "init", "-q", "-b", "main");
    let stream = "";

    for (let n = 1; n <= mainLength; n += 1) {
      const message = `m${n}\n`;
      const body = `line ${n}\n`;
      stream += `commit refs/heads/main\nmark :${n}\ncommitter t <t@example.invalid> ${1_700_000_000 + n} +0000\n`;
      stream += `data ${message.length}\n${message}${n > 1 ? `from :${n - 1}\n` : ""}`;
      stream += `M 100644 inline f/${n}.md\ndata ${body.length}\n${body}`;

      for (const [at, file] of [
        [10, "old.md"],
        [800, "late.md"],
      ] as const) {
        if (n === at) {
          stream += `M 100644 inline ${file}\ndata ${word.length + 1}\n${word}\n`;
        }
      }
    }

    const imported = spawnSync("git", ["fast-import", "--quiet"], { cwd: work, input: stream, encoding: "utf8" });
    expect(imported.status, imported.stderr).toBe(0);
    git(work, "reset", "-q", "--hard", "main");

    const own = (name: string) => {
      writeFileSync(join(work, `${name}.md`), `${name}\n`);
      git(work, "add", "-A");
      git(work, "commit", "-q", "-m", name);
    };

    // plain: two commits on main as it was 400 commits before its tip.
    git(work, "checkout", "-q", "-b", "plain", `main~${400}`);
    own("b1");
    own("b2");
    // merged: the same start, then a merge of main as it was 150 commits before its tip, and one more.
    git(work, "checkout", "-q", "-b", "merged", "plain");
    git(work, "merge", "-q", "--no-edit", `main~${150}`);
    own("b4");

    server = join(root, "server.git");
    git(root, "clone", "-q", "--bare", work, server);
    rmSync(work, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // A shallow clone of the server on one branch, with one commit of its own on top, as a cloud session
  // has it. The word list is outside the clone.
  const clone = <A>(
    branch: string,
    body: (clone: {
      dir: string;
      own: (lines: string[]) => string;
      check: (env: Record<string, string>, ...revs: string[]) => Ran;
    }) => A,
    depth: ReadonlyArray<string> = ["--depth=2", "--no-single-branch"],
  ): A => {
    count += 1;
    const dir = join(root, `clone${count}`);
    git(root, "clone", "-q", ...depth, "-b", branch, `file://${server}`, dir);

    return body({
      dir,
      own: (lines) => {
        writeFileSync(join(dir, "local.md"), lines.map((line) => `${line}\n`).join(""));
        git(dir, "add", "-A");
        git(dir, "commit", "-q", "-m", "local");

        return git(dir, "rev-parse", "HEAD").slice(0, 12);
      },
      check: (env, ...revs) => check(dir, words, env, ...revs),
    });
  };

  const depth = (dir: string) => Number(git(dir, "rev-list", "--count", "--all"));

  it("scenario: a base past the edge is found by deepening, and the range's own commits are read", () => {
    clone("plain", ({ dir, own, check }) => {
      own(["plain"]);
      const before = depth(dir);
      const ran = check({}, "origin/main..HEAD");

      // b1, b2 and the local commit: none of main's history, none read as a first commit.
      expect(ran).toMatchObject({ status: 0 });
      expect(commitsRead(ran)).toBe("3");
      expect(leaks(ran)).toEqual([]);
      expect(ran.stderr).toMatch(/^leakgrep: deepened this shallow clone by \d+ steps of up to 200 commits/m);
      // It went deeper, and it did not unshallow: the commit that holds the word is still not here.
      expect(depth(dir)).toBeGreaterThan(before);
      expect(git(dir, "rev-parse", "--is-shallow-repository")).toBe("true");
      expect(spawnSync("git", ["cat-file", "-e", "origin/main~990"], { cwd: dir }).status).not.toBe(0);
    });
  });

  it("scenario: the range of a push, HEAD --not --remotes=origin, is read the same way", () => {
    clone("plain", ({ dir, own, check }) => {
      own(["plain"]);
      const ran = check({}, ...pushed);

      expect(ran).toMatchObject({ status: 0 });
      expect(commitsRead(ran)).toBe("1");
      expect(leaks(ran)).toEqual([]);
      expect(git(dir, "rev-parse", "--is-shallow-repository")).toBe("true");
    });
  });

  it("scenario: a branch that merged main in has the merge as its own and main's side as not", () => {
    clone("merged", ({ dir, own, check }) => {
      own(["merged"]);
      const ran = check({}, "origin/main..HEAD");

      // b1, b2, the merge, b4 and the local commit. The late word came in through main's side.
      expect(ran).toMatchObject({ status: 0 });
      expect(commitsRead(ran)).toBe("5");
      expect(leaks(ran)).toEqual([]);
      expect(git(dir, "rev-parse", "--is-shallow-repository")).toBe("true");
    });
  });

  it("scenario: a real leak in a commit of the branch is found after deepening", () => {
    clone("plain", ({ own, check }) => {
      const leaky = own([`local says ${word}`]);
      const ran = check({}, "origin/main..HEAD");

      expect(ran.status).toBe(1);
      expect(commitsRead(ran)).toBeUndefined();
      const hits = leaks(ran);

      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatch(new RegExp(`^leakgrep: leak private_word at added line \\d+ of commit ${leaky}$`));
    });
  });

  it("scenario: a clone that is not shallow reads the range as before, with no deepening", () => {
    clone(
      "plain",
      ({ own, check }) => {
        own(["plain"]);
        const ran = check({}, "origin/main..HEAD");

        expect(ran).toMatchObject({ status: 0, stdout: "leakgrep: 3 commits read, added text clean\n" });
        expect(ran.stderr).not.toContain("deepened");
      },
      [],
    );
  });

  it("vector: a base the clone cannot reach refuses with exit 2, reading no commit", () => {
    clone("plain", ({ dir, own, check }) => {
      own(["plain"]);
      git(dir, "remote", "set-url", "origin", `file://${join(root, "gone.git")}`);

      for (const revs of [["origin/main..HEAD"], pushed]) {
        const ran = check({}, ...revs);

        expect(ran.status).toBe(2);
        expect(ran.stdout).toBe("");
        expect(ran.stderr).toContain(
          `${topic}: the fetch from origin failed; deepen it with git fetch --deepen=200 origin main`,
        );
        expect(leaks(ran)).toEqual([]);
      }

      // The failed deepening left the clone as it was.
      expect(git(dir, "rev-parse", "--is-shallow-repository")).toBe("true");
    });
  });

  it("vector: FABRIKA_LEAK_DEEPEN_STEPS caps the steps, and 0 refuses at once", () => {
    clone("plain", ({ dir, own, check }) => {
      own(["plain"]);
      const before = readFileSync(join(dir, ".git/shallow"), "utf8");
      const none = check({ FABRIKA_LEAK_DEEPEN_STEPS: "0" }, "origin/main..HEAD");

      expect(none.status).toBe(2);
      expect(none.stdout).toBe("");
      expect(none.stderr).toContain(`${topic}: gave up after 0 deepening steps;`);
      // Nothing was fetched.
      expect(readFileSync(join(dir, ".git/shallow"), "utf8")).toBe(before);

      // The base is more than one step from main's tip, so one step is too few.
      const one = check({ FABRIKA_LEAK_DEEPEN_STEPS: "1" }, "origin/main..HEAD");

      expect(one.status).toBe(2);
      expect(one.stdout).toBe("");
      expect(one.stderr).toContain(`${topic}: gave up after 1 deepening steps;`);
      expect(leaks(one)).toEqual([]);

      const bad = check({ FABRIKA_LEAK_DEEPEN_STEPS: "many" }, "origin/main..HEAD");

      expect(bad.status).toBe(2);
      expect(bad.stderr).toContain("FABRIKA_LEAK_DEEPEN_STEPS must be a whole number");
    });
  });

  it("vector: a step that adds nothing refuses with exit 2", () => {
    clone("plain", ({ dir, own, check }) => {
      own(["plain"]);
      // The server now holds a main and nothing else, with a history that shares no commit with the
      // clone's edge, so a deepening fetch has nothing to add.
      const other = join(root, "other");
      mkdirSync(other);
      git(other, "init", "-q", "-b", "main");
      writeFileSync(join(other, "x.md"), "x\n");
      git(other, "add", "-A");
      git(other, "commit", "-q", "-m", "unrelated");
      git(dir, "remote", "set-url", "origin", `file://${other}`);

      const ran = check({}, "origin/main..HEAD");

      expect(ran.status).toBe(2);
      expect(ran.stdout).toBe("");
      expect(ran.stderr).toContain(`${topic}: a deepening step added nothing; deepen it with git fetch`);
      expect(leaks(ran)).toEqual([]);
    });
  });
});
