import * as NodeServices from "@effect/platform-node/NodeServices";
// The git-binary adapter on the real git binary (I1 to I5). Real git runs in temp folders, so this file runs
// only in CI's full run and in a cloud box, never on the laptop (the host's test config refuses it by name).
// A stand-in cannot do this job: these laws are the proof that `/process` answers what `/memory` answers and
// that the parser reads what real git writes.
import { expect, it } from "@effect/vitest";
import { Effect, Predicate, Schema, Tracer } from "effect";
import * as Digest from "effect/crypto/Digest";
import * as FileSystem from "effect/FileSystem";
import * as Commit from "./Commit.ts";
import * as CommitId from "./CommitId.ts";
import {
  TREE_CARRIER_CLASSES,
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

// I1 runs the shared laws S1 to S11 on real git, 10 runs each, over bare repositories the seeder fills with files.
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
