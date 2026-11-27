// MainFetch: origin's main, fetched into a ref of this call alone, for the two things that need main's commit as it is now: the merge
// of main into a quest's branch (land.ts) and the signature read (./SignaturesGit.ts). Never FETCH_HEAD (every fetch in a checkout
// writes it, and a session that fetched there at once swapped it before the read: "the fetched main is not a commit") and never a
// shared ref. The ref is removed when the read ends. Today's lead tooling, run on our own laptop; it is not product.
import { Effect, Random, Schema } from "effect";
import type { ChildProcessSpawner } from "effect/process";

import { run } from "./command.ts";

/** Main could not be fetched or read, and the git output that says why. */
export class MainNotFetched extends Schema.TaggedError<MainNotFetched, { readonly brand: unique symbol }>()(
  "MainNotFetched",
  { reason: Schema.String, output: Schema.String },
) {}

/** One git call in `dir` that must exit 0: its output, trimmed. */
const must = (dir: string, reason: string, ...args: ReadonlyArray<string>) =>
  run("git", args, dir).pipe(
    Effect.mapError((e) => MainNotFetched.make({ reason, output: e.message })),
    Effect.flatMap((done) =>
      done.code === 0
        ? Effect.succeed(done.out.trim())
        : Effect.fail(MainNotFetched.make({ reason, output: `${done.out}${done.err}` })),
    ),
  );

/** Fetches origin's main into a ref of this call alone and gives back its commit, then removes the ref. */
export const fetchedMain = Effect.fn("MainFetch.fetchedMain")(function* (
  dir: string,
): Effect.fn.Return<string, MainNotFetched, ChildProcessSpawner.ChildProcessSpawner> {
  const ref = `refs/land-fetch/${process.pid}-${yield* Random.nextInt}`;

  return yield* Effect.acquireUseRelease(
    must(
      dir,
      "origin main could not be fetched",
      "fetch",
      "-q",
      "--no-write-fetch-head",
      "origin",
      `+refs/heads/main:${ref}`,
    ),
    () => must(dir, "the fetched main is not a commit", "rev-parse", `${ref}^{commit}`),
    () => Effect.ignore(run("git", ["update-ref", "-d", ref], dir)),
  );
});
