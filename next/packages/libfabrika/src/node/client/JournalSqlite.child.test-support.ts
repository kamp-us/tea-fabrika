// P39 slice 4b, next/: the child J2 kills (`JournalSqlite.integration.test.ts`). Run as
// `node JournalSqlite.child.test-support.ts <file>`, it opens the journal file and writes whole
// entries in a loop, round the same sixteen jobs, each entry large enough that a write in place could
// be cut halfway. It prints `ready` once its first entry is saved, then writes until it is killed.
import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Entry, Journal } from "../../client/Journal.ts";
import * as JournalStore from "../../client/JournalStore.ts";
import { Result } from "../../jobs/Job.ts";
import * as JournalSqlite from "./JournalSqlite.ts";

/** The jobs the child writes, and the law reads back. */
const JOBS = Array.from({ length: 16 }, (_, i) => `P/${i}/0`);

const file = process.argv[2] ?? "";

const loop = Effect.gen(function* () {
  const journal = yield* Journal;

  for (let n = 0; ; n++) {
    const job = JOBS[n % JOBS.length] ?? "P/0/0";
    // About 64 KiB a value, so a write is many pages and a kill can land inside one.
    const version = `${n}:`.padEnd(64 * 1024, String.fromCharCode(97 + (n % 26)));
    yield* journal.write(
      job,
      Entry.cases.result.make({
        execution: `execution-${n}`,
        result: Result.cases.exited.make({ code: 0, version }),
        at: `2026-11-15T10:00:00.${String(n % 1000).padStart(3, "0")}Z`,
      }),
    );

    if (n === 0) {
      process.stdout.write("ready\n");
    }
  }
});

NodeRuntime.runMain(loop.pipe(Effect.provide(JournalStore.layer.pipe(Layer.provide(JournalSqlite.layer({ file }))))));
