// P39 slice 4b, next/: the brain E2 and S2 run the real hands launcher against
// (`hands-launcher.integration.test.ts`). It is the real Project with three calls only the test's
// own local handle reaches, never a route: ask a `git_version` task of a key, read that task, and read
// every stored row for the secrets scan. The key is the launcher's own, known only once it made it,
// so the task is asked after the grant, not at startup.
import { Command } from "@kampus/libfabrika/tasks/Task";
import { Tasks } from "@kampus/libfabrika/tasks/Tasks";
import { Effect, Schema } from "effect";
import { Project as RealProject } from "./brain.ts";
import { projectTasksLayer } from "./runtime.ts";

/**
 * The one task E2 asks, and the started program that asks it. This file loads only in workerd, so
 * the Node test names the same two values itself and imports only this file's type.
 */
const TASK = "hands-task";
const PROCESS = "process_01m6v5270hetdrt4r8h9vvjwjs";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

export class Project extends RealProject {
  /** Asks the hands of `target` for `git --version`, as a started program would. */
  requestHandsTask(target: string) {
    const key = Schema.decodeUnknownSync(Schema.NonEmptyString)(target);
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return Effect.runPromise(
      Effect.scoped(
        Tasks.use((tasks) =>
          tasks.request(
            {
              id: TASK,
              process: PROCESS,
              name: "wire:1",
              program: "fabrika/counter",
              command: Command.cases.git_version.make({}),
              needs: ["git"],
              target: key,
              build: "fixture-build",
              settings: null,
              parent: null,
              traceId: TRACE,
            },
            {
              by: "trusted-fixture",
              for: PERSON,
              sentAt: "2026-11-15T10:00:00.000Z",
              seen: 0,
              parent: null,
              traceId: TRACE,
              build: "fixture-build",
            },
          ),
        ).pipe(Effect.provide(projectTasksLayer(this.ctx, this.env))),
      ),
    );
  }

  /** The task E2 asked, as the brain holds it. */
  readHandsTask() {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return Effect.runPromise(
      Effect.scoped(Tasks.use((tasks) => tasks.read(TASK)).pipe(Effect.provide(projectTasksLayer(this.ctx, this.env)))),
    );
  }

  /** Every stored row of every table, for S2's scan. */
  allRows() {
    const sql = this.ctx.storage.sql;
    const tables = sql
      .exec("SELECT name FROM sqlite_master WHERE type='table'")
      .toArray()
      .map((row) => String(row["name"]));
    return Object.fromEntries(
      tables.map((table) => [table, sql.exec(`SELECT * FROM "${table.replace(/"/g, '""')}"`).toArray()]),
    );
  }
}
