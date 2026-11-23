// ChecksTest.layer: the Checks service in memory. Each poll of `job` takes the next answer from the
// list, and the last one repeats; `started` takes the next answer of its own list the same way
// (started by default); `log` serves one text. It asks GitHub nothing.
import { Effect, Layer, Option } from "effect";
import { Checks, type ChecksError, type Job } from "./Checks.ts";

/** One poll's answer: the job as it stands, none yet, or GitHub failing with this error. */
export type Poll = Option.Option<Job> | ChecksError;

/** Each build of the layer starts at the list's first answer. */
export const layer = (
  polls: ReadonlyArray<Poll>,
  log: string,
  starts: ReadonlyArray<boolean> = [true],
): Layer.Layer<Checks> =>
  Layer.sync(Checks, () => {
    let at = 0;
    let began = 0;

    const job = () =>
      Effect.suspend(() => {
        const poll = polls[Math.min(at, polls.length - 1)] ?? Option.none();
        at += 1;

        return Option.isOption(poll) ? Effect.succeed(poll) : Effect.fail(poll);
      });

    const started = () =>
      Effect.sync(() => {
        const answer = starts[Math.min(began, starts.length - 1)] ?? true;
        began += 1;

        return answer;
      });

    return Checks.of({ job, started, log: () => Effect.succeed(log) });
  });
