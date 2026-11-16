// T878, next/, L8 against real git: refusal, consent and retries never run a command the clone's
// git config names (hooks, fsmonitor, ssh command, upload-pack). Only real git can show that git
// itself leaves them alone, so this law drives git, temp folders and a spawned process, and runs on
// the schedule (0536). OpenRepository.composed.integration.test.ts keeps L3, L9 and the injected L8,
// which hold the repository-code tripwires. The arbitraries below are that file's own.
import { DatabaseSync } from "node:sqlite"; // edge: synchronous transactions are the ledger's driver contract
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import type { Schema } from "effect";
import { Arbitrary, Effect, Exit, FileSystem, Layer, Path } from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as fc from "fast-check";
import * as Id from "../../Id.ts";
import { Doorbell } from "../../ledger/Ledger.ts";
import * as LedgerSql from "../../ledger/LedgerSql.ts";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import * as RepositoryTrustLedger from "../../packs/RepositoryTrustLedger.ts";
import * as RepositoryOpenTest from "../settings/RepositoryOpenTest.ts";
import * as OpenRepository from "./OpenRepository.ts";
import * as RepositoriesGit from "./RepositoriesGit.ts";

const services = Layer.mergeAll(NodeServices.layer, RepositoryOpenTest.toml, Digest.layerWebCrypto);

const generated = <S extends Schema.Top>(schema: S): fc.Arbitrary<S["Type"]> =>
  fc.nat().map((seed) => Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(schema), { seed, count: 1 }))[0]!);

const ids = generated(Id.InputId);

const people = generated(Id.make("person"));

const document = ".fabrika/fabrika.toml";

const personName = "~/.fabrika/fabrika.toml";

const cell = fc.record({ move: fc.nat(), pick: fc.nat() });

const tape = fc.array(cell, { minLength: 1, maxLength: 8 });

const git = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
  return (yield* (yield* ChildProcessSpawner.ChildProcessSpawner).string(
    ChildProcess.make("git", [...args], {
      cwd,
      extendEnv: true,
      env: {
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
    }),
  )).trim();
});

// The 200 real-Git fixtures exceed 60 seconds under load. Allow 15 minutes,
// using the lead's 695-second L7 measurement as the floor, and retain all 200 runs.
it("L8: refusal, consent and retries never evaluate, bundle or start repository code or Git-configured commands", async () => {
  await fc.assert(
    fc.asyncProperty(tape, ids, ids, people, async (cells, selection, request, actor) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem,
              path = yield* Path.Path;

            const root = yield* fs.makeTempDirectoryScoped({ prefix: "t878-code-" });
            yield* RepositoryOpenTest.isolateGit(root);

            const origin = path.join(root, "origin.git"),
              repo = path.join(root, "repo"),
              person = path.join(root, "person");

            const marker = path.join(root, "executed");
            yield* fs.makeDirectory(person);
            yield* git(root, ["init", "--bare", "--initial-branch=stable", origin]);
            yield* git(root, ["clone", origin, repo]);
            yield* fs.makeDirectory(path.join(repo, ".fabrika/packs/trap"), { recursive: true });
            yield* fs.writeFileString(path.join(repo, document), 'fabrika-version = "0.0.0"\n');
            const tripwire = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); throw new Error('outside code ran');`;

            for (const file of ["settings.mjs", ".fabrika/packs/trap/index.mjs", ".fabrika/packs/trap/program.mjs"]) {
              yield* fs.writeFileString(path.join(repo, file), tripwire);
            }

            yield* fs.writeFileString(
              path.join(repo, "package.json"),
              JSON.stringify({ type: "module", scripts: { build: "node settings.mjs", start: "node settings.mjs" } }),
            );
            yield* git(repo, ["add", "."]);
            yield* git(repo, ["commit", "-m", "fixture"]);
            yield* git(repo, ["push", "origin", "stable"]);
            const trap = path.join(root, "git-trap");
            yield* fs.writeFileString(trap, `#!${process.execPath}\n${tripwire}\n`);
            yield* fs.chmod(trap, 0o700);
            const hooks = path.join(root, "hooks");
            yield* fs.makeDirectory(hooks);
            yield* fs.writeFileString(
              path.join(hooks, "reference-transaction"),
              `#!${process.execPath}\n${tripwire}\n`,
            );
            yield* fs.chmod(path.join(hooks, "reference-transaction"), 0o700);
            yield* git(repo, ["config", "core.hooksPath", hooks]);
            yield* git(repo, ["config", "core.fsmonitor", trap]);
            yield* git(repo, ["config", "core.sshCommand", trap]);
            yield* git(repo, ["config", "remote.origin.uploadpack", trap]);
            yield* git(repo, ["config", "maintenance.auto", "true"]);

            const db = yield* Effect.acquireRelease(
              Effect.sync(() => new DatabaseSync(":memory:")),
              (value) => Effect.sync(() => value.close()),
            );

            const trust = RepositoryTrustLedger.layer.pipe(
              Layer.provide(LedgerSql.layer(nodeSql(db), { reader: "brain" })),
              Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
            );

            for (const c of cells) {
              const prepared = yield* OpenRepository.prepare(repo, {
                person: { path: path.join(person, "fabrika.toml"), name: personName },
                flags: {},
                env: {},
                version: "0.0.0",
              }).pipe(Effect.provide(RepositoriesGit.layer({ person })));

              const result = yield* OpenRepository.open(prepared, {
                selection,
                request,
                actor,
                by: "brain",
                build: "fixture",
                interactive: c.move % 3 !== 0,
                confirm: () => Effect.succeed(c.move % 2 === 0),
              }).pipe(Effect.provide(trust), Effect.exit);

              expect(Exit.isSuccess(result)).toBe(true);
              expect(yield* fs.exists(marker)).toBe(false);
            }
          }),
        ).pipe(Effect.provide(services)),
      );
    }),
    { seed: 119120, numRuns: runsFor({ fast: 20, full: 200 }) },
  );
}, 900_000);
