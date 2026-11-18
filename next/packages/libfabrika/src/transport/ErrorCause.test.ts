// T695, next/. The transport's WebCrypto edge and its passkey writer keep the failure they translate
// (decision 0043 rule 12). Audit sites: `internal/binary.ts:106` (the one callback digest, importKey
// and verify share) and `Webauthn.ts:176` (client data that does not decode). Each run makes its
// own passkey and signs with it, so only the client data is damaged. A rejection is injected through
// Effect's own `WebCrypto` reference with a stand-in `Crypto`, so nothing is spied on (0555, ticket
// 1067 slice 1).
import { describe, expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as WebCrypto from "effect/crypto/WebCrypto";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as fc from "fast-check";
import { checkHello, helloText } from "./Hello.ts";
import { subtle } from "./internal/binary.ts";
import * as Rejecting from "./internal/rejecting.test-support.ts";
import { digest, freshKey, write } from "./Sshsig.test-support.ts";
import { PasskeyLine, writeWebauthnSshsig } from "./Webauthn.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

const RUNS = 100;

const effectOptions = { arbitrary: { runs: RUNS } };

const GeneratedFailure = Schema.TaggedUnion({
  error: { message: Schema.String },
  dom: { message: Schema.String },
  object: { code: Schema.String, detail: Schema.Json },
});

/** A property over generated input, each run an Effect on the real code. */
const law = <T>(name: string, input: fc.Arbitrary<T>, check: (input: T) => Effect.Effect<void, unknown, never>) =>
  it(name, () =>
    fc.assert(
      fc.asyncProperty(input, (value) => Effect.runPromise(check(value))),
      { seed: SEED, numRuns: RUNS },
    ),
  );

type Method = Rejecting.Method;

/** One WebCrypto call through the transport's edge, with arguments of the right shape. */
const call = (method: Method, bytes: Uint8Array<ArrayBuffer>) => {
  if (method === "digest") {
    return subtle("digest", "SHA-256", bytes);
  }

  if (method === "importKey") {
    return subtle("importKey", "raw", bytes, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }

  return subtle("verify", { name: "ECDSA", hash: "SHA-256" }, {} as CryptoKey, bytes, bytes);
};

/** `work` on a WebCrypto whose one `method` rejects with `failure`; every other call is the real one. */
const rejecting = <A, E>(method: Method, failure: object, work: Effect.Effect<A, E>) =>
  work.pipe(Effect.provide(WebCrypto.layer(Rejecting.crypto(method, failure))));

describe("T695, the WebCrypto edge keeps what WebCrypto rejected with", () => {
  // C5, internal/binary.ts:106. Plant: `const fail = () => WebCryptoError.make({ cause: undefined })`.
  // C5 injects its rejection through `WebCrypto.layer`, so C6's plant (read the global again) reds
  // it too.
  it.effect.prop(
    "C5: a generated rejection on any WebCrypto call is WebCryptoError with that very value as its cause",
    {
      steps: Arbitrary.array(
        Arbitrary.all({
          method: Arbitrary.schema(Schema.Literals(["digest", "importKey", "verify"])),
          failure: Arbitrary.schema(GeneratedFailure).pipe(
            Arbitrary.map(
              GeneratedFailure.match({
                error: ({ message }) => new Error(message),
                dom: ({ message }) => new DOMException(message, "OperationError"),
                object: ({ code, detail }) => ({ code, detail }),
              }),
            ),
          ),
        }),
        { minLength: 1, maxLength: 4 },
      ),
      bytes: Arbitrary.array(Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))), {
        maxLength: 65,
      }).pipe(Arbitrary.map((values) => new Uint8Array(values))),
    },
    ({ steps, bytes }) =>
      Effect.gen(function* () {
        for (const { method, failure } of steps) {
          const error = yield* Effect.flip(
            rejecting<unknown, Effect.Error<ReturnType<typeof call>>>(method, failure, call(method, bytes)),
          );

          expect(error._tag).toBe("WebCryptoError");
          expect((error as { readonly cause?: unknown }).cause).toBe(failure);
        }
      }),
    effectOptions,
  );

  // C6, internal/binary.ts:105: the edge reads the provided `WebCrypto`, never the global. A hello
  // that passes every check before its fingerprint reaches `digest`, which the stand-in rejects, so
  // `checkHello` fails with WebCryptoError carrying that rejection, and admission is never reached
  // (its stand-in dies). Plant: read `globalThis.crypto.subtle` in `binary.ts` again; the real
  // digest answers, the hello reaches admission, and the law dies there.
  it.effect(
    "C6 scenario: with a WebCrypto whose digest rejects, checkHello on a signed hello fails with WebCryptoError",
    () =>
      Effect.gen(function* () {
        const url = "https://fabrika.test/project-a";
        const tab = "tab-a";
        const nonce = "nonce-a";
        const key = yield* freshKey();
        const signed = yield* write(key, helloText({ url, tab, nonce }));
        const hash = yield* digest("SHA-256", key.publicKey);
        const failure = new DOMException("digest refused", "OperationError");

        const error = yield* Effect.flip(
          rejecting(
            "digest",
            failure,
            checkHello({
              hello: {
                versions: [2],
                has: [],
                ping: "30s",
                key: Buffer.from(key.publicKey).toString("base64url"),
                tab,
                nonce,
                platform: "browser",
                os: "linux",
                sentAt: "2026-11-08T04:00:00.000Z",
                signed,
              },
              url,
              tab,
              nonce,
              name: `SHA256:${Buffer.from(hash).toString("base64").replace(/=+$/, "")}`,
              versions: [2],
              ping: { min: 10_000, max: 60_000 },
              consume: () => true,
              admit: () => Effect.die("C6: admission must not be reached once digest is refused"),
            }),
          ),
        );

        expect(error._tag).toBe("WebCryptoError");
        expect((error as { readonly cause?: unknown }).cause).toBe(failure);
      }),
  );
});

