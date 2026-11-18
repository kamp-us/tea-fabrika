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
import { editor } from "./editor.ts";

const decode = Schema.decodeUnknownSync(Schema.toType(editor.msg));

type Model = ReturnType<typeof editor.init>[0];

type Msg = typeof editor.msg.Type;

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
  const [model, cmds] = applyCell<Model, Msg, Output>(editor, real.model, decode(raw));
  real.model = model;
  real.cmds = cmds;
};

// A logical key boundary is explicit. Transport frames alone do not disambiguate Esc.
const key = (real: Real, data: string, split?: number) => {
  const outputs: Output[] = [];

  for (const chunk of split === undefined ? [data] : [data.slice(0, split), data.slice(split)]) {
    send(real, { type: "keys", data: chunk });
    outputs.push(...real.cmds);
  }

  send(real, { type: "flush" });
  real.cmds = [...outputs, ...real.cmds];
};

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

const withoutControlCharacters = (text: string) =>
  [...text]
    .filter((char) => {
      const codepoint = char.codePointAt(0) ?? 0;
      return codepoint > 0x1f && (codepoint < 0x7f || codepoint > 0x9f);
    })
    .join("");

const csiMatches = (text: string) => {
  const matches: Array<{ index: number; end: number; parameters: string }> = [];

  for (let start = 0; start < text.length;) {
    const index = text.indexOf("\x1b[", start);

    if (index < 0) {
      break;
    }

    let end = index + 2;

    while (end < text.length) {
      const code = text.charCodeAt(end);

      if ((code >= 0x30 && code <= 0x39) || code === 0x3b) {
        end += 1;
      } else {
        break;
      }
    }

    const final = text.charCodeAt(end);

    if ((final >= 0x41 && final <= 0x5a) || (final >= 0x61 && final <= 0x7a)) {
      matches.push({ index, end: end + 1, parameters: text.slice(index + 2, end) });
      start = end + 1;
    } else {
      start = index + 1;
    }
  }

  return matches;
};

const withoutCsi = (text: string) => {
  let result = "";
  let end = 0;

  for (const match of csiMatches(text)) {
    result += text.slice(end, match.index);
    end = match.end;
  }

  return `${result}${text.slice(end)}`;
};

const options = (runs = 300) => ({ arbitrary: { runs: runsFor({ fast: runs, full: runs }) } });

