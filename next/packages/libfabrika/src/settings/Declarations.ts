/**
 * The settings fabrika itself declares: `instance.port`, `fabrika-version`, `gateway.limit`, `gateway.window`, the
 * four local brain settings under `desktop.brain-*`, `desktop.link-ttl`, the two mail settings `mail.unread` and
 * `mail.chunk`, `hands.target`, the three quota settings `limits.writes`, `limits.storage` and
 * `limits.recovery`, and `all`, the group of the fifteen.
 *
 * **Details**
 *
 * A schema's title and description are the words a refused value is explained with. Every setting here is `since` release 0.0.0 and reloads on restart. See docs/direction/settings.md, "Is this a setting?", for how a choice becomes one.
 *
 * @stability unstable
 */
import { ByteSize, Schema } from "effect";
import * as Setting from "./Setting.ts";

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })).annotate({
  title: "a port",
  description: "A port is a whole number from 1 to 65535.",
});

// The u flag lets Effect write the pattern into the generated JSON Schema.
const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/u)).annotate({
  title: "a version",
  description: "A version is three whole numbers, as 1.2.3.",
});

/**
 * Setting for the port the local instance listens on.
 *
 * **Details**
 *
 * The value is a whole number from 1 to 65535. The default is 18787. It is set in a person's file only.
 *
 * @stability unstable
 * @category settings
 */
export const port = Setting.make("instance.port", {
  schema: Port,
  default: 18787,
  doc: "The port the local instance listens on.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the oldest fabrika release a repo works with.
 *
 * **Details**
 *
 * The value is three whole numbers, as `1.2.3`. It is set in the repo's file only, and it is read before every other setting. The default is 0.0.0, the first release that reads settings, and a later release never raises it by itself.
 *
 * @stability unstable
 * @category settings
 */
export const version = Setting.make("fabrika-version", {
  schema: Version,
  default: "0.0.0",
  doc: "The oldest fabrika this repo works with. It is read before every other setting.",
  scope: ["repo"],
  reload: "restart",
  since: "0.0.0",
});

const Positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));

/**
 * Setting for the most attempts one checked sender may route in a gateway window.
 *
 * @stability unstable
 * @category settings
 */
