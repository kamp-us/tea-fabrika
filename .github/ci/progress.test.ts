import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, ManagedRuntime, Path, Result, Schema } from "effect";
import { TestConsole } from "effect/testing";
import ProgressReporter, { recording } from "./progress-reporter.ts";
import * as Progress from "./progress.ts";
import { collect, markdown as timingMarkdown } from "./time-table.ts";

const options = { arbitrary: { runs: runsFor({ fast: 100, full: 100 }), size: 30, concurrency: 1 } };

const Count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 }));

const leg = {
  run: "123",
  attempt: "1",
  workflow: "scheduled",
  event: "workflow_dispatch",
  sha: "a".repeat(40),
  job: "tests",
  leg: "tooling-1",
} as const;

const header = { _tag: "run", phase: "started", version: 1, leg, seq: 0, at: 0 };

const event = (key: number, seq: number, end = false, hook = false): Progress.Event => {
  const fields = {
    phase: end ? "ended" : "started",
    project: key % 2 ? "next" : "tooling",
    file: `next/item-${key}.test.ts`,
    id: `-123_${key}`,
    seq,
    at: seq,
  } as const;

  return hook
    ? Progress.Event.cases.hook.make({ ...fields, hook: "beforeEach" })
    : Progress.Event.cases.test.make(fields);
};

const journal = (events: readonly Progress.Event[], end = true) =>
  [
    header,
    ...events,
    ...(end ? [{ _tag: "run", phase: "ended", reason: "passed", seq: events.length + 1, at: events.length + 1 }] : []),
  ]
    .map((line) => `${JSON.stringify(line)}\n`)
    .join("");

it.prop(
  "P2 independent starts survive every concurrent prefix, including indistinguishable overlapping hooks",
  {
    workers: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 4 })),
    choices: Schema.Array(Count).check(Schema.isMinLength(1), Schema.isMaxLength(30)),
    finish: Schema.Boolean,
  },
  ({ workers, choices, finish }) => {
    // Plant: retain only the latest started entity or clear another worker on any end.
    const expected: Progress.Event[] = [];

    const streams: Progress.Event[][] = Array.from({ length: workers }, (_, key) => {
      const test = event(key, 1);

      const module = (phase: "queued" | "collected" | "started" | "ended") =>
        Progress.Event.cases.module.make({ ...test, _tag: "module", id: "-123", phase });

      return [
        module("queued"),
        module("collected"),
        module("started"),
        test,
        event(key, 1, false, true),
        event(key, 1, false, true),
        event(key, 1, true, true),
        ...(finish ? [event(key, 1, true, true), event(key, 1, true), module("ended")] : []),
      ];
    });

    const events: Progress.Event[] = streams.map((rows) => rows.shift()!);
    let choice = 0;

    while (streams.some((rows) => rows.length)) {
      const waiting = streams.filter((rows) => rows.length);
      const picked = choices[choice++ % choices.length]! % waiting.length;
      events.push(waiting[picked]!.shift()!);
    }

    for (const [index, value] of events.entries()) {
      const next = { ...value, seq: index + 1, at: index + 1 };
      events[index] = next;

      const matches = (row: Progress.Event) =>
        row.project === next.project && row.file === next.file && row.id === next.id && row._tag === next._tag;

      if (next._tag !== "hook") {
        const at = expected.findIndex(matches);

        if (next.phase === "ended") {
          if (at >= 0) {
            expected.splice(at, 1);
          }
        } else if (at < 0) {
          expected.push(next);
        } else {
          expected[at] = next;
        }
      }

      const prefix = events.slice(0, index + 1);
      const actual = Progress.replay(prefix);
      expect(
        actual
          .filter((row) => row._tag !== "hook")
          .map((row) => JSON.stringify(row))
          .toSorted(),
      ).toEqual(expected.map((row) => JSON.stringify(row)).toSorted());

      const hookKeys = new Set(
        prefix
          .filter((row) => row._tag === "hook")
          .map((row) => JSON.stringify([row.project, row.file, row.id, row._tag === "hook" ? row.hook : null])),
      );

      const expectedHooks = [];

      for (const key of hookKeys) {
        let pending = 0;
        let starts: number[] = [];

        for (const row of prefix) {
          if (row._tag !== "hook" || JSON.stringify([row.project, row.file, row.id, row.hook]) !== key) {
            continue;
          }

          if (row.phase === "started") {
            if (pending === 0) {
              starts = [];
            }

            starts.push(row.seq);
            pending++;
          } else {
            pending = Math.max(0, pending - 1);
          }
        }

        if (pending > 0) {
          expectedHooks.push(JSON.stringify([key, pending, starts]));
        }
      }

      const observedHooks = actual
        .filter((row) => row._tag === "hook")
        .map((row) =>
          JSON.stringify([
            JSON.stringify([row.project, row.file, row.id, row.hook]),
            row.pending,
            row.starts?.map((start) => start.seq),
          ]),
        );

      expect(observedHooks.toSorted()).toEqual(expectedHooks.toSorted());
    }

    expect(events.filter((row) => row._tag === "hook" && row.phase === "started")).toHaveLength(workers * 2);
    expect(new Set(events.filter((row) => row._tag === "module").map((row) => row.file)).size).toBe(workers);
  },
  options,
);

