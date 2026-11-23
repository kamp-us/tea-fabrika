import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { broadRefusal, HOST_RUN, hostRun } from "./vitest.hostrun.ts";

// Today's tooling, both versions: the host-only guard's decision (vitest.hostrun.ts, decision 0178).
// A pure function of the environment and the platform, so these laws start nothing. Each plant was
// run once on vitest.hostrun.ts and restored; each turned its law red.
const options = { seed: 119120, numRuns: 200 };

/** Any environment the laptop's shell might hold, without CI or the owner's yes. */
const laptopEnv = fc
  .dictionary(fc.constantFrom("CLAUDE_CODE_REMOTE", "CLAUDECODE", "HOME", "TERM", "FABRIKA_HOME"), fc.string())
  .map((env): Record<string, string | undefined> => ({ ...env, CI: undefined, [HOST_RUN]: undefined }));

describe("the host-only guard's decision", () => {
  // Plants: allow on the marker alone, without the platform; allow any non-empty marker value.
  it("law: on the laptop, with no CI and no owner's yes, it refuses, whatever else the shell holds", () => {
    expect(hostRun({}, "darwin")).toEqual({ _tag: "refuse" });
    expect(hostRun({ CLAUDE_CODE_REMOTE: "true" }, "darwin")).toEqual({ _tag: "refuse" });
    expect(hostRun({ CLAUDE_CODE_REMOTE: "1" }, "linux")).toEqual({ _tag: "refuse" });
    expect(hostRun({ [HOST_RUN]: "true" }, "darwin")).toEqual({ _tag: "refuse" });
    fc.assert(
      fc.property(laptopEnv, (env) => hostRun(env, "darwin")._tag === "refuse"),
      options,
    );
  });

  // Plant: drop the cloud box's case, which is the bug this law came with.
  it("law: in a cloud box, a Linux run with CLAUDE_CODE_REMOTE=true, it allows", () => {
    expect(hostRun({ CLAUDE_CODE_REMOTE: "true" }, "linux")).toEqual({ _tag: "allow", reason: "box" });
  });

  // Plant: read CI only on Linux.
  it("law: in CI it allows, on any platform", () => {
    for (const platform of ["linux", "darwin"] as const) {
      expect(hostRun({ CI: "true" }, platform)).toEqual({ _tag: "allow", reason: "ci" });
    }
  });

  // Plant: drop the owner's case.
  it("law: with the owner's yes for this command, it allows on the laptop", () => {
    expect(hostRun({ [HOST_RUN]: "1" }, "darwin")).toEqual({ _tag: "allow", reason: "owner" });
  });
});

// The laptop's refusal of a broad run (vitest.config.ts calls it). A builder once blamed `--maxWorkers=3` for a
// refusal that a folder filter caused, because every refusal said the same words. Each plant was run once on
// vitest.hostrun.ts and restored; each turned its law red.
describe("the laptop's refusal of a broad run names the rule that fired", () => {
  const cwd = "/work";
  const trigger = (path: string) => path === "pnpm-lock.yaml" || path.startsWith("oxlint-plugins/");
  const file = fc.constantFrom(
    "a/b.test.ts",
    "kalfa/markdown/src/Frontmatter.test.ts",
    "oxlint-plugins/layers.test.ts",
  );
  const folder = fc.constantFrom("kalfa/markdown", "oxlint-plugins", "packages", "kalfa/*/src", "Frontmatter");
  const quiet = fc.constantFrom("README.md", "kalfa/markdown/src/Frontmatter.ts", "AGENTS.md");
  const forced = fc.uniqueArray(fc.constantFrom("pnpm-lock.yaml", "oxlint-plugins/layers.ts", "oxlint-plugins/a.mjs"), {
    minLength: 1,
  });

  // Plant: give every refusal the same generic words.
  it("law: a filter that is not one test file is named, and with no --changed that is the refusal", () => {
    fc.assert(
      fc.property(fc.array(file, { maxLength: 3 }), folder, fc.array(file, { maxLength: 3 }), (before, wide, after) => {
        const said = broadRefusal({ filters: [...before, wide, ...after], changed: undefined }, cwd, trigger);

        return said?.includes(`'${wide}'`) === true && !said.includes("--changed would select");
      }),
      options,
    );
  });

  // Plant: drop the file names from the forced message, or blame the filter in it.
  it("law: --changed with a rerun trigger among the changed files, and a run that is not one test file, names those files, not the filters", () => {
    fc.assert(
      fc.property(
        fc.array(quiet),
        forced,
        fc.array(file, { maxLength: 2 }),
        fc.option(folder),
        (calm, hot, files, wide) => {
          const said = broadRefusal(
            { filters: wide === null ? [] : [...files, wide], changed: [...calm, ...hot] },
            cwd,
            trigger,
          );

          return (
            said !== undefined &&
            hot.every((path) => said.includes(path)) &&
            said.includes("--changed would select every test") &&
            !said.includes("is not one test file")
          );
        },
      ),
      options,
    );
  });

  // Plant: refuse a run with no filter and no --changed with the filter's words.
  it("scenario: no filter and no --changed says no test file was given", () => {
    expect(broadRefusal({ filters: [], changed: undefined }, cwd, trigger)).toContain("no test file was given");
  });

  // Plant: let git's failure pass, or give it the trigger words.
  it("scenario: git failing to list the changed files says so", () => {
    expect(broadRefusal({ filters: [], changed: null }, cwd, trigger)).toContain("git could not list");
  });

  // Plant: refuse several test files, or refuse --changed with no trigger among the files.
  it("law: any number of test files, or --changed with no rerun trigger changed, runs", () => {
    fc.assert(
      fc.property(fc.array(file, { minLength: 1, maxLength: 4 }), fc.array(quiet), (files, calm) => {
        return (
          broadRefusal({ filters: files, changed: undefined }, cwd, trigger) === undefined &&
          broadRefusal({ filters: files, changed: null }, cwd, trigger) === undefined &&
          broadRefusal({ filters: [], changed: calm }, cwd, trigger) === undefined
        );
      }),
      options,
    );
  });

  // Plant: read an absolute path as a folder.
  it("vector: an absolute path to a test file under the working folder is one test file", () => {
    expect(broadRefusal({ filters: ["/work/a/b.test.ts"], changed: undefined }, cwd, trigger)).toBeUndefined();
  });
});
