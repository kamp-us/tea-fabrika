import { execFileSync } from "node:child_process";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { agentEnv, hostEnv, notAsNode, runAsNode, runEnv, shellEnv, toolHome } from "./env.ts";

// The short environments, on a made-up parent: no test here reads a real key.
// How each place that starts a process uses them is tested beside that place.

/** A parent with what a machine has set: the plain names, a login, an ssh agent, and keys nobody named. */
const PARENT = {
  PATH: "/bin",
  HOME: "/people/someone",
  TMPDIR: "/tmp/someone",
  LANG: "en_US.UTF-8",
  USER: "someone",
  SSH_AUTH_SOCK: "/tmp/someone/agent.sock",
  TYPESAFE_API_KEY: "not-a-key",
  GH_TOKEN: "not-a-token",
  SOME_SERVICE_SECRET: "not-a-secret",
  EDITOR: "vi",
};

const RUN = { PATH: "/bin", HOME: "/people/someone", TMPDIR: "/tmp/someone", LANG: "en_US.UTF-8" };

describe("the environment a started process is handed", () => {
  it("is what a program needs to run, for code a ticket or an agent wrote", () => {
    expect(runEnv(PARENT)).toEqual(RUN);
  });

  it("keeps where a version manager holds the real tools, so its shim works under another home", () => {
    const parent = { ...PARENT, VOLTA_HOME: "/people/someone/.volta" };
    expect(runEnv(parent)).toEqual({ ...RUN, VOLTA_HOME: "/people/someone/.volta" });
    expect(toolHome(parent)).toEqual({ VOLTA_HOME: "/people/someone/.volta" });
    expect(toolHome(PARENT)).toEqual({});
  });

  // A shim with no home for its tools looks along the PATH for the real one, finds itself, and waits
  // on the child it starts. So a Volta folder on the PATH always brings its home, set or not.
  it.each<[string, string, string]>([
    ["first", "/people/someone/.volta/bin:/bin", "/people/someone/.volta"],
    ["in the middle", "/bin:/elsewhere/.volta/bin:/usr/bin", "/elsewhere/.volta"],
    ["last, with a slash at its end", "/bin:/people/someone/.volta/bin/", "/people/someone/.volta"],
  ])("finds Volta's home from the PATH when none is set and its folder is %s", (_, path, home) => {
    const parent = { ...PARENT, PATH: path };
    expect(toolHome(parent)).toEqual({ VOLTA_HOME: home });

    for (const env of [runEnv(parent), agentEnv(parent), shellEnv(parent), hostEnv(parent)]) {
      expect(env.VOLTA_HOME).toBe(home);
    }
  });

  it("takes the home that is set over the PATH, and does not read a longer name as Volta's", () => {
    const set = { ...PARENT, PATH: "/a/.volta/bin", VOLTA_HOME: "/set/volta" };
    expect(toolHome(set)).toEqual({ VOLTA_HOME: "/set/volta" });

    for (const path of ["/a/.volta/bin2", "/a/not.volta/bin", "/a/.volta/bin/more", ".volta/bin"]) {
      expect(toolHome({ ...PARENT, PATH: path })).toEqual({});
    }
  });

  it("adds the agent's own login for an agent, wherever that login is kept", () => {
    expect(agentEnv(PARENT)).toEqual({ ...RUN, USER: "someone" });
    expect(
      agentEnv({
        ...PARENT,
        ANTHROPIC_API_KEY: "a",
        CLAUDE_CODE_OAUTH_TOKEN: "b",
        CLAUDE_CONFIG_DIR: "c",
      }),
    ).toEqual({
      ...RUN,
      USER: "someone",
      ANTHROPIC_API_KEY: "a",
      CLAUDE_CODE_OAUTH_TOKEN: "b",
      CLAUDE_CONFIG_DIR: "c",
    });
  });

  it("adds where git finds its key for a shell, and for nothing else", () => {
    expect(shellEnv(PARENT)).toEqual({
      ...RUN,
      USER: "someone",
      SSH_AUTH_SOCK: "/tmp/someone/agent.sock",
    });
    expect(agentEnv(PARENT)).not.toHaveProperty("SSH_AUTH_SOCK");
    expect(runEnv(PARENT)).not.toHaveProperty("SSH_AUTH_SOCK");
  });

  it("never holds the Jev key, or any other variable it does not name", () => {
    for (const env of [runEnv(PARENT), agentEnv(PARENT), shellEnv(PARENT)]) {
      expect(env).not.toHaveProperty("TYPESAFE_API_KEY");
      expect(env).not.toHaveProperty("GH_TOKEN");
      expect(env).not.toHaveProperty("SOME_SERVICE_SECRET");
      expect(env).not.toHaveProperty("EDITOR");
    }
  });

  it("adds gh's login and git's key for code's own git and gh, and never the Jev key", () => {
    expect(hostEnv(PARENT)).toEqual({
      ...RUN,
      USER: "someone",
      GH_TOKEN: "not-a-token",
      SSH_AUTH_SOCK: "/tmp/someone/agent.sock",
    });
    expect(hostEnv(PARENT)).not.toHaveProperty("TYPESAFE_API_KEY");
    expect(hostEnv(PARENT)).not.toHaveProperty("SOME_SERVICE_SECRET");
    // An agent's is never a host's: it holds no gh login.
    expect(agentEnv(PARENT)).not.toHaveProperty("GH_TOKEN");
  });

  it("leaves a name out when the parent does not set it, and never hands it on empty", () => {
    expect(shellEnv({ PATH: "/bin", HOME: undefined })).toEqual({ PATH: "/bin" });
    expect(Object.keys(runEnv({}))).toEqual([]);
  });

  it("is what a real child process sees: the marker of its parent does not reach it", () => {
    const parent = { ...process.env, TEA_FABRIKA_MARKER: "set", TYPESAFE_API_KEY: "not-a-key" };
    const names = (env: NodeJS.ProcessEnv): string[] =>
      JSON.parse(
        execFileSync(process.execPath, ["-e", "console.log(JSON.stringify(Object.keys(process.env)))"], {
          env,
          encoding: "utf8",
        }),
      );

    // The same child, handed everything, does see it: the test can tell the two apart.
    expect(names(parent)).toContain("TEA_FABRIKA_MARKER");

    for (const env of [runEnv(parent), agentEnv(parent), shellEnv(parent)]) {
      expect(names(env)).toContain("PATH");
      expect(names(env)).not.toContain("TEA_FABRIKA_MARKER");
      expect(names(env)).not.toContain("TYPESAFE_API_KEY");
    }
  });
});

