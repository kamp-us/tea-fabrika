import * as NodeServices from "@effect/platform-node/NodeServices";
// The git-binary adapter on the real git binary (I1 to I7). Real git runs in temp folders, so this file runs
// only in CI's full run and in a cloud box, never on the laptop (the host's test config refuses it by name).
// A stand-in cannot do this job: these laws are the proof that `/process` answers what `/memory` answers and
// that the parser reads what real git writes.
import { expect, it } from "@effect/vitest";
import { Effect, Option, Predicate, Schema, Tracer } from "effect";
import * as Digest from "effect/crypto/Digest";
import * as FileSystem from "effect/FileSystem";
import * as Commit from "./Commit.ts";
import * as CommitId from "./CommitId.ts";
import {
  TREE_CARRIER_CLASSES,
  editCarrier,
  shapes,
  textureArb,
  treeCarrier,
  type FlatSignature,
  type History,
} from "./History.test-support.ts";
import * as MemoryRepository from "./MemoryRepository.ts";
import { bareRepository, fastImport, git, openRepository, processSubject } from "./ProcessSeed.test-support.ts";
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

// I1 runs the shared laws S1 to S16 on real git, 10 runs each, over bare repositories the seeder fills with files.
// Plant: each S law's plant, run once on `/process`.
RepositoryTest.suite("process", processSubject, { runs: 10, timeout: 1_800_000 });

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

const patchIdOrUndefined = (repo: Repository.Repository["Service"], from: CommitId.CommitId, to: CommitId.CommitId) =>
  Effect.map(repo.patchId(from, to), Option.getOrUndefined);

// Plant (I6): run porcelain `git diff` in place of `diff-tree`, which reads `diff.noprefix` and `diff.orderFile`; drop
// `--verbatim`, which `patchid.stable` would change; leave `--no-renames` out. The ids of every edit of the generator, asked of one
// bare repository, are the same before and after its config gets the four lines.
it.effect.prop(
  "I6 scenario: a repository's own config steers nothing: diff.noprefix, diff.orderFile, diff.algorithm=patience and patchid.stable=true change no patch id",
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

          const without = yield* ids();
          const fs = yield* FileSystem.FileSystem;
          // A file that puts the paths ending in 0 first, which a porcelain diff would follow.
          yield* fs.writeFileString(`${dir}/order`, "*0\n");

          for (const [key, value] of [
            ["diff.noprefix", "true"],
            ["diff.orderFile", `${dir}/order`],
            ["diff.algorithm", "patience"],
            ["patchid.stable", "true"],
          ] as const) {
            yield* git(dir, ["config", key, value]);
          }

          expect(yield* ids(), "the same ids with the four config lines").toEqual(without);
          expect(without.filter((id) => id !== undefined).length, "the edits have ids").toBeGreaterThan(20);
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 5, seed: 119120 } },
);

const GITLINK_A = "a".repeat(40);

const GITLINK_B = "b".repeat(40);

// Plant (I7): ask `cat-file` the size of a gitlink's id, so `patchId` fails on the submodule; leave the file side of a `T` entry
// out of the sizes, so the file made a submodule is not counted.
it.effect(
  "I7 scenario: a commit with a submodule entry gets a patch id on real git, which follows the submodule's commit, even when the diff limit is one byte, and a file made a submodule counts the file's bytes",
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
    }).pipe(Effect.provide(NodeServices.layer)),
);
