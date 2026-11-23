// T2 and T3: the calls' types and the layers' types. T5 and T6: the types of the write calls and the layer that needs a
// `Digest`. Compile the exact expressions, never execute them.
import { expect, expectTypeOf, it } from "@effect/vitest";
import { Result, Schema, type Context, type Effect, type Layer, type Option } from "effect";
import type { NonEmptyReadonlyArray } from "effect/Array";
import type * as Digest from "effect/crypto/Digest";
import type { ChildProcessSpawner } from "effect/process";
import type { Commit, Signature } from "./Commit.ts";
import type { CommitId } from "./CommitId.ts";
import type { PatchId } from "./Diff.ts";
import type * as MemoryRepository from "./MemoryRepository.ts";
import type * as ProcessRepository from "./ProcessRepository.ts";
import type { Ref, RefName } from "./Ref.ts";
import * as Repository from "./Repository.ts";
import type { TreeId } from "./Tree.ts";

type Fails = Repository.GitUnavailable | Repository.TimedOut;

// Plant (T2): add `R = Scope` to `walk`; type `include` as `ReadonlyArray`, so the empty-include line compiles. Plant (T5, ticket
// 1933): add `HistoryTooShort` to `patchId`'s errors; make `patchId` answer a `PatchId` and not an `Option` of one; give it a
// requirement `Scope`.
const calls = (repo: Repository.Repository["Service"]) => {
  expectTypeOf<
    Pick<
      Context.Service.Shape<typeof Repository.Repository>,
      "readCommit" | "readRefs" | "walk" | "mergeBases" | "isAncestor" | "patchId"
    >
  >().toEqualTypeOf<{
    readonly readCommit: (
      id: CommitId,
    ) => Effect.Effect<Commit, Repository.NoSuchCommit | Repository.TooLarge | Repository.UnreadableCommit | Fails>;
    readonly readRefs: (
      under: RefName,
    ) => Effect.Effect<ReadonlyArray<Ref>, Repository.TooMany | Repository.RefNotCommit | Fails>;
    readonly walk: (range: {
      readonly include: NonEmptyReadonlyArray<CommitId>;
      readonly exclude: ReadonlyArray<CommitId>;
    }) => Effect.Effect<
      ReadonlyArray<Commit>,
      | Repository.NoSuchCommit
      | Repository.TooMany
      | Repository.TooLarge
      | Repository.UnreadableCommit
      | Repository.HistoryTooShort
      | Fails
    >;
    readonly mergeBases: (
      a: CommitId,
      b: CommitId,
    ) => Effect.Effect<
      ReadonlyArray<CommitId>,
      Repository.NoSuchCommit | Repository.TooMany | Repository.HistoryTooShort | Fails
    >;
    readonly isAncestor: (
      ancestor: CommitId,
      of: CommitId,
    ) => Effect.Effect<boolean, Repository.NoSuchCommit | Repository.HistoryTooShort | Fails>;
    readonly patchId: (
      from: CommitId,
      to: CommitId,
    ) => Effect.Effect<
      Option.Option<PatchId>,
      Repository.NoSuchCommit | Repository.TooMany | Repository.DiffTooLarge | Fails
    >;
  }>();

  // @ts-expect-error A walk names at least one commit to include.
  return repo.walk({ include: [], exclude: [] });
};

// Plant (T3): require `FileSystem` in `/process`.
const layers = () => {
  expectTypeOf<ReturnType<typeof ProcessRepository.layer>>().toEqualTypeOf<
    Layer.Layer<
      Repository.Repository,
      Repository.GitTooOld | Repository.NoRepository | Repository.GitUnavailable | Repository.TimedOut,
      ChildProcessSpawner.ChildProcessSpawner
    >
  >();
};

// Plant (T6): give `MemoryRepository.layer` no requirement, so its `Digest` need is gone and the equality fails; or
// require `FileSystem` in `/process`.
const layersWithDigest = () => {
  expectTypeOf<ReturnType<typeof MemoryRepository.layer>>().toEqualTypeOf<
    Layer.Layer<Repository.Repository | MemoryRepository.MemoryStore, never, Digest.Digest>
  >();
  expectTypeOf<ReturnType<typeof ProcessRepository.layer>>().toEqualTypeOf<
    Layer.Layer<
      Repository.Repository,
      Repository.GitTooOld | Repository.NoRepository | Repository.GitUnavailable | Repository.TimedOut,
      ChildProcessSpawner.ChildProcessSpawner
    >
  >();
};

