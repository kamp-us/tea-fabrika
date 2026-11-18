/**
 * A decision's status (decision 0606): `accepted`, or `superseded` by one named record. Nothing else
 * is a status, so "amended in part by five records" cannot be written down.
 */
import { Predicate, Result, Schema } from "effect";
import { DecisionId, Finding } from "./Finding.ts";

/**
 * The two statuses. A superseded record names the record that took its place, `successor`.
 *
 * @category models
 */
export const Status = Schema.TaggedUnion({
  accepted: {},
  superseded: { successor: DecisionId },
});

/**
 * A decision's status, as a value.
 *
 * @category models
 */
export type Status = typeof Status.Type;

/** What a status line and its successor say, before the two are put together. */
const Written = Schema.Struct({
  status: Schema.Literals(["accepted", "superseded"]),
  successor: Schema.optional(DecisionId),
});

/**
 * Reads a status from a decision's frontmatter, as `yaml` parsed it.
 *
 * **Details**
 *
 * `accepted` has no successor and `superseded` has one, four digits. Anything else is one `status` finding at `at`, with the status as it was written (`""` when it is missing or not text).
 *
 * @category constructors
 */
export const decodeStatus = (
  frontmatter: unknown,
  at: { readonly path: string; readonly line: number },
): Result.Result<Status, Finding> => {
  const written = Schema.decodeUnknownResult(Written)(frontmatter);

  const raw =
    Predicate.hasProperty(frontmatter, "status") && Predicate.isString(frontmatter.status) ? frontmatter.status : "";

  const wrong = Result.fail(Finding.cases.status.make({ path: at.path, line: at.line, raw }));

  if (Result.isFailure(written)) {
    return wrong;
  }

  const { status, successor } = written.success;

  if (status === "accepted") {
    return successor === undefined ? Result.succeed(Status.cases.accepted.make({})) : wrong;
  }

  return successor === undefined ? wrong : Result.succeed(Status.cases.superseded.make({ successor }));
};
