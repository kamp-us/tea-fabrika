// S2 of docs/plan/quests/port-scripts-0113-PLAN.md: the real-layer set for the shared Git service.
// GitProcess.layer runs real git; GitTest.layer answers from a model in memory. Each law builds a
// small real repository in a temp folder from a generated history, gives the same history to the
// model, and sees both layers answer alike, and governance.ts print the same lines on each.
//
// A history is built step by step (0093): a first base, work and main commit, then a walk whose
// next move is read against the history built so far: a commit on work, on main or on a side
// branch, a side branch made, a `--no-ff` merge of main into work, of work into main or of the side
// into work (each offered only when git would make a merge commit, so a merge of an ancestor is
// one). A commit's edit appends, inserts, removes, replaces, moves or swaps lines, drops the last
// newline, adds or deletes a file. After every move the model either answers what git answers or
// refuses with GitError: an answer that differs from git's is the one thing it may not give.
//
// It starts git and node and writes a temp folder, so it is an `.integration.` file (0584): no
// stand-in can show that real git writes the diff the model writes, or that the process exits with
// the code governance.ts maps. The model's diff carries no hunk positions, so "alike" is read where
// the ports read it: the file header lines, and the changed lines as a sorted list.
//
// The repository's own config pins what a person's global git config could change (a diff prefix,
// color), so the law does not lean on the machine (0052). Rename detection stays git's default, as
// governance.sh ran it; every line of a file carries the file's own name, so no two files are alike
// enough for git to call one a rename of the other. Each branch edits only the files it made, so no
// merge conflicts, and a merge's files are read back from git, so the model holds git's merge.
//
// Each law was planted once (the layer changed to break it, the law seen red) and restored by copy;
// the plant is named beside it.
import { NodeServices } from "@effect/platform-node";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, FileSystem, Layer, Path, type Scope } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { governance } from "../governance.ts";
import { run } from "../pr/command.ts";
import { Git } from "./Git.ts";
import * as GitProcess from "./GitProcess.ts";
import * as GitTest from "./GitTest.ts";

// A red stops at its first counterexample, as the other real-IO laws do: shrinking through real git
// and node runs past the test's time limit, and the red would read as a timeout.
const runs = { seed: 119120, numRuns: runsFor({ fast: 5, full: 30 }), endOnFailure: true };

