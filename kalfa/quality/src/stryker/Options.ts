/**
 * The Stryker options for one plant (decision 0600): one `mutate` place, one test file, bail off, so
 * the report says which tests killed the mutant. Plain data in Stryker's own keys (its
 * `stryker-core.json` schema). Pure.
 */
import { Option } from "effect";
import type { Plant } from "./Plant.ts";
import type { Found } from "./Report.ts";
import type { Settings } from "./Settings.ts";

/**
 * What `make` returns, and what a run writes to Stryker's config file.
 *
 * @category models
 */
export interface Options {
  readonly testRunner: "vitest";
  readonly plugins: ReadonlyArray<string>;
  /** The one place, as `file:line:column-endLine:endColumn`: lines from 1, columns from 0. */
  readonly mutate: ReadonlyArray<string>;
  /** The law's file alone. Stryker runs every test of an entry, so never a folder. */
  readonly testFiles: ReadonlyArray<string>;
  /** Every covering test runs, so `killedBy` names all killers, not the first. */
  readonly disableBail: true;
  readonly coverageAnalysis: "perTest";
  readonly reporters: ReadonlyArray<"json">;
  readonly jsonReporter: { readonly fileName: string };
  readonly inPlace: boolean;
  readonly concurrency: number;
  readonly timeoutMS: number;
  readonly ignorePatterns: ReadonlyArray<string>;
  readonly tempDirName: string;
  readonly cleanTempDir: "always";
  /** An absent file: Stryker reads a tsconfig with TypeScript's JavaScript API, which TypeScript 7 lacks. */
  readonly tsconfigFile: string;
  /** `related: false`: `testFiles` picks the files, and vitest's own related search would narrow them again. */
  readonly vitest: { readonly related: false; readonly configFile?: string };
}

/**
 * The options for `target`, with every file the run writes under `temp.dir` and the vitest runner at `temp.plugin`.
 *
 * @category constructors
 */
export const make = (
  target: Found,
  plant: Plant,
  settings: Settings,
  temp: { readonly dir: string; readonly plugin: string },
): Options => ({
  testRunner: "vitest",
  plugins: [temp.plugin],
  mutate: [`${target.file}:${target.line}:${target.column}-${target.endLine}:${target.endColumn}`],
  testFiles: [plant.law.file],
  disableBail: true,
  coverageAnalysis: "perTest",
  reporters: ["json"],
  jsonReporter: { fileName: `${temp.dir}/report.json` },
  inPlace: settings.inPlace,
  concurrency: settings.concurrency,
  timeoutMS: settings.timeout,
  ignorePatterns: settings.ignore,
  tempDirName: `${temp.dir}/sandbox`,
  cleanTempDir: "always",
  tsconfigFile: `${temp.dir}/absent.json`,
  vitest: Option.match(settings.vitest, {
    onNone: () => ({ related: false }),
    onSome: (configFile) => ({ related: false, configFile }),
  }),
});
