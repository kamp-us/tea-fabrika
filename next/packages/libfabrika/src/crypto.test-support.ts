// Stand-in WebCrypto objects for laws that hand the product a crypto through Effect's `WebCrypto`
// reference (decision 0555, the mock sweep's gateway and telemetry slice). Gateway and telemetry
// laws both read it, so it sits at the top of src/, beside Id.test-support.ts. Each stand-in is a
// `Stub.make` (decision 0554): a member a law did not give throws, naming it.
import { Stub } from "@kampus/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

type Crypto = typeof globalThis.crypto;

type Subtle = Crypto["subtle"];

type Digest = Subtle["digest"];

const unexpected = (member: string): never => {
  throw new Error(`unused crypto member in a law: ${member}`);
};

/** The bytes a digest is asked to hash, as a copy the law may keep. */
const copied = (data: Parameters<Digest>[1]): Uint8Array =>
  ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
    : new Uint8Array(data).slice();

/**
 * The real crypto, except that the first digest of bytes holding `marker` succeeds `entered`, then
 * waits for `release` before it hashes. A law forks the work, awaits `entered`, acts in the gap,
 * then succeeds `release`.
 */
export const paused = Effect.fnUntraced(function* (marker: string) {
  const entered = yield* Deferred.make<void>(),
    release = yield* Deferred.make<void>();

  let reached = false;
  // A shared top file holds no error of its own (0043), so the real digest's rejection is Effect's
  // own tagged UnknownError, with WebCrypto's failure kept as its cause.
  const fail = (cause: unknown) => new Cause.UnknownError(cause, "the real digest failed");

  const real = (algorithm: Parameters<Digest>[0], data: Parameters<Digest>[1]) =>
    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes only through a Promise
    Effect.tryPromise({ try: () => globalThis.crypto.subtle.digest(algorithm, data), catch: fail });

  const digest: Digest = (algorithm, data) => {
    const gate = !reached && new TextDecoder().decode(copied(data)).includes(marker);
    reached ||= gate;

    const work = gate
      ? Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(real(algorithm, data)),
        )
      : real(algorithm, data);

    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: a WebCrypto digest answers a Promise
    return Effect.runPromise(work);
  };

  const crypto = Stub.make<Crypto>(unexpected, {
    getRandomValues: (array) => globalThis.crypto.getRandomValues(array),
    subtle: Stub.make<Subtle>(unexpected, { digest }),
  });

  return { crypto, entered, release };
});

/** A crypto whose digest keeps a copy of each body it is asked to hash, then rejects with `failure`. */
export const rejecting = (failure: unknown) => {
  const asked: Array<Uint8Array> = [];

  const digest: Digest = (_algorithm, data) => {
    asked.push(copied(data));

    // oxlint-disable-next-line fabrika/no-promises -- edge: a WebCrypto digest rejects through its Promise
    return Promise.reject(failure);
  };

  const crypto = Stub.make<Crypto>(unexpected, { subtle: Stub.make<Subtle>(unexpected, { digest }) });

  return { asked, crypto };
};
