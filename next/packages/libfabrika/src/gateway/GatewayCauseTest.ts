// T695, next/. The door's storage and its SYN-cookie keys keep the failure they translate (decision
// 0043 rule 12). A suite on any `Sql`, read through its module as `GatewayCauseTest.suite(law, harness)`;
// the module that owns the driver runs it (0062).
//
// Ticket 921 slice 1: both files fail with `GatewayError`, the error of the service they serve
// (0055), and its tagged reason keeps the fault from below (0119). This is the plan's law 8 for the
// two files: every plant below builds the error without its `cause`. The laws read the error by
// its `_tag`, so the harness hands in no error class.
//
// Audit sites: `GatewayStore.ts:27` (a throw in the atomic step), `GatewayStore.ts:40` (a saved
// state row that does not decode), `GatewayNonce.ts:26` (a saved key that does not decode, and one
// of the wrong length, which has no cause), `GatewayNonce.ts:29` (the one WebCrypto callback that
// importKey, sign and verify share).
//
// Ticket 1067 slice 2, H5: the door hands `checkHello` its admission as the transport's
// `Admissions` service, whose one error is `AdmissionError`. A failure inside the door's admission
// reaches `initialize`'s caller as that `AdmissionError`, with the door's own error as its cause.
import { describe, expect } from "@effect/vitest";
import { Effect, Layer, Predicate, Result, Schema } from "effect";
import * as Arr from "effect/Array";
import { Base64, Base64Url } from "effect/encoding";
import * as Formatter from "effect/Formatter";
import * as Option from "effect/Option";
import * as RateLimiter from "effect/persistence/RateLimiter";
import * as fc from "fast-check";
import * as ClientManagerLedger from "../access/ClientManagerLedger.ts";
import * as Id from "../Id.ts";
import { ProcessIdGenerator } from "../processes/ProcessIdGenerator.ts";
import { MailWakeups } from "../runtime/MailWakeups.ts";
import type { Sql } from "../Sql.ts";
import { Tasks } from "../tasks/Tasks.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { helloText } from "../transport/Hello.ts";
import { KeyLine, writeSshsig } from "../transport/Sshsig.ts";
import { Gateway } from "./Gateway.ts";
import { gatewayNonce } from "./GatewayNonce.ts";
import { gatewayStore } from "./GatewayStore.ts";
import * as RateLimiterSql from "./RateLimiterSql.ts";

/** A failure as a platform gives one: an Error, a subclass with its own cause, or a plain object. */
const failures: fc.Arbitrary<object> = fc.oneof(
  fc.string().map((message) => new Error(message)),
  fc.string().map((message) => new TypeError(message, { cause: { detail: message } })),
  fc.record({ code: fc.string(), detail: fc.jsonValue() }, { noNullPrototype: true }),
);

/** Every service the door's layer needs, read from its own type. */
type Needs = Layer.Services<ReturnType<typeof Gateway.layer<Schema.Json, never, never, never>>>;

/**
 * What the module that owns the driver gives: fresh storage, and the ledger's layers over it. The
 * door's module never imports `ledger/` (0043 rule 11), so the ledger's part of the door comes in
 * here: every service the door needs that this suite does not build itself.
 */
export type Harness = {
  /** A fresh, empty database. */
  readonly fresh: () => Sql;
  /** The ledger's layers over `sql`. */
  readonly ledger: (sql: Sql) => Layer.Layer<Exclude<Needs, Layer.Success<ReturnType<typeof own>>>>;
};

/** Runs one property: generated input, each case an Effect on the real code. The runner gives it. */
export type Law = <T>(name: string, input: fc.Arbitrary<T>, check: (input: T) => Effect.Effect<void, unknown>) => void;

/** The same `Sql`, but each transaction throws `failure`, as SQLite does on a full disk. */
const throwing = (sql: Sql, failure: object): Sql => ({
  ...sql,
  transaction: () => {
    throw failure;
  },
});

/** The same `Sql`, but once `armed.on` is set, each transaction throws `failure`. */
const throwingWhenArmed = (sql: Sql, armed: { readonly on: boolean }, failure: object): Sql => ({
  ...sql,
  transaction: (step) => {
    if (armed.on) {
      throw failure;
    }

    return sql.transaction(step);
  },
});

/**
 * What an error keeps beneath it: the cause under its tagged reason (0119), or its own. A cause that
 * is no object is nothing beneath, as neither caller reads one.
 */
const beneath = (error: object | undefined): object | undefined => {
  const cause =
    Predicate.hasProperty(error, "reason") && Predicate.hasProperty(error.reason, "cause")
      ? error.reason.cause
      : Predicate.hasProperty(error, "cause")
        ? error.cause
        : undefined;

  return Predicate.isObjectOrArray(cause) ? cause : undefined;
};

