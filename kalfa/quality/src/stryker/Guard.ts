/**
 * The host's say on a run (decisions 0594 and 0178), as a service: before Stryker starts a test file,
 * the host that runs this package is asked whether this machine may start it. The package holds no
 * rule of its own and no repo path, so which files a machine refuses is the host's; that a host must
 * answer is the package's. `node/MutantsStryker.ts` asks with the test files it is about to run, right
 * before it runs them, so no command line, in any order or spelling, reaches Stryker unasked. This file
 * is the contract only (0095).
 */
import { Context } from "effect";
import type { Effect } from "effect";
import type { Refused } from "./Report.ts";

/**
 * The host's say on a run: whether this machine may start a test file.
 *
 * @category services
 */
export class Guard extends Context.Service<
  Guard,
  {
    /** Succeeds when this machine may start every one of `files`, repo-relative test files; fails as `not_allowed` otherwise. */
    readonly allow: (files: ReadonlyArray<string>) => Effect.Effect<void, Refused>;
  }
>()("@kalfa/quality/stryker/Guard") {}
