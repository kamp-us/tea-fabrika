// Today's tooling on memory-only services. Synthetic traces here provide no actual-input proof.
import { ByteSize, Effect, Exit, FileSystem, Option, Path, Ref, Result, Sink, Stream } from "effect";
import { Digest } from "effect/crypto";
import { HttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";
import fc from "fast-check";
import { expect, it } from "vitest";
import * as Cases from "./l11-cases.ts";
import * as Exercise from "./l11-exercise.ts";

const request: Cases.Request = { case: "l11-compare", sha: Cases.cached };

const bytes = (text: string) => new TextEncoder().encode(text);

it("fixed source and transform hashes refuse every changed input before writing", async () => {
  // Plant: omit the source digest check. The Digest stand-in identifies generated snapshots; it supplies no real-source proof.
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("l11-span-name", "l11-span-code", "l11-span-errcode", "l11-log", "l11-reply"),
      fc.constantFrom("none", "source", "transform"),
      fc.string(),
      async (name, fault, suffix) => {
        const request = Cases.Request.make({ case: name, sha: Cases.cached });
        const edits = Cases.mappings(request);
        const paths = [...new Set(edits.map((edit) => edit.path))];

        const saved = new Map(
          paths.map((path) => [
            path,
            bytes(
              edits
                .filter((edit) => edit.path === path)
                .map((edit) => edit.before)
                .join("\n") + suffix,
            ),
          ]),
        );

        const changed = Cases.derive(saved, edits);
        expect(Result.isSuccess(changed)).toBe(true);

        if (Result.isFailure(changed)) {
          return;
        }

        const expected = Cases.transformed[`${name}/cached`]!;

        const digest = Digest.Digest.of({
          digest: () => Effect.succeed(new Uint8Array()),
          digestHex: (_algorithm, value) =>
            Effect.sync(() => {
              const original = [...saved].find(([, content]) => content === value);

              if (original !== undefined) {
                if (fault === "source") {
                  return "wrong-source";
                }

                return original[0] === Cases.file
                  ? Cases.sources.cached.law
                  : original[0] === Cases.runtime
                    ? Cases.hashes[Cases.runtime]
                    : Cases.hashes[Cases.children];
              }

              const result = [...changed.success].find(
                ([, content]) => new TextDecoder().decode(content) === new TextDecoder().decode(value),
              );

              return fault === "transform" || result === undefined ? "wrong-transform" : expected[result[0]]!;
            }),
        });

        const result = await Effect.runPromise(
          Cases.prepare(request, "cached", saved).pipe(Effect.provideService(Digest.Digest, digest)),
        );

        expect(Result.isSuccess(result)).toBe(fault === "none");
      },
    ),
    { numRuns: 100 },
  );
});

it("strict requests reject caller additions and every unsupported case or source", () => {
  // Plant: remove onExcessProperty:error. Effect's schemas have no arbitrary for excess fields.
  fc.assert(
    fc.property(fc.constantFrom(...Cases.cases), fc.string(), fc.string(), (name, extra, value) => {
      expect(Result.isSuccess(Cases.decode({ case: name, sha: Cases.cached }))).toBe(true);
      const chosen = Cases.Request.make({ case: name, sha: Cases.cached });
      const pattern = Cases.argv(chosen, "private.json").find((arg) => arg.startsWith("--testNamePattern="));
      expect(Cases.argv(chosen, "private.json").includes("--disableConsoleIntercept")).toBe(name === "l11-inputs");
      expect(pattern === undefined).toBe(Cases.output(chosen) === null);

      if (pattern !== undefined) {
        const matcher = new RegExp(pattern.slice("--testNamePattern=".length));

        for (const title of Cases.titles) {
          expect(matcher.test(title)).toBe(Cases.selected(chosen).includes(title));
          expect(matcher.test(`${title}suffix`)).toBe(false);
        }
      }

      if (extra !== "case" && extra !== "sha") {
        expect(Result.isFailure(Cases.decode({ case: name, sha: Cases.cached, [extra]: value }))).toBe(true);
      }

      if (value !== Cases.cached) {
        expect(Result.isFailure(Cases.decode({ case: name, sha: value }))).toBe(true);
      }

      if (!Cases.cases.some((supported) => supported === value)) {
        expect(Result.isFailure(Cases.decode({ case: value, sha: Cases.cached }))).toBe(true);
      }

      expect(
        Cases.argv({ case: "l11-batch", sha: Cases.cached }, "private.json").some((arg) =>
          arg.startsWith("--testNamePattern"),
        ),
      ).toBe(false);
    }),
    { numRuns: 100 },
  );
});