export const gatewayLimit = Setting.make("gateway.limit", {
  schema: Positive,
  default: 600,
  doc: "The most routed attempts one signed-in key may make in one gateway window.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the gateway budget's window in milliseconds.
 *
 * @stability unstable
 * @category settings
 */
export const gatewayWindow = Setting.make("gateway.window", {
  schema: Positive,
  default: 60_000,
  doc: "The gateway window in milliseconds.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for a one-time browser link's lifetime in whole milliseconds.
 *
 * @stability unstable
 * @category settings
 */
export const desktopLinkTtl = Setting.make("desktop.link-ttl", {
  schema: Positive,
  default: 60_000,
  doc: "How long a one-time browser link lives in milliseconds.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the delay in whole seconds that the service manager waits between crash restarts
 * of the local brain.
 *
 * @stability unstable
 * @category settings
 */
export const brainThrottle = Setting.make("desktop.brain-throttle", {
  schema: Positive,
  default: 2,
  doc: "The delay in whole seconds between crash restarts of the local brain.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the interval in milliseconds between two readiness or shutdown checks of the local
 * brain. A native command that is interrupted gets the same interval to exit before it is killed.
 *
 * @stability unstable
 * @category settings
 */
export const brainPoll = Setting.make("desktop.brain-poll", {
  schema: Positive,
  default: 100,
  doc: "The interval in milliseconds between brain readiness and shutdown checks.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the most milliseconds one attempt to start or reuse the local brain may take
 * before it fails.
 *
 * @stability unstable
 * @category settings
 */
export const brainStartTimeout = Setting.make("desktop.brain-start-timeout", {
  schema: Positive,
  default: 60000,
  doc: "The maximum time in milliseconds to start or reuse a ready local brain.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the most milliseconds one stop may take to confirm that the local brain and what
 * it owns are gone, before it fails.
 *
 * @stability unstable
 * @category settings
 */
export const brainStopTimeout = Setting.make("desktop.brain-stop-timeout", {
  schema: Positive,
  default: 5000,
  doc: "The maximum time in milliseconds to confirm the local brain and its children have stopped.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

const KIB = 1_024;
const MIB = 1_024 * KIB;

const Unread = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16_384 })).annotate({
  title: "a letter count",
  description: "A letter count is a whole number from 1 to 16384.",
});

const ChunkBytes = Schema.ByteSize.check(
  Schema.isBetweenBigInt({ minimum: BigInt(KIB), maximum: BigInt(MIB) }),
).annotate({
  title: "a chunk size",
  description: "A chunk size is a byte size from 1 KiB to 1 MiB, as 64 KiB.",
});

/**
 * Setting for the most unread letters one inbox holds.
 *
 * **Details**
 *
 * A send to an inbox at its cap answers `full`, and nothing is saved. The value is a whole number
 * from 1 to 16,384, the largest count experiment 295 measured, and the default is 256, which
 * experiment 295 picked: 256 letters of the default chunk size are 16 MiB, what one catch-up may
 * hold at once. It is set in the repo's file only.
 *
 * @stability unstable
 * @category settings
 */
export const mailUnread = Setting.make("mail.unread", {
  schema: Unread,
  default: 256,
  doc: "The most unread letters one inbox holds. A send past it answers full, and nothing is saved.",
  scope: ["repo"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the most bytes in one letter of a chunked send.
 *
 * **Details**
 *
 * The value is a byte size from 1 KiB to 1 MiB, written as text, as `64 KiB`. 1 MiB is about half
 * the ledger's row cap, and 1 KiB leaves room for a chunk's own fields. The default is 64 KiB,
 * which experiment 295 picked. It is set in the repo's file only.
 *
 * @stability unstable
 * @category settings
 */
export const mailChunk = Setting.make("mail.chunk", {
  schema: ChunkBytes,
  format: "text",
  default: ByteSize.bytes(64 * KIB),
  doc: "The most bytes in one letter of a chunked send.",
  scope: ["repo"],
  reload: "restart",
  since: "0.0.0",
});

// The u flag lets Effect write the pattern into the generated JSON Schema.
const Fingerprint = Schema.String.check(Schema.isPattern(/^SHA256:[A-Za-z0-9+/]{43}$/u)).annotate({
  title: "a key fingerprint",
  description: "A key fingerprint is SHA256: and 43 base64 characters, as ssh-keygen -l prints it.",
});

/**
 * Setting for the hands key a program's hands command targets: the fingerprint of the hands that
 * run its jobs.
 *
 * **Details**
 *
 * The default is none: a program's hands command is then refused with `no_hands`, and no job is
 * made. TOML has no null, so a person sets it by writing the key and unsets it by leaving it out.
 *
 * @stability unstable
 * @category settings
 */
export const handsTarget = Setting.make("hands.target", {
  schema: Schema.NullOr(Fingerprint),
  default: null,
  doc: "The fingerprint of the hands key that runs a program's hands commands. Unset, they are refused.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

const Bytes = Schema.ByteSizeFromString.check(
  Schema.makeFilter((n) => ByteSize.toBigInt(n) > 0n, {
    expected: "a positive byte size",
  }),
);

const RecoveryAllowance = Schema.Struct({
  writes: Positive,
  bytes: Bytes,
  letter: Schema.Struct({ writes: Positive, bytes: Bytes }),
});

/**
 * Setting for the most ledger writes one program may commit per rolling minute.
 *
 * @stability unstable
 * @category settings
 */
export const writes = Setting.make("limits.writes", {
  schema: Positive.check(Schema.isLessThanOrEqualTo(13_760)),
  default: 13_760,
  doc: "The most ledger writes one program may commit per rolling minute, including admitted steps.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the most encoded ledger bytes one program may keep.
 *
 * @stability unstable
 * @category settings
 */
export const storage = Setting.make("limits.storage", {
  schema: Bytes.check(
    Schema.makeFilter((n) => ByteSize.toBigInt(n) <= 1_000_000_000n, {
      expected: "at most 1000000000 B",
    }),
  ),
  default: ByteSize.bytes(1_000_000_000),
  doc: "The most encoded ledger bytes one program may keep, at most decimal one GB.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Setting for the recovery allowance of each storage location: its writes and bytes per rolling
 * minute, and the room one replayed letter may take.
 *
 * @stability unstable
 * @category settings
 */
export const recovery = Setting.make("limits.recovery", {
  schema: Schema.Struct({ project: RecoveryAllowance, process: RecoveryAllowance }),
  default: {
    project: { writes: 160, bytes: ByteSize.bytes(74_080), letter: { writes: 10, bytes: ByteSize.bytes(5_469) } },
    process: { writes: 290, bytes: ByteSize.bytes(207_410), letter: { writes: 50, bytes: ByteSize.bytes(18_790) } },
  },
  doc: "Recovery writes and bytes per rolling minute, plus each accepted letter's replay room.",
  scope: ["person"],
  reload: "restart",
  since: "0.0.0",
});

/**
 * Group of every setting fabrika declares, ready to load, validate and print.
 *
 * **Details**
 *
 * Holds `port`, `version`, `gatewayLimit`, `gatewayWindow`, the four local brain settings
 * (`brainThrottle`, `brainPoll`, `brainStartTimeout` and `brainStopTimeout`), `desktopLinkTtl`,
 * the two mail settings, `mailUnread` and `mailChunk`, `handsTarget`, and the three quota
 * settings, `writes`, `storage` and `recovery`.
 * Making the group checked their paths, environment names and defaults together.
 *
 * @stability unstable
 * @category settings
 */
export const all = Setting.group({
  port,
  version,
  gatewayLimit,
  gatewayWindow,
  brainThrottle,
  brainPoll,
  brainStartTimeout,
  brainStopTimeout,
  desktopLinkTtl,
  mailUnread,
  mailChunk,
  handsTarget,
  writes,
  storage,
  recovery,
});
