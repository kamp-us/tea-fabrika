// fieldrow.ts [--parent RUN] [--model M] [--effort E] [--step S --started T --ended T --start SHA
//             --end SHA --status N] <events.jsonl> <run> <ticket> <outcome> <reason...>
//   prints one `field/runs.jsonl` row for a Codex run, from its events file. Today's lead tooling,
//   the port of fieldrow.py (decision 0113); box.sh's `run` calls it after each step.
//
//   node fieldrow.ts --model gpt-6.1-sol out/events.jsonl t766-build 766 done built it
//
// The model and effort default to CODEX_MODEL and CODEX_EFFORT (env.sh). Codex reports the tokens
// billed over the run, not the size of its conversation at the last turn, so they go in `billed`
// and `tokens` stays null (field/README.md).
//
// Rules the row keeps from fieldrow.py, so a row made again from an old events file holds the same
// numbers:
//   - Only a `turn.completed` event whose usage holds whole numbers in all three counts is summed.
//     A line that is not JSON, another event, or a usage of another shape is read past.
//   - With no `--started` or `--ended`, the events file's birth and change times are the bounds;
//     with no events file either, both are now. Times print in the local zone, to the second.
//   - Minutes and dollars round half to even on the exact value, as Python's `round` does.
//   - `step`, `start`, `end` and `status` are written only with `--step`; a bound not given is
//     left out. `redacted` is the count in `<events>.redacted`, when redact.sh wrote one.

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Config,
  ConfigProvider,
  Console,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Record as R,
  Result,
  Schema,
} from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { rounded } from "./clauderow.ts";

class Refused extends Schema.TaggedError<Refused, { readonly brand: unique symbol }>()("Refused", {
  reason: Schema.String,
}) {}

/**
 * Dollars per million tokens (in, cached, out), standard tier, up to 272K input, from OpenAI's
 * pricing page (https://developers.openai.com/api/docs/pricing), read 2026-11-09. The same table
 * as `packages/pipeline/src/stages/price.ts`. A model not here gets no dollars, never another's.
 */
const LIST: Readonly<Record<string, readonly [number, number, number]>> = {
  "gpt-6.1-sol": [2, 0.1, 10],
  "gpt-6-astra": [10, 1, 50],
};

/** A completed turn's usage, the three counts fieldrow sums. Other keys are not read. */
const Turn = Schema.Struct({
  type: Schema.Literal("turn.completed"),
  usage: Schema.Struct({ input_tokens: Schema.Int, cached_input_tokens: Schema.Int, output_tokens: Schema.Int }),
});

const decodeTurn = Schema.decodeUnknownResult(Schema.fromJsonString(Turn));

const decodeCount = Schema.decodeUnknownResult(Schema.NumberFromString.check(Schema.isInt()));

interface Usage {
  readonly input: number;
  readonly cached: number;
  readonly output: number;
}

/** The usage summed over an events file's completed turns, or none when no turn said it. */
const summed = (text: string): Option.Option<Usage> => {
  let sum: Usage | undefined;

  for (const line of text.split(/\r\n?|\n/)) {
    const turn = decodeTurn(line);

    if (Result.isFailure(turn)) {
      continue;
    }

    const { cached_input_tokens: cached, input_tokens: input, output_tokens: output } = turn.success.usage;
    sum = {
      input: (sum?.input ?? 0) + input,
      cached: (sum?.cached ?? 0) + cached,
      output: (sum?.output ?? 0) + output,
    };
  }

  return Option.fromUndefinedOr(sum);
};

/** An instant as that zone's clock reads it, to the second: `2026-11-16T09:05:00-08:00`. */
const local = (zone: DateTime.TimeZone, at: DateTime.DateTime): string => {
  const zoned = DateTime.setZone(at, zone);

  return `${DateTime.formatIsoOffset(zoned).slice(0, 19)}${DateTime.zonedOffsetIso(zoned)}`;
};

/** A given bound, `2026-11-16T09:05:00-08:00`, printed back in its own offset. */
const given = (flag: string, text: string): Effect.Effect<DateTime.Zoned, Refused> =>
  Effect.fromOption(DateTime.makeZonedFromString(text), () =>
    Refused.make({ reason: `--${flag} is not a time with an offset: ${text}` }),
  );

