// Today's tooling. These laws supply in-memory I/O only; the real adapters remain unexercised.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, FileSystem, Option, Path, RegExp as Regex, Result, Schema } from "effect";
import { Digest } from "effect/crypto";
import { argv, cases, decodeRequest, derive, Request } from "./plant-cases.ts";
import { Model, Observation } from "./plant-machine.ts";
import {
  attempt,
  diffOptions,
  exercise,
  ExerciseError,
  observation,
  unchanged,
  Workspace,
  type Snapshot,
} from "./plant.ts";

const options = { arbitrary: { runs: runsFor({ fast: 100, full: 100 }) } };

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const sha = "a".repeat(40);

const root = "/temporary/source";

const details = (key: Request["case"]) => ({
  title: cases[key].title,
  file: cases[key].test,
  exit: 0 as const,
  ms: 1,
  duration: 1,
  suites: { total: 1, passed: 1, failed: 0, pending: 0, todo: 0 },
  counts: { total: 1, passed: 1, failed: 0, pending: 0, todo: 0 },
});

// Vitest 5.0.5's JSON reporter serializes e.stack || e.message, never err.diff.
// Use the installed matcher to produce that input instead of inventing its display diff.
const message = (key: Request["case"], content = "", syntax = false) => {
  const matchers = {
    "checklist-pid": () => expect(undefined, "a notice names its process").toBe("process-id"),
    "watcher-r1": () =>
      expect({ _tag: "same", program: content, hash: content }).toMatchObject(
        syntax ? { _tag: "failed", reason: "bundle" } : { _tag: "loaded" },
      ),
    "host-pin": () => expect(["v26.13.0", "v0.0.0", "v0.0.0"]).toEqual(Array(3).fill("v26.13.0")),
    "host-discovery-timeout": () => expect(30_001).toBeLessThan(10_000),
  };

  return Result.match(Result.try(matchers[key]), {
    onSuccess: () => "",
    onFailure: (error) => {
      const serialized = Schema.decodeUnknownSync(
        Schema.Struct({ message: Schema.String, stack: Schema.optionalKey(Schema.String) }),
      )(error);

      const stack = serialized.stack || serialized.message;

      return cases[key].project === "tooling" ? `${stack}\n    at fixture (${root}/${cases[key].test}:194:12)` : stack;
    },
  });
};

const report = (key: Request["case"], status: string, messages: string[] = []) => ({
  success: status === "passed",
  numTotalTests: 1,
  numPassedTests: status === "passed" ? 1 : 0,
  numFailedTests: status === "failed" ? 1 : 0,
  numPendingTests: status === "skipped" ? 1 : 0,
  numTodoTests: 0,
  numTotalTestSuites: 2,
  numPassedTestSuites: status === "failed" ? 0 : 2,
  numFailedTestSuites: status === "failed" ? 2 : 0,
  numPendingTestSuites: 0,
  testResults: [
    {
      name: `${root}/${cases[key].test}`,
      status: status === "failed" ? "failed" : "passed",
      message: "",
      assertionResults: [{ fullName: cases[key].title, status, duration: 12, failureMessages: messages }],
    },
  ],
});

