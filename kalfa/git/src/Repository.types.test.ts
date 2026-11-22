// T2 and T3: the calls' types and the layers' types. Compile the exact expressions, never execute them.
import { expectTypeOf, it } from "@effect/vitest";
import type { Context, Effect, Layer } from "effect";
import type { NonEmptyReadonlyArray } from "effect/Array";
import type { ChildProcessSpawner } from "effect/process";
import type { Commit } from "./Commit.ts";
import type { CommitId } from "./CommitId.ts";
import type * as MemoryRepository from "./MemoryRepository.ts";
import type * as ProcessRepository from "./ProcessRepository.ts";
import type { Ref, RefName } from "./Ref.ts";
import type * as Repository from "./Repository.ts";

type Fails = Repository.GitUnavailable | Repository.TimedOut;

// Plant (T2): add `R = Scope` to `walk`; type `include` as `ReadonlyArray`, so the empty-include line compiles.
const calls = (repo: Repository.Repository["Service"]) => {
  expectTypeOf<Context.Service.Shape<typeof Repository.Repository>>().toEqualTypeOf<{
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
  expectTypeOf<ReturnType<typeof MemoryRepository.layer>>().toEqualTypeOf<
    Layer.Layer<Repository.Repository | MemoryRepository.MemoryStore>
  >();
};

it("type: each call has the answer and errors the plan gives, and each layer the plan's types", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(calls).toBeFunction();
  expectTypeOf(layers).toBeFunction();
});
