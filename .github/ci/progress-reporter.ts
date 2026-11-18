// Today's CI. Every accepted callback appends metadata before returning; failures are advisory.
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Clock, Console, Effect, FileSystem, Layer, ManagedRuntime, Path, Result, Schema, Semaphore } from "effect";
import type { Reporter } from "vitest/node";
import * as Progress from "./progress.ts";
import { legOf } from "./time-table.ts";

export const recording = Effect.fnUntraced(function* (root: string, temp: string, identity: unknown) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const leg = Schema.decodeUnknownResult(Progress.LegIdentity)(identity);
  const file = path.join(temp, "vitest-progress.ndjson");
  const semaphore = yield* Semaphore.make(1);
  const validPaths = path.isAbsolute(root) && path.isAbsolute(temp);
  let seq = 0;

  const write = (value: unknown, flag: "w" | "a") =>
    fs
      .writeFileString(file, `${JSON.stringify(value)}\n`, { flag, mode: 0o600 })
      .pipe(Effect.catchCause(() => Console.error("vitest-progress: journal write unavailable")));

  const start = Effect.gen(function* () {
    if (!validPaths || Result.isFailure(leg)) {
      return yield* Console.error("vitest-progress: identity unavailable");
    }

    yield* write(
      { _tag: "run", phase: "started", version: 1, leg: leg.success, seq: 0, at: yield* Clock.currentTimeMillis },
      "w",
    );
  }).pipe(semaphore.withPermit);

  const event = Effect.fnUntraced(function* (input: Record<string, unknown>) {
    const current = ++seq;
    const projected = Progress.project(root, path, { ...input, seq: current, at: yield* Clock.currentTimeMillis });

    if (!validPaths || Result.isFailure(leg) || Result.isFailure(projected)) {
      return yield* Console.error("vitest-progress: metadata unavailable");
    }

    yield* write(projected.success, "a");
  }, semaphore.withPermit);

  const end = Effect.fnUntraced(function* (reason: unknown) {
    const current = ++seq;
    const decoded = Schema.decodeUnknownResult(Progress.EndReason)(reason);

    if (!validPaths || Result.isFailure(leg) || Result.isFailure(decoded)) {
      return yield* Console.error("vitest-progress: end unavailable");
    }

    yield* write(
      { _tag: "run", phase: "ended", reason: decoded.success, seq: current, at: yield* Clock.currentTimeMillis },
      "a",
    );
  }, semaphore.withPermit);

  return { start, event, end };
});

type Recording = Effect.Success<ReturnType<typeof recording>>;

type Runtime = ManagedRuntime.ManagedRuntime<FileSystem.FileSystem | Path.Path, never>;

type EntityFields = {
  readonly id: string;
  readonly project: { readonly name: string };
  readonly location?: { readonly line: number; readonly column: number } | undefined;
};

type Module = EntityFields & { readonly type: "module"; readonly moduleId: string };

type Test = EntityFields & { readonly type: "test"; readonly module: Module };

type Suite = EntityFields & { readonly type: "suite"; readonly module: Module };

type Hook = { readonly name: typeof Progress.Hook.Type; readonly entity: Module | Test | Suite };

export default class ProgressReporter implements Reporter {
  private readonly runtime: Runtime;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private root = "";
  private journal: Recording | undefined;

  constructor(
    _options?: unknown,
    dependencies: { readonly runtime?: Runtime; readonly env?: Readonly<Record<string, string | undefined>> } = {},
  ) {
    this.runtime = dependencies.runtime ?? ManagedRuntime.make(Layer.merge(NodeFileSystem.layer, NodePath.layer));
    this.env = dependencies.env ?? process.env;
  }

  onInit(vitest: { readonly config: { readonly root: string } }) {
    this.root = vitest.config.root;
  }

  async onTestRunStart() {
    const identity = legOf({
      GITHUB_RUN_ID: this.env.GITHUB_RUN_ID,
      GITHUB_RUN_ATTEMPT: this.env.GITHUB_RUN_ATTEMPT,
      GITHUB_WORKFLOW: this.env.GITHUB_WORKFLOW,
      GITHUB_EVENT_NAME: this.env.GITHUB_EVENT_NAME,
      HEAD: this.env.HEAD ?? this.env.GITHUB_SHA,
      GITHUB_JOB: this.env.GITHUB_JOB,
      LEG: this.env.LEG ?? this.env.SHARD?.split("/")[0],
    });

    this.journal = await this.runtime
      .runPromise(recording(this.root, this.env.RUNNER_TEMP ?? "", identity))
      .catch(() => undefined);

    if (this.journal) {
      await this.runtime.runPromise(this.journal.start).catch(() => undefined);
    }
  }

  private async event(
    entity: Module | Suite | Test,
    tag: "module" | "test" | "hook",
    phase: "queued" | "collected" | "started" | "ended",
    hook?: Hook["name"],
  ) {
    if (!this.journal) {
      return;
    }

    const module = entity.type === "module" ? entity : entity.module;
    await this.runtime
      .runPromise(
        this.journal.event({
          _tag: tag,
          phase,
          project: entity.project.name,
          file: module.moduleId,
          id: entity.id,
          ...(entity.location ?? {}),
          ...(hook === undefined ? {} : { hook }),
        }),
      )
      .catch(() => undefined);
  }

  onTestModuleQueued(module: Module) {
    return this.event(module, "module", "queued");
  }

  onTestModuleCollected(module: Module) {
    return this.event(module, "module", "collected");
  }

  onTestModuleStart(module: Module) {
    return this.event(module, "module", "started");
  }

  onTestModuleEnd(module: Module) {
    return this.event(module, "module", "ended");
  }

  onTestCaseReady(test: Test) {
    return this.event(test, "test", "started");
  }

  onTestCaseResult(test: Test) {
    return this.event(test, "test", "ended");
  }

  onHookStart(hook: Hook) {
    return this.event(hook.entity, "hook", "started", hook.name);
  }

  onHookEnd(hook: Hook) {
    return this.event(hook.entity, "hook", "ended", hook.name);
  }

  async onTestRunEnd(_modules: readonly unknown[], _errors: readonly unknown[], reason: unknown) {
    if (this.journal) {
      await this.runtime.runPromise(this.journal.end(reason)).catch(() => undefined);
    }

    await this.runtime.dispose().catch(() => undefined);
  }
}