/** One case, in its own scope, on Node's platform. */
const ran = <A, E>(law: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>) =>
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits the Promise each async case hands back
  Effect.runPromise(law.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

/** Setup git reads no person's config: no signing key, no hooks path, no other name. */
const CLEAN = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

/** What a person's global config could change in a diff, pinned in the repository's own config. */
const PINNED = [
  ["user.name", "law"],
  ["user.email", "law@example.invalid"],
  ["commit.gpgsign", "false"],
  ["diff.noprefix", "false"],
  ["diff.mnemonicPrefix", "false"],
  ["color.ui", "false"],
  ["core.quotePath", "true"],
  ["merge.ff", "false"],
] as const;

const WORDS = ["ledger", "review", "merge", "lint", "port", "never", "shell", "box", "brain", "lease", "Effect"];
const word = fc.constantFrom(...WORDS);

/** A file's lines: each carries the file's own name, so git sees no rename between two files. */
const body = fc.array(fc.array(word, { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 4 });

/**
 * What HEAD does to a file of the merge base: an edit appends lines or swaps every one, the two
 * shapes whose changed lines the model knows. Every history holds each fate once, so each run
 * reaches all five and asserts it: the first file is a decision HEAD added, which governance always
 * lists, and the second a decision with one of the other four fates, shuffled.
 */
const FATES = ["added", "same", "append", "swap", "deleted"] as const;

const file = fc.record({
  folder: fc.constantFrom(".decisions", "src", "docs"),
  name: fc.array(word, { minLength: 1, maxLength: 2 }),
  number: fc.integer({ min: 1, max: 9999 }),
  before: body,
  after: body,
});

const history = fc.record({
  files: fc
    .tuple(
      fc.uniqueArray(file, {
        selector: (f) => `${f.number}/${f.name.join("-")}`,
        minLength: FATES.length,
        maxLength: FATES.length,
      }),
      fc.shuffledSubarray(FATES.slice(1), { minLength: FATES.length - 1 }),
    )
    .map(([fs, rest]) => {
      const fates = [FATES[0], ...rest];
      return fs.map((f, i) => ({
        ...f,
        folder: i < 2 ? ".decisions" : f.folder === ".decisions" ? "src" : f.folder,
        fate: fates[i] ?? "same",
      }));
    }),
  mainOnly: body,
});

type History = typeof history extends fc.Arbitrary<infer H> ? H : never;

/** The branches a walk commits on: HEAD is always on `work`, and the diff is `main...HEAD`. */
type Branch = "main" | "work" | "side";

/** A walk's moves, in the order the fold offers them. */
const MOVES = ["work", "main", "side", "branch", "mergeMain", "mergeWork", "mergeSide", "mergeBehind"] as const;
type Move = (typeof MOVES)[number];

/** What a commit does to one file its branch made, or `add`, a new file. */
const EDITS = ["add", "append", "insert", "remove", "replace", "move", "swap", "noeol", "delete"] as const;

/**
 * One raw step. The fold reads it against the history it has built: a move that is not possible
 * there is replaced by the possible move `at` names, and `file`, `at` and `to` pick a file and lines
 * among the ones that exist.
 */
const step = fc.record({
  move: fc.constantFrom(...MOVES),
  edit: fc.constantFrom(...EDITS),
  file: fc.nat(),
  at: fc.nat(),
  to: fc.nat(),
  folder: fc.constantFrom(".decisions", "src", "docs"),
  name: fc.array(word, { minLength: 1, maxLength: 2 }),
  lines: body,
});

type Step = typeof step extends fc.Arbitrary<infer S> ? S : never;

const walk = fc.record({ history, steps: fc.array(step, { minLength: 6, maxLength: 14 }) });

type Walk = typeof walk extends fc.Arbitrary<infer W> ? W : never;

const filePath = (f: History["files"][number]) =>
  f.folder === ".decisions"
    ? `.decisions/${String(f.number).padStart(4, "0")}-${f.name.join("-").toLowerCase()}.md`
    : `${f.folder}/${f.name.join("-").toLowerCase()}-${f.number}.md`;

const fileText = (path: string, tag: string, ls: ReadonlyArray<ReadonlyArray<string>>) =>
  ls.map((l) => `${path} ${tag} ${l.join(" ")}\n`).join("");

/** The merge base's tree, HEAD's, and main's, which changes one file only main has. */
const trees = (h: History) => {
  const base: Record<string, string> = { ".decisions/README.md": "# Decisions\n" };
  const head: Record<string, string> = { ".decisions/README.md": "# Decisions\n" };

  for (const f of h.files) {
    const path = filePath(f);
    const was =
      f.folder === ".decisions"
        ? `---\ntitle: ${f.name.join(" ")}\n---\n${fileText(path, "old", f.before)}`
        : fileText(path, "old", f.before);

    if (f.fate !== "added") {
      base[path] = was;
    }

    if (f.fate === "same" || f.fate === "added") {
      head[path] = was;
    } else if (f.fate === "append") {
      head[path] = `${was}${fileText(path, "more", f.after)}`;
    } else if (f.fate === "swap") {
      head[path] = fileText(path, "new", f.after);
    }
  }

  return { base, head, main: { ...base, "notes/main-only.md": fileText("notes/main-only.md", "main", h.mainOnly) } };
};

/** Whether `ancestor` is `from` or one of its ancestors, in the walk's commits. */
const reaches = (commits: Readonly<Record<string, GitTest.Commit>>, from: string, ancestor: string): boolean => {
  const seen = new Set<string>();
  const queue = [from];

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (next === ancestor) {
      return true;
    }

    if (!seen.has(next)) {
      seen.add(next);
      queue.push(...(commits[next]?.parents ?? []));
    }
  }

  return false;
};

/** The moves git would make in this history: a merge only when it makes a merge commit. */
const possible = (
  commits: Readonly<Record<string, GitTest.Commit>>,
  refs: Readonly<Record<string, string>>,
): ReadonlyArray<Move> => {
  const { main = "", work = "", side } = refs;
  const behind = commits[work]?.parents[0];
  const can: Record<Move, boolean> = {
    work: true,
    main: true,
    side: side !== undefined,
    branch: side === undefined,
    mergeMain: !reaches(commits, work, main),
    mergeWork: !reaches(commits, main, work),
    mergeSide: side !== undefined && !reaches(commits, work, side),
    mergeBehind: behind !== undefined && !reaches(commits, main, behind),
  };
  return MOVES.filter((move) => can[move]);
};

/** The move a raw step makes here: its own when possible, else the possible one `at` names. */
const chosen = (s: Step, can: ReadonlyArray<Move>): Move =>
  can.includes(s.move) ? s.move : (can[s.at % can.length] ?? "work");

/** One commit's tree: the step's edit on one file `mine` holds, or a new file when it holds none. */
const edited = (tree: GitTest.Tree, mine: ReadonlyArray<string>, s: Step, n: number) => {
  const target = s.edit === "add" ? undefined : mine[s.file % Math.max(mine.length, 1)];

  if (target === undefined) {
    const slug = s.name.join("-").toLowerCase();
    const path =
      s.folder === ".decisions"
        ? `.decisions/${String(n).padStart(4, "0")}-step-${slug}.md`
        : `${s.folder}/${slug}-step${n}.md`;
    const head = s.folder === ".decisions" ? `---\ntitle: ${s.name.join(" ")}\n---\n` : "";
    return { tree: { ...tree, [path]: `${head}${fileText(path, `add${n}`, s.lines)}` }, added: path, moved: false };
  }

  if (s.edit === "delete") {
    const { [target]: _gone, ...rest } = tree;
    return { tree: rest, added: undefined, moved: false };
  }

  const text = tree[target] ?? "";
  const eol = text.endsWith("\n");
  const old = (eol ? text.slice(0, -1) : text).split("\n");
  const fresh = s.lines.map((l) => `${target} step${n} ${l.join(" ")}`);
  const at = s.at % old.length;
  const to = s.to % old.length;
  const lines = (() => {
    switch (s.edit) {
      case "append":
      case "noeol":
        return s.edit === "append" ? [...old, ...fresh] : old;
      case "insert":
        return old.toSpliced(s.at % (old.length + 1), 0, ...fresh);
      case "remove":
        return old.length < 2 ? [...old, ...fresh] : old.toSpliced(at, 1);
      case "replace":
        return fresh;
      case "move": {
        const rest = old.toSpliced(at, 1);
        return rest.toSpliced(s.to % (rest.length + 1), 0, old[at] ?? "");
      }
      case "swap": {
        const other = to === at ? (at + 1) % old.length : to;
        return old.map((line, i) => (i === at ? (old[other] ?? line) : i === other ? (old[at] ?? line) : line));
      }
      // Returned above as a new file; the type only knows `delete` went.
      case "add":
        return old;
    }
  })();
  const now = `${lines.join("\n")}${eol && s.edit !== "noeol" ? "\n" : ""}`;
  return {
    tree: { ...tree, [target]: now },
    added: undefined,
    moved: (s.edit === "move" || s.edit === "swap") && now !== text,
  };
};

/** What a walk reached, over a whole property: each required case must be met at least once. */
const reached = () => ({ answered: 0, refused: 0, ancestorMerge: 0, mainIntoWork: 0, movedLines: 0, manyBases: 0 });

/** One real repository at a temp folder, built from the trees, and the model of the same history. */
const build = Effect.fn("git.integration.build")(function* (h: History) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "git-law-" }));
  const git = Effect.fn("git.integration.git")(function* (...args: ReadonlyArray<string>) {
    const ran = yield* run("git", args, dir, { env: CLEAN });
    expect(ran.code, `git ${args.join(" ")}: ${ran.err}`).toBe(0);
    return ran.out.trim();
  });
  const commit = Effect.fn("git.integration.commit")(function* (
    tree: Readonly<Record<string, string>>,
    message: string,
  ) {
    for (const entry of yield* fs.readDirectory(dir)) {
      if (entry !== ".git") {
        yield* fs.remove(path.join(dir, entry), { recursive: true });
      }
    }

    for (const [at, text] of Object.entries(tree)) {
      yield* fs.makeDirectory(path.dirname(path.join(dir, at)), { recursive: true });
      yield* fs.writeFileString(path.join(dir, at), text);
    }

    yield* git("add", "-A");
    yield* git("commit", "-q", "--allow-empty", "-m", message);
    return yield* git("rev-parse", "HEAD");
  });

  yield* git("init", "-q", "-b", "main");

  for (const [key, value] of PINNED) {
    yield* git("config", key, value);
  }

  const t = trees(h);
  const b = yield* commit(t.base, "base");
  yield* git("checkout", "-q", "-b", "work");
  const w = yield* commit(t.head, "work");
  yield* git("checkout", "-q", "main");
  const m = yield* commit(t.main, "main");
  yield* git("checkout", "-q", "work");
  const model: GitTest.Model = {
    top: dir,
    commits: {
      [b]: { parents: [], tree: t.base },
      [w]: { parents: [b], tree: t.head },
      [m]: { parents: [b], tree: t.main },
    },
    refs: { HEAD: w, work: w, main: m },
  };

  const commits: Record<string, GitTest.Commit> = { ...model.commits };
  const refs: Record<string, string> = { work: w, main: m };
  const owner = new Map<string, Branch>([
    ...Object.keys({ ...t.base, ...t.head }).map((p): [string, Branch] => [p, "work"]),
    ["notes/main-only.md", "main"],
  ]);
  /** The model of the history the walk has built so far, HEAD on work. */
  const now = (): GitTest.Model => ({ top: dir, commits: { ...commits }, refs: { ...refs, HEAD: refs.work ?? w } });

  /** One raw step, read against the history so far and made in the real repository and the model. */
  const take = Effect.fn("git.integration.take")(function* (s: Step, n: number) {
    const move = chosen(s, possible(commits, refs));

    if (move === "branch") {
      yield* git("branch", "side", "work");
      refs.side = refs.work ?? w;
      return { move, ancestor: false, moved: false };
    }

    if (move === "work" || move === "main" || move === "side") {
      const tip = refs[move] ?? w;
      const tree = commits[tip]?.tree ?? {};
      const mine = Object.keys(tree)
        .filter((p) => owner.get(p) === move)
        .toSorted();
      const next = edited(tree, mine, s, n);

      if (next.added !== undefined) {
        owner.set(next.added, move);
      }

      yield* git("checkout", "-q", move);
      const sha = yield* commit(next.tree, `${move} ${n}`);
      commits[sha] = { parents: [tip], tree: next.tree };
      refs[move] = sha;
      yield* git("checkout", "-q", "work");
      return { move, ancestor: false, moved: next.moved };
    }

    // `mergeBehind` merges into main the commit before work's tip, so that a later step can find two
    // best merge bases (a criss-cross), which the model must refuse.
    const into = move === "mergeWork" || move === "mergeBehind" ? "main" : "work";
    const tip = refs[into] ?? w;
    const other =
      move === "mergeBehind"
        ? (commits[refs.work ?? w]?.parents[0] ?? w)
        : (refs[move === "mergeWork" ? "work" : move === "mergeMain" ? "main" : "side"] ?? w);
    yield* git("checkout", "-q", into);
    yield* git("merge", "-q", "--no-ff", "-m", `${move} ${n}`, other);
    const sha = yield* git("rev-parse", "HEAD");
    const tracked = (yield* git("ls-files", "-z")).split("\0").filter((p) => p !== "");
    const texts = yield* Effect.forEach(tracked, (p) => fs.readFileString(path.join(dir, p)), {
      concurrency: 16,
    });
    commits[sha] = { parents: [tip, other], tree: Object.fromEntries(tracked.map((p, i) => [p, texts[i] ?? ""])) };
    refs[into] = sha;
    yield* git("checkout", "-q", "work");
    // A `--no-ff` merge of a commit that already holds the branch: its first parent is an ancestor
    // of its second.
    return { move, ancestor: reaches(commits, other, tip), moved: false };
  });

  /** How many best merge bases real git names for main and HEAD. */
  const bases = Effect.map(git("merge-base", "--all", "main", "HEAD"), (out) => out.split("\n").length);

  return { dir, model, now, take, bases };
});

