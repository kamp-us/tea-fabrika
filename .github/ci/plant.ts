// Today's manual lead tooling. Raw child output stays in the scoped scratch directory.
import { run } from "@demlik/tea/effect";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Clock, Context, DateTime, Effect, FileSystem, Option, Path, Ref, Schema, Stream } from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { argv, cases, decodeRequest, derive, prepare, Request } from "./plant-cases.ts";
import { Failure, Issue } from "./plant-errors.ts";
import { machine, Model, Observation, type Phase } from "./plant-machine.ts";

export class ExerciseError extends Schema.TaggedError<ExerciseError, { readonly brand: unique symbol }>()(
  "ExerciseError",
  { reason: Schema.String },
) {}

const fail = (reason: string) => ExerciseError.make({ reason });

const Counts = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Reporter = Schema.Struct({
  success: Schema.Boolean,
  numTotalTests: Counts,
  numPassedTests: Counts,
  numFailedTests: Counts,
  numPendingTests: Counts,
  numTodoTests: Counts,
  numTotalTestSuites: Counts,
  numPassedTestSuites: Counts,
  numFailedTestSuites: Counts,
  numPendingTestSuites: Counts,
  testResults: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.Literals(["passed", "failed"]),
      message: Schema.String,
      assertionResults: Schema.Array(
        Schema.Struct({
          fullName: Schema.String,
          status: Schema.String,
          duration: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
          failureMessages: Schema.NullOr(Schema.Array(Schema.String)),
          meta: Schema.optionalKey(Schema.Struct({ plant: Schema.NullOr(Failure) })),
        }),
      ),
    }),
  ),
});

export const observation = (key: Request["case"], root: string, raw: string, exit: number, ms: number): Observation => {
  const missing = (reason: string) => Observation.cases.incomplete.make({ reason });

  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Reporter))(raw);

  if (Option.isNone(decoded)) {
    return missing("report_malformed");
  }

  const report = decoded.value;

  const selected = cases[key];

  const suites = report.testResults.filter((suite) => suite.name === `${root}/${selected.test}`);

  if (suites.length !== 1 || report.testResults.length !== 1) {
    return missing("target_suite_missing");
  }

  const suite = suites[0];

  if (suite === undefined) {
    return missing("target_suite_missing");
  }

  const targets = suite.assertionResults.filter((result) => result.fullName === selected.title);

  if (targets.length !== 1) {
    return missing("target_missing");
  }

  const target = targets[0];

  if (target === undefined) {
    return missing("target_missing");
  }

  if (target.status !== "passed" && target.status !== "failed") {
    return missing(`target_${["skipped", "pending", "todo"].includes(target.status) ? target.status : "unknown"}`);
  }

  if (target.duration == null || target.duration < 0 || !Number.isFinite(ms) || ms < 0 || !Number.isInteger(exit)) {
    return missing("timing_or_exit_invalid");
  }

  const active = suite.assertionResults.filter((result) => result.status === "passed" || result.status === "failed");

  if (
    active.length !== 1 ||
    report.numTotalTests !== suite.assertionResults.length ||
    report.numTotalTests < 1 ||
    report.numPassedTests + report.numFailedTests + report.numPendingTests + report.numTodoTests !==
      report.numTotalTests ||
    report.numTotalTestSuites < 1 ||
    report.numPendingTestSuites !== 0 ||
    suite.message !== ""
  ) {
    return missing("suite_incomplete");
  }

  const details = {
    title: selected.title,
    file: selected.test,
    exit,
    ms,
    duration: target.duration,
    counts: {
      total: report.numTotalTests,
      passed: report.numPassedTests,
      failed: report.numFailedTests,
      pending: report.numPendingTests,
      todo: report.numTodoTests,
    },
    suites: {
      total: report.numTotalTestSuites,
      passed: report.numPassedTestSuites,
      failed: report.numFailedTestSuites,
      pending: report.numPendingTestSuites,
    },
  };

  if (
    target.status === "passed" &&
    exit === 0 &&
    report.success &&
    suite.status === "passed" &&
    report.numPassedTests === 1 &&
    report.numFailedTests === 0 &&
    report.numFailedTestSuites === 0 &&
    report.numPassedTestSuites === report.numTotalTestSuites &&
    (target.failureMessages ?? []).length === 0
  ) {
    return Observation.cases.passed.make({ ...details, exit: 0 });
  }

  const safe = target.meta?.plant ?? null;

  if (
    target.status === "failed" &&
    exit > 0 &&
    !report.success &&
    suite.status === "failed" &&
    report.numFailedTests === 1 &&
    report.numPassedTests === 0 &&
    report.numFailedTestSuites > 0 &&
    safe !== null
  ) {
    if (selected.project === "tooling" && safe.assertion === null) {
      return missing("unclear");
    }

    return Observation.cases.failed.make({ ...details, category: "assertion", ...safe });
  }

  return missing("unclear");
};

