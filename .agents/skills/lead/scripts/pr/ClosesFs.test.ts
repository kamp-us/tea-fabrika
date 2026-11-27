// ClosesFs.layer on a real folder: the record's own file, as a crash and a close leave it. The laws read the
// file's lines, so a line cut short is one the file really holds. Today's lead tooling, run on our own laptop.
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Schema, type Scope } from "effect";
import { describe, expect, it } from "vitest";
import { Close, Closes } from "./Closes.ts";
import * as ClosesFs from "./ClosesFs.ts";

const CloseLine = Schema.fromJsonString(Close);

const encode = (close: Close) => Schema.encodeSync(CloseLine)(close);

const ran = <A, E>(law: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>) =>
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
  Effect.runPromise(law.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

/** A temp folder for one record, given back when the law ends. */
const temp = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  return yield* Effect.acquireRelease(fs.makeTempDirectory({ prefix: "closes-" }), (dir) =>
    fs.remove(dir, { recursive: true, force: true }).pipe(Effect.ignore),
  );
});

const LANDED = "feedfacefeedfacefeedfacefeedfacefeedface";

const first: Close = { at: "2026-11-26T00:00:00.000Z", pr: 2317, ticket: 1307, commit: LANDED };

const second: Close = { at: "2026-11-26T01:00:00.000Z", pr: 2318, ticket: 1308, commit: LANDED };

/** Every close the record holds, read through the service. */
const readAll = Effect.gen(function* () {
  return yield* (yield* Closes).all;
});

/** Records one close through the service. */
const write = (close: Close) =>
  Effect.gen(function* () {
    yield* (yield* Closes).record(close);
  });

/** `law` with the record in `state` as its Closes service. */
const on = <A, E>(state: string, law: Effect.Effect<A, E, Closes>): Effect.Effect<A, E, FileSystem.FileSystem> =>
  law.pipe(Effect.provide(ClosesFs.layer(state)));

describe("ClosesFs: one line per close, and a line a crash cut short is named, never written over", () => {
  // Plant: append the next close onto the cut-short line, so the close is lost inside a line that does not read.
  it("scenario: a record whose last line is cut short fails its reads and names that line; the next close is a line of its own", () =>
    ran(
      Effect.gen(function* () {
        const state = yield* temp;
        const fs = yield* FileSystem.FileSystem;
        const file = `${state}/closes.jsonl`;
        const torn = '{"at":"2026-11-26T01:';

        yield* fs.writeFileString(file, `${encode(first)}\n${torn}`);

        const cut = yield* Effect.flip(on(state, readAll));
        expect(cut.reason).toContain("line 2 is cut short");

        yield* on(state, write(second));

        const lines = (yield* fs.readFileString(file)).split("\n");
        expect(lines[1]).toBe(torn);
        expect(Schema.decodeUnknownSync(CloseLine)(lines[2] ?? "")).toEqual(second);
      }),
    ));

  // Plant: a blank line in front of every close, or a close glued onto the line before it.
  it("scenario: a record that ends in a newline takes its next close with no blank line before it", () =>
    ran(
      Effect.gen(function* () {
        const state = yield* temp;
        const fs = yield* FileSystem.FileSystem;
        const file = `${state}/closes.jsonl`;

        yield* fs.writeFileString(file, `${encode(first)}\n`);
        yield* on(state, write(second));

        expect(yield* fs.readFileString(file)).toBe(`${encode(first)}\n${encode(second)}\n`);
      }),
    ));

  // Plant: a record that does not exist yet reads as empty, and its first close reads back alone.
  it("scenario: no record yet reads as empty, and the first close makes it", () =>
    ran(
      Effect.gen(function* () {
        const state = yield* temp;

        expect(yield* on(state, readAll)).toEqual([]);
        yield* on(state, write(first));
        expect(yield* on(state, readAll)).toEqual([first]);
      }),
    ));
});
