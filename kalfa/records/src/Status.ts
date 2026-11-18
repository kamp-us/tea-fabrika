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
 * `accepted` has no successor and `superseded` has one, four digits. Anything else is one `status` finding, with the value as it was written (`""` when it is missing or not text). A status that is not one of the two, and a `superseded` with no successor, are reported at `at.line`, the status line, with the status as `raw`. A successor that is wrong, one that is not four digits or one that an `accepted` record has, is reported at `at.successor`, the `successor:` line, with the successor as `raw`; with no `at.successor`, at `at.line`.
 *
 * @category constructors
 */
export const decodeStatus = (
  frontmatter: unknown,
  at: { readonly path: string; readonly line: number; readonly successor?: number },
): Result.Result<Status, Finding> => {
  const written = Schema.decodeUnknownResult(Written)(frontmatter);

  const value = (key: string) => (Predicate.hasProperty(frontmatter, key) ? frontmatter[key] : undefined);

  const text = (key: string) => {
    const written = value(key);

    return Predicate.isString(written) ? written : "";
  };

  const wrong = (key: "status" | "successor") =>
    Result.fail(
      Finding.cases.status.make({
        path: at.path,
        line: key === "successor" ? (at.successor ?? at.line) : at.line,
        raw: text(key),
      }),
    );

  const status = value("status");
  const named = status === "accepted" || status === "superseded";

  if (Result.isFailure(written)) {
    return wrong(named && value("successor") !== undefined ? "successor" : "status");
  }

  const { successor } = written.success;

  if (written.success.status === "accepted") {
    return successor === undefined ? Result.succeed(Status.cases.accepted.make({})) : wrong("successor");
  }

  return successor === undefined ? wrong("status") : Result.succeed(Status.cases.superseded.make({ successor }));
};