const Status = Schema.Literals(["passed", "failed", "skipped", "pending", "todo"]);

const Diagnostics = Schema.Struct({
  testResults: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      assertionResults: Schema.Array(
        Schema.Struct({
          fullName: Schema.String,
          meta: Schema.optionalKey(
            Schema.Struct({
              plantErrors: Schema.optionalKey(Schema.Array(Issue)),
              plantUnhandled: Schema.optionalKey(Schema.Array(Issue)),
            }),
          ),
        }),
      ),
    }),
  ),
});

/** The receipt explains an incomplete verdict without changing the observation's acceptance rules. */
export const report = (key: Request["case"], root: string, raw: string) => {
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Reporter))(raw);

  if (Option.isNone(decoded)) {
    return { state: raw === "" ? "missing" : "malformed" };
  }

  const report = decoded.value;

  const diagnostics = Schema.decodeUnknownOption(Schema.fromJsonString(Diagnostics))(raw).pipe(
    Option.map((value) =>
      value.testResults
        .filter((suite) => suite.name === `${root}/${cases[key].test}`)
        .flatMap((suite) => suite.assertionResults.filter((target) => target.fullName === cases[key].title)),
    ),
    Option.getOrElse(() => []),
  );

  const status = (value: string) => Option.getOrElse(Schema.decodeUnknownOption(Status)(value), () => "unknown");

  return {
    state: "decoded",
    success: report.success,
    counts: {
      total: report.numTotalTests,
      passed: report.numPassedTests,
      failed: report.numFailedTests,
      pending: report.numPendingTests,
      todo: report.numTodoTests,
    },
    suites: {
      total: report.numTotalTestSuites,
      passed: report.numPassedTestSuites,
      failed: report.numFailedTestSuites,
      pending: report.numPendingTestSuites,
      results: report.testResults.length,
    },
    targets: report.testResults
      .filter((suite) => suite.name === `${root}/${cases[key].test}`)
      .map((suite) => ({
        status: suite.status,
        message: suite.message !== "",
        assertions: suite.assertionResults.length,
        active: suite.assertionResults.filter((target) => target.status === "passed" || target.status === "failed")
          .length,
        results: suite.assertionResults
          .filter((target) => target.fullName === cases[key].title)
          .map((target) => ({
            status: status(target.status),
            duration: target.duration ?? null,
            failures: target.failureMessages?.length ?? 0,
            plant: target.meta?.plant != null,
            errors: diagnostics.flatMap((target) => target.meta?.plantErrors ?? []),
            unhandled: diagnostics.flatMap((target) => target.meta?.plantUnhandled ?? []),
          })),
      })),
  };
};

export interface Snapshot {
  readonly bytes: Uint8Array;
  readonly mode: number;
  readonly head: string;
  readonly index: string;
  readonly status: string;
  readonly summary: string;
}

export class Workspace extends Context.Service<
  Workspace,
  {
    readonly inspect: Effect.Effect<Snapshot, ExerciseError>;
    readonly write: (bytes: Uint8Array, mode: number) => Effect.Effect<void, ExerciseError>;
    readonly diff: Effect.Effect<Uint8Array, ExerciseError>;
    readonly test: (phase: Phase) => Effect.Effect<Observation, ExerciseError>;
  }
>()("ci/plant/Workspace") {}

const equal = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, i) => byte === right[i]);

export const diffOptions = [
  "diff",
  "--no-ext-diff",
  "--no-textconv",
  "--no-renames",
  "--no-color",
  "--no-relative",
  "--full-index",
  "--binary",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--unified=3",
] as const;

/** Head, index, mode and the complete NUL-delimited inventory must agree with the sole expected edit. */

