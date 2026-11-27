// LandLogFs.layer: the LandLog service on a folder, one file for each key (`<pr>.jsonl`, `quest-<name>.jsonl`), one JSON line per
// event, appended and never rewritten. No file is no lines. A line that does not read is skipped and counted, never a failure: a
// lost line costs one fact about one attempt. A write a crash cut short leaves a cut-short last line; the next line starts on a
// line of its own, so it is never written onto that one. A key that is no plain name is refused before any path is built, so a
// line never lands outside the folder. Today's lead tooling, run on our own laptop; it is not product.
import { Effect, FileSystem, Layer, Option, Schema } from "effect";
import { type Key, LandLog, LandLogError, Line, QuestName } from "./LandLog.ts";

const EventLine = Schema.fromJsonString(Line);

/** The file a key's lines are in, inside the folder. */
const fileFor = (dir: string, key: Key): Option.Option<string> =>
  key._tag === "pr"
    ? Option.some(`${dir}/${key.pr}.jsonl`)
    : Schema.is(QuestName)(key.name)
      ? Option.some(`${dir}/quest-${key.name}.jsonl`)
      : Option.none();

/** `dir` is the folder that holds the records: `runs/land` of the main checkout. */
export const layer = (dir: string): Layer.Layer<LandLog, never, FileSystem.FileSystem> =>
  Layer.effect(
    LandLog,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const checked = (key: Key) =>
        Effect.fromOption(fileFor(dir, key)).pipe(
          Effect.mapError(() => LandLogError.make({ reason: "the quest name is not a plain name" })),
        );

      const append = Effect.fn("LandLogFs.append")(function* (key: Key, line: Line) {
        const file = yield* checked(key);

        yield* Effect.gen(function* () {
          yield* fs.makeDirectory(dir, { recursive: true });

          // A line starts on a line of its own: after one a crash cut short, it would be read as part of that one.
          const text = (yield* fs.exists(file)) ? yield* fs.readFileString(file) : "";
          const lead = text === "" || text.endsWith("\n") ? "" : "\n";

          yield* fs.writeFileString(file, `${lead}${Schema.encodeSync(EventLine)(line)}\n`, { flag: "a" });
        }).pipe(Effect.mapError(() => LandLogError.make({ reason: "the record could not be written" })));
      });

      const read = Effect.fn("LandLogFs.read")(function* (key: Key) {
        const file = yield* checked(key);

        return yield* Effect.gen(function* () {
          if (!(yield* fs.exists(file))) {
            return { lines: [], torn: 0 };
          }

          const text = yield* fs.readFileString(file);
          const filled = text.split("\n").filter((raw) => raw.trim() !== "");
          const read = filled.map((raw) => Schema.decodeOption(EventLine)(raw));

          return {
            lines: read.flatMap((got) => (got._tag === "Some" ? [got.value] : [])),
            torn: read.filter((got) => got._tag === "None").length,
          };
        }).pipe(Effect.mapError(() => LandLogError.make({ reason: "the record could not be read" })));
      });

      return LandLog.of({ append, read });
    }),
  );
