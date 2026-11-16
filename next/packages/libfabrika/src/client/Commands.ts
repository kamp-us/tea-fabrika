/**
 * What the hands client can run: the contract only (0095). A layer that runs real commands comes
 * with the hands launcher; until then only tests give one.
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { Command, Result } from "../tasks/Task.ts";

/**
 * Service that runs one closed command on this host.
 *
 * **Details**
 *
 * `has` is what this host can do, sent as the hello's `has`: a fact about the layer, never a
 * setting. `execute` runs one command once and answers its result. A command that cannot start is a
 * `failed` result, never an error.
 *
 * @category services
 */
export class Commands extends Context.Service<
  Commands,
  {
    readonly has: ReadonlyArray<string>;
    readonly execute: (command: Command) => Effect.Effect<Result>;
  }
>()("@kampus/libfabrika/client/Commands") {}
