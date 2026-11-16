// P39 slice 4b, next/: the brain E2 and S2 run the real hands launcher against
// (`hands-launcher.integration.test.ts`). It is the real Project with three calls only the test's
// own local handle reaches, never a route: ask a `git_version` task of a key, read that task, and read
// every stored row for the secrets scan. The key is the launcher's own, known only once it made it,
// so the task is asked after the grant, not at startup.
//
// The control door calls a closed list of the Project's methods and answers any other name
// `unknown_method`, so the three calls come in beside it: this file's `Control` takes a control
// request that names one of them, checks the same token, and hands it to this Project's `fetch`.
// Every other request goes to the real `Control` untouched. The product's list gains nothing.
import { Command } from "@kampus/libfabrika/tasks/Task";
import { Tasks } from "@kampus/libfabrika/tasks/Tasks";
import { Array as Arr, Cause, Effect, Option, Schema } from "effect";
import { Control as RealControl, Project as RealProject } from "./brain.ts";
import { projectTasksLayer } from "./runtime.ts";

/**
 * The one task E2 asks, and the started program that asks it. This file loads only in workerd, so
 * the Node test names the same two values itself and imports only this file's type.
 */
const TASK = "hands-task";
const PROCESS = "process_01m6v5270hetdrt4r8h9vvjwjs";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

/** One of the three calls, as this file's `Control` hands it to this file's Project. */
const Call = Schema.Struct({
  method: Schema.Literals(["requestHandsTask", "readHandsTask", "allRows"]),
  args: Schema.Array(Schema.Unknown),
});

/** A control request for one of the three calls, as the test's local handle sends it. */
const ControlCall = Schema.fromJsonString(
  Schema.Struct({ target: Schema.Literal("project"), project: Schema.String, ...Call.fields }),
);

const hex = (bytes: Uint8Array) =>
  Arr.join(
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")),
    "",
  );

export class Project extends RealProject {
  /** Asks the hands of `target` for `git --version`, as a started program would. */
  requestHandsTask(target: string) {
    return Effect.scoped(
      Tasks.use((tasks) =>
        tasks.request(
          {
            id: TASK,
            process: PROCESS,
            name: "wire:1",
            program: "fabrika/counter",
            command: Command.cases.git_version.make({}),
            needs: ["git"],
            target,
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
    );
  }

  /** The task E2 asked, as the brain holds it. */
  readHandsTask() {
    return Effect.scoped(
      Tasks.use((tasks) => tasks.read(TASK)).pipe(Effect.provide(projectTasksLayer(this.ctx, this.env))),
    );
  }

  /**
   * Every stored row of every table, for S2's scan. A blob is given as its hex and its text, since
   * the answer travels as JSON, where raw bytes would arrive empty and hide what they hold.
   */
  allRows() {
    const sql = this.ctx.storage.sql;
    const tables = Arr.map(sql.exec("SELECT name FROM sqlite_master WHERE type='table'").toArray(), (row) =>
      String(row["name"]),
    );
    return Object.fromEntries(
      Arr.map(tables, (table) => [
        table,
        Arr.map(sql.exec(`SELECT * FROM "${table.replace(/"/g, '""')}"`).toArray(), (row) =>
          Object.fromEntries(
            Arr.map(Object.entries(row), ([column, value]) => [
              column,
              value instanceof ArrayBuffer
                ? { hex: hex(new Uint8Array(value)), text: new TextDecoder().decode(value) }
                : value,
            ]),
          ),
        ),
      ]),
    );
  }

  /** Answers one of the three calls in the control door's own shape: `{ value }`, or `{ error }`. */
  fetch(request: Request) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: a Durable Object fetch returns a Promise
    return Effect.runPromise(
      // oxlint-disable-next-line fabrika/no-promises -- edge: a Request body returns a Promise
      Effect.tryPromise(() => request.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Call)),
        Effect.flatMap((call): Effect.Effect<unknown, unknown> =>
          call.method === "requestHandsTask"
            ? Schema.decodeUnknownEffect(Schema.NonEmptyString)(call.args[0]).pipe(
                Effect.flatMap((target) => this.requestHandsTask(target)),
                Effect.asVoid,
              )
            : call.method === "readHandsTask"
              ? this.readHandsTask()
              : Effect.sync(() => this.allRows()),
        ),
        Effect.map((value) => Response.json({ value: value ?? null })),
        // The whole cause is the reason, so a red run says why the brain refused.
        Effect.catchCause((cause) =>
          Effect.succeed(Response.json({ error: { reason: `fixture: ${Cause.pretty(cause)}` } }, { status: 500 })),
        ),
      ),
    );
  }
}

export class Control extends RealControl {
  override fetch(request: Request) {
    const real = () => super.fetch(request);
    const body = request.clone();
    const granted = request.headers.get("authorization") === `Bearer ${this.ctx.props.token}`;
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the private local control socket returns a Promise
    return Effect.runPromise(
      // oxlint-disable-next-line fabrika/no-promises -- edge: a Request body returns a Promise
      Effect.tryPromise(() => body.text()).pipe(
        Effect.map(Schema.decodeUnknownOption(ControlCall)),
        Effect.flatMap(
          Option.match({
            // Not one of the three: the real control door answers it, token check and all.
            // oxlint-disable-next-line fabrika/no-promises -- edge: the real control entrypoint returns a Promise
            onNone: () => Effect.tryPromise(real),
            onSome: (call) =>
              granted
                ? // oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object stub's fetch returns a Promise
                  Effect.tryPromise(() =>
                    this.env.PROJECT.getByName(call.project).fetch("http://project/", {
                      method: "POST",
                      body: JSON.stringify({ method: call.method, args: call.args }),
                    }),
                  )
                : Effect.succeed(new Response(null, { status: 403 })),
          }),
        ),
      ),
    );
  }
}
