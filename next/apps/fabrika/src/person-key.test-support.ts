// next/. A test person's SSH identity for a door's hello, on Effect's Signature and Digest over
// WebCrypto. The armored SSHSIG is written here by hand from PROTOCOL.sshsig, never by the product's
// own writer, so the door's reader is checked against bytes it did not make.
import { Effect, Layer } from "effect";
import { Digest, SecureRandom, Signature } from "effect/crypto";
import { Base64, Base64Url } from "effect/encoding";

/** The namespace the door's hello is signed in. */
const SPACE = "fabrika-client";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const concat = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  parts.reduce((at, part) => {
    out.set(part, at);

    return at + part.length;
  }, 0);

  return out;
};

/** RFC 4251's `string`: a big-endian u32 length, then the bytes. */
const field = (value: Uint8Array | string): Uint8Array => {
  const body = typeof value === "string" ? utf8(value) : value;
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, body.length);

  return concat(size, body);
};

/** SSHSIG's version, a u32 1. */
const VERSION = new Uint8Array([0, 0, 0, 1]);

export interface PersonKey {
  /** The public key's 32 bytes in base64url, as a JWK's `x`. */
  readonly raw: string;
  /** The `ssh-ed25519 <blob>` public key line. */
  readonly line: string;
  /** `SHA256:` and the unpadded base64 SHA-256 of the public key's 32 bytes. */
  readonly fingerprint: string;
  /** `SHA256:` and the unpadded base64 SHA-256 of the whole SSH blob, as `ssh-keygen -l` prints it. */
  readonly sshFingerprint: string;
  /** The raw 64-byte Ed25519 signature of `data`. */
  readonly sign: (data: Uint8Array) => Effect.Effect<Uint8Array>;
  /** `text` signed as an armored SSHSIG in the door's namespace, over its SHA-512. */
  readonly proof: (text: string) => Effect.Effect<string>;
}

const services = Layer.mergeAll(
  Digest.layerWebCrypto,
  Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto)),
);

const make = Effect.fnUntraced(
  function* (privateKey: Signature.PrivateKey<Signature.Ed25519>) {
    const digest = yield* Digest.Digest;
    const signature = yield* Signature.Signature;
    const bytes = yield* Signature.toBytes(yield* signature.publicKeyOf(privateKey));
    const blob = concat(field("ssh-ed25519"), field(bytes));
    const sign = (data: Uint8Array) => signature.sign(privateKey, data).pipe(Effect.orDie);

    const proof = Effect.fnUntraced(function* (text: string) {
      const hashed = yield* digest.digest(Digest.sha512, utf8(text));
      const signed = yield* sign(concat(utf8("SSHSIG"), field(SPACE), field(""), field("sha512"), field(hashed)));

      const packet = concat(
        utf8("SSHSIG"),
        VERSION,
        field(blob),
        field(SPACE),
        field(""),
        field("sha512"),
        field(concat(field("ssh-ed25519"), field(signed))),
      );

      const rows = Base64.encode(packet).match(/.{1,70}/g) ?? [];

      return `-----BEGIN SSH SIGNATURE-----\n${rows.join("\n")}\n-----END SSH SIGNATURE-----\n`;
    });

    const fingerprint = (data: Uint8Array) =>
      digest
        .digest(Digest.sha256, data)
        .pipe(Effect.map((hashed) => `SHA256:${Base64.encode(hashed).replace(/=+$/, "")}`));

    const key: PersonKey = {
      raw: Base64Url.encode(bytes),
      line: `ssh-ed25519 ${Base64.encode(blob)}`,
      fingerprint: yield* fingerprint(bytes),
      sshFingerprint: yield* fingerprint(blob),
      sign,
      proof,
    };

    return key;
  },
  Effect.provide(services),
  Effect.orDie,
);

/** A fresh identity, its private key never kept anywhere but in this value. */
export const personKey: Effect.Effect<PersonKey> = Signature.Signature.use((signature) =>
  signature.generateKeyPair(Signature.ed25519),
).pipe(
  Effect.flatMap(({ privateKey }) => make(privateKey)),
  Effect.provide(services),
  Effect.orDie,
);

/** The identity of a known 32-byte Ed25519 seed, such as a JWK's `d`. */
export const personKeyFrom = Effect.fn("personKey.from")(function* (seed: Uint8Array) {
  return yield* make(yield* Signature.privateKey(Signature.ed25519, seed).pipe(Effect.orDie));
});
