import { NodeServices } from "@effect/platform-node";
// Today's tooling. This fixture runs only fast-check and Vitest's matcher, with no product runtime.
import { it, expect } from "@effect/vitest";
import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { argv, cases } from "./plant-cases.ts";
import { observation } from "./plant.ts";

// Plant: use JSON failureMessages alone, dropping the actual fast-check cause.
it.effect("scenario: a real child is needed to prove the installed reporter preserves fast-check causes", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const root = path.resolve(".");

    const scratch = yield* fs.makeTempDirectoryScoped({
      directory: path.join(root, "node_modules"),
      prefix: ".plant-reporter-",
    });

    const selected = cases["checklist-pid"];
    const suite = "L13: notices name their process";
    const test = path.join(scratch, selected.test);
    yield* fs.makeDirectory(path.dirname(test), { recursive: true });
    const config = path.join(scratch, "vitest.config.ts");
    yield* fs.writeFileString(
      config,
      'export default { test: { include: ["**/*.test.ts"], maxWorkers: 1, fileParallelism: false } };',
    );
    const observations = [];

    for (const phase of ["baseline", "broken", "restored", "wrong"] as const) {
      const report = path.join(scratch, `${phase}.json`);
      const label = phase === "wrong" ? "another assertion" : "a notice names its process";
      yield* fs.writeFileString(
        test,
        `import { describe, test, expect } from "vitest";
import fc from "fast-check";
describe(${JSON.stringify(suite)}, () => { test(${JSON.stringify(selected.title.slice(suite.length + 1))}, async () => {
  expect(process.versions.node).toBe("26.13.0");
  expect(process.env.TYPESAFE_API_KEY).toBeUndefined();
  await fc.assert(fc.asyncProperty(fc.string(), async (pid) => {
    expect(${phase === "broken" || phase === "wrong" ? "undefined" : "pid"}, ${JSON.stringify(label)}).toBe(pid);
  }), { seed: 119120, numRuns: 100 });
}); });
`,
      );

      const handle = yield* spawner.spawn(
        ChildProcess.make(
          "pnpm",
          [
            "exec",
            "vitest",
            "run",
            "--config",
            config,
            "--root",
            scratch,
            "--maxWorkers=1",
            "--fileParallelism=false",
            `--reporter=${path.join(root, ".github/ci/plant-reporter.ts")}`,
            `--outputFile.json=${report}`,
            test,
            "-t",
            argv("checklist-pid", report).at(-1) ?? "(?!)",
          ],
          { cwd: root, stdin: "ignore", env: { PLANT_CASE: "checklist-pid" }, extendEnv: true },
        ),
      );

      const [exit] = yield* Effect.all(
        [handle.exitCode, handle.stdout.pipe(Stream.runDrain), handle.stderr.pipe(Stream.runDrain)],
        { concurrency: "unbounded" },
      );

      const raw = yield* fs.readFileString(report);
      const result = observation("checklist-pid", scratch, raw, Number(exit), 1);
      observations.push(result);
      expect(JSON.stringify(result)).not.toContain(scratch);

      if (phase === "broken") {
        const json = JSON.parse(raw);
        expect(json.testResults[0].assertionResults[0].failureMessages[0]).toContain("Property failed");
        expect(json.testResults[0].assertionResults[0].failureMessages[0]).not.toContain(label);
        expect(result).toMatchObject({
          _tag: "failed",
          diagnostic: "AssertionError: a notice names its process",
          assertion: { line: 7 },
        });
      }
    }

    expect(observations.map((result) => result._tag)).toEqual(["passed", "failed", "passed", "incomplete"]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
