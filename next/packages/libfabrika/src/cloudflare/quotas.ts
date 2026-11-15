/**
 * The quota assembly of a brain's objects: the Project's accounts under its ledger, one name's
 * accounting port in its Process object, and the door's quota answer before an input is recorded.
 * The limits come from the start's checked settings snapshot alone.
 *
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { LedgerError } from "../ledger/Ledger.ts";
import { Appended, lineFor } from "../ledger/Log.ts";
import { QuotaRefused } from "../ledger/WritePolicy.ts";
import type { ProcessManager } from "../processes/ProcessManager.ts";
import { Quotas, QuotasError, Storage, type Accounting } from "../processes/Quotas.ts";
import * as QuotasSql from "../processes/QuotasSql.ts";
import type { Incoming } from "../runtime/Entry.ts";
import type { Sql } from "../Sql.ts";
import * as QuotaSettings from "./QuotaSettings.ts";

type Values = Parameters<typeof QuotaSettings.limits>[0];

const Send = Schema.TaggedStruct("send", { m: Schema.Json });

/**
 * Layer that provides `Quotas` and the ledger's `WritePolicy` over the Project's own store, with
 * the limits of the start's checked settings. Provide it beneath the Project's ledger layers, so
 * every append and transaction is admitted.
 *
 * @stability unstable
 * @category layers
 */
export const project = <E>(sql: Sql, brain: string, settings: Effect.Effect<{ readonly values: Values }, E>) =>
  Layer.unwrap(
    Effect.map(settings, ({ values }) => QuotasSql.layer(sql, { brain, limits: QuotaSettings.limits(values) })),
  );

/**
 * Creates one registered name's accounting port in its Process object's own store, with the
 * Process recovery allowance of the start's checked settings. Its tables and fault slot are
 * created here, before the name does any work.
 *
 * @stability unstable
 * @category constructors
 */
export const process = (sql: Sql, name: string, values: Values): Effect.Effect<Accounting, QuotasError> =>
  Effect.try({
    try: () => QuotasSql.accounting(sql, { name, limits: QuotaSettings.limits(values).recovery.process }),
    catch: (cause) => new QuotasError({ reason: new Storage({ cause }) }),
  });

/**
 * Returns the line a delivered input's letter is saved as in its name's inbox. The inbox append
 * and the door's quota trial both build it here, so the trial charges what would land.
 *
 * @stability unstable
 * @category constructors
 */
export const inboxLine = Effect.fnUntraced(function* (input: Incoming, build: string) {
  const m = yield* Schema.decodeUnknownEffect(Schema.Json)(input.envelope.input).pipe(
    Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
  );
  return lineFor(
    {
      by: input.envelope.by.key,
      for: input.envelope.by.for,
      sentAt: input.sentAt,
      seen: input.seen,
      parent: input.envelope.id,
      traceId: input.span.traceId,
      build,
    },
    Send.make({ m }),
  );
});

/**
 * Whether the program behind `process` would take this input's letter and its step now, asked by
 * the door before it saves anything of the input. A name that is not live, or a letter its inbox
 * already took, is taken: the door's own answer for it stands (0147).
 *
 * @stability unstable
 * @category getters
 */
export const admitsInput = Effect.fnUntraced(function* (
  quotas: Quotas["Service"],
  processes: ProcessManager["Service"],
  process: string,
  input: Incoming,
  build: string,
) {
  const found = yield* Effect.option(processes.resolve(process));

  if (Option.isNone(found) || found.value.state._tag !== "live") {
    return true;
  }

  return yield* quotas
    .admits(found.value.name, input.id, yield* inboxLine(input, build))
    .pipe(Effect.mapError((cause) => new LedgerError({ reason: "storage", cause })));
});

/**
 * Runs a Process object's append to the Project's ledger as that process's own runtime write when
 * the stream is a process's own stream, so its step record settles the charge its letter took
 * ahead. Any other stream is admitted by its owner, as every other write is.
 *
 * @stability unstable
 * @category combinators
 */
export const runtimeAppend = <A, E, R>(
  stream: string,
  life: Effect.Effect<unknown, unknown>,
  work: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const quotas = yield* Effect.serviceOption(Quotas);
    const known = Option.isSome(quotas) && Option.isSome(yield* Effect.option(life));
    return yield* Option.isSome(quotas) && known ? quotas.value.runtime(stream, work) : work;
  });

/**
 * Runs a process's own checked write, asked of the Project by its Process object, as that
 * process's program writing its own entries, so the write is charged to the program. A write over
 * the program's quota answers the `quota` refusal, as a single append's does.
 *
 * @stability unstable
 * @category combinators
 */
export const ownWrite = <E, R>(process: string, work: Effect.Effect<Appended, E, R>): Effect.Effect<Appended, E, R> =>
  Effect.flatMap(Effect.serviceOption(Quotas), (quotas) =>
    Option.isSome(quotas) ? quotas.value.own(process, work) : work,
  ).pipe(
    Effect.catchIf(
      (error) => error instanceof LedgerError && error.cause instanceof QuotaRefused,
      () => Effect.succeed(Appended.cases.refused.make({ reason: "quota" })),
    ),
  );
