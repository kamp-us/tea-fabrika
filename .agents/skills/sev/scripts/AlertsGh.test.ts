// Today's lead tooling. How AlertsGh reads `gh issue list --json`; nothing here starts gh. The rows
// carry the two titles the checks write (`.github/ci/scheduled.mjs`, `lead/scripts/ci/Speed.ts`).
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import * as AlertsGh from "./AlertsGh.ts";

const listed = JSON.stringify([
  { number: 1301, title: "CI speed: a stage is over its goal", createdAt: "2026-11-14T20:00:00Z" },
  { number: 1300, title: "Scheduled CI is red on main", createdAt: "2026-11-14T18:00:00Z" },
]);

describe("alertsIn", () => {
  it.effect("format: it reads gh's rows as alerts, oldest first", () =>
    Effect.gen(function* () {
      expect(yield* AlertsGh.alertsIn(listed)).toEqual([
        { number: 1300, title: "Scheduled CI is red on main", since: "2026-11-14T18:00:00Z" },
        { number: 1301, title: "CI speed: a stage is over its goal", since: "2026-11-14T20:00:00Z" },
      ]);
    }),
  );

  it.effect("format: it reads an empty answer as no open issue", () =>
    Effect.gen(function* () {
      expect(yield* AlertsGh.alertsIn("\n")).toEqual([]);
    }),
  );

  it.effect("format: it fails on a shape it does not read", () =>
    Effect.gen(function* () {
      expect((yield* Effect.flip(AlertsGh.alertsIn('[{"number":"one"}]')))._tag).toBe("SchemaError");
    }),
  );
});

describe("LABEL", () => {
  it.effect("pinned: it is the label both checks write on their issue, read from their own source", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.resolve(import.meta.dirname, "..", "..", "..", "..");
      const scheduled = yield* fs.readFileString(path.join(root, ".github", "ci", "scheduled.mjs"));
      const speed = yield* fs.readFileString(path.join(root, ".agents", "skills", "lead", "scripts", "ci", "Speed.ts"));
      expect(scheduled).toContain(`export const LABEL = "${AlertsGh.LABEL}";`);
      expect(speed).toContain(`export const LABEL_NAME = "${AlertsGh.LABEL}";`);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
