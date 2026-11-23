// X1 to X3 [secrets]: a frame can hold the app's sign-in proof (the hello carries one), so Transport never shows a frame, or a value in
// one, in a span, a log line or an error. Each law draws a secret and runs flows that put it in a frame (a value that crosses, the
// text of a refused frame, a value the schema refuses, and frames sent before the socket failed), then reads everything the run
// handed out, in every form a secret is written in.
import { assert, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Inspectable, Option, Predicate, References, Schema, Stream } from "effect";
import type { Tracer } from "effect";
import { Socket } from "effect/socket";
import { Format, FormatError, Transport } from "./index.ts";
import * as MemorySocket from "./MemorySocket.ts";
import {
  between,
  bothWays,
  exitClose,
  failureFrom,
  Message,
  notification,
  Progress,
  reachable,
  recording,
  SEED,
  secretForms,
  secretFrom,
  spanText,
  textMessage,
  watching,
  word,
} from "./Transport.test-support.ts";

/** One run of a flow: how it ended, every span it made and every line it logged. */
interface Observed {
  readonly name: string;
  readonly exit: Exit.Exit<unknown, unknown>;
  readonly spans: ReadonlyArray<Tracer.Span>;
  readonly lines: ReadonlyArray<string>;
}

/** A flow that puts the secret in a frame: its name, the program, and what it must come to (so no flow passes by doing nothing). */
interface Flow {
  readonly name: string;
  readonly run: Effect.Effect<unknown, unknown, Format>;
  readonly check: (exit: Exit.Exit<unknown, unknown>) => void;
}

const refused = (reason: FormatError["reason"]) => (exit: Exit.Exit<unknown, unknown>) => {
  const { error, defect } = failureFrom(exit);

  expect(defect, "never a defect").toBe(false);
  expect(
    Option.map(error, (each) => (Schema.is(FormatError)(each) ? each.reason : each)),
    "the frame is refused",
  ).toEqual(Option.some(reason));
};

const decoding = (frame: string) => Stream.make(frame).pipe(Transport.decode(Message), Stream.runCollect);

/** The flows (t) of one drawn secret. */
const flows = (secret: string, cut: number): ReadonlyArray<Flow> => {
  const good = notification("value", textMessage(secret));
  const wire = Progress.make({ done: 1, total: 1 });

  return [
    {
      name: "t: the secret in a value that crosses the pair",
      run: bothWays([textMessage(secret)], [textMessage(secret)]),
      check: (exit) => {
        assert.isTrue(Exit.isSuccess(exit), "the value crosses");
        expect(exit).toEqual(Exit.succeed([[textMessage(secret)], [textMessage(secret)]]));
      },
    },
    {
      name: "f: the secret in the text of a refused frame",
      run: decoding(`~${secret}`),
      check: refused("text"),
    },
    {
      name: "f: the secret in a frame cut off",
      run: decoding(good.slice(0, good.indexOf(secret) + 1 + (cut % secret.length))),
      check: refused("text"),
    },
    {
      name: "k: the secret in a value the schema refuses",
      run: decoding(notification("value", { ...wire, done: secret })),
      check: refused("value"),
    },
    {
      name: "k: the secret as a tag the schema does not know",
      run: decoding(notification("value", wire).replace(JSON.stringify(wire._tag), JSON.stringify(secret))),
      check: refused("value"),
    },
    {
      name: "q: the secret in frames sent before the socket fails",
      run: Effect.gen(function* () {
        const [near, far] = yield* MemorySocket.pair;

        // The far end reads the first frame, so it was sent, and then fails the socket.
        const farEnd = Effect.gen(function* () {
          const { pull } = yield* far.reader;
          yield* pull;
          const writer = yield* far.writer;
          yield* writer.write(new Socket.CloseEvent(1011, "gone"));
        });

        const [exit] = yield* Effect.all(
          [
            Stream.fromIterable([textMessage(secret), textMessage(secret)]).pipe(
              Transport.encode(Message),
              Transport.socket,
              Transport.decode(Message),
              Stream.runDrain,
              Effect.provideService(Socket.Socket, near),
              Effect.exit,
            ),
            farEnd,
          ],
          { concurrency: "unbounded" },
        );

        return yield* exit;
      }).pipe(Effect.scoped),
      check: (exit) => {
        const { error } = failureFrom(exit);

        expect(
          Option.flatMap(error, (each) => (Socket.isSocketError(each) ? exitClose(Exit.fail(each)) : Option.none())),
          "the socket fails with the close",
        ).toEqual(Option.some({ code: 1011, reason: "gone" }));
      },
    },
  ];
};

