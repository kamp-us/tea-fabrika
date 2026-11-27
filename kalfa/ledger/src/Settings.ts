/**
 * The settings of the Ledger: the size of the largest entry it keeps.
 *
 * **Details**
 *
 * The package imports no settings engine, so it gives the schema and the default, and the app that puts the Ledger together reads the value through its own
 * settings and hands it to a provider's layer.
 */
import { Schema } from "effect";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/**
 * Schema for the Ledger's settings. `limits.bytes` is the most bytes one entry counts: its stream, id, type, body and metadata, as UTF-8 text.
 *
 * @category models
 */
export const Settings = Schema.Struct({ limits: Schema.Struct({ bytes: Count }) });

export type Settings = typeof Settings.Type;

/**
 * The settings when nothing says otherwise: the row limit of a Cloudflare object, 2,000,000 bytes.
 *
 * @category constants
 */
export const defaults: Settings = { limits: { bytes: 2_000_000 } };
