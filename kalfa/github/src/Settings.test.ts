// The settings of `@kalfa/github/Settings`: S1, what each setting is and which values it takes, and S2, the start of a group that holds
// them, through `@kalfa/config`'s own `SettingGroup.layer` on files and an environment held in memory. Nothing reads a disk.
import { assert, describe, expect, it } from "@effect/vitest";
import { SettingGroup } from "@kalfa/config";
import { Arbitrary, Cause, ConfigProvider, Effect, Exit, FileSystem, Layer, Option, Path, Schema } from "effect";
import { between, SEED, word } from "./GitHub.test-support.ts";
import { addresses, badAddresses, goodAddresses, pick, showsAny } from "./GitHubLive.test-support.ts";
import * as GitHubSettings from "./Settings.ts";

/** The text a schema's refusal shows, whole. */
const refusal = (exit: Exit.Exit<unknown, unknown>): string => (Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "");

const decode = <A, I>(schema: Schema.Codec<A, I>, input: string | number) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(Effect.exit);

const drawn1 = Arbitrary.all({
  address: addresses,
  marker: word,
  amount: between(1, 100000),
  unit: pick(["millis", "seconds", "minutes", "hours"]),
  redirects: between(0, 20),
  beyond: between(21, 1000),
});

// S1. Plant: check only that the text parses as a URL (m's `http:` passes); forget the user check (m's user case passes); put the text into the
// message (m's marker shows); leave the description out; default the address to another text.
describe("S1, the settings", () => {
  it.effect.prop(
    "api-url is github.api-url, defaults to GitHub's address, has a description, takes the good addresses and refuses each bad one with a message that holds no part of the text; poll-interval and redirects are named, default, and take and refuse what they should",
    { drawn: drawn1 },
    ({ drawn }) =>
      Effect.gen(function* () {
        const { apiUrl, pollInterval, redirects } = GitHubSettings;

        // A marker no message of ours could hold by chance, whatever word was drawn.
        const marker = `qz9${drawn.marker.replace(/[^A-Za-z0-9]/gu, "")}`;

        expect(apiUrl.name).toBe("github.api-url");
        expect(Option.getOrUndefined(apiUrl.default)).toBe("https://api.github.com");
        expect(apiUrl.description?.length ?? 0, "a description").toBeGreaterThan(0);

        for (const each of goodAddresses(drawn.address.host, drawn.address.port)) {
          const exit = yield* decode(apiUrl.schema, each.value);

          expect(Exit.isSuccess(exit), `${each.name}: ${each.value}`).toBe(true);
        }

        for (const each of badAddresses(drawn.address.host, marker)) {
          const exit = yield* decode(apiUrl.schema, each.value);

          expect(Exit.isFailure(exit), `${each.name}: refused`).toBe(true);
          expect(
            showsAny([refusal(exit)], [marker, each.value]),
            `${each.name}: the message holds no part of the text`,
          ).toEqual([]);
        }

        expect(pollInterval.name).toBe("github.poll-interval");
        expect(Option.getOrUndefined(pollInterval.default)).toBe("30 seconds");
        expect(pollInterval.description?.length ?? 0, "a description").toBeGreaterThan(0);

        const length = `${drawn.amount} ${drawn.unit}`;

        expect(Exit.isSuccess(yield* decode(pollInterval.schema, length)), length).toBe(true);

        for (const bad of ["ten", marker, "", `${drawn.amount} parsecs`]) {
          const exit = yield* decode(pollInterval.schema, bad);

          expect(Exit.isFailure(exit), `refuses ${bad}`).toBe(true);
          expect(showsAny([refusal(exit)], [marker]), "the message holds no part of the text").toEqual([]);
        }

        expect(redirects.name).toBe("github.redirects");
        expect(Option.getOrUndefined(redirects.default)).toBe(20);
        expect(redirects.description?.length ?? 0, "a description").toBeGreaterThan(0);

        for (const good of [0, 20, drawn.redirects]) {
          expect(Exit.isSuccess(yield* decode(redirects.schema, good)), `takes ${good}`).toBe(true);
        }

        for (const bad of [-1, 21, drawn.beyond, drawn.redirects + 0.5, "20", Number.NaN]) {
          expect(Exit.isFailure(yield* decode(redirects.schema, bad)), `refuses ${String(bad)}`).toBe(true);
        }
      }),
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

const ROOT = "/work";

const group = SettingGroup.make("demo", ...GitHubSettings.all);

/** The group's start on files and an environment held in memory. */
const started = (files: Readonly<Record<string, string>>, env: Readonly<Record<string, string>>) => {
  const text = (path: string) => files[path];

  const disk = FileSystem.makeNoop({
    exists: (path) => Effect.succeed(text(path) !== undefined),
    readFileString: (path) => {
      const found = text(path);

      return found === undefined ? FileSystem.makeNoop({}).readFileString(path) : Effect.succeed(found);
    },
    readFile: (path) => {
      const found = text(path);

      return found === undefined
        ? FileSystem.makeNoop({}).readFile(path)
        : Effect.succeed(new TextEncoder().encode(found));
    },
  });

  return group.pipe(
    Effect.provide(SettingGroup.layer(group, { version: "1.0.0", repo: ROOT })),
    Effect.provide(Layer.merge(Layer.succeed(FileSystem.FileSystem)(disk), Path.layer)),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...env } }))),
    Effect.exit,
  );
};