export const unchanged = (before: Snapshot, after: Snapshot, bytes: Uint8Array, file: string) =>
  before.head === after.head &&
  before.index === after.index &&
  before.mode === after.mode &&
  after.summary === "" &&
  equal(after.bytes, bytes) &&
  after.status === (equal(before.bytes, bytes) ? "" : ` M ${file}\0`);

const perform = Effect.fn("plant.exercise")(function* (input: unknown, tested?: string) {
  const request = yield* decodeRequest(input).pipe(Effect.mapError(() => fail("request_invalid")));

  const workspace = yield* Workspace;

  const digest = yield* Digest.Digest;

  const before = yield* workspace.inspect;

  const head = yield* Schema.decodeUnknownEffect(Request.fields.sha)(tested ?? request.sha).pipe(
    Effect.mapError(() => fail("request_invalid")),
  );

  if (before.status !== "" || before.summary !== "" || before.head !== head) {
    return yield* fail("source_dirty_or_wrong_head");
  }

  const originalHash = yield* digest.digestHex(Digest.sha256, before.bytes);

  const prepared = yield* prepare(request.case, before.bytes).pipe(Effect.mapError(() => fail("source_unsupported")));

  const expected = yield* derive(request.case, prepared).pipe(Effect.mapError(() => fail("source_unsupported")));

  const preparedHash = yield* digest.digestHex(Digest.sha256, prepared);

  const editedHash = yield* digest.digestHex(Digest.sha256, expected);

  const diffHash = yield* Ref.make<string | null>(null);

  const observedHashes = yield* Ref.make<Record<Phase, string | null>>({
    baseline: null,
    broken: null,
    restored: null,
  });

  const cleanup = yield* Ref.make({ restored: false, hash: Option.none<string>() });

  const verify = Effect.fn("plant.verify")(function* (bytes: Uint8Array) {
    const after = yield* workspace.inspect;

    if (!unchanged(before, after, bytes, cases[request.case].file)) {
      return yield* fail("source_changed");
    }

    return yield* digest.digestHex(Digest.sha256, after.bytes);
  });

  const restore = Effect.gen(function* () {
    yield* workspace.write(before.bytes, before.mode);

    yield* verify(before.bytes);

    return yield* digest.digestHex(Digest.sha256, (yield* workspace.inspect).bytes);
  });

  const model = yield* Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(Effect.void, () =>
        restore.pipe(
          Effect.matchEffect({
            onFailure: () => Ref.set(cleanup, { restored: false, hash: Option.none() }),
            onSuccess: (hash) => Ref.set(cleanup, { restored: true, hash: Option.some(hash) }),
          }),
        ),
      );

      const handle = yield* run(machine, {
        interpret: {
          phase: (cmd) =>
            Effect.gen(function* () {
              if (cmd.phase === "broken") {
                yield* workspace.write(expected, before.mode);

                yield* verify(expected);

                const bytes = yield* workspace.diff;

                if (bytes.length === 0) {
                  return yield* fail("diff_empty");
                }

                yield* Ref.set(diffHash, yield* digest.digestHex(Digest.sha256, bytes));
              } else if (cmd.phase === "restored" || !equal(prepared, before.bytes)) {
                yield* workspace.write(prepared, before.mode);
              }

              const bytes = cmd.phase === "broken" ? expected : prepared;

              const observed = yield* verify(bytes);

              yield* Ref.update(observedHashes, (hashes) => ({ ...hashes, [cmd.phase]: observed }));

              const answer = yield* workspace.test(cmd.phase);

              yield* verify(bytes);

              return answer;
            }).pipe(Effect.catch(() => Effect.succeed(Observation.cases.incomplete.make({ reason: "phase_io" })))),
        },
        terminal: (state) => Model.isAnyOf(["recorded", "incomplete"])(state),
        onError: () => {},
      });

      const runtime = yield* handle.ready;

      return yield* runtime.done();
    }),
  );

  const restored = yield* Ref.get(cleanup);

  return {
    request,
    originalHash,
    preparedHash,
    originalMode: before.mode,
    head: before.head,
    index: before.index,
    editedHash,
    observedHashes: yield* Ref.get(observedHashes),
    diffHash: yield* Ref.get(diffHash),
    model,
    cleanup: { restored: restored.restored, hash: Option.getOrNull(restored.hash) },
  };
});

