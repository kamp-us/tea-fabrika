// Today's CI diagnostics. Real Vitest and SIGKILL proof belongs only on disposable CI.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  Cause,
  Clock,
  Console,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Path,
  Queue,
  Result,
  Schema,
  Stream,
} from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { collect, markdown, Unread, type Io, type Timings } from "./time-table.ts";

const ready = "CI_PROGRESS_READY\n";

const fixtureIdentity = {
  run: "1",
  attempt: "1",
  workflow: "scheduled",
  event: "workflow_dispatch",
  sha: "0000000000000000000000000000000000000000",
  job: "tests",
  leg: "tooling-1",
} as const;

const identities = {
  ci: {
    run: process.env["GITHUB_RUN_ID"] ?? null,
    attempt: process.env["GITHUB_RUN_ATTEMPT"] ?? null,
    sha: process.env["GITHUB_SHA"] ?? null,
  },
  fixture: fixtureIdentity,
};

const metricsPrefix = "CI_PROGRESS_COORDINATOR ";

const Counter = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Point = Schema.Struct({
  wall: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  user: Counter,
  system: Counter,
});

const Measurement = Schema.Struct({
  node: Schema.String.check(Schema.isPattern(/^[0-9]+\.[0-9]+\.[0-9]+$/)),
  counts: Schema.Struct({
    run_start: Counter,
    queued: Counter,
    collected: Counter,
    module_start: Counter,
    module_end: Counter,
    test_start: Counter,
    test_end: Counter,
    hook_start: Counter,
    hook_end: Counter,
    run_end: Counter,
  }),
  phases: Schema.Struct({ module: Point, init: Point, start: Point, first: Point, end: Point }),
});

// The same observer runs in both treatments. It reads no entity fields and writes only once, at run end.
const observer = `const point = () => ({ wall: performance.now(), ...process.cpuUsage() });
const loaded = point();
export default class Observer {
  counts = { run_start: 0, queued: 0, collected: 0, module_start: 0, module_end: 0, test_start: 0, test_end: 0, hook_start: 0, hook_end: 0, run_end: 0 };
  phases = { module: loaded };
  onInit() { this.phases.init = point(); }
  onTestRunStart() { this.counts.run_start++; this.phases.start = point(); }
  onTestModuleQueued() { this.counts.queued++; this.phases.first ??= point(); }
  onTestModuleCollected() { this.counts.collected++; }
  onTestModuleStart() { this.counts.module_start++; }
  onTestModuleEnd() { this.counts.module_end++; }
  onTestCaseReady() { this.counts.test_start++; }
  onTestCaseResult() { this.counts.test_end++; }
  onHookStart() { this.counts.hook_start++; }
  onHookEnd() { this.counts.hook_end++; }
  onTestRunEnd() { this.counts.run_end++; this.phases.end = point(); process.stdout.write(${JSON.stringify(metricsPrefix)} + JSON.stringify({ node: process.versions.node, counts: this.counts, phases: this.phases }) + "\\n"); }
}\n`;

type Mode = "normal" | "cutoff" | "timeout";

