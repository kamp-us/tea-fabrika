/**
 * What the checks report, one union for all of them. Each case is one
 * place that breaks one rule; the words that teach the rule are in `cli.ts`.
 */
import { Schema } from "effect";

/**
 * The rules a runbook, or the sev skill's list of them, can break; see `Finding`.
 *
 * @category models
 */
export const RunbookRule = Schema.Literals(["summary", "heading", "unlinked", "dangling"]);

/**
 * One broken rule at one place, tagged by the check that found it.
 *
 * **Details**
 *
 * - `map` (advice, never a failure): the instruction file `path` has more `lines` than `max`.
 * - `runbook` a runbook, or the sev skill's list of them, breaks one `rule` of its shape. `raw` is the heading or path the rule names, and `""` when it names none.
 *
 * `line` counts from 1.
 *
 * @category models
 */
export const Finding = Schema.TaggedUnion({
  map: { path: Schema.String, lines: Schema.Int, max: Schema.Int },
  runbook: {
    path: Schema.String,
    line: Schema.Int,
    rule: RunbookRule,
    raw: Schema.String,
  },
});

/**
 * One finding, as a value.
 *
 * @category models
 */
export type Finding = typeof Finding.Type;
