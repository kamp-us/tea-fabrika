// Ticket 766, today's tooling (0113, 0410, following next/'s rules by 0033): `pnpm typecheck`'s
// program on its test layers. Nothing here starts a process, takes the machine's lock or touches
// node_modules: LocksTest, CommandsTest, ProcessesTest and NodeModulesTest stand in, and a spawner in
// memory stands in for pgrep and ps. The laws that start real processes are in
// typecheck.integration.test.ts and caps.test.ts.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { ConfigProvider, Effect, Fiber, Layer, PlatformError, Schema, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { TestClock, TestConsole } from "effect/testing";
import fc from "fast-check";
import { Ended } from "./typecheck/Commands.ts";
import * as CommandsTest from "./typecheck/CommandsTest.ts";
import * as LocksTest from "./typecheck/LocksTest.ts";
import { Liveness } from "./typecheck/Look.ts";
import { Shape } from "./typecheck/NodeModules.ts";
import * as NodeModulesTest from "./typecheck/NodeModulesTest.ts";
import { Listing, Processes } from "./typecheck/Processes.ts";
import * as ProcessesPs from "./typecheck/ProcessesPs.ts";
import * as ProcessesTest from "./typecheck/ProcessesTest.ts";
import * as Typecheck from "./typecheck/Typecheck.ts";

const INSTALL = "pnpm install --offline --frozen-lockfile";
const PATCH = "pnpm exec effect-tsgo patch --typescript";
const CHECK = "pnpm -r typecheck --incremental --tsBuildInfoFile node_modules/.cache/tsc/typecheck.tsbuildinfo";
const LOCK = "/tmp/fabrika-typecheck.lock";
// The signals a command is generated to end on, with their numbers on Linux and macOS alike.
const SIGNALS = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 } as const;

/** Moves the test clock on until `fiber` ends, so the compiler wait's one-second polls run. */
const drive = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.gen(function* () {
    for (let step = 0; step < 400 && fiber.pollUnsafe() === undefined; step += 1) {
      yield* TestClock.adjust("250 millis");
    }

    return yield* Fiber.join(fiber);
  });

/** One way a command ends. */
const ended = fc.oneof(
  { weight: 3, arbitrary: fc.constant(Ended.cases.exited.make({ code: 0 })) },
  fc.constantFrom(1, 2, 127).map((code) => Ended.cases.exited.make({ code })),
  fc.constantFrom(...Object.keys(SIGNALS)).map((signal) => Ended.cases.signaled.make({ signal })),
);

/** A process pgrep finds under the compiler's name: an editor's language server, a compiler, or one ps cannot read. */
const found = fc.record({
  pid: fc.integer({ min: 2, max: 99_999 }),
  args: fc.constantFrom("tsgo --lsp --stdio", "tsgo -p next/tsconfig.json", "node_modules/.bin/tsgo --watch", ""),
});

const run = fc.record({
  shape: fc.constantFrom(...Shape.literals),
  install: fc.record({ ended, leavesFolder: fc.boolean() }),
  patch: ended,
  check: ended,
  ci: fc.boolean(),
  lock: fc.option(fc.constantFrom("/tmp/tc-law/typecheck.lock"), { nil: undefined }),
  compiler: fc.option(fc.constantFrom("tcwlaw"), { nil: undefined }),
  pgrep: fc.oneof(
    fc.constant({ _tag: "refused" as const }),
    fc.record({
      _tag: fc.constant("listed" as const),
      found: fc.uniqueArray(found, { selector: (f) => f.pid, maxLength: 3 }),
      polls: fc.integer({ min: 0, max: 3 }),
    }),
  ),
});

type Run = typeof run extends fc.Arbitrary<infer R> ? R : never;

const status = (e: Ended) =>
  Ended.match(e, {
    exited: ({ code }) => code,
    signaled: ({ signal }) => 128 + SIGNALS[signal as keyof typeof SIGNALS],
  });