const Text = Schema.NullOr(Schema.String);

const Count = Schema.NullOr(Schema.Finite);

/** One `field/runs.jsonl` row, in fieldrow.py's key order. Its `reason` is saved as `why`. */
const Row = Schema.Struct({
  date: Schema.String,
  run: Schema.String,
  ticket: Schema.String,
  pr: Schema.Null,
  started: Schema.String,
  ended: Schema.String,
  parent: Text,
  active: Schema.Null,
  role: Schema.Literal("hand"),
  model: Schema.String,
  effort: Schema.String,
  outcome: Schema.String,
  reason: Schema.String,
  tokens: Schema.Null,
  tools: Schema.Null,
  minutes: Schema.Finite,
  note: Schema.Null,
  costUsd: Schema.Null,
  listUsd: Count,
  billed: Count,
  inputTokens: Count,
  cachedTokens: Count,
  outputTokens: Count,
  step: Schema.optionalKey(Schema.String),
  start: Schema.optionalKey(Schema.String),
  end: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.Finite),
  redacted: Schema.optionalKey(Schema.Finite),
}).pipe(Schema.encodeKeys({ reason: "why" }));

const encodeRow = Schema.encodeSync(Schema.fromJsonString(Row));

/** What the caller says about the run; the events file says none of it. */
interface Ask {
  readonly events: string;
  readonly run: string;
  readonly ticket: string;
  readonly outcome: string;
  readonly reason: string;
  readonly parent: string | null;
  readonly model: string;
  readonly effort: string;
  readonly step: string | null;
  readonly started: string | null;
  readonly ended: string | null;
  readonly start: string | null;
  readonly end: string | null;
  readonly status: number | null;
}

/** The row of one Codex run, as one JSON line. */
const row = Effect.fn("fieldrow.row")(function* (ask: Ask) {
  const fs = yield* FileSystem.FileSystem;
  const zone = yield* DateTime.CurrentTimeZone;
  const now = yield* DateTime.now;
  const unreadable = (path: string) => Effect.mapError(() => Refused.make({ reason: `${path} could not be read` }));

  const read = Effect.fnUntraced(function* (path: string) {
    return (yield* fs.exists(path).pipe(unreadable(path)))
      ? Option.some(yield* fs.readFileString(path).pipe(unreadable(path)))
      : Option.none<string>();
  });

  const text = yield* read(ask.events);

  const info = Option.isSome(text)
    ? Option.some(yield* fs.stat(ask.events).pipe(unreadable(ask.events)))
    : Option.none();

  const birth = info.pipe(
    Option.flatMap((stat) => Option.orElse(stat.birthtime, () => stat.mtime)),
    Option.map(DateTime.fromDateUnsafe),
  );

  const changed = info.pipe(
    Option.flatMap((stat) => stat.mtime),
    Option.map(DateTime.fromDateUnsafe),
  );

  const bound = (flag: string, value: string | null, file: Option.Option<DateTime.Utc>) =>
    value === null
      ? Effect.succeed({ at: Option.getOrElse(file, () => now), zone })
      : Effect.map(given(flag, value), (at) => ({ at, zone: at.zone }));

  const begun = yield* bound("started", ask.started, birth);
  const ended = yield* bound("ended", ask.ended, changed);

  const usage = Option.getOrNull(Option.flatMap(text, (held) => summed(held)));
  const rate = Option.getOrUndefined(R.get(LIST, ask.model));

  const usd =
    rate === undefined || usage === null
      ? null
      : rounded(((usage.input - usage.cached) * rate[0] + usage.cached * rate[1] + usage.output * rate[2]) / 1e6, 4);

  const priced =
    rate === undefined
      ? ""
      : ` Dollars are ${ask.model}'s standard list price (packages/pipeline/src/stages/price.ts); runs use the standard tier.`;

  const receipt = `${ask.events}.redacted`;
  const redacted = yield* read(receipt);

  const count = Option.isSome(redacted)
    ? Option.some(
        yield* Effect.fromResult(decodeCount(redacted.value.trim())).pipe(
          Effect.mapError(() => Refused.make({ reason: `${receipt} holds no whole number` })),
        ),
      )
    : Option.none<number>();

  const started = local(begun.zone, begun.at);

  return encodeRow({
    date: started.slice(0, 10),
    run: ask.run,
    ticket: ask.ticket,
    pr: null,
    started,
    ended: local(ended.zone, ended.at),
    parent: ask.parent,
    active: null,
    role: "hand",
    model: ask.model,
    effort: ask.effort,
    outcome: ask.outcome,
    reason: `${ask.reason}${priced}`,
    tokens: null,
    tools: null,
    // Seconds first, then minutes, as fieldrow.py divided.
    minutes: rounded((DateTime.toEpochMillis(ended.at) - DateTime.toEpochMillis(begun.at)) / 1000 / 60, 1),
    note: null,
    costUsd: null,
    listUsd: usd,
    billed: usage === null ? null : usage.input + usage.output,
    inputTokens: usage === null ? null : usage.input,
    cachedTokens: usage === null ? null : usage.cached,
    outputTokens: usage === null ? null : usage.output,
    // box.sh's run gives the run's bounds too; drive gives only the step, which box.sh's order check reads.
    ...(ask.step === null
      ? {}
      : {
          step: ask.step,
          ...(ask.start === null ? {} : { start: ask.start }),
          ...(ask.end === null ? {} : { end: ask.end }),
          ...(ask.status === null ? {} : { status: ask.status }),
        }),
    ...Option.match(count, { onNone: () => ({}), onSome: (n) => ({ redacted: n }) }),
  });
});

