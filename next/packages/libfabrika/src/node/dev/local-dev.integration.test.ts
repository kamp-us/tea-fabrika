import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Arr from "effect/Array";
import * as Formatter from "effect/Formatter";
import * as fc from "fast-check";
import { processId } from "../../Id.test-support.ts";
import { BrainEvent } from "../../runtime/BrainEvent.ts";
import { brainOutbox, checkMemory } from "./local-dev.ts";

/** The failure a stand-in control channel answers a flush with. */
class ControlFault extends Schema.TaggedError<ControlFault, { readonly brand: unique symbol }>()("ControlFault", {
  message: Schema.String,
}) {}

const SEED = 119120;

// Each run has its own scope, so the folder a run opens goes away when the run ends (0061).
const runNode = <A, E>(work: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
  Effect.runPromise(work.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

const home = (prefix: string) =>
  Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), prefix))),
    (folder) => Effect.sync(() => rmSync(folder, { recursive: true, force: true })),
  );

const firstStart: typeof BrainEvent.Type = {
  id: "brain-start-1",
  _tag: "started",
  start: Effect.runSync(processId),
  after: null,
  build: "build-a",
  reason: "open",
  pid: 417,
  at: 42,
};

const life = {
  id: fc.string({ minLength: 1 }),
  start: fc.string({ minLength: 1 }),
  at: fc.integer({ min: 0 }),
  exitCode: fc.option(fc.integer(), { nil: null }),
  signal: fc.option(fc.string(), { nil: null }),
  bytes: fc.integer({ min: 0 }),
  backoff: fc.integer({ min: 0 }),
};

const reason = fc.constantFrom("open", "crash", "memory", "core");

const brainEvent: fc.Arbitrary<typeof BrainEvent.Type> = fc.oneof(
  fc.record({
    ...life,
    _tag: fc.constant("started"),
    after: fc.option(fc.string(), { nil: null }),
    build: fc.string(),
    reason,
    pid: fc.integer({ min: 1 }),
  }),
  fc.record({ ...life, _tag: fc.constant("exited"), reason }),
  fc.record({
    ...life,
    _tag: fc.constant("braked"),
    reason: fc.constantFrom("intensity", "restart_failed"),
  }),
  fc.record({ ...life, _tag: fc.constant("stopped"), reason: fc.constant("stop") }),
);

describe("P12 local brain life", () => {
  // The memory restart plan makes the limit a setting, `desktop.brain-memory`, so the law generates it;
  // the pinned cases keep 0292's 500 MB mark.
  it("p81 plant: sample workerd RSS, replace at the limit, never measure the Node parent", () => {
    const child = fc.integer({ min: 1 }).filter((pid) => pid !== process.pid);
    const belowCap: [number, number, number] = [499_999_999, 417, 500_000_000];
    const atCap: [number, number, number] = [500_000_000, 417, 500_000_000];
    const aboveCap: [number, number, number] = [500_000_001, 417, 500_000_000];
    const limit = fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER });
    return fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), child, limit, (bytes, pid, limit) =>
        runNode(
          Effect.gen(function* () {
            const sampled: Array<number> = [],
              requests: Array<unknown> = [];

            yield* checkMemory({
              pid,
              limit,
              sample: (pid: number) =>
                Effect.sync(() => {
                  sampled.push(pid);

                  return bytes;
                }),
              replace: (reason: unknown) =>
                Effect.sync(() => {
                  requests.push(reason);
                }),
            });
            expect(sampled).toEqual([pid]);
            expect(sampled).not.toContain(process.pid);
            expect(requests).toEqual(bytes < limit ? [] : [{ reason: "memory", pid, bytes }]);
          }),
        ),
      ),
      { seed: SEED, examples: [belowCap, atCap, aboveCap] },
    );
  });
  it("p81/content plant: remove a pending event before acknowledgement or leak error text", () =>
    fc.assert(
      fc.asyncProperty(brainEvent, (event) =>
        runNode(
          Effect.gen(function* () {
            const folder = yield* home("p12-l-");
            let outbox = yield* brainOutbox(folder);
            yield* outbox.add(event);
            yield* Effect.exit(
              outbox.flush(() => Effect.fail(new ControlFault({ message: "private control failure" }))),
            );
            outbox = yield* brainOutbox(folder);
            expect(yield* outbox.pending).toEqual([event]);
            expect(readFileSync(join(folder, "brain.pending.jsonl"), "utf8")).not.toContain("private control failure");
            const sent: Array<unknown> = [];
            yield* outbox.flush((row: unknown) =>
              Effect.sync(() => {
                sent.push(row);
              }),
            );
            expect(sent).toEqual([event]);
            expect(yield* outbox.pending).toEqual([]);
            yield* outbox.add(event);
            yield* outbox.flush((row: unknown) =>
              Effect.sync(() => {
                sent.push(row);
              }),
            );
            expect(sent).toEqual([event, event]); // Same stable id lets Project deduplicate a lost reply.
            expect(readFileSync(join(folder, "brain.pending.jsonl"), "utf8")).not.toContain("private control failure");
          }),
        ),
      ),
      { seed: SEED, examples: [[firstStart]] },
    ));
});

