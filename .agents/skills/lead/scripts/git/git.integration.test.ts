// S2 of docs/plan/quests/port-scripts-0113-PLAN.md: the real-layer set for the shared Git service.
// GitProcess.layer runs real git; GitTest.layer answers from a model in memory. Each law builds a
// small real repository in a temp folder from a generated history, gives the same history to the
// model, and sees both layers answer alike, and governance.ts print the same lines on each.
//
// It starts git and writes a temp folder, so it is an `.integration.` file (0584): no stand-in can
// show that real git writes the diff the model writes. The model's diff carries no hunk positions,
// so "alike" is read where the ports read it: the file header lines, and the changed lines as a
// sorted list.
//
// The repository's own config pins what a person's global git config could change (a diff prefix,
// color), so the law does not lean on the machine (0052). Rename detection stays git's default, as
// governance.sh ran it; every line of a file carries the file's own name, so no two files are alike
// enough for git to call one a rename of the other.
//
// Each law was planted once (the layer changed to break it, the law seen red) and restored by copy;
// the plant is named beside it.
import { NodeServices } from "@effect/platform-node";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, FileSystem, Layer, Path, type Scope } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { governance } from "../governance.ts";
import { run } from "../pr/command.ts";
import { Git } from "./Git.ts";
import * as GitProcess from "./GitProcess.ts";
import * as GitTest from "./GitTest.ts";

const runs = { seed: 119120, numRuns: runsFor({ fast: 5, full: 30 }) };

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
  return { dir, model };
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

/** governance.ts's lines on one pair of layers. */
const governed = (layers: Layer.Layer<Git | FileSystem.FileSystem>) =>
  Effect.gen(function* () {
    const exit = yield* Command.runWith(governance, { version: "0.0.0" })(["main"]).pipe(Effect.exit);
    const out = (yield* TestConsole.logLines).map(String).join("\n");
    return { ok: Exit.isSuccess(exit), out };
  }).pipe(Effect.provide(Layer.merge(layers, TestConsole.layer)));

describe("the Git service's two layers", () => {
  // Plant, run once: GitTest's `diff` read `a...b` as `a..b`, from main and not from the merge base.
  // Red: main's own change showed in the model's diff and not in real git's.
  it("property: GitProcess and GitTest answer top and a three-dot diff alike, and both refuse an unknown ref", () =>
    fc.assert(
      fc.asyncProperty(history, (h) =>
        ran(
          Effect.gen(function* () {
            const { dir, model } = yield* build(h);
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
          }),
        ),
      ),
      runs,
    ));

  // Plant, run once: GitTest's work tree read the merge base's files in place of HEAD's. Red: a
  // decision HEAD added was listed on the real layers and not on the model.
  it("property: governance.ts prints the same lines on the real layers and on the model of the same history", () =>
    fc.assert(
      fc.asyncProperty(history, (h) =>
        ran(
          Effect.gen(function* () {
            const { dir, model } = yield* build(h);
            const real = yield* governed(
              Layer.merge(GitProcess.layer(dir).pipe(Layer.provide(NodeServices.layer)), NodeServices.layer),
            );
            const fake = yield* governed(Layer.merge(GitTest.layer(model), GitTest.workTree(model)));
            expect(real.ok).toBe(true);
            expect(fake).toEqual(real);
            // The decision HEAD added is listed in every run, so no run compares two empty answers.
            const added = h.files.slice(0, 1).map((f) => `${filePath(f)}: edited`);
            expect(added).toHaveLength(1);
            expect(real.out.split("\n")).toEqual(expect.arrayContaining(added));
          }),
        ),
      ),
      runs,
    ));
});