it("fixed edits reject missing or duplicate anchors and preserve every other byte", () => {
  // Plant: accept the first of duplicate anchors. Generated surrounding bytes exclude the anchor alphabet.
  fc.assert(
    fc.property(
      fc.constantFrom(...Cases.cases),
      fc.array(fc.integer({ min: 128, max: 255 }), { maxLength: 30 }),
      (name, padding) => {
        const edits = Cases.mappings({ case: name, sha: Cases.cached });

        for (const edit of edits) {
          const pad = String.fromCharCode(...padding);
          const saved = new Map([[edit.path, bytes(`${pad}${edit.before}${pad}`)]]);
          const result = Cases.derive(saved, [edit]);
          expect(Result.isSuccess(result)).toBe(true);

          if (Result.isSuccess(result)) {
            expect(new TextDecoder().decode(result.success.get(edit.path))).toBe(`${pad}${edit.after}${pad}`);
          }

          expect(Result.isFailure(Cases.derive(new Map([[edit.path, bytes(edit.before + edit.before)]]), [edit]))).toBe(
            true,
          );
          expect(Result.isFailure(Cases.derive(new Map([[edit.path, bytes(pad)]]), [edit]))).toBe(true);
        }
      },
    ),
    { numRuns: 100 },
  );
});

it("report reconciliation refuses missing, skipped, contradictory and wrong-name assertions", () => {
  // Plant: credit a failed exit without the selected target. Reporter values match Vitest 5's installed types.
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: Cases.titles.length - 1 }),
      fc.constantFrom("passed", "failed", "skipped", "pending", "todo"),
      fc.nat({ max: 100000 }),
      (index, status, duration) => {
        const collection = Cases.titles.map((name) => ({ name, file: Cases.file }));

        const assertions = Cases.titles.map((fullName, at) => ({
          fullName,
          status: at === index ? status : "passed",
          duration,
          failureMessages: at === index && status === "failed" ? ["assertion failed"] : [],
        }));

        const failed = status === "failed";

        const report = {
          success: !failed,
          testResults: [
            {
              name: Cases.file,
              status: failed ? "failed" : "passed",
              message: "",
              startTime: 0,
              endTime: duration,
              assertionResults: assertions,
            },
          ],
        };

        const seen = Exercise.reconcile(request, collection, report, failed ? 1 : 0);
        expect(Exercise.Observation.isAnyOf(["observed"])(seen)).toBe(status === "passed" || status === "failed");
        expect(
          Exercise.Observation.isAnyOf(["incomplete"])(Exercise.reconcile(request, collection, report, failed ? 0 : 1)),
        ).toBe(true);
        assertions[index]!.fullName = "wrong assertion";
        expect(
          Exercise.Observation.isAnyOf(["incomplete"])(Exercise.reconcile(request, collection, report, failed ? 1 : 0)),
        ).toBe(true);
        expect(Exercise.Observation.isAnyOf(["incomplete"])(Exercise.reconcile(request, collection, null, 0))).toBe(
          true,
        );
      },
    ),
    { numRuns: 100 },
  );
});

const trace = (secret: string): Exercise.Trace[] => {
  const inventory = Cases.storagePaths.map((path) => ({ path, operation: 0, statement: "SELECT 1" }));
  const remaining = [...inventory];
  const events: Exercise.Trace[] = [Exercise.Trace.cases.inventory.make({ inventory })];
  const forms = [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];
  const encodings = [0, 1, 2] as const;

  for (let walk = 0; walk < 100; walk++) {
    events.push(Exercise.Trace.cases.walk.make({ walk, secret, forms }));

    for (let move = 0; move < 4; move++) {
      const encoding = encodings[move % encodings.length]!;
      const available = remaining.length > 0 ? remaining : inventory;
      events.push(
        Exercise.Trace.cases.pick.make({
          walk,
          move,
          pick: { point: 0, encoding },
          cut: available[0]!,
          repeat: remaining.length === 0,
          marker: forms[encoding]!,
        }),
        Exercise.Trace.cases.inspect.make({
          walk,
          move,
          counts: { reply: 1, span: 1, row: 1, log: 1 },
          leaks: { reply: false, span: false, row: false, log: false },
        }),
        Exercise.Trace.cases.move.make({ walk, moves: move + 1 }),
      );
      remaining.shift();
    }

    events.push(Exercise.Trace.cases.end.make({ walk, moves: 4 }));
  }

  events.push(Exercise.Trace.cases.complete.make({ remaining: 0, reached: inventory.length }));

  const failures = {
    descriptor: ["owner", "descriptor"],
    recovery: ["exists", "owner", "descriptor"],
    configuration: ["pending", "configure", "ack"],
    exit: ["exit_write", "down", "watch_cleanup", "retire"],
  };

  for (const path of Cases.paths) {
    for (const output of Cases.outputs) {
      for (let walk = 0; walk < 100; walk++) {
        events.push(Exercise.Trace.cases.project.make({ path, output, secret, forms }));
        const available = [...failures[path]];

        for (let move = 0; move < 4; move++) {
          const encoding = encodings[move % encodings.length]!;
          events.push(
            Exercise.Trace.cases["project-pick"].make({
              path,
              output,
              move,
              pick: { point: 0, encoding },
              available: [...available],
              repeat: available.length === 0,
            }),
          );
          const point = available.shift();

          if (point !== undefined) {
            events.push(Exercise.Trace.cases["project-cut"].make({ path, output, point, marker: forms[encoding]! }));
          }
        }

        events.push(
          Exercise.Trace.cases["project-end"].make({
            path,
            output,
            moves: 4,
            reached: failures[path].length,
            expected: failures[path].length,
            inspected: 1,
            leaked: false,
          }),
        );
      }
    }
  }

  return events;
};

