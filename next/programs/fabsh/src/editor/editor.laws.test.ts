// next/, S1. All faults named here are pending one CI run after build and restoration.
import { applyCell, replay } from "@demlik/tea";
import { arbMsgSequence, foldEvents } from "@demlik/tea/pbt";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Arbitrary, Effect, FileSystem, Match, Path, Schema } from "effect";
import * as fc from "fast-check";
import { Ghostty } from "ghostty-web";
import { spot } from "./cells.ts";
import { editor, Msg } from "./editor.ts";

const decode = Schema.decodeUnknownSync(Msg);

type Model = ReturnType<typeof editor.init>[0];

type Output = ReturnType<typeof editor.init>[1][number];

interface Real {
  model: Model;
  cmds: ReadonlyArray<Output>;
}

const ctx = (history: ReadonlyArray<string> = [], historyLimit = 1000) => ({
  programs: new Map(),
  history,
  historyLimit,
});

const boot = (history: ReadonlyArray<string> = [], limit = 1000): Real => {
  const initial = replay(editor, { ctx: ctx(history, limit), msgs: [] });
  return { model: initial.state, cmds: initial.cmds };
};

const send = (real: Real, raw: unknown) => {
  const [model, cmds] = applyCell(editor, real.model, decode(raw));
  real.model = model;
  real.cmds = cmds;
};

const key = (real: Real, data: string) => send(real, { type: "keys", data });

const prompt = (real: Real) =>
  Match.value(real.model.mode).pipe(
    Match.tag("prompt", (mode) => mode.line),
    Match.orElse(() => expect.fail("expected prompt mode")),
  );

const bytes = (cmds: ReadonlyArray<Output>) =>
  cmds
    .flatMap((cmd) =>
      Match.value(cmd).pipe(
        Match.when({ type: "write" }, (value) => [value.bytes]),
        Match.orElse(() => []),
      ),
    )
    .join("");

const options = (runs = 300) => ({ arbitrary: { runs: runsFor({ fast: runs, full: runs }) } });

// The installed @effect/vitest accepts Effect Arbitrary, while tea and fc.commands use fast-check.
// A Schema-generated seed selects a command walk inside the property runner.
// Effect shrinks the seed and command data; fast-check supplies legal-move checks for the walk.
const walk = <M, R>(
  seed: number,
  choices: ReadonlyArray<fc.Command<M, R>>,
  model: M,
  real: R,
  required: ReadonlyArray<fc.Command<M, R>>,
) => {
  const generated = fc.sample(fc.commands([fc.constantFrom(...choices)], { maxCommands: 80, size: "max" }), {
    seed,
    numRuns: 1,
  })[0];
  expect(generated, "the state-aware command generator produced a walk").toBeDefined();
  fc.modelRun(() => ({ model, real }), [...required, ...generated!]);
};

const Text = Arbitrary.schema(Schema.String).pipe(
  Arbitrary.map((text) => [...text].map((c) => "abc de"[(c.codePointAt(0) ?? 0) % 6] ?? "a").join("") || "a"),
);

const Edits = Schema.Literals([
  "\x01",
  "\x05",
  "\x02",
  "\x06",
  "\x1b[D",
  "\x1b[C",
  "\x1bb",
  "\x1bf",
  "\x1b[1;3D",
  "\x1b[1;3C",
  "\x1b[1;5D",
  "\x1b[1;5C",
  "\x7f",
  "\x08",
  "\x1b[3~",
  "\x0b",
  "\x15",
  "\x17",
  "\x1bd",
  "\x1b\x7f",
  "\x19",
  "\x14",
  "\x0c",
  "\r",
  "\n",
  "\x10",
  "\x0e",
  "\x1b[A",
  "\x1b[B",
  "\x12",
  "\x13",
  "\t",
  "\x03",
  "\x04",
  "\x1f",
  "\x18\x15",
  "\x1b.",
  "\x1by",
  "\x1bu",
  "\x1bl",
  "\x1bc",
  "\x1b<",
  "\x1b>",
]);

