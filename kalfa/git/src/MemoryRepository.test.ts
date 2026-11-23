// The laws of the in-memory adapter: its ids are git's (M1, M3), its store refuses what git refuses (M2, M4), it
// holds the files it was given (M5), merges a file against a folder as a conflict (M6), and it passes the shared laws of
// Repository (S1 to S14), at 100 runs.
import { expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Result, Schema } from "effect";
import * as Digest from "effect/crypto/Digest";
import * as Commit from "./Commit.ts";
import fastImport from "./fixtures/fast-import-2.40.1.json" with { type: "json" };
import treeIds from "./fixtures/tree-ids-2.40.1.json" with { type: "json" };
import {
  CONFLICT_CLASSES,
  conflictClasses,
  folderCarrier,
  FOLDER_MERGE_CLASSES,
  missingId,
  shapes,
  textureArb,
  TREE_CLASSES,
  TREE_ID,
  treeArb,
  treeClasses,
} from "./History.test-support.ts";
import * as MemoryRepository from "./MemoryRepository.ts";
import {
  build,
  commitIdFrom,
  idAt,
  memorySubject,
  pathFrom,
  refNameFrom,
  signature,
  toFile,
  toFileMap,
  treeIdFrom,
} from "./MemorySeed.test-support.ts";
import { expectFailure } from "./Repository.test-support.ts";
import * as Repository from "./Repository.ts";
import * as RepositoryTest from "./RepositoryTest.ts";

const Recorded = Schema.Struct({
  git: Schema.String,
  command: Schema.String,
  rows: Schema.Array(
    Schema.Struct({
      note: Schema.String,
      parents: Schema.Array(Schema.String),
      author: Schema.Struct({
        name: Schema.String,
        email: Schema.String,
        at: Schema.Struct({ seconds: Schema.Finite, offset: Schema.String }),
      }),
      committer: Schema.Struct({
        name: Schema.String,
        email: Schema.String,
        at: Schema.Struct({ seconds: Schema.Finite, offset: Schema.String }),
      }),
      message: Schema.String,
      id: Schema.String,
    }),
  ),
});

// vector: git 2.40.1's fast-import gave each commit below its id, with git's empty tree, and memory computes the same one.
// Plant: drop the blank line before the message; write the offset as `+0000` for `-0000`; put the
// parents in sorted order.
it.effect("M1 vector: MemoryRepository.commit computes the id git gave each recorded commit", () =>
  Effect.gen(function* () {
    const recorded = Schema.decodeUnknownSync(Recorded)(fastImport);
    expect(recorded.git).toContain("git version");
    expect(recorded.rows.length, "the list is not empty").toBeGreaterThan(20);

    for (const row of recorded.rows) {
      const commit = yield* MemoryRepository.commit({
        tree: treeIdFrom(TREE_ID),
        parents: row.parents.map(commitIdFrom),
        author: new Commit.Signature(row.author),
        committer: new Commit.Signature(row.committer),
        message: row.message,
      });

      expect(commit.id, row.note).toBe(row.id);
    }
  }).pipe(Effect.provide(Digest.layerWebCrypto)),
);

const refusal = (result: Result.Result<unknown, unknown>, reason: string, place: string): void => {
  expect(Result.isFailure(result), `${place} is refused`).toBe(true);

  if (Result.isFailure(result)) {
    expectFailure(result.failure, MemoryRepository.BadStore, { reason }, `${place} says why`);
  }
};

