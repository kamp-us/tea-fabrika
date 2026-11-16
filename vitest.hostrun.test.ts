import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HOST_RUN, hostRun } from "./vitest.hostrun.ts";

// Today's tooling, both versions: the host-only guard's decision (vitest.hostrun.ts, decision 0178).
// A pure function of the environment and the platform, so these laws start nothing. Each plant was
// run once on vitest.hostrun.ts and restored; each turned its law red.
const options = { seed: 119120, numRuns: 200 };

/** Any environment the laptop's shell might hold, without CI or the owner's yes. */
const laptopEnv = fc
  .dictionary(
    fc.constantFrom("CLAUDE_CODE_REMOTE", "CLAUDECODE", "HOME", "TERM", "FABRIKA_HOME"),
    fc.string(),
  )
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
