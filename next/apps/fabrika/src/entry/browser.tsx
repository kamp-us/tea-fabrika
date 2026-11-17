import { Id } from "@kampus/libfabrika";
import { start } from "@kampus/libfabrika/client/WindowStart";
import { mount } from "@kampus/tuval";
import { browserKey, browserRows, runMain } from "@kampus/tuval/browser";
import { Effect, Layer } from "effect";
import { Socket } from "effect/socket";
import { keys, tezgah, window, windowFor } from "./views.ts";

const page = Effect.scoped(
  Effect.gen(function* () {
    const origin = globalThis.location.origin;
    const build = document.querySelector('meta[name="fabrika-build"]')?.getAttribute("content") ?? "unknown";
    const element = document.getElementById("root");

    if (element === null) {
      return;
    }

    const client = { platform: "browser", os: "unknown", has: [], label: "Browser" } as const;
    const booting = yield* start({ tiles: [], tezgah, window, origin, build, client });
    const run = yield* booting.ready;
    yield* mount(element, { run, machine: window, origin, windowFor, keys });

    return yield* Effect.never;
  }),
).pipe(
  Effect.provide(Layer.mergeAll(browserKey, browserRows, Socket.layerWebSocketConstructorGlobal, Id.Generator.layer)),
);

page.pipe(runMain);
