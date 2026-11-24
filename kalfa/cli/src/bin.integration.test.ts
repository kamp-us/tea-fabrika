// K12, K20, K22 and K23: the real `kalfa` command, `node bin.ts`, a real process, in a small repo written to disk. It is an
// integration file: it starts a process and writes to the local disk, so it runs in CI's full run and in a cloud box,
// never on the laptop (the host's test config refuses it by name). A stand-in cannot do this job: what these laws prove
// is that Node's resolve, `findPackageJSON`, `import()` and `runMain` behave as the in-memory `Packages` of run.test.ts
// says they do, and that standard output is whole when the process exits with a code that is not 0.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { closedPipe, flooded, kalfa, makeRepo, stopped } from "./bin.test-support.ts";

// K12. Plant: resolve from where `@kalfa/cli` is installed (`import.meta.resolve`), and the repo's package is not found;
// read a dependency's manifest through `resolve("<name>/package.json")`, and the package that exports none stops the
// start with exit code 2; take the package's `import` condition as its entry, and the refused start goes on.
it.effect(
  "K12 scenario: in a repo on disk the subcommand's line and report come out on their own streams and the command ends 1",
  () =>
    Effect.gen(function* () {
      // scenario: the real binary, a real process and a repo on disk; what it proves is that Node's resolve,
      // `findPackageJSON`, `import()` and `runMain` do what the in-memory stand-in does.
      const folder = yield* makeRepo(["leak", "leftPad"]);
      const run = yield* kalfa(folder, ["leak", "check"]);

      expect(run.stdout).toBe("checked 2 files\n");

      expect(run.stderr).toBe(
        "docs/setup.md:12: error leak/key-shape: A line has the shape of a private key. Hint: Remove the key and rotate it.\n",
      );

      expect(run.code).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "K12 scenario: a package whose entry is exported under an import condition only stops the start, naming it, with exit code 2",
  () =>
    Effect.gen(function* () {
      // scenario: Node's own resolve is what refuses an entry with no `default` condition; no stand-in is Node.
      const folder = yield* makeRepo(["leak", "leftPad", "importOnly"]);
      const run = yield* kalfa(folder, ["leak", "check"]);

      expect(run.stdout).toBe("");

      expect(run.stderr).toBe(
        'kalfa: @demo/mod names ./cli in its kalfa.cli field, but its exports give that path no "default" condition, so kalfa cannot load it.\n',
      );

      expect(run.code).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// K20, ticket 2302. A pipe holds about 64 KB, so a handler that writes a few megabytes and then ends with a code that is
// not 0 meets the exit while most of it is still waiting to be read. Plant: leave out the drain in `bin.ts`, so that
// the exit goes straight to `process.exit`; on macOS, where a pipe is written asynchronously, the reader gets less than
// was written. On Linux a pipe is written at once, so there this law cannot turn red for the drain (see the plan's
// "What this cannot tell us").
const LINES = 60_000;

for (const [end, code] of [
  ["report", 1],
  ["fail", 2],
] as const) {
  it.effect(
    `K20 scenario: ${LINES} lines on standard output are all read through a pipe when the command ends ${code}`,
    () =>
      Effect.gen(function* () {
        // scenario: only a real process, a real pipe and a real exit show whether output is cut at exit.
        const folder = yield* makeRepo(["leak"]);
        const run = yield* kalfa(folder, ["leak", "flood", String(LINES), end]);

        expect(run.code).toBe(code);
        expect(run.stdout.length, "every byte of standard output was read").toBe(flooded(LINES).length);
        expect(run.stdout).toBe(flooded(LINES));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}

// K20, standard error. `bin.ts` waits for standard error as it waits for standard output, so a handler that writes a few
// megabytes there, to a reader that is slow, meets the exit with most of it unread. One more line than K20's: the count
// is not a round number. Plant: leave out the wait for standard error in `bin.ts` (the `process.stderr.write` inside the
// callback of the standard output's), and on macOS the reader gets less than was written.
const ERROR_LINES = 60_001;

const FLOOD_ENDS = [
  [
    "report",
    1,
    "docs/setup.md: error leak/key-shape: A line has the shape of a private key. Hint: Remove the key and rotate it.\n",
  ],
  ["fail", 2, "kalfa: the flood stopped\n"],
] as const;

for (const [end, code, last] of FLOOD_ENDS) {
  it.effect(
    `K20 scenario: ${ERROR_LINES} lines on standard error are all read by a slow reader when the command ends ${code}`,
    () =>
      Effect.gen(function* () {
        // scenario: only a real process, a real pipe and a reader that waits show whether output is cut at exit.
        const folder = yield* makeRepo(["leak"]);
        const run = yield* kalfa(folder, ["leak", "flood-err", String(ERROR_LINES), end], "2 millis");

        expect(run.code).toBe(code);
        expect(run.stdout).toBe("");
        expect(run.stderr.length, "every byte of standard error was read").toBe(
          flooded(ERROR_LINES).length + last.length,
        );
        expect(run.stderr).toBe(flooded(ERROR_LINES) + last);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}

// K22. A reader that closes early, as in `kalfa --help | head -n 1`, is the reader's business: Node's write to a closed pipe
// is an `EPIPE` error event on the stream, which, with no listener, ends the process with a stack that holds a path of this
// machine and exit code 1. The run's own exit code stands, and the stream that stayed open holds what the run wrote there,
// whole. A command that reports an error ends 1 on its own, so the rows that tell are the ones that end otherwise.
// Plants: `bin.ts` as built has no listener for the `error` of either stream, so the `--help` and `flood` rows end 1 with a
// stack and the `warn` row ends 1. With a listener on both that ignores `EPIPE` every row holds. Listen on `process.stderr`
// only, and the rows on a closed standard output are red again; on `process.stdout` only, and the `warn` row is.
const STACK = /EPIPE|^\s+at |node:internal/m;

// An absolute path: a slash that does not follow a word, then a part and another slash.
const ABSOLUTE = /(?<![\w.@-])\/[\w.@-]+\//;

const CLOSED_ROWS = [
  // The help text goes out, the reader has gone, and the run ends 0 with nothing on standard error.
  { closed: "stdout", args: ["--help"], code: 0, kept: "" },
  // A long output on the closed stream: the handler's failure line still reaches standard error, and the code is 2, not 1.
  { closed: "stdout", args: ["leak", "flood", "60000", "fail"], code: 2, kept: "kalfa: the flood stopped\n" },
  {
    closed: "stdout",
    args: ["leak", "check"],
    code: 1,
    kept: "docs/setup.md:12: error leak/key-shape: A line has the shape of a private key. Hint: Remove the key and rotate it.\n",
  },
  // A warning goes to standard error and the run ends 0; with that stream closed it still ends 0.
  { closed: "stderr", args: ["leak", "warn"], code: 0, kept: "" },
  { closed: "stderr", args: ["leak", "check"], code: 1, kept: "checked 2 files\n" },
] as const;

for (const row of CLOSED_ROWS) {
  it.effect(
    `K22 scenario: a reader of standard ${row.closed} that closes early leaves the run's code ${row.code} and no stack, for ${row.args.join(" ")}`,
    () =>
      Effect.gen(function* () {
        // scenario: only a real pipe whose reader has gone gives `EPIPE`; a stand-in stream cannot.
        const folder = yield* makeRepo(["leak"]);
        const run = yield* closedPipe(folder, row.args, row.closed);

        expect(run.kept).not.toMatch(STACK);
        expect(run.kept).not.toMatch(ABSOLUTE);
        expect(run.kept).toBe(row.kept);
        expect(run.code).toBe(row.code);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}

// K23. Ctrl-C and a plain `kill` are each a signal Effect's `runMain` turns into the run's interruption, which says so once
// on standard error and ends 2. Plant: take out the `Effect.onInterrupt` of `main` (the stopped line): the line is not
// printed and standard error is empty.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  it.effect(`K23 scenario: ${signal} stops a run with one line on standard error and exit code 2`, () =>
    Effect.gen(function* () {
      // scenario: only a real process gets a real signal, and `runMain` installs the handler for it.
      const folder = yield* makeRepo(["leak"]);
      const run = yield* stopped(folder, signal);

      expect(run.ready).toBe("ready");
      expect(run.stderr).toBe("kalfa: kalfa was stopped.\n");
      expect(run.code).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}
