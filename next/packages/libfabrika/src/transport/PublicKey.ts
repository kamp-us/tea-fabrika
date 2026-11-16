/**
 * The public names of a raw Ed25519 key: its OpenSSH fingerprint and its SSH key line, the same
 * math the door's hello check does.
 *
 * @stability unstable
 */
import { Effect, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { field, join, subtle } from "./internal/binary.ts";
import { KeyLine } from "./Sshsig.ts";

/**
 * Computes the OpenSSH `SHA256:` fingerprint of a raw public key: the SHA-256 of its bytes in
 * base64 with no padding.
 *
 * @stability unstable
 * @category constructors
 */
export const fingerprint = Effect.fnUntraced(function* (raw: Uint8Array) {
  const hash = yield* subtle("digest", "SHA-256", new Uint8Array(raw));

  return `SHA256:${Base64.encode(new Uint8Array(hash)).replace(/=+$/, "")}`;
});

/**
 * Builds the `ssh-ed25519` key line of a raw public key: the type and the key, each a length and
 * its bytes, in base64.
 *
 * **Gotchas**
 *
 * It fails with a `SchemaError` when `raw` is not 32 bytes, since then it is no Ed25519 key.
 *
 * @stability unstable
 * @category constructors
 */
export const line = (raw: Uint8Array) =>
  Schema.decodeUnknownEffect(KeyLine)(`ssh-ed25519 ${Base64.encode(join(field("ssh-ed25519"), field(raw)))}`);
