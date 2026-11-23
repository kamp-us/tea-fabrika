import * as NodeServices from "@effect/platform-node/NodeServices";
// The git-binary adapter on the real git binary (I1 to I11). Real git runs in temp folders, so this file runs
// only in CI's full run and in a cloud box, never on the laptop (the host's test config refuses it by name).
// A stand-in cannot do this job: these laws are the proof that `/process` answers what `/memory` answers and
// that the parser reads what real git writes.
import { expect, it } from "@effect/vitest";
import { Effect, Match, Option, Predicate, Result, Schema, Tracer } from "effect";
import * as Digest from "effect/crypto/Digest";
import * as FileSystem from "effect/FileSystem";
import * as Commit from "./Commit.ts";
import * as CommitId from "./CommitId.ts";
import * as Diff from "./Diff.ts";
import {
  TREE_CARRIER_CLASSES,
  editCarrier,
  readCarrier,
  shapes,
  textureArb,
  treeCarrier,
  type FlatSignature,
  type History,
} from "./History.test-support.ts";
import * as MemoryRepository from "./MemoryRepository.ts";
import { memorySubject } from "./MemorySeed.test-support.ts";
import * as MergeCommitTest from "./MergeCommit.test-support.ts";
import {
  bareRepository,
  fastImport,
  git,
  openRepository,
  processSubject,
  setConfigTable,
} from "./ProcessSeed.test-support.ts";
import * as Ref from "./Ref.ts";
import { expectFailure } from "./Repository.test-support.ts";
import * as Repository from "./Repository.ts";
import * as RepositoryTest from "./RepositoryTest.ts";
import * as Tree from "./Tree.ts";

const commitIdFrom = (text: string): CommitId.CommitId => Schema.decodeUnknownSync(CommitId.CommitId)(text);

const refNameFrom = (text: string): Ref.RefName => Schema.decodeUnknownSync(Ref.RefName)(text);

const settings = RepositoryTest.settings();

const failure = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<E, never, R> =>
  Effect.flip(effect).pipe(Effect.orDie);

const bytes = (...parts: ReadonlyArray<string | Uint8Array>): Uint8Array => {
  const encoder = new TextEncoder();
  const chunks = parts.map((part) => (Predicate.isString(part) ? encoder.encode(part) : part));
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;

  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }

  return out;
};

const ADA = "Ada <ada@example.test> 1700000000 +0000";

// I1 runs the shared laws S1 to S24 on real git, 10 runs each, over bare repositories the seeder fills with files.
// Plant: each S law's plant, run once on `/process`.
RepositoryTest.suite("process", processSubject, { runs: 10, timeout: 1_800_000 });

MergeCommitTest.suite("process", processSubject, { runs: 10, timeout: 1_800_000 });

const signature = (flat: FlatSignature): Commit.Signature =>
  new Commit.Signature({ name: flat.name, email: flat.email, at: { seconds: flat.seconds, offset: flat.offset } });

/** The ids the memory store gives a history's commits and trees: what git must give too. */
const memoryIds = (
  history: History,
): Effect.Effect<
  { readonly ids: ReadonlyArray<string>; readonly trees: ReadonlyArray<string> },
  never,
  Digest.Digest
> =>
  Effect.gen(function* () {
    let store = MemoryRepository.empty;
    const ids: Array<CommitId.CommitId> = [];
    const trees: Array<Tree.TreeId> = [];

    for (const node of history.nodes) {
      const files = new Map(
        node.files.map((file) => [
          Schema.decodeUnknownSync(Tree.Path)(file.path),
          { mode: Schema.decodeUnknownSync(Tree.Mode)(file.mode), content: file.content },
        ]),
      );

      const made = yield* Effect.orDie(MemoryRepository.tree(store, files));

      const commit = yield* MemoryRepository.commit({
        tree: made.id,
        parents: node.parents.map((parent) => ids[parent] ?? commitIdFrom("0".repeat(40))),
        author: signature(node.author),
        committer: signature(node.committer),
        message: node.message,
      });

      store = yield* Effect.orDie(Effect.fromResult(MemoryRepository.add(made.store, commit)));
      ids.push(commit.id);
      trees.push(made.id);
    }

    return { ids, trees };
  });

