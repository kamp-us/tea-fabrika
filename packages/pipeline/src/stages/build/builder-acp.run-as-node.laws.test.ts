import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { harnessOf, type Row } from "@kampus/fabrika-old/agents/acp";
import * as fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { builderHarness, underGuard } from "./builder-acp.ts";

// The agent helpers plan (docs/plan/quests/dock-PLAN.md), law L1's guarded arm and L2's builder
// arm, today's version. They live here, not beside harness.ts, because `underGuard` and
// `builderHarness` are this package's, and @kampus/fabrika-old does not depend on it.
//
// The guard (./guard.ts) is a Node script started on `process.execPath` with the harness's own
// environment, and it starts the harness with that environment too. So on Electron the switch must
// ride the harness's env through the guard, and on plain Node no ELECTRON_* key may appear.
//
//   underGuard(harnessOf("claude", tree, 5), lock, 60)   on Electron
//   // { command: <the Electron binary>, args: [..., guard.ts, lock, "60", "--", ...], env: { ..., ELECTRON_RUN_AS_NODE: "1" } }
//
// Played on plain Node by setting `process.versions.electron` for the call, as
// harness.run-as-node.laws.test.ts does. Nothing is started.

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

const HOME = scratch("guard-run-as-node-home-");
const TREE = scratch("guard-run-as-node-tree-");

const on = <A>(electron: boolean, body: () => A): A => {
  expect(process.versions.electron, "these laws run on plain Node").toBeUndefined();

  if (!electron) {
    return body();
  }

  Object.defineProperty(process.versions, "electron", { value: "45.2.1", configurable: true, enumerable: true });

  try {
    return body();
  } finally {
    Reflect.deleteProperty(process.versions, "electron");
  }
};

const ELECTRON_KEY = /^ELECTRON_/;
const electronKeys = (env: Readonly<Record<string, string>>) => Object.keys(env).filter((k) => ELECTRON_KEY.test(k));

const parent$ = fc
  .record({
    other: fc.dictionary(fc.stringMatching(/^[A-Z][A-Z0-9_]{0,11}$/), fc.string({ maxLength: 12 }), { maxKeys: 6 }),
    electron: fc.dictionary(fc.stringMatching(/^ELECTRON_[A-Z_]{1,16}$/), fc.string({ maxLength: 8 }), {
      maxKeys: 4,
    }),
    runAsNode: fc.option(fc.constantFrom("1", "", "0", "true"), { nil: undefined }),
  })
  .map(({ other, electron, runAsNode }) => ({
    ...other,
    ...electron,
    ...(runAsNode === undefined ? {} : { ELECTRON_RUN_AS_NODE: runAsNode }),
    PATH: "/usr/bin:/bin",
    HOME,
    TMPDIR: tmpdir(),
  }));

const row$ = fc.constantFrom<Row>(
  "claude",
  "fake",
  { name: "codex", access: "read" },
  { name: "codex", access: "write" },
);

/** What every Spawnable on this binary must carry: the switch on Electron, no ELECTRON_* key on plain Node. */
const runsAsNode = (env: Readonly<Record<string, string>>, electron: boolean) => {
  expect(env.ELECTRON_RUN_AS_NODE, "the switch Electron reads at its first line").toBe(electron ? "1" : undefined);
  expect(electronKeys(env), "no other ELECTRON_* key is handed on").toEqual(electron ? ["ELECTRON_RUN_AS_NODE"] : []);
};

describe("L1, under the guard: the guard and the harness it starts both run as Node on Electron, and only there", () => {
  it("each row, guarded, starts on this binary with the switch on Electron and no ELECTRON_* key on plain Node", () => {
    fc.assert(
      fc.property(row$, parent$, fc.boolean(), fc.integer({ min: 1, max: 600 }), (row, parent, electron, wait) => {
        const guarded = on(electron, () => underGuard(harnessOf(row, TREE, null, parent), join(TREE, "lock"), wait));
        expect(guarded.command).toBe(process.execPath);
        runsAsNode(guarded.env, electron);
      }),
      { numRuns: 200 },
    );
  });

  it("the builder's own harness, guarded or not, does the same, and clears the switch for the Claude CLI's commands", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.double({ min: 0.01, max: 50, noNaN: true }),
        (electron, guard, budget) => {
          const { harness, meta } = on(electron, () => builderHarness(TREE, budget, guard));
          expect(harness.command).toBe(process.execPath);
          runsAsNode(harness.env, electron);
          const options = (meta as { claudeCode: { options: Options } }).claudeCode.options;
          // L2: on Electron the Claude CLI's commands see the switch unset; on plain Node nothing is cleared.
          const cleared = "env" in options ? options.env?.ELECTRON_RUN_AS_NODE : "no env";
          expect(cleared, "what the Claude CLI's commands see of the switch").toBe(electron ? "" : "no env");
        },
      ),
      { numRuns: 200 },
    );
  });
});
