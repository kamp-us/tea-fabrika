// L3 of the trusted-rules swap (decision 0573): the Effect checker's `preferSchemaTaggedError` holds
// every type-checked class beside `fabrika/no-data-taggederror`, so the checker's level is a law.
// Each tsconfig the repo tracks is read the way the checker reads it (0577, through test-helpers/effect-config.ts):
// its `extends` chain is followed and the checker's plugin block merged key by key, so a project
// inherits the base's level unless it sets its own. The level that results is `error` in every
// tracked tsconfig, and no override it ends with, its own or one it inherits, sets it lower for any path.
// Nor does the merged block, or any override, set `"diagnostics": false` or
// `"ignoreEffectErrorsInTscExitCode": true`, either of which lets the check's errors pass `tsc` at
// any level.
// Plants, run once each (field/runs/2026-11-16-effect-checks-held-merge.json): a package block that
// sets the check to `"warning"`; the base set to `"off"` with no package naming it; and a package
// tsconfig with its `extends` dropped, so it never inherits the base. Each is red.
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { expect, it } from "vitest";
import { blockOf, levelAt, merge, type Options, record } from "./test-helpers/effect-config.ts";

const ROOT = join(import.meta.dirname, "..");
const CHECK = "preferSchemaTaggedError";
const SERVICE = "@effect/language-service";

/** Each place one set of checker options leaves the check below `error` or lets its errors pass, said in words. */
const lowered = (where: string, options: Options): ReadonlyArray<string> => [
  ...(levelAt(options, CHECK) === "error" ? [] : [`${where}: ${CHECK} is ${String(levelAt(options, CHECK))}`]),
  ...(options.diagnostics === false ? [`${where}: ${SERVICE} sets diagnostics to false`] : []),
  ...(options.ignoreEffectErrorsInTscExitCode === true
    ? [`${where}: ${SERVICE} sets ignoreEffectErrorsInTscExitCode to true`]
    : []),
];

it("L3 scenario: preferSchemaTaggedError stays at error in every tracked tsconfig, for every path", () => {
  const files = execFileSync("git", ["ls-files", "*tsconfig*.json"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((file) => basename(file).startsWith("tsconfig") && !file.startsWith("fixtures/"));
  // Coverage: the base and the projects that extend it, `next/` and the tooling among them.
  expect(files).toEqual(
    expect.arrayContaining([
      "tsconfig.base.json",
      "next/packages/libfabrika/tsconfig.json",
      ".agents/tsconfig.json",
      "oxlint-plugins/tsconfig.json",
    ]),
  );
  // The base names the check itself, so one line there covers every project that extends it.
  expect(
    record(blockOf(join(ROOT, "tsconfig.base.json")).options.diagnosticSeverity)[CHECK],
    "tsconfig.base.json names the check",
  ).toBe("error");
  expect(
    files.flatMap((file) => {
      const block = blockOf(join(ROOT, file));
      // An override reaches only the paths it matches, so each is judged on top of the block alone.
      return [
        ...lowered(file, block.options),
        ...block.overrides.flatMap((override, i) =>
          lowered(`${file} override ${i}`, merge(block.options, override.options)),
        ),
      ];
    }),
  ).toEqual([]);
});
