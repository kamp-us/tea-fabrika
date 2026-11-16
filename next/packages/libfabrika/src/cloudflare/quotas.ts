/**
 * The quota assembly of a brain's objects: the Project's accounts under its ledger, one name's
 * accounting port in its Process object, and the door's quota answer before an input is recorded.
 * The limits come from the start's checked settings snapshot alone.
 *
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Function from "effect/Function";
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

const projectBody = <E>(sql: Sql, brain: string, settings: Effect.Effect<{ readonly values: Values }, E>) =>
  Layer.effectContext(
    Effect.flatMap(settings, ({ values }) =>
      Layer.build(QuotasSql.layer(sql, { brain, limits: QuotaSettings.limits(values) })).pipe(
        Effect.mapError(() => new LedgerError({ reason: "storage" })),
      ),
    ),
  );

/**
 * Layer that provides `Quotas` and the ledger's `WritePolicy` over the Project's own store, with
 * the limits of the start's checked settings. Provide it beneath the Project's ledger layers, so
 * every append and transaction is admitted. A store that refuses the accounting tables fails the
 * build with the ledger's `storage` error, which carries no storage text.
 *
 * @stability unstable
 * @category layers
 */
export const project: {
  <E>(
    brain: string,
    settings: Effect.Effect<{ readonly values: Values }, E>,
  ): (sql: Sql) => ReturnType<typeof projectBody<E>>;
  <E>(
    sql: Sql,
    brain: string,
    settings: Effect.Effect<{ readonly values: Values }, E>,
  ): ReturnType<typeof projectBody<E>>;
} = Function.dual(3, projectBody);

/**
 * Creates one registered name's accounting port in its Process object's own store, with the
 * Process recovery allowance of the start's checked settings. Its tables and fault slot are
 * created here, before the name does any work.
 *
 * @stability unstable
 * @category constructors
 */
export const process: {
  (name: string, values: Values): (sql: Sql) => Effect.Effect<Accounting, QuotasError>;
  (sql: Sql, name: string, values: Values): Effect.Effect<Accounting, QuotasError>;
} = Function.dual(3, (sql: Sql, name: string, values: Values): Effect.Effect<Accounting, QuotasError> =>
  Effect.try({
    try: () => QuotasSql.accounting(sql, { name, limits: QuotaSettings.limits(values).recovery.process }),
    catch: (cause) => new QuotasError({ reason: new Storage({ cause }) }),
  }),
);

/**
 * Returns the line a delivered input's message is saved as in its name's inbox. The inbox append
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
 * Whether the program behind `process` would take this input's message and its step now, placed
 * after the `before` entries the door writes first, asked by the door before it saves anything of
 * the input. A name that is not live, or a message its inbox already took, is taken: the door's
 * own answer for it stands (0147).
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
  before: number,
) {
  const found = yield* Effect.option(processes.resolve(process));

  if (Option.isNone(found) || found.value.state._tag !== "live") {
    return true;
  }

  return yield* quotas
    .admits(found.value.name, input.id, yield* inboxLine(input, build), before)
    .pipe(Effect.mapError((cause) => new LedgerError({ reason: "storage", cause })));
});

/**
 * Runs a Process object's append to the Project's ledger as that process's own runtime write when
 * the stream is a process's own stream, so its step record settles the charge its message took
 * ahead. Any other stream is admitted by its owner, as every other write is.
 *
 * @stability unstable
 * @category combinators
 */
export const runtimeAppend: {
  <A, E, R>(
    life: Effect.Effect<unknown, unknown>,
    work: Effect.Effect<A, E, R>,
  ): (stream: string) => Effect.Effect<A, E, R>;
  <A, E, R>(
    stream: string,
    life: Effect.Effect<unknown, unknown>,
    work: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R>;
} = Function.dual(
  3,
  <A, E, R>(
    stream: string,
    life: Effect.Effect<unknown, unknown>,
    work: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const quotas = yield* Effect.serviceOption(Quotas);
      const known = Option.isSome(quotas) && Option.isSome(yield* Effect.option(life));
      return yield* Option.isSome(quotas) && known ? quotas.value.runtime(stream, work) : work;
    }),
);

/**
 * Runs Project work asked by a process's Process object as that process's program writing its own
 * entries, so every entry it commits is charged to the program: a hands task's request, its
 * pointer for the hands key and its later collect are, as a checked write is.
 *
 * @stability unstable
 * @category combinators
 */
export const own: {
  <A, E, R>(work: Effect.Effect<A, E, R>): (process: string) => Effect.Effect<A, E, R>;
  <A, E, R>(process: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
} = Function.dual(2, <A, E, R>(process: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.serviceOption(Quotas), (quotas) =>
    Option.isSome(quotas) ? quotas.value.own(process, work) : work,
  ),
);

/**
 * Runs a process's own checked write, asked of the Project by its Process object, as that
 * process's program writing its own entries, so the write is charged to the program. A write over
 * the program's quota answers the `quota` refusal, as a single append's does.
 *
 * @stability unstable
 * @category combinators
 */
export const ownWrite: {
  <E, R>(work: Effect.Effect<Appended, E, R>): (process: string) => Effect.Effect<Appended, E, R>;
  <E, R>(process: string, work: Effect.Effect<Appended, E, R>): Effect.Effect<Appended, E, R>;
} = Function.dual(2, <E, R>(process: string, work: Effect.Effect<Appended, E, R>): Effect.Effect<Appended, E, R> =>
  own(process, work).pipe(
    Effect.catchIf(
      (error) => error instanceof LedgerError && error.cause instanceof QuotaRefused,
      () => Effect.succeed(Appended.cases.refused.make({ reason: "quota" })),
    ),
  ),
);