it.prop(
  "P4 stale headers and damaged journals preserve only trusted observations and remain explicitly incomplete",
  {
    count: Count,
    order: Schema.UniqueArray(
      Schema.Literals(["none", "stale", "malformed", "truncated", "gap", "missing_end", "duplicate", "path", "id"]),
    ).check(Schema.isMinLength(9), Schema.isMaxLength(9)),
    corruption: Schema.String,
  },
  ({ count, order, corruption }) => {
    // Plant: accept stale identity. Every draw also covers every damaged-input class and identity field.
    expect.hasAssertions();
    const events = Array.from({ length: count + 1 }, (_, i) => event(i % 6, i + 1));

    const replacements = {
      run: "124",
      attempt: "2",
      workflow: "check",
      event: "push",
      sha: "b".repeat(40),
      job: "changed",
      leg: "tooling-2",
    } as const;

    for (const damage of order) {
      if (damage === "stale") {
        for (const key of ["run", "attempt", "workflow", "event", "sha", "job", "leg"] as const) {
          const text = [{ ...header, leg: { ...leg, [key]: replacements[key] } }, ...events]
            .map((line) => `${JSON.stringify(line)}\n`)
            .join("");

          expect(Progress.read(text, leg)._tag).toBe("unavailable");
        }

        continue;
      }

      let text = journal(events);

      if (damage === "malformed") {
        text = `${journal(events, false)}!${corruption}\n${JSON.stringify(event(0, count + 3))}\n`;
      }

      if (damage === "truncated") {
        text = `${journal(events, false)}{"_tag":"run"`;
      }

      if (damage === "gap") {
        text = journal(
          events.map((row) => ({ ...row, seq: row.seq + 1 })),
          false,
        );
      }

      if (damage === "missing_end") {
        text = journal(events, false);
      }

      if (damage === "duplicate") {
        text = journal([events[0]!, ...events], false);
      }

      if (damage === "path") {
        text = `${journal(events, false)}${JSON.stringify({ ...event(0, count + 2), file: "../escape.test.ts" })}\n${JSON.stringify(event(0, count + 3))}\n`;
      }

      if (damage === "id") {
        text = `${journal(events, false)}${JSON.stringify({ ...event(0, count + 2), id: "9999999999_0" })}\n`;
      }

      const result = Progress.read(text, leg);
      expect(result._tag).toBe(damage === "none" ? "read" : "partial");

      if (result._tag !== "unavailable") {
        expect(result.events).toEqual(
          damage === "duplicate"
            ? [events[0]]
            : damage === "gap"
              ? events.map((row) => ({ ...row, seq: row.seq + 1 }))
              : events,
        );
        expect(result.complete).toBe(damage === "none");
        expect(result.start).toEqual({ seq: 0, at: 0 });

        if (damage === "gap") {
          expect(result.gaps).toEqual([1]);
        }

        if (damage === "none") {
          expect(result.end).toMatchObject({
            phase: "ended",
            reason: "passed",
            seq: events.length + 1,
            at: events.length + 1,
          });
        }
      }
    }
  },
  options,
);

