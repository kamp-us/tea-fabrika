// The wire helpers, keys and saved vectors that Sshsig.test.ts and Sshsig.integration.test.ts share:
// the first holds the laws over saved vectors and WebCrypto keys, the second p44, which runs the
// real `ssh-keygen` and so runs on the schedule (0536).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as Arr from "effect/Array";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Signature from "effect/crypto/Signature";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import type * as ClientKey from "./ClientKey.ts";
import { checkSshsig, KeyLine, writeSshsig } from "./Sshsig.ts";

export const SPACE = "fabrika-client";

export const refused = { reason: "bad_signature" };

// P1's saved vectors (fixtures/next/sshsig/README.md), made once by real `ssh-keygen -Y sign`.
const VECTORS = resolve(import.meta.dirname, "../../../../../fixtures/next/sshsig");

export const at = (name: string): string => readFileSync(join(VECTORS, name), "utf8");

export const text = at("text.txt");

export const goodSig = at("good.sig");
export const signer = Str.trim(at("signer.pub"));
export const other = Str.trim(at("other.pub"));
export const ecdsa = Str.trim(at("ecdsa.pub"));

export const check = (armored: string, signers: ReadonlyArray<string>, body: string = text) =>
  checkSshsig({ text: body, armored, space: SPACE, signers });

// The wire, for building blobs by hand: RFC 4251's `string` is a u32 length, then the bytes.
export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export const join8 = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(Arr.reduce(parts, 0, (n, p) => n + p.length));
  Arr.reduce(parts, 0, (offset, p) => {
    out.set(p, offset);

    return offset + p.length;
  });
  return out;
};

export const u32 = (n: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);

  return out;
};

export const str = (s: Uint8Array | string): Uint8Array => {
  const bytes = typeof s === "string" ? utf8(s) : s;

  return join8(u32(bytes.length), bytes);
};

export const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

export const rows = (body: string): string =>
  Option.match(Str.match(/.{1,70}/g)(body), { onNone: () => "", onSome: (found) => Arr.join(found, "\n") });

export const armor = (blob: Uint8Array): string =>
  `-----BEGIN SSH SIGNATURE-----\n${rows(base64(blob))}\n-----END SSH SIGNATURE-----\n`;

export const unarmor = (armored: string): Uint8Array =>
  Buffer.from(
    Arr.join(
      Arr.filter(Str.split(armored, "\n"), (row) => !Str.startsWith("-----")(row)),
      "",
    ),
    "base64",
  );

export const keyBlob = (key: Uint8Array): Uint8Array => join8(str("ssh-ed25519"), str(key));

export const lineFor = (blob: Uint8Array, comment?: string): string =>
  comment === undefined ? `ssh-ed25519 ${base64(blob)}` : `ssh-ed25519 ${base64(blob)} ${comment}`;

/** PROTOCOL.sshsig's blob, field by field. */
export type Blob = {
  readonly magic: Uint8Array;
  readonly version: number;
  readonly key: Uint8Array;
  readonly space: Uint8Array;
  readonly reserved: Uint8Array;
  readonly hash: Uint8Array;
  readonly signature: Uint8Array;
};

const parse = (bytes: Uint8Array): Blob => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const take = (n: number): Uint8Array => bytes.slice(offset, (offset += n));

  const word = (): number => {
    const n = view.getUint32(offset);
    offset += 4;

    return n;
  };

  const field = (): Uint8Array => take(word());

  return {
    magic: take(6),
    version: word(),
    key: field(),
    space: field(),
    reserved: field(),
    hash: field(),
    signature: field(),
  };
};

export const build = (b: Blob, tail: Uint8Array = new Uint8Array()): Uint8Array =>
  join8(b.magic, u32(b.version), str(b.key), str(b.space), str(b.reserved), str(b.hash), str(b.signature), tail);

/** What the signature covers: "SSHSIG", then namespace, reserved, hash name and H(message). */
export const toSign = (space: string, hash: string, digest: Uint8Array): Uint8Array =>
  join8(utf8("SSHSIG"), str(space), str(""), str(hash), str(digest));

export const good = parse(unarmor(goodSig));

/** `ssh-ed25519`, then a 32-byte key: 4 + 11 + 4 bytes before the key itself. */
export const goodKey = good.key.slice(19);

/** `ssh-ed25519`, then a 64-byte signature. */
export const goodRaw = good.signature.slice(19);

// A fresh Ed25519 key from WebCrypto, extractable so the test can hand it to `ssh-keygen` too.
export type Key = {
  readonly line: string;
  readonly publicKey: Uint8Array;
  readonly seed: Uint8Array;
  readonly privateKey: CryptoKey;
};

// A test-support file is not a `*.test.ts` file, so its WebCrypto calls are marked Promise edges with
// a tagged failure, as the shared suites' are (gateway/TasksTest.ts). A failure is a defect here, as
// it was under `Effect.promise`: no law expects WebCrypto to fail.
class CryptoFailed extends Schema.TaggedError<CryptoFailed, { readonly brand: unique symbol }>()("CryptoFailed", {
  cause: Schema.Defect(),
}) {}

