/**
 * The new fabrika's test primitives (decision 0538), as Effect keeps its own in `@effect/vitest`. A
 * test in next/ reads them by the package's name, as `import { runsFor, Recorder } from
 * "@kampus/vitest"`. The package imports no service of ours, and each module here keeps its own doc
 * blocks. The root holds only what runs anywhere. `TestDatabase` opens a real SQLite file, so it is
 * read through its own subpath, `@kampus/vitest/TestDatabase`, and never from here: that keeps
 * Node's native module out of every law that imports `runsFor`, and lets lint tell a law over real
 * IO from one in memory.
 */
/**
 * How deep a test run goes, `runsFor({ fast, full })`, the only reader of `FABRIKA_TEST_DEPTH`.
 */
export * from "./Depth.ts";

/**
 * The one typed way a law watches a service's calls (decision 0579): `Recorder.layer` provides a
 * service and records each run of its methods, and `Recorder.calls` reads them back.
 *
 * @category testing
 */
export * as Recorder from "./Recorder.ts";

/**
 * The one stand-in for a platform object (decision 0554): `Stub.make(rest, own)` answers `own`'s
 * members as given and every other method with `rest(name)`.
 *
 * @category testing
 */
export * as Stub from "./Stub.ts";