const stdout = (events: readonly Exercise.Trace[]) =>
  events.map((event) => Cases.tracePrefix + JSON.stringify(event)).join("\n");

it("private input equality compares complete ordered values and every changed point", () => {
  // Plant: compare trace lengths only. This synthetic generator tests the comparator, never the real workload.
  fc.assert(
    fc.property(fc.string({ maxLength: 30 }), fc.integer({ min: 0, max: 5 }), (secret, mutation) => {
      const before = trace(secret);
      const after = structuredClone(before);
      expect(Result.isSuccess(Exercise.equality(stdout(before), stdout(after)))).toBe(true);
      const pick = after.find((event) => event._tag === "pick")!;

      if (pick._tag !== "pick") {
        throw new Error("no generated pick");
      }

      switch (mutation) {
        case 0:
          pick.pick.point += Cases.storagePaths.length;
          break;
        case 1:
          pick.pick.encoding = 2;
          pick.marker = encodeURIComponent(secret);
          break;
        case 2:
          pick.cut.operation++;
          break;
        case 3:
          pick.marker += "x";
          break;
        case 4:
          pick.repeat = !pick.repeat;
          break;
        default:
          after.pop();
          break;
      }

      expect(Result.isFailure(Exercise.equality(stdout(before), stdout(after)))).toBe(true);
      expect(Result.isFailure(Exercise.equality(stdout(before), ""))).toBe(true);
    }),
    { numRuns: 100 },
  );
});

it("ten declared slots retain the first failure and reject replacement attempts", () => {
  // Plant: drop the failed slot before counting passes. Array generation varies every slot without resetting the manifest.
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom("passed", "failed", "incomplete", "unstarted", "canceled"), {
        minLength: 10,
        maxLength: 10,
      }),
      fc.integer({ min: 0, max: 9 }),
      (states, index) => {
        const slots = states.map((state, at): Exercise.BatchSlot => ({
          slot: Cases.Slot.literals[at]!,
          source: Cases.cached,
          attempt: 1,
          reason: null,
          state,
        }));

        const seen = Exercise.batch(slots);
        expect(Result.isSuccess(seen)).toBe(true);

        if (Result.isSuccess(seen)) {
          expect(seen.success.slots).toEqual(slots);
          expect(seen.success.complete).toBe(states.every((state) => state === "passed"));
          const first = states.findIndex((state) => state !== "passed");
          expect(seen.success.ordered).toBe(
            first < 0 || states.slice(first + 1).every((state) => state === "unstarted"),
          );
        }

        expect(Result.isFailure(Exercise.batch(slots.filter((_, at) => at !== index)))).toBe(true);
        expect(
          Result.isFailure(Exercise.batch(slots.map((slot, at) => (at === index ? { ...slot, attempt: 2 } : slot)))),
        ).toBe(true);
      },
    ),
    { numRuns: 100 },
  );
});

it("[secrets] sanitized facts discard raw diagnostics, generated values and paths", () => {
  // Plant: copy failureMessages into a fact. All diagnostic fields get the same generated forbidden bytes.
  fc.assert(
    fc.property(fc.stringMatching(/^[A-Z]{12}$/), (word) => {
      const marker = `private-${word}/%?\n`;
      const raw = [marker, JSON.stringify(marker), encodeURIComponent(marker), `/private/${marker}`];
      const collection = Cases.titles.map((name) => ({ name, file: Cases.file, event: raw, environment: raw }));

      const report = {
        success: false,
        stdout: raw,
        stderr: raw,
        diff: raw,
        auth: raw,
        testResults: [
          {
            name: Cases.file,
            status: "failed",
            message: "",
            startTime: 0,
            endTime: 1,
            assertionResults: Cases.titles.map((fullName) => ({
              fullName,
              status: "failed",
              duration: 1,
              failureMessages: raw,
            })),
          },
        ],
      };

      const seen = Exercise.reconcile(request, collection, report, 1);
      const published = JSON.stringify(seen);

      for (const value of raw) {
        expect(published).not.toContain(value);
      }

      expect(published).not.toContain(word);
      expect(published).not.toContain("failureMessages");
    }),
    { numRuns: 100 },
  );
});