/** A diff as the ports read it: its file header lines, and its changed lines, each sorted. */
const readDiff = (diff: string) => {
  const lines = diff.split("\n");
  return {
    headers: lines.filter((l) => l.startsWith("--- ") || l.startsWith("+++ ")).toSorted(),
    changed: lines.filter((l) => /^[+-]/.test(l) && !l.startsWith("--- ") && !l.startsWith("+++ ")).toSorted(),
  };
};

/** Both layers' answers to the same calls. */
const answers = (git: Layer.Layer<Git>) =>
  Effect.gen(function* () {
    const service = yield* Git;
    const top = yield* service.top;
    const diff = readDiff(yield* service.diff(["--unified=0", "main...HEAD"]));
    const unknown = yield* Effect.exit(service.diff(["--unified=0", "no-such-ref...HEAD"]));
    return { top, diff, unknown: Exit.isFailure(unknown) };
  }).pipe(Effect.provide(git));

/** The three-dot diff on real git, and on the model: the same answer, or the model's refusal. */
const alike = (dir: string, model: GitTest.Model) =>
  Effect.gen(function* () {
    const diff = Effect.gen(function* () {
      const service = yield* Git;
      return readDiff(yield* service.diff(["--unified=0", "main...HEAD"]));
    });
    const real = yield* diff.pipe(Effect.provide(GitProcess.layer(dir).pipe(Layer.provide(NodeServices.layer))));
    const fake = yield* diff.pipe(
      Effect.provide(GitTest.layer(model)),
      Effect.catchTag("GitError", (e) => Effect.succeed({ refused: e._tag })),
    );
    return { real, fake };
  });

