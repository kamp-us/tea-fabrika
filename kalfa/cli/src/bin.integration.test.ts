// K12 and K20: the real `kalfa` command, `node bin.ts`, a real process, in a small repo written to disk. It is an
// integration file: it starts a process and writes to the local disk, so it runs in CI's full run and in a cloud box,
// never on the laptop (the host's test config refuses it by name). A stand-in cannot do this job: what these laws prove
// is that Node's resolve, `findPackageJSON`, `import()` and `runMain` behave as the in-memory `Packages` of run.test.ts
// says they do, and that standard output is whole when the process exits with a code that is not 0.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { flooded, kalfa, makeRepo } from "./bin.test-support.ts";

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