it("multiple-file restoration attempts every saved file after each injected I/O failure", async () => {
  // Plant: restore only the first saved target. There is no real filesystem, Git, child or signal.
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 0, max: 33 }),
      fc.constantFrom("io", "index", "extra", "symlink", "mode"),
      async (fault, kind) => {
        const names = [Cases.file, Cases.runtime, Cases.children];

        const originals = new Map<string, Exercise.Saved>(
          names.map((path) => [path, { bytes: bytes(path), mode: 0o100644, regular: true, parents: true }]),
        );

        const files = new Map<string, Exercise.Saved>(
          [...originals].map(([path, saved]) => [path, { ...saved, bytes: saved.bytes.slice() }]),
        );

        const journal: string[] = [];
        let call = 0;
        let index = "original-index";
        let extra = "";

        const boundary = (label: string) =>
          Effect.gen(function* () {
            journal.push(label);

            if (call++ === fault && kind === "io") {
              return yield* Exercise.WorkspaceError.make({ reason: "operation_failed" });
            }
          });

        const workspace = Exercise.Workspace.of({
          identity: Effect.gen(function* () {
            yield* boundary("identity");

            return {
              head: Cases.cached,
              index,
              status:
                [...files]
                  .filter(([path, saved]) => new TextDecoder().decode(saved.bytes) !== path)
                  .map(([path]) => ` M ${path}\0`)
                  .toSorted()
                  .join("") + extra,
            };
          }),
          read: (path) =>
            Effect.gen(function* () {
              yield* boundary(`read:${path}`);
              const saved = files.get(path);

              if (saved === undefined) {
                return yield* Exercise.WorkspaceError.make({ reason: "source_missing" });
              }

              return saved;
            }),
          write: (path, saved) =>
            Effect.gen(function* () {
              yield* boundary(`write:${path}`);
              files.set(path, { ...saved, bytes: saved.bytes.slice() });
            }),
        });

        if (kind === "symlink") {
          files.set(Cases.children, { ...files.get(Cases.children)!, regular: false });
        }

        if (kind === "mode") {
          files.set(Cases.runtime, { ...files.get(Cases.runtime)!, mode: 0o100755 });
        }

        const use = Effect.sync(() => {
          if (kind === "index") {
            index = "changed-index";
          }

          if (kind === "extra") {
            extra = "?? extra\0";
          }

          return "executed";
        });

        const result = await Effect.runPromise(
          Exercise.temporary(
            request,
            "cached",
            names.map((path) => ({ path, before: path, after: "changed" })),
            use,
          ).pipe(Effect.provideService(Exercise.Workspace, workspace)),
        );

        expect(journal[0]).toBe("identity");

        if (kind === "io" && fault >= journal.length) {
          expect(result.restored).toBe(true);
        }

        if (result.restored) {
          expect(index).toBe("original-index");
          expect(extra).toBe("");

          for (const path of names) {
            expect(files.get(path)).toEqual(originals.get(path));
          }
        }

        if (kind === "index" || kind === "extra") {
          expect(result.restored).toBe(false);
        }

        if (kind === "symlink" || kind === "mode") {
          expect(Exit.isFailure(result.value)).toBe(true);
        }

        const changed = journal.some((label) => label.startsWith("write:"));

        if (changed) {
          for (const path of names) {
            expect(journal.filter((label) => label === `write:${path}`).length).toBeGreaterThan(0);
          }
        }
      },
    ),
    { numRuns: 100 },
  );
});

const stamp = "2026-11-17T08:00:00.000Z";

const workflowSha = "a".repeat(40);

const url = (id: number) => `https://github.com/kamp-us/tea-fabrika/actions/runs/123/job/${id}`;

const identity = (job: Exercise.IdentityRecord["job"], id = 1) =>
  Exercise.IdentityRecord.cases.verified.make({
    run: "123",
    attempt: 1,
    caller: 5,
    workflow: workflowSha,
    head: workflowSha,
    job,
    id,
    url: url(id),
    dispatched: null,
  });

const versions = { node: "26.13.0", effect: "4.1.3", vitest: "5.0.5", fastCheck: "4.10.2", tea: "0.27.0" } as const;

