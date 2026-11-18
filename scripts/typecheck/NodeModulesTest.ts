// NodeModulesTest.layer: the NodeModules service in memory. The folder's shape is one mutable cell a
// law sets, CommandsTest's install changes, and `unlink` turns from `link` to `missing`, writing
// `unlink` to the shared log. It touches no disk. Today's tooling (0113), following next/'s rules
// (0033).
import { Effect, Layer } from "effect";
import { NodeModules, type Shape } from "./NodeModules.ts";

export type Folder = {
  /** What `./node_modules` is now. */
  shape: Shape;
  /** The shared log: `unlink` each time the link goes. */
  readonly log: Array<string>;
};

/** A fresh folder of `shape`, over the shared log `log`. */
export const folder = (shape: Shape, log: Array<string>): Folder => ({ shape, log });

export const layer = (f: Folder): Layer.Layer<NodeModules> =>
  Layer.succeed(
    NodeModules,
    NodeModules.of({
      shape: Effect.sync(() => f.shape),
      unlink: Effect.suspend(() => {
        if (f.shape !== "link") {
          return Effect.die(new Error(`NodeModulesTest: unlink on a ${f.shape}, not a link`));
        }

        f.log.push("unlink");
        f.shape = "missing";
        return Effect.void;
      }),
    }),
  );
