/**
 * Bans the pre-v4 service forms `Context.Tag(...)`, `Context.GenericTag(...)` and `Effect.Service(...)`, and asks for
 * Effect v4's `Context.Service`.
 *
 * The code is on Effect v4. The v3 service idioms are wrong there; the one v4 idiom is
 * `class S extends Context.Service<S, Shape>()("id") {}`. The rule is a regression gate: it stops a v3 form from coming
 * back into code that has none.
 *
 * It matches the member itself (`Context.Tag` and the rest) and not a call, because the forms differ in arity and type
 * arguments (`Context.Tag("id")<S, Shape>()`, `Context.GenericTag<Shape>("id")`, `Effect.Service<S>()("id", {...})`): the
 * bare member is the stable shape common to all of them. That includes a type (`type T = Context.Tag`,
 * `interface I extends Context.Tag<X>`).
 */
import type { CreateRule } from "@oxlint/plugins";
import { banNames } from "./internal/Syntax.ts";

const fix = (id: string) =>
  `Fix: define the service as \`class S extends Context.Service<S, Shape>()('id') {}\`. Exception: // oxlint-disable-next-line ${id} -- <reason>.`;

/**
 * Refuses `Context.Tag`, `Context.GenericTag` and `Effect.Service`, in values and in types.
 *
 * @category rules
 */
export const noContextTag: CreateRule = {
  create: banNames((id) => ({
    "Context.Tag": `\`Context.Tag(...)\` is the Effect-v3 service form and is banned: this code is on Effect v4. ${fix(id)}`,
    "Context.GenericTag": `\`Context.GenericTag(...)\` is the Effect-v3 service form and is banned: this code is on Effect v4. ${fix(id)}`,
    "Effect.Service": `\`Effect.Service(...)\` is not used here: v4 uses \`Context.Service\` only. ${fix(id)}`,
  })),
};
