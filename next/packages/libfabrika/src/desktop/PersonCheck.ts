/**
 * Person confirmation, without a platform handle or an implementation.
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Schema for a person check's answer: `checked`, by touch or by click, or `declined`.
 *
 * @category schemas
 */
export const Answer = Schema.TaggedUnion({
  checked: { check: Schema.Literals(["touch", "click"]) },
  declined: {},
});

/**
 * Error for a person check that could not run. It keeps the underlying cause.
 *
 * @category errors
 */
export class Unavailable extends Schema.TaggedError<Unavailable, { readonly brand: unique symbol }>()("Unavailable", {
  cause: Schema.Defect(),
}) {}

/**
 * Error that a person check fails with. Its `reason` names the failure.
 *
 * @category errors
 */
export class PersonCheckError extends Schema.TaggedError<PersonCheckError, { readonly brand: unique symbol }>()(
  "PersonCheckError",
  {
    reason: Schema.Union([Unavailable]),
  },
) {}

/**
 * Service that asks a person to confirm the action `reason` describes, and answers `checked` or `declined`.
 *
 * @category services
 */
export class PersonCheck extends Context.Service<
  PersonCheck,
  {
    readonly ask: (reason: string) => Effect.Effect<typeof Answer.Type, PersonCheckError>;
  }
>()("@kampus/libfabrika/desktop/PersonCheck") {}