const sourceFact = (variant: Cases.Variant) =>
  Exercise.SourceFact.make({
    variant,
    sha: Cases.sources[variant].sha,
    tree: "b".repeat(40),
    product: Cases.hashes.product,
    index: "b".repeat(40),
    law: Cases.sources[variant].law,
    lock: Cases.hashes.lock,
    node: "26.13.0",
    git: "git version 2.50.0",
    versions: null,
  });

const clean = (variant: Cases.Variant): Exercise.Cleanup => ({
  variant,
  restored: true,
  files: true,
  head: true,
  index: true,
  status: true,
});

const testReport = (request: Cases.Request, failed = false, timeout = false, raw = "") => ({
  success: !failed,
  testResults: [
    {
      name: Cases.file,
      status: failed ? "failed" : "passed",
      message: "",
      startTime: 0,
      endTime: 1,
      assertionResults: Cases.selected(request).map((fullName) => ({
        fullName,
        status: failed ? "failed" : "passed",
        duration: timeout ? 60000 : 1,
        failureMessages: failed ? [timeout ? "Test timed out in 60000ms" : `assertion failed ${raw}`] : [],
      })),
    },
  ],
});

const standin = (
  request: Cases.Request,
  options: {
    readonly fail?: string;
    readonly timeout?: boolean;
    readonly secret?: string;
    readonly reports?: readonly unknown[];
    readonly jobs?: readonly Exercise.ActionJob[];
  } = {},
) => {
  const calls: string[] = [];
  const checkpoints: Exercise.Report[] = [];

  const boundary = (name: string) =>
    Effect.gen(function* () {
      calls.push(name);

      if (options.fail === name) {
        return yield* Exercise.WorkspaceError.make({ reason: "operation_failed" });
      }
    });

  const io = Exercise.Executor.of({
    now: Effect.succeed(stamp),
    inspect: (variant) => boundary(`inspect:${variant}`).pipe(Effect.as(sourceFact(variant))),
    install: (variant) => boundary(`install:${variant}`).pipe(Effect.as(versions)),
    collect: (variant) =>
      boundary(`collect:${variant}`).pipe(
        Effect.as(Cases.selected(request).map((name) => ({ name, file: Cases.file }))),
      ),
    apply: (variant) => boundary(`apply:${variant}`).pipe(Effect.as("f".repeat(64))),
    test: (variant, phase) =>
      boundary(`test:${variant}:${phase}`).pipe(
        Effect.as({
          exit: options.timeout ? 1 : 0,
          started: stamp,
          ended: stamp,
          elapsed: options.timeout ? 60000 : 1,
          stdout: options.secret ?? "",
          stderr: options.secret ?? "",
          pid: 10,
          report: testReport(request, options.timeout, options.timeout, options.secret),
        }),
      ),
    restore: (variant) => boundary(`restore:${variant}`).pipe(Effect.as(clean(variant))),
    hash: () => Effect.succeed("e".repeat(64)),
    reports: Effect.succeed(options.reports ?? []),
    jobs: Effect.succeed(options.jobs ?? []),
    checkpoint: (report) =>
      boundary("checkpoint").pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            checkpoints.push(structuredClone(report));
          }),
        ),
      ),
  });

  return { io, calls, checkpoints };
};

const run = (
  request: Cases.Request,
  mode: Exercise.Internal,
  id: Exercise.IdentityRecord,
  io: typeof Exercise.Executor.Service,
) => Effect.runPromise(Exercise.execute(request, mode, id).pipe(Effect.provideService(Exercise.Executor, io)));