// The agent helpers plan (docs/plan/quests/dock-PLAN.md), law L3. Electron's binary boots its whole
// app, with a Dock icon on a Mac, unless ELECTRON_RUN_AS_NODE is set and not empty
// (electron_main_mac.cc at v45.2.1, lines 37 to 40). `runAsNode` is what a Node helper started on
// that binary needs; `notAsNode` clears it for the commands an agent runs. On plain Node each is
// nothing.
//
//   runAsNode(true)    { ELECTRON_RUN_AS_NODE: "1" }        notAsNode(true)    { ELECTRON_RUN_AS_NODE: "" }
//   runAsNode(false)   {}                                   notAsNode(false)   {}
describe("L3: the switch, set or cleared, is the one key and only on Electron", () => {
  it("answers only ELECTRON_RUN_AS_NODE, 1 to run as Node and empty to clear it, on Electron, and nothing on plain Node", () => {
    fc.assert(
      fc.property(fc.boolean(), (electron) => {
        // `toStrictEqual`: an `undefined` value under the key would not be nothing.
        expect(runAsNode(electron)).toStrictEqual(electron ? { ELECTRON_RUN_AS_NODE: "1" } : {});
        expect(notAsNode(electron)).toStrictEqual(electron ? { ELECTRON_RUN_AS_NODE: "" } : {});
      }),
      { numRuns: 50 },
    );
  });

  it("on plain Node, as these tests run, both default to nothing", () => {
    // Label: scenario. The default reads `process.versions.electron` at the edge, which plain Node never sets.
    expect(process.versions.electron).toBeUndefined();
    expect(Object.keys(runAsNode())).toEqual([]);
    expect(Object.keys(notAsNode())).toEqual([]);
  });
});
