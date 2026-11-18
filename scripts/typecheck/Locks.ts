// Locks: the one typecheck lock every shell on the machine shares (0410, one type check at a time,
// 0012). This file is the contract only (0095): `LocksFile.layer` keeps it as a label file holding
// its holder's pid, after Mercurial's repository lock, and `LocksTest.layer` holds it in memory.
// Today's tooling (0113), following next/'s rules (0033).
import { Context, Schema } from "effect";
import type { Effect, Option, Scope } from "effect";

/** A lock file could not be read, written or removed. */
export class LockError extends Schema.TaggedError<LockError>()("LockError", {
  path: Schema.String,
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** The lock, while it is held. */
export interface Held {
  /** Writes `pid` to `<lock>.child` while that command runs, or removes it with `none`. */
  readonly running: (pid: Option.Option<number>) => Effect.Effect<void, LockError>;
}

export class Locks extends Context.Service<
  Locks,
  {
    /**
     * Holds the lock at `path` until the scope ends. While another holds it, prints one line naming
     * that holder and waits; a stale lock is broken at once and in silence. On release the label is
     * removed only if it still names this process.
     */
    readonly hold: (path: string) => Effect.Effect<Held, LockError, Scope.Scope>;
  }
>()("scripts/typecheck/Locks") {}