describe("P12 durable brain outbox", () => {
  for (const reader of ["pending", "last"] as const) {
    it(`malformed saved ${reader} returns BrainError without a defect`, () => {
      const schema = reader === "pending" ? BrainEvent : Schema.NonEmptyString;
      return fc.assert(
        fc.asyncProperty(
          fc.jsonValue().filter((raw) => !Schema.is(schema)(raw)),
          async (raw) => {
            const exit = await runNode(
              Effect.gen(function* () {
                const folder = yield* home("p12-m-");
                writeFileSync(
                  join(folder, reader === "pending" ? "brain.pending.jsonl" : "brain.last.json"),
                  Formatter.formatJson(raw),
                );
                const outbox = yield* brainOutbox(folder);

                return yield* outbox[reader];
              }).pipe(Effect.exit),
            );

            expect(Exit.isFailure(exit)).toBe(true);
            const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
            expect(Cause.hasDies(cause)).toBe(false);
            expect(Cause.hasFails(cause)).toBe(true);
            expect(Cause.findErrorOption(cause)).toMatchObject({
              _tag: "Some",
              value: { _tag: "BrainError", reason: "bad_row" },
            });
          },
        ),
        { seed: SEED, numRuns: runsFor({ fast: 5, full: 20 }), examples: [[null], [{}], [17]] },
      );
    });
  }

  it("FileSystem writes each pending and last file in durable order, including acknowledgement", () =>
    fc.assert(
      fc.asyncProperty(fc.uniqueArray(brainEvent, { minLength: 1, maxLength: 4, selector: (row) => row.id }), (rows) =>
        runNode(
          Effect.gen(function* () {
            const context = yield* Effect.context<never>();
            const folder = yield* home("p12-m-");
            const files = new Map<string, string>();
            const calls: Array<unknown> = [];
            const joins: Array<ReadonlyArray<string>> = [];

            const note = (call: unknown) =>
              Effect.sync(() => {
                calls.push(call);
              });

            const fs = FileSystem.layerNoop({
              exists: (path) => Effect.sync(() => files.has(path)),
              readFileString: (path) => Effect.sync(() => files.get(path) ?? ""),
              makeDirectory: () => Effect.void,
              open: (path) =>
                Effect.acquireRelease(
                  Effect.sync((): FileSystem.File => {
                    calls.push(["open", path]);

                    return {
                      [FileSystem.FileTypeId]: FileSystem.FileTypeId,
                      stat: Effect.die("unused stat"),
                      seek: () => Effect.die("unused seek"),
                      read: () => Effect.die("unused read"),
                      readAlloc: () => Effect.die("unused readAlloc"),
                      truncate: () => Effect.die("unused truncate"),
                      write: () => Effect.die("use writeAll"),
                      sync: note(["sync", path]),
                      writeAll: (data) =>
                        Effect.sync(() => {
                          const text = new TextDecoder().decode(data);
                          calls.push(["write", path, text]);
                          files.set(path, text);
                        }),
                    };
                  }),
                  () => note(["close", path]),
                ),
              rename: (from, to) =>
                Effect.sync(() => {
                  calls.push(["rename", from, to]);
                  files.set(to, files.get(from)!);
                  files.delete(from);
                }),
            });
            const path = Effect.runSyncWith(context)(Path.Path.pipe(Effect.provide(Path.layer)));
            const paths = Layer.succeed(Path.Path, {
              ...path,
              join: (...parts) => {
                joins.push(parts);

                return path.join(...parts);
              },
            });

            const file = join(folder, "brain.pending.jsonl"),
              last = join(folder, "brain.last.json");

            const durable = (target: string, text: string) => [
              ["open", `${target}.tmp`],
              ["write", `${target}.tmp`, text],
              ["sync", `${target}.tmp`],
              ["close", `${target}.tmp`],
              ["rename", `${target}.tmp`, target],
              ["open", folder],
              ["sync", folder],
              ["close", folder],
            ];

            const encoded = (rows: ReadonlyArray<typeof BrainEvent.Type>) =>
              Arr.join(
                Arr.map(rows, (row) => JSON.stringify(row)),
                "\n",
              ) + (rows.length > 0 ? "\n" : "");
            yield* Effect.scoped(
              Effect.gen(function* () {
                const outbox = yield* brainOutbox(folder);
                const expected: Array<unknown> = [];

                for (const [index, row] of rows.entries()) {
                  yield* outbox.add(row);
                  expected.push(...durable(file, encoded(rows.slice(0, index + 1))));

                  if (row._tag === "started") {
                    expected.push(...durable(last, Formatter.formatJson(row.start)));
                  }

                  expect(calls).toEqual(expected);
                }

                const latest = Arr.filter(rows, (row) => row._tag === "started").at(-1);
                const sent: Array<typeof BrainEvent.Type> = [];
                yield* outbox.flush((row) =>
                  Effect.sync(() => {
                    sent.push(row);
                  }),
                );

                if (latest !== undefined) {
                  expected.push(...durable(last, Formatter.formatJson(latest.start)));
                }

                for (let n = 1; n <= rows.length; n++) {
                  expected.push(...durable(file, encoded(rows.slice(n))));
                }

                expect(calls).toEqual(expected);
                expect(sent).toEqual(rows);
                expect(yield* outbox.pending).toEqual([]);
                expect(yield* outbox.last).toBe(latest?.start ?? null);
                expect(joins).toContainEqual([folder, "brain.pending.jsonl"]);
                expect(joins).toContainEqual([folder, "brain.last.json"]);
              }),
            ).pipe(Effect.provide(fs.pipe(Layer.provideMerge(paths))));
          }),
        ),
      ),
      {
        seed: SEED,
        numRuns: runsFor({ fast: 4, full: 20 }),
        examples: [
          // Empty-after-ack and last-start writes must both keep the durability order.
          [[firstStart]],
          [[firstStart, { ...firstStart, id: "next", start: "next-start", at: 43 }]],
        ],
      },
    ));
  it("an event with an excess property is a bad_row on add and on a saved pending row", () =>
    fc.assert(
      fc.asyncProperty(brainEvent, fc.string({ minLength: 1 }), (event, extra) =>
        runNode(
          Effect.gen(function* () {
            const folder = yield* home("p12-m-");
            const outbox = yield* brainOutbox(folder);
            const excess = { ...event, [`x-${extra}`]: extra };
            expect(yield* Effect.flip(outbox.add(excess))).toMatchObject({
              _tag: "BrainError",
              reason: "bad_row",
            });
            expect(yield* outbox.pending).toEqual([]);
            writeFileSync(join(folder, "brain.pending.jsonl"), `${Formatter.formatJson(excess)}\n`);
            expect(yield* Effect.flip(outbox.pending)).toMatchObject({
              _tag: "BrainError",
              reason: "bad_row",
            });
          }),
        ),
      ),
      { seed: SEED, numRuns: runsFor({ fast: 3, full: 20 }) },
    ));
  it("an outbox id accepts an exact retry once and rejects changed content", () =>
    fc.assert(
      fc.asyncProperty(brainEvent, (event) =>
        runNode(
          Effect.gen(function* () {
            const folder = yield* home("p12-m-");
            const outbox = yield* brainOutbox(folder);
            yield* outbox.add(event);
            yield* outbox.add(event);
            expect(yield* outbox.pending).toEqual([event]);

            if (event._tag === "started") {
              const build = event.build === "build-b" ? "build-c" : "build-b";
              expect(yield* Effect.flip(outbox.add({ ...event, build }))).toMatchObject({
                _tag: "BrainError",
                reason: "id_reused",
              });
            }

            expect(yield* Effect.flip(outbox.add({ ...event, start: `${event.start}-changed` }))).toMatchObject({
              _tag: "BrainError",
              reason: "id_reused",
            });
            expect(yield* (yield* brainOutbox(folder)).pending).toEqual([event]);
          }),
        ),
      ),
      { seed: SEED, examples: [[firstStart]] },
    ));

  it("outbox writes release both the pending file and its directory handle", () =>
    fc.assert(
      fc.asyncProperty(brainEvent, (event) =>
        runNode(
          Effect.gen(function* () {
            const outbox = yield* brainOutbox(yield* home("p12-m-"));
            const before = readdirSync("/dev/fd").sort();
            yield* outbox.add(event);
            expect(readdirSync("/dev/fd").sort()).toEqual(before);
            yield* outbox.flush(() => Effect.void);
            expect(readdirSync("/dev/fd").sort()).toEqual(before);
          }),
        ),
      ),
      { seed: SEED, examples: [[firstStart]] },
    ));
});
