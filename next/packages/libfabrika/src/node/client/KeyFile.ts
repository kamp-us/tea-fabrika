/**
 * The hands' `ClientKey` on a laptop: one Ed25519 key in one file, made once with mode 0600 in a
 * folder of mode 0700, and reused on every start. A file that others can read, or that does not
 * decode, is a typed error and is never used or replaced; only the key the door removed is
 * replaced.
 */
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { ClientKey, ClientKeyError, type Identity } from "../../transport/ClientKey.ts";
import { ErrorClass } from "../../transport/ClientRows.ts";
import * as PublicKey from "../../transport/PublicKey.ts";
import type { KeyLine } from "../../transport/Sshsig.ts";

const ED = "Ed25519";

/** What the file holds: the private key as WebCrypto's JWK, `d` its private half and `x` its public. */
const Stored = Schema.Struct({
  jwk: Schema.Struct({
    kty: Schema.Literal("OKP"),
    crv: Schema.Literal("Ed25519"),
    d: Schema.String,
    x: Schema.String,
  }),
});
type Stored = typeof Stored.Type;

const StoredJson = Schema.fromJsonString(Stored);

/** A key read from the file or just made: what it signs with, and its public names. */
type Loaded = {
  readonly fingerprint: string;
  readonly raw: string;
  readonly line: KeyLine;
  readonly signer: CryptoKey;
};

type Op = ClientKeyError["op"];

const isErrorClass = Schema.is(ErrorClass);

/** A failure's class from a fixed list: a file system reason, or a WebCrypto error's name. Never a message. */
const errorClass = (cause: unknown): ErrorClass => {
  if (PlatformError.isPlatformError(cause)) {
    const reason = cause.reason._tag;
    return reason === "NotFound" ? "NotFoundError" : reason === "PermissionDenied" ? "NotAllowedError" : "other";
  }

  return cause instanceof Error && isErrorClass(cause.name) ? cause.name : "other";
};

const failure = (op: Op) => (cause: unknown) => ClientKeyError.make({ op, error: errorClass(cause) });

const damaged = (op: Op) => () => ClientKeyError.make({ op, error: "DataError" });

/** The stored key, imported to sign only, with its public names. A key that does not import is damaged. */
const load = Effect.fnUntraced(function* (stored: Stored, op: Op) {
  const bytes = Base64Url.decode(stored.jwk.x);

  if (bytes._tag === "Failure") {
    return yield* damaged(op)();
  }

  const line = yield* PublicKey.line(bytes.success).pipe(Effect.mapError(damaged(op)));
  const fingerprint = yield* PublicKey.fingerprint(bytes.success).pipe(Effect.mapError(failure(op)));
  const [s, jwk, bad] = [crypto.subtle, { ...stored.jwk }, damaged(op)];
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto imports a key through a Promise
  const signer = yield* Effect.tryPromise({ try: () => s.importKey("jwk", jwk, ED, false, ["sign"]), catch: bad });
  return { fingerprint, raw: Base64Url.encode(bytes.success), line, signer } satisfies Loaded;
});

/** A fresh pair: its private half as the file will hold it, and the key loaded from that. */
const make = Effect.gen(function* () {
  const [s, bad] = [crypto.subtle, failure("make")];
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto makes a key through a Promise
  const pair = yield* Effect.tryPromise({ try: () => s.generateKey(ED, true, ["sign", "verify"]), catch: bad });

  if (!("privateKey" in pair)) {
    return yield* ClientKeyError.make({ op: "make", error: "TypeError" });
  }

  const key = pair.privateKey;
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto exports a key through a Promise
  const jwk = yield* Effect.tryPromise({ try: () => s.exportKey("jwk", key), catch: bad });
  const stored = yield* Schema.decodeUnknownEffect(Stored)({
    jwk: { kty: jwk.kty, crv: jwk.crv, d: jwk.d, x: jwk.x },
  }).pipe(Effect.mapError(damaged("make")));
  return { stored, key: yield* load(stored, "make") };
});

const identity = (key: Loaded, found: Identity["found"]): Identity => ({
  fingerprint: key.fingerprint,
  raw: key.raw,
  line: key.line,
  found,
  sign: (bytes) => {
    const [s, signer, data, bad] = [crypto.subtle, key.signer, new Uint8Array(bytes), failure("sign")];
    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto signs through a Promise
    const signed = Effect.tryPromise({ try: () => s.sign(ED, signer, data), catch: bad });
    return Effect.map(signed, (signature) => new Uint8Array(signature));
  },
});

