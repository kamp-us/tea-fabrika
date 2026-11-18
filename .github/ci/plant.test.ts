// Today's tooling. These laws supply in-memory I/O only; the real adapters remain unexercised.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, FileSystem, Option, Path, RegExp as Regex, Result, Schema } from "effect";
import { Digest } from "effect/crypto";
import { describe } from "vitest";
import { argv, cases, decodeRequest, derive, prepare, Request } from "./plant-cases.ts";
import { failure, Issue, issue } from "./plant-errors.ts";
import { Model, Observation } from "./plant-machine.ts";
import PlantReporter from "./plant-reporter.ts";
import {
  attempt,
  diffOptions,
  exercise,
  ExerciseError,
  observation,
  report as receipt,
  unchanged,
  Workspace,
  type Snapshot,
} from "./plant.ts";

const options = { arbitrary: { runs: runsFor({ fast: 100, full: 100 }) } };

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const sha = "a".repeat(40);

const root = "/temporary/source";

const Matcher = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
  stack: Schema.optionalKey(Schema.String),
  actual: Schema.optionalKey(Schema.Unknown),
  expected: Schema.optionalKey(Schema.Unknown),
  operator: Schema.optionalKey(Schema.String),
});

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
const matcher = (key: Request["case"], content = "", syntax = false) => {
  const tmp = `/private/plant-private-${content.replaceAll("/", "_").replaceAll("\0", "_")}`;
  const kept = { keep: "fixture child", foreground: true, paid: true };
  const homeRoot = new TextEncoder().encode(`${tmp}/fh-XXXXXX/host/sock`).length < 103 ? tmp : "/tmp";

  const matchers: Partial<Record<Request["case"], () => unknown>> = {
    "watcher-r1": () =>
      expect({ _tag: "same", program: content, hash: content }).toMatchObject(
        syntax ? { _tag: "failed", reason: "bundle" } : { _tag: "loaded" },
      ),
    "host-pin": () => expect(["v26.13.0", "v0.0.0", "v0.0.0"]).toEqual(Array(3).fill("v26.13.0")),
    "host-discovery-timeout": () => expect(30_001).toBeLessThan(10_000),
    "host-requested-pin": () => expect("0.0.0\n").toBe("26.13.0\n"),
    "host-pnpm-path": () => expect(["v26.13.0", "v0.0.0", "v0.0.0"]).toEqual(Array(3).fill("v26.13.0")),
    "host-env-order": () =>
      expect(JSON.stringify({ ...kept, removed: false, tmp, home: `${homeRoot}/fh-unit` })).toBe(
        JSON.stringify({ ...kept, removed: true, tmp: `${tmp}/host-unit`, home: `${tmp}/host-unit/home` }),
      ),
  };

  const compare = matchers[key];

  if (compare === undefined) {
    throw new Error("missing fixed matcher");
  }

  return Result.match(Result.try(compare), {
    onSuccess: () => Matcher.make({ name: "Error", message: "" }),
    onFailure: (error) => {
      const serialized = Schema.decodeUnknownSync(Matcher)(error);

      return serialized;
    },
  });
};

const position = (key: Request["case"], line = 17, column = 23) =>
  key === "host-requested-pin"
    ? { line: 195, column: 62 }
    : key === "host-pnpm-path"
      ? { line: 194, column: 70 }
      : key === "host-env-order"
        ? { line: 197, column: 24 }
        : { line, column };

const message = (key: Request["case"], content = "", syntax = false) => {
  const error = matcher(key, content, syntax);
  const stack = error.stack || error.message;
  const fixture = cases[key].project === "tooling" ? position(key, 194, 12) : null;

  return fixture === null
    ? stack
    : `${stack}\n    at fixture (${root}/${cases[key].test}:${fixture.line}:${fixture.column})`;
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
      assertionResults: [
        {
          fullName: cases[key].title,
          status,
          duration: 12,
          failureMessages: messages,
          meta: {
            plant: failure(
              key,
              messages.map((stack) => ({
                ...matcher(key),
                name: stack.startsWith("AssertionError:") ? "AssertionError" : "Error",
                message: stack.replace(/^AssertionError: /, "").split("\n    at ")[0],
                stack,
              })),
            ),
          },
        },
      ],
    },
  ],
});