/** governance.ts's lines on one pair of layers. */
const governed = (layers: Layer.Layer<Git | FileSystem.FileSystem>) =>
  Effect.gen(function* () {
    const exit = yield* Command.runWith(governance, { version: "0.0.0" })(["main"]).pipe(Effect.exit);
    const out = (yield* TestConsole.logLines).map(String).join("\n");
    return { ok: Exit.isSuccess(exit), out };
  }).pipe(Effect.provide(Layer.merge(layers, TestConsole.layer)));

/** governance.ts's lines on the model, or its refusal when the model refuses a git call. */
const governedOrRefused = (layers: Layer.Layer<Git | FileSystem.FileSystem>) =>
  Effect.gen(function* () {
    const refused = yield* Command.runWith(governance, { version: "0.0.0" })(["main"]).pipe(
      Effect.as(undefined),
      Effect.catchTag("GitError", (e) => Effect.succeed(e._tag)),
    );
    const out = (yield* TestConsole.logLines).map(String).join("\n");
    return refused === undefined ? { ok: true, out } : { refused };
  }).pipe(Effect.provide(Layer.merge(layers, TestConsole.layer)));

/** A first history whose every file has two or more lines, for the pinned walks below. */
const PINNED_HISTORY: History = {
  files: [
    { folder: ".decisions", name: ["ledger"], number: 1, before: [["review"]], after: [["merge"]], fate: "added" },
    {
      folder: ".decisions",
      name: ["port"],
      number: 2,
      before: [["lint"], ["box"]],
      after: [["shell"]],
      fate: "append",
    },
    { folder: "src", name: ["lease"], number: 3, before: [["brain"], ["never"]], after: [["lint"]], fate: "same" },
    { folder: "docs", name: ["merge"], number: 4, before: [["port"], ["box"]], after: [["Effect"]], fate: "swap" },
    { folder: "src", name: ["review"], number: 5, before: [["shell"], ["lease"]], after: [["brain"]], fate: "deleted" },
  ],
  mainOnly: [["ledger"], ["merge"]],
};

