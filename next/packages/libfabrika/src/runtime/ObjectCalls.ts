/**
 * The calls a Durable Object answers over RPC, as Promises, named once for both platforms: the
 * Cloudflare bindings and the local dev client both read them.
 *
 * @stability unstable
 */
import type { Effect } from "effect";
import type { Activity } from "../processes/Process.ts";
import type * as IsolateUsage from "./IsolateUsage.ts";
import type { Descriptor, ProgramRunner } from "./Runner.ts";

/**
 * One Effect call as the Promise call RPC answers: the same arguments, and a Promise of the
 * Effect's success.
 *
 * @stability unstable
 * @category models
 */
export type RemoteCall<F> = F extends (...args: infer A) => infer B
  ? (...args: A) => Promise<Effect.Success<B>>
  : never;

/**
 * Every call of `S` over RPC.
 *
 * @stability unstable
 * @category models
 */
export type Remote<S> = { [K in keyof S]: RemoteCall<S[K]> };

type Runner = (typeof ProgramRunner)["Service"];

/**
 * A Process object's calls: the runner's `msg`, `open`, `due`, `restart` and `swap`, plus its
 * configuration, usage, alarm and abort calls.
 *
 * @stability unstable
 * @category models
 */
export type ProcessObjectCalls = Remote<Pick<Runner, "msg" | "open" | "due" | "restart" | "swap">> & {
  mailed: RemoteCall<(trace?: { traceId: string; spanId: string }) => Runner["mailed"]>;
  configure: RemoteCall<(descriptor: Descriptor, drain?: boolean) => Effect.Effect<void>>;
  usage: RemoteCall<typeof IsolateUsage.record>;
  descriptor: RemoteCall<(process?: string) => Effect.Effect<Descriptor>>;
  activity: RemoteCall<(value: typeof Activity.Type) => Effect.Effect<void>>;
  recover: RemoteCall<() => Effect.Effect<unknown>>;
  savedAlarm: RemoteCall<() => Effect.Effect<number | null>>;
  abort: RemoteCall<() => Effect.Effect<void>>;
};