const images = <Key extends Request["case"]>(key: Key, content: string) => {
  const selected = cases[key];
  const original = bytes(`${JSON.stringify(content)}\n\n${selected.before}\n`);
  const prepared = original;

  const edited = bytes(new TextDecoder().decode(prepared).replace(selected.before, selected.after));
  const head = sha;

  return { original, prepared, edited, head };
};

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
      expect(args).toContain(`^${Regex.escape(selected.selector)}$`);
      expect(args).toContain(selected.test);
      expect(args[args.indexOf("--project") + 1]).toBe(key.startsWith("host-") ? "tooling" : "next-integration");
      const selection = new RegExp(args.at(-1) ?? "(?!)");
      expect(selection.test(selected.selector)).toBe(true);
      expect(selection.test(`prefix ${selected.selector}`)).toBe(false);
      expect(selection.test(`${selected.selector} suffix`)).toBe(false);

      const changedTitle = selected.selector.includes(".")
        ? selected.selector.replaceAll(".", "#")
        : `${selected.selector}.`;

      expect(selection.test(changedTitle)).toBe(false);
      expect(args).not.toContain("--passWithNoTests");
      expect(args.some((arg) => /Timeout|retry|seed|numRuns/.test(arg))).toBe(false);
    }),
  options,
);

// Plant: anchor the JSON reporter's space-joined name instead of Vitest's actual CLI task name.
// The suite/leaf pairs were read from each mapped source law. These bodies start no real resource.
const nested = [
  {
    key: "watcher-r1",
    suite: "P15 slice 1: the watcher",
    leaf: "scenario: R1 a held same reply from boot or a preceding save cannot complete a good or broken save",
  },
  {
    key: "host-pin",
    suite: "the host step's outcomes",
    leaf: "scenario: an explicit pin keeps direct and nested pnpm on that Node, even when the manifest differs",
  },
  {
    key: "host-discovery-timeout",
    suite: "the host step's outcomes",
    leaf: "scenario: stalled runtime discovery shares the first command's deadline and is reaped before returning",
  },
] as const;

for (const { key, suite, leaf } of nested) {
  describe(suite, () => {
    it.prop(
      leaf,
      { extra: Schema.String },
      ({ extra }, context) => {
        for (const selected of key === "host-pin"
          ? ([key, "host-requested-pin", "host-pnpm-path", "host-env-order"] as const)
          : [key]) {
          const pattern = new RegExp(argv(selected, "/private/result.json").at(-1) ?? "(?!)");
          expect(pattern.test(context.task.fullTestName)).toBe(true);
          expect(pattern.test(`${context.task.fullTestName}${extra}!`)).toBe(false);
          expect(pattern.test(`!${extra}${context.task.fullTestName}`)).toBe(false);
          expect(cases[key].title).toBe(`${context.task.suite?.name} ${context.task.name}`);
          expect(pattern.test(cases[selected].title)).toBe(false);
        }
      },
      options,
    );
  });
}

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