/** An error and every cause under it, outermost first. */
const chain = (error: object): ReadonlyArray<object> => {
  const found: Array<object> = [];
  let at: unknown = error;

  while (Predicate.isObjectOrArray(at) && !found.includes(at)) {
    found.push(at);
    at = beneath(at);
  }

  return found;
};

/** Whether `link` is the door's own error for a saved row that does not decode. */
const isBadRow = (link: object): boolean =>
  Predicate.hasProperty(link, "_tag") &&
  link._tag === "GatewayError" &&
  Predicate.hasProperty(link, "reason") &&
  Predicate.hasProperty(link.reason, "_tag") &&
  link.reason._tag === "BadRow";

/** One WebCrypto call rejects with `failure` while `work` runs: an own property shadows the method. */
const rejecting = <A, E>(method: "importKey" | "sign" | "verify", failure: object, work: Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      Object.defineProperty(crypto.subtle, method, {
        configurable: true,
        // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto answers with a Promise
        value: () => Promise.reject(failure),
      });
    }),
    () => work,
    () =>
      Effect.sync(() => {
        Reflect.deleteProperty(crypto.subtle, method);
      }),
  );

const TTL = 60_000;

const CAP = 100;

// A shared suite is not a `*.test.ts` file, so its own failures are tagged like product code's.
class KeyFailed extends Schema.TaggedError<KeyFailed, { readonly brand: unique symbol }>()("KeyFailed", {
  cause: Schema.Defect(),
}) {}

const keyFailed = (cause: unknown) => new KeyFailed({ cause });

/** RFC 4251's `string`: a u32 length, then the bytes. */
const sshString = (bytes: Uint8Array) => {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);

  return out;
};

const hashed = Effect.fnUntraced(function* (bytes: Uint8Array) {
  const value = new Uint8Array(bytes);
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes a generated public key
  const hash = yield* Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", value), catch: keyFailed });

  return `SHA256:${Base64.encode(new Uint8Array(hash)).replace(/=+$/, "")}`;
});

/** A fresh Ed25519 client key: its raw base64url form, its line, both fingerprints, and its signer. */
const clientKey = Effect.fnUntraced(function* () {
  const s = crypto.subtle;
  const uses = ["sign", "verify"] as const;
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto generates the law's key
  const pair = yield* Effect.tryPromise({ try: () => s.generateKey("Ed25519", false, uses), catch: keyFailed });
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto exports the generated public key
  const exported = yield* Effect.tryPromise({ try: () => s.exportKey("raw", pair.publicKey), catch: keyFailed });
  const raw = new Uint8Array(exported);
  const name = sshString(new TextEncoder().encode("ssh-ed25519"));
  const blob = new Uint8Array([...name, ...sshString(raw)]);
  const line = yield* Schema.decodeUnknownEffect(KeyLine)(`ssh-ed25519 ${Base64.encode(blob)}`);

  const sign = (bytes: Uint8Array) =>
    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto signs with the generated test key
    Effect.tryPromise({ try: () => s.sign("Ed25519", pair.privateKey, new Uint8Array(bytes)), catch: keyFailed }).pipe(
      Effect.map((signature) => new Uint8Array(signature)),
    );

  return {
    raw: Base64Url.encode(raw),
    line,
    fingerprint: yield* hashed(raw),
    by: yield* hashed(blob),
    hello: (url: string, tab: string, nonce: string) =>
      writeSshsig({ text: helloText({ url, tab, nonce }), space: "fabrika-client", line, sign }),
  };
});

const DOOR = "https://fabrika.test/h5";

const PROCESS = "process_01m6v5270hetdrt4r8h9vvjwjs";

type Owner = Parameters<typeof ClientManagerLedger.layer>[0];

/** The door's layers this suite builds itself, over `sql`; the membership reads the ledger. */
const own = (sql: Sql, owner: Owner) =>
  Layer.mergeAll(
    ClientManagerLedger.layer(owner),
    SpanSink.layer(sql, { object: PROCESS }),
    RecordManager.memory(4 * 1024 * 1024),
    Archive.memory,
    Layer.mock(MailWakeups, {}),
    Layer.mock(Tasks, {}),
    ProcessIdGenerator.layer,
    Id.Generator.layer,
    RateLimiter.layer.pipe(
      Layer.provide(RateLimiterSql.layer(sql, { build: "h5", policy: { limit: 100_000, window: 60_000 } })),
    ),
  );