it("executor preserves timing failures, cleans plants and continues both diagnostic variants", async () => {
  // Plant: stop the diagnostic after the first timed-out test; omit restoration after a broken run.
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(...Cases.cases),
      fc.boolean(),
      fc.nat({ max: 8 }),
      async (name, timeout, failure) => {
        const request = Cases.Request.make({ case: name, sha: Cases.cached });

        const mode =
          name === "l11-compare"
            ? Exercise.Internal.cases.compare.make({ variant: "cached" })
            : name === "l11-batch"
              ? Exercise.Internal.cases.batch.make({ slot: 1 })
              : name === "l11-inputs"
                ? Exercise.Internal.cases.inputs.make({})
                : Exercise.Internal.cases.output.make({});

        const points = [
          "none",
          "inspect:cached",
          "install:cached",
          "collect:cached",
          "apply:cached",
          "test:cached:broken",
          "test:cached:measurement",
          "checkpoint",
          "none",
        ];

        const mock = standin(request, { timeout, fail: points[failure] });

        const result = await run(
          request,
          mode,
          identity(
            name === "l11-compare"
              ? "compare"
              : name === "l11-batch"
                ? "slot-1"
                : name === "l11-inputs"
                  ? "inputs"
                  : "output",
          ),
          mock.io,
        );

        expect(Exercise.Report.make(result)).toEqual(result);

        if (name === "l11-row") {
          expect(mock.calls).toEqual([]);
          expect(result.result).toEqual({ _tag: "incomplete", reason: "row_mapping_missing" });
        }

        if (name === "l11-inputs" && mock.calls.includes("test:uncached:diagnostic")) {
          expect(mock.calls).toContain("apply:cached");
        }

        if (mock.calls.includes("test:cached:broken")) {
          expect(mock.calls).toContain("restore:cached");
          expect(mock.calls).toContain("test:cached:restored");
        }

        if (name === "l11-compare" && points[failure] === "none") {
          expect(result.result._tag).toBe("observed");
          expect(result.tests[0]?.observation._tag).toBe("observed");
          expect(Exercise.exitCode(result)).toBe(timeout ? 1 : 0);
        }
      },
    ),
    { numRuns: 100 },
  );
});

it("collector keeps all ten slots and rejects retry, wrong job and missing report credits", async () => {
  // Plant: accept a slot report from a different job ID, or drop a missing slot from the manifest.
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 10 }),
      fc.constantFrom("none", "missing", "job", "retry", "failed"),
      async (slot, fault) => {
        const request = Cases.Request.make({ case: "l11-batch", sha: Cases.cached });

        const manifest = await run(
          request,
          Exercise.Internal.cases.manifest.make({}),
          identity("manifest", 20),
          standin(request).io,
        );

        const reports: Exercise.Report[] = [manifest];
        const jobs: Exercise.ActionJob[] = [{ key: "manifest", variant: null, id: 20, url: url(20), state: "passed" }];

        for (const number of Cases.Slot.literals) {
          const key = `slot-${number}` as const;
          const mode = Exercise.Internal.cases.batch.make({ slot: number });
          const mock = standin(request, { timeout: number === slot && fault === "failed" });
          const actual = await run(request, mode, identity(key, number), mock.io);

          if (!(number === slot && fault === "missing")) {
            reports.push(
              number === slot && fault === "retry"
                ? { ...actual, identity: { ...actual.identity, attempt: 2 } }
                : actual,
            );
          }

          jobs.push({
            key,
            variant: null,
            id: number === slot && fault === "job" ? 99 : number,
            url: url(number),
            state: number === slot && fault === "failed" ? "failed" : "passed",
          });
        }

        const mock = standin(request, { reports, jobs });
        const result = await run(request, Exercise.Internal.cases.collect.make({}), identity("collect", 30), mock.io);
        expect(result.slots.map((row) => row.slot)).toEqual(Cases.Slot.literals);
        expect(result.result._tag).toBe(fault === "none" ? "observed" : "incomplete");
        expect(result.receipts.length).toBe(fault === "missing" || fault === "retry" ? 10 : 11);

        if (fault !== "none") {
          expect(result.slots[slot - 1]?.state).not.toBe("passed");
        }

        expect(mock.checkpoints.length).toBeGreaterThan(0);
      },
    ),
    { numRuns: 100 },
  );
});

it("[secrets] every public report and checkpoint drops generated child and error content", async () => {
  // Plant: include raw child output or an unknown error message in a checkpoint.
  await fc.assert(
    fc.asyncProperty(fc.stringMatching(/^[A-Z]{12}$/), fc.boolean(), async (word, timeout) => {
      const marker = `private-${word}/%?\\n`;
      const request = Cases.Request.make({ case: "l11-compare", sha: Cases.cached });
      const mock = standin(request, { secret: marker, timeout });

      const result = await run(
        request,
        Exercise.Internal.cases.compare.make({ variant: "cached" }),
        identity("compare"),
        mock.io,
      );

      for (const report of [result, ...mock.checkpoints]) {
        const published = JSON.stringify(report);
        expect(published).not.toContain(word);
        expect(published).not.toContain(encodeURIComponent(word));
        expect(published).not.toContain("failureMessages");
        expect(published).not.toContain("/private/");
      }
    }),
    { numRuns: 100 },
  );
});