it.effect.prop(
  "[secrets] P5 callback projection drops titles, private values and machine paths from journal, artifact and Markdown",
  { canary: Schema.String.check(Schema.isPattern(/^[A-Z]{12}$/)), key: Count, complete: Schema.Boolean },
  ({ canary, key, complete }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      // Plants: copy title into raw journal, timing JSON or Markdown, once per named output.
      const secret = `private-${canary}\n/%☃`;
      const root = `/memory/${secret.replaceAll("\n", "")}`;

      const input = {
        ...event(key, 1),
        file: `${root}/next/item-${key}.test.ts`,
        title: secret,
        fullName: secret,
        meta: { secret },
        stdout: secret,
        error: new Error(secret),
        line: 2,
        column: 0,
      };

      const projected = Progress.project(root, path, input);
      expect(Result.isSuccess(projected)).toBe(true);

      if (Result.isFailure(projected)) {
        return;
      }

      const writes: string[] = [];

      const fs = FileSystem.makeNoop({
        writeFileString: (_file, text) =>
          Effect.sync(() => {
            writes.push(text);
          }),
      });

      const runtime = ManagedRuntime.make(Layer.merge(Path.layer, Layer.succeed(FileSystem.FileSystem, fs)));
      yield* Effect.addFinalizer(() => runtime.disposeEffect);

      const env = {
        GITHUB_RUN_ID: leg.run,
        GITHUB_RUN_ATTEMPT: leg.attempt,
        GITHUB_WORKFLOW: leg.workflow,
        GITHUB_EVENT_NAME: leg.event,
        GITHUB_SHA: leg.sha,
        GITHUB_JOB: leg.job,
        LEG: leg.leg,
        RUNNER_TEMP: "/memory/temp",
      };

      const reporter = new ProgressReporter(undefined, { runtime, env });
      reporter.onInit({ config: { root } });

      const module = {
        type: "module" as const,
        id: "-123",
        project: { name: "tooling" },
        moduleId: input.file,
        name: secret,
        fullName: secret,
        meta: () => ({ secret }),
        logs: () => [secret],
      };

      const test = {
        type: "test" as const,
        id: `-123_${key}`,
        project: module.project,
        module,
        location: { line: 2, column: 0 },
        name: secret,
        fullName: secret,
        meta: () => ({ secret }),
        result: () => ({ errors: [new Error(secret)] }),
      };

      const edge = (call: () => Promise<void>) => Effect.tryPromise({ try: call, catch: (error) => error });
      yield* edge(() => reporter.onTestRunStart());
      yield* edge(() => reporter.onTestModuleQueued(module));
      yield* edge(() => reporter.onTestModuleCollected(module));
      yield* edge(() => reporter.onTestModuleStart(module));
      yield* edge(() => reporter.onTestCaseReady(test));
      yield* edge(() => reporter.onHookStart({ name: "beforeEach", entity: test }));
      yield* edge(() => reporter.onHookEnd({ name: "beforeEach", entity: test }));

      if (complete) {
        yield* edge(() => reporter.onTestCaseResult(test));
        yield* edge(() => reporter.onTestModuleEnd(module));
        yield* edge(() => reporter.onTestRunEnd([], [], "passed"));
      }

      const text = writes.join("");
      const result = Progress.read(text, leg);

      const timings = yield* collect(
        { ...env, HEAD: leg.sha },
        root,
        { job: () => Effect.succeed({}), read: () => Effect.succeed(text) },
        0,
      );

      const enriched = Object.assign({}, timings, { title: secret, fullName: secret, metadata: { secret }, root });
      const outputs = [text, JSON.stringify(timings), timingMarkdown(enriched)];

      for (const output of outputs) {
        for (const marker of [canary, root, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)]) {
          expect(output).not.toContain(marker);
        }
      }

      expect(result._tag).toBe(complete ? "read" : "partial");
      expect(projected.success).toMatchObject({ file: `next/item-${key}.test.ts`, line: 2, column: 0 });

      for (const file of [
        `${root}/../escape.test.ts`,
        `/outside/${canary}.test.ts`,
        "virtual:test",
        `${root}/next/../../escape.test.ts`,
      ]) {
        expect(Result.isFailure(Progress.project(root, path, { ...input, file }))).toBe(true);
      }
    }).pipe(Effect.provide(Path.layer)),
  options,
);