/**
 * The real door over `sql`, its ledger from the harness. `door` is the `Sql` the gateway's own store
 * runs on; the ledger and the rest read `sql` itself.
 */
const doorOver = (harness: Harness, sql: Sql, door: Sql, founder: Effect.Success<ReturnType<typeof clientKey>>) => {
  const owner: Owner = {
    name: "h5",
    person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
    keys: [founder.line],
    window: null,
    by: founder.by,
    build: "h5",
  };

  const ledger = harness.ledger(sql);

  return Gateway.layer<Schema.Json, never, never, never>({
    sql: door,
    founder: owner,
    name: "h5",
    url: DOOR,
    origins: ["https://fabrika.test"],
    versions: [1],
    location: "test",
    build: "h5",
    waiting: { most: 20, ttl: 600_000 },
    rateLimit: { limit: 100_000, window: 60_000 },
    ping: { min: 10_000, max: 60_000 },
    inputCap: 1000,
    spentCap: 1000,
    nextProcess: () => Effect.succeed(PROCESS),
    deliver: () => Effect.void,
    notify: () => Effect.void,
    inputs: { schema: Schema.Json, personOnly: [], raw: [] },
    events: { personOnly: [] },
  }).pipe(Layer.provide(own(sql, owner).pipe(Layer.provideMerge(ledger))));
};