it("scoped adapters check every parent and restore every target through injected filesystem and Git failures", async () => {
  // Plant: skip parent lstat, accept a changed Git index, or restore only one of the three saved targets.
  // All processes, filesystem operations and HTTP calls are memory stand-ins.
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("none", "parent", "mode", "index", "write"),
      fc.integer({ min: 0, max: 2 }),
      async (fault, index) => {
        const request = Cases.Request.make({ case: "l11-span-code", sha: Cases.cached });
        const root = "/memory/work";
        const temp = "/memory/temp";
        const scratch = `${temp}/private`;
        const source = `${root}/source-cached`;
        const paths = [Cases.file, Cases.runtime, Cases.children];
        const original = new Map(paths.map((file) => [`${source}/${file}`, bytes(file)]));
        original.set(`${source}/pnpm-lock.yaml`, bytes("lock"));
        original.set(`${source}/pnpm-workspace.yaml`, bytes("workspace"));
        const files = new Map([...original].map(([file, value]) => [file, value.slice()]));
        const writes: string[] = [];
        const gitCalls: string[] = [];
        let changedIndex = false;

        const info = (file: string): FileSystem.File.Info => ({
          type:
            fault === "parent" && file === `${source}/next/packages`
              ? "SymbolicLink"
              : files.has(file)
                ? "File"
                : "Directory",
          mode: fault === "mode" && file === `${source}/${paths[index]}` ? 0o100755 : 0o100644,
          mtime: Option.none(),
          atime: Option.none(),
          birthtime: Option.none(),
          dev: 0n,
          ino: Option.none(),
          nlink: Option.none(),
          uid: Option.none(),
          gid: Option.none(),
          rdev: Option.none(),
          size: ByteSize.bytes(files.get(file)?.length ?? 0),
          blksize: Option.none(),
          blocks: Option.none(),
        });

        const fs = FileSystem.makeNoop({
          makeDirectory: () => Effect.void,
          lstat: (file) => Effect.succeed(info(file)),
          realPath: (file) => Effect.succeed(file),
          readFile: (file) => Effect.sync(() => files.get(file) ?? bytes("")),
          writeFileString: () => Effect.void,
          chmod: () => Effect.void,
          open: (file) =>
            Effect.succeed({
              [FileSystem.FileTypeId]: FileSystem.FileTypeId,
              stat: Effect.succeed(info(file)),
              seek: () => Effect.succeed(0n),
              sync: Effect.void,
              read: () => Effect.succeed(0),
              readAlloc: () => Effect.succeed(Option.none()),
              truncate: () => Effect.void,
              write: (value) => Effect.succeed(value.length),
              writeAll: (value) =>
                Effect.sync(() => {
                  writes.push(file);

                  if (fault === "write" && file === `${source}/${paths[index]}`) {
                    throw new Error("injected private failure");
                  }

                  files.set(file, value.slice());
                }),
            }),
        });

        const spawner = ChildProcessSpawner.make((command) =>
          Effect.sync(() => {
            if (command._tag !== "StandardCommand" || command.command !== "git") {
              throw new Error("unexpected child");
            }

            expect(command.options.extendEnv).toBe(false);
            expect(Object.keys(command.options.env ?? {}).sort()).toEqual([
              "CI",
              "FABRIKA_MAX_WORKERS",
              "FABRIKA_TEST_DEPTH",
              "HOME",
              "LANG",
              "PATH",
              "TMPDIR",
            ]);
            const args = command.args.join(" ");
            gitCalls.push(args);

            const output =
              args === "rev-parse HEAD"
                ? Cases.cached
                : args === "write-tree"
                  ? changedIndex
                    ? "c".repeat(40)
                    : "b".repeat(40)
                  : args === "rev-parse HEAD:next/packages/libfabrika"
                    ? Cases.hashes.product
                    : args === "rev-parse HEAD^{tree}"
                      ? "b".repeat(40)
                      : args === "--version"
                        ? "git version 2.50.0"
                        : "";

            return ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(10),
              exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              stdin: Sink.drain,
              stdout: Stream.make(bytes(output)),
              stderr: Stream.empty,
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void),
            });
          }),
        );

        const digest = Digest.Digest.of({
          digest: () => Effect.succeed(bytes("")),
          digestHex: (_algorithm, value) =>
            Effect.succeed(
              new TextDecoder().decode(value) === Cases.file
                ? Cases.sources.cached.law
                : new TextDecoder().decode(value) === Cases.runtime
                  ? Cases.hashes[Cases.runtime]
                  : new TextDecoder().decode(value) === Cases.children
                    ? Cases.hashes[Cases.children]
                    : new TextDecoder().decode(value) === "lock"
                      ? Cases.hashes.lock
                      : Cases.hashes.workspace,
            ),
        });

        const env = Exercise.context({
          CI: "true",
          GITHUB_ACTIONS: "true",
          RUNNER_OS: "Linux",
          GITHUB_EVENT_NAME: "workflow_dispatch",
          GITHUB_REF: "refs/heads/main",
          GITHUB_REPOSITORY: "kamp-us/tea-fabrika",
          GITHUB_WORKFLOW_REF: "kamp-us/tea-fabrika/.github/workflows/l11-exercise.yaml@refs/heads/main",
          GITHUB_WORKFLOW_SHA: workflowSha,
          GITHUB_SHA: workflowSha,
          GITHUB_RUN_ID: "123",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_JOB: "output",
          GITHUB_WORKSPACE: root,
          GITHUB_EVENT_PATH: `${temp}/event.json`,
          RUNNER_TEMP: temp,
          RUNNER_NAME: "memory",
          PATH: "/memory/bin",
          L11_CASE: request.case,
          L11_SHA: Cases.cached,
          L11_MODE: "output",
        });

        if (Result.isFailure(env)) {
          throw new Error("invalid fixture");
        }

        const seed = await run(
          { case: "l11-batch", sha: Cases.cached },
          Exercise.Internal.cases.manifest.make({}),
          identity("manifest"),
          standin({ case: "l11-batch", sha: Cases.cached }).io,
        );

        const finalizers = Ref.make<readonly Exercise.Cleanup[]>([]);

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const last = yield* Ref.make(seed);
            const closed = yield* finalizers;

            const captured = yield* Effect.scoped(
              Effect.gen(function* () {
                const backend = yield* Exercise.live(
                  env.success,
                  request,
                  Exercise.Internal.cases.output.make({}),
                  scratch,
                  last,
                  closed,
                );

                const inspected = yield* backend.executor.inspect("cached").pipe(Effect.exit);

                if (Exit.isSuccess(inspected)) {
                  for (const file of paths) {
                    files.set(`${source}/${file}`, bytes("temporary changed bytes"));
                  }

                  changedIndex = fault === "index";
                }

                return inspected;
              }),
            );

            return { captured, cleanup: yield* Ref.get(closed) };
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provide(Path.layer),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.provideService(Digest.Digest, digest),
            Effect.provideService(
              HttpClient.HttpClient,
              HttpClient.make(() => Effect.die("unexpected request")),
            ),
          ),
        );

        if (fault === "parent" || fault === "mode") {
          expect(Exit.isFailure(result.captured)).toBe(true);
          expect(writes).toEqual([]);
        } else {
          expect(Exit.isSuccess(result.captured)).toBe(true);
          expect(result.cleanup).toHaveLength(1);
          expect(result.cleanup[0]?.restored).toBe(fault === "none");

          for (const file of paths) {
            expect(writes).toContain(`${source}/${file}`);
          }

          expect(gitCalls.filter((call) => call === "write-tree").length).toBeGreaterThan(1);

          if (fault === "none") {
            for (const [file, before] of original) {
              expect(files.get(file)).toEqual(before);
            }
          }
        }
      },
    ),
    { numRuns: 100 },
  );
});

