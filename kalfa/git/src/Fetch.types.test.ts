// F17: the types of fetch, its two raw calls, the slot and the layers that need a file system. Compile the exact expressions, never execute them.
import { expectTypeOf, it } from "@effect/vitest";
import type { Effect, Scope } from "effect";
import { type Layer, type Option, type Redacted } from "effect";
import type * as FileSystem from "effect/FileSystem";
import type { ChildProcessSpawner } from "effect/process";
import * as Credentials from "./Credentials.ts";
import type * as MemoryRepository from "./MemoryRepository.ts";
import type * as ProcessRepository from "./ProcessRepository.ts";
import type { Ref, RefName } from "./Ref.ts";
import * as Remote from "./Remote.ts";
import type * as Repository from "./Repository.ts";

type Fails = Repository.GitUnavailable | Repository.TimedOut;

// Plant (F17): capture the slot at layer build, so `fetch` needs nothing and the `@ts-expect-error` goes unused; type the password `string`; add
// `Scope` to the service's `fetch` requirement; leave `HistoryTooShort` out of its errors; type `adopt`'s error `GitUnavailable | TimedOut`; leave `Raw["fetch"]`
// answering the refs; take `Scope` out of `Raw["fetch"]`'s requirement.
const calls = (repo: Repository.Repository["Service"], remote: Remote.Remote, text: string, under: RefName) => {
  expectTypeOf<Repository.Repository["Service"]["fetch"]>().toEqualTypeOf<
    (request: {
      readonly remote: Remote.Remote;
      readonly under: RefName;
    }) => Effect.Effect<
      ReadonlyArray<Ref>,
      | Remote.NoSuchRemote
      | Remote.BadRemoteUrl
      | Credentials.NoCredential
      | Remote.FetchFailed
      | Repository.HistoryTooShort
      | Repository.TooMany
      | Repository.RefNotCommit
      | Fails,
      Credentials.Credentials
    >
  >();

  expectTypeOf<Repository.Raw["remoteUrl"]>().toEqualTypeOf<
    (remote: Remote.Remote) => Effect.Effect<Remote.Url, Remote.NoSuchRemote | Remote.BadRemoteUrl | Fails>
  >();

  // The adapter's fetch answers what it read and the one step that adds it, and needs the scope `make` gives it.
  expectTypeOf<Repository.Raw["fetch"]>().toEqualTypeOf<
    (request: {
      readonly url: Remote.Url;
      readonly under: RefName;
      readonly credential: Option.Option<Credentials.Credential>;
    }) => Effect.Effect<
      Repository.Fetched,
      Remote.FetchFailed | Repository.HistoryTooShort | Repository.TooMany | Repository.RefNotCommit | Fails,
      Scope.Scope
    >
  >();

  expectTypeOf<Repository.Fetched["refs"]>().toEqualTypeOf<ReadonlyArray<Ref>>();

  // The adopt has no time limit, so it never fails `TimedOut`: its one failure is a disk that refuses.
  expectTypeOf<Repository.Fetched["adopt"]>().toEqualTypeOf<Effect.Effect<void, Repository.GitUnavailable>>();

  expectTypeOf<Credentials.Credential["password"]>().toEqualTypeOf<Redacted.Redacted<string>>();
  expectTypeOf(Credentials.none).toEqualTypeOf<Layer.Layer<Credentials.Credentials>>();

  // A program that fetches needs the slot: what a call returns is no `Effect` with no requirement, so `Effect.runPromise` takes it only
  // after a filler is provided.
  expectTypeOf(repo.fetch({ remote, under })).not.toExtend<Effect.Effect<unknown, unknown, never>>();
  // @ts-expect-error A URL is a `Remote.Url`, never plain text, so no unchecked text reaches git.
  const plain = Remote.url(text);

  return [plain];
};

// Plant (F17): drop `FileSystem` from what `/process` requires; give `MemoryRepository.layer` no third argument.
const layers = () => {
  expectTypeOf<ReturnType<typeof ProcessRepository.layer>>().toEqualTypeOf<
    Layer.Layer<
      Repository.Repository,
      Repository.GitTooOld | Repository.NoRepository | Repository.GitUnavailable | Repository.TimedOut,
      ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
    >
  >();

  expectTypeOf<Parameters<typeof MemoryRepository.layer>[2]>().toEqualTypeOf<MemoryRepository.Remotes | undefined>();
};

it("type: fetch asks the slot for its requirement and answers the refs and errors the plan gives; the raw fetch answers Fetched and needs a Scope, and its adopt cannot time out; the raw calls hold no slot; /process needs a file system", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(calls).toBeFunction();
  expectTypeOf(layers).toBeFunction();
});
