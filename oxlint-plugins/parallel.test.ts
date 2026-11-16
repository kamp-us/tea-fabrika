// The runner `pnpm lint` goes through: it decides whether lint passed, so each law runs the real
// script over shell parts and reads its exit code and its output. The parts are generated: how
// each ends, what it writes to each stream, and how long it waits, so parts end in any order. Each
// spawns processes, so the runs are few. Each law was planted (the runner changed to break it, the
// law seen red) and restored; the plant is named beside it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import * as Rec from "effect/Record";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "parallel.ts");
const home = mkdtempSync(join(tmpdir(), "parallel-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const RUNS = { seed: 119120, numRuns: 6 };

/** Runs the runner over these parts in a folder of its own, for the files the parts make. */
const run = (parts: readonly string[], env: NodeJS.ProcessEnv = process.env) => {
  const cwd = mkdtempSync(join(home, "run-"));
  const ran = spawnSync(process.execPath, [SCRIPT, ...parts], { cwd, env, encoding: "utf8" });
  return { status: ran.status, out: ran.stdout.split("\n"), err: ran.stderr.split("\n") };
};

/** One generated part: how it ends, its lines on each stream, and its wait between them. */
type Part = {
  readonly code: number;
  readonly out: readonly string[];
  readonly err: readonly string[];
  readonly tenths: number;
};

const word = fc.stringMatching(/^[a-z0-9]{1,6}$/);

const part = fc.record({
  code: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 9 })),
  out: fc.array(word, { maxLength: 3 }),
  err: fc.array(word, { maxLength: 3 }),
  tenths: fc.integer({ min: 0, max: 3 }),
});

const parts = fc.array(part, { minLength: 1, maxLength: 4 });

/** Part `i`'s lines, each marked with its part and stream, so no two parts' lines are alike. */
const lines = (parts: readonly Part[]) =>
  parts.map((p, i) => ({
    out: p.out.map((w, j) => `p${i}o${j}${w}`),
    err: p.err.map((w, j) => `p${i}e${j}${w}`),
  }));

const marked = (line: string) => /^p\d+[oe]\d+/.test(line);

const printf = (written: readonly string[], to = "") =>
  written.length === 0 ? [] : [`printf '%s\\n' ${written.join(" ")}${to}`];

/** Part `i` as a shell command: its stdout lines, its wait, its stderr lines, its exit. */
const commands = (parts: readonly Part[]) =>
  lines(parts).map(({ out, err }, i) =>
    [...printf(out), `sleep 0.${parts[i]?.tenths ?? 0}`, ...printf(err, " >&2"), `exit ${parts[i]?.code ?? 0}`].join(
      "; ",
    ),
  );

const header = (said: readonly string[], command: string) =>
  said.findIndex((line) => line.startsWith(`> ${command} (`));

