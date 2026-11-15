// next/, test support. A test's own connection to one SQLite file of a running local instance, the one
// way a test opens such a file. Read through its module, as port.test-support is.
// edge: Effect SQL has no open of another process's SQLite file, with a busy timeout, that a test can read rows from
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";

// The instance writes its files from its own connection while the test holds a second one. Once a reply
// write is cut, a process retries about every 100 ms, each write holding the lock for 0.3 to 11.5 ms on
// a laptop (ticket 962). node:sqlite's default busy timeout is 0, so a CREATE or DROP TRIGGER that met
// one of those writes failed at once with "database is locked" (PR 1242's run 43623892315), and a read
// can meet the same answer while workerd creates a file and turns it to WAL. SQLite's busy timeout waits
// for the lock as any second client does. 5000 ms is over 400 times the longest hold measured.
const LOCK_WAIT_MS = 5000;

/** Opens `file` from the test's own connection, waiting for the instance's lock, and closes it with the scope. */
export const instanceDatabase = (file: string, options: { readonly readOnly: boolean }) =>
  Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(file, { readOnly: options.readOnly, timeout: LOCK_WAIT_MS })),
    (db) => Effect.sync(() => db.close()),
  );
