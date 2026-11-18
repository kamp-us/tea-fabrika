// L7 of docs/plan/quests/rules-and-records-build-PLAN.md (slice 8, 0608, 0069, 0086): the limit is the setting.
// Its default is 32,768 with the Codex docs URL in its doc text, `KALFA_RECORDS_MAP_MAX_BYTES` and the repo's
// `.kalfa/kalfa.toml` `[records.map] max-bytes` set it, and `MapSize.check` fails a root over what was loaded
// and passes one at it.
//
// Assumed export, `Settings.ts`: `maxBytes`, a `@kalfa/config` setting made by `App.make({ name: "kalfa", list:
// "kalfa config get" })`'s `Setting.make("records.map.max-bytes", { schema: Schema.Int.check(isGreaterThan(0)),
// default: 32_768, doc, scope: ["repo"], reload: "restart", since: "0.0.0" })`. The group is made here from
// its own app: `maxBytes.app.Setting.group({ maxBytes })`, and loaded with `Load.load` over an in-memory repo.
import { expect, it } from "@effect/vitest";
import * as Load from "@kalfa/config/Load";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, Layer, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as MapSize from "./MapSize.ts";
import { bytesOf, type Files, ROOT, tomlStandIn, world } from "./Records.test-support.ts";
import * as Settings from "./Settings.ts";

const check = { arbitrary: { seed: 119120, runs: runsFor({ fast: 50, full: 200 }) } };

const group = Settings.maxBytes.app.Setting.group({ maxBytes: Settings.maxBytes });

const loaded = (env: Readonly<Record<string, string>>, files: Files) =>
  Load.load(group, { repo: ROOT, home: "/people/one", flags: {}, env, version: "0.0.0" }).pipe(
    Effect.provide(Layer.mergeAll(world(ROOT, files), tomlStandIn, Digest.layerWebCrypto)),
  );

const VARIABLE = "KALFA_RECORDS_MAP_MAX_BYTES";

const toml = (limit: number) => `[records.map]\nmax-bytes = ${limit}\n`;

// Plant: hard-code 32,768 where the limit is read, so the environment's value and the file's are ignored.
it.effect.prop(
  "L7 the limit is the setting: the environment or the repo's file sets it, and a root over it fails the check while a root at it passes",
  {
    limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 70_000 })),
    source: Schema.Literals(["env", "file", "both"]),
    // A root a byte under, at or a byte over the limit as often as one anywhere within 500 of it.
    near: Schema.Boolean,
    delta: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 500 })),
    twos: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 200 })),
  },
  ({ limit, source, near, delta, twos }) =>
    Effect.gen(function* () {
      // The environment wins over the repo's file, as every setting does (0086).
      const env = source === "file" ? {} : { [VARIABLE]: String(limit) };
      const files = source === "env" ? {} : { ".kalfa/kalfa.toml": toml(source === "both" ? limit + 7 : limit) };
      const { values } = yield* loaded(env, files);

      expect(values.maxBytes).toBe(limit);

      const bytes = Math.max(0, near ? limit + (delta % 3) - 1 : limit + delta - 250);

      const found = yield* MapSize.check(ROOT, values.maxBytes).pipe(
        Effect.provide(world(ROOT, { "AGENTS.md": bytesOf(bytes, twos) })),
      );

      expect(found.length > 0, `${bytes} bytes against ${limit}`).toBe(bytes > limit);
    }),
  check,
);

it.effect.prop(
  "L7 a limit of zero, below zero, not whole or not a number is refused",
  { bad: Schema.Literals(["0", "-1", "-32768", "1.5", "abc", "1e3x"]) },
  ({ bad }) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(loaded({ [VARIABLE]: bad }, {}));

      expect(Exit.isFailure(exit), bad).toBe(true);
    }),
  check,
);

// Pinned: the default is Codex's `project_doc_max_bytes`, 32 KiB, and its doc says where that comes from (0608).
it.effect("L7 scenario: the default is 32,768, and the doc text holds the Codex docs URL", () =>
  Effect.gen(function* () {
    const { values } = yield* loaded({}, {});

    expect(values.maxBytes).toBe(32_768);
    expect(Settings.maxBytes.doc).toContain("https://developers.openai.com/codex/guides/agents-md");
    expect(Settings.maxBytes.path).toBe("records.map.max-bytes");
  }),
);