// Plant: let a ref and a ref below it both in.
it.effect.prop(
  "M2 the store refuses what git refuses: a missing parent, a ref at a missing commit, a ref beside a ref below it",
  { texture: textureArb },
  ({ texture }) =>
    Effect.gen(function* () {
      const all = shapes(texture);

      for (const shape of all) {
        yield* build(shape.history);
      }

      const root = all.find((shape) => shape.label === "one root");
      const flat = texture.signatures[0];

      if (root === undefined || flat === undefined) {
        return yield* Effect.die("the generator made no root or signature");
      }

      const { store, ids } = yield* build(root.history);
      const first = idAt(ids, 0);
      const gone = commitIdFrom(missingId(texture, 0, ids));

      const orphan = yield* MemoryRepository.commit({
        tree: treeIdFrom(TREE_ID),
        parents: [gone],
        author: signature(flat),
        committer: signature(flat),
        message: "orphan",
      });

      refusal(MemoryRepository.add(store, orphan), "missing-parent", "a commit whose parent is missing");
      refusal(
        MemoryRepository.point(store, refNameFrom("refs/conflict/other"), gone),
        "missing-commit",
        "a ref at a missing commit",
      );
      const part = texture.parts[0] ?? "p";
      const above = refNameFrom(`refs/conflict/${part}`);
      const below = refNameFrom(`refs/conflict/${part}/b`);

      for (const [one, two] of [
        [above, below],
        [below, above],
      ] as const) {
        const held = yield* Effect.orDie(Effect.fromResult(MemoryRepository.point(store, one, first)));
        refusal(MemoryRepository.point(held, two, first), "ref-conflict", `${one} beside ${two}`);
      }
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
  { arbitrary: { runs: 100, seed: 119120 } },
);

const RecordedTrees = Schema.Struct({
  git: Schema.String,
  command: Schema.String,
  author: Schema.Struct({
    name: Schema.String,
    email: Schema.String,
    at: Schema.Struct({ seconds: Schema.Finite, offset: Schema.String }),
  }),
  committer: Schema.Struct({
    name: Schema.String,
    email: Schema.String,
    at: Schema.Struct({ seconds: Schema.Finite, offset: Schema.String }),
  }),
  message: Schema.String,
  rows: Schema.Array(
    Schema.Struct({
      note: Schema.String,
      files: Schema.Array(Schema.Struct({ path: Schema.String, mode: Schema.String, content: Schema.String })),
      tree: Schema.String,
      commit: Schema.String,
    }),
  ),
});

// vector: git 2.40.1's fast-import gave each commit below its files' tree id and its own id (a list of files, never a
// record keyed by path), and memory computes the same two. The bytes are kept as base64, so none is read as text.
// Plant: sort a tree's entries as plain strings; write every path into one flat tree; write a link as `100644`; hash
// a file's content after decoding it as text; keep a tree's files in a plain object; write the empty tree in a commit's
// bytes whatever `tree` says.
it.effect("M3 vector: tree and commit give the tree id and the commit id git gave each recorded set of files", () =>
  Effect.gen(function* () {
    const recorded = Schema.decodeUnknownSync(RecordedTrees)(treeIds);
    expect(recorded.git).toContain("git version");
    expect(recorded.rows.length, "the list is not empty").toBeGreaterThan(15);
    expect(
      recorded.rows.filter((row) => row.files.length === 0).map((row) => row.tree),
      "the row with no files is git's empty tree",
    ).toEqual([TREE_ID]);

    for (const row of recorded.rows) {
      const files = new Map(
        row.files.map((file) => [
          pathFrom(file.path),
          toFile(file.mode, Uint8Array.from(Buffer.from(file.content, "base64"))),
        ]),
      );

      const { id } = yield* Effect.orDie(MemoryRepository.tree(MemoryRepository.empty, files));
      expect(id, `${row.note}: the tree`).toBe(row.tree);

      const commit = yield* MemoryRepository.commit({
        tree: id,
        parents: [],
        author: new Commit.Signature(recorded.author),
        committer: new Commit.Signature(recorded.committer),
        message: recorded.message,
      });

      expect(commit.id, `${row.note}: the commit`).toBe(row.commit);
      expect(commit.tree, `${row.note}: the commit's tree`).toBe(row.tree);
    }
  }).pipe(Effect.provide(Digest.layerWebCrypto)),
);

/** What a store holds, as plain data, so a refused call can be seen to have left it as it was. */
interface Held {
  readonly commits: ReadonlyArray<string>;
  readonly trees: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, unknown]>]>;
  readonly blobs: ReadonlyArray<readonly [string, ReadonlyArray<number>]>;
  readonly refs: ReadonlyArray<readonly [string, string]>;
  readonly shallow: ReadonlyArray<string>;
}

