/**
 * The SQLite file a test opens (decision 0538), named as Django and Rails name theirs, "the test
 * database". `make` opens a file the test owns and makes it fast: the journal in memory and no disk
 * sync, since no law cuts the power and a clean close still keeps every commit. `open` opens a file
 * something else owns, such as a running instance's store, and changes nothing in it. Both close the
 * connection when the scope closes, and a reopen is Effect's own `ScopedRef.set`.
 */
import { DatabaseSync } from "node:sqlite"; // edge: Effect SQL has no synchronous SQLite handle, and the stores under test take node:sqlite's
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

/**
 * Error for a file another party owns that would not open: it may be missing, locked or not SQLite.
 *
 * @category errors
 */
export class TestDatabaseError extends Schema.TaggedError<TestDatabaseError, { readonly brand: unique symbol }>()(
  "TestDatabaseError",
  {
    file: Schema.String,
    cause: Schema.Defect(),
  },
) {}

const close = (db: DatabaseSync): Effect.Effect<void> =>
  Effect.sync(() => {
    if (db.isOpen) {
      db.close();
    }
  });

/**
 * Opens a file the test owns with `journal_mode=MEMORY` and `synchronous=OFF`, and closes it when
 * the scope closes.
 *
 * **When to use**
 *
 * Use when a law writes a store in a temp folder the law made. Wrap it in `ScopedRef.fromAcquire` for
 * a law that reopens the store: `ScopedRef.set(ref, make(file))` opens the new connection, then
 * closes the old one.
 *
 * **Gotchas**
 *
 * - A file that will not open is a broken test, so it dies rather than fails.
 * - The journal lives in memory, so a second connection writing the same file at the same time can
 *   meet `database is locked`. Such a file belongs to `open`.
 * - A reopen through `ScopedRef.set` holds two connections for a moment, so the old one must be idle
 *   (no open transaction) when the law reopens.
 *
 * @category constructors
 */
export const make = (file: string): Effect.Effect<DatabaseSync, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const db = new DatabaseSync(file);
      db.exec("PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF");

      return db;
    }),
    close,
  );

/**
 * How a test reaches a file another party owns: `readOnly` refuses every write, and `wait` is how
 * long SQLite waits on a lock another process holds before it gives up (none when left out).
 *
 * @category models
 */
export interface Options {
  readonly readOnly?: boolean;
  readonly wait?: Duration.Input;
}

/**
 * Opens a file another party owns, sets no pragma in it, and closes it when the scope closes.
 *
 * **When to use**
 *
 * Use when a running instance or the product writes the file, such as the local span queue, and the
 * test must see it as its owner left it.
 *
 * **Gotchas**
 *
 * - Such a file may be missing or locked, so a failed open fails with `TestDatabaseError`, which
 *   names the file.
 *
 * @category constructors
 */
export const open = (
  file: string,
  options: Options = {},
): Effect.Effect<DatabaseSync, TestDatabaseError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.try({
      try: () =>
        new DatabaseSync(file, {
          readOnly: options.readOnly ?? false,
          timeout: options.wait === undefined ? 0 : Duration.toMillis(options.wait),
        }),
      catch: (cause) => TestDatabaseError.make({ file, cause }),
    }),
    close,
  );
