// D4a: no tie to one class. The compile-time laws need tsc (the lead runs it after the build); each is written as a function the test
// never calls, so no value is declared and the file also runs under vitest, as `../Transport.types.test.ts` does.
import * as Cloudflare from "@alchemy.run/cloudflare";
import { expectTypeOf, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Layer } from "effect";
import { Gateway } from "./index.ts";
import type { HeldSocket } from "./index.ts";

// D4a. Plant: type a slot's socket as `Cloudflare.WebSocket` in `Gateway.ts`: the stand-in's socket line fails; give `upgrade` a class
// argument: the spread into `AppGateway` fails.
const mounts = (handlers: Layer.Layer<Gateway>, held: Cloudflare.WebSocket) => {
  const slots = Effect.gen(function* () {
    const gateway = yield* Gateway;

    // The gateway's slots have Alchemy's own signatures, so a class's shape takes them as they are.
    return {
      fetch: gateway.upgrade(),
      webSocketMessage: gateway.webSocketMessage,
      webSocketClose: gateway.webSocketClose,
      webSocketError: gateway.webSocketError,
    } satisfies Cloudflare.DurableObjectShape;
  }).pipe(Effect.provide(handlers));

  // An app's gateway class, and a Ledger object that mounts the same gateway beside a call of its own: no slot names either.
  class AppGateway extends Cloudflare.DurableObject<AppGateway>()("AppGateway", Effect.succeed(slots)) {}

  class LedgerObject extends Cloudflare.DurableObject<LedgerObject>()(
    "LedgerObject",
    Effect.succeed(Effect.map(slots, (shape) => ({ ...shape, append: () => Effect.succeed(1) }))),
  ) {}

  // An Alchemy socket fits a slot as it is, and what a Gateway needs of a socket is four of its calls.
  expectTypeOf(held).toExtend<HeldSocket>();
  expectTypeOf<HeldSocket>().toEqualTypeOf<
    Pick<Cloudflare.WebSocket, "send" | "close" | "getAttachment" | "setAttachment">
  >();

  return [AppGateway, LedgerObject, held satisfies HeldSocket];
};

/** A socket that is no Alchemy socket: a plain object with the same four calls, as the stand-in's socket is. */
const standIn = (): HeldSocket => ({
  send: () => Effect.void,
  close: () => Effect.void,
  getAttachment: () => Effect.die("a stand-in socket"),
  setAttachment: () => Effect.void,
});

it("D4a type: a Gateway's four slots are spread into the shapes of two classes, an Alchemy socket and the stand-in's fit a slot, and a slot names no class", () => {
  expectTypeOf(mounts).toBeFunction();
  expectTypeOf(standIn).toBeFunction();
});
