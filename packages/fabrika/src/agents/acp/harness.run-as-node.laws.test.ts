import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { Schema } from "effect";
import * as fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { SystemPrompt } from "../agent/turn.ts";
import { type Harness, harnessOf, type Row, withSystem } from "./harness.ts";

// The agent helpers plan (docs/plan/lanes/dock-PLAN.md), laws L1 and L2, today's version. The host
// runs on Electron's binary, run as Node, and starts each adapter on that same binary
// (`process.execPath`). Electron boots its whole app, with a Dock icon on a Mac, unless
// ELECTRON_RUN_AS_NODE is set and not empty (electron_main_mac.cc at v45.2.1, lines 37 to 40 and
// 70 to 73). So every adapter carries the switch on Electron, and the commands the agent runs never
// inherit it.
//
//   harnessOf({ name: "codex", access: "read" }, folder, null, parent)   on Electron
//   // { command: <the Electron binary>, env: { PATH, HOME, ..., ELECTRON_RUN_AS_NODE: "1" } }
//   harnessOf("claude", folder, null, parent).meta.claudeCode.options.env
//   // { ELECTRON_RUN_AS_NODE: "" }: the Claude CLI's Bash commands see it as unset
//
// On Electron, `process.versions.electron` is set in every process, run as Node or not
// (node_bindings.cc at v45.2.1, lines 1242 to 1245). These tests run on plain Node, so on Electron
// is played by setting that one value for the call and taking it off after. Nothing is started.

const made: string[] = [];

