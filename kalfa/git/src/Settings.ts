/**
 * The settings of the git package: the limits every call keeps, and who the commits it writes name as their committer.
 *
 * **Details**
 *
 * Every value is required, with no default: the app gives each one where it builds the layer. A setting's value is plain data, so the time limit is duration text such as `"10 seconds"`, and `timeLimit` decodes it.
 */
import { Duration, Option, Schema } from "effect";
import * as Commit from "./Commit.ts";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

// Duration text is text that `Schema.DurationFromString` decodes to a finite length of time above zero.
const isDurationText = (text: string): boolean =>
  Option.match(Option.getSuccess(Schema.decodeUnknownResult(Schema.DurationFromString)(text)), {
    onNone: () => false,
    onSome: (duration) => Duration.isFinite(duration) && Duration.isPositive(duration),
  });

const TimeText = Schema.String.check(
  Schema.makeFilter((text: string) => isDurationText(text) || "Expected duration text above zero, such as 10 seconds"),
);

/**
 * Schema for the limits of one repository's calls.
 *
 * **Details**
 *
 * `commits` is the most commits one walk, or one merge-base answer, holds. `refs` is the most refs one `readRefs` answer holds. `bytes` is the most bytes one commit object holds, and the most stderr an error keeps. `files` is the most files one diff names, and a file that changes kind counts once. `diff` is the most bytes of file content one diff compares: each changed file's content before and after. `blob` is the most bytes of one file that `readFile` reads. `time` is the longest one call may take, as duration text above zero such as `"10 seconds"`. `kill` is how long git has to stop, once a call has run out of time, before it is killed, as duration text above zero such as `"5 seconds"`. A call that would pass a limit fails and never answers a cut list.
 *
 * @category models
 */
export const Limits = Schema.Struct({
  commits: Count,
  refs: Count,
  bytes: Count,
  files: Count,
  diff: Count,
  blob: Count,
  time: TimeText,
  kill: TimeText,
});

// Who a written commit names as its committer: a name and an email, which take what a signature's take. The time is no
// setting: it comes from the clock, at offset `+0000`.
const Committer = Schema.Struct({ name: Commit.Name, email: Commit.Email });

/**
 * Schema for the settings of the git package.
 *
 * **Details**
 *
 * `committer` is the name and email every commit the package writes names as its committer, with the clock's time.
 *
 * @category models
 */
export const Settings = Schema.Struct({ limits: Limits, committer: Committer });

export type Settings = typeof Settings.Type;

/**
 * The time limit as a length of time, decoded from its text.
 *
 * **Details**
 *
 * The text was checked when the settings were read, so this never fails for a value that came from `Settings`.
 *
 * @category conversions
 */
export const timeLimit = (settings: Settings): Duration.Duration =>
  Schema.decodeSync(Schema.DurationFromString)(settings.limits.time);

/**
 * The kill wait as a length of time, decoded from its text.
 *
 * **Details**
 *
 * It decodes inside a `{ limits: { kill } }` shape, so a missing or bad value fails with an error that names `limits.kill`. A value that came from `Settings` never fails.
 *
 * @category conversions
 */
export const killWait = (settings: Settings): Duration.Duration =>
  Schema.decodeUnknownSync(Schema.Struct({ limits: Schema.Struct({ kill: Schema.DurationFromString }) }))(settings)
    .limits.kill;