const pinnedStep = (move: Move, edit: Step["edit"], file: number, at: number, to: number): Step => ({
  move,
  edit,
  file,
  at,
  to,
  folder: "src",
  name: ["box"],
  lines: [["review"]],
});

/**
 * Pinned, a past bug: commit X, Y on X, HEAD a `--no-ff` merge with parents [X, Y], main at Y. Git's
 * merge base is Y and `diff main...HEAD` is empty; the model walked back from HEAD and took X, so
 * Y's file showed as added. Here X is work, main merges work, Y is main's next commit, and work
 * merges main.
 */
const ANCESTOR_MERGE: Walk = {
  history: PINNED_HISTORY,
  steps: [
    pinnedStep("mergeWork", "add", 0, 0, 0),
    pinnedStep("main", "add", 0, 0, 0),
    pinnedStep("mergeMain", "add", 0, 0, 0),
  ],
};

/**
 * Pinned, a past bug: two lines that swap places. Git changes 2 lines; the model trimmed only the
 * lines both sides share at the start and the end, and changed 4. Work swaps the two old lines of
 * `.decisions/0002-port.md`, its second file, after its frontmatter.
 */
const SWAPPED_LINES: Walk = { history: PINNED_HISTORY, steps: [pinnedStep("work", "swap", 1, 3, 4)] };

