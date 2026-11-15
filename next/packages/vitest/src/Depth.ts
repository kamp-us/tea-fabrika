/**
 * How deep a test run goes (decision 0535), and the only reader of `FABRIKA_TEST_DEPTH` (decision
 * 0538). A pull request and the merge queue run `fast`; the 3-hour schedule sets
 * `FABRIKA_TEST_DEPTH=full` and runs `full`. A law over real IO reads its case count here, never as a
 * number of its own, and lint holds that (`fabrika/runs-from-depth`). Anything else that has a fast
 * form and a full form, such as an in-memory layer beside a real one, reads `depth`.
 *
 * @stability unstable
 */
import * as Schema from "effect/Schema";

const Depth = Schema.Literals(["fast", "full"]);

type Depth = typeof Depth.Type;

/**
 * The depth a value of `FABRIKA_TEST_DEPTH` names: unset is `fast`, and any other word fails the run.
 *
 * @stability unstable
 * @category decoding
 */
export const decodeDepth = (value: string | undefined): Depth => Schema.decodeUnknownSync(Depth)(value ?? "fast");

/**
 * This run's depth, read once.
 *
 * @stability unstable
 * @category depth
 */
export const depth: Depth = decodeDepth(process.env.FABRIKA_TEST_DEPTH);

/**
 * The fewest cases a `fast` count may name, unless the law's full count is smaller still. Below three
 * a generated law is barely more than its first example (experiment 291's sketch of this helper).
 *
 * @stability unstable
 * @category constants
 */
export const LEAST = 3;

/**
 * A law's case counts: `fast` proves the law on every pull request, `full` is the count it had.
 *
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
 * @category counts
 */
export const runsFor = (runs: Runs): number => runsAt(depth, runs);
