// P39 slice 4a, next/, T1 (0095, 0043): `Journal.ts` and `Commands.ts` hold the hands client's two
// contracts, each in the client module's own error and the shared names. Effect's `KeyValueStore`
// and its `PlatformError` are translated at `JournalStore.layer`, with the cause kept, and never
// part of the contract; a command that cannot start is a `failed` Result, never an error. CI's
// typecheck is this law's runner. Plant (after build): put `PlatformError` in `Journal.write`'s
// error channel.
import { expectTypeOf, it } from "@effect/vitest";
import type * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import type * as KeyValueStore from "effect/persistence/KeyValueStore";
import type * as PlatformError from "effect/PlatformError";
import type { Rev } from "../Rev.ts";
import type { Command, Result } from "../tasks/Task.ts";
import type * as CommandsFront from "./Commands.ts";
import type { Commands } from "./Commands.ts";
import type * as JournalFront from "./Journal.ts";
import type { Entry, Journal, JournalError } from "./Journal.ts";
import type * as JournalStore from "./JournalStore.ts";

it("type: T1 Journal and Commands speak their own errors and shared names only, never KeyValueStore's or PlatformError", () => {
  // The journal's two calls, as the contract writes them: one entry per task, read or written.
  expectTypeOf<Context.Service.Shape<typeof Journal>>().toEqualTypeOf<{
    readonly read: (task: string) => Effect.Effect<Entry | null, JournalError>;
    readonly write: (task: string, entry: Entry) => Effect.Effect<void, JournalError>;
  }>();
  expectTypeOf<Extract<JournalError, PlatformError.PlatformError>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<JournalError, KeyValueStore.KeyValueStoreError>>().toEqualTypeOf<never>();
  expectTypeOf<JournalError["reason"]>().toEqualTypeOf<"storage" | "bad_entry">();
  // The five steps a task's entry may stand at, each keeping its execution and the client's own clock.
  expectTypeOf<Entry["_tag"]>().toEqualTypeOf<"prepared" | "executing" | "result" | "acknowledged" | "held">();
  // A finish refused for good keeps the brain's reason, and every entry after `executing` keeps
  // when the command started.
  expectTypeOf<Extract<Entry, { _tag: "held" }>["reason"]>().toEqualTypeOf<string>();
  expectTypeOf<Extract<Entry, { _tag: "result" }>["startedAt"]>().toEqualTypeOf<string | undefined>();
  expectTypeOf<Entry["execution"]>().toEqualTypeOf<string>();
  expectTypeOf<Entry["at"]>().toEqualTypeOf<string>();
  expectTypeOf<Extract<Entry, { _tag: "result" }>["result"]>().toEqualTypeOf<Result>();
  expectTypeOf<Extract<Entry, { _tag: "acknowledged" }>["rev"]>().toEqualTypeOf<Rev>();
  // The command contract: what this host can do, and one closed command run once, never failing.
  expectTypeOf<Context.Service.Shape<typeof Commands>>().toEqualTypeOf<{
    readonly has: ReadonlyArray<string>;
    readonly execute: (command: Command) => Effect.Effect<Result>;
  }>();

  // The journal's one layer is over Effect's own store, which it needs and never names in the contract.
  type Store = typeof JournalStore.layer;

  expectTypeOf<Layer.Success<Store>>().toEqualTypeOf<Journal>();
  expectTypeOf<Layer.Error<Store>>().toEqualTypeOf<never>();
  expectTypeOf<Layer.Services<Store>>().toEqualTypeOf<KeyValueStore.KeyValueStore>();
  // No static layer on either class, and neither contract module exports a layer.
  expectTypeOf<"layer" extends keyof typeof Journal ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"layer" extends keyof typeof JournalFront ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"layer" extends keyof typeof Commands ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"layer" extends keyof typeof CommandsFront ? true : false>().toEqualTypeOf<false>();
  // The error is a schema value of its own, so a client can save or show it as the module wrote it.
  expectTypeOf<JournalError>().toEqualTypeOf<JournalError>();
});
