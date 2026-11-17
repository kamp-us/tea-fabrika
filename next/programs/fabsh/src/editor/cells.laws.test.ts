// next/, S1. L14 keeps the approved exhaustive wasm vector, not a sampled Unicode table.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { Ghostty } from "ghostty-web";
import { factsOf, spot } from "./cells.ts";

const probes = [
  "width",
  "variation",
  "after-pict",
  "after-l",
  "after-lv",
  "after-lvt",
  "after-ri",
  "after-zwj",
  "after-base",
  "between-pict",
  "before-other",
  "before-v",
  "before-t",
  "before-l",
  "before-ri",
  "before-modifier",
  "before-zwj",
] as const;

type Probe = (typeof probes)[number];

const TOTAL = 0x110000;

const COLS = 8;

const ROWS = 500;

const control = (cp: number) => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);

const text = (probe: Probe, cp: number, width: number) => {
  const char = String.fromCodePoint(cp);
  const leading = cp <= 0xff || width > 0 ? char : `\u0600${char}`;

  switch (probe) {
    case "width":
      return `${char}x`;
    case "variation":
      return `${char}${width === 2 ? "\ufe0e" : "\ufe0f"}x`;
    case "after-pict":
      return `©${char}`;
    case "after-l":
      return `ᄀ${char}`;
    case "after-lv":
      return `가${char}`;
    case "after-lvt":
      return `각${char}`;
    case "after-ri":
      return `🇹${char}`;
    case "after-zwj":
      return `😀‍${char}`;
    case "after-base":
      return `☝${char}`;
    case "between-pict":
      return `😀${char}😀`;
    case "before-other":
      return `${leading}ğ`;
    case "before-v":
      return `${leading}ᅡ`;
    case "before-t":
      return `${leading}ᆨ`;
    case "before-l":
      return `${leading}ᄀ`;
    case "before-ri":
      return `${leading}🇹`;
    case "before-modifier":
      return `${leading}🏽`;
    case "before-zwj":
      return `${leading}‍😀`;
  }
};

interface Batch {
  texts: string[];
  slots: number[];
  cursor: boolean[];
}

// Widths are read first. A zero-width leading code point needs a base for the join probes.
function* batches(answers: Int16Array, width: boolean): Generator<Batch> {
  let batch: Batch = { texts: [], slots: [], cursor: [] };

  for (let cp = 0; cp < TOTAL; cp += 1) {
    if (control(cp)) {
      continue;
    }

    for (let n = width ? 0 : 1; n < (width ? 1 : probes.length); n += 1) {
      const probe = probes[n]!;

      if ((width && cp <= 0xff) || (cp <= 0xff && (probe.startsWith("after-") || probe === "between-pict"))) {
        continue;
      }

      batch.texts.push(text(probe, cp, answers[cp * probes.length] ?? 1));
      batch.slots.push(cp * probes.length + n);
      batch.cursor.push(probe === "width" || probe === "variation");

      if (batch.texts.length === ROWS) {
        yield batch;
        batch = { texts: [], slots: [], cursor: [] };
      }
    }
  }

  if (batch.texts.length > 0) {
    yield batch;
  }
}

