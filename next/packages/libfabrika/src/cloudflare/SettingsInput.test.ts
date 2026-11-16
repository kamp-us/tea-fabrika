// T753, next/, L3 and L10 [secrets]. The Worker reads only INSTANCE through Alchemy. The memory restart
// plan declares the brain's memory limit and grace, so the values gain `brainMemory` and `brainGrace`.
import { WorkerEnvironment } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { describe, expect } from "@effect/vitest";
import { ByteSize, Effect, Exit, Formatter, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import * as Declarations from "../settings/Declarations.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import * as SettingsInput from "./SettingsInput.ts";

describe("shared Worker settings reader, next/", () => {
  StartsTest.law(
    "L3 the shared reader accepts exactly integer ports from 1 through 65535",
    // Push both sides of the declaration's range, including fractions, infinities and NaN.
    fc.oneof(fc.integer({ min: 1, max: 65535 }), fc.integer(), fc.double()),
    (port) =>
      Effect.gen(function* () {
        const valid = Number.isInteger(port) && port >= 1 && port <= 65535;
        const input = yield* StartsTest.input({
          port: valid ? port : 18787,
          start: "port-boundary",
          build: "port-build",
          revision: null,
          origin: "flag",
        });
        const raw = valid
          ? input
          : { ...input, settings: { ...input.settings, values: { ...input.settings.values, "instance.port": port } } };
        const exit = yield* Effect.exit(
          SettingsInput.read.pipe(Effect.provideService(WorkerEnvironment, { INSTANCE: Formatter.formatJson(raw) })),
        );
        expect(Exit.isSuccess(exit)).toBe(valid);

        if (Exit.isSuccess(exit)) {
          expect(exit.value.values.port).toBe(port);
        }
      }).pipe(Effect.provide(Digest.layerWebCrypto)),
    // vector: the port protocol's inclusive endpoints and their immediate neighbours.
    [[1], [65535], [0], [65536]],
  );

  StartsTest.law(
    "L3 deployment, corruption and repeat delivery check complete snapshots every time",
    fc.tuple(StartsTest.recipe, fc.array(fc.nat(), { minLength: 10, maxLength: 50 }), StartsTest.sentinel),
    ([initial, choices, secret]) =>
      Effect.gen(function* () {
        let current = yield* StartsTest.input(initial);

        for (const [index, choice] of choices.entries()) {
          const moves = ["valid", "corrupt", "deploy", "repeat"];
          const move = moves[choice % moves.length];

          if (move === "deploy") {
            current = yield* StartsTest.input({
              ...initial,
              start: `${initial.start}-${index}`,
              port: (choice % 65535) + 1,
            });
            continue;
          }

          const raw =
            move === "corrupt" ? StartsTest.corrupt(current, Math.floor(choice / moves.length), secret) : current;
          const exit = yield* Effect.exit(
            SettingsInput.read.pipe(
              Effect.provideService(WorkerEnvironment, {
                INSTANCE: Formatter.formatJson(raw),
                UNRELATED_PASSWORD: secret,
              }),
            ),
          );
          expect(Exit.isSuccess(exit)).toBe(move !== "corrupt");

          if (Exit.isSuccess(exit)) {
            expect(exit.value.snapshot).toEqual(current.settings);
            expect(exit.value.values).toEqual({
              port: current.settings.values["instance.port"],
              version: "0.0.0",
              gatewayLimit: StartsTest.rateLimit.limit,
              gatewayWindow: StartsTest.rateLimit.window,
              brainThrottle: current.settings.values["desktop.brain-throttle"],
              brainPoll: current.settings.values["desktop.brain-poll"],
              brainStartTimeout: current.settings.values["desktop.brain-start-timeout"],
              brainStopTimeout: current.settings.values["desktop.brain-stop-timeout"],
              // A byte size is saved as its JSON spelling and read back as a byte count.
              brainMemory: Schema.decodeUnknownSync(Schema.toCodecJson(Schema.ByteSize))(
                current.settings.values["desktop.brain-memory"],
              ),
              brainGrace: current.settings.values["desktop.brain-grace"],
              desktopLinkTtl: current.settings.values["desktop.link-ttl"],
              // T1041: the two mail settings; a byte size is saved as its count of bytes in text.
              mailUnread: current.settings.values["mail.unread"],
              mailChunk: ByteSize.bytes(BigInt(String(current.settings.values["mail.chunk"]))),
              // P39 slice 3: the recipe sets no hands key, so the start reads the default, none.
              handsTarget: null,
              // P34c: the three quota settings. A byte size inside them is saved as its text and
              // read back with its declaration's schema.
              writes: current.settings.values["limits.writes"],
              storage: Schema.decodeUnknownSync(Declarations.storage.schema)(current.settings.values["limits.storage"]),
              recovery: Schema.decodeUnknownSync(Declarations.recovery.schema)(
                current.settings.values["limits.recovery"],
              ),
            });
            StartsTest.exclude(exit.value, secret);
          }
        }
      }).pipe(Effect.provide(Digest.layerWebCrypto)),
  );
});
