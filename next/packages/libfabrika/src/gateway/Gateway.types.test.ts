// Ticket 921, next/. Law 3 (decision 0043, rule 12): nothing in `gateway/` fails with the ledger's
// error. One block a file, added in the slice that fixes it. Slice 1 fixes the two helper files of
// the `Gateway` service, `GatewayStore.ts` and `GatewayNonce.ts`; the service itself keeps the
// ledger's error until its own slice and has no block yet. An error is matched by its `_tag`, so
// this file imports no ledger file. The type checker reads the law; Vitest does not typecheck, so
// the lead and CI run it with `pnpm typecheck`.
// Plant: add a member tagged `LedgerError` to one function's error.
import { expectTypeOf, it } from "@effect/vitest";
import type { Effect, Result } from "effect";
import type { From } from "../processes/Mailbox.ts";
import type { Recipient } from "../processes/Process.ts";
import type { News } from "../runtime/News.ts";
import type { Gateway } from "./Gateway.ts";
import type { gatewayNonce } from "./GatewayNonce.ts";
import type { gatewayStore } from "./GatewayStore.ts";

/** What one function fails with: an Effect's error, a Result's failure, or that of what a function answers. */
type Failure<Member> = Member extends (...args: ReadonlyArray<never>) => infer Answer
  ? Failure<Answer>
  : Member extends Effect.Effect<infer _A, infer E, infer _R>
    ? E
    : Member extends Result.Result<infer _A, infer E>
      ? E
      : never;

/** The members of a union of errors that are the ledger's own error. */
type FromLedger<Errors> = Extract<Errors, { readonly _tag: "LedgerError" }>;

type Own = { readonly _tag: "Own" };
type Ledgers = { readonly _tag: "LedgerError" };

it("type: the gateway's store and nonce fail with GatewayError, never an error tagged LedgerError", () => {
  // The helper finds a ledger error where one is: in an Effect, in a Result, and in a function's answer.
  expectTypeOf<FromLedger<Failure<Effect.Effect<void, Own | Ledgers>>>>().toEqualTypeOf<Ledgers>();
  expectTypeOf<FromLedger<Failure<() => Result.Result<boolean, Own | Ledgers>>>>().toEqualTypeOf<Ledgers>();
  expectTypeOf<Failure<(name: string) => Effect.Effect<void, Own>>>().toEqualTypeOf<Own>();

  // GatewayStore: the one call that fails is `atomic`.
  type Atomic = Failure<ReturnType<ReturnType<typeof gatewayStore>["atomic"]>>;
  expectTypeOf<Atomic["_tag"]>().toEqualTypeOf<"GatewayError">();
  expectTypeOf<FromLedger<Atomic>>().toBeNever();

  // GatewayNonce: making the tools, and then `issue`, `check` and `spend`.
  type Made = Failure<typeof gatewayNonce>;
  type Tools = Effect.Success<ReturnType<typeof gatewayNonce>>;
  type Used = Failure<Tools["issue"]> | Failure<Tools["check"]> | Failure<Tools["spend"]>;
  expectTypeOf<(Made | Used)["_tag"]>().toEqualTypeOf<"GatewayError">();
  expectTypeOf<FromLedger<Made | Used>>().toBeNever();
});

// P18 slice 2, next/ (ticket 979): T1. The door's `monitor` option takes the watch's recipient as
// the client case of `Recipient`, which the door builds from the checked hello and the socket's
// session. The type checker reads the law; the lead and CI run it with `pnpm typecheck`.
// Plant: type the option's `to` as the whole `Recipient` union, or as a plain string.
type MonitorOption = NonNullable<Parameters<typeof Gateway.layer>[0]["monitor"]>;

it("type: the door's monitor option takes a ref, a pid, the client case of Recipient and the call's From", () => {
  expectTypeOf<Parameters<MonitorOption>[0]>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<MonitorOption>[1]>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<MonitorOption>[2]>().toEqualTypeOf<typeof Recipient.cases.client.Type>();
  expectTypeOf<Parameters<MonitorOption>[3]>().toEqualTypeOf<From>();
  expectTypeOf<Parameters<MonitorOption>>().toHaveProperty("length").toEqualTypeOf<4>();
});

// Ticket 1053 slice 1, next/: L5 of the plan (docs/plan/quests/t1053-PLAN.md), written before the
// build. The door builds what a client's socket is told, so its `notify` option takes `News`, never
// `unknown`. The type checker reads the law; the lead and CI run it with `pnpm typecheck`.
// Plant: put `unknown` back on `Options.notify`.
type NotifyOption = Parameters<typeof Gateway.layer>[0]["notify"];

it("type: L5 the door's notify option takes a client and News", () => {
  expectTypeOf<Parameters<NotifyOption>>().toEqualTypeOf<[client: string, news: News]>();
});