/** The manual core always tests the exact source commit from its request. */

export const exercise = (input: unknown) => perform(input);

const Event = Schema.Struct({
  inputs: Schema.Unknown,
  sender: Schema.Struct({ login: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9-]+$/)) }),
});

const Environment = Schema.Struct({
  GITHUB_REF: Schema.Literal("refs/heads/main"),
  GITHUB_EVENT_NAME: Schema.Literal("workflow_dispatch"),
  GITHUB_WORKFLOW_SHA: Request.fields.sha,
  GITHUB_SHA: Request.fields.sha,
  GITHUB_RUN_ID: Schema.String.check(Schema.isPattern(/^\d+$/)),
  GITHUB_RUN_ATTEMPT: Schema.String.check(Schema.isPattern(/^\d+$/)),
  GITHUB_ACTIONS: Schema.Literal("true"),
  CI: Schema.Literal("true"),
  GITHUB_EVENT_PATH: Schema.String,
  RUNNER_TEMP: Schema.String,
  PATH: Schema.String,
  HOME: Schema.String,
});

type Environment = typeof Environment.Type;

const Attempt = Schema.Struct({
  kind: Schema.Literal("plant-exercise"),
  startedAt: Schema.String,
  dispatchedAt: Schema.Null,
  dispatchTimeReason: Schema.String,
  caller: Schema.Null,
  source: Schema.NullOr(Request.fields.sha),
  request: Schema.NullOr(Request),
  runner: Request.fields.sha,
  run: Environment.fields.GITHUB_RUN_ID,
  attempt: Environment.fields.GITHUB_RUN_ATTEMPT,
});

const Reason = Schema.Literals([
  "runner_sha_mismatch",
  "event_invalid",
  "request_invalid",
  "child_io",
  "git_failed",
  "git_io",
  "checkout_mismatch",
  "source_versions_unsupported",
  "source_not_regular",
  "source_unsupported",
  "source_install_failed",
  "inspect_failed",
  "source_dirty_or_wrong_head",
  "source_changed",
  "diff_empty",
  "restore_or_edit_failed",
  "test_io",
  "git_version_unsupported",
  "exercise_incomplete",
]);

type ExerciseResult = Effect.Success<ReturnType<typeof exercise>> & {
  readonly gitVersion: string;
  readonly diffOptions: typeof diffOptions;
};

/** The real attempt boundary persists known facts before setup and keeps only closed failure reasons. */

export const attempt = Effect.fn("plant.attempt")(function* <E, R>(
  input: unknown,
  body: (environment: Environment, request: Request) => Effect.Effect<ExerciseResult, E, R>,
) {
  const startedAt = DateTime.formatIso(yield* DateTime.now);

  const environment = yield* Schema.decodeUnknownEffect(Environment)(input).pipe(
    Effect.mapError(() => fail("trusted_main_required")),
  );

  const fs = yield* FileSystem.FileSystem;

  const path = yield* Path.Path;

  const facts = yield* Ref.make<typeof Attempt.Type & Partial<Omit<ExerciseResult, "request">>>({
    kind: "plant-exercise",
    startedAt,
    dispatchedAt: null,
    dispatchTimeReason: "workflow_dispatch event supplies no dispatch timestamp",
    caller: null,
    source: null,
    request: null,
    runner: environment.GITHUB_WORKFLOW_SHA,
    run: environment.GITHUB_RUN_ID,
    attempt: environment.GITHUB_RUN_ATTEMPT,
    cleanup: { restored: false, hash: null },
  });

  const directory = path.join(environment.RUNNER_TEMP, "plant-exercise");

  const write = Effect.fn("plant.writeAttempt")(function* (result: Record<string, unknown>) {
    yield* fs.makeDirectory(directory, { recursive: true });

    yield* fs.writeFileString(
      path.join(directory, "result.json"),
      JSON.stringify({ ...(yield* Ref.get(facts)), ...result }, null, 2),
    );
  });

  const unfinished = {
    state: "incomplete",
    reason: "attempt_unfinished",
    cleanup: { restored: false, reason: "no verified exercise result" },
  };

  return yield* Effect.gen(function* () {
    yield* write(unfinished);

    if (environment.GITHUB_SHA !== environment.GITHUB_WORKFLOW_SHA) {
      return yield* fail("runner_sha_mismatch");
    }

    const event = yield* fs.readFileString(environment.GITHUB_EVENT_PATH).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Event))),
      Effect.mapError(() => fail("event_invalid")),
    );

    yield* write(unfinished);

    const request = yield* decodeRequest(event.inputs).pipe(Effect.mapError(() => fail("request_invalid")));

    yield* Ref.update(facts, (known) => ({ ...known, source: request.sha, request }));

    yield* write(unfinished);

    const result = yield* body(environment, request);

    yield* Ref.update(facts, (known) => ({ ...known, ...result }));

    const complete = result.cleanup.restored && Model.isAnyOf(["recorded"])(result.model);

    yield* write({
      ...result,
      state: complete ? "recorded" : "incomplete",
      reason: complete ? null : "exercise_incomplete",
    });

    return complete;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        const reason = Option.getOrElse(
          Option.flatMap(Cause.findErrorOption(cause), (error) =>
            Schema.is(ExerciseError)(error) ? Schema.decodeUnknownOption(Reason)(error.reason) : Option.none(),
          ),
          () => "setup_or_io",
        );

        yield* write({ state: "incomplete", reason });

        return false;
      }),
    ),
  );
});

