/**
 * How deep a test run goes: `fast` or `full`, read once from `KALFA_QUALITY_VITEST_DEPTH` while this
 * module loads. Unset is `fast`; any other value than the two words fails the run. A law over real
 * input and output reads its case count here, never as a number of its own. Anything else with a
 * fast form and a full form, such as an in-memory layer beside a real one, reads `depth`.
 */
import * as Schema from "effect/Schema";

const Depth = Schema.Literals(["fast", "full"]);

type Depth = typeof Depth.Type;

/**
 * The depth a value of `KALFA_QUALITY_VITEST_DEPTH` names: unset is `fast`, and any other word fails the run.
 *
 * @category decoding
 */
export const decodeDepth = (value: string | undefined): Depth => Schema.decodeUnknownSync(Depth)(value ?? "fast");

/**
 * This run's depth, read once.
 *
 * @category depth
 */
export const depth: Depth = decodeDepth(process.env.KALFA_QUALITY_VITEST_DEPTH);

/**
 * The fewest cases a `fast` count may name, unless the law's full count is smaller still. Below three
 * a generated law is barely more than its first example.
 *
 * @category constants
 */
export const LEAST = 3;

/**
 * A law's case counts: `fast` proves the law on every pull request, `full` is the count it had.
 *
 * @category models
 */
export interface Runs {
  readonly fast: number;
  readonly full: number;
}

/**
 * The count a law runs at a depth. A count that is not a whole number, or a `fast` above `full` or
 * under `LEAST`, fails.
 *
 * @category counts
 */
export const runsAt = (at: Depth, { fast, full }: Runs): number => {
  if (!Number.isInteger(fast) || !Number.isInteger(full) || full < 1 || fast > full || fast < Math.min(LEAST, full)) {
    throw new Error(`runsFor: fast ${fast} must be a whole number from ${Math.min(LEAST, full)} to full ${full}`);
  }

  return at === "full" ? full : fast;
};

/**
 * The count a law runs in this run: `runsFor({ fast: 10, full: 100 })` is 10 on a pull request and
 * 100 on the schedule.
 *
 * @category counts
 */
export const runsFor = (runs: Runs): number => runsAt(depth, runs);
