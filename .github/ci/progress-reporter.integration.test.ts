// Today's CI diagnostics. Real Vitest and SIGKILL proof belongs only on disposable CI.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Cause, Clock, Console, Deferred, Effect, Exit, Fiber, FileSystem, Path, Queue, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { collect, legOf, markdown, Unread, type Io, type Timings } from "./time-table.ts";

const ready = "CI_PROGRESS_READY\n";

type Mode = "normal" | "cutoff" | "timeout";

const probe = Effect.fnUntraced(function* (mode: Mode, diagnostic: "on" | "off" | "unwritable" = "on", cases = 1) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = path.resolve(".");

  const scratch = yield* fs.makeTempDirectoryScoped({
    directory: path.join(root, "node_modules"),
    prefix: ".ci-progress-",
  });

  const home = path.join(scratch, "home");
  yield* fs.makeDirectory(home);
  const report = path.join(scratch, "results.json");
  const config = path.join(scratch, "vitest.config.ts");
  const file = path.join(scratch, "probe.test.ts");
  const enabled = diagnostic !== "off";
  const temp = diagnostic === "unwritable" ? config : scratch;
  yield* fs.writeFileString(
    config,
    'export default { test: { name: "tooling", include: ["probe.test.ts"], maxWorkers: 1, fileParallelism: false, disableConsoleIntercept: true, includeTaskLocation: true } };',
  );
  // Normal and blocked bodies differ only in this final statement. Vitest's own default deadline stays.
  const last = mode === "normal" ? "return;" : "await new Promise<void>(() => {});";
  yield* fs.writeFileString(
    file,
    `import { test, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
beforeAll(() => {}); afterAll(() => {}); beforeEach(() => {}); afterEach(() => {});
for (let i = 0; i < ${cases}; i++) test("probe " + i, async () => { process.stdout.write(${JSON.stringify(ready)}); ${last} });\n`,
  );
  const vars = process.env;

  const leg = legOf({
    GITHUB_RUN_ID: vars.GITHUB_RUN_ID,
    GITHUB_RUN_ATTEMPT: vars.GITHUB_RUN_ATTEMPT,
    GITHUB_WORKFLOW: vars.GITHUB_WORKFLOW,
    GITHUB_EVENT_NAME: vars.GITHUB_EVENT_NAME,
    HEAD: vars.HEAD ?? vars.GITHUB_SHA,
    GITHUB_JOB: vars.GITHUB_JOB,
    LEG: vars.LEG ?? vars.SHARD?.split("/")[0],
  });

  const marker = yield* Deferred.make<void>();
  let tail = "";
  const started = yield* Clock.currentTimeMillis;

  const handle = yield* spawner.spawn(
    ChildProcess.make(
      process.execPath,
      [
        path.join(root, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        config,
        "--root",
        scratch,
        "--maxWorkers=1",
        "--fileParallelism=false",
        "--reporter=json",
        ...(enabled ? [`--reporter=${path.join(root, ".github/ci/progress-reporter.ts")}`] : []),
        `--outputFile.json=${report}`,
        file,
      ],
      {
        cwd: root,
        stdin: "ignore",
        detached: true,
        extendEnv: false,
        env: {
          PATH: vars.PATH,
          HOME: home,
          TMPDIR: scratch,
          LANG: vars.LANG,
          CI: vars.CI,
          GITHUB_RUN_ID: leg.run,
          GITHUB_RUN_ATTEMPT: leg.attempt,
          GITHUB_WORKFLOW: leg.workflow,
          GITHUB_EVENT_NAME: leg.event,
          GITHUB_SHA: leg.sha,
          GITHUB_JOB: leg.job,
          LEG: leg.leg,
          RUNNER_TEMP: temp,
        },
      },
    ),
  );

  const stdout = yield* Effect.forkChild(
    handle.stdout.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) => {
        const text = tail + chunk;
        tail = text.slice(-ready.length);

        return text.includes(ready) ? Deferred.succeed(marker, undefined).pipe(Effect.asVoid) : Effect.void;
      }),
    ),
  );

  const stderr = yield* Effect.forkChild(handle.stderr.pipe(Stream.runDrain));

  if (mode === "cutoff") {
    const observed = yield* Effect.raceFirst(
      Deferred.await(marker).pipe(Effect.as("ready")),
      Effect.exit(handle.exitCode).pipe(Effect.as("exited")),
    );

    expect(observed).toBe("ready");
  }

  const io: Io = {
    job: () => Effect.fail(Unread.make({ cause: "fixture has no jobs API" })),
    read: (file) => fs.readFileString(file).pipe(Effect.mapError((cause) => Unread.make({ cause }))),
  };

  const environment = {
    GITHUB_RUN_ID: leg.run,
    GITHUB_RUN_ATTEMPT: leg.attempt,
    GITHUB_WORKFLOW: leg.workflow,
    GITHUB_EVENT_NAME: leg.event,
    HEAD: leg.sha,
    GITHUB_JOB: leg.job,
    LEG: leg.leg,
    RUNNER_TEMP: temp,
    REPORT: report,
  };

  let before: Timings | null = null;

  if (mode === "cutoff") {
    expect(yield* handle.isRunning).toBe(true);

    // Worker stdout can precede Vitest's throttled reporter RPC. A decoded append is the acknowledgement.
    const observation = Effect.scoped(
      Effect.gen(function* () {
        const watching = yield* Deferred.make<void>();

        const changes = yield* Stream.toQueue(
          fs.watch(scratch, { onReady: () => void Deferred.doneUnsafe(watching, Effect.void) }),
          { capacity: "unbounded" },
        );

        yield* Effect.raceFirst(Deferred.await(watching), Queue.take(changes));
        let current = yield* collect(environment, scratch, io, 0);

        while (
          !(
            current.progress &&
            current.progress._tag !== "unavailable" &&
            current.progress.active.some(
              (event) => event._tag === "test" && event.phase === "started" && event.file === "probe.test.ts",
            ) &&
            current.progress.events.some(
              (event) => event._tag === "hook" && event.hook === "beforeEach" && event.phase === "ended",
            )
          )
        ) {
          yield* Queue.take(changes);
          current = yield* collect(environment, scratch, io, 0);
        }

        return current;
      }),
    );

    before = yield* Effect.raceFirst(observation, Effect.exit(handle.exitCode).pipe(Effect.as(null)));
    expect(before).not.toBeNull();

    if (before === null) {
      return yield* Effect.fail(Unread.make({ cause: "child ended before journal acknowledgement" }));
    }

    expect(before.files._tag).toBe("unavailable");
    expect(before.progress?._tag).toBe("partial");

    if (before.progress && before.progress._tag !== "unavailable") {
      expect(before.progress.events.some((event) => event._tag === "module" && event.phase === "queued")).toBe(true);
      expect(
        before.progress.active.some(
          (event) => event._tag === "test" && event.phase === "started" && event.file === "probe.test.ts",
        ),
      ).toBe(true);
      expect(
        before.progress.events.some(
          (event) => event._tag === "hook" && event.hook === "beforeEach" && event.phase === "ended",
        ),
      ).toBe(true);
    }

    expect(yield* handle.isRunning).toBe(true);
    // Only this acquired handle owns this process group. No PID search or unrelated group is used.
    yield* handle.kill({ killSignal: "SIGKILL" });
  }

  const exit = yield* Effect.exit(handle.exitCode);
  yield* Fiber.join(stdout);
  yield* Fiber.join(stderr);
  expect(yield* Deferred.isDone(marker)).toBe(true);
  const elapsed = (yield* Clock.currentTimeMillis) - started;
  expect(yield* handle.isRunning).toBe(false);
  const actual = yield* collect(environment, scratch, io, 0);
  const code = Exit.isSuccess(exit) ? Number(exit.value) : null;

  if (mode === "cutoff") {
    expect(Exit.isFailure(exit)).toBe(true);

    if (Exit.isFailure(exit)) {
      // The installed handle exposes a signal exit as PlatformError, not an ExitCode.
      expect(Cause.pretty(exit.cause)).toContain("SIGKILL");
    }

    expect(actual.files._tag).toBe("unavailable");
    expect(actual.progress?._tag).toBe("partial");
    expect(yield* fs.exists(report)).toBe(false);
  } else {
    expect(code).toBe(mode === "normal" ? 0 : 1);
    expect(actual.files._tag).toBe("read");

    if (diagnostic === "on") {
      expect(actual.progress?._tag).toBe("read");

      if (actual.progress?._tag === "read") {
        expect(actual.progress.end.reason).toBe(mode === "normal" ? "passed" : "failed");

        if (mode === "normal") {
          expect(actual.progress.active).toHaveLength(0);
        }
      }
    }

    if (actual.files._tag === "read") {
      expect(actual.files.rows.every((row) => row.result === (mode === "normal" ? "passed" : "failed"))).toBe(true);
      expect(actual.files.rows.reduce((count, row) => count + row.tests, 0)).toBe(cases);
    }
  }

  const journal = diagnostic === "on" ? yield* fs.readFileString(path.join(scratch, "vitest-progress.ndjson")) : "";
  expect(JSON.stringify(actual)).not.toContain(scratch);
  expect(markdown(actual)).not.toContain(scratch);

  return {
    mode,
    enabled,
    cases,
    elapsed,
    bytes: new TextEncoder().encode(journal).length,
    node: process.versions.node,
    pid: Number(handle.pid),
    ready: true,
    before,
    timings: actual,
    code,
    progress: actual.progress?._tag ?? "unavailable",
  };
}, Effect.scoped);