/** What today's typecheck.sh does with this run: its log under the lock, its lines and its exit code. */
const expected = (r: Run) => {
  const lock = r.lock ?? LOCK,
    compiler = r.compiler ?? "tsgo";

  if (r.shape === "other") {
    return {
      log: [],
      lines: ["typecheck: node_modules is no folder; remove it and run pnpm install --offline --frozen-lockfile"],
      code: 1,
      asked: [],
    };
  }

  const lines: Array<string> = [];
  let asked: Array<string> = [];

  if (!r.ci) {
    if (r.pgrep._tag === "refused") {
      asked = [compiler];
      lines.push(`typecheck: pgrep cannot list processes here, so the wait for a running ${compiler} is skipped`);
    } else {
      const waited = r.pgrep.found.filter((f) => !f.args.split(" ").includes("--lsp"));
      asked = Array.from(
        { length: r.pgrep.found.length === 0 ? 1 : waited.length === 0 ? 1 : r.pgrep.polls + 2 },
        () => compiler,
      );

      if (waited[0] !== undefined) {
        const holder = waited[0].args === "" ? `pid ${waited[0].pid}` : `pid ${waited[0].pid} (${waited[0].args})`;
        lines.push(`typecheck: waiting for ${holder}, a ${compiler} already running`);
      }
    }
  }

  const log = [`hold ${lock}`];
  const linked = r.shape === "link";
  const commands = linked
    ? ([
        [INSTALL, r.install.ended],
        [PATCH, r.patch],
        [CHECK, r.check],
      ] as const)
    : ([
        [PATCH, r.patch],
        [CHECK, r.check],
      ] as const);

  if (linked) {
    log.push("unlink");
  }

  let code = 0,
    pid = 7000;

  for (const [command, end] of commands) {
    pid += 1;
    log.push(`run ${command}`, `running ${pid}`, `ended ${command}`, "running none");
    code = status(end);

    if (command === INSTALL && code === 0 && !r.install.leavesFolder) {
      code = 1;
    }

    if (code !== 0) {
      if (command === INSTALL) {
        lines.push(
          "typecheck: node_modules was a link and is removed, but the offline install failed; run pnpm install --frozen-lockfile",
        );
      }

      break;
    }
  }

  log.push(`release ${lock}`);
  return { log, lines, code, asked };
};

/** The same run on the test layers: the log, the lines on stderr, the exit code and pgrep's names. */
const actual = (r: Run) => {
  const log: Array<string> = [];
  const folder = NodeModulesTest.folder(r.shape, log);
  const locks = LocksTest.taken(log);
  const commands = CommandsTest.script(
    {
      install: { ended: r.install.ended, leavesFolder: r.install.leavesFolder },
      patch: { ended: r.patch },
      check: { ended: r.check },
    },
    log,
    folder,
  );
  const listings =
    r.pgrep._tag === "refused"
      ? [Listing.cases.refused.make({})]
      : [
          ...Array.from({ length: r.pgrep.polls + 1 }, () =>
            Listing.cases.listed.make({ pids: r.pgrep._tag === "listed" ? r.pgrep.found.map((f) => f.pid) : [] }),
          ),
          Listing.cases.listed.make({ pids: [] }),
        ];
  const table = ProcessesTest.table(listings);

  if (r.pgrep._tag === "listed") {
    for (const f of r.pgrep.found) {
      table.running.set(f.pid, 1_000);
      table.args.set(f.pid, f.args);
    }
  }

  const env: Record<string, string> = { PATH: "/usr/bin:/bin" };

  if (r.ci) {
    env["CI"] = "true";
  }

  if (r.lock !== undefined) {
    env["FABRIKA_TYPECHECK_LOCK"] = r.lock;
  }

  if (r.compiler !== undefined) {
    env["FABRIKA_TYPECHECK_COMPILER"] = r.compiler;
  }

  const layer = Layer.mergeAll(
    LocksTest.layer(locks),
    CommandsTest.layer(commands),
    ProcessesTest.layer(table, 4101),
    NodeModulesTest.layer(folder),
    ConfigProvider.layer(ConfigProvider.fromEnvRecord(env)),
    TestConsole.layer,
    TestClock.layer(),
  );
  return Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Typecheck.program);
    const code = yield* drive(fiber);
    const lines = (yield* TestConsole.errorLines).map(String);
    return { log, lines, code, asked: table.asked };
  }).pipe(Effect.provide(layer));
};

