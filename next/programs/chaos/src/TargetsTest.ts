// next/, P17b slice 3. The app supplies the real checklist and scoped SQLite wiring (0062).
// After build plants: omit StepFault.before, charge saved folds, reset the arm per process,
// wrap the original error class, repeat a dead write, recompute a saved refusal, drop a note.
import { describe, expect, it } from "@effect/vitest";
import { type Incoming, type ProgramRunner, Sent } from "@kampus/libfabrika";
import { runsFor } from "@kampus/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { Array as Arr, String as Str } from "effect";
import type { Open as RunnerOpen } from "./RunnerTest.ts";

type World = Effect.Success<RunnerOpen>;

type Before = {
  readonly name: string;
  readonly process: string;
  readonly letter: string;
  readonly phase: "fresh" | "saved";
};

type ErrorClass = "TypeError" | "RangeError" | "URIError";

export type Open = Effect.Effect<
  Omit<World, "session" | "letter"> & {
    readonly session: (
      name: string,
      programName: string,
      program: unknown,
      handlers: Parameters<World["session"]>[3],
      observe?: Parameters<World["session"]>[4],
      before?: (input: Before) => Effect.Effect<void>,
    ) => ReturnType<World["session"]>;
    readonly person: Incoming["envelope"]["by"];
    readonly agent: Incoming["envelope"]["by"];
    readonly letter: (n: number, input: unknown, by?: Incoming["envelope"]["by"]) => Incoming;
    readonly fault: {
      readonly arm: (name: string, letter: string, errors: ReadonlyArray<ErrorClass>) => Effect.Effect<void>;
      readonly before: (input: Before) => Effect.Effect<void>;
      readonly saved: Effect.Effect<unknown>;
    };
    readonly history: (name: string) => Effect.Effect<ReadonlyArray<unknown>>;
    readonly dead: Effect.Effect<ReadonlyArray<unknown>>;
  },
  never,
  Scope.Scope
>;

const NAME = "checklist:1";

const PROGRAM = "fabrika/checklist";

const options = { arbitrary: { seed: 119120, runs: runsFor({ fast: 5, full: 25 }) }, timeout: 120_000 };

const integer = (maximum: number) => Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum })));

const walk = Arbitrary.array(Arbitrary.all({ pick: integer(1000), retry: Arbitrary.schema(Schema.Boolean) }), {
  minLength: 12,
  maxLength: 24,
});

const View = Schema.Struct({
  items: Schema.Array(Schema.Struct({ name: Schema.String, state: Schema.String, note: Schema.NullOr(Schema.String) })),
  left: Schema.Int,
});

const shown = (raw: unknown) => {
  const view = Schema.decodeUnknownSync(View)(raw);
  return { ...view, items: [...view.items].sort((a, b) => Str.localeCompare(b.name)(a.name)) };
};

const Controller = Schema.TaggedStruct("armed", {
  attempts: Schema.Array(Schema.Struct({ process: Schema.String, error: Schema.String })),
});