const field = (value: string | Uint8Array) => {
  const bytes = Predicate.isString(value) ? Buffer.from(value, "utf8") : Buffer.from(value);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);

  return Buffer.concat([size, bytes]);
};

/** A DER integer from 32 big-endian bytes: no leading zeros, and one zero byte before a high bit. */
const integer = (raw: Uint8Array) => {
  let at = 0;

  while (at < raw.length - 1 && raw[at] === 0) {
    at++;
  }

  const bytes = Buffer.from(raw.slice(at));

  return (bytes[0] ?? 0) >= 128 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
};

class WebCryptoError extends Schema.TaggedError<WebCryptoError, { readonly brand: unique symbol }>()("WebCryptoError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const web = <A>(work: () => Promise<A>): Effect.Effect<A, WebCryptoError> =>
  Effect.tryPromise({ try: work, catch: (cause) => WebCryptoError.make({ message: "test WebCrypto failed", cause }) });

/**
 * scenario: a passkey made when the law runs (WebCrypto, P-256) signs authenticator data and the
 * damaged client data, so only the client data is wrong. No key, signature or authenticator data is
 * a literal here.
 */
const signed = Effect.fnUntraced(function* (client: Uint8Array) {
  const pair = yield* web(() =>
    crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]),
  );

  const point = new Uint8Array(yield* web(() => crypto.subtle.exportKey("raw", pair.publicKey)));
  const rp = "fabrika.test";
  const KEY = "sk-ecdsa-sha2-nistp256@openssh.com";
  const blob = Buffer.concat([field(KEY), field("nistp256"), field(point), field(rp)]);
  const rpHash = Buffer.from(yield* web(() => crypto.subtle.digest("SHA-256", Buffer.from(rp))));
  const authenticatorData = Buffer.concat([rpHash, Buffer.from([5]), Buffer.from([0, 0, 0, 1])]);
  const clientHash = Buffer.from(yield* web(() => crypto.subtle.digest("SHA-256", new Uint8Array(client))));

  const raw = new Uint8Array(
    yield* web(() =>
      crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        pair.privateKey,
        Buffer.concat([authenticatorData, clientHash]),
      ),
    ),
  );

  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  const ints = Buffer.concat([Buffer.from([2, r.length]), r, Buffer.from([2, s.length]), s]);

  return {
    line: `${KEY} ${blob.toString("base64")}`,
    assertion: {
      authenticatorData: new Uint8Array(authenticatorData),
      clientDataJSON: new Uint8Array(client),
      signature: new Uint8Array(Buffer.concat([Buffer.from([0x30, ints.length]), ints])),
    },
  };
});

/** Client data a browser could not have sent: a damaged field, or bytes that are not UTF-8. */
const damagedClients = fc.oneof(
  fc
    .record({
      type: fc.oneof(fc.string(), fc.integer()),
      challenge: fc.oneof(fc.integer(), fc.constant(null)),
      origin: fc.string(),
    })
    .map((client) => ({ utf8: true, data: new TextEncoder().encode(JSON.stringify(client)) })),
  fc.string().map((s) => ({ utf8: true, data: new TextEncoder().encode(`{${s}`) })),
  fc.uint8Array({ minLength: 1, maxLength: 16 }).map((b) => ({ utf8: false, data: Uint8Array.from([0xff, ...b]) })),
);

describe("T695, the passkey writer keeps why client data was refused", () => {
  // C3, Webauthn.ts:176. Plant: `catch: () => new BadAssertion({})`.
  law(
    "C3: client data that does not decode is BadAssertion carrying the decoder's or text decoder's failure",
    fc.record({ client: damagedClients, text: fc.string() }),
    ({ client, text }) =>
      Effect.gen(function* () {
        const { line, assertion } = yield* signed(client.data);

        const error = yield* Effect.flip(
          writeWebauthnSshsig({ text, line: Schema.decodeSync(PasskeyLine)(line), assertion }),
        );

        expect(error._tag).toBe("BadAssertion");
        const cause = (error as { readonly cause?: unknown }).cause;

        if (client.utf8) {
          expect(Schema.isSchemaError(cause), "the cause is the decoder's own failure").toBe(true);
        } else {
          expect(cause, "the cause is the text decoder's own failure").toBeInstanceOf(TypeError);
        }
      }),
  );
});
