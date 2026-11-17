import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, FileSystem, Option, Path, Schema, Stream } from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { expect, it } from "vitest";
import { Request } from "./plant-cases.ts";
import { execute, ExerciseError } from "./plant.ts";

// These are real Git histories and source files. Every refusal must happen before a test phase.
it.each([
  { fault: "nonancestor", reason: "git_io" },
  { fault: "different lock", reason: "source_versions_unsupported" },
  { fault: "dirty tree", reason: "source_dirty_or_wrong_head" },
])("scenario: automatic binding refuses $fault before any test phase", async ({ fault, reason }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "plant-binding-" });
      const root = path.join(temporary, "source");
      const target = path.join(root, "next/packages/libfabrika/src/cloudflare/runtime.ts");

      const git = Effect.fn("binding.test.git")(function* (args: readonly string[]) {
        const child = yield* spawner.spawn(ChildProcess.make("git", args, { cwd: root, stdin: "ignore" }));
        const [exit, stdout] = yield* Effect.all(
          [child.exitCode, child.stdout.pipe(Stream.decodeText(), Stream.mkString), child.stderr.pipe(Stream.runDrain)],
          { concurrency: "unbounded" },
        );

        expect(Number(exit)).toBe(0);
        return stdout.trim();
      }, Effect.scoped);

      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      yield* fs.writeFileString(target, "p.publish(client, { ...update, pid: active })\n");
      yield* fs.writeFileString(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "binding-fixture",
          private: true,
          packageManager: "pnpm@12.16.1",
          engines: { node: "26.13.0" },
        }),
      );
      yield* fs.writeFileString(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      yield* fs.writeFileString(path.join(root, "pnpm-workspace.yaml"), "catalog:\n  vitest: 5.0.5\n");
      yield* git(["init", "-q"]);
      yield* git(["config", "user.name", "binding-test"]);
      yield* git(["config", "user.email", "binding@example.invalid"]);
      yield* git(["add", "."]);
      yield* git(["commit", "-q", "-m", "catalog"]);
      const catalog = yield* git(["rev-parse", "HEAD"]);

      if (fault === "nonancestor") {
        yield* git(["checkout", "--orphan", "unrelated"]);
        yield* git(["add", "."]);
        yield* git(["commit", "-q", "-m", "unrelated"]);
      } else {
        if (fault === "different lock") {
          yield* fs.writeFileString(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nchanged: true\n");
          yield* git(["add", "pnpm-lock.yaml"]);
        }

        yield* git(["commit", "-q", "--allow-empty", "-m", "tested"]);
      }

      const head = yield* git(["rev-parse", "HEAD"]);

      if (fault === "dirty tree") {
        yield* fs.writeFileString(path.join(root, "extra.txt"), "untracked\n");
      }

      const before = yield* fs.readFileString(target);
      const result = yield* execute(
        {
          PATH: process.env["PATH"] ?? "",
          HOME: process.env["HOME"] ?? root,
          RUNNER_TEMP: temporary,
          GITHUB_RUN_ID: "1",
          GITHUB_RUN_ATTEMPT: "1",
        },
        Request.make({ case: "checklist-pid", sha: catalog }),
        {
          runner: root,
          source: root,
          runnerHead: head,
          head,
          install: false,
        },
      ).pipe(Effect.exit);

      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result)) {
        const error = Cause.findErrorOption(result.cause);
        expect(Option.isSome(error) && Schema.is(ExerciseError)(error.value) ? error.value.reason : null).toBe(reason);
      }

      expect(yield* fs.readFileString(target)).toBe(before);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.provide(Digest.layerWebCrypto)),
  );
});
