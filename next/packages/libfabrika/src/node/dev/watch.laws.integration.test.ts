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

import { it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import * as Arr from "effect/Array";
import * as Deferred from "effect/Deferred";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Formatter from "effect/Formatter";
import * as Function from "effect/Function";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import * as Tracer from "effect/Tracer";

import * as fc from "fast-check";
import { type Expression, parseSync, type SpreadElement, Visitor } from "oxc-parser";
import { assert, describe, expect, vi } from "vitest";
import { expectTypeOf } from "vitest";
import { hash } from "../../runtime/Built.ts";
import type * as Dev from "./dev.ts";
import { watchPrograms } from "./watch.ts";

/** A promise the test waits on rejected: the test's own failure, with the rejection as its cause. */
class TestFailure extends Schema.TaggedError<TestFailure, { readonly brand: unique symbol }>()("TestFailure", {
  cause: Schema.Unknown,
}) {}

/** Waits on a promise inside the test's Effect, as `Effect.tryPromise` in its object form. */
const promised = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => TestFailure.make({ cause }) });

class NotificationError extends Schema.TaggedError<NotificationError, { readonly brand: unique symbol }>()(
  "NotificationError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

const SEED = 119120;

const ROOT = new URL("../../../../../../", import.meta.url).pathname;

/**
 * Every real Rolldown watcher and result the laws saw, and which were closed. Per watcher, `ends`
 * counts the `END` notifications that reached the product's listener, real and replayed, and
 * `changes` holds the ids of Rolldown's own `change` events, absolute temp paths kept in memory only.
 * `notify` runs after each `change`, so a law can wait on a report without polling.
 */
const opened = vi.hoisted(() => ({
  watchers: Array.of<{ closed: boolean; repeat: Effect.Effect<void>; ends: number; changes: Array<string> }>(),
  results: Array.of<{ code: string; closed: boolean }>(),
  notify: () => {},
}));

vi.mock("rolldown", async (original) => {
  const actual = await original<typeof import("rolldown")>();

  return {
    ...actual,
    watch: (...args: Parameters<typeof actual.watch>) => {
      const watcher = actual.watch(...args);
      const seen = { closed: false, repeat: Effect.void, ends: 0, changes: Array.of<string>() };
      opened.watchers.push(seen);
      const close = watcher.close.bind(watcher);
      watcher.close = () => {
        seen.closed = true;
        // A closed watcher replays nothing. Dropping the replay also lets go of the product's
        // listener and every run's state it holds, which `opened` would otherwise keep for the file.
        seen.repeat = Effect.void;

        return close();
      };

      const on = watcher.on.bind(watcher);
      // Rolldown's own report of a modified file, read through the real watcher unchanged.
      on("change", (id) => {
        seen.changes.push(id);
        opened.notify();
      });
      // SAFETY: the wrapper has only the `event` overload of Rolldown's `on`, the one watch.ts calls (`watcher.on("event", ...)`).
      watcher.on = ((
        name: "event",
        listener: (event: import("rolldown").RolldownWatcherEvent) => void | Promise<void>,
      ) => {
        let cycle: Array<import("rolldown").RolldownWatcherEvent> = [];

        // Every notification the product's listener receives, real or replayed, goes through here.
        const deliver = (event: import("rolldown").RolldownWatcherEvent) => {
          if (event.code === "END") {
            seen.ends++;
          }

          return listener(event);
        };

        return on(name, (event) => {
          if (event.code === "START") {
            cycle = [];
          }

          // Repeat notifications, without acquiring another result or changing any file bytes.
          if (event.code === "ERROR") {
            cycle.push({
              ...event,
              // Replay owns no new Rolldown result to close. `close` is the result's one member.
              result: { close: () => Promise.resolve(undefined) },
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
                  try: () => Promise.resolve(deliver(notification)),
                  catch: (cause: unknown) =>
                    NotificationError.make({ message: "the repeated Rolldown notification failed", cause }),
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

          return deliver(event);
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

const fixtureValue = (source: string) => {
  const parsed = parseSync("watcher-fixture.mjs", source);

  const top = new Set(
    parsed.program.body.flatMap((statement) =>
      statement.type === "ExpressionStatement" && statement.expression.type === "AssignmentExpression"
        ? [statement.expression]
        : [],
    ),
  );

  const assignments: Array<{ right: Expression; nested: boolean }> = [];
  const declarations: Array<{ name: string; init: Expression | null; nested: boolean; grouped: boolean }> = [];
  let shadowed = false;
  let writes = 0;
  let depth = 0;
  const enter = () => depth++;
  const leave = () => depth--;

  const bind = (node: { readonly type: string; readonly name?: string } | null) => {
    if (node?.type === "Identifier" && node.name === "globalThis") {
      shadowed = true;
    }
  };

  new Visitor({
    FunctionDeclaration(node) {
      enter();
      bind(node.id);
      node.params.forEach(bind);
    },
    "FunctionDeclaration:exit": leave,
    FunctionExpression(node) {
      enter();
      bind(node.id);
      node.params.forEach(bind);
    },
    "FunctionExpression:exit": leave,
    ArrowFunctionExpression(node) {
      enter();
      node.params.forEach(bind);
    },
    "ArrowFunctionExpression:exit": leave,
    ClassDeclaration(node) {
      bind(node.id);
    },
    ClassExpression(node) {
      bind(node.id);
    },
    ImportDeclaration(node) {
      for (const specifier of node.specifiers) {
        bind(specifier.local);
      }
    },
    CatchClause(node) {
      bind(node.param);
    },
    ObjectPattern(node) {
      for (const property of node.properties) {
        bind(property.type === "RestElement" ? property.argument : property.value);
      }
    },
    ArrayPattern(node) {
      node.elements.forEach(bind);
    },
    AssignmentPattern(node) {
      bind(node.left);
    },
    RestElement(node) {
      bind(node.argument);
    },
    VariableDeclaration(node) {
      for (const declaration of node.declarations) {
        bind(declaration.id);

        if (declaration.id.type === "Identifier") {
          declarations.push({
            name: declaration.id.name,
            init: declaration.init,
            nested: depth > 0,
            grouped: node.declarations.length > 1,
          });
        }
      }
    },
    AssignmentExpression(node) {
      const left = node.left;
      bind(left);

      if (
        left.type === "MemberExpression" &&
        left.object.type === "Identifier" &&
        left.object.name === "globalThis" &&
        ((!left.computed && left.property.type === "Identifier" && left.property.name === "__p15") ||
          (left.computed && left.property.type === "Literal" && left.property.value === "__p15") ||
          (left.computed &&
            left.property.type === "TemplateLiteral" &&
            left.property.expressions.length === 0 &&
            left.property.quasis[0]?.value.cooked === "__p15"))
      ) {
        writes++;

        if (node.operator === "=" && !left.computed) {
          assignments.push({ right: node.right, nested: !top.has(node) });
        }
      }
    },
  }).visit(parsed.program);

  const kind = (node: Expression | SpreadElement | null | undefined) =>
    node === null || node === undefined
      ? "absent"
      : node.type === "ArrayExpression" ||
          node.type === "Identifier" ||
          node.type === "Literal" ||
          node.type === "UnaryExpression"
        ? node.type
        : "other";

  const number = (node: Expression | SpreadElement | null | undefined) =>
    node?.type === "Literal" && typeof node.value === "number" && Number.isFinite(node.value) ? node.value : null;

  return {
    errors: parsed.errors.length,
    assignments: writes,
    facts: (shadowed ? [] : assignments.slice(0, 4)).map(({ right, nested }) => {
      const own = right.type === "ArrayExpression" ? right.elements[1] : undefined;

      const bindings =
        own?.type === "Identifier" ? declarations.filter((declaration) => declaration.name === own.name) : [];

      return {
        right: kind(right),
        length: right.type === "ArrayExpression" ? right.elements.length : null,
        nested,
        own: kind(own),
        value: number(own),
        // The array's elements as numeric literals, `[shared, own]`; `null` for one that is not.
        values: right.type === "ArrayExpression" ? right.elements.map(number) : null,
        bindings: bindings.length,
        candidates: bindings.slice(0, 4).map((declaration) => ({
          init: kind(declaration.init),
          value: number(declaration.init),
          nested: declaration.nested,
          grouped: declaration.grouped,
        })),
      };
    }),
  };
};

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
                          Function.pipe(Formatter.formatJson(forbidden), Str.slice(1, -1)),
                          encodeURIComponent(forbidden),
                        ]) {
                          expect(
                            Function.pipe(output, Str.includes(form)),
                            "a rebuild output copied private input",
                          ).toBe(false);
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
                      Effect.repeat({
                        until: () => Arr.every(rebuilds(), (rebuild) => rebuild.status._tag === "Ended"),
                      }),
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

              expect(
                fixtureValue(code.source),
                "the installed bundle's fixture assignment contains this save's module value",
              ).toEqual({
                errors: 0,
                assignments: 1,
                facts: [
                  {
                    right: "ArrayExpression",
                    length: 2,
                    nested: false,
                    own: "Literal",
                    value,
                    values: [0, value],
                    bindings: 0,
                    candidates: [],
                  },
                ],
              });
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

  /** One install the watcher sent, with the rebuild span it ran in. */
  type Seen = { readonly code: Install; readonly span: Tracer.Span };

  /** What L10's walk can do to its two programs, with every install accounted for as it goes. */
  type World = {
    readonly reaches: Readonly<Record<string, ReadonlyArray<string>>>;
    /** The value last written to a fixture file, 0 before any save. */
    readonly value: (file: string) => number;
    /** Writes a new value to a fixture file, and nothing else. */
    readonly write: (file: string, value: number) => Effect.Effect<void>;
    /** Takes every install a written file owes, waits for its change reports, then settles. */
    readonly owe: (file: string) => Effect.Effect<void>;
    readonly save: (file: string, value: number) => Effect.Effect<void>;
    /** Replays every case watcher's last completed cycle, without changing any file. */
    readonly repeat: Effect.Effect<void>;
    /** Holds a program's next install until `release`, or until the scope closes. */
    readonly hold: (
      program: string,
    ) => Effect.Effect<
      { readonly held: Effect.Effect<Install>; readonly release: Effect.Effect<void> },
      never,
      Scope.Scope
    >;
    readonly settle: Effect.Effect<void>;
    /** How each install was accounted for: the one change it owed, or an unchanged repeat. */
    readonly accounted: (code: Install) => "change" | "repeat" | undefined;
    /** The hash of a program's last change. */
    readonly last: (program: string) => string | undefined;
    readonly repeats: (program: string) => number;
  };

  // L10a-L10d. Every install is a change or a repeat; no wait is a quiet window. An owed change has
  // its own 3 s bound, which a repeat never renews; `settle` waits on a count, never on quiet.
  const accountedWalk = Effect.fnUntraced(function* (walk: (world: World) => Effect.Effect<void, never, Scope.Scope>) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { home, reaches, programs } = yield* fixture;
    const real = yield* fs.realPath(home);
    const firstWatcher = opened.watchers.length;
    const watchers = () => opened.watchers.slice(firstWatcher);
    const installs = yield* Queue.unbounded<Seen>();
    // A wake-up after each ended rebuild and each change report, for waits on a condition.
    const ticks = yield* Queue.unbounded<void>();
    // Counts, hashes and weak collections only: a closed case's state can stay reachable for the rest
    // of the file (finding 2026-11-18-watch-laws-closed-builds-stay-reachable), so nothing here keeps
    // a span or a bundle's source, which is several MB.
    let started = 0;
    let ended = 0;
    const running = new Map<string, string>();
    const last = new Map<string, string>();
    const tied = new WeakSet<Tracer.Span>();
    const accounted = new WeakMap<Install, "change" | "repeat">();
    const repeats = new Map<string, number>();
    const values = new Map<string, number>();
    const marks = new Map<string, ReadonlyArray<number>>();

    const gates = new Map<
      string,
      { readonly held: Deferred.Deferred<Install>; readonly release: Deferred.Deferred<void> }
    >();

    const failures: Array<Failed> = [];
    let closed = false;

    const tracer = Tracer.make({
      span(settings) {
        const span = new Tracer.NativeSpan(settings);

        if (span.name === "watch.rebuild") {
          started++;
        }

        const end = span.end.bind(span);
        span.end = (at, exit) => {
          end(at, exit);

          if (span.name === "watch.rebuild") {
            ended++;
            Queue.offerUnsafe(ticks, undefined);
          }
        };

        return span;
      },
    });

    /** Waits until `done` holds, rechecked on each wake-up. A condition with a bound, never a sleep. */
    const until = (done: () => boolean, bound: Duration.Input, message: string) =>
      Effect.gen(function* () {
        while (!done()) {
          yield* Queue.take(ticks);
        }
      }).pipe(Effect.timeoutOrElse({ duration: bound, orElse: () => Effect.die(new Error(message)) }));

    const relative = (id: string) => {
      const inside = path.relative(home, id);

      return Function.pipe(inside, Str.startsWith("..")) ? path.relative(real, id) : inside;
    };

    /** The case watchers that reported a change for `file` since `from`, one count per watcher. */
    const reported = (file: string, from: ReadonlyArray<number> = []) =>
      Arr.filter(watchers(), (watcher, n) =>
        Arr.some(watcher.changes.slice(from[n] ?? 0), (id) => relative(id) === file),
      ).length;

    const want = (program: string) => [
      values.get("shared/shared.ts") ?? 0,
      values.get(`programs/${Str.split(program, "/")[1]}/own.ts`) ?? 0,
    ];

    // The brain as the watcher sees it, which also keeps the span each install ran in.
    const install = (code: Install) =>
      Effect.gen(function* () {
        const span = yield* Effect.orDie(Effect.currentSpan);
        yield* Queue.offer(installs, { code, span });
        const gate = gates.get(code.program);

        if (gate !== undefined) {
          gates.delete(code.program);
          yield* Deferred.succeed(gate.held, code);
          yield* Deferred.await(gate.release);
        }

        const same = running.get(code.program) === code.hash;
        running.set(code.program, code.hash);

        return same ? { _tag: "same" as const } : { _tag: "loaded" as const, processes: [] };
      });

    // An install's own rebuild: a `watch.rebuild` of its program that ended normally with this
    // outcome, shared with no other install. A rebuild the closing scope cut writes no attributes.
    const inOwnRebuild = Effect.fnUntraced(function* (seen: Seen, outcome: "same" | "loaded") {
      expect(seen.span.name, "an install runs inside a rebuild").toBe("watch.rebuild");
      expect(tied.has(seen.span), "one install per rebuild").toBe(false);
      tied.add(seen.span);

      const exit = () =>
        Match.valueTags(seen.span.status, { Started: () => undefined, Ended: (status) => status.exit });

      yield* until(() => exit() !== undefined, "10 seconds", "a started rebuild never ended");
      const finished = exit();
      assert(finished !== undefined, "the install's rebuild ended");

      if (closed && Exit.hasInterrupts(finished)) {
        return;
      }

      expect(Exit.isSuccess(finished), "the install's rebuild completed normally").toBe(true);
      expect(seen.span.attributes.get("program"), "an install runs in its own program's rebuild").toBe(
        seen.code.program,
      );
      expect(seen.span.attributes.get("outcome")).toBe(outcome);
    });

    const account = Effect.fnUntraced(function* (seen: Seen, pending: Set<string>) {
      const code = seen.code;
      const before = last.get(code.program);

      // L10c: a repeat. Rolldown notified again, and the bytes did not change.
      if (before !== undefined && code.hash === before) {
        expect(code.from, "a repeat comes from the watcher").toBe("watch");
        expect(yield* hash(code.source), "a repeat carries its program's last change, byte for byte").toBe(before);
        yield* inOwnRebuild(seen, "same");
        accounted.set(code, "repeat");
        repeats.set(code.program, (repeats.get(code.program) ?? 0) + 1);

        return;
      }

      // L10a and L10b: the one change a boot or a save owes this program.
      expect(pending.has(code.program), "only a program the save reaches installs a changed hash").toBe(true);
      expect(code.from, "the first install is the boot's, every later one the watcher's").toBe(
        before === undefined ? "boot" : "watch",
      );
      expect(code.hash).toBe(yield* hash(code.source));
      expect(fixtureValue(code.source), "the changed install carries the saved values").toMatchObject({
        errors: 0,
        assignments: 1,
        facts: [{ values: want(code.program) }],
      });
      yield* inOwnRebuild(seen, "loaded");
      accounted.set(code, "change");
      last.set(code.program, code.hash);
      pending.delete(code.program);
    });

    // L10d: each owed change has its own 3 s bound. A repeat is accounted inside it and pays nothing.
    const owed = (owing: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const pending = new Set(owing);

        while (pending.size > 0) {
          const size = pending.size;
          yield* Effect.gen(function* () {
            while (pending.size === size) {
              yield* account(yield* Queue.take(installs), pending);
            }
          }).pipe(
            Effect.timeoutOrElse({
              duration: "3 seconds",
              orElse: () => Effect.die(new Error("an owed install never came")),
            }),
          );
        }
      });

    /** Every `END` the case watchers delivered to the product, real and replayed. */
    const delivered = () => Arr.reduce(watchers(), 0, (total, watcher) => total + watcher.ends);

    // A rebuild starts only after the `END` that ends its cycle was delivered, so a count of started
    // rebuilds, read before the delivered count, never exceeds it. A cut rebuild counts too.
    const outnumbered = () => {
      const rebuilds = started;
      expect(rebuilds, "rebuilds never outnumber delivered Rolldown cycles").toBeLessThanOrEqual(delivered());
    };

    // Settled: every Rolldown cycle delivered so far has an ended rebuild. A count, not a quiet time.
    const settle = Effect.gen(function* () {
      outnumbered();
      const cycles = delivered();
      yield* until(() => ended >= cycles, "10 seconds", "a delivered Rolldown cycle never ended its rebuild");

      for (const seen of yield* Queue.clear(installs)) {
        yield* account(seen, new Set());
      }
    });

    const write = (file: string, value: number) =>
      Effect.gen(function* () {
        values.set(file, value);
        marks.set(
          file,
          Arr.map(watchers(), (watcher) => watcher.changes.length),
        );

        const name = Function.pipe(file, Str.endsWith("shared.ts"))
          ? "shared"
          : Function.pipe(file, Str.endsWith("unused.ts"))
            ? "unused"
            : "own";

        yield* Effect.orDie(fs.writeFileString(path.join(home, file), `export const ${name} = ${value};\n`));
      });

    const owe = (file: string) =>
      Effect.gen(function* () {
        const reach = reaches[file] ?? [];
        yield* owed(reach);
        yield* until(
          () => reported(file, marks.get(file)) >= reach.length,
          "3 seconds",
          "a watcher whose program reaches the saved file never reported its change",
        );
        yield* settle;
      });

    const world: World = {
      reaches,
      value: (file) => values.get(file) ?? 0,
      write,
      owe,
      save: (file, value) => Effect.andThen(write(file, value), owe(file)),
      // One watcher's replay after another, so each program's repeat lands in a known order.
      repeat: Effect.suspend(() =>
        Effect.forEach(watchers(), (watcher) => watcher.repeat, { discard: true, concurrency: 1 }),
      ),
      hold: (program) =>
        Effect.gen(function* () {
          const gate = { held: yield* Deferred.make<Install>(), release: yield* Deferred.make<void>() };
          yield* Effect.addFinalizer(() => Deferred.succeed(gate.release, undefined));
          gates.set(program, gate);

          return {
            held: Deferred.await(gate.held).pipe(
              Effect.timeoutOrElse({
                duration: "3 seconds",
                orElse: () => Effect.die(new Error("the gate never held an install")),
              }),
            ),
            release: Effect.asVoid(Deferred.succeed(gate.release, undefined)),
          };
        }),
      settle,
      accounted: (code) => accounted.get(code),
      last: (program) => last.get(program),
      repeats: (program) => repeats.get(program) ?? 0,
    };

    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            opened.notify = () => {
              Queue.offerUnsafe(ticks, undefined);
            };
          }),
          () =>
            Effect.sync(() => {
              opened.notify = () => {};
            }),
        );
        yield* Effect.forkScoped(
          Stream.runDrain(
            watchPrograms({
              root: home,
              entry: path.join(home, "brain.ts"),
              programs,
              install,
              failed: (fact) =>
                Effect.sync(() => {
                  failures.push(fact);
                }),
            }),
          ).pipe(Effect.withTracer(tracer)),
        );
        // The boot: each program owes one change, with values [0, 0].
        yield* owed(Arr.map(programs, (program) => program.name));
        yield* settle;
        yield* walk(world);
        yield* settle;
      }),
    );

    // The scope closed every watcher. Every install left over is accounted for.
    closed = true;

    for (const seen of yield* Queue.clear(installs)) {
      yield* account(seen, new Set());
    }

    outnumbered();

    for (const file of marks.keys()) {
      expect(reported(file), `the watchers that report a change for ${file} number the programs that reach it`).toBe(
        reaches[file]?.length,
      );
    }

    expect(failures, "no build in the walk failed").toEqual([]);
  });

  // L10, p77. Plants: hash the entry file only (P1); install every program on any rebuild (P2); build
  // each cycle twice (P3); install the previous rebuild's build (P4); watch shared/unused.ts (P5); add
  // a per-rebuild counter to the hash (P6, red in the scenario below). Law plant: the old quiet drains.
  it.live(
    "L10: a save changes the hash of exactly the programs whose bundle reaches the file, and any other install is an unchanged repeat from that program's own rebuild",
    () =>
      Effect.gen(function* () {
        const seen = new Set<string>();
        yield* promised(() =>
          fc.assert(
            fc.asyncProperty(fc.gen(), (g) =>
              Effect.runPromise(
                Effect.scoped(
                  accountedWalk((world) =>
                    Effect.gen(function* () {
                      const edits = g(fc.integer, { min: 1, max: 4 });

                      for (let n = 0; n < edits; n++) {
                        // A file from the current set, and an edit: a new value, so the bytes change.
                        const files = Rec.keys(world.reaches);
                        const file = files[g(fc.nat, { max: files.length - 1 })]!;
                        yield* world.save(file, world.value(file) + g(fc.integer, { min: 1, max: 99 }));

                        seen.add(
                          Match.value(world.reaches[file]!.length).pipe(
                            Match.when(2, () => "shared"),
                            Match.when(1, () => "own"),
                            Match.orElse(() => "outside"),
                          ),
                        );
                      }
                    }),
                  ),
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

  // scenario: S1, the four orders the finding's run 2 and its save-time variants produce, each made
  // on purpose with the wrapper's replay and one gate. Law plants: the old L10 assertions (case 1
  // shows run 2's shape; cases 2 and 3 fail "only the programs that reach it install"); L10d's plant,
  // any install of a pending program pays its owed change (case 4 red). Product plant: P6 (case 1).
  it.live(
    "scenario: L10 repeats at boot and inside saves are accounted for",
    () =>
      Effect.gen(function* () {
        const cases: ReadonlyArray<(world: World) => Effect.Effect<void, never, Scope.Scope>> = [
          // 1. A boot repeat: each program installs its boot hash again, from `watch`.
          (world) =>
            Effect.gen(function* () {
              yield* world.repeat;
              yield* world.settle;
              expect(world.repeats("p15/one"), "program one repeated its boot install").toBeGreaterThanOrEqual(1);
              expect(world.repeats("p15/two"), "program two repeated its boot install").toBeGreaterThanOrEqual(1);
            }),
          // 2. A repeat inside an own save: program two, which the save does not reach, installs unchanged code.
          (world) =>
            Effect.gen(function* () {
              const before = world.repeats("p15/two");
              yield* world.write("programs/one/own.ts", 37);
              yield* world.repeat;
              yield* world.owe("programs/one/own.ts");
              expect(world.repeats("p15/two"), "the unreached program repeated inside the save").toBeGreaterThan(
                before,
              );
            }),
          // 3. A repeat inside an outside save: both programs install unchanged code while the save owes nothing.
          (world) =>
            Effect.gen(function* () {
              const one = world.repeats("p15/one");
              const two = world.repeats("p15/two");
              yield* world.write("shared/unused.ts", 41);
              yield* world.repeat;
              yield* world.owe("shared/unused.ts");
              expect(world.repeats("p15/one"), "program one repeated inside the outside save").toBeGreaterThan(one);
              expect(world.repeats("p15/two"), "program two repeated inside the outside save").toBeGreaterThan(two);
            }),
          // 4. A held repeat released after the write: it is accounted as a repeat and pays nothing.
          (world) =>
            Effect.gen(function* () {
              const boot = world.last("p15/one");
              const gate = yield* world.hold("p15/one");
              yield* world.repeat;
              const held = yield* gate.held;
              expect(held, "the gate held program one's unchanged install").toMatchObject({
                hash: boot,
                from: "watch",
              });
              yield* world.write("programs/one/own.ts", 53);
              yield* gate.release;
              yield* world.owe("programs/one/own.ts");
              expect(world.accounted(held), "the held unchanged install is a repeat").toBe("repeat");
              expect(world.last("p15/one"), "the save's own change paid what it owed").not.toBe(boot);
            }),
        ];

        for (const order of cases) {
          yield* Effect.scoped(accountedWalk(order));
        }
      }).pipe(Effect.provide(NodeServices.layer)),
    300_000,
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
