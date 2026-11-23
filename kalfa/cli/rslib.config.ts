import { defineConfig } from "@rslib/core";

// The build every kalfa package has: one ES module and one type file per source file, tests left out.
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