/** Runs every flow of a secret, under a tracer and a logger that keep what they are handed, at every log level. */
const observe = (secret: string, cut: number): Effect.Effect<ReadonlyArray<Observed>, never, Format> =>
  Effect.forEach(
    flows(secret, cut),
    (flow) =>
      Effect.gen(function* () {
        const { spans, tracer } = yield* watching;
        const logs = recording();

        const exit = yield* flow.run.pipe(
          Effect.exit,
          Effect.withTracer(tracer),
          Effect.provide(logs.layer),
          Effect.provideService(References.MinimumLogLevel, "All"),
        );

        flow.check(exit);

        return { name: flow.name, exit, spans, lines: logs.lines };
      }),
    { concurrency: 1 },
  );

const drawn = { secret: word, n: between(0, 1_000_000), cut: between(0, 1_000_000) };

const FLOW_NAMES = [
  "t: the secret in a value that crosses the pair",
  "f: the secret in the text of a refused frame",
  "f: the secret in a frame cut off",
  "k: the secret in a value the schema refuses",
  "k: the secret as a tag the schema does not know",
  "q: the secret in frames sent before the socket fails",
];

// X1 [secrets]. Plant: annotate the span with each frame; add a span event naming the refused frame.
it.effect.prop(
  "X1 [secrets] spans hold no frame: no span name, attribute, event or failure text holds the secret in any form",
  drawn,
  (each) =>
    Effect.gen(function* () {
      const secret = secretFrom(each);
      const seen = yield* observe(secret, each.cut);

      expect(
        seen.map(({ name }) => name),
        "every flow is run",
      ).toEqual(FLOW_NAMES);

      for (const { name, spans } of seen) {
        for (const span of spans) {
          const text = spanText(span);

          for (const form of secretForms(secret)) {
            expect(text.includes(form), `${name}: the span ${span.name} holds ${form}`).toBe(false);
          }
        }
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);

// X2 [secrets]. Plant: `Effect.logDebug` the frame text on a FormatError.
it.effect.prop(
  "X2 [secrets] logs hold no frame: no line at any level of a recording logger holds the secret in any form",
  drawn,
  (each) =>
    Effect.gen(function* () {
      const secret = secretFrom(each);
      const seen = yield* observe(secret, each.cut);

      expect(
        seen.map(({ name }) => name),
        "every flow is run",
      ).toEqual(FLOW_NAMES);

      for (const { name, lines } of seen) {
        for (const line of lines) {
          for (const form of secretForms(secret)) {
            expect(line.includes(form), `${name}: a log line holds ${form}`).toBe(false);
          }
        }
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);

/** Every text a failed flow hands out: its pretty cause with the stack, and its error as text, as JSON, by its properties and by its causes. */
const errorTexts = (exit: Exit.Exit<unknown, unknown>): ReadonlyArray<string> => {
  const error = failureFrom(exit).error;

  return [
    ...(Exit.isFailure(exit)
      ? [
          Cause.pretty(exit.cause),
          ...Cause.prettyErrors(exit.cause).map((each) => `${each.name} ${each.message}\n${each.stack ?? ""}`),
        ]
      : []),
    ...Option.match(error, {
      onNone: () => [],
      onSome: (each) => [
        String(each),
        Inspectable.toStringUnknown(each),
        ...(Predicate.isObject(each) ? reachable(each) : []),
      ],
    }),
  ];
};

// X3 [secrets]. Plant: keep the SchemaError as the FormatError's cause; put the frame text in the FormatError's message.
it.effect.prop(
  "X3 [secrets] errors hold no frame: a failed flow's pretty cause with its stack, its text, its JSON, its properties and its cause chain hold the secret in no form",
  drawn,
  (each) =>
    Effect.gen(function* () {
      const secret = secretFrom(each);
      const seen = yield* observe(secret, each.cut);
      const failed = seen.filter(({ exit }) => Exit.isFailure(exit));

      expect(
        failed.map(({ name }) => name),
        "the five flows that fail are the ones that do",
      ).toEqual(FLOW_NAMES.slice(1));

      for (const { name, exit } of failed) {
        for (const text of errorTexts(exit)) {
          for (const form of secretForms(secret)) {
            expect(text.includes(form), `${name}: an error text holds ${form}`).toBe(false);
          }
        }
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);