const fail = (cause: unknown) => CryptoFailed.make({ cause });

export const freshKey = (comment?: string): Effect.Effect<Key> =>
  Effect.gen(function* () {
    const subtle = crypto.subtle;

    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto generates the test's Ed25519 key
    const pair = yield* Effect.tryPromise({
      try: () => subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]),
      catch: fail,
    });

    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto exports the generated public key
    const raw = yield* Effect.tryPromise({ try: () => subtle.exportKey("raw", pair.publicKey), catch: fail });
    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto exports the generated test key's seed
    const pkcs8 = yield* Effect.tryPromise({ try: () => subtle.exportKey("pkcs8", pair.privateKey), catch: fail });
    const publicKey = new Uint8Array(raw);

    return {
      line: lineFor(keyBlob(publicKey), comment),
      publicKey,
      seed: new Uint8Array(pkcs8).slice(-32), // PKCS#8 for Ed25519 ends with the 32-byte seed
      privateKey: pair.privateKey,
    };
  }).pipe(Effect.orDie);

export const signWith =
  (key: Key) =>
  (bytes: Uint8Array): Effect.Effect<Uint8Array> => {
    const sign = () => crypto.subtle.sign("Ed25519", key.privateKey, new Uint8Array(bytes));

    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto signs with the generated test key
    return Effect.tryPromise({ try: sign, catch: fail }).pipe(
      Effect.map((sig) => new Uint8Array(sig)),
      Effect.orDie,
    );
  };

export const digest = (name: "SHA-256" | "SHA-384" | "SHA-512", bytes: Uint8Array) =>
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes the test's bytes
  Effect.tryPromise({ try: () => crypto.subtle.digest(name, new Uint8Array(bytes)), catch: fail }).pipe(
    Effect.map((d) => new Uint8Array(d)),
    Effect.orDie,
  );

export const decodeLine = Schema.decodeUnknownEffect(KeyLine);

/** `writeSshsig` over `body` with `key`, its line decoded first, as every caller must. */
export const write = (key: Key, body: string) =>
  Effect.flatMap(decodeLine(key.line), (line) => writeSshsig({ text: body, space: SPACE, line, sign: signWith(key) }));

/** A blob signed by hand, with any hash name: what `ssh-keygen` would write if it used one. */
export const signedByHand = (
  publicKey: Uint8Array,
  sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array>,
  hash: string,
  digested: Uint8Array,
) =>
  Effect.map(sign(toSign(SPACE, hash, digested)), (raw) =>
    armor(
      build({
        magic: utf8("SSHSIG"),
        version: 1,
        key: keyBlob(publicKey),
        space: utf8(SPACE),
        reserved: new Uint8Array(),
        hash: utf8(hash),
        signature: join8(str("ssh-ed25519"), str(raw)),
      }),
    ),
  );

/** A test identity can sign raw bytes and a door hello without claiming a membership rank. */
export type Identity = Pick<ClientKey.Identity, "raw" | "line" | "fingerprint"> & {
  readonly sshFingerprint: string;
  readonly sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array>;
  readonly proof: (text: string) => Effect.Effect<string>;
};

const fromSigner = Effect.fnUntraced(function* (
  publicKey: Uint8Array,
  sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array>,
): Effect.fn.Return<Identity> {
  const blob = keyBlob(publicKey);
  const fingerprint = (bytes: Uint8Array) =>
    digest("SHA-256", bytes).pipe(Effect.map((hashed) => `SHA256:${Str.replace(/=+$/, "")(base64(hashed))}`));

  return {
    raw: Base64Url.encode(publicKey),
    line: yield* decodeLine(lineFor(blob)).pipe(Effect.orDie),
    fingerprint: yield* fingerprint(publicKey),
    sshFingerprint: yield* fingerprint(blob),
    sign,
    proof: Effect.fnUntraced(function* (text: string) {
      return yield* signedByHand(publicKey, sign, "sha512", yield* digest("SHA-512", utf8(text)));
    }),
  };
});

export const identity: Effect.Effect<Identity> = freshKey().pipe(
  Effect.flatMap((key) => fromSigner(key.publicKey, signWith(key))),
);

/** Derive the same identity from a saved 32-byte Ed25519 seed. */
export const identityFrom = Effect.fnUntraced(
  function* (seed: Uint8Array) {
    const signature = yield* Signature.Signature;
    const key = yield* Signature.privateKey(Signature.ed25519, seed);
    const publicKey = yield* Signature.toBytes(yield* signature.publicKeyOf(key));

    return yield* fromSigner(publicKey, (bytes) => signature.sign(key, bytes).pipe(Effect.orDie));
  },
  Effect.provide(Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))),
  Effect.orDie,
);
