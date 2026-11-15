// The runner `pnpm lint` goes through: it decides whether lint passed, so each law runs the real
// script over small shell parts and reads its exit code and its output. Each law was planted (the
// runner changed to break it, the law seen red) and restored; the plant is named beside it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "parallel.ts");
const home = mkdtempSync(join(tmpdir(), "parallel-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

/** Runs the runner over these parts in a folder of its own, for the files the parts make. */
const run = (...parts: readonly string[]) => {
  const ran = spawnSync("node", [SCRIPT, ...parts], { cwd: mkdtempSync(join(home, "run-")), encoding: "utf8" });
  return { status: ran.status, out: ran.stdout.split("\n"), err: ran.stderr.split("\n") };
};

const PASS = "echo pass-out";
const FAIL = "echo fail-out; echo fail-err >&2; exit 3";
// It writes a line, waits for the next part to have written its own, then writes again. Run at
// once, the next part's line comes while this one waits; in the output it must still come after.
const SLOW = "echo slow-1; for i in $(seq 100); do [ -f fast ] && break; sleep 0.1; done; [ -f fast ] && echo slow-2";
const FAST = "echo fast; touch fast";

describe("parallel.ts, the runner pnpm lint goes through", () => {
  // Plant: end with `return;` in place of failing with the failed parts: exit 0, red.
  it("exits 1 when a part fails, and 0 when every part passes", () => {
    expect(run(PASS, FAIL).status).toBe(1);
    expect(run(PASS, PASS).status).toBe(0);
  });

  // Plant: wait for each forked part to end before the next starts (`Effect.tap(Fiber.await)` on
  // the fork): the first part waits 10 s for the other's file, gives up and exits 1, red.
  it("runs the parts at once: two parts that each wait for the other both pass", () => {
    const wait = (mine: string, theirs: string) =>
      `touch ${mine}; for i in $(seq 100); do [ -f ${theirs} ] && exit 0; sleep 0.1; done; exit 1`;
    const ran = run(wait("a", "b"), wait("b", "a"));
    expect(ran.err).toEqual([""]);
    expect(ran.status).toBe(0);
  });

  // Plants, each red: join the fibers with `concurrency: "unbounded"`, so each part prints as it
  // ends, and fast comes first; write each piece to stdout as it comes in `run`, so fast lands
  // between slow-1 and slow-2.
  it("prints each part whole, in the order given, though a later part ended first", () => {
    const ran = run(SLOW, FAST);
    expect(ran.status).toBe(0);
    const at = (line: string) => ran.out.findIndex((said) => said === line || said.startsWith(`${line} (`));
    const order = [`> ${SLOW}`, "slow-1", "slow-2", `> ${FAST}`, "fast"].map(at);
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(ran.out[at("slow-1") + 1]).toBe("slow-2");
  });

  // Plant: `stdio.stdout()` for both streams: fail-err moves to stdout, red.
  it("keeps what a part wrote to stderr on stderr, and to stdout on stdout", () => {
    const ran = run(FAIL);
    expect(ran.out).toContain("fail-out");
    expect(ran.out).not.toContain("fail-err");
    expect(ran.err).toContain("fail-err");
    expect(ran.err).not.toContain("fail-out");
  });

  // Plant: `failed` as every part (`ran.map(...)`, no filter): the passing part is named, red.
  it("names the failed parts last, and only them", () => {
    const ran = run(PASS, FAIL, "exit 1");
    expect(ran.out.some((line) => line.startsWith(`> ${FAIL} (failed, exit 3, `))).toBe(true);
    const summary = ran.err.slice(ran.err.findIndex((line) => line.startsWith("parallel: ")));
    expect(summary[0]).toMatch(/^parallel: 2 of 3 parts failed in [\d.]+ s:$/);
    expect(summary.slice(1)).toEqual([`  ${FAIL}`, "  exit 1", ""]);
  });
});