// Plant: accept unknown fields and cases
it.effect.prop(
  "only exact case and SHA requests decode",
  { request: Request, junk: Schema.String },
  ({ request, junk }) =>
    Effect.gen(function* () {
      expect(yield* decodeRequest(request)).toEqual(request);

      for (const invalid of [
        { ...request, patch: junk },
        { ...request, command: junk },
        { ...request, case: `unknown-${junk}` },
        { ...request, sha: `${request.sha}0` },
        { ...request, sha: "A".repeat(40) },
        {},
        null,
        junk,
      ]) {
        expect(Option.isNone(yield* decodeRequest(invalid).pipe(Effect.option))).toBe(true);
        let touched = false;

        const workspace = Workspace.of({
          inspect: Effect.suspend(() => {
            touched = true;

            return Effect.fail(ExerciseError.make({ reason: "must_not_execute" }));
          }),
          write: () => Effect.void,
          diff: Effect.succeed(new Uint8Array()),
          test: () => Effect.succeed(Observation.cases.incomplete.make({ reason: "must_not_execute" })),
        });

        expect(
          Option.isNone(yield* exercise(invalid).pipe(Effect.provideService(Workspace, workspace), Effect.option)),
        ).toBe(true);
        expect(touched).toBe(false);
      }
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
  options,
);

// Plant: replace every occurrence instead of requiring exactly one
it.effect.prop(
  "each case derives exactly one fixed byte edit and refuses ambiguous layouts",
  {
    key: Request.fields.case,
    prefix: Schema.String,
    suffix: Schema.String,
  },
  ({ key, prefix, suffix }) =>
    Effect.gen(function* () {
      const selected = cases[key];
      const original = bytes(`${JSON.stringify(prefix)}\n${selected.before}\n${JSON.stringify(suffix)}`);
      const expected = bytes(`${JSON.stringify(prefix)}\n${selected.after}\n${JSON.stringify(suffix)}`);
      expect(yield* derive(key, original)).toEqual(expected);

      for (const bad of [
        bytes(""),
        bytes(selected.before.repeat(2)),
        bytes(selected.after),
        new Uint8Array([255, ...original]),
      ]) {
        expect(Option.isNone(yield* derive(key, bad).pipe(Effect.option))).toBe(true);
      }

      const args = argv(key, "/private/result.json");
      expect(args).toContain(`^${Regex.escape(selected.title)}$`);
      expect(args).toContain(selected.test);
      expect(args[args.indexOf("--project") + 1]).toBe(key.startsWith("host-") ? "tooling" : "next-integration");
      const selection = new RegExp(args.at(-1) ?? "(?!)");
      expect(selection.test(selected.title)).toBe(true);
      expect(selection.test(`prefix ${selected.title}`)).toBe(false);
      expect(selection.test(`${selected.title} suffix`)).toBe(false);
      const changedTitle = selected.title.includes(".") ? selected.title.replaceAll(".", "#") : `${selected.title}.`;
      expect(selection.test(changedTitle)).toBe(false);
      expect(args).not.toContain("--passWithNoTests");
      expect(args.some((arg) => /Timeout|retry|seed|numRuns/.test(arg))).toBe(false);
    }),
  options,
);

// Plant: check allowed paths but ignore bytes or index
it.prop(
  "the byte edit cannot hide a changed index, mode, HEAD or extra path",
  { key: Request.fields.case, text: Schema.String },
  ({ key, text }) => {
    const original = bytes(text);
    const edited = bytes(`${text}!`);
    const before: Snapshot = { bytes: original, mode: 0o100644, head: sha, index: sha, status: "", summary: "" };
    const after = { ...before, bytes: edited, status: ` M ${cases[key].file}\0` };
    expect(unchanged(before, after, edited, cases[key].file)).toBe(true);

    for (const bad of [
      { ...after, bytes: bytes(`${text}?`) },
      { ...after, index: "b".repeat(40) },
      { ...after, head: "b".repeat(40) },
      { ...after, mode: 0o100755 },
      { ...after, summary: "mode changed" },
      { ...after, status: `${after.status}?? extra.ts\0` },
      { ...after, status: `M  ${cases[key].file}\0` },
    ]) {
      expect(unchanged(before, bad, edited, cases[key].file)).toBe(false);
    }
  },
  options,
);

// Plant: accept exit 1 without a failed target assertion
it.prop(
  "only actual selected assertion results become phase observations",
  { key: Request.fields.case, extra: Schema.String },
  ({ key, extra }) => {
    expect(observation(key, root, JSON.stringify(report(key, "passed")), 0, 12)._tag).toBe("passed");
    const red = report(key, "failed", [message(key)]);
    expect(observation(key, root, JSON.stringify(red), 1, 12)._tag).toBe("failed");
    const skipped = report(key, "skipped");
    const absent = report(key, "passed");
    absent.testResults[0]!.assertionResults = [];
    const wrongTitle = report(key, "passed");
    wrongTitle.testResults[0]!.assertionResults[0]!.fullName += ` ${extra}!`;
    const wrongFile = report(key, "passed");
    wrongFile.testResults[0]!.name += "!";
    const startup = report(key, "failed");
    startup.testResults[0]!.message = "startup failed";

    for (const raw of [
      JSON.stringify(skipped),
      JSON.stringify(absent),
      JSON.stringify(wrongTitle),
      JSON.stringify(wrongFile),
      JSON.stringify(startup),
      "{}",
      "",
      "null",
      JSON.stringify(report(key, "failed", ["Error: Test timed out"])),
    ]) {
      expect(observation(key, root, raw, 1, 12)._tag).toBe("incomplete");
    }

    expect(observation(key, root, JSON.stringify(red), 0, 12)._tag).toBe("incomplete");
    expect(observation(key, root, JSON.stringify(report(key, "passed")), 1, 12)._tag).toBe("incomplete");
  },
  options,
);

// Plant: require formatted minus/plus diff lines absent from JSON failureMessages
it.prop(
  "watcher observations decode installed matcher stacks and keep ambiguous outcomes incomplete",
  {
    syntax: Schema.Boolean,
    content: Schema.String,
    line: Schema.Int.check(Schema.isGreaterThan(0)),
    column: Schema.Int.check(Schema.isGreaterThan(0)),
  },
  ({ syntax, content, line, column }) => {
    const stack = message("watcher-r1", content, syntax);
    expect(stack).not.toMatch(/^[-+]\s+"_tag":/m);
    const actual = observation("watcher-r1", root, JSON.stringify(report("watcher-r1", "failed", [stack])), 1, 12);
    expect(actual._tag).toBe("failed");

    if (Observation.isAnyOf(["failed"])(actual)) {
      expect(actual.diagnostic).toBe(
        `AssertionError: expected _tag ${syntax ? "failed" : "loaded"}; received _tag ${stack.includes("{ Object (_tag, program, ...) }") ? "unknown" : "same"}`,
      );
    }

    const positioned = observation(
      "watcher-r1",
      root,
      JSON.stringify(
        report("watcher-r1", "failed", [
          `${stack}\n    at receiveChange (/private/runner/${cases["watcher-r1"].test}:${line}:${column})`,
        ]),
      ),
      1,
      12,
    );

    expect(positioned).toMatchObject({ _tag: "failed", assertion: { line, column } });
    expect(JSON.stringify(positioned)).not.toContain("/private/runner");

    for (const unknown of [
      "AssertionError: expected an object to match another object",
      "Error: Test timed out",
      content,
    ]) {
      expect(
        observation("watcher-r1", root, JSON.stringify(report("watcher-r1", "failed", [unknown])), 1, 12)._tag,
      ).toBe("incomplete");
    }
  },
  options,
);

// Plant: publish raw failure messages
it.prop(
  "public observations copy no generated private diagnostic content",
  { key: Request.fields.case, content: Schema.String },
  ({ key, content }) => {
    const marker = `private-value-${JSON.stringify(content)}-end`;

    const raw = report(key, "failed", [
      `${message(key)}\n${marker}\n${encodeURIComponent(marker)}\n/private/temp/source.ts:22\n+ ${marker}`,
    ]);

    const output = JSON.stringify(observation(key, root, JSON.stringify(raw), 1, 12));
    expect(output).not.toContain(marker);
    expect(output).not.toContain(encodeURIComponent(marker));
    expect(output).not.toContain("/private/temp");

    const diagnostics = {
      "checklist-pid": "AssertionError: a notice names its process",
      "watcher-r1": "AssertionError: expected _tag loaded; received _tag same",
      "host-pin": "AssertionError: direct and nested pnpm versions differ from the explicit Node pin",
      "host-discovery-timeout": "AssertionError: runtime discovery exceeded the existing command cleanup bound",
    };

    expect(JSON.parse(output).diagnostic).toBe(diagnostics[key]);
  },
  options,
);

// Plant: accept a host mismatch without the actual assertion position, or accept a setup failure.
it.prop(
  "host diagnostics keep assertion positions and refuse unrelated failures",
  {
    key: Schema.Literals(["host-pin", "host-discovery-timeout"]),
    line: Schema.Int.check(Schema.isGreaterThan(0)),
    column: Schema.Int.check(Schema.isGreaterThan(0)),
    content: Schema.String,
  },
  ({ key, line, column, content }) => {
    const header = message(key).split(/\n\s+at /)[0] ?? "";
    const positioned = `${header}\n    at fixture (/private/runner/${cases[key].test}:${line}:${column})`;
    const result = observation(key, root, JSON.stringify(report(key, "failed", [positioned])), 1, 12);
    expect(result).toMatchObject({ _tag: "failed", assertion: { line, column } });
    expect(JSON.stringify(result)).not.toContain("/private/runner");

    for (const unknown of [
      header,
      `Error: Test timed out\n    at fixture (${cases[key].test}:${line}:${column})`,
      `AssertionError: expected 1 to be 2\n    at fixture (${cases[key].test}:${line}:${column})`,
      `AssertionError: expected 30000 to be less than 20000\n    at fixture (${cases[key].test}:${line}:${column})`,
      content,
    ]) {
      expect(observation(key, root, JSON.stringify(report(key, "failed", [unknown])), 1, 12)._tag).toBe("incomplete");
    }
  },
  options,
);

// Plant: skip scoped restoration after the broken child fails
it.effect.prop(
  "every acquired source restores after an injected I/O failure",
  {
    key: Request.fields.case,
    content: Schema.String,
    fault: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 35 })),
  },
  ({ key, content, fault }) =>
    Effect.gen(function* () {
      const original = bytes(`${JSON.stringify(content)}\n${cases[key].before}\n`);
      let current = original;
      let calls = 0;
      const tested: string[] = [];

      const io = <A>(body: () => A) =>
        Effect.suspend(() =>
          calls++ === fault ? Effect.fail(ExerciseError.make({ reason: "injected-private-value" })) : Effect.sync(body),
        );

      const workspace = Workspace.of({
        inspect: io(() => ({
          bytes: current,
          mode: 0o100644,
          head: sha,
          index: sha,
          status: current === original ? "" : ` M ${cases[key].file}\0`,
          summary: "",
        })),
        write: (data) =>
          io(() => {
            current = data;
          }),
        diff: io(() => (current === original ? new Uint8Array() : bytes(`generated-diff-${JSON.stringify(content)}`))),
        test: (phase) =>
          io(() => {
            tested.push(phase);

            return phase === "broken"
              ? Observation.cases.failed.make({
                  ...details(key),
                  exit: 1,
                  category: "assertion",
                  assertion: null,
                  diagnostic: "assertion mismatch",
                })
              : Observation.cases.passed.make(details(key));
          }),
      });

      const answer = yield* exercise({ case: key, sha }).pipe(
        Effect.provideService(Workspace, workspace),
        Effect.option,
      );

      if (Option.isSome(answer)) {
        const result = answer.value;

        if (result.cleanup.restored) {
          expect(current).toEqual(original);
        } else {
          expect(Model.isAnyOf(["recorded", "incomplete"])(result.model)).toBe(true);
        }

        if (Model.isAnyOf(["recorded"])(result.model)) {
          expect(tested).toEqual(["baseline", "broken", "restored"]);
        }

        const hash = yield* Digest.Digest;

        if (result.diffHash !== null) {
          expect(result.diffHash).toBe(
            yield* hash.digestHex(Digest.sha256, bytes(`generated-diff-${JSON.stringify(content)}`)),
          );
        }

        expect(JSON.stringify(result)).not.toContain("injected-private-value");
      } else {
        expect(tested).toEqual([]);
      }

      expect(tested).toEqual(["baseline", "broken", "restored"].slice(0, tested.length));
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
  options,
);

// Plant: discard validated attempt facts and replace every setup failure with a generic reason
it.effect.prop(
  "validated attempt facts survive every early setup failure without copying private errors",
  {
    request: Request,
    caller: Schema.String.check(Schema.isPattern(/^[a-z]{1,16}$/)),
    reason: Schema.Literals([
      "checkout_mismatch",
      "source_versions_unsupported",
      "source_not_regular",
      "source_install_failed",
      "git_version_unsupported",
      "inspect_failed",
      "source_unsupported",
    ]),
    content: Schema.String,
  },
  ({ request, caller, reason, content }) =>
    Effect.gen(function* () {
      const environment = {
        GITHUB_REF: "refs/heads/main",
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_WORKFLOW_SHA: sha,
        GITHUB_SHA: sha,
        GITHUB_RUN_ID: "42",
        GITHUB_RUN_ATTEMPT: "2",
        GITHUB_ACTIONS: "true",
        CI: "true",
        GITHUB_EVENT_PATH: "/runner/event.json",
        RUNNER_TEMP: "/runner/temp",
        PATH: "/runner/bin",
        HOME: "/runner/home",
      };

      const saved: string[] = [];

      const layer = FileSystem.layerNoop({
        makeDirectory: () => Effect.void,
        readFileString: () =>
          Effect.succeed(JSON.stringify({ sender: { login: caller }, inputs: request, ignored: content })),
        writeFileString: (_file, value) =>
          Effect.sync(() => {
            saved.push(value);
          }),
      });

      let entered = false;

      const result = yield* attempt(environment, () =>
        Effect.gen(function* () {
          entered = true;

          const before = Schema.decodeUnknownSync(
            Schema.fromJsonString(
              Schema.Struct({ caller: Schema.String, source: Request.fields.sha, startedAt: Schema.String }),
            ),
          )(saved.at(-1));

          expect(before.caller).toBe(caller);
          expect(before.source).toBe(request.sha);
          expect(before.startedAt).not.toBe("");

          return yield* ExerciseError.make({ reason });
        }),
      ).pipe(Effect.provide(layer), Effect.provide(Path.layer));

      expect(result).toBe(false);
      expect(entered).toBe(true);

      const Record = Schema.Struct({
        caller: Schema.NullOr(Schema.String),
        source: Schema.NullOr(Request.fields.sha),
        request: Schema.NullOr(Request),
        startedAt: Schema.String,
        state: Schema.String,
        reason: Schema.String,
        runner: Request.fields.sha,
        run: Schema.String,
        attempt: Schema.String,
      });

      const recorded = Schema.decodeUnknownSync(Schema.fromJsonString(Record))(saved.at(-1));
      expect(recorded).toMatchObject({
        caller,
        source: request.sha,
        request,
        runner: sha,
        run: "42",
        attempt: "2",
        state: "incomplete",
        reason,
      });
      expect(recorded.startedAt).not.toBe("");
      const unknown = `private-value-${JSON.stringify(content)}-end`;
      yield* attempt(environment, () => Effect.fail(ExerciseError.make({ reason: unknown }))).pipe(
        Effect.provide(layer),
        Effect.provide(Path.layer),
      );
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Record))(saved.at(-1)).reason).toBe("setup_or_io");
      expect(saved.at(-1)).not.toContain(encodeURIComponent(unknown));
      expect(saved.at(-1)).not.toContain(unknown);
      expect(saved.at(-1)).not.toContain(JSON.stringify(unknown).slice(1, -1));
      yield* attempt(environment, () => Effect.die(new Error(unknown))).pipe(
        Effect.provide(layer),
        Effect.provide(Path.layer),
      );
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Record))(saved.at(-1))).toMatchObject({
        source: request.sha,
        caller,
        reason: "setup_or_io",
      });
      expect(saved.at(-1)).not.toContain(encodeURIComponent(unknown));

      const malformed = FileSystem.layerNoop({
        makeDirectory: () => Effect.void,
        readFileString: () => Effect.succeed(JSON.stringify(content)),
        writeFileString: (_file, value) =>
          Effect.sync(() => {
            saved.push(value);
          }),
      });

      yield* attempt(environment, () => Effect.fail(ExerciseError.make({ reason: "must_not_execute" }))).pipe(
        Effect.provide(malformed),
        Effect.provide(Path.layer),
      );
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Record))(saved.at(-1))).toMatchObject({
        source: null,
        caller: null,
        request: null,
        reason: "event_invalid",
      });

      let writes = 0;

      const interruptedWrite = FileSystem.layerNoop({
        makeDirectory: () => Effect.void,
        readFileString: () => Effect.succeed(JSON.stringify({ sender: { login: caller }, inputs: request })),
        writeFileString: (_file, value) =>
          Effect.suspend(() =>
            ++writes === 4
              ? Effect.die(new Error(unknown))
              : Effect.sync(() => {
                  saved.push(value);
                }),
          ),
      });

      const passed = Observation.cases.passed.make(details(request.case));

      const broken = Observation.cases.failed.make({
        ...details(request.case),
        exit: 1,
        category: "assertion",
        assertion: null,
        diagnostic: "assertion mismatch",
      });

      yield* attempt(environment, () =>
        Effect.succeed({
          request,
          originalHash: sha,
          editedHash: sha,
          originalMode: 0o100644,
          head: request.sha,
          index: sha,
          diffHash: sha,
          gitVersion: "git version 2.0.0",
          diffOptions,
          cleanup: { restored: true, hash: sha },
          model: Model.cases.recorded.make({ baseline: passed, broken, restored: passed }),
        }),
      ).pipe(Effect.provide(interruptedWrite), Effect.provide(Path.layer));

      const afterWriteFailure = Schema.decodeUnknownSync(
        Schema.fromJsonString(
          Schema.Struct({
            ...Record.fields,
            model: Model,
            cleanup: Schema.Struct({ restored: Schema.Boolean, hash: Schema.String }),
          }),
        ),
      )(saved.at(-1));

      expect(afterWriteFailure).toMatchObject({
        source: request.sha,
        caller,
        state: "incomplete",
        reason: "setup_or_io",
        model: { _tag: "recorded" },
        cleanup: { restored: true, hash: sha },
      });

      const invalid = FileSystem.layerNoop({
        makeDirectory: () => Effect.void,
        readFileString: () =>
          Effect.succeed(JSON.stringify({ sender: { login: caller }, inputs: { ...request, patch: content } })),
        writeFileString: (_file, value) =>
          Effect.sync(() => {
            saved.push(value);
          }),
      });

      yield* attempt(environment, () => Effect.fail(ExerciseError.make({ reason: "must_not_execute" }))).pipe(
        Effect.provide(invalid),
        Effect.provide(Path.layer),
      );
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Record))(saved.at(-1))).toMatchObject({
        caller,
        source: null,
        request: null,
        state: "incomplete",
        reason: "request_invalid",
      });
    }),
  options,
);