describe("the Git service's two layers", () => {
  // Plant, run once: GitTest's `diff` read `a...b` as `a..b`, from main and not from the merge base.
  // Red: main's own change showed in the model's diff and not in real git's.
  // Plant, run once: GitTest's merge base walked back from HEAD and took the first commit main also
  // has. Red: the pinned ancestor merge, the model's diff showed main's files as added.
  // Plant, run once: GitTest's file diff trimmed shared lines and answered every other shape. Red:
  // the pinned swap, the model changed 4 lines where git changed 2.
  // Plant, run once: GitTest took the first of several best merge bases and did not refuse. Red: a
  // walked criss-cross, git named two bases and the model answered a diff.
  it("property: GitProcess and GitTest answer top and a three-dot diff alike, and both refuse an unknown ref", () => {
    const seen = reached();
    return fc.assert(
      fc.asyncProperty(walk, (wk) =>
        ran(
          Effect.gen(function* () {
            const { dir, model, now, take, bases } = yield* build(wk.history);
            const real = yield* answers(GitProcess.layer(dir).pipe(Layer.provide(NodeServices.layer)));
            const fake = yield* answers(GitTest.layer(model));
            expect(fake).toEqual(real);
            expect(real.unknown).toBe(true);
            expect(real.top).toBe(dir);
            // Every history adds, deletes, appends to and swaps a file: each run reaches all four.
            expect(real.diff.headers).toContain("--- /dev/null");
            expect(real.diff.headers).toContain("+++ /dev/null");
            expect(real.diff.changed.some((l) => l.startsWith("-") && l.includes(" old "))).toBe(true);
            expect(real.diff.changed.some((l) => l.includes(" more "))).toBe(true);

            for (const [n, s] of wk.steps.entries()) {
              const took = yield* take(s, n + 1);
              const both = yield* alike(dir, now());
              seen.movedLines += took.moved ? 1 : 0;

              // Where git names more than one best merge base, the model must refuse.
              if ((yield* bases) > 1) {
                expect(both.fake).toEqual({ refused: "GitError" });
                seen.manyBases += 1;
              }

              if ("refused" in both.fake) {
                // A refusal is a GitError, never another error and never an answer unlike git's.
                expect(both.fake.refused).toBe("GitError");
                seen.refused += 1;
              } else {
                expect(both.fake).toEqual(both.real);
                seen.answered += 1;
                seen.ancestorMerge += took.ancestor ? 1 : 0;
                seen.mainIntoWork += took.move === "mergeMain" ? 1 : 0;
              }
            }
          }),
        ),
      ),
      {
        ...runs,
        examples: [[ANCESTOR_MERGE], [SWAPPED_LINES]],
        // Coverage, once every run is done: the walks answer after a merge of an ancestor and of
        // main into work, make moved-line edits, reach a history with several best merge bases,
        // and see the model both answer and refuse. A case never reached fails here by name.
        reporter: (out) => {
          if (out.failed) {
            throw new Error(fc.defaultReportMessage(out));
          }

          expect(Object.entries(seen).filter(([, count]) => count === 0)).toEqual([]);
        },
      },
    );
  });

  // Plant, run once: GitTest's work tree read the merge base's files in place of HEAD's. Red: a
  // decision HEAD added was listed on the real layers and not on the model.
  it("property: governance.ts prints the same lines on the real layers and on the model of the same history", () =>
    fc.assert(
      fc.asyncProperty(walk, (wk) =>
        ran(
          Effect.gen(function* () {
            const { dir, model, now, take } = yield* build(wk.history);
            const real = yield* governed(
              Layer.merge(GitProcess.layer(dir).pipe(Layer.provide(NodeServices.layer)), NodeServices.layer),
            );
            const fake = yield* governed(Layer.merge(GitTest.layer(model), GitTest.workTree(model)));
            expect(real.ok).toBe(true);
            expect(fake).toEqual(real);
            // The decision HEAD added is listed in every run, so no run compares two empty answers.
            const added = wk.history.files.slice(0, 1).map((f) => `${filePath(f)}: edited`);
            expect(added).toHaveLength(1);
            expect(real.out.split("\n")).toEqual(expect.arrayContaining(added));

            // After the walk: the same lines again, or the model's refusal of a git call.
            for (const [n, s] of wk.steps.entries()) {
              yield* take(s, n + 1);
            }

            const after = now();
            const walked = yield* governedOrRefused(
              Layer.merge(GitProcess.layer(dir).pipe(Layer.provide(NodeServices.layer)), NodeServices.layer),
            );
            const modeled = yield* governedOrRefused(Layer.merge(GitTest.layer(after), GitTest.workTree(after)));
            expect(walked).toEqual({ ok: true, out: expect.any(String) });
            expect(modeled).toEqual("refused" in modeled ? { refused: "GitError" } : walked);
          }),
        ),
      ),
      { ...runs, examples: [[ANCESTOR_MERGE], [SWAPPED_LINES]] },
    ));

  // S6 added `commonDir`, `remote` and `globalConfig` for Env.ts. A small real repository, maybe a
  // worktree of it, maybe an origin, and a global config file of its own (GIT_CONFIG_GLOBAL, so no
  // person's config is read) that sets user.name and user.email or leaves them out. The model of the
  // same world must answer the three calls as real git does.
  // The tests step wrote this law before GitProcess had the three calls, so each plant ran once on a
  // reference of them, written for the plants and restored by copy before the commit.
  // Plant, run once: GitProcess's `remote` failed on a missing remote. Red: "no origin" was a
  // GitError on the real layer and none on the model. Plant, run once: GitProcess's `commonDir` ran
  // `--show-toplevel`. Red: in a worktree, the real layer named the worktree and the model its main
  // checkout's git folder.
  it("property: GitProcess and GitTest answer commonDir, remote and globalConfig alike, in a main checkout and a worktree", () => {
    const seen = new Set<string>();
    const world = fc.record({
      worktree: fc.boolean(),
      origin: fc.option(
        fc.constantFrom(
          "https://github.com/owner/name.git",
          "git@github.com:owner/name",
          "https://example.com/a/b.git",
        ),
        { nil: undefined, freq: 2 },
      ),
      name: fc.option(
        fc.array(word, { minLength: 1, maxLength: 3 }).map((w) => w.join(" ")),
        {
          nil: undefined,
          freq: 2,
        },
      ),
      email: fc.option(
        word.map((w) => `${w.toLowerCase()}@example.invalid`),
        { nil: undefined, freq: 2 },
      ),
    });
    return fc.assert(
      fc.asyncProperty(world, (w) =>
        ran(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const dir = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "git-env-law-" }));
            const main = path.join(dir, "main");
            const config = path.join(dir, "gitconfig");
            yield* fs.makeDirectory(main);
            yield* fs.writeFileString(config, "");
            const git = Effect.fn("git.integration.envGit")(function* (cwd: string, ...args: ReadonlyArray<string>) {
              const r = yield* run("git", args, cwd, { env: CLEAN });
              expect(r.code, `git ${args.join(" ")}: ${r.err}`).toBe(0);
            });
            yield* git(main, "init", "-q", "-b", "main");

            for (const [key, value] of PINNED) {
              yield* git(main, "config", key, value);
            }

            yield* git(main, "commit", "-q", "--allow-empty", "-m", "base");

            if (w.origin !== undefined) {
              yield* git(main, "remote", "add", "origin", w.origin);
            }

            if (w.name !== undefined) {
              yield* git(main, "config", "--file", config, "user.name", w.name);
            }

            if (w.email !== undefined) {
              yield* git(main, "config", "--file", config, "user.email", w.email);
            }

            const top = w.worktree ? path.join(dir, "wt") : main;

            if (w.worktree) {
              yield* git(main, "worktree", "add", "-q", "-b", "wt", top);
            }

            const model: GitTest.Model = {
              top,
              ...(w.worktree ? { commonDir: path.join(main, ".git") } : {}),
              commits: { b: { parents: [], tree: {} } },
              refs: { HEAD: "b" },
              remotes: w.origin === undefined ? {} : { origin: w.origin },
              globalConfig: {
                ...(w.name === undefined ? {} : { "user.name": w.name }),
                ...(w.email === undefined ? {} : { "user.email": w.email }),
              },
            };
            const ask = Effect.gen(function* () {
              const service = yield* Git;
              return {
                commonDir: yield* service.commonDir,
                origin: yield* service.remote("origin"),
                other: yield* service.remote("upstream"),
                name: yield* service.globalConfig("user.name"),
                email: yield* service.globalConfig("user.email"),
              };
            });
            // GitProcess runs git in this process's environment, so the global config file is set
            // there for this case alone. Config passed in the environment (GIT_CONFIG_COUNT) is
            // turned off too: a cloud box sets a `url.<base>.insteadOf` there, which rewrites the
            // URL `remote get-url` prints, and the law must not lean on the machine (0052).
            vi.stubEnv("GIT_CONFIG_GLOBAL", config);
            vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
            vi.stubEnv("GIT_CONFIG_COUNT", "0");
            const real = yield* ask.pipe(
              Effect.provide(GitProcess.layer(top).pipe(Layer.provide(NodeServices.layer))),
              Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())),
            );
            const fake = yield* ask.pipe(Effect.provide(GitTest.layer(model)));
            expect(fake).toEqual(real);
            expect(real.commonDir).toBe(path.join(main, ".git"));
            seen.add(w.worktree ? "worktree" : "main checkout");
            seen.add(w.origin === undefined ? "no origin" : "origin");
            seen.add(w.name === undefined ? "no user.name" : "user.name");
          }),
        ),
      ),
      {
        ...runs,
        numRuns: runsFor({ fast: 6, full: 30 }),
        // Coverage, once every run is done: both checkouts, with and without origin and a name,
        // each met at least once. A case never reached fails here by name.
        reporter: (out) => {
          if (out.failed) {
            throw new Error(fc.defaultReportMessage(out));
          }

          expect([...seen].toSorted()).toEqual(
            ["main checkout", "no origin", "no user.name", "origin", "user.name", "worktree"].toSorted(),
          );
        },
      },
    );
  });

  // Plant, run once: governance.ts's edge mapped a clean run to exit 1 (`Effect.as(1)`). Red: the
  // process exited 1 where the law asks 0. Plant, run once: a bad command line mapped to exit 1. Red:
  // the process exited 1 where the law asks 2.
  it("property: node governance.ts exits 0 with the in-process lines, 1 when git cannot answer and 2 on a bad command line", () =>
    fc.assert(
      fc.asyncProperty(
        walk,
        fc.constantFrom<ReadonlyArray<string>>(["main", "extra"], ["--no-such-flag"], ["main", "--no-such-flag"]),
        (wk, bad) =>
          ran(
            Effect.gen(function* () {
              const path = yield* Path.Path;
              const script = path.join(import.meta.dirname, "..", "governance.ts");
              const { dir, take } = yield* build(wk.history);

              for (const [n, s] of wk.steps.entries()) {
                yield* take(s, n + 1);
              }

              const real = yield* governed(
                Layer.merge(GitProcess.layer(dir).pipe(Layer.provide(NodeServices.layer)), NodeServices.layer),
              );
              const clean = yield* run(process.execPath, [script, "main"], dir, { env: CLEAN });
              expect({ code: clean.code, out: clean.out }).toEqual({ code: 0, out: `${real.out}\n` });
              const unknown = yield* run(process.execPath, [script, "no-such-ref"], dir, { env: CLEAN });
              expect(unknown.code).toBe(1);
              const usage = yield* run(process.execPath, [script, ...bad], dir, { env: CLEAN });
              expect(usage.code).toBe(2);
            }),
          ),
      ),
      { ...runs, numRuns: runsFor({ fast: 3, full: 10 }) },
    ));
});