// Plant: copy a raw error name, message, stack or nested cause into the public receipt.
it.prop(
  "incomplete phase receipts retain verdict facts and only closed causal error details",
  {
    key: Request.fields.case,
    content: Schema.String,
    line: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 })),
    column: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
    name: Schema.Literals(["AssertionError", "SyntaxError", "ReferenceError", "TypeError", "RangeError", "Error"]),
  },
  ({ key, content, line, column, name }) => {
    const marker = `private-value-${JSON.stringify(content)}-end`;

    const error = {
      name,
      message: marker,
      stack: `at selected (/private/${encodeURIComponent(marker)}/${cases[key].test}:${line}:${column})`,
      actual: marker,
      expected: marker,
    };

    const detail = issue(key, {
      name: "Error",
      message: marker,
      cause: { name: "Error", message: marker, cause: error },
    });

    expect(detail).toEqual({ kind: name, frame: { line, column } });
    expect(Schema.is(Issue)(detail)).toBe(true);
    expect(issue(key, { ...error, name: marker })).toEqual({ kind: "unknown", frame: { line, column } });
    expect(
      issue(key, { ...error, stack: `/private/${encodeURIComponent(marker)}/unrelated.test.ts:${line}:${column}` }),
    ).toEqual({ kind: name, frame: null });
    expect(issue(key, { ...error, name: "Error", message: `Test timed out in 60000ms: ${marker}` }).kind).toBe(
      "timeout",
    );
    expect(issue(key, marker)).toEqual({ kind: "unknown", frame: null });

    const cyclic = { name: "Error", message: marker, cause: {} };
    cyclic.cause = cyclic;
    expect(issue(key, cyclic)).toEqual({ kind: "unknown", frame: null });

    const raw = report(key, "failed", [marker]);

    const target = raw.testResults[0]!.assertionResults[0]!;

    const extended = {
      ...raw,
      testResults: [
        {
          ...raw.testResults[0]!,
          assertionResults: [
            { ...target, meta: { plant: null, plantErrors: [detail], plantUnhandled: [detail], private: marker } },
          ],
        },
      ],
    };

    const actual = receipt(key, root, JSON.stringify(extended));
    expect(actual).toMatchObject({
      state: "decoded",
      success: false,
      counts: { total: 1, passed: 0, failed: 1, pending: 0, todo: 0 },
      suites: { total: 2, passed: 0, failed: 2, pending: 0, results: 1 },
      targets: [
        {
          status: "failed",
          message: false,
          assertions: 1,
          active: 1,
          results: [
            { status: "failed", duration: 12, failures: 1, plant: false, errors: [detail], unhandled: [detail] },
          ],
        },
      ],
    });

    expect(observation(key, root, JSON.stringify(extended), 1, 12)).toEqual({ _tag: "incomplete", reason: "unclear" });
    expect(JSON.stringify(actual)).not.toContain(marker);
    expect(JSON.stringify(actual)).not.toContain("/private/");
    expect(JSON.stringify(actual)).not.toContain(cases[key].title);
    expect(JSON.stringify(actual)).not.toContain(cases[key].test);

    const passed = report(key, "passed");

    const malformed = {
      ...passed,
      testResults: [
        {
          ...passed.testResults[0]!,
          assertionResults: [
            { ...passed.testResults[0]!.assertionResults[0]!, meta: { plant: null, plantErrors: [marker] } },
          ],
        },
      ],
    };

    expect(observation(key, root, JSON.stringify(malformed), 0, 12)).toEqual(
      observation(key, root, JSON.stringify(passed), 0, 12),
    );
    expect(receipt(key, root, "")).toEqual({ state: "missing" });
    expect(receipt(key, root, marker)).toEqual({ state: "malformed" });
  },
  options,
);

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

// Plant: accept wrapper stacks, generic property failures or multiple errors as the intended assertion.
it.prop(
  "only one causal assertion supplies its own location and closed diagnostic",
  { key: Request.fields.case, depth: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 })) },
  ({ key, depth }) => {
    const stack = message(key);

    const location = position(key);

    const assertion = {
      ...matcher(key),
      name: "AssertionError",
      message: stack.replace(/^AssertionError: /, "").split("\n    at ")[0],
      stack: `${stack.split(/\n\s+at /)[0]}\n    at matcher (/private/${cases[key].test}:${location.line}:${location.column})`,
    };

    let error: unknown = assertion;

    for (let i = 0; i < depth; i++) {
      error = { name: "Error", message: "Property failed", stack: `${cases[key].test}:99:1`, cause: error };
    }

    expect(failure(key, [error])).toMatchObject({ assertion: location });
    const cycle: { name: string; message: string; cause?: unknown } = { name: "Error", message: "Property failed" };
    cycle.cause = cycle;
    const links: Array<{ name: string; message: string; cause?: unknown }> = [];

    for (let i = 0; i <= depth; i++) {
      links.push({ name: "Error", message: "Property failed" });
    }

    for (const [index, link] of links.entries()) {
      link.cause = links[(index + 1) % links.length];
    }

    for (const errors of [
      [],
      [error, error],
      [cycle],
      [links[0]],
      [{ name: "Error", message: "Property failed" }],
      [{ ...assertion, name: "Error" }],
      [{ ...assertion, message: `unrelated ${assertion.message}` }],
      [{ ...assertion, cause: error }],
    ]) {
      expect(failure(key, errors)).toBeNull();
    }

    const unreported = report(key, "failed", [stack]);
    unreported.testResults[0]!.assertionResults[0]!.meta.plant = null;
    expect(observation(key, root, JSON.stringify(unreported), 1, 1)._tag).toBe("incomplete");
  },
  options,
);

