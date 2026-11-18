import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Ticket 1162, today's tooling: in a shallow clone git lists a branch's grafted boundary commit as
// a root that holds everything. `leakgrep.sh --commits base..head` must still read exactly the commits
// the full repository's `git rev-list base..head` names: exit 1 when one of them adds the private
// word, exit 0 when none does, exit 2 only when the history does not fit in the deepen steps (50,
// 200, 1000 commits). Only `base..head` and `--not --remotes=origin` read a branch's own commits;
// `base...head` also reads main's new commits.
const script = process.env.TEST_LEAKGREP ?? join(import.meta.dirname, "leakgrep.sh");

const word = "private_zzqxjv";

/** One step of a history: a commit on the branch, a commit on main, or the branch merging main in. */
type Step = "branch" | "main" | "merge";

type History = {
  /** Commits on main before the branch forks from it. */
  readonly before: number;
  readonly steps: ReadonlyArray<Step>;
  /** Which commit adds the word, counted over the commits made, or none. */
  readonly leak: number | null;
  /** How many commits the clone takes. */
  readonly depth: number;
};

type Built = {
  /** The stream `git fast-import` reads. */
  readonly stream: string;
  /** The commits that make `main..work`, by message. */
  readonly leaker: string | null;
};

// A history as a fast-import stream: one file per commit, so a merge never conflicts, and a merge
// lists the files of main it did not hold yet.
const build = ({ before, steps, leak }: History): Built => {
  let stream = "";
  let n = 0;
  const mainFiles: Array<string> = [];
  const workFiles: Array<string> = [];
  let tip = { main: "", work: "" };
  let merged = 0;
  let leaker: string | null = null;

  const data = (text: string) => `data ${Buffer.byteLength(text)}\n${text}\n`;

  const commit = (
    ref: "main" | "work",
    message: string,
    from: string,
    files: ReadonlyArray<string>,
    merge: string | null,
  ) => {
    n += 1;
    stream += `commit refs/heads/${ref}\nmark :${n}\ncommitter t <t@example.invalid> ${1_000_000 + n} +0000\n${data(message)}`;

    if (from !== "") {
      stream += `from ${from}\n`;
    }

    if (merge !== null) {
      stream += `merge ${merge}\n`;
    }

    for (const file of files) {
      stream += `M 644 :${file.split("/")[0]} ${file.split("/")[1]}\n`;
    }

    return `:${n}`;
  };

  const blob = (text: string) => {
    n += 1;
    stream += `blob\nmark :${n}\n${data(text)}`;

    return `${n}/f${n}.md`;
  };

  const own = (ref: "main" | "work") => {
    const label = `c${n + 2}`;
    const isLeak = leak !== null && leak === made;
    made += 1;
    const file = blob(isLeak ? `says ${word}\n` : `says plain\n`);
    const id = commit(ref, label, tip[ref], [...(ref === "main" ? mainFiles : workFiles), file], null);

    (ref === "main" ? mainFiles : workFiles).push(file);

    if (ref === "work" && isLeak) {
      leaker = label;
    }

    tip = { ...tip, [ref]: id };
  };

  let made = 0;

  for (let i = 0; i < before + 1; i += 1) {
    own("main");
  }

  // The branch forks here. Its files are main's so far.
  tip = { ...tip, work: tip.main };
  workFiles.push(...mainFiles);
  merged = mainFiles.length;
  stream += `reset refs/heads/work\nfrom ${tip.main}\n\n`;

  for (const step of steps) {
    if (step === "branch") {
      own("work");
    } else if (step === "main") {
      own("main");
    } else if (mainFiles.length > merged) {
      const fresh = mainFiles.slice(merged).filter((file) => !workFiles.includes(file));
      n += 1;
      const id = `:${n}`;
      stream += `commit refs/heads/work\nmark ${id}\ncommitter t <t@example.invalid> ${1_000_000 + n} +0000\n${data("merge main")}from ${tip.work}\nmerge ${tip.main}\n`;

      for (const file of fresh) {
        stream += `M 644 :${file.split("/")[0]} ${file.split("/")[1]}\n`;
      }

      workFiles.push(...fresh);
      merged = mainFiles.length;
      tip = { ...tip, work: id };
    }
  }

  return { stream: `${stream}done\n`, leaker };
};

type Ran = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