it.live(
  "scenario: P8 installed callbacks survive a ready-observed SIGKILL before final JSON, while normal and timed-out verdicts stay real",
  () =>
    Effect.gen(function* () {
      // Plant, on disposable CI only: buffer event writes until onTestRunEnd, then cut off after ready.
      // A stand-in cannot prove kernel-visible appends survive the installed process being killed.
      for (const mode of ["cutoff", "normal", "timeout"] as const) {
        const result = yield* probe(mode);
        expect(result.progress).toBe(mode === "cutoff" ? "partial" : "read");
        yield* Console.log(`CI_PROGRESS_PROOF ${JSON.stringify(result)}`);
      }

      const unavailable = yield* probe("normal", "unwritable");
      expect(unavailable.code).toBe(0);
      expect(unavailable.progress).toBe("unavailable");
      yield* Console.log(`CI_PROGRESS_PROOF ${JSON.stringify(unavailable)}`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("scenario: P9 finite identical fixtures record every overhead sample without a clock threshold", () =>
  Effect.gen(function* () {
    // Advisory elapsed/byte measurements supplement the pure exact-work-count law; no speed gate.
    const samples = [];

    for (let sample = 0; sample < 3; sample++) {
      const baseline = yield* probe("normal", "off", 20);
      const observed = yield* probe("normal", "on", 20);
      expect(baseline.code).toBe(0);
      expect(observed.code).toBe(0);
      expect(observed.bytes).toBeGreaterThan(0);
      samples.push({
        sample,
        baseline: baseline.elapsed,
        observed: observed.elapsed,
        difference: observed.elapsed - baseline.elapsed,
        bytes: observed.bytes,
        cases: observed.cases,
      });
    }

    yield* Console.log(`CI_PROGRESS_OVERHEAD ${JSON.stringify(samples)}`);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