// L8 fault: count a wide character as one cell in cursor placement.
it.effect.prop(
  "L8 every bound key redraws the prompt and puts the cursor at spot(left)",
  {
    seed: Schema.Int,
    keys: Arbitrary.array(Arbitrary.schema(Edits), { minLength: 100, maxLength: 160 }),
    text: Schema.String,
    width: Schema.Int.check(Schema.isBetween({ minimum: 10, maximum: 200 })),
  },
  ({ seed, keys, text, width }) =>
    Effect.gen(function* () {
      const reached = new Set<string>();
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const wasm = yield* fs.readFile(
        yield* path.fromFileUrl(new URL(import.meta.resolve("ghostty-web/ghostty-vt.wasm"))),
      );
      const module = new WebAssembly.Module(new Uint8Array(wasm));
      const ghostty = new Ghostty(new WebAssembly.Instance(module, { env: { log: () => {} } }));
      const terminal = yield* Effect.acquireRelease(
        Effect.sync(() => ghostty.createTerminal(width, 1000)),
        (term) => Effect.sync(() => term.free()),
      );
      const real = boot(["history one", "history two"]);
      terminal.write(bytes(real.cmds));
      send(real, { type: "size", cols: width });
      const sized = bytes(real.cmds);

      if (sized !== "") {
        terminal.write(sized);
      }
      const references: ReturnType<typeof ghostty.createTerminal>[] = [];
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const term of references) {
            term.free();
          }
        }),
      );
      const choices = [
        ...Edits.literals,
        ...keys,
        [...text].map((c) => ["a", "b", " ", "漢", "😀", "é", "©️"][(c.codePointAt(0) ?? 0) % 7] ?? "a").join(""),
        "漢😀é©️",
      ].map((data): fc.Command<{ prompt: boolean }, Real> => ({
        check: (state) => state.prompt,
        run: (model, state) => {
          reached.add(data);
          key(state, data);
          const out = bytes(state.cmds);

          if (out !== "") {
            terminal.write(out);
          }

          Match.value(state.model.mode).pipe(
            Match.tag("busy", () => {
              send(state, { type: "ready" });
              const ready = bytes(state.cmds);

              if (ready !== "") {
                terminal.write(ready);
              }
            }),
            Match.tag("search", () => {
              key(state, "\x07");
              const cancel = bytes(state.cmds);

              if (cancel !== "") {
                terminal.write(cancel);
              }
            }),
            Match.tag("ended", () => {
              const restarted = boot();
              state.model = restarted.model;
              state.cmds = restarted.cmds;
              send(state, { type: "size", cols: width });
              terminal.write(`${bytes(restarted.cmds)}${bytes(state.cmds)}`);
            }),
            Match.orElse(() => {}),
          );
          model.prompt = Match.value(state.model.mode).pipe(
            Match.tag("prompt", () => true),
            Match.orElse(() => false),
          );
          const line = prompt(state);
          const expected = `fabsh$ ${line.left}${line.right}`;
          const cursor = terminal.getCursor();
          const rows = Math.ceil((spot(expected, width) + 1) / width);
          const start = cursor.y - Math.floor(spot(`fabsh$ ${line.left}`, width) / width);
          const reference = ghostty.createTerminal(width, rows + 1);
          references.push(reference);
          reference.write(expected + " ");
          const cells = (row: ReturnType<typeof terminal.getLine>) =>
            (row ?? []).map((cell) => ({
              codepoint: cell.codepoint,
              width: cell.width,
              marks: cell.grapheme_len,
            }));

          for (let row = 0; row < rows; row += 1) {
            expect(cells(terminal.getLine(start + row))).toEqual(cells(reference.getLine(row)));
          }

          expect(cursor.x).toBe(spot(`fabsh$ ${line.left}`, width) % width);
        },
        toString: () => JSON.stringify(data),
      }));
      walk(seed, choices, { prompt: true }, real, [...choices.slice(0, Edits.literals.length), ...choices.slice(-2)]);

      for (const data of Edits.literals) {
        expect(reached.has(data), `L8 never reached bound key ${JSON.stringify(data)}`).toBe(true);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  options(),
);

interface Ring {
  text: string;
  at: number;
  ring: string[];
  joined: boolean;
  undo: Array<{ text: string; at: number }>;
  yank: { at: number; length: number; index: number } | null;
  filled: number;
}

