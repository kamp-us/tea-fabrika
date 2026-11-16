// P12, next/. The real recorder must use the supplied platform services, including errors.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { runsFor } from "@kampus/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { Written } from "../../telemetry/Records.ts";
import { devRecording } from "./dev-recording.ts";

for (const failed of [false, true]) {
  it(`recording creates its directory and database path through supplied FileSystem and Path: ${failed ? "refusal" : "success"}`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (child) => {
        const home = mkdtempSync(join(tmpdir(), "p12-rec-")),
          folder = join(home, child);
        const directories: Array<unknown> = [],
          paths: Array<ReadonlyArray<string>> = [];
        const realPath = Effect.runSync(Path.Path.pipe(Effect.provide(Path.layer)));
        const fs = FileSystem.layerNoop({
          makeDirectory: (path, options) =>
            Effect.suspend(() => {
              directories.push([path, options]);
              return failed
                ? Effect.fail(
                    PlatformError.systemError({
                      module: "FileSystem",
                      method: "makeDirectory",
                      _tag: "PermissionDenied",
                      pathOrDescriptor: path,
                    }),
                  )
                : Effect.sync(() => {
                    mkdirSync(path, options);
                  });
            }),
        });
        const platform = Layer.merge(
          fs,
          Layer.succeed(Path.Path, {
            ...realPath,
            join: (...parts) => {
              paths.push(parts);
              return realPath.join(...parts);
            },
          }),
        );

        try {
          const exit = await Effect.runPromiseExit(
            Effect.scoped(
              devRecording(folder, "brain:test", () => Effect.succeed(Written.cases.written.make({}))),
            ).pipe(Effect.provide(platform), Effect.provide(NodeServices.layer)),
          );
          expect(directories).toEqual([[folder, { recursive: true }]]);
          expect(Exit.isFailure(exit)).toBe(failed);
          const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
          expect(Cause.hasDies(cause)).toBe(false);
          expect(Cause.hasFails(cause)).toBe(failed);

          if (!failed) {
            expect(paths).toContainEqual([folder, "brain.records.sqlite"]);
          }
        } finally {
          rmSync(home, { recursive: true, force: true });
        }
      }),
      { seed: 119120, numRuns: runsFor({ fast: 3, full: 10 }) },
    );
  });
}
