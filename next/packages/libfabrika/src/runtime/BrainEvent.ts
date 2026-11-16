/**
 * The events of a local brain's life, as the driver that runs the brain on a laptop records them.
 */
import { Schema } from "effect";

const Life = {
  id: Schema.NonEmptyString,
  start: Schema.NonEmptyString,
  at: Schema.Finite,
};

const Reason = Schema.Literals(["open", "crash", "memory", "core"]);

const Exit = {
  exitCode: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  signal: Schema.optionalKey(Schema.NullOr(Schema.String)),
  bytes: Schema.optionalKey(Schema.Int),
  backoff: Schema.optionalKey(Schema.Finite),
};

/**
 * Schema for one event in a local brain's life: `started`, `replacing`, `killed`, `exited`,
 * `restarting`, `braked` or `stopped`.
 *
 * **Details**
 *
 * Every case carries its own `id`, the `start` it belongs to, and `at`, the driver's clock when it
 * happened. A `started` also names the start it came `after`, its build and its OS `pid`. The exit
 * fields (`exitCode`, `signal`, `bytes`, `backoff`) are there when the driver knows them. A
 * `replacing` is written when the memory sampler saw `pid` hold `bytes`, at or over `limit`, just
 * before its SIGTERM, and names the `grace` it waits before a SIGKILL. A `killed` is written when
 * that grace ran out, just before the SIGKILL. The
 * project appends each event to the `gateway/brain` stream under its `id`.
 *
 * @category schemas
 */
export const BrainEvent = Schema.TaggedUnion({
  started: {
    ...Life,
    after: Schema.NullOr(Schema.String),
    build: Schema.String,
    reason: Reason,
    pid: Schema.Int,
    ...Exit,
  },
  replacing: {
    ...Life,
    reason: Schema.Literal("memory"),
    pid: Schema.Int,
    bytes: Schema.Int,
    limit: Schema.Int,
    grace: Schema.Finite,
  },
  killed: { ...Life, pid: Schema.Int },
  exited: { ...Life, reason: Reason, ...Exit },
  restarting: { ...Life, reason: Reason, ...Exit, backoff: Schema.Finite },
  braked: { ...Life, reason: Schema.Literals(["intensity", "restart_failed"]), ...Exit },
  stopped: { ...Life, reason: Schema.Literal("stop"), ...Exit },
});