export const suite = (law: Law, harness: Harness) => {
  const { fresh } = harness;
  describe("T695, the door's store keeps what failed", () => {
    // C1, GatewayStore.ts:27. Plant: build the `Storage` reason without the caught value.
    law(
      "C1: a generated throw in the atomic step is the door's own `Storage` with that value as its cause",
      fc.record({ failure: failures, name: fc.string() }),
      ({ failure, name }) =>
        Effect.gen(function* () {
          const store = gatewayStore(throwing(fresh(), failure));
          const error = yield* Effect.flip(store.atomic(() => store.get(name, Schema.String)));
          expect(error._tag).toBe("GatewayError");
          expect(error.reason._tag).toBe("Storage");
          expect(error.reason.cause).toBe(failure);
        }),
    );

    // C2 and C3, GatewayStore.ts:40 inside :27. Plant: replace the inner cause with its message.
    law(
      "C2: a damaged saved row keeps the chain down to the decoder's SchemaError",
      fc.record({ name: fc.string(), value: fc.string(), bad: fc.oneof(fc.integer(), fc.boolean()) }),
      ({ name, value, bad }) =>
        Effect.gen(function* () {
          const store = gatewayStore(fresh());
          yield* store.atomic(() => store.set(name, Schema.String, value));
          store.sql.exec("UPDATE gateway_state SET value=? WHERE name=?", Formatter.formatJson(bad), name);
          const error = yield* Effect.flip(store.atomic(() => store.get(name, Schema.String)));
          expect(error._tag).toBe("GatewayError");
          const row = Option.getOrUndefined(Arr.findFirst(chain(error), isBadRow));
          expect(row, "a `BadRow` GatewayError is in the chain").toBeDefined();
          expect(Schema.isSchemaError(beneath(row)), "it holds the decoder's own failure").toBe(true);
        }),
    );
  });

  describe("T695, the door's SYN-cookie key keeps what failed", () => {
    // C3, GatewayNonce.ts:26. Plant: drop the decode failure from the `storage` error.
    law(
      "C3: a saved key that is not base64url is the door's own `Storage` carrying the decoder's failure",
      fc.record({ secret: fc.string().map((s) => `${s}!`) }),
      ({ secret }) =>
        Effect.gen(function* () {
          const store = gatewayStore(fresh());
          yield* store.atomic(() => store.set("challengeKey", Schema.String, secret));
          const error = yield* Effect.flip(gatewayNonce(store, TTL, CAP));
          expect(error._tag).toBe("GatewayError");
          expect(error.reason._tag).toBe("Storage");
          const decoded = Base64Url.decode(secret);
          expect(Result.isFailure(decoded)).toBe(true);
          expect(error.reason.cause).toEqual(Result.isFailure(decoded) ? decoded.failure : null);
        }),
    );

    // C6, GatewayNonce.ts:26. Plant: put a made-up cause on the reason.
    law(
      "C6: a saved key that decodes to the wrong length is the door's own `Storage` with no cause",
      fc.record({ size: fc.integer({ min: 0, max: 64 }).filter((n) => n !== 32), seed: fc.integer() }),
      ({ size, seed }) =>
        Effect.gen(function* () {
          const store = gatewayStore(fresh());
          const key = Base64Url.encode(Uint8Array.from({ length: size }, (_, i) => (seed + i) & 255));
          yield* store.atomic(() => store.set("challengeKey", Schema.String, key));
          const error = yield* Effect.flip(gatewayNonce(store, TTL, CAP));
          expect(error._tag).toBe("GatewayError");
          expect(error.reason._tag).toBe("Storage");
          expect(error.reason.cause).toBeUndefined();
        }),
    );

    // C5, GatewayNonce.ts:29: one shared callback for importKey, sign and verify. Plant: make it
    // zero-argument, so the `Crypto` reason is built without the rejection.
    law(
      "C5: a generated WebCrypto rejection on any call the nonce makes is the door's own `Crypto` with that cause",
      fc.record({
        steps: fc.array(fc.record({ call: fc.constantFrom("importKey", "sign", "verify"), failure: failures }), {
          minLength: 1,
          maxLength: 4,
        }),
        client: fc.string(),
      }),
      ({ steps, client }) =>
        Effect.gen(function* () {
          const store = gatewayStore(fresh());

          for (const { call, failure } of steps) {
            if (call === "importKey") {
              const error = yield* Effect.flip(rejecting(call, failure, gatewayNonce(store, TTL, CAP)));
              expect(error._tag).toBe("GatewayError");
              expect(error.reason._tag).toBe("Crypto");
              expect(error.reason.cause).toBe(failure);
              continue;
            }

            const nonce = yield* gatewayNonce(store, TTL, CAP);

            if (call === "sign") {
              const error = yield* Effect.flip(rejecting(call, failure, nonce.issue(client)));
              expect(error._tag).toBe("GatewayError");
              expect(error.reason._tag).toBe("Crypto");
              expect(error.reason.cause).toBe(failure);
              continue;
            }

            // verify needs a nonce in the right shape and still in its window: issue one first.
            const issued = yield* nonce.issue(client);
            const error = yield* Effect.flip(rejecting(call, failure, nonce.check(client, issued)));
            expect(error._tag).toBe("GatewayError");
            expect(error.reason._tag).toBe("Crypto");
            expect(error.reason.cause).toBe(failure);
          }
        }),
    );
  });

  describe("T695, the door's hello admission keeps what failed (ticket 1067 slice 2)", () => {
    // H5, Gateway.ts `initializeChecked`: the door provides `Admissions` per attempt and wraps its own
    // admission errors as `AdmissionError` with the cause kept. A hello that passes every check
    // reaches admission, whose first step is the store's atomic nonce spend; the door's store throws
    // there, so the door's own `Storage` error is what admission failed with. Plant: map the error
    // to a new `AdmissionError` with no cause.
    // 0411 reason: the thrown value is a platform failure (an Error, a subclass with a cause, a plain
    // object), data Effect's Arbitrary has no schema for, so `failures` stays a fast-check input; the
    // suite's `Law` is the runner the module that owns the driver gives (scope, seed), as for C1 to C4.
    law(
      "H5: a store throw inside the hello's admission reaches initialize's caller as AdmissionError, its cause the door's own Storage error",
      fc.record({ failure: failures, tab: fc.string({ minLength: 1, maxLength: 20 }) }),
      ({ failure, tab }) =>
        Effect.gen(function* () {
          const sql = fresh();
          // Armed once the challenge is issued: no store transaction runs after it before admission.
          const armed = { on: false };
          const door = throwingWhenArmed(sql, armed, failure);
          const key = yield* clientKey();

          const error = yield* Effect.gen(function* () {
            const gateway = yield* Gateway;
            const client = yield* gateway.connect();
            const nonce = yield* gateway.challenge(client);

            const hello = {
              versions: [1],
              has: [],
              ping: "30s",
              key: key.raw,
              tab,
              nonce,
              platform: "headless",
              os: "linux",
              sentAt: "2026-11-16T10:00:00.000Z",
              signed: yield* key.hello(DOOR, tab, nonce),
            };

            armed.on = true;

            return yield* Effect.flip(gateway.initialize(client, hello, { url: DOOR, tab, name: key.fingerprint }));
          }).pipe(Effect.provide(doorOver(harness, sql, door, key)));

          const found = chain(error);
          expect(Predicate.hasProperty(found[0], "_tag") ? found[0]._tag : null).toBe("AdmissionError");
          const inner = found[1];
          expect(Predicate.hasProperty(inner, "_tag") ? inner._tag : null, "its cause is the door's own error").toBe(
            "GatewayError",
          );
          expect(
            Predicate.hasProperty(inner, "reason") && Predicate.hasProperty(inner.reason, "_tag")
              ? inner.reason._tag
              : null,
          ).toBe("Storage");
          expect(found[2], "the door's error keeps the store's throw").toBe(failure);
        }),
    );
  });
};
