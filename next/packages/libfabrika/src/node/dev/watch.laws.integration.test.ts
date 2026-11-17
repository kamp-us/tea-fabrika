// P15 slice 1, next/. The watcher: laws L10 and L18 of the approved plan, through the real Rolldown
// watcher and the real program build on fixture programs in a temp folder. Only the brain is a
// double here: `install` and `failed` record what the watcher sent and answer as the brain would.
//
// Test contract (the plan's shapes): `node/dev/watch.ts`, exported as `@kampus/libfabrika/node/watch`,
// has `watchPrograms({root, entry, programs, install, failed})`, a scoped Stream of install answers.
// One Rolldown watcher per selected program, on its entry; on each `END` it runs `buildPrograms` for
// that program and installs `{id, program, hash, source, from}`, `from: "boot"` first, then
// `"watch"`. A bundle error is `failed {hash: null, reason: "bundle", path, line}`. Every watcher and
// every `BUNDLE_END` and `ERROR` result is closed with the scope (0061).
//
// L18 counts closes on the real Rolldown objects: `rolldown`'s `watch` is wrapped, never replaced.
//
// These start real file watchers. A sandbox that refuses file events (macOS without FSEvents in a
// box) builds once and never sees a save: L10 and L18's save-driven runs then wait for the lead.
import { NodeServices } from "@effect/platform-node";
import { runsFor } from "@kampus/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";
import * as fc from "fast-check";
import { assert, describe, expect, it, vi } from "vitest";
import { expectTypeOf } from "vitest";
import { hash } from "../../runtime/Built.ts";
import type * as Dev from "./dev.ts";
import { watchPrograms } from "./watch.ts";

const SEED = 119120;

const ROOT = new URL("../../../../../../", import.meta.url).pathname;

/** Every real Rolldown watcher and result the laws saw, and which were closed. */
const opened = vi.hoisted(() => ({
  watchers: [] as Array<{ closed: boolean; repeat: Effect.Effect<void> }>,
  results: [] as Array<{ code: string; closed: boolean }>,
}));

vi.mock("rolldown", async (original) => {
  const actual = await original<typeof import("rolldown")>();

  return {
    ...actual,
    watch: (...args: Parameters<typeof actual.watch>) => {
      const watcher = actual.watch(...args);
      const seen = { closed: false, repeat: Effect.void };
      opened.watchers.push(seen);
      const close = watcher.close.bind(watcher);
      watcher.close = () => {
        seen.closed = true;

        return close();
      };

      const on = watcher.on.bind(watcher);
      watcher.on = ((
        name: "event",
        listener: (event: import("rolldown").RolldownWatcherEvent) => void | Promise<void>,
      ) => {
        let cycle: Array<import("rolldown").RolldownWatcherEvent> = [];

        return on(name, (event) => {
          if (event.code === "START") {
            cycle = [];
          }

          // Repeat notifications, without acquiring another result or changing any file bytes.
          if (event.code === "ERROR") {
            cycle.push({
              ...event,
              result: new Proxy(event.result, {
                get(target, key) {
                  if (key === "close") {
                    // Replay owns no new Rolldown result to close.
                    return async () => undefined;
                  }

                  return Reflect.get(target, key);
                },
              }),
            });
          } else if (event.code !== "BUNDLE_END") {
            cycle.push(event);
          }

          if (event.code === "END") {
            const completed = cycle.slice();
            seen.repeat = Effect.forEach(
              completed,
              (notification) =>
                Effect.tryPromise({
                  try: async () => {
                    await listener(notification);
                  },
                  catch: (cause: unknown): Error => new Error("the repeated Rolldown notification failed", { cause }),
                }).pipe(Effect.orDie),
              { discard: true, concurrency: 1 },
            );
          }

          if ((event.code === "BUNDLE_END" || event.code === "ERROR") && event.result !== undefined) {
            const result = { code: event.code, closed: false };
            opened.results.push(result);
            const done = event.result.close.bind(event.result);
            event.result.close = () => {
              result.closed = true;

              return done();
            };
          }

          return listener(event);
        });
      }) as typeof watcher.on;

      return watcher;
    },
  };
});

type Options = Parameters<typeof watchPrograms>[0];

type Install = Parameters<Options["install"]>[0];

type Failed = Parameters<Options["failed"]>[0];