it("comparison collector checks both actual source jobs and keeps failed timing observations", async () => {
  // Plant: accept a report whose actual job state disagrees with its test result.
  await fc.assert(
    fc.asyncProperty(
      fc.boolean(),
      fc.constantFrom("none", "missing", "state", "source", "identity"),
      async (timeout, fault) => {
        const request = Cases.Request.make({ case: "l11-compare", sha: Cases.cached });
        const reports: Exercise.Report[] = [];
        const jobs: Exercise.ActionJob[] = [];

        for (const [at, variant] of Cases.Variant.literals.entries()) {
          const report = await run(
            request,
            Exercise.Internal.cases.compare.make({ variant }),
            identity("compare", at + 1),
            standin(request, { timeout }).io,
          );

          reports.push(
            variant === "cached" && fault === "source"
              ? { ...report, sources: report.sources.map((source) => ({ ...source, sha: Cases.uncached })) }
              : variant === "cached" && fault === "identity"
                ? { ...report, identity: { ...report.identity, head: "c".repeat(40) } }
                : report,
          );
          jobs.push({
            key: "compare",
            variant,
            id: at + 1,
            url: url(at + 1),
            state:
              variant === "cached" && fault === "state"
                ? timeout
                  ? "passed"
                  : "failed"
                : timeout
                  ? "failed"
                  : "passed",
          });
        }

        const result = await run(
          request,
          Exercise.Internal.cases.collect.make({}),
          identity("collect", 3),
          standin(request, { reports: fault === "missing" ? reports.slice(1) : reports, jobs }).io,
        );

        expect(result.paired).toBe(fault === "none");
        expect(result.result._tag).toBe(fault === "none" ? "observed" : "incomplete");
        expect(result.tests.length).toBe(fault === "missing" || fault === "identity" ? 1 : 2);
      },
    ),
    { numRuns: 100 },
  );
});
