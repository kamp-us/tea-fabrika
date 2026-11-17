// Today's tooling on memory-only services. Synthetic traces here provide no actual-input proof.
import { Effect, Exit, Result } from "effect";
import { Digest } from "effect/crypto";
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