// Plant: assume inherited setup paths equal the host fixture's own paths.
it.prop(
  "env-order follows the adapter temp and exact testHomes root",
  { content: Schema.String },
  ({ content }) => {
    const component = `generated-${content.replaceAll("/", "_").replaceAll("\0", "_")}`;

    for (const budget of [102, 103]) {
      const padding = budget - new TextEncoder().encode("/tmp//fh-XXXXXX/host/sock").length;
      const tmp = `/tmp/${"é".repeat(Math.floor(padding / 2))}${"a".repeat(padding % 2)}`;
      const homeRoot = budget === 102 ? tmp : "/tmp";
      const kept = { keep: "fixture child", foreground: true, paid: true };
      const actual = { ...kept, removed: false, tmp, home: `${homeRoot}/fh-${component}` };

      const expected = {
        ...kept,
        removed: true,
        tmp: `${tmp}/host-${component}`,
        home: `${tmp}/host-${component}/home`,
      };

      const error = {
        ...matcher("host-env-order"),
        actual: JSON.stringify(actual),
        expected: JSON.stringify(expected),
        stack: `at matcher (/private/${cases["host-env-order"].test}:197:24)`,
      };

      expect(new TextEncoder().encode(`${tmp}/fh-XXXXXX/host/sock`).length).toBe(budget);
      expect(failure("host-env-order", [error])).toMatchObject({
        diagnostic: "AssertionError: pinned host environment retained a removed parent value",
        assertion: { line: 197, column: 24 },
      });

      for (const changed of [
        { ...actual, home: `${homeRoot}/nested/fh-${component}` },
        { ...actual, home: `${homeRoot}/hh-${component}` },
        { ...actual, home: `${homeRoot}/fh-` },
        { ...actual, home: `${budget === 102 ? "/tmp" : tmp}/fh-${component}` },
        { ...actual, home: expected.home, tmp: expected.tmp },
        { ...actual, removed: true },
        { ...actual, extra: component },
      ]) {
        expect(failure("host-env-order", [{ ...error, actual: JSON.stringify(changed) }])).toBeNull();
      }

      for (const changed of [
        { ...expected, tmp: `${tmp}/nested/host-${component}`, home: `${tmp}/nested/host-${component}/home` },
        { ...expected, tmp: `${tmp}/other-${component}`, home: `${tmp}/other-${component}/home` },
        { ...expected, tmp: `${tmp}/host-`, home: `${tmp}/host-/home` },
        { ...expected, home: actual.home },
        { ...expected, removed: false },
        { ...expected, extra: component },
      ]) {
        expect(failure("host-env-order", [{ ...error, expected: JSON.stringify(changed) }])).toBeNull();
      }
    }
  },
  options,
);

// Plant: accept a different matcher value or frame as one of the three new host faults.
it.prop(
  "new host faults require their matcher values and exact assertion frame",
  {
    key: Schema.Literals(["host-requested-pin", "host-pnpm-path", "host-env-order"]),
    content: Schema.String,
    delta: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  },
  ({ key, content, delta }) => {
    const location = position(key);

    const error = {
      ...matcher(key, content),
      stack: `at matcher (/private/${cases[key].test}:${location.line}:${location.column})`,
    };

    expect(failure(key, [error])).toMatchObject({ assertion: location });

    for (const invalid of [
      { ...error, stack: `at matcher (${cases[key].test}:${location.line + delta}:${location.column})` },
      { ...error, stack: `at matcher (${cases[key].test}:${location.line}:${location.column + delta})` },
      { ...error, stack: "no source frame" },
      { ...error, message: `unrelated ${error.message}` },
      { ...error, name: "Error" },
    ]) {
      expect(failure(key, [invalid])).toBeNull();
    }

    if (key !== "host-pnpm-path") {
      for (const invalid of [
        { ...error, operator: "deepStrictEqual" },
        { ...error, actual: error.expected },
        { ...error, actual: undefined },
        { ...error, expected: undefined },
        { ...error, actual: `${error.actual}!` },
      ]) {
        expect(failure(key, [invalid])).toBeNull();
      }
    }

    if (key === "host-env-order") {
      const actual = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(
        error.actual,
      );

      for (const changed of [
        { ...actual, keep: `${content}!` },
        { ...actual, tmp: `${content}!` },
        { ...actual, home: `${content}!` },
        { ...actual, foreground: false },
        { ...actual, paid: false },
        { ...actual, removed: true },
        { ...actual, extra: content },
      ]) {
        expect(failure(key, [{ ...error, actual: JSON.stringify(changed) }])).toBeNull();
      }
    }
  },
  options,
);