/** fast-check's report, with its counterexample, as the law's typed failure. */
class PropertyFailed extends Schema.TaggedError<PropertyFailed>()("PropertyFailed", { cause: Schema.Defect() }) {}

describe("T766 the typecheck's program on its test layers, today's tooling", () => {
  // N1. Plants (each run once, recorded in the tests run row): release the lock before the last
  // command; print the wait for an `--lsp` process; read `refused` as none in silence; patch
  // before `unlink`.
  it("property: the commands run in order under one lock, with today's lines and exit code", () => {
    const seen = new Set<string>();
    const law = (r: Run) =>
      Effect.map(actual(r), (got) => {
        const want = expected(r);
        seen.add(r.shape);
        seen.add(want.code === 0 ? "passed" : want.code > 128 ? "signaled" : "failed");
        seen.add(want.lines.length > 0 ? "a line" : "silent");
        expect(got).toEqual(want);
      });
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
    return Effect.runPromise(
      Effect.gen(function* () {
        // fast-check's own report, its counterexample included, is the failure the test shows.
        yield* Effect.orDie(
          // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property runs on Promises
          Effect.tryPromise({
            try: () =>
              fc.assert(
                // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits the Promise a property hands back
                fc.asyncProperty(run, (r) => Effect.runPromise(law(r))),
                { seed: 119120, numRuns: runsFor({ fast: 100, full: 300 }), endOnFailure: true },
              ),
            catch: (cause) => new PropertyFailed({ cause }),
          }),
        );
        // Coverage: every shape, each way a run ends, and runs with and without a line.
        expect([...seen].toSorted()).toEqual(
          ["a line", "failed", "folder", "link", "missing", "other", "passed", "signaled", "silent"].toSorted(),
        );
      }),
    );
  });
});

/** What one made-up pgrep or ps run prints and how it exits, or `missing` for a command not on PATH. */
type Ran = { readonly out: string; readonly code: number } | "missing";

/** A spawner that answers each command by `answer`, and keeps each command line it was asked. */
const spawner = (answer: (cmd: string, args: ReadonlyArray<string>) => Ran) => {
  const calls: Array<string> = [];
  const text = (s: string) => Stream.make(new TextEncoder().encode(s));
  const layer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.suspend(() => {
        const cmd = command._tag === "StandardCommand" ? command.command : "";
        const args = command._tag === "StandardCommand" ? command.args.map(String) : [];
        calls.push([cmd, ...args].join(" "));
        const ran = answer(cmd, args);

        if (ran === "missing") {
          return Effect.fail(
            PlatformError.systemError({
              _tag: "NotFound",
              module: "ChildProcess",
              method: "spawn",
              pathOrDescriptor: cmd,
            }),
          );
        }

        return Effect.succeed(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(27000),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(ran.code)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            stdin: Sink.drain,
            stdout: text(ran.out),
            stderr: text(""),
            all: text(ran.out),
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void),
          }),
        );
      }),
    ),
  );
  return { calls, layer };
};

/**
 * Runs `use` on ProcessesPs.layer over a spawner that answers by `answer`, at test-clock time `now`,
 * and hands back its answer and the command lines the spawner was asked.
 */
const onPs = <A>(
  answer: (cmd: string, args: ReadonlyArray<string>) => Ran,
  use: (p: Processes["Service"]) => Effect.Effect<A>,
  now = 1_800_000_000_000,
) => {
  const fake = spawner(answer);
  return Effect.gen(function* () {
    yield* TestClock.setTime(now);
    const value = yield* use(yield* Processes);
    return { value, calls: fake.calls };
  }).pipe(Effect.provide(Layer.provide(ProcessesPs.layer, fake.layer)));
};

// A pid no machine here has: Linux's pid_max is at most 2^22, macOS's 99,998, so kill(pid, 0) says ESRCH.
const NO_PID = 2 ** 22 + 7;

