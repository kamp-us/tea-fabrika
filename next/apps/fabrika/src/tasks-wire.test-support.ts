import { Command } from "@kampus/libfabrika/tasks/Task";
// A14, next/. The fixture seeds the real Project's database through the public Tasks contract.
// Build supplies projectTasksLayer as allowed by Amendment A-Fixture. No administration route.
import { Tasks } from "@kampus/libfabrika/tasks/Tasks";
import { Effect, Schema } from "effect";
import { Project as RealProject } from "./brain.ts";
import { projectTasksLayer } from "./runtime.ts";

export class Project extends RealProject {
  static selected: string;

  constructor(...args: ConstructorParameters<typeof RealProject>) {
    super(...args);
    const target = Schema.decodeUnknownSync(Schema.NonEmptyString)(new.target.selected);
    this.ctx.blockConcurrencyWhile(() =>
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: object startup enters Effect once
      Effect.runPromise(
        Effect.scoped(
          Tasks.use((tasks) =>
            tasks.request(
              {
                id: "wire-task",
                process: "process_01m6v5270hetdrt4r8h9vvjwjs",
                name: "wire:1",
                program: "fabrika/counter",
                command: Command.cases.git_version.make({}),
                needs: ["git"],
                target,
                build: "fixture-build",
                settings: null,
                parent: null,
                traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
              },
              {
                by: "trusted-fixture",
                for: "person_01m6v5270hf3c8x2q7w9z4k5mn",
                sentAt: "2026-11-12T10:00:00.000Z",
                seen: 0,
                parent: null,
                traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                build: "fixture-build",
              },
            ),
          ).pipe(Effect.provide(projectTasksLayer(this.ctx, this.env))),
        ),
      ),
    );
  }
}
