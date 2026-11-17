// L14 next/. Only the declarations and lower settings services belong in this law. The memory restart
// plan (docs/plan/quests/memory-restart-PLAN.md) adds L9: the memory limit and the grace.
import { expect, it } from "@effect/vitest";
import { ByteSize, ConfigProvider, Effect, Exit, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as Declarations from "./Declarations.ts";
import * as Files from "./Files.ts";
import * as Snapshot from "./Snapshot.ts";
import * as Sources from "./Sources.ts";
import { Toml } from "./Toml.ts";
import * as TomlParser from "./TomlParser.ts";

const paths = [
  "desktop.brain-throttle",
  "desktop.brain-poll",
  "desktop.brain-start-timeout",
  "desktop.brain-stop-timeout",
] as const;

const Positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 }));

const slots = (flags: Record<string, string>) => ({
  flags: Sources.flags(flags),
  env: Sources.env({}),
  repo: Sources.file("repo", { value: {}, spans: [] }),
  person: Sources.file("person", { value: {}, spans: [] }),
});

const declaration = (path: string) => {
  const value = Declarations.all.declarations.find((d) => d.path === path);
  expect(value, `${path} is declared`).toBeDefined();

  return value!;
};

it.effect.prop(
  "L14 declared person settings read a provider, keep defaults and survive snapshots",
  [Schema.Tuple([Positive, Positive, Positive, Positive])],
  ([values]) =>
    Effect.gen(function* () {
      const flags = Object.fromEntries(paths.map((path, i) => [path, String(values[i])]));
      const resolved = yield* Sources.resolve(Declarations.all, slots(flags));
      const saved = yield* Snapshot.make(Declarations.all, resolved);
      const checked = yield* Snapshot.read(Declarations.all, saved);

      for (const [i, path] of paths.entries()) {
        const d = declaration(path);
        expect(d.scope).toEqual(["person"]);
        expect(d.reload).toBe("restart");
        expect(yield* d.parse(ConfigProvider.fromUnknown({ desktop: { [path.split(".")[1]!]: values[i] } }))).toBe(
          values[i],
        );
        expect(yield* d.parse(ConfigProvider.fromUnknown({}))).toBe(d.default);
        expect(saved.values[path]).toBe(values[i]);
        expect(checked.snapshot.values[path]).toBe(values[i]);
        expect(saved.origins[path]?._tag).toBe("flag");
      }
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
  { arbitrary: { seed: 119120, runs: 100 } },
);

it.effect.prop(
  "L14 invalid and repo-scoped timings fail before a start can read them",
  [
    Schema.Literals(paths),
    Schema.Union([Schema.Int.check(Schema.isLessThanOrEqualTo(0)), Schema.Literals([0.5, "bad"])]),
  ],
  ([path, bad]) =>
    Effect.gen(function* () {
      const d = declaration(path);
      expect(
        Exit.isFailure(
          yield* d.parse(ConfigProvider.fromUnknown({ desktop: { [path.split(".")[1]!]: bad } })).pipe(Effect.exit),
        ),
      ).toBe(true);
      const toml = yield* Toml;
      const repo = yield* toml.parse(`[desktop]\n${path.split(".")[1]} = 1\n`);
      const own = yield* toml.parse("");

      const failed = yield* Files.validate(
        Declarations.all,
        { repo: { file: "repo", document: repo }, person: { file: "person", document: own } },
        { version: "0.0.0" },
      ).pipe(Effect.exit);

      expect(Exit.isFailure(failed)).toBe(true);
    }).pipe(Effect.provide(TomlParser.layer)),
  { arbitrary: { seed: 119120, runs: 100 } },
);

// The group's own name for a declared path, so a law reads the decoded value it resolved.
const named = (path: string) => Object.entries(Declarations.all.settings).find(([, d]) => d.path === path)?.[0];

// L9. Plant: default the limit to 50 MB, or leave the grace out of `all`: L9 fails.
it.effect.prop(
  "L9 the brain's memory limit and grace are declared person settings that read a provider, keep their defaults and survive snapshots",
  [Schema.Tuple([Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000_000_000 })), Positive])],
  ([[bytes, grace]]) =>
    Effect.gen(function* () {
      const memory = declaration("desktop.brain-memory");
      const wait = declaration("desktop.brain-grace");
      // A byte size has one spelling: a string with its unit.
      const flags = { "desktop.brain-memory": `${bytes} B`, "desktop.brain-grace": String(grace) };
      const resolved = yield* Sources.resolve(Declarations.all, slots(flags));
      const saved = yield* Snapshot.make(Declarations.all, resolved);
      const checked = yield* Snapshot.read(Declarations.all, saved);
      const values: Record<string, unknown> = checked.values;

      for (const d of [memory, wait]) {
        expect(d.scope).toEqual(["person"]);
        expect(d.reload).toBe("restart");
        expect(saved.origins[d.path]?._tag).toBe("flag");
        expect(checked.snapshot.values[d.path]).toEqual(saved.values[d.path]);
      }

      expect(
        yield* memory.parse(ConfigProvider.fromUnknown({ desktop: { "brain-memory": `${bytes} B` } })),
      ).toStrictEqual(ByteSize.bytes(bytes));
      expect(yield* wait.parse(ConfigProvider.fromUnknown({ desktop: { "brain-grace": grace } }))).toBe(grace);
      expect(values[named(memory.path)!]).toStrictEqual(ByteSize.bytes(bytes));
      expect(values[named(wait.path)!]).toBe(grace);
      // The mark 0292 and experiment 93 set, and OTP's worker default for a stop's grace.
      expect(yield* memory.parse(ConfigProvider.fromUnknown({}))).toStrictEqual(ByteSize.bytes(500_000_000));
      expect(yield* wait.parse(ConfigProvider.fromUnknown({}))).toBe(5000);
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
  { arbitrary: { seed: 119120, runs: 50 } },
);

// L9, the floor. Plant: declare the limit as a plain `Schema.ByteSize`: a zero limit loads, and the
// brain would replace every runtime at its first sample.
it.effect.prop(
  "L9 a memory limit of zero is refused when the person's file loads, with an error that names the setting and what it takes",
  [Schema.Literals(["0 B", "0B", "0 kB", "0 MB", "0 KiB", "0 GiB"])],
  ([zero]) =>
    Effect.gen(function* () {
      const memory = declaration("desktop.brain-memory");
      expect(
        Exit.isFailure(
          yield* memory.parse(ConfigProvider.fromUnknown({ desktop: { "brain-memory": zero } })).pipe(Effect.exit),
        ),
      ).toBe(true);
      const toml = yield* Toml;
      const person = yield* toml.parse(`[desktop]\nbrain-memory = "${zero}"\n`);
      const repo = yield* toml.parse("");

      const failed = yield* Files.validate(
        Declarations.all,
        { repo: { file: "repo", document: repo }, person: { file: "person", document: person } },
        { version: "0.0.0" },
      ).pipe(Effect.flip);

      expect(failed.reason).toBe("invalid");
      // A person reads which setting, and the schema's own title in place of "a valid value".
      expect(failed.message).toContain("desktop.brain-memory");
      expect(failed.message).not.toContain("a valid value");
    }).pipe(Effect.provide(TomlParser.layer)),
  { arbitrary: { seed: 119120, runs: 30 } },
);
