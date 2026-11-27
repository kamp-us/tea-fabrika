// ClosesFs.layer: the Closes service on BOXES/state/closes.jsonl, one JSON line per close, appended and
// never rewritten. No file is an empty record. A line that does not read fails every read of the record:
// a close the record cannot read may be a ticket a person reopened, so the ticket pass closes nothing
// until that line is fixed or removed. Today's lead tooling, run on our own laptop; it is not product.
import { Effect, FileSystem, Layer, Schema } from "effect";
import { Close, Closes, ClosesError } from "./Closes.ts";

const CloseLine = Schema.fromJsonString(Close);

/** `state` is the folder that holds the record: gcloop's state folder, beside its own gc.jsonl. */
export const layer = (state: string): Layer.Layer<Closes, never, FileSystem.FileSystem> =>
  Layer.effect(
    Closes,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const file = `${state}/closes.jsonl`;

      const all = Effect.fn("ClosesFs.all")(function* () {
        const present = yield* fs
          .exists(file)
          .pipe(Effect.mapError(() => ClosesError.make({ reason: "the record could not be read" })));

        if (!present) {
          return [];
        }

        const text = yield* fs
          .readFileString(file)
          .pipe(Effect.mapError(() => ClosesError.make({ reason: "the record could not be read" })));

        const numbered = text.split("\n").flatMap((line, i) => (line.trim() === "" ? [] : [{ no: i + 1, line }]));

        // Serial on purpose: the first line that does not read is the one the reason names.
        return yield* Effect.forEach(
          numbered,
          ({ no, line }) =>
            Schema.decodeEffect(CloseLine)(line).pipe(
              Effect.mapError(() =>
                ClosesError.make({ reason: `line ${no} of the record does not read; fix or remove it` }),
              ),
            ),
          { concurrency: 1 },
        );
      });

      const record = Effect.fn("ClosesFs.record")(
        function* (close: Close) {
          yield* fs.makeDirectory(state, { recursive: true });
          yield* fs.writeFileString(file, `${Schema.encodeSync(CloseLine)(close)}\n`, { flag: "a" });
        },
        Effect.mapError(() => ClosesError.make({ reason: "the record could not be written" })),
      );

      return Closes.of({ all: all(), record });
    }),
  );
