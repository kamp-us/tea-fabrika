// M1 to M5 on real workerd: the same suite the stand-in runs on every pull request (`Platform.test.ts`), run against the raw gateway
// mounted in a Durable Object by `platform-gateway-worker.test-support.ts`, through Alchemy's local dev. It is an integration law: it
// starts workerd and binds a port on 127.0.0.1, so the laptop refuses it by its name and it runs in the lead's proof run and on main's
// full run. Its point is that the stand-in keeps the platform's rules, so no stand-in could replace it. R0 (`Platform.integration.test.ts`)
// runs first in the proof run and is a file of its own, so that a product that is not built yet never stops it.
//
// One run of three draws, each on an object of its own and side by side: a sleep waits for the platform's idle timer, so the 12 seconds
// are waited once for the three, not three times one after another (a test has 60 seconds). A run sleeps at most once.
import { NodeServices } from "@effect/platform-node";
import { layer } from "@effect/vitest";
import { Context, Effect, FileSystem, Layer, Path, Queue, Schedule, Schema } from "effect";
import type { Scope } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { GateReportText } from "./platform-gate-wire.test-support.ts";
import { connect, freePort } from "./Platform.test-support.ts";
import { platformLaws } from "./PlatformLaws.test-support.ts";
import type { Session, World } from "./PlatformLaws.test-support.ts";

/** How long the object is left alone: the platform says 10 seconds with no event (R0 saw 12 enough), and this is 12. */
const IDLE = "12 seconds";

/** How long an event that never comes is waited for, as R0's. */
const SETTLE = "3 seconds";

/** A module that would not load. It is a fault of the set-up, so the layer dies with it. */
class LoadFailed extends Schema.TaggedError<LoadFailed, { readonly brand: unique symbol }>()("LoadFailed", {
  cause: Schema.Defect(),
}) {}

/** A module loaded now, after the environment is set. */
const load = <A>(module: () => Promise<A>) =>
  Effect.orDie(Effect.tryPromise({ try: module, catch: (cause) => new LoadFailed({ cause }) }));

class Deployed extends Context.Service<Deployed, { readonly port: number }>()(
  "@kalfa/transport/cloudflare/PlatformLaws.integration.test.Deployed",
) {}

/** The gateway Worker, built and run by Alchemy's local dev on a port of its own; released with the scope. */
const deployed = Layer.effect(
  Deployed,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "m-" });
    const port = yield* freePort;

    // Alchemy and the Worker's module read these three variables themselves, so this file is the one place that writes them.
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const saved = [process.env.ALCHEMY_HOME, process.env.PLATFORM_PORT, process.env.DO_NOT_TRACK] as const;

        process.env.ALCHEMY_HOME = path.join(home, "alchemy");
        process.env.PLATFORM_PORT = String(port);
        process.env.DO_NOT_TRACK = "1";

        return saved;
      }),
      (saved) =>
        Effect.sync(() => {
          for (const [key, value] of [
            ["ALCHEMY_HOME", saved[0]],
            ["PLATFORM_PORT", saved[1]],
            ["DO_NOT_TRACK", saved[2]],
          ] as const) {
            if (value === undefined) {
              delete process.env[key];
            } else {
              process.env[key] = value;
            }
          }
        }),
    );

    const Cloudflare = yield* load(() => import("@alchemy.run/cloudflare"));
    const Alchemy = yield* load(() => import("alchemy"));
    const { deploy } = yield* load(() => import("alchemy/Deploy"));
    const { localState } = yield* load(() => import("alchemy/State/LocalState"));
    const { AlchemyContext } = yield* load(() => import("alchemy/AlchemyContext"));
    const { ArtifactStore, createArtifactStore } = yield* load(() => import("alchemy/Artifacts"));
    const Interaction = yield* load(() => import("alchemy/Interaction"));
    const { AuthProvidersLive } = yield* load(() => import("alchemy/Auth/Registry"));
    const fixture = yield* load(() => import("./platform-gateway-worker.test-support.ts"));

    const stack = Alchemy.Stack(
      "platform-gate",
      { providers: Cloudflare.providers(), state: Alchemy.localState() },
      fixture.GateHost.pipe(Effect.asVoid, Effect.provide(fixture.default)),
    );

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

    // Any answer says the Worker is up: this path names no object and role, so the Worker answers 404.
    yield* HttpClient.get(`http://127.0.0.1:${port}/ready`).pipe(
      Effect.retry({ times: 100, schedule: Schedule.spaced("100 millis") }),
    );

    return { port };
  }).pipe(Effect.provide([NodeServices.layer, FetchHttpClient.layer])),
);

let objects = 0;

/** A world on real workerd: one object of its own, its three sockets told apart by path, its reports read from the log socket. */
const workerd: Effect.Effect<World, never, Deployed | Scope.Scope> = Effect.gen(function* () {
  const { port } = yield* Deployed;
  const base = `ws://127.0.0.1:${port}/g-${(objects += 1)}`;
  const reports = yield* Queue.unbounded<typeof GateReportText.Type>();

  // The log socket first, so no report can be made before it is there to carry it.
  const log = yield* Effect.orDie(connect(`${base}/log`));

  yield* Effect.forkScoped(
    Effect.forever(
      Effect.flatMap(Queue.take(log.inbox), (text) =>
        Effect.flatMap(Effect.orDie(Schema.decodeUnknownEffect(GateReportText)(text)), (report) =>
          Queue.offer(reports, report),
        ),
      ),
    ),
  );

  const session = (path: string) =>
    Effect.map(Effect.orDie(connect(`${base}/${path}`)), (client): Session => ({ client, reports }));

  return {
    kind: "workerd",
    maxSleeps: 1,
    patience: "10 seconds",
    open: (options) =>
      session(options === undefined ? "main" : `main?options=${encodeURIComponent(JSON.stringify(options))}`),
    stranger: session("stranger"),
    sleep: Effect.sleep(IDLE),
    settle: Effect.sleep(SETTLE),
  };
});

layer(deployed, { excludeTestServices: true, timeout: "120 seconds" })("M1 to M5 on real workerd", (it) => {
  platformLaws(it.effect, workerd, { runs: 1, draws: 3, concurrency: "unbounded" });
});
