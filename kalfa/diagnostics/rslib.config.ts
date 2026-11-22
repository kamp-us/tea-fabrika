import { defineConfig } from "@rslib/core";

export default defineConfig({
  lib: [{ format: "esm", bundle: false, dts: true, syntax: "es2023" }],
  source: {
    entry: {
      index: ["./src/**/*.ts", "!./src/**/*.test.ts", "!./src/**/*Test.ts", "!./src/**/*.test-support.ts"],
    },
    tsconfigPath: "./tsconfig.build.json",
  },
  output: { target: "node" },
});
