// T502 PR 2, next/. Lead runs this outside the box; no sibling patch is installed.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { String as Str } from "effect";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Formatter from "effect/Formatter";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { noTracking, scopedEnv } from "./env.test-support.ts";
import { heldPort } from "./port.test-support.ts";

it.effect("scenario: Ping.hit -> Pong.back -> Ping.leaf; the bare per-call lookup plant fails (A2, real workerd)", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const source = yield* fs.readFileString(path.join(import.meta.dirname, "sibling-objects.test-support.ts"));
    yield* Effect.sync(noTracking);

    for (const bare of [false, true]) {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const home = yield* fs.makeTempDirectoryScoped({ prefix: "t502-s-" });
          yield* scopedEnv({ ALCHEMY_HOME: path.join(home, "alchemy") });
          const port = yield* Effect.acquireRelease(heldPort(), (p) => p.release);
          yield* scopedEnv({ T502_PORT: String(port.port) });
          yield* fs.symlink(resolve(import.meta.dirname, "../node_modules"), path.join(home, "node_modules"));
          yield* fs.writeFileString(path.join(home, "package.json"), Formatter.formatJson({ type: "module" }));
          const file = path.join(home, "objects.ts");
          yield* fs.writeFileString(
            file,
            bare
              ? Str.replace(
                  'const reply = yield* pongs.getByName("one").back(n + 1);',
                  'const pongs = yield* Pong; const reply = yield* pongs.getByName("one").back(n + 1);',
                )(source)
              : source,
          );
          const Cloudflare = yield* Effect.promise(() => import("@alchemy.run/cloudflare"));
          const Alchemy = yield* Effect.promise(() => import("alchemy"));
          const { deploy } = yield* Effect.promise(() => import("alchemy/Deploy"));
          const { localState } = yield* Effect.promise(() => import("alchemy/State/LocalState"));
          const { AlchemyContext } = yield* Effect.promise(() => import("alchemy/AlchemyContext"));
          const { ArtifactStore, createArtifactStore } = yield* Effect.promise(() => import("alchemy/Artifacts"));
          const Interaction = yield* Effect.promise(() => import("alchemy/Interaction"));
          const { AuthProvidersLive } = yield* Effect.promise(() => import("alchemy/Auth/Registry"));

          const fixture: typeof import("./sibling-objects.test-support.ts") = yield* Effect.promise(
            () => import(pathToFileURL(file).href),
          );

          const stack = Alchemy.Stack(
            "siblings",
            { providers: Cloudflare.providers(), state: Alchemy.localState() },
            fixture.Host.pipe(Effect.asVoid, Effect.provide(fixture.default)),
          );

          // oxlint-disable-next-line fabrika/no-stage-word -- Alchemy's own key picks its deployment state
          yield* deploy({ stack, stage: "local", dev: true, scope: yield* Effect.scope }).pipe(
            Effect.asVoid,
            Effect.provide(localState()),
            Effect.provide(
              Layer.mergeAll(
                Layer.succeed(AlchemyContext, { dotAlchemy: path.join(home, ".alchemy"), dev: true, adopt: false }),
                Layer.succeed(ArtifactStore, createArtifactStore()),
                Interaction.layerNonInteractive(),
                AuthProvidersLive,
              ),
            ),
          );

          const reply = yield* Effect.tryPromise(() => fetch(`http://127.0.0.1:${port.port}`)).pipe(
            Effect.retry({ times: 100, schedule: Schedule.spaced("100 millis") }),
          );

          const body = yield* Effect.promise(() => reply.text());
          expect(reply.ok).toBe(!bare);
          expect(bare ? body : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(body)).toEqual(
            bare ? expect.stringContaining("Pong") : { path: ["ping.hit", "pong.back", "ping.leaf"], n: 3 },
          );
        }),
      );
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);
