// P39 slice 4b, next/: the brain E2 and S2 run the real hands launcher against
// (`hands-launcher.integration.test.ts`). It is the real Project with three calls only the test's
// own local handle reaches, never a route: ask a `git_version` job of a key, read that job, and read
// every stored row for the secrets scan. The key is the launcher's own, known only once it made it,
// so the job is asked after the grant, not at startup.
import { Command } from "@kampus/libfabrika/jobs/Job";
import { Jobs } from "@kampus/libfabrika/jobs/Jobs";
import { Effect, Schema } from "effect";
import { Project as RealProject } from "./brain.ts";
import { projectJobsLayer } from "./runtime.ts";

/** The one job E2 asks, and the started program that asks it. */
export const JOB = "hands-job";
export const PROCESS = "process_01m6v5270hetdrt4r8h9vvjwjs";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

export class Project extends RealProject {
  /** Asks the hands of `target` for `git --version`, as a started program would. */
  requestHandsJob(target: string) {
    const key = Schema.decodeUnknownSync(Schema.NonEmptyString)(target);
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return Effect.runPromise(
      Effect.scoped(
        Jobs.use((jobs) =>
          jobs.request(
            {
              id: JOB,
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
        ).pipe(Effect.provide(projectJobsLayer(this.ctx, this.env))),
      ),
    );
  }

  /** The job E2 asked, as the brain holds it. */
  readHandsJob() {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return Effect.runPromise(
      Effect.scoped(Jobs.use((jobs) => jobs.read(JOB)).pipe(Effect.provide(projectJobsLayer(this.ctx, this.env)))),
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
