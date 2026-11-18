import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Ticket 1162, today's tooling: in a shallow clone the base of a branch may be out of reach, and git
// then lists the grafted history as if the branch added it. `leakgrep.sh --commits base...head`
// deepens the fetch until the two ends meet, and refuses when a boundary commit is still in range.
const script = process.env.TEST_LEAKGREP ?? join(import.meta.dirname, "leakgrep.sh");

const word = "private_zzqxjv";

const lab = (
  body: (lab: {
    clone: string;
    read: (...revs: string[]) => { status: number | null; stdout: string; stderr: string };
  }) => void,
) => {
  const dir = mkdtempSync(join(tmpdir(), "lg-shallow-"));

  try {
    const words = join(dir, "words");
    writeFileSync(words, `${word}\n`);

    const run = (cwd: string, ...args: string[]) => {
      const ran = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
        cwd,
        encoding: "utf8",
      });

      expect(ran.status, ran.stderr).toBe(0);
    };

    const up = join(dir, "up");
    run(dir, "init", "-q", "-b", "main", up);

    const commit = (file: string, text: string) => {
      writeFileSync(join(up, file), `${text}\n`);
      run(up, "add", "-A");
      run(up, "commit", "-q", "-m", text);
    };

    // Old history on main holds the private word. A branch leaves main four commits later.
    commit("old.md", word);

    for (const n of [1, 2, 3, 4]) {
      commit("main.md", `main ${n}`);
    }

    run(up, "checkout", "-q", "-b", "work");
    commit("work.md", "clean branch line");
    run(up, "checkout", "-q", "main");

    const clone = join(dir, "clone");
    run(dir, "clone", "-q", "--depth=1", "--branch=work", `file://${up}`, clone);
    run(clone, "fetch", "-q", "--depth=1", "origin", "main:refs/remotes/origin/main");

    body({
      clone,
      read: (...revs) =>
        spawnSync("sh", [script, "--commits", ...revs], {
          cwd: clone,
          encoding: "utf8",
          env: { ...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined },
        }),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("T1162 the leak check reads only a branch's own commits in a shallow clone, today's tooling", () => {
  // Plant: scan from the root commit instead of the merge base.
  it("deepens until the branch meets its base, so old history on the base is not read as new", () => {
    lab(({ read }) => {
      const ran = read("origin/main...HEAD");
      expect(ran.status, ran.stderr).toBe(0);
      expect(ran.stdout.trim()).toBe("leakgrep: 1 commits read, added text clean");
    });
  });

  it("a range that still holds a shallow-boundary commit is refused with exit 2, never skipped", () => {
    lab(({ read }) => {
      const ran = read("HEAD");
      expect(ran.status).toBe(2);
      expect(ran.stdout).toBe("");
      expect(ran.stderr).toContain("boundary");
    });
  });
});
