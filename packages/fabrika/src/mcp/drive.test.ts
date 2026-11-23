import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { listed } from "../program/listed.ts";
import { defineProgram } from "../program/program.ts";
import { input } from "../program/shape.ts";
import { programList } from "../shell/programs.ts";
import { driveFor } from "./drive.ts";

// A call on a program's input answers once the run has handled its value, and no longer than
// `settle` (a setting of the door, `SETTLE` when left out). Today's version. The tracker's own
// views are in programs/tracker/src/agent.test.ts; this is the door's part: the wait, and its limit.
//
//   drive.call("slow_say", {value: "x"})   // answers after the handler of "x" returned
//   driveFor({list, tiles, settle: "50 millis"}) then the same call, with a handler that takes
//   longer: answers at 50 ms with {settled: false} beside the view

const slow = (done: string[], millis: number) =>
  defineProgram({
    name: "slow",
    description: "Handles a word after a while.",
    inputs: { say: input(Schema.String, "A word.") },
    outputs: {},
    main: ({ serve }) =>
      serve({
        say: (word) => Effect.sleep(`${millis} millis`).pipe(Effect.andThen(Effect.sync(() => done.push(word)))),
      }),
  });

const doorOn = (done: string[], millis: number, settle?: `${number} millis`) =>
  driveFor({
    list: programList([listed(slow(done, millis), Layer.empty)]),
    tiles: () => [],
    ...(settle === undefined ? {} : { settle }),
  }).pipe(Effect.map(({ drive }) => drive));

describe("a call on an input waits for its value to be handled, within `settle`", () => {
  it("answers after the handler returned, and says nothing of settling when it did", async () => {
    const done: string[] = [];
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const drive = yield* doorOn(done, 30);
        const answer = yield* drive.call("slow_say", { value: "one" });
        return { answer, done: [...done] };
      }).pipe(Effect.scoped),
    );
    expect(seen.done).toEqual(["one"]);
    expect(seen.answer).toMatchObject({ kind: "done", data: { word: "queued" } });
    expect(seen.answer.kind === "done" ? seen.answer.data : null).not.toHaveProperty("settled");
  });

  it("answers when `settle` runs out, with settled: false, while the handler still runs", async () => {
    const done: string[] = [];
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const drive = yield* doorOn(done, 400, "40 millis");
        const answer = yield* drive.call("slow_say", { value: "late" });
        return { answer, done: [...done] };
      }).pipe(Effect.scoped),
    );
    expect(seen.done).toEqual([]);
    expect(seen.answer).toMatchObject({ kind: "done", data: { word: "queued", settled: false } });
  });
});