// Plant (I5): each of M3's plants, run once: sort a tree's entries as plain strings; write every path into one flat tree;
// write a link as `100644`; hash a file's content after decoding it as text; keep a tree's files in a plain object.
it.effect.prop(
  "I5 scenario: memory and git give each commit of a generated history the same commit id and the same tree id",
  { texture: textureArb },
  ({ texture }) =>
    Effect.gen(function* () {
      const made = treeCarrier(texture);
      expect(made.classes, "the generator reaches every tree class").toEqual(TREE_CARRIER_CLASSES);

      const histories = [...shapes(texture), { label: "tree carrier", history: made.history }];

      for (const { label, history } of histories) {
        const memory = yield* memoryIds(history);

        const real = yield* Effect.scoped(
          Effect.map(processSubject.seed(history, settings), (seeded) => ({ ids: seeded.ids, trees: seeded.trees })),
        );

        expect(real.ids, `${label}: commit ids`).toEqual(memory.ids);
        expect(real.trees, `${label}: tree ids`).toEqual(memory.trees);
      }
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
  { arbitrary: { runs: 10, seed: 119120 }, timeout: 1_800_000 },
);

// Plant (I2): decode with replacement, so the latin-1 message reads as text.
it.effect(
  "I2 scenario: a commit memory cannot hold, a message in latin-1 under an encoding header, is UnreadableCommit",
  () =>
    Effect.gen(function* () {
      const dir = yield* bareRepository;

      const [first] = yield* fastImport(
        dir,
        bytes(
          "commit refs/heads/main\nmark :1\n",
          `author ${ADA}\ncommitter ${ADA}\nencoding ISO-8859-1\n`,
          "data 5\n",
          new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]),
          "\n\n",
        ),
      );

      const repo = yield* openRepository(dir, settings);
      const id = commitIdFrom(first ?? "");
      expectFailure(
        yield* failure(repo.readCommit(id)),
        Repository.UnreadableCommit,
        { id, reason: "message" },
        "readCommit",
      );
      expectFailure(
        yield* failure(repo.walk({ include: [id], exclude: [] })),
        Repository.UnreadableCommit,
        { id, reason: "message" },
        "walk",
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

// Plant (I3): skip refs that are not commits.
it.effect(
  "I3 scenario: a real annotated tag and a symbolic ref under the asked name fail readRefs with RefNotCommit",
  () =>
    Effect.gen(function* () {
      const dir = yield* bareRepository;

      const [first] = yield* fastImport(
        dir,
        bytes("commit refs/heads/main\nmark :1\n", `author ${ADA}\ncommitter ${ADA}\n`, "data 3\nhi\n\n"),
      );

      yield* git(dir, [
        "-c",
        "user.name=Ada",
        "-c",
        "user.email=ada@example.test",
        "tag",
        "-a",
        "-m",
        "tagged",
        "annotated",
        first ?? "",
      ]);
      yield* git(dir, ["symbolic-ref", "refs/heads/alias", "refs/heads/main"]);
      const repo = yield* openRepository(dir, settings);
      expectFailure(
        yield* failure(repo.readRefs(refNameFrom("refs/tags/annotated"))),
        Repository.RefNotCommit,
        { ref: "refs/tags/annotated", points: "tag" },
        "an annotated tag",
      );
      expectFailure(
        yield* failure(repo.readRefs(refNameFrom("refs/heads/alias"))),
        Repository.RefNotCommit,
        { ref: "refs/heads/alias", points: "symbolic" },
        "a symbolic ref",
      );
      expectFailure(
        yield* failure(repo.readRefs(refNameFrom("refs/heads"))),
        Repository.RefNotCommit,
        {},
        "a folder holding a symbolic ref",
      );
      expect(
        (yield* repo.readRefs(refNameFrom("refs/heads/main"))).map((ref) => ref.name),
        "the plain branch",
      ).toEqual(["refs/heads/main"]);
    }).pipe(Effect.provide(NodeServices.layer)),
);

// Plant (I4): let `rev-parse` find a repository above the path (no `--git-dir`), so the empty folder inside
// a checkout opens.
it.effect(
  "I4 scenario: the layer opens on a real bare repository and records git's version; an empty folder is NoRepository",
  () =>
    Effect.gen(function* () {
      const bare = yield* bareRepository;
      const spans: Array<Tracer.NativeSpan> = [];

      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);

          return span;
        },
      });

      yield* openRepository(bare, settings).pipe(Effect.withTracer(tracer));
      const open = spans.filter((span) => span.name === "git.open");
      expect(open.length, "one git.open span").toBe(1);
      expect(String(open[0]?.attributes.get("kalfa.git.version")), "the version git printed").toMatch(/\d+\.\d+/);

      const fs = yield* FileSystem.FileSystem;
      const empty = yield* fs.makeTempDirectoryScoped();
      expectFailure(yield* failure(openRepository(empty, settings)), Repository.NoRepository, {}, "an empty folder");
      // An empty folder inside a repository: only `--git-dir` stops git from finding the one above it.
      yield* fs.makeDirectory(`${bare}/empty`);
      expectFailure(
        yield* failure(openRepository(`${bare}/empty`, settings)),
        Repository.NoRepository,
        {},
        "an empty folder inside a repository",
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

const idAt = (ids: ReadonlyArray<CommitId.CommitId>, index: number): CommitId.CommitId => {
  const id = ids[index];

  if (id === undefined) {
    throw new Error(`the seeder gave no id for commit ${index}`);
  }

  return id;
};

// Built when it is called, so this file loads before the product names exist.
const encodeDiff = (files: Diff.Diff) => Schema.encodeSync(Schema.Array(Diff.FileChange))(files);

/** What `diff` came to as plain data: the files, or the failure's tag and the path it names. */
const diffOutcome = (repo: Repository.Repository["Service"], from: CommitId.CommitId, to: CommitId.CommitId) =>
  Effect.map(Effect.result(repo.diff(from, to)), (result) =>
    Result.isSuccess(result)
      ? { files: encodeDiff(result.success) }
      : { failure: result.failure._tag, path: "path" in result.failure ? result.failure.path : undefined },
  );

const patchIdOrUndefined = (repo: Repository.Repository["Service"], from: CommitId.CommitId, to: CommitId.CommitId) =>
  Effect.map(repo.patchId(from, to), Option.getOrUndefined);

// Plant (I8): run porcelain `git diff` in place of `diff-tree`, which reads `diff.noprefix` and `diff.orderFile`; drop
// `--verbatim`, which `patchid.stable` would change; leave `--no-renames` out; run porcelain `git diff` for the patch of `diff`; drop
// `--no-ext-diff` or `--no-textconv` from it; leave a config line of the diff commands out of what the adapter reads, so git calls a
// one-line text edit `Binary files differ` (`core.bigFileThreshold` and `core.attributesFile` each do it on git 2.40.1). The ids and
// the diffs of every edit of the generator, asked of one bare repository, are the same before and after its config gets the six lines.
it.effect.prop(
  "I8 scenario: a repository's own config steers nothing: diff.noprefix, diff.orderFile, diff.algorithm=patience, patchid.stable=true, core.bigFileThreshold=3 and an attributes file that marks every file binary change no patch id and no diff",
  { texture: textureArb },
  ({ texture }) =>
    Effect.gen(function* () {
      const carrier = editCarrier(texture);

      yield* Effect.scoped(
        Effect.gen(function* () {
          const seeded = yield* processSubject.seed(carrier.history, settings);
          const [dir] = seeded.hidden;

          if (dir === undefined) {
            return yield* Effect.die("the seeder gave no repository folder");
          }

          const ids = () =>
            Effect.forEach(
              carrier.cases,
              (each) => patchIdOrUndefined(seeded.repository, idAt(seeded.ids, each.from), idAt(seeded.ids, each.to)),
              { concurrency: 1 },
            );

          const diffs = () =>
            Effect.forEach(
              carrier.cases,
              (each) => diffOutcome(seeded.repository, idAt(seeded.ids, each.from), idAt(seeded.ids, each.to)),
              { concurrency: 1 },
            );

          const without = yield* ids();
          const diffsWithout = yield* diffs();
          const fs = yield* FileSystem.FileSystem;
          // A file that puts the paths ending in 0 first, which a porcelain diff would follow.
          yield* fs.writeFileString(`${dir}/order`, "*0\n");
          // Every file binary, which git reads from the repository's own config as it reads a global attributes file.
          yield* fs.writeFileString(`${dir}/attributes`, "* binary\n");

          for (const [key, value] of [
            ["diff.noprefix", "true"],
            ["diff.orderFile", `${dir}/order`],
            ["diff.algorithm", "patience"],
            ["patchid.stable", "true"],
            ["core.bigFileThreshold", "3"],
            ["core.attributesFile", `${dir}/attributes`],
          ] as const) {
            yield* git(dir, ["config", key, value]);
          }

          expect(yield* ids(), "the same ids with the six config lines").toEqual(without);
          expect(yield* diffs(), "the same diffs with the six config lines").toEqual(diffsWithout);
          expect(without.filter((id) => id !== undefined).length, "the edits have ids").toBeGreaterThan(20);

          expect(
            diffsWithout.filter((each) => "files" in each && each.files.length > 0).length,
            "the edits have diffs",
          ).toBeGreaterThan(20);
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 5, seed: 119120 } },
);

const GITLINK_A = "a".repeat(40);

const GITLINK_B = "b".repeat(40);

// Plant (I9): ask `cat-file` the size of a gitlink's id, so `patchId` fails on the submodule; leave the file side of a `T` entry
// out of the sizes, so the file made a submodule is not counted; read 160000 as a file in `diff`, so it answers; check the size before
// the submodule in `diff`, so the file made a submodule is `DiffTooLarge`.
it.effect(
  "I9 scenario: a commit with a submodule entry gets a patch id on real git, which follows the submodule's commit, even when the diff limit is one byte, a file made a submodule counts the file's bytes, and diff over any of them fails with NotAFile naming it before the size limit",
  () =>
    Effect.gen(function* () {
      const dir = yield* bareRepository;

      const commit = (mark: number, parent: number | undefined, change: string): Uint8Array =>
        bytes(
          `commit refs/heads/main\nmark :${mark}\n`,
          `author ${ADA}\ncommitter ${ADA}\n`,
          "data 2\nc",
          String(mark),
          "\n",
          parent === undefined ? "" : `from :${parent}\n`,
          change,
          "\n",
        );

      const [c0, c1, c2, c3, c4] = yield* fastImport(
        dir,
        bytes(
          commit(1, undefined, "M 100644 inline a\ndata 2\nx\n\n"),
          commit(2, 1, `M 160000 ${GITLINK_A} sub\n`),
          commit(3, 2, `M 160000 ${GITLINK_B} sub\n`),
          commit(4, 2, ""),
          // The file `a` becomes a submodule: one `T` entry, whose file side is 2 bytes.
          commit(5, 1, `M 160000 ${GITLINK_B} a\n`),
        ),
      );

      const repo = yield* openRepository(dir, RepositoryTest.settings({ files: 1, diff: 1 }));
      const [id0, id1, id2, id3, id4] = [c0, c1, c2, c3, c4].map((id) => commitIdFrom(id ?? ""));

      if (id0 === undefined || id1 === undefined || id2 === undefined || id3 === undefined || id4 === undefined) {
        return yield* Effect.die("fast-import gave fewer commits");
      }

      const added = yield* patchIdOrUndefined(repo, id0, id1);
      const moved = yield* patchIdOrUndefined(repo, id1, id2);
      const addedOther = yield* patchIdOrUndefined(repo, id0, id2);

      expect(added, "a submodule added has an id").toBeDefined();
      expect(moved, "a submodule moved to another commit has an id").toBeDefined();
      expect(added, "another commit in the submodule is another change").not.toBe(moved);
      expect(addedOther, "the same submodule at another commit added is another change").not.toBe(added);
      expect(yield* patchIdOrUndefined(repo, id1, id3), "a commit with the same files is no change").toBeUndefined();

      // A file made a submodule: the file's bytes count against the one-byte limit, though the other side is a submodule.
      const error = yield* Effect.flip(repo.patchId(id0, id4));
      expectFailure(
        error,
        Repository.DiffTooLarge,
        { most: 1 },
        "a file made a submodule is over a diff limit of one byte",
      );

      // A diff answers files and lines, and a submodule is neither: it names the submodule's path, with the size limit at one byte
      // and the files limit at one, so the check that names it comes before the size and after the count.
      const diffs: ReadonlyArray<readonly [string, CommitId.CommitId, CommitId.CommitId]> = [
        ["a submodule added", id0, id1],
        ["a submodule moved to another commit", id1, id2],
        ["a file made a submodule", id0, id4],
      ];

      for (const [label, from, to] of diffs) {
        const named = yield* Effect.flip(repo.diff(from, to));
        expectFailure(
          named,
          Repository.NotAFile,
          { path: label === "a file made a submodule" ? "a" : "sub", holds: "submodule" },
          label,
        );
      }

      expect(yield* repo.diff(id1, id3), "a commit with the same files is no change, whatever the submodule").toEqual(
        [],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

// Plant (I6): drop `--no-deref` from `update-ref`, so git follows the symbolic ref and moves its target.
it.effect(
  "I6 scenario: moveRef of a symbolic ref whose target is at `from` makes it a plain ref at `to` and leaves the target where it was",
  () =>
    Effect.gen(function* () {
      const dir = yield* bareRepository;

      const [first, second] = yield* fastImport(
        dir,
        bytes(
          "commit refs/heads/main\nmark :1\n",
          `author ${ADA}\ncommitter ${ADA}\n`,
          "data 3\nhi\n\n",
          "commit refs/heads/other\nmark :2\n",
          `author ${ADA}\ncommitter ${ADA}\n`,
          "data 3\nyo\n\n",
        ),
      );

      yield* git(dir, ["symbolic-ref", "refs/heads/alias", "refs/heads/main"]);
      const repo = yield* openRepository(dir, settings);
      const [x, y] = [commitIdFrom(first ?? ""), commitIdFrom(second ?? "")];

      yield* repo.moveRef({ ref: refNameFrom("refs/heads/alias"), from: Option.some(x), to: y });

      const listed = yield* git(dir, ["for-each-ref", "--format=%(refname)|%(objectname)|%(symref)"]);

      expect(
        listed.trim().split("\n").toSorted(),
        "the alias is a plain ref at `to`, the target is where it was",
      ).toEqual([`refs/heads/alias|${y}|`, `refs/heads/main|${x}|`, `refs/heads/other|${y}|`]);
    }).pipe(Effect.provide(NodeServices.layer)),
);

/** One commit of a hand-made history: its first parent by index, and its files as path, text and mode. */
interface Made {
  readonly parent: number | undefined;
  readonly files: ReadonlyArray<readonly [path: string, text: string, mode?: string]>;
}

/** A fast-import stream of the commits, each holding exactly its files, on a branch of its own. */
const madeStream = (made: ReadonlyArray<Made>): Uint8Array =>
  bytes(
    ...made.flatMap((each, i): ReadonlyArray<string | Uint8Array> => [
      each.parent === undefined ? "reset refs/seed/tmp\n" : "",
      `commit refs/seed/tmp\nmark :${i + 1}\nauthor ${ADA}\ncommitter ${ADA}\ndata 2\nm\n\n`,
      each.parent === undefined ? "" : `from :${each.parent + 1}\n`,
      "deleteall\n",
      ...each.files.flatMap(([path, text, mode]): ReadonlyArray<string> => [
        `M ${mode ?? "100644"} inline ${path}\ndata ${new TextEncoder().encode(text).length}\n${text}\n`,
      ]),
      "\n",
    ]),
    "reset refs/seed/tmp\n\n",
  );

/** A real bare repository holding the commits (`ours` is the second, `theirs` the third), and the service on it. */
const mergedRepository = (made: ReadonlyArray<Made>, config: ReadonlyArray<readonly [string, string]> = []) =>
  Effect.gen(function* () {
    const dir = yield* bareRepository;
    const ids = (yield* fastImport(dir, madeStream(made))).map(commitIdFrom);

    for (const [key, value] of config) {
      yield* git(dir, ["config", key, value]);
    }

    const [mergeBase, ours, theirs] = ids;

    if (mergeBase === undefined || ours === undefined || theirs === undefined) {
      return yield* Effect.die("fast-import gave fewer than three commits");
    }

    return { dir, merge: { mergeBase, ours, theirs }, repo: yield* openRepository(dir, settings) };
  });

const LINES = Array.from({ length: 10 }, (_, i) => `line ${i + 1} of a file long enough for git to see it again\n`);

// vector: git's own answers where `/memory`, which merges whole files, answers differently. Plant (I7): set
// `merge.directoryRenames=true` in the repository's own config and drop the three `-c merge.*` pins, so the folder move
// comes back as a clean tree and not a conflict; read the files by whole file, so the by-line case is a conflict; let a
// mode change and a content change conflict. (git 2.40.1's `merge-tree` ignores `merge.renames` in a repository's config,
// so that pin is held by P5 alone.)
it.effect(
  "I7 scenario: on real git a merge goes by line, takes a mode change and a content change together, follows a rename, reports a folder move as a conflict whatever the repository's own config says, and moves a file that stands where a folder is wanted",
  () =>
    Effect.gen(function* () {
      // 1. Ours changes the first line and theirs the last: git merges the lines, `/memory` would conflict.
      const byLine = yield* mergedRepository([
        { parent: undefined, files: [["f", "a\nb\nc\n"]] },
        { parent: 0, files: [["f", "A\nb\nc\n"]] },
        { parent: 0, files: [["f", "a\nb\nC\n"]] },
      ]);

      const lines = yield* byLine.repo.mergeTrees(byLine.merge);
      expect(yield* git(byLine.dir, ["cat-file", "-p", `${lines}:f`]), "by line: both changes are in the file").toBe(
        "A\nb\nC\n",
      );

      // 2. Ours makes the file executable and theirs changes its content: git takes both, `/memory` would conflict.
      const both = yield* mergedRepository([
        { parent: undefined, files: [["f", "1\n"]] },
        { parent: 0, files: [["f", "1\n", "100755"]] },
        { parent: 0, files: [["f", "2\n"]] },
      ]);

      const taken = yield* both.repo.mergeTrees(both.merge);
      expect(yield* git(both.dir, ["ls-tree", "--format=%(objectmode) %(path)", taken]), "mode").toBe("100755 f\n");
      expect(yield* git(both.dir, ["cat-file", "-p", `${taken}:f`]), "content").toBe("2\n");

      // 3. Ours renames the file and theirs changes it: git follows the rename, even when the repository's own config
      // turns rename detection off. `/memory` sees a change against a delete.
      const [first, ...rest] = LINES;

      const renamed = yield* mergedRepository(
        [
          { parent: undefined, files: [["a", LINES.join("")]] },
          { parent: 0, files: [["b", LINES.join("")]] },
          { parent: 0, files: [["a", `${first?.toUpperCase() ?? ""}${rest.join("")}`]] },
        ],
        [["merge.renames", "false"]],
      );

      const followed = yield* renamed.repo.mergeTrees(renamed.merge);
      expect(yield* git(renamed.dir, ["ls-tree", "--name-only", followed]), "the file is at its new name").toBe("b\n");
      expect(yield* git(renamed.dir, ["cat-file", "-p", `${followed}:b`]), "with theirs' change").toBe(
        `${first?.toUpperCase() ?? ""}${rest.join("")}`,
      );

      // 3b. Ours moves a folder and theirs adds a file to it: git reports the move as a conflict, naming the file at its new
      // place, even when the repository's own config says to move the file along, since every command pins the answer.
      const text = LINES.join("");

      const moved = yield* mergedRepository(
        [
          {
            parent: undefined,
            files: [
              ["d/x", text],
              ["d/y", `${text}y\n`],
            ],
          },
          {
            parent: 0,
            files: [
              ["e/x", text],
              ["e/y", `${text}y\n`],
            ],
          },
          {
            parent: 0,
            files: [
              ["d/x", text],
              ["d/y", `${text}y\n`],
              ["d/n", "n\n"],
            ],
          },
        ],
        [["merge.directoryRenames", "true"]],
      );

      expectFailure(
        yield* failure(moved.repo.mergeTrees(moved.merge)),
        Repository.Conflict,
        { paths: ["e/n"] },
        "a folder move",
      );

      // 4. Ours adds a file where theirs adds a folder: git moves the file to a name of its own and conflicts, naming that
      // name; `/memory` conflicts on both paths and writes no tree.
      const aside = yield* mergedRepository([
        { parent: undefined, files: [] },
        { parent: 0, files: [["a", "o\n"]] },
        { parent: 0, files: [["a/b", "t\n"]] },
      ]);

      const error = yield* failure(aside.repo.mergeTrees(aside.merge));
      expectFailure(error, Repository.Conflict, {}, "a file against a folder");

      if (Schema.is(Repository.Conflict)(error)) {
        expect(error.paths.length, "one path").toBe(1);
        expect(error.paths[0]?.startsWith("a~"), "the file moved to a name of its own").toBe(true);
      }

      // 5. The same one folder deeper: a file at `a/b` against a file at `a/b/c`.
      const deeper = yield* mergedRepository([
        { parent: undefined, files: [] },
        { parent: 0, files: [["a/b", "o\n"]] },
        { parent: 0, files: [["a/b/c", "t\n"]] },
      ]);

      const deep = yield* failure(deeper.repo.mergeTrees(deeper.merge));
      expectFailure(deep, Repository.Conflict, {}, "a file in a folder against a file below it");

      if (Schema.is(Repository.Conflict)(deep)) {
        expect(deep.paths.length, "one path").toBe(1);
        expect(deep.paths[0]?.startsWith("a/b~"), "the file moved to a name of its own").toBe(true);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

type ReadError =
  | Repository.NoSuchCommit
  | Repository.NotAFile
  | Repository.FileTooLarge
  | Repository.NotUtf8
  | Repository.GitUnavailable
  | Repository.TimedOut;

/** What a read came to, as text a law compares: the bytes, none, or the failure's tag and the fields it holds. */
const readOutcome = (read: Effect.Effect<Option.Option<Uint8Array | string>, ReadError>): Effect.Effect<string> =>
  Effect.map(Effect.result(read), (result) => {
    if (Result.isSuccess(result)) {
      const found = result.success;

      if (Option.isNone(found)) {
        return "none";
      }

      return Predicate.isString(found.value)
        ? `text:${found.value}`
        : `file:${Buffer.from(found.value).toString("base64")}`;
    }

    return Match.value(result.failure).pipe(
      Match.tag("NotAFile", (error) => `NotAFile ${error.path} ${error.holds}`),
      Match.tag("FileTooLarge", (error) => `FileTooLarge ${error.path} ${error.most}`),
      Match.tag("NotUtf8", (error) => `NotUtf8 ${error.path}`),
      Match.tag("NoSuchCommit", (error) => `NoSuchCommit ${error.id}`),
      Match.orElse((error) => error._tag),
    );
  });

// Plant (I10): run `cat-file --filters --path=<path>` for a file's bytes, which `core.autocrlf` and the attributes file turn into
// other bytes, (w) red; give `ls-tree` the path as an argument, so `core.ignoreCase` and `core.precomposeUnicode` act, (w) red. The
// answers of every read of the generator, asked of one bare repository, are the same before and after its config gets every key of
// the table, and the same as `/memory` gives for the same history.
it.effect.prop(
  "I10 scenario: a repository's own config steers no read: core.quotePath, core.precomposeUnicode, core.ignoreCase, core.autocrlf, core.eol, core.safecrlf, a filter, core.attributesFile, info/attributes and core.bigFileThreshold change no answer of readFile or readText, and the answers are /memory's",
  { texture: textureArb },
  ({ texture }) =>
    Effect.gen(function* () {
      const carrier = readCarrier(texture);

      yield* Effect.scoped(
        Effect.gen(function* () {
          const real = yield* processSubject.seed(carrier.history, settings);
          const model = yield* memorySubject.seed(carrier.history, settings);
          const [dir] = real.hidden;

          if (dir === undefined) {
            return yield* Effect.die("the seeder gave no repository folder");
          }

          const answers = (seeded: RepositoryTest.Seeded) =>
            Effect.forEach(
              carrier.cases,
              (each) => {
                const commit = idAt(seeded.ids, each.commit);
                const path = Schema.decodeUnknownSync(Tree.Path)(each.path);

                return Effect.all(
                  [
                    readOutcome(seeded.repository.readFile(commit, path)),
                    readOutcome(seeded.repository.readText(commit, path)),
                  ],
                  { concurrency: 1 },
                );
              },
              { concurrency: 1 },
            );

          const without = yield* answers(real);
          expect(without, "git answers what /memory answers").toEqual(yield* answers(model));
          yield* setConfigTable(dir);
          expect(yield* answers(real), "the same answers with every key of the config table set").toEqual(without);
          expect(without.filter(([raw]) => raw?.startsWith("file:")).length, "the reads have files").toBeGreaterThan(
            20,
          );
          expect(
            without.filter(([, text]) => text?.startsWith("text:")).length,
            "the reads have text, which the filter would change",
          ).toBeGreaterThan(20);
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 5, seed: 119120 } },
);

// Plant (I11): read a gitlink as nothing at the path, (i) red; read a path below a gitlink as none, (i) red. A submodule holds a
// commit and no file: a read at it, or below it, fails `NotAFile` naming the submodule, and the files beside it read as they are.
it.effect(
  "I11 scenario: with a gitlink made by fast-import, readFile and readText at it and below it fail NotAFile with holds submodule naming it, the files beside it read, and the folder that holds it is a folder",
  () =>
    Effect.gen(function* () {
      const dir = yield* bareRepository;

      const [first] = yield* fastImport(
        dir,
        bytes(
          `commit refs/heads/main\nmark :1\nauthor ${ADA}\ncommitter ${ADA}\ndata 2\nc1\n`,
          "M 100644 inline a\ndata 2\nx\n\n",
          "M 100644 inline dir/f\ndata 2\ny\n\n",
          `M 160000 ${GITLINK_A} sub\n`,
          `M 160000 ${GITLINK_B} dir/inner\n\n`,
        ),
      );

      const repo = yield* openRepository(dir, settings);
      const commit = commitIdFrom(first ?? "");
      const path = (text: string) => Schema.decodeUnknownSync(Tree.Path)(text);

      for (const [label, asked, named] of [
        ["a submodule at the top", "sub", "sub"],
        ["a path below a submodule", "sub/x/y", "sub"],
        ["a submodule in a folder", "dir/inner", "dir/inner"],
        ["a path below a submodule in a folder", "dir/inner/z", "dir/inner"],
      ] as const) {
        const reads: ReadonlyArray<readonly [string, Effect.Effect<Option.Option<unknown>, unknown>]> = [
          ["readFile", repo.readFile(commit, path(asked))],
          ["readText", repo.readText(commit, path(asked))],
        ];

        for (const [call, read] of reads) {
          expectFailure(
            yield* Effect.flip(read),
            Repository.NotAFile,
            { path: named, holds: "submodule" },
            `${label}, ${call}`,
          );
        }
      }

      expect(Option.getOrUndefined(yield* repo.readText(commit, path("a"))), "a file beside a submodule reads").toBe(
        "x\n",
      );
      expect(
        Option.getOrUndefined(yield* repo.readText(commit, path("dir/f"))),
        "a file in the folder of a submodule reads",
      ).toBe("y\n");
      expectFailure(
        yield* Effect.flip(repo.readFile(commit, path("dir"))),
        Repository.NotAFile,
        { path: "dir", holds: "folder" },
        "the folder",
      );
      expect(
        Option.isNone(yield* repo.readFile(commit, path("sub-not"))),
        "a name that only starts like the submodule's is none",
      ).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer)),
);
