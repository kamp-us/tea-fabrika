// depth.config.ts: the root test config with the property laws capped to `MUTATE_RUNS` cases (ticket 1306). Today's
// lead tooling. The box's plain baseline run names it with `--config` when a depth is set; depth.ts says why.
import { defineConfig } from "vitest/config";
import { testConfig } from "../../../../vitest.config.ts";
import { depthConfig } from "./depth.ts";

export default defineConfig({ ...testConfig, test: { ...testConfig.test, ...depthConfig(process.env.MUTATE_RUNS) } });
