// The runner's settings (decisions 0069 and 0585): each one Effect `Config` with its Schema and its one
// default, under `quality.stryker`, so its environment name is `KALFA_QUALITY_STRYKER_<KEY>`. No
// `FABRIKA_` name is read and no file: the edge hands the repo's own values in as a provider.
//
// What joins when `@kalfa/config` is on main: each Config becomes one of its settings, the repo and
// person files become providers, and the flags come with its loader. Every setting stays reachable
// through its `KALFA_` variable until then.
import { Config, ConfigProvider, Schema } from "effect";

/** What every environment variable of a setting starts with; the provider below reads under it. */
const PREFIX = "KALFA";

const Atleast = (minimum: number) => Schema.Int.check(Schema.isGreaterThanOrEqualTo(minimum));

/** The Stryker settings of one run. */
export const all = Config.all({
  /** The module that lists the repo's plants. No default: a run without one says which variable to set. */
  catalog: Config.NonEmptyString("catalog").pipe(
    Config.orElse((error) =>
      Config.fail(
        new ConfigProvider.SourceError({
          message: `set ${PREFIX}_QUALITY_STRYKER_CATALOG to the module that lists the plants`,
          cause: error,
        }),
      ),
    ),
  ),
  /** Stryker's test runners at once. One: other work shares the machine. */
  concurrency: Config.schema(Atleast(1), "concurrency").pipe(Config.withDefault(1)),
  /** Stryker's `timeoutMS`, in milliseconds. */
  timeout: Config.schema(Atleast(1), "timeout").pipe(Config.withDefault(60_000)),
  /** Mutate the checkout itself, not a copy: a test that reaches its target through a workspace link needs it. */
  inPlace: Config.Boolean("inPlace").pipe(Config.withDefault(false)),
  /** Stryker's `ignorePatterns`: what its sandbox does not copy. */
  ignore: Config.Array(Schema.String, "ignore").pipe(Config.withDefault<ReadonlyArray<string>>([])),
  /** The vitest config, from the repo root. None: vitest's own search. */
  vitest: Config.option(Config.NonEmptyString("vitest")),
  /** `nice -n <this>` before Stryker; 0 is no `nice`. */
  nice: Config.schema(Atleast(0).check(Schema.isLessThanOrEqualTo(19)), "nice").pipe(Config.withDefault(0)),
}).pipe(Config.nested("stryker"), Config.nested("quality"));

export type Settings = Config.Success<typeof all>;

/**
 * Where the values come from, in the order of decision 0086: the environment under `KALFA`, then the
 * repo's own values (`{ quality: { stryker: { ... } } }`). The edge reads the process's environment
 * and passes it in, so this reads nothing itself.
 */
export const provider = (
  env: Readonly<Record<string, string | undefined>>,
  repo: unknown,
): ConfigProvider.ConfigProvider =>
  ConfigProvider.orElse(
    ConfigProvider.fromEnvRecord({ ...env }).pipe(ConfigProvider.constantCase, ConfigProvider.nested(PREFIX)),
    ConfigProvider.fromUnknown(repo),
  );