it.effect.prop(
  "P1 and P9 each public callback awaits one append without reading or replaying the prior journal",
  {
    order: Schema.UniqueArray(
      Schema.Literals([
        "queued",
        "collected",
        "module_start",
        "module_end",
        "test_start",
        "test_end",
        "hook_start",
        "hook_end",
      ]),
    ).check(Schema.isMinLength(8), Schema.isMaxLength(8)),
    extra: Schema.Array(
      Schema.Literals([
        "queued",
        "collected",
        "module_start",
        "module_end",
        "test_start",
        "test_end",
        "hook_start",
        "hook_end",
      ]),
    ).check(Schema.isMaxLength(30)),
  },
  ({ order, extra }) =>
    Effect.gen(function* () {
      const actions = [...order, ...extra];
      // Plants: buffer until run end, or serialize the whole history after each callback.
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const writes: Array<{ text: string; flag: string | undefined }> = [];
      let reads = 0;

      const fs = FileSystem.makeNoop({
        readFileString: () => {
          reads++;

          return Effect.succeed("");
        },
        writeFileString: (_file, text, config) =>
          Effect.gen(function* () {
            if (config?.flag === "a" && JSON.parse(text).seq === 1) {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
            }

            writes.push({ text, flag: config?.flag });
          }),
      });

      const runtime = ManagedRuntime.make(Layer.merge(Path.layer, Layer.succeed(FileSystem.FileSystem, fs)));
      yield* Effect.addFinalizer(() => runtime.disposeEffect);

      const reporter = new ProgressReporter(undefined, {
        runtime,
        env: {
          GITHUB_RUN_ID: leg.run,
          GITHUB_RUN_ATTEMPT: leg.attempt,
          GITHUB_WORKFLOW: leg.workflow,
          GITHUB_EVENT_NAME: leg.event,
          GITHUB_SHA: leg.sha,
          GITHUB_JOB: leg.job,
          SHARD: "tooling-1/2",
          RUNNER_TEMP: "/memory/temp",
        },
      });

      reporter.onInit({ config: { root: "/memory/root" } });
      const edge = (call: () => Promise<void>) => Effect.tryPromise({ try: call, catch: (error) => error });
      yield* edge(() => reporter.onTestRunStart());

      const module = {
        type: "module" as const,
        id: "-321",
        project: { name: "tooling" },
        moduleId: "/memory/root/sample.test.ts",
      };

      const test = {
        type: "test" as const,
        id: "-321_0",
        project: module.project,
        module,
        location: { line: 2, column: 0 },
      };

      const calls = {
        queued: () => reporter.onTestModuleQueued(module),
        collected: () => reporter.onTestModuleCollected(module),
        module_start: () => reporter.onTestModuleStart(module),
        module_end: () => reporter.onTestModuleEnd(module),
        test_start: () => reporter.onTestCaseReady(test),
        test_end: () => reporter.onTestCaseResult(test),
        hook_start: () => reporter.onHookStart({ name: "beforeEach", entity: test }),
        hook_end: () => reporter.onHookEnd({ name: "beforeEach", entity: test }),
      };

      const first = yield* Effect.forkChild(edge(calls[actions[0]!]));

      const observed = yield* Effect.raceFirst(
        Deferred.await(entered).pipe(Effect.as("entered")),
        Fiber.join(first).pipe(Effect.as("returned")),
      );

      expect(observed).toBe("entered");
      expect(writes).toHaveLength(1);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);

      for (const [index, action] of actions.entries()) {
        if (index > 0) {
          yield* edge(calls[action]);
        }

        expect(writes).toHaveLength(index + 2);
        const line = JSON.parse(writes[index + 1]!.text);
        expect(line.seq).toBe(index + 1);

        const expected = {
          queued: ["module", "queued"],
          collected: ["module", "collected"],
          module_start: ["module", "started"],
          module_end: ["module", "ended"],
          test_start: ["test", "started"],
          test_end: ["test", "ended"],
          hook_start: ["hook", "started"],
          hook_end: ["hook", "ended"],
        };

        expect([line._tag, line.phase]).toEqual(expected[action]);
        expect(line.file).toBe("sample.test.ts");
        expect(writes[index + 1]!.flag).toBe("a");
        expect(writes[index + 1]!.text.split("\n")).toHaveLength(2);
        expect(Object.keys(line).toSorted()).toEqual(
          (line._tag === "hook"
            ? ["_tag", "at", "column", "file", "hook", "id", "line", "phase", "project", "seq"]
            : line._tag === "test"
              ? ["_tag", "at", "column", "file", "id", "line", "phase", "project", "seq"]
              : ["_tag", "at", "file", "id", "phase", "project", "seq"]
          ).toSorted(),
        );
      }

      expect(reads).toBe(0);
      expect(Progress.read(writes.map((row) => row.text).join(""), leg)._tag).toBe("partial");
    }),
  options,
);

