// A WebCrypto Promise that rejects reaches the Effect error channel as the module's own error,
// never as a defect or a bare undefined error.
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { subtle } from "./binary.ts";

describe("a rejected WebCrypto Promise", () => {
  it.live("scenario: transport subtle fails with WebCryptoError on a bad key import", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        subtle("importKey", "raw", new Uint8Array(3), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]),
      );
      assert.strictEqual(error._tag, "WebCryptoError");
    }),
  );
});
