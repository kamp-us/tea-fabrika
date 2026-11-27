// SignaturesTest.layer: the Signatures service in memory. It names the unsigned commits, as told, or cannot
// read, as git can fail. It asks git nothing.
import { Effect, Layer } from "effect";
import { Signatures, SignaturesError } from "./Signatures.ts";

/** The unsigned commits, as `<8 hex> <subject>`, and why git cannot be read when it cannot. */
export type World = { readonly unsigned?: ReadonlyArray<string>; readonly broken?: string };

export const layer = (w: World = {}): Layer.Layer<Signatures> =>
  Layer.succeed(
    Signatures,
    Signatures.of({
      unsigned: () =>
        w.broken === undefined
          ? Effect.succeed(w.unsigned ?? [])
          : Effect.fail(SignaturesError.make({ reason: w.broken })),
    }),
  );
