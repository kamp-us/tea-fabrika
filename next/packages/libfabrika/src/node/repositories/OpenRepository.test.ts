// T878, next/, L3 (rewritten, ticket 1067). prepare checks the saved snapshot it makes: a hash that
// does not check is refused, never returned unchecked. Every stand-in is in-process (Effect's
// `Digest` on WebCrypto, a `Repositories` stub, a no-op FileSystem), so this file runs on every
// pull request (0536, 0581). The composed laws that write to a temp folder are in
// OpenRepository.composed.integration.test.ts.
// Plant (run once, not kept), in `kalfa/config/src`: (a) Load.resolve skips Snapshot.read and returns
// make's snapshot, red on both cases; (b) Load.resolve catches read's failure and returns make's
// snapshot, red when the second hash is wrong; (c) Snapshot.read drops its hash compare, red when
// the second hash is wrong.
import { expect, it } from "@effect/vitest";
import * as Files from "@kalfa/config/Files";
import * as SettingsSnapshot from "@kalfa/config/Snapshot";
import { Recorder } from "@kampus/vitest";
import * as Cause from "effect/Cause";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Function from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import {
  Repositories,
  RepositoriesError,
  ReadFailed,
  Snapshot as RepoSnapshot,
} from "../../repositories/Repositories.ts";
import * as RepositoryOpenTest from "../settings/RepositoryOpenTest.ts";
import * as OpenRepository from "./OpenRepository.ts";

const personName = "~/.fabrika/fabrika.toml";

const document = ".fabrika/fabrika.toml";

/** The repository documents the settings accept: no file, an empty one, and one that names the version. */
const Document = Schema.NullOr(Schema.Literals(["", '# repo\n\nfabrika-version = "0.0.0"\n']));

const repoSnapshot = (text: string | null) =>
  Schema.decodeSync(RepoSnapshot)({
    key: Function.pipe("a", Str.repeat(64)),
    branch: "release",
    commit: Function.pipe("b", Str.repeat(40)),
    file: document,
    text,
    hash: Function.pipe("c", Str.repeat(64)),
  });

/** A repository that holds `text` as its settings document, and refuses to resolve any source. */
const reader = (text: string | null) =>
  Layer.succeed(Repositories, {
    open: () =>
      Effect.succeed({
        snapshot: repoSnapshot(text),
        read: () => Effect.succeed(null),
        resolve: () =>
          Effect.fail(
            RepositoriesError.make({ reason: ReadFailed.make({ cause: Redacted.make("must not resolve code") }) }),
          ),
      }),
  });

/** The same hash with its first digit changed: "0" becomes "1", every other digit becomes "0". */
const flip = (hex: string) => (hex.startsWith("0") ? "1" : "0") + Function.pipe(hex, Str.slice(1));

/**
 * Effect's `Digest` on WebCrypto, watched by a Recorder. The run numbered `wrong` (from 0) answers a
 * hash with one digit changed, and every other run answers the true hash. `digest` is left out, so
 * code that hashes another way dies on it.
 */
const digests = (wrong: Option.Option<number>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const real = yield* Effect.provide(Digest.Digest, Digest.layerWebCrypto);
      const runs = yield* Ref.make(0);

      return Recorder.layer(Digest.Digest, {
        digestHex: (algorithm, data) =>
          Effect.zipWith(
            real.digestHex(algorithm, data),
            Ref.getAndUpdate(runs, (n) => n + 1),
            (hex, n) => (Option.contains(wrong, n) ? flip(hex) : hex),
          ),
      });
    }),
  );

const options = {
  person: { path: "person-file", name: personName },
  flags: {},
  env: {},
  version: "0.0.0",
};

it.effect.prop(
  "L3: a snapshot whose saved hash does not check is refused, never returned unchecked",
  { wrong: Schema.Boolean, text: Document },
  ({ wrong, text }) =>
    Effect.gen(function* () {
      const result = yield* OpenRepository.prepare("selected-repo", options).pipe(Effect.exit);
      const runs = yield* Recorder.calls(Digest.Digest, "digestHex");

      // make hashed the values, then read hashed the same bytes again to check the saved hash.
      expect(runs).toHaveLength(2);
      expect(runs[1]).toEqual(runs[0]);
      expect(Exit.isFailure(result)).toBe(wrong);

      if (Exit.isFailure(result)) {
        // This failure and no other: the document is invalid, because the saved settings did not check.
        const error = Option.getOrThrow(Cause.findErrorOption(result.cause));
        expect(error.reason._tag).toBe("InvalidDocument");
        const refused = error.reason.cause;
        expect(Redacted.isRedacted(refused)).toBe(true);
        const settings = Redacted.isRedacted(refused) ? Redacted.value(refused) : undefined;
        const isSettingsError = Schema.is(Files.SettingsError);
        expect(isSettingsError(settings)).toBe(true);
        expect(Schema.is(SettingsSnapshot.SnapshotError)(isSettingsError(settings) ? settings.cause : undefined)).toBe(
          true,
        );
      }
    }).pipe(
      Effect.provide([reader(text), FileSystem.layerNoop({ readFileString: () => Effect.succeed("") })]),
      Effect.provide(digests(wrong ? Option.some(1) : Option.none())),
      Effect.provide([RepositoryOpenTest.toml, Path.layer]),
    ),
);
