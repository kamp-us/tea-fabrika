// Ticket 766, today's tooling (0113, 0410, following next/'s rules by 0033): `pnpm typecheck`'s
// program on its test layers. Nothing here starts a process, takes the machine's lock or touches
// node_modules: LocksTest, CommandsTest, ProcessesTest and NodeModulesTest stand in, and a spawner in
// memory stands in for pgrep and ps. The laws that start real processes are in
// typecheck.integration.test.ts and caps.test.ts.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { ConfigProvider, Effect, Fiber, Layer, PlatformError, Schema, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { TestClock, TestConsole } from "effect/testing";
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

// The old oneof weights were 3 success, 1 nonzero code, 1 signal. Repeated union members keep them.
const Success = Schema.TaggedStruct("exited", { code: Schema.Literal(0) });

const End = Schema.Union([
  Success,
  Success,
  Success,
  Schema.TaggedStruct("exited", { code: Schema.Literals([1, 2, 127]) }),
  Schema.TaggedStruct("signaled", { signal: Schema.Literals(["SIGINT", "SIGKILL", "SIGTERM"]) }),
]);

const Found = Schema.Struct({
  pid: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 99_999 })),
  args: Schema.Literals(["tsgo --lsp --stdio", "tsgo -p next/tsconfig.json", "node_modules/.bin/tsgo --watch", ""]),
});

/** pgrep refuses, or lists at most three distinct pids for zero through three extra polls. */
const Pgrep = Schema.TaggedUnion({
  refused: {},
  listed: {
    found: Schema.Array(Found).check(
      Schema.isMaxLength(3),
      Schema.makeFilter<ReadonlyArray<typeof Found.Type>>(
        (rows) => new Set(rows.map((row) => row.pid)).size === rows.length,
        { arbitraryConstraint: { uniqueBy: (row: typeof Found.Type) => row.pid } },
      ),
    ),
    polls: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
  },
});

const Run = Schema.Struct({
  shape: Shape,
  install: Schema.Struct({ ended: End, leavesFolder: Schema.Boolean }),
  patch: End,
  check: End,
  ci: Schema.Boolean,
  lock: Schema.UndefinedOr(Schema.Literal("/tmp/tc-law/typecheck.lock")),
  compiler: Schema.UndefinedOr(Schema.Literal("tcwlaw")),
  pgrep: Pgrep,
});

type Run = typeof Run.Type;

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
    asked = Pgrep.match(r.pgrep, {
      refused: () => {
        lines.push(`typecheck: pgrep cannot list processes here, so the wait for a running ${compiler} is skipped`);
        return [compiler];
      },
      listed: ({ found: listed, polls }) => {
        const waited = listed.filter((f) => !f.args.split(" ").includes("--lsp"));

        if (waited[0] !== undefined) {
          const holder = waited[0].args === "" ? `pid ${waited[0].pid}` : `pid ${waited[0].pid} (${waited[0].args})`;
          lines.push(`typecheck: waiting for ${holder}, a ${compiler} already running`);
        }

        return Array.from({ length: listed.length === 0 ? 1 : waited.length === 0 ? 1 : polls + 2 }, () => compiler);
      },
    });
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
  const listings = Pgrep.match(r.pgrep, {
    refused: () => [Listing.cases.refused.make({})],
    listed: ({ found: listed, polls }) => [
      ...Array.from({ length: polls + 1 }, () => Listing.cases.listed.make({ pids: listed.map((f) => f.pid) })),
      Listing.cases.listed.make({ pids: [] }),
    ],
  });
  const table = ProcessesTest.table(listings);

  if (Pgrep.guards.listed(r.pgrep)) {
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

describe("T766 the typecheck's program on its test layers, today's tooling", () => {
  const seen = new Set<string>();
  let coverageRegistered = false;
  const checkCoverage = () => {
    expect([...seen].toSorted()).toEqual(
      ["a line", "failed", "folder", "link", "missing", "other", "passed", "signaled", "silent"].toSorted(),
    );
  };
  // N1. Plants: release before the last command; wait on --lsp; hide a refused pgrep; patch before unlink.
  it.effect.prop(
    "property: the commands run in order under one lock, with today's lines and exit code",
    { run: Run },
    ({ run }, ctx) => {
      if (!coverageRegistered) {
        coverageRegistered = true;
        ctx.onTestFinished(checkCoverage);
      }

      return Effect.map(actual(run), (got) => {
        const want = expected(run);
        seen.add(run.shape);
        seen.add(want.code === 0 ? "passed" : want.code > 128 ? "signaled" : "failed");
        seen.add(want.lines.length > 0 ? "a line" : "silent");
        expect(got).toEqual(want);
      });
    },
    { arbitrary: { runs: runsFor({ fast: 100, full: 300 }) } },
  );
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
        const standard = ChildProcess.isStandardCommand(command);
        const cmd = standard ? command.command : "";
        const args = standard ? command.args.map(String) : [];
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
  // line; ps right-aligns etime as [[dd-]hh:]mm:ss), plus Darwin output captured on 2026-11-17
  // from one bounded Node child that exited naturally: pgrep exits 0/1/2, args and 00:01 etime.
  // The spawner replays saved output, not the real Mac adapter. Plant: read pgrep's exit 2 as
  // listed, so refused is lost.
  it.effect("vector: pgrep's exit 0 lists its pids, exit 1 lists none, and 2 or more, or no pgrep, is refused", () =>
    Effect.forEach(
      [
        [{ out: "4101\n4102\n", code: 0 }, Listing.cases.listed.make({ pids: [4101, 4102] }), "tsgo"],
        [{ out: "", code: 1 }, Listing.cases.listed.make({ pids: [] }), "tsgo"],
        [{ out: "", code: 2 }, Listing.cases.refused.make({}), "tsgo"],
        [{ out: "", code: 3 }, Listing.cases.refused.make({}), "tsgo"],
        ["missing", Listing.cases.refused.make({}), "tsgo"],
        [{ out: "12334\n", code: 0 }, Listing.cases.listed.make({ pids: [12334] }), "tc_n6_capture"],
        [{ out: "", code: 1 }, Listing.cases.listed.make({ pids: [] }), "tc_n6_absent"],
        [{ out: "", code: 2 }, Listing.cases.refused.make({}), "["],
      ] as const,
      ([ran, want, name]) =>
        Effect.map(
          onPs(
            (cmd, args) =>
              cmd === "pgrep" && args.includes("-x") && args.at(-1) === name ? ran : { out: "", code: 99 },
            (p) => p.named(name),
          ),
          ({ value }) => expect(value).toEqual(want),
        ),
      { concurrency: 1, discard: true },
    ),
  );

  // Plant: remove only the newline, leaving the captured Mac command's two trailing spaces.
  it.effect("vector: ps -o args= gives the command line trimmed, and an empty one where ps cannot read it", () =>
    Effect.forEach(
      [
        [{ out: "node -e setTimeout(()=>{},3000)\n", code: 0 }, "node -e setTimeout(()=>{},3000)"],
        [{ out: "tsgo --lsp --stdio\n", code: 0 }, "tsgo --lsp --stdio"],
        [{ out: "tc_n6_capture  \n", code: 0 }, "tc_n6_capture"],
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

  // Plant: reject etime's zero-minute form, losing the captured Mac child's start time.
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
          ["00:01\n", 1],
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
