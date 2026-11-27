// U1 (ticket 2018): `GitUnavailable` holds why git could not answer as its `reason`, and sets the same value as its JavaScript `cause`. Effect's printer follows
// `error.cause` and nothing else, so a wrapper without one prints as its tag alone, and so does the exception a failed span records. It runs in memory on every pull
// request.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Effect, Exit, Predicate, Schema, type Tracer } from "effect";
import { wordArb } from "./History.test-support.ts";
import { traced } from "./Laws.test-support.ts";
import * as Repository from "./Repository.ts";

const int = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

/** Every text a failed span's exception can show: what `OtlpTracer` exports reads the failure through `Cause.prettyErrors` with the cause in the stack. */
const exported = (span: Tracer.NativeSpan): ReadonlyArray<string> => {
  const { status } = span;

  return Predicate.isTagged(status, "Ended") && Exit.isFailure(status.exit)
    ? Cause.prettyErrors(status.exit.cause, { includeCauseInStack: true }).flatMap((error) => [
        error.name,
        error.message,
        error.stack ?? "",
      ])
    : [];
};

const wire = Schema.toCodecJson(Repository.GitUnavailable);

const isRecord = Schema.is(Schema.Record(Schema.String, Schema.Json));

// U1. Plant: drop the line from `GitUnavailable`, so every case is red; write `cause = this.reason.cause` (SocketError's form), so a reason with no cause of its own
// (`Exited`, `GitTooOld`) has none, and `toBe` fails; make `cause` a schema field of `GitUnavailable`, so the wire holds a key the plan does not list; give
// `NotStarted` and `Unreadable` a `cause` field that is `undefined` again after the constructor (`override readonly cause = undefined`), so a print stops at the reason's
// tag and shows no message under it.
it.effect.prop(
  "U1 unavailable: GitUnavailable's cause is its reason, so a print and a failed span's exception name the reason and the message under it, and the wire holds the reason alone",
  { message: wordArb, problem: wordArb, code: int(2, 255), stderr: wordArb, major: int(0, 2), minor: int(0, 99) },
  ({ message, problem, code, stderr, major, minor }) =>
    Effect.gen(function* () {
      // One reason of each class: the two that hold a native error, and the two that hold none.
      const reasons = [
        { id: "p", reason: new Repository.NotStarted({ cause: new Error(message) }), under: message },
        { id: "q", reason: new Repository.Unreadable({ cause: new Error(problem) }), under: problem },
        { id: "r", reason: new Repository.Exited({ code, stderr }), under: undefined },
        { id: "s", reason: new Repository.GitTooOld({ found: `${major}.${minor}`, needs: "2.38" }), under: undefined },
      ];

      expect(reasons.map((each) => each.id).join(""), "the generator reaches every class").toBe("pqrs");

      for (const { id, reason, under } of reasons) {
        const error = new Repository.GitUnavailable({ reason });
        const named = `${id}, ${reason._tag}`;

        expect(error.cause, `${named}: the cause is the reason`).toBe(reason);

        const printed = Cause.pretty(Cause.fail(error));

        expect(printed, `${named}: a print names the reason`).toContain(`[cause]: ${reason._tag}`);

        if (under !== undefined) {
          expect(printed, `${named}: a print holds the message under it`).toContain(under);
        }

        // The span: one that ends with the failure, read as the exporter reads it.
        const { spans } = yield* traced(Effect.exit(Effect.fail(error).pipe(Effect.withSpan("unavailable"))));

        expect(
          spans.map((span) => span.name),
          `${named}: one span`,
        ).toEqual(["unavailable"]);

        const texts = spans.flatMap(exported).join("\n");

        expect(texts, `${named}: the exception names the reason`).toContain(reason._tag);

        if (under !== undefined) {
          expect(texts, `${named}: the exception holds the message under it`).toContain(under);
        }

        // The wire is the same as before: the tag and the reason, and no key for the cause.
        const written = Schema.encodeUnknownSync(wire)(error);

        expect(
          isRecord(written) ? Object.keys(written).sort() : [],
          `${named}: the wire holds the tag and the reason alone`,
        ).toEqual(["_tag", "reason"]);
      }
    }),
  { arbitrary: { runs: 100, seed: 119120 } },
);