describe("T766 ProcessesPs reads pgrep and ps as they print, today's tooling", () => {
  // N6. Vectors: pgrep -x and ps -o as procps-ng 4.0.4 printed them on Linux, 2026-11-16 (a pid per
  // line; ps right-aligns etime as [[dd-]hh:]mm:ss). macOS's ps(1) documents the same etime form;
  // no macOS output was captured for these vectors. Plant: read pgrep's exit 2 as listed, so
  // refused is lost.
  it.effect("vector: pgrep's exit 0 lists its pids, exit 1 lists none, and 2 or more, or no pgrep, is refused", () =>
    Effect.forEach(
      [
        [{ out: "4101\n4102\n", code: 0 }, Listing.cases.listed.make({ pids: [4101, 4102] })],
        [{ out: "", code: 1 }, Listing.cases.listed.make({ pids: [] })],
        [{ out: "", code: 2 }, Listing.cases.refused.make({})],
        [{ out: "", code: 3 }, Listing.cases.refused.make({})],
        ["missing", Listing.cases.refused.make({})],
      ] as const,
      ([ran, want]) =>
        Effect.map(
          onPs(
            (cmd, args) =>
              cmd === "pgrep" && args.includes("-x") && args.at(-1) === "tsgo" ? ran : { out: "", code: 99 },
            (p) => p.named("tsgo"),
          ),
          ({ value }) => expect(value).toEqual(want),
        ),
      { concurrency: 1, discard: true },
    ),
  );

  it.effect("vector: ps -o args= gives the command line trimmed, and an empty one where ps cannot read it", () =>
    Effect.forEach(
      [
        [{ out: "node -e setTimeout(()=>{},3000)\n", code: 0 }, "node -e setTimeout(()=>{},3000)"],
        [{ out: "tsgo --lsp --stdio\n", code: 0 }, "tsgo --lsp --stdio"],
        [{ out: "", code: 1 }, ""],
        ["missing", ""],
      ] as const,
      ([ran, want]) =>
        Effect.map(
          onPs(
            (cmd, args) =>
              cmd === "ps" && args.includes("args=") && args.includes("4101") ? ran : { out: "", code: 99 },
            (p) => p.args(4101),
          ),
          ({ value }) => expect(value).toEqual(want),
        ),
      { concurrency: 1, discard: true },
    ),
  );

  it.effect(
    "vector: a running pid's start is now less ps's etime, none where ps cannot read it, and a gone pid asks ps nothing",
    () => {
      const now = 1_800_000_000_000;
      const self = process.pid;
      const etime =
        (out: string, code = 0) =>
        (cmd: string, args: ReadonlyArray<string>) =>
          cmd === "ps" && args.includes("etime=") && args.includes(String(self))
            ? { out, code }
            : { out: "", code: 99 };
      return Effect.gen(function* () {
        for (const [out, seconds] of [
          ["      18:16\n", 18 * 60 + 16],
          ["   02:03:04\n", 2 * 3600 + 3 * 60 + 4],
          [" 1-02:03:04\n", 86_400 + 2 * 3600 + 3 * 60 + 4],
        ] as const) {
          const { value } = yield* onPs(etime(out), (p) => p.liveness(self), now);
          expect(value).toEqual(Liveness.cases.running.make({ startedAt: now - seconds * 1000 }));
        }

        const unread = yield* onPs(etime("", 1), (p) => p.liveness(self), now);
        expect(unread.value).toEqual(Liveness.cases.running.make({}));
        const gone = yield* onPs(etime("      18:16\n"), (p) => p.liveness(NO_PID), now);
        expect(gone.value).toEqual(Liveness.cases.gone.make({}));
        expect(gone.calls).toEqual([]);
      });
    },
  );

  it.effect("vector: self is this process's pid", () =>
    Effect.map(
      onPs(
        () => ({ out: "", code: 99 }),
        (p) => Effect.succeed(p.self),
      ),
      ({ value }) => expect(value).toBe(process.pid),
    ),
  );
});
