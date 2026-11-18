// Law Q11 of docs/plan/quests/kalfa-quality-stryker-PLAN.md: real Stryker 10.1.1 answers a plant. It starts
// Stryker's own processes in a temp folder, so no stand-in can show the form of the report it writes,
// which the answer (Q4) and its vector (Q5) rest on. It runs on disposable CI or a cloud box
// (decision 0594), never on a person's laptop.
//
// scenario: one fixture project (Fixture.test-support.ts), two plants and one survey, because each
// run starts Stryker and its test runner; a generated input would repeat that cost to show no more.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Path } from "effect";
import { FILES, KILLS, PRODUCT, SPARES, TARGET, TESTS } from "../Fixture.test-support.ts";
import { plant } from "../Plant.ts";
import * as Run from "../Run.ts";
import * as MutantsStryker from "./MutantsStryker.ts";

// This package's own node_modules, from this file's folder: the fixture links it, so vitest and Stryker's runner resolve.
const MODULES = "../../../node_modules";

const settings = (path: Path.Path, root: string) => ({
  catalog: path.join(root, "plants.ts"),
  concurrency: 1,
  timeout: 60_000,
  inPlace: false,
  ignore: [],
  vitest: Option.none<string>(),
  nice: 0,
});

const named = (name: string, law: { file: string; name: string }) =>
  plant({
    name,
    file: PRODUCT,
    mutator: TARGET.mutator,
    original: TARGET.original,
    replacement: TARGET.replacement,
    law,
  });

// Plant: read only the first entry of `killedBy` with bail on, so the second law's plant answers killed.
it.live(
  "scenario: Q11 a plant answers killed for the law that fails and elsewhere for the law that does not, and a survey lists the mutants",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "quality-" }));

      for (const [file, text] of Object.entries(FILES)) {
        yield* fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true });
        yield* fs.writeFileString(path.join(root, file), text);
      }

      yield* fs.symlink(path.join(import.meta.dirname, MODULES), path.join(root, "node_modules"));

      const catalog = [named("kills", KILLS), named("spares", SPARES)];
      const real = MutantsStryker.layer({ root, nice: 0 });
      const run = (name: string) =>
        Run.plant({ catalog, name, settings: settings(path, root), root }).pipe(Effect.scoped, Effect.provide(real));

      const killed = yield* run("kills");
      expect(killed.answer).toEqual({ _tag: "killed", by: [KILLS] });

      const elsewhere = yield* run("spares");
      expect(elsewhere.answer).toEqual({ _tag: "elsewhere", by: [KILLS] });

      // The whole line is the range, so Stryker lists its other nodes too (the strings, the arrow); the
      // four mutants of `n > 0` are among them, each with its status and its killers read from the report.
      const rows = yield* Run.survey({
        file: PRODUCT,
        law: TESTS,
        from: 1,
        to: 1,
        settings: settings(path, root),
        root,
      }).pipe(Effect.scoped, Effect.provide(real));

      expect(rows.every(({ line }) => line === 1)).toBe(true);
      expect(rows.length).toBeGreaterThan(4);
      expect(rows.map(({ mutator, replacement, status, by }) => ({ mutator, replacement, status, by }))).toEqual(
        expect.arrayContaining([
          { mutator: "ConditionalExpression", replacement: "true", status: "Killed", by: [KILLS] },
          { mutator: "ConditionalExpression", replacement: "false", status: "Survived", by: [] },
          { mutator: "EqualityOperator", replacement: "n >= 0", status: "Survived", by: [] },
          { mutator: "EqualityOperator", replacement: "n <= 0", status: "Killed", by: [KILLS] },
        ]),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);