// L9 fault: let a cursor move between kills keep joining the previous kill.
it.prop(
  "L9 kills join only in a row, yank-pop walks ten kills and undo restores prior edits",
  {
    seed: Schema.Int,
    text: Text,
  },
  ({ seed, text }) => {
    const ringSeen = new Set<string>();
    const real = boot();
    const model: Ring = { text: "", at: 0, ring: [], joined: false, undo: [], yank: null, filled: 0 };
    const save = (state: Ring) => state.undo.push({ text: state.text, at: state.at });
    const operations = [
      "insert",
      "left",
      "right",
      "home",
      "end",
      "kill-left",
      "kill-right",
      "yank",
      "pop",
      "undo",
    ] as const;
    const raw = {
      left: "\x1b[D",
      right: "\x1b[C",
      home: "\x01",
      end: "\x05",
      "kill-left": "\x15",
      "kill-right": "\x0b",
      yank: "\x19",
      pop: "\x1by",
      undo: "\x1f",
    };
    const choices = operations.map((op): fc.Command<Ring, Real> => ({
      check: (state) => state.filled >= 11 && (op !== "pop" || state.yank !== null),
      run: (state, machine) => {
        ringSeen.add(op);
        const before = state.text;

        if (op === "insert") {
          save(state);
          state.text = state.text.slice(0, state.at) + text + state.text.slice(state.at);
          state.at += text.length;
        } else if (op === "left") {
          state.at = Math.max(0, state.at - 1);
        } else if (op === "right") {
          state.at = Math.min(state.text.length, state.at + 1);
        } else if (op === "home") {
          state.at = 0;
        } else if (op === "end") {
          state.at = state.text.length;
        } else if (op === "kill-left" || op === "kill-right") {
          const killed = op === "kill-left" ? state.text.slice(0, state.at) : state.text.slice(state.at);

          if (killed !== "") {
            save(state);

            if (state.joined && state.ring.length > 0) {
              state.ring[0] = op === "kill-left" ? killed + state.ring[0] : state.ring[0] + killed;
            } else {
              state.ring.unshift(killed);
              state.ring = state.ring.slice(0, 10);
            }

            state.text = op === "kill-left" ? state.text.slice(state.at) : state.text.slice(0, state.at);
            state.at = op === "kill-left" ? 0 : state.at;
          }
        } else if (op === "yank" && state.ring.length > 0) {
          save(state);
          const value = state.ring[0]!;
          state.yank = { at: state.at, length: value.length, index: 0 };
          state.text = state.text.slice(0, state.at) + value + state.text.slice(state.at);
          state.at += value.length;
        } else if (op === "pop" && state.yank !== null) {
          save(state);
          const index = (state.yank.index + 1) % state.ring.length;
          const value = state.ring[index]!;
          const start = state.yank.at;
          state.text = state.text.slice(0, start) + value + state.text.slice(start + state.yank.length);
          state.at = start + value.length;
          state.yank = { at: start, length: value.length, index };
        } else if (op === "undo") {
          const old = state.undo.pop();

          if (old !== undefined) {
            state.text = old.text;
            state.at = old.at;
          }
        }

        state.joined = op === "kill-left" || op === "kill-right";

        if (op !== "yank" && op !== "pop") {
          state.yank = null;
        }

        key(machine, op === "insert" ? text : raw[op]);
        const line = prompt(machine);
        expect(line.left + line.right, `${op} after ${before}`).toBe(state.text);
        expect(line.left.length).toBe(state.at);
      },
      toString: () => op,
    }));
    const fill: fc.Command<Ring, Real> = {
      check: (state) => state.filled < 11,
      run: (state, machine) => {
        const value = `${text}${state.filled}`;
        save(state);
        key(machine, value);
        state.text = value;
        state.at = value.length;
        key(machine, "\x01");
        state.at = 0;
        save(state);
        key(machine, "\x0b");
        state.ring = [value, ...state.ring].slice(0, 10);
        state.text = "";
        state.at = 0;
        state.joined = true;
        state.filled += 1;
        expect(prompt(machine)).toMatchObject({ left: "", right: "" });

        if (state.filled === 11) {
          ringSeen.add("ring-full");
        }
      },
      toString: () => "store a separate generated kill",
    };
    const required = ["insert", "home", "kill-right", "yank", "pop", "undo", "left", "right", "end", "kill-left"].map(
      (op) => choices.find((command) => command.toString() === op)!,
    );
    walk(seed, [...Array.from({ length: 8 }, () => fill), ...choices], model, real, [
      ...Array.from({ length: 11 }, () => fill),
      ...required,
    ]);

    for (const op of ["ring-full", ...operations]) {
      expect(ringSeen.has(op), `L9 never reached ${op}`).toBe(true);
    }
  },
  options(),
);

interface Recall {
  lines: string[];
  text: string;
  typed: string;
  back: number;
}