it.effect.prop(
  "[secrets] P6 append failures never escape callbacks and later writes reveal the missed sequence",
  {
    failures: Schema.Array(Schema.Boolean).check(Schema.isMinLength(1), Schema.isMaxLength(30)),
    canary: Schema.String.check(Schema.isPattern(/^[A-Z]{12}$/)),
    headerFail: Schema.Boolean,
  },
  ({ failures, canary, headerFail }) =>
    Effect.gen(function* () {
      // Plant: let an append error escape, or put its raw cause in the journal/diagnostic.
      const writes: string[] = [];
      const answers = [true, ...failures];
      let index = 0;

      const fs = FileSystem.makeNoop({
        writeFileString: (_file, text, config) =>
          Effect.suspend(() => {
            const fail = config?.flag === "w" ? headerFail : JSON.parse(text)._tag !== "run" && answers[index++];

            return fail
              ? Effect.die(new Error(canary))
              : Effect.sync(() => {
                  writes.push(text);
                });
          }),
      });

      const session = yield* recording("/memory/root", "/memory/temp", leg).pipe(
        Effect.provide(Layer.merge(Path.layer, Layer.succeed(FileSystem.FileSystem, fs))),
      );

      expect(Exit.isSuccess(yield* Effect.exit(session.start))).toBe(true);

      for (const [i] of answers.entries()) {
        expect(
          Exit.isSuccess(
            yield* Effect.exit(
              session.event({ ...event(i % 6, i + 1), file: `/memory/root/next/item-${i % 6}.test.ts` }),
            ),
          ),
        ).toBe(true);
      }

      expect(Exit.isSuccess(yield* Effect.exit(session.end("passed")))).toBe(true);
      const text = writes.join("");
      expect(text).not.toContain(canary);
      const result = Progress.read(text, leg);
      expect(result._tag).toBe(headerFail ? "unavailable" : "partial");
      expect(writes.map((text) => JSON.parse(text).seq)).not.toContain(1);

      if (result._tag !== "unavailable") {
        expect(result.gaps).toContain(1);
      }

      const diagnostics = yield* TestConsole.errorLines;
      expect(JSON.stringify(diagnostics)).not.toContain(canary);
    }),
  options,
);