// vector: the installed ghostty-web 0.4.0 wasm is the independent oracle for every code point.
// Fault: treat U+FE0F as one cell after every character, including non-emoji.
it.effect("vector: L14 every code point's cell facts and hard-character spot match Ghostty wasm", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const wasm = yield* fs.readFile(
      yield* path.fromFileUrl(new URL(import.meta.resolve("ghostty-web/ghostty-vt.wasm"))),
    );
    const module = new WebAssembly.Module(new Uint8Array(wasm));
    const answers = new Int16Array(TOTAL * probes.length);

    for (let cp = 0; cp <= 0xff; cp += 1) {
      answers[cp * probes.length] = 1;
    }

    for (const phase of [true, false]) {
      const pending = batches(answers, phase);
      let finished = false;

      while (!finished) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const term = yield* Effect.acquireRelease(
              Effect.sync(() =>
                new Ghostty(new WebAssembly.Instance(module, { env: { log: () => {} } })).createTerminal(
                  COLS,
                  ROWS + 1,
                ),
              ),
              (terminal) => Effect.sync(() => terminal.free()),
            );

            // Today's probing found wasm grapheme storage exhausted after hundreds of writes.
            // Each group gets fresh wasm memory and a scoped terminal, before that boundary.
            for (let page = 0; page < 100; page += 1) {
              const next = pending.next();

              if (next.done) {
                finished = true;
                return;
              }

              const batch = next.value;
              term.write(`\x1b[H\x1b[2J${batch.texts.join("\r\n")}`);
              expect(term.getCursor().y, "a wasm probe wrapped outside its row").toBe(batch.texts.length - 1);
              const cells = term.getViewport();

              for (let row = 0; row < batch.texts.length; row += 1) {
                const slot = batch.slots[row]!;

                if (batch.cursor[row]) {
                  let found = -1;

                  for (let col = COLS - 1; col >= 0; col -= 1) {
                    if (cells[row * COLS + col]?.codepoint === 0x78) {
                      found = col;
                      break;
                    }
                  }

                  expect(found, `missing wasm marker at slot ${slot}`).toBeGreaterThanOrEqual(0);
                  answers[slot] = found;
                } else {
                  answers[slot] = cells[row * COLS]?.grapheme_len ?? 0;
                }
              }
            }
          }),
        );
      }
    }

    for (let cp = 0; cp < TOTAL; cp += 1) {
      const answer = (probe: Probe) => answers[cp * probes.length + probes.indexOf(probe)] ?? 0;
      const width = answer("width");
      const extra = cp <= 0xff || width > 0 ? 0 : 1;
      let category = "other";

      if (!control(cp)) {
        if (cp > 0xff && answer("after-pict") > 0) {
          category = answer("between-pict") === 2 ? "zwj" : "extend";
        } else if (answer("before-other") > extra) {
          category = "prepend";
        } else if (answer("before-modifier") > extra) {
          category = "base";
        } else if (answer("before-zwj") > extra + 1) {
          category = "pict";
        } else if (answer("before-ri") > extra) {
          category = "ri";
        } else if (answer("before-l") > extra) {
          category = "L";
        } else if (answer("before-v") > extra && answer("before-t") > extra) {
          category = answer("after-lv") > 0 ? "V" : "LV";
        } else if (answer("before-t") > extra) {
          category = answer("after-l") > 0 ? "LVT" : "T";
        } else if (answer("after-base") > 0) {
          category = "modifier";
        }
      }

      expect(factsOf(cp), `cell facts for U+${cp.toString(16)}`).toEqual({
        width: control(cp) ? 1 : width,
        class: category,
        vs: !control(cp) && width > 0 && answer("variation") !== width,
      });
    }

    const hard = ["a\ufe0f", "©\ufe0f", "😀\ufe0e", "é", "漢", "👍🏽", "🇹🇷", "👨‍👩‍👧", "각", "؀x"];

    for (const cols of [2, 3, 8, 10, 80, 200]) {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const ghostty = new Ghostty(new WebAssembly.Instance(module, { env: { log: () => {} } }));

          for (const value of hard) {
            for (const lead of ["", "a".repeat(cols - 1), "a".repeat(cols)]) {
              const source = lead + value;
              const term = yield* Effect.acquireRelease(
                Effect.sync(() => ghostty.createTerminal(cols, 20)),
                (terminal) => Effect.sync(() => terminal.free()),
              );
              term.write(source + "x");
              let expected = -1;

              for (let row = 0; row < 20; row += 1) {
                const cells = term.getLine(row) ?? [];

                for (let col = 0; col < cells.length; col += 1) {
                  if (cells[col]?.codepoint === 0x78) {
                    expected = row * cols + col;
                  }
                }
              }

              expect(expected, `wasm did not draw the final marker for ${source}`).toBeGreaterThanOrEqual(0);
              expect(spot(source, cols), `${JSON.stringify(source)} at width ${cols}`).toBe(expected);
            }
          }
        }),
      );
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);