const said = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withDescription(description), Flag.optional, Flag.map(Option.getOrNull));

/** A setting the flag names, else the environment's, else fieldrow.py's default. */
const setting = (name: string, env: string, fallback: string, description: string) =>
  Flag.String(name).pipe(
    Flag.withDescription(`${description}; defaults to ${env}, then ${fallback}`),
    Flag.optional,
    Flag.map((flag) =>
      Option.match(flag, {
        onSome: Effect.succeed,
        onNone: () => Config.String(env).pipe(Config.withDefault(fallback)),
      }),
    ),
  );

export const fieldrow = Command.make(
  "fieldrow",
  {
    parent: said("parent", "The run that started this one"),
    model: setting("model", "CODEX_MODEL", "gpt-6-astra", "The Codex model the run used"),
    effort: setting("effort", "CODEX_EFFORT", "medium", "The effort the run used"),
    step: said("step", "The pipeline step the run did; writes step, start, end and status"),
    started: said("started", "When the run started, with its offset; else the events file's birth"),
    ended: said("ended", "When the run ended, with its offset; else the events file's change time"),
    start: said("start", "The commit the run started from"),
    end: said("end", "The commit the run ended on"),
    status: Flag.Int("status").pipe(
      Flag.withDescription("The runner's exit status"),
      Flag.optional,
      Flag.map(Option.getOrNull),
    ),
    events: Argument.String("events"),
    run: Argument.String("run"),
    ticket: Argument.String("ticket"),
    outcome: Argument.String("outcome"),
    reason: Argument.String("reason").pipe(Argument.variadic({ min: 1 })),
  },
  ({ effort, model, reason, ...ask }) =>
    Effect.gen(function* () {
      const line = yield* row({ ...ask, model: yield* model, effort: yield* effort, reason: reason.join(" ") });

      return yield* Console.log(line);
    }).pipe(
      Effect.catchTag("ConfigError", (error) => Effect.fail(Refused.make({ reason: error.message }))),
      Effect.tapError((refused) => Console.error(`fieldrow: ${refused.reason}`)),
    ),
);

/** Runs the command with Python's distinction between missing and present empty environment values. */
export const run = (args: ReadonlyArray<string>, env?: Record<string, string>) =>
  Command.runWith(fieldrow, { version: "0.0.0" })(args).pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env, preserveEmptyStrings: true }))),
  );

if (import.meta.main) {
  NodeRuntime.runMain(
    run(process.argv.slice(2)).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, DateTime.layerCurrentZoneLocal))),
    { disableErrorReporting: true },
  );
}
