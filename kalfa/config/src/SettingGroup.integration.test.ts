// Ticket 1839, kalfa/config (new work): R1 of the approved plan (.kalfa/quests/kalfa-config-declare-PLAN.md). The laws
// of SettingGroup.test.ts run on the in-memory file system in MemoryFiles.test-support.ts, so this one checks that
// stand-in against a real temp folder through NodeServices: the same three cases must give the same values, origins
// and error on both. It writes to a temp folder, so it is an integration law and runs in main's full run.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit, FileSystem, Path, Schema } from "effect";
import { Setting, SettingGroup } from "./index.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const DEFAULT = 18787;

const group = SettingGroup.make(
  "demo",
  Setting.make("net.port", Port).pipe(Setting.withDefault(DEFAULT), Setting.withDescription("The port.")),
);

interface Given {
  readonly name: string;
  /** The text of each file, or none. */
  readonly repo: string | undefined;
  readonly user: string | undefined;
}

const CASES: ReadonlyArray<Given> = [
  { name: "no files", repo: undefined, user: undefined },
  { name: "a user file with a value on line 2", repo: undefined, user: "[net]\nport = 4100\n" },
  { name: "a repo file with a mistyped key", repo: "[net]\npotr = 4100\n", user: undefined },
];

/** What a start left, as plain data both file systems must agree on. */
const outcome = (exit: Exit.Exit<{ values: Record<string, unknown>; origins: Record<string, unknown> }, unknown>) => {
  if (Exit.isSuccess(exit)) {
    return { started: { values: { ...exit.value.values }, origins: { ...exit.value.origins } } };
  }

  const error = exit.cause.reasons.flatMap((reason) => (reason._tag === "Fail" ? [reason.error] : []))[0];

  return error instanceof SettingGroup.SettingsError
    ? { failed: { reason: error.reason, file: error.file, line: error.line, message: error.message } }
    : { failed: { reason: "not a SettingsError" } };
};

const run = (home: string, repo: string) =>
  Effect.gen(function* () {
    const values = yield* group;
    const origins = yield* SettingGroup.origins(group);

    return { values, origins };
  }).pipe(
    Effect.provide(SettingGroup.layer(group, { version: "1.2.3", repo })),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: home } }))),
    Effect.exit,
    Effect.map(outcome),
  );

// Plant: build the repo path without the `.<app>` folder.
it.effect(
  "R1 scenario: on a real temp folder, three cases give the values, origins and error they give in memory",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const want = [
        { started: { values: { port: DEFAULT }, origins: { "net.port": { _tag: "default" } } } },
        {
          started: {
            values: { port: 4100 },
            origins: { "net.port": { _tag: "file", file: "~/.demo/demo.toml", line: 2 } },
          },
        },
        { failed: { reason: "unknown", file: ".demo/demo.toml", line: 2 } },
      ];

      for (const [n, given] of CASES.entries()) {
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "kalfa-config-" });
        const repo = path.join(root, "repo");
        const home = path.join(root, "home");

        yield* fs.makeDirectory(path.join(repo, ".demo"), { recursive: true });
        yield* fs.makeDirectory(path.join(home, ".demo"), { recursive: true });

        if (given.repo !== undefined) {
          yield* fs.writeFileString(path.join(repo, ".demo", "demo.toml"), given.repo);
        }

        if (given.user !== undefined) {
          yield* fs.writeFileString(path.join(home, ".demo", "demo.toml"), given.user);
        }

        const real = yield* run(home, repo);

        const memory = yield* run("/people/one", "/work").pipe(
          Effect.provide(
            MemoryFiles.layer({
              files: {
                ...(given.repo === undefined ? {} : { "/work/.demo/demo.toml": given.repo }),
                ...(given.user === undefined ? {} : { "/people/one/.demo/demo.toml": given.user }),
              },
            }),
          ),
        );

        expect(real, `${given.name}: the temp folder`).toMatchObject(want[n] ?? {});
        expect(memory, `${given.name}: in memory`).toMatchObject(want[n] ?? {});
        expect(memory, `${given.name}: memory against the disk`).toEqual(real);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
);