/** A name no other start picks: the file's own name and random letters. */
const tempName = (file: string) => `${file}.${Base64Url.encode(crypto.getRandomValues(new Uint8Array(9)))}`;

/**
 * Layer that supplies `ClientKey` from one key file, through Effect's `FileSystem` and `Path`.
 *
 * **Details**
 *
 * `current(null)` makes the file's folder with mode 0700 when it is missing. With no file it makes
 * a pair, writes it whole to a temporary name in that folder with mode 0600, and links it to
 * `file` only if `file` is still absent: `created`. When another start linked first, it reads
 * theirs: `reused`. A file with mode 0600 is `reused`. A file with any group or other bit is
 * `ClientKeyError { op: "read", error: "NotAllowedError" }` and is never read; one that does not
 * decode is `{ op: "read", error: "DataError" }` and is left as it was. `current(fp)`, with `fp`
 * the stored key's fingerprint, writes a new pair the same way and renames it over `file`:
 * `replaced`. `claimPersist` answers `false` and `persist` `true`: a file is already kept.
 *
 * @category layers
 */
export const layer = (options: { readonly file: string }) =>
  Layer.effect(
    ClientKey,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { file } = options;

      /** The stored key, or none when there is no file. */
      const read = Effect.gen(function* () {
        const info = yield* fs.stat(file).pipe(
          Effect.asSome,
          Effect.catchTag("PlatformError", (cause) =>
            cause.reason._tag === "NotFound" ? Effect.succeedNone : Effect.fail(failure("read")(cause)),
          ),
        );

        if (Option.isNone(info)) {
          return Option.none<Loaded>();
        }

        // As OpenSSH does: a key file others may read is refused, never used.
        if ((info.value.mode & 0o077) !== 0) {
          return yield* ClientKeyError.make({ op: "read", error: "NotAllowedError" });
        }

        const text = yield* fs.readFileString(file).pipe(Effect.mapError(failure("read")));
        const stored = yield* Schema.decodeEffect(StoredJson)(text).pipe(Effect.mapError(damaged("read")));
        return Option.some(yield* load(stored, "read"));
      });

      /** Writes `stored` whole to a fresh temporary name, mode 0600, and hands that name to `place`. */
      const written = <A, E>(stored: Stored, place: (temp: string) => Effect.Effect<A, E>) =>
        Effect.acquireUseRelease(
          Effect.sync(() => tempName(file)),
          (temp) =>
            Effect.gen(function* () {
              const text = yield* Schema.encodeEffect(StoredJson)(stored).pipe(Effect.mapError(damaged("write")));
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const handle = yield* fs.open(temp, { flag: "wx", mode: 0o600 });
                  yield* handle.writeAll(new TextEncoder().encode(text));
                  yield* handle.sync;
                }),
              ).pipe(Effect.mapError(failure("write")));
              return yield* place(temp);
            }),
          // The temporary name is gone once it was linked or renamed, or when the write failed.
          (temp) => fs.remove(temp, { force: true }).pipe(Effect.ignore),
        );

      const current = Effect.fn("KeyFile.current")(function* (rejected: string | null) {
        yield* fs
          .makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 })
          .pipe(Effect.mapError(failure("open")));
        const known = yield* read;

        if (Option.isSome(known) && known.value.fingerprint !== rejected) {
          return identity(known.value, "reused");
        }

        const made = yield* make;

        if (Option.isSome(known)) {
          // The door removed this key: a new one takes its place whole.
          yield* written(made.stored, (temp) => fs.rename(temp, file).pipe(Effect.mapError(failure("write"))));
          return identity(made.key, "replaced");
        }

        // Linked only if no other start made the file first; then theirs is the key.
        const linked = yield* written(made.stored, (temp) =>
          fs.link(temp, file).pipe(
            Effect.as(true),
            Effect.catchTag("PlatformError", (cause) =>
              cause.reason._tag === "AlreadyExists" ? Effect.succeed(false) : Effect.fail(failure("write")(cause)),
            ),
          ),
        );

        if (linked) {
          return identity(made.key, "created");
        }

        const theirs = yield* read;

        if (Option.isNone(theirs)) {
          return yield* ClientKeyError.make({ op: "read", error: "NotFoundError" });
        }

        return identity(theirs.value, "reused");
      });

      return ClientKey.of({
        current,
        claimPersist: Effect.succeed(false),
        persist: Effect.succeed(true),
      });
    }),
  );