// The installed @effect/vitest accepts Effect Arbitrary, while tea and fc.commands use fast-check.
// A Schema-generated seed selects a command walk inside the property runner.
// Effect shrinks the seed and command data; fast-check supplies legal-move checks for the walk.
const walk = <M extends object, R>(
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
  "\x1b[H",
  "\x1bOH",
  "\x1b[1~",
  "\x1b[F",
  "\x1bOF",
  "\x1b[4~",
  "\x1bOD",
  "\x1bOC",
  "\x1bOA",
  "\x1bOB",
  "\x1b",
  "\x07",
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
      ]
        .flatMap((data) => [
          { data, split: undefined },
          { data, split: Math.abs(seed) % (data.length + 1) },
        ])
        .map(({ data, split }): fc.Command<{ prompt: boolean }, Real> => ({
          check: (state) => state.prompt,
          run: (model, state) => {
            reached.add(data);
            key(state, data, split);
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
            reference.write(`${expected} `);
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
      walk(seed, choices, { prompt: true }, real, [
        ...choices.slice(0, Edits.literals.length * 2),
        ...choices.slice(-4),
      ]);

      for (const data of Edits.literals) {
        expect(reached.has(data), `L8 never reached bound key ${JSON.stringify(data)}`).toBe(true);
      }

      // Aliases must perform the same edit and feedback, even when frames split after Esc.

      for (const [alias, canonical] of [
        ["\x1b[H", "\x01"],
        ["\x1bOH", "\x01"],
        ["\x1b[1~", "\x01"],
        ["\x1b[F", "\x05"],
        ["\x1bOF", "\x05"],
        ["\x1b[4~", "\x05"],
        ["\x1bOD", "\x02"],
        ["\x1bOC", "\x06"],
        ["\x1bOA", "\x10"],
        ["\x1bOB", "\x0e"],
        ["\x1b", "\x07"],
        ["\x07", "\x07"],
      ]) {
        const expected = boot(["older", "newer"]);
        const actual = boot(["older", "newer"]);

        for (const machine of [expected, actual]) {
          key(machine, `a${withoutControlCharacters(text)}`);
          key(machine, "\x01\x06");
        }

        key(expected, canonical!);
        key(actual, alias!, Math.abs(seed) % (alias!.length + 1));
        expect(prompt(actual)).toEqual(prompt(expected));
        expect(bytes(actual.cmds)).toBe(bytes(expected.cmds));
      }

      // Fault: paint judges the last word instead of the word at the real cursor.
      const edited = boot();
      const missing = `absent${Math.abs(seed)}`;
      const underlined = (outputs: ReadonlyArray<Output>) =>
        csiMatches(bytes(outputs)).some(
          (match) => bytes(outputs).charAt(match.end - 1) === "m" && match.parameters.split(";").includes("4"),
        );
      key(edited, `${missing} `);
      expect(underlined(edited.cmds)).toBe(true);
      key(edited, "\x01");
      expect(underlined(edited.cmds)).toBe(false);
      key(edited, "z");
      expect(underlined(edited.cmds)).toBe(false);
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
      const empty = boot([], cap);
      key(empty, "\x1b[A");
      expect(bytes(empty.cmds)).toContain("\x07");
      expect(prompt(empty)).toEqual({ left: "", right: "" });
      key(empty, "\x1b[B");
      expect(bytes(empty.cmds)).toContain("\x07");
      expect(prompt(empty)).toEqual({ left: "", right: "" });
      const history = Array.from({ length: cap + 2 }, (_, n) => `entry ${n}`);
      const real = boot(history, cap);
      const model: Recall = { lines: history.slice(-cap), text: "", typed: "", back: 0 };
      expect(real.model.history).toEqual(model.lines);
      const choices = ["type", "submit", "repeat", "up", "down", "first", "last"].map(
        (op): fc.Command<Recall, Real> => ({
          check: (state) => (op !== "type" || state.back === 0) && (op !== "repeat" || state.lines.length > 0),
          run: (state, machine) => {
            historySeen.add(op);
            const boundary = op === "up" ? state.back === state.lines.length : op === "down" && state.back === 0;

            if (op === "type") {
              state.text += text;
              key(machine, text);
            } else if (op === "submit" || op === "repeat") {
              const value = op === "repeat" ? state.lines.at(-1)! : state.text;

              if (op === "repeat") {
                key(machine, `\x05\x15${value}`);
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

            if (op === "up" || op === "down") {
              expect(bytes(machine.cmds).includes("\x07"), `${op} boundary feedback`).toBe(boundary);
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
        choices.find((command) => command.toString().startsWith(`${op} `))!,
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

    // Fault: deciding standalone Esc from an input frame destroys a split arrow or meta key.

    for (const ending of ["\x1b", "\x1b[D", "\x1bb", "\x1b[1;5D"]) {
      const batch = `\x12${text}${ending}`;
      const expected = boot(history);
      key(expected, text);
      key(expected, batch);

      for (const cut of new Set([1, batch.length - ending.length + 1, Math.abs(seed) % (batch.length + 1)])) {
        const actual = boot(history);
        key(actual, text);
        send(actual, { type: "keys", data: batch.slice(0, cut) });
        send(actual, { type: "keys", data: batch.slice(cut) });
        send(actual, { type: "flush" });
        expect(prompt(actual)).toEqual(prompt(expected));
      }
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
          const nextBusy = (check: (ahead: ReadonlyArray<string>) => void) =>
            Match.value(step.next.mode).pipe(
              Match.tag("busy", ({ ahead }) => check(ahead)),
              Match.tag("asking", () => expect.fail("busy line entered asking mode")),
              Match.tag("prompt", () => expect.fail("busy line returned to prompt mode")),
              Match.tag("search", () => expect.fail("busy line entered search mode")),
              Match.tag("ended", () => expect.fail("busy line ended before it was ready")),
              Match.exhaustive,
            );

          Match.value(step.msg).pipe(
            Match.when({ type: "keys" }, ({ data }) =>
              Match.value(data).pipe(
                Match.when("\x03", () => {
                  expect(step.cmds.some((cmd) => cmd.type === "interrupt")).toBe(true);
                  queued = "";
                  nextBusy((ahead) => expect(ahead).toEqual([]));
                }),
                Match.when("\x04", () => {
                  expect(step.cmds.some((cmd) => cmd.type === "submit")).toBe(false);
                  nextBusy((ahead) => expect(ahead.join("")).toBe(queued));
                }),
                Match.orElse(() => {
                  expect(step.cmds.some((cmd) => cmd.type === "submit")).toBe(false);
                  queued += data;
                  nextBusy((ahead) => expect(ahead.join("")).toBe(queued));
                }),
              ),
            ),
            Match.when({ type: "ready" }, () => {
              const prefix = queued.split("\r")[0]!;
              const submit = step.cmds.flatMap((cmd) =>
                Match.value(cmd).pipe(
                  Match.when({ type: "submit" }, (value) => [value.line]),
                  Match.orElse(() => []),
                ),
              );

              Match.value(queued.includes("\r")).pipe(
                Match.when(true, () => {
                  expect(submit[0]).toBe(prefix);
                  queued = queued.slice(queued.indexOf("\r") + 1);
                }),
                Match.when(false, () => {
                  expect(submit).toEqual([]);
                  Match.value(step.next.mode).pipe(
                    Match.tag("prompt", ({ line }) => expect(line.left + line.right).toBe(queued)),
                    Match.orElse(() => expect.fail("ready did not restore the queued prompt")),
                  );
                  queued = "";
                }),
                Match.exhaustive,
              );
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

    // Fault: parsing beyond Enter moves an incomplete suffix before earlier queued text.

    for (const ending of ["\x1b[D", "\x1bOD", "\x1bf", `\x1b[200~${text}\nlast\x1b[201~`]) {
      const suffix = text + ending + text;
      const expected = boot();
      key(expected, "go\r");
      send(expected, { type: "ready" });
      key(expected, suffix);
      const prefix = "go\r";
      const split = text.length + Math.max(1, Math.abs(seed) % ending.length);
      const cuts = new Set([text.length + 1, split, text.length + ending.length - 1]);

      if (ending.startsWith("\x1b[200~")) {
        cuts.add(text.length + "\x1b[200~".length + text.length);
      }

      for (const at of cuts) {
        const actual = boot();
        send(actual, { type: "keys", data: prefix + suffix.slice(0, at) });
        send(actual, { type: "keys", data: suffix.slice(at) });
        send(actual, { type: "ready" });
        send(actual, { type: "flush" });
        expect(prompt(actual)).toEqual(prompt(expected));
        expect(actual.model.history).toEqual(expected.model.history);
        const once = prompt(actual);
        send(actual, { type: "ready" });
        expect(prompt(actual), "ready must not replay type-ahead twice").toEqual(once);
      }
    }

    // A standalone-Esc boundary typed ahead must not turn the following text into Meta.
    const separated = boot();
    key(separated, "go\r");
    key(separated, `${text}\x1b`);
    key(separated, text);
    send(separated, { type: "ready" });
    const direct = boot();
    key(direct, "go\r");
    send(direct, { type: "ready" });
    key(direct, `${text}\x1b`);
    key(direct, text);
    expect(prompt(separated)).toEqual(prompt(direct));

    // Fault: asking drops the busy queue, cannot be withdrawn, or never releases on ready.
    const questionSeen = new Set<string>();
    const asking = boot();
    const state: { phase: "idle" | "busy" | "asking"; pending: string } = { phase: "idle", pending: "" };
    const operations = ["start", "queue", "ask", "yes", "no", "enter", "withdraw", "finish", "interrupt"] as const;
    const choices = operations.map((op): fc.Command<typeof state, Real> => ({
      check: (model) =>
        op === "start"
          ? model.phase === "idle"
          : op === "queue" || op === "ask"
            ? model.phase === "busy"
            : op === "finish" || op === "interrupt"
              ? model.phase !== "idle"
              : model.phase === "asking",
      run: (model, machine) => {
        questionSeen.add(op);

        const answer = (allow: boolean, input: string) => {
          key(machine, input);
          model.phase = "busy";
          const answers = machine.cmds.flatMap((cmd) =>
            Match.value(cmd).pipe(
              Match.when({ type: "answer" }, (value) => [{ job: value.job, allow: value.allow }]),
              Match.orElse(() => []),
            ),
          );
          expect(answers).toEqual([{ job: 1, allow }]);
          expect(withoutCsi(bytes(machine.cmds)).trim()).not.toBe("");
        };

        Match.value(op).pipe(
          Match.when("start", () => {
            key(machine, "\x01\x0bstart\r");
            model.phase = "busy";
            model.pending = "";
          }),
          Match.when("queue", () => {
            send(machine, { type: "keys", data: text });
            model.pending += text;
          }),
          Match.when("ask", () => {
            send(machine, { type: "asked", job: 1, text: "Allow?" });
            model.phase = "asking";
          }),
          Match.when("withdraw", () => {
            send(machine, { type: "asked", job: 1, text: null });
            model.phase = "busy";
            expect(machine.cmds.some((cmd) => cmd.type === "answer")).toBe(false);
          }),
          Match.when("finish", () => {
            send(machine, { type: "ready" });
            model.phase = "idle";
            expect(prompt(machine).left + prompt(machine).right).toBe(model.pending);
          }),
          Match.when("interrupt", () => {
            key(machine, "\x03");
            model.phase = "busy";
            model.pending = "";
            expect(machine.cmds.some((cmd) => cmd.type === "interrupt")).toBe(true);
          }),
          Match.when("yes", () => answer(true, "y")),
          Match.when("no", () => answer(false, "n")),
          Match.when("enter", () => answer(false, "\r")),
          Match.exhaustive,
        );

        Match.value(model.phase).pipe(
          Match.when("busy", () =>
            Match.value(machine.model.mode).pipe(
              Match.tag("busy", ({ ahead }) => {
                expect(model.phase).toBe("busy");
                expect(ahead.join("")).toBe(model.pending);
              }),
              Match.tag("asking", () => expect.fail("busy line entered asking mode")),
              Match.tag("prompt", () => expect.fail("busy line returned to prompt mode")),
              Match.tag("search", () => expect.fail("busy line entered search mode")),
              Match.tag("ended", () => expect.fail("busy line ended before it was ready")),
              Match.exhaustive,
            ),
          ),
          Match.when("asking", () =>
            Match.value(machine.model.mode).pipe(
              Match.tag("busy", () => expect.fail("question left asking mode")),
              Match.tag("asking", ({ ahead }) => {
                expect(model.phase).toBe("asking");
                expect(ahead.join("")).toBe(model.pending);
              }),
              Match.tag("prompt", () => expect.fail("question returned to prompt mode")),
              Match.tag("search", () => expect.fail("question entered search mode")),
              Match.tag("ended", () => expect.fail("question ended before it was answered")),
              Match.exhaustive,
            ),
          ),
          Match.when("idle", () => {}),
          Match.exhaustive,
        );
      },
      toString: () => op,
    }));
    const required = [
      "start",
      "queue",
      "ask",
      "yes",
      "finish",
      "start",
      "queue",
      "ask",
      "no",
      "finish",
      "start",
      "queue",
      "ask",
      "enter",
      "finish",
      "start",
      "queue",
      "ask",
      "withdraw",
      "finish",
      "start",
      "queue",
      "ask",
      "finish",
      "start",
      "queue",
      "ask",
      "interrupt",
      "finish",
    ].map((op) => choices.find((command) => command.toString() === op)!);
    walk(seed, choices, state, asking, required);

    for (const op of operations) {
      expect(questionSeen.has(op), `L12 never reached question ${op}`).toBe(true);
    }
  },
);
