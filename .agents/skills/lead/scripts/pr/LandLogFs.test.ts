// Today's lead tooling. LandLogFs.layer on a real temp folder (L7 of .kalfa/quests/land-record-PLAN.md): the record's own file, as an
// append and a crash leave it. The laws read the file's text, so a line cut short is one the file really holds.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, FileSystem, Schema } from "effect";
import { type Key, LandLog, Line } from "./LandLog.ts";
import * as LandLogFs from "./LandLogFs.ts";

const EventLine = Schema.fromJsonString(Line);

const encode = (line: Line) => Schema.encodeSync(EventLine)(line);

const key: Key = { _tag: "pr", pr: 2351 };

/** What a file may hold besides a good line: a line that reads, a blank line, or noise that is no line. */
const Entry = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("line"), line: Line }),
  Schema.Struct({ kind: Schema.Literal("blank"), space: Schema.Literals(["", " ", "\t", "  "]) }),
  // A "~" first makes it no JSON, and no token holds a newline, so it is one line of its own.
  Schema.Struct({
    kind: Schema.Literal("noise"),
    tokens: Schema.Array(Schema.Literals(["{", "}", "x", "[1", "null", "é", "🙂", '"a":', " "])),
  }),
]);

type Entry = typeof Entry.Type;

/** A line a crash cut short: some of one line's text, cut anywhere inside it, with no newline after. */
const Tail = Schema.Struct({ line: Line, cut: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })) });

const text = (entry: Entry): string =>
  entry.kind === "line" ? encode(entry.line) : entry.kind === "blank" ? entry.space : `~${entry.tokens.join("")}`;

const cutShort = (tail: typeof Tail.Type): string => {
  const whole = encode(tail.line);

  return whole.slice(0, 1 + (tail.cut % (whole.length - 1)));
};

/** A temp folder for one record, given back when the law ends. */
const temp = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.makeTempDirectoryScoped({ prefix: "landlog-" });
});

const appendThrough = (dir: string, line: Line) =>
  Effect.gen(function* () {
    yield* (yield* LandLog).append(key, line);
  }).pipe(Effect.provide(LandLogFs.layer(dir)));

const readThrough = (dir: string) =>
  Effect.gen(function* () {
    return yield* (yield* LandLog).read(key);
  }).pipe(Effect.provide(LandLogFs.layer(dir)));

describe("LandLogFs: one line per event, and a line a crash cut short is skipped on read and never written onto", () => {
  // Plants, each run once and restored: write a line with no newline after it (the next one lands on the same line); append onto a
  // cut-short last line without a newline first (red: the next line is lost inside the torn one); fail the read on a bad line, as
  // `ClosesFs.all` does (red: the read fails); count a blank line as torn (red: torn is too high); drop the line that reads
  // after a bad one (red: lines are short).
  it.effect.prop(
    "L7 property: a record holds one line for each event, each ending in a newline; a cut-short last line takes the next on a line of its own; a read skips a bad or blank line, counts the bad ones, and never fails",
    {
      entries: Schema.Array(Entry),
      tail: Schema.UndefinedOr(Tail),
      next: Line,
    },
    ({ entries, tail, next }) =>
      Effect.gen(function* () {
        const dir = yield* temp;
        const fs = yield* FileSystem.FileSystem;
        const file = `${dir}/2351.jsonl`;

        // No record yet reads as no lines, and the first append makes it.
        expect(yield* readThrough(dir)).toEqual({ lines: [], torn: 0 });

        const before = entries.map((entry) => `${text(entry)}\n`).join("");
        const torn = tail === undefined ? "" : cutShort(tail);
        yield* fs.writeFileString(file, `${before}${torn}`);

        const good = entries.flatMap((entry) => (entry.kind === "line" ? [entry.line] : []));
        const bad = entries.filter((entry) => entry.kind === "noise").length + (tail === undefined ? 0 : 1);
        expect(yield* readThrough(dir)).toEqual({ lines: good, torn: bad });

        yield* appendThrough(dir, next);

        // The next line is one on its own: after a cut-short line it takes a newline first, and after a whole line none.
        expect(yield* fs.readFileString(file)).toBe(`${before}${torn}${torn === "" ? "" : "\n"}${encode(next)}\n`);
        expect(yield* readThrough(dir)).toEqual({ lines: [...good, next], torn: bad });
      }).pipe(Effect.provide(NodeServices.layer)),
    { arbitrary: { seed: 2344, runs: runsFor({ fast: 40, full: 100 }) } },
  );
});
