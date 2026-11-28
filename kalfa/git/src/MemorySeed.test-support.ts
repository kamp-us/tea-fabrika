// Seeds in-memory stores for the laws of the in-memory adapter and the shared laws it runs: a history becomes a store with
// its trees and ids computed as git computes them, its refs pointed and its shallow commits marked.
import { Context, Effect, Layer, Schema } from "effect";
import * as Digest from "effect/crypto/Digest";
import * as Commit from "./Commit.ts";
import * as CommitId from "./CommitId.ts";
import type { FetchSeeded, FetchSubject } from "./Fetch.test-support.ts";
import type { FileSpec, FlatSignature, History } from "./History.test-support.ts";
import * as MemoryRepository from "./MemoryRepository.ts";
import * as Ref from "./Ref.ts";
import * as Remote from "./Remote.ts";
import * as Repository from "./Repository.ts";
import type { Subject } from "./RepositoryTest.ts";
import * as Tree from "./Tree.ts";

export const signature = (flat: FlatSignature): Commit.Signature =>
  new Commit.Signature({
    name: flat.name,
    email: flat.email,
    at: { seconds: flat.seconds, offset: flat.offset },
  });

export const commitIdFrom = (text: string): CommitId.CommitId => Schema.decodeUnknownSync(CommitId.CommitId)(text);

export const refNameFrom = (text: string): Ref.RefName => Schema.decodeUnknownSync(Ref.RefName)(text);

export const treeIdFrom = (text: string): Tree.TreeId => Schema.decodeUnknownSync(Tree.TreeId)(text);

export const pathFrom = (text: string): Tree.Path => Schema.decodeUnknownSync(Tree.Path)(text);

export const toFile = (mode: string, content: Uint8Array): MemoryRepository.File => ({
  mode: Schema.decodeUnknownSync(Tree.Mode)(mode),
  content,
});

/** The files of a node as the memory store takes them: a Map, so a path named `__proto__` is a path like any other. */
export const toFileMap = (files: ReadonlyArray<FileSpec>): ReadonlyMap<Tree.Path, MemoryRepository.File> =>
  new Map(files.map((file) => [pathFrom(file.path), toFile(file.mode, file.content)]));

export const idAt = (ids: ReadonlyArray<CommitId.CommitId>, index: number): CommitId.CommitId => {
  const id = ids[index];

  if (id === undefined) {
    throw new Error(`no id for commit ${index}`);
  }

  return id;
};

/** A store holding the history: trees and ids computed as git computes them, refs pointed, shallow commits marked. */
export const build = (
  history: History,
): Effect.Effect<
  {
    readonly store: MemoryRepository.Store;
    readonly ids: ReadonlyArray<CommitId.CommitId>;
    readonly trees: ReadonlyArray<Tree.TreeId>;
  },
  never,
  Digest.Digest
> =>
  Effect.gen(function* () {
    let store = MemoryRepository.empty;
    const ids: Array<CommitId.CommitId> = [];
    const trees: Array<Tree.TreeId> = [];

    for (const node of history.nodes) {
      const made = yield* Effect.orDie(MemoryRepository.tree(store, toFileMap(node.files)));

      const commit = yield* MemoryRepository.commit({
        tree: made.id,
        parents: node.parents.map((parent) => idAt(ids, parent)),
        author: signature(node.author),
        committer: signature(node.committer),
        message: node.message,
      });

      store = yield* Effect.orDie(Effect.fromResult(MemoryRepository.add(made.store, commit)));
      ids.push(commit.id);
      trees.push(made.id);
    }

    for (const ref of history.refs) {
      store = yield* Effect.orDie(
        Effect.fromResult(MemoryRepository.point(store, refNameFrom(ref.name), idAt(ids, ref.commit))),
      );
    }

    return { store: { ...store, shallow: new Set(history.shallow.map((i) => idAt(ids, i))) }, ids, trees };
  });

export const memorySubject: Subject = {
  seed: (history, config) =>
    Effect.gen(function* () {
      const { store, ids, trees } = yield* build(history);
      const context = yield* Layer.build(MemoryRepository.layer(store, config));

      return {
        repository: Context.get(context, Repository.Repository),
        ids,
        trees,
        fingerprint: Context.get(context, MemoryRepository.MemoryStore).get,
        hidden: [],
      };
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
};

/** The remote's one URL, and the name this repository holds for it. */
const REMOTE_URL = Schema.decodeUnknownSync(Remote.Url)("https://remote.test/r.git");

const NOWHERE_URL = Schema.decodeUnknownSync(Remote.Url)("https://nowhere.test/r.git");

const ORIGIN = Schema.decodeUnknownSync(Remote.Name)("origin");

/**
 * A subject for the laws of fetch: the remote and the local repository are two stores, the local one knows the remote by the name `origin` and
 * by one URL, and the remote store is read as it is at each fetch, so a law moves one of its refs between two fetches.
 */
export const memoryFetchSubject: FetchSubject = {
  seed: (remote, local, config) =>
    Effect.gen(function* () {
      const there = yield* build(remote);
      const here = yield* build(local);
      const remoteContext = yield* Layer.build(MemoryRepository.layer(there.store, config));
      const remoteStore = Context.get(remoteContext, MemoryRepository.MemoryStore);

      const remotes: MemoryRepository.Remotes = {
        names: new Map([[ORIGIN, REMOTE_URL]]),
        stores: new Map([[REMOTE_URL, remoteStore.get]]),
      };

      const context = yield* Layer.build(MemoryRepository.layer(here.store, config, remotes));
      const store = Context.get(context, MemoryRepository.MemoryStore);

      const seeded: FetchSeeded = {
        repository: Context.get(context, Repository.Repository),
        remote: Context.get(remoteContext, Repository.Repository),
        ids: here.ids,
        remoteIds: there.ids,
        named: Remote.named(ORIGIN),
        configured: REMOTE_URL,
        urls: [Remote.url(REMOTE_URL)],
        nowhere: NOWHERE_URL,
        shallow: Effect.map(store.get, (held) => held.shallow.size > 0),
        fingerprint: store.get,
        hidden: [],
        moveRemoteRef: (ref, commit) =>
          Effect.gen(function* () {
            const held = yield* remoteStore.get;

            const moved = yield* Effect.orDie(
              Effect.fromResult(MemoryRepository.point(held, refNameFrom(ref), idAt(there.ids, commit))),
            );

            yield* remoteStore.set(moved);
          }),
      };

      return seeded;
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
};
