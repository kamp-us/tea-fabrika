// next/, ticket 962. A test's own connection to an instance's SQLite file waits for a lock another
// process holds, as A13's trigger write must wait for the live instance's short writes.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess } from "effect/process";

import { instanceDatabase } from "./instance-database.test-support.ts";

// Longer than a busy CI machine takes to see the holder's line, so the second client meets the lock,
// and far shorter than the opener's wait. The instance's own holds were 0.3 to 11.5 ms (ticket 962).
const HOLD_MS = 500;

// The other client, in its own process: workerd's writer for a write, and a writer before its file
// turns to WAL for a read. It says `held` once it has the lock, keeps it, then commits one row.
// fs.writeSync, since a pipe write from process.stdout waits for the event loop on macOS.
const HOLDER = `
import { writeSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [file, journal, hold] = process.argv.slice(1);
const db = new DatabaseSync(file);
db.exec("PRAGMA journal_mode=" + journal);
db.exec("CREATE TABLE IF NOT EXISTS rows (n INTEGER)");
db.exec(journal === "wal" ? "BEGIN IMMEDIATE" : "BEGIN EXCLUSIVE");
db.exec("INSERT INTO rows VALUES (1)");
writeSync(1, "held\\n");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(hold));
db.exec("COMMIT");
db.close();
`;

/** Starts the holder on a fresh file in `journal` mode, and answers the file once it holds the lock. */
const held = Effect.fnUntraced(function* (journal: "wal" | "delete") {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;

  const file = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "t962-lock-" }), "object.sqlite");

  const holder = yield* ChildProcess.make(process.execPath, [
    "--input-type=module",
    "-e",
    HOLDER,
    file,
    journal,
    String(HOLD_MS),
  ]);

  const line = yield* holder.stdout.pipe(Stream.decodeText(), Stream.splitLines, Stream.runHead);
  expect(line._tag === "Some" ? line.value : undefined).toBe("held");

  return { file, done: holder.exitCode };
});

it.effect("T962 scenario: a trigger write from the test's own connection waits for the instance's WAL write lock", () =>
  Effect.gen(function* () {
    const { file, done } = yield* held("wal");
    const db = yield* instanceDatabase(file, { readOnly: false });
    db.exec("CREATE TRIGGER cut BEFORE INSERT ON rows BEGIN SELECT RAISE(FAIL, 'cut'); END");
    // The holder's row is there, so the write ran after its commit: it waited, not failed.
    expect(db.prepare("SELECT count(*) AS n FROM rows").get()).toEqual({ n: 1 });
    expect(yield* done).toBe(0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("T962 scenario: a read-only read waits for a writer that holds the file's exclusive lock before WAL", () =>
  Effect.gen(function* () {
    const { file, done } = yield* held("delete");
    const db = yield* instanceDatabase(file, { readOnly: true });
    expect(db.prepare("SELECT count(*) AS n FROM rows").get()).toEqual({ n: 1 });
    expect(yield* done).toBe(0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
