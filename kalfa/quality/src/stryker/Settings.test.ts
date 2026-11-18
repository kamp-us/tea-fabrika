// Law Q7 of docs/plan/quests/kalfa-quality-stryker-PLAN.md (decisions 0069 and 0585): each setting is one
// Effect Config with one default, read from `KALFA_QUALITY_STRYKER_<KEY>` or from `quality.stryker.<key>`
// in a provider the edge hands in. The environment wins over the provider, an absent value is the
// default, an out-of-range value fails naming its key, and a `FABRIKA_` name is never read.
//
// `Settings.provider(env, repo)` is the one composition the edge (.github/ci/plants.ts) uses: the
// environment under `KALFA`, then the repo's values.
//
// fast-check: one value per setting, in range or not, and which source holds it, shaped by hand.
import { Effect, Exit, Option } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Settings from "./Settings.ts";

const options = { seed: 600, numRuns: 100 };

const KEYS = ["catalog", "concurrency", "timeout", "inPlace", "ignore", "vitest", "nice"] as const;

type Key = (typeof KEYS)[number];

const ENV: Record<Key, string> = {
  catalog: "KALFA_QUALITY_STRYKER_CATALOG",
  concurrency: "KALFA_QUALITY_STRYKER_CONCURRENCY",
  timeout: "KALFA_QUALITY_STRYKER_TIMEOUT",
  inPlace: "KALFA_QUALITY_STRYKER_IN_PLACE",
  ignore: "KALFA_QUALITY_STRYKER_IGNORE",
  vitest: "KALFA_QUALITY_STRYKER_VITEST",
  nice: "KALFA_QUALITY_STRYKER_NICE",
};

const path = fc
  .array(fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/), { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join("/"));

/** One in-range value for each key, and a second one that differs from it. */
const values = fc.record({
  catalog: fc.tuple(path, path).filter(([a, b]) => a !== b),
  concurrency: fc.tuple(fc.integer({ min: 1, max: 16 }), fc.integer({ min: 17, max: 32 })),
  timeout: fc.tuple(fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 100_001, max: 200_000 })),
  inPlace: fc.boolean().map((b) => [b, !b] as const),
  ignore: fc.tuple(
    fc.array(fc.stringMatching(/^[a-z.]{1,8}$/), { minLength: 1, maxLength: 3 }),
    fc.array(fc.stringMatching(/^[A-Z.]{1,8}$/), { minLength: 1, maxLength: 3 }),
  ),
  vitest: fc.tuple(path, path).filter(([a, b]) => a !== b),
  nice: fc.tuple(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 10, max: 19 })),
});

const source = fc.constantFrom("env", "repo", "both", "none");

const text = (value: unknown) => (Array.isArray(value) ? value.join(",") : String(value));

const DEFAULTS = { concurrency: 1, timeout: 60_000, inPlace: false, ignore: [], vitest: undefined, nice: 0 };

const read = (env: Record<string, string>, repo: unknown) =>
  Effect.runSyncExit(Settings.all.parse(Settings.provider(env, repo)));

const plain = <T extends { readonly vitest: Option.Option<string> }>(got: T) => ({
  ...got,
  vitest: Option.getOrUndefined(got.vitest),
});

describe("Settings, each one read as a person sets it", () => {
  // Plant: nest the environment under FABRIKA instead of KALFA.
  it("Q7: the environment and the provider both read, the environment first, an absent value its default, FABRIKA_ never", () => {
    fc.assert(
      fc.property(
        values,
        fc.record({
          catalog: source,
          concurrency: source,
          timeout: source,
          inPlace: source,
          ignore: source,
          vitest: source,
          nice: source,
        }),
        (v, where) => {
          const env: Record<string, string> = {};
          const repo: Record<string, unknown> = {};
          const want: Record<string, unknown> = { ...DEFAULTS };

          for (const key of KEYS) {
            const [first, second] = v[key];
            const from = key === "catalog" && where[key] === "none" ? "env" : where[key];

            // The same key under another app's name is a decoy: it never reaches the answer.
            env[ENV[key].replace("KALFA_", "FABRIKA_")] = text(second);

            if (from === "env" || from === "both") {
              env[ENV[key]] = text(first);
              want[key] = first;
            }

            if (from === "repo" || from === "both") {
              repo[key] = second;
              want[key] = from === "both" ? first : second;
            }
          }

          const got = read(env, { quality: { stryker: repo } });
          expect(Exit.isSuccess(got)).toBe(true);
          expect(Exit.isSuccess(got) ? plain(got.value) : undefined).toEqual(want);
        },
      ),
      options,
    );
  });

  // Plant: accept an out-of-range value as it is, or drop the key from the failure.
  it("Q7: a missing catalog and every out-of-range value fail, each naming its key", () => {
    const BAD: ReadonlyArray<readonly [Key, string]> = [
      ["concurrency", "0"],
      ["concurrency", "-3"],
      ["concurrency", "1.5"],
      ["timeout", "0"],
      ["timeout", "-1"],
      ["nice", "20"],
      ["nice", "-1"],
      ["inPlace", "maybe"],
    ];

    const bad = fc.constantFrom(...BAD);

    fc.assert(
      fc.property(path, bad, fc.boolean(), (catalog, [key, value], viaRepo) => {
        const env: Record<string, string> = { [ENV.catalog]: catalog };
        const repo: Record<string, unknown> = {};

        if (viaRepo) {
          repo[key] = Number.isNaN(Number(value)) ? value : Number(value);
        } else {
          env[ENV[key]] = value;
        }

        const got = read(env, { quality: { stryker: repo } });
        expect(Exit.isFailure(got)).toBe(true);
        expect(String(got).toLowerCase().replace(/[-_ ]/g, "")).toContain(key.toLowerCase());

        // And with no catalog at all the run fails naming it.
        const none = read({}, {});
        expect(Exit.isFailure(none)).toBe(true);
        expect(String(none).toLowerCase()).toContain("catalog");
      }),
      options,
    );
  });
});
