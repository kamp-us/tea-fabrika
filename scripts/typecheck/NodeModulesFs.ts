// NodeModulesFs.layer: the NodeModules service on Effect's FileSystem, for `./node_modules` in the
// folder the typecheck runs in. `lstat` reads a link as a link, its target there or not, and
// `remove` takes the link away, never what it points at. Today's tooling (0113), following next/'s
// rules (0033).
import { Effect, FileSystem, Layer } from "effect";
import { NodeModules, NodeModulesError, type Shape } from "./NodeModules.ts";

const FOLDER = "node_modules";

export const layer: Layer.Layer<NodeModules, never, FileSystem.FileSystem> = Layer.effect(
  NodeModules,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const shape = fs.lstat(FOLDER).pipe(
      Effect.map((info): Shape =>
        info.type === "Directory" ? "folder" : info.type === "SymbolicLink" ? "link" : "other",
      ),
      Effect.catchIf(
        (e) => e.reason._tag === "NotFound",
        () => Effect.succeed<Shape>("missing"),
      ),
      Effect.mapError((cause) => new NodeModulesError({ reason: `${FOLDER} does not read: ${cause.message}`, cause })),
    );

    const unlink = fs
      .remove(FOLDER)
      .pipe(
        Effect.mapError(
          (cause) => new NodeModulesError({ reason: `the ${FOLDER} link does not remove: ${cause.message}`, cause }),
        ),
      );

    return NodeModules.of({ shape, unlink });
  }),
);