// 0135: the install restated here is the watcher's own parameter.
type InstallShape = {
  readonly id: string;
  readonly program: string;
  readonly hash: string;
  readonly source: string;
  readonly from: "watch" | "deploy" | "boot" | "restart" | "open";
};

expectTypeOf<Install>().toEqualTypeOf<InstallShape>();

// L20 (type): the install answer is a closed union a caller must match whole.
expectTypeOf<Effect.Success<ReturnType<Options["install"]>>["_tag"]>().toEqualTypeOf<"same" | "failed" | "loaded">();

// The handle `startDev` answers installs over its control socket in the watcher's own shape.
expectTypeOf<Effect.Success<ReturnType<typeof Dev.startDev>>["install"]>().toEqualTypeOf<Options["install"]>();

/** Two fixture programs and a module both import, in a fresh folder given back with its scope. */
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "p15w." });
  yield* fs.writeFileString(path.join(home, "package.json"), '{"type":"module"}');
  yield* fs.makeDirectory(path.join(home, "node_modules/@p15"), { recursive: true });

  for (const name of ["effect", "@demlik", "@kampus", "@alchemy.run"]) {
    yield* fs.symlink(path.join(ROOT, "next/apps/fabrika/node_modules", name), path.join(home, "node_modules", name));
  }

  yield* fs.makeDirectory(path.join(home, "shared"), { recursive: true });
  yield* fs.writeFileString(path.join(home, "shared/shared.ts"), "export const shared = 0;\n");
  // A module nothing imports: a save there reaches no program.
  yield* fs.writeFileString(path.join(home, "shared/unused.ts"), "export const unused = 0;\n");
  yield* fs.writeFileString(path.join(home, "brain.ts"), "export {};\n");

  for (const short of ["one", "two"]) {
    const pkg = path.join(home, "programs", short);
    yield* fs.makeDirectory(pkg, { recursive: true });
    yield* fs.symlink(pkg, path.join(home, "node_modules/@p15", short));
    yield* fs.writeFileString(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: `@p15/${short}`, type: "module", exports: { ".": "./program.ts" } }),
    );
    yield* fs.writeFileString(path.join(pkg, "own.ts"), "export const own = 0;\n");
    yield* fs.writeFileString(
      path.join(pkg, "program.ts"),
      `import {counter} from "@kampus/counter"; import {shared} from "../../shared/shared.ts"; import {own} from "./own.ts";\n` +
        `globalThis.__p15 = [shared, own]; export const program = {...counter, name: "p15/${short}"};\n`,
    );
  }

  /** Which files each program's bundle reaches, by the fixture's own import lines. */
  const reaches: Readonly<Record<string, ReadonlyArray<string>>> = {
    "programs/one/own.ts": ["p15/one"],
    "programs/two/own.ts": ["p15/two"],
    "shared/shared.ts": ["p15/one", "p15/two"],
    "shared/unused.ts": [],
  };

  return {
    home,
    reaches,
    programs: ["one", "two"].map((short) => ({ name: `p15/${short}`, package: `@p15/${short}`, export: "program" })),
  };
});

/** The brain as the watcher sees it: it answers `same` for a hash a program already runs. */
const brain = Effect.gen(function* () {
  const installs = yield* Queue.unbounded<Install>();
  const failures = yield* Queue.unbounded<Failed>();
  const running = new Map<string, string>();

  return {
    installs,
    failures,
    install: (code: Install) =>
      Effect.gen(function* () {
        yield* Queue.offer(installs, code);
        const same = running.get(code.program) === code.hash;
        running.set(code.program, code.hash);

        return same ? { _tag: "same" as const } : { _tag: "loaded" as const, processes: [] };
      }),
    failed: (fact: Failed) => Queue.offer(failures, fact).pipe(Effect.asVoid),
  };
});

/** Every install that arrives within `ms` of the last one. */
const drain = <A>(queue: Queue.Queue<A>, ms: number) =>
  Effect.gen(function* () {
    const got: Array<A> = [];

    while (true) {
      const next = yield* Queue.take(queue).pipe(Effect.timeoutOption(ms));

      if (next._tag === "None") {
        return got;
      }

      got.push(next.value);
    }
  });