// Plant (T5): add `committer` to the public `writeCommit`, so the `@ts-expect-error` is unused and the keys differ.
const writes = (
  repo: Repository.Repository["Service"],
  tree: TreeId,
  parent: CommitId,
  author: Signature,
  person: Signature,
  text: string,
  ref: RefName,
) => {
  expectTypeOf<Repository.Repository["Service"]["writeCommit"]>().toEqualTypeOf<
    (commit: {
      readonly tree: TreeId;
      readonly parents: ReadonlyArray<CommitId>;
      readonly author: Signature;
      readonly message: string;
    }) => Effect.Effect<
      Commit,
      Repository.NoSuchTree | Repository.NoSuchCommit | Repository.NulInMessage | Repository.TooLargeToWrite | Fails
    >
  >();
  expectTypeOf<Repository.Repository["Service"]["moveRef"]>().toEqualTypeOf<
    (move: {
      readonly ref: RefName;
      readonly from: Option.Option<CommitId>;
      readonly to: CommitId;
    }) => Effect.Effect<void, Repository.NoSuchCommit | Repository.RefMoved | Repository.RefInTheWay | Fails>
  >();
  expectTypeOf<keyof Parameters<Repository.Repository["Service"]["writeCommit"]>[0]>().toEqualTypeOf<
    "tree" | "parents" | "author" | "message"
  >();
  expectTypeOf<Parameters<Repository.Raw["writeCommit"]>[0]["committer"]>().toEqualTypeOf<Signature>();
  // @ts-expect-error The committer comes from the settings and the clock, never from the caller.
  const withCommitter = repo.writeCommit({ tree, parents: [parent], author, message: text, committer: person });
  // @ts-expect-error A move names where the ref was read, as an Option: a bare id is no answer.
  const bareFrom = repo.moveRef({ ref, from: parent, to: parent });

  return [withCommitter, bareFrom];
};

// Plant (T5): type `ref` of `RefMoved` as `Schema.String`, so the `@ts-expect-error` is unused and the equality fails.
const writeErrors = (text: string, ref: RefName, tree: TreeId) => {
  expectTypeOf<ConstructorParameters<typeof Repository.RefMoved>[0]["ref"]>().toEqualTypeOf<RefName>();
  expectTypeOf<ConstructorParameters<typeof Repository.RefInTheWay>[0]["other"]>().toEqualTypeOf<RefName>();
  expectTypeOf<ConstructorParameters<typeof Repository.NoSuchTree>[0]["id"]>().toEqualTypeOf<TreeId>();
  // @ts-expect-error A plain string is not a ref name.
  const movedText = new Repository.RefMoved({ ref: text });
  // @ts-expect-error A plain string is not a tree id.
  const treeText = new Repository.NoSuchTree({ id: text });

  return [movedText, treeText, new Repository.RefMoved({ ref }), new Repository.NoSuchTree({ id: tree })];
};

// Plant (T4): type `ref` of `RefNotCommit` as `Schema.String`: the `@ts-expect-error` is unused and the equality fails.
const refNotCommit = (text: string, ref: RefName) => {
  expectTypeOf<ConstructorParameters<typeof Repository.RefNotCommit>[0]["ref"]>().toEqualTypeOf<RefName>();
  // @ts-expect-error A plain string is not a ref name.
  const fromText = new Repository.RefNotCommit({ ref: text, points: "tag" });

  return [fromText, new Repository.RefNotCommit({ ref, points: "tag" })];
};

it("type: each call has the answer and errors the plan gives, and each layer the plan's types", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(calls).toBeFunction();
  expectTypeOf(layers).toBeFunction();
  expectTypeOf(layersWithDigest).toBeFunction();
  expectTypeOf(writes).toBeFunction();
  expectTypeOf(writeErrors).toBeFunction();
  expectTypeOf(refNotCommit).toBeFunction();
});

it("T4 scenario: RefNotCommit names the ref as a RefName, so text that is no ref name does not decode", () => {
  const decode = Schema.decodeUnknownResult(Repository.RefNotCommit.fields.ref);

  expect(Result.isSuccess(decode("refs/heads/main")), "a ref name decodes").toBe(true);
  expect(Result.isFailure(decode("refs/heads/a b")), "a space is no ref name").toBe(true);
  expect(Result.isFailure(decode("main")), "a branch name is no ref name").toBe(true);
});
