// P16, next/. Vitest transpiles TypeScript; the app's real command must also work in plain Node.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Path, Stream } from "effect";
import { ChildProcess } from "effect/process";

// The test's scope removes the folder when the test ends (0061).
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const app = path.resolve(import.meta.dirname, "..");
  const home = yield* fs.makeTempDirectoryScoped({ directory: "/tmp", prefix: "fh." });

  for (const file of ["package.json", "build.ts"]) {
    yield* fs.copyFile(path.join(app, file), path.join(home, file));
  }

  for (const dir of ["src", "node_modules"]) {
    yield* fs.symlink(path.join(app, dir), path.join(home, dir));
  }

  return home;
});

/** `node build.ts` in `home`, run to its exit: its exit code and what it wrote to stderr. */
const command = Effect.fnUntraced(function* (home: string) {
  const env: Record<string, string | undefined> = { ...process.env, FABRIKA_HOME: home };
  delete env.FABRIKA_FOREGROUND;
  delete env.TYPESAFE_API_KEY;
  delete env.NODE_OPTIONS;

  const child = yield* ChildProcess.make(process.execPath, ["build.ts"], {
    cwd: home,
    env,
    extendEnv: false,
    stdin: "ignore",
  });

  const [stderr, , status] = yield* Effect.all(
    [Stream.mkString(Stream.decodeText(child.stderr)), Stream.runDrain(child.stdout), child.exitCode],
    { concurrency: "unbounded" },
  );

  return { status, stderr };
}, Effect.scoped);

const verify = Effect.fnUntraced(function* (home: string, result: Effect.Success<ReturnType<typeof command>>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  expect(result.status, result.stderr).toBe(0);
  expect((yield* fs.readFileString(path.join(home, "dist/brain.mjs"))).length).toBeGreaterThan(0);
});

describe("P16 app build command", () => {
  it.live("scenario: node build.ts exits zero and writes brain.mjs in a fresh folder", () =>
    Effect.gen(function* () {
      const home = yield* fixture;
      yield* verify(home, yield* command(home));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.live("scenario: plant a parameter property in the real command and reject Node's import failure", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fixture,
        file = path.join(home, "build.ts");

      yield* fs.writeFileString(
        file,
        `class Options { constructor(readonly out: string) {} }\n${yield* fs.readFileString(file)}`,
      );
      const result = yield* command(home);
      expect(result.stderr).toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
      expect(result.stderr).toContain("TypeScript parameter property");
      expect(result.stderr).toContain("class Options { constructor(readonly out: string) {} }");
      expect(Exit.isFailure(yield* Effect.exit(verify(home, result)))).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
