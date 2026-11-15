// The new fabrika's test primitives (decision 0538), as Effect keeps its own in `@effect/vitest`. A
// test in next/ reads them by the package's name, as `import { runsFor } from "@kampus/vitest"`. The
// package imports no service of ours, and each module here keeps its own doc blocks.
export * from "./Depth.ts";