describe("P15 slice 1: the watcher", () => {
  it("L17/L18: every completed rebuild records its program, bytes, duration and outcome, including initial bundle and compiler failures, without leaking source through warnings or repeating a failure for unchanged bytes", async () => {
    const seen = new Set<string>();

    const Save = fc.record({
      program: fc.nat(),
      sentinel: fc.stringMatching(/^[A-Z]{12}$/),
      move: fc.constantFrom("fit", "syntax", "compiler"),
      repeats: fc.integer({ min: 1, max: 3 }),
    });

    type Save = typeof Save extends fc.Arbitrary<infer A> ? A : never;

    const moves: ReadonlyArray<Save["move"]> = ["fit", "syntax", "compiler"];
    // One save of each move runs before the random tail: three seeded runs at the fast depth drew no
    // compiler move, so the reach check below failed while every rebuild was fine
    // (field/findings/2026-11-15-watch-l17-misses-compiler-move.json).
    const each = moves.map((move): [Save] => [{ program: 0, sentinel: "AAAAAAAAAAAA", move, repeats: 1 }]);
    await fc.assert(
      fc.asyncProperty(Save, (save) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const { home, programs } = yield* fixture;
              const selected = programs[save.program % programs.length]!;
              const short = selected.name.split("/")[1]!;
              const file = path.join(home, "programs", short, "program.ts");
              const original = yield* fs.readFileString(file);
              const sentinel = `P15SECRET${save.sentinel}`;

              const warnings = yield* Effect.acquireRelease(
                Effect.sync(() => vi.spyOn(console, "warn").mockImplementation(() => {})),
                (spy) => Effect.sync(() => spy.mockRestore()),
              );

              const move = save.move;
              // A duplicate key makes Rolldown warn with a source excerpt while the program still builds.
              let text = `${original}\nglobalThis.__p15Secret = {${JSON.stringify(sentinel)}: 1, ${JSON.stringify(sentinel)}: 2};\n`;

              if (move === "syntax") {
                text += `export const broken = ${JSON.stringify(sentinel)} +;\n`;
              } else if (move === "compiler") {
                yield* fs.writeFileString(
                  path.join(home, "programs", short, "view.tsx"),
                  'export function Bad() { "use no memo"; return <div />; }\nglobalThis.__p15View = Bad;\n',
                );
                text += 'import "./view.tsx";\n';
              }

              yield* fs.writeFileString(file, text);
              const spans: Array<Tracer.NativeSpan> = [];

              const tracer = Tracer.make({
                span(options) {
                  const span = new Tracer.NativeSpan(options);
                  spans.push(span);

                  return span;
                },
              });

              const installs: Array<Install> = [];
              const failures: Array<Failed> = [];
              const answers = yield* Queue.unbounded<Stream.Success<ReturnType<typeof watchPrograms>>>();
              const firstWatcher = opened.watchers.length;
              const running = new Map<string, string>();
              yield* Effect.forkScoped(
                Stream.runForEach(
                  watchPrograms({
                    root: home,
                    entry: path.join(home, "brain.ts"),
                    programs: [selected],
                    install: (code) =>
                      Effect.sync(() => {
                        installs.push(code);
                        const same = running.get(code.program) === code.hash;
                        running.set(code.program, code.hash);

                        return same ? { _tag: "same" as const } : { _tag: "loaded" as const, processes: [] };
                      }),
                    failed: (fact) =>
                      Effect.sync(() => {
                        failures.push(fact);
                      }),
                  }),
                  (answer) => Queue.offer(answers, answer),
                ).pipe(Effect.withTracer(tracer)),
              );
              const answer = yield* Queue.take(answers).pipe(Effect.timeout("10 seconds"));
              expect(answer).toMatchObject(
                move === "fit"
                  ? { _tag: "loaded", program: selected.name }
                  : { _tag: "failed", reason: move === "syntax" ? "bundle" : "compiler" },
              );
              // Rolldown may already have sent a second START to END cycle for the same bytes: macOS
              // reports the write above after the watcher starts. The plan lets a repeated event
              // rebuild and absorbs it as `same`, so the first span is the answer's, and the count
              // of rebuilds that changed anything is checked below, once every repeat has ended.
              const rebuilds = () => spans.filter((span) => span.name === "watch.rebuild");
              const span = rebuilds()[0];
              assert(span !== undefined, "the answered rebuild recorded its span");
              expect(span.status._tag).toBe("Ended");
              expect(span.attributes.get("program")).toBe(selected.name);
              expect(span.attributes.get("outcome")).toBe(answer._tag);
              expect(span.attributes.get("bytes")).toBe(
                installs[0] === undefined ? 0 : new TextEncoder().encode(installs[0].source).byteLength,
              );
              expect(span.attributes.get("ms")).toEqual(expect.any(Number));
              expect(Number(span.attributes.get("ms"))).toBeGreaterThanOrEqual(0);

              for (const output of [
                JSON.stringify([...span.attributes]),
                JSON.stringify(answer),
                JSON.stringify(failures),
                JSON.stringify(warnings.mock.calls),
              ]) {
                for (const forbidden of [sentinel, home]) {
                  for (const form of [
                    forbidden,
                    JSON.stringify(forbidden).slice(1, -1),
                    encodeURIComponent(forbidden),
                  ]) {
                    expect(output.includes(form), "a rebuild output copied private input").toBe(false);
                  }
                }
              }

              const repeats = save.repeats;

              for (let n = 0; n < repeats; n++) {
                yield* opened.watchers[firstWatcher]!.repeat;
                const repeated = yield* drain(answers, 300);
                expect(
                  failures,
                  "one failed save writes one code.failed fact, even after a repeated notification",
                ).toHaveLength(move === "fit" ? 0 : 1);

                for (const notification of repeated) {
                  expect(notification, "unchanged file bytes produced a second change or failure").toMatchObject({
                    _tag: "same",
                  });
                }
              }

              yield* Effect.sleep("20 millis").pipe(
                Effect.repeat({ until: () => rebuilds().every((rebuild) => rebuild.status._tag === "Ended") }),
                Effect.timeoutOrElse({
                  duration: "10 seconds",
                  orElse: () => Effect.die(new Error("a repeated rebuild never ended")),
                }),
              );
              expect(rebuilds().length, "the repeated notifications reached the watcher").toBeGreaterThan(1);
              expect(
                rebuilds().filter((rebuild) => rebuild.attributes.get("outcome") !== "same"),
                "one save records exactly one rebuild that changed or failed; every repeat records `same`",
              ).toEqual([span]);

              for (const rebuild of rebuilds()) {
                expect(rebuild.attributes.get("program")).toBe(selected.name);
                expect(Number(rebuild.attributes.get("ms"))).toBeGreaterThanOrEqual(0);
              }

              seen.add(move);
            }),
          ).pipe(Effect.provide(NodeServices.layer)),
        ),
      ),
      { seed: SEED, numRuns: runsFor({ fast: 3, full: 20 }), endOnFailure: true, examples: each },
    );
    expect(seen).toEqual(new Set(["fit", "syntax", "compiler"]));
  }, 300_000);

  // R1-R5. Plants: next-answer assertion; stale source; dropped rebuild/span; leaked input.
  const saveWalk = Effect.fnUntraced(function* (options: {
    readonly program: number;
    readonly edits: number;
    readonly next: (broken: boolean) => { move: "edit" | "syntax" | "fix"; value: number; sentinel: string };
    readonly seen: Set<string>;
    readonly hold: boolean;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { home, programs } = yield* fixture;
    const selected = programs[options.program % programs.length]!;
    const relative = path.join("programs", selected.name.split("/")[1]!, "own.ts");
    const file = path.join(home, relative);
    const b = yield* brain;

    type Reply = Stream.Success<ReturnType<typeof watchPrograms>>;

    const answers = yield* Queue.unbounded<Reply>();
    const completed = yield* Queue.unbounded<Tracer.NativeSpan>();

    const gates = yield* Queue.unbounded<{
      held: Deferred.Deferred<Reply>;
      release: Deferred.Deferred<void>;
    }>();

    const replies: Array<Reply> = [];
    const checked = new Set<Reply>();
    const spans: Array<Tracer.NativeSpan> = [];
    const checkedSpans = new Set<Tracer.NativeSpan>();
    const changedSpans: Array<Tracer.NativeSpan> = [];
    const installs = new Map<string, Install>();
    const sentinels: Array<string> = [];
    const failures: Array<Failed> = [];
    const required: Array<"loaded" | "failed"> = ["loaded"];
    const firstResult = opened.results.length;
    const firstWatcher = opened.watchers.length;
    let previousBytes = 0;
    let broken = false;

    const tracer = Tracer.make({
      span(settings) {
        const span = new Tracer.NativeSpan(settings);
        const end = span.end.bind(span);
        span.end = (at, exit) => {
          end(at, exit);

          if (span.name === "watch.rebuild") {
            spans.push(span);
            Queue.offerUnsafe(completed, span);
          }
        };

        return span;
      },
    });

    const duplicate = Effect.fnUntraced(function* (answer: Reply) {
      expect(answer.program).toBe(selected.name);
      expect(answer).toMatchObject({ _tag: "same" });
      expect(answer.hash !== null && installs.has(answer.hash), "same names a previously loaded hash").toBe(true);
      const code = yield* Queue.take(b.installs).pipe(Effect.timeout("3 seconds"));
      const loaded = installs.get(answer.hash ?? "");
      assert(loaded !== undefined, "the duplicate has an earlier successful install");
      expect(code).toMatchObject({ program: loaded.program, hash: loaded.hash, source: loaded.source, from: "watch" });
      checked.add(answer);
    });

    const checkSpan = (span: Tracer.NativeSpan) => {
      expect(checkedSpans.has(span), "each completed span is accounted for once").toBe(false);
      checkedSpans.add(span);
      assert(span.status._tag === "Ended", "the recorded span has ended");
      expect(Exit.isSuccess(span.status.exit), "an answered rebuild completed normally").toBe(true);
      expect(span.attributes.get("program")).toBe(selected.name);
      expect(span.attributes.get("bytes")).toEqual(expect.any(Number));
      expect(Number(span.attributes.get("bytes"))).toBeGreaterThanOrEqual(0);
      expect(span.attributes.get("ms")).toEqual(expect.any(Number));
      expect(Number(span.attributes.get("ms"))).toBeGreaterThanOrEqual(0);
    };

    const sameSpan = (span: Tracer.NativeSpan) => {
      checkSpan(span);
      expect(span.attributes.get("outcome")).toBe("same");
      expect(span.attributes.get("bytes")).toBe(previousBytes);
    };

    // The outer timeout belongs to the save, so a duplicate cannot renew it.
    const receiveChange = Effect.fnUntraced(function* (value: number, syntax: boolean) {
      while (true) {
        const answer = yield* Queue.take(answers);

        const same = Match.value(answer).pipe(
          Match.tag("same", () => true),
          Match.tag("loaded", "failed", () => false),
          Match.exhaustive,
        );

        if (same) {
          yield* duplicate(answer);
          continue;
        }

        expect(answer.program).toBe(selected.name);
        expect(answer).toMatchObject(syntax ? { _tag: "failed", reason: "bundle", hash: null } : { _tag: "loaded" });
        checked.add(answer);
        let bytes = 0;
        yield* Match.value(answer).pipe(
          Match.tag("loaded", (loaded) =>
            Effect.gen(function* () {
              expect(installs.has(loaded.hash), "a distinct save changes the installed hash").toBe(false);
              const code = yield* Queue.take(b.installs);
              expect(code).toMatchObject({
                program: selected.name,
                hash: loaded.hash,
                from: required.length === 1 ? "boot" : "watch",
              });
              expect(code.hash).toBe(yield* hash(code.source));
              expect(code.source, "the installed bundle contains this save's module value").toMatch(
                new RegExp(`\\b(?:var|let|const) own\\s*=\\s*${value}\\s*;`),
              );
              installs.set(loaded.hash, code);
              bytes = new TextEncoder().encode(code.source).byteLength;
            }),
          ),
          Match.tag("failed", (failed) =>
            Effect.gen(function* () {
              const fact = yield* Queue.take(b.failures);
              expect(fact).toMatchObject({ program: selected.name, reason: "bundle", hash: null });
              expect(fact.path).toBe(relative);
              expect(fact.line).toBeGreaterThanOrEqual(1);
              expect(failed.path).toBe(fact.path);
              expect(failed.line).toBe(fact.line);
              failures.push(fact);
            }),
          ),
          Match.tag("same", () => Effect.die(new Error("a duplicate completed the save"))),
          Match.exhaustive,
        );

        while (true) {
          const span = yield* Queue.take(completed);

          if (span.attributes.get("outcome") === "same") {
            sameSpan(span);
            continue;
          }

          checkSpan(span);
          expect(span.attributes.get("outcome")).toBe(answer._tag);
          expect(span.attributes.get("bytes")).toBe(bytes);
          changedSpans.push(span);
          previousBytes = bytes;

          return answer;
        }
      }
    });

    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.forkScoped(
          Stream.runForEach(
            watchPrograms({
              root: home,
              entry: path.join(home, "brain.ts"),
              programs: [selected],
              install: b.install,
              failed: b.failed,
            }),
            (answer) =>
              Effect.gen(function* () {
                yield* Match.value(answer).pipe(
                  Match.tag("same", () =>
                    Effect.gen(function* () {
                      const gate = yield* Queue.poll(gates);

                      if (Option.isSome(gate)) {
                        yield* Deferred.succeed(gate.value.held, answer);
                        yield* Deferred.await(gate.value.release);
                      }
                    }),
                  ),
                  Match.tag("loaded", "failed", () => Effect.void),
                  Match.exhaustive,
                );
                replies.push(answer);
                yield* Queue.offer(answers, answer);
              }),
          ).pipe(Effect.withTracer(tracer)),
        );
        yield* receiveChange(0, false).pipe(Effect.timeout("10 seconds"));

        for (let n = 0; n < options.edits; n++) {
          const edit = options.next(broken);
          const held = yield* Deferred.make<Reply>();
          const release = yield* Deferred.make<void>();
          const gate = options.hold && !broken;

          yield* Effect.scoped(
            Effect.gen(function* () {
              if (gate) {
                yield* Effect.acquireRelease(Effect.void, () => Deferred.succeed(release, undefined));
                yield* Queue.offer(gates, { held, release });
                yield* opened.watchers[firstWatcher]!.repeat;
                const answer = yield* Deferred.await(held).pipe(Effect.timeout("3 seconds"));
                expect(answer).toMatchObject({ _tag: "same" });
              }

              broken = edit.move === "syntax";
              required.push(broken ? "failed" : "loaded");
              const sentinel = `P15SECRET${edit.sentinel}`;
              sentinels.push(sentinel);
              const results = opened.results.length;
              yield* fs.writeFileString(
                file,
                broken
                  ? `export const own = ${JSON.stringify(sentinel)} +; // ${edit.value}\n`
                  : `export const own = ${edit.value};\n`,
              );
              yield* Deferred.succeed(release, undefined);
              yield* receiveChange(edit.value, broken).pipe(
                Effect.timeoutOrElse({
                  duration: "3 seconds",
                  orElse: () => Effect.die(new Error("the watcher did not report the saved module's rebuild")),
                }),
              );
              expect(
                opened.results.slice(results).some((result) => result.code === (broken ? "ERROR" : "BUNDLE_END")),
              ).toBe(true);
              expect(opened.results.slice(firstResult).every((result) => result.closed)).toBe(true);

              if (gate) {
                expect(
                  checked.has(yield* Deferred.await(held)),
                  "the held duplicate was checked before the changed reply",
                ).toBe(true);
              }

              yield* opened.watchers[firstWatcher]!.repeat;
              yield* Queue.take(completed).pipe(
                Effect.tap((span) => Effect.sync(() => sameSpan(span))),
                Effect.timeout("10 seconds"),
              );
              const late = yield* drain(answers, 300);

              for (const answer of late) {
                yield* duplicate(answer);
              }

              expect(yield* Queue.clear(b.failures), "unchanged failures write no additional fact").toEqual([]);
              options.seen.add(edit.move);
            }),
          );
        }
      }),
    );

    for (const answer of yield* Queue.clear(answers)) {
      yield* duplicate(answer);
    }

    for (const span of yield* Queue.clear(completed)) {
      const status = span.status;

      if (status._tag === "Ended" && Exit.isSuccess(status.exit)) {
        sameSpan(span);
      }
    }

    const normal = spans.filter((span) => span.status._tag === "Ended" && Exit.isSuccess(span.status.exit));
    expect(
      normal.every((span) => checkedSpans.has(span)),
      "every normally completed rebuild is checked",
    ).toBe(true);
    expect(
      replies.every((reply) => checked.has(reply)),
      "every delivered reply is checked",
    ).toBe(true);
    expect(replies.filter((reply) => reply._tag !== "same").map((reply) => reply._tag)).toEqual(required);
    expect(changedSpans.map((span) => span.attributes.get("outcome"))).toEqual(required);
    expect(failures).toHaveLength(required.filter((outcome) => outcome === "failed").length);
    expect(yield* Queue.clear(b.failures)).toEqual([]);
    expect(opened.watchers.slice(firstWatcher).every((watcher) => watcher.closed)).toBe(true);
    expect(opened.results.slice(firstResult).every((result) => result.closed)).toBe(true);

    for (const output of [
      JSON.stringify(replies),
      JSON.stringify(failures),
      ...spans.map((span) => JSON.stringify([...span.attributes])),
    ]) {
      for (const forbidden of [home, ...sentinels]) {
        for (const form of [forbidden, JSON.stringify(forbidden).slice(1, -1), encodeURIComponent(forbidden)]) {
          expect(output.includes(form), "a rebuild output copied private input").toBe(false);
        }
      }
    }
  });

  it("L17/L18: save-driven rebuilds record success and ERROR outcomes and close every acquired result", async () => {
    const seen = new Set<string>();
    await fc.assert(
      fc.asyncProperty(fc.gen(), (g) => {
        const program = g(fc.nat, { max: 1 });
        const edits = g(fc.integer, { min: 2, max: 5 });
        let value = 0;

        return Effect.runPromise(
          Effect.scoped(
            saveWalk({
              program,
              edits,
              seen,
              hold: true,
              next: (broken) => {
                const moves: ReadonlyArray<"fix" | "syntax" | "edit"> = broken ? ["fix", "syntax"] : ["edit", "syntax"];
                const move = moves[g(fc.nat, { max: moves.length - 1 })]!;
                value += g(fc.integer, { min: 1, max: 99 });

                return { move, value, sentinel: g(() => fc.stringMatching(/^[A-Z]{12}$/)) };
              },
            }),
          ).pipe(Effect.provide(NodeServices.layer)),
        );
      }),
      { seed: SEED, numRuns: runsFor({ fast: 3, full: 20 }), endOnFailure: true },
    );
    expect(seen).toEqual(new Set(["edit", "syntax", "fix"]));
  }, 300_000);

  // scenario: R1 gates a real unchanged reply from boot and a preceding save, before good and broken saves.
  // Plant: replace receiveChange's loop with the original next-answer assertion.
  it("scenario: R1 a held same reply from boot or a preceding save cannot complete a good or broken save", async () => {
    for (const preceding of [false, true]) {
      for (const syntax of [false, true]) {
        let value = 0;
        const edits = preceding ? 2 : 1;
        await Effect.runPromise(
          Effect.scoped(
            saveWalk({
              program: 0,
              edits,
              seen: new Set(),
              hold: true,
              next: () => {
                value++;

                return { move: value === edits && syntax ? "syntax" : "edit", value, sentinel: "AAAAAAAAAAAA" };
              },
            }),
          ).pipe(Effect.provide(NodeServices.layer)),
        );
      }
    }
  }, 300_000);

  // L10, p77. Plant: hash the entry file only; push the swap to every process.
  it("L10: a save changes the hash of exactly the programs whose bundle reaches the file, and only they install", async () => {
    const seen = new Set<string>();
    await fc.assert(
      fc.asyncProperty(fc.gen(), (g) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const { home, reaches, programs } = yield* fixture;
              const b = yield* brain;

              const stream = watchPrograms({
                root: home,
                entry: path.join(home, "brain.ts"),
                programs,
                install: b.install,
                failed: b.failed,
              });

              yield* Effect.forkScoped(Stream.runDrain(stream));
              // The start: every program installs once, from the boot.
              const first = yield* drain(b.installs, 3000);
              expect(first.map((i) => [i.program, i.from]).toSorted()).toEqual(
                programs.map((p) => [p.name, "boot"]).toSorted(),
              );
              const hashes = new Map(first.map((i) => [i.program, i.hash]));
              const values = new Map<string, number>();
              const edits = g(fc.integer, { min: 1, max: 4 });

              for (let n = 0; n < edits; n++) {
                // A file from the current set, and an edit: a new value, so the bytes change.
                const files = Object.keys(reaches);
                const file = files[g(fc.nat, { max: files.length - 1 })]!;
                const value = (values.get(file) ?? 0) + g(fc.integer, { min: 1, max: 99 });
                values.set(file, value);
                const name = file.endsWith("shared.ts") ? "shared" : file.endsWith("unused.ts") ? "unused" : "own";
                yield* fs.writeFileString(path.join(home, file), `export const ${name} = ${value};\n`);
                const got = yield* drain(b.installs, 3000);
                const changed = got.filter((i) => i.hash !== hashes.get(i.program)).map((i) => i.program);
                expect(new Set(changed), `a save to ${file}`).toEqual(new Set(reaches[file]));
                expect(got.every((i) => i.from === "watch")).toBe(true);
                expect(new Set(got.map((i) => i.program)), "only the programs that reach it install").toEqual(
                  new Set(reaches[file]),
                );

                for (const i of got) {
                  hashes.set(i.program, i.hash);
                }

                seen.add(reaches[file]!.length === 2 ? "shared" : reaches[file]!.length === 1 ? "own" : "outside");
              }
            }),
          ).pipe(Effect.provide(NodeServices.layer)),
        ),
      ),
      { seed: SEED, numRuns: runsFor({ fast: 3, full: 20 }), endOnFailure: true },
    );

    for (const kind of ["shared", "own", "outside"]) {
      expect(seen.has(kind), `the walk reaches a save to a ${kind} file`).toBe(true);
    }
  }, 600_000);

  // L18. Plant: never close a BUNDLE_END result; close the watcher outside the scope.
  it("L18: every Rolldown watcher and every BUNDLE_END and ERROR result is closed when the scope closes, after success, a failure or an interruption at any point the run reached", async () => {
    const seen = new Set<string>();
    await fc.assert(
      fc.asyncProperty(fc.gen(), (g) =>
        Effect.runPromise(
          Effect.gen(function* () {
            opened.watchers.length = 0;
            opened.results.length = 0;
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            // The point the run is cut at: after this many installs or failures, picked from what it reached.
            const cut = g(fc.integer, { min: 0, max: 4 });
            const broken = g(fc.boolean);
            yield* Effect.scoped(
              Effect.gen(function* () {
                expect.hasAssertions();
                const { home, programs } = yield* fixture;
                const b = yield* brain;
                const reached = yield* Deferred.make<void>();
                let events = 0;

                const count = <A, E>(work: Effect.Effect<A, E>) =>
                  Effect.tap(work, () => (++events >= cut ? Deferred.succeed(reached, undefined) : Effect.void));

                const run = yield* Effect.forkScoped(
                  Stream.runDrain(
                    watchPrograms({
                      root: home,
                      entry: path.join(home, "brain.ts"),
                      programs,
                      install: (code) => count(b.install(code)),
                      failed: (fact) => count(b.failed(fact)),
                    }),
                  ),
                );

                if (cut === 0) {
                  // Cut as it acquires its watchers.
                  yield* Effect.yieldNow;
                  seen.add("acquire");
                } else {
                  yield* drain(b.installs, 3000);

                  if (broken) {
                    // A save that does not parse: Rolldown answers ERROR, with a result to close.
                    yield* fs.writeFileString(path.join(home, "shared/shared.ts"), "export const shared = ;\n");
                    const failure = yield* Queue.take(b.failures).pipe(Effect.timeoutOption(3000));
                    expect(
                      Option.isSome(failure),
                      "the real watcher must reach the syntax failure before interruption",
                    ).toBe(true);
                    expect(
                      opened.results.some((r) => r.code === "ERROR"),
                      "the run acquired an ERROR result",
                    ).toBe(true);
                    seen.add("error");
                  } else {
                    yield* fs.writeFileString(path.join(home, "shared/shared.ts"), `export const shared = ${cut};\n`);
                  }

                  yield* Deferred.await(reached).pipe(Effect.timeoutOption(3000));
                  seen.add("reached");
                }

                yield* Fiber.interrupt(run);
              }),
            );
            // The scope is closed: everything Rolldown opened for the run is closed.
            expect(opened.watchers.length, "the run opened a watcher per program").toBeGreaterThan(0);
            expect(
              opened.watchers.filter((w) => !w.closed),
              "watchers left open",
            ).toEqual([]);
            expect(
              opened.results.filter((r) => !r.closed),
              "results left open",
            ).toEqual([]);
          }).pipe(Effect.provide(NodeServices.layer)),
        ),
      ),
      { seed: SEED, numRuns: runsFor({ fast: 3, full: 20 }), endOnFailure: true },
    );

    for (const point of ["acquire", "reached", "error"]) {
      expect(seen.has(point), `the walk reaches ${point}`).toBe(true);
    }
  }, 600_000);
});
