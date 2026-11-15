/**
 * The quota settings as a Worker reads them from a settings snapshot.
 *
 * @stability unstable
 */
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type { Allowance, Limits } from "../processes/Quotas.ts";
import * as Declarations from "../settings/Declarations.ts";
import * as Snapshot from "../settings/Snapshot.ts";

type Declared = {
  readonly writes: (typeof Declarations.writes.schema)["Type"];
  readonly storage: (typeof Declarations.storage.schema)["Type"];
  readonly recovery: (typeof Declarations.recovery.schema)["Type"];
};

// `INSTANCE` holds the start's whole input; the quota settings are in its settings snapshot.
const Instance = Schema.fromJsonString(Schema.Struct({ settings: Schema.Unknown }));

const allowance = (declared: Declared["recovery"]["project"]): Allowance => ({
  writes: declared.writes,
  bytes: ByteSize.toNumberUnsafe(declared.bytes),
  letter: { writes: declared.letter.writes, bytes: ByteSize.toNumberUnsafe(declared.letter.bytes) },
});

const refused = (cause: unknown) =>
  new Snapshot.SnapshotError({ message: "The quota settings are invalid.", cause: Redacted.make(cause) });

/**
 * Reads the quota limits from a settings snapshot: the program's writes and storage, and the
 * recovery allowances. The whole snapshot is checked against the declared settings and its hash
 * first.
 *
 * @stability unstable
 * @category constructors
 */
export const read = Effect.fn("quota_settings.read")(function* (input: unknown) {
  const checked = yield* Snapshot.read(Declarations.all, input);
  const { writes, storage, recovery } = checked.values;
  return { writes, storage, recovery };
});

/**
 * Returns checked quota settings as the limits accounting counts in: plain writes and bytes.
 *
 * @stability unstable
 * @category constructors
 */
export const limits = (declared: Declared): Limits => ({
  writes: declared.writes,
  storage: ByteSize.toNumberUnsafe(declared.storage),
  recovery: { project: allowance(declared.recovery.project), process: allowance(declared.recovery.process) },
});

/**
 * Reads the limits from a Worker's `INSTANCE` text, for an object that is handed no settings of
 * its own. Nothing is filled in: a missing or invalid snapshot fails with `SnapshotError`.
 *
 * @stability unstable
 * @category constructors
 */
export const instance = Effect.fn("quota_settings.instance")(function* (text: unknown) {
  const config = yield* Schema.decodeUnknownEffect(Instance)(text).pipe(Effect.mapError(refused));
  return limits(yield* read(config.settings));
});
