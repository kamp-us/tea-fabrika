/**
 * The new fabrika's test primitives (decision 0538), as Effect keeps its own in `@effect/vitest`. A
 * test in next/ reads them by the package's name, as `import { runsFor, Recorder } from
 * "@kampus/vitest"`. The package imports no service of ours, and each module here keeps its own doc
 * blocks.
 *
 * @stability unstable
 */
/**
 * How deep a test run goes, `runsFor({ fast, full })`, the only reader of `FABRIKA_TEST_DEPTH`.
 *
 * @stability unstable
 */
export * from "./Depth.ts";
/**
 * The one typed way a law watches a service's calls (decision 0579): `Recorder.layer` provides a
 * service and records each run of its methods, and `Recorder.calls` reads them back.
 *
 * @stability unstable
 * @category testing
 */
export * as Recorder from "./Recorder.ts";
export {
  /**
   * A law's declaration (decisions 0579 and 0580): `it`, with `it.effect`, `it.live`, `it.prop`,
   * `it.effect.prop` and `it.live.prop`, each taking its plant and label as options.
   *
   * @stability unstable
   * @category testing
   */
  it,
} from "./Law.ts";
export {
  /**
   * vitest's own `assertType`, so a type law's file has one import.
   *
   * @stability unstable
   * @category testing
   */
  assertType,
  /**
   * vitest's own `describe`, so a law file has one import.
   *
   * @stability unstable
   * @category testing
   */
  describe,
  /**
   * vitest's own `expect`, so a law file has one import.
   *
   * @stability unstable
   * @category testing
   */
  expect,
  /**
   * vitest's own `expectTypeOf`, so a type law's file has one import.
   *
   * @stability unstable
   * @category testing
   */
  expectTypeOf,
} from "vitest";
/**
 * A plant's record from a run's tasks (decision 0580): `Plants.records(files, root)`.
 *
 * @stability unstable
 * @category testing
 */
export * as Plants from "./Plants.ts";