const probe = Effect.fnUntraced(function* (
  mode: Mode,
  diagnostic: "on" | "off" | "unwritable" = "on",
  cases = 1,
  measurement?: { readonly files: 1 | 10 },
) {
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

  const names = Array.from({ length: measurement?.files ?? 1 }, (_, i) =>
    i === 0 ? "probe.test.ts" : `probe-${i}.test.ts`,
  );

  const files = names.map((name) => path.join(scratch, name));
  const observerFile = path.join(scratch, "observer.mjs");
  const enabled = diagnostic !== "off";
  const temp = diagnostic === "unwritable" ? config : scratch;
  const configText = `export default { test: { name: "tooling", include: ${JSON.stringify(names)}, maxWorkers: 1, fileParallelism: false, disableConsoleIntercept: true, includeTaskLocation: true } };`;
  yield* fs.writeFileString(config, configText);
  // Normal and blocked bodies differ only in this final statement. Vitest's own default deadline stays.
  const last = mode === "normal" ? "return;" : "await new Promise<void>(() => {});";

  const fixture = `import { test, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
beforeAll(() => {}); afterAll(() => {}); beforeEach(() => {}); afterEach(() => {});
for (let i = 0; i < ${cases}; i++) test("probe " + i, async () => { process.stdout.write(${JSON.stringify(ready)}); ${last} });\n`;

  for (const file of files) {
    yield* fs.writeFileString(file, fixture);
  }

  let input: string | undefined;

  if (measurement) {
    yield* fs.writeFileString(observerFile, observer);
    input = yield* Effect.gen(function* () {
      const digest = yield* Digest.Digest;

      return yield* digest.digestHex(
        Digest.sha256,
        new TextEncoder().encode(JSON.stringify({ names, fixture, configText, observer })),
      );
    }).pipe(Effect.provide(Digest.layerWebCrypto));
  }

  const vars = process.env;

  const leg = fixtureIdentity;

  const marker = yield* Deferred.make<void>();
  let tail = "";
  let pending = "";
  let metrics: typeof Measurement.Type | undefined;
  let metricsLines = 0;
  let malformedMetrics = false;
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
        ...(measurement ? [`--reporter=${observerFile}`] : []),
        ...(enabled ? [`--reporter=${path.join(root, ".github/ci/progress-reporter.ts")}`] : []),
        `--outputFile.json=${report}`,
        ...files,
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

        if (measurement) {
          const lines = (pending + chunk).split("\n");
          pending = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith(metricsPrefix)) {
              metricsLines++;

              const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(Measurement))(
                line.slice(metricsPrefix.length),
                { onExcessProperty: "error" },
              );

              if (Result.isFailure(decoded)) {
                malformedMetrics = true;
              } else {
                metrics = decoded.success;
              }
            }
          }
        }

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

  if (actual.progress && actual.progress._tag !== "unavailable") {
    expect(actual.progress.leg).toEqual(fixtureIdentity);
  }

  if (before?.progress && before.progress._tag !== "unavailable") {
    expect(before.progress.leg).toEqual(fixtureIdentity);
  }

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
      expect(actual.files.rows.reduce((count, row) => count + row.tests, 0)).toBe(cases * files.length);
    }
  }

  const journal =
    diagnostic === "on" || (measurement && (yield* fs.exists(path.join(scratch, "vitest-progress.ndjson"))))
      ? yield* fs.readFileString(path.join(scratch, "vitest-progress.ndjson"))
      : "";

  expect(JSON.stringify(actual)).not.toContain(scratch);
  expect(markdown(actual)).not.toContain(scratch);

  const recorded = {
    run_start: 0,
    queued: 0,
    collected: 0,
    module_start: 0,
    module_end: 0,
    test_start: 0,
    test_end: 0,
    hook_start: 0,
    hook_end: 0,
    run_end: 0,
  };

  if (measurement) {
    expect(metricsLines).toBe(1);
    expect(malformedMetrics).toBe(false);
    expect(metrics).toBeDefined();

    if (actual.progress && actual.progress._tag !== "unavailable") {
      recorded.run_start++;
      recorded.run_end += actual.progress.end === null ? 0 : 1;

      for (const event of actual.progress.events) {
        if (event._tag === "module") {
          if (event.phase === "queued" || event.phase === "collected") {
            recorded[event.phase]++;
          } else {
            recorded[event.phase === "started" ? "module_start" : "module_end"]++;
          }
        } else if (event._tag === "test") {
          recorded[event.phase === "started" ? "test_start" : "test_end"]++;
        } else {
          recorded[event.phase === "started" ? "hook_start" : "hook_end"]++;
        }
      }
    }

    if (enabled) {
      expect(metrics?.counts).toEqual(recorded);
    }
  }

  return {
    mode,
    enabled,
    cases: cases * files.length,
    elapsed,
    bytes: new TextEncoder().encode(journal).length,
    node: process.versions.node,
    pid: Number(handle.pid),
    ready: true,
    before,
    timings: actual,
    code,
    progress: actual.progress?._tag ?? "unavailable",
    ...(measurement ? { files: files.length, input, metrics, recorded } : {}),
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
        yield* Console.log(`CI_PROGRESS_PROOF ${JSON.stringify({ ...identities, ...result })}`);
      }

      const unavailable = yield* probe("normal", "unwritable");
      expect(unavailable.code).toBe(0);
      expect(unavailable.progress).toBe("unavailable");
      yield* Console.log(`CI_PROGRESS_PROOF ${JSON.stringify({ ...identities, ...unavailable })}`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("scenario: P9 finite identical fixtures record every overhead sample without a clock threshold", () =>
  Effect.gen(function* () {
    // Advisory elapsed/byte measurements supplement the pure exact-work-count law; no speed gate.
    const samples = [];

    const difference = (from: typeof Point.Type, to: typeof Point.Type) => ({
      wall: to.wall - from.wall,
      user: to.user - from.user,
      system: to.system - from.system,
    });

    const intervals = (phases: typeof Measurement.Type.phases) => ({
      load: difference(phases.module, phases.init),
      start: difference(phases.init, phases.start),
      first: difference(phases.start, phases.first),
      run: difference(phases.first, phases.end),
    });

    for (const files of [1, 10] as const) {
      for (let sample = 0; sample < 3; sample++) {
        const baseline = yield* probe("normal", "off", 20, { files });
        const observed = yield* probe("normal", "on", 20, { files });
        expect(baseline.code).toBe(0);
        expect(observed.code).toBe(0);
        expect(observed.bytes).toBeGreaterThan(0);
        expect(baseline.bytes).toBe(0);
        expect(baseline.input).toBeDefined();
        expect(baseline.input).toBe(observed.input);
        expect(baseline.files).toBe(files);
        expect(observed.files).toBe(files);
        expect(observed.metrics?.counts).toEqual(baseline.metrics?.counts);
        expect(baseline.metrics).toBeDefined();
        expect(observed.metrics).toBeDefined();

        if (!baseline.metrics || !observed.metrics) {
          return yield* Effect.fail(Unread.make({ cause: "coordinator measurement unavailable" }));
        }

        expect(baseline.metrics.node).toBe(observed.metrics.node);

        const summary = {
          sample,
          ci: identities.ci,
          fixture: identities.fixture,
          baseline: baseline.elapsed,
          observed: observed.elapsed,
          difference: observed.elapsed - baseline.elapsed,
          bytes: observed.bytes,
          cases: observed.cases,
        };

        if (files === 1) {
          samples.push(summary);
        }

        const measured = {
          ...summary,
          order: "baseline_then_reporter",
          units: { wall: "ms", cpu: "us", journal: "bytes" },
          files,
          input: baseline.input,
          node: observed.metrics.node,
          journal: { baseline: baseline.bytes, observed: observed.bytes },
          coordinator: { baseline: baseline.metrics, observed: observed.metrics },
          intervals: { baseline: intervals(baseline.metrics.phases), observed: intervals(observed.metrics.phases) },
          recorded: { baseline: baseline.recorded, observed: observed.recorded },
        };

        yield* Console.log(`CI_PROGRESS_MEASURE ${JSON.stringify(measured)}`);
      }

      if (files === 1) {
        yield* Console.log(`CI_PROGRESS_OVERHEAD ${JSON.stringify({ ...identities, samples })}`);
      }
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
