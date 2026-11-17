import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path, Schema } from "effect";
import { Ghostty } from "ghostty-web";
import { pack, tableText, type Facts } from "./src/editor/cells.ts";

class TableError extends Schema.TaggedError<TableError>()("TableError", { cause: Schema.Defect() }) {}

const TOTAL = 0x110000;

const COLS = 8;

const ROWS = 500;

const PROBES = 17;

const control = (cp: number) => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);

const probeText = (probe: number, cp: number, width: number): string => {
  const c = String.fromCodePoint(cp);
  const lead = cp <= 0xff || width > 0 ? c : `\u0600${c}`;

  switch (probe) {
    case 0:
      return `${c}x`;
    case 1:
      return `${c}${width === 2 ? "\ufe0e" : "\ufe0f"}x`;
    case 2:
      return `©${c}`;
    case 3:
      return `ᄀ${c}`;
    case 4:
      return `가${c}`;
    case 5:
      return `각${c}`;
    case 6:
      return `🇹${c}`;
    case 7:
      return `😀‍${c}`;
    case 8:
      return `☝${c}`;
    case 9:
      return `😀${c}😀`;
    case 10:
      return `${lead}ğ`;
    case 11:
      return `${lead}ᅡ`;
    case 12:
      return `${lead}ᆨ`;
    case 13:
      return `${lead}ᄀ`;
    case 14:
      return `${lead}🇹`;
    case 15:
      return `${lead}🏽`;
    default:
      return `${lead}‍😀`;
  }
};

interface Batch {
  readonly texts: string[];
  readonly slots: number[];
  readonly markers: boolean[];
}

function* batches(answers: Int16Array, widths: boolean): Generator<Batch> {
  let batch: Batch = { texts: [], slots: [], markers: [] };

  for (let cp = 0; cp < TOTAL; cp += 1) {
    if (control(cp)) {
      continue;
    }

    for (let n = widths ? 0 : 1; n < (widths ? 1 : PROBES); n += 1) {
      if ((widths && cp <= 0xff) || (cp <= 0xff && n >= 2 && n <= 9)) {
        continue;
      }

      batch.texts.push(probeText(n, cp, answers[cp * PROBES] ?? 1));
      batch.slots.push(cp * PROBES + n);
      batch.markers.push(n <= 1);

      if (batch.texts.length === ROWS) {
        yield batch;
        batch = { texts: [], slots: [], markers: [] };
      }
    }
  }

  if (batch.texts.length > 0) {
    yield batch;
  }
}

const category = (cp: number, answers: Int16Array): Facts => {
  const a = (n: number) => answers[cp * PROBES + n] ?? 0;
  const width = a(0);

  if (control(cp)) {
    return { width: 1, class: "other", vs: false };
  }

  const extra = cp <= 0xff || width > 0 ? 0 : 1;
  const kind = (): Facts["class"] => {
    if (cp > 0xff && a(2) > 0) {
      return a(9) === 2 ? "zwj" : "extend";
    }

    if (a(10) > extra) {
      return "prepend";
    }

    if (a(15) > extra) {
      return "base";
    }

    if (a(16) > extra + 1) {
      return "pict";
    }

    if (a(14) > extra) {
      return "ri";
    }

    if (a(13) > extra) {
      return "L";
    }

    if (a(11) > extra && a(12) > extra) {
      return a(4) > 0 ? "V" : "LV";
    }

    if (a(12) > extra) {
      return a(3) > 0 ? "LVT" : "T";
    }

    if (a(8) > 0) {
      return "modifier";
    }

    return "other";
  };
  return { width, class: kind(), vs: width > 0 && a(1) !== width };
};

const generate = Effect.fn("fabsh.table")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const wasm = yield* fs.readFile(yield* path.fromFileUrl(new URL(import.meta.resolve("ghostty-web/ghostty-vt.wasm"))));
  const compiled = yield* Effect.try({
    try: () => new WebAssembly.Module(new Uint8Array(wasm)),
    catch: (cause) => TableError.make({ cause }),
  });
  const answers = new Int16Array(TOTAL * PROBES);

  for (let cp = 0; cp <= 0xff; cp += 1) {
    answers[cp * PROBES] = 1;
  }

  for (const widths of [true, false]) {
    const pending = batches(answers, widths);
    let finished = false;

    while (!finished) {
      yield* Effect.scoped(
        Effect.gen(function* () {
          // Fresh wasm memory bounds Ghostty's grapheme storage, not just its viewport.
          const terminal = yield* Effect.acquireRelease(
            Effect.try({
              try: () =>
                new Ghostty(new WebAssembly.Instance(compiled, { env: { log: () => {} } })).createTerminal(
                  COLS,
                  ROWS + 1,
                ),
              catch: (cause) => TableError.make({ cause }),
            }),
            (term) => Effect.sync(() => term.free()),
          );

          for (let page = 0; page < 100; page += 1) {
            const next = pending.next();

            if (next.done) {
              finished = true;
              return;
            }

            const batch = next.value;
            yield* Effect.try({
              try: () => {
                terminal.write(`\x1b[H\x1b[2J${batch.texts.join("\r\n")}`);
                terminal.getCursor();
                const cells = terminal.getViewport();

                for (let row = 0; row < batch.texts.length; row += 1) {
                  const slot = batch.slots[row]!;

                  if (batch.markers[row]) {
                    for (let col = COLS - 1; col >= 0; col -= 1) {
                      if (cells[row * COLS + col]?.codepoint === 0x78) {
                        answers[slot] = col;
                        break;
                      }
                    }
                  } else {
                    answers[slot] = cells[row * COLS]?.grapheme_len ?? 0;
                  }
                }
              },
              catch: (cause) => TableError.make({ cause }),
            });
          }
        }),
      );
    }
  }

  const packed = new Uint8Array(TOTAL);

  for (let cp = 0; cp < TOTAL; cp += 1) {
    packed[cp] = pack(category(cp, answers));
  }

  const runs = tableText(packed).match(/[0-9a-z]+[A-Z]{2}/g) ?? [];
  const rows: string[] = [];
  let row = "";

  for (const run of runs) {
    if (row.length + run.length > 96) {
      rows.push(row);
      row = "";
    }

    row += run;
  }

  rows.push(row);
  const text = [
    "// Generated by ../../table.ts from ghostty-web 0.4.0 wasm. Regenerate when it changes.",
    "export const TABLE = `",
    ...rows,
    "`;",
    "",
  ].join("\n");
  yield* fs.writeFileString(path.join(import.meta.dirname, "src/editor/cells.table.ts"), text);
});

NodeRuntime.runMain(generate().pipe(Effect.provide(NodeServices.layer)));