export const suite = (open: Open, checklist: unknown) =>
  describe("P17b real checklist faults and replies", () => {
    it.effect.prop(
      "legal checklist walks keep state, writer, first agent note and terminal replies through duplicates and reopen",
      [walk, integer(5), Arbitrary.schema(Schema.NonEmptyString.check(Schema.isMaxLength(100)))],
      ([moves, cut, note]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const world = yield* open;
            const items = new Map<string, string | null>();
            const replies: Array<{ input: Incoming; answer: unknown }> = [];
            let serial = 0;

            const expected = () => ({
              items: Arr.map([...items], ([name, kept]) => ({ name, state: kept === null ? "new" : "checked", note: kept,
              })).sort((a, b) => Str.localeCompare(b.name)(a.name)),
              left: Arr.filter([...items.values()], (kept) => kept === null).length,
            });

            const send = Effect.fnUntraced(function* (
              runner: ProgramRunner["Service"],
              input: unknown,
              by = world.person,
            ) {
              const sent = world.letter(++serial, input, by);
              const answer = yield* runner.msg(sent);
              replies.push({ input: sent, answer });

              return { input: sent, answer };
            });

            yield* Effect.scoped(
              Effect.gen(function* () {
                const { runner } = yield* world.session(NAME, PROGRAM, checklist, {});
                expect((yield* send(runner, { type: "add", name: "first" })).answer._tag).toBe("accepted");
                const checked = yield* send(runner, { type: "check", name: "first", note }, world.agent);
                expect(checked.answer._tag).toBe("accepted");
                expect(
                  (yield* send(runner, { type: "check", name: "first", note: "replacement" }, world.agent)).answer._tag,
                ).toBe("accepted");
                expect(shown((yield* runner.open("first-note")).view).items[0]?.note).toBe(note);
                const kept = Option.getOrUndefined(
                  Arr.findFirst(yield* world.letters(NAME), (row) => row.id === checked.input.id),
                );
                expect(kept).toMatchObject({
                  by: world.agent.key,
                  parent: checked.input.envelope.id,
                  m: { type: "check", note },
                });
                const refusal = yield* send(runner, { type: "add", name: "first" });
                expect(refusal.answer).toEqual(Sent.cases.refused.make({ reason: "taken" }));
                expect((yield* send(runner, { type: "remove", name: "first" })).answer._tag).toBe("accepted");
                // This add is now legal, but the same identity must still receive its first refusal.
              }),
            );
            const refused = Option.getOrUndefined(
              Arr.findFirst(replies, (reply) => Schema.is(Schema.TaggedStruct("refused", {}))(reply.answer)),
            );
            expect(refused).toBeDefined();

            for (let offset = 0; offset < moves.length; offset += cut + 1) {
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const { runner } = yield* world.session(NAME, PROGRAM, checklist, {});

                  if (refused !== undefined) {
                    expect(yield* runner.msg(refused.input)).toEqual(refused.answer);
                  }

                  expect(shown((yield* runner.open("reopen")).view)).toEqual(expected());

                  for (const move of moves.slice(offset, offset + cut + 1)) {
                    const before = shown((yield* runner.open("before")).view);
                    const saved = yield* world.letters(NAME);

                    if (move.retry) {
                      const previous = replies[move.pick % replies.length];

                      if (previous !== undefined) {
                        expect(yield* runner.msg(previous.input)).toEqual(previous.answer);
                        expect(shown((yield* runner.open("duplicate")).view)).toEqual(before);
                        expect(yield* world.letters(NAME)).toEqual(saved);
                      }

                      continue;
                    }

                    // Choose from the current model: additions need a free name; every other move needs an item.
                    const free = Arr.filter(["one", "two", "three"], (name) => !items.has(name));
                    const available = [...items.keys()];

                    const legal = [
                      ...Arr.map(free, (name) => ({ type: "add", name })),
                      ...Arr.flatMap(available, (name) => [
                        { type: "check", name, note },
                        { type: "uncheck", name },
                        { type: "remove", name },
                      ]),
                    ];

                    const input = legal[move.pick % legal.length];

                    if (input === undefined) {
                      return yield* Effect.die(new Error("the checklist walk has no legal input"));
                    }

                    const by = input.type === "check" || input.type === "uncheck" ? world.agent : world.person;
                    expect((yield* send(runner, input, by)).answer._tag).toBe("accepted");

                    if (input.type === "remove") {
                      items.delete(input.name);
                    } else if (input.type === "check") {
                      items.set(input.name, items.get(input.name) ?? note);
                    } else {
                      items.set(input.name, null);
                    }

                    expect(shown((yield* runner.open("after")).view)).toEqual(expected());
                  }
                }),
              );
            }

            const letters = yield* world.letters(NAME);

            for (const reply of replies) {
              const found = Arr.filter(letters, (row) => row.id === reply.input.id);
              const accepted = Schema.is(Schema.TaggedStruct("accepted", {}))(reply.answer);
              expect(found).toHaveLength(accepted ? 1 : 0);

              if (accepted) {
                expect(found[0]).toMatchObject({
                  by: reply.input.envelope.by.key,
                  parent: reply.input.envelope.id,
                  m: reply.input.envelope.input,
                });
              }
            }
          }),
        ),
      options,
    );

    it.effect.prop(
      "one stable fresh letter fails once or three times across real replacements; saved folds and other letters do not spend the arm",
      [
        Arbitrary.schema(Schema.Literals([1, 3])),
        Arbitrary.array(Arbitrary.schema(Schema.Literals(["TypeError", "RangeError", "URIError"])), {
          minLength: 3,
          maxLength: 3,
        }),
        integer(3),
      ],
      ([times, classes, cut]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const world = yield* open;
            const poison = world.letter(20, { type: "check", name: "kept", note: "first-agent-note" }, world.agent);
            const errors = classes.slice(0, times);
            yield* world.fault.arm(NAME, poison.id, errors);
            const start = () => world.session(NAME, PROGRAM, checklist, {}, undefined, world.fault.before);
            yield* Effect.scoped(
              Effect.gen(function* () {
                const { runner } = yield* start();
                expect((yield* runner.msg(world.letter(1, { type: "add", name: "kept" })))._tag).toBe("accepted");
                expect((yield* runner.msg(world.letter(2, { type: "add", name: "other" })))._tag).toBe("accepted");
              }),
            );
            const processes: Array<string> = [];

            for (let attempt = 0; attempt < times; attempt++) {
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const { runner, process } = yield* start();
                  processes.push(process);
                  const result = yield* Effect.exit(runner.msg(poison));

                  if (times === 3 && attempt === 2) {
                    expect(result._tag).toBe("Success");

                    if (result._tag === "Success") {
                      expect(result.value).toEqual(Sent.cases.refused.make({ reason: "dead" }));
                    }
                  } else {
                    expect(result._tag).toBe("Failure");
                  }

                  // Person restarts avoid freezing today's backoff or any future supervision policy into this law.
                  yield* runner.restart({ id: `person-restart-${attempt}`, build: "chaos-law" });
                }),
              );

              if (attempt === cut % times) {
                yield* Effect.scoped(
                  Effect.gen(function* () {
                    const { runner } = yield* start();
                    yield* runner.open("cut");
                  }),
                );
              }
            }

            expect(new Set(processes).size).toBe(times);
            const armed = Schema.decodeUnknownSync(Controller)(yield* world.fault.saved);
            expect(armed.attempts).toEqual(Arr.map(processes, (process, n) => ({ process, error: errors[n] })));
            const lives = yield* world.history(NAME);
            const restarts = Arr.filter(lives, Schema.is(Schema.TaggedStruct("restarted", { body: Schema.Unknown })));
            expect(restarts.length).toBeGreaterThanOrEqual(times);

            for (const [n, process] of processes.entries()) {
              expect(
                Arr.some(restarts, (row) => Schema.is(Schema.Struct({ after: Schema.Literal(process) }))(row.body)),
              ).toBe(true);
              const exited = Arr.filter(
                lives,
                Schema.is(
                  Schema.TaggedStruct("exited", {
                    body: Schema.Struct({
                      process: Schema.String,
                      reason: Schema.TaggedStruct("crashed", { phase: Schema.String, error: Schema.String }),
                    }),
                  }),
                ),
              );
              expect(
                Option.getOrUndefined(Arr.findFirst(exited, (exit) => exit.body.process === process))?.body.reason,
              ).toEqual(
                Schema.TaggedStruct("crashed", { phase: Schema.String, error: Schema.String }).make({
                  phase: "step",
                  error: errors[n] ?? "",
                }),
              );
            }

            yield* Effect.scoped(
              Effect.gen(function* () {
                const { runner } = yield* start();

                if (times === 1) {
                  expect((yield* runner.msg(poison))._tag).toBe("accepted");
                  expect(
                    Option.getOrUndefined(
                      Arr.findFirst(shown((yield* runner.open("success")).view).items, (item) => item.name === "kept"),
                    ),
                  ).toMatchObject({ state: "checked", note: "first-agent-note" });
                } else {
                  for (let n = 0; n < cut + 1; n++) {
                    expect(yield* runner.msg(poison)).toEqual(Sent.cases.refused.make({ reason: "dead" }));
                  }
                }

                expect(
                  (yield* runner.msg(
                    world.letter(30, { type: "check", name: "other", note: "unrelated-note" }, world.agent),
                  ))._tag,
                ).toBe("accepted");
                expect(
                  Option.getOrUndefined(
                    Arr.findFirst(shown((yield* runner.open("other")).view).items, (item) => item.name === "other"),
                  )?.note,
                ).toBe("unrelated-note");
                expect(Schema.decodeUnknownSync(Controller)(yield* world.fault.saved).attempts).toEqual(armed.attempts);
                // Rearm an already saved input, then force the real successor to fold it from history.
                const saved = world.letter(30, { type: "check", name: "other", note: "unrelated-note" }, world.agent);
                yield* world.fault.arm(NAME, saved.id, errors);
                yield* runner.restart({ id: "person-fold-saved", build: "chaos-law" });
                yield* runner.open("folded");
                expect((yield* runner.msg(saved))._tag).toBe("accepted");
                expect(Schema.decodeUnknownSync(Controller)(yield* world.fault.saved).attempts).toEqual([]);
              }),
            );
            const dead = yield* world.dead;
            expect(dead).toHaveLength(times === 3 ? 1 : 0);

            if (times === 3) {
              expect(dead[0]).toMatchObject({ body: { m: poison.id, tries: 3, errors, name: NAME, program: PROGRAM } });
            }

            expect(Arr.filter(yield* world.letters(NAME), (row) => row.id === poison.id)).toHaveLength(
              times === 1 ? 1 : 0,
            );
          }),
        ),
      options,
    );
  });