// L10 fault: append repeated lines without removing their earlier occurrence.
it.prop(
  "L10 history deduplicates, obeys the configured limit and restores a draft after recall",
  {
    seed: Schema.Int,
    text: Text,
    limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1100 })),
  },
  ({ seed, text, limit }) => {
    for (const cap of [1, limit, 1000]) {
      const historySeen = new Set<string>();
      const history = Array.from({ length: cap + 2 }, (_, n) => `entry ${n}`);
      const real = boot(history, cap);
      const model: Recall = { lines: history.slice(-cap), text: "", typed: "", back: 0 };
      expect(real.model.history).toEqual(model.lines);
      const choices = ["type", "submit", "repeat", "up", "down", "first", "last"].map(
        (op): fc.Command<Recall, Real> => ({
          check: (state) => (op !== "type" || state.back === 0) && (op !== "repeat" || state.lines.length > 0),
          run: (state, machine) => {
            historySeen.add(op);

            if (op === "type") {
              state.text += text;
              key(machine, text);
            } else if (op === "submit" || op === "repeat") {
              const value = op === "repeat" ? state.lines.at(-1)! : state.text;

              if (op === "repeat") {
                key(machine, "\x05\x15" + value);
              }

              key(machine, "\r");
              send(machine, { type: "ready" });

              if (value.trim() !== "") {
                state.lines = [...state.lines.filter((line) => line !== value), value].slice(-cap);
              }

              state.text = "";
              state.typed = "";
              state.back = 0;
            } else if (op === "up" || op === "first") {
              if (state.back === 0) {
                state.typed = state.text;
              }

              state.back = op === "first" ? state.lines.length : Math.min(state.lines.length, state.back + 1);
              state.text = state.lines[state.lines.length - state.back] ?? state.typed;
              key(machine, op === "first" ? "\x1b<" : "\x1b[A");
            } else {
              if (state.back > 0) {
                state.back = op === "last" ? 0 : state.back - 1;
                state.text = state.back === 0 ? state.typed : state.lines[state.lines.length - state.back]!;
              }
              key(machine, op === "last" ? "\x1b>" : "\x1b[B");
            }

            const line = prompt(machine);
            expect(line.left + line.right).toBe(state.text);
            expect(machine.model.history).toEqual(state.lines);
            expect(new Set(machine.model.history).size).toBe(machine.model.history.length);
            expect(machine.model.history.length).toBeLessThanOrEqual(cap);
          },
          toString: () => `${op} limit=${cap}`,
        }),
      );
      const required = ["type", "up", "down", "submit", "repeat", "first", "last"].map((op) =>
        choices.find((command) => command.toString().startsWith(op + " "))!,
      );
      walk(seed, choices, model, real, required);

      for (const op of ["type", "submit", "repeat", "up", "down", "first", "last"]) {
        expect(historySeen.has(op), `L10 never reached ${op}`).toBe(true);
      }
    }
  },
  options(),
);

interface Search {
  active: boolean;
  typed: string;
  text: string;
  query: string;
  at: number;
  lines: string[];
}

// L11 fault: start a reverse search at the oldest match.
it.prop(
  "L11 reverse and forward search choose the right match and cancellation restores the draft",
  {
    seed: Schema.Int,
    text: Text,
  },
  ({ seed, text }) => {
    const searchSeen = new Set<string>();
    const history = [`older ${text}`, `middle ${text} different`, `newer ${text}`, "no match"];
    const real = boot(history);
    key(real, text);
    const model: Search = { active: false, typed: text, text, query: "", at: -1, lines: [...history].reverse() };
    const choices = ["start", "query", "backspace", "older", "newer", "escape", "cancel", "interrupt", "accept"].map(
      (op): fc.Command<Search, Real> => ({
        check: (state) => (op === "start" ? !state.active : state.active),
        run: (state, machine) => {
          searchSeen.add(op);
          const find = (from: number, way: number) => {
            if (state.query === "") {
              return -1;
            }

            for (let at = from; at >= 0 && at < state.lines.length; at += way) {
              if (state.lines[at]!.includes(state.query)) {
                return at;
              }
            }

            return -1;
          };

          if (op === "start") {
            state.active = true;
            state.typed = state.text;
            state.query = "";
            state.at = -1;
            key(machine, "\x12");
          } else if (op === "query") {
            state.query += text;

            if (state.at < 0 || !state.lines[state.at]!.includes(state.query)) {
              state.at = find(0, 1);
            }

            key(machine, text);
          } else if (op === "backspace") {
            state.query = state.query.slice(0, -1);
            state.at = find(0, 1);
            key(machine, "\x7f");
          } else if (op === "older" || op === "newer") {
            const at = find(state.at + (op === "older" ? 1 : -1), op === "older" ? 1 : -1);

            if (at >= 0) {
              state.at = at;
            }

            key(machine, op === "older" ? "\x12" : "\x13");
          } else if (op === "accept") {
            const found = state.lines[state.at];
            key(machine, "\r");

            if (found !== undefined) {
              state.lines = [found, ...state.lines.filter((line) => line !== found)];
              send(machine, { type: "ready" });
              state.text = "";
            } else {
              state.text = state.typed;
            }

            state.active = false;
          } else {
            key(machine, op === "escape" ? "\x1b" : op === "cancel" ? "\x07" : "\x03");
            state.text = state.typed;
            state.active = false;
          }

          Match.value(state.active).pipe(
            Match.when(true, () =>
              Match.value(machine.model.mode).pipe(
                Match.tag("search", ({ search }) => {
                  expect(search.query).toBe(state.query);
                  expect(search.at).toBe(state.at);
                }),
                Match.orElse(() => expect.fail("search ended before a finishing key")),
              ),
            ),
            Match.orElse(() => {
              const line = prompt(machine);
              expect(line.left + line.right).toBe(state.text);
            }),
          );
        },
        toString: () => op,
      }),
    );
    const required = [
      "start",
      "query",
      "older",
      "newer",
      "backspace",
      "escape",
      "start",
      "cancel",
      "start",
      "interrupt",
      "start",
      "query",
      "accept",
    ].map((op) => choices.find((command) => command.toString() === op)!);
    walk(seed, choices, model, real, required);

    for (const op of ["start", "query", "backspace", "older", "newer", "escape", "cancel", "interrupt", "accept"]) {
      expect(searchSeen.has(op), `L11 never reached ${op}`).toBe(true);
    }
  },
  options(),
);

