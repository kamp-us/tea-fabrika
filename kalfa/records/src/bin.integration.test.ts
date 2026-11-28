// B4, B5 and B6 of .kalfa/quests/kalfa-records-bin-flush-PLAN.md (ticket 2302): the real `records` bin, `node bin.ts`, a real process,
// in a small git repo written to disk. It is an integration file: it starts a process and writes to the local disk, so it
// runs in CI's full run and in a cloud box, never on the laptop (the host's test config refuses it by name). A stand-in cannot do
// this job: what these laws prove is that Node's real stream on a real pipe behaves as Teardown.test.ts's stand-in does, and that
// `runMain`'s real `process.exit` waits for the teardown. B1 to B3 (Teardown.test.ts) run the same wait on a stand-in on every
// pull request.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { bin, closedPipe, dangling, makeRepo, printed } from "./bin.test-support.ts";

// Twenty thousand links make a few megabytes of findings, over forty times what a pipe holds (about 64 KB).
const LINKS = 20_000;

// B4, ticket 2302. Plant: put back `onExit(code)` at once in `bin.ts` (`teardown: (exit, onExit) => onExit(...)`): `runMain` calls
// `process.exit(1)` while most of the output is still in Node's own buffer. On macOS, where a pipe is written asynchronously, a
// reader that starts one second late gets less than was written, so the law is red. On Linux a pipe is written at once, so there
// this law cannot turn red for the drain (see the plan's "What this cannot tell us"); B1 to B3 are the laws that can.
// `it.live`: the late reader sleeps, and `it.effect` runs on a TestClock that never moves on its own.
it.live(
  `B4 scenario: ${LINKS} findings on standard output are all read by a late reader through a pipe, and the bin ends 1`,
  () =>
    Effect.gen(function* () {
      // scenario: only a real process, a real pipe and a reader that waits show whether output is cut at exit.
      const files = dangling(LINKS);
      const folder = yield* makeRepo(files);
      const expected = yield* printed(["check", "runbook"], files);
      const run = yield* bin(folder, ["check", "runbook"], "1 second");

      expect(run.code).toBe(1);
      expect(run.stderr).toBe("");
      expect(run.stdout.length, "every byte of standard output was read").toBe(expected.length);
      expect(run.stdout).toBe(expected);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// B5. The bin keeps its codes. Plant: make the teardown answer 1 for anything that is not 0, and `check nope` ends 1. Dropping
// the `isSuccess` check is no plant here: a failed `Exit` has no `value`, and `bin.ts` turns `check nope` into a success of 2.
const CLEAN = [["check"], ["check", "runbook"]] as const;

for (const args of CLEAN) {
  it.effect(
    `B5 scenario: ${args.join(" ")} ends 0 with nothing on either stream on a repo with nothing to report`,
    () =>
      Effect.gen(function* () {
        // scenario: the exit code of a real process is what `runMain` does with the teardown's answer; no stand-in is `runMain`.
        const folder = yield* makeRepo({
          "AGENTS.md": "# Map\n",
          ".kalfa/runbooks/README.md": "---\nsummary: a page\n---\n",
        });

        const run = yield* bin(folder, args);

        expect(run.stdout).toBe("");
        expect(run.stderr).toBe("");
        expect(run.code).toBe(0);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}

it.effect("B5 scenario: a check that does not exist ends 2", () =>
  Effect.gen(function* () {
    // scenario: the same, for a run that does not succeed with a number.
    const folder = yield* makeRepo({ "AGENTS.md": "# Map\n" });
    const run = yield* bin(folder, ["check", "nope"]);

    expect(run.code).toBe(2);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// B6. A reader that closes early, as in `records check runbook | head -n 1`, is the reader's business: Node's write to a closed
// pipe is an `EPIPE` error event on the stream, which, with no listener, ends the process with a stack that holds a path of this
// machine. The run's own exit code stands. Plant: drop the `error` listeners in `Teardown.ts`: the stack is on standard error,
// on Linux and on macOS.
const STACK = /EPIPE|^\s+at |node:internal/m;

// An absolute path: a slash that does not follow a word, then a part and another slash.
const ABSOLUTE = /(?<![\w.@-])\/[\w.@-]+\//;

it.effect(
  "B6 scenario: a reader of standard output that closes after one line leaves the code 1 and no stack on standard error",
  () =>
    Effect.gen(function* () {
      // scenario: only a real pipe whose reader has gone gives `EPIPE`; a stand-in stream cannot.
      const folder = yield* makeRepo(dangling(LINKS));
      const run = yield* closedPipe(folder, ["check", "runbook"]);

      expect(run.kept).not.toMatch(STACK);
      expect(run.kept).not.toMatch(ABSOLUTE);
      expect(run.kept).toBe("");
      expect(run.code).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