type RuntimeEnvironment = Pick<Environment, "PATH" | "HOME" | "RUNNER_TEMP" | "GITHUB_RUN_ID" | "GITHUB_RUN_ATTEMPT">;

type Checkout = {
  readonly runner: string;
  readonly source: string;
  readonly runnerHead: string;
  readonly head: string;
  readonly install: boolean;
};

const execute = Effect.fn("plant.execute")(function* (
  environment: RuntimeEnvironment,
  request: Request,
  checkout: Checkout,
) {
  yield* decodeRequest(request).pipe(Effect.mapError(() => fail("request_invalid")));

  const fs = yield* FileSystem.FileSystem;

  const path = yield* Path.Path;

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runner = path.resolve(checkout.runner);

  const source = path.resolve(checkout.source);

  const selected = cases[request.case];

  const scratch = yield* fs.makeTempDirectoryScoped({ directory: environment.RUNNER_TEMP, prefix: "plant-private-" });

  const childEnv = {
    PATH: environment.PATH,
    HOME: environment.HOME,
    TMPDIR: scratch,
    CI: "true",
    GITHUB_ACTIONS: "true",
    GITHUB_RUN_ID: environment.GITHUB_RUN_ID,
    GITHUB_RUN_ATTEMPT: environment.GITHUB_RUN_ATTEMPT,
    FABRIKA_TEST_DEPTH: "full",
    PLANT_CASE: request.case,
  };

  const child = Effect.fn("plant.child")(
    function* (cwd: string, executable: string, args: readonly string[], name: string) {
      const started = yield* Clock.currentTimeMillis;

      const process = yield* spawner.spawn(
        ChildProcess.make(executable, args, { cwd, env: childEnv, extendEnv: false, stdin: "ignore" }),
      );

      const [exit] = yield* Effect.all(
        [
          process.exitCode,
          process.stdout.pipe(Stream.run(fs.sink(path.join(scratch, `${name}.out`), { mode: 0o600 }))),
          process.stderr.pipe(Stream.run(fs.sink(path.join(scratch, `${name}.err`), { mode: 0o600 }))),
        ],
        { concurrency: "unbounded" },
      );

      return { exit: Number(exit), ms: (yield* Clock.currentTimeMillis) - started };
    },
    Effect.scoped,
    Effect.mapError(() => fail("child_io")),
  );

  const git = Effect.fn("plant.git")(
    function* (cwd: string, args: readonly string[]) {
      const handle = yield* spawner.spawn(
        ChildProcess.make("git", args, { cwd, env: childEnv, extendEnv: false, stdin: "ignore" }),
      );

      const [exit, stdout] = yield* Effect.all(
        [
          handle.exitCode,
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.runDrain),
        ],
        { concurrency: "unbounded" },
      );

      if (Number(exit) !== 0) {
        return yield* fail("git_failed");
      }

      return stdout;
    },
    Effect.scoped,
    Effect.mapError(() => fail("git_io")),
  );

  if (
    (yield* git(runner, ["rev-parse", "HEAD"])).trim() !== checkout.runnerHead ||
    (yield* git(source, ["rev-parse", "HEAD"])).trim() !== checkout.head ||
    checkout.head !== request.sha
  ) {
    return yield* fail("checkout_mismatch");
  }

  const lock = yield* fs.readFile(path.join(runner, "pnpm-lock.yaml"));

  if (!equal(lock, yield* fs.readFile(path.join(source, "pnpm-lock.yaml")))) {
    return yield* fail("source_versions_unsupported");
  }

  const target = path.join(source, selected.file);

  const regular = Effect.gen(function* () {
    const parts = selected.file.split("/");

    for (let i = 0; i <= parts.length; i++) {
      const info = yield* fs.lstat(path.join(source, ...parts.slice(0, i)));

      if (info.type !== (i === parts.length ? "File" : "Directory")) {
        return yield* fail("source_not_regular");
      }
    }

    return yield* fs.lstat(target);
  });

  yield* regular;

  const original = yield* fs.readFile(target);

  const prepared = yield* prepare(request.case, original).pipe(Effect.mapError(() => fail("source_unsupported")));

  yield* derive(request.case, prepared).pipe(Effect.mapError(() => fail("source_unsupported")));

  if (checkout.install) {
    const install = yield* child(source, "pnpm", ["install", "--frozen-lockfile"], "source-install");

    if (install.exit !== 0) {
      return yield* fail("source_install_failed");
    }
  }

  const inspect = Effect.gen(function* () {
    const info = yield* regular;

    const bytes = yield* fs.readFile(target);

    const head = (yield* git(source, ["rev-parse", "HEAD"])).trim();

    const index = (yield* git(source, ["write-tree"])).trim();

    const status = yield* git(source, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);

    const summary = yield* git(source, ["diff", "--no-ext-diff", "--no-textconv", "--summary", "--no-renames"]);

    return { bytes, mode: info.mode, head, index, status, summary };
  }).pipe(Effect.mapError(() => fail("inspect_failed")));

  const reports: {
    readonly phase: Phase;
    readonly exit: number;
    readonly ms: number;
    readonly report: ReturnType<typeof report>;
  }[] = [];

  const workspace = Workspace.of({
    inspect,
    write: (bytes, mode) =>
      Effect.gen(function* () {
        yield* regular;

        yield* fs.writeFile(target, bytes);

        yield* fs.chmod(target, mode);
      }).pipe(Effect.mapError(() => fail("restore_or_edit_failed"))),
    diff: git(source, [...diffOptions, "--", selected.file]).pipe(Effect.map((text) => new TextEncoder().encode(text))),
    test: (phase) =>
      Effect.gen(function* () {
        const output = path.join(scratch, `${phase}.json`);

        const args = argv(request.case, output).map((arg) =>
          arg === "--reporter=json" ? `--reporter=${path.join(runner, ".github/ci/plant-reporter.ts")}` : arg,
        );

        const result = yield* child(source, "nice", args, phase);

        const raw = yield* fs.readFileString(output).pipe(Effect.orElseSucceed(() => ""));

        reports.push({ phase, ...result, report: report(request.case, source, raw) });

        return observation(request.case, source, raw, result.exit, result.ms);
      }).pipe(Effect.mapError(() => fail("test_io"))),
  });

  const gitVersion = (yield* git(runner, ["--version"])).trim();

  if (!/^git version [0-9.]+$/.test(gitVersion)) {
    return yield* fail("git_version_unsupported");
  }

  const result = yield* perform(request, checkout.head).pipe(Effect.provideService(Workspace, workspace));

  return { ...result, gitVersion, diffOptions, reports };
}, Effect.scoped);

const main = attempt(process.env, (environment, request) =>
  execute(environment, request, {
    runner: ".",
    source: "source",
    runnerHead: environment.GITHUB_WORKFLOW_SHA,
    head: request.sha,
    install: true,
  }),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    main.pipe(
      Effect.tap((complete) =>
        Effect.sync(() => {
          if (!complete) {
            process.exitCode = 1;
          }
        }),
      ),
      Effect.catchCause(() =>
        Effect.sync(() => {
          console.error("plant-exercise: incomplete; result could not be saved");
          process.exitCode = 1;
        }),
      ),
      Effect.provide(NodeServices.layer),
      Effect.provide(Digest.layerWebCrypto),
    ),
  );
}
