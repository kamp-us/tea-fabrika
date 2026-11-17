// Today's tooling. These laws supply in-memory I/O only; the real adapters remain unexercised.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Option, Schema } from "effect";
import { Digest } from "effect/crypto";
import { argv, cases, decodeRequest, derive, Request } from "./plant-cases.ts";
import { Model, Observation } from "./plant-machine.ts";
import { exercise, ExerciseError, observation, unchanged, Workspace, type Snapshot } from "./plant.ts";

const options = (plant: string) => ({
  arbitrary: { runs: runsFor({ fast: 100, full: 100 }) },
  meta: { plant },
});

const bytes = (text: string) => new TextEncoder().encode(text);

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

const message = (key: Request["case"]) =>
  key === "checklist-pid"
    ? "AssertionError: a notice names its process"
    : 'AssertionError: expected object to match object\n-  "_tag": "loaded",\n+  "_tag": "same",';

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

            return Effect.fail(new ExerciseError({ reason: "must_not_execute" }));
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
  options("accept unknown fields and cases"),
);

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
      expect(args).toContain(`^${RegExp.escape(selected.title)}$`);
      expect(args).toContain(selected.test);
      expect(args).not.toContain("--passWithNoTests");
      expect(args.some((arg) => /Timeout|retry|seed|numRuns/.test(arg))).toBe(false);
    }),
  options("replace every occurrence instead of requiring exactly one"),
);

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
  options("check allowed paths but ignore bytes or index"),
);

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
  options("accept exit 1 without a failed target assertion"),
);

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
    expect(JSON.parse(output).diagnostic).toBe(
      key === "checklist-pid"
        ? "AssertionError: a notice names its process"
        : "AssertionError: expected _tag loaded; received _tag same",
    );
  },
  options("publish raw failure messages"),
);

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
          calls++ === fault ? Effect.fail(new ExerciseError({ reason: "injected-private-value" })) : Effect.sync(body),
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
  options("skip scoped restoration after the broken child fails"),
);
