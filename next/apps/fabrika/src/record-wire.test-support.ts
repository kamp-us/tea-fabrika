// T502 PR 2, next/. Records through the normal local instance control socket.
import { NodeServices } from "@effect/platform-node";
import * as StartsTest from "@kampus/libfabrika/settings/StartsTest";
import { SinkError } from "@kampus/libfabrika/telemetry/Sink";
import * as SshsigTest from "@kampus/libfabrika/transport/Sshsig.test-support";
import { Effect, FileSystem, Path, Schema } from "effect";
import { SecureRandom } from "effect/crypto";

import { build } from "./build.ts";
import { keptEnv } from "./env.test-support.ts";
import { localInstance } from "./local-instance.ts";
import { heldPort } from "./port.test-support.ts";

const Failure = Schema.Struct({ reason: Schema.String });

export const settingsFixture = <A extends StartsTest.Fixture>(config: A) => {
  const { port: _port, person: _person, founder: _founder, window: _window, values: _values, ...rest } = config;

  return StartsTest.fixture(config).pipe(Effect.map((input) => ({ ...rest, ...input })));
};

// Startup allocates its own identity; direct Worker fixtures still need a complete envelope.
export const startupFixture = <A extends StartsTest.Fixture & { readonly home: string }>(config: A) =>
  settingsFixture(config).pipe(
    Effect.map(({ start: _start, ...input }) => ({
      ...input,
      ...(config.start === undefined ? {} : { start: config.start }),
    })),
  );

export const recordCall = Effect.fnUntraced(function* <A>(invoke: () => Promise<A>) {
  // oxlint-disable-next-line fabrika/no-promises -- edge: the local instance record proxy exposes Promise-returning stub calls
  return yield* Effect.tryPromise({
    try: invoke,
    catch: (cause: unknown) => Schema.decodeUnknownSync(Failure)(cause),
  }).pipe(
    // Mapping every reach failure to unreachable still fails the bad_row law.
    Effect.catch((error) =>
      error.reason === "unreachable" || error.reason === "bad_row" || error.reason === "storage"
        ? Effect.fail(new SinkError({ reason: error.reason, held: 0, cause: error }))
        : Effect.die(error),
    ),
  );
});

export const recordWire = Effect.fnUntraced(
  function* (cap: number) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "t502-r-" });
    const port = yield* Effect.acquireRelease(heldPort(), (p) => p.release);
    const key = yield* SshsigTest.identity;
    const built = yield* build({ out: path.join(home, "dist") });
    // localInstance sets ALCHEMY_HOME; it goes back as it was when the scope closes.
    yield* keptEnv(["ALCHEMY_HOME"]);

    return yield* localInstance(
      built,
      yield* startupFixture({
        home,
        name: "record-law",
        person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
        founder: key.line,
        window: key.raw,
        port: port.port,
        limits: { recordBytes: cap },
      }),
    );
  },
  Effect.provide(SecureRandom.layerWebCrypto),
  Effect.provide(NodeServices.layer),
);