// L12 fault: queue Ctrl-C behind type-ahead instead of sending it now and discarding the queue.
it.prop(
  "L12 busy keys wait in order, Ctrl-D is dropped and Ctrl-C interrupts at once",
  {
    seed: Schema.Int,
    text: Text,
  },
  ({ seed, text }) => {
    const messages = ["line\r", text, "\x03", "\x04"].map((data) => decode({ type: "keys", data }));
    messages.push(decode({ type: "ready" }));
    const sequence = fc.sample(
      arbMsgSequence(fc.constantFrom(...messages), {
        minLength: 2,
        maxLength: 80,
        size: "max",
        prefix: [
          decode({ type: "keys", data: "start\r" }),
          decode({ type: "keys", data: text }),
          decode({ type: "keys", data: "\x03" }),
          decode({ type: "keys", data: text }),
          decode({ type: "keys", data: "\x04" }),
          decode({ type: "ready" }),
        ],
      }),
      { seed, numRuns: 1 },
    )[0]!;
    const folded = foldEvents(editor, ctx(), null, sequence);
    let queued = "";
    let observedBusy = 0;

    for (const step of folded.steps) {
      Match.value(step.prev.mode).pipe(
        Match.tag("busy", () => {
          observedBusy += 1;
          Match.value(step.msg).pipe(
            Match.when({ type: "keys" }, ({ data }) => {
              if (data === "\x03") {
                expect(step.cmds.some((cmd) => cmd.type === "interrupt")).toBe(true);
                queued = "";
                Match.value(step.next.mode).pipe(
                  Match.tag("busy", ({ ahead }) => expect(ahead).toEqual([])),
                  Match.orElse(() => {}),
                );
              } else {
                expect(step.cmds.some((cmd) => cmd.type === "submit")).toBe(false);

                if (data !== "\x04") {
                  queued += data;
                }

                Match.value(step.next.mode).pipe(
                  Match.tag("busy", ({ ahead }) => expect(ahead.join("")).toBe(queued)),
                  Match.orElse(() => expect.fail("ordinary type-ahead left busy mode")),
                );
              }
            }),
            Match.when({ type: "ready" }, () => {
              const prefix = queued.split("\r")[0]!;
              const submit = step.cmds.flatMap((cmd) =>
                Match.value(cmd).pipe(
                  Match.when({ type: "submit" }, (value) => [value.line]),
                  Match.orElse(() => []),
                ),
              );

              if (queued.includes("\r")) {
                expect(submit[0]).toBe(prefix);
                queued = queued.slice(queued.indexOf("\r") + 1);
              } else {
                expect(submit).toEqual([]);
                Match.value(step.next.mode).pipe(
                  Match.tag("prompt", ({ line }) => expect(line.left + line.right).toBe(queued)),
                  Match.orElse(() => expect.fail("ready did not restore the queued prompt")),
                );
                queued = "";
              }
            }),
            Match.orElse(() => {}),
          );
        }),
        Match.orElse(() => {
          queued = "";
        }),
      );
    }

    expect(observedBusy).toBeGreaterThan(0);
  },
);
