// The new fabrika's test primitives (decision 0538), as Effect keeps its own in `@effect/vitest`. A
// test in next/ reads them by the package's name, as `import { runsFor } from "@kampus/vitest"`. The
// package imports no service of ours, and each module here keeps its own doc blocks. The root holds
// only what runs anywhere. `TestDatabase` opens a real SQLite file, so it is read through its own
// subpath, `@kampus/vitest/TestDatabase`, and never from here: that keeps Node's native module out of
// every law that imports `runsFor`, and lets lint tell a law over real IO from one in memory.
export * from "./Depth.ts";
