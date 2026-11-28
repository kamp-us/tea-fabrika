/**
 * The bin's teardown: what `runMain` does when the run ends, with both standard streams written whole first.
 *
 * Effect's `runMain` calls `process.exit` at once for any exit code that is not 0, and Node writes to a pipe
 * asynchronously on macOS, so output that Node has not written yet is lost: `check runbook | head` could show
 * fewer lines than were printed. This teardown writes an empty string to each stream and exits in the last
 * callback, since a write ends only when everything written before it has. A reader that closes early (`EPIPE`, as
 * in `check | head`) is the reader's business and leaves the run's code. A stream error before the run ends ends it 2.
 */
import { Exit, Predicate } from "effect";
import type { Runtime } from "effect";

/** What a stream's `error` event carries: Node says an `Error`, and the teardown reads a string, `null` or nothing just as safely. */
type Raised = Error | string | null | undefined;

/** One standard stream, as much of Node's as the teardown uses: `process.stdout` and `process.stderr` fit it. */
interface Stream {
  readonly write: (chunk: string, done: (error?: Error | null) => void) => boolean;
  readonly on: (event: "error", listener: (error: Raised) => void) => void;
}

/**
 * The two streams a run writes to.
 *
 * @category models
 */
export interface Streams {
  readonly stdout: Stream;
  readonly stderr: Stream;
}

/**
 * The teardown for a bin: the run's code, or 2 when it did not end with a number or a stream broke, after both
 * streams have written everything. The listeners are added when this is called, so call it before the run starts.
 *
 * @category running
 */
export const teardown = (streams: Streams): Runtime.Teardown => {
  // A stream that failed for a reason other than a closed reader: the run goes on, and ends 2.
  let broken = false;

  for (const stream of [streams.stdout, streams.stderr]) {
    stream.on("error", (error) => {
      if (!(Predicate.hasProperty(error, "code") && error.code === "EPIPE")) {
        broken = true;
      }
    });
  }

  return (exit, onExit) => {
    const code = Exit.isSuccess(exit) && Predicate.isNumber(exit.value) && !broken ? exit.value : 2;

    // An empty write ends when everything before it is written, so each callback runs after that stream is whole.
    streams.stdout.write("", () => streams.stderr.write("", () => onExit(code)));
  };
};