afterAll(() => {
  for (const folder of made.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

const scratch = (prefix: string) => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(folder);
  return folder;
};

/** A made-up home and a work folder, both real folders, so Codex's fence has something to walk. */
const HOME = scratch("run-as-node-home-");
const FOLDER = scratch("run-as-node-folder-");

/** What Electron 45.2.1 sets in `process.versions`. */
const ELECTRON = "45.2.1";

/** Run `body` as if this process were Electron's binary run as Node, or plain Node. */
const on = <A>(electron: boolean, body: () => A): A => {
  expect(process.versions.electron, "these laws run on plain Node").toBeUndefined();

  if (!electron) {
    return body();
  }

  Object.defineProperty(process.versions, "electron", { value: ELECTRON, configurable: true, enumerable: true });

  try {
    return body();
  } finally {
    Reflect.deleteProperty(process.versions, "electron");
  }
};

const ELECTRON_KEY = /^ELECTRON_/;
const electronKeys = (env: Readonly<Record<string, string>>) => Object.keys(env).filter((k) => ELECTRON_KEY.test(k));

/** A parent's environment: what a machine has, keys nobody named, and Electron's own keys, the switch among them. */
const parent$ = fc
  .record({
    other: fc.dictionary(fc.stringMatching(/^[A-Z][A-Z0-9_]{0,11}$/), fc.string({ maxLength: 12 }), { maxKeys: 6 }),
    electron: fc.dictionary(fc.stringMatching(/^ELECTRON_[A-Z_]{1,16}$/), fc.string({ maxLength: 8 }), {
      maxKeys: 4,
    }),
    // A parent that is itself run as Node has the switch, as the app's host does (start-host.ts).
    runAsNode: fc.option(fc.constantFrom("1", "", "0", "true"), { nil: undefined }),
    user: fc.option(fc.constant("someone"), { nil: undefined }),
  })
  .map(({ other, electron, runAsNode, user }) => ({
    ...other,
    ...electron,
    ...(runAsNode === undefined ? {} : { ELECTRON_RUN_AS_NODE: runAsNode }),
    ...(user === undefined ? {} : { USER: user }),
    PATH: "/usr/bin:/bin",
    HOME,
    TMPDIR: tmpdir(),
  }));

const row$: fc.Arbitrary<Row> = fc.constantFrom<Row>(
  "claude",
  "fake",
  { name: "codex", access: "read" },
  { name: "codex", access: "write" },
);

/** A turn's system prompt, or none: decoded by its own schema, so a replace's text is never blank. */
const system$: fc.Arbitrary<SystemPrompt | null> = fc.option(
  fc
    .oneof(
      fc.record({ _tag: fc.constant("append" as const), text: fc.string({ maxLength: 20 }) }),
      fc.record({ _tag: fc.constant("replace" as const), text: fc.stringMatching(/^\S.{0,19}$/) }),
    )
    .map((raw) => Schema.decodeUnknownSync(SystemPrompt)(raw)),
  { nil: null },
);

const budget$ = fc.option(fc.double({ min: 0.01, max: 50, noNaN: true }), { nil: null });

const case$ = fc.record({ row: row$, system: system$, electron: fc.boolean(), parent: parent$, budget: budget$ });

/** The harness a caller gets: the row, then told a turn's system prompt when there is one. */
type Case = typeof case$ extends fc.Arbitrary<infer A> ? A : never;

const started = (c: Case): Harness => {
  const row = harnessOf(c.row, FOLDER, c.budget, c.parent);
  return c.system === null ? row : withSystem(row, c.system, FOLDER, c.parent);
};

describe("L1: every helper started on this process's own binary runs as Node on Electron, and only there", () => {
  it("carries ELECTRON_RUN_AS_NODE=1 on Electron, no ELECTRON_* key on plain Node, and no other ELECTRON_* key from the parent", () => {
    fc.assert(
      fc.property(case$, (c) => {
        const h = on(c.electron, () => started(c));
        expect(h.command).toBe(process.execPath);
        // On Electron, the switch Electron reads at its first line; on plain Node, none, a parent's neither.
        expect(h.env.ELECTRON_RUN_AS_NODE, "the switch").toBe(c.electron ? "1" : undefined);
        expect(electronKeys(h.env), "no other ELECTRON_* key is handed on").toEqual(
          c.electron ? ["ELECTRON_RUN_AS_NODE"] : [],
        );
      }),
      { numRuns: 200 },
    );
  });
});

/** The Agent SDK options the Claude row hands its adapter. */
const claudeOf = (h: Harness) => (h.meta as { claudeCode: { options: Options } }).claudeCode.options;

/** What Codex hands each command it runs, from the config the adapter is given. */
const codexShellOf = (h: Harness) =>
  (
    JSON.parse(h.env.CODEX_CONFIG ?? "{}") as {
      shell_environment_policy: { inherit: string; set: Record<string, string> };
    }
  ).shell_environment_policy;

describe("L2: the commands an agent runs never inherit the switch", () => {
  it("clears it for the Claude CLI's commands on Electron, keeps Codex's to the core variables, and adds nothing on plain Node", () => {
    fc.assert(
      fc.property(case$, (c) => {
        const h = on(c.electron, () => started(c));
        // The Claude adapter spreads its options' env over its own environment before it starts the
        // CLI (acp-agent.js, lines 9010 to 9012): a key can only be set there, so on Electron it is
        // set empty, which Electron reads as unset. On plain Node there is nothing to clear.
        const claude = h.name === "claude" ? claudeOf(h) : null;
        const cleared = claude === null ? "not claude" : "env" in claude ? claude.env?.ELECTRON_RUN_AS_NODE : "no env";
        expect(cleared, "what the Claude CLI's commands see of the switch").toBe(
          claude === null ? "not claude" : c.electron ? "" : "no env",
        );
        // Codex hands each command the core variables and its fenced set, never an ELECTRON_* key.
        const shell = h.name === "codex" ? codexShellOf(h) : null;
        expect(shell === null ? null : { inherit: shell.inherit, electron: electronKeys(shell.set) }).toEqual(
          shell === null ? null : { inherit: "core", electron: [] },
        );
      }),
      { numRuns: 200 },
    );
  });
});