// Plant: copy raw actual/expected JSON or a stack into the new closed diagnostic metadata.
it.prop(
  "strict diagnostics discard generated matcher values and paths",
  {
    key: Schema.Literals(["host-requested-pin", "host-pnpm-path", "host-env-order"]),
    content: Schema.String,
  },
  ({ key, content }) => {
    const marker = `private-value-${JSON.stringify(content)}-end`;
    const location = position(key);

    const result = failure(key, [
      {
        ...matcher(key, marker),
        stack: `at matcher (/private/${marker}/${cases[key].test}:${location.line}:${location.column})`,
        private: marker,
      },
    ]);

    expect(result).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(JSON.stringify(result)).not.toContain(JSON.stringify(marker).slice(1, -1));
    expect(JSON.stringify(result)).not.toContain(encodeURIComponent(marker));
    const raw = report(key, "failed", [message(key)]);
    raw.testResults[0]!.assertionResults[0]!.meta.plant = result;
    const published = JSON.stringify(observation(key, root, JSON.stringify(raw), 1, 12));
    expect(published).not.toContain(marker);
    expect(published).not.toContain(JSON.stringify(marker).slice(1, -1));
    expect(published).not.toContain(encodeURIComponent(marker));
    expect(published).not.toContain("/private/");
    expect(published).not.toContain("actual");
    expect(published).not.toContain("expected");
  },
  options,
);

