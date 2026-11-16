// next/. The test person's key that the door's integration laws sign their hellos with
// (person-key.test-support.ts) is read by the product's own SSHSIG check and fingerprint: its proof
// of a text passes for that text and that key alone, and its fingerprint is the one the door takes.
// Plants, run once each: a proof over the text with one byte more, and a fingerprint over the blob
// in place of the key's 32 bytes.
import { expect, it } from "@effect/vitest";
import * as PublicKey from "@kampus/libfabrika/transport/PublicKey";
import { checkSshsig } from "@kampus/libfabrika/transport/Sshsig";
import { runsFor } from "@kampus/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { Digest } from "effect/crypto";
import { Base64, Base64Url } from "effect/encoding";
import { personKey, personKeyFrom } from "./person-key.test-support.ts";

const SPACE = "fabrika-client";

it.effect.prop(
  "a proof passes the door's SSHSIG check for its text and key only, and the fingerprint is the door's",
  {
    text: Schema.String,
    other: Schema.String,
    seed: Arbitrary.array(Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))), {
      minLength: 32,
      maxLength: 32,
    }),
  },
  ({ text, other, seed }) =>
    Effect.gen(function* () {
      const key = yield* personKey;
      const stranger = yield* personKey;
      const armored = yield* key.proof(text);

      expect(yield* checkSshsig({ text, armored, space: SPACE, signers: [key.line] })).toEqual({
        signer: key.line,
      });
      expect(yield* checkSshsig({ text, armored, space: SPACE, signers: [stranger.line] })).toEqual({
        reason: "bad_signature",
      });

      if (other !== text) {
        expect(yield* checkSshsig({ text: other, armored, space: SPACE, signers: [key.line] })).toEqual({
          reason: "bad_signature",
        });
      }

      const raw = Base64Url.decode(key.raw);
      expect(raw._tag).toBe("Success");

      if (raw._tag === "Success") {
        expect(key.fingerprint).toBe(yield* PublicKey.fingerprint(raw.success));
        expect(key.line).toBe(yield* PublicKey.line(raw.success));
      }

      // ssh-keygen's fingerprint is over the whole blob the key line carries, not the 32 raw bytes.
      const blob = yield* Effect.fromResult(Base64.decode(key.line.slice("ssh-ed25519 ".length)));
      const hashed = yield* Digest.Digest.use((digest) => digest.digest(Digest.sha256, blob));
      expect(key.sshFingerprint).toBe(`SHA256:${Base64.encode(hashed).replace(/=+$/, "")}`);
      expect(key.sshFingerprint).not.toBe(key.fingerprint);

      // A known seed gives the same identity each time, so a saved key keeps its name.
      const bytes = new Uint8Array(seed);
      const once = yield* personKeyFrom(bytes);
      const again = yield* personKeyFrom(bytes);
      expect([again.raw, again.line, again.fingerprint, again.sshFingerprint]).toEqual([
        once.raw,
        once.line,
        once.fingerprint,
        once.sshFingerprint,
      ]);
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 20, full: 100 }) } },
);