const REPO_FILE = `${ROOT}/.demo/demo.toml`;

const drawn2 = Arbitrary.all({
  address: addresses,
  pad: between(0, 20),
  marker: word,
});

// S2. Plant: declare `apiUrl` with a plain `Schema.String` (the `http:` file starts); let the file win over the environment; drop the default.
describe("S2, the start", () => {
  it.effect.prop(
    "a group of the settings starts with their defaults; a value in the repo file is read, the environment variable wins over it, and a file value the check refuses stops the start naming that file and line",
    { drawn: drawn2 },
    ({ drawn }) =>
      Effect.gen(function* () {
        const comments = Array.from({ length: drawn.pad }, (_, n) => `# note ${n}`);
        const fileText = (value: string) => `${[...comments, "[github]", `api-url = "${value}"`].join("\n")}\n`;

        const defaults = yield* started({}, {});

        expect(Exit.isSuccess(defaults), "starts with nothing set").toBe(true);

        if (Exit.isSuccess(defaults)) {
          expect(defaults.value.apiUrl).toBe("https://api.github.com");
          expect(defaults.value.pollInterval).toBe("30 seconds");
          expect(defaults.value.redirects).toBe(20);
        }

        const fromFile = `https://${drawn.address.host}/api/v3`;
        const fromEnv = `https://${drawn.address.other}`;

        const filed = yield* started({ [REPO_FILE]: fileText(fromFile) }, {});

        expect(Exit.isSuccess(filed) ? filed.value.apiUrl : undefined, "the repo file").toBe(fromFile);

        const both = yield* started({ [REPO_FILE]: fileText(fromFile) }, { DEMO_GITHUB_API_URL: fromEnv });

        expect(Exit.isSuccess(both) ? both.value.apiUrl : undefined, "the variable wins").toBe(fromEnv);

        const unsafe = yield* started({ [REPO_FILE]: fileText(`http://${drawn.address.host}`) }, {});

        expect(Exit.isFailure(unsafe), "an http address stops the start").toBe(true);

        if (Exit.isFailure(unsafe)) {
          const error = Option.getOrUndefined(Cause.findErrorOption(unsafe.cause));

          expect(unsafe.cause.reasons, "one error, no defect beside it").toHaveLength(1);
          assert.isTrue(Schema.is(SettingGroup.SettingsError)(error));

          if (Schema.is(SettingGroup.SettingsError)(error)) {
            expect(error.reason).toBe("invalid");
            expect(error.file, "names the file").toBe(".demo/demo.toml");
            expect(error.line, "and the line of the key").toBe(drawn.pad + 2);
          }
        }
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});