// Plant: choose the first same-title case instead of the trusted request case.
it.prop(
  "reporter binds same-title failures to the trusted selected case only",
  { key: Request.fields.case, content: Schema.String },
  ({ key, content }) => {
    const selected = cases[key];
    const file = `/private/${selected.test}`;
    const location = position(key);
    const error = { ...matcher(key, content), stack: `at matcher (${file}:${location.line}:${location.column})` };
    const expected = failure(key, [error]);
    const reporter = new PlantReporter({ case: key });

    expect(expected).not.toBeNull();
    expect(reporter.failure(file, selected.title, [error])).toEqual(expected);
    expect(reporter.failure(`${file}!`, selected.title, [error])).toBeNull();
    expect(reporter.failure(file, `${selected.title}!`, [error])).toBeNull();

    for (const invalid of [undefined, null, `unknown-${content}`, {}, []]) {
      expect(new PlantReporter({ case: invalid }).failure(file, selected.title, [error])).toBeNull();
    }

    if (key === "host-requested-pin" || key === "host-env-order") {
      expect(new PlantReporter({ case: "host-pin" }).failure(file, selected.title, [error])).toBeNull();
    }

    if (key === "host-pnpm-path") {
      const wrong = { ...error, stack: `at matcher (${file}:194:71)` };
      expect(reporter.failure(file, selected.title, [wrong])).toBeNull();
      expect(new PlantReporter({ case: "host-pin" }).failure(file, selected.title, [wrong])).not.toBeNull();
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
      "watcher-r1": "AssertionError: expected _tag loaded; received _tag same",
      "host-pin": "AssertionError: direct and nested pnpm versions differ from the explicit Node pin",
      "host-discovery-timeout": "AssertionError: runtime discovery exceeded the existing command cleanup bound",
      "host-requested-pin": "AssertionError: runtime discovery ignored the explicit Node pin",
      "host-pnpm-path": "AssertionError: direct and nested pnpm versions differ from the explicit Node pin",
      "host-env-order": "AssertionError: pinned host environment retained a removed parent value",
    };

    expect(JSON.parse(output).diagnostic).toBe(new Map(Object.entries(diagnostics)).get(key));
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
      const { original, prepared, edited, head } = images(key, content);
      expect(yield* prepare(key, original)).toEqual(prepared);
      const digest = yield* Digest.Digest;

      for (const brokenAt of [fault, 35]) {
        let current = original;
        let calls = 0;
        const tested: string[] = [];

        const io = <A>(body: () => A) =>
          Effect.suspend(() =>
            calls++ === brokenAt
              ? Effect.fail(ExerciseError.make({ reason: "injected-private-value" }))
              : Effect.sync(body),
          );

        const workspace = Workspace.of({
          inspect: io(() => ({
            bytes: current,
            mode: 0o100644,
            head,
            index: sha,
            status: current === original ? "" : ` M ${cases[key].file}\0`,
            summary: "",
          })),
          write: (data) =>
            io(() => {
              current = data;
            }),
          diff: io(() =>
            current === original ? new Uint8Array() : bytes(`generated-diff-${JSON.stringify(content)}`),
          ),
          test: (phase) =>
            io(() => {
              expect(current).toEqual(phase === "broken" ? edited : prepared);
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

        const answer = yield* exercise({ case: key, sha: head }).pipe(
          Effect.provideService(Workspace, workspace),
          Effect.option,
        );

        if (brokenAt === 35) {
          expect(Option.isSome(answer)).toBe(true);

          if (Option.isSome(answer)) {
            expect(Model.isAnyOf(["recorded"])(answer.value.model)).toBe(true);
            expect(answer.value.preparedHash).toBe(yield* digest.digestHex(Digest.sha256, prepared));
            expect(answer.value.observedHashes).toEqual({
              baseline: yield* digest.digestHex(Digest.sha256, prepared),
              broken: yield* digest.digestHex(Digest.sha256, edited),
              restored: yield* digest.digestHex(Digest.sha256, prepared),
            });
            expect(answer.value.cleanup.hash).toBe(yield* digest.digestHex(Digest.sha256, original));
            expect(current).toEqual(original);
          }
        }

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
      }
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
      const account = `private-account-${caller}`;

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
          Effect.succeed(JSON.stringify({ sender: { login: account }, inputs: request, ignored: content })),
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
              Schema.Struct({ caller: Schema.Null, source: Request.fields.sha, startedAt: Schema.String }),
            ),
          )(saved.at(-1));

          expect(before.caller).toBeNull();
          expect(before.source).toBe(request.sha);
          expect(before.startedAt).not.toBe("");

          return yield* ExerciseError.make({ reason });
        }),
      ).pipe(Effect.provide(layer), Effect.provide(Path.layer));

      expect(result).toBe(false);
      expect(entered).toBe(true);

      const Record = Schema.Struct({
        caller: Schema.Null,
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
        caller: null,
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
        caller: null,
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
        readFileString: () => Effect.succeed(JSON.stringify({ sender: { login: account }, inputs: request })),
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
          preparedHash: sha,
          editedHash: sha,
          observedHashes: { baseline: sha, broken: sha, restored: sha },
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
        caller: null,
        state: "incomplete",
        reason: "setup_or_io",
        model: { _tag: "recorded" },
        cleanup: { restored: true, hash: sha },
      });

      const invalid = FileSystem.layerNoop({
        makeDirectory: () => Effect.void,
        readFileString: () =>
          Effect.succeed(JSON.stringify({ sender: { login: account }, inputs: { ...request, patch: content } })),
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
        caller: null,
        source: null,
        request: null,
        state: "incomplete",
        reason: "request_invalid",
      });

      for (const raw of saved) {
        expect(raw).not.toContain(account);
        expect(raw).not.toContain(unknown);
        expect(raw).not.toContain(JSON.stringify(unknown).slice(1, -1));
        expect(raw).not.toContain(encodeURIComponent(unknown));
      }
    }),
  options,
);