const lab = (
  history: History,
  range: string,
  body: (ran: Ran, truth: ReadonlyArray<string>, leaker: string | null) => void,
) => {
  const dir = mkdtempSync(join(tmpdir(), "lg-shallow-"));

  try {
    const words = join(dir, "words");
    writeFileSync(words, `${word}\n`);

    const run = (cwd: string, args: ReadonlyArray<string>, input?: string) => {
      const ran = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
        cwd,
        encoding: "utf8",
        input,
      });

      expect(ran.status, ran.stderr).toBe(0);

      return ran.stdout.trim();
    };

    const up = join(dir, "up");
    run(dir, ["init", "-q", "-b", "main", up]);
    const built = build(history);
    run(up, ["fast-import", "--quiet"], built.stream);

    // The truth: what the full repository says the branch added.
    const truth = run(up, ["log", "--format=%s", "main..work"])
      .split("\n")
      .filter((line) => line !== "");

    const clone = join(dir, "clone");
    run(dir, ["clone", "-q", `--depth=${history.depth}`, "--branch=work", `file://${up}`, clone]);
    run(clone, ["fetch", "-q", `--depth=${history.depth}`, "origin", "main:refs/remotes/origin/main"]);

    const ran = spawnSync("sh", [script, "--commits", range], {
      cwd: clone,
      encoding: "utf8",
      env: { ...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined },
    });

    const subjects = new Map(
      run(clone, ["log", "--all", "--format=%h %s"])
        .split("\n")
        .map((line) => [line.split(" ")[0] ?? "", line.split(" ")[1] ?? ""]),
    );

    const hit = /of commit ([0-9a-f]{12})/.exec(ran.stderr);
    const named = hit?.[1] === undefined ? null : ([...subjects].find(([id]) => hit[1]?.startsWith(id))?.[1] ?? null);

    body(
      {
        status: ran.status,
        stdout: ran.stdout.trim(),
        stderr: named === null ? ran.stderr : `${ran.stderr}\nsubject ${named}`,
      },
      truth,
      built.leaker,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const expectRead = (ran: Ran, truth: ReadonlyArray<string>, leaker: string | null) => {
  // Merge commits are named `merge main`, and add nothing of their own.
  const leaks = leaker !== null && truth.includes(leaker);
  expect(ran.status, ran.stderr).toBe(leaks ? 1 : 0);

  if (leaks) {
    expect(ran.stderr).toContain(`subject ${leaker}`);
  } else {
    expect(ran.stdout).toBe(`leakgrep: ${truth.length} commits read, added text clean`);
  }

  expect(ran.stderr).not.toContain(word);
};

const history = fc.record({
  before: fc.nat({ max: 70 }),
  steps: fc.array(fc.constantFrom<Step>("branch", "main", "merge"), { maxLength: 120 }),
  leak: fc.option(fc.nat({ max: 190 }), { nil: null }),
  depth: fc.constantFrom(1, 2, 7, 60),
});

const options = { seed: 1162, numRuns: 12 };

describe("T1162 the leak check reads only a branch's own commits in a shallow clone, today's tooling", () => {
  // Plants: stop deepening at the first merge base; drop the boundary commits of a `..` range
  // instead of refusing them; scan from the root commit.
  it("reads exactly the commits of the full repository's base..head, whatever the clone depth", () => {
    fc.assert(
      fc.property(history, (made) => {
        lab(made, "origin/main..HEAD", expectRead);
      }),
      options,
    );
  });

  // Plants: the same three.
  it("pinned: 2026-11-18-leakgrep-commits-reads-grafted-history, old text on main is not read as the branch's", () => {
    lab(
      { before: 4, steps: ["main", "main", "main", "main", "branch"], leak: 0, depth: 1 },
      "origin/main..HEAD",
      (ran, truth) => {
        expect(truth).toHaveLength(1);
        expect(ran.status, ran.stderr).toBe(0);
        expect(ran.stdout).toBe("leakgrep: 1 commits read, added text clean");
      },
    );
  });

  // Plants: stop deepening at the first merge base (the old fork that merged main in, finding case C).
  it("pinned: a branch forked long ago that merged main in reads only its own commits", () => {
    const steps: Array<Step> = [
      "branch",
      "branch",
      "branch",
      ...Array.from({ length: 295 }, (): Step => "main"),
      "merge",
      "main",
      "main",
    ];

    lab({ before: 5, steps, leak: 0, depth: 1 }, "origin/main..HEAD", (ran, truth) => {
      expect(truth).toHaveLength(4);
      expect(ran.status, ran.stderr).toBe(0);
      expect(ran.stdout).toBe("leakgrep: 4 commits read, added text clean");
    });
  });

  // Plants: stop deepening at the first merge base (finding case A2); drop boundary commits.
  it("pinned: 150 own commits that merged main in are all read, and the first one's word is found", () => {
    const steps: Array<Step> = [
      "main",
      "branch",
      ...Array.from({ length: 149 }, (): Step => "branch"),
      "main",
      "merge",
    ];

    lab({ before: 1, steps, leak: 3, depth: 1 }, "origin/main..HEAD", expectRead);
    lab({ before: 1, steps, leak: 3, depth: 1 }, "origin/main..HEAD", (ran) => expect(ran.status, ran.stderr).toBe(1));
  });

  // Plants: drop the boundary commits instead of refusing.
  it("pinned: a history that does not fit the deepen steps is refused with exit 2, never read in part", () => {
    const steps = Array.from({ length: 2600 }, (): Step => "branch");

    lab({ before: 0, steps, leak: 0, depth: 1 }, "origin/main..HEAD", (ran) => {
      expect(ran.status).toBe(2);
      expect(ran.stdout).toBe("");
      expect(ran.stderr).toContain("boundary");
      expect(ran.stderr).not.toContain("origin/main");
    });
  });
});
