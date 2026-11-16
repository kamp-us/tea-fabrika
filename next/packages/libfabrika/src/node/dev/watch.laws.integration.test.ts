import { NodeServices } from "@effect/platform-node";
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
import { it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import * as Rec from "effect/Record";
import * as Formatter from "effect/Formatter";
import { String as Str, pipe } from "effect";
import * as fc from "fast-check";
import { assert, describe, expect, vi } from "vitest";
import { expectTypeOf } from "vitest";
import type * as Dev from "./dev.ts";
import { watchPrograms } from "./watch.ts";

/** A promise the test waits on rejected: the test's own failure, with the rejection as its cause. */
class TestFailure extends Schema.TaggedError<TestFailure>()("TestFailure", { cause: Schema.Unknown }) {}

/** Waits on a promise inside the test's Effect, as `Effect.tryPromise` in its object form. */
const promised = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new TestFailure({ cause }) });

const SEED = 119120;
/** Sorts `[program, from]` pairs so two lists compare as sets. */
const byPair = Order.Tuple([Order.String, Order.String]);
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
                    return () => Promise.resolve(undefined);
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
                  try: () => Promise.resolve(listener(notification)),
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
      Formatter.formatJson({ name: `@p15/${short}`, type: "module", exports: { ".": "./program.ts" } }),
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
    programs: Arr.map(["one", "two"], (short) => ({
      name: `p15/${short}`,
      package: `@p15/${short}`,
      export: "program",
    })),
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
  it.live(
    "L17/L18: every completed rebuild records its program, bytes, duration and outcome, including initial bundle and compiler failures, without leaking source through warnings or repeating a failure for unchanged bytes",
    () =>
      Effect.gen(function* () {
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
        const each = Arr.map(moves, (move): [Save] => [{ program: 0, sentinel: "AAAAAAAAAAAA", move, repeats: 1 }]);
        yield* promised(() =>
          fc.assert(
      fc.asyncProperty(Save, (save) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const { home, programs } = yield* fixture;
              const selected = programs[save.program % programs.length]!;
              const short = Str.split(selected.name, "/")[1]!;
              const file = path.join(home, "programs", short, "program.ts");
              const original = yield* fs.readFileString(file);
              const sentinel = `P15SECRET${save.sentinel}`;

              const warnings = yield* Effect.acquireRelease(
                Effect.sync(() => vi.spyOn(console, "warn").mockImplementation(() => {})),
                (spy) => Effect.sync(() => spy.mockRestore()),
              );

              const move = save.move;
              // A duplicate key makes Rolldown warn with a source excerpt while the program still builds.
              let text = `${original}\nglobalThis.__p15Secret = {${Formatter.formatJson(sentinel)}: 1, ${Formatter.formatJson(sentinel)}: 2};\n`;

              if (move === "syntax") {
                text += `export const broken = ${Formatter.formatJson(sentinel)} +;\n`;
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
              const rebuilds = () => Arr.filter(spans, (span) => span.name === "watch.rebuild");
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
                Formatter.formatJson([...span.attributes]),
                Formatter.formatJson(answer),
                Formatter.formatJson(failures),
                Formatter.formatJson(warnings.mock.calls),
              ]) {
                for (const forbidden of [sentinel, home]) {
                  for (const form of [
                    forbidden,
                    pipe(Formatter.formatJson(forbidden), Str.slice(1, -1)),
                    encodeURIComponent(forbidden),
                  ]) {
                    expect(pipe(output, Str.includes(form)), "a rebuild output copied private input").toBe(false);
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
                Effect.repeat({ until: () => Arr.every(rebuilds(), (rebuild) => rebuild.status._tag === "Ended") }),
                Effect.timeoutOrElse({
                  duration: "10 seconds",
                  orElse: () => Effect.die(new Error("a repeated rebuild never ended")),
                }),
              );
              expect(rebuilds().length, "the repeated notifications reached the watcher").toBeGreaterThan(1);
              expect(
                Arr.filter(rebuilds(), (rebuild) => rebuild.attributes.get("outcome") !== "same"),
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
          ),
    );
    expect(seen).toEqual(new Set(["fit", "syntax", "compiler"]));
      }),
    300_000,
  );

  it.live(
    "L17/L18: save-driven rebuilds record success and ERROR outcomes and close every acquired result",
    () =>
      Effect.gen(function* () {
    const seen = new Set<string>();
        yield* promised(() =>
          fc.assert(
      fc.asyncProperty(fc.gen(), (g) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const { home, programs } = yield* fixture;
              const selected = programs[g(fc.nat, { max: programs.length - 1 })]!;
              const file = path.join(home, "programs", Str.split(selected.name, "/")[1]!, "own.ts");
              const b = yield* brain;
              const answers = yield* Queue.unbounded<unknown>();
              const spans: Array<Tracer.NativeSpan> = [];

              const tracer = Tracer.make({
                span(options) {
                  const span = new Tracer.NativeSpan(options);
                  spans.push(span);

                  return span;
                },
              });

              const firstResult = opened.results.length;
              yield* Effect.forkScoped(
                Stream.runForEach(
                  watchPrograms({
                    root: home,
                    entry: path.join(home, "brain.ts"),
                    programs: [selected],
                    install: b.install,
                    failed: b.failed,
                  }),
                  (answer) => Queue.offer(answers, answer),
                ).pipe(Effect.withTracer(tracer)),
              );
              yield* Queue.take(answers).pipe(
                Effect.timeoutOrElse({
                  duration: "10 seconds",
                  orElse: () => Effect.die(new Error("the watcher did not report its initial rebuild")),
                }),
              );
              let value = 0;
              let broken = false;
              const edits = g(fc.integer, { min: 2, max: 5 });

              for (let n = 0; n < edits; n++) {
                // Pick from the reached module's current state, then generate a distinct edit.
                      const moves: ReadonlyArray<"fix" | "syntax" | "edit"> = broken
                        ? ["fix", "syntax"]
                        : ["edit", "syntax"];
                const move = moves[g(fc.nat, { max: moves.length - 1 })]!;
                value += g(fc.integer, { min: 1, max: 99 });
                broken = move === "syntax";
                const sentinel = `P15SECRET${g(() => fc.stringMatching(/^[A-Z]{12}$/))}`;
                const before = spans.length;
                const results = opened.results.length;
                yield* fs.writeFileString(
                  file,
                  broken
                    ? `export const own = ${Formatter.formatJson(sentinel)} +; // ${value}\n`
                    : `export const own = ${value};\n`,
                );

                const answer = yield* Queue.take(answers).pipe(
                  Effect.timeoutOrElse({
                    duration: "3 seconds",
                    orElse: () => Effect.die(new Error("the watcher did not report the saved module's rebuild")),
                  }),
                );

                expect(answer).toMatchObject(broken ? { _tag: "failed", reason: "bundle" } : { _tag: "loaded" });
                const acquired = opened.results.slice(results);
                expect(Arr.some(acquired, (result) => result.code === (broken ? "ERROR" : "BUNDLE_END"))).toBe(true);
                expect(Arr.every(opened.results.slice(firstResult), (result) => result.closed)).toBe(true);
                // A late graph notification can retry unchanged bytes. L2 permits `same`, never a second failure fact.
                const late = yield* drain(answers, 300);

                for (const repeated of late) {
                  expect(repeated, "one save produced a second change or failure answer").toMatchObject({
                    _tag: "same",
                  });
                }

                // The plan lets one save run more than one rebuild: "on each END the watcher runs
                // buildPrograms for that program", "Rolldown's `buildDelay`: left at its default; the
                // same-hash answer absorbs repeated events", and a save that "changes nothing in the
                // bundle's bytes (macOS late event ...)" gives "Same hash: no fact, no swap, no view
                // notice". So per save: exactly one rebuild that changed or failed, plus any `same`.
                const saved = () => Arr.filter(spans.slice(before), (span) => span.name === "watch.rebuild");
                yield* Effect.sleep("20 millis").pipe(
                  Effect.repeat({ until: () => Arr.every(saved(), (rebuild) => rebuild.status._tag === "Ended") }),
                  Effect.timeoutOrElse({
                    duration: "10 seconds",
                    orElse: () => Effect.die(new Error("a rebuild for the save never ended")),
                  }),
                );
                const rebuilds = saved();
                const changed = Arr.filter(rebuilds, (rebuild) => rebuild.attributes.get("outcome") !== "same");
                expect(changed, "one save records exactly one rebuild that changed or failed").toHaveLength(1);
                const span = changed[0]!;
                expect(span.status._tag).toBe("Ended");
                expect(span.attributes.get("program")).toBe(selected.name);
                expect(span.attributes.get("outcome")).toBe(broken ? "failed" : "loaded");
                expect(span.attributes.get("bytes")).toEqual(expect.any(Number));
                expect(Number(span.attributes.get("bytes"))).toBeGreaterThanOrEqual(broken ? 0 : 1);
                expect(Number(span.attributes.get("ms"))).toBeGreaterThanOrEqual(0);

                for (const rebuild of rebuilds) {
                  expect(rebuild.attributes.get("program")).toBe(selected.name);
                }

                const failures = yield* Queue.clear(b.failures);
                expect(failures, "one failed save writes one code.failed fact").toHaveLength(broken ? 1 : 0);

                for (const output of [
                  Formatter.formatJson([...span.attributes]),
                  Formatter.formatJson(answer),
                  Formatter.formatJson(late),
                  Formatter.formatJson(failures),
                ]) {
                  for (const forbidden of [sentinel, home]) {
                    expect(pipe(output, Str.includes(forbidden))).toBe(false);
                  }
                }

                seen.add(move);
              }
            }),
          ).pipe(Effect.provide(NodeServices.layer)),
        ),
      ),
      { seed: SEED, numRuns: runsFor({ fast: 3, full: 20 }), endOnFailure: true },
          ),
    );
    expect(seen).toEqual(new Set(["edit", "syntax", "fix"]));
      }),
    300_000,
  );

  // L10, p77. Plant: hash the entry file only; push the swap to every process.
  it.live(
    "L10: a save changes the hash of exactly the programs whose bundle reaches the file, and only they install",
    () =>
      Effect.gen(function* () {
    const seen = new Set<string>();
        yield* promised(() =>
          fc.assert(
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
              expect(
                Arr.sort(
                  Arr.map(first, (i): readonly [string, string] => [i.program, i.from]),
                  byPair,
                ),
              ).toEqual(
                Arr.sort(
                  Arr.map(programs, (p): readonly [string, string] => [p.name, "boot"]),
                  byPair,
                ),
              );
              const hashes = new Map(Arr.map(first, (i) => [i.program, i.hash]));
              const values = new Map<string, number>();
              const edits = g(fc.integer, { min: 1, max: 4 });

              for (let n = 0; n < edits; n++) {
                // A file from the current set, and an edit: a new value, so the bytes change.
                const files = Rec.keys(reaches);
                const file = files[g(fc.nat, { max: files.length - 1 })]!;
                const value = (values.get(file) ?? 0) + g(fc.integer, { min: 1, max: 99 });
                values.set(file, value);
                      const name = pipe(file, Str.endsWith("shared.ts"))
                  ? "shared"
                        : pipe(file, Str.endsWith("unused.ts"))
                          ? "unused"
                          : "own";
                yield* fs.writeFileString(path.join(home, file), `export const ${name} = ${value};\n`);
                const got = yield* drain(b.installs, 3000);
                const changed = Arr.map(
                  Arr.filter(got, (i) => i.hash !== hashes.get(i.program)),
                  (i) => i.program,
                );
                expect(new Set(changed), `a save to ${file}`).toEqual(new Set(reaches[file]));
                expect(Arr.every(got, (i) => i.from === "watch")).toBe(true);
                expect(new Set(Arr.map(got, (i) => i.program)), "only the programs that reach it install").toEqual(
                  new Set(reaches[file]),
                );

                for (const i of got) {
                  hashes.set(i.program, i.hash);
                }

                      seen.add(
                        reaches[file]!.length === 2 ? "shared" : reaches[file]!.length === 1 ? "own" : "outside",
                      );
              }
            }),
          ).pipe(Effect.provide(NodeServices.layer)),
        ),
      ),
      { seed: SEED, numRuns: runsFor({ fast: 3, full: 20 }), endOnFailure: true },
          ),
    );

    for (const kind of ["shared", "own", "outside"]) {
      expect(seen.has(kind), `the walk reaches a save to a ${kind} file`).toBe(true);
    }
      }),
    600_000,
  );

  // L18. Plant: never close a BUNDLE_END result; close the watcher outside the scope.
  it.live(
    "L18: every Rolldown watcher and every BUNDLE_END and ERROR result is closed when the scope closes, after success, a failure or an interruption at any point the run reached",
    () =>
      Effect.gen(function* () {
    const seen = new Set<string>();
        yield* promised(() =>
          fc.assert(
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
                      Arr.some(opened.results, (r) => r.code === "ERROR"),
                      "the run acquired an ERROR result",
                    ).toBe(true);
                    seen.add("error");
                  } else {
                          yield* fs.writeFileString(
                            path.join(home, "shared/shared.ts"),
                            `export const shared = ${cut};\n`,
                          );
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
              Arr.filter(opened.watchers, (w) => !w.closed),
              "watchers left open",
            ).toEqual([]);
            expect(
              Arr.filter(opened.results, (r) => !r.closed),
              "results left open",
            ).toEqual([]);
          }).pipe(Effect.provide(NodeServices.layer)),
        ),
      ),
      { seed: SEED, numRuns: runsFor({ fast: 3, full: 20 }), endOnFailure: true },
          ),
    );

    for (const point of ["acquire", "reached", "error"]) {
      expect(seen.has(point), `the walk reaches ${point}`).toBe(true);
    }
      }),
    600_000,
  );
});
