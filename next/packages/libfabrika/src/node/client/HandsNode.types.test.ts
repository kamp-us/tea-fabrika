// P39 slice 4b, next/, T2 (0095, 0043): the three node layers of the hands client supply the client
// module's own contracts, `Commands`, `ClientKey` and Effect's `KeyValueStore`, and a platform's
// `PlatformError` is translated inside each, never left in what a caller sees: not in a contract's
// calls, and not in a layer's error or what it needs past its own build. CI's typecheck is this
// law's runner. Plant (run once in a typecheck window, recorded in the tests step's field row): let
// `KeyFile`'s `current` fail with `PlatformError`.
import { expectTypeOf, it } from "@effect/vitest";
import type * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import type * as KeyValueStore from "effect/persistence/KeyValueStore";
import type * as PlatformError from "effect/PlatformError";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type { Commands } from "../../client/Commands.ts";
import type { Command, Result } from "../../tasks/Task.ts";
import type { ClientKey, ClientKeyError, Identity } from "../../transport/ClientKey.ts";
import type * as CommandsNode from "./CommandsNode.ts";
import type * as JournalSqlite from "./JournalSqlite.ts";
import type * as KeyFile from "./KeyFile.ts";

it("type: T2 the three node layers supply Commands, ClientKey and KeyValueStore with no PlatformError left in their error or requirement channels", () => {
  type CommandsLayer = typeof CommandsNode.layer;

  type KeyLayer = ReturnType<typeof KeyFile.layer>;

  type JournalLayer = ReturnType<typeof JournalSqlite.layer>;

  // Each layer supplies exactly its contract.
  expectTypeOf<Layer.Success<CommandsLayer>>().toEqualTypeOf<Commands>();
  expectTypeOf<Layer.Success<KeyLayer>>().toEqualTypeOf<ClientKey>();
  expectTypeOf<Layer.Success<JournalLayer>>().toEqualTypeOf<KeyValueStore.KeyValueStore>();
  // No PlatformError is left in a layer's own failure.
  expectTypeOf<Extract<Layer.Error<CommandsLayer>, PlatformError.PlatformError>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<Layer.Error<KeyLayer>, PlatformError.PlatformError>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<Layer.Error<JournalLayer>, PlatformError.PlatformError>>().toEqualTypeOf<never>();
  // What each needs is Effect's own platform services, and nothing else: the journal file names
  // node:sqlite itself, at its one marked edge.
  expectTypeOf<
    Exclude<Layer.Services<CommandsLayer>, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path>
  >().toEqualTypeOf<never>();
  expectTypeOf<Exclude<Layer.Services<KeyLayer>, FileSystem.FileSystem | Path.Path>>().toEqualTypeOf<never>();
  expectTypeOf<Layer.Services<JournalLayer>>().toEqualTypeOf<never>();
  // The two contracts the layers keep, as 4a and the transport wrote them: a command never fails,
  // and the key's calls fail only with the key's own error.
  expectTypeOf<Context.Service.Shape<typeof Commands>>().toEqualTypeOf<{
    readonly has: ReadonlyArray<string>;
    readonly execute: (command: Command) => Effect.Effect<Result>;
  }>();
  expectTypeOf<Context.Service.Shape<typeof ClientKey>>().toEqualTypeOf<{
    readonly current: (rejected: string | null) => Effect.Effect<Identity, ClientKeyError>;
    readonly claimPersist: Effect.Effect<boolean, ClientKeyError>;
    readonly persist: Effect.Effect<boolean, "unsupported" | "failed">;
  }>();
  // Both layers take their file as an option, never a setting of their own.
  expectTypeOf<Parameters<typeof KeyFile.layer>>().toEqualTypeOf<[options: { readonly file: string }]>();
  expectTypeOf<Parameters<typeof JournalSqlite.layer>>().toEqualTypeOf<[options: { readonly file: string }]>();
});
