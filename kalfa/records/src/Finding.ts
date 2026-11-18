/**
 * What the four checks report, one union for all of them (decisions 0605 to 0607, and 0610 for the map). Each case is one
 * place that breaks one rule; the words that teach the rule are in `cli.ts`.
 */
import { Schema } from "effect";

/**
 * A decision's number as its file name and its `id` write it: four digits.
 *
 * @category models
 */
export const DecisionId = Schema.String.check(Schema.isPattern(/^\d{4}$/));

/**
 * One broken rule at one place, tagged by the check that found it.
 *
 * **Details**
 *
 * - `status` (0606): the decision's `id`, `status` or `successor` is not what its file and the two statuses say. `raw` is the value as written.
 * - `patch` (0605): a decision that patches another, in one of the three forms.
 * - `link` (0607): a link to a superseded record, `target`, whose successor `live` is the record to link.
 * - `map` (0610; advice, never a failure): the instruction file `path` has more `lines` than `max`.
 *
 * `line` counts from 1.
 *
 * @category models
 */
export const Finding = Schema.TaggedUnion({
  status: { path: Schema.String, line: Schema.Int, raw: Schema.String },
  patch: {
    path: Schema.String,
    line: Schema.Int,
    form: Schema.Literals(["amendments", "still-holds", "carried-forward"]),
  },
  link: { path: Schema.String, line: Schema.Int, target: DecisionId, live: DecisionId },
  map: { path: Schema.String, lines: Schema.Int, max: Schema.Int },
});

/**
 * One finding, as a value.
 *
 * @category models
 */
export type Finding = typeof Finding.Type;
