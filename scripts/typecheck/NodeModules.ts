// NodeModules: what `./node_modules` is, and the removal of a link there. This file is the contract
// only (0095): `NodeModulesFs.layer` reads the disk and `NodeModulesTest.layer` keeps a shape in
// memory. Today's tooling (0113), following next/'s rules (0033).
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** What `./node_modules` is. A link counts as a link whether or not its target is there. */
export const Shape = Schema.Literals(["folder", "link", "missing", "other"]);

export type Shape = typeof Shape.Type;

/** `./node_modules` could not be read or its link removed. */
export class NodeModulesError extends Schema.TaggedError<NodeModulesError>()("NodeModulesError", {
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class NodeModules extends Context.Service<
  NodeModules,
  {
    readonly shape: Effect.Effect<Shape, NodeModulesError>;
    /** Removes the link only, never what it points at. */
    readonly unlink: Effect.Effect<void, NodeModulesError>;
  }
>()("scripts/typecheck/NodeModules") {}