describe("parallel.ts, the runner pnpm lint goes through", () => {
  // Plant: end with `return;` in place of failing with the failed parts: exit 0, red.
  it("exits 1 when a part fails, and 0 when every part passes", () => {
    fc.assert(
      fc.property(parts, (generated) => {
        expect(run(commands(generated)).status).toBe(generated.some((p) => p.code !== 0) ? 1 : 0);
      }),
      RUNS,
    );
  });

  // Plant: wait for each forked part to end before the next starts (`Effect.tap(Fiber.await)` on
  // the fork): the first part waits 10 s for the other's file, gives up and exits 1, red.
  it("scenario: runs the parts at once: two parts that each wait for the other both pass", () => {
    const wait = (mine: string, theirs: string) =>
      `touch ${mine}; for i in $(seq 100); do [ -f ${theirs} ] && exit 0; sleep 0.1; done; exit 1`;
    const ran = run([wait("a", "b"), wait("b", "a")]);
    expect(ran.err).toEqual([""]);
    expect(ran.status).toBe(0);
  });

  // Plants, each red: join the fibers with `concurrency: "unbounded"`, so each part prints as it
  // ends; write each piece to stdout as it comes in `run`, so a part's lines leave its header.
  it("prints each part whole, in the order given, whatever order they end in", () => {
    fc.assert(
      fc.property(parts, (generated) => {
        const given = commands(generated);
        const ran = run(given);
        const at = given.map((command) => header(ran.out, command));
        expect(at.every((index) => index >= 0)).toBe(true);
        expect(at).toEqual(at.toSorted((a, b) => a - b));
        lines(generated).forEach(({ out }, i) => {
          const start = (at[i] ?? 0) + 1;
          expect(ran.out.slice(start, start + out.length)).toEqual(out);
        });
      }),
      RUNS,
    );
  });

  // Plant: `stdio.stdout()` for both streams: every stderr line moves to stdout, red.
  it("keeps what a part wrote to stderr on stderr, and to stdout on stdout, in the order given", () => {
    fc.assert(
      fc.property(parts, (generated) => {
        const ran = run(commands(generated));
        expect(ran.out.filter(marked)).toEqual(lines(generated).flatMap(({ out }) => out));
        expect(ran.err.filter(marked)).toEqual(lines(generated).flatMap(({ err }) => err));
      }),
      RUNS,
    );
  });

  // Plants, each red: `failed` as every part (no filter), so a passing part is named; the summary
  // without each part's last line.
  it("names the failed parts last, and only them, each with its last line of stderr, else of stdout", () => {
    fc.assert(
      fc.property(parts, (generated) => {
        const given = commands(generated);
        const ran = run(given);
        const failed = generated.flatMap((p, i) => (p.code === 0 ? [] : [i]));
        const said = lines(generated);

        if (failed.length === 0) {
          expect(ran.out.at(-2)).toMatch(new RegExp(`^parallel: ${given.length} parts passed in [\\d.]+ s$`));
          return;
        }

        const summary = ran.err.slice(ran.err.findIndex((line) => line.startsWith("parallel: ")));
        expect(summary[0]).toMatch(
          new RegExp(`^parallel: ${failed.length} of ${given.length} parts failed in [\\d.]+ s:$`),
        );
        const last = (i: number) => said[i]?.err.at(-1) ?? said[i]?.out.at(-1);
        const named = failed.flatMap((i) => {
          const line = last(i);
          const ended = `  ${given[i]} (failed, exit ${generated[i]?.code})`;
          return line === undefined ? [ended] : [ended, `    ${line}`];
        });
        expect(summary.slice(1)).toEqual([...named, ""]);
      }),
      RUNS,
    );
  });

  // Plant: the old `run`, where `handle.exitCode` failed on the signal, interrupted the output and
  // the catch called the part unstarted with code 127: its lines were gone, red.
  it("keeps a part's output when a signal kills it, and names the signal and 128 + n", () => {
    const signal = fc.constantFrom("HUP", "TERM", "KILL", "ABRT", "USR1", "USR2", "ALRM");
    fc.assert(
      fc.property(signal, word, word, (name, out, err) => {
        const command = `echo o-${out}; echo e-${err} >&2; kill -${name} $$`;
        const ran = run([command]);
        const n = Rec.toEntries(constants.signals).find(([signal]) => signal === `SIG${name}`)?.[1];
        const code = 128 + (n ?? 0);
        expect(ran.status).toBe(1);
        expect(ran.out).toContain(`o-${out}`);
        expect(ran.err).toContain(`e-${err}`);
        expect(ran.out[header(ran.out, command)]).toMatch(
          new RegExp(`\\(failed, killed by SIG${name}, exit ${code}, [\\d.]+ s\\)$`),
        );
      }),
      // The review of pull request 1281: an aborted part (SIGABRT, as Node's heap running out ends
      // it) lost its output and was called unstarted.
      { ...RUNS, examples: [["ABRT", "heap", "oom"]] },
    );
  });

  // Plant: catch a spawn failure as a part that ended with exit 127: the header loses
  // "could not start", red.
  it("scenario: a part that cannot start says so, and is named as failed", () => {
    const ran = run(["echo never"], { ...process.env, PATH: "" });
    expect(ran.status).toBe(1);
    expect(ran.out.some((line) => line.startsWith("> echo never (could not start: "))).toBe(true);
    expect(ran.err.at(-3)).toMatch(/^parallel: 1 of 1 parts failed in [\d.]+ s:$/);
  });
});
