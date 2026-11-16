// RedactTest.layer: the Redact service in memory, built on the Recorder (0579). Each call answers
// with the answer given and touches no file and starts no process; the Recorder keeps every call in
// order with all its args, so a law reads what a caller asked with `Recorder.calls(Redact)`.
// Today's lead tooling.
import { Recorder } from "@kampus/vitest";
import { Effect, type Layer } from "effect";
import { type Files, type Ran, Redact } from "./Redact.ts";

/** What each call answers: `files` for a scrub of named files, `ran` for a run. */
export type Answer = { readonly files: Files; readonly ran: Ran };

export const layer = (answer: Answer): Layer.Layer<Redact | Recorder.Recorded<Redact>> =>
  Recorder.layer(Redact, {
    files: () => Effect.succeed(answer.files),
    run: () => Effect.succeed(answer.ran),
  });
