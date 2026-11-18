// How a CI script reads the variables its step gives it, and the two files every step writes to.
import { Config, ConfigProvider, Effect } from "effect";

/**
 * A step's variables through Effect's Config, read now. An empty variable stays empty, as a read of
 * process.env gave it, and an unset one takes its `Config.withDefault`.
 */
export const readEnv = <A>(config: Config.Config<A>): A =>
  Effect.runSync(config.parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true })));

/** The step's output file and summary file, `undefined` when the run has none. */
export const stepFiles = {
  output: Config.String("GITHUB_OUTPUT").pipe(Config.withDefault(undefined)),
  summary: Config.String("GITHUB_STEP_SUMMARY").pipe(Config.withDefault(undefined)),
};
