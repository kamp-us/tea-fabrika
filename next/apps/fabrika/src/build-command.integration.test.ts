// P16, next/. Vitest transpiles TypeScript; the app's real command must also work in plain Node.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect } from "@effect/vitest";
import { it } from "@kampus/vitest";
import { Effect } from "effect";

const APP = resolve(import.meta.dirname, "..");

// The test's scope removes the folder when the test ends (0061).
const fixture = Effect.acquireRelease(
  Effect.sync(() => {
    const home = mkdtempSync("/tmp/fh.");

    for (const file of ["package.json", "build.ts"]) {
      copyFileSync(join(APP, file), join(home, file));
    }

    for (const dir of ["src", "node_modules"]) {
      symlinkSync(join(APP, dir), join(home, dir), "dir");
    }

    return home;
  }),
  (home) => Effect.sync(() => rmSync(home, { recursive: true, force: true })),
);

const command = (home: string) =>
  spawnSync(process.execPath, ["build.ts"], {
    cwd: home,
    encoding: "utf8",
    env: {
      ...process.env,
      FABRIKA_HOME: home,
      FABRIKA_FOREGROUND: undefined,
      TYPESAFE_API_KEY: undefined,
      NODE_OPTIONS: undefined,
    },
  });

const verify = (home: string, result: ReturnType<typeof command>) => {
  expect(result.error, "Node must start").toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(join(home, "dist/brain.mjs"), "utf8").length).toBeGreaterThan(0);
};

// What `node build.ts` reads as files, which no import of this test reaches: the command itself and
// the sources its bundle takes. The app's package.json is a rerun trigger, so it is not declared.
describe("P16 app build command", () => {
  it.live(
    "node build.ts exits zero and writes brain.mjs in a fresh folder",
    () =>
      Effect.gen(function* () {
        const home = yield* fixture;
        verify(home, command(home));
      }),
    {
      scenario: "one fresh folder holding the real command",
      reads: [
        "next/apps/fabrika/build.ts",
        "next/apps/fabrika/src/**",
        "next/programs/*/src/**",
        "next/packages/libfabrika/src/**",
        "next/packages/tuval/src/**",
      ],
    },
  );
  it.live(
    "plant a parameter property in the real command and reject Node's import failure",
    () =>
      Effect.gen(function* () {
        const home = yield* fixture,
          file = join(home, "build.ts");
        writeFileSync(file, `class Options { constructor(readonly out: string) {} }\n${readFileSync(file, "utf8")}`);
        const result = command(home);
        expect(result.stderr).toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
        expect(result.stderr).toContain("TypeScript parameter property");
        expect(result.stderr).toContain("class Options { constructor(readonly out: string) {} }");
        expect(() => verify(home, result)).toThrow();
      }),
    {
      scenario: "one syntax Node refuses, planted in a copy of the real command",
      reads: ["next/apps/fabrika/build.ts"],
    },
  );
});
