// Lock: one holder at a time for a name, across the processes of one laptop. This file is the
// contract only (0095): `LockFs.layer` keeps a pid file, `LockTest.layer` a set in memory. Today's
// lead tooling, run on our own laptop.
import { Context } from "effect";
import type { Effect, Scope } from "effect";

export class Lock extends Context.Service<
  Lock,
  {
    /**
     * Wait until no other holder has `name`, then hold it until the scope closes. `name` is a plain
     * file name, such as `npm-isolate-<sha>`. Never fails: a hold waits for as long as it is held.
     */
    readonly hold: (name: string) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("lead/sys/Lock") {}