const held = (store: MemoryRepository.Store): Held => ({
  commits: [...store.commits.keys()],
  trees: [...store.trees].map(([id, files]) => [id, [...files]] as const),
  blobs: [...store.blobs].map(([id, content]) => [id, [...content]] as const),
  refs: [...store.refs],
  shallow: [...store.shallow],
});

// Plant: delete the path-conflict check; check only a file beside its direct child, so a file beside one two folders
// below it passes; delete the missing-tree check in `add`.
it.effect.prop(
  "M4 the store refuses what git cannot hold: a path that is a folder of another, a commit whose tree it lacks",
  { draw: treeArb, texture: textureArb },
  ({ draw, texture }) =>
    Effect.gen(function* () {
      const conflicts = conflictClasses(draw);
      expect(
        conflicts.map(({ label }) => label),
        "the generator reaches every conflict class",
      ).toEqual(CONFLICT_CLASSES);

      expect(
        treeClasses(draw).map(({ label }) => label),
        "the generator reaches every tree class",
      ).toEqual(TREE_CLASSES);

      const root = shapes(texture).find((shape) => shape.label === "one root");

      if (root === undefined) {
        return yield* Effect.die("the generator made no root");
      }

      const { store, ids } = yield* build(root.history);
      const before = held(store);

      for (const { label, files } of conflicts) {
        refusal(yield* Effect.result(MemoryRepository.tree(store, toFileMap(files))), "path-conflict", `${label}`);
        expect(held(store), `${label}: the store is as it was`).toEqual(before);
      }

      for (const { label, files } of treeClasses(draw)) {
        yield* Effect.orDie(MemoryRepository.tree(store, toFileMap(files)));
        expect(held(store), `${label}: building a tree leaves the store it was given as it was`).toEqual(before);
      }

      // A commit whose tree the store lacks, its parents all in the store: a root, and a child of the one commit.
      const lacking = (yield* Effect.orDie(
        MemoryRepository.tree(MemoryRepository.empty, toFileMap(treeClasses(draw)[0]?.files ?? [])),
      )).id;

      expect(store.trees.has(lacking), "the store lacks the tree").toBe(false);
      const flat = texture.signatures[0];

      if (flat === undefined) {
        return yield* Effect.die("the generator made no signature");
      }

      const fields = { author: signature(flat), committer: signature(flat), message: "m" };

      for (const parents of [[], [idAt(ids, 0)]]) {
        const orphan = yield* MemoryRepository.commit({ ...fields, tree: lacking, parents });
        refusal(
          MemoryRepository.add(store, orphan),
          "missing-tree",
          `a commit with ${parents.length} parents and no tree`,
        );
      }

      // The parent check comes first: with both missing, the answer is the missing parent.
      const gone = commitIdFrom(missingId(texture, 0, ids));
      const both = yield* MemoryRepository.commit({ ...fields, tree: lacking, parents: [gone] });
      refusal(MemoryRepository.add(store, both), "missing-parent", "a commit missing its parent and its tree");

      // With its tree built into the store, the same commit goes in, and its tree is kept.
      const filled = yield* Effect.orDie(MemoryRepository.tree(store, toFileMap(treeClasses(draw)[0]?.files ?? [])));
      const child = yield* MemoryRepository.commit({ ...fields, tree: filled.id, parents: [idAt(ids, 0)] });
      const added = yield* Effect.orDie(Effect.fromResult(MemoryRepository.add(filled.store, child)));
      expect(added.commits.get(child.id)?.tree, "the commit keeps its tree").toBe(filled.id);
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
  { arbitrary: { runs: 100, seed: 119120 } },
);

const hex = (content: Uint8Array): string => Buffer.from(content).toString("hex");

// Plant: leave out an empty file; keep the first mode seen for one blob, so a second path takes it; key `blobs` by
// path, so two paths with one content give two blobs; store the caller's array, not a copy of it.
it.effect.prop(
  "M5 a tree reads back: its paths with their modes, each path's bytes byte for byte, and one blob for equal bytes",
  { draw: treeArb },
  ({ draw }) =>
    Effect.gen(function* () {
      for (const { label, files } of treeClasses(draw)) {
        const { store, id } = yield* Effect.orDie(MemoryRepository.tree(MemoryRepository.empty, toFileMap(files)));
        const entries = store.trees.get(id);

        if (entries === undefined) {
          return yield* Effect.die(`${label}: the store holds no tree ${id}`);
        }

        expect([...entries.keys()].sort(), `${label}: the paths`).toEqual(files.map((file) => file.path).sort());

        for (const file of files) {
          const entry = entries.get(pathFrom(file.path));
          expect(entry?.mode, `${label}: the mode of ${JSON.stringify(file.path)}`).toBe(file.mode);
          expect(
            entry === undefined ? undefined : store.blobs.get(entry.blob),
            `${label}: the bytes of ${JSON.stringify(file.path)}`,
          ).toEqual(file.content);
        }

        expect(store.blobs.size, `${label}: one blob for each content`).toBe(
          new Set(files.map((file) => hex(file.content))).size,
        );
        const again = yield* Effect.orDie(MemoryRepository.tree(store, toFileMap(files)));
        expect(again.id, `${label}: the same files, the same tree`).toBe(id);
        expect(again.store.blobs.size, `${label}: no new blob the second time`).toBe(store.blobs.size);

        // The store copies the bytes it is given: a caller that changes its array afterwards changes nothing in the store.
        const given = files.map((file) => ({ ...file, content: Uint8Array.from(file.content) }));
        const copied = yield* Effect.orDie(MemoryRepository.tree(MemoryRepository.empty, toFileMap(given)));

        for (const file of given) {
          file.content.fill(0xa5);
        }

        for (const file of files) {
          const entry = copied.store.trees.get(copied.id)?.get(pathFrom(file.path));
          expect(
            entry === undefined ? undefined : copied.store.blobs.get(entry.blob),
            `${label}: the bytes of ${JSON.stringify(file.path)} after the caller changed its array`,
          ).toEqual(file.content);
        }
      }
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
  { arbitrary: { runs: 100, seed: 119120 } },
);

// Plant: delete the check for a path that is a folder of another in the merge, so `tree` refuses the files and the call
// dies, with no Conflict.
it.effect.prop(
  "M6 a file against a folder: mergeTrees gives Conflict naming both paths and no other, and the store is as it was",
  { texture: textureArb },
  ({ texture }) =>
    Effect.gen(function* () {
      const made = folderCarrier(texture);
      expect(
        made.cases.map((each) => each.label),
        "the generator reaches every class",
      ).toEqual([...FOLDER_MERGE_CLASSES]);

      const { store, ids } = yield* build(made.history);
      const context = yield* Layer.build(MemoryRepository.layer(store, RepositoryTest.settings()));
      const repository = Context.get(context, Repository.Repository);
      const current = Context.get(context, MemoryRepository.MemoryStore);
      const before = held(yield* current.get);

      for (const merge of made.cases) {
        const paths = merge.expected.kind === "conflict" ? merge.expected.paths : [];
        expect(paths.length, `${merge.label}: the model names the file and its folder's file`).toBeGreaterThan(1);

        const error = yield* Effect.flip(
          repository.mergeTrees({
            mergeBase: idAt(ids, merge.base),
            ours: idAt(ids, merge.ours),
            theirs: idAt(ids, merge.theirs),
          }),
        ).pipe(Effect.orDie);

        expectFailure(error, Repository.Conflict, { paths }, merge.label);
        expect(held(yield* current.get), `${merge.label}: the store is as it was`).toEqual(before);
      }
    }).pipe(Effect.scoped, Effect.provide(Digest.layerWebCrypto)),
  { arbitrary: { runs: 100, seed: 119120 } },
);

RepositoryTest.suite("memory", memorySubject, { runs: 100, timeout: 300_000 });
